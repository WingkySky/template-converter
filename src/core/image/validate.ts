// OCR 结果校验层（两引擎共用，设计 §6）：付款数据零容错，任何引擎的准确率都不可依赖
// （2026-10-13 实测：小数点误读为 &、数字 0 误读为 日），校验层 + 人工校对才是最终防线。
// 两类产出：
//  1) per-cell 问题标记（含高频误读的一键修正候选——仅数字格、用户点选确认，绝不静默改）；
//  2) 列合计核对：图内自带 合计/小计 行时自动核对金额列，不平即整列告警——实测样张
//     自带小计行，这是自动揪出 OCR 误读的金标准。
// 本层为纯逻辑（对任意 rows 生效），仅图片源在渲染/编辑后由 mapping.ts 现算，不落 state。
import type { Row, Rows } from '../../types';
import type { DetectedColumn } from '../mapping/column-detect';

export interface OcrCellIssue {
  msg: string;
  /** 高频误读的一键修正候选（点击单元格时预填，用户确认后生效） */
  fix?: string;
}

export interface OcrValidation {
  /** key = `${dataRowIndex}:${colIndex}`（dataRowIndex 为 dataRows 下标） */
  issues: Record<string, OcrCellIssue>;
  /** 列合计与图内合计行不符的金额列下标 */
  sumMismatchCols: number[];
}

// 高频误读映射（2026-10-13 实测归纳：日↔0、L↔1、&↔.；另收全角/形近字符）
const MISREAD_MAP: Record<string, string> = {
  '日': '0', 'O': '0', 'o': '0', 'Ｏ': '0',
  'L': '1', 'l': '1', 'I': '1', '｜': '1',
  '&': '.', '＆': '.', '。': '.', '，': '.', '．': '.', ',': '.',
};

/** 金额/数值格式（千分位可选，小数 ≤2 位；也接受纯整数——卡号式长数字不进这里） */
const AMOUNT_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

/** 数字格判定：只含数字、空白与已知名义误读字符（含误读字符才可能给修正候选） */
const DIGITISH_RE = /^[\d\s.,，。&＆OoLlI｜日．]+$/;

/**
 * 数字格误读修正候选：逐字符替换已知名义误读，仅当确有替换、且结果为合法数值格式时返回。
 * 注意这是「候选」——小数点丢失类错误（如 1007.51 读成 1 日 007 51 → 100751）无法可靠
 * 还原，候选值必须经用户对照原图确认。
 */
export function suggestNumericFix(text: string): string | undefined {
  if (!text || !/\d/.test(text)) return undefined; // 原串必须含真实数字（纯误读字符替换无意义）
  let fixed = '';
  let changed = false;
  for (const ch of text) {
    const rep = MISREAD_MAP[ch];
    if (rep !== undefined) { fixed += rep; changed = true; } else { fixed += ch; }
  }
  if (!changed) return undefined;
  fixed = fixed.replace(/\s+/g, '');
  return AMOUNT_RE.test(fixed) ? fixed : undefined;
}

/** 身份证 18 位校验位验算（GB 11643-1999 加权因子） */
export function isIdCardChecksumValid(s: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(s)) return false;
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const CODE = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * W[i];
  return CODE[sum % 11] === s[17].toUpperCase();
}

function cellText(v: unknown): string {
  return String(v ?? '').trim();
}

function parseAmount(v: unknown): number {
  const n = Number(cellText(v).replace(/[,，\s￥¥]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 计算 OCR 结果的校验标记。
 * @param rows 全部行（含表头与合计行——合计核对需要它们）
 * @param dataRows 智能检测后的有效数据行（issues 下标以此为基准）
 * @param cols 列识别结果（来自 detectColumnMapping；type 为空的列不校验）
 */
export function computeOcrValidation(
  rows: Rows,
  dataRows: Rows,
  cols: Record<string, DetectedColumn>,
): OcrValidation {
  const issues: Record<string, OcrCellIssue> = {};
  const sumMismatchCols: number[] = [];

  const colType = new Map<number, string>();
  Object.entries(cols).forEach(([ci, col]) => {
    if (col.type) colType.set(Number(ci), col.type);
  });

  // —— 字段级校验：只对「数字格」（数字 + 空白 + 已知误读字符）生效，
  //    姓名/开户行等文本格不校验也不给误读候选（全角字符在文本里是正常内容）
  dataRows.forEach((row, ri) => {
    colType.forEach((type, ci) => {
      const raw = cellText(row?.[ci]);
      if (!raw || !DIGITISH_RE.test(raw) || !/\d/.test(raw)) return;
      const compact = raw.replace(/\s+/g, '');
      let msg = '';
      if (type === 'idCard') {
        if (!/^\d{17}[\dXx]$/.test(compact)) {
          msg = '身份证应为 18 位（17 位数字 + 校验位），识别结果位数/字符异常';
        } else if (!isIdCardChecksumValid(compact)) {
          msg = '身份证校验位不符，疑似个别数字误读';
        }
      } else if (type === 'phone') {
        if (!/^1[3-9]\d{9}$/.test(compact)) msg = '手机号应为 1 开头的 11 位数字，识别结果异常';
      } else if (type === 'bankCard') {
        if (!/^\d{16,19}$/.test(compact)) msg = '卡号/账号应为 16~19 位数字，识别结果位数异常';
      } else if (type === 'amount') {
        if (!AMOUNT_RE.test(raw)) msg = '金额格式异常（应为数字，可含千分位与 ≤2 位小数）';
      }
      if (msg) {
        const fix = suggestNumericFix(raw);
        // 修正候选必须「真的改了字符」才有意义：候选与原值（去空白）相同则不给
        issues[`${ri}:${ci}`] = { msg, fix: fix && fix !== compact ? fix : undefined };
      }
    });
  });

  // —— 列合计核对：在全部行中自底向上找最后一个「首个非空格以 合计/总计/小计/累计 开头」的行
  let summaryRow: Row | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] || [];
    let first = '';
    for (const c of row) {
      const s = cellText(c);
      if (s) { first = s; break; }
    }
    if (/^(合计|总计|小计|累计)/.test(first)) { summaryRow = row; break; }
  }
  if (summaryRow) {
    const sr = summaryRow;
    colType.forEach((type, ci) => {
      if (type !== 'amount') return;
      const sum = dataRows.reduce((acc, row) => {
        const n = parseAmount(row?.[ci]);
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0);
      const declared = parseAmount(sr[ci]);
      if (!Number.isFinite(declared)) return; // 合计行该列非数字（列错位等），不做无谓告警
      const tolerance = Math.max(0.02, Math.abs(declared) * 1e-6);
      if (Math.abs(sum - declared) > tolerance) sumMismatchCols.push(ci);
    });
  }

  return { issues, sumMismatchCols };
}
