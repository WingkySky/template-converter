// smartDetectTable 及其辅助函数单测 —— 用例覆盖 git 修复历史中的高危逻辑：
// 合计/汇总行过滤（isSummaryLikeRow）、双行表头合并（isHeaderContinuation/mergeHeaderRows）、
// 费用行与人员记录区分（hasIdentityField）、身份证性别推断（inferGenderFromIdCard）。
import { describe, it, expect } from 'vitest';
import {
  smartDetectTable, isHeaderContinuation, mergeHeaderRows, isSummaryLikeRow,
  hasIdentityField, inferGenderFromIdCard, SUMMARY_RE, FEE_LABEL_RE,
} from '../../../src/core/parser/table-detect';
import { parseCSV } from '../../../src/core/parser/parse-csv';
import csvUtf8 from '../../fixtures/发放明细-UTF8.csv?raw';

const PERSON_HEADER = ['姓名', '身份证号码', '手机号码', '税前金额'];
const personRow = (name: string, id: string, phone: string, amount: string) => [name, id, phone, amount];

describe('isHeaderContinuation（双行表头第二行检测）', () => {
  it('少数短文本补行判定为表头延续', () => {
    expect(isHeaderContinuation(['姓名', '身份证', '备注1', ''], ['','','说明',''])).toBe(true);
  });

  it('数据行（非空单元格过多 / 数值 / 手机号 / 长文本）不判为表头延续', () => {
    expect(isHeaderContinuation(PERSON_HEADER, personRow('张三', '11010119900307421X', '13800138000', '5200.50'))).toBe(false);
    expect(isHeaderContinuation(['姓名'], ['123.45'])).toBe(false);                    // 纯数字
    expect(isHeaderContinuation(['姓名'], ['13800138000'])).toBe(false);               // 手机号
    expect(isHeaderContinuation(['姓名'], ['11010119900307421X'])).toBe(false);        // 身份证
    expect(isHeaderContinuation(['姓名'], ['6217000000000000247'])).toBe(false);       // 银行卡号
    expect(isHeaderContinuation(['姓名'], ['这是一个超过十个字符的长表头文本'])).toBe(false);
  });

  it('空行 / undefined 不判为表头延续', () => {
    expect(isHeaderContinuation(PERSON_HEADER, undefined)).toBe(false);
    expect(isHeaderContinuation(PERSON_HEADER, ['', '', ''])).toBe(false);
  });
});

describe('mergeHeaderRows（双行表头合并）', () => {
  it('两行均有值则拼接，否则取非空值', () => {
    expect(mergeHeaderRows(['姓名', '税前', '备注'], ['', '金额', '说明'])).toEqual(['姓名', '税前金额', '备注说明']);
  });

  it('第二行更长时补齐', () => {
    expect(mergeHeaderRows(['a'], ['b', 'c'])).toEqual(['ab', 'c']);
  });
});

describe('isSummaryLikeRow（合计/汇总行识别）', () => {
  it('首个非空单元格以强汇总词开头判为汇总行', () => {
    expect(isSummaryLikeRow(['合计', '', '', '9000.50'])).toBe(true);
    expect(isSummaryLikeRow(['累计发放', '', '', '9000.50'])).toBe(true);
  });

  it('汇总词出现在非首列（如备注）不判为汇总行', () => {
    expect(isSummaryLikeRow(['张三', '备注：合计已核对'])).toBe(false);
  });

  it('空行判为否', () => {
    expect(isSummaryLikeRow(['', '', ''])).toBe(false);
  });
});

describe('hasIdentityField（人员/费用行区分）', () => {
  it('强身份标识：身份证 / 统一社会信用代码 / 手机号 / 银行卡号', () => {
    const header = PERSON_HEADER;
    expect(hasIdentityField(['张三', '11010119900307421X', '', ''], header)).toBe(true);
    expect(hasIdentityField(['91440101F0E3LB8770'], header)).toBe(true);
    expect(hasIdentityField(['', '13800138000'], header)).toBe(true);
    expect(hasIdentityField(['6217000000000000247'], header)).toBe(true);
  });

  it('兜底：拟似姓名 + 金额 + 足够非空列', () => {
    expect(hasIdentityField(['张三', '现场施工', '5200.50'], PERSON_HEADER)).toBe(true);
  });

  it('费用/汇总标签行判为非人员记录', () => {
    expect(hasIdentityField(['平台服务费', '1000'], PERSON_HEADER)).toBe(false);
    expect(hasIdentityField(['服务费', '', '', '300'], PERSON_HEADER)).toBe(false);
  });

  it('地点列的中文值不判为姓名（表头含城市/类型等）', () => {
    expect(hasIdentityField(['天津', '100'], ['城市', '金额'])).toBe(false);
  });

  it('FEE_LABEL_RE 覆盖费用词', () => {
    expect(FEE_LABEL_RE.test('平台服务费')).toBe(true);
    expect(FEE_LABEL_RE.test('劳务报酬')).toBe(true);
    expect(FEE_LABEL_RE.test('张三')).toBe(false);
  });
});

