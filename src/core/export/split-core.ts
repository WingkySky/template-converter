// 拆分导出纯逻辑 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 C）。
// 原实现读取 state.exportMode 与 TEMPLATES[templateKey].name；core 禁止依赖 state，
// 故「导出模式」与「模版显示名」改为参数传入（`state.exportMode || 'merge'` 等语义不变），
// legacy.js 侧由同名包装函数转调并补齐参数。读 state 的编排函数
// （getSplitGroups / getSplitGroupCounts / isSplitExportActive / ensureSplitBatches /
// buildSplitFilesForTemplates）留在 legacy.js 不搬。
// 位置锚点：getSplitGroupsFromMeta legacy.js L3321，splitGroupLabel L3346，
// sanitizeFileNamePart L3360，getSplitFileBaseName L3364，allocSplitFileName L3375。

/** 行级来源元数据（generateOutput 输出的 outputRowMeta 元素，拆分相关字段） */
export interface OutputRowMeta {
  fileName?: string;
  sheetName?: string;
  [k: string]: unknown;
}

/** 一个拆分分组：同来源（文件/数据表）的行索引集合 */
export interface SplitGroup {
  key: string;
  fileName: string;
  sheetName: string;
  rowIdxs: number[];
}

// 从行级来源元数据计算分组：byFile 按文件名分组，bySheet 按文件名+工作表名分组
// key 带模式前缀，避免两种粒度的批次号状态互相污染
export function getSplitGroupsFromMeta(
  meta: OutputRowMeta[] | null | undefined,
  mode: string | undefined
): SplitGroup[] {
  const exportMode = mode || 'merge';
  const map = new Map<string, SplitGroup>();
  (meta || []).forEach((m, i) => {
    const fileName = m.fileName || '未命名文件';
    const sheetName = m.sheetName || '';
    const key = exportMode === 'bySheet' ? `${exportMode}||${fileName}||${sheetName}` : `${exportMode}||${fileName}`;
    if (!map.has(key)) map.set(key, { key, fileName, sheetName, rowIdxs: [] });
    map.get(key)!.rowIdxs.push(i);
  });
  return [...map.values()];
}

export function splitGroupLabel(g: SplitGroup, mode: string | undefined): string {
  return mode === 'bySheet'
    ? `${g.fileName} / ${g.sheetName || '默认表'}`
    : g.fileName;
}

