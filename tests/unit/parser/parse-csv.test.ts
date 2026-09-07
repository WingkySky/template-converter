// parseCSV / isGarbled 单测 —— 用例覆盖 git 修复历史中的高危逻辑：
// 引号转义("")、单元格内逗号/换行、\r\n 行尾、空行过滤、GBK 乱码检测。
import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { parseCSV, isGarbled } from '../../../src/core/parser/parse-csv';
import csvUtf8 from '../../fixtures/发放明细-UTF8.csv?raw';

describe('parseCSV', () => {
  it('解析基础两行 CSV', () => {
    expect(parseCSV('姓名,税前金额\n张三,5200.50')).toEqual([
      ['姓名', '税前金额'],
      ['张三', '5200.50'],
    ]);
  });

  it('单元格内逗号需引号包裹，不切分', () => {
    expect(parseCSV('姓名,备注\n张三,"含,逗号"')).toEqual([
      ['姓名', '备注'],
      ['张三', '含,逗号'],
    ]);
  });

  it('转义双引号 "" 还原为单个 "', () => {
    expect(parseCSV('"he said ""hi"" ok",x')).toEqual([
      ['he said "hi" ok', 'x'],
    ]);
  });

  it('引号内换行不产生新行', () => {
    expect(parseCSV('a,"line1\nline2",b')).toEqual([
      ['a', 'line1\nline2', 'b'],
    ]);
  });

  it('处理 \\r\\n 与纯 \\r 行尾', () => {
    expect(parseCSV('a,b\r\n1,2\r3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('末尾换行不产生幽灵空行，无换行结尾的最后一行保留', () => {
    expect(parseCSV('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCSV('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('过滤空行', () => {
    expect(parseCSV('a,b\n\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('发放明细-UTF8.csv fixture：引号内千分位金额、¥ 前缀、身份证形近字符原样保留', () => {
    const rows = parseCSV(csvUtf8);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual(['姓名', '身份证号码', '手机号码', '开户银行', '银行卡号', '税前金额']);
    // 王五行的 "6,266.80"（引号内逗号）
    expect(rows[3][4]).toBe('6,266.80');
    // 赵六行的 ¥5100.00
    expect(rows[4][5]).toBe('¥5100.00');
    // 解析器不改动内容：李四行的罗马数字 Ⅹ 原样保留（归一是 cleanValue 的职责）
    expect(rows[2][1]).toBe('42082119860805901\u2169');
  });
});

describe('isGarbled（GBK 乱码检测）', () => {
  it('正常 UTF-8 中文文本不判乱码', () => {
    expect(isGarbled('姓名,身份证号码,手机号码\n张三,42082119860805901X,13800138000')).toBe(false);
  });

  it('含连续替换字符 U+FFFD 判乱码', () => {
    expect(isGarbled('ab\uFFFD\uFFFDcd')).toBe(true);
  });

  it('GBK 字节被按 UTF-8 误读（真实乱码场景）判乱码', () => {
    // 与 processFile 的 FileReader readAsText('utf-8') 误读 GBK 文件等价的字节态
    const gbkBytes = iconv.encode('发放明细,张三,李四,王五,赵六,合计', 'gbk');
    const mojibake = gbkBytes.toString('utf8');
    expect(mojibake).toContain('\uFFFD\uFFFD');
    expect(isGarbled(mojibake)).toBe(true);
    // 同一内容以 GBK 正确解码后不判乱码
    expect(isGarbled(iconv.decode(gbkBytes, 'gbk'))).toBe(false);
  });

  it('计数分支：前 500 字符内 >11 个非 CJK 高位字符判乱码，CJK/全角标点不计入', () => {
    expect(isGarbled('\u0410'.repeat(11))).toBe(true);   // 西里尔 А，11 个 > 10
    expect(isGarbled('\u0410'.repeat(10))).toBe(false);  // 10 个不超过阈值
    expect(isGarbled('中'.repeat(500))).toBe(false);      // CJK 统一表意文字不计入
    expect(isGarbled('\u3001'.repeat(500))).toBe(false);  // 全角顿号（CJK 标点区）不计入
  });
});
