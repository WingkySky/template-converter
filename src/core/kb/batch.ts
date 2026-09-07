// 批次号生成 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 B）。
// 原 legacy.js 锚点：PINYIN_INITIAL_SPECIALS L1028、PINYIN_BOUNDARIES L1032、chineseInitial L1039、
// shortNameForBatch L1052、initialsForBatchName L1059、buildBatchNoFromShangShe L1065、
// applyBatchShangShe L1071、dedupeBatchNo L3384。
// 去 state 化说明（唯一结构性改动）：applyBatchShangShe 原函数写 state（batchShangSheId/
// batchShangSheName/batchNo）并调用 getShangSheIdFromLookup（内部 loadKB）。core 侧拆为
// 纯计算函数 kbComputeBatchShangShe(kb, lookup, id) 返回三元组；state 写入留在 legacy.js
// 的 applyBatchShangShe 包装函数中（见交付报告补丁块）。
// getTodayStr 为 legacy.js L3089 的逐字私有副本（naming.ts 归 C 分区，为避免跨分区依赖暂存于此，
// 行为完全一致；C 分区落地后主智能体可统一指向 naming.ts）。
import type { KB } from './model';
import { kbGetShangSheIdFromLookup, type ShangSheLookup } from './shangshe';

const PINYIN_INITIAL_SPECIALS: Record<string, string> = {
  晟: 'S', 联: 'L', 数: 'S', 码: 'M', 博: 'B', 跃: 'Y', 重: 'C', 长: 'C', 厦: 'X', 曾: 'Z', 单: 'S'
};

const PINYIN_BOUNDARIES = [
  ['A','阿'], ['B','八'], ['C','嚓'], ['D','咑'], ['E','妸'], ['F','发'], ['G','旮'],
  ['H','哈'], ['J','讥'], ['K','咖'], ['L','垃'], ['M','妈'], ['N','拿'], ['O','哦'],
  ['P','啪'], ['Q','七'], ['R','呥'], ['S','仨'], ['T','他'], ['W','哇'], ['X','夕'],
  ['Y','丫'], ['Z','匝']
];

export function chineseInitial(ch: string): string {
  if (!ch) return '';
  if (/[A-Za-z]/.test(ch)) return ch.toUpperCase();
  if (!/[\u4e00-\u9fff]/.test(ch)) return '';
  if (PINYIN_INITIAL_SPECIALS[ch]) return PINYIN_INITIAL_SPECIALS[ch];
  let initial = 'Z';
  for (const [letter, boundary] of PINYIN_BOUNDARIES) {
    if (ch.localeCompare(boundary, 'zh-Hans-CN-u-co-pinyin') >= 0) initial = letter;
    else break;
  }
  return initial;
}

export function shortNameForBatch(shortName: string | null | undefined): string {
  let s = String(shortName || '').trim();
  if (!s) return '';
  s = s.split(/[-－—]/).filter(Boolean).pop()!.trim();
  return s.replace(/有限公司|有限责任公司|公司|集团/g, '') || s;
}

export function initialsForBatchName(name: string | null | undefined): string {
  const raw = String(name || '').trim();
  const initials = Array.from(raw).map(chineseInitial).join('');
  return initials || 'UNKNOWN';
}

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

export function buildBatchNoFromShangShe(lookup: ShangSheLookup | null | undefined): string {
  if (!lookup) return '';
  const baseName = shortNameForBatch(lookup.shortName || lookup.fullName);
  return `${getTodayStr()}${initialsForBatchName(baseName)}-A`;
}

export interface BatchShangSheState {
  batchShangSheId: string;
  batchShangSheName: string;
  batchNo: string;
}

// applyBatchShangShe 的纯核心：计算三个 state 字段值（不写 state，state 写入在 legacy 包装函数）
export function kbComputeBatchShangShe(
  kb: KB,
  lookup: ShangSheLookup | null | undefined,
  id: string | null | undefined,
): BatchShangSheState {
  const batchShangSheId = id || kbGetShangSheIdFromLookup(kb, lookup);
  const batchShangSheName = lookup?.shortName || lookup?.fullName || '';
  const batchNo = buildBatchNoFromShangShe(lookup);
  return { batchShangSheId, batchShangSheName, batchNo };
}

// 批次号去重：buildBatchNoFromShangShe 固定以 -A 结尾，冲突时递增为 -B/-C...
export function dedupeBatchNo(batchNo: string, existingSet: Set<string>): string {
  if (!existingSet.has(batchNo)) return batchNo;
  const m = batchNo.match(/^(.*)-([A-Z])$/);
  const base = m ? m[1] : batchNo;
  let idx = m ? m[2].charCodeAt(0) - 64 : 0;
  let candidate = batchNo;
  do { idx++; candidate = `${base}-${String.fromCharCode(64 + idx)}`; }
  while (existingSet.has(candidate) && idx < 26);
  return candidate;
}
