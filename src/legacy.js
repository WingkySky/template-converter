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


// ==================== State ====================
const DEFAULT_PREVIEW_ROW_LIMIT = 8;
const PREVIEW_ROW_INCREMENT = 20;

const state = {
  sources: [],
  previewSourceId: '',
  pendingFiles: 0,
  accumFileCount: 0,
  mappingState: null,
  targetTemplate: null,
  selectedTemplates: [],
  templateOutputs: {},
  customFields: [],
  outputRows: null,
  outputHeaders: null,
  outputRowMeta: [],
  selectedNoteRows: [],
  previewRowLimit: DEFAULT_PREVIEW_ROW_LIMIT,
  batchNo: '',
  batchShangSheId: '',
  batchShangSheName: '',
  cleanCount: 0,
  // Template file data (ArrayBuffer) for preservation-based export
  templateFiles: {},
  // 知识库匹配状态：记录哪些输出行未匹配到知识库
  unmatchedRows: [],
  // 缩小范围的候选商社（供手动选择器使用）
  shangSheCandidates: [],
  // 商社全量列表（供搜索下拉框使用）
  shangSheFullList: [],
  // 平台全量列表（供搜索下拉框使用）
  platformFullList: [],
  // 记住上次保存文件的目录
  lastSaveDir: null,
  // 列索引常量，由 showExportStep() 动态计算
  colIndex: {},
  // 列筛选状态：{ colIdx: Set(允许的值) }
  columnFilters: {},
  // 身边云导出选项
  sbyShowBatchInfo: false,   // 是否显示总笔数和总金额行（默认不显示）
  sbyPlainAmount: true,      // 金额使用纯数字格式（默认纯数字，不带¥符号）
  // 导出模式: 'merge' 合并为一份 | 'byFile' 按文件拆分 | 'bySheet' 按数据表拆分
  exportMode: 'merge',
  // 拆分模式下每份的商社/批次号: { [groupKey]: { batchNo, shangSheId, shangSheName } }
  splitBatches: {},
  // 渲染拆分批次面板时暂存的分组列表（供下拉框回调定位分组）
  splitGroupList: [],
};

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

let _kbCache = null;  // KB 内存缓存


// 加载知识库
function loadKB() {
  // 优先从缓存返回
  if (_kbCache !== null) return _kbCache;
  try {
    const raw = localStorage.getItem(KB_STORAGE_KEY);
    if (raw) {
      const kb = JSON.parse(raw);
      if (kb && kb.shangSheMap) {
        // 确保新字段有默认值（兼容旧数据）
        if (!kb.configData) kb.configData = { taxSources: [], platforms: [] };
        if (!kb.taskListData) kb.taskListData = [];
        migrateKB(kb);
        _kbCache = kb;
        return kb;
      }
    }
  } catch (e) {
    console.warn('加载知识库失败:', e);
  }
  const defaultKB = { shangSheMap: {}, configData: { taxSources: [], platforms: [] }, taskListData: [], lastUpdated: null, schemaVersion: KB_SCHEMA_VERSION };
  _kbCache = defaultKB;
  return defaultKB;
}

