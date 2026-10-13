// OCR 结果清洗层（2026-10-14 用户反馈补强）：两引擎都会把「非数据字符」带进单元格——
// LLM 会输出 JSON 引号伪影（"130403…）与表格竖线（…3326. / 39315.71|20768.06），
// 本地 Tesseract 还会把边框线读成字符。本层在 recognizeCanvasRaw 出口统一清洗，
// 只作用于图片源，绝不触碰 CSV/Excel/PDF 文本管线的数据。
// 原则：只删「不可能是数据」的字符，不做任何语义修正——识别错字留给校验层 + 人工校对
// （spec §6），清洗不能变成静默改数。
// 分类处理：含中文的混排格只删竖线/引号并折叠中文间空格（不动任何标点，防误改
// 「张三。」「A 公司 B 部」）；无中文的数字语境格（守卫含全角数字）才做全角转换与噪声剥离。

import type { Rows } from '../../types';

/** 竖线类表格边框残留（半角 | 与全角/制表变体）——合法数据不含竖线，全部删除 */
const PIPE_RE = /[\u007C\uFF5C\u2502\u2503\u2506\u2223\u01C0]/g;

/** 包裹型引号（LLM 的 JSON 伪影/中文引号）：首尾剥离，不配对也剥（LLM 常只带半边） */
const EDGE_QUOTES_RE = /^[\s"'“”‘’「『」』]+|[\s"'“”‘’「『」』]+$/g;

/** 数字格守卫：半角或全角数字（\d 不匹配全角，必须显式含 FF10~FF19） */
const HAS_DIGIT_RE = /[\d\uFF10-\uFF19]/;
const HAS_CJK_RE = /[\u4e00-\u9fff]/;

/** 纯数字语境格的首尾噪声标点黑名单（括号/引号/书名号/角标/悬空点逗等）。
 * 刻意不含 -（负号）、x/X（身份证末位）、%￥¥（合法币/百分比）与全部字母数字 */
const EDGE_NOISE = '\\s.,()（）\\[\\]【】《》<>＞＜“”‘’"\'「『」』·、；;:：！!？?～~—–_+';

/** 相邻中文之间的空白折叠（郭 卫 杰 → 郭卫杰）；英文/数字与中文间的空格保留 */
const CJK_GAP_RE = /([\u4e00-\u9fff])[\s\u3000]+(?=[\u4e00-\u9fff])/g;

/** 全角（FF01~FF5E）→ 半角；全角空格 → 半角空格。仅无中文的数字语境格内应用 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
}

export function cleanOcrCell(raw: string): string {
  let t = String(raw ?? '').trim();
  if (!t) return '';
  // 1) 表格边框竖线：任何位置出现都删除（含 Tesseract 词块内的嵌入式竖线）
  t = t.replace(PIPE_RE, '');
  // 2) 首尾引号
  t = t.replace(EDGE_QUOTES_RE, '').trim();
  if (!t) return '';

  if (HAS_DIGIT_RE.test(t)) {
    if (HAS_CJK_RE.test(t)) {
      // —— 中英混排格（王辉2、３栋502）：只折叠中文间空格 + 全角数字转半角，不动标点 ——
      return t
        .replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(CJK_GAP_RE, '$1')
        .trim();
    }
    // —— 数字语境格：全角转半角、中文句点转小数点、首尾噪声剥离 ——
    t = toHalfWidth(t).replace(/。/g, '.');
    const lead = new RegExp(`^[${EDGE_NOISE}]+`);
    const tail = new RegExp(`[${EDGE_NOISE}]+$`);
    while (t && lead.test(t)) t = t.slice(1).trim();
    while (t && tail.test(t)) t = t.slice(0, -1).trim();
    // 长数字去内部排版空白（卡号/证件号，与 pdf-text 同口径；含小数点/千分位的金额不适用）
    if (/^\d[\d\s]*$/.test(t) && t.replace(/\D/g, '').length >= 10) {
      t = t.replace(/\s+/g, '');
    } else {
      t = t.replace(/\s+/g, ' ').trim();
    }
    return t;
  }

  // —— 纯文本格（姓名/开户行）：折叠相邻中文之间的空格 ——
  return t.replace(CJK_GAP_RE, '$1').trim();
}

/** 整表清洗：recognizeCanvasRaw 出口统一调用（rows 为引擎产出，含表头与小计行） */
export function cleanOcrRows(rows: Rows): Rows {
  return rows.map(row => row.map(c => cleanOcrCell(String(c ?? ''))));
}
