// 同人多条合并纯函数单测：身份证判重与小数精度求和/空白归一（\n 尾巴）/姓名手机兜底/
// 要素冲突不合并与忽略空值/多金额列求和/文本差异写备注与纯数字过滤/无键行/原引用红线。
// 数据形态参照 2026-10-14 真实样张（黄卫娣两家门店、易文英跨月各两条）。
// 身份串一律用常量引用，杜绝手打位数不一致导致判重键对不上。
import { describe, expect, it } from 'vitest';
import { mergeSamePersonRows } from '../../../src/core/mapping/row-merge';
import type { Rows } from '../../../src/types';

// 列布局：0 序号 | 1 姓名 | 2 身份证 | 3 银行卡 | 4 手机号 | 5 城市 | 6 门店 | 7 上班时间 | 8 金额 | 9 备注
const TYPE_TO_COL: Record<string, number> = { name: 1, idCard: 2, bankCard: 3, phone: 4, note: 9 };
const LABELS = ['序号', '姓名', '身份证', '银行卡', '手机号', '城市', '门店', '上班时间', '小计', '备注'];
const labelOf = (ci: number) => LABELS[ci] || `第 ${ci + 1} 列`;
const opts = { typeToCol: TYPE_TO_COL, amountCols: [8], labelOf, merge: true };

// 身份常量（真实样张脱敏变体，18 位证号/11 位手机号）
const ID_HUANG = '441823197407040921';
const ID_YI = '450421200308117824';
const ID_A = '110101199001010015';
const ID_B = '110101199001010016';
const CARD_HUANG = '6217281942000400827';
const CARD_YI = '6228481456828108178';
const CARD_A1 = '6222000000000000001';
const CARD_A2 = '6222000000000000002';
const PHONE_HUANG = '18211329338';
const PHONE_YI = '19977420672';
const PHONE_A = '13800000000';
const PHONE_B = '13900000000';

describe('mergeSamePersonRows · 判重与合并', () => {
  it('身份证判重合并：金额小数对齐求和、未映射列取首条、文本差异写备注', () => {
    const rows: Rows = [
      ['45', '黄卫娣', ID_HUANG, CARD_HUANG, PHONE_HUANG, '广州', '中华广场店', '2026年9月', '5105.66', ''],
      ['49', '黄卫娣', ID_HUANG, CARD_HUANG, PHONE_HUANG, '广州', '星樾城(中华广场店)', '2026年9月', '1028.77', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.dupGroups).toHaveLength(1);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].name).toBe('黄卫娣');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0][0]).toBe('45'); // 序号取首条
    expect(res.rows[0][6]).toBe('中华广场店'); // 门店取首条
    expect(res.rows[0][8]).toBe('6134.43'); // 5105.66 + 1028.77，整数缩放无浮点尾差
    expect(res.rows[0][9]).toBe('门店：中华广场店、星樾城(中华广场店)');
  });

  it('整数求和无小数尾巴；同证跨月：上班时间差异写备注', () => {
    const rows: Rows = [
      ['58', '易文英', ID_YI, CARD_YI, PHONE_YI, '广州', '文昌总店', '2026年9月', '5164.8', ''],
      ['58', '易文英', ID_YI, CARD_YI, PHONE_YI, '广州', '文昌总店', '2026年10月', '1085.2', ''],
      ['59', '张三', ID_A, CARD_YI, PHONE_A, '广州', '文昌总店', '2026年9月', '198', ''],
      ['60', '张三', ID_A, CARD_YI, PHONE_A, '广州', '文昌总店', '2026年9月', '8', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0][8]).toBe('6250.0'); // 按最大小数位对齐
    expect(res.rows[0][9]).toBe('上班时间：2026年9月、2026年10月');
    expect(res.rows[1][8]).toBe('206');
    expect(res.rows[1][9]).toBe(''); // 无文本差异
  });

  it('卡号/证号带换行尾巴仍判同组（样张实测 \n 尾巴）', () => {
    const rows: Rows = [
      ['1', '甲', ID_A + '\n', CARD_A1 + ' ', PHONE_A, '', 'A店', '', '100', ''],
      ['2', '甲', ID_A, CARD_A1 + '\n', PHONE_A, '', 'B店', '', '23.45', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.groups).toHaveLength(1);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0][8]).toBe('123.45');
  });

  it('无身份证列：姓名+手机号兜底合并；同名不同手机不合并', () => {
    const noId = { typeToCol: { name: 1, phone: 4, note: 9 }, amountCols: [8], labelOf, merge: true };
    const rows: Rows = [
      ['1', '甲', '', '', PHONE_A, '', 'A店', '', '100', ''],
      ['2', '甲', '', '', PHONE_A, '', 'B店', '', '50', ''],
      ['3', '乙', '', '', PHONE_B, '', 'C店', '', '10', ''],
      ['4', '乙', '', '', PHONE_B + '1', '', 'C店', '', '20', ''],
    ];
    const res = mergeSamePersonRows(rows, noId);
    expect(res.groups).toHaveLength(1); // 仅甲合并
    expect(res.rows).toHaveLength(3);
    expect(res.rows[0][8]).toBe('150');
    expect(res.rows[1][1]).toBe('乙'); // 乙两条手机号不同，原样保留
  });

  it('同名不同证绝不合并（键不同）', () => {
    const rows: Rows = [
      ['1', '李明', ID_A, '', '', '', '', '', '100', ''],
      ['2', '李明', ID_B, '', '', '', '', '', '200', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.dupGroups).toHaveLength(0);
    expect(res.rows).toHaveLength(2);
  });
});

