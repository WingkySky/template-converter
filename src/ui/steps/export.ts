// 第四步：生成与导出编排 —— 自 src/legacy.js 逐字搬移（阶段 4，legacy.js 退役）。
// 组成：
//  - generateOutput（ui 版）：调 core/generate/generate-outputData 纯转换 + 写 state
//    （含原 applyBatchShangShe 语义的 batchMatch 落库）+ showExportStep；
//  - showExportStep 及模版输出缓存（clone/cache/restore/switchPreviewTemplate）；
//  - 导出编排（文件名/批次号/拆分分组/ZIP/Excel/CSV/多模版打包）与 resetAll；
//  - 自定义列映射（showCustomMappingUI/genCustom）；
//  - 原 ui/legacy-bridge.ts 的 state 读包装（渲染器/搜索下拉所需），legacy-bridge 随本文件落位删除；
//  - 工作簿构建/文件命名改查 core/templates 注册表（ctx 从 state 构造）。
// 非逐字改动均在对应行有注释或在交付报告列明：
//  - showExportStep/showCustomMappingUI 动态 HTML 中残留的内联 onclick → data-action
//    （阶段 3 事件委托收尾，经 initExportStepDelegates 分发，window 桥退役）；
//  - showSplitBatchPanel 声明位置恢复为原版（阶段 3 搬移时误置于 if 块内）；
//  - state.sbyShowBatchInfo/sbyPlainAmount 的直接赋值改 Object.assign（state.ts satisfies
//    使布尔字段收窄为字面量类型，语义不变，与 controls.ts onSbyOptionChange 同款处理）。
import { escapeHTML, byId, delegateAction } from '../dom';
import { icon } from '../icons';
import { state, DEFAULT_PREVIEW_ROW_LIMIT, type AppState, type OutputRowMeta } from '../../state';
import type { Rows, Row } from '../../types';
import { COL_TYPE_LABELS } from '../../core/mapping/column-detect';
import { sanitizeAmount, cleanValue } from '../../core/clean/values';
import { generateOutputData } from '../../core/generate/generate-output';
import {
  TEMPLATES, buildWorkbookForTemplate as buildWorkbookFromRegistry,
  buildFileNameForTemplate, type TemplateContext,
} from '../../core/templates/registry';
import { rowsToCSV } from '../../core/export/csv';
import { getTodayStr } from '../../core/export/naming';
import {
  getSplitGroupsFromMeta as getSplitGroupsFromMetaCore,
  splitGroupLabel as splitGroupLabelCore,
  getSplitFileBaseName as getSplitFileBaseNameCore,
  allocSplitFileName as allocSplitFileNameCore,
  type SplitGroup,
  type SplitNamingOptions,
} from '../../core/export/split-core';
import { workbookToArray, createZipBlob, type ZipEntry } from '../../core/export/zip';
import { dedupeBatchNo, buildBatchNoFromShangShe, kbComputeBatchShangShe } from '../../core/kb/batch';
import { kbLookupShangShe, kbDetectBestShangSheMatch } from '../../core/kb/shangshe';
import { kbGetTasksForShangShe } from '../../core/kb/task';
import { kbTaxSourceForPlatform, uniqueTaxSources } from '../../core/kb/tax-source';
import { kbFillShangSheInfoForRow, kbGetRemarkPresetValue } from '../../core/kb/shangshe-fill';
import { getConfigLists } from '../../core/kb/model';
import { loadKB } from '../../io/kb-storage';
import { saveWorkbook, saveCSV, saveBlobAsFile } from '../../io/save-file';
import { renderPreviewTable } from '../export/preview-table';
import { renderRemarkPanel } from '../export/remark-panel';
import { renderExportControls } from '../export/controls';
import { applyColumnFilters, updateFilterSummary, normalizeSearchText } from '../column-filter';
import { getSelectedTemplates, goBack } from './template';

function updateOutputRow(rowIdx: number, colIdx: number, value: string): void {
  if (state.outputRows && state.outputRows[rowIdx]) {
    state.outputRows[rowIdx][colIdx] = value;
  }
}
export { updateOutputRow };

// ==================== 知识库/商社/批次包装（原 ui/legacy-bridge.ts，渲染器经此调用） ====================

export function lookupShangShe(shangSheId: string) {
  return kbLookupShangShe(loadKB(), shangSheId);
}

export function getTasksForShangShe(shangSheId: string) {
  return kbGetTasksForShangShe(loadKB(), shangSheId);
}

export function taxSourceForPlatform(platform: string, kb?: import('../../core/kb/model').KB): string {
  return kbTaxSourceForPlatform(kb || loadKB(), platform);
}

