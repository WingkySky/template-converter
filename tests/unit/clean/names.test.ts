// 姓名清洗单测：注记剥离、安全边界（少数民族名/一格多人/非中文开头不误伤）。
// 样例含 2026-10 真实业务中出现的注记形态（王辉2 / 陈建新8月）。
import { describe, expect, it } from 'vitest';
import { cleanNameCell } from '../../../src/core/clean/names';

describe('cleanNameCell · 注记剥离', () => {
  it('尾部数字注记（同一人第二笔/编号）', () => {
    expect(cleanNameCell('王辉2')).toBe('王辉');
    expect(cleanNameCell('陈建新8月')).toBe('陈建新');
    expect(cleanNameCell('李梅12号')).toBe('李梅');
  });

  it('括号/标点注记', () => {
    expect(cleanNameCell('王辉（补发）')).toBe('王辉');
    expect(cleanNameCell('王辉(新)')).toBe('王辉');
    expect(cleanNameCell('王辉。')).toBe('王辉');
  });

  it('中文间空格折叠', () => {
    expect(cleanNameCell('王 辉')).toBe('王辉');
  });

  it('·连接的少数民族名带注记时保留全名', () => {
    expect(cleanNameCell('古丽娜尔·买买提2')).toBe('古丽娜尔·买买提');
  });
});

describe('cleanNameCell · 安全边界（不误伤）', () => {
  it('纯中文整格原样（含 5~6 字与·连接名）', () => {
    expect(cleanNameCell('王辉')).toBe('王辉');
    expect(cleanNameCell('欧阳娜娜')).toBe('欧阳娜娜');
    expect(cleanNameCell('努尔买买提')).toBe('努尔买买提');
    expect(cleanNameCell('古丽娜尔·买买提')).toBe('古丽娜尔·买买提');
  });

  it('疑似一格多人（、，分隔）不清洗，绝不静默丢人', () => {
    expect(cleanNameCell('王辉、王辉2')).toBe('王辉、王辉2');
    expect(cleanNameCell('王辉，吴佐生')).toBe('王辉，吴佐生');
  });

  it('不以中文开头/长度异常不动', () => {
    expect(cleanNameCell('John Wick')).toBe('John Wick');
    expect(cleanNameCell('8月陈建新')).toBe('8月陈建新');
    expect(cleanNameCell('张3')).toBe('张3'); // 前导中文不足 2 字
  });

  it('机构/全称形态不动（客户名称列常被误标为 name 类型，compare 回归案例）', () => {
    expect(cleanNameCell('武汉市红枫咨询商行（个体工商户）')).toBe('武汉市红枫咨询商行（个体工商户）');
    expect(cleanNameCell('建设银行股份有限公司北京上地支行2')).toBe('建设银行股份有限公司北京上地支行2');
    expect(cleanNameCell('红枫咨询服务中心（新）')).toBe('红枫咨询服务中心（新）');
  });

  it('空值安全（全空白格清为空串，导出时等价于空）', () => {
    expect(cleanNameCell('')).toBe('');
    expect(cleanNameCell('   ')).toBe('');
  });
});
