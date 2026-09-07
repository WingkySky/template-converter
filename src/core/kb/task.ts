// 任务清单/工种推断/配置与任务 sheet 生成 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 B）。
// 原 legacy.js 锚点：parseTaskListEntries L761、generateGlobalTaskList L1078、findTaskContent L1090、
// WORK_TYPE_RULES L1096、normalizeTaskNameToWorkType L1112、inferWorkType L1120、
// parseTaskString L1141、generateConfigSheet L1190、generateTaskListSheet L1210、
// getTasksForShangShe L2528。
// 去 loadKB 化说明（唯一结构性改动）：getTasksForShangShe 原函数体内 `const kb = loadKB()`
// 改为 kb 提升为第一个参数，导出名加 kb 前缀；legacy.js 保留原签名包装函数。
import type { ShangSheEntry, Row, Rows } from '../../types';
import type { KB } from './model';
import { DEFAULT_CONFIG } from './model';

export interface GlobalTask { seq: number; name: string; shangSheId: string; content: string; }

export interface MatchedTask extends GlobalTask { fullString: string; }

// 从taskListData中解析匹配指定商社编号的任务条目
export function parseTaskListEntries(
  taskListData: string[] | null | undefined,
  shangSheId: string,
  entry: ShangSheEntry | null | undefined,
): MatchedTask[] {
  if (!taskListData || !taskListData.length) return [];
  const entries: MatchedTask[] = [];
  for (const taskEntry of taskListData) {
    const match = taskEntry.match(/^(\d+)\.(.+)\((.+)\)$/);
    if (match && match[3] === String(shangSheId).trim()) {
      entries.push({
        seq: parseInt(match[1]),
        name: match[2],
        shangSheId: match[3],
        content: findTaskContent(entry, match[2]),
        fullString: taskEntry
      });
    }
  }
  return entries;
}

// 生成全局任务清单（带序号）
export function generateGlobalTaskList(kb: KB): GlobalTask[] {
  const entries = Object.values(kb.shangSheMap);
  const taskList: GlobalTask[] = [];
  let seq = 1;
  for (const entry of entries) {
    for (const task of (entry.tasks || [])) {
      taskList.push({ seq: seq++, name: task.name, shangSheId: entry.id, content: task.content });
    }
  }
  return taskList;
}

export function findTaskContent(entry: ShangSheEntry | null | undefined, taskName: string | null | undefined): string {
  if (!entry || !Array.isArray(entry.tasks) || !taskName) return '';
  const task = entry.tasks.find(t => String(t.name || '').trim() === String(taskName || '').trim());
  return task ? String(task.content || '').trim() : '';
}

const WORK_TYPE_RULES: { value: string; pattern: RegExp }[] = [
  { value: '保洁', pattern: /保洁|清洁|清扫|打扫|清洗|家政|卫生/ },
  { value: '搬运', pattern: /搬运|装卸|分拣|理货|仓储|打包|包装|配送|快递|物流/ },
  { value: '司机', pattern: /司机|驾驶|代驾|开车|车辆|运输/ },
  { value: '客服', pattern: /客服|客户服务|呼叫|回访|咨询|售后/ },
  { value: '销售', pattern: /销售|促销|推广|导购|营销|业务拓展/ },
  { value: '技术', pattern: /技术|开发|软件|系统|运维|测试|信息|数据|网络|设计/ },
  { value: '培训', pattern: /培训|讲师|授课|教学|辅导|教练/ },
  { value: '翻译', pattern: /翻译|口译|笔译/ },
  { value: '摄影', pattern: /摄影|摄像|拍摄|剪辑|视频|直播/ },
  { value: '安保', pattern: /安保|保安|秩序|巡逻|门卫/ },
  { value: '餐饮', pattern: /餐饮|厨师|后厨|配餐|服务员|洗碗/ },
  { value: '文员', pattern: /文员|行政|助理|录入|文案|资料整理/ },
  { value: '安装维修', pattern: /安装|维修|维护|检修|修理|装配/ }
];

