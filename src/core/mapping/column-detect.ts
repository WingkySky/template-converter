// 列类型识别 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），
// 仅补充类型注解与显式 export，不改变任何行为。
// COL_KEYWORDS / COL_TYPE_LABELS 在 legacy.js 中为隐式全局常量（legacy.js L1217/L1232），
// 供本模块与 smartDetectTable、UI 层共同引用。
// 唯一行为偏差（2026-10-15，用户反馈卡号常被识别成银行名）：bankCard 认领前的
// 银行名称仲裁，见 detectColumnMapping 内注释。
import type { Row, Rows } from '../../types';
import { getAmountColumnScore, isAmountLikeNumber } from './amount-score';
import { parseAmountValue } from './row-expand';

export const COL_KEYWORDS: Record<string, RegExp> = {
  name:       /姓名|户名|名称|人员|收款人|员工|name|person/i,
  idCard:     /身份证|身份证号|身份证号码|id\s*card|idcard|证件号/i,
  phone:      /电话|phone|手机|mobile|联系电话/i,
  bankName:   /开户行|开户银行|银行名称|bank\s*name/i,
  bankCard:   /银行|bank|卡号|bankcard|账号|账户|个人银行卡号/i,
  amount:     /金额|amount|收入|income|报酬|pay|税前金额|税前收入|税后收入|应发金额|实发金额|计划发放收入|发放金额|付款金额|应发金额\(含税\)|应发金额（含税）/i,
  gender:     /性别|gender|sex/i,
  location:   /开户地|开户所属地|银行所属地|税源地/i,
  note:       /备注|note|说明|remark/i,
  shangSheId: /商社编号|商社代码|商户编号/i,
  clientName: /客户名称|公司名称|委托方名称?|甲方名称?/i,
  taxId: /纳税人识别号|统一信用代码|统一社会信用代码|税号|信用代码/i,
};

export const COL_TYPE_LABELS: Record<string, string> = {
  '':         '— 不识别 —',
  name:       '姓名',
  idCard:     '身份证',
  phone:      '手机号',
  bankName:   '开户银行',
  bankCard:   '银行卡号',
  amount:     '税前金额',
  amountTotal: '合计金额（仅核对，不导出）',
  gender:     '性别',
  location:   '开户地/税源地',
  note:       '备注',
  shangSheId: '商社编号',
  clientName: '客户名称',
  taxId: '纳税人识别号',
};

/** detectColumnMapping 返回的单列识别信息（type 为空串表示未识别，与 legacy 行为一致） */
export interface DetectedColumn {
  header: string;
  type: string;
  samples: string[];
}

// bankCard 显式字样：表头含这些字样时视为明确的卡号/账号列，不做数据仲裁
const BANK_CARD_HINT_RE = /卡|账号|帐号|账户|card/i;

// 开户地字样：表头含这些字样时绝不认 bankCard——「银行卡开户地」含「卡」字会骗过
// BANK_CARD_HINT_RE 抢走 bankCard，真卡号列（如「账号★」）落空（2026-10-27 友谊发薪
// 明细）；直接跳过让位给后置的 location 认领
const LOCATION_HEADER_RE = /开户地|开户所属地|银行所属地|税源地/;

/**
 * 卡号样数据占比：前 12 个非空样本中「去空白后 10~23 位纯数字」的比例。
 * 无非空样本时返回 1——无数据可佐证就保持 legacy 纯关键词行为。
 */
function cardLikeRatio(dataRows: Rows, ci: number): number {
  let nonEmpty = 0, hits = 0;
  dataRows.slice(0, 12).forEach(row => {
    const v = String(row?.[ci] ?? '').trim();
    if (!v) return;
    nonEmpty++;
    if (/^\d{10,23}$/.test(v.replace(/\s+/g, ''))) hits++;
  });
  return nonEmpty ? hits / nonEmpty : 1;
}

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

/**
 * detectColumnMapping 的返回。
 * amountCol / nameCol 由 analyzeSheet 在识别后补写（legacy 中为动态挂载属性），
 * detectColumnMapping 本身只返回 { cols }，故为可选属性。
 */
export interface ColumnMapping {
  cols: Record<string, DetectedColumn>;
  amountCol?: number | null;
  nameCol?: number | null;
}

