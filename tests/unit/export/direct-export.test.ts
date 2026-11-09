// 直接导出（识别导出）纯函数单测 —— 原表/整理表两种口径，
// 设计 docs/superpowers/specs/2026-10-14-mapping-direct-export-design.md。
import { describe, it, expect } from 'vitest';
import { buildRawDirectTable, buildMappedDirectTable } from '../../../src/core/export/direct-export';
import { detectColumnMapping } from '../../../src/core/mapping/column-detect';
import type { Rows } from '../../../src/types';

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

  it('≥2 列金额自动拆行：归一最左列，只输出单「税前金额」，行数展开', () => {
    const cols = {
      '1': { header: '第一笔', type: 'amount' },
      '2': { header: '第二笔', type: 'amount' },
      '0': { header: '姓名', type: 'name' },
    };
    const t = buildMappedDirectTable([['张三', '100', '200']], cols, { nameColIndex: 0 });
    expect(t.headers).toEqual(['姓名', '税前金额']);
    expect(t.rows).toEqual([['张三', '100'], ['张三', '200']]);
    expect(t.mismatches).toEqual([]);
  });

  it('拆行空金额跳过；全拆分列空行保留 1 行', () => {
    const cols = {
      '0': { header: '姓名', type: 'name' },
      '1': { header: '第一笔', type: 'amount' },
      '2': { header: '第二笔', type: 'amount' },
    };
    const t = buildMappedDirectTable([
      ['甲', '', '300'],
      ['乙', '', ''],
      ['丙', '100', '200'],
    ], cols, { nameColIndex: null });
    expect(t.headers).toEqual(['姓名', '税前金额']);
    expect(t.rows).toEqual([
      ['甲', '300'],
      ['乙', ''],
      ['丙', '100'],
      ['丙', '200'],
    ]);
  });

  it('拆行含合计列核对：mismatches 返回原始行号与差值，合计列不输出', () => {
    const cols = {
      '0': { header: '姓名', type: 'name' },
      '1': { header: '第一笔', type: 'amount' },
      '2': { header: '第二笔', type: 'amount' },
      '3': { header: '税后', type: 'amountTotal' },
    };
    const t = buildMappedDirectTable([
      ['甲', '100', '200', '300'],
      ['乙', '50', '70', '999'],
    ], cols, { nameColIndex: null });
    expect(t.headers).toEqual(['姓名', '税前金额']);
    expect(t.mismatches).toEqual([{ rowIndex: 1, sum: 120, declared: 999 }]);
  });

  it('labelNote 开启且源无备注列 → 行尾追加虚拟「备注」列写来源标签', () => {
    const cols = {
      '0': { header: '姓名', type: 'name' },
      '1': { header: '第一笔', type: 'amount' },
      '2': { header: '第二笔', type: 'amount' },
    };
    const t = buildMappedDirectTable([['张三', '100', '200']], cols, { nameColIndex: null, labelNote: true });
    expect(t.headers).toEqual(['姓名', '税前金额', '备注']);
    expect(t.rows).toEqual([['张三', '100', '第一笔'], ['张三', '200', '第二笔']]);
  });

  it('既有备注列时拆行标签追加不覆盖（labelNote 开启）', () => {
    const cols = {
      '0': { header: '姓名', type: 'name' },
      '1': { header: '第一笔', type: 'amount' },
      '2': { header: '第二笔', type: 'amount' },
      '3': { header: '备注', type: 'note' },
    };
    const t = buildMappedDirectTable([['张三', '100', '200', '原备注']], cols, { nameColIndex: null, labelNote: true });
    expect(t.headers).toEqual(['姓名', '税前金额', '备注']);
    expect(t.rows).toEqual([['张三', '100', '原备注；第一笔'], ['张三', '200', '原备注；第二笔']]);
  });

  it('天九分润端到端：detect 求和仲裁 → 整理表拆行（金额 sanitizeAmount 两位小数）', () => {
    const header = ['姓名', '税后', '第一笔', '第二笔', '账号', '银行', '身份证', '电话', '是否认证'];
    const rows: Rows = [
      ['王辉', 42264.219047619, 34501.786, 7762.433047619, '4563510100864730480', '中国银行北京亮马河大厦支行', '110101195902021012', '13501211095', '是'],
      ['王辉2', 40905.2666666667, '', 40905.2666666667, '4563510100864730480', '中国银行北京亮马河大厦支行', '110101195902021012', '13501211095', '是'],
      ['吴佐生', 84971.0857142857, 70026.0879999998, 14944.9977142859, '6222600525660099999', '交行柳州支行', '330323197310304915', '13807722188', '是'],
      ['卞福林', 40881.3714285714, 28616.962, 12264.4094285714, '6228491728004778778', '中国农业银行股份有限公司邯郸沁阳支行', '130403195603160330', '18132236888', '是'],
    ];
    const det = detectColumnMapping(header, rows);
    const t = buildMappedDirectTable(rows, det.cols, { nameColIndex: null });
    expect(t.headers).toEqual(['姓名', '税前金额', '银行卡号', '身份证', '手机号']);
    expect(t.rows).toEqual([
      ['王辉', '34501.79', '4563510100864730480', '110101195902021012', '13501211095'],
      ['王辉', '7762.43', '4563510100864730480', '110101195902021012', '13501211095'],
      ['王辉2', '40905.27', '4563510100864730480', '110101195902021012', '13501211095'],
      ['吴佐生', '70026.09', '6222600525660099999', '330323197310304915', '13807722188'],
      ['吴佐生', '14945', '6222600525660099999', '330323197310304915', '13807722188'],
      ['卞福林', '28616.96', '6228491728004778778', '130403195603160330', '18132236888'],
      ['卞福林', '12264.41', '6228491728004778778', '130403195603160330', '18132236888'],
    ]);
    expect(t.mismatches).toEqual([]);
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

  it('单金额列（含合计列）与旧实现逐格一致，mismatches 恒空', () => {
    const t = buildMappedDirectTable(ROWS, COLS, { nameColIndex: null });
    expect(t.headers).toEqual(['姓名', '银行卡号', '税前金额']);
    expect(t.rows[0]).toEqual(['王辉2', '6222000011112222', '1234.5']);
    expect(t.mismatches).toEqual([]);
  });
});
