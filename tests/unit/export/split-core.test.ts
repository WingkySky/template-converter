// 拆分导出纯逻辑单测 —— 三种导出模式的分组键、文件名清洗与去重分配。
import { describe, it, expect } from 'vitest';
import {
  getSplitGroupsFromMeta, splitGroupLabel, sanitizeFileNamePart,
  getSplitFileBaseName, allocSplitFileName, type OutputRowMeta,
} from '../../../src/core/export/split-core';

const meta = (fileName: string, sheetName: string): OutputRowMeta => ({ fileName, sheetName });
const group = (fileName: string, sheetName: string) => ({ key: 'k', fileName, sheetName, rowIdxs: [0] });

describe('getSplitGroupsFromMeta', () => {
  it('merge 模式：忽略文件/表名，key 前缀仍为模式名', () => {
    const groups = getSplitGroupsFromMeta(
      [meta('a.csv', 'S1'), meta('b.csv', 'S1'), meta('a.csv', 'S2')], 'merge');
    expect(groups.map(g => g.key)).toEqual(['merge||a.csv', 'merge||b.csv']);
    expect(groups[0].rowIdxs).toEqual([0, 2]);
    expect(groups[1].rowIdxs).toEqual([1]);
  });

  it('byFile 模式：按文件名分组（忽略工作表名）', () => {
    const groups = getSplitGroupsFromMeta(
      [meta('a.csv', 'S1'), meta('a.csv', 'S2'), meta('b.xlsx', 'S1')], 'byFile');
    expect(groups.map(g => g.key)).toEqual(['byFile||a.csv', 'byFile||b.xlsx']);
    expect(groups[0].rowIdxs).toEqual([0, 1]);
    expect(groups[0].sheetName).toBe('S1'); // 记录首个出现的表名
  });

  it('bySheet 模式：按文件名+工作表名分组', () => {
    const groups = getSplitGroupsFromMeta(
      [meta('a.csv', 'S1'), meta('a.csv', 'S2'), meta('a.csv', 'S1')], 'bySheet');
    expect(groups.map(g => g.key)).toEqual(['bySheet||a.csv||S1', 'bySheet||a.csv||S2']);
    expect(groups[0].rowIdxs).toEqual([0, 2]);
    expect(groups[1].rowIdxs).toEqual([1]);
  });

  it('缺失文件名补「未命名文件」，缺失表名补空串；null/undefined meta → 空数组', () => {
    const groups = getSplitGroupsFromMeta([{ sheetName: 'S' }, { fileName: 'a.csv' }], 'bySheet');
    expect(groups.map(g => g.key)).toEqual(['bySheet||未命名文件||S', 'bySheet||a.csv||']);
    expect(getSplitGroupsFromMeta(null, 'byFile')).toEqual([]);
    expect(getSplitGroupsFromMeta(undefined, 'byFile')).toEqual([]);
  });

  it('mode 传 undefined 时按 merge 处理（原 state.exportMode || \'merge\' 语义）', () => {
    const groups = getSplitGroupsFromMeta([meta('a.csv', 'S1')], undefined);
    expect(groups[0].key).toBe('merge||a.csv');
  });
});

describe('splitGroupLabel', () => {
  it('bySheet 显示「文件 / 表」；表名空时补「默认表」；其他模式只显示文件名', () => {
    const g = group('a.csv', 'S1');
    expect(splitGroupLabel(g, 'bySheet')).toBe('a.csv / S1');
    expect(splitGroupLabel({ ...g, sheetName: '' }, 'bySheet')).toBe('a.csv / 默认表');
    expect(splitGroupLabel(g, 'byFile')).toBe('a.csv');
    expect(splitGroupLabel(g, 'merge')).toBe('a.csv');
  });
});

