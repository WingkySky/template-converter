// 同人多条合并（2026-10-14 设计，docs/superpowers/specs/2026-10-14-row-merge-design.md）：
// 同一批次内同一结算人出现多条记录（多家门店/跨月各一笔）时，确认映射阶段把同人合并成
// 一条发放记录：金额逐列求和、已映射要素列必须一致（冲突整组不合并、预警待人工）、
// 未映射列取首条、文本型差异去重拼接进备注。
// 红线：merge 关闭（产品默认）/无重复组/无判重键列时返回原数据引用（字节级不变，
// compare 基线零变化）；与拆行的衔接顺序为「姓名清洗 → 同人合并 → 多列拆行」。
import type { Row, Rows } from '../../types';

export interface MergeSamePersonOptions {
  /** 列类型 → 列号（confirmMapping 的 typeToCol 口径；amount/amountTotal/note 类型在函数内排除） */
  typeToCol: Record<string, number | null>;
  /** 参与求和的金额列（通常 1 列；多列金额场景逐列求和后再交给拆行） */
  amountCols: number[];
  /** 列号 → 列头文本（冲突明细与差异备注用，如「门店」） */
  labelOf?: (ci: number) => string;
  /** 是否真正合并（产品默认关；false 时仅探测重复组供预警条提示，返回原数据引用） */
  merge?: boolean;
}

/** 重复/合并组信息（key 为内部判重键；name 为展示用姓名） */
export interface MergeGroupInfo {
  key: string;
  name: string;
  count: number;
}

/** 要素冲突明细项：列号、列头、互异原值（首现顺序） */
export interface MergeConflictItem {
  ci: number;
  label: string;
  vals: string[];
}

/** 要素冲突、保持不合并的组 */
export interface MergeConflict extends MergeGroupInfo {
  items: MergeConflictItem[];
}

export interface MergeSamePersonResult {
  rows: Rows;
  /** 判重键重复的全部组（含合并成功与冲突不合并的） */
  dupGroups: MergeGroupInfo[];
  /** 实际合并的组（merge 关闭时为空；冲突组不在此列） */
  groups: MergeGroupInfo[];
  /** 要素冲突、保持不合并的组 */
  conflicts: MergeConflict[];
  /** 判重键全缺、不参与合并的行数 */
  noKeyCount: number;
}

/** 判重/比对归一：去所有空白（含换行——样张卡号实测带 \n 尾巴） */
function norm(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, '');
}

/** 数值化：剥离千分位/币符/空白后须为纯数字；返回数值与小数位数（整数缩放求和用） */
function parseAmount(raw: unknown): { num: number; decimals: number } | null {
  const s = String(raw ?? '').replace(/[,，\s￥¥]/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return { num: n, decimals: (s.split('.')[1] || '').length };
}

/** 逐金额列求和：按最大小数位整数缩放避免浮点累加误差；全列不可解析返回 null（保留首条原值） */
function sumAmountCell(raws: unknown[]): string | null {
  const parsed = raws.map(r => parseAmount(r));
  if (!parsed.some(p => p != null)) return null;
  const decimals = Math.max(0, ...parsed.map(p => p?.decimals ?? 0));
  const scale = Math.pow(10, decimals);
  const acc = parsed.reduce((sum, p) => (p ? sum + Math.round(p.num * scale) : sum), 0);
  return (acc / scale).toFixed(decimals);
}

/** 文本型差异判定：剥去千分位/小数点/空白后至少一值含非数字字符（纯数字对如 45/49、26.05/25.87 不写备注） */
function isTextualDiff(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/[,，\s.。]/g, '');
  return !(/^-?\d*$/.test(strip(a)) && /^-?\d*$/.test(strip(b)));
}

/** 列内互异非空值（归一空白判同，保留首现原值用于展示） */
function distinctValues(rows: Row[], ci: number): string[] {
  const seen: { key: string; display: string }[] = [];
  rows.forEach(r => {
    const raw = String(r?.[ci] ?? '').trim();
    if (!raw) return;
    const key = norm(raw);
    if (!seen.some(s => s.key === key)) seen.push({ key, display: raw });
  });
  return seen.map(s => s.display);
}

