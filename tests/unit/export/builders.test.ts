// 构建器单测 —— buildYidaoWorkbook/buildGenericWorkbook/buildYouyiWorkbook 用 XLSX.read
// 读回逐格断言；buildShenbianyunWorkbookCore 用 ExcelJS 读回断言（说明行合并、批次行、
// 表头行样式、金额格式 '#,##0.00' vs '¥#,##0.00'）。
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  buildYidaoWorkbook, buildGenericWorkbook, buildYouyiWorkbook, buildShenbianyunWorkbookCore,
} from '../../../src/core/export/builders';
import { workbookToArray } from '../../../src/core/export/zip';
import type { KB } from '../../../src/types';

function readBack(wb: XLSX.WorkBook): XLSX.WorkBook {
  return XLSX.read(workbookToArray(wb), { type: 'array' });
}

describe('buildYidaoWorkbook', () => {
  it('单 sheet「智能模板」：表头+数据逐格一致，列宽 = min(最长字符+2, 30)', () => {
    const headers = ['姓名', '付款金额（元，必填）'];
    const rows = [['张三', '100.50'], ['李四', '200']];
    const built = buildYidaoWorkbook(headers, rows);

    const read = readBack(built);
    expect(read.SheetNames).toEqual(['智能模板']);
    const ws = read.Sheets['智能模板'];
    expect(ws['A1']?.v).toBe('姓名');
    expect(ws['B1']?.v).toBe('付款金额（元，必填）');
    expect(ws['A2']?.v).toBe('张三');
    expect(ws['B2']?.v).toBe('100.50');
    expect(ws['A3']?.v).toBe('李四');
    expect(ws['B3']?.v).toBe('200');

    // 列宽取自原始产物：'姓名' 最长 2 → 4；'付款金额（元，必填）' 10 字 → 12
    expect(built.Sheets['智能模板']['!cols']).toEqual([{ wch: 4 }, { wch: 12 }]);
  });
});

describe('buildGenericWorkbook', () => {
  it('单 sheet「数据」：表头+数据逐格一致', () => {
    const read = readBack(buildGenericWorkbook(['甲', '乙'], [['1', '2']]));
    expect(read.SheetNames).toEqual(['数据']);
    const ws = read.Sheets['数据'];
    expect(ws['A1']?.v).toBe('甲');
    expect(ws['B2']?.v).toBe('2');
  });
});

describe('buildYouyiWorkbook', () => {
  it('三 sheet（费用明细/配置表/任务清单），配置与任务清单来自注入的生成器', () => {
    const kb: KB = {
      shangSheMap: {},
      configData: { taxSources: [], platforms: [] },
      taskListData: [],
      lastUpdated: null,
    };
    const read = readBack(buildYouyiWorkbook(['姓名', '银行卡号'], [['张三', '6222...']], {
      kb,
      generateConfigSheet: () => [['税源地', '平台'], ['0001.湖南', '平台A']],
      generateTaskListSheet: () => [['任务', '内容'], ['发放', '工资表']],
    }));
    expect(read.SheetNames).toEqual(['费用明细', '配置表', '任务清单']);
    expect(read.Sheets['费用明细']['A1']?.v).toBe('姓名');
    expect(read.Sheets['配置表']['A2']?.v).toBe('0001.湖南');
    expect(read.Sheets['配置表']['B2']?.v).toBe('平台A');
    expect(read.Sheets['任务清单']['A2']?.v).toBe('发放');
    expect(read.Sheets['任务清单']['B2']?.v).toBe('工资表');
  });
});

