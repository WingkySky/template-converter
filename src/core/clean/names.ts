// 姓名列清洗（2026-10-15 用户需求）：客户常在姓名旁写注记——「王辉2」（同一人第二笔）、
// 「陈建新8月」（月份标注）、「王辉（补发）」——原样导出会被目标平台拒收。
// 本清洗在 confirmMapping 落数据时应用（CSV/XLSX/PDF/图片源通用），并遵守三条红线：
//  1) 只在「有明确断点」时提取（数字/括号/标点之后），纯中文整格（含·连接的少数民族名）
//     一律原样——欧阳娜娜、努尔买买提不得被误伤；
//  2) 余部以「、，,/」开头疑似一格多人 → 宁可不动，绝不静默丢人；
//  3) 无·且超 6 字、或带机构后缀（公司/银行/商行…）的前导段判为机构名不动——
//     客户名称列常被关键词误标为 name 类型（「客户名称」含「名称」），compare 曾据此
//     抓到「武汉市红枫咨询商行」被截断（2026-10-15），此守卫即为此而设。
// 预览所见即所得（mapping 预览同步展示清洗值），改动格悬停可见原值、点击可改回。

/** 相邻中文之间的空白折叠（王 辉 → 王辉）；英文/数字与中文间的空格保留 */
const CJK_GAP_RE = /([\u4e00-\u9fff])[\s\u3000]+(?=[\u4e00-\u9fff])/g;

/** 纯中文整格（·连接允许）：无任何注记断点 */
const PURE_CJK_RE = /^[\u4e00-\u9fff·・]+$/;

/** 前导中文段（不设上限：先看全貌再判断是否人名） */
const LEADING_CJK_RE = /^([\u4e00-\u9fff·・]+)/;

/** 机构后缀：命中即判为机构/全称，不清洗 */
const ORG_SUFFIX_RE = /(公司|银行|支行|分行|商行|商社|营业部|营业室|事务所|工作室|服务部|经营部|中心|店|厂|院|所|队|站|校)$/;

/** 一格多人的分隔符：余部以此开头时不清洗（宁可保留原样也不静默丢人） */
const MULTI_NAME_REST_RE = /^[、，,／/]/;

export function cleanNameCell(raw: string): string {
  let t = String(raw ?? '').trim();
  if (!t) return t;
  t = t.replace(CJK_GAP_RE, '$1').trim();
  if (!t || PURE_CJK_RE.test(t)) return t; // 无断点 → 无注记，原样
  const m = t.match(LEADING_CJK_RE);
  if (!m) return t; // 不以中文开头（外文名/编号开头等）→ 不动
  const name = m[1].replace(/[·・]+$/, '');
  const rest = t.slice(m[1].length);
  if (name.length < 2 || name.length > 15) return t; // 长度不像人名 → 不动
  if (MULTI_NAME_REST_RE.test(rest)) return t; // 疑似一格多人 → 不动
  // 无·连接且超 6 字、或带机构后缀 → 更像机构/全称，不动（·连接是人名特征，机构不用·）
  if (!/[·・]/.test(name) && (name.length > 6 || ORG_SUFFIX_RE.test(name))) return t;
  return name;
}
