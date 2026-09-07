// 商社查找/匹配 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 B）。
// 原 legacy.js 锚点：lookupShangShe L780、lookupShangSheByTaxId L822、lookupShangSheByNameAll L835、
// lookupShangSheByName L870、detectSourceClientInfo L905、getShangSheIdFromLookup L981、
// detectBestShangSheMatch L990。
// 去 loadKB 化说明（唯一结构性改动）：
//  - lookupXxx 系列 / getShangSheIdFromLookup 原函数体内的 `const kb = loadKB()` 改为
//    kb 提升为第一个参数，导出名加 kb 前缀；legacy.js 保留原签名包装函数。
//  - detectSourceClientInfo / detectBestShangSheMatch 原第二参 sourcesOverride 为可选，
//    兜底 `state.sources.filter(s => s.selected)` 属 state 依赖，改为必传参 sources
//    （即已过滤的选中数据源列表），legacy 包装函数里做 `sourcesOverride || state.sources.filter(...)`
//    兜底（照原逻辑），调用点零改动。
import type { Rows, ShangSheEntry } from '../../types';
import type { KB } from './model';
import { getConfigLists } from './model';
import { kbSignEntityToPlatform, kbTaxSourceForPlatform } from './tax-source';
import { parseTaskListEntries, generateGlobalTaskList, type MatchedTask } from './task';

/** lookupShangShe 的返回（原匿名对象形状） */
export interface ShangSheLookup {
  platform: string;
  taxSource: string;
  tasks: { name: string; content: string }[];
  matchedTasks: MatchedTask[];
  signEntity: string | undefined;
  feeRate: number | undefined;
  shortName: string | undefined;
  fullName: string | undefined;
  taxId: string | undefined;
}

/** lookupShangSheByNameAll 的元素。lookup 在 push 处断言非空（与原行为一致：
 *  id 来自 shangSheMap 的键，lookupShangShe 运行时不返回 null）。 */
export interface NameMatchResult { id: string; lookup: ShangSheLookup; matchType: string; }

/** detectSourceClientInfo 的 sources 参数元素（原 state.sources 元素的最小形状） */
export interface ScanSource { rows: Rows; }

/** sourcesData 的元素（state.mappingState.sourcesData 的最小形状） */
export interface MappingSourceData { dataRows: Rows; typeToCol: Record<string, number | null>; }

export interface ShangSheCandidate { id: string; label: string; matchType: string; }

export interface BestShangSheMatch {
  lookup: ShangSheLookup | null;
  id: string;
  candidates: ShangSheCandidate[];
  clientName: string;
  taxId: string;
}

// 查找商社信息
export function kbLookupShangShe(kb: KB, shangSheId: string | null | undefined): ShangSheLookup | null {
  if (!shangSheId) return null;
  const entry = kb.shangSheMap[String(shangSheId).trim()];
  if (!entry) return null;

  const { platforms } = getConfigLists(kb);
  const platform = kbSignEntityToPlatform(kb, entry.signEntity, platforms);
  const taxSource = kbTaxSourceForPlatform(kb, platform);

  // 从taskListData中查找匹配该商社编号的任务
  let matchedTasks = parseTaskListEntries(kb.taskListData, shangSheId, entry);

  // 如果taskListData没有匹配到，回退到KB的tasks
  if (matchedTasks.length === 0 && entry.tasks && entry.tasks.length > 0) {
    const globalTasks = generateGlobalTaskList(kb);
    for (const task of entry.tasks) {
      const globalTask = globalTasks.find(t => t.name === task.name && t.shangSheId === String(shangSheId).trim());
      matchedTasks.push({
        seq: globalTask ? globalTask.seq : 1,
        name: task.name,
        shangSheId: String(shangSheId).trim(),
        content: task.content || '',
        fullString: `${globalTask ? globalTask.seq : 1}.${task.name}(${String(shangSheId).trim()})`
      });
    }
  }

  return {
    platform: platform,
    taxSource: taxSource,
    tasks: entry.tasks || [],
    matchedTasks: matchedTasks,
    signEntity: entry.signEntity,
    feeRate: entry.feeRate as number | undefined,
    shortName: entry.shortName,
    fullName: entry.fullName,
    taxId: entry.taxId
  };
}

