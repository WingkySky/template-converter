// @ts-nocheck
// 过渡文件：template-converter.html <script> 段的逐字拷贝（阶段 1-3 逐步抽空，阶段 5 删除）

// ==================== 阶段 1A：core/parser / mapping / clean 已抽取 ====================
// 函数实现移至 src/core/*，此处仅 import 以保持 legacy 内部调用与 window 测试面不变。
import { parseCSV, isGarbled } from './core/parser/parse-csv';
import { buildSourceItem } from './core/parser/source-item';
import { analyzeWorkbookSheets, analyzeSheet } from './core/parser/excel';
import {
  SUMMARY_RE, SUMMARY_TERMS_EXACT, FEE_LABEL_RE, isHeaderContinuation,
  mergeHeaderRows, smartDetectTable, isSummaryLikeRow, hasIdentityField,
  inferGenderFromIdCard,
} from './core/parser/table-detect';
import { isAmountLikeNumber, getAmountColumnScore } from './core/mapping/amount-score';
import { COL_KEYWORDS, COL_TYPE_LABELS, detectColumnMapping } from './core/mapping/column-detect';
import { sanitizeAmount, cleanValue } from './core/clean/values';

// ==================== 阶段 1B：core/kb 已抽取 ====================
import {
  KB_STORAGE_KEY, KB_SCHEMA_VERSION, KB_MAIN_HEADERS, DEFAULT_CONFIG,
  getConfigLists, migrateKB, mergeKnowledgeRows, knowledgeRowsFromKB,
  applyConfigSheetRows, applyTaskListSheetRows,
} from './core/kb/model';
import {
  uniqueTaxSources, kbInferTaxSourceByPlatformName, kbTaxSourceForPlatform, kbSignEntityToPlatform,
} from './core/kb/tax-source';
import {
  parseTaskListEntries, generateGlobalTaskList, findTaskContent, normalizeTaskNameToWorkType,
  inferWorkType, parseTaskString, kbGetTasksForShangShe, generateConfigSheet, generateTaskListSheet,
} from './core/kb/task';
import {
  chineseInitial, shortNameForBatch, initialsForBatchName, buildBatchNoFromShangShe,
  dedupeBatchNo, kbComputeBatchShangShe,
} from './core/kb/batch';
import {
  kbLookupShangShe, kbLookupShangSheByTaxId, kbLookupShangSheByNameAll, kbLookupShangSheByName,
  kbGetShangSheIdFromLookup, kbDetectSourceClientInfo, kbDetectBestShangSheMatch,
} from './core/kb/shangshe';
import {
  inferBankLocationFromBranch, kbFillShangSheInfoForRow, kbGetRemarkPresetValue,
} from './core/kb/shangshe-fill';


// ==================== 阶段 1C：core/export 已抽取 ====================
import { workbookToArray, crc32, dosDateTime, u16, u32, concatBytes, createZipBlob } from './core/export/zip';
import { rowsToCSV } from './core/export/csv';
import { getTodayStr } from './core/export/naming';
import {
  getSplitGroupsFromMeta as getSplitGroupsFromMetaCore,
  splitGroupLabel as splitGroupLabelCore,
  sanitizeFileNamePart,
  getSplitFileBaseName as getSplitFileBaseNameCore,
  allocSplitFileName as allocSplitFileNameCore,
} from './core/export/split-core';
import {
  buildYidaoWorkbook, buildGenericWorkbook,
  buildShenbianyunWorkbookCore, buildYouyiWorkbook as buildYouyiWorkbookCore,
} from './core/export/builders';

// ==================== 阶段 2：state 与 io 层已抽取 ====================
import { state, DEFAULT_PREVIEW_ROW_LIMIT, PREVIEW_ROW_INCREMENT } from './state';
import { loadKB, saveKB, invalidateKBCache, clearKBStorage, onKBChanged } from './io/kb-storage';
import {
  exportKBToExcel, importKBFromJSON, importKBFromWorkbook, downloadKBSample,
  handleKBUpload, handleKBImport, handleKBConfigUpload,
} from './io/kb-transfer';
import { saveWorkbook, saveCSV, saveBlobAsFile } from './io/save-file';

