# 多列金额自动识别 + 整理表导出即拆行 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动检测识别多列金额拆分（求和关系仲裁），并让映射页「导出整理表」直接产出拆好行的标准表。

**Architecture:** 两个独立的 core 改动 + 一处 UI 接线。Task 1 在 `detectColumnMapping` 单列金额认领前插入「多列金额仲裁」阶段（候选收集 → 行级求和验证 → 认领 amountTotal + 多 amount，未命中回退现有单列逻辑）；Task 2 在 `buildMappedDirectTable` 中复用 `expandAmountSplitRows` 先拆行后清洗；Task 3 给 `exportDirect` handler 接 mismatches 弹窗与备注开关。

**Tech Stack:** TypeScript / Vitest / tsx（compare 基线工具）。设计依据：`docs/superpowers/specs/2026-11-09-multi-amount-column-detect-design.md` 与 `docs/superpowers/specs/2026-11-09-direct-export-split-rows-design.md`。

**红线（全程有效）:**
- 单金额列场景行为字节级不变：仲裁未命中时检测结果与现状逐字节一致；`buildMappedDirectTable` 单金额列输出与旧实现逐格一致；
- 不修改 `getAmountColumnScore` 的排除正则（那是单列评分路径，`数量` 表头 + 数据兜底路径的既有测试依赖它）；
- 交付前 `npm run compare` 全量基线零变化。

---

### Task 1: 多列金额仲裁（column-detect.ts）

**Files:**
- Modify: `src/core/mapping/row-expand.ts:41`（仅加 export 关键字）
- Modify: `src/core/mapping/column-detect.ts`（新增仲裁阶段 + 集成）
- Test: `tests/unit/mapping/column-detect.test.ts`（新增 describe）

- [ ] **Step 1.1: 导出 row-expand 的 parseAmountValue**

`src/core/mapping/row-expand.ts` L41，把

```ts
/** 宽松数值化：剥离千分位/币符/空白后转 Number；不可解析/0 视同空（返回 null） */
function parseAmountValue(raw: unknown): number | null {
```

改为

```ts
/** 宽松数值化：剥离千分位/币符/空白后转 Number；不可解析/0 视同空（返回 null）。
 * 2026-11-09 起由 column-detect 的多列金额仲裁复用（同一口径，避免两处漂移） */
export function parseAmountValue(raw: unknown): number | null {
```

- [ ] **Step 1.2: 写失败测试**

在 `tests/unit/mapping/column-detect.test.ts` 文件末尾追加（顶部 import 区无需改动，detectColumnMapping 已导入）：

```ts
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
```

- [ ] **Step 1.3: 运行确认失败**

Run: `npx vitest run tests/unit/mapping/column-detect.test.ts`
Expected: 新 describe 的用例 FAIL（天九分润表 `税后` 被标 amount、两笔未识别），既有用例 PASS。

- [ ] **Step 1.4: 实现 column-detect.ts**

`src/core/mapping/column-detect.ts` 三处修改：

（a）顶部 import 区，L8 改为：

```ts
import { getAmountColumnScore, isAmountLikeNumber } from './amount-score';
import { parseAmountValue } from './row-expand';
```

（b）在 `detectColumnMapping` 定义之前（`cardLikeRatio` 函数之后）插入仲裁模块：

