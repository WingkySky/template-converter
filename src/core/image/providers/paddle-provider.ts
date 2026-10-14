// 本地 OCR 引擎（PaddleOCR 官方浏览器 SDK @0.4.2，PP-OCRv5 mobile，ONNX Runtime Web——
// 浏览器内推理，数据不出网）。2026-10-14 替换 Tesseract.js：真实样张双引擎对照
// Paddle 全表仅 1 字错 vs Tesseract 全表碎裂（详见 docs/superpowers/plans/2026-10-14-paddle-local-engine-plan.md）。
//
// 资源策略：全部 CDN 运行时拉取、不进 single 产物（模型数 MB～数十 MB，pdf.js 1MB worker
// 内联已是体积上限先例）。三组资源：
//   主入口 + 裸依赖（js-yaml/clipper-lib/opencv-js）→ jsDelivr，裸依赖经 index.html import map 解析；
//   worker / ORT wasm → jsDelivr 钉版；
//   模型（det 4.8MB + rec 16.7MB）→ paddle-model-ecology.bj.bcebos.com（百度 BOS 默认源，
//   实测对任意 Origin 反射 CORS 头，GitHub Pages 挂网直用；后备 ModelAsset.url 可自定义）。
//
// 已知坑（spike 实测，勿“简化”掉）：
//  1) 跨域 Worker 构造被浏览器 SecurityError 拒绝，同源 shim + importScripts 对该大文件
//     又实测 NetworkError——必须主线程 fetch 代码文本后经 Blob URL 建 worker；worker-entry
//     含 import.meta（ORT wasm 路径解析），必须 type:'module'；
//  2) ortOptions.wasmPaths 必须显式绝对地址（blob 上下文 import.meta.url 相对解析失效）；
//  3) OcrResultItem.poly 运行时是 [x,y] 数值数组（README 的 Point2D {x,y} 类型标注与实际
//     不符）——按数组下标读，并整体做最小投影防类型库漂移（沿 tesseract-provider 手法）；
//  4) worker-entry 文件名含内容哈希（C9UNuyOJ）——升级 SDK 版本时必须同步更新 WORKER_URL。
import type { OcrEngineResult, OcrImageInput, OcrProgress, OcrProvider, OcrWord } from '../types';
import { ocrWordsToRows } from '../ocr-words';
import { detectColumnBorders } from '../grid-cols';

const SDK_VERSION = '0.4.2';
const SDK_CDN = `https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@${SDK_VERSION}`;
const INDEX_URL = `${SDK_CDN}/dist/index.mjs`;
// 内容哈希随版本变化（见头部坑位 4）
const WORKER_URL = `${SDK_CDN}/dist/assets/worker-entry-C9UNuyOJ.js`;
// 与 worker-entry 打包所用的 ORT 版本一致（SDK 声明 ^1.22.0，实际打包 1.24.3）
const ORT_WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
// 推理参数：unclip 收紧检测框（默认 1.5）。行级框膨胀会把右对齐金额与其右邻列
// （卡号等）的间隙压到几何管线 0.75×字号分格阈值之下 → 两列粘进一格（2026-10-14
// 真实样张实测：1.5/1.2 粘连、1.0 分离，置信度 99.7→99.6 基本无损）
const PREDICT_PARAMS = { textDetUnclipRatio: 1.0 };

// —— SDK 输出/入参结构的最小投影（与官方类型解耦，防漂移；运行时形状见头部坑位 3：
//    点是 [x, y] 数值数组，tuple 类型即可表达且接受 number[] 字面量之外的真实数据）——
type PaddlePointLike = readonly [number, number];
interface PaddleItemLike { poly?: PaddlePointLike[]; text?: string; score?: number }
interface PaddleResultLike { items?: PaddleItemLike[] | null }
interface PaddlePipelineLike {
  predict: (image: unknown, params?: Record<string, unknown>) => Promise<PaddleResultLike[]>;
  dispose?: () => Promise<void>;
}
interface PaddleModuleLike {
  PaddleOCR: {
    create: (options: Record<string, unknown>) => Promise<PaddlePipelineLike>;
  };
}

/**
 * poly 四点（任意方向四边形）→ 包围盒词块；纯符号过滤（表格边框被识别成 | — ~ 等，
 * 不含字母/数字/CJK 即丢弃）；score 0~1 → 0~100 截断。导出供单测。
 */