export function mergeSamePersonRows(dataRows: Rows, opts: MergeSamePersonOptions): MergeSamePersonResult {
  const empty: MergeSamePersonResult = { rows: dataRows, dupGroups: [], groups: [], conflicts: [], noKeyCount: 0 };
  const typeToCol = opts.typeToCol || {};
  const idCardCol = typeToCol.idCard != null ? typeToCol.idCard : null;
  const nameCol = typeToCol.name != null ? typeToCol.name : null;
  const phoneCol = typeToCol.phone != null ? typeToCol.phone : null;
  const noteCol = typeToCol.note != null ? typeToCol.note : null;
  if (idCardCol == null && nameCol == null) return empty; // 无姓名无证号：无从判重

  // 已映射要素列 = 全部映射列剔除金额/合计/备注（同列多类型去重）
  const elementCis = [...new Set(
    Object.entries(typeToCol)
      .filter(([type, ci]) => ci != null && type !== 'amount' && type !== 'amountTotal' && type !== 'note')
      .map(([, ci]) => Number(ci)),
  )];
  const amountCis = [...new Set((opts.amountCols || []).map(Number))];
  const labelOf = opts.labelOf ?? ((ci: number) => `第 ${ci + 1} 列`);
  const merge = opts.merge === true;

  const keyOf = (row: Row): string | null => {
    if (idCardCol != null) {
      const id = norm(row?.[idCardCol]);
      if (id) return 'id:' + id;
    }
    const nm = nameCol != null ? norm(row?.[nameCol]) : '';
    const ph = phoneCol != null ? norm(row?.[phoneCol]) : '';
    if (nm && ph) return 'np:' + nm + '|' + ph;
    return null;
  };

  // 按判重键分组，保持首现顺序；无键行单独计数
  const order: string[] = [];
  const buckets = new Map<string, number[]>();
  let noKeyCount = 0;
  dataRows.forEach((row, ri) => {
    const key = keyOf(row);
    if (key == null) { noKeyCount++; return; }
    if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
    buckets.get(key)!.push(ri);
  });

  const nameOf = (key: string, groupRows: Row[]): string => {
    if (nameCol != null) {
      const nm = String(groupRows[0]?.[nameCol] ?? '').trim();
      if (nm) return nm;
    }
    return key.replace(/^(id|np):/, '');
  };

  // 重复组探测（merge 关闭时也要报告，供预警条「检测到重复」提示）
  const dupGroups: MergeGroupInfo[] = [];
  const groups: MergeGroupInfo[] = [];
  const conflicts: MergeConflict[] = [];
  /** 组首行下标 → 合并后行（仅实际合并的组） */
  const mergedByFirstRow = new Map<number, Row>();
  /** 被并入组首行、应从输出中跳过的行下标 */
  const skipRows = new Set<number>();

  order.forEach(key => {
    const idxs = buckets.get(key)!;
    if (idxs.length <= 1) return;
    const groupRows = idxs.map(ri => dataRows[ri]);
    dupGroups.push({ key, name: nameOf(key, groupRows), count: idxs.length });

    // 要素一致性：逐列收集互异非空值（忽略空值——OCR 半行空值不阻塞合并）
    const items: MergeConflictItem[] = [];
    elementCis.forEach(ci => {
      const vals = distinctValues(groupRows, ci);
      if (vals.length >= 2) items.push({ ci, label: labelOf(ci), vals });
    });
    if (items.length) {
      conflicts.push({ key, name: nameOf(key, groupRows), count: idxs.length, items });
      return; // 整组不合并，行保持原样
    }
    if (!merge) return; // 仅探测不合并

    const first = groupRows[0] || [];
    const width = Math.max(...groupRows.map(r => r?.length ?? 0));
    const out: Row = [];
    for (let i = 0; i < width; i++) out.push(first[i] ?? '');

    // 要素列：取组内首个非空原值（防首行空值卡位）
    elementCis.forEach(ci => {
      const hit = groupRows.find(r => norm(r?.[ci]) !== '');
      if (hit) out[ci] = hit[ci];
    });
    // 金额列：逐列求和（按最大小数位对齐）；全列不可解析保留首条原值
    amountCis.forEach(ci => {
      const sum = sumAmountCell(groupRows.map(r => r?.[ci]));
      if (sum != null) out[ci] = sum;
    });
    // 未映射列取首条（out 初值）；文本型差异去重拼接进备注
    if (noteCol != null) {
      const parts: string[] = [];
      for (let ci = 0; ci < width; ci++) {
        if (elementCis.includes(ci) || amountCis.includes(ci) || ci === noteCol) continue;
        const vals = distinctValues(groupRows, ci);
        if (vals.length < 2) continue;
        if (!vals.some((v, i) => vals.slice(i + 1).some(w => isTextualDiff(v, w)))) continue;
        parts.push(`${labelOf(ci)}：${vals.join('、')}`);
      }
      if (parts.length) {
        out[noteCol] = [String(first[noteCol] ?? '').trim(), ...parts].filter(Boolean).join('；');
      }
    }

    groups.push({ key, name: nameOf(key, groupRows), count: idxs.length });
    mergedByFirstRow.set(idxs[0], out);
    idxs.slice(1).forEach(ri => skipRows.add(ri));
  });

  if (!mergedByFirstRow.size) {
    return { rows: dataRows, dupGroups, groups, conflicts, noKeyCount };
  }
  const rows: Rows = [];
  dataRows.forEach((row, ri) => {
    if (skipRows.has(ri)) return; // 已并入组首行
    const merged = mergedByFirstRow.get(ri);
    rows.push(merged ?? row);
  });
  return { rows, dupGroups, groups, conflicts, noKeyCount };
}