```ts
// ==================== 多列金额仲裁（2026-11-09 设计
// docs/superpowers/specs/2026-11-09-multi-amount-column-detect-design.md）====================
// 现状自动检测最多认领 1 列 amount，「第一笔/第二笔」类拆分表落空 → 拆分功能不触发。
// 在单列认领前尝试：候选列收集 → 行级求和验证（某列 ≈ 其余若干列之和）→
// 命中则合计列标 amountTotal、被加列全标 amount；未命中走表头模式兜底；再不中回退单列逻辑。

/** 候选列排除表（仅作用于多列仲裁的候选收集；单列回退路径的评分排除表不动——
 *  「数量」表头 + 数据兜底的既有行为依赖 getAmountColumnScore 现状） */
const MULTI_AMOUNT_EXCLUDE_RE = /序号|编号|方式|类型|选择|状态|税源地|开户|账号|账户|手机号|电话|身份证|证件|银行|备注|说明|业务|减除|扣除|速算|核定|预扣(?!前)|免税|服务费|个税|数量|件数|笔数|人数|天数/;

/** 拆分模式表头：「第N笔」「N月」（表头模式兜底用，求和验证未命中时的弱信号） */
const PEN_HEADER_RE = /^第\s*(?:[一二三四五六七八九十百]+|\d+)\s*笔$/;
const MONTH_HEADER_RE = /^(?:0?[1-9]|1[0-2])\s*月$/;

interface SumHit {
  totalCol: number;
  splitCols: number[];
  ok: number;
}

/** 候选金额列：未被关键词认领、表头不命中排除正则、前 12 非空样本金额样占比 ≥ 0.6 */
function collectAmountCandidates(headerRow: Row, dataRows: Rows, mapping: Record<number, string | undefined>): number[] {
  const out: number[] = [];
  headerRow.forEach((cell, ci) => {
    if (mapping[ci]) return;
    const h = String(cell || '').trim();
    if (h && MULTI_AMOUNT_EXCLUDE_RE.test(h)) return;
    let nonEmpty = 0, hits = 0;
    dataRows.slice(0, 12).forEach(row => {
      const v = row?.[ci];
      if (v == null || String(v).trim() === '') return;
      nonEmpty++;
      if (isAmountLikeNumber(v)) hits++;
    });
    if (nonEmpty > 0 && hits / nonEmpty >= 0.6) out.push(ci);
  });
  return out;
}

/** 行级求和计数：sum(splitCols) ≈ row[totalCol]，容差与 row-expand 合计核对同口径 */
function countSumHits(rows: Rows, totalCol: number, splitCols: number[]): { checked: number; ok: number } {
  let checked = 0, ok = 0;
  for (const row of rows) {
    const rawDeclared = String(row?.[totalCol] ?? '').replace(/[,，\s￥¥]/g, '');
    if (!rawDeclared || !/\d/.test(rawDeclared)) continue;
    const declared = Number(rawDeclared);
    if (!Number.isFinite(declared)) continue;
    let sum = 0;
    splitCols.forEach(ci => {
      const v = parseAmountValue(row?.[ci]);
      if (v != null) sum += v;
    });
    checked++;
    const tolerance = Math.max(0.02, Math.abs(declared) * 1e-6);
    if (Math.abs(sum - declared) <= tolerance) ok++;
  }
  return { checked, ok };
}

/** 两段验证：前 20 行粗筛 ≥80% 才做全量复核（大表防组合 × 全行扫描），均需 checked ≥ 3 */
function verifySumRelation(dataRows: Rows, totalCol: number, splitCols: number[]): SumHit | null {
  const probe = dataRows.length <= 20 ? dataRows : dataRows.slice(0, 20);
  const p = countSumHits(probe, totalCol, splitCols);
  if (p.checked < 3 || p.ok / p.checked < 0.8) return null;
  const full = dataRows.length <= 20 ? p : countSumHits(dataRows, totalCol, splitCols);
  if (full.checked < 3 || full.ok / full.checked < 0.8) return null;
  return { totalCol, splitCols, ok: full.ok };
}

/** 求和仲裁：枚举「合计列 c + 拆分子集 S(|S|≥2)」，择优（拆分列数 → 命中行数 → 列序） */
function arbitrateMultiAmount(dataRows: Rows, candidates: number[]): SumHit | null {
  const hits: SumHit[] = [];
  for (const c of candidates) {
    const rest = candidates.filter(x => x !== c);
    for (let mask = 0; mask < (1 << rest.length); mask++) {
      const subset: number[] = [];
      for (let b = 0; b < rest.length; b++) if (mask & (1 << b)) subset.push(rest[b]);
      if (subset.length < 2) continue;
      const hit = verifySumRelation(dataRows, c, subset);
      if (hit) hits.push(hit);
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) =>
    b.splitCols.length - a.splitCols.length ||
    b.ok - a.ok ||
    a.totalCol - b.totalCol ||
    (a.splitCols.join(',') < b.splitCols.join(',') ? -1 : 1),
  );
  return hits[0];
}

/** 表头模式兜底：候选中 ≥2 列呈「第N笔」或「N月」同模式 → 全标 amount（无合计核对） */
function headerSplitFallback(headerRow: Row, candidates: number[]): boolean {
  let pen = 0, month = 0;
  candidates.forEach(ci => {
    const h = String(headerRow?.[ci] || '').trim();
    if (PEN_HEADER_RE.test(h)) pen++;
    else if (MONTH_HEADER_RE.test(h)) month++;
  });
  return pen >= 2 || month >= 2;
}
```

