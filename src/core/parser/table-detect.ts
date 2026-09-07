// 智能表格识别 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），
// 仅补充类型注解与显式 import/export，不改变任何行为。
import type { Row, Rows } from '../../types';
import { COL_KEYWORDS } from '../mapping/column-detect';
import { isAmountLikeNumber } from '../mapping/amount-score';

export const SUMMARY_RE = /合计|总计|汇总|小计|平台服务费|服务费率|平台费率|合计支付|开票金额|收费通知/i;

/** smartDetectTable 的返回 */
export interface SmartTableDetection {
  headerRow: Row;
  headerRowIndex: number;
  dataRows: Rows;
  filteredCount: number;
}

// 检测下一行是否是表头延续（双行表头的第二行）
export function isHeaderContinuation(headerRow: Row, nextRow?: Row | null): boolean {
  if (!nextRow || !Array.isArray(nextRow)) return false;
  const nextNonEmpty = nextRow.filter(c => c != null && String(c).trim() !== '');
  if (nextNonEmpty.length === 0) return false;
  // 双行表头的第二行通常只有少数拆分的列，不超过表头列数的一半
  if (nextNonEmpty.length > Math.max(3, headerRow.length * 0.5)) return false;
  // 所有非空单元格必须是短文本，不能是数字、身份证号、手机号、银行卡号等数据值
  for (const c of nextNonEmpty) {
    const s = String(c).trim();
    if (!s) continue;
    if (/^\d+(\.\d+)?$/.test(s)) return false;       // 纯数字
    if (/^\d{17}[\dXx]$/.test(s)) return false;       // 身份证号
    if (/^1[3-9]\d{9}$/.test(s)) return false;        // 手机号
    if (/^\d{16,19}$/.test(s)) return false;          // 银行卡号
    if (s.length > 10) return false;                  // 表头文本通常较短
  }
  return true;
}

// 合并双行表头：对于每一列，若两行都有值则拼接，否则取非空值
export function mergeHeaderRows(row1: Row, row2: Row): string[] {
  const len = Math.max(row1.length, row2.length);
  const merged: string[] = [];
  for (let i = 0; i < len; i++) {
    const h1 = String(row1[i] || '').trim();
    const h2 = String(row2[i] || '').trim();
    if (h1 && h2) merged.push(h1 + h2);
    else merged.push(h1 || h2);
  }
  return merged;
}

export function smartDetectTable(rows: Rows): SmartTableDetection {
  const HEADER_RE = /月份|month|收入|income|金额|amount|姓名|name|身份证|电话|phone|手机|银行|bank|卡号|性别|gender|开户|账号|备注|note|出错|平台|商社|任务|税源|工种|付款|收款|商户|订单|发放|应发|实发|户名/i;
  let bestIdx = 0, bestScore = 0;
  const scanEnd = Math.min(rows.length, 30);

  for (let i = 0; i < scanEnd; i++) {
    const row = rows[i] || [];
    let score = 0;
    row.forEach(cell => {
      const v = String(cell || '');
      if (!v.trim()) return;
      Object.values(COL_KEYWORDS).forEach(re => { if (re.test(v)) score++; });
      if (/序号|编号|^#$/.test(v)) score += 0.5;
    });
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  let headerRow: Row = rows[bestIdx] || [];
  let dataStartIdx = bestIdx + 1;
  // 检测双行表头：若下一行是表头延续，则合并两行作为完整表头
  const nextRow = rows[bestIdx + 1];
  if (isHeaderContinuation(headerRow, nextRow)) {
    headerRow = mergeHeaderRows(headerRow, nextRow);
    dataStartIdx = bestIdx + 2;
  }

  const dataRows: Rows = [];
  let filteredNonPerson = 0;   // 被判定为非人员/单位记录而过滤掉的行数（如平台服务费、合计等）
  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i] || [];
    // Skip empty rows
    const nonEmptyCells = row.filter(c => c != null && String(c).trim() !== '');
    if (nonEmptyCells.length === 0) continue;
    // Skip summary rows (check ALL cells)
    if (isSummaryLikeRow(row)) continue;
    // Skip rows that look like secondary headers: most cells are short header-like keywords
    // A true secondary header has >50% of non-empty cells matching header keywords AND each is short (<=8 chars)
    const kwCells = row.filter(cell => {
      const s = String(cell || '').trim();
      return s && HEADER_RE.test(s) && s.length <= 8;
    });
    // Only skip if keyword cells dominate the non-empty cells (>60%) AND there are at least 3
    if (kwCells.length >= 3 && kwCells.length >= nonEmptyCells.length * 0.6) continue;
    // 多重校验：只保留真正是人员/单位发放数据的记录
    if (!hasIdentityField(row, headerRow)) { filteredNonPerson++; continue; }
    dataRows.push(row);
  }
  return { headerRow, headerRowIndex: bestIdx, dataRows, filteredCount: filteredNonPerson };
}

