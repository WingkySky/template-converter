// 基线驱动器共享模块：以真实 UI 入口驱动转换管道
// （handleFiles → selectTemplate → confirmTemplate → generateOutput），
// 产物为「导出落盘前的字节」，绕过 saveWorkbook 的文件系统副作用。
// 阶段 4 起 legacy.js/window 测试面已退役，本驱动器直连 ui/steps 等模块（window 不再使用）。
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { setupBrowserStubs, stubVendorGlobals } from './browser-stubs.mjs';

let loaded = null;

export async function getLegacy() {
  if (loaded) return loaded;
  setupBrowserStubs();
  stubVendorGlobals(XLSX, ExcelJS);
  const stateMod = await import('../../src/state');
  const exportMod = await import('../../src/ui/steps/export');
  const templateMod = await import('../../src/ui/steps/template');
  const uploadMod = await import('../../src/ui/steps/upload');
  const mappingMod = await import('../../src/ui/steps/mapping');
  const csvMod = await import('../../src/core/export/csv');
  const modelMod = await import('../../src/core/kb/model');
  const kbStorageMod = await import('../../src/io/kb-storage');
  const registryMod = await import('../../src/core/templates/registry');
  // 阶段 3 接缝：步骤模块的 confirmTemplate→generateOutput / resetAll 委托需要装配
  const { setExportControlsDeps } = await import('../../src/ui/export/controls');
  const { setPreviewTableDeps } = await import('../../src/ui/export/preview-table');
  const { setRemarkPanelDeps } = await import('../../src/ui/export/remark-panel');
  const { setSearchDropdownDeps } = await import('../../src/ui/search-dropdown');
  templateMod.setGenerateOutputHandler(exportMod.generateOutput);
  uploadMod.setResetAllHandler(exportMod.resetAll);
  // 渲染器依赖注入（浏览器侧由 main.ts 调 initExportPanelHandlers 完成同等装配）
  const deps = {
    showExportStep: exportMod.showExportStep,
    cacheCurrentTemplateOutput: exportMod.cacheCurrentTemplateOutput,
    getSelectedTemplates: templateMod.getSelectedTemplates,
    getSplitGroups: exportMod.getSplitGroups,
    getSplitGroupCounts: exportMod.getSplitGroupCounts,
    isSplitExportActive: exportMod.isSplitExportActive,
    ensureSplitBatches: exportMod.ensureSplitBatches,
  };
  setExportControlsDeps(deps);
  setPreviewTableDeps(deps);
  setRemarkPanelDeps(deps);
  setSearchDropdownDeps(deps);
  // 原 window 测试面 → 直连模块绑定（键名与阶段 1-3 的 w.* 保持一致）
  const w = {
    state: stateMod.state,
    resetAll: exportMod.resetAll,
    handleFiles: uploadMod.handleFiles,
    confirmMapping: mappingMod.confirmMapping,
    selectTemplate: templateMod.selectTemplate,
    confirmTemplate: templateMod.confirmTemplate,
    generateOutput: exportMod.generateOutput,
    buildWorkbookForTemplate: exportMod.buildWorkbookForTemplate,   // 查注册表分发，ctx 从 state 构造
    buildSplitFilesForTemplates: exportMod.buildSplitFilesForTemplates,
    getExportFileNameForTemplate: exportMod.getExportFileNameForTemplate,
    rowsToCSV: csvMod.rowsToCSV,
    mergeKnowledgeRows: modelMod.mergeKnowledgeRows,
    loadKB: kbStorageMod.loadKB,
    saveKB: kbStorageMod.saveKB,
    __legacy: { state: stateMod.state, TEMPLATES: registryMod.TEMPLATES },
  };
  loaded = { XLSX, ExcelJS, w };
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