（c）替换 `detectColumnMapping` 中 L110-127 的单列金额认领段（`let bestIdx: number | null = null...` 到数据兜底循环结束）为：

```ts
  // ---- 多列金额仲裁（2026-11-09 设计）：单列认领前先尝试；未命中回退下方单列逻辑 ----
  const candidates = collectAmountCandidates(headerRow, dataRows, mapping);
  let multiClaimed = false;
  if (candidates.length >= 2 && candidates.length <= 8) {
    const hit = arbitrateMultiAmount(dataRows, candidates);
    if (hit) {
      mapping[hit.totalCol] = 'amountTotal'; used.add('amountTotal');
      hit.splitCols.forEach(ci => { mapping[ci] = 'amount'; });
      used.add('amount');
      multiClaimed = true;
    } else if (headerSplitFallback(headerRow, candidates)) {
      candidates.forEach(ci => { mapping[ci] = 'amount'; });
      used.add('amount');
      multiClaimed = true;
    }
  }
  if (!multiClaimed) {
    let bestIdx: number | null = null, bestScore = -Infinity;
    headerRow.forEach((cell, i) => {
      if (mapping[i]) return;
      const s = getAmountColumnScore(cell, dataRows, i);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    });
    if (bestIdx != null && bestScore >= 5) { mapping[bestIdx] = 'amount'; used.add('amount'); }

    if (!used.has('amount')) {
      for (let ci = 0; ci < headerRow.length; ci++) {
        if (mapping[ci]) continue;
        let n = 0;
        for (let ri = 0; ri < Math.min(dataRows.length, 10); ri++) {
          if (isAmountLikeNumber(dataRows[ri]?.[ci])) n++;
        }
        if (n >= Math.min(dataRows.length, 10) * 0.5) { mapping[ci] = 'amount'; used.add('amount'); break; }
      }
    }
  }
```

- [ ] **Step 1.5: 运行确认通过**

Run: `npx vitest run tests/unit/mapping/column-detect.test.ts tests/unit/mapping/amount-score.test.ts tests/unit/mapping/row-expand.test.ts`
Expected: 全部 PASS（新增 8 用例 + 既有用例零回归）。

- [ ] **Step 1.6: Commit**

```bash
git add src/core/mapping/row-expand.ts src/core/mapping/column-detect.ts tests/unit/mapping/column-detect.test.ts
git commit -m "feat(mapping): 多列金额求和关系仲裁——候选收集+行级求和验证自动认领 amountTotal+多 amount，未命中回退单列逻辑字节级不变，修复拆分功能对第一笔/第二笔类表不触发"
```

---

### Task 2: 整理表导出即拆行（direct-export.ts）

**Files:**
- Modify: `src/core/export/direct-export.ts`
- Test: `tests/unit/export/direct-export.test.ts`

- [ ] **Step 2.1: 改写失败测试**

`tests/unit/export/direct-export.test.ts` 两处修改：

（a）顶部 import 改为：

```ts
import { buildRawDirectTable, buildMappedDirectTable } from '../../../src/core/export/direct-export';
import { detectColumnMapping } from '../../../src/core/mapping/column-detect';
import type { Rows } from '../../../src/types';
```

（b）把 L70-79 的 `it('多列金额全部保留不拆行，第 2 列起表头追加序号（税前金额2）', ...)` 整个替换为下面 6 个用例：

```ts
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
```

（c）在 `buildMappedDirectTable` describe 内再追加一条单金额列回归红线：

```ts
  it('单金额列（含合计列）与旧实现逐格一致，mismatches 恒空', () => {
    const t = buildMappedDirectTable(ROWS, COLS, { nameColIndex: null });
    expect(t.headers).toEqual(['姓名', '银行卡号', '税前金额']);
    expect(t.rows[0]).toEqual(['王辉2', '6222000011112222', '1234.5']);
    expect(t.mismatches).toEqual([]);
  });
```

