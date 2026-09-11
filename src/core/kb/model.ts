// 知识库数据模型 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 B），
// 仅补充类型注解与显式 export，不改变任何行为。
// 原 legacy.js 锚点：KB_STORAGE_KEY/KB_SCHEMA_VERSION L75-76、DEFAULT_CONFIG L79-111、
// getConfigLists L113、migrateKB L201、KB_MAIN_HEADERS L270、mergeKnowledgeRows L272、
// knowledgeRowsFromKB L321、applyConfigSheetRows L343、applyTaskListSheetRows L359
//（apply* 整体替换实现已废弃：2026-09-11 起配置/任务清单改为增量合并，见 mergeConfigData 系列）。
// 注意：loadKB/saveKB/clearKB/invalidateKBCache（localStorage/confirm 副作用）留在 legacy.js。
import type { Cell, KB as SharedKB, Rows } from '../../types';

export const KB_STORAGE_KEY = 'lg_knowledge_base';
export const KB_SCHEMA_VERSION: number = 1;

/** KB.configData 的运行时完整形状：types.ts 的 KB 只声明了 taxSources/platforms，
 *  handleKBConfigUpload（legacy.js）还会写入 signEntityMapping / platformTaxSourceMapping。 */
export interface KBConfigData {
  taxSources: string[];
  platforms: string[];
  signEntityMapping?: Record<string, string[]>;
  platformTaxSourceMapping?: Record<string, string>;
}

/** core/kb 使用的 KB 形状：types.ts 的 KB + configData 扩展字段 +
 *  taskListData 收窄为 string[]（applyTaskListSheetRows / loadKB 只写入字符串数组）。 */
export type KB = Omit<SharedKB, 'configData' | 'taskListData'> & {
  configData: KBConfigData;
  taskListData: string[];
};

// 默认配置数据（硬编码兜底）
export const DEFAULT_CONFIG: KBConfigData = {
  taxSources: ['0001.湖南','0002.海南','0003.河南','0004.安徽','0005.信宜','0006.湖北','0007.天津'],
  platforms: ['278.甲乙科技','283.丙丁工场','288.戊己客（灵活用工）6.2%','290.庚辛云','294.湖南清源','295.岳西众才','298.戊己客（企和推荐）7.1%','349.河南雅文','356.国联信宜','367.安徽优文莱（培训业务）','375.湖南合用工','376.戊己客（冠华系列）6.42%+50','378.安徽薪账通','379.咸宁合用工6.1%','397.戊己客平台（自营业务）7.5%','409.天津税地（身边云）5.6%','451.戊己客（7.9%）','453.戊己客（7.1%）','454.戊己客（8.1%）','455.戊己客（8.7%）','456.戊己客（9.6%）','461.戊己客（7.7%）','462.戊己客（7.5%）','468.潮涌（8.2%）','481.星薪平台（6.1%）','484.江西合用工（6.1%）','485.小规模纳税企业结算（6.67%）','486.河南茂丰源（5.4%）'],
  signEntityMapping: {
    '佛山云杉': ['佛山', '甲乙'],
    '广州南沙云杉': ['南沙'],
    '广州国联': ['国联'],
    '广州云杉': ['广州', '丙丁'],
    '深圳云杉': ['深圳', '梓合'],
    '东莞云杉': ['东莞', '梓才']
  },
  platformTaxSourceMapping: {
    '天津': '0007.天津',
    '身边云': '0007.天津',
    '戊己客': '0007.天津',
    '河南': '0003.河南',
    '茂丰源': '0003.河南',
    '雅文': '0003.河南',
    '安徽': '0004.安徽',
    '岳西': '0004.安徽',
    '优文莱': '0004.安徽',
    '薪账通': '0004.安徽',
    '信宜': '0005.信宜',
    '国联': '0005.信宜',
    '湖北': '0006.湖北',
    '咸宁': '0006.湖北',
    '海南': '0002.海南',
    '湖南': '0001.湖南',
    '合用工': '0001.湖南',
    '清源': '0001.湖南',
    '甲乙': '0001.湖南'
  }
};

export interface ConfigLists {
  platforms: string[];
  taxSources: string[];
  hasUploadedPlatforms: boolean | undefined;
}

export function getConfigLists(kb: KB): ConfigLists {
  const hasUploadedPlatforms = kb?.configData?.platforms && kb.configData.platforms.length > 0;
  return {
    platforms: hasUploadedPlatforms ? kb.configData.platforms : DEFAULT_CONFIG.platforms,
    taxSources: hasUploadedPlatforms ? (kb.configData.taxSources || []) : DEFAULT_CONFIG.taxSources,
    hasUploadedPlatforms
  };
}

// 数据迁移
export function migrateKB(kb: KB): KB {
  if (!kb.schemaVersion || kb.schemaVersion < KB_SCHEMA_VERSION) {
    // 未来版本迁移逻辑在此添加
    // if (kb.schemaVersion < 2) { ... }
    kb.schemaVersion = KB_SCHEMA_VERSION;
  }
  return kb;
}

