// 任务清单/工种推断单测 —— parseTaskString、normalizeTaskNameToWorkType、inferWorkType
// 为 git 修复历史高危区。
import { describe, it, expect } from 'vitest';
import {
  parseTaskListEntries, generateGlobalTaskList, findTaskContent,
  normalizeTaskNameToWorkType, inferWorkType, parseTaskString,
  kbGetTasksForShangShe, generateConfigSheet, generateTaskListSheet,
  generateSignEntitySheet, generatePlatformTaxSourceSheet,
} from '../../../src/core/kb/task';
import { DEFAULT_CONFIG, type KB } from '../../../src/core/kb/model';

function makeKB(): KB {
  return { shangSheMap: {}, configData: { taxSources: [], platforms: [] }, taskListData: [], lastUpdated: null, schemaVersion: 1 };
}

describe('parseTaskString', () => {
  it('解析 "序号.任务名(商社编号)"', () => {
    expect(parseTaskString('22.保洁服务(0000913)')).toEqual({
      name: '保洁服务',
      shangSheId: '0000913',
      fullString: '22.保洁服务(0000913)',
    });
  });

  it('格式不符返回 null', () => {
    expect(parseTaskString('保洁服务')).toBeNull();
    expect(parseTaskString('')).toBeNull();
    expect(parseTaskString('1.缺少括号')).toBeNull();
  });
});

describe('parseTaskListEntries', () => {
  it('按商社编号过滤并解析序号/名称/内容/完整串', () => {
    const entry = { id: '0001', tasks: [{ name: '保洁', content: '打扫干净' }] };
    const result = parseTaskListEntries(['1.保洁(0001)', '2.搬运(0002)', '3.保洁(0001)'], '0001', entry);
    expect(result).toEqual([
      { seq: 1, name: '保洁', shangSheId: '0001', content: '打扫干净', fullString: '1.保洁(0001)' },
      { seq: 3, name: '保洁', shangSheId: '0001', content: '打扫干净', fullString: '3.保洁(0001)' },
    ]);
  });

  it('无匹配 / 空清单返回 []；entry 可为空（内容为空串）', () => {
    expect(parseTaskListEntries(['1.保洁(0001)'], '0002', null)).toEqual([]);
    expect(parseTaskListEntries(null, '0001', null)).toEqual([]);
    expect(parseTaskListEntries(undefined, '0001', null)).toEqual([]);
    expect(parseTaskListEntries(['1.保洁(0001)'], '0001', null)[0].content).toBe('');
  });
});

describe('generateGlobalTaskList', () => {
  it('按 shangSheMap 插入顺序连续编号', () => {
    const kb = makeKB();
    kb.shangSheMap['0001'] = { id: '0001', tasks: [{ name: '保洁', content: 'a' }, { name: '搬运', content: 'b' }] };
    kb.shangSheMap['0002'] = { id: '0002', tasks: [{ name: '司机', content: 'c' }] };
    expect(generateGlobalTaskList(kb)).toEqual([
      { seq: 1, name: '保洁', shangSheId: '0001', content: 'a' },
      { seq: 2, name: '搬运', shangSheId: '0001', content: 'b' },
      { seq: 3, name: '司机', shangSheId: '0002', content: 'c' },
    ]);
  });
});

describe('findTaskContent', () => {
  it('按名称（trim 后）匹配任务内容', () => {
    const entry = { id: '0001', tasks: [{ name: ' 保洁 ', content: ' 打扫 ' }] };
    expect(findTaskContent(entry, '保洁')).toBe('打扫');
    expect(findTaskContent(entry, '搬运')).toBe('');
    expect(findTaskContent(null, '保洁')).toBe('');
    expect(findTaskContent(entry, '')).toBe('');
  });
});

describe('normalizeTaskNameToWorkType（git 高危区）', () => {
  it('剥离序号前缀与括号后缀', () => {
    expect(normalizeTaskNameToWorkType('1.保洁服务')).toBe('保洁');
    expect(normalizeTaskNameToWorkType('12.搬运(0001)')).toBe('搬运');
  });
  it('剥离提供/从事/完成/开展前缀与 服务/工作/任务/人员/岗位 后缀', () => {
    expect(normalizeTaskNameToWorkType('提供搬运服务')).toBe('搬运');
    expect(normalizeTaskNameToWorkType('开展数据录入工作')).toBe('数据录入');
  });
  it('无法归一时回退原始名称；空值返回空串', () => {
    expect(normalizeTaskNameToWorkType('送水工')).toBe('送水工');
    expect(normalizeTaskNameToWorkType('')).toBe('');
    expect(normalizeTaskNameToWorkType(undefined)).toBe('');
  });
});