// ==================== 阶段 3：UI 已抽取（渲染器 + 步骤模块） ====================
import { renderPreviewTable } from './ui/export/preview-table';
import { renderRemarkPanel } from './ui/export/remark-panel';
import { renderExportControls } from './ui/export/controls';
import { applyColumnFilters, updateFilterSummary, normalizeSearchText } from './ui/column-filter';
import { getSelectedTemplates, goBack, selectTemplate, confirmTemplate } from './ui/steps/template';
import { handleFiles } from './ui/steps/upload';
import { confirmMapping } from './ui/steps/mapping';




// ---- 阶段 1C 桥接包装：core 版为纯函数，导出模式/模版名/选项经参数传入 ----
function getSplitGroupsFromMeta(meta) {
  return getSplitGroupsFromMetaCore(meta, state.exportMode);
}
function splitGroupLabel(g) {
  return splitGroupLabelCore(g, state.exportMode);
}
function splitTplName(templateKey) {
  return templateKey === 'custom' ? '自定义' : (TEMPLATES[templateKey]?.name || '转换结果');
}
function getSplitFileBaseName(g, templateKey) {
  return getSplitFileBaseNameCore(g, splitTplName(templateKey), state.exportMode);
}
function allocSplitFileName(g, templateKey, ext, usedNames) {
  return allocSplitFileNameCore(g, ext, usedNames, splitTplName(templateKey), state.exportMode);
}
function buildShenbianyunWorkbook(headers, rows, batchNo = '') {
  return buildShenbianyunWorkbookCore(headers, rows, batchNo, { showBatchInfo: state.sbyShowBatchInfo, plainAmount: state.sbyPlainAmount });
}
function buildYouyiWorkbook(headers, rows) {
  return buildYouyiWorkbookCore(headers, rows, { kb: loadKB(), generateConfigSheet, generateTaskListSheet });
}



function updateOutputRow(rowIdx, colIdx, value) {
  if (state.outputRows && state.outputRows[rowIdx]) {
    state.outputRows[rowIdx][colIdx] = value;
  }
}

// ==================== 知识库 (Knowledge Base) ====================




function inferTaxSourceByPlatformName(platform) {
  return kbInferTaxSourceByPlatformName(loadKB(), platform);
}


function taxSourceForPlatform(platform, kb) {
  return kbTaxSourceForPlatform(kb || loadKB(), platform);
}


function signEntityToPlatform(signEntity, platforms) {
  return kbSignEntityToPlatform(loadKB(), signEntity, platforms);
}












function lookupShangShe(shangSheId) {
  return kbLookupShangShe(loadKB(), shangSheId);
}


function lookupShangSheByTaxId(taxId) {
  return kbLookupShangSheByTaxId(loadKB(), taxId);
}


function lookupShangSheByNameAll(name) {
  return kbLookupShangSheByNameAll(loadKB(), name);
}


function lookupShangSheByName(name) {
  return kbLookupShangSheByName(loadKB(), name);
}


function detectSourceClientInfo(sourcesData, sourcesOverride) {
  return kbDetectSourceClientInfo(sourcesData, sourcesOverride || state.sources.filter(s => s.selected));
}


function getShangSheIdFromLookup(lookup) {
  return kbGetShangSheIdFromLookup(loadKB(), lookup);
}


function detectBestShangSheMatch(sourcesData, sourcesOverride) {
  return kbDetectBestShangSheMatch(loadKB(), sourcesData, sourcesOverride || state.sources.filter(s => s.selected));
}








function applyBatchShangShe(lookup, id) {
  const r = kbComputeBatchShangShe(loadKB(), lookup, id);
  state.batchShangSheId = r.batchShangSheId;
  state.batchShangSheName = r.batchShangSheName;
  state.batchNo = r.batchNo;
}












// 页面加载时更新知识库状态

// ==================== Column Keywords ====================