export function paddleResultToWords(items: PaddleItemLike[] | null | undefined): OcrWord[] {
  const words: OcrWord[] = [];
  for (const item of items || []) {
    const text = String(item.text || '');
    if (!text.trim() || !/[\p{L}\p{N}]/u.test(text)) continue;
    const poly = item.poly;
    if (!Array.isArray(poly) || poly.length < 2) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of poly) {
      const x = Number(p?.[0]);
      const y = Number(p?.[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        xs.push(x);
        ys.push(y);
      }
    }
    if (!xs.length) continue;
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    words.push({
      text,
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      confidence: Math.max(0, Math.min(100, Number(item.score ?? 0) * 100)),
    });
  }
  return words;
}

// Pipeline 全局单例复用：创建含 worker 代码下载（11.3MB）、ORT wasm 与模型下载（~34MB）、
// WASM 实例化，代价大；失败时允许下次重试，不缓存 rejected promise（沿 tesseract-provider 模式）
let pipelinePromise: Promise<PaddlePipelineLike> | null = null;
// 进度经 sink 转接：创建期（worker 下载）与识别期回调来自不同调用
let progressSink: ((p: OcrProgress) => void) | null = null;

/** fetch 文本 + 流式进度（worker 代码 11.3MB，映射到进度条 0~60% 区间）。
 *  字节必须累积后一次性解码——按 chunk 解码会把跨块边界的多字节字符劈坏，
 *  产出的坏脚本会让 Blob worker 静默启动失败（spike 后首冒烟实测踩坑）。 */
async function fetchTextWithProgress(url: string, toPercent: (loaded: number, total: number) => number): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const total = Number(resp.headers.get('content-length') || 0);
  if (!resp.body || !total) return resp.text();
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    progressSink?.({ percent: toPercent(loaded, total), stage: '下载本地识别组件' });
  }
  const all = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}

// worker 引用自持：dispose() 的协议消息对已崩坏（bad_alloc）的 worker 可能挂起/失败，
// 唯一确定的释放是 worker.terminate()（同步、必成功）——否则泄漏整套推理引擎
// （wasm+模型数百 MB/套），泄漏几次即渲染进程 OOM（2026-10-14 用户实测浏览器崩溃）
let trackedWorker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
// 闲置自动释放：识别引擎常驻数百 MB，分析完成后 90s 无后续识别即归还内存；
// 下次识别重建（模型走 HTTP 缓存，重建秒级）
const IDLE_DISPOSE_MS = 90_000;

function getPipeline(): Promise<PaddlePipelineLike> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // 动态 import 外部 CDN URL：@vite-ignore 阻止 vite 打包/改写；裸依赖由页面
      // import map 解析（vite dev 与 build 产物均原样保留该 script）
      const mod = await import(/* @vite-ignore */ INDEX_URL) as PaddleModuleLike;
      const code = await fetchTextWithProgress(WORKER_URL, (loaded, total) =>
        Math.min(60, Math.round((loaded / total) * 60)));
      // createWorker 是同步签名：fetch 必须发生在 create 之前
      const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const worker = new Worker(blobUrl, { type: 'module' });
      trackedWorker = worker;
      return await mod.PaddleOCR.create({
        lang: 'ch',
        ocrVersion: 'PP-OCRv5',
        worker: { createWorker: () => worker },
        // 默认 wasm 后端：spike 实测不慢于 webgpu 首跑，且下载量少 13MB；webgpu 留作后续实验
        ortOptions: { backend: 'wasm', wasmPaths: ORT_WASM_PATHS },
      });
    })();
    pipelinePromise.catch(() => { pipelinePromise = null; });
  }
  return pipelinePromise;
}

/** 彻底释放推理引擎：terminate 同步确定（dispose 协议消息对坏 worker 不可靠） */
function killPipeline(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  try { trackedWorker?.terminate(); } catch { /* 已死则忽略 */ }
  trackedWorker = null;
  pipelinePromise = null;
}

/** OOM 后重建：terminate 旧 worker（新 worker 即新堆），模型走 HTTP 缓存重建秒级 */
function recreatePipeline(): Promise<PaddlePipelineLike> {
  killPipeline();
  return getPipeline();
}

