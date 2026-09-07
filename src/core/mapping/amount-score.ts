// 金额列打分与金额样值识别 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），
// 仅补充类型注解，不改变任何行为。
import type { Cell, Rows } from '../../types';

export function isAmountLikeNumber(value: Cell): boolean {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return false;
  // 剥离货币符号（货币格式单元格经 raw:false 读取后形如 "¥90,100.00"）
  const compact = raw.replace(/[¥￥$€£,，\s]/g, '').replace(/(元|人民币)$/,'');
  if (/^\d{11}$/.test(compact) || /^\d{16,19}$/.test(compact) || /^\d{17}[\dXx]$/.test(compact)) return false;
  const num = parseFloat(compact);
  return !isNaN(num) && isFinite(num) && num > 0 && num < 1e8;
}

export function getAmountColumnScore(header: Cell, dataRows: Rows, ci: number): number {
  const h = String(header || '').trim();
  if (!h || /序号|编号|方式|类型|选择|状态|税源地|开户|账号|账户|手机号|电话|身份证|证件|银行|备注|说明|业务|减除|扣除|速算|核定|预扣|免税|服务费|个税/.test(h)) return -Infinity;
  let score = 0;
  if (/税前金额|税前收入/i.test(h)) score += 12;
  else if (/计划发放收入|应发金额|实发金额|客户支付合计|付款金额|应发金额/i.test(h)) score += 9;
  else if (/金额|amount|收入额|合计金额|应付金额/i.test(h)) score += 6;
  const sample = dataRows.slice(0, 12);
  if (!sample.length) return score;
  let hits = 0;
  sample.forEach(row => { if (isAmountLikeNumber(row?.[ci])) hits++; });
  const ratio = hits / sample.length;
  score += ratio * 8;
  // 仅在无关键词命中时才施加低命中率惩罚
  // （低命中率通常因数据行质量差导致，表头关键词是更可靠的信号）
  if (ratio < 0.35 && score < 6) score -= 8;
  return score;
}