// ==================== Target Templates ====================
const TEMPLATES = {
  yidao: {
    name: '移步到岗',
    icon: '🚀',
    desc: '简洁模版，6列核心信息（保留模版结构）',
    headers: ['姓名', '身份证', '手机号', '开户银行', '银行卡号', '税前金额'],
    fieldMap: { name: '姓名', idCard: '身份证', phone: '手机号', bankName: '开户银行', bankCard: '银行卡号', amount: '税前金额' },
  },
  shenbianyun: {
    name: '身边云',
    icon: '☁️',
    desc: '付款模版（保留说明行、批次信息行和表头）',
    headers: ['商户订单号（非必填）', '收款人姓名（必填）', '身份证号（必填）', '个人银行卡号（必填）', '付款金额（元，必填）', '手机号（必填）', '备注（非必填）', '自定义备注（非必填）'],
    fieldMap: { name: '收款人姓名（必填）', idCard: '身份证号（必填）', bankCard: '个人银行卡号（必填）', amount: '付款金额（元，必填）', phone: '手机号（必填）', note: '备注（非必填）' },
  },
  youyi: {
    name: '云杉公司',
    icon: '🤝',
    desc: '详细模版（保留配置表和任务清单）',
    headers: ['出错信息', '平台', '商社编号', '姓名', '身份证号码', '性别', '任务清单', '税源地', '工种', '手机号码', '账号', '银行名称', '银行所属地', '税前金额', '个税金额', '商业保险', '备注'],
    fieldMap: { name: '姓名', idCard: '身份证号码', gender: '性别', phone: '手机号码', bankCard: '账号', bankName: '银行名称', location: '银行所属地', amount: '税前金额', note: '备注', shangSheId: '商社编号' },
  },
  custom: {
    name: '自定义模版',
    icon: '✏️',
    desc: '自由定义列名和顺序',
    headers: [],
    fieldMap: {},
  },
};



// ==================== CSV ====================


// ==================== Excel Analysis ====================


// ==================== Smart Table Detection (IMPROVED) ====================

// 检测下一行是否是表头延续（双行表头的第二行）

// 合并双行表头：对于每一列，若两行都有值则拼接，否则取非空值



/**
 * Check if a row contains at least one identity field.
 * Supports: Chinese name (2-15 chars, with possible · separator), ID card (18 digits),
 * phone (11 digits starting with 1), bank card (16-19 digits), sequence number,
 * or valid amount (strong signal this is a data row).
 */

// 费用/汇总类标签：这些文本明显不是人员姓名，出现时应判定为非人员记录
// （例如"平台服务费""额外服务费""服务费""手续费""小计""合计"等）

/**
 * 判断一行是否为"真正的人员/单位发放记录"。
 * 多重校验，避免把"平台服务费""额外服务费""合计""小计"等费用/汇总行误当作人员导出。
 *
 * 强身份标识（满足任一即视为有效发放对象）：
 *   - 身份证号（18位，末位可为 X）
 *   - 统一社会信用代码（18位字母+数字，个体户/单位收款人）
 *   - 手机号（11位，1开头）
 *   - 银行卡号（16-19位数字）
 *
 * 兜底规则：同时含"拟似姓名"（2-15个中文字符且不是费用/汇总标签）+ 金额 + 足够数据列。
 *
 * 只要该行包含费用/汇总标签（如"平台服务费"），且没有任何强身份标识，则判定为非人员记录。
 */

/**
 * Infer gender from Chinese 18-digit ID card number.
 * The 17th digit: odd = male (男), even = female (女).
 * Returns '男' or '女' or '' if not applicable.
 */




// ==================== Mapping Step ====================

// ==================== Template Selection ====================

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

function restoreTemplateOutput(templateKey) {
  const cached = state.templateOutputs?.[templateKey];
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
  state.sbyShowBatchInfo = cached.sbyShowBatchInfo ?? false;
  state.sbyPlainAmount = cached.sbyPlainAmount ?? true;
  return true;
}

