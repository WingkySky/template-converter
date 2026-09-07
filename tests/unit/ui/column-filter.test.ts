// 列筛选纯逻辑单测（node 环境，不依赖 DOM）
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeSearchText, getColumnUniqueValues } from '../../../src/ui/column-filter';
import { state } from '../../../src/state';

describe('normalizeSearchText', () => {
  it('trim + 转小写', () => {
    expect(normalizeSearchText('  AbC 布 Enter ')).toBe('abc 布 enter');
  });
  it('null/undefined → 空串', () => {
    expect(normalizeSearchText(null)).toBe('');
    expect(normalizeSearchText(undefined)).toBe('');
  });
  it('数字转字符串', () => {
    expect(normalizeSearchText(123)).toBe('123');
  });
});

describe('getColumnUniqueValues', () => {
  beforeEach(() => {
    state.outputRows = [
      ['张三', 'a', 1],
      ['李四', 'b', 2],
      ['张三', null, 1],
    ];
  });
  afterEach(() => {
    state.outputRows = null;
  });

  it('去重、按字典序排序', () => {
    expect(getColumnUniqueValues(0)).toEqual(['张三', '李四'].sort());
  });
  it('null 值归一为空串', () => {
    expect(getColumnUniqueValues(1)).toEqual(['', 'a', 'b']);
  });
  it('数字转字符串后参与去重', () => {
    expect(getColumnUniqueValues(2)).toEqual(['1', '2']);
  });
  it('outputRows 为空时返回空数组', () => {
    state.outputRows = null;
    expect(getColumnUniqueValues(0)).toEqual([]);
  });
});
