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
