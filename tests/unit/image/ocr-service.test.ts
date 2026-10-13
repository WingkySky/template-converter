// 引擎编排单测：auto 策略的顺序决策（2026-10-13 双引擎实测：云端 LLM 对表格截图的
// 结构还原显著优于本地 Tesseract，故 auto = 已配置 key 云端优先、失败回落本地）。
// 另含图片源姓名列数据特征推断（表头「9月」类案例）——该推断在 core/mapping/column-detect，
// 但属图片源专属行为，测试归位此处。
import { describe, expect, it, vi } from 'vitest';
import { pickEngineOrder } from '../../../src/core/image/ocr-service';
import { applyInferredNameByData, detectColumnMapping } from '../../../src/core/mapping/column-detect';
import { createLlmProvider, consumeContentStream } from '../../../src/core/image/providers/llm-provider';
import { DEFAULT_OCR_SETTINGS } from '../../../src/io/ocr-settings';
import type { OcrProgress } from '../../../src/core/image/types';
import type { OcrSettings as OcrSettingsIo } from '../../../src/io/ocr-settings';

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

describe('applyInferredNameByData（表头「9月」案例：关键词匹配不到姓名时的数据特征兜底）', () => {
  const header = ['9月', '代扣缴后', '账号', '身份证', '电话'];
  const rows = [
    ['王辉', '39315.71', '4563510100864730480', '130403195603160330', '18132236888'],
    ['吴佐生', '85098.04', '6222600525660099999', '', ''],
    ['卞福林', '41189.15', '6228491728004778778', '370024197111090045', '15863621109'],
    ['小计', '828048.00', '', '', ''],
  ];

  it('表头匹配不到姓名关键词时按数据补 name 列（小计等费用标签不计入）', () => {
    const autoMap = detectColumnMapping(header, rows.slice(0, 3));
    expect(autoMap.nameCol).toBeUndefined(); // 前置：detectColumnMapping 本身不补写 nameCol，关键词也没认出姓名列
    expect(applyInferredNameByData(header, rows, autoMap)).toBe(true);
    expect(autoMap.nameCol).toBe(0);
    expect(autoMap.cols['0'].type).toBe('name');
    expect(autoMap.cols['0'].samples[0]).toBe('王辉');
  });

  it('已有 name 列时不动作；无名似列时不写回', () => {
    const header2 = ['姓名', '金额'];
    const rows2 = [['王辉', '1.00'], ['吴佐生', '2.00'], ['卞福林', '3.00']];
    const am2 = detectColumnMapping(header2, rows2);
    expect(applyInferredNameByData(header2, rows2, am2)).toBe(false);

    const header3 = ['A', 'B'];
    const rows3 = [['40.00', 'x1'], ['50.00', 'x2'], ['60.00', 'x3']];
    const am3 = detectColumnMapping(header3, rows3);
    expect(applyInferredNameByData(header3, rows3, am3)).toBe(false);
  });
});

// —— LLM 流式接收（SSE）——

const LLM_SETTINGS: OcrSettingsIo = {
  engine: 'llm',
  llm: { baseURL: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-vision' },
};
const IMAGE = { canvas: null, dataUrl: 'data:image/png;base64,AAA', width: 100, height: 50 };

function sseResponse(events: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      events.forEach(e => c.enqueue(enc.encode(e)));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('consumeContentStream / 流式识别进度', () => {
  it('累计 delta.content 与 reasoning_content，进度回调带不确定进度与实时预览', async () => {
    const progresses: OcrProgress[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"正在逐列辨认表格"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"{\\"header\\":[\\"姓名\\"],\\"rows\\":[[\\"王辉\\"]]}"}}]}\n\n',
      'data: [DONE]\n\n',
    ]) as unknown as typeof fetch));
    try {
      const result = await createLlmProvider(LLM_SETTINGS).recognize(IMAGE, {
        onProgress: p => progresses.push(p),
      });
      expect(result.rows).toEqual([['姓名'], ['王辉']]);
      // 发送阶段 + 流式接收阶段都有进度；接收阶段为不确定进度（percent<0）且带预览
      expect(progresses[0]).toMatchObject({ percent: -1, stage: expect.stringContaining('等待') });
      const streaming = progresses.find(p => /流式接收/.test(p.stage));
      expect(streaming?.detail).toContain('正在逐列辨认表格'); // 思考过程可见
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('consumeContentStream 直接解析：多块拼接送入、[DONE] 终止、空正文报错', async () => {
    const enc = new TextEncoder();
    const chunks = ['data: {"choices":[{"delta":{"content":"甲"}}]}\n', 'data: {"choices":[{"delta":{"content":"乙"}}]}\n', 'data: [DONE]\n'];
    const stream = new ReadableStream<Uint8Array>({
      start(c) { chunks.forEach(x => c.enqueue(enc.encode(x))); c.close(); },
    });
    const seen: string[] = [];
    expect(await consumeContentStream(stream, p => seen.push(p))).toBe('甲乙');

    const empty = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode('data: [DONE]\n')); c.close(); } });
    await expect(consumeContentStream(empty)).rejects.toThrow(/为空/);
  });
});
