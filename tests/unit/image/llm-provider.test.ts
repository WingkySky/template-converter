// LLM 引擎单测：响应解析（围栏/裸数组/header 合并/空行丢弃）与请求编排
// （成功/401/429/非 JSON 重试一次/CORS TypeError 归一化/未配置拒绝）。
// fetch 以 vi.stubGlobal 打桩；Node 18+ 自带 Response/AbortController。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createLlmProvider, parseLlmResponse } from '../../../src/core/image/providers/llm-provider';
import { DEFAULT_OCR_SETTINGS } from '../../../src/io/ocr-settings';
import type { OcrSettings } from '../../../src/io/ocr-settings';

const SETTINGS: OcrSettings = {
  engine: 'llm',
  llm: { baseURL: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'test-vision' },
};

const IMAGE = { canvas: null, dataUrl: 'data:image/png;base64,AAA', width: 100, height: 50 };

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl as unknown as typeof fetch);
  vi.stubGlobal('fetch', mock);
  return mock;
}

const okResp = (content: string) => new Response(
  JSON.stringify({ choices: [{ message: { content } }] }),
  { status: 200 },
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseLlmResponse', () => {
  it('剥 ```json 围栏并解析 header + rows', () => {
    const rows = parseLlmResponse('```json\n{"header":["姓名","金额"],"rows":[["王辉","1.00"]]}\n```');
    expect(rows).toEqual([['姓名', '金额'], ['王辉', '1.00']]);
  });

  it('容忍裸二维数组；空行丢弃；null 单元格转空串', () => {
    const rows = parseLlmResponse('[["a","b"],[],["c",null]]');
    expect(rows).toEqual([['a', 'b'], ['c', '']]);
  });

  it('非 JSON 抛可读错误', () => {
    expect(() => parseLlmResponse('抱歉，我无法识别这张图片')).toThrow(/JSON/);
  });
});

describe('createLlmProvider', () => {
  it('成功：POST baseURL/chat/completions（尾斜杠归一），带 Bearer 与 model，dataURL 入 image_url', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const mock = stubFetch(async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return okResp('{"header":["姓名"],"rows":[["王辉"]]}');
    });
    const result = await createLlmProvider(SETTINGS).recognize(IMAGE);
    expect(result.engine).toBe('llm');
    expect(result.rows).toEqual([['姓名'], ['王辉']]);
    expect(result.meanConfidence).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe('test-vision');
    expect(body.messages[0].content[1].image_url.url).toBe(IMAGE.dataUrl);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('401 → 认证失败提示且不重试', async () => {
    const mock = stubFetch(async () => new Response('', { status: 401 }));
    await expect(createLlmProvider(SETTINGS).recognize(IMAGE)).rejects.toThrow(/认证失败/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('429 → 限流提示且不重试', async () => {
    const mock = stubFetch(async () => new Response('', { status: 429 }));
    await expect(createLlmProvider(SETTINGS).recognize(IMAGE)).rejects.toThrow(/限流/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('响应非 JSON → 重试 1 次后抛出', async () => {
    const mock = stubFetch(async () => okResp('这不是 JSON'));
    await expect(createLlmProvider(SETTINGS).recognize(IMAGE)).rejects.toThrow(/JSON/);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('CORS 拦截（TypeError: Failed to fetch）→ 归一化提示且不重试', async () => {
    const mock = stubFetch(async () => { throw new TypeError('Failed to fetch'); });
    await expect(createLlmProvider(SETTINGS).recognize(IMAGE)).rejects.toThrow(/CORS/);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('未配置完整 → 拒绝且不发请求', async () => {
    const mock = stubFetch(async () => okResp('{}'));
    await expect(createLlmProvider({ ...DEFAULT_OCR_SETTINGS, engine: 'llm' }).recognize(IMAGE))
      .rejects.toThrow(/识别设置/);
    expect(mock).not.toHaveBeenCalled();
  });
});
