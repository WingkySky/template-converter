// 映射页直接导出（识别导出，2026-10-14 设计 docs/superpowers/specs/2026-10-14-mapping-direct-export-design.md）：
// 「映射页 → 直接落盘」短路径的纯函数构建层，与「确认映射 → 模版转换」管线并行、零耦合。
// 两种口径：
//  - 原表：所见即所得，与映射页数据预览逐格一致（人工校对覆盖由调用方取
//    state.mappingState.dataRows 带入——其已含 source.dataRowsOverride）；
//  - 整理表：按确认的列映射整理——COL_TYPE_LABELS 标准表头 + 值清洗（与模版管线净效果
//    同口径：姓名列先 cleanNameCell 剥注记再 cleanValue，金额 sanitizeAmount）+ 丢弃
//    不识别列与合计列；多列金额不拆行、全部保留（拆行属模版管线职责）。
// 不读 state/localStorage，输入输出皆参数（core 禁读约定）。
import type { Rows } from '../../types';
import { COL_TYPE_LABELS } from '../mapping/column-detect';
import { sanitizeAmount, cleanValue } from '../clean/values';
import { cleanNameCell } from '../clean/names';

/** 列元数据的宽松形状（state.mappingState.mapping.cols 与 DetectedColumn 均可直传） */
export type DirectCols = Record<string, { header?: string; type?: string }>;

export interface DirectTable {
  headers: string[];
  rows: Rows;
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
 * 同类型多列全部保留，第 2 列起表头追加序号（税前金额、税前金额2……）——保表头唯一
 * 且零丢列；金额不拆行是既定决策。
 * 值清洗与模版管线净效果同口径（confirmMapping 清姓名 → generate-output 清值）：
 * 姓名列先 cleanNameCell 再 cleanValue；amount → sanitizeAmount；其余 → cleanValue；
 * 出参 trim。不做行过滤（无身份列丢弃/全空行跳过均不适用），保留全部数据行。
 */
export function buildMappedDirectTable(
  dataRows: Rows, cols: DirectCols, opts: { nameColIndex: number | null },
): DirectTable {
  const indices = orderedColIndices(cols).filter(ci => {
    const type = String(cols[ci]?.type ?? '');
    return !!type && type !== 'amountTotal';
  });
  const typeCount: Record<string, number> = {};
  const headers = indices.map(ci => {
    const type = String(cols[ci]?.type ?? '');
    const base = COL_TYPE_LABELS[type] || type;
    typeCount[type] = (typeCount[type] || 0) + 1;
    return typeCount[type] > 1 ? `${base}${typeCount[type]}` : base;
  });
  const rows = dataRows.map(row => indices.map(ci => {
    const type = String(cols[ci]?.type ?? '');
    const cell = row?.[ci];
    let v: string;
    if (opts.nameColIndex != null && ci === opts.nameColIndex) v = cleanValue(cleanNameCell(cell == null ? '' : String(cell)), 'name');
    else if (type === 'amount') v = sanitizeAmount(cell);
    else v = cleanValue(cell, type);
    return String(v ?? '').trim();
  }));
  return { headers, rows };
}
