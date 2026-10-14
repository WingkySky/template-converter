// 直接导出（识别导出）纯函数单测 —— 原表/整理表两种口径，
// 设计 docs/superpowers/specs/2026-10-14-mapping-direct-export-design.md。
import { describe, it, expect } from 'vitest';
import { buildRawDirectTable, buildMappedDirectTable } from '../../../src/core/export/direct-export';

// 映射页典型列集（乱序键验证列序升序；含不识别列与合计列）
const COLS = {
  '0': { header: '姓名', type: 'name' },
  '2': { header: '账号', type: 'bankCard' },
  '3': { header: '金额', type: 'amount' },
  '1': { header: '备注', type: '' },
  '4': { header: '合计', type: 'amountTotal' },
};
const ROWS = [
  ['王辉2', '备注甲', '6222 0000 1111 2222', '¥1,234.50', '1234.50'],
  ['施丽华', '', '', '', ''],
];

describe('buildRawDirectTable', () => {
  it('列序按列号升序，表头用识别原表头，含不识别列与合计列', () => {
    const t = buildRawDirectTable(ROWS, COLS, { nameColIndex: null });
    expect(t.headers).toEqual(['姓名', '备注', '账号', '金额', '合计']);
  });

  it('数据逐格原样（含空值出空串），不做任何值清洗', () => {
    const t = buildRawDirectTable(ROWS, COLS, { nameColIndex: null });
    expect(t.rows[0]).toEqual(['王辉2', '备注甲', '6222 0000 1111 2222', '¥1,234.50', '1234.50']);
    expect(t.rows[1]).toEqual(['施丽华', '', '', '', '']);
  });

  it('nameColIndex 指定时姓名列应用 cleanNameCell（王辉2 → 王辉），其余列不动', () => {
    const t = buildRawDirectTable(ROWS, COLS, { nameColIndex: 0 });
    expect(t.rows[0][0]).toBe('王辉');
    expect(t.rows[0][3]).toBe('¥1,234.50');
  });

  it('null/undefined 单元格出空串', () => {
    const t = buildRawDirectTable([[], [null, undefined]], { '1': { header: '甲', type: 'note' } }, { nameColIndex: null });
    expect(t.rows[0]).toEqual(['']);
    expect(t.rows[1]).toEqual(['']);
  });

  it('空表头回退为 列N（运行时不出现，防御 applyUserTypeOverrides 之外的非常规输入）', () => {
    const t = buildRawDirectTable([['x']], { '2': { header: '', type: 'note' } }, { nameColIndex: null });
    expect(t.headers).toEqual(['列3']);
  });
});

describe('buildMappedDirectTable', () => {
  it('丢弃不识别列与合计列，表头用 COL_TYPE_LABELS 标准名', () => {
    const t = buildMappedDirectTable(ROWS, COLS, { nameColIndex: null });
    expect(t.headers).toEqual(['姓名', '银行卡号', '税前金额']);
  });

  it('值清洗与模版管线同口径：卡号剥空格、金额 sanitizeAmount（¥/, 千分位）、备注 trim', () => {
    const t = buildMappedDirectTable(ROWS, COLS, { nameColIndex: null });
    expect(t.rows[0]).toEqual(['王辉2', '6222000011112222', '1234.5']);
  });

  it('姓名列先 cleanNameCell 再 cleanValue（模版管线净效果：王辉2 → 王辉）', () => {
    const t = buildMappedDirectTable(ROWS, COLS, { nameColIndex: 0 });
    expect(t.rows[0][0]).toBe('王辉');
  });

  it('nameColIndex 为 null 时姓名列只做 cleanValue（注记保留，仅剥空白）', () => {
    const t = buildMappedDirectTable([['王 辉2']], { '0': { header: '姓名', type: 'name' } }, { nameColIndex: null });
    expect(t.rows[0][0]).toBe('王辉2');
  });

  it('多列金额全部保留不拆行，第 2 列起表头追加序号（税前金额2）', () => {
    const cols = {
      '1': { header: '第一笔', type: 'amount' },
      '2': { header: '第二笔', type: 'amount' },
      '0': { header: '姓名', type: 'name' },
    };
    const t = buildMappedDirectTable([['张三', '100', '200']], cols, { nameColIndex: 0 });
    expect(t.headers).toEqual(['姓名', '税前金额', '税前金额2']);
    expect(t.rows[0]).toEqual(['张三', '100', '200']);
  });

  it('全空值行保留（不做行过滤），全空出空串', () => {
    const t = buildMappedDirectTable([['', '', '']], { '0': { header: '姓名', type: 'name' }, '1': { header: '金额', type: 'amount' } }, { nameColIndex: null });
    expect(t.rows[0]).toEqual(['', '']);
  });

  it('身份证全角数字/形近 X 归一（cleanValue idCard 规则）', () => {
    const cols = { '0': { header: '身份证', type: 'idCard' } };
    const t = buildMappedDirectTable([['３７０６２４１９７１１０９００４５ｘ']], cols, { nameColIndex: null });
    expect(t.rows[0][0]).toBe('37062419711090045X');
  });

  it('全部列均不识别 → 0 列空表（调用方负责 alert 拦截）', () => {
    const t = buildMappedDirectTable(ROWS, { '0': { header: '甲', type: '' } }, { nameColIndex: null });
    expect(t.headers).toEqual([]);
    expect(t.rows[0]).toEqual([]);
  });
});
