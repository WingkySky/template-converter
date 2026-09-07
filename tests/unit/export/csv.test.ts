// CSV 序列化单测 —— 引号转义/逗号/换行等特殊字符行为。
import { describe, it, expect } from 'vitest';
import { rowsToCSV } from '../../../src/core/export/csv';

describe('rowsToCSV', () => {
  it('无特殊字符：直接拼接，表头在首行，行间 \\n', () => {
    expect(rowsToCSV(['姓名', '金额'], [['张三', '100'], ['李四', '200']]))
      .toBe('姓名,金额\n张三,100\n李四,200');
  });

  it('含逗号：整格加引号', () => {
    expect(rowsToCSV(['a'], [['x,y']])).toBe('a\n"x,y"');
  });

  it('含双引号：整格加引号且内部引号翻倍', () => {
    expect(rowsToCSV(['a'], [['say "hi"']])).toBe('a\n"say ""hi"""');
  });

  it('含换行：整格加引号（引号内保留原始换行）', () => {
    expect(rowsToCSV(['a'], [['l1\nl2']])).toBe('a\n"l1\nl2"');
  });

  it('null/undefined/0/false 等假值输出空串（沿用原 String(cell || \'\') 语义）', () => {
    expect(rowsToCSV(['a', 'b', 'c', 'd'], [[null, undefined, 0, false]])).toBe('a,b,c,d\n,,,');
  });

  it('一行内多个特殊字符格各自独立转义', () => {
    expect(rowsToCSV(['h1', 'h2'], [['x,y', 'p"q']])).toBe('h1,h2\n"x,y","p""q"');
  });
});
