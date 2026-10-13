// 云端 OCR 引擎（OpenAI 兼容多模态 /chat/completions，设计 §5.2）。
// 首发目标服务：Agnes AI agnes-3.0-flash（apihub.agnes-ai.com/v1，OpenAI 兼容，
// 文档现价 $0，2026-10-13）；配置为通用 baseURL/key/model 三件套，任何兼容视觉服务可替换。
// 硬约束：服务必须支持浏览器 CORS 直连（不做代理后端）；key 仅存本浏览器 localStorage；
// 开启即身份证/卡号/金额发送至所填服务（设置面板红字明示）。
import type { OcrEngineResult, OcrImageInput, OcrProgress, OcrProvider } from '../types';
import type { OcrSettings } from '../../../io/ocr-settings';
import type { Rows } from '../../../types';

const TIMEOUT_MS = 120_000;
// prompt 契约：严格 JSON、逐字符照抄数字（禁止模型「好心修正」）、合计行保留——
// 行级清洗（小计过滤、表头识别）交给下游 smartDetectTable，这里不做任何语义加工。
// 第 3 条针对真实案例（2026-10-14）：首列表头写「9月」但内容是姓名，模型曾因此丢列。
const PROMPT = `你是表格识别助手。图片中是一张表格（表头可能不完整）。请把表格内容完整转录为 JSON，要求：
1. 只输出 JSON，不要任何解释或 markdown 代码围栏；
2. 格式：{"header": ["列名", ...], "rows": [["单元格", ...], ...]}；
3. 每一列都必须完整输出：即使某列表头不是常规列名（如「9月」这类月份标注、或表头缺失），只要该列有数据（如人员姓名）就必须作为独立一列逐行照抄，不得丢弃、合并或挪作他用；
4. 保持原有行列顺序，空单元格输出 ""；
5. 数字、金额、证件号、卡号必须逐字符照抄，禁止修正、补零或四舍五入；
6. 合计/小计行原样保留；
7. 无法辨认的字符照原样输出或输出 ""，不要猜测。`;

/** LLM 响应解析：剥围栏 → JSON → 归一为 Rows（容忍裸二维数组；空行丢弃） */
export function parseLlmResponse(content: string): Rows {
  const t = content.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const jsonText = (fenced ? fenced[1] : t).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('LLM 响应不是合法 JSON，请重试或更换模型');
  }
  const bareRows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(bareRows)) throw new Error('LLM 响应缺少 rows 数组');
  const rows: Rows = [];
  const header = !Array.isArray(parsed) ? (parsed as { header?: unknown }).header : null;
  if (Array.isArray(header)) {
    rows.push(header.map(c => String(c ?? '').trim()));
  }
  for (const r of bareRows) {
    if (!Array.isArray(r)) continue;
    const row = r.map(c => String(c ?? '').trim());
    if (row.some(v => v !== '')) rows.push(row);
  }
  return rows;
}

/**
 * SSE 流式接收：逐块累计 delta.content（含 reasoning_content 思考过程），节流回调
 * 实时预览——云端识别不再像死机，用户能看到模型正在输出（2026-10-14 用户反馈）。
 */
export async function consumeContentStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (preview: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let lastNotify = 0;
  const notify = (force = false): void => {
    if (!onDelta) return;
    const now = Date.now();
    if (!force && now - lastNotify < 150) return; // 节流，避免 UI 刷屏
    lastNotify = now;
    // 思考过程优先展示（最能传达「模型在动」），无思考流时展示正文尾部
    const live = (reasoning || content).replace(/\s+/g, ' ');
    onDelta(live.length > 60 ? '…' + live.slice(-60) : live);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>;
        };
        const delta = j.choices?.[0]?.delta;
        if (typeof delta?.content === 'string' && delta.content) {
          content += delta.content;
          notify();
        } else if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          notify();
        }
      } catch { /* 心跳注释或非 JSON 行，忽略 */ }
    }
  }
  notify(true);
  if (!content.trim()) throw new Error('LLM 流式响应为空（未收到正文）');
  return content;
}

async function chatOnce(
  llm: OcrSettings['llm'],
  image: OcrImageInput,
  signal: AbortSignal,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  const base = llm.baseURL.replace(/\/+$/, '');
  onProgress?.({ percent: -1, stage: '已发送图片，等待云端模型响应…' });
  let resp: Response;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
      signal,
      body: JSON.stringify({
        model: llm.model,
        temperature: 0,
        stream: true, // 流式接收：进度可见（服务端不支持时回落普通 JSON 解析）
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: image.dataUrl } },
          ],
        }],
      }),
    });
  } catch (err) {
    // CORS 拦截在浏览器表现为 TypeError: Failed to fetch（服务未回跨域头）——归一化提示
    if (err instanceof TypeError) {
      throw new Error('云端 OCR 请求被浏览器拦截（通常是所选服务不支持 CORS 跨域直调，静态网页无法代理）：请换用支持浏览器直连的服务');
    }
    throw err;
  }
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) throw new Error(`云端 OCR 认证失败（HTTP ${resp.status}）：请检查 API key`);
    if (resp.status === 429) throw new Error('云端 OCR 触发限流（HTTP 429）：请稍后重试或检查服务额度');
    throw new Error(`云端 OCR 服务返回 HTTP ${resp.status}`);
  }
  const ctype = resp.headers.get('content-type') || '';
  if (resp.body && /event-stream/i.test(ctype)) {
    return await consumeContentStream(resp.body, preview => {
      onProgress?.({ percent: -1, stage: '云端识别中（流式接收）', detail: preview });
    });
  }
  // 服务端忽略 stream 参数：按普通 JSON 解析
  const json = await resp.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM 响应为空');
  return content;
}

export function createLlmProvider(settings: OcrSettings): OcrProvider {
  return {
    id: 'llm',
    async recognize(image: OcrImageInput, opts = {}): Promise<OcrEngineResult> {
      const llm = settings.llm;
      if (!llm.baseURL || !llm.apiKey || !llm.model) {
        throw new Error('云端 OCR 未配置完整（baseURL / API key / 模型名），请在上传页「识别设置」中填写');
      }
      let lastErr: unknown = null;
      // 网络抖动/JSON 解析失败重试 1 次；认证/限流/超时/CORS 类错误重试无意义，直接抛
      for (let attempt = 0; attempt < 2; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
          const content = await chatOnce(llm, image, ctrl.signal, opts.onProgress);
          return { rows: parseLlmResponse(content), meanConfidence: null, engine: 'llm' };
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            throw new Error('云端 OCR 请求超时（120 秒），请重试或缩小图片');
          }
          lastErr = err;
          if (err instanceof Error && /认证失败|限流|HTTP \d|CORS/.test(err.message)) throw err;
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
  };
}