describe('buildShenbianyunWorkbookCore', () => {
  const HEADERS = [
    '付款账号（必填）', '付款名称（必填）', '商户订单号（必填）', '付款金额（元，必填）',
    '付款金额（备用）', '收款账号（必填）', '收款名称（必填）', '收款银行（必填）',
  ];
  const ROWS = [
    ['A100', '测试付款方', 'PO001', '1,234.56', '10.00', 'B200', '张三', '工商银行'],
    ['A101', '测试付款方', 'PO002', '10', '0', 'B201', '李四', '建设银行'],
  ];

  async function loadCore(headers: string[], rows: string[][], batchNo: string, options: { showBatchInfo: boolean; plainAmount: boolean }) {
    const result = await buildShenbianyunWorkbookCore(headers, rows, batchNo, options);
    // 返回形状保持不变：{ __exceljsBuffer }
    expect(result).toHaveProperty('__exceljsBuffer');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.__exceljsBuffer as ExcelJS.Buffer);
    const ws = wb.getWorksheet('个人银行账户批量付款模板');
    expect(ws).toBeDefined();
    return ws!;
  }

  it('说明行合并 A1:H1 且含原文；批次行标签/样式始终保留；表头行绿色样式', async () => {
    const ws = await loadCore(HEADERS, ROWS, 'B20260907-01', { showBatchInfo: false, plainAmount: true });

    expect(ws.model.merges).toContain('A1:H1');
    expect(String(ws.getCell('A1').value)).toContain('单批次最大支持12000条订单。');

    expect(ws.getCell('A2').value).toBe('商户批次号（非必填）');
    expect(ws.getCell('B2').value).toBe('总笔数（非必填）');
    expect(ws.getCell('C2').value).toBe('总金额（元，非必填）');
    expect(ws.getCell('B2').font?.color?.argb).toBe('FF9C6500');
    expect((ws.getCell('B2').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFFEB9C');

    expect(ws.getCell('A4').value).toBe('付款账号（必填）');
    expect(ws.getCell('D4').value).toBe('付款金额（元，必填）');
    expect(ws.getCell('A4').font?.color?.argb).toBe('FF006100');
    expect((ws.getCell('A4').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFC6EFCE');
  });

  it('纯数字金额 + 不显示批次信息：B3/C3 留空，金额列 #,##0.00，千分位金额解析为数字', async () => {
    const ws = await loadCore(HEADERS, ROWS, 'B20260907-01', { showBatchInfo: false, plainAmount: true });

    expect(ws.getCell('A3').value).toBe('B20260907-01');
    expect(ws.getCell('B3').value).toBe('');
    expect(ws.getCell('C3').value).toBe('');

    // 数据从第 5 行开始；'1,234.56' → 1234.56（去掉千分位、保留两位）
    expect(ws.getCell('D5').value).toBe(1234.56);
    expect(ws.getCell('D6').value).toBe(10);
    expect(ws.getCell('D5').numFmt).toBe('#,##0.00');
    expect(ws.getCell('C3').numFmt).toBe('#,##0.00');
    // 非金额列保持文本格式与原值
    expect(ws.getCell('A5').numFmt).toBe('@');
    expect(ws.getCell('A5').value).toBe('A100');
    expect(ws.getCell('H6').value).toBe('建设银行');
  });

  it('显示批次信息 + 货币金额：B3=总笔数、C3=总金额，金额格式 ¥#,##0.00', async () => {
    const ws = await loadCore(HEADERS, ROWS, '', { showBatchInfo: true, plainAmount: false });

    expect(ws.getCell('A3').value).toBe('');
    expect(ws.getCell('B3').value).toBe(2);
    expect(ws.getCell('C3').value).toBe(1244.56);
    expect(ws.getCell('C3').numFmt).toBe('¥#,##0.00');
    expect(ws.getCell('D5').numFmt).toBe('¥#,##0.00');
  });

  it('showBatchInfo 但总金额为 0 时 C3 留空（沿用原 truthy 判断）', async () => {
    const ws = await loadCore(['付款金额（元，必填）'], [['0']], '', { showBatchInfo: true, plainAmount: true });
    expect(ws.getCell('B3').value).toBe(1);
    expect(ws.getCell('C3').value).toBe('');
  });
});