export function detectColumnMapping(headerRow: Row, dataRows: Rows): ColumnMapping {
  const mapping: Record<number, string | undefined> = {};
  const used = new Set<string>();

  headerRow.forEach((cell, i) => {
    const v = String(cell || '').trim();
    if (!v) return;
    for (const [type, re] of Object.entries(COL_KEYWORDS)) {
      if (type === 'amount') continue;
      if (used.has(type) || !re.test(v)) continue;
      // 银行名称仲裁（2026-10-15 用户反馈：收费通知表「开户行/开户银行/账号」三列并存，
      // 「开户银行」列因含「银行」抢占 bankCard，支行名被当卡号，真卡号列「账号」落空）：
      // 表头只有宽泛「银行/bank」语义而无卡/账号字样的列，多半装的是银行名，绝不认 bankCard——
      // bankName 空闲且数据非卡号样式时顺势认领为 bankName，否则留空让位给后面的真卡号列。
      if (type === 'bankCard' && LOCATION_HEADER_RE.test(v)) continue;
      if (type === 'bankCard' && !BANK_CARD_HINT_RE.test(v)) {
        // 数据不像卡号 → 判为银行名称列：bankName 空闲则顺势认领，否则留空让位给真卡号列
        if (cardLikeRatio(dataRows, i) < 0.5) {
          if (!used.has('bankName')) { mapping[i] = 'bankName'; used.add('bankName'); }
          continue;
        }
        // 数据确为长数字 → 落到下方 bankCard 认领（裸「银行」列装卡号的 legacy 行为）
      }
      mapping[i] = type; used.add(type); break;
    }
  });

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

  const cols: Record<string, DetectedColumn> = {};
  headerRow.forEach((cell, i) => {
    const v = String(cell || '').trim();
    if (!v && mapping[i] == null) return;
    const samples: string[] = [];
    for (let ri = 0; ri < Math.min(dataRows.length, 3); ri++) {
      const sv = dataRows[ri]?.[i];
      if (sv != null && String(sv).trim()) samples.push(String(sv).trim());
    }
    cols[i] = { header: v || `列${i+1}`, type: mapping[i] || '', samples };
  });
  return { cols };
}

/**
 * 按数据特征推断姓名列并写回 autoMap（图片源专用 opt-in——表头可能是「9月」这类
 * 月份标注而非「姓名」，关键词匹配必然落空，2026-10-14 用户实测案例）。
 * 只在图片源（source.ocr 存在）时调用，绝不触碰 CSV/Excel/PDF 基线行为（compare 红线）。
 * 判据（保守）：该列 ≥60% 非空样本是 2~6 字纯中文（·分隔支持）且非费用/汇总标签，
 * 至少 3 行；多列达标取占比最高（并列取最左）。已有 name 列时不做任何事。
 * @returns 是否发生了写回
 */
export function applyInferredNameByData(headerRow: Row, dataRows: Rows, autoMap: ColumnMapping): boolean {
  const alreadyNamed = Object.values(autoMap.cols).some(col => col.type === 'name');
  if (alreadyNamed || autoMap.nameCol != null) return false;

  const sampleN = Math.min(dataRows.length, 20);
  if (sampleN < 3) return false;
  const NAME_LIKE_RE = /^[\u4e00-\u9fff·]{2,6}$/;
  // 内联费用/汇总标签前缀（不 import table-detect 的 FEE_LABEL_RE——它反过来依赖本模块，会成环）
  const FEE_PREFIX_RE = /^(合计|总计|小计|累计|汇总|平台|服务费|手续费|费率|税率|金额|开票)/;
  const width = Math.max(headerRow.length, ...dataRows.slice(0, sampleN).map(r => r.length));
  let best = -1;
  let bestShare = 0;
  for (let ci = 0; ci < width; ci++) {
    if (autoMap.cols[String(ci)]?.type) continue; // 已识别类型的列不参与推断
    let nonEmpty = 0;
    let nameLike = 0;
    for (let ri = 0; ri < sampleN; ri++) {
      const v = String(dataRows[ri]?.[ci] ?? '').trim();
      if (!v) continue;
      nonEmpty++;
      if (NAME_LIKE_RE.test(v) && !FEE_PREFIX_RE.test(v)) nameLike++;
    }
    if (nonEmpty < 3) continue;
    const share = nameLike / nonEmpty;
    if (share >= 0.6 && share > bestShare) { bestShare = share; best = ci; }
  }
  if (best < 0) return false;

  const samples: string[] = [];
  for (let ri = 0; ri < Math.min(dataRows.length, 3); ri++) {
    const sv = dataRows[ri]?.[best];
    if (sv != null && String(sv).trim()) samples.push(String(sv).trim());
  }
  const header = String(headerRow?.[best] || '').trim() || `第 ${best + 1} 列`;
  autoMap.cols[best] = { header, type: 'name', samples };
  autoMap.nameCol = best;
  return true;
}