function switchPreviewTemplate(templateKey) {
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
  const { sourcesData } = state.mappingState;

  if (state.targetTemplate === 'custom') {
    // For custom template, use the preview source's mapping
    const previewData = sourcesData[0] || { typeToCol: {} };
    showCustomMappingUI(previewData.typeToCol, sourcesData.flatMap(s => s.dataRows));
    return;
  }

  const tpl = TEMPLATES[state.targetTemplate];

  // Generate output rows using per-source column mappings
  const outputRows = [];
  const outputRowMeta = [];
  let cleanCount = 0;
  sourcesData.forEach(({ dataRows, typeToCol, source }) => {
    // Build source-type → dest-column mapping for this source
    const srcToDest = {};
    for (const [type, destName] of Object.entries(tpl.fieldMap)) {
      const destIdx = tpl.headers.indexOf(destName);
      if (destIdx >= 0 && typeToCol[type] != null) srcToDest[type] = destIdx;
    }

    dataRows.forEach(row => {
      const out = new Array(tpl.headers.length).fill('');
      for (const [type, destIdx] of Object.entries(srcToDest)) {
        let val = row[typeToCol[type]];
        const raw = val != null ? String(val) : '';
        if (type === 'amount') val = sanitizeAmount(val);
        else val = cleanValue(val, type);
        // Count cleaned values (had spaces/whitespace removed)
        if (val !== raw.trim() && val.length < raw.trim().length) cleanCount++;
        out[destIdx] = val != null ? String(val).trim() : '';
      }
      if (!out.some(v => v)) return;
      const hasIdentity = (srcToDest.name != null && out[srcToDest.name]) ||
                          (srcToDest.idCard != null && out[srcToDest.idCard]) ||
                          (srcToDest.bankCard != null && out[srcToDest.bankCard]);
      if (!hasIdentity) return;
      // Auto-infer gender from ID card if gender column exists but is empty
      {
        const genderIdx = tpl.headers.indexOf(tpl.fieldMap.gender || '性别');
        if (genderIdx >= 0 && !out[genderIdx]) {
          const idCardIdx = tpl.headers.indexOf(tpl.fieldMap.idCard);
          if (idCardIdx >= 0 && out[idCardIdx]) {
            const inferred = inferGenderFromIdCard(out[idCardIdx]);
            if (inferred) out[genderIdx] = inferred;
          }
        }
        // 云杉模版: set 个税金额 and 商业保险 to 0 for rows with data
        if (state.targetTemplate === 'youyi') {
          const taxIdx = tpl.headers.indexOf('个税金额');
          const insuranceIdx = tpl.headers.indexOf('商业保险');
          const bankNameIdx = tpl.headers.indexOf('银行名称');
          const bankLocationIdx = tpl.headers.indexOf('银行所属地');
          if (taxIdx >= 0) out[taxIdx] = '0';
          if (insuranceIdx >= 0) out[insuranceIdx] = '0';
          if (bankNameIdx >= 0 && !out[bankNameIdx]) {
            out[bankNameIdx] = '0';
          }
          if (bankLocationIdx >= 0 && !out[bankLocationIdx]) {
            out[bankLocationIdx] = inferBankLocationFromBranch(bankNameIdx >= 0 ? out[bankNameIdx] : '');
          }
        }
      }
      outputRows.push(out);
      outputRowMeta.push({
        fileName: source?.fileName || '',
        sheetName: source?.sheetName || '',
        rawRow: row,
        typeToCol
      });
    });
  });

  const batchMatch = ['yidao', 'shenbianyun'].includes(state.targetTemplate)
    ? detectBestShangSheMatch(sourcesData)
    : null;
  if (batchMatch) {
    state.shangSheCandidates = batchMatch.candidates || [];
    if (batchMatch.lookup) {
      applyBatchShangShe(batchMatch.lookup, batchMatch.id);
    } else {
      state.batchShangSheId = '';
      state.batchShangSheName = '';
      state.batchNo = '';
    }
  }

  // 云杉模版：知识库自动填充
  const unmatchedRows = [];
  if (state.targetTemplate === 'youyi') {
    // 云杉模版列索引：0-出错信息, 1-平台, 2-商社编号, 3-姓名, 4-身份证号码,
    //   5-性别, 6-任务清单, 7-税源地, 8-工种, 9-手机号码, 10-账号,
    //   11-银行名称, 12-银行所属地, 13-税前金额, 14-个税金额, 15-商业保险, 16-备注
    const platformIdx = tpl.headers.indexOf('平台');       // 1
    const shangSheIdx = tpl.headers.indexOf('商社编号');   // 2
    const taskListIdx = tpl.headers.indexOf('任务清单');   // 6
    const taxSourceIdx = tpl.headers.indexOf('税源地');    // 7
    const workTypeIdx = tpl.headers.indexOf('工种');       // 8

    // 尝试从源文件头部行中检测客户名称和纳税人识别号
    const clientInfo = detectSourceClientInfo(sourcesData);
    const clientName = clientInfo.clientName || '';
    const taxIdValue = clientInfo.taxId || '';

    // 通过纳税人识别号查找
    let taxIdLookup = null;
    if (taxIdValue) {
      taxIdLookup = lookupShangSheByTaxId(taxIdValue);
    }

    // 通过客户名称查找（可能返回多个匹配）
    let clientNameLookups = [];
    if (clientName) {
      clientNameLookups = lookupShangSheByNameAll(clientName);
    }

    // 构建候选列表：自动检测到的命中均转为候选，不直接锁定行，
    // 以便云杉公司内部同一公司存在多个编号时可手动切换。
    let candidates = [];
    if (taxIdLookup) {
      const id = getShangSheIdFromLookup(taxIdLookup);
      candidates.push({ id, label: `${id} - ${taxIdLookup.shortName || taxIdLookup.fullName}`, matchType: '税号精确' });
    } else if (clientNameLookups.length > 0) {
      candidates = clientNameLookups.map(c => ({ id: c.id, label: `${c.id} - ${c.lookup.shortName || c.lookup.fullName}`, matchType: c.matchType }));
    }

    state.shangSheCandidates = candidates;

    // 填充商社信息的辅助函数
    function fillShangSheInfo(out, lookup, rowContext) {
      if (!lookup) return false;
      const colIndex = { platform: platformIdx, taxSource: taxSourceIdx, taskList: taskListIdx, workType: workTypeIdx };
      fillShangSheInfoForRow(out, lookup, colIndex, (idx, val) => { out[idx] = val; }, rowContext);
      // 如果商社编号列为空，也填充商社编号
      if (shangSheIdx >= 0 && !out[shangSheIdx]) {
        // 从lookup中获取商社编号（需要从KB中查找）
        const kb = loadKB();
        for (const [id, entry] of Object.entries(kb.shangSheMap)) {
          if (entry.fullName === lookup.fullName || entry.shortName === lookup.shortName) {
            out[shangSheIdx] = id;
            break;
          }
        }
      }
      return true;
    }

    outputRows.forEach((out, rowIdx) => {
      const rowContext = outputRowMeta[rowIdx] || {};
      const shangSheId = shangSheIdx >= 0 ? out[shangSheIdx] : '';
      if (shangSheId) {
        const lookup = lookupShangShe(shangSheId);
        if (lookup) { fillShangSheInfo(out, lookup, rowContext); return; }
      }
      // 自动检测候选不直接填充，保持未匹配状态供手动选择器确认/切换
      unmatchedRows.push(rowIdx);
    });
  }

  // 身边云: do NOT auto-fill merchant order number (leave empty per user request)

  state.outputRows = outputRows;
  state.outputRowMeta = outputRowMeta;
  state.outputHeaders = tpl.headers;
  state.cleanCount = cleanCount;
  state.unmatchedRows = unmatchedRows;
  state.selectedNoteRows = [];
  state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
  cacheCurrentTemplateOutput();
  showExportStep();
}