export function applyBatchShangShe(lookup: Parameters<typeof kbComputeBatchShangShe>[1], id: string): void {
  const r = kbComputeBatchShangShe(loadKB(), lookup, id);
  state.batchShangSheId = r.batchShangSheId;
  state.batchShangSheName = r.batchShangSheName;
  state.batchNo = r.batchNo;
}

export function fillShangSheInfoForRow(out: unknown, lookup: Parameters<typeof kbFillShangSheInfoForRow>[2], colIndex: Parameters<typeof kbFillShangSheInfoForRow>[3], setter: Parameters<typeof kbFillShangSheInfoForRow>[4], rowContext: Parameters<typeof kbFillShangSheInfoForRow>[5]): void {
  return kbFillShangSheInfoForRow(loadKB(), out as never, lookup, colIndex, setter, rowContext);
}

export function getRemarkPresetValue(rowIdx: number, preset: string): string {
  return kbGetRemarkPresetValue(loadKB(), preset, {
    row: state.outputRows?.[rowIdx] || [],
    metaFileName: (state.outputRowMeta?.[rowIdx] || {}).fileName,
    metaSheetName: (state.outputRowMeta?.[rowIdx] || {}).sheetName,
    selectedFileNames: state.sources.filter(s => s.selected).map(s => s.fileName),
    outputHeaders: state.outputHeaders || [],
    customText: (document.getElementById('note-custom-text') as HTMLInputElement | null)?.value.trim() || '',
  });
}

// ---- 拆分/构建器包装（读 state） ----
function splitTplName(templateKey: string): string {
  return templateKey === 'custom' ? '自定义' : (TEMPLATES[templateKey]?.name || '转换结果');
}
export function splitGroupLabelBridge(g: Parameters<typeof splitGroupLabelCore>[0]): string {
  return splitGroupLabelCore(g, state.exportMode);
}
function allocSplitFileName(g: SplitGroup, templateKey: string, ext: string, usedNames: Set<string>, naming?: SplitNamingOptions): string {
  return allocSplitFileNameCore(g, ext, usedNames, splitTplName(templateKey), state.exportMode, {
    ...naming,
    batchNo: state.splitBatches?.[g.key]?.batchNo || '',
  });
}
// 命名规则上下文从 state 组装（compact/batchno 的段取舍逻辑在 core）
function splitNamingOptions(groups: SplitGroup[], multiTemplate: boolean): SplitNamingOptions {
  return { rule: state.splitNamingRule || 'compact', multiTemplate, allGroups: groups };
}
/** 拆分文件名预览（批次面板行与命名规则提示共用）；batchNoOverride 供提示用占位组固定显示「批次号」段 */
export function splitPreviewName(
  g: SplitGroup, templateKey: string, groups: SplitGroup[], multiTemplate: boolean, batchNoOverride?: string
): string {
  return getSplitFileBaseNameCore(g, splitTplName(templateKey), state.exportMode, {
    ...splitNamingOptions(groups, multiTemplate),
    batchNo: batchNoOverride != null ? batchNoOverride : (state.splitBatches?.[g.key]?.batchNo || ''),
  }) + '.xlsx';
}

// ==================== 模版输出缓存 ====================

/** cloneTemplateOutputState 的完整缓存形状（state.ts 的 TemplateOutputCache 为其窄声明，运行时同对象） */
type TemplateOutputCacheFull = ReturnType<typeof cloneTemplateOutputState>;

function cloneTemplateOutputState() {
  return {
    outputHeaders: state.outputHeaders ? [...state.outputHeaders] : null,
    outputRows: state.outputRows ? state.outputRows.map(r => [...r]) : null,
    outputRowMeta: state.outputRowMeta ? state.outputRowMeta.map(m => ({ ...m })) : [],
    cleanCount: state.cleanCount,
    unmatchedRows: [...(state.unmatchedRows || [])],
    shangSheCandidates: [...(state.shangSheCandidates || [])],
    selectedNoteRows: [...(state.selectedNoteRows || [])],
    previewRowLimit: state.previewRowLimit,
    batchNo: state.batchNo || '',
    batchShangSheId: state.batchShangSheId || '',
    batchShangSheName: state.batchShangSheName || '',
    sbyShowBatchInfo: state.sbyShowBatchInfo,
    sbyPlainAmount: state.sbyPlainAmount
  };
}

