// 值清洗 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），仅补充类型注解，不改变任何行为。
// sanitizeAmount 位于 legacy.js L2309，cleanValue 位于 L2323。
import type { Cell } from '../../types';

export function sanitizeAmount(val: Cell): string {
  if (val == null) return '';
  // raw:false 读取时货币格式的单元格会带 ¥/$ 等符号（如 "¥90,100.00"），需先剥离再解析
  const n = parseFloat(String(val).trim().replace(/[¥￥$€£,，\s]/g, '').replace(/(元|人民币)$/,''));
  return isNaN(n) ? '' : String(Math.round(n * 100) / 100);
}

// ==================== Data Preprocessing (Space/Whitespace Cleaning) ====================
/**
 * Clean a value based on its field type.
 * Strips all whitespace (spaces, tabs, non-breaking spaces, full-width spaces, etc.)
 * for sensitive fields that should never contain spaces: name, idCard, phone, bankCard.
 * Also normalizes common full-width digits/letters to half-width.
 */
export function cleanValue(val: Cell, type: string): string {
  if (val == null) return '';
  let s = String(val);
  if (!s.trim()) return '';
  // Only clean specific field types that should never have spaces
  const SPACE_CLEAN_TYPES = new Set(['name', 'idCard', 'phone', 'bankCard']);
  if (SPACE_CLEAN_TYPES.has(type)) {
    // Remove ALL whitespace: regular spaces, tabs, non-breaking spaces (\u00A0),
    // full-width spaces (\u3000), zero-width chars, etc.
    s = s.replace(/[\s\u00A0\u3000\u200B\u200C\u200D\uFEFF]/g, '');
    // Normalize full-width digits (０-９) → half-width (0-9)
    s = s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    // Normalize full-width letters (Ａ-Ｚ, ａ-ｚ) → half-width (A-Z, a-z)
    s = s.replace(/[Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    // 身份证末位校验码归一化：X 的形近字符（罗马数字 Ⅹ/ⅹ、西里尔字母 Х/х）→ X，
    // 小写 x 统一转大写（客户数据常见非标准写法导致平台导入失败）
    if (type === 'idCard') {
      s = s.replace(/[\u2169\u2179\u0425\u0445]/g, 'X');
      s = s.replace(/^(\d{17})[xX]$/, '$1X');
    }
  }
  return s;
}