describe('sanitizeFileNamePart', () => {
  it('Windows 非法字符替换为空格，连续空白压缩，去首尾空白', () => {
    expect(sanitizeFileNamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(sanitizeFileNamePart('a\tb\rc\nd  e')).toBe('a b c d e');
    expect(sanitizeFileNamePart('  x  ')).toBe('x');
    expect(sanitizeFileNamePart(null)).toBe('');
    expect(sanitizeFileNamePart('')).toBe('');
  });

  it('限长 60 字符', () => {
    expect(sanitizeFileNamePart('好'.repeat(70)).length).toBe(60);
  });
});

describe('getSplitFileBaseName', () => {
  it('扩展名剥离 + 清洗 + 模版名拼接；merge/byFile 模式不追加表名', () => {
    expect(getSplitFileBaseName(group('发放表.xlsx', 'S1'), '本公司', 'byFile')).toBe('发放表_本公司');
    expect(getSplitFileBaseName(group('发放表.xlsx', ''), '本公司', 'merge')).toBe('发放表_本公司');
  });

  it('bySheet 模式追加清洗后的表名', () => {
    expect(getSplitFileBaseName(group('a.csv', '2026年9月'), '自定义', 'bySheet')).toBe('a_2026年9月_自定义');
  });

  it('文件名清洗后为空时补「未命名」', () => {
    expect(getSplitFileBaseName(group('   .xlsx', ''), '自定义', 'merge')).toBe('未命名_自定义');
  });

  it('compact 规则：整批同源文件省文件名段、单模板省模板名段（单文件多表 → 表名）', () => {
    const groups = [group('发放表.xlsx', 'S1'), group('发放表.xlsx', 'S2')];
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'compact', allGroups: groups }))
      .toBe('S1');
  });

  it('compact 规则：整批同表名省表名段（多文件同表 → 文件名，天然不撞名）', () => {
    const groups = [group('a.csv', 'S1'), group('b.csv', 'S1')];
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'compact', allGroups: groups }))
      .toBe('a');
    expect(getSplitFileBaseName(groups[1], '本公司', 'bySheet', { rule: 'compact', allGroups: groups }))
      .toBe('b');
  });

  it('compact 规则：混合场景保留文件+表名；multiTemplate 时保留模板名段', () => {
    const mixed = [group('a.csv', 'S1'), group('a.csv', 'S2'), group('b.csv', 'S1')];
    expect(getSplitFileBaseName(mixed[2], '本公司', 'bySheet', { rule: 'compact', allGroups: mixed }))
      .toBe('b_S1');
    const two = [group('a.csv', 'S1'), group('b.csv', 'S1')];
    expect(getSplitFileBaseName(two[0], '本公司', 'bySheet', { rule: 'compact', allGroups: two, multiTemplate: true }))
      .toBe('a_本公司');
  });

  it('compact 规则：段全空时兜底「拆分结果」', () => {
    const groups = [group('发放表.xlsx', ''), group('发放表.xlsx', '')];
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'compact', allGroups: groups }))
      .toBe('拆分结果');
  });

  it('compact 规则：文件段剥离整批公共前缀与同名段（真实工表格场景）', () => {
    const names = [
      '2026年发放表格-广州市晟联数码科技-福州8月代发',
      '2026年发放表格-广州市晟联数码科技-武汉8月代发（李结机朴生活费）',
      '2026年发放表格-广州市晟联数码科技-武汉8月代发（杨缘）',
      '2026年9月(工资结算)灵工发放表格-广州市晟联数码科技-坂田基地',
      '2026年灵工发放表格-广州市晟联数码科技-韶关二期8月代发-吕双全班组',
    ];
    const groups = names.map(n => group(n, ''));
    expect(getSplitFileBaseName(groups[0], '本公司', 'byFile', { rule: 'compact', allGroups: groups }))
      .toBe('发放表格-福州8月代发');
    expect(getSplitFileBaseName(groups[3], '本公司', 'byFile', { rule: 'compact', allGroups: groups }))
      .toBe('9月(工资结算)灵工发放表格-坂田基地');
    expect(getSplitFileBaseName(groups[4], '本公司', 'byFile', { rule: 'compact', allGroups: groups }))
      .toBe('灵工发放表格-韶关二期8月代发-吕双全班组');
  });

  it('compact 规则：公共后缀剥离；剔除整批相同的中间「-」段；剥空名字时跳过（防呆）', () => {
    // 公共后缀「-公司-甲」被剥掉，只剩真正有区分度的首段
    const suffix = [group('A-公司-甲', ''), group('B-公司-甲', '')];
    expect(getSplitFileBaseName(suffix[0], '本公司', 'byFile', { rule: 'compact', allGroups: suffix }))
      .toBe('A');
    // 后缀不同时走中间同名段剔除
    const mid = [group('A-公司-甲', ''), group('B-公司-乙', '')];
    expect(getSplitFileBaseName(mid[0], '本公司', 'byFile', { rule: 'compact', allGroups: mid }))
      .toBe('A-甲');
    expect(getSplitFileBaseName(mid[1], '本公司', 'byFile', { rule: 'compact', allGroups: mid }))
      .toBe('B-乙');
    // 剥前缀会把「甲」剥空 → 跳过该步，保留原名
    const emptying = [group('甲', ''), group('甲乙', '')];
    expect(getSplitFileBaseName(emptying[0], '本公司', 'byFile', { rule: 'compact', allGroups: emptying }))
      .toBe('甲');
    expect(getSplitFileBaseName(emptying[1], '本公司', 'byFile', { rule: 'compact', allGroups: emptying }))
      .toBe('甲乙');
  });

  it('batchno 规则：批次号即文件名，多模板拼「批次号_模板名」，空批次号回退 compact', () => {
    const groups = [group('发放表.xlsx', 'S1'), group('发放表.xlsx', 'S2')];
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'batchno', allGroups: groups, batchNo: '20260908SLSM-A' }))
      .toBe('20260908SLSM-A');
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'batchno', allGroups: groups, batchNo: 'BN', multiTemplate: true }))
      .toBe('BN_本公司');
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'batchno', allGroups: groups, batchNo: '' }))
      .toBe('S1');
  });

  it('batchno 规则：批次号经清洗（非法字符替换）', () => {
    expect(getSplitFileBaseName(group('a.csv', ''), '本公司', 'byFile', { rule: 'batchno', batchNo: 'x/y' }))
      .toBe('x y');
  });

  it('batchno-compact 规则：批次号_精简结果；无批次号回退精简；多模板保留模板名', () => {
    const groups = [group('发放表.xlsx', 'S1'), group('发放表.xlsx', 'S2')];
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'batchno-compact', allGroups: groups, batchNo: '20260908SLSM-A' }))
      .toBe('20260908SLSM-A_S1');
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'batchno-compact', allGroups: groups, batchNo: '' }))
      .toBe('S1');
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'batchno-compact', allGroups: groups, batchNo: 'BN', multiTemplate: true }))
      .toBe('BN_S1_本公司');
  });

  it('naming 缺省或 full 规则行为逐字不变（回归）', () => {
    const groups = [group('发放表.xlsx', 'S1'), group('发放表.xlsx', 'S2')];
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet')).toBe('发放表_S1_本公司');
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { rule: 'full', allGroups: groups }))
      .toBe('发放表_S1_本公司');
    expect(getSplitFileBaseName(groups[0], '本公司', 'bySheet', { allGroups: groups }))
      .toBe('发放表_S1_本公司');
  });
});

