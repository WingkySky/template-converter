// 多列金额拆行（2026-10-15 设计，docs/superpowers/specs/2026-10-15-amount-split-rows-design.md）：
// 客户把发放费用拆到多列（第一笔/第二笔，另有代扣缴后总额列）时，确认映射阶段把同一行内
// 每个非空拆分列展开成一行同名要素的发放记录，金额归一写入最左拆分列（= typeToCol.amount），
// 其余拆分列清空——导出管线（单金额列假设）零改动。
// 红线：金额列 ≤1 时返回原数据引用（单金额列场景字节级不变，compare 基线零变化）；
// 0/空/不可解析一律视同空跳过；全部拆分列空的行保留原行 1 行；
// 备注来源标签追加不覆盖，源表无备注列时行尾追加虚拟备注列（所有行对齐补齐）。
import type { Row, Rows } from '../../types';

export interface ExpandAmountSplitOptions {
  /** 参与拆行的税前金额列（升序）；长度 ≤1 时不拆行 */
  amountCols: number[];
  /** 合计金额列（仅核对，不参与拆行与导出） */
  totalCol?: number | null;
  /** 既有备注列；labelNote 开启且无此列时行尾追加虚拟备注列 */
  noteCol?: number | null;
  /** 拆分列的来源标签（一般为列头文本，如「第一笔」） */
  labelOf?: (ci: number) => string;
  /** 拆分行备注标注来源（默认 true=写「第一笔」等标签；2026-10-15 用户要求产品默认关，
   *  UI 层经设置开关控制并传入）。关闭时不写标签、不追加虚拟备注列，既有备注原样保留 */
  labelNote?: boolean;
}

export interface SplitMismatch {
  /** 原始行在有效数据中的下标（0 起） */
  rowIndex: number;
  sum: number;
  declared: number;
}

export interface ExpandAmountSplitResult {
  rows: Rows;
  /** 实际备注列下标（追加虚拟列时为新列索引；未动备注时为传入值或 null） */
  noteCol: number | null;
  mismatches: SplitMismatch[];
  /** 拆行后总行数 */
  expandedRowCount: number;
}

/** 宽松数值化：剥离千分位/币符/空白后转 Number；不可解析/0 视同空（返回 null） */
function parseAmountValue(raw: unknown): number | null {
  const s = String(raw ?? '').replace(/[,，\s￥¥]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function expandAmountSplitRows(dataRows: Rows, opts: ExpandAmountSplitOptions): ExpandAmountSplitResult {
  const amountCols = [...opts.amountCols].sort((a, b) => a - b);
  const noteColIn = opts.noteCol ?? null;
  if (amountCols.length <= 1) {
    return { rows: dataRows, noteCol: noteColIn, mismatches: [], expandedRowCount: dataRows.length };
  }

  const target = amountCols[0];
  const labelOf = opts.labelOf ?? ((ci: number) => `第 ${ci + 1} 列`);
  const labelNote = opts.labelNote !== false;

  // 虚拟备注列：标注开启且源表无备注列时追加在行尾（所有行对齐补齐）
  const width = dataRows.reduce((w, r) => Math.max(w, r.length), 0);
  const noteIdx = noteColIn ?? (labelNote ? width : null);
  const outWidth = noteColIn != null ? width : (labelNote ? width + 1 : width);

  const rows: Rows = [];
  const mismatches: SplitMismatch[] = [];

  dataRows.forEach((row, ri) => {
    const cells: Row = [];
    for (let i = 0; i < outWidth; i++) cells.push(row?.[i] ?? '');
    if (noteColIn == null && noteIdx != null) cells[noteIdx] = '';

    // 合计核对：sum(全部拆分列数值) vs 合计列（拆分列不可解析按 0 计入）
    if (opts.totalCol != null) {
      let sum = 0;
      amountCols.forEach(ci => {
        const v = parseAmountValue(row?.[ci]);
        if (v != null) sum += v;
      });
      const rawDeclared = String(row?.[opts.totalCol] ?? '').replace(/[,，\s￥¥]/g, '');
      const declared = Number(rawDeclared);
      if (Number.isFinite(declared) && rawDeclared !== '' && /\d/.test(rawDeclared)) {
        const tolerance = Math.max(0.02, Math.abs(declared) * 1e-6);
        if (Math.abs(sum - declared) > tolerance) {
          mismatches.push({ rowIndex: ri, sum: Math.round(sum * 100) / 100, declared: Math.round(declared * 100) / 100 });
        }
      }
    }

    const splits = amountCols
      .map(ci => ({ ci, value: parseAmountValue(row?.[ci]) }))
      .filter((s): s is { ci: number; value: number } => s.value != null);

    if (splits.length === 0) {
      rows.push(cells); // 全部拆分列空 → 保留原行 1 行
      return;
    }
    splits.forEach(({ ci }) => {
      const newRow: Row = [...cells];
      newRow[target] = row?.[ci] ?? ''; // 金额逐字符照抄原值（含千分位），归一写入目标列
      amountCols.forEach(other => {
        if (other !== target) newRow[other] = '';
      });
      if (labelNote && noteIdx != null) {
        const label = labelOf(ci);
        newRow[noteIdx] = [String(cells[noteIdx] ?? '').trim(), String(label ?? '').trim()]
          .filter(Boolean)
          .join('；');
      }
      rows.push(newRow);
    });
  });

  return { rows, noteCol: noteIdx, mismatches, expandedRowCount: rows.length };
}
