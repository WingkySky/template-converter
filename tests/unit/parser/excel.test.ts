// analyzeWorkbookSheets / analyzeSheet 单测：真实 xlsx fixture（灵工商社数据）+ 内存构造工作簿。
// 注：仓库未安装 @types/node，node:fs 无法通过 tsc 解析；vitest/node 运行时本身可用，
// 故下一行对类型检查豁免。若后续补装 @types/node，可移除该 @ts-ignore。
// @ts-ignore -- node:fs 缺少类型声明（未安装 @types/node）
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { analyzeWorkbookSheets, analyzeSheet } from '../../../src/core/parser/excel';
import type { Rows } from '../../../src/types';

// 读法说明：不要用 XLSX.readFile（对中文路径有兼容问题），统一 readFileSync + type:'buffer'
const loadFixtureWb = () =>
  XLSX.read(readFileSync(new URL('../../fixtures/灵工商社数据(1).xlsx', import.meta.url)), { type: 'buffer' });

const SAMPLE_ROWS: Rows = [
  ['姓名', '身份证号码', '手机号码', '税前金额'],
  ['张三', '11010119900307421X', '13800138000', '5200.50'],
  ['李四', '11010119900307421x', '13900139000', '3800'],
  ['合计', '', '', '9000.50'],
  ['平台服务费', '', '', '1000'],
];

describe('analyzeSheet（内存构造数据）', () => {
  it('评分、双行过滤与列映射', () => {
    const r = analyzeSheet('发放明细', SAMPLE_ROWS, '', '');
    expect(r.sheetName).toBe('发放明细');
    expect(r.dataRowsCount).toBe(2);
    expect(r.filteredCount).toBe(1);
    expect(r.headerRowIndex).toBe(0);
    // headerScore 25(amount)+20(name)+10(idCard)+10(phone) = 65
    // dataScore 0(样本<3 不加分)+18(金额命中)+12(姓名命中) = 30
    // nameScore 发放/明细 +8 → 合计 103
    expect(r.score).toBe(103);
    expect(r.autoMap.cols['0'].type).toBe('name');
    expect(r.autoMap.cols['1'].type).toBe('idCard');
    expect(r.autoMap.cols['2'].type).toBe('phone');
    expect(r.autoMap.cols['3'].type).toBe('amount');
    expect(r.autoMap.amountCol).toBe(3);
    expect(r.autoMap.nameCol).toBe(0);
  });

  it('全空数据返回 -999 哨兵评分与空映射（保持 legacy 空对象形状：无 amountCol 键）', () => {
    const r = analyzeSheet('空表', [], '', '');
    expect(r).toEqual({
      sheetName: '空表', rows: [], score: -999,
      dataRowsCount: 0, headerRowIndex: 0, autoMap: { cols: {} },
    });
    expect('amountCol' in r.autoMap).toBe(false);
  });

  it('汇总类 sheet 名扣分', () => {
    const good = analyzeSheet('发放明细', SAMPLE_ROWS, '', '').score;
    const bad = analyzeSheet('任务汇总', SAMPLE_ROWS, '', '').score;
    expect(good - bad).toBe(20); // +8 vs -12
  });
});

describe('analyzeWorkbookSheets × 灵工商社数据(1).xlsx fixture', () => {
  const items = analyzeWorkbookSheets(loadFixtureWb(), '灵工商社数据(1).xlsx');

  it('只保留有数据的工作表（Sheet2/Sheet3 为空被过滤）', () => {
    expect(items).toHaveLength(1);
    expect(items[0].sheetName).toBe('Sheet1');
  });

  it('构建 SourceItem 形状：id 前缀、type、fileName、selected、行数', () => {
    const item = items[0];
    expect(item.type).toBe('excel-sheet');
    expect(item.fileName).toBe('灵工商社数据(1).xlsx');
    expect(item.id.startsWith('excel-sheet:灵工商社数据(1).xlsx:Sheet1:')).toBe(true);
    expect(item.selected).toBe(true);
    expect(item.rows.length).toBeGreaterThan(0);
  });

  it('analysis：识别商社编号/任务名称/纳税人识别号列，签约费率打分为金额列', () => {
    const a = items[0].analysis!;
    expect(a.dataRowsCount).toBeGreaterThan(300);
    expect(a.headerRowIndex).toBe(0);
    expect(a.autoMap.cols['0'].type).toBe('shangSheId'); // 商社编号
    expect(a.autoMap.cols['2'].type).toBe('');           // 商社全称：不含“名称”子串，不识别
    expect(a.autoMap.cols['5'].type).toBe('taxId');      // 纳税人识别号
    expect(a.autoMap.cols['6'].type).toBe('amount');     // 签约费率（纯数值列兜底打分）
    expect(a.autoMap.cols['8'].type).toBe('name');       // 任务名称 → 名称
    expect(a.autoMap.amountCol).toBe(6);
    expect(a.autoMap.nameCol).toBe(8);
  });

  it('空工作簿返回空数组', () => {
    const empty = XLSX.utils.book_new();
    expect(analyzeWorkbookSheets(empty, '空.xlsx')).toEqual([]);
  });
});
