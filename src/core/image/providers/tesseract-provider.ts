// 本地 OCR 引擎（Tesseract.js v7，WASM，浏览器内运行——数据不出网，设计 §5.1）。
// 资源策略：worker / WASM core / 语言包运行时从 jsDelivr 与 tessdata.projectnaptha.com
// 拉取（强缓存头，首次联网下载后由浏览器 HTTP 缓存承载复用）；不内联进 single 产物——
// 模型数 MB，pdf.js 的 1MB worker 内联已是体积上限先例（设计 §2）。
// v6+ 默认只输出 text，word 级坐标需显式开启 blocks 输出后自行遍历。
import type { OcrEngineResult, OcrImageInput, OcrProgress, OcrProvider, OcrWord } from '../types';
import { ocrWordsToRows } from '../ocr-words';

// 资源钉版（与 package.json 的 tesseract.js@7.0.0 对齐；WASM core 为独立包，同为 7.0.0）
const WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js';
const CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';
// 中英混排：中文表头/姓名 + 数字金额/证件号
const LANGS = 'chi_sim+eng';

// —— Tesseract 输出结构的最小投影（与官方类型解耦，防类型库漂移）——
interface TessBBox { x0: number; y0: number; x1: number; y1: number }
interface TessWordLike { text?: string; confidence?: number; bbox?: TessBBox }
interface TessBlockLike { paragraphs?: Array<{ lines?: Array<{ words?: TessWordLike[] }> }> }
interface TessWorkerLike {
  recognize: (image: unknown, options?: unknown, output?: unknown) => Promise<{ data: { blocks?: TessBlockLike[] | null } }>;
}

// Worker 全局单实例复用：创建含模型下载与 WASM 实例化，代价大；多图识别在单 worker 上
// 由 tesseract.js 内部队列串行，避免重复创建的内存峰值（设计 §5.1）
let workerPromise: Promise<TessWorkerLike> | null = null;
// logger 是 createWorker 的创建期参数，而进度回调随每次识别变化——经 sink 转接
let progressSink: ((p: OcrProgress) => void) | null = null;

async function getWorker(): Promise<TessWorkerLike> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker(LANGS, 1, {
        workerPath: WORKER_PATH,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        logger: (m: { status?: string; progress?: number }) => {
          if (progressSink && typeof m?.progress === 'number') {
            progressSink({ percent: Math.round(m.progress * 100), stage: m.status || '识别中' });
          }
        },
      });
      return worker as unknown as TessWorkerLike;
    })();
    // 创建失败（无网/CDN 故障）时允许下次重试，不缓存 rejected promise
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

function extractWords(data: { blocks?: TessBlockLike[] | null }): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) {
          const text = String(word.text || '');
          const bbox = word.bbox;
          if (!text.trim() || !bbox) continue;
          // 过滤纯符号词块：表格边框线被 OCR 成 | — ~ 等字符（2026-10-13 冒烟实测），
          // 它们不携带内容却污染格内拼接与列带间隙计算；不含任何字母/数字/CJK 即丢弃
          if (!/[\p{L}\p{N}]/u.test(text)) continue;
          words.push({
            text,
            x: bbox.x0,
            y: bbox.y0,
            w: bbox.x1 - bbox.x0,
            h: bbox.y1 - bbox.y0,
            confidence: Math.max(0, Math.min(100, Number(word.confidence ?? 0))),
          });
        }
      }
    }
  }
  return words;
}

export const tesseractProvider: OcrProvider = {
  id: 'local',
  async recognize(image: OcrImageInput, opts = {}): Promise<OcrEngineResult> {
    if (!image.canvas) {
      throw new Error('本地 OCR 引擎仅支持浏览器环境（需要 canvas）');
    }
    progressSink = opts.onProgress ?? null;
    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(image.canvas, {}, { blocks: true });
      const words = extractWords(data);
      if (!words.length) return { rows: [], meanConfidence: null, engine: 'local' };
      const { rows, meanConfidence } = ocrWordsToRows(words, image.height);
      return { rows, meanConfidence, engine: 'local' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/net::|failed to fetch|networkerror|load|404|timed?\s*out/i.test(msg)) {
        throw new Error(`本地 OCR 引擎资源加载失败（首次使用需联网下载识别模型，之后浏览器缓存承载复用）：${msg}`);
      }
      throw err;
    } finally {
      progressSink = null;
    }
  },
};
