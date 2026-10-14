// grid-cols 单测：竖线检测（覆盖率阈值区分边框与文本列）、格线分列（表头/数据错位对齐、
// 区内子格拆分）、ocrWordsToRows 的格线路径入口。几何量级参照真实样张构造。
import { describe, expect, it } from 'vitest';
import { detectColumnBorders, wordsToGridRows } from '../../../src/core/image/grid-cols';
import { ocrWordsToRows } from '../../../src/core/image/ocr-words';
import type { GrayImage } from '../../../src/core/image/preprocess';

/** 构造灰度画布：白底 + 指定 x 的全高竖线 + 指定 x 的部分高文本条（覆盖率 ~0.6，不应成线） */
function makeImage(width: number, height: number, lines: number[], textCols: number[]): GrayImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x: number, y: number, v: number) => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v;
  };
  for (const x of lines) for (let y = 0; y < height; y++) set(x, y, 100);
  for (const x of textCols) for (let y = 10; y < Math.floor(height * 0.6); y++) set(x, y, 0);
  return { width, height, data };
}

function w(text: string, x: number, y: number, wd: number, h: number, confidence = 95) {
  return { text, x, y, w: wd, h, confidence };
}

describe('detectColumnBorders', () => {
  it('全高竖线成候选（聚簇取中心），部分高文本列不成线', () => {
    // 竖线 x=100（单像素）、x=200/201/202（3px 线聚簇为 201）、x=290；文本列 x=150 覆盖 ~0.6
    const img = makeImage(300, 100, [100, 200, 201, 202, 290], [150]);
    expect(detectColumnBorders(img, 0, 99)).toEqual([100, 201, 290]);
  });

  it('少于 3 条线返回空数组（不足两个列区，调用方回落推断路径）', () => {
    const img = makeImage(300, 100, [100, 201], []);
    expect(detectColumnBorders(img, 0, 99)).toEqual([]);
  });
});

describe('wordsToGridRows', () => {
  // 三区格线 [0,150,400,650]（姓名|代扣缴后|第一笔…）；表头左对齐、数字右对齐
  // （真实样张形态：表头与数据框零重叠）——格线路径按区归位，天然对齐
  const borders = [0, 150, 400, 650];

  it('表头与数据框零重叠仍归同区（推断归带的失败场景）', () => {
    const words = [
      w('9月', 10, 5, 30, 16),        // 区1 表头
      w('代扣缴后', 160, 5, 70, 16),  // 区2 表头 [160,230]
      w('第一笔', 410, 5, 60, 16),    // 区3 表头
      w('王辉', 5, 40, 20, 16),       // 区1
      w('39315.71', 340, 40, 55, 16), // 区2 右对齐 [340,395]，与表头零重叠
      w('20768.06', 580, 40, 58, 16), // 区3 右对齐 [580,638]
    ];
    const { rows } = wordsToGridRows(words, borders);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['9月', '代扣缴后', '第一笔']);
    expect(rows[1]).toEqual(['王辉', '39315.71', '20768.06']);
  });

  it('同区多个横向分离条目拆子格（漏检边框兜底），列布局按每区全局最大子格数固定', () => {
    const words = [
      w('甲', 10, 5, 20, 16), w('乙', 150, 5, 20, 16), w('丙', 400, 5, 20, 16), // 表头行三区
      w('a1', 10, 40, 15, 16), w('a2', 170, 40, 15, 16), w('a3', 230, 40, 15, 16), // 区1 一个 + 区2 两个子格
      w('b1', 400, 40, 15, 16),
    ];
    const { rows } = wordsToGridRows(words, borders);
    expect(rows).toHaveLength(2);
    // 列布局：区1(1格) 区2(2格) 区3(1格) → 4 列；表头行的乙对齐区2 第 1 子格
    expect(rows[0]).toEqual(['甲', '乙', '', '丙']);
    expect(rows[1]).toEqual(['a1', 'a2', 'a3', 'b1']);
  });

  it('跨区溢出文本（少量越过边界）按最大重叠归区', () => {
    const words = [
      w('开户行', 150, 5, 40, 16),  // 区2 表头
      w('中国农业银行股份有限公司邯郸沁阳支行', 305, 40, 320, 16), // [305,625] 越过 600 边界 25px
    ];
    const { rows } = wordsToGridRows(words, borders);
    expect(rows[0][1]).toBe('开户行');
    expect(rows[1][2]).toContain('中国农业银行');
  });
});

describe('ocrWordsToRows 格线路径入口', () => {
  it('borders ≥3 走格线分列（表头/数据对齐）；无 borders 走共享管线（现状不变）', () => {
    const words = [
      w('9月', 10, 5, 30, 16),
      w('代扣缴后', 160, 5, 70, 16),
      w('王辉', 5, 40, 20, 16),
      w('39315.71', 340, 40, 55, 16),
    ];
    const imageHeight = 80;
    const grid = ocrWordsToRows(words, imageHeight, [0, 150, 400]);
    expect(grid.rows[0]).toEqual(['9月', '代扣缴后']);
    expect(grid.rows[1]).toEqual(['王辉', '39315.71']);
    expect(grid.meanConfidence).toBe(95);

    const legacy = ocrWordsToRows(words, imageHeight);
    // 回落路径不抛错、有产出即可（具体行为由 pdf.test/compare 基线守护）
    expect(legacy.rows.length).toBeGreaterThan(0);
    expect(legacy.meanConfidence).toBe(95);
  });
});