describe('inferGenderFromIdCard（身份证倒数第二位奇偶）', () => {
  it('第 17 位（倒数第二位）奇数为男、偶数为女', () => {
    expect(inferGenderFromIdCard('11010119900307421X')).toBe('男'); // s[16]='1'
    expect(inferGenderFromIdCard('11010119900307422X')).toBe('女'); // s[16]='2'
  });

  it('小写 x 结尾同样支持', () => {
    expect(inferGenderFromIdCard('11010119900307421x')).toBe('男');
  });

  it('非 18 位身份证号返回空串', () => {
    expect(inferGenderFromIdCard('')).toBe('');
    expect(inferGenderFromIdCard('12345')).toBe('');
    expect(inferGenderFromIdCard('110101199003074')).toBe('');
  });
});

describe('smartDetectTable', () => {
  it('过滤合计行与费用行：合计行走汇总过滤，费用行计入 filteredCount', () => {
    const rows: string[][] = [
      PERSON_HEADER,
      personRow('张三', '11010119900307421X', '13800138000', '5200.50'),
      personRow('李四', '11010119900307421x', '13900139000', '3800'),
      ['合计', '', '', '9000.50'],
      ['平台服务费', '', '', '1000'],
    ];
    const r = smartDetectTable(rows);
    expect(r.headerRowIndex).toBe(0);
    expect(r.dataRows).toEqual([rows[1], rows[2]]);
    // 合计行经 isSummaryLikeRow 过滤（不计数）；平台服务费行经 hasIdentityField 过滤（计数）
    expect(r.filteredCount).toBe(1);
  });

  it('跳过前导非表头行', () => {
    const rows: string[][] = [
      ['导出时间:2026-06-01'],
      PERSON_HEADER,
      personRow('张三', '11010119900307421X', '13800138000', '5200.50'),
    ];
    const r = smartDetectTable(rows);
    expect(r.headerRowIndex).toBe(1);
    expect(r.dataRows).toEqual([rows[2]]);
  });

  it('双行表头自动合并，数据从第三行开始', () => {
    const rows: string[][] = [
      ['姓名', '身份证', '备注1', ''],
      ['', '', '说明', ''],
      personRow('张三', '11010119900307421X', '13800138000', '5200.50'),
    ];
    const r = smartDetectTable(rows);
    expect(r.headerRowIndex).toBe(0);
    expect(r.headerRow).toEqual(['姓名', '身份证', '备注1说明', '']);
    expect(r.dataRows).toEqual([rows[2]]);
  });
});

describe('smartDetectTable × 发放明细-UTF8.csv fixture', () => {
  it('表头识别正确，4 行人员数据保留，合计行被过滤', () => {
    const rows = parseCSV(csvUtf8);
    const r = smartDetectTable(rows);
    expect(r.headerRowIndex).toBe(0);
    expect(r.headerRow).toEqual(['姓名', '身份证号码', '手机号码', '开户银行', '银行卡号', '税前金额']);
    expect(r.dataRows).toHaveLength(4);
    expect(r.dataRows[0][0]).toBe('张三');
    expect(r.dataRows[3][0]).toBe('赵六');
    // 合计行经 isSummaryLikeRow 过滤，不占用 filteredCount
    expect(r.filteredCount).toBe(0);
  });
});

describe('SUMMARY_RE 常量', () => {
  it('忽略大小写匹配汇总词', () => {
    expect(SUMMARY_RE.test('平台服务费')).toBe(true);
    expect(SUMMARY_RE.test('收费通知')).toBe(true);
    expect(SUMMARY_RE.test('张三')).toBe(false);
  });
});
