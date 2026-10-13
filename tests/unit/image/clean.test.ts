// 清洗层单测：竖线/引号伪影/首尾噪声标点/悬空小数点/全角数字/长数字内空格/中文间空格折叠。
// 样例取自 2026-10-13/14 真实冒烟产物（已是噪声化的识别输出，非原始个人数据）。
import { describe, expect, it } from 'vitest';
import { cleanOcrCell, cleanOcrRows } from '../../../src/core/image/clean';

describe('cleanOcrCell · 数字格', () => {
  it('剥首尾不配对引号（LLM 的 JSON 伪影）', () => {
    expect(cleanOcrCell('"130403195603160330')).toBe('130403195603160330');
    expect(cleanOcrCell('“370624197111090045”')).toBe('370624197111090045');
  });

  it('删表格竖线（首尾与嵌入式）', () => {
    expect(cleanOcrCell('|6222600525660099999')).toBe('6222600525660099999');
    expect(cleanOcrCell('85098.04|')).toBe('85098.04');
    expect(cleanOcrCell('王|辉')).toBe('王辉');
  });

  it('剥首尾噪声标点与悬空小数点', () => {
    expect(cleanOcrCell('6217001830016063326.')).toBe('6217001830016063326');
    expect(cleanOcrCell('41189.15)')).toBe('41189.15');
    expect(cleanOcrCell('(20768.06')).toBe('20768.06');
  });

  it('全角数字/标点转半角，中文句点转小数点', () => {
    expect(cleanOcrCell('４５６３５１０１００８６４７３０４８０')).toBe('4563510100864730480');
    expect(cleanOcrCell('39315．71')).toBe('39315.71');
    expect(cleanOcrCell('3，9315。71')).toBe('3,9315.71');
  });

  it('长数字去内部排版空格，金额保留千分位结构', () => {
    expect(cleanOcrCell('6222 6025 6600 9999 9')).toBe('62226025660099999');
    expect(cleanOcrCell('1,234.56')).toBe('1,234.56');
    expect(cleanOcrCell('39315.71')).toBe('39315.71');
  });

  it('合法金额/币符不被误伤', () => {
    expect(cleanOcrCell('￥39315.71')).toBe('￥39315.71');
    expect(cleanOcrCell('35.5%')).toBe('35.5%');
  });
});

describe('cleanOcrCell · 非数字格', () => {
  it('折叠相邻中文之间的空格，保留英文/数字与中文间的空格', () => {
    expect(cleanOcrCell('郭 卫 杰')).toBe('郭卫杰');
    expect(cleanOcrCell('中国 农业银行 邯郸沁阳支行')).toBe('中国农业银行邯郸沁阳支行');
    expect(cleanOcrCell('A 公司 B 部')).toBe('A 公司 B 部');
  });

  it('引号+竖线混合污染一并清理', () => {
    expect(cleanOcrCell('"中国银行|北京亮马河大厦支行')).toBe('中国银行北京亮马河大厦支行');
  });
});

describe('cleanOcrRows', () => {
  it('整表逐格清洗，空值安全', () => {
    const rows = [
      ['9月', '代扣缴后', '第一笔'],
      ['王辉', '39315.71', '20768.06|'],
      ['"吴佐生', '', null as unknown as string],
    ];
    expect(cleanOcrRows(rows)).toEqual([
      ['9月', '代扣缴后', '第一笔'],
      ['王辉', '39315.71', '20768.06'],
      ['吴佐生', '', ''],
    ]);
  });
});
