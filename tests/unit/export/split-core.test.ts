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
    expect(getSplitFileBaseName(group('发放表.xlsx', 'S1'), '云杉公司', 'byFile')).toBe('发放表_云杉公司');
    expect(getSplitFileBaseName(group('发放表.xlsx', ''), '云杉公司', 'merge')).toBe('发放表_云杉公司');
  });

  it('bySheet 模式追加清洗后的表名', () => {
    expect(getSplitFileBaseName(group('a.csv', '2026年9月'), '自定义', 'bySheet')).toBe('a_2026年9月_自定义');
  });

  it('文件名清洗后为空时补「未命名」', () => {
    expect(getSplitFileBaseName(group('   .xlsx', ''), '自定义', 'merge')).toBe('未命名_自定义');
  });
});

describe('allocSplitFileName', () => {
  it('首分配 base.ext 并登记进 usedNames', () => {
    const used = new Set<string>();
    expect(allocSplitFileName(group('a.csv', ''), 'xlsx', used, '云杉公司', 'merge')).toBe('a_云杉公司.xlsx');
    expect(used.has('a_云杉公司.xlsx')).toBe(true);
  });

  it('冲突时递增 (2)/(3) 后缀', () => {
    const used = new Set<string>(['a_云杉公司.xlsx']);
    expect(allocSplitFileName(group('a.csv', ''), 'xlsx', used, '云杉公司', 'merge')).toBe('a_云杉公司(2).xlsx');
    expect(allocSplitFileName(group('a.csv', ''), 'xlsx', used, '云杉公司', 'merge')).toBe('a_云杉公司(3).xlsx');
  });
});
