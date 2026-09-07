// 知识库数据模型 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 B），
// 仅补充类型注解与显式 export，不改变任何行为。
// 原 legacy.js 锚点：KB_STORAGE_KEY/KB_SCHEMA_VERSION L75-76、DEFAULT_CONFIG L79-111、
// getConfigLists L113、migrateKB L201、KB_MAIN_HEADERS L270、mergeKnowledgeRows L272、
// knowledgeRowsFromKB L321、applyConfigSheetRows L343、applyTaskListSheetRows L359。
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

export function applyConfigSheetRows(rows: Rows, kb: KB): void {
  if (rows.length < 2) return;
  const taxSources = [];
  const platforms = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const taxVal = String(row[0] || '').trim();
    const platVal = String(row[1] || '').trim();
    if (taxVal) taxSources.push(taxVal);
    if (platVal) platforms.push(platVal);
  }
  if (taxSources.length > 0 || platforms.length > 0) {
    kb.configData = { taxSources, platforms };
  }
}

export function applyTaskListSheetRows(rows: Rows, kb: KB): void {
  if (rows.length < 2) return;
  const taskEntries = [];
  for (let i = 1; i < rows.length; i++) {
    const entry = String((rows[i] || [])[0] || '').trim();
    if (entry) taskEntries.push(entry);
  }
  if (taskEntries.length > 0) {
    kb.taskListData = taskEntries;
  }
}
