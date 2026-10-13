// 拆行纯函数单测：多列拆行/金额归一与清空/跳空与 0 元/全空保留/备注追加与虚拟备注列/
// 合计核对收集/单金额列返回原引用（compare 零变化基石）。数据形态参照 2026-10-12 真实样张。
import { describe, expect, it } from 'vitest';
import { expandAmountSplitRows } from '../../../src/core/mapping/row-expand';
import type { Rows } from '../../../src/types';

// 列布局：0 姓名 | 1 身份证 | 2 第一笔 | 3 第二笔 | 4 合计 | 5 备注
const LABELS = ['', '', '第一笔', '第二笔', '合计', ''];

function labelOf(ci: number): string {
  return LABELS[ci] || '';
}

const opts = { amountCols: [2, 3], totalCol: 4, noteCol: 5, labelOf };

describe('expandAmountSplitRows · 拆行与归一', () => {
  const rows: Rows = [
    ['王辉', '110101199001010015', '20768.06', '18547.66', '39315.71', ''],
    ['王辉2', '110101199001010015', '', '39626.05', '39626.05', ''],
  ];

  it('每个非空拆分列一行：金额归一写最左拆分列、其余拆分列清空、备注写来源', () => {
    const res = expandAmountSplitRows(rows, opts);
    expect(res.expandedRowCount).toBe(3);
    expect(res.mismatches).toEqual([]);
    expect(res.rows[0]).toEqual(['王辉', '110101199001010015', '20768.06', '', '39315.71', '第一笔']);
    expect(res.rows[1]).toEqual(['王辉', '110101199001010015', '18547.66', '', '39315.71', '第二笔']);
    // 王辉2 第一笔为空 → 跳过，只生成第二笔一行；金额归一写入第一笔列
    expect(res.rows[2]).toEqual(['王辉2', '110101199001010015', '39626.05', '', '39626.05', '第二笔']);
  });

  it('0 元与不可解析视同空跳过', () => {
    const r: Rows = [
      ['甲', '110101199001010015', '0.00', '500.00', '500.00', ''],
      ['乙', '110101199001010015', '8月', '——', '0', ''],
    ];
    const res = expandAmountSplitRows(r, opts);
    // 甲：0.00 跳过 → 1 行；乙：全部视同空 → 保留原行 1 行
    expect(res.expandedRowCount).toBe(2);
    expect(res.rows[0]).toEqual(['甲', '110101199001010015', '500.00', '', '500.00', '第二笔']);
    expect(res.rows[1]).toEqual(['乙', '110101199001010015', '8月', '——', '0', '']);
  });

  it('千分位金额照抄归一', () => {
    const r: Rows = [['王辉', '110101199001010015', '39,315.71', '', '', '']];
    const res = expandAmountSplitRows(r, { ...opts, totalCol: null });
    expect(res.rows[0][2]).toBe('39,315.71');
  });
});

describe('expandAmountSplitRows · 备注', () => {
  it('已有备注列：原备注追加来源标签，不覆盖', () => {
    const r: Rows = [['王辉', '110101199001010015', '100.00', '200.00', '300.00', '加急']];
    const res = expandAmountSplitRows(r, opts);
    expect(res.rows[0][5]).toBe('加急；第一笔');
    expect(res.rows[1][5]).toBe('加急；第二笔');
  });

  it('源表无备注列：行尾追加虚拟备注列，全部行对齐补齐', () => {
    const r: Rows = [
      ['王辉', '110101199001010015', '100.00', '200.00', '300.00'],
      ['吴佐生', '110101199001010015', '', '', ''],
    ];
    const res = expandAmountSplitRows(r, { amountCols: [2, 3], noteCol: null, labelOf });
    expect(res.noteCol).toBe(5);
    expect(res.rows[0]).toEqual(['王辉', '110101199001010015', '100.00', '', '300.00', '第一笔']);
    expect(res.rows[1]).toEqual(['王辉', '110101199001010015', '200.00', '', '300.00', '第二笔']);
    // 全空行保留且补齐虚拟列
    expect(res.rows[2]).toEqual(['吴佐生', '110101199001010015', '', '', '', '']);
  });
});

describe('expandAmountSplitRows · 合计核对', () => {
  it('不平行收集（容差 max(0.02, |declared|×1e-6)），合计列空/非数值跳过', () => {
    const r: Rows = [
      ['王辉', '110101199001010015', '100.00', '200.00', '300.00', ''],
      ['吴佐生', '110101199001010015', '100.00', '200.00', '39315.70', ''],
      ['卞福林', '110101199001010015', '100.00', '200.00', '', ''],
      ['郭卫杰', '110101199001010015', '100.00', '200.00', '300.001', ''],
    ];
    const res = expandAmountSplitRows(r, opts);
    expect(res.mismatches).toEqual([{ rowIndex: 1, sum: 300, declared: 39315.7 }]);
  });
});

describe('expandAmountSplitRows · labelNote 开关（2026-10-15 用户要求产品默认关）', () => {
  it('labelNote=false：不写来源标签、不追加虚拟备注列、行宽不变', () => {
    const r: Rows = [
      ['王辉', '110101199001010015', '100.00', '200.00', '300.00'],
      ['吴佐生', '110101199001010015', '', '', ''],
    ];
    const res = expandAmountSplitRows(r, { amountCols: [2, 3], noteCol: null, labelOf, labelNote: false });
    expect(res.noteCol).toBeNull();
    expect(res.expandedRowCount).toBe(3);
    expect(res.rows[0]).toEqual(['王辉', '110101199001010015', '100.00', '', '300.00']);
    expect(res.rows[1]).toEqual(['王辉', '110101199001010015', '200.00', '', '300.00']);
    expect(res.rows[2]).toEqual(['吴佐生', '110101199001010015', '', '', '']);
  });

  it('labelNote=false 且已有备注列：备注原样保留不追加', () => {
    const r: Rows = [['王辉', '110101199001010015', '100.00', '200.00', '300.00', '加急']];
    const res = expandAmountSplitRows(r, { ...opts, labelNote: false });
    expect(res.rows[0][5]).toBe('加急');
    expect(res.rows[1][5]).toBe('加急');
  });

  it('labelNote 缺省 = true（保持原行为，引擎层默认不变）', () => {
    const r: Rows = [['王辉', '110101199001010015', '100.00', '200.00', '300.00', '']];
    const res = expandAmountSplitRows(r, opts);
    expect(res.rows[0][5]).toBe('第一笔');
  });
});

describe('expandAmountSplitRows · 红线', () => {
  it('单金额列返回原数据引用（单金额列场景字节级不变）', () => {
    const r: Rows = [['王辉', '110101199001010015', '100.00']];
    const res = expandAmountSplitRows(r, { amountCols: [2], noteCol: null, labelOf });
    expect(res.rows).toBe(r);
    expect(res.expandedRowCount).toBe(1);
    expect(res.mismatches).toEqual([]);
  });
});