export const KB_MAIN_HEADERS: string[] = ['商社编号','商社简称','商社全称','一级业务类型','二级业务类型','纳税人识别号','签约费率','签约主体','任务名称','服务内容'];

export interface MergeKnowledgeResult { newCount: number; updateCount: number; }

export function mergeKnowledgeRows(rows: Rows, kb: KB): MergeKnowledgeResult {
  let newCount = 0, updateCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const shangSheId = String(row[0] || '').trim();
    if (!shangSheId) continue;

    const shortName = String(row[1] || '').trim();
    const fullName = String(row[2] || '').trim();
    const taxId = String(row[5] || '').trim();
    const feeRateRaw = String(row[6] || '').trim();
    const feeRate = parseFloat(feeRateRaw) || 0;
    const signEntity = String(row[7] || '').trim();
    const taskName = String(row[8] || '').trim();
    const taskContent = String(row[9] || '').trim();

    if (kb.shangSheMap[shangSheId]) {
      const entry = kb.shangSheMap[shangSheId];
      if (!Array.isArray(entry.tasks)) entry.tasks = [];
      if (shortName) entry.shortName = shortName;
      if (fullName) entry.fullName = fullName;
      if (taxId) entry.taxId = taxId;
      if (feeRateRaw) entry.feeRate = feeRate;
      if (signEntity) entry.signEntity = signEntity;
      if (taskName) {
        const exists = entry.tasks.some(t => t.name === taskName && (t.content || '') === taskContent);
        if (!exists) entry.tasks.push({ name: taskName, content: taskContent });
      }
      updateCount++;
    } else {
      const entry = {
        id: shangSheId,
        shortName: shortName,
        fullName: fullName,
        taxId: taxId,
        feeRate: feeRate,
        signEntity: signEntity,
        tasks: [] as { name: string; content: string }[]
      };
      if (taskName) entry.tasks.push({ name: taskName, content: taskContent });
      kb.shangSheMap[shangSheId] = entry;
      newCount++;
    }
  }

  return { newCount, updateCount };
}

export function knowledgeRowsFromKB(kb: KB): Rows {
  const rows: Rows = [KB_MAIN_HEADERS];
  for (const entry of Object.values(kb.shangSheMap)) {
    const tasks = Array.isArray(entry.tasks) && entry.tasks.length > 0 ? entry.tasks : [{ name: '', content: '' }];
    for (const task of tasks) {
      rows.push([
        entry.id || '',
        entry.shortName || '',
        entry.fullName || '',
        '',
        '',
        entry.taxId || '',
        (entry.feeRate as Cell) ?? '',
        entry.signEntity || '',
        task.name || '',
        task.content || ''
      ]);
    }
  }
  return rows;
}

// —— 配置数据增量合并（与知识库同语义：新数据增改，旧数据保留，不做删除）——

export interface MergeConfigResult {
  newTaxSources: number;
  newPlatforms: number;
  newSignEntityKeys: number;
  newPlatformTaxSourceKeys: number;
}

const ZERO_MERGE_CONFIG: MergeConfigResult = { newTaxSources: 0, newPlatforms: 0, newSignEntityKeys: 0, newPlatformTaxSourceKeys: 0 };

// 选项列表并集：保留现有顺序，新项按上传顺序追加
function unionLists(current: string[], incoming: string[]): { merged: string[]; added: number } {
  const merged = current.slice();
  let added = 0;
  for (const v of incoming) {
    if (!merged.includes(v)) { merged.push(v); added++; }
  }
  return { merged, added };
}

// 键值映射合并：同名键新值覆盖，仅存在于旧数据的键保留
function mergeRecords<T>(current: Record<string, T> | undefined, incoming: Record<string, T>): { merged: Record<string, T>; added: number } {
  const merged: Record<string, T> = { ...(current || {}) };
  let added = 0;
  for (const [k, v] of Object.entries(incoming)) {
    if (!(k in merged)) added++;
    merged[k] = v;
  }
  return { merged, added };
}

// 对 kb.configData 施加增量补丁；未提供的字段保持不变
export function mergeConfigData(kb: KB, patch: Partial<KBConfigData>): MergeConfigResult {
  if (!kb.configData) kb.configData = { taxSources: [], platforms: [] };
  const cd = kb.configData;
  const result: MergeConfigResult = { ...ZERO_MERGE_CONFIG };
  if (patch.taxSources && patch.taxSources.length > 0) {
    const r = unionLists(cd.taxSources || [], patch.taxSources);
    cd.taxSources = r.merged;
    result.newTaxSources = r.added;
  }
  if (patch.platforms && patch.platforms.length > 0) {
    const r = unionLists(cd.platforms || [], patch.platforms);
    cd.platforms = r.merged;
    result.newPlatforms = r.added;
  }
  if (patch.signEntityMapping && Object.keys(patch.signEntityMapping).length > 0) {
    const r = mergeRecords(cd.signEntityMapping, patch.signEntityMapping);
    cd.signEntityMapping = r.merged;
    result.newSignEntityKeys = r.added;
  }
  if (patch.platformTaxSourceMapping && Object.keys(patch.platformTaxSourceMapping).length > 0) {
    const r = mergeRecords(cd.platformTaxSourceMapping, patch.platformTaxSourceMapping);
    cd.platformTaxSourceMapping = r.merged;
    result.newPlatformTaxSourceKeys = r.added;
  }
  return result;
}

