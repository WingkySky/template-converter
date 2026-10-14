// OCR 服务编排（设计 §3）：图片 → canvas → 前处理 → 引擎识别 → analyzeSheet 管线 →
// 数据源条目。两引擎产出统一 OcrEngineResult，下游完全复用 PDF 导入的
// smartDetectTable/detectColumnMapping 管线——图片只是第 4 种数据源入口。
// 本模块含 DOM 调用，但仅被浏览器分支动态 import（upload.ts 图片分支 / pdf.ts 扫描
// 降级），Node 单测/回归驱动器不会触达。
import { buildSourceItem } from '../parser/source-item';
import type { SourceItemData } from '../parser/source-item';
import { analyzeSheet } from '../parser/excel';
import { applyInferredNameByData } from '../mapping/column-detect';
import { loadOcrSettings } from '../../io/ocr-settings';
import type { OcrEngineChoice } from '../../io/ocr-settings';
import { cleanOcrRows } from './clean';
import { DEFAULT_PREPROCESS, effectiveScale, enhance } from './preprocess';
import type { PreprocessParams, GrayImage } from './preprocess';
import type { OcrEngineResult, OcrProgress, OcrProvider } from './types';

export type OcrEngineId = 'local' | 'llm';

export interface OcrRunOptions {
  engine?: OcrEngineChoice;
  onProgress?: (p: OcrProgress) => void;
  /** 前处理参数覆盖（扫描 PDF 渲染已含放大，传 scale:1 防止二次放大） */
  preprocess?: PreprocessParams;
}

/**
 * 引擎编排顺序（纯函数，可单测）。2026-10-13 双引擎实测：云端 LLM 对表格截图的
 * 结构还原显著优于本地 Tesseract（8 列完美分离 vs 列带粘连），故 auto 默认
 * 「已配置 key → 云端优先、失败回落本地」；未配置或显式 local 时仅本地。
 */
export function pickEngineOrder(choice: OcrEngineChoice, hasLlmKey: boolean): OcrEngineId[] {
  if (choice === 'local') return ['local'];
  if (choice === 'llm') return ['llm'];
  return hasLlmKey ? ['llm', 'local'] : ['local'];
}

/** 图片解码为 canvas；超大图先等比压到 maxDim（OCR 不需要摄影级分辨率，护栏内存） */
async function blobToCanvas(blob: Blob, maxDim = 4000): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片解码失败，请确认文件为有效图片'));
      img.src = url;
    });
    const shrink = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * shrink));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * shrink));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布（浏览器不支持 canvas 2D）');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 前处理：短边放大（标定 1.5 倍，见 DEFAULT_PREPROCESS）→ 灰度 → 对比度拉伸（±可选二值化）。
 *  返回增强画布 + 增强前的原始像素（raw：表格竖线检测必须用原始像素——对比度拉伸会把
 *  浅灰格线洗出暗像素阈值，实测原始画布检出 8 条边框线、增强后仅剩 3 条） */
function preprocessCanvas(src: HTMLCanvasElement, params: PreprocessParams): { canvas: HTMLCanvasElement; raw: GrayImage } {
  const scale = effectiveScale(Math.min(src.width, src.height), params);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布（浏览器不支持 canvas 2D）');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const raw = ctx.getImageData(0, 0, w, h);
  const enhanced = enhance(raw, params);
  // enhance 返回的 data 底层必为新建的普通 ArrayBuffer（见 preprocess.ts），泛型收窄仅为类型层面
  ctx.putImageData(new ImageData(enhanced.data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return { canvas, raw: { width: w, height: h, data: raw.data } };
}

async function getProvider(id: OcrEngineId): Promise<OcrProvider> {
  if (id === 'llm') {
    const { createLlmProvider } = await import('./providers/llm-provider');
    return createLlmProvider(loadOcrSettings());
  }
  const { paddleProvider } = await import('./providers/paddle-provider');
  return paddleProvider;
}

/**
 * canvas → 引擎识别（导出给 pdf.ts 扫描降级复用：每页渲染成 canvas 后调用）。
 * 按 pickEngineOrder 顺序尝试；auto 模式云端失败时回落本地并在结果中附回落原因。
 * 行数可能为 0（空白页），由调用方聚合后统一判断。
 */
export async function recognizeCanvasRaw(
  src: HTMLCanvasElement,
  opts: OcrRunOptions = {},
): Promise<OcrEngineResult> {
  const settings = loadOcrSettings();
  const { canvas: processed, raw } = preprocessCanvas(src, opts.preprocess ?? DEFAULT_PREPROCESS);
  // dataUrl 仅云端引擎需要（base64 大图，本地路径生成即浪费内存/CPU——OOM 敏感场景）
  const order = pickEngineOrder(opts.engine ?? settings.engine, !!settings.llm.apiKey.trim());
  const image = {
    canvas: processed,
    dataUrl: order.includes('llm') ? processed.toDataURL('image/png') : '',
    width: processed.width,
    height: processed.height,
    rawImageData: raw,
  };
  let llmError: string | null = null;
  for (const id of order) {
    const provider = await getProvider(id);
    try {
      const result = await provider.recognize(image, { onProgress: opts.onProgress });
      // 出口统一清洗（引号伪影/边框竖线/全角数字/悬空标点/长数字内空格）——只作用于图片源
      result.rows = cleanOcrRows(result.rows);
      if (id === 'local' && llmError) {
        result.notice = `云端识别失败，已自动回落本地引擎（云端原因：${llmError}）`;
      }
      return result;
    } catch (err) {
      if (id === 'llm' && order.includes('local')) {
        // auto 模式：云端失败不算终局，记下原因回落本地
        llmError = err instanceof Error ? err.message : String(err);
        continue;
      }
      throw err;
    }
  }
  throw new Error('未能完成识别（引擎编排顺序为空）');
}

/** 图片文件 → 单一数据源条目（upload.ts 图片分支入口，设计 §3 数据流） */
export async function importImageSource(
  blob: Blob,
  fileName: string,
  opts: OcrRunOptions = {},
): Promise<SourceItemData> {
  if (blob.size > 20 * 1024 * 1024) {
    throw new Error('图片超过 20MB，请压缩后再试');
  }
  const src = await blobToCanvas(blob);
  const result = await recognizeCanvasRaw(src, opts);
  if (!result.rows.length) {
    throw new Error('未能从图片识别到文字：请确认图片中包含清晰的表格文字，或在上传页「识别设置」中改用云端识别');
  }
  // 与 PDF 导入同构：智能表头识别 + 自动列映射在 analyzeSheet 内完成
  const analysis = analyzeSheet(fileName, result.rows, '', '');
  // 图片源：表头非「姓名」（如「9月」）时按数据特征补推断姓名列
  // （多图场景非预览源在 confirmMapping 走 analysis.autoMap，必须在此补齐）
  applyInferredNameByData(
    analysis.rows[analysis.headerRowIndex] || [],
    analysis.rows.slice(analysis.headerRowIndex + 1),
    analysis.autoMap,
  );
  const item = buildSourceItem({
    type: 'image',
    fileName,
    sheetName: '图片',
    rows: analysis.rows,
    analysis,
  });
  item.ocr = { engine: result.engine, meanConfidence: result.meanConfidence, notice: result.notice };
  return item;
}
