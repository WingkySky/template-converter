// 基线驱动器共享模块：以真实 UI 入口驱动 legacy 管道
// （handleFiles → selectTemplate → confirmTemplate → generateOutput），
// 产物为「导出落盘前的字节」，绕过 saveWorkbook 的文件系统副作用。
// 阶段 1-3 期间经 window 测试面桥接调用；阶段 4 起切换为直连 core 模块。
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { setupBrowserStubs, stubVendorGlobals } from './browser-stubs.mjs';

let loaded = null;

export async function getLegacy() {
  if (loaded) return loaded;
  setupBrowserStubs();
  stubVendorGlobals(XLSX, ExcelJS);
  await import('../../src/legacy.js');
  loaded = { XLSX, ExcelJS, w: globalThis.window };
  return loaded;
}

function getLoaded() {
  if (!loaded) throw new Error('请先 await getLegacy()');
  return loaded;
}

export const fileEntry = (path, name) => ({
  name: name ?? path.split(/[\\/]/).pop(),
  _buf: readFileSync(path),
});

// 用知识库格式 fixture（10 列）种子化 localStorage 知识库
export function seedKB(path) {
  const { XLSX, w } = getLoaded();
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
  const kb = w.loadKB();
  const res = w.mergeKnowledgeRows(rows, kb);
  w.saveKB(kb);
  return res;
}

const toBuffer = data => Buffer.from(data);

async function collectArtifacts(w, state, template, mode) {
  const out = [];
  const headers = state.outputHeaders;
  const rows = state.outputRows;
  if (mode === 'merge') {
    const wbOut = await w.buildWorkbookForTemplate(template, headers, rows);
    const data = wbOut && wbOut.__exceljsBuffer
      ? toBuffer(wbOut.__exceljsBuffer)
      : toBuffer(XLSX.write(wbOut, { type: 'buffer', bookType: 'xlsx' }));
    out.push({ name: w.getExportFileNameForTemplate(template, 'xlsx'), data, ext: 'xlsx' });
    out.push({ name: w.getExportFileNameForTemplate(template, 'csv'), data: Buffer.from('\uFEFF' + w.rowsToCSV(headers, rows)), ext: 'csv' });
  } else {
    state.exportMode = mode; // 'byFile' | 'bySheet'
    for (const ext of ['xlsx', 'csv']) {
      const files = await w.buildSplitFilesForTemplates([template], ext);
      for (const f of files) out.push({ name: f.name, data: toBuffer(f.data), ext });
    }
  }
  return out;
}

export async function runCase({ id, files, template, sbyPlainAmount = true, sbyShowBatchInfo = false }) {
  const { w } = getLoaded();
  const { state } = w.__legacy;
  w.resetAll();
  w.handleFiles(files);
  w.confirmMapping(); // 等价于用户点击「确认映射」：构建 mappingState.sourcesData
  w.selectTemplate(template);
  w.confirmTemplate();
  if (template === 'shenbianyun' && (!sbyPlainAmount || sbyShowBatchInfo)) {
    state.sbyPlainAmount = sbyPlainAmount;
    state.sbyShowBatchInfo = sbyShowBatchInfo;
    w.generateOutput();
  }
  const artifacts = [
    ...(await collectArtifacts(w, state, template, 'merge')),
    ...(await collectArtifacts(w, state, template, 'byFile')),
    ...(await collectArtifacts(w, state, template, 'bySheet')),
  ];
  return {
    snapshot: {
      headers: [...(state.outputHeaders || [])],
      rows: (state.outputRows || []).map(r => [...r]),
      batchNo: state.batchNo,
      cleanCount: state.cleanCount,
    },
    artifacts,
  };
}

export { XLSX };
