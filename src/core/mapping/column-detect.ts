// 列类型识别 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），
// 仅补充类型注解与显式 export，不改变任何行为。
// COL_KEYWORDS / COL_TYPE_LABELS 在 legacy.js 中为隐式全局常量（legacy.js L1217/L1232），
// 供本模块与 smartDetectTable、UI 层共同引用。
// 唯一行为偏差（2026-10-15，用户反馈卡号常被识别成银行名）：bankCard 认领前的
// 银行名称仲裁，见 detectColumnMapping 内注释。
import type { Row, Rows } from '../../types';
import { getAmountColumnScore, isAmountLikeNumber } from './amount-score';

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