function showCustomMappingUI(typeToCol, allDataRows) {
  const container = document.getElementById('export-content');
  document.getElementById('step-export').classList.remove('hidden');

  let html = '<div style="font-size:14px;font-weight:600;margin-bottom:12px;">🔗 自定义列映射</div>';
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
  html += `<div class="btn-row"><button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" onclick="genCustom()">✅ 生成</button></div>`;
  container.innerHTML = html;
}

function genCustom() {
  const { sourcesData } = state.mappingState;

  const fmap = {};
  document.querySelectorAll('#export-content select[data-field]').forEach(sel => {
    if (sel.value) fmap[sel.dataset.field] = sel.value;
  });

  state.outputHeaders = state.customFields;
  state.outputRows = [];
  state.outputRowMeta = [];
  let cleanCount = 0;
  sourcesData.forEach(({ dataRows, typeToCol, source }) => {
    dataRows.forEach(row => {
      const out = new Array(state.customFields.length).fill('');
      for (const [fi, type] of Object.entries(fmap)) {
        let val = row[typeToCol[type]];
        const raw = val != null ? String(val) : '';
        if (type === 'amount') val = sanitizeAmount(val);
        else val = cleanValue(val, type);
        if (val !== raw.trim() && val.length < raw.trim().length) cleanCount++;
        out[Number(fi)] = val != null ? String(val).trim() : '';
      }
      if (!out.some(v => v)) return;
      state.outputRows.push(out);
      state.outputRowMeta.push({
        fileName: source?.fileName || '',
        sheetName: source?.sheetName || ''
      });
    });
  });
  state.cleanCount = cleanCount;
  state.selectedNoteRows = [];
  state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
  showExportStep();
}


