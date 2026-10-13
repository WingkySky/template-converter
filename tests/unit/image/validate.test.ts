// 校验层单测：身份证校验位、手机号/卡号/金额格式、误读修正候选、列合计核对、
// 文本格不受数字校验影响。身份证样例为按 GB 11643-1999 加权因子现场计算的虚构号。
import { describe, expect, it } from 'vitest';
import {
  computeOcrValidation, isIdCardChecksumValid, suggestNumericFix,
} from '../../../src/core/image/validate';
import type { DetectedColumn } from '../../../src/core/mapping/column-detect';

// 11010119900101001 的校验位 = CODE[106 % 11] = '5'（现场计算，非真实证件号）
const VALID_ID = '110101199001010015';

const COLS: Record<string, DetectedColumn> = {
  '0': { header: '姓名', type: 'name', samples: [] },
  '1': { header: '身份证号', type: 'idCard', samples: [] },
  '2': { header: '电话', type: 'phone', samples: [] },
  '3': { header: '金额', type: 'amount', samples: [] },
};

describe('isIdCardChecksumValid', () => {
  it('校验位正确通过，错误/格式不合法拒绝', () => {
    expect(isIdCardChecksumValid(VALID_ID)).toBe(true);
    expect(isIdCardChecksumValid('110101199001010013')).toBe(false);
    expect(isIdCardChecksumValid('11010119900101001X')).toBe(false);
    expect(isIdCardChecksumValid('11010119900101001')).toBe(false);
  });
});

describe('suggestNumericFix', () => {
  it('高频误读字符替换且结果为合法数值时给候选', () => {
    expect(suggestNumericFix('39315&71')).toBe('39315.71');
    expect(suggestNumericFix('1O2L')).toBe('1021');
    expect(suggestNumericFix('13日0000001')).toBe('1300000001');
  });
  it('无误读字符或结果不构成数值时不给候选', () => {
    expect(suggestNumericFix('1007.51')).toBeUndefined();
    expect(suggestNumericFix('王辉')).toBeUndefined();
    expect(suggestNumericFix('日日日')).toBeUndefined(); // 全是误读字符但没有数字 → 替换后空串
  });
});

describe('computeOcrValidation', () => {
  const rows = [
    ['姓名', '身份证号', '电话', '金额'],
    ['王辉', VALID_ID, '13800000001', '100.00'],
    ['吴佐生', '110101199001010013', '13日0000001', '1O0.00'],
    ['合计', '', '', '200.00'],
  ];
  const dataRows = rows.slice(1, 3);

  it('校验位不符/手机号误读/金额误读各自标记，误读格给修正候选', () => {
    const { issues } = computeOcrValidation(rows, dataRows, COLS);
    expect(issues['1:1']).toMatchObject({ msg: expect.stringContaining('校验位') });
    expect(issues['1:1'].fix).toBeUndefined(); // 纯数字无误读字符，无候选
    expect(issues['1:2']).toMatchObject({ fix: '1300000001' });
    expect(issues['1:3']).toMatchObject({ fix: '100.00' });
    expect(issues['0:0']).toBeUndefined(); // 姓名格不参与数字校验
  });

  it('列合计与图内合计行一致时不告警，不平时整列告警', () => {
    const cleanRows = [
      ['姓名', '身份证号', '电话', '金额'],
      ['王辉', VALID_ID, '13800000001', '100.00'],
      ['吴佐生', VALID_ID, '13909934012', '100.00'],
      ['合计', '', '', '200.00'],
    ];
    const cleanData = cleanRows.slice(1, 3);
    expect(computeOcrValidation(cleanRows, cleanData, COLS).sumMismatchCols).toEqual([]);
    const wrong = cleanRows.slice();
    wrong[3] = ['合计', '', '', '999.00'];
    expect(computeOcrValidation(wrong, cleanData, COLS).sumMismatchCols).toEqual([3]);
  });

  it('金额格误读无法解析时按 0 计入，列合计随之不平（与字段级校验构成双重防线）', () => {
    // rows[2] 的金额 '1O0.00' 解析失败 → 100 ≠ 200
    expect(computeOcrValidation(rows, dataRows, COLS).sumMismatchCols).toEqual([3]);
  });

  it('无合计行时跳过列合计核对', () => {
    const noSummary = rows.slice(0, 3);
    const { sumMismatchCols } = computeOcrValidation(noSummary, dataRows, COLS);
    expect(sumMismatchCols).toEqual([]);
  });

  it('位数异常的身份证/卡号给格式错误且保留修正候选', () => {
    const r2 = [
      ['姓名', '身份证号', '电话', '金额'],
      ['陈建新', '05900119770319247日', '13909934012', '3907&51'],
    ];
    const { issues } = computeOcrValidation(r2, r2.slice(1), COLS);
    expect(issues['0:1']).toMatchObject({ msg: expect.stringContaining('18 位'), fix: '059001197703192470' });
    expect(issues['0:3']).toMatchObject({ fix: '3907.51' });
  });
});