- [ ] **Step 2.2: 运行确认失败**

Run: `npx vitest run tests/unit/export/direct-export.test.ts`
Expected: 新用例 FAIL（现状不拆行：headers 含「税前金额2」、rows 不展开；mismatches 属性不存在），既有其余用例 PASS。

- [ ] **Step 2.3: 实现 direct-export.ts**

`src/core/export/direct-export.ts` 全文替换为：

```ts
// 映射页直接导出（识别导出，2026-10-14 设计 docs/superpowers/specs/2026-10-14-mapping-direct-export-design.md）：
// 「映射页 → 直接落盘」短路径的纯函数构建层，与「确认映射 → 模版转换」管线并行、零耦合。
// 两种口径：
//  - 原表：所见即所得，与映射页数据预览逐格一致（人工校对覆盖由调用方取
//    state.mappingState.dataRows 带入——其已含 source.dataRowsOverride）；
//  - 整理表：按确认的列映射整理——COL_TYPE_LABELS 标准表头 + 值清洗（与模版管线净效果
//    同口径：姓名列先 cleanNameCell 剥注记再 cleanValue，金额 sanitizeAmount）+ 丢弃
//    不识别列与合计列；≥2 列金额时先 expandAmountSplitRows 拆行再清洗（2026-11-09 设计
//    docs/superpowers/specs/2026-11-09-direct-export-split-rows-design.md）——金额归一最左
//    拆分列、其余拆分列不输出，整理表只剩单「税前金额」列。
// 不读 state/localStorage，输入输出皆参数（core 禁读约定）。
import type { Rows } from '../../types';
import { COL_TYPE_LABELS } from '../mapping/column-detect';
import { expandAmountSplitRows, type SplitMismatch } from '../mapping/row-expand';
import { sanitizeAmount, cleanValue } from '../clean/values';
import { cleanNameCell } from '../clean/names';

/** 列元数据的宽松形状（state.mappingState.mapping.cols 与 DetectedColumn 均可直传） */
export type DirectCols = Record<string, { header?: string; type?: string }>;

export interface DirectTable {
  headers: string[];
  rows: Rows;
}

/** 整理表构建结果：mismatches 供 UI 层合计核对弹窗（core 纯函数不弹窗） */
export interface MappedDirectTable extends DirectTable {
  mismatches: SplitMismatch[];
}

/** 列序：键按数值升序（与映射页预览 colIndices 同口径） */
function orderedColIndices(cols: DirectCols): number[] {
  return Object.keys(cols).map(Number).sort((a, b) => a - b);
}

/**
 * 原表构建：表头 = 识别到的原始表头，数据逐格原样（空值出空串，不做任何清洗）。
 * nameColIndex 非空时仅对该列应用 cleanNameCell——调用方按预览同口径决定：
 * 未经人工编辑的源传姓名列号，编辑过的源（dataRowsOverride 存在）传 null（视为已校对）。
 */
export function buildRawDirectTable(
  dataRows: Rows, cols: DirectCols, opts: { nameColIndex: number | null },
): DirectTable {
  const indices = orderedColIndices(cols);
  const headers = indices.map(ci => String(cols[ci]?.header ?? '').trim() || `列${ci + 1}`);
  const rows = dataRows.map(row => indices.map(ci => {
    let v = row?.[ci] == null ? '' : String(row[ci]);
    if (opts.nameColIndex != null && ci === opts.nameColIndex) v = cleanNameCell(v);
    return v;
  }));
  return { headers, rows };
}

/**
 * 整理表构建：每个已识别列一列（列序升序），表头用 COL_TYPE_LABELS 标准名；
 * 「不识别」（空串）与「合计金额」（仅核对，不导出）丢弃。
 * ≥2 列金额 → 先 expandAmountSplitRows 拆行（复用确认映射管线同一纯函数：
 * 原值照抄、空/0 金额跳过、全拆分列空行保留 1 行、合计核对 mismatches 原样返回），
 * 再对拆行后行集清洗输出；金额归一最左拆分列，其余拆分列清空且不输出——
 * 整理表只剩单「税前金额」列（不再出现「税前金额2」空列）。
 * 备注来源标签（labelNote，默认关=产品开关默认）跟随映射页「备注标注来源」开关：
 * 开启且源无备注列时按 expandAmountSplitRows 返回的虚拟列号行尾追加「备注」列。
 * 值清洗与模版管线净效果同口径（confirmMapping 清姓名 → generate-output 清值）：
 * 姓名列先 cleanNameCell 再 cleanValue；amount → sanitizeAmount；其余 → cleanValue；
 * 出参 trim。不做行过滤，保留全部数据行。
 * 单金额列（<2 列 amount）行为与旧实现逐格一致（回归红线）。
 */
export function buildMappedDirectTable(
  dataRows: Rows, cols: DirectCols,
  opts: { nameColIndex: number | null, labelNote?: boolean },
): MappedDirectTable {
  const labelNote = opts.labelNote === true;
  const withType = orderedColIndices(cols).filter(ci => !!String(cols[ci]?.type ?? ''));
  const amountCols = withType.filter(ci => String(cols[ci]?.type ?? '') === 'amount');
  const totalColEntry = withType.find(ci => String(cols[ci]?.type ?? '') === 'amountTotal');
  const noteColEntry = withType.find(ci => String(cols[ci]?.type ?? '') === 'note');

  let workRows = dataRows;
  let mismatches: SplitMismatch[] = [];
  const dropped = new Set<number>();
  let virtualNoteCol: number | null = null;

  if (amountCols.length >= 2) {
    const res = expandAmountSplitRows(dataRows, {
      amountCols,
      totalCol: totalColEntry ?? null,
      noteCol: noteColEntry ?? null,
      labelOf: ci => String(cols[ci]?.header ?? '').trim() || `第 ${ci + 1} 列`,
      labelNote,
    });
    workRows = res.rows;
    mismatches = res.mismatches;
    amountCols.slice(1).forEach(ci => dropped.add(ci));
    if (noteColEntry == null && labelNote && res.noteCol != null) virtualNoteCol = res.noteCol;
  }

  const indices = withType.filter(ci =>
    !dropped.has(ci) && String(cols[ci]?.type ?? '') !== 'amountTotal',
  );
  const typeCount: Record<string, number> = {};
  const headers = indices.map(ci => {
    const type = String(cols[ci]?.type ?? '');
    const base = COL_TYPE_LABELS[type] || type;
    typeCount[type] = (typeCount[type] || 0) + 1;
    return typeCount[type] > 1 ? `${base}${typeCount[type]}` : base;
  });
  if (virtualNoteCol != null) headers.push(COL_TYPE_LABELS['note']);

  const rows = workRows.map(row => {
    const out = indices.map(ci => {
      const type = String(cols[ci]?.type ?? '');
      const cell = row?.[ci];
      let v: string;
      if (opts.nameColIndex != null && ci === opts.nameColIndex) v = cleanValue(cleanNameCell(cell == null ? '' : String(cell)), 'name');
      else if (type === 'amount') v = sanitizeAmount(cell);
      else v = cleanValue(cell, type);
      return String(v ?? '').trim();
    });
    if (virtualNoteCol != null) out.push(String(row?.[virtualNoteCol] ?? '').trim());
    return out;
  });
  return { headers, rows, mismatches };
}
```

