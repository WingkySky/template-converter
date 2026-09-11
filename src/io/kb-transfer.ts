// io 层：知识库 Excel/JSON 导入导出、样例下载、上传事件处理。
// （阶段 3 时 kb-panel UI 模块负责按钮接线，本文件只做数据搬运。）
import * as XLSX from 'xlsx';
import type { KB } from '../core/kb/model';
import type { Rows } from '../types';
import {
  mergeKnowledgeRows, mergeConfigSheetRows, mergeTaskListEntries, mergeTaskListSheetRows,
  mergeConfigData, parseSignEntitySheetRows, parsePlatformTaxSourceSheetRows,
  knowledgeRowsFromKB, type MergeConfigResult,
} from '../core/kb/model';
import {
  generateConfigSheet, generateTaskListSheet, generateSignEntitySheet, generatePlatformTaxSourceSheet,
} from '../core/kb/task';
import { loadKB, saveKB } from './kb-storage';

// 导出知识库为Excel备份文件（用户看到中文列名，内部仍保存JSON结构）
export function exportKBToExcel(): void {
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

  // 映射数据单独成 sheet 导出：否则备份无法回读签约主体/平台税源地映射
  const signWs = XLSX.utils.aoa_to_sheet(generateSignEntitySheet(kb));
  signWs['!cols'] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, signWs, '签约主体映射');

  const platWs = XLSX.utils.aoa_to_sheet(generatePlatformTaxSourceSheet(kb));
  platWs['!cols'] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, platWs, '平台税源地映射');

  const d = new Date();
  XLSX.writeFile(wb, `知识库备份_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.xlsx`);
}

// 从JSON字符串导入知识库（合并逻辑：新数据覆盖旧数据）
export function importKBFromJSON(jsonStr: string): boolean {
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
  // 合并：新数据覆盖旧数据，旧数据保留（与 mergeKnowledgeRows 同语义）
  for (const [id, entry] of Object.entries(newKB.shangSheMap) as [string, KB['shangSheMap'][string]][]) {
    currentKB.shangSheMap[id] = entry;
  }
  // 合并配置数据（增量：列表并集、映射同名键覆盖，不删除旧值）
  if (newKB.configData) {
    mergeConfigData(currentKB, newKB.configData);
  }
  // 合并任务清单（同一商社+任务名新覆盖旧，其余保留）
  if (Array.isArray(newKB.taskListData) && newKB.taskListData.length > 0) {
    mergeTaskListEntries(newKB.taskListData, currentKB);
  }
  saveKB(currentKB);
  return true;
}

export function importKBFromWorkbook(wb: XLSX.WorkBook): { newCount: number; updateCount: number } | null {
  const kb = loadKB();
  const mainSheetName = wb.SheetNames.find(n => n.includes('知识库')) || wb.SheetNames[0];
  if (!mainSheetName) {
    alert('Excel文件中未找到知识库工作表');
    return null;
  }

  const mainRows = XLSX.utils.sheet_to_json(wb.Sheets[mainSheetName], { header: 1, raw: false }) as Rows;
  if (mainRows.length < 2) {
    alert('知识库文件数据不足（至少需要表头+1行数据）');
    return null;
  }

  const result = mergeKnowledgeRows(mainRows, kb);

  // 配置表：增量合并（列表并集 + 可选扩展列映射，旧数据保留）
  const configSheetName = wb.SheetNames.find(n => n.includes('配置表'));
  if (configSheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[configSheetName], { header: 1, raw: false }) as Rows;
    mergeConfigSheetRows(rows, kb);
  }

  // 独立映射 sheet（新备份导出会包含；旧备份没有则保留现有映射）
  const signEntitySheetName = wb.SheetNames.find(n => n.includes('签约主体映射'));
  if (signEntitySheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[signEntitySheetName], { header: 1, raw: false }) as Rows;
    const mapping = parseSignEntitySheetRows(rows);
    if (Object.keys(mapping).length > 0) mergeConfigData(kb, { signEntityMapping: mapping });
  }

  const platTaxSourceSheetName = wb.SheetNames.find(n => n.includes('平台税源地映射'));
  if (platTaxSourceSheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[platTaxSourceSheetName], { header: 1, raw: false }) as Rows;
    const mapping = parsePlatformTaxSourceSheetRows(rows);
    if (Object.keys(mapping).length > 0) mergeConfigData(kb, { platformTaxSourceMapping: mapping });
  }

  // 任务清单：增量合并
  const taskSheetName = wb.SheetNames.find(n => n.includes('任务清单'));
  if (taskSheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[taskSheetName], { header: 1, raw: false }) as Rows;
    mergeTaskListSheetRows(rows, kb);
  }

  saveKB(kb);
  return result;
}

// 下载知识库样例文件
export function downloadKBSample(): void {
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
export function handleKBUpload(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = e.target?.result;
      const wb = XLSX.read(data, { type: 'array' });
      // 读取第一个sheet
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as Rows;

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
      alert('解析知识库文件失败：' + (err as Error).message);
    }
  };
  reader.readAsArrayBuffer(file);
  // 重置input以便再次选择同一文件
  target.value = '';
}