describe('inferWorkType（git 高危区）', () => {
  it('工种规则按声明顺序命中（任务内容）', () => {
    expect(inferWorkType({ name: '临时任务', content: '负责厂区保洁打扫' }, null, null)).toBe('保洁');
    expect(inferWorkType('司机', null, null)).toBe('司机');
    expect(inferWorkType({ name: '其他', content: '仓库打包发货' }, null, null)).toBe('搬运');
  });

  it('行上下文（note/clientName 列）参与匹配', () => {
    expect(inferWorkType({ name: '其他' }, ['备注：仓库打包发货'], { note: 0 })).toBe('搬运');
    expect(inferWorkType({ name: '其他' }, null, null)).toBe('其他');
  });

  it('"提供XX服务"句式提取工种', () => {
    expect(inferWorkType({ name: '绿化养护' }, ['提供绿化养护服务'], { note: 0 })).toBe('绿化养护');
  });

  it('无规则命中时回退 normalizeTaskNameToWorkType', () => {
    expect(inferWorkType('1.送水工(001)', null, null)).toBe('送水工');
  });
});

describe('kbGetTasksForShangShe', () => {
  it('优先 taskListData 匹配，回退商社自带 tasks（序号取全局清单）', () => {
    const kb = makeKB();
    kb.shangSheMap['0001'] = { id: '0001', tasks: [{ name: '保洁', content: '打扫' }] };
    expect(kbGetTasksForShangShe(kb, '0001')).toEqual([
      { seq: 1, name: '保洁', shangSheId: '0001', content: '打扫', fullString: '1.保洁(0001)' },
    ]);
    kb.taskListData = ['5.搬运(0001)', '6.保洁(0001)'];
    expect(kbGetTasksForShangShe(kb, '0001')).toEqual([
      { seq: 5, name: '搬运', shangSheId: '0001', content: '', fullString: '5.搬运(0001)' },
      { seq: 6, name: '保洁', shangSheId: '0001', content: '打扫', fullString: '6.保洁(0001)' },
    ]);
    expect(kbGetTasksForShangShe(kb, '')).toEqual([]);
    expect(kbGetTasksForShangShe(kb, '9999')).toEqual([]);
  });
});

describe('generateConfigSheet', () => {
  it('空知识库回落 DEFAULT_CONFIG，按最大长度补空', () => {
    const sheet = generateConfigSheet(makeKB());
    expect(sheet[0]).toEqual(['税源地', '平台']);
    expect(sheet).toHaveLength(1 + DEFAULT_CONFIG.platforms.length);
    expect(sheet[1]).toEqual(['0001.湖南', '278.甲乙科技']);
  });

  it('已上传配置优先使用', () => {
    const kb = makeKB();
    kb.configData = { taxSources: ['0009.测试'], platforms: ['P1', 'P2'] };
    const sheet = generateConfigSheet(kb);
    expect(sheet).toEqual([['税源地', '平台'], ['0009.测试', 'P1'], ['', 'P2']]);
  });
});

describe('generateTaskListSheet', () => {
  it('taskListData 非空时逐行输出', () => {
    const kb = makeKB();
    kb.taskListData = ['1.保洁(0001)', '2.搬运(0002)'];
    expect(generateTaskListSheet(kb)).toEqual([['任务清单'], ['1.保洁(0001)'], ['2.搬运(0002)']]);
  });

  it('回退：从 shangSheMap 生成带序号任务串', () => {
    const kb = makeKB();
    kb.shangSheMap['0001'] = { id: '0001', tasks: [{ name: '保洁', content: 'a' }] };
    kb.shangSheMap['0002'] = { id: '0002', tasks: [{ name: '搬运', content: 'b' }] };
    expect(generateTaskListSheet(kb)).toEqual([['任务清单'], ['1.保洁(0001)'], ['2.搬运(0002)']]);
  });
});

describe('generateSignEntitySheet / generatePlatformTaxSourceSheet（备份导出映射）', () => {
  it('生成与上传解析格式一致的键值行；空映射只输出表头', () => {
    const kb = makeKB();
    kb.configData.signEntityMapping = { '佛山云杉': ['佛山', '甲乙'] };
    kb.configData.platformTaxSourceMapping = { '天津': '0007.天津' };
    expect(generateSignEntitySheet(kb)).toEqual([['签约主体', '关键词'], ['佛山云杉', '佛山,甲乙']]);
    expect(generatePlatformTaxSourceSheet(kb)).toEqual([['平台关键词', '税源地'], ['天津', '0007.天津']]);
    const empty = makeKB();
    expect(generateSignEntitySheet(empty)).toEqual([['签约主体', '关键词']]);
    expect(generatePlatformTaxSourceSheet(empty)).toEqual([['平台关键词', '税源地']]);
  });
});