- [ ] **Step 2.4: 运行确认通过**

Run: `npx vitest run tests/unit/export/direct-export.test.ts`
Expected: 全部 PASS（新 7 用例 + 既有用例零回归；注意 `税前金额2` 旧测试已被替换）。

- [ ] **Step 2.5: Commit**

```bash
git add src/core/export/direct-export.ts tests/unit/export/direct-export.test.ts
git commit -m "feat(export): 整理表导出即拆行——buildMappedDirectTable 复用 expandAmountSplitRows 先拆行后清洗，列集收敛单税前金额列，返回 mismatches 供 UI 合计核对弹窗，单金额列行为逐格不变"
```

---

### Task 3: UI 接线（mapping.ts exportDirect）

**Files:**
- Modify: `src/ui/steps/mapping.ts:462-476`（exportDirect 函数）及 L16 import 行

- [ ] **Step 3.1: 修改 import（L16）**

```ts
import { buildRawDirectTable, buildMappedDirectTable } from '../../core/export/direct-export';
import type { DirectTable, MappedDirectTable } from '../../core/export/direct-export';
```

- [ ] **Step 3.2: 修改 exportDirect（L462-476）**

替换为：

```ts
async function exportDirect(kind: 'raw' | 'mapped'): Promise<void> {
  const ms = state.mappingState;
  const dataRows = (ms?.dataRows || []) as Rows;
  const cols = ms?.mapping?.cols || {};
  if (!dataRows.length || !Object.keys(cols).length) { alert('没有可导出的数据'); return; }
  if (kind === 'mapped' && !Object.values(cols).some(col => col.type)) {
    alert('没有已识别的列，请先在上方确认列映射'); return;
  }
  const nameCol = directNameColIndex(cols, !!ms?.source?.dataRowsOverride);
  let table: DirectTable | MappedDirectTable;
  if (kind === 'raw') {
    table = buildRawDirectTable(dataRows, cols, { nameColIndex: nameCol });
  } else {
    const mapped = buildMappedDirectTable(dataRows, cols, { nameColIndex: nameCol, labelNote: splitNoteLabelsOn() });
    // 发钱场景零容错：拆分合计不平不静默落盘，弹窗明示、用户可返回修改（与 confirmMapping 同文案口径）
    if (mapped.mismatches.length) {
      const lines = mapped.mismatches.slice(0, 5)
        .map(m => `第 ${m.rowIndex + 1} 行：拆分合计 ${m.sum} ≠ 合计 ${m.declared}`)
        .join('\n');
      if (!confirm(`整理表有 ${mapped.mismatches.length} 行拆分金额之和与合计列不符：\n${lines}${mapped.mismatches.length > 5 ? '\n…' : ''}\n\n仍要继续导出吗？（取消可返回映射页修正后重新导出）`)) return;
    }
    table = mapped;
  }
  const wb = buildGenericWorkbook(table.headers, table.rows);
  await saveWorkbook(wb, `${directExportBaseName()}_${kind === 'raw' ? '识别原表' : '整理表'}_${getTodayStr()}.xlsx`);
}
```