export function cacheCurrentTemplateOutput() {
  if (!state.targetTemplate || !state.outputHeaders || !state.outputRows) return;
  if (!state.templateOutputs) state.templateOutputs = {};
  state.templateOutputs[state.targetTemplate] = cloneTemplateOutputState();
}

function restoreTemplateOutput(templateKey: string) {
  const cached = state.templateOutputs?.[templateKey] as TemplateOutputCacheFull | undefined;
  if (!cached) return false;
  state.outputHeaders = cached.outputHeaders ? [...cached.outputHeaders] : null;
  state.outputRows = cached.outputRows ? cached.outputRows.map(r => [...r]) : null;
  state.outputRowMeta = cached.outputRowMeta ? cached.outputRowMeta.map(m => ({ ...m })) : [];
  state.cleanCount = cached.cleanCount || 0;
  state.unmatchedRows = [...(cached.unmatchedRows || [])];
  state.shangSheCandidates = [...(cached.shangSheCandidates || [])];
  state.selectedNoteRows = [...(cached.selectedNoteRows || [])];
  state.previewRowLimit = cached.previewRowLimit || DEFAULT_PREVIEW_ROW_LIMIT;
  state.batchNo = cached.batchNo || '';
  state.batchShangSheId = cached.batchShangSheId || '';
  state.batchShangSheName = cached.batchShangSheName || '';
  // satisfies 使布尔字段收窄为字面量类型，改经 Object.assign 写入（语义不变）
  Object.assign(state, {
    sbyShowBatchInfo: cached.sbyShowBatchInfo ?? false,
    sbyPlainAmount: cached.sbyPlainAmount ?? true,
  });
  return true;
}

function switchPreviewTemplate(templateKey: string) {
  if (!templateKey || templateKey === state.targetTemplate) return;
  state.columnFilters = {};
  cacheCurrentTemplateOutput();
  state.targetTemplate = templateKey;
  if (restoreTemplateOutput(templateKey)) {
    showExportStep();
  } else {
    generateOutput();
  }
}

// ==================== Generate Output ====================
export function generateOutput() {
  state.columnFilters = {};
  const sourcesData = state.mappingState!.sourcesData!;

  if (state.targetTemplate === 'custom') {
    // For custom template, use the preview source's mapping
    const previewData = sourcesData[0] || { typeToCol: {} as Record<string, number | null> };
    showCustomMappingUI(previewData.typeToCol, sourcesData.flatMap(s => s.dataRows));
    return;
  }

  // 纯转换部分在 core（custom early-return 与 state 写入留在 ui）
  const result = generateOutputData({
    targetTemplate: state.targetTemplate as string,
    sourcesData,
    sources: state.sources.filter(s => s.selected),
    kb: loadKB(),
    sbyOptions: { showBatchInfo: state.sbyShowBatchInfo, plainAmount: state.sbyPlainAmount },
  });

  // 原 batchMatch 分支的 state 写入（applyBatchShangShe 语义 / 未匹配时三字段清空）
  if (result.batchMatch) {
    if (result.batchMatch.lookup) {
      applyBatchShangShe(result.batchMatch.lookup, result.batchMatch.id);
    } else {
      state.batchShangSheId = '';
      state.batchShangSheName = '';
      state.batchNo = '';
    }
  }

  state.outputRows = result.rows;
  state.outputRowMeta = result.meta;
  state.outputHeaders = result.headers;
  state.cleanCount = result.cleanCount;
  state.unmatchedRows = result.unmatchedRows;
  state.shangSheCandidates = result.shangSheCandidates;
  state.selectedNoteRows = [];
  state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
  cacheCurrentTemplateOutput();
  showExportStep();
}

