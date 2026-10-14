// paddle-words 单测：poly 四点数组 → 包围盒投影（运行时是 [x,y] 数值数组，非 {x,y}——
// 见 paddle-provider 头部坑位 3）、score 0~1 → 0~100 截断、纯符号过滤、空值防护。
// 几何量级参照真实样张（2026-10-12 微信明细截图）构造。
import { describe, expect, it } from 'vitest';
import { paddleResultToWords } from '../../../src/core/image/providers/paddle-provider';

function item(text: string, poly: [number, number][], score = 0.97) {
  return { text, poly, score };
}

describe('paddleResultToWords', () => {
  it('poly 四点（乱序四边形）投影为包围盒：x/y 取最小，w/h 取跨度', () => {
    const words = paddleResultToWords([
      item('王辉', [[31, 34], [80, 60], [80, 34], [31, 60]], 0.99),
    ]);
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({ text: '王辉', x: 31, y: 34, w: 49, h: 26 });
  });

  it('score 0~1 映射 0~100 并截断出界值', () => {
    const words = paddleResultToWords([
      item('a', [[0, 0], [10, 10]], 0.9768),
      item('b', [[0, 20], [10, 30]], 1.2),
      item('c', [[0, 40], [10, 50]], -0.3),
    ]);
    expect(words.map(w => w.confidence)).toEqual([97.68, 100, 0]);
  });

  it('纯符号词块被过滤（表格边框被识别成 | — ~ 等）；空文本/空白过滤', () => {
    const words = paddleResultToWords([
      item('|', [[0, 0], [2, 8]]),
      item('—', [[4, 0], [12, 8]]),
      item('', [[14, 0], [20, 8]]),
      item('   ', [[22, 0], [30, 8]]),
      item('39315.71', [[32, 0], [90, 8]]),
    ]);
    expect(words).toHaveLength(1);
    expect(words[0].text).toBe('39315.71');
  });

  it('poly 缺失/过短的项被跳过；含非法数值点按有效点投影，不影响其余项', () => {
    const words = paddleResultToWords([
      item('无poly', undefined as unknown as [number, number][]),
      item('短poly', [[1, 1]]),
      item('NaN', [[1, 1], [Number.NaN, 2], [3, 3]]),
      item('张三', [[10, 10], [30, 20]]),
    ]);
    expect(words).toHaveLength(2);
    expect(words[0].text).toBe('NaN');
    expect(words[0]).toMatchObject({ x: 1, y: 1, w: 2, h: 2 });
    expect(words[1].text).toBe('张三');
  });

  it('null/undefined 输入返回空数组', () => {
    expect(paddleResultToWords(null)).toEqual([]);
    expect(paddleResultToWords(undefined)).toEqual([]);
  });
});