export function normalizeTaskNameToWorkType(taskName: string | null | undefined): string {
  let s = String(taskName || '').trim();
  if (!s) return '';
  s = s.replace(/^\d+\./, '').replace(/\([^)]*\)\s*$/, '').trim();
  s = s.replace(/^(提供|从事|完成|开展)/, '').replace(/(类)?(服务|工作|任务|人员|岗位)$/g, '').trim();
  return s || String(taskName || '').trim();
}

export function inferWorkType(
  task: string | { name?: string; content?: string } | null | undefined,
  row: Row | null | undefined,
  typeToCol: Record<string, number | null> | null | undefined,
): string {
  const rowTextParts: Row = [];
  if (row && typeToCol) {
    ['note', 'clientName'].forEach(type => {
      if (typeToCol[type] != null) rowTextParts.push(row[typeToCol[type]!]);
    });
  }
  const taskName = typeof task === 'string' ? task : (task?.name || '');
  const taskContent = typeof task === 'string' ? '' : (task?.content || '');
  const text = [...rowTextParts, taskContent, taskName].map(v => String(v || '')).join(' ');

  for (const rule of WORK_TYPE_RULES) {
    if (rule.pattern.test(text)) return rule.value;
  }

  const serviceMatch = text.match(/(?:提供|从事|完成|开展)([^，。,；;\s]{2,12}?)(?:服务|工作|任务)/);
  if (serviceMatch && serviceMatch[1]) return normalizeTaskNameToWorkType(serviceMatch[1]);

  return normalizeTaskNameToWorkType(taskName);
}

export interface ParsedTaskString { name: string; shangSheId: string; fullString: string; }

export function parseTaskString(taskString: string): ParsedTaskString | null {
  const match = String(taskString || '').match(/^\d+\.(.+)\((.+)\)$/);
  return match ? { name: match[1], shangSheId: match[2], fullString: taskString } : null;
}

export function kbGetTasksForShangShe(kb: KB, shangSheId: string | null | undefined): MatchedTask[] {
  if (!shangSheId) return [];
  const entry = kb.shangSheMap[String(shangSheId).trim()];
  let matchedTasks: MatchedTask[] = [];

  // 优先从taskListData查找
  matchedTasks = parseTaskListEntries(kb.taskListData, shangSheId, entry);

  // 回退到KB的tasks
  if (matchedTasks.length === 0) {
    if (entry && entry.tasks && entry.tasks.length > 0) {
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
  }

  return matchedTasks;
}

// 生成配置表sheet数据
export function generateConfigSheet(kb: KB): Rows {
  // 优先使用KB中上传的配置数据，否则使用默认配置
  let taxSources, platforms;
  if (kb.configData && kb.configData.taxSources && kb.configData.taxSources.length > 0) {
    taxSources = kb.configData.taxSources;
    platforms = kb.configData.platforms || [];
  } else {
    taxSources = DEFAULT_CONFIG.taxSources;
    platforms = DEFAULT_CONFIG.platforms;
  }

  const maxLen = Math.max(taxSources.length, platforms.length);
  const sheetData: Rows = [['税源地', '平台']];
  for (let i = 0; i < maxLen; i++) {
    sheetData.push([taxSources[i] || '', platforms[i] || '']);
  }
  return sheetData;
}

// 生成任务清单sheet数据
export function generateTaskListSheet(kb: KB): Rows {
  // 优先使用KB中上传的任务清单数据，否则从shangSheMap生成
  if (kb.taskListData && kb.taskListData.length > 0) {
    const sheetData: Rows = [['任务清单']];
    for (const entry of kb.taskListData) {
      sheetData.push([entry]);
    }
    return sheetData;
  }
  // 回退：从shangSheMap生成
  const globalTasks = generateGlobalTaskList(kb);
  const sheetData: Rows = [['任务清单']];
  for (const task of globalTasks) {
    sheetData.push([`${task.seq}.${task.name}(${task.shangSheId})`]);
  }
  return sheetData;
}