describe('allocSplitFileName', () => {
  it('首分配 base.ext 并登记进 usedNames', () => {
    const used = new Set<string>();
    expect(allocSplitFileName(group('a.csv', ''), 'xlsx', used, '本公司', 'merge')).toBe('a_本公司.xlsx');
    expect(used.has('a_本公司.xlsx')).toBe(true);
  });

  it('冲突时递增 (2)/(3) 后缀', () => {
    const used = new Set<string>(['a_本公司.xlsx']);
    expect(allocSplitFileName(group('a.csv', ''), 'xlsx', used, '本公司', 'merge')).toBe('a_本公司(2).xlsx');
    expect(allocSplitFileName(group('a.csv', ''), 'xlsx', used, '本公司', 'merge')).toBe('a_本公司(3).xlsx');
  });

  it('naming 透传：compact 按组取段，batchno 同号冲突走 (2) 后缀', () => {
    const groups = [group('发放表.xlsx', 'S1'), group('发放表.xlsx', 'S2')];
    const used = new Set<string>();
    expect(allocSplitFileName(groups[0], 'xlsx', used, '本公司', 'bySheet', { rule: 'compact', allGroups: groups }))
      .toBe('S1.xlsx');
    expect(allocSplitFileName(groups[1], 'xlsx', used, '本公司', 'bySheet', { rule: 'compact', allGroups: groups }))
      .toBe('S2.xlsx');
    const same = [group('a.csv', ''), group('a.csv', '')];
    const used2 = new Set<string>();
    expect(allocSplitFileName(same[0], 'xlsx', used2, '本公司', 'bySheet', { rule: 'batchno', allGroups: same, batchNo: 'BN' }))
      .toBe('BN.xlsx');
    expect(allocSplitFileName(same[1], 'xlsx', used2, '本公司', 'bySheet', { rule: 'batchno', allGroups: same, batchNo: 'BN' }))
      .toBe('BN(2).xlsx');
  });
});