/** 识别结束后闲置计时，超时归还引擎内存 */
function scheduleIdleDispose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { idleTimer = null; killPipeline(); }, IDLE_DISPOSE_MS);
}

/** canvas 等比缩小 factor 倍（OOM 降级重试用；白底，避免透明区参与推理） */
function downscaleCanvas(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(src.width * factor));
  canvas.height = Math.max(1, Math.round(src.height * factor));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布（浏览器不支持 canvas 2D）');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** ORT WASM 堆溢出（std::bad_alloc 等）——大图在 worker 内叠加 opencv/模型内存时偶发 */
function isOomError(err: unknown): boolean {
  return /bad_alloc|out of memory|OOM|OrtRun/i.test(err instanceof Error ? err.message : String(err));
}

/** 表格竖线检测（内容 y 范围取词块覆盖范围）；任何异常都回落 undefined（推断归带路径） */
function detectBordersSafe(canvas: HTMLCanvasElement, words: OcrWord[]): number[] | undefined {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const yMin = Math.max(0, Math.min(...words.map(w => w.y)) - 4);
    const yMax = Math.min(canvas.height, Math.max(...words.map(w => w.y + w.h)) + 4);
    return detectColumnBorders(imageData, yMin, yMax);
  } catch {
    return undefined;
  }
}

export const paddleProvider: OcrProvider = {
  id: 'local',
  async recognize(image: OcrImageInput, opts = {}): Promise<OcrEngineResult> {
    if (!image.canvas) {
      throw new Error('本地 OCR 引擎仅支持浏览器环境（需要 canvas）');
    }
    // file:// 下浏览器禁 Blob worker（含本地单文件模式）——提前给出准确指引，
    // 而非落到「资源加载失败」网络文案误导用户以为是模型没下载
    if (location.protocol === 'file:') {
      throw new Error('单文件本地模式（file://）下浏览器禁止创建识别引擎的 Worker，本地识别不可用；请在项目根目录运行 npx vite preview --mode single 后访问 localhost 地址测试，或直接使用挂网地址/云端识别');
    }
    progressSink = opts.onProgress ?? null;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } // 连续识别复用引擎
    try {
      let pipeline = await getPipeline();
      // 模型初始化与推理无进度钩子（发生在 worker 内部），走不确定进度
      progressSink?.({ percent: -1, stage: '识别中' });
      let activeCanvas = image.canvas;
      let result: PaddleResultLike;
      try {
        [result] = await pipeline.predict(activeCanvas, PREDICT_PARAMS);
      } catch (err) {
        if (!isOomError(err)) throw err;
        // OOM：terminate 旧 worker（新 worker=新堆，无泄漏）原尺寸重试；仍溢出才降 1/2——
        // 降分辨率会让检测框在列间隙小处粘连（实测），只作最后兜底
        progressSink?.({ percent: -1, stage: '内存不足，重建识别引擎重试' });
        pipeline = await recreatePipeline();
        try {
          [result] = await pipeline.predict(activeCanvas, PREDICT_PARAMS);
        } catch (err2) {
          if (!isOomError(err2) || activeCanvas.width * activeCanvas.height < 1_500_000) throw err2;
          progressSink?.({ percent: -1, stage: '内存不足，降低分辨率重试' });
          activeCanvas = downscaleCanvas(activeCanvas, 0.5);
          [result] = await pipeline.predict(activeCanvas, PREDICT_PARAMS);
        }
      }
      const words = paddleResultToWords(result?.items);
      if (!words.length) return { rows: [], meanConfidence: null, engine: 'local' };
      // 表格竖线检测（画布坐标与词块一致——含 OOM 降级后的实际推理画布）；失败回落推断归带
      const borders = detectBordersSafe(activeCanvas, words);
      const { rows, meanConfidence } = ocrWordsToRows(words, activeCanvas.height, borders);
      return { rows, meanConfidence, engine: 'local' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/net::|failed to fetch|networkerror|load|404|timed?\s*out/i.test(msg)) {
        throw new Error(`本地 OCR 引擎资源加载失败（首次使用需联网下载识别组件与模型约 45MB，之后浏览器缓存承载复用）：${msg}`);
      }
      throw err;
    } finally {
      progressSink = null;
      scheduleIdleDispose(); // 90s 无后续识别即归还引擎内存（防常驻数百 MB 拖垮渲染进程）
    }
  },
};