// 通过纳税人识别号查找商社信息
export function kbLookupShangSheByTaxId(kb: KB, taxId: string | null | undefined): ShangSheLookup | null {
  if (!taxId) return null;
  const trimmedId = String(taxId).trim().toUpperCase();
  for (const [id, entry] of Object.entries(kb.shangSheMap)) {
    if (entry.taxId && entry.taxId.trim().toUpperCase() === trimmedId) {
      return kbLookupShangShe(kb, id);
    }
  }
  return null;
}

// 通过商社全称或简称查找商社信息（返回所有匹配）
export function kbLookupShangSheByNameAll(kb: KB, name: string | null | undefined): NameMatchResult[] {
  if (!name) return [];
  const trimmedName = String(name).trim();
  const results: NameMatchResult[] = [];
  const seen = new Set<string>();
  // Exact fullName match
  for (const [id, entry] of Object.entries(kb.shangSheMap)) {
    if (entry.fullName && entry.fullName.trim() === trimmedName && !seen.has(id)) {
      seen.add(id);
      results.push({ id, lookup: kbLookupShangShe(kb, id)!, matchType: '全称精确' });
    }
  }
  // Exact shortName match
  for (const [id, entry] of Object.entries(kb.shangSheMap)) {
    if (entry.shortName && entry.shortName.trim() === trimmedName && !seen.has(id)) {
      seen.add(id);
      results.push({ id, lookup: kbLookupShangShe(kb, id)!, matchType: '简称精确' });
    }
  }
  // Partial match
  for (const [id, entry] of Object.entries(kb.shangSheMap)) {
    if (seen.has(id)) continue;
    if ((entry.fullName && entry.fullName.includes(trimmedName)) ||
        (entry.shortName && entry.shortName.includes(trimmedName)) ||
        (entry.fullName && trimmedName.includes(entry.fullName.trim())) ||
        (entry.shortName && trimmedName.includes(entry.shortName.trim()))) {
      seen.add(id);
      results.push({ id, lookup: kbLookupShangShe(kb, id)!, matchType: '模糊匹配' });
    }
  }
  return results;
}

// 通过商社全称或简称查找商社信息（返回第一个匹配）
export function kbLookupShangSheByName(kb: KB, name: string | null | undefined): ShangSheLookup | null {
  if (!name) return null;
  const trimmedName = String(name).trim();
  // First try exact match on fullName
  for (const [id, entry] of Object.entries(kb.shangSheMap)) {
    if (entry.fullName && entry.fullName.trim() === trimmedName) {
      return kbLookupShangShe(kb, id);
    }
  }
  // Then try exact match on shortName
  for (const [id, entry] of Object.entries(kb.shangSheMap)) {
    if (entry.shortName && entry.shortName.trim() === trimmedName) {
      return kbLookupShangShe(kb, id);
    }
  }
  // Then try partial match (name contains or is contained in fullName/shortName)
  for (const [id, entry] of Object.entries(kb.shangSheMap)) {
    if ((entry.fullName && entry.fullName.includes(trimmedName)) ||
        (entry.shortName && entry.shortName.includes(trimmedName))) {
      return kbLookupShangShe(kb, id);
    }
  }
  // Also try reverse: fullName contains the name
  for (const [id, entry] of Object.entries(kb.shangSheMap)) {
    if (entry.fullName && trimmedName.includes(entry.fullName.trim())) {
      return kbLookupShangShe(kb, id);
    }
    if (entry.shortName && trimmedName.includes(entry.shortName.trim())) {
      return kbLookupShangShe(kb, id);
    }
  }
  return null;
}

