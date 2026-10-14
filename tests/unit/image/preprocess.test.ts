// 前处理纯函数单测：放大倍数护栏、灰度加权、对比度拉伸、二值化、纯函数性。
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREPROCESS, effectiveScale, enhance } from '../../../src/core/image/preprocess';

function img(rgba: number[]) {
  return { width: rgba.length / 4, height: 1, data: new Uint8ClampedArray(rgba) };
}

describe('effectiveScale', () => {
  it('小图按目标倍数放大', () => {
    expect(effectiveScale(87, DEFAULT_PREPROCESS)).toBe(1.5);
  });

  it('大图受 maxShortSide 约束，图已够大则不放大（绝不缩小）', () => {
    expect(effectiveScale(2480, DEFAULT_PREPROCESS)).toBeCloseTo(3600 / 2480, 6);
    expect(effectiveScale(5000, DEFAULT_PREPROCESS)).toBe(1);
  });

  it('非法短边返回 1', () => {
    expect(effectiveScale(0, DEFAULT_PREPROCESS)).toBe(1);
  });
});

describe('enhance', () => {
  it('灰度按 BT.601 加权（红 255 → 0.299×255 ≈ 76）', () => {
    const p = { ...DEFAULT_PREPROCESS, contrast: 1 };
    const out = enhance(img([255, 0, 0, 255]), p);
    expect(out.data[0]).toBe(76);
    expect(out.data[1]).toBe(76);
    expect(out.data[2]).toBe(76);
  });

  it('对比度围绕 128 拉伸：纯黑截断为 0，中灰不动', () => {
    const out = enhance(img([0, 0, 0, 255, 128, 128, 128, 255]), DEFAULT_PREPROCESS);
    expect(out.data[0]).toBe(0);
    expect(out.data[4]).toBe(128);
  });

  it('二值化按阈值切分，alpha 保留', () => {
    const p = { ...DEFAULT_PREPROCESS, binarizeThreshold: 100 };
    const out = enhance(img([76, 76, 76, 255, 128, 128, 128, 255]), p);
    expect(out.data[0]).toBe(0);
    expect(out.data[4]).toBe(255);
    expect(out.data[3]).toBe(255);
  });

  it('纯函数：不改输入', () => {
    const src = img([255, 0, 0, 255]);
    enhance(src, DEFAULT_PREPROCESS);
    expect([...src.data]).toEqual([255, 0, 0, 255]);
  });
});