// ==================== Data Preprocessing (Space/Whitespace Cleaning) ====================
/**
 * Clean a value based on its field type.
 * Strips all whitespace (spaces, tabs, non-breaking spaces, full-width spaces, etc.)
 * for sensitive fields that should never contain spaces: name, idCard, phone, bankCard.
 * Also normalizes common full-width digits/letters to half-width.
 */

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// ==================== Export Step ====================
export function showExportStep() {
  // 保存当前滚动位置和焦点信息
  const container = document.getElementById('export-content');
  const stepEl = document.getElementById('step-export');
  const savedScrollTop = stepEl ? stepEl.scrollTop : 0;
  const activeEl = document.activeElement;
  let focusInfo = null;
  if (activeEl && stepEl && stepEl.contains(activeEl)) {
    focusInfo = {
      rowIdx: activeEl.dataset.rowIdx || activeEl.closest('[data-row-idx]')?.dataset.rowIdx,
      colIdx: activeEl.dataset.colIdx || activeEl.closest('[data-col-idx]')?.dataset.colIdx,
      tagName: activeEl.tagName,
      type: activeEl.type,
      selectionStart: activeEl.selectionStart,
    };
  }

  stepEl.classList.remove('hidden');

  const headers = state.outputHeaders;
  const rows = state.outputRows;

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
  const tplName = state.targetTemplate === 'custom' ? '自定义' : TEMPLATES[state.targetTemplate].name;

  // 云杉模版：获取平台和任务清单数据用于下拉框
  const isYouyi = state.targetTemplate === 'youyi';
  const supportsBatchNo = ['yidao', 'shenbianyun'].includes(state.targetTemplate);
  let allPlatforms = [];
  let allTaxSources = [];
  let shangSheFullList = [];
  let shangSheCandidates = [];
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
  const previewSwitchHTML = selectedExportTemplates.length > 1
    ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <span style="font-size:13px;font-weight:600;color:var(--text2);">切换预览:</span>
        ${selectedExportTemplates.map(k => `<button class="btn ${k === state.targetTemplate ? 'btn-primary' : 'btn-secondary'} btn-sm" onclick="switchPreviewTemplate('${k}')">${TEMPLATES[k].icon} ${TEMPLATES[k].name}</button>`).join('')}
      </div>`
    : '';
  const splitGroupCount = splitActive ? getSplitGroups().length : 0;
  const multiExportHTML = selectedExportTemplates.length > 1
    ? (splitActive
      ? `<button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" onclick="exportSelectedExcel()">📦 拆分打包导出（${selectedExportTemplates.length} 模板 × ${splitGroupCount} 来源 = ${selectedExportTemplates.length * splitGroupCount} 个 Excel）</button>`
      : `<button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" onclick="exportSelectedExcel()">📦 打包导出 ZIP（${selectedExportTemplates.length} 个 Excel）</button>`)
    : '';

  container.innerHTML = `
    <div class="status-msg success">✅ 转换完成 — ${tplName}（${rows.length} 行）</div>
    ${selectedExportTemplates.length > 1 ? `<div class="status-msg info">本次已选择：${selectedExportTemplates.map(k => TEMPLATES[k].name).join('、')}。当前表格预览为 ${tplName}。</div>` : ''}
    ${previewSwitchHTML}
    ${renderExportControls()}
    ${renderRemarkPanel()}
    <div id="filter-summary" class="filter-summary"></div>
    ${renderPreviewTable()}
    <div class="btn-row">
      ${multiExportHTML}
      ${splitActive
        ? `<button class="btn btn-green" style="flex:1;padding:12px;font-size:15px;" onclick="exportExcel()">📦 拆分导出 ZIP（${splitGroupCount} 份 Excel）</button>
           <button class="btn btn-secondary" onclick="exportCSV()">📦 拆分导出 CSV（${splitGroupCount} 份）</button>`
        : `<button class="btn btn-green" style="flex:1;padding:12px;font-size:15px;" onclick="exportExcel()">📥 导出 Excel（可选保存位置）</button>
           <button class="btn btn-secondary" onclick="exportCSV()">📥 导出 CSV</button>`}
      <button class="btn btn-secondary" onclick="goBack('step-export')">⬅️ 返回</button>
    </div>`;

  // 设置搜索下拉框所需的数据（存入 state 对象）
  if (isYouyi || supportsBatchNo || showSplitBatchPanel) {
  const showSplitBatchPanel = isSplitExportActive() && getSelectedTemplates().includes('shenbianyun');

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
      targetEl.focus();
      if (focusInfo.selectionStart != null && targetEl.setSelectionRange) {
        try { targetEl.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionStart); } catch(e) {}
      }
    }
  }
  // 应用列筛选
  applyColumnFilters();
  updateFilterSummary();
}




