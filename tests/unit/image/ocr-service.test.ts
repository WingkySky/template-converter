// 引擎编排单测：auto 策略的顺序决策（2026-10-13 双引擎实测：云端 LLM 对表格截图的
// 结构还原显著优于本地 Tesseract，故 auto = 已配置 key 云端优先、失败回落本地）。
import { describe, expect, it } from 'vitest';
import { pickEngineOrder } from '../../../src/core/image/ocr-service';

describe('pickEngineOrder', () => {
  it('auto + 已配置 key：云端优先、本地兜底', () => {
    expect(pickEngineOrder('auto', true)).toEqual(['llm', 'local']);
  });

  it('auto + 未配置 key：直接本地', () => {
    expect(pickEngineOrder('auto', false)).toEqual(['local']);
  });

  it('显式指定不编排回落', () => {
    expect(pickEngineOrder('llm', true)).toEqual(['llm']);
    expect(pickEngineOrder('llm', false)).toEqual(['llm']); // 让 provider 自己报「未配置」错
    expect(pickEngineOrder('local', true)).toEqual(['local']);
  });
});
