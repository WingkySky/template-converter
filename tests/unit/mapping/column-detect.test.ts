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

// 银行名称 vs 银行卡号 仲裁（2026-10-15 用户反馈：卡号常被识别成银行名）
describe('bankCard 银行名称仲裁', () => {
  const NOTICE_ROWS: Rows = [
    ['招商银行', '广东省深圳市威盛大厦支行', '6214857809288808'],
    ['中国农业银行', '广东省广州市永平支行', '6228480086994408176'],
  ];

  it('开户行/开户银行/账号 三列并存：开户银行 不抢占 bankCard，账号列认领（用户实测表型）', () => {
    const r = detectColumnMapping(['开户行', '开户银行', '账号'], NOTICE_ROWS);
    expect(r.cols['0'].type).toBe('bankName');
    expect(r.cols['1'].type).toBe('');
    expect(r.cols['2'].type).toBe('bankCard');
  });

  it('裸「银行」列装银行名 + 后置「卡号」列：银行列转认 bankName，卡号列认 bankCard', () => {
    const r = detectColumnMapping(['银行', '卡号'], NOTICE_ROWS.map(([a, , c]) => [a, c]));
    expect(r.cols['0'].type).toBe('bankName');
    expect(r.cols['1'].type).toBe('bankCard');
  });

  it('裸「银行」列装卡号（数据佐证 ≥50% 长数字）：仍认 bankCard（legacy 行为）', () => {
    const r = detectColumnMapping(['银行'], [[NOTICE_ROWS[0][2]], [NOTICE_ROWS[1][2]]]);
    expect(r.cols['0'].type).toBe('bankCard');
  });

  it('显式卡号表头不受数据仲裁影响（卡号列混有金额等脏样本仍认领）', () => {
    const r = detectColumnMapping(['银行卡号'], [['6217000000000000247'], ['6,266.80']]);
    expect(r.cols['0'].type).toBe('bankCard');
  });

  it('无数据行时保持 legacy 纯关键词行为（裸「银行」→ bankCard）', () => {
    const r = detectColumnMapping(['银行'], []);
    expect(r.cols['0'].type).toBe('bankCard');
  });
});

// 「银行卡开户地」含「卡」字不得抢占 bankCard（2026-10-27 友谊发薪明细 ★ 表头，用户反馈
// 「表头含特殊字符识别差」——★ 本身不影响关键词子串匹配，实际是开户地抢卡号列 + 预扣误杀金额列）
describe('bankCard 开户地仲裁（友谊发薪 ★ 表头）', () => {
  const YIYI_HEADER = ['序号', '户名★', '性别★', '身份证号码★', '手机号码★', '银行卡开户行★', '银行卡开户地', '账号★', '应发金额★\n(预扣前）'];
  const YIYI_ROWS: Rows = [
    ['1', '郭淑萍', '女', '440126197309091565', '13423651005', '中国邮政储蓄银行南沙区支行', '', '6221805810004948530', '3800.00'],
    ['2', '梁丽仪', '女', '440126197310185729', '13798077363', '中国邮政储蓄银行沙头支行', '', '6210985814004196574', '4135.00'],
  ];

  it('银行卡开户地→location、账号★→bankCard、应发金额★(预扣前)→amount（用户实测表型）', () => {
    const r = detectColumnMapping(YIYI_HEADER, YIYI_ROWS);
    expect(r.cols['5'].type).toBe('bankName');
    expect(r.cols['6'].type).toBe('location');
    expect(r.cols['7'].type).toBe('bankCard');
    expect(r.cols['8'].type).toBe('amount');
  });

  it('「银行卡开户地」即使装着卡号样式数据也不认 bankCard', () => {
    const r = detectColumnMapping(['银行卡开户地', '账号'], [['6214857809288808', '6214857809288809']]);
    expect(r.cols['0'].type).toBe('location');
    expect(r.cols['1'].type).toBe('bankCard');
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
    expect(COL_TYPE_LABELS['amountTotal']).toBe('合计金额（仅核对，不导出）');
    expect(Object.keys(COL_TYPE_LABELS)).toHaveLength(14);
  });
});

// ============ 多列金额仲裁（2026-11-09 设计）============

const TJ_HEADER = ['姓名', '税后', '第一笔', '第二笔', '账号', '银行', '身份证', '电话', '是否认证'];
const tjRows: Rows = [
  ['王辉', 42264.219047619, 34501.786, 7762.433047619, '4563510100864730480', '中国银行北京亮马河大厦支行', '110101195902021012', '13501211095', '是'],
  ['王辉2', 40905.2666666667, '', 40905.2666666667, '4563510100864730480', '中国银行北京亮马河大厦支行', '110101195902021012', '13501211095', '是'],
  ['吴佐生', 84971.0857142857, 70026.0879999998, 14944.9977142859, '6222600525660099999', '交行柳州支行', '330323197310304915', '13807722188', '是'],
  ['卞福林', 40881.3714285714, 28616.962, 12264.4094285714, '6228491728004778778', '中国农业银行股份有限公司邯郸沁阳支行', '130403195603160330', '18132236888', '是'],
];