// 处理知识库备份导入（优先Excel，兼容旧JSON备份）
export function handleKBImport(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let result = null;
      if (ext === 'json') {
        result = importKBFromJSON(e.target?.result as string) ? { newCount: 0, updateCount: 0 } : null;
      } else {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        result = importKBFromWorkbook(wb);
      }
      if (result) {
        const kb = loadKB();
        const count = Object.keys(kb.shangSheMap).length;
        alert(`知识库导入成功！\n新增 ${result.newCount} 个商社，更新 ${result.updateCount} 条记录\n当前共 ${count} 个商社`);
      }
    } catch (err) {
      console.error('导入知识库备份失败:', err);
      alert('导入知识库备份失败：' + (err as Error).message);
    }
  };
  if (ext === 'json') {
    reader.readAsText(file, 'utf-8');
  } else {
    reader.readAsArrayBuffer(file);
  }
  target.value = '';
}

// 处理配置数据上传（增量合并：新数据增改，已有配置不会被删除）
export function handleKBConfigUpload(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = e.target?.result;
      const wb = XLSX.read(data, { type: 'array' });
      const kb = loadKB();
      let shangSheCrossRef = 0;
      let foundConfig = false, foundTask = false;
      let configResult: MergeConfigResult = { newTaxSources: 0, newPlatforms: 0, newSignEntityKeys: 0, newPlatformTaxSourceKeys: 0 };
      let taskResult = { newCount: 0, updateCount: 0 };

      // 1. 「配置表」sheet：税源地/平台列表并集 + 可选扩展列映射合并
      const configSheetName = wb.SheetNames.find(n => n.includes('配置表'));
      if (configSheetName) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[configSheetName], { header: 1, raw: false }) as Rows;
        if (rows.length >= 2) {
          configResult = mergeConfigSheetRows(rows, kb);
          foundConfig = true;
        }
      }

      // 1.5 独立「签约主体映射」/「平台税源地映射」sheet（键值合并）
      const signEntitySheetName = wb.SheetNames.find(n => n.includes('签约主体映射'));
      if (signEntitySheetName) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[signEntitySheetName], { header: 1, raw: false }) as Rows;
        const mapping = parseSignEntitySheetRows(rows);
        if (Object.keys(mapping).length > 0) {
          const r = mergeConfigData(kb, { signEntityMapping: mapping });
          configResult.newSignEntityKeys += r.newSignEntityKeys;
          foundConfig = true;
        }
      }

      const platTaxSourceSheetName = wb.SheetNames.find(n => n.includes('平台税源地映射'));
      if (platTaxSourceSheetName) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[platTaxSourceSheetName], { header: 1, raw: false }) as Rows;
        const mapping = parsePlatformTaxSourceSheetRows(rows);
        if (Object.keys(mapping).length > 0) {
          const r = mergeConfigData(kb, { platformTaxSourceMapping: mapping });
          configResult.newPlatformTaxSourceKeys += r.newPlatformTaxSourceKeys;
          foundConfig = true;
        }
      }

      // 2. 「任务清单」sheet：同一（商社编号+任务名）覆盖更新，旧任务保留
      const taskSheetName = wb.SheetNames.find(n => n.includes('任务清单'));
      if (taskSheetName) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[taskSheetName], { header: 1, raw: false }) as Rows;
        if (rows.length >= 2) {
          taskResult = mergeTaskListSheetRows(rows, kb);
          foundTask = true;
        }
      }

      // 3. 解析"费用明细"sheet - 提取商社编号并交叉引用
      const detailSheetName = wb.SheetNames.find(n => n.includes('费用明细'));
      if (detailSheetName) {
        const ws = wb.Sheets[detailSheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as Rows;
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
            const shangSheIds = new Set<string>();
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

      let msg = '配置数据上传成功（增量合并，已有数据不会被删除）！\n';
      if (configResult.newTaxSources > 0 || configResult.newPlatforms > 0) {
        msg += `配置表：新增 ${configResult.newTaxSources} 个税源地、${configResult.newPlatforms} 个平台（当前共 ${(kb.configData.taxSources || []).length}/${(kb.configData.platforms || []).length} 项）\n`;
      }
      if (configResult.newSignEntityKeys > 0) {
        msg += `签约主体映射：新增 ${configResult.newSignEntityKeys} 条\n`;
      }
      if (configResult.newPlatformTaxSourceKeys > 0) {
        msg += `平台税源地映射：新增 ${configResult.newPlatformTaxSourceKeys} 条\n`;
      }
      if (taskResult.newCount > 0 || taskResult.updateCount > 0) {
        msg += `任务清单：新增 ${taskResult.newCount} 条，更新 ${taskResult.updateCount} 条（当前共 ${(kb.taskListData || []).length} 条）\n`;
      }
      if (shangSheCrossRef > 0) {
        msg += `费用明细交叉引用：${shangSheCrossRef} 个商社编号已在知识库中`;
      }
      if (!foundConfig && !foundTask) {
        msg += '未找到"配置表"或"任务清单"工作表';
      }
      alert(msg);
    } catch (err) {
      console.error('解析配置数据文件失败:', err);
      alert('解析配置数据文件失败：' + (err as Error).message);
    }
  };
  reader.readAsArrayBuffer(file);
  target.value = '';
}
