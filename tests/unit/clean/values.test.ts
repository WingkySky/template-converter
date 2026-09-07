// sanitizeAmount / cleanValue 单测 —— 重点覆盖 git 近期修复：
// 身份证末位形近字符归一（罗马数字 Ⅹ/ⅹ、西里尔 Х/х → 大写 X）。
import { describe, it, expect } from 'vitest';
import { sanitizeAmount, cleanValue } from '../../../src/core/clean/values';
import { parseCSV } from '../../../src/core/parser/parse-csv';
import csvUtf8 from '../../fixtures/发放明细-UTF8.csv?raw';

describe('sanitizeAmount', () => {
  it('剥离货币符号与千分位后解析，保留两位小数以内', () => {
    expect(sanitizeAmount('5200.50')).toBe('5200.5');
    expect(sanitizeAmount('3800')).toBe('3800');
    expect(sanitizeAmount('¥90,100.00')).toBe('90100');
    expect(sanitizeAmount('￥5,100.00')).toBe('5100');
    expect(sanitizeAmount('6,266.80')).toBe('6266.8');
  });

  it('空白清理：首尾空白与内部空白均被剥离', () => {
    expect(sanitizeAmount(' 5200.50 ')).toBe('5200.5');
    expect(sanitizeAmount('1 234.5')).toBe('1234.5');
    expect(sanitizeAmount('  ')).toBe('');
  });

  it('元/人民币后缀', () => {
    expect(sanitizeAmount('1234元')).toBe('1234');
    expect(sanitizeAmount('12人民币')).toBe('12');
  });

  it('非法值与空值返回空串', () => {
    expect(sanitizeAmount('abc')).toBe('');
    expect(sanitizeAmount('')).toBe('');
    expect(sanitizeAmount(null)).toBe('');
    expect(sanitizeAmount(undefined)).toBe('');
  });

  it('四舍五入到两位小数', () => {
    expect(sanitizeAmount('10.125')).toBe('10.13'); // Math.round(1012.5) = 1013
  });
});

describe('cleanValue', () => {
  it('name/idCard/phone/bankCard 移除所有空白（含全角空格、NBSP、零宽字符）', () => {
    expect(cleanValue(' 张 三\t', 'name')).toBe('张三');
    expect(cleanValue('张\u00A0三', 'name')).toBe('张三');
    expect(cleanValue('张\u3000三', 'name')).toBe('张三');
    expect(cleanValue('138 0013\u200B8000', 'phone')).toBe('13800138000');
    expect(cleanValue('6217 0000 0000 0000', 'bankCard')).toBe('6217000000000000');
  });

  it('全角数字/字母归一为半角', () => {
    expect(cleanValue('４２０８２１１９８６０８０５９０１Ｘ', 'idCard')).toBe('42082119860805901X');
    expect(cleanValue('ＡＢ１２', 'name')).toBe('AB12');
  });

  it('身份证末位形近字符归一为 X（近期修复的高危 bug）', () => {
    expect(cleanValue('11010119900307421\u0445', 'idCard')).toBe('11010119900307421X'); // 西里尔 х
    expect(cleanValue('11010119900307421\u0425', 'idCard')).toBe('11010119900307421X'); // 西里尔 Х
    expect(cleanValue('42082119860805901\u2169', 'idCard')).toBe('42082119860805901X'); // 罗马数字 Ⅹ
    expect(cleanValue('42082119860805901\u2179', 'idCard')).toBe('42082119860805901X'); // 罗马数字 ⅹ
    expect(cleanValue('42082119860805901x', 'idCard')).toBe('42082119860805901X');      // 小写 x
    expect(cleanValue('42082119860805901X', 'idCard')).toBe('42082119860805901X');      // 已是 X
  });

  it('仅 17 位数字 + 末位形近字符才归一，其余位置不动', () => {
    expect(cleanValue('x0123', 'idCard')).toBe('x0123');
    expect(cleanValue('X123', 'idCard')).toBe('X123');
    expect(cleanValue('1101011990030742\u0445000', 'idCard')).toBe('1101011990030742X000');
  });

  it('非 idCard 类型不做 X 归一', () => {
    expect(cleanValue('张x', 'name')).toBe('张x');
  });

  it('非空白清洗类型原样返回', () => {
    expect(cleanValue(' 张 三 ', 'note')).toBe(' 张 三 ');
    expect(cleanValue('性别：男', 'gender')).toBe('性别：男');
  });

  it('空值与纯空白返回空串', () => {
    expect(cleanValue(null, 'name')).toBe('');
    expect(cleanValue(undefined, 'idCard')).toBe('');
    expect(cleanValue('  ', 'name')).toBe('');
  });

  it('发放明细-UTF8.csv fixture：四种身份证写法全部归一为 X 结尾', () => {
    const rows = parseCSV(csvUtf8);
    const ids = rows.slice(1, 5).map(r => cleanValue(r[1], 'idCard'));
    expect(ids).toEqual([
      '42082119860805901X', // X
      '42082119860805901X', // Ⅹ
      '11010119900307421X', // х
      '11010119900307421X', // x
    ]);
    // ¥ 金额清洗
    expect(sanitizeAmount(rows[4][5])).toBe('5100');
  });
});