// 文件名片段清洗：去 Windows 非法字符、压缩空白、限长
export function sanitizeFileNamePart(s: string | null | undefined): string {
  return String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** 拆分命名规则：compact=自动省略整批相同的段；batchno=批次号；batchno-compact=批次号_精简结果；full=原行为 */
export type SplitNamingRule = 'compact' | 'batchno' | 'batchno-compact' | 'full';

/** 命名规则上下文（UI 层从 state 组装；全部可选，缺省即原 full 行为） */
export interface SplitNamingOptions {
  rule?: SplitNamingRule;
  /** 本次导出选了多个模板 → 文件名保留模板名段防撞名 */
  multiTemplate?: boolean;
  /** 整批分组列表：compact 据此自动省略整批相同的段（batchno 空号回退 compact 时同用） */
  allGroups?: SplitGroup[];
  /** 该组批次号（batchno 规则） */
  batchNo?: string;
}

// 剥离整批文件名的公共前缀/后缀，并剔除按「-」分段后整批相同的段（不含最后一段），
// 只留区分部分；某一步会把任一名字剥空则跳过该步（防呆）。入参为已清洗的名字。
function stripCommonFileParts(names: string[]): string[] {
  if (new Set(names).size <= 1) return names.slice();
  let out = names.slice();
  // 公共前缀
  let p = out[0] || '';
  for (const s of out) { let i = 0; while (i < p.length && i < s.length && p[i] === s[i]) i++; p = p.slice(0, i); if (!p) break; }
  if (p) {
    const stripped = out.map(s => s.slice(p.length).replace(/^[-—－_·\s]+/, ''));
    if (stripped.every(s => s)) out = stripped;
  }
  // 公共后缀
  let q = out[0] || '';
  for (const s of out) { let i = 0; while (i < q.length && i < s.length && q[q.length - 1 - i] === s[s.length - 1 - i]) i++; q = q.slice(q.length - i); if (!q) break; }
  if (q) {
    const stripped = out.map(s => s.slice(0, s.length - q.length).replace(/[-—－_·\s]+$/, ''));
    if (stripped.every(s => s)) out = stripped;
  }
  // 整批相同的「-」段（最后一段保留，首要区分信息通常在此）
  const segs = out.map(s => s.split('-'));
  const minLen = Math.min(...segs.map(a => a.length));
  const drop = new Set<number>();
  for (let i = 0; i < minLen - 1; i++) {
    if (segs.every(a => a[i] === segs[0][i])) drop.add(i);
  }
  if (drop.size) {
    const stripped = segs.map(a => a.filter((_, i) => !drop.has(i)).join('-').trim());
    if (stripped.every(s => s)) out = stripped;
  }
  return out;
}

// tplName 由调用方解析（legacy 侧：templateKey === 'custom' ? '自定义' : TEMPLATES[templateKey]?.name）
// naming 为 legacy 之后新增的增强：compact 省略整批相同的段并把文件名剥成区分部分、
// batchno 用批次号命名、batchno-compact 用「批次号_精简结果」；缺省逐字等价原实现
export function getSplitFileBaseName(
  g: SplitGroup, tplName: string, mode: string | undefined, naming?: SplitNamingOptions
): string {
  const rule = naming?.rule || 'full';
  const all = naming?.allGroups;
  // 「整批相同才省略」仅在分组数 >1 时成立：单分组没有可比对象，段全保留
  // （真实 UI 拆分要求 >1 组；此防御覆盖测试/直连调用单分组的场景）
  const sameFile = !!all && all.length > 1 && new Set(all.map(x => x.fileName)).size <= 1;
  const sameSheet = !!all && all.length > 1 && new Set(all.map(x => x.sheetName)).size <= 1;
  const compact = rule !== 'full';
  const parts: string[] = [];
  if (!compact || !sameFile) {
    const raw = sanitizeFileNamePart(String(g.fileName || '未命名').replace(/\.[^.]+$/, '')) || '未命名';
    let seg = raw;
    if (compact && all && all.length > 1 && !sameFile) {
      const names = all.map(x => sanitizeFileNamePart(String(x.fileName || '').replace(/\.[^.]+$/, '')) || '未命名');
      const i = all.findIndex(x => x.fileName === g.fileName);
      if (i >= 0) seg = stripCommonFileParts(names)[i] || raw;
    }
    parts.push(seg);
  }
  if (mode === 'bySheet' && g.sheetName && (!compact || !sameSheet)) {
    const sn = sanitizeFileNamePart(g.sheetName);
    if (sn) parts.push(sn);
  }
  if (!compact || naming?.multiTemplate) parts.push(tplName);
  let base = parts.join('_') || '拆分结果';
  if (rule === 'batchno') {
    const bn = sanitizeFileNamePart(naming?.batchNo);
    if (bn) base = naming?.multiTemplate ? `${bn}_${tplName}` : bn;
  } else if (rule === 'batchno-compact') {
    const bn = sanitizeFileNamePart(naming?.batchNo);
    if (bn) base = `${bn}_${base}`;
  }
  return base;
}

export function allocSplitFileName(
  g: SplitGroup, ext: string, usedNames: Set<string>, tplName: string, mode: string | undefined,
  naming?: SplitNamingOptions
): string {
  const base = getSplitFileBaseName(g, tplName, mode, naming);
  let name = `${base}.${ext}`, i = 2;
  while (usedNames.has(name)) { name = `${base}(${i}).${ext}`; i++; }
  usedNames.add(name);
  return name;
}
