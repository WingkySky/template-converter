// 图片识别领域类型。core/image 不依赖 DOM——DOM 侧（图片加载、canvas 绘制、PDF 页面
// 渲染）一律由调用方（ocr-service / upload / pdf.ts 的浏览器分支）完成，本层只收纯数据。
import type { Rows } from '../../types';

/** OCR 引擎产出的词块：文本 + 包围盒 + 置信度（图片坐标，y 向下，x/y 为包围盒左上角） */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0~100；LLM 引擎无词块概念，不产出词块 */
  confidence: number;
}

/** 单次识别的统一产出（两引擎同形，下游管线只认这个形状） */
export interface OcrEngineResult {
  rows: Rows;
  /** 词块置信度均值（0~100，1 位小数）；LLM 引擎为 null——格级问题完全靠校验层 */
  meanConfidence: number | null;
  engine: 'local' | 'llm';
  /** 引擎编排提示（如 auto 模式云端失败回落本地的原因），随结果透传给校对横幅 */
  notice?: string;
}

/** 识别进度回调载荷（percent < 0 表示不确定进度，如 LLM 流式接收） */
export interface OcrProgress {
  /** 0~100；-1 = 不确定进度 */
  percent: number;
  stage: string;
  /** 可选的实时细节（LLM 流式：最近输出片段预览），UI 原样展示 */
  detail?: string;
}

/**
 * 识别入参：同一张图同时给出 canvas（本地引擎直接吃 canvas）与 dataURL（LLM 引擎走
 * base64），由 ocr-service 统一准备，Provider 各取所需。Node/测试环境 canvas 为 null。
 */
export interface OcrImageInput {
  canvas: HTMLCanvasElement | null;
  dataUrl: string;
  width: number;
  height: number;
}

export interface OcrRecognizeOptions {
  onProgress?: (p: OcrProgress) => void;
}

/** Provider 接口：本地 PaddleOCR 与云端 LLM 各实现一份（设计 §3 双引擎抽象） */
export interface OcrProvider {
  id: 'local' | 'llm';
  recognize(image: OcrImageInput, opts?: OcrRecognizeOptions): Promise<OcrEngineResult>;
}