describe('多列金额仲裁（求和关系）', () => {
  it('天九分润表：税后=第一笔+第二笔 → 税后 amountTotal、两笔均 amount', () => {
    const r = detectColumnMapping(TJ_HEADER, tjRows);
    expect(r.cols['1'].type).toBe('amountTotal');
    expect(r.cols['2'].type).toBe('amount');
    expect(r.cols['3'].type).toBe('amount');
    expect(r.cols['0'].type).toBe('name');
    expect(r.cols['4'].type).toBe('bankCard');
    expect(r.cols['6'].type).toBe('idCard');
    expect(r.cols['7'].type).toBe('phone');
  });

  it('月份式：合计=1月+2月 → 合计 amountTotal、月份列均 amount', () => {
    const rows: Rows = [
      ['张三', '100', '200', '300'],
      ['李四', '150', '250', '400'],
      ['王五', '80', '90', '170'],
      ['赵六', '60', '70', '130'],
    ];
    const r = detectColumnMapping(['姓名', '1月', '2月', '合计'], rows);
    expect(r.cols['3'].type).toBe('amountTotal');
    expect(r.cols['1'].type).toBe('amount');
    expect(r.cols['2'].type).toBe('amount');
  });

  it('项目名式（表头看不出拆分语义）：总计=劳务费+代缴费 → 求和关系命中', () => {
    const rows: Rows = [
      ['张三', '100', '200', '300'],
      ['李四', '150', '250', '400'],
      ['王五', '80', '90', '170'],
      ['赵六', '60', '70', '130'],
    ];
    const r = detectColumnMapping(['姓名', '劳务费', '代缴费', '总计'], rows);
    expect(r.cols['3'].type).toBe('amountTotal');
    expect(r.cols['1'].type).toBe('amount');
    expect(r.cols['2'].type).toBe('amount');
  });

  it('无求和关系 → 回退单列认领（评分最左列 amount，另一列空）', () => {
    const rows: Rows = [
      ['张三', '100', '50'],
      ['李四', '200', '60'],
      ['王五', '300', '70'],
      ['赵六', '400', '80'],
    ];
    const r = detectColumnMapping(['姓名', '金额A', '金额B'], rows);
    expect(r.cols['1'].type).toBe('amount');
    expect(r.cols['2'].type).toBe('');
  });

  it('序号列被排除正则挡住，不参与仲裁也不被认领', () => {
    const rows: Rows = [
      ['张三', '1', '100', '200', '300'],
      ['李四', '2', '150', '250', '400'],
      ['王五', '3', '80', '90', '170'],
      ['赵六', '4', '60', '70', '130'],
    ];
    const r = detectColumnMapping(['姓名', '序号', '第一笔', '第二笔', '合计'], rows);
    expect(r.cols['1'].type).toBe('');
    expect(r.cols['2'].type).toBe('amount');
    expect(r.cols['3'].type).toBe('amount');
    expect(r.cols['4'].type).toBe('amountTotal');
  });

  it('候选恰为 2 且表头呈「第N笔」模式 → 无合计兜底全标 amount', () => {
    const rows: Rows = [
      ['张三', '100', '200'],
      ['李四', '150', '250'],
      ['王五', '80', '90'],
      ['赵六', '60', '70'],
    ];
    const r = detectColumnMapping(['姓名', '第一笔', '第二笔'], rows);
    expect(r.cols['1'].type).toBe('amount');
    expect(r.cols['2'].type).toBe('amount');
  });

  it('候选 > 8 → 不仲裁，回退单列逻辑（仅评分最高一列 amount）', () => {
    const header = ['姓名', ...Array.from({ length: 9 }, (_, i) => `金额${i + 1}`)];
    const rows: Rows = [
      ['张三', '11', '23', '37', '41', '53', '67', '71', '83', '97'],
      ['李四', '12', '24', '38', '42', '54', '68', '72', '84', '98'],
      ['王五', '13', '25', '39', '43', '55', '69', '73', '85', '99'],
      ['赵六', '14', '26', '40', '44', '56', '70', '74', '86', '100'],
    ];
    const r = detectColumnMapping(header, rows);
    const amountCount = Object.values(r.cols).filter(c => c.type === 'amount').length;
    expect(amountCount).toBe(1);
    expect(r.cols['1'].type).toBe('amount');
  });

  it('既有行为回归：单金额列场景（数量表头数据兜底、应发金额评分）不受仲裁影响', () => {
    const r1 = detectColumnMapping(['姓名', '应发金额'], [['张三', '5200.5']]);
    expect(r1.cols['1'].type).toBe('amount');
    const rows: Rows = Array.from({ length: 10 }, (_, i) => ['张三', i < 6 ? String(100 + i) : '不适用']);
    const r2 = detectColumnMapping(['姓名', '数量'], rows);
    expect(r2.cols['1'].type).toBe('amount');
  });
});