export function isSummaryLikeRow(row: Row): boolean {
  if (!Array.isArray(row)) return false;
  // True summary rows usually have the summary keyword in the FIRST non-empty cell
  // (like starting with "合计", "总计", "小计" in the first/label column)
  // AND typically have a large number in the amount column.
  // We don't want to skip rows just because a note/remark cell happens to contain "合计".

  // Find first non-empty cell
  let firstNonEmpty = '';
  for (const cell of row) {
    const s = String(cell || '').trim();
    if (s) {
      firstNonEmpty = s;
      break;
    }
  }
  if (!firstNonEmpty) return false;

  // If the row starts with a strong summary keyword, it IS a summary row
  const STRONG_SUMMARY_RE = /^(合计|总计|汇总|小计|累计)/;
  if (STRONG_SUMMARY_RE.test(firstNonEmpty)) return true;

  // Also check if the first cell IS exactly "合计" etc (exact match)
  if (/^(合计|总计|汇总|小计|累计)$/.test(firstNonEmpty)) return true;

  return false;
}

/**
 * Check if a row contains at least one identity field.
 * Supports: Chinese name (2-15 chars, with possible · separator), ID card (18 digits),
 * phone (11 digits starting with 1), bank card (16-19 digits), sequence number,
 * or valid amount (strong signal this is a data row).
 */
export const SUMMARY_TERMS_EXACT = new Set([
  '累计', '总计', '合计', '小计', '收入', '金额', '税率', '费率', '支付', '平台',
  '到手', '服务', '保险', '备注', '说明', '税源', '工种', '任务', '性别', '开户',
  '发放', '实发', '应发', '个税', '序号', '编号', '姓名', '身份证', '电话', '手机',
  '银行', '卡号', '账号', '户名', '备注', '说明'
]);

// 费用/汇总类标签：这些文本明显不是人员姓名，出现时应判定为非人员记录
// （例如"平台服务费""额外服务费""服务费""手续费""小计""合计"等）
export const FEE_LABEL_RE = /费|平台|服务|合计|小计|总计|汇总|累计|税率|税点|费率|金额|账号|银行|开户|手机|电话|性别|备注|说明|序号|编号|开票|支付|社保|公积金|保险|个税|报酬|收入|商户|订单/;

/**
 * 判断一行是否为"真正的人员/单位发放记录"。
 * 多重校验，避免把"平台服务费""额外服务费""合计""小计"等费用/汇总行误当作人员导出。
 *
 * 强身份标识（满足任一即视为有效发放对象）：
 *   - 身份证号（18位，末位可为 X）
 *   - 统一社会信用代码（18位字母+数字，个体户/单位收款人）
 *   - 手机号（11位，1开头）
 *   - 银行卡号（16-19位数字）
 *
 * 兜底规则：同时含"拟似姓名"（2-15个中文字符且不是费用/汇总标签）+ 金额 + 足够数据列。
 *
 * 只要该行包含费用/汇总标签（如"平台服务费"），且没有任何强身份标识，则判定为非人员记录。
 */
export function hasIdentityField(row: Row, headerRow: Row): boolean {
  let strongCount = 0;   // 强身份标识数量
  let nameLike = false;  // 拟似姓名
  let hasAmount = false;
  let nonEmptyCount = 0;

  for (let ci = 0; ci < row.length; ci++) {
    const cell = row[ci];
    const s = String(cell || '').trim();
    if (!s) continue;
    nonEmptyCount++;

    // —— 强身份标识：明确对应某个具体发放对象 ——
    if (/^\d{17}[\dXx]$/.test(s)) { strongCount++; continue; }        // 身份证
    if (/^[0-9A-Za-z]{18}$/.test(s)) { strongCount++; continue; }     // 统一社会信用代码
    if (/^1[3-9]\d{9}$/.test(s)) { strongCount++; continue; }         // 手机号
    if (/^\d{16,19}$/.test(s)) { strongCount++; continue; }           // 银行卡号

    // —— 费用/汇总标签：明确不是人员姓名，跳过（不计入姓名）——
    if (FEE_LABEL_RE.test(s)) continue;

    // —— 拟似姓名：2-15 个中文字符（支持少数民族 ·）——
    if (/^[\u4e00-\u9fff·]{2,15}$/.test(s)) {
      // 检查该列是否为地点/类型等非姓名列，避免将"天津"等地名误判为人名
      const header = String(headerRow?.[ci] || '').trim();
      if (/开户地|税源地|地址|地区|区域|城市|类型|方式|项目/.test(header)) continue;
      nameLike = true;
      continue;
    }

    // —— 金额：作为兜底判定依据 ——
    if (isAmountLikeNumber(s)) hasAmount = true;
  }

  // 多重校验结论
  if (strongCount >= 1) return true;                            // 含强身份标识 → 人员/单位记录
  if (nameLike && hasAmount && nonEmptyCount >= 3) return true; // 姓名 + 金额 + 足够列 → 兜底
  return false;
}

/**
 * Infer gender from Chinese 18-digit ID card number.
 * The 17th digit: odd = male (男), even = female (女).
 * Returns '男' or '女' or '' if not applicable.
 */
export function inferGenderFromIdCard(idCard: string): string {
  if (!idCard) return '';
  const s = String(idCard).trim();
  if (/^\d{17}[\dXx]$/.test(s)) {
    const digit = parseInt(s[16]);
    return digit % 2 === 1 ? '男' : '女';
  }
  return '';
}