describe('mergeSamePersonRows · 要素冲突', () => {
  it('同证不同卡号：整组不合并、行保持原样、报告冲突明细', () => {
    const rows: Rows = [
      ['1', '甲', ID_A, CARD_A1, PHONE_A, '', 'A店', '', '100', ''],
      ['2', '甲', ID_A, CARD_A2, PHONE_A, '', 'B店', '', '200', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.rows).toBe(rows); // 无合并 → 原引用
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].items[0]).toMatchObject({ ci: 3, label: '银行卡' });
    expect(res.conflicts[0].items[0].vals).toEqual([CARD_A1, CARD_A2]);
  });

  it('冲突判定忽略空值：一行卡号空 → 合并取首个非空值', () => {
    const rows: Rows = [
      ['1', '甲', ID_A, CARD_A1, PHONE_A, '', 'A店', '', '100', ''],
      ['2', '甲', ID_A, '', PHONE_A, '', 'B店', '', '200', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.conflicts).toHaveLength(0);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0][3]).toBe(CARD_A1);
  });

  it('同证不同手机号：手机号是要素列 → 冲突不合并', () => {
    const rows: Rows = [
      ['1', '甲', ID_A, '', PHONE_A, '', '', '', '100', ''],
      ['2', '甲', ID_A, '', PHONE_B, '', '', '', '200', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.conflicts[0].items[0]).toMatchObject({ ci: 4, label: '手机号' });
    expect(res.rows).toHaveLength(2);
  });
});

