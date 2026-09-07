// detectColumnMapping / COL_KEYWORDS / COL_TYPE_LABELS 单测 —— 覆盖标准列名识别、
// 金额列打分路径与数据兜底路径、samples 采样与空表头列处理。
import { describe, it, expect } from 'vitest';
import {
  detectColumnMapping, COL_KEYWORDS, COL_TYPE_LABELS,
} from '../../../src/core/mapping/column-detect';
import { parseCSV } from '../../../src/core/parser/parse-csv';
import { smartDetectTable } from '../../../src/core/parser/table-detect';
import csvUtf8 from '../../fixtures/发放明细-UTF8.csv?raw';
import type { Rows } from '../../../src/types';

const STD_HEADER = ['姓名', '身份证号码', '手机号码', '开户银行', '银行卡号', '税前金额'];
const stdData: Rows = [
  ['张三', '11010119900307421X', '13800138000', '建设银行', '6217000000000000247', '5200.50'],
  ['李四', '11010119900307421x', '13900139000', '工商银行', '6216616200012345678', '3800'],
];

describe('detectColumnMapping', () => {
  it('标准列名识别', () => {
    const r = detectColumnMapping(STD_HEADER, stdData);
    expect(r.cols['0'].type).toBe('name');
    expect(r.cols['1'].type).toBe('idCard');
    expect(r.cols['2'].type).toBe('phone');
    expect(r.cols['3'].type).toBe('bankName');
    expect(r.cols['4'].type).toBe('bankCard');
    expect(r.cols['5'].type).toBe('amount');
  });

  it('只返回 { cols }，amountCol/nameCol 由 analyzeSheet 后补（保持 legacy 返回形状）', () => {
    const r = detectColumnMapping(STD_HEADER, stdData);
    expect(Object.keys(r)).toEqual(['cols']);
  });

  it('amount 类型在关键词循环中被跳过，只能经打分/兜底产生', () => {
    // '应发金额' 同时命中 amount 关键词，但关键词循环跳过 amount；
    // 走打分路径（9 + 全命中 8 = 17 ≥ 5）识别为 amount
    const r = detectColumnMapping(['姓名', '应发金额'], [['张三', '5200.5']]);
    expect(r.cols['1'].type).toBe('amount');
  });

  it('表头无金额关键词时走数据兜底路径（打分 4.8 < 5 被拒，兜底 6/10 ≥ 5 命中）', () => {
    const rows: Rows = Array.from({ length: 10 }, (_, i) => ['张三', i < 6 ? String(100 + i) : '不适用']);
    const r = detectColumnMapping(['姓名', '数量'], rows);
    expect(r.cols['0'].type).toBe('name');
    expect(r.cols['1'].type).toBe('amount');
  });

  it('每个类型只分配一次（首个命中的列占位）', () => {
    const r = detectColumnMapping(['姓名', '收款人姓名', '金额'], [['张三', '李四', '1']]);
    expect(r.cols['0'].type).toBe('name');
    expect(r.cols['1'].type).toBe(''); // name 已被第 0 列占用
  });

  it('客户名称命中 name（名称优先于 clientName，保持 legacy 关键词顺序）', () => {
    const r = detectColumnMapping(['客户名称', '委托方'], [['某某公司', '甲方']]);
    expect(r.cols['0'].type).toBe('name');
  });

  it('samples 取前 3 行非空值并 trim；空表头且未识别的列不产生条目', () => {
    const r = detectColumnMapping(['姓名', ''], [['  张三 ', 'x'], ['李四', 'y'], ['王五', 'z'], ['赵六', 'w']]);
    expect(r.cols['0']).toEqual({ header: '姓名', type: 'name', samples: ['张三', '李四', '王五'] });
    expect(r.cols['1']).toBeUndefined();
  });

  it('未识别但有表头的列 type 为空串', () => {
    const r = detectColumnMapping(['姓名', '血型'], [['张三', 'A']]);
    expect(r.cols['1'].header).toBe('血型');
    expect(r.cols['1'].type).toBe('');
  });

  it('无数据行时按关键词分识别金额列（税前金额 12 ≥ 5）', () => {
    const r = detectColumnMapping(['姓名', '税前金额'], []);
    expect(r.cols['0'].type).toBe('name');
    expect(r.cols['1'].type).toBe('amount');
  });

  it('发放明细-UTF8.csv fixture：金额列与样本值', () => {
    const { headerRow, dataRows } = smartDetectTable(parseCSV(csvUtf8));
    const r = detectColumnMapping(headerRow, dataRows);
    expect(r.cols['1'].type).toBe('idCard');
    expect(r.cols['5'].type).toBe('amount');
    // 王五行的 "6,266.80" 在银行卡号列，税前金额列为 4266.80
    expect(r.cols['5'].samples).toEqual(['5200.50', '3800', '4266.80']);
    expect(r.cols['4'].samples).toEqual(['6217000000000000247', '6216616200012345678', '6,266.80']);
  });
});

describe('COL_KEYWORDS / COL_TYPE_LABELS 常量', () => {
  it('COL_KEYWORDS 键集与 legacy 一致（amount 在打分阶段单独处理）', () => {
    expect(Object.keys(COL_KEYWORDS)).toEqual([
      'name', 'idCard', 'phone', 'bankName', 'bankCard', 'amount', 'gender',
      'location', 'note', 'shangSheId', 'clientName', 'taxId',
    ]);
    expect(COL_KEYWORDS.name.test('张三户名')).toBe(true);
    expect(COL_KEYWORDS.taxId.test('统一社会信用代码')).toBe(true);
  });

  it('COL_TYPE_LABELS 面向 UI 下拉的标签', () => {
    expect(COL_TYPE_LABELS['']).toBe('— 不识别 —');
    expect(COL_TYPE_LABELS['amount']).toBe('税前金额');
    expect(Object.keys(COL_TYPE_LABELS)).toHaveLength(13);
  });
});
