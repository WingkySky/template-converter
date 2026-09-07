// isAmountLikeNumber / getAmountColumnScore 单测 —— 覆盖货币格式（¥ 前缀、千分位）与
// 手机号/银行卡/身份证号等易混淆值的排除逻辑。
import { describe, it, expect } from 'vitest';
import { isAmountLikeNumber, getAmountColumnScore } from '../../../src/core/mapping/amount-score';
import type { Rows } from '../../../src/types';

describe('isAmountLikeNumber', () => {
  it('¥/￥/$ 等货币符号与千分位、空格', () => {
    expect(isAmountLikeNumber('¥90,100.00')).toBe(true);
    expect(isAmountLikeNumber('￥1,234')).toBe(true);
    expect(isAmountLikeNumber('1,234.5')).toBe(true);
    expect(isAmountLikeNumber('5200.50')).toBe(true);
    expect(isAmountLikeNumber(' 90,100 ')).toBe(true);
  });

  it('元/人民币后缀', () => {
    expect(isAmountLikeNumber('100元')).toBe(true);
    expect(isAmountLikeNumber('12人民币')).toBe(true);
  });

  it('手机号 / 银行卡号 / 身份证号不判为金额', () => {
    expect(isAmountLikeNumber('13800138000')).toBe(false);          // 11 位
    expect(isAmountLikeNumber('6217000000000000247')).toBe(false);  // 19 位
    expect(isAmountLikeNumber('42082119860805901X')).toBe(false);   // 17 位+X
  });

  it('非正数与非法值', () => {
    expect(isAmountLikeNumber('')).toBe(false);
    expect(isAmountLikeNumber(null)).toBe(false);
    expect(isAmountLikeNumber(undefined)).toBe(false);
    expect(isAmountLikeNumber('abc')).toBe(false);
    expect(isAmountLikeNumber('0')).toBe(false);
    expect(isAmountLikeNumber('-5')).toBe(false);
    expect(isAmountLikeNumber('1e9')).toBe(false);      // ≥ 1e8 上限
    expect(isAmountLikeNumber('99999999.99')).toBe(true);
  });
});

describe('getAmountColumnScore', () => {
  const numericRows: Rows = Array.from({ length: 12 }, (_, i) => [`数据${i}`, String(1000 + i * 7)]);

  it('表头关键词加分 + 全命中数据加分', () => {
    expect(getAmountColumnScore('税前金额', numericRows, 1)).toBe(20); // 12 + 8
    expect(getAmountColumnScore('应发金额', numericRows, 1)).toBe(17); // 9 + 8
    expect(getAmountColumnScore('金额', numericRows, 1)).toBe(14);     // 6 + 8
  });

  it('无数据行时仅返回关键词分', () => {
    expect(getAmountColumnScore('税前金额', [], 0)).toBe(12);
  });

  it('黑名单表头返回 -Infinity', () => {
    expect(getAmountColumnScore('序号', numericRows, 1)).toBe(-Infinity);
    expect(getAmountColumnScore('手机号', numericRows, 1)).toBe(-Infinity);
    expect(getAmountColumnScore('开户银行', numericRows, 1)).toBe(-Infinity);
    expect(getAmountColumnScore('', numericRows, 1)).toBe(-Infinity);
  });

  it('无关键词命中时施加低命中率惩罚', () => {
    // 1/12 命中：score = 0 + 0.67 < 6 → -8
    const sparse: Rows = Array.from({ length: 12 }, (_, i) => [i === 0 ? '100' : '不适用']);
    const s = getAmountColumnScore('数量', sparse, 0);
    expect(s).toBeLessThan(0);
    // 关键词已命中（score ≥ 6）则不惩罚
    const noHits: Rows = Array.from({ length: 12 }, () => ['不适用']);
    expect(getAmountColumnScore('金额', noHits, 0)).toBe(6);
  });
});