function fillShangSheInfoForRow(out, lookup, colIndex, setter, rowContext) {
  return kbFillShangSheInfoForRow(loadKB(), out, lookup, colIndex, setter, rowContext);
}

// 手动匹配商社 - 将选中的商社信息应用到所有未匹配行
function applyManualShangShe() {
  const hidden = document.getElementById('manual-shangshe-selected-id');
  const selectedId = hidden ? hidden.value : '';
  if (!selectedId) {
    alert('请先选择一个商社');
    return;
  }

  const lookup = lookupShangShe(selectedId);
  if (!lookup) {
    alert('未找到该商社的信息');
    return;
  }

  const headers = state.outputHeaders;
  const shangSheIdx = headers.indexOf('商社编号');   // 2
  const platformIdx = headers.indexOf('平台');       // 1
  const taskListIdx = headers.indexOf('任务清单');   // 6
  const taxSourceIdx = headers.indexOf('税源地');    // 7
  const workTypeIdx = headers.indexOf('工种');       // 8

  const unmatchedSet = new Set(state.unmatchedRows || []);

  const colIndex = { platform: platformIdx, taxSource: taxSourceIdx, taskList: taskListIdx, workType: workTypeIdx };

  // 对所有未匹配行应用商社信息
  state.outputRows.forEach((out, rowIdx) => {
    if (!unmatchedSet.has(rowIdx)) return;

    // 填充商社编号
    if (shangSheIdx >= 0) {
      updateOutputRow(rowIdx, shangSheIdx, selectedId);
    }
    // 填充平台、税源地、任务清单、工种
    const rowContext = state.outputRowMeta?.[rowIdx] || {};
    fillShangSheInfoForRow(out, lookup, colIndex, (idx, val) => { updateOutputRow(rowIdx, idx, val); }, rowContext);
  });

  // 从未匹配列表中移除已处理的行
  state.unmatchedRows = state.unmatchedRows.filter(rowIdx => !unmatchedSet.has(rowIdx));

  // 刷新预览
  showExportStep();
}




// ==================== Export Helpers ====================

function getExportFileName(ext) {
  return getExportFileNameForTemplate(state.targetTemplate, ext);
}

function getExportFileNameForTemplate(templateKey, ext) {
  const tplName = templateKey === 'custom' ? '自定义' : TEMPLATES[templateKey].name;
  const batchNo = getBatchNoForTemplate(templateKey);
  if (['yidao', 'shenbianyun'].includes(templateKey) && batchNo) {
    return `${batchNo}_${tplName}.${ext}`;
  }
  return `${tplName}_转换结果_${getTodayStr()}.${ext}`;
}

function getBatchNoForTemplate(templateKey) {
  if (templateKey === state.targetTemplate) return state.batchNo || '';
  return state.templateOutputs?.[templateKey]?.batchNo || '';
}









// ==================== Split Export (一源一单) ====================

export function getSplitGroups() { return getSplitGroupsFromMeta(state.outputRowMeta); }

