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
  // 与 shenbianyun 模版注册表一致的新版 9 列表头（2026-09 批量付款导入模板：新增任务ID列、
  // 个人银行卡号更名收款账号；任务ID 无源数据字段对应，恒留空）
  const HEADERS = [
    '商户订单号（非必填）', '任务ID（条件必填）', '收款人姓名（必填）', '身份证号（必填）',
    '收款账号（条件必填）', '付款金额（元，必填）', '手机号（必填）', '备注（非必填）', '自定义备注（非必填）',
  ];
  const ROWS = [
    ['', '', '张三', '110101199001011234', '6222021234567890123', '1,234.56', '13800138000', '测试备注1', ''],
    ['', '', '李四', '110101199002022345', '6222029876543210987', '10', '13900139000', '测试备注2', ''],
  ];

  async function loadCore(headers: string[], rows: string[][], batchNo: string, options: { plainAmount: boolean }) {
    const result = await buildShenbianyunWorkbookCore(headers, rows, batchNo, options);
    // 返回形状保持不变：{ __exceljsBuffer }
    expect(result).toHaveProperty('__exceljsBuffer');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.__exceljsBuffer as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Sheet1');
    expect(ws).toBeDefined();
    return ws!;
  }

  it('说明行合并 A1:I1 且含新版原文（任务ID/收款账号规则）；批次行仅剩商户批次号标签', async () => {
    const ws = await loadCore(HEADERS, ROWS, 'B20260907-01', { plainAmount: true });

    expect(ws.model.merges).toContain('A1:I1');
    expect(String(ws.getCell('A1').value)).toContain('单批次最大支持12000条订单。');
    expect(String(ws.getCell('A1').value)).toContain('多任务模式时任务ID必填（单次最多50个任务），单任务模式时不可填任务ID。');
    expect(String(ws.getCell('A1').value)).toContain('收款账号需要与所选收款方式对应匹配，银行卡方式对应个人银行卡号、支付宝方式对应支付宝号、微信方式对应OpenID。');

    expect(ws.getCell('A2').value).toBe('商户批次号（非必填）');
    expect(ws.getCell('B2').value).toBeNull(); // 新版模板总笔数/总金额标签已下线
    expect(ws.getCell('A2').font?.color?.argb).toBe('FF9C6500');
    expect((ws.getCell('A2').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFFEB9C');

    expect(ws.getCell('A4').value).toBe('商户订单号（非必填）');
    expect(ws.getCell('B4').value).toBe('任务ID（条件必填）');
    expect(ws.getCell('E4').value).toBe('收款账号（条件必填）');
    expect(ws.getCell('A4').font?.color?.argb).toBe('FF006100');
    expect((ws.getCell('A4').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFC6EFCE');
  });

  it('批次号写入 A3；B3/C3 不再写入任何内容；金额列 #,##0.00，千分位金额解析为数字', async () => {
    const ws = await loadCore(HEADERS, ROWS, 'B20260907-01', { plainAmount: true });

    expect(ws.getCell('A3').value).toBe('B20260907-01');
    expect(ws.getCell('B3').value).toBeNull();
    expect(ws.getCell('C3').value).toBeNull();

    // 数据从第 5 行开始；'1,234.56' → 1234.56（去掉千分位、保留两位），金额在第 6 列（F）
    expect(ws.getCell('F5').value).toBe(1234.56);
    expect(ws.getCell('F6').value).toBe(10);
    expect(ws.getCell('F5').numFmt).toBe('#,##0.00');
    // 非金额列保持文本格式与原值（新版模板仅金额列为数值格式，身份证/收款账号列不再带货币格式）
    expect(ws.getCell('E5').numFmt).toBe('@');
    expect(ws.getCell('E5').value).toBe('6222021234567890123');
    expect(ws.getCell('B5').value).toBe('');
  });

  it('货币金额：金额列格式 ¥#,##0.00；批次号为空时 A3 留空', async () => {
    const ws = await loadCore(HEADERS, ROWS, '', { plainAmount: false });

    expect(ws.getCell('A3').value).toBe('');
    expect(ws.getCell('F5').numFmt).toBe('¥#,##0.00');
    expect(ws.getCell('F5').value).toBe(1234.56);
  });
});