// 解析「配置表」sheet：税源地/平台两列 + 可选扩展列（表头含"签约主体"/"平台税源地"，
// 单元格格式：签约主体名称→关键词1,关键词2 / 关键词→税源地）
export function parseConfigSheetRows(rows: Rows): Partial<KBConfigData> {
  const taxSources: string[] = [];
  const platforms: string[] = [];
  const signEntityMapping: Record<string, string[]> = {};
  const platformTaxSourceMapping: Record<string, string> = {};
  const headerRow = rows[0] || [];
  let signEntityColIdx = -1;
  let platTaxSourceColIdx = -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = String(headerRow[c] || '');
    if (/签约主体/.test(h)) signEntityColIdx = c;
    if (/平台税源地/.test(h)) platTaxSourceColIdx = c;
  }
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const taxVal = String(row[0] || '').trim();
    const platVal = String(row[1] || '').trim();
    if (taxVal) taxSources.push(taxVal);
    if (platVal) platforms.push(platVal);
    if (signEntityColIdx >= 0) {
      const seVal = String(row[signEntityColIdx] || '').trim();
      if (seVal && seVal.includes('→')) {
        const [seKey, seKeywords] = seVal.split('→').map(s => s.trim());
        if (seKey && seKeywords) {
          signEntityMapping[seKey] = seKeywords.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        }
      }
    }
    if (platTaxSourceColIdx >= 0) {
      const ptVal = String(row[platTaxSourceColIdx] || '').trim();
      if (ptVal && ptVal.includes('→')) {
        const [ptKey, ptTaxSource] = ptVal.split('→').map(s => s.trim());
        if (ptKey && ptTaxSource) platformTaxSourceMapping[ptKey] = ptTaxSource;
      }
    }
  }
  const patch: Partial<KBConfigData> = { taxSources, platforms };
  if (Object.keys(signEntityMapping).length > 0) patch.signEntityMapping = signEntityMapping;
  if (Object.keys(platformTaxSourceMapping).length > 0) patch.platformTaxSourceMapping = platformTaxSourceMapping;
  return patch;
}

export function mergeConfigSheetRows(rows: Rows, kb: KB): MergeConfigResult {
  if (rows.length < 2) return { ...ZERO_MERGE_CONFIG };
  return mergeConfigData(kb, parseConfigSheetRows(rows));
}

// 解析独立「签约主体映射」sheet（格式：签约主体 | 关键词1,关键词2）
export function parseSignEntitySheetRows(rows: Rows): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const seKey = String(row[0] || '').trim();
    const seKeywords = String(row[1] || '').trim();
    if (seKey && seKeywords) {
      mapping[seKey] = seKeywords.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    }
  }
  return mapping;
}

// 解析独立「平台税源地映射」sheet（格式：关键词 | 税源地）
export function parsePlatformTaxSourceSheetRows(rows: Rows): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const ptKey = String(row[0] || '').trim();
    const ptTaxSource = String(row[1] || '').trim();
    if (ptKey && ptTaxSource) mapping[ptKey] = ptTaxSource;
  }
  return mapping;
}

// —— 任务清单增量合并 ——
// 条目格式 "序号.任务名(商社编号)"：同一（商社编号+任务名）视为同一任务，新数据覆盖旧数据
// （更新序号），仅存在于旧数据的任务保留；无法解析格式的条目按整串去重。

function taskEntryKey(entry: string): string {
  const m = entry.match(/^(\d+)\.(.+)\((.+)\)$/);
  return m ? `${m[3]}|${m[2]}` : entry;
}

export function mergeTaskListEntries(entries: string[], kb: KB): { newCount: number; updateCount: number } {
  const merged = new Map<string, string>();
  for (const e of kb.taskListData || []) merged.set(taskEntryKey(e), e);
  let newCount = 0, updateCount = 0;
  for (const e of entries) {
    const key = taskEntryKey(e);
    if (merged.has(key)) updateCount++; else newCount++;
    merged.set(key, e); // 已存在的键原地更新（保持旧顺序），新键追加到末尾
  }
  if (newCount + updateCount > 0) kb.taskListData = [...merged.values()];
  return { newCount, updateCount };
}

export function mergeTaskListSheetRows(rows: Rows, kb: KB): { newCount: number; updateCount: number } {
  if (rows.length < 2) return { newCount: 0, updateCount: 0 };
  const entries: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const entry = String((rows[i] || [])[0] || '').trim();
    if (entry) entries.push(entry);
  }
  return mergeTaskListEntries(entries, kb);
}
