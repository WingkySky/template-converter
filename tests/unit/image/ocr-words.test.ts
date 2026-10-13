// ocr-words 单测：坐标翻转（y 向下 → y 向上基线近似）、列带分离、格内碎片拼接、
// 数字去空白、均值置信度。词块几何参照真实样张（2026-10-12 微信明细截图）量级构造。
import { describe, expect, it } from 'vitest';
import { ocrWordsToRows } from '../../../src/core/image/ocr-words';
import type { OcrWord } from '../../../src/core/image/types';

function w(text: string, x: number, y: number, wd: number, h: number, confidence = 90): OcrWord {
  return { text, x, y, w: wd, h, confidence };
}

describe('ocrWordsToRows', () => {
  // 三列布局：姓名 x14 / 金额 x222 / 卡号 x555；两行 y=28、y=64（图片 y 向下）
  const words: OcrWord[] = [
    // 第一行
    w('王', 14, 28, 13, 14, 95),
    w('辉', 29, 28, 13, 14, 95),
    w('39315', 222, 31, 38, 10, 92),
    w('.', 262, 39, 2, 2, 60),
    w('71', 270, 31, 13, 10, 92),
    w('0222000525000099999', 555, 31, 114, 10, 96),
    // 第二行
    w('吴', 14, 64, 13, 14, 94),
    w('佐', 29, 64, 13, 14, 94),
    w('生', 44, 64, 13, 14, 94),
    w('100924', 214, 67, 47, 10, 91),
    w('.', 262, 75, 2, 2, 60),
    w('47', 270, 67, 14, 10, 91),
  ];

  it('行序按视觉自上而下（y 翻转后与 PDF 坐标系一致）', () => {
    const { rows } = ocrWordsToRows(words, 100);
    expect(rows.length).toBe(2);
    expect(rows[0][0]).toBe('王辉');
    expect(rows[1][0]).toBe('吴佐生');
  });

  it('列带分离：姓名/金额/卡号各归各列，格内碎片无空格拼接', () => {
    const { rows } = ocrWordsToRows(words, 100);
    expect(rows[0][0]).toBe('王辉');
    expect(rows[0][1]).toBe('39315.71');
    expect(rows[0][2]).toBe('0222000525000099999');
    expect(rows[1][1]).toBe('100924.47');
  });

  it('均值置信度 = 词块置信度平均（1 位小数）', () => {
    const { meanConfidence } = ocrWordsToRows(words, 100);
    const sum = words.reduce((s, x) => s + x.confidence, 0);
    expect(meanConfidence).toBe(Math.round((sum / words.length) * 10) / 10);
  });

  it('空白/零尺寸词块被过滤；全空输入返回空行与 null 置信度', () => {
    const { rows, meanConfidence } = ocrWordsToRows(
      [w('', 10, 10, 5, 5), w('  ', 30, 10, 5, 5), w('x', 50, 10, 0, 5)],
      50,
    );
    expect(rows).toEqual([]);
    expect(meanConfidence).toBeNull();
  });
});