- [ ] **Step 3.3: 类型检查 + 全量测试**

Run: `npm run typecheck && npm run test`
Expected: typecheck 零错误；vitest 全量 PASS（含 mapping.test.ts 等 UI 测试零回归）。

- [ ] **Step 3.4: Commit**

```bash
git add src/ui/steps/mapping.ts
git commit -m "feat(ui): 导出整理表接线拆行——labelNote 跟随备注标注来源开关，mismatches 弹窗核对不平不静默落盘（与 confirmMapping 同口径）"
```

---

### Task 4: 全量回归与收尾

**Files:** 无新改动（验证任务）

- [ ] **Step 4.1: compare 基线回归**

Run: `npm run compare`
Expected: 全部用例逐格一致（近期基线为 32 用例 224 产物零 diff）。若个别 fixture 触发多列仲裁导致 diff：逐个打开产物人工确认——正确行为（多列拆分表自动拆行/合计列核对）则更新基线（`npm run baseline` 重建后复跑 compare）并在 commit message 说明；不正确则回到 Task 1 修仲裁逻辑，绝不过基线硬塞。

- [ ] **Step 4.2: 构建 + 浏览器手动冒烟**

Run: `npm run build`
Expected: tsc + vite build 零错误。

手动冒烟（`npm run dev` 打开页面）：
1. 导入用户真实表格「26年10月天九分润」→ 映射页应自动出现蓝色提示「检测到 2 列税前金额，确认后将展开为 N 行发放记录」，且「税后」列下拉显示「合计金额（仅核对，不导出）」、「第一笔」「第二笔」显示「税前金额」；
2. 点「导出整理表」→ 得到标准表头（姓名/税前金额/银行卡号/身份证/手机号）且每人两笔拆为两行（空笔跳过）、无「税前金额2」列；
3. 勾选「备注标注来源」再导出一次 → 行尾多「备注」列，值为「第一笔/第二笔」；
4. 点「导出原表」→ 与预览逐格一致（不拆行，回归确认）。

- [ ] **Step 4.3: 若基线有更新则 commit**

```bash
git add tests/fixtures/baseline
git commit -m "test(baseline): 多列金额仲裁生效后的基线更新——逐产物人工确认拆行/合计核对行为正确"
```

（若 Step 4.1 零 diff 则跳过本步。）