describe('mergeSamePersonRows · 金额与备注', () => {
  it('多金额列逐列求和（先合并后拆行的衔接口径）', () => {
    const two = { typeToCol: TYPE_TO_COL, amountCols: [8, 7], labelOf, merge: true };
    const rows: Rows = [
      ['1', '甲', ID_A, '', '', '', '', '100.5', '10', ''],
      ['2', '甲', ID_A, '', '', '', '', '0.5', '20', ''],
    ];
    const res = mergeSamePersonRows(rows, two);
    expect(res.rows[0][8]).toBe('30'); // 10 + 20
    expect(res.rows[0][7]).toBe('101.0'); // 100.5 + 0.5，按最大小数位输出
  });

  it('金额全不可解析：保留首条原值；千分位参与求和', () => {
    const rows: Rows = [
      ['1', '甲', ID_A, '', '', '', '', '', '8月', ''],
      ['2', '甲', ID_A, '', '', '', '', '', '——', ''],
      ['3', '乙', ID_B, '', '', '', '', '', '5,105.66', ''],
      ['4', '乙', ID_B, '', '', '', '', '', '1,028.77', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.rows[0][8]).toBe('8月'); // 全不可解析
    expect(res.rows[1][8]).toBe('6134.43'); // 千分位剥除后求和
  });

  it('纯数字差异不写备注（序号/单价噪声过滤）；文本差异与原备注以「；」相连', () => {
    const rows: Rows = [
      ['45', '甲', ID_A, '', '', '', 'A店', '', '100', '加急'],
      ['49', '甲', ID_A, '', '', '', 'B店', '', '200', ''],
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.rows[0][9]).toBe('加急；门店：A店、B店'); // 序号 45/49 纯数字被过滤
  });

  it('无备注列：跳过差异拼接，行宽不变', () => {
    const noNote = { typeToCol: { name: 1, idCard: 2, phone: 4 }, amountCols: [8], labelOf, merge: true };
    const rows: Rows = [
      ['1', '甲', ID_A, '', PHONE_A, '', 'A店', '', '100'],
      ['2', '甲', ID_A, '', PHONE_A, '', 'B店', '', '200'],
    ];
    const res = mergeSamePersonRows(rows, noNote);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toHaveLength(9); // 不追加虚拟列
    expect(res.rows[0][6]).toBe('A店');
  });
});

describe('mergeSamePersonRows · 红线与边界', () => {
  it('无重复组：返回原数据引用（compare 零变化基石）', () => {
    const rows: Rows = [['1', '甲', ID_A, '', '', '', '', '', '100', '']];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.rows).toBe(rows);
    expect(res.dupGroups).toHaveLength(0);
  });

  it('merge:false：仅探测不合并，原引用 + dupGroups 仍报告（预警条关闭态提示）', () => {
    const rows: Rows = [
      ['1', '甲', ID_A, '', '', '', '', '', '100', ''],
      ['2', '甲', ID_A, '', '', '', '', '', '200', ''],
    ];
    const res = mergeSamePersonRows(rows, { ...opts, merge: false });
    expect(res.rows).toBe(rows);
    expect(res.dupGroups).toHaveLength(1);
    expect(res.groups).toHaveLength(0);
  });

  it('键全缺的行不参与合并：保留原样并计数', () => {
    const rows: Rows = [
      ['1', '甲', ID_A, '', PHONE_A, '', '', '', '100', ''],
      ['2', '', '', '', PHONE_A, '', '', '', '50', ''],
      ['3', '乙', '', '', '', '', '', '', '10', ''], // 有姓名无手机 → 无键
    ];
    const res = mergeSamePersonRows(rows, opts);
    expect(res.rows).toHaveLength(3);
    expect(res.noKeyCount).toBe(2);
    expect(res.rows[1][8]).toBe('50');
  });

  it('typeToCol 无姓名无证号：原引用（无从判重）', () => {
    const noKey = { typeToCol: { phone: 4 }, amountCols: [8], labelOf };
    const rows: Rows = [['1', '', '', '', PHONE_A, '', '', '', '100', '']];
    const res = mergeSamePersonRows(rows, noKey);
    expect(res.rows).toBe(rows);
  });

  it('typeToCol 含 amount 键（confirmMapping 口径）不影响要素列集合与金额求和', () => {
    const withAmount = { typeToCol: { ...TYPE_TO_COL, amount: 8 }, amountCols: [8], labelOf, merge: true };
    const rows: Rows = [
      ['1', '甲', ID_A, '', PHONE_A, '', 'A店', '', '100', ''],
      ['2', '甲', ID_A, '', PHONE_A, '', 'B店', '', '23.45', ''],
    ];
    const res = mergeSamePersonRows(rows, withAmount);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0][8]).toBe('123.45');
    expect(res.rows[0][9]).toBe('门店：A店、B店');
  });
});