// 保存知识库
function saveKB(kb) {
  kb.schemaVersion = KB_SCHEMA_VERSION;
  kb.lastUpdated = new Date().toISOString();
  try {
    localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(kb));
    _kbCache = kb;
  } catch (e) {
    console.error('保存知识库失败:', e);
    // 降级方案：自动下载 JSON 备份
    const blob = new Blob([JSON.stringify(kb, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `知识库备份_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    alert('知识库数据超出浏览器存储限制，已自动下载为 JSON 备份文件。请妥善保存备份文件。');
  }
  updateKBStatus();
}

// 使知识库缓存失效
function invalidateKBCache() {
  _kbCache = null;
}

// 清空知识库
function clearKB() {
  if (!confirm('确定要清空知识库吗？此操作不可恢复。')) return;
  localStorage.removeItem(KB_STORAGE_KEY);
  invalidateKBCache();
  updateKBStatus();
}






// 导出知识库为Excel备份文件（用户看到中文列名，内部仍保存JSON结构）
function exportKBToExcel() {
  const kb = loadKB();
  const count = Object.keys(kb.shangSheMap).length;
  if (count === 0) {
    alert('知识库为空，无法导出');
    return;
  }

  const wb = XLSX.utils.book_new();
  const mainWs = XLSX.utils.aoa_to_sheet(knowledgeRowsFromKB(kb));
  mainWs['!cols'] = [
    {wch:12},{wch:22},{wch:30},{wch:12},{wch:18},{wch:22},{wch:10},{wch:28},{wch:16},{wch:50}
  ];
  XLSX.utils.book_append_sheet(wb, mainWs, '知识库');

  const configWs = XLSX.utils.aoa_to_sheet(generateConfigSheet(kb));
  configWs['!cols'] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, configWs, '配置表');

  const taskWs = XLSX.utils.aoa_to_sheet(generateTaskListSheet(kb));
  taskWs['!cols'] = [{ wch: 40 }];
  XLSX.utils.book_append_sheet(wb, taskWs, '任务清单');

  const d = new Date();
  XLSX.writeFile(wb, `知识库备份_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.xlsx`);
}

// 从JSON字符串导入知识库（合并逻辑：新数据覆盖旧数据）
function importKBFromJSON(jsonStr) {
  let newKB;
  try {
    newKB = JSON.parse(jsonStr);
  } catch (e) {
    alert('JSON格式错误，无法解析');
    return false;
  }
  if (!newKB || !newKB.shangSheMap || typeof newKB.shangSheMap !== 'object') {
    alert('JSON格式不正确，缺少shangSheMap字段');
    return false;
  }
  const currentKB = loadKB();
  // 合并：新数据覆盖旧数据
  for (const [id, entry] of Object.entries(newKB.shangSheMap)) {
    currentKB.shangSheMap[id] = entry;
  }
  // 合并配置数据（新数据覆盖旧数据）
  if (newKB.configData) {
    currentKB.configData = newKB.configData;
  }
  // 合并任务清单数据（新数据覆盖旧数据）
  if (newKB.taskListData) {
    currentKB.taskListData = newKB.taskListData;
  }
  saveKB(currentKB);
  return true;
}

function importKBFromWorkbook(wb) {
  const kb = loadKB();
  const mainSheetName = wb.SheetNames.find(n => n.includes('知识库')) || wb.SheetNames[0];
  if (!mainSheetName) {
    alert('Excel文件中未找到知识库工作表');
    return null;
  }

  const mainRows = XLSX.utils.sheet_to_json(wb.Sheets[mainSheetName], { header: 1, raw: false });
  if (mainRows.length < 2) {
    alert('知识库文件数据不足（至少需要表头+1行数据）');
    return null;
  }

  const result = mergeKnowledgeRows(mainRows, kb);

  const configSheetName = wb.SheetNames.find(n => n.includes('配置表'));
  if (configSheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[configSheetName], { header: 1, raw: false });
    applyConfigSheetRows(rows, kb);
  }

  const taskSheetName = wb.SheetNames.find(n => n.includes('任务清单'));
  if (taskSheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[taskSheetName], { header: 1, raw: false });
    applyTaskListSheetRows(rows, kb);
  }

  saveKB(kb);
  return result;
}

// 下载知识库样例文件
function downloadKBSample() {
  const headers = ['商社编号','商社简称','商社全称','一级业务类型','二级业务类型','纳税人识别号','签约费率','签约主体','任务名称','服务内容'];
  const sampleRow1 = ['0000913','甲乙商贸（灵活用工）','甲乙商贸（广州）有限公司','新业态服务','平台用工','91440101F0E3LB8770','6','佛山云杉人力资源服务有限公司','保洁服务','我司需要一批自由职业者提供保洁服务，包含但不限于办公场所的清洁打扫工作等'];
  const sampleRow2 = ['0000913','甲乙商贸（灵活用工）','甲乙商贸（广州）有限公司','新业态服务','平台用工','91440101F0E3LB8770','6','佛山云杉人力资源服务有限公司','搬运服务','我司需要一批自由职业者提供搬运服务'];
  const sampleRow3 = ['0349912','测试（信息中心）','测试（信息中心）','新业态服务','平台用工','','8.5','广州市云杉对外服务有限公司','司机','开车'];
  const wsData = [headers, sampleRow1, sampleRow2, sampleRow3];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [
    {wch:12},{wch:22},{wch:30},{wch:12},{wch:18},{wch:22},{wch:10},{wch:28},{wch:16},{wch:50}
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, '知识库样例文件.xlsx');
}

// 处理知识库Excel上传
function handleKBUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = e.target.result;
      const wb = XLSX.read(data, { type: 'array' });
      // 读取第一个sheet
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

      if (rows.length < 2) {
        alert('知识库文件数据不足（至少需要表头+1行数据）');
        return;
      }

      const kb = loadKB();
      const { newCount, updateCount } = mergeKnowledgeRows(rows, kb);

      saveKB(kb);
      const total = Object.keys(kb.shangSheMap).length;
      alert(`知识库上传成功！\n新增 ${newCount} 个商社，更新 ${updateCount} 条记录\n当前共 ${total} 个商社`);
    } catch (err) {
      console.error('解析知识库文件失败:', err);
      alert('解析知识库文件失败：' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
  // 重置input以便再次选择同一文件
  event.target.value = '';
}

// 处理知识库备份导入（优先Excel，兼容旧JSON备份）
function handleKBImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let result = null;
      if (ext === 'json') {
        result = importKBFromJSON(e.target.result) ? { newCount: 0, updateCount: 0 } : null;
      } else {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        result = importKBFromWorkbook(wb);
      }
      if (result) {
        const kb = loadKB();
        const count = Object.keys(kb.shangSheMap).length;
        alert(`知识库导入成功！\n新增 ${result.newCount} 个商社，更新 ${result.updateCount} 条记录\n当前共 ${count} 个商社`);
      }
    } catch (err) {
      console.error('导入知识库备份失败:', err);
      alert('导入知识库备份失败：' + err.message);
    }
  };
  if (ext === 'json') {
    reader.readAsText(file, 'utf-8');
  } else {
    reader.readAsArrayBuffer(file);
  }
  event.target.value = '';
}

// 处理配置数据上传（从模板文件更新配置表和任务清单）
function handleKBConfigUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = e.target.result;
      const wb = XLSX.read(data, { type: 'array' });
      const kb = loadKB();
      let taxSourceCount = 0, platformCount = 0, taskCount = 0, shangSheCrossRef = 0;

      // 1. 解析"配置表"sheet
      const configSheetName = wb.SheetNames.find(n => n.includes('配置表'));
      if (configSheetName) {
        const ws = wb.Sheets[configSheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (rows.length >= 2) {
          const taxSources = [];
          const platforms = [];
          const headerRow = rows[0] || [];
          // 检查是否有扩展列（签约主体映射、平台税源地映射）
          let signEntityColIdx = -1;
          let platTaxSourceColIdx = -1;
          for (let c = 0; c < headerRow.length; c++) {
            const h = String(headerRow[c] || '');
            if (/签约主体/.test(h)) signEntityColIdx = c;
            if (/平台税源地/.test(h)) platTaxSourceColIdx = c;
          }
          const signEntityMapping = {};
          const platformTaxSourceMapping = {};
          // Row 0 is header ("税源地", "平台", ...)
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const taxVal = String(row[0] || '').trim();
            const platVal = String(row[1] || '').trim();
            taxSources.push(taxVal);
            platforms.push(platVal);
            // 解析签约主体映射（格式：签约主体名称→关键词1,关键词2）
            if (signEntityColIdx >= 0) {
              const seVal = String(row[signEntityColIdx] || '').trim();
              if (seVal && seVal.includes('→')) {
                const [seKey, seKeywords] = seVal.split('→').map(s => s.trim());
                if (seKey && seKeywords) {
                  signEntityMapping[seKey] = seKeywords.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                }
              }
            }
            // 解析平台税源地映射（格式：关键词→税源地）
            if (platTaxSourceColIdx >= 0) {
              const ptVal = String(row[platTaxSourceColIdx] || '').trim();
              if (ptVal && ptVal.includes('→')) {
                const [ptKey, ptTaxSource] = ptVal.split('→').map(s => s.trim());
                if (ptKey && ptTaxSource) {
                  platformTaxSourceMapping[ptKey] = ptTaxSource;
                }
              }
            }
          }
          // Filter out completely empty values
          kb.configData = {
            taxSources: taxSources.filter(v => v !== ''),
            platforms: platforms.filter(v => v !== '')
          };
          if (Object.keys(signEntityMapping).length > 0) {
            kb.configData.signEntityMapping = signEntityMapping;
          }
          if (Object.keys(platformTaxSourceMapping).length > 0) {
            kb.configData.platformTaxSourceMapping = platformTaxSourceMapping;
          }
          taxSourceCount = kb.configData.taxSources.length;
          platformCount = kb.configData.platforms.length;
        }
      }

      // 1.5 解析"签约主体映射"sheet（独立sheet格式：签约主体 | 关键词1,关键词2）
      const signEntitySheetName = wb.SheetNames.find(n => n.includes('签约主体映射'));
      if (signEntitySheetName) {
        const ws = wb.Sheets[signEntitySheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (rows.length >= 2) {
          const signEntityMapping = {};
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const seKey = String(row[0] || '').trim();
            const seKeywords = String(row[1] || '').trim();
            if (seKey && seKeywords) {
              signEntityMapping[seKey] = seKeywords.split(/[,，]/).map(s => s.trim()).filter(Boolean);
            }
          }
          if (Object.keys(signEntityMapping).length > 0) {
            if (!kb.configData) kb.configData = {};
            kb.configData.signEntityMapping = signEntityMapping;
          }
        }
      }

      // 1.6 解析"平台税源地映射"sheet（独立sheet格式：关键词 | 税源地）
      const platTaxSourceSheetName = wb.SheetNames.find(n => n.includes('平台税源地映射'));
      if (platTaxSourceSheetName) {
        const ws = wb.Sheets[platTaxSourceSheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (rows.length >= 2) {
          const platformTaxSourceMapping = {};
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const ptKey = String(row[0] || '').trim();
            const ptTaxSource = String(row[1] || '').trim();
            if (ptKey && ptTaxSource) {
              platformTaxSourceMapping[ptKey] = ptTaxSource;
            }
          }
          if (Object.keys(platformTaxSourceMapping).length > 0) {
            if (!kb.configData) kb.configData = {};
            kb.configData.platformTaxSourceMapping = platformTaxSourceMapping;
          }
        }
      }

      // 2. 解析"任务清单"sheet
      const taskSheetName = wb.SheetNames.find(n => n.includes('任务清单'));
      if (taskSheetName) {
        const ws = wb.Sheets[taskSheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (rows.length >= 2) {
          const taskEntries = [];
          // Row 0 is header ("任务清单")
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const entry = String(row[0] || '').trim();
            if (entry) taskEntries.push(entry);
          }
          kb.taskListData = taskEntries;
          taskCount = taskEntries.length;
        }
      }

      // 3. 解析"费用明细"sheet - 提取商社编号并交叉引用
      const detailSheetName = wb.SheetNames.find(n => n.includes('费用明细'));
      if (detailSheetName) {
        const ws = wb.Sheets[detailSheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (rows.length >= 2) {
          // 查找商社编号列
          const headerRow = rows[0] || [];
          let shangSheColIdx = -1;
          for (let c = 0; c < headerRow.length; c++) {
            if (/商社编号/.test(String(headerRow[c] || ''))) {
              shangSheColIdx = c;
              break;
            }
          }
          if (shangSheColIdx >= 0) {
            const shangSheIds = new Set();
            for (let i = 1; i < rows.length; i++) {
              const val = String((rows[i] || [])[shangSheColIdx] || '').trim();
              if (val) shangSheIds.add(val);
            }
            // 交叉引用：如果KB中有该商社编号则计数
            for (const id of shangSheIds) {
              if (kb.shangSheMap[id]) shangSheCrossRef++;
            }
          }
        }
      }

      saveKB(kb);

      let msg = '配置数据更新成功！\n';
      if (taxSourceCount > 0 || platformCount > 0) {
        msg += `配置表：${taxSourceCount} 个税源地，${platformCount} 个平台\n`;
      }
      if (taskCount > 0) {
        msg += `任务清单：${taskCount} 条任务\n`;
      }
      if (shangSheCrossRef > 0) {
        msg += `费用明细交叉引用：${shangSheCrossRef} 个商社编号已在知识库中`;
      }
      if (taxSourceCount === 0 && platformCount === 0 && taskCount === 0) {
        msg += '未找到"配置表"或"任务清单"工作表';
      }
      alert(msg);
    } catch (err) {
      console.error('解析配置数据文件失败:', err);
      alert('解析配置数据文件失败：' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

// 更新知识库状态显示
function updateKBStatus() {
  const kb = loadKB();
  const shangSheCount = Object.keys(kb.shangSheMap).length;
  let taskCount = 0;
  for (const entry of Object.values(kb.shangSheMap)) {
    taskCount += (entry.tasks || []).length;
  }
  let lastUpdated = '未加载';
  if (kb.lastUpdated) {
    const d = new Date(kb.lastUpdated);
    lastUpdated = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  const area = document.getElementById('kb-status-area');
  if (area) {
    area.innerHTML = `
      <div class="kb-stat"><div><div class="num">${shangSheCount}</div><div class="label">商社数量</div></div></div>
      <div class="kb-stat"><div><div class="num">${taskCount}</div><div class="label">任务数量</div></div></div>
      <div class="kb-stat"><div><div class="num" style="font-size:13px;">${escapeHTML(lastUpdated)}</div><div class="label">最后更新</div></div></div>
    `;
  }
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
updateKBStatus();

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

// ==================== File Upload ====================
const uploadArea = document.getElementById('upload-area');
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault(); uploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

function handleFileInput(e) { if (e.target.files.length) handleFiles(e.target.files); }

function handleFiles(fileList) {
  const files = Array.from(fileList);
  state.pendingFiles += files.length;
  state.accumFileCount += files.length;
  files.forEach(f => processFile(f));
}

function processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = e => {
      let text = e.target.result;
      if (isGarbled(text)) {
        const r2 = new FileReader();
        r2.onload = e2 => {
          state.sources.push(buildSourceItem({ type: 'csv', fileName: file.name, rows: parseCSV(e2.target.result) }));
          onFileParsed();
        };
        r2.readAsText(file, 'gbk');
      } else {
        state.sources.push(buildSourceItem({ type: 'csv', fileName: file.name, rows: parseCSV(text) }));
        onFileParsed();
      }
    };
    reader.readAsText(file, 'utf-8');
  } else if (['xlsx', 'xls'].includes(ext)) {
    const reader = new FileReader();
    reader.onload = e => {
      const data = e.target.result;
      const wb = XLSX.read(data, { type: 'array' });
      const sheetItems = analyzeWorkbookSheets(wb, file.name);
      sheetItems.forEach(item => state.sources.push(item));
      // Store raw ArrayBuffer for template-based export
      state.templateFiles[file.name] = data;
      onFileParsed();
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert('不支持的文件格式');
    state.pendingFiles--;
  }
}

function onFileParsed() {
  state.pendingFiles--;
  if (state.pendingFiles <= 0) {
    updateAccumIndicator();
    showMappingStep();
    document.getElementById('file-input').value = '';
  }
}


function updateAccumIndicator() {
  const el = document.getElementById('accum-indicator');
  const sel = state.sources.filter(s => s.selected);
  if (state.accumFileCount > 0) {
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="accum-bar">
        <span>📂 已累加 ${state.accumFileCount} 个文件（${sel.length} 个数据表，${countSelectedRows()} 行数据）</span>
        <button class="btn btn-secondary btn-sm" onclick="resetAll()">🗑️ 清空</button>
      </div>`;
  } else { el.classList.add('hidden'); }
}

function countSelectedRows() {
  return state.sources.filter(s => s.selected).reduce((sum, s) => sum + s.rows.length, 0);
}

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
function showMappingStep() {
  const container = document.getElementById('mapping-content');
  document.getElementById('step-mapping').classList.remove('hidden');

  const sel = state.sources.filter(s => s.selected);

  // Source selection cards：多源时始终展示；全部取消勾选时也展示，便于重新勾选
  let sourceHTML = '';
  if (state.sources.length > 1 || !sel.length) {
    const cards = state.sources.map(item => {
      const desc = item.type === 'excel-sheet' ? `${item.fileName} / ${item.sheetName}` : item.fileName;
      const isP = item.id === state.previewSourceId;
      return `
        <div style="padding:10px;border:1px solid ${isP?'var(--blue)':(item.selected?'var(--accent)':'var(--border)')};border-radius:8px;background:${isP?'rgba(116,185,255,0.08)':(item.selected?'rgba(108,92,231,0.08)':'var(--surface2)')};">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            <input type="checkbox" ${item.selected?'checked':''} onchange='toggleSrc(${JSON.stringify(item.id)},this.checked)' style="margin-top:2px;accent-color:var(--accent);">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;word-break:break-word;">${escapeHTML(desc)}</div>
              <div style="font-size:12px;color:var(--text2);margin-top:2px;">${(item.analysis?.dataRowsCount||item.rows.length)} 行</div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick='setPreview(${JSON.stringify(item.id)})'>${isP?'✓ 预览中':'预览'}</button>
        </div>`;
    }).join('');
    sourceHTML = `<div style="background:var(--surface2);border-radius:8px;padding:14px;border:1px solid var(--border);margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">🗂️ 数据源</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">${cards}</div>
    </div>`;
  }

  if (!sel.length) {
    container.innerHTML = `
      ${sourceHTML}
      <div class="status-msg error">⚠️ 请至少勾选一个数据表以继续列映射</div>`;
    return;
  }

  const source = sel.find(s => s.id === state.previewSourceId) || sel[0];
  state.previewSourceId = source.id;

  const { headerRow, headerRowIndex, dataRows, filteredCount } = smartDetectTable(source.rows);
  const autoMap = detectColumnMapping(headerRow, dataRows);
  state.mappingState = { headerRow, headerRowIndex, dataRows, mapping: autoMap, source, filteredCount: filteredCount || 0 };

  // Column mapping
  const colIndices = Object.keys(autoMap.cols).map(Number).sort((a,b)=>a-b);
  let colsHTML = '';
  colIndices.forEach(ci => {
    const col = autoMap.cols[ci];
    colsHTML += `<div class="mapping-col ${col.type?'selected':''}">
      <div class="col-idx">第 ${ci+1} 列</div>
      <div class="col-header">${escapeHTML(col.header)}</div>
      <select data-col="${ci}" onchange="onMapChange(this)">
        ${Object.entries(COL_TYPE_LABELS).map(([k,v])=>`<option value="${k}" ${k===col.type?'selected':''}>${v}</option>`).join('')}
      </select>
      <div class="col-sample">${col.samples.map(s=>`<span>${escapeHTML(s.length>15?s.slice(0,15)+'…':s)}</span>`).join(' ')}</div>
    </div>`;
  });

  // Preview
  const pv = Math.min(dataRows.length, 5);
  let pvBody = '';
  for (let ri = 0; ri < pv; ri++) {
    pvBody += '<tr>' + colIndices.map(ci => {
      const v = String((dataRows[ri]||[])[ci]||'');
      return `<td>${v?escapeHTML(v):'<span style="color:var(--text2);opacity:0.4;">—</span>'}</td>`;
    }).join('') + '</tr>';
  }
  if (dataRows.length > pv) pvBody += `<tr><td colspan="${colIndices.length}" style="text-align:center;color:var(--text2);font-size:12px;padding:8px;">… 还有 ${dataRows.length-pv} 行</td></tr>`;

  container.innerHTML = `
    ${sourceHTML}
    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
      <div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">📊 <strong style="color:var(--accent2);">${dataRows.length}</strong> 行有效数据</div>
      <div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">📋 识别 <strong style="color:var(--accent2);">${colIndices.length}</strong> 列</div>
      ${headerRowIndex>0?`<div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">⏭️ 跳过前 ${headerRowIndex} 行</div>`:''}
      ${filteredCount>0?`<div style="background:rgba(253,203,110,0.12);padding:8px 14px;border-radius:8px;font-size:13px;color:var(--orange);">🛡️ 已自动过滤 <strong>${filteredCount}</strong> 行非人员记录（如平台服务费、合计等费用/汇总行）</div>`:''}
    </div>
    <div style="font-size:14px;font-weight:600;margin-bottom:10px;">📋 列映射 — 请确认或修改</div>
    <div class="mapping-grid">${colsHTML}</div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px;">📋 数据预览</div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
        <table class="result-table" style="font-size:12px;">
          <thead><tr>${colIndices.map(ci=>`<th>${escapeHTML(autoMap.cols[ci].header)}</th>`).join('')}</tr></thead>
          <tbody>${pvBody}</tbody>
        </table>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" onclick="confirmMapping()">✅ 确认映射</button>
      <button class="btn btn-secondary" onclick="resetAll()">🔄 重置</button>
    </div>`;
}

function toggleSrc(id, checked) {
  const t = state.sources.find(s=>s.id===id);
  if (t) t.selected = checked;
  if (checked) state.previewSourceId = id;
  updateAccumIndicator(); showMappingStep();
}

function setPreview(id) {
  const t = state.sources.find(s=>s.id===id);
  if (t) { if (!t.selected) t.selected = true; state.previewSourceId = id; }
  updateAccumIndicator(); showMappingStep();
}

function onMapChange(sel) {
  const ci = sel.dataset.col;
  if (state.mappingState) state.mappingState.mapping.cols[ci].type = sel.value;
  sel.parentElement.classList.toggle('selected', !!sel.value);
}

function confirmMapping() {
  // Collect data rows WITH per-source column mappings
  // This is critical for multi-sheet files where each sheet has different column layout
  const sourcesData = [];
  state.sources.filter(s => s.selected).forEach(src => {
    const { dataRows } = smartDetectTable(src.rows);
    if (dataRows.length === 0) return;

    // Use user-modified mapping for preview source, auto-detected for others
    let typeToCol = {};
    if (src.id === state.previewSourceId) {
      const cols = state.mappingState.mapping.cols;
      Object.entries(cols).forEach(([ci, col]) => { if (col.type) typeToCol[col.type] = Number(ci); });
    } else if (src.analysis?.autoMap?.cols) {
      Object.entries(src.analysis.autoMap.cols).forEach(([ci, col]) => { if (col.type) typeToCol[col.type] = Number(ci); });
    }

    sourcesData.push({ dataRows, typeToCol, source: src });
  });

  if (!sourcesData.length) { alert('没有有效数据行'); return; }
  state.mappingState.sourcesData = sourcesData;
  showTemplateStep();
}

// ==================== Template Selection ====================
function showTemplateStep() {
  const container = document.getElementById('template-content');
  document.getElementById('step-template').classList.remove('hidden');

  const selectedTemplates = getSelectedTemplates();
  let cardsHTML = '';
  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    const selected = selectedTemplates.includes(key);
    cardsHTML += `<div class="template-card ${selected?'selected':''}" onclick="selectTemplate('${key}')">
      <input class="multi-check" type="checkbox" ${selected?'checked':''} tabindex="-1">
      <div class="name">${tpl.icon} ${tpl.name}</div>
      <div class="fields">${tpl.desc}</div>
      ${key!=='custom'?`<div style="margin-top:8px;font-size:11px;color:var(--text2);">${escapeHTML(tpl.headers.slice(0,6).join('、'))}${tpl.headers.length>6?'…':''}</div>`:''}
    </div>`;
  }

  let customHTML = '';
  if (state.targetTemplate === 'custom') {
    const tags = state.customFields.map((f,i)=>`<div class="custom-field-tag">${escapeHTML(f)} <span class="remove" onclick="rmCF(${i})">✕</span></div>`).join('');
    customHTML = `<div style="background:var(--surface2);border-radius:8px;padding:14px;border:1px solid var(--border);margin-top:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">自定义列名</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="custom-field-input" id="cf-input" placeholder="输入列名，回车添加" onkeydown="if(event.key==='Enter'){addCF();event.preventDefault();}">
        <button class="btn btn-secondary btn-sm" onclick="addCF()">添加</button>
      </div>
      <div class="custom-fields">${tags}</div>
    </div>`;
  }

  container.innerHTML = `<div class="template-grid">${cardsHTML}</div>${customHTML}
    ${selectedTemplates.length > 1 ? `<div class="status-msg info">已选择 ${selectedTemplates.length} 个模版：${selectedTemplates.map(k => TEMPLATES[k].name).join('、')}。下一步先预览 ${TEMPLATES[state.targetTemplate].name}，导出时可一次导出全部所选模版。</div>` : ''}
    <div class="btn-row">
      <button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" onclick="confirmTemplate()" ${!selectedTemplates.length?'disabled':''}>${state.targetTemplate==='custom'?'✅ 映射自定义列':'✅ 生成转换结果'}</button>
      <button class="btn btn-secondary" onclick="goBack('step-template')">⬅️ 返回</button>
    </div>`;
}

function getSelectedTemplates() {
  if (Array.isArray(state.selectedTemplates) && state.selectedTemplates.length) return state.selectedTemplates;
  return state.targetTemplate ? [state.targetTemplate] : [];
}

function selectTemplate(key) {
  if (key === 'custom') {
    state.selectedTemplates = ['custom'];
    state.targetTemplate = 'custom';
    showTemplateStep();
    return;
  }

  let selected = getSelectedTemplates().filter(k => k !== 'custom');
  if (selected.includes(key)) {
    selected = selected.filter(k => k !== key);
  } else {
    selected.push(key);
  }

  state.selectedTemplates = selected;
  state.targetTemplate = selected.includes(state.targetTemplate) ? state.targetTemplate : (selected[0] || null);
  if (selected.includes(key)) state.targetTemplate = key;
  showTemplateStep();
}
function addCF() {
  const input = document.getElementById('cf-input');
  const v = input.value.trim();
  if (v && !state.customFields.includes(v)) { state.customFields.push(v); input.value = ''; showTemplateStep(); }
}
function rmCF(i) { state.customFields.splice(i,1); showTemplateStep(); }
function goBack(id) { document.getElementById(id).classList.add('hidden'); }

function confirmTemplate() {
  const selectedTemplates = getSelectedTemplates();
  if (!selectedTemplates.length) { alert('请选择模版'); return; }
  state.selectedTemplates = selectedTemplates;
  state.targetTemplate = state.targetTemplate || selectedTemplates[0];
  if (state.targetTemplate === 'custom' && !state.customFields.length) { alert('请添加列名'); return; }
  generateOutput();
}

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

function cacheCurrentTemplateOutput() {
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
function generateOutput() {
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

function normalizeSearchText(value) {
  return String(value ?? '').trim().toLowerCase();
}

// ==================== Column Filter ====================
function getColumnUniqueValues(colIdx) {
  const values = new Set();
  for (const row of state.outputRows || []) {
    const v = row[colIdx];
    values.add(v != null ? String(v) : '');
  }
  return Array.from(values).sort();
}

let _activeFilterCol = -1;

function toggleColumnFilter(event, colIdx) {
  event.stopPropagation();
  closeAllFilterPanels();
  if (_activeFilterCol === colIdx) {
    _activeFilterCol = -1;
    return;
  }
  _activeFilterCol = colIdx;
  const th = event.target.closest('th');
  if (!th) return;
  const panel = document.createElement('div');
  panel.className = 'col-filter-panel';
  panel.id = 'col-filter-panel';
  const uniqueValues = getColumnUniqueValues(colIdx);
  const currentFilter = state.columnFilters[colIdx];
  const allChecked = !currentFilter || currentFilter.size === uniqueValues.length;

  panel.innerHTML = `
    <input class="filter-search" placeholder="搜索..." oninput="filterFilterList(this.value, ${colIdx})">
    <div style="display:flex;align-items:center;gap:6px;padding:2px 4px;">
      <input type="checkbox" id="filter-select-all" ${allChecked ? 'checked' : ''} onchange="toggleFilterSelectAll(${colIdx}, this.checked)">
      <label for="filter-select-all" style="font-size:12px;color:var(--text2);cursor:pointer;">全选/取消全选</label>
    </div>
    <div class="filter-list" id="filter-value-list">
      ${uniqueValues.map(v => {
        const checked = !currentFilter || currentFilter.has(v);
        const escapedV = escapeHTML(v).replace(/'/g, "\\'");
        return `<div class="filter-item" data-value="${escapeHTML(v)}">
          <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleFilterValue(${colIdx}, '${escapedV}', this.checked)">
          <span class="filter-value" title="${escapeHTML(v)}">${v ? escapeHTML(v) : '<span style="color:var(--text2);opacity:0.5;">(空)</span>'}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="filter-actions">
      <button onclick="resetColumnFilter(${colIdx})">重置</button>
      <button onclick="applyColumnFilter(${colIdx})">确定</button>
    </div>`;
  th.style.position = 'relative';
  th.appendChild(panel);
  setTimeout(() => document.addEventListener('click', closeFilterOnOutsideClick), 0);
}

function closeAllFilterPanels() {
  const panel = document.getElementById('col-filter-panel');
  if (panel) panel.remove();
  document.removeEventListener('click', closeFilterOnOutsideClick);
}

function closeFilterOnOutsideClick(e) {
  const panel = document.getElementById('col-filter-panel');
  if (panel && !panel.contains(e.target) && !e.target.classList.contains('col-filter-btn')) {
    closeAllFilterPanels();
    _activeFilterCol = -1;
  }
}

function filterFilterList(searchText, colIdx) {
  const list = document.getElementById('filter-value-list');
  if (!list) return;
  const items = list.querySelectorAll('.filter-item');
  const lower = searchText.toLowerCase();
  items.forEach(item => {
    const value = item.dataset.value || '';
    item.style.display = !searchText || value.toLowerCase().includes(lower) ? '' : 'none';
  });
}

function toggleFilterSelectAll(colIdx, checked) {
  const list = document.getElementById('filter-value-list');
  if (!list) return;
  list.querySelectorAll('.filter-item input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
}

function toggleFilterValue(colIdx, value, checked) {
  // 即时更新复选框状态，但不立即应用筛选
}

function applyColumnFilter(colIdx) {
  const list = document.getElementById('filter-value-list');
  if (!list) return;
  const checkboxes = list.querySelectorAll('.filter-item input[type="checkbox"]');
  const uncheckedValues = new Set();
  checkboxes.forEach(cb => {
    if (!cb.checked) {
      const value = cb.closest('.filter-item').dataset.value;
      uncheckedValues.add(value);
    }
  });

  if (uncheckedValues.size === 0) {
    delete state.columnFilters[colIdx];
  } else {
    const uniqueValues = getColumnUniqueValues(colIdx);
    state.columnFilters[colIdx] = new Set(uniqueValues.filter(v => !uncheckedValues.has(v)));
  }

  closeAllFilterPanels();
  _activeFilterCol = -1;
  applyColumnFilters();
  updateFilterSummary();
}

function resetColumnFilter(colIdx) {
  delete state.columnFilters[colIdx];
  closeAllFilterPanels();
  _activeFilterCol = -1;
  applyColumnFilters();
  updateFilterSummary();
}

function clearAllColumnFilters() {
  state.columnFilters = {};
  applyColumnFilters();
  updateFilterSummary();
  document.querySelectorAll('.col-filter-btn.active').forEach(btn => btn.classList.remove('active'));
}

function applyColumnFilters() {
  const tbody = document.querySelector('#export-content .result-table tbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr[data-row-idx]');
  const filters = state.columnFilters;
  const hasAnyFilter = Object.keys(filters).length > 0;

  rows.forEach(tr => {
    const ri = parseInt(tr.dataset.rowIdx);
    if (isNaN(ri)) return;
    const row = state.outputRows?.[ri];
    if (!row) return;

    let visible = true;
    if (hasAnyFilter) {
      for (const [colIdxStr, allowedSet] of Object.entries(filters)) {
        const ci = parseInt(colIdxStr);
        const cellValue = row[ci] != null ? String(row[ci]) : '';
        if (!allowedSet.has(cellValue)) {
          visible = false;
          break;
        }
      }
    }
    tr.style.display = visible ? '' : 'none';
  });

  // 更新表头筛选按钮的 active 状态
  document.querySelectorAll('.col-filter-btn').forEach(btn => {
    const onclickStr = btn.getAttribute('onclick') || '';
    const match = onclickStr.match(/toggleColumnFilter\(event,\s*(\d+)\)/);
    if (match) {
      const colIdx = parseInt(match[1]);
      const hasFilter = filters[colIdx] && filters[colIdx].size < getColumnUniqueValues(colIdx).length;
      btn.classList.toggle('active', !!hasFilter);
    }
  });
}

function updateFilterSummary() {
  const filters = state.columnFilters;
  const headers = state.outputHeaders || [];
  const summaryEl = document.getElementById('filter-summary');
  if (!summaryEl) return;

  const entries = Object.entries(filters);
  if (entries.length === 0) {
    summaryEl.innerHTML = '';
    return;
  }

  let html = '<span style="color:var(--text2);">🔍 筛选:</span>';
  for (const [colIdxStr, allowedSet] of entries) {
    const ci = parseInt(colIdxStr);
    const colName = headers[ci] || `列${ci+1}`;
    const total = getColumnUniqueValues(ci).length;
    const selected = allowedSet.size;
    html += `<span class="filter-tag">${escapeHTML(colName)}: ${selected}/${total}<button onclick="resetColumnFilter(${ci})">✕</button></span>`;
  }
  html += `<button class="clear-all-btn" onclick="clearAllColumnFilters()">清除全部</button>`;
  summaryEl.innerHTML = html;
}

// ==================== Export Step ====================
function showExportStep() {
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
  const unmatchedSet = new Set(state.unmatchedRows || []);
  const noteColIdx = headers.findIndex(h => /备注|note|说明|remark/i.test(String(h || '')));
  const hasNoteColumn = noteColIdx >= 0;
  const selectedNoteSet = new Set(state.selectedNoteRows || []);

  // 云杉模版：找到商社编号列索引用于高亮
  const shangSheColIdx = (state.targetTemplate === 'youyi') ? headers.indexOf('商社编号') : -1;

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

  const previewLimit = Math.max(DEFAULT_PREVIEW_ROW_LIMIT, Number(state.previewRowLimit) || DEFAULT_PREVIEW_ROW_LIMIT);
  const pv = Math.min(rows.length, previewLimit);
  let headHTML = headers.map((h, ci) => {
    const hasFilter = state.columnFilters[ci] && state.columnFilters[ci].size < getColumnUniqueValues(ci).length;
    return `<th><span>${escapeHTML(h)}</span><button class="col-filter-btn${hasFilter ? ' active' : ''}" title="筛选" onclick="toggleColumnFilter(event, ${ci})">🔽</button></th>`;
  }).join('');
  if (hasNoteColumn) {
    const allVisibleSelected = visiblePreviewRowCount() > 0 && Array.from({ length: visiblePreviewRowCount() }, (_, i) => i).every(i => selectedNoteSet.has(i));
    headHTML = `<th style="width:44px;text-align:center;"><input type="checkbox" id="select-all-visible-checkbox" title="选择当前预览行" ${allVisibleSelected ? 'checked' : ''} onchange="toggleVisibleNoteRows(this.checked)"></th>` + headHTML;
  }
  let bodyHTML = '';
  for (let ri = 0; ri < pv; ri++) {
    const isUnmatched = unmatchedSet.has(ri);
    const rowClass = isUnmatched ? ' class="unmatched-row"' : '';
    let rowHTML = '';
    if (hasNoteColumn) {
      rowHTML += `<td style="text-align:center;"><input type="checkbox" data-row-idx="${ri}" ${selectedNoteSet.has(ri) ? 'checked' : ''} onchange="toggleNoteRow(${ri}, this.checked)"></td>`;
    }
    rowHTML += rows[ri].map((c, ci) => {
      let cellContent = c ? escapeHTML(c) : '<span style="color:var(--text2);opacity:0.4;">—</span>';

      // 云杉模版：平台列显示下拉框
      if (isYouyi && ci === state.colIndex.platform) {
        const currentVal = c || '';
        let optionsHTML = '<option value="">未选择</option>';
        for (const p of allPlatforms) {
          optionsHTML += `<option value="${escapeHTML(p)}" ${p === currentVal ? 'selected' : ''}>${escapeHTML(p)}</option>`;
        }
        cellContent = `<select data-row-idx="${ri}" data-col-idx="${ci}" onchange="onPlatformChange(this, ${ri})">${optionsHTML}</select>`;
      }
      // 云杉模版：任务清单列显示下拉框
      else if (isYouyi && ci === state.colIndex.taskList) {
        const currentVal = c || '';
        const shangSheId = rows[ri][state.colIndex.shangSheId] || '';
        const matchedTasks = getTasksForShangShe(shangSheId);
        let optionsHTML = '<option value="">未选择</option>';
        for (const task of matchedTasks) {
          optionsHTML += `<option value="${escapeHTML(task.fullString)}" ${task.fullString === currentVal ? 'selected' : ''}>${escapeHTML(task.fullString)}</option>`;
        }
        cellContent = `<select data-row-idx="${ri}" data-col-idx="${ci}" onchange="onTaskChange(this, ${ri})">${optionsHTML}</select>`;
      }
      // 云杉模版：税源地列显示下拉框，允许手动覆盖平台预匹配结果
      else if (isYouyi && ci === state.colIndex.taxSource) {
        const currentVal = c || '';
        let optionsHTML = '<option value="">未选择</option>';
        for (const taxSource of allTaxSources) {
          optionsHTML += `<option value="${escapeHTML(taxSource)}" ${taxSource === currentVal ? 'selected' : ''}>${escapeHTML(taxSource)}</option>`;
        }
        cellContent = `<select data-row-idx="${ri}" data-col-idx="${ci}" onchange="onTaxSourceChange(this, ${ri})">${optionsHTML}</select>`;
      }
      // 未匹配行的商社编号列添加"未匹配"标记
      else if (isUnmatched && ci === shangSheColIdx && c) {
        cellContent = escapeHTML(c) + '<span class="unmatched-badge">未匹配</span>';
      }
      // 备注列：允许单行直接编辑
      else if (ci === noteColIdx) {
        cellContent = `<input class="note-input" data-row-idx="${ri}" data-col-idx="${ci}" value="${escapeHTML(c || '')}" placeholder="填写备注" oninput="onNoteChange(this, ${ri})">`;
      }
      return `<td>${cellContent}</td>`;
    }).join('');
    bodyHTML += `<tr data-row-idx="${ri}"${rowClass}>${rowHTML}</tr>`;
  }
  const hiddenRowCount = rows.length - pv;
  if (rows.length > DEFAULT_PREVIEW_ROW_LIMIT) {
    const previewControls = `
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;">
        <span style="color:var(--text2);font-size:12px;">已预览 ${pv} / ${rows.length} 行${hiddenRowCount > 0 ? `，还有 ${hiddenRowCount} 行` : ''}</span>
        ${hiddenRowCount > 0 ? `<button class="btn btn-secondary btn-sm" onclick="showMorePreviewRows()">预览更多</button>` : ''}
        ${hiddenRowCount > 0 ? `<button class="btn btn-secondary btn-sm" onclick="showAllPreviewRows()">全部展开</button>` : ''}
        ${pv > DEFAULT_PREVIEW_ROW_LIMIT ? `<button class="btn btn-secondary btn-sm" onclick="collapsePreviewRows()">收起预览</button>` : ''}
      </div>`;
    bodyHTML += `<tr><td colspan="${headers.length + (hasNoteColumn ? 1 : 0)}" style="text-align:center;padding:12px;">${previewControls}</td></tr>`;
  }

  // 云杉模版：显示知识库匹配统计
  let kbMatchHTML = '';
  if (isYouyi && unmatchedSet.size > 0) {
    kbMatchHTML = `<div class="status-msg info">⚠️ 知识库匹配：${rows.length - unmatchedSet.size}/${rows.length} 行已匹配，${unmatchedSet.size} 行商社编号未在知识库中找到（橙色高亮行）</div>`;
  } else if (isYouyi && rows.length > 0) {
    kbMatchHTML = `<div class="status-msg success">✅ 知识库匹配：全部 ${rows.length} 行已成功匹配</div>`;
  }

  // ===== 拆分导出（一源一单）：模式选择 + 每份批次号 =====
  const splitCounts = getSplitGroupCounts();
  const splitActive = isSplitExportActive();
  const showSplitModePanel = rows.length > 0 && (splitCounts.byFile > 1 || splitCounts.bySheet > 1);
  let splitModeHTML = '';
  if (showSplitModePanel) {
    const mode = state.exportMode || 'merge';
    const radio = (value, label, count) => {
      const disabled = value !== 'merge' && count <= 1;
      return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:${disabled?'not-allowed':'pointer'};${disabled?'opacity:0.45;':''}">
        <input type="radio" name="export-mode" value="${value}" ${mode===value?'checked':''} ${disabled?'disabled':''} onchange="onExportModeChange('${value}')" style="accent-color:var(--accent);">
        ${label}${value!=='merge'&&count>1?`（${count} 份）`:''}
      </label>`;
    };
    const activeGroups = splitActive ? getSplitGroups().length : 0;
    splitModeHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">📦 导出模式</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;">
        ${radio('merge', '合并为一份', 0)}
        ${radio('byFile', '按文件拆分', splitCounts.byFile)}
        ${radio('bySheet', '按数据表拆分', splitCounts.bySheet)}
      </div>
      ${splitActive ? `<div style="font-size:12px;color:var(--text2);margin-top:8px;">将生成 <strong style="color:var(--accent2);">${activeGroups}</strong> 个文件（与来源一一对应），打包为 ZIP 下载；命名规则：<strong>源文件名${state.exportMode==='bySheet'?'_工作表名':''}_模板名.xlsx</strong>。</div>` : ''}
    </div>`;
  }

  let splitBatchHTML = '';
  const showSplitBatchPanel = splitActive && getSelectedTemplates().includes('shenbianyun');
  if (showSplitBatchPanel) {
    const groups = getSplitGroups();
    ensureSplitBatches(groups);
    state.splitGroupList = groups;
    splitBatchHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px;">🏷️ 每份批次号（拆分模式）</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:6px;">每份已按来源单独检测商社并生成批次号（同一商社多份时自动 -A/-B 区分），可搜索更换商社或直接修改批次号。</div>
      ${groups.map((g, gi) => {
        const b = state.splitBatches[g.key] || {};
        const status = b.shangSheName
          ? `<span style="color:var(--green);">✓ ${escapeHTML(b.shangSheName)}</span>`
          : '<span style="color:var(--orange);">未匹配到商社，可搜索选择</span>';
        return `
        <div style="display:grid;grid-template-columns:minmax(140px,1.1fr) minmax(200px,1.5fr) minmax(170px,1fr);gap:10px;align-items:center;padding:8px 0;${gi>0?'border-top:1px solid var(--border);':''}">
          <div style="min-width:0;" title="${escapeHTML(splitGroupLabel(g))}（${g.rowIdxs.length} 行）">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(splitGroupLabel(g))}</div>
            <div style="font-size:11px;color:var(--text2);">${g.rowIdxs.length} 行</div>
          </div>
          <div style="min-width:0;">
            <div style="font-size:11px;margin-bottom:3px;">${status}</div>
            ${createShangSheSearchHTML('split' + gi, '搜索商社（编号/名称/税号）...', b.shangSheName, b.shangSheId)}
          </div>
          <input data-group-key="${escapeHTML(g.key)}" value="${escapeHTML(b.batchNo || '')}" placeholder="批次号（可修改）"
            style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none;"
            oninput="onSplitBatchNoChange(this)">
        </div>`;
      }).join('')}
    </div>`;
  }

  let batchNoHTML = '';
  if (supportsBatchNo && !splitActive) {
    const candidateHint = shangSheCandidates.length > 0
      ? `<div style="font-size:12px;color:var(--orange);margin-bottom:6px;">💡 已根据客户信息缩小范围，找到 ${shangSheCandidates.length} 个候选商社（也可搜索其他商社）</div>`
      : '';
    const batchStatus = state.batchShangSheName
      ? `已匹配商社：${escapeHTML(state.batchShangSheName)}`
      : '未自动匹配到商社，可手动搜索选择';
    batchNoHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">🏷️ 商社与批次号</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;">${batchStatus}</div>
      ${candidateHint}
      <div style="display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr) auto;gap:10px;align-items:center;">
        ${createShangSheSearchHTML('batch', '输入编号、名称或税号搜索商社...', state.batchShangSheName, state.batchShangSheId)}
        <input id="batch-no-input" value="${escapeHTML(state.batchNo || '')}" placeholder="批次号"
          style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none;"
          oninput="onBatchNoChange(this)">
        <button class="btn btn-primary btn-sm" onclick="applyBatchShangSheFromSelection()">应用商社</button>
      </div>
    </div>`;
  }

  // 云杉模版：手动匹配商社选择器（仅在有未匹配行时显示）- 可搜索下拉框
  let manualShangSheHTML = '';
  if (isYouyi && unmatchedSet.size > 0) {
    // Build candidates: if we have narrowed candidates from auto-matching, show those first
    const candidateList = shangSheCandidates;
    // Also prepare full list for search
    const fullList = shangSheFullList;

    const candidateHint = candidateList.length > 0
      ? `<div style="font-size:12px;color:var(--orange);margin-bottom:6px;">💡 已根据客户信息缩小范围，找到 ${candidateList.length} 个候选商社（也可搜索其他商社）</div>`
      : '';

    // 仅当唯一候选时预填搜索框，保留可切换的入口
    const defaultCandidate = candidateList.length === 1 ? candidateList[0] : null;

    manualShangSheHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">🔗 手动匹配商社</div>
      ${candidateHint}
      <div style="position:relative;">
        <div style="display:flex;gap:10px;align-items:center;">
          <div style="flex:1;">
            ${createShangSheSearchHTML('manual', '输入编号、名称或税号搜索...', defaultCandidate?.label || '', defaultCandidate?.id || '')}
          </div>
          <button class="btn btn-primary btn-sm" onclick="applyManualShangShe()">应用</button>
        </div>
      </div>
    </div>`;
  }

  // 云杉模版：批量设置平台控件 - 可搜索下拉框
  let batchControlsHTML = '';
  if (isYouyi && rows.length > 0) {
    batchControlsHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:relative;">
      <span style="font-size:13px;font-weight:600;color:var(--text2);">批量设置平台:</span>
      <div style="position:relative;min-width:200px;">
        <input type="text" id="platform-search" placeholder="搜索平台..."
          style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);font-size:13px;outline:none;"
          oninput="filterPlatformList()" onfocus="showPlatformDropdown()" autocomplete="off">
        <input type="hidden" id="platform-selected-val" value="">
        <div id="platform-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;margin-top:2px;max-height:200px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:6px;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,0.3);"></div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="applyPlatformToAll()">应用到所有行</button>
    </div>`;
  }

  // 身边云导出选项
  let sbyOptionsHTML = '';
  if (state.targetTemplate === 'shenbianyun' || getSelectedTemplates().includes('shenbianyun')) {
    sbyOptionsHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">☁️ 身边云导出选项</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:8px;">
        <input type="checkbox" id="sby-show-batch-info" onchange="onSbyOptionChange()" ${state.sbyShowBatchInfo?'checked':''} style="accent-color:var(--accent);">
        填写总笔数和总金额（不勾选则留空）
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
        <input type="checkbox" id="sby-plain-amount" onchange="onSbyOptionChange()" ${state.sbyPlainAmount?'checked':''} style="accent-color:var(--accent);">
        金额使用纯数字格式（不带 ¥ 符号）
      </label>
    </div>`;
  }

  let noteControlsHTML = '';
  if (hasNoteColumn && rows.length > 0) {
    noteControlsHTML = `
    <div class="note-toolbar">
      <span style="font-size:13px;font-weight:600;color:var(--text2);">批量备注:</span>
      <button class="btn btn-secondary btn-sm" onclick="selectVisibleNoteRows()">选择当前预览</button>
      <button class="btn btn-secondary btn-sm" onclick="selectAllNoteRows()">全选全部记录</button>
      <button class="btn btn-secondary btn-sm" onclick="clearNoteRowSelection()">清除选择</button>
      <span style="font-size:12px;color:var(--text2);">已选 <strong id="selected-note-count" style="color:var(--accent2);">${selectedNoteSet.size}</strong> 行</span>
      <select id="note-preset" onchange="onNotePresetChange()">
        <option value="filename">文件名</option>
        <option value="date">日期</option>
        <option value="shangshe">商社简称</option>
        <option value="custom">自定义</option>
      </select>
      <input id="note-custom-text" class="hidden" placeholder="输入自定义备注">
      <select id="note-write-mode" title="写入方式">
        <option value="replace">覆盖备注</option>
        <option value="append">追加备注</option>
      </select>
      <button class="btn btn-primary btn-sm" onclick="applyBatchRemark()">应用备注</button>
      <button class="btn btn-red btn-sm" onclick="clearSelectedRemarks()">清空备注</button>
    </div>`;
  }

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
    ${splitModeHTML}
    ${kbMatchHTML}
    ${splitBatchHTML}
    ${batchNoHTML}
    ${sbyOptionsHTML}
    ${manualShangSheHTML}
    ${state.cleanCount > 0 ? `<div class="status-msg info">🧹 数据预处理：自动清除了 <strong>${state.cleanCount}</strong> 个字段中的多余空格（姓名、身份证、手机号、银行卡号等）</div>` : ''}
    ${batchControlsHTML}
    ${noteControlsHTML}
    <div id="filter-summary" class="filter-summary"></div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:16px;">
      <table class="result-table"><thead><tr>${headHTML}</tr></thead><tbody>${bodyHTML}</tbody></table>
    </div>
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

// 获取某个商社编号对应的所有任务（从taskListData或KB tasks）

function getTasksForShangShe(shangSheId) {
  return kbGetTasksForShangShe(loadKB(), shangSheId);
}

// 平台切换处理（保留兼容）
function onPlatformChange(selectEl, rowIdx) {
  const newVal = selectEl.value;
  updateOutputRow(rowIdx, state.colIndex.platform, newVal);

  const taxSource = taxSourceForPlatform(newVal);
  if (taxSource) {
    updateOutputRow(rowIdx, state.colIndex.taxSource, taxSource);
  }
  showExportStep();
}

function onTaxSourceChange(selectEl, rowIdx) {
  updateOutputRow(rowIdx, state.colIndex.taxSource, selectEl.value);
}

// 任务切换处理
function onTaskChange(selectEl, rowIdx) {
  const newVal = selectEl.value;
  updateOutputRow(rowIdx, state.colIndex.taskList, newVal);

  // 根据任务名称、服务内容和源行备注推断工种
  if (newVal) {
    const parsed = parseTaskString(newVal);
    const shangSheId = parsed?.shangSheId || state.outputRows[rowIdx][state.colIndex.shangSheId] || '';
    const task = getTasksForShangShe(shangSheId).find(t => t.fullString === newVal) || parsed || newVal;
    const rowContext = state.outputRowMeta?.[rowIdx] || {};
    updateOutputRow(rowIdx, state.colIndex.workType, inferWorkType(task, rowContext.rawRow, rowContext.typeToCol));
  }
}

// 批量设置平台到所有行
function applyPlatformToAll() {
  const hidden = document.getElementById('platform-selected-val');
  const platformVal = hidden ? hidden.value : '';
  if (!platformVal) {
    alert('请先选择一个平台');
    return;
  }

  const taxSource = taxSourceForPlatform(platformVal);

  // 应用到所有行
  for (let i = 0; i < state.outputRows.length; i++) {
    updateOutputRow(i, state.colIndex.platform, platformVal);
    if (taxSource) {
      updateOutputRow(i, state.colIndex.taxSource, taxSource);
    }
  }

  // 刷新预览
  showExportStep();
}

function onBatchNoChange(inputEl) {
  state.batchNo = String(inputEl.value || '').trim();
  cacheCurrentTemplateOutput();
}

function onExportModeChange(mode) {
  state.exportMode = mode;
  if (mode !== 'merge' && getSelectedTemplates().includes('shenbianyun')) {
    ensureSplitBatches(getSplitGroups());
  }
  showExportStep();
}

function onSplitBatchNoChange(inputEl) {
  const key = inputEl.dataset.groupKey;
  if (!key || !state.splitBatches[key]) return;
  state.splitBatches[key].batchNo = String(inputEl.value || '').trim();
}

function onSbyOptionChange() {
  const showBatchEl = document.getElementById('sby-show-batch-info');
  const plainAmountEl = document.getElementById('sby-plain-amount');
  state.sbyShowBatchInfo = showBatchEl ? showBatchEl.checked : false;
  state.sbyPlainAmount = plainAmountEl ? plainAmountEl.checked : true;
  cacheCurrentTemplateOutput();
}

function applyBatchShangSheFromSelection() {
  const hidden = document.getElementById('batch-shangshe-selected-id');
  const batchInput = document.getElementById('batch-no-input');
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
  // 读取用户可能手动编辑过的批次号
  const editedBatchNo = batchInput ? String(batchInput.value || '').trim() : '';
  applyBatchShangShe(lookup, selectedId);
  // 如果用户手动编辑过批次号，以用户编辑的为准
  if (editedBatchNo && editedBatchNo !== state.batchNo) {
    state.batchNo = editedBatchNo;
  }
  cacheCurrentTemplateOutput();
  showExportStep();
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

function getNoteColIdx() {
  return (state.outputHeaders || []).findIndex(h => /备注|note|说明|remark/i.test(String(h || '')));
}

function visiblePreviewRowCount() {
  return Math.min((state.outputRows || []).length, Math.max(DEFAULT_PREVIEW_ROW_LIMIT, Number(state.previewRowLimit) || DEFAULT_PREVIEW_ROW_LIMIT));
}

function showMorePreviewRows() {
  const total = (state.outputRows || []).length;
  state.previewRowLimit = Math.min(total, visiblePreviewRowCount() + PREVIEW_ROW_INCREMENT);
  showExportStep();
}

function showAllPreviewRows() {
  state.previewRowLimit = (state.outputRows || []).length;
  showExportStep();
}

function collapsePreviewRows() {
  state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
  showExportStep();
}

function setSelectedNoteRows(rows) {
  const max = (state.outputRows || []).length;
  state.selectedNoteRows = Array.from(new Set(rows.filter(i => i >= 0 && i < max))).sort((a, b) => a - b);
}

function toggleNoteRow(rowIdx, checked) {
  const selected = new Set(state.selectedNoteRows || []);
  if (checked) selected.add(rowIdx);
  else selected.delete(rowIdx);
  setSelectedNoteRows(Array.from(selected));
  updateNoteSelectionUI();
}

function toggleVisibleNoteRows(checked) {
  const selected = new Set(state.selectedNoteRows || []);
  for (let i = 0; i < visiblePreviewRowCount(); i++) {
    if (checked) selected.add(i);
    else selected.delete(i);
  }
  setSelectedNoteRows(Array.from(selected));
  updateNoteSelectionUI();
}

function selectVisibleNoteRows() {
  const selected = new Set(state.selectedNoteRows || []);
  for (let i = 0; i < visiblePreviewRowCount(); i++) selected.add(i);
  setSelectedNoteRows(Array.from(selected));
  updateNoteSelectionUI();
}

function selectAllNoteRows() {
  setSelectedNoteRows((state.outputRows || []).map((_, i) => i));
  updateNoteSelectionUI();
}

function clearNoteRowSelection() {
  state.selectedNoteRows = [];
  updateNoteSelectionUI();
}

// 局部更新备注行选择的 UI（复选框状态和计数），不触发全量重渲染
function updateNoteSelectionUI() {
  const container = document.getElementById('export-content');
  if (!container) return;
  const selectedSet = new Set(state.selectedNoteRows || []);
  const pv = visiblePreviewRowCount();

  // 更新每行复选框的 checked 状态
  const checkboxes = container.querySelectorAll('input[type="checkbox"][data-row-idx]');
  checkboxes.forEach(cb => {
    const ri = parseInt(cb.dataset.rowIdx, 10);
    if (!isNaN(ri)) cb.checked = selectedSet.has(ri);
  });

  // 更新表头全选复选框
  const headerCb = document.getElementById('select-all-visible-checkbox');
  if (headerCb) {
    const allVisibleSelected = pv > 0 && Array.from({ length: pv }, (_, i) => i).every(i => selectedSet.has(i));
    headerCb.checked = allVisibleSelected;
  }

  // 更新已选行数
  const countEl = document.getElementById('selected-note-count');
  if (countEl) countEl.textContent = selectedSet.size;
}

function onNoteChange(inputEl, rowIdx) {
  const noteIdx = getNoteColIdx();
  if (noteIdx < 0 || !state.outputRows?.[rowIdx]) return;
  updateOutputRow(rowIdx, noteIdx, inputEl.value);
}

function onNotePresetChange() {
  const preset = document.getElementById('note-preset')?.value || '';
  const custom = document.getElementById('note-custom-text');
  if (custom) custom.classList.toggle('hidden', preset !== 'custom');
}


function getRemarkPresetValue(rowIdx, preset) {
  return kbGetRemarkPresetValue(loadKB(), preset, {
    row: state.outputRows?.[rowIdx] || [],
    metaFileName: (state.outputRowMeta?.[rowIdx] || {}).fileName,
    selectedFileNames: state.sources.filter(s => s.selected).map(s => s.fileName),
    outputHeaders: state.outputHeaders || [],
    customText: document.getElementById('note-custom-text')?.value.trim() || '',
  });
}

function applyBatchRemark() {
  const noteIdx = getNoteColIdx();
  if (noteIdx < 0) {
    alert('当前模版没有备注列');
    return;
  }
  const selected = state.selectedNoteRows || [];
  if (!selected.length) {
    alert('请先选择要添加备注的记录，或点击“全选全部记录”');
    return;
  }
  const preset = document.getElementById('note-preset')?.value || 'filename';
  const mode = document.getElementById('note-write-mode')?.value || 'replace';
  if (preset === 'custom' && !document.getElementById('note-custom-text')?.value.trim()) {
    alert('请输入自定义备注');
    return;
  }

  selected.forEach(rowIdx => {
    const row = state.outputRows[rowIdx];
    if (!row) return;
    const nextVal = getRemarkPresetValue(rowIdx, preset);
    if (!nextVal) return;
    if (mode === 'append' && row[noteIdx]) {
      updateOutputRow(rowIdx, noteIdx, `${row[noteIdx]} ${nextVal}`.trim());
    } else {
      updateOutputRow(rowIdx, noteIdx, nextVal);
    }
  });

  showExportStep();
}

function clearSelectedRemarks() {
  const noteIdx = getNoteColIdx();
  if (noteIdx < 0) {
    alert('当前模版没有备注列');
    return;
  }
  const selected = state.selectedNoteRows || [];
  if (!selected.length) {
    alert('请先选择要清空备注的记录，或点击“全选全部记录”');
    return;
  }

  selected.forEach(rowIdx => {
    const row = state.outputRows?.[rowIdx];
    if (row) updateOutputRow(rowIdx, noteIdx, '');
  });

  showExportStep();
}

// ==================== Searchable Combobox Functions ====================

// 通用商社搜索下拉组件生成函数，根据 prefix 生成唯一 DOM ID
function createShangSheSearchHTML(prefix, placeholder, inputValue, hiddenValue) {
  return `
    <div style="position:relative;">
      <input type="text" id="${prefix}-shangshe-search" placeholder="${placeholder}"
        style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none;"
        oninput="filterShangSheList('${prefix}')" onfocus="showShangSheDropdown('${prefix}')" autocomplete="off"
        value="${escapeHTML(inputValue || '')}">
      <input type="hidden" id="${prefix}-shangshe-selected-id" value="${escapeHTML(hiddenValue || '')}">
      <div id="${prefix}-shangshe-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;margin-top:2px;max-height:240px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:6px;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,0.3);"></div>
    </div>`;
}

// 商社搜索下拉框
function showShangSheDropdown(prefix) {
  filterShangSheList(prefix);
}

function filterShangSheList(prefix) {
  const input = document.getElementById(prefix + '-shangshe-search');
  const dropdown = document.getElementById(prefix + '-shangshe-dropdown');
  if (!input || !dropdown) return;

  const query = normalizeSearchText(input.value);
  // Always search the full knowledge base for comprehensive filtering
  const fullList = state.shangSheFullList || [];

  // Build candidate set for highlighting
  const candidateIds = new Set();
  if (state.shangSheCandidates && state.shangSheCandidates.length > 0) {
    state.shangSheCandidates.forEach(c => candidateIds.add(c.id));
  }

  let filtered = fullList;
  if (query) {
    filtered = fullList.filter(item => (item.searchText || normalizeSearchText([
      item.id,
      item.label,
      item.taxId,
      item.fullName,
      item.shortName
    ].join(' '))).includes(query));
  }

  filtered = filtered.slice(0, 50);

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text2);font-size:12px;">无匹配结果</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.style.display = 'block';
  dropdown.innerHTML = filtered.map(item => {
    const isCandidate = candidateIds.has(item.id);
    const candStyle = isCandidate ? 'background:rgba(253,203,110,0.08);' : '';
    const candBadge = isCandidate ? '<span style="color:var(--orange);font-size:10px;margin-left:4px;">候选</span>' : '';
    return `<div class="ss-dropdown-item" data-ss-id="${escapeHTML(item.id)}" data-ss-label="${escapeHTML(item.label || item.id)}" data-ss-prefix="${prefix}" onclick="selectShangSheFromItem(this)" style="${candStyle}">
      <span class="ss-id">${escapeHTML(item.id)}${candBadge}</span>
      <span class="ss-name">${escapeHTML(item.shortName || item.label || '')}</span>
      ${item.taxId ? `<span class="ss-taxid">税号: ${escapeHTML(item.taxId)}</span>` : ''}
    </div>`;
  }).join('');
}

function selectShangSheFromItem(itemEl) {
  const prefix = itemEl.dataset.ssPrefix || 'batch';
  selectShangShe(itemEl.dataset.ssId || '', itemEl.dataset.ssLabel || '', prefix);
}

function selectShangShe(id, label, prefix) {
  const input = document.getElementById(prefix + '-shangshe-search');
  const hidden = document.getElementById(prefix + '-shangshe-selected-id');
  const dropdown = document.getElementById(prefix + '-shangshe-dropdown');
  const batchInput = document.getElementById('batch-no-input');
  if (input) input.value = label;
  if (hidden) hidden.value = id;
  if (dropdown) dropdown.style.display = 'none';
  // 拆分模式：为对应分组更换商社并重新生成该份批次号
  if (prefix.startsWith('split') && id) {
    const gi = Number(prefix.slice(5));
    const g = (state.splitGroupList || [])[gi];
    if (g) {
      const lookup = lookupShangShe(id);
      const existing = new Set((state.splitGroupList || [])
        .filter(x => x.key !== g.key)
        .map(x => state.splitBatches[x.key]?.batchNo).filter(Boolean));
      state.splitBatches[g.key] = {
        batchNo: dedupeBatchNo(buildBatchNoFromShangShe(lookup), existing),
        shangSheId: id,
        shangSheName: lookup?.shortName || lookup?.fullName || ''
      };
      showExportStep();
    }
    return;
  }
  // 选择商社后立即预览批次号（仅 batch 前缀时）
  if (prefix === 'batch' && id && batchInput) {
    const lookup = lookupShangShe(id);
    if (lookup) {
      const previewBatchNo = buildBatchNoFromShangShe(lookup);
      batchInput.value = previewBatchNo;
    }
  }
}

// 平台搜索下拉框
function filterPlatformList() {
  const input = document.getElementById('platform-search');
  const dropdown = document.getElementById('platform-dropdown');
  if (!input || !dropdown) return;

  const query = normalizeSearchText(input.value);
  const list = state.platformFullList || [];

  let filtered = list;
  if (query) {
    filtered = list.filter(item => (item.searchText || normalizeSearchText(item.label)).includes(query));
  }

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text2);font-size:12px;">无匹配结果</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.style.display = 'block';
  dropdown.innerHTML = filtered.map(item => {
    return `<div class="ss-dropdown-item" data-platform-value="${escapeHTML(item.value)}" onclick="selectPlatformFromItem(this)">
      <span class="ss-name">${escapeHTML(item.label)}</span>
    </div>`;
  }).join('');
}

function selectPlatformFromItem(itemEl) {
  selectPlatform(itemEl.dataset.platformValue || '');
}

function showPlatformDropdown() {
  filterPlatformList();
}

function selectPlatform(value) {
  const input = document.getElementById('platform-search');
  const hidden = document.getElementById('platform-selected-val');
  const dropdown = document.getElementById('platform-dropdown');
  if (input) input.value = value;
  if (hidden) hidden.value = value;
  if (dropdown) dropdown.style.display = 'none';
}

// 点击外部关闭下拉框
document.addEventListener('click', function(e) {
  // 关闭商社下拉框（两个前缀实例）
  ['batch', 'manual'].forEach(function(prefix) {
    const ssDropdown = document.getElementById(prefix + '-shangshe-dropdown');
    const ssInput = document.getElementById(prefix + '-shangshe-search');
    if (ssDropdown && ssInput && !ssInput.contains(e.target) && !ssDropdown.contains(e.target)) {
      ssDropdown.style.display = 'none';
    }
  });
  // 关闭平台下拉框
  const pDropdown = document.getElementById('platform-dropdown');
  const pInput = document.getElementById('platform-search');
  if (pDropdown && pInput && !pInput.contains(e.target) && !pDropdown.contains(e.target)) {
    pDropdown.style.display = 'none';
  }
});

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

/**
 * Save workbook using File System Access API (lets user pick directory),
 * falls back to auto-download for unsupported browsers.
 */
async function saveWorkbook(wb, defaultName) {
  // ExcelJS buffer 结果（身边云模版）
  if (wb && wb.__exceljsBuffer) {
    const data = wb.__exceljsBuffer;
    if (window.showSaveFilePicker) {
      try {
        const opts = {
          suggestedName: defaultName,
          types: [{ description: 'Excel 文件', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
        };
        if (state.lastSaveDir) opts.startIn = state.lastSaveDir;
        const handle = await window.showSaveFilePicker(opts);
        state.lastSaveDir = handle;
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
        console.warn('showSaveFilePicker failed, falling back:', e);
      }
    }
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  }
  if (window.showSaveFilePicker) {
    try {
      const opts = {
        suggestedName: defaultName,
        types: [{ description: 'Excel 文件', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
      };
      if (state.lastSaveDir) opts.startIn = state.lastSaveDir;
      const handle = await window.showSaveFilePicker(opts);
      // 记住本次保存的目录
      state.lastSaveDir = handle;
      const writable = await handle.createWritable();
      const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      await writable.write(data);
      await writable.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false; // user cancelled
      console.warn('showSaveFilePicker failed, falling back:', e);
    }
  }
  // Fallback: auto-download
  XLSX.writeFile(wb, defaultName);
  return true;
}

/**
 * Save CSV using File System Access API, falls back to auto-download.
 */
async function saveCSV(csvContent, defaultName) {
  if (window.showSaveFilePicker) {
    try {
      const opts = {
        suggestedName: defaultName,
        types: [{ description: 'CSV 文件', accept: { 'text/csv': ['.csv'] } }],
      };
      if (state.lastSaveDir) opts.startIn = state.lastSaveDir;
      const handle = await window.showSaveFilePicker(opts);
      state.lastSaveDir = handle;
      const writable = await handle.createWritable();
      await writable.write(csvContent);
      await writable.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      console.warn('showSaveFilePicker failed, falling back:', e);
    }
  }
  // Fallback
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  return true;
}

async function saveBlobAsFile(blob, defaultName, description, accept) {
  if (window.showSaveFilePicker) {
    try {
      const opts = {
        suggestedName: defaultName,
        types: [{ description, accept }],
      };
      if (state.lastSaveDir) opts.startIn = state.lastSaveDir;
      const handle = await window.showSaveFilePicker(opts);
      state.lastSaveDir = handle;
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      console.warn('showSaveFilePicker failed, falling back:', e);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}








// ==================== Split Export (一源一单) ====================

function getSplitGroups() { return getSplitGroupsFromMeta(state.outputRowMeta); }

function getSplitGroupCounts() {
  const files = new Set(), sheets = new Set();
  (state.outputRowMeta || []).forEach(m => {
    const fn = m.fileName || '未命名文件';
    files.add(fn);
    sheets.add(`${fn}||${m.sheetName || ''}`);
  });
  return { byFile: files.size, bySheet: sheets.size };
}


// 当前是否处于有效的拆分导出模式（分组数 > 1 才有拆分意义）
function isSplitExportActive() {
  if ((state.exportMode || 'merge') === 'merge') return false;
  const counts = getSplitGroupCounts();
  return (state.exportMode === 'byFile' ? counts.byFile : counts.bySheet) > 1;
}

// 文件名片段清洗：去 Windows 非法字符、压缩空白、限长




// 每份单独跑商社检测（按分组过滤数据源），生成各自批次号
function ensureSplitBatches(groups, force = false) {
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
function resetAll() {
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
// ES module 作用域不是全局作用域；HTML 内联 onclick/onchange 处理器经 window 解析，
// 故将全部被内联处理器引用的函数显式挂到 window。
window.__legacy = { state, TEMPLATES };
Object.assign(window, {
  addCF, applyBatchRemark, applyBatchShangSheFromSelection, applyColumnFilter,
  applyManualShangShe, applyPlatformToAll, clearAllColumnFilters, clearKB,
  clearNoteRowSelection, clearSelectedRemarks, collapsePreviewRows, confirmMapping,
  confirmTemplate, downloadKBSample, exportCSV, exportExcel, exportKBToExcel,
  exportSelectedExcel, filterFilterList, filterPlatformList, filterShangSheList,
  genCustom, goBack, handleFileInput, handleKBConfigUpload, handleKBImport, showPlatformDropdown,
  showShangSheDropdown,
  handleKBUpload, onBatchNoChange, onExportModeChange, onMapChange, onNoteChange,
  onNotePresetChange, onPlatformChange, onSbyOptionChange, onSplitBatchNoChange,
  onTaskChange, onTaxSourceChange, resetAll, resetColumnFilter, rmCF,
  selectAllNoteRows, selectPlatformFromItem, selectShangSheFromItem, selectTemplate,
  selectVisibleNoteRows, showAllPreviewRows, showMorePreviewRows, switchPreviewTemplate,
  toggleColumnFilter, toggleFilterSelectAll, toggleFilterValue, toggleNoteRow,
  toggleVisibleNoteRows,
});

// ==================== 测试面桥接（阶段 4 删除，届时 harness 直连 core 模块） ====================
// 供 tests/tools 基线驱动器在 Node 中调用；仅暴露纯管道函数，不新增任何行为。
Object.assign(window, {
  analyzeWorkbookSheets, smartDetectTable, detectColumnMapping, parseCSV, isGarbled,
  buildSourceItem, generateOutput, buildWorkbookForTemplate, buildSplitFilesForTemplates,
  mergeKnowledgeRows, importKBFromWorkbook, saveKB, loadKB, invalidateKBCache,
  rowsToCSV, getSplitGroups, ensureSplitBatches, handleFiles, getExportFileNameForTemplate,
  dedupeBatchNo, buildBatchNoFromShangShe, generateConfigSheet, generateTaskListSheet,
});