function showCustomMappingUI(typeToCol: Record<string, number | null>, allDataRows: Rows) {
  const container = byId('export-content');
  byId('step-export').classList.remove('hidden');

  let html = `<div style="font-size:14px;font-weight:600;margin-bottom:12px;">${icon('edit', 14)} 自定义列映射</div>`;
  state.customFields.forEach((field, fi) => {
    const opts = ['<option value="">— 不映射 —</option>'];
    Object.keys(typeToCol).forEach(type => {
      opts.push(`<option value="${type}">${COL_TYPE_LABELS[type]||type}</option>`);
    });
    html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <div style="width:120px;font-size:13px;font-weight:600;">${escapeHTML(field)}</div>
      <select data-field="${fi}" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px;">${opts.join('')}</select>
    </div>`;
  });
  // 原内联 onclick="genCustom()" → data-action（经 initExportStepDelegates 分发）
  html += `<div class="btn-row"><button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" data-action="genCustom">${icon('check', 15)} 生成</button></div>`;
  container.innerHTML = html;
}

function genCustom() {
  const sourcesData = state.mappingState!.sourcesData!;

  const fmap: Record<string, string> = {};
  document.querySelectorAll('#export-content select[data-field]').forEach(sel => {
    const el = sel as HTMLSelectElement;
    if (el.value) fmap[el.dataset.field as string] = el.value;
  });

  state.outputHeaders = state.customFields;
  state.outputRows = [];
  state.outputRowMeta = [];
  let cleanCount = 0;
  sourcesData.forEach(({ dataRows, typeToCol, source }) => {
    dataRows.forEach(row => {
      const out = new Array(state.customFields.length).fill('');
      for (const [fi, type] of Object.entries(fmap)) {
        let val = row[typeToCol[type] as number];
        const raw = val != null ? String(val) : '';
        if (type === 'amount') val = sanitizeAmount(val);
        else val = cleanValue(val, type);
        if (val !== raw.trim() && val.length < raw.trim().length) cleanCount++;
        out[Number(fi)] = val != null ? String(val).trim() : '';
      }
      if (!out.some(v => v)) return;
      state.outputRows!.push(out);
      // 原 push 对象不含 rawRow/typeToCol 两键（custom 行元数据不参与 KB 填充），仅类型面断言
      state.outputRowMeta.push({ fileName: source?.fileName || '', sheetName: source?.sheetName || '' } as unknown as OutputRowMeta);
    });
  });
  state.cleanCount = cleanCount;
  state.selectedNoteRows = [];
  state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
  showExportStep();
}


// ==================== Export Step ====================
// 模版切换按钮图标（SVG，替代原 emoji）
const SWITCH_ICONS: Record<string, string> = {
  yidao: 'rocket', shenbianyun: 'cloud', youyi: 'users', custom: 'edit',
};

export function showExportStep() {
  // 保存当前滚动位置和焦点信息
  const container = byId('export-content');
  const stepEl = byId('step-export');
  const savedScrollTop = stepEl ? stepEl.scrollTop : 0;
  const activeEl = document.activeElement as HTMLElement | null;
  let focusInfo: {
    rowIdx?: string;
    colIdx?: string;
    tagName: string;
    type?: string;
    selectionStart: number | null;
  } | null = null;
  if (activeEl && stepEl && stepEl.contains(activeEl)) {
    focusInfo = {
      rowIdx: activeEl.dataset.rowIdx || (activeEl.closest('[data-row-idx]') as HTMLElement | null)?.dataset.rowIdx,
      colIdx: activeEl.dataset.colIdx || (activeEl.closest('[data-col-idx]') as HTMLElement | null)?.dataset.colIdx,
      tagName: activeEl.tagName,
      type: (activeEl as HTMLInputElement).type,
      selectionStart: (activeEl as HTMLInputElement).selectionStart,
    };
  }

  stepEl.classList.remove('hidden');

  const headers = state.outputHeaders as string[];
  const rows = state.outputRows as Rows;

  // 动态计算列索引，消除魔数硬编码
  state.colIndex = {
    platform: headers.indexOf('平台'),
    shangSheId: headers.indexOf('商社编号'),
    name: headers.indexOf('姓名'),
    idCard: headers.indexOf('身份证号码'),
    taskList: headers.indexOf('任务清单'),
    taxSource: headers.indexOf('税源地'),
    workType: headers.indexOf('工种'),
    phone: headers.indexOf('手机号码'),
    account: headers.indexOf('账号'),
    bankName: headers.indexOf('银行名称'),
    bankLocation: headers.indexOf('银行所属地'),
    preTaxAmount: headers.indexOf('税前金额'),
    taxAmount: headers.indexOf('个税金额'),
    insurance: headers.indexOf('商业保险'),
    remark: headers.indexOf('备注'),
    error: headers.indexOf('出错信息'),
  };
  cacheCurrentTemplateOutput();
  const tplName = state.targetTemplate === 'custom' ? '自定义' : TEMPLATES[state.targetTemplate as string].name;

  // 云杉模版：获取平台和任务清单数据用于下拉框
  const isYouyi = state.targetTemplate === 'youyi';
  const supportsBatchNo = TEMPLATES[state.targetTemplate as string]?.supportsBatchNo ?? false;
  let allPlatforms: string[] = [];
  let allTaxSources: string[] = [];
  let shangSheFullList: AppState['shangSheFullList'] = [];
  let shangSheCandidates: AppState['shangSheCandidates'] = [];
  if (isYouyi || supportsBatchNo || getSelectedTemplates().includes('shenbianyun')) {
    const kb = loadKB();
    const config = getConfigLists(kb);
    if (isYouyi) {
      allPlatforms = config.platforms;
      allTaxSources = uniqueTaxSources(config.taxSources);
    }
    shangSheCandidates = (state.shangSheCandidates || []).filter(Boolean);
    shangSheFullList = Object.entries(kb.shangSheMap || {}).map(([id, entry]) => {
      const shortName = entry.shortName || '';
      const fullName = entry.fullName || '';
      const taxId = entry.taxId || '';
      const label = `${id} - ${shortName || fullName}`;
      return {
        id,
        label,
        taxId,
        fullName,
        shortName,
        searchText: normalizeSearchText([id, shortName, fullName, taxId, label].join(' '))
      };
    });
  }


  const splitActive = isSplitExportActive();

  const selectedExportTemplates = getSelectedTemplates().filter(k => k !== 'custom');
  // 原内联 onclick="switchPreviewTemplate('${k}')" → data-action + data-key（事件委托）
  const previewSwitchHTML = selectedExportTemplates.length > 1
    ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <span style="font-size:13px;font-weight:600;color:var(--text2);">切换预览:</span>
        ${selectedExportTemplates.map(k => `<button class="btn ${k === state.targetTemplate ? 'btn-primary' : 'btn-secondary'} btn-sm" data-action="switchPreviewTemplate" data-key="${k}">${icon(SWITCH_ICONS[k] || 'table', 13)} ${TEMPLATES[k].name}</button>`).join('')}
      </div>`
    : '';
  const splitGroupCount = splitActive ? getSplitGroups().length : 0;
  // 原内联 onclick="exportSelectedExcel()" → data-action（事件委托）
  const multiExportHTML = selectedExportTemplates.length > 1
    ? (splitActive
      ? `<button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" data-action="exportSelectedExcel">${icon('package', 15)} 拆分打包导出（${selectedExportTemplates.length} 模板 × ${splitGroupCount} 来源 = ${selectedExportTemplates.length * splitGroupCount} 个 Excel）</button>`
      : `<button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" data-action="exportSelectedExcel">${icon('package', 15)} 打包导出 ZIP（${selectedExportTemplates.length} 个 Excel）</button>`)
    : '';

  container.innerHTML = `
    <div class="status-msg success">${icon('check', 15)} 转换完成 — ${tplName}（${rows.length} 行）</div>
    ${selectedExportTemplates.length > 1 ? `<div class="status-msg info">本次已选择：${selectedExportTemplates.map(k => TEMPLATES[k].name).join('、')}。当前表格预览为 ${tplName}。</div>` : ''}
    ${previewSwitchHTML}
    ${renderExportControls()}
    ${renderRemarkPanel()}
    <div id="filter-summary" class="filter-summary"></div>
    ${renderPreviewTable()}
    <div class="btn-row">
      ${multiExportHTML}
      ${splitActive
        ? `<button class="btn btn-green" style="flex:1;padding:12px;font-size:15px;" data-action="exportExcel">${icon('package', 15)} 拆分导出 ZIP（${splitGroupCount} 份 Excel）</button>
           <button class="btn btn-secondary" data-action="exportCSV">${icon('package', 15)} 拆分导出 CSV（${splitGroupCount} 份）</button>`
        : `<button class="btn btn-green" style="flex:1;padding:12px;font-size:15px;" data-action="exportExcel">${icon('download', 15)} 导出 Excel（可选保存位置）</button>
           <button class="btn btn-secondary" data-action="exportCSV">${icon('download', 15)} 导出 CSV</button>`}
      <button class="btn btn-secondary" data-action="goBack" data-target="step-export">${icon('arrowLeft', 14)} 返回</button>
    </div>`;

  // 设置搜索下拉框所需的数据（存入 state 对象）
  // （showSplitBatchPanel 原声明于拆分批次面板段；该段已拆至 renderExportControls，
  //   此处按原表达式就地声明——阶段 3 搬移时误置于下方 if 块内，会在 custom 流程抛
  //   ReferenceError，本阶段恢复原版语义）
  const showSplitBatchPanel = splitActive && getSelectedTemplates().includes('shenbianyun');
  if (isYouyi || supportsBatchNo || showSplitBatchPanel) {
    // 设置商社列表数据
    state.shangSheFullList = shangSheFullList;
    state.shangSheCandidates = shangSheCandidates;
  }
  if (isYouyi) {
    // 设置平台列表数据
    state.platformFullList = allPlatforms.map(p => ({ value: p, label: p, searchText: normalizeSearchText(p) }));
  }

  // 恢复滚动位置
  if (savedScrollTop > 0 && stepEl) {
    stepEl.scrollTop = savedScrollTop;
  }
  // 恢复焦点
  if (focusInfo && focusInfo.rowIdx != null) {
    const selector = `[data-row-idx="${focusInfo.rowIdx}"][data-col-idx="${focusInfo.colIdx}"]`;
    const targetEl = container ? container.querySelector(selector) : null;
    if (targetEl) {
      (targetEl as HTMLElement).focus();
      if (focusInfo.selectionStart != null && (targetEl as HTMLInputElement).setSelectionRange) {
        try { (targetEl as HTMLInputElement).setSelectionRange(focusInfo.selectionStart, focusInfo.selectionStart); } catch(e) {}
      }
    }
  }
  // 应用列筛选
  applyColumnFilters();
  updateFilterSummary();
}

// 导出步骤容器事件委托：showExportStep/showCustomMappingUI 动态 HTML 中残留的内联
// onclick（导出按钮/模版切换/自定义映射生成/返回）→ data-action 分发，
// 原 legacy.js 的 window 桥（switchPreviewTemplate/exportSelectedExcel/exportExcel/
// exportCSV/goBack/genCustom）随之退役。
export function initExportStepDelegates(): void {
  const container = byId('export-content');
  delegateAction(container, 'click', {
    switchPreviewTemplate: el => switchPreviewTemplate(el.dataset.key || ''),
    exportSelectedExcel: () => exportSelectedExcel(),
    exportExcel: () => exportExcel(),
    exportCSV: () => exportCSV(),
    goBack: el => goBack(el.dataset.target || ''),
    genCustom: () => genCustom(),
  });
}


// ==================== Export Helpers ====================

function getExportFileName(ext: string) {
  return getExportFileNameForTemplate(state.targetTemplate as string, ext);
}

export function getExportFileNameForTemplate(templateKey: string, ext: string) {
  // 文件命名规则收敛进注册表（core/templates/*）；批次号读 state 的部分留在调用方
  const ctx: TemplateContext = {
    headers: [],
    rows: [],
    meta: [],
    batchNo: getBatchNoForTemplate(templateKey),
    kb: loadKB(),
    options: { showBatchInfo: state.sbyShowBatchInfo, plainAmount: state.sbyPlainAmount },
  };
  return buildFileNameForTemplate(templateKey, ext, ctx);
}

function getBatchNoForTemplate(templateKey: string) {
  if (templateKey === state.targetTemplate) return state.batchNo || '';
  return state.templateOutputs?.[templateKey]?.batchNo || '';
}


// ==================== Split Export (一源一单) ====================

// split-core 的 OutputRowMeta 为宽松形状（fileName/sheetName 可选 + index signature），
// state.outputRowMeta 为精确形状（运行时同源），此处仅类型面对齐
type SplitRowMeta = Parameters<typeof getSplitGroupsFromMetaCore>[0];
function asSplitMeta(meta: OutputRowMeta[] | null | undefined): SplitRowMeta {
  return meta as unknown as SplitRowMeta;
}

export function getSplitGroups(): SplitGroup[] { return getSplitGroupsFromMetaCore(asSplitMeta(state.outputRowMeta), state.exportMode); }

export function getSplitGroupCounts() {
  const files = new Set<string>(), sheets = new Set<string>();
  (state.outputRowMeta || []).forEach(m => {
    const fn = m.fileName || '未命名文件';
    files.add(fn);
    sheets.add(`${fn}||${m.sheetName || ''}`);
  });
  return { byFile: files.size, bySheet: sheets.size };
}


// 当前是否处于有效的拆分导出模式（分组数 > 1 才有拆分意义）
export function isSplitExportActive() {
  if ((state.exportMode || 'merge') === 'merge') return false;
  const counts = getSplitGroupCounts();
  return (state.exportMode === 'byFile' ? counts.byFile : counts.bySheet) > 1;
}

// 每份单独跑商社检测（按分组过滤数据源），生成各自批次号
export function ensureSplitBatches(groups: SplitGroup[], force = false) {
  if (!state.splitBatches) state.splitBatches = {};
  const sourcesData = state.mappingState?.sourcesData || [];
  // 去重范围仅限当前这批分组的批次号
  const existing = new Set(groups.map(g => state.splitBatches[g.key]?.batchNo).filter(Boolean));
  groups.forEach(g => {
    if (!force && state.splitBatches[g.key]) return;
    const groupData = sourcesData.filter(sd => {
      if ((sd.source?.fileName || '') !== g.fileName) return false;
      if (state.exportMode === 'bySheet') return (sd.source?.sheetName || '') === (g.sheetName || '');
      return true;
    });
    const groupSources = groupData.map(sd => sd.source).filter(Boolean);
    const match = kbDetectBestShangSheMatch(loadKB(), groupData, groupSources);
    const lookup = match?.lookup || null;
    const batchNo = lookup ? dedupeBatchNo(buildBatchNoFromShangShe(lookup), existing) : '';
    if (batchNo) existing.add(batchNo);
    state.splitBatches[g.key] = {
      batchNo,
      shangSheId: lookup ? (match.id || '') : '',
      shangSheName: lookup ? (lookup.shortName || lookup.fullName || '') : ''
    };
  });
}


/**
 * 拆分导出核心：每个模板 × 每个来源分组 → 一个文件（xlsx/csv），返回文件列表。
 * templateKeys 为空时返回空数组；调用方负责打 ZIP。
 */
export async function buildSplitFilesForTemplates(templateKeys: string[], ext: string): Promise<ZipEntry[]> {
  const files: ZipEntry[] = [];
  if (!templateKeys.length) return files;
  cacheCurrentTemplateOutput();
  const currentTemplate = state.targetTemplate;
  // 批次号对全部模板生成（batchno 命名规则通用）；写入表内容的批次号仍仅身边云使用
  ensureSplitBatches(getSplitGroups());
  const usedNames = new Set<string>();

  for (const templateKey of templateKeys) {
    let out: {
      outputHeaders: string[] | null;
      outputRows: Rows | null;
      outputRowMeta: OutputRowMeta[];
      sbyShowBatchInfo?: boolean;
      sbyPlainAmount?: boolean;
    };
    if (templateKey === currentTemplate) {
      out = {
        outputHeaders: state.outputHeaders,
        outputRows: state.outputRows,
        outputRowMeta: state.outputRowMeta,
        sbyShowBatchInfo: state.sbyShowBatchInfo,
        sbyPlainAmount: state.sbyPlainAmount,
      };
    } else {
      if (!state.templateOutputs?.[templateKey]) {
        state.targetTemplate = templateKey;
        generateOutput();
      }
      out = state.templateOutputs?.[templateKey];
    }
    if (!out?.outputHeaders || !out?.outputRows) continue;
    // 闭包内引用需稳定别名（原表达式逐字等价）
    const outHeaders = out.outputHeaders;
    const outRows = out.outputRows;

    const groups = getSplitGroupsFromMetaCore(asSplitMeta(out.outputRowMeta), state.exportMode);
    const naming = splitNamingOptions(groups, templateKeys.length > 1);
    for (const g of groups) {
      const rows = g.rowIdxs.map(i => outRows[i]).filter(Boolean);
      if (!rows.length) continue;
      let data: ArrayBuffer | Uint8Array;
      if (ext === 'csv') {
        data = new TextEncoder().encode('\uFEFF' + rowsToCSV(outHeaders, rows));
      } else {
        // satisfies 使布尔字段收窄为字面量类型，改经 Object.assign 写入（语义不变）
        Object.assign(state, {
          sbyShowBatchInfo: out.sbyShowBatchInfo ?? false,
          sbyPlainAmount: out.sbyPlainAmount ?? true,
        });
        const batchNo = templateKey === 'shenbianyun' ? (state.splitBatches?.[g.key]?.batchNo || '') : '';
        const wb = await buildWorkbookForTemplate(templateKey, outHeaders, rows, batchNo);
        data = workbookToArray(wb);
      }
      files.push({ name: allocSplitFileName(g, templateKey, ext, usedNames, naming), data });
    }
  }

  state.targetTemplate = currentTemplate;
  restoreTemplateOutput(currentTemplate as string);
  showExportStep();
  return files;
}

async function downloadSplitZip(files: ZipEntry[], kind: string) {
  if (!files.length) { alert('没有可导出的数据'); return; }
  const zipBlob = createZipBlob(files);
  const saved = await saveBlobAsFile(
    zipBlob,
    `拆分转换结果_${getTodayStr()}.zip`,
    'ZIP 压缩包',
    { 'application/zip': ['.zip'] }
  );
  if (saved) alert(`已拆分导出 ${files.length} 个${kind === 'csv' ? ' CSV' : ' Excel'}文件（ZIP 打包，与来源一一对应）`);
}

async function exportSplitExcel() {
  const files = await buildSplitFilesForTemplates([state.targetTemplate as string].filter(Boolean), 'xlsx');
  await downloadSplitZip(files, 'xlsx');
}

async function exportSplitCSV() {
  const files = await buildSplitFilesForTemplates([state.targetTemplate as string].filter(Boolean), 'csv');
  await downloadSplitZip(files, 'csv');
}

// ==================== Excel Export (Template-Preserving) ====================
async function exportExcel() {
  if (isSplitExportActive()) { await exportSplitExcel(); return; }
  const headers = state.outputHeaders;
  const rows = state.outputRows;
  const fileName = getExportFileName('xlsx');
  const wb = await buildWorkbookForTemplate(state.targetTemplate as string, headers as string[], rows as Rows);
  return await saveWorkbook(wb, fileName);
}

/** 工作簿构建（查模版注册表分发；ctx 从 state 构造，原 buildYidaoWorkbook/buildShenbianyunWorkbook/
 *  buildYouyiWorkbook/buildGenericWorkbook 分支由各模版定义承载）。 */
export async function buildWorkbookForTemplate(templateKey: string, headers: string[], rows: Rows, batchNoOverride?: string): Promise<ReturnType<typeof buildWorkbookFromRegistry>> {
  const ctx: TemplateContext = {
    headers,
    rows,
    meta: state.outputRowMeta,
    batchNo: batchNoOverride != null ? batchNoOverride : getBatchNoForTemplate(templateKey),
    kb: loadKB(),
    options: { showBatchInfo: state.sbyShowBatchInfo, plainAmount: state.sbyPlainAmount },
  };
  return buildWorkbookFromRegistry(templateKey, ctx);
}

async function exportSelectedExcel() {
  const selectedTemplates = getSelectedTemplates().filter(k => k !== 'custom');
  if (selectedTemplates.length <= 1) {
    await exportExcel();
    return;
  }
  if (isSplitExportActive()) {
    const files = await buildSplitFilesForTemplates(selectedTemplates, 'xlsx');
    await downloadSplitZip(files, 'xlsx');
    return;
  }

  cacheCurrentTemplateOutput();
  const currentTemplate = state.targetTemplate;
  const files: ZipEntry[] = [];
  for (const templateKey of selectedTemplates) {
    if (!state.templateOutputs?.[templateKey]) {
      state.targetTemplate = templateKey;
      generateOutput();
    }
    const cached = state.templateOutputs?.[templateKey];
    if (!cached?.outputHeaders || !cached?.outputRows) continue;
    // 恢复该模版缓存的身边云导出选项
    Object.assign(state, {
      sbyShowBatchInfo: cached.sbyShowBatchInfo ?? false,
      sbyPlainAmount: cached.sbyPlainAmount ?? true,
    });
    const wb = await buildWorkbookForTemplate(templateKey, cached.outputHeaders, cached.outputRows);
    files.push({
      name: getExportFileNameForTemplate(templateKey, 'xlsx'),
      data: workbookToArray(wb)
    });
  }

  state.targetTemplate = currentTemplate;
  restoreTemplateOutput(currentTemplate as string);
  showExportStep();
  if (!files.length) {
    alert('没有可导出的模版数据');
    return;
  }

  const zipBlob = createZipBlob(files);
  const saved = await saveBlobAsFile(
    zipBlob,
    `批量模版转换结果_${getTodayStr()}.zip`,
    'ZIP 压缩包',
    { 'application/zip': ['.zip'] }
  );
  if (saved) alert(`已打包导出 ${files.length} 个 Excel 文件`);
}




async function exportCSV() {
  if (isSplitExportActive()) { await exportSplitCSV(); return; }
  const csv = rowsToCSV(state.outputHeaders as Row, state.outputRows as Rows);
  await saveCSV('\uFEFF' + csv, getExportFileName('csv'));
}

// ==================== Reset ====================
export function resetAll() {
  Object.assign(state, {
    sources: [], previewSourceId: '', pendingFiles: 0, accumFileCount: 0,
    mappingState: null, targetTemplate: null, selectedTemplates: [], templateOutputs: {}, customFields: [],
    outputRows: null, outputHeaders: null, outputRowMeta: [], selectedNoteRows: [], previewRowLimit: DEFAULT_PREVIEW_ROW_LIMIT, templateFiles: {}, cleanCount: 0,
    unmatchedRows: [], shangSheCandidates: [],
    exportMode: 'merge', splitBatches: {}, splitGroupList: [],
    splitNamingRule: 'compact',
  });
  ['accum-indicator','step-mapping','step-template','step-export'].forEach(id =>
    byId(id).classList.add('hidden'));
  (byId('file-input') as HTMLInputElement).value = '';
}
