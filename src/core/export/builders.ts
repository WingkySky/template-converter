// 目标模版工作簿构建器 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 C），仅补充类型注解
// 与显式 import，不改变任何行为。阶段 4 再收敛进 core/templates 注册表。
// 位置锚点：buildYidaoWorkbook legacy.js L3575，buildShenbianyunWorkbook L3590（→
// buildShenbianyunWorkbookCore，原读 state.sbyShowBatchInfo/sbyPlainAmount 改经 options 传入），
// buildYouyiWorkbook L3672（→ 依赖注入 kb 与配置/任务清单生成器，core 禁读 localStorage），
// buildGenericWorkbook L3702。
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import type { KB, Rows } from '../../types';

// 移步到岗: 1 header row + data rows
export function buildYidaoWorkbook(headers: string[], rows: Rows): XLSX.WorkBook {
  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = headers.map((h, i) => {
    let max = h.length;
    rows.forEach(r => { const l = String(r[i]||'').length; if (l > max) max = l; });
    return { wch: Math.min(max + 2, 30) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '智能模板');
  return wb;
}

/** 身边云导出选项（原读 state.sbyShowBatchInfo / state.sbyPlainAmount，搬移后经参数传入） */
export interface ShenbianyunOptions {
  showBatchInfo: boolean;
  plainAmount: boolean;
}

// 身边云: 使用 ExcelJS 保留原版模板完整样式
// Row1=instructions(merged A1:H1), Row2=batch labels, Row3=batch values, Row4=header, Row5+=data
export async function buildShenbianyunWorkbookCore(
  headers: string[],
  rows: Rows,
  batchNo = '',
  options: ShenbianyunOptions
): Promise<{ __exceljsBuffer: ExcelJS.Buffer }> {
  const amountIdx = headers.indexOf('付款金额（元，必填）');
  const totalAmount = rows.reduce((sum, row) => sum + (parseFloat(String(row[amountIdx] || '').replace(/,/g, '')) || 0), 0);

  const { showBatchInfo, plainAmount } = options;
  const amtFmt = plainAmount ? '#,##0.00' : '¥#,##0.00';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('个人银行账户批量付款模板');

  // 列宽（与原版模板一致）
  const colWidths = [20.15, 34.0, 26.08, 20.15, 20.15, 20.15, 14.39, 22.45];
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // 各列数字格式（金额列根据选项切换货币/纯数字）
  const colNumFmts = ['@', '@', '@', amtFmt, amtFmt, '@', amtFmt, amtFmt];

  // Row 1: 说明文字（合并 A1:H1）
  ws.getRow(1).height = 121;
  ws.mergeCells('A1:H1');
  const cellA1 = ws.getCell('A1');
  cellA1.value = '单批次最大支持12000条订单。\n商户订单号纯数字并且唯一，禁止重复。\n付款金额保留两位小数，四舍五入。\n备注字段最大限制20字，银行备注展示限制具体以银行为准。\n付款文件名称或备注存在以下字段会导致文件上传失败：工资、薪酬、提现、薪、补贴、分红、奖金、返现、劳务费、分润、备用金、¥、$\n银行卡号建议使用一类户，如使用二类户日限额导致交易退汇，需T+8个工作日退回';
  cellA1.font = { name: '微软雅黑', size: 12, color: { argb: 'FFFF0000' } };
  cellA1.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  cellA1.numFmt = '@';

  // Row 2: 批次标签（始终保留，A2/B2/C2 有样式，与原版一致）
  const batchLabels = ['商户批次号（非必填）', '总笔数（非必填）', '总金额（元，非必填）'];
  batchLabels.forEach((label, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = label;
    cell.font = { name: '微软雅黑', size: 12, color: { argb: 'FF9C6500' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.numFmt = '@';
  });

  // Row 3: 批次值（始终保留结构；B3/C3 根据选项决定是否填入数字）
  const cellA3 = ws.getCell('A3');
  cellA3.value = batchNo || '';
  const cellB3 = ws.getCell('B3');
  cellB3.value = showBatchInfo ? (rows.length || '') : '';
  const cellC3 = ws.getCell('C3');
  cellC3.value = (showBatchInfo && totalAmount) ? Math.round(totalAmount * 100) / 100 : '';
  cellC3.font = { name: '微软雅黑', size: 12 };
  cellC3.alignment = { horizontal: 'center', vertical: 'middle' };
  cellC3.numFmt = amtFmt;

  // Row 4: 表头（与原版一致的绿色样式）
  headers.forEach((header, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = header;
    cell.font = { name: '微软雅黑', size: 12, color: { argb: 'FF006100' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.numFmt = colNumFmts[i] || '@';
  });

  // Row 5+: 数据行
  const dataStartRow = 5;
  rows.forEach((row, rowIdx) => {
    const excelRow = rowIdx + dataStartRow;
    row.forEach((val, colIdx) => {
      const cell = ws.getCell(excelRow, colIdx + 1);
      cell.font = { name: '微软雅黑', size: 12 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.numFmt = colNumFmts[colIdx] || '@';
      if (colIdx === amountIdx && val !== '' && !isNaN(parseFloat(String(val).replace(/,/g, '')))) {
        const n = parseFloat(String(val).replace(/,/g, ''));
        cell.value = Math.round(n * 100) / 100;
      } else {
        cell.value = val;
      }
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  return { __exceljsBuffer: buffer };
}

/** buildYouyiWorkbook 的注入依赖：知识库与配置/任务清单生成器（原直调 loadKB() 与 core 生成函数） */
export interface YouyiWorkbookDeps {
  kb: KB;
  generateConfigSheet: (kb: KB) => Rows;
  generateTaskListSheet: (kb: KB) => Rows;
}

// 本公司: 从头生成费用明细 + 动态生成配置表和任务清单
export function buildYouyiWorkbook(headers: string[], rows: Rows, deps: YouyiWorkbookDeps): XLSX.WorkBook {
  const { kb, generateConfigSheet, generateTaskListSheet } = deps;
  const wb = XLSX.utils.book_new();

  // 1. 费用明细 sheet：表头 + 数据行
  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = headers.map((h, i) => {
    let max = h.length;
    rows.forEach(r => { const l = String(r[i]||'').length; if (l > max) max = l; });
    return { wch: Math.min(max + 2, 30) };
  });
  XLSX.utils.book_append_sheet(wb, ws, '费用明细');

  // 2. 配置表 sheet：从知识库动态生成
  const configData = generateConfigSheet(kb);
  const cfgWs = XLSX.utils.aoa_to_sheet(configData);
  cfgWs['!cols'] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, cfgWs, '配置表');

  // 3. 任务清单 sheet：从知识库动态生成
  const taskData = generateTaskListSheet(kb);
  const taskWs = XLSX.utils.aoa_to_sheet(taskData);
  taskWs['!cols'] = [{ wch: 40 }];
  XLSX.utils.book_append_sheet(wb, taskWs, '任务清单');

  return wb;
}

// Generic: just headers + data
export function buildGenericWorkbook(headers: string[], rows: Rows): XLSX.WorkBook {
  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = headers.map((h, i) => {
    let max = h.length;
    rows.forEach(r => { const l = String(r[i]||'').length; if (l > max) max = l; });
    return { wch: Math.min(max + 2, 30) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '数据');
  return wb;
}