export function kbDetectSourceClientInfo(
  sourcesData: MappingSourceData[],
  sources: ScanSource[],
): { clientName: string; taxId: string } {
  const scanSources = sources;
  let detectedClientName = '';
  for (const src of scanSources) {
    const allRows = src.rows;
    for (let ri = 0; ri < allRows.length; ri++) {
      const row = allRows[ri] || [];
      for (let ci = 0; ci < row.length; ci++) {
        const cellStr = String(row[ci] || '').trim();
        const m1 = cellStr.match(/(?:客户名称|公司名称|委托方|甲方)[：:]\s*(.+)/);
        if (m1 && m1[1]) {
          detectedClientName = m1[1].trim();
          break;
        }
        if (/^(?:客户名称|公司名称|委托方|甲方)[：:]?$/.test(cellStr)) {
          const nextVal = row[ci + 1] ? String(row[ci + 1]).trim() : '';
          if (nextVal) {
            detectedClientName = nextVal;
            break;
          }
        }
      }
      if (detectedClientName) break;
    }
    if (detectedClientName) break;
  }

  let mappedClientName = '';
  sourcesData.forEach(({ dataRows, typeToCol }) => {
    if (mappedClientName) return;
    if (typeToCol.clientName != null) {
      const firstVal = dataRows[0]?.[typeToCol.clientName];
      if (firstVal) mappedClientName = String(firstVal).trim();
    }
  });

  let detectedTaxId = '';
  for (const src of scanSources) {
    const allRows = src.rows;
    for (let ri = 0; ri < allRows.length; ri++) {
      const row = allRows[ri] || [];
      for (let ci = 0; ci < row.length; ci++) {
        const cellStr = String(row[ci] || '').trim();
        const m1 = cellStr.match(/(?:统一信用代码|纳税人识别号|统一社会信用代码|税号|信用代码)[：:]\s*(.+)/);
        if (m1 && m1[1]) {
          detectedTaxId = m1[1].trim();
          break;
        }
        if (/^(?:统一信用代码|纳税人识别号|统一社会信用代码|税号|信用代码)[：:]?$/.test(cellStr)) {
          const nextVal = row[ci + 1] ? String(row[ci + 1]).trim() : '';
          if (nextVal) {
            detectedTaxId = nextVal;
            break;
          }
        }
      }
      if (detectedTaxId) break;
    }
    if (detectedTaxId) break;
  }

  let mappedTaxId = '';
  sourcesData.forEach(({ dataRows, typeToCol }) => {
    if (mappedTaxId) return;
    if (typeToCol.taxId != null) {
      const firstVal = dataRows[0]?.[typeToCol.taxId];
      if (firstVal) mappedTaxId = String(firstVal).trim();
    }
  });

  return {
    clientName: detectedClientName || mappedClientName,
    taxId: detectedTaxId || mappedTaxId
  };
}

export function kbGetShangSheIdFromLookup(kb: KB, lookup: ShangSheLookup | null | undefined): string {
  if (!lookup) return '';
  for (const [id, entry] of Object.entries(kb.shangSheMap || {})) {
    if (entry.fullName === lookup.fullName || entry.shortName === lookup.shortName || entry.taxId === lookup.taxId) return id;
  }
  return '';
}

export function kbDetectBestShangSheMatch(
  kb: KB,
  sourcesData: MappingSourceData[],
  sources: ScanSource[],
): BestShangSheMatch {
  let mappedShangSheId = '';
  sourcesData.forEach(({ dataRows, typeToCol }) => {
    if (mappedShangSheId) return;
    if (typeToCol.shangSheId != null) {
      const firstVal = dataRows[0]?.[typeToCol.shangSheId];
      if (firstVal) mappedShangSheId = String(firstVal).trim();
    }
  });
  if (mappedShangSheId) {
    const lookup = kbLookupShangShe(kb, mappedShangSheId);
    if (lookup) {
      return { lookup, id: mappedShangSheId, candidates: [], clientName: '', taxId: '' };
    }
  }

  const { clientName, taxId } = kbDetectSourceClientInfo(sourcesData, sources);
  let bestLookup = taxId ? kbLookupShangSheByTaxId(kb, taxId) : null;
  let candidates: ShangSheCandidate[] = [];

  if (!bestLookup && clientName) {
    const clientNameLookups = kbLookupShangSheByNameAll(kb, clientName);
    if (clientNameLookups.length === 1) {
      bestLookup = clientNameLookups[0].lookup;
    } else if (clientNameLookups.length > 1) {
      candidates = clientNameLookups.map(c => ({ id: c.id, label: `${c.id} - ${c.lookup.shortName || c.lookup.fullName}`, matchType: c.matchType }));
    }
  }

  return {
    lookup: bestLookup,
    id: kbGetShangSheIdFromLookup(kb, bestLookup),
    candidates,
    clientName,
    taxId
  };
}