export function getSplitGroupCounts() {
  const files = new Set(), sheets = new Set();
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

// 文件名片段清洗：去 Windows 非法字符、压缩空白、限长




// 每份单独跑商社检测（按分组过滤数据源），生成各自批次号
export function ensureSplitBatches(groups, force = false) {
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
    const match = detectBestShangSheMatch(groupData, groupSources);
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
async function buildSplitFilesForTemplates(templateKeys, ext) {
  const files = [];
  if (!templateKeys.length) return files;
  cacheCurrentTemplateOutput();
  const currentTemplate = state.targetTemplate;
  if (templateKeys.includes('shenbianyun')) ensureSplitBatches(getSplitGroups());
  const usedNames = new Set();

  for (const templateKey of templateKeys) {
    let out;
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

    const groups = getSplitGroupsFromMeta(out.outputRowMeta);
    for (const g of groups) {
      const rows = g.rowIdxs.map(i => out.outputRows[i]).filter(Boolean);
      if (!rows.length) continue;
      let data;
      if (ext === 'csv') {
        data = new TextEncoder().encode('\uFEFF' + rowsToCSV(out.outputHeaders, rows));
      } else {
        state.sbyShowBatchInfo = out.sbyShowBatchInfo ?? false;
        state.sbyPlainAmount = out.sbyPlainAmount ?? true;
        const batchNo = templateKey === 'shenbianyun' ? (state.splitBatches?.[g.key]?.batchNo || '') : '';
        const wb = await buildWorkbookForTemplate(templateKey, out.outputHeaders, rows, batchNo);
        data = workbookToArray(wb);
      }
      files.push({ name: allocSplitFileName(g, templateKey, ext, usedNames), data });
    }
  }

  state.targetTemplate = currentTemplate;
  restoreTemplateOutput(currentTemplate);
  showExportStep();
  return files;
}

async function downloadSplitZip(files, kind) {
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
  const files = await buildSplitFilesForTemplates([state.targetTemplate].filter(Boolean), 'xlsx');
  await downloadSplitZip(files, 'xlsx');
}

async function exportSplitCSV() {
  const files = await buildSplitFilesForTemplates([state.targetTemplate].filter(Boolean), 'csv');
  await downloadSplitZip(files, 'csv');
}

// ==================== Excel Export (Template-Preserving) ====================
async function exportExcel() {
  if (isSplitExportActive()) { await exportSplitExcel(); return; }
  const headers = state.outputHeaders;
  const rows = state.outputRows;
  const fileName = getExportFileName('xlsx');
  const wb = await buildWorkbookForTemplate(state.targetTemplate, headers, rows);
  return await saveWorkbook(wb, fileName);
}

async function buildWorkbookForTemplate(templateKey, headers, rows, batchNoOverride) {
  if (templateKey === 'yidao') return buildYidaoWorkbook(headers, rows);
  if (templateKey === 'shenbianyun') return await buildShenbianyunWorkbook(headers, rows, batchNoOverride != null ? batchNoOverride : getBatchNoForTemplate(templateKey));
  if (templateKey === 'youyi') return buildYouyiWorkbook(headers, rows);
  return buildGenericWorkbook(headers, rows);
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
  const files = [];
  for (const templateKey of selectedTemplates) {
    if (!state.templateOutputs?.[templateKey]) {
      state.targetTemplate = templateKey;
      generateOutput();
    }
    const cached = state.templateOutputs?.[templateKey];
    if (!cached?.outputHeaders || !cached?.outputRows) continue;
    // 恢复该模版缓存的身边云导出选项
    state.sbyShowBatchInfo = cached.sbyShowBatchInfo ?? false;
    state.sbyPlainAmount = cached.sbyPlainAmount ?? true;
    const wb = await buildWorkbookForTemplate(templateKey, cached.outputHeaders, cached.outputRows);
    files.push({
      name: getExportFileNameForTemplate(templateKey, 'xlsx'),
      data: workbookToArray(wb)
    });
  }

  state.targetTemplate = currentTemplate;
  restoreTemplateOutput(currentTemplate);
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
  const csv = rowsToCSV(state.outputHeaders, state.outputRows);
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
  });
  ['accum-indicator','step-mapping','step-template','step-export'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));
  document.getElementById('file-input').value = '';
}

// ==================== 过渡桥接（阶段 3 结束删除） ====================
// 剩余内联事件引用（导出按钮/模版切换/自定义映射），经 window 解析。
window.__legacy = { state, TEMPLATES };
Object.assign(window, {
  switchPreviewTemplate, exportSelectedExcel, exportExcel, exportCSV, goBack, genCustom,
});

// ==================== 测试面桥接（阶段 4 删除，届时 harness 直连模块） ====================
Object.assign(window, {
  analyzeWorkbookSheets, smartDetectTable, detectColumnMapping, parseCSV, isGarbled,
  buildSourceItem, generateOutput, buildWorkbookForTemplate, buildSplitFilesForTemplates,
  mergeKnowledgeRows, importKBFromWorkbook, saveKB, loadKB, invalidateKBCache,
  rowsToCSV, getSplitGroups, ensureSplitBatches, getExportFileNameForTemplate,
  dedupeBatchNo, buildBatchNoFromShangShe, generateConfigSheet, generateTaskListSheet,
  handleFiles, confirmMapping, selectTemplate, confirmTemplate, resetAll,
});
