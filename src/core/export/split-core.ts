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

// tplName 由调用方解析（legacy 侧：templateKey === 'custom' ? '自定义' : TEMPLATES[templateKey]?.name）
export function getSplitFileBaseName(g: SplitGroup, tplName: string, mode: string | undefined): string {
  const parts = [sanitizeFileNamePart(String(g.fileName || '未命名').replace(/\.[^.]+$/, '')) || '未命名'];
  if (mode === 'bySheet' && g.sheetName) {
    const sn = sanitizeFileNamePart(g.sheetName);
    if (sn) parts.push(sn);
  }
  parts.push(tplName);
  return parts.join('_');
}

export function allocSplitFileName(
  g: SplitGroup, ext: string, usedNames: Set<string>, tplName: string, mode: string | undefined
): string {
  const base = getSplitFileBaseName(g, tplName, mode);
  let name = `${base}.${ext}`, i = 2;
  while (usedNames.has(name)) { name = `${base}(${i}).${ext}`; i++; }
  usedNames.add(name);
  return name;
}
