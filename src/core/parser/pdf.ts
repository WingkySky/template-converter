// PDF 数据源解析（pdf.js 接线）：文本项几何重建 → 复用 analyzeSheet 智能表格管线。
// pdf.js 以主线程 fake worker 方式运行（下方注入 globalThis.pdfjsWorker，pdf.mjs 的
// #mainThreadWorkerMessageHandler 会优先读取该全局）：避免真实 Worker/Blob 在
// file:// 单文件构建下的兼容性问题，与 xlsx/exceljs 同为主线程解析的取舍，
// 代价是 worker 脚本（约 1MB）内联进 bundle。
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs';
import type { Rows } from '../../types';
import { buildSourceItem } from './source-item';
import type { SourceItemData } from './source-item';
import { analyzeSheet } from './excel';
import { pdfTextItemsToRows } from './pdf-text';
import type { PdfTextItem } from './pdf-text';
import { DEFAULT_PREPROCESS } from '../image/preprocess';

// 必须在首次 getDocument 之前注入（PDFWorker 初始化时读取一次）
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

// —— 扫描件/图片型 PDF 降级（设计 §1 决策 4）——
// 逐页渲染成 canvas（渲染倍率 3 ≈ 216dpi，OCR 甜点区）→ 复用 OCR 编排
// recognizeCanvasRaw（前处理 scale:1，防止二次放大）。Node 测试环境无 canvas →
// 返回 null，上层保持原可读报错（tests/unit/parser/pdf.test.ts 的 /扫描件/ 断言依赖）。
async function ocrScannedPages(doc: PDFDocumentProxy, fileName: string): Promise<SourceItemData | null> {
  if (typeof document === 'undefined') return null;
  const { recognizeCanvasRaw } = await import('../image/ocr-service');
  const rows: Rows = [];
  const confidences: number[] = [];
  let engine: 'local' | 'llm' | null = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 3 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const result = await recognizeCanvasRaw(canvas, { preprocess: { ...DEFAULT_PREPROCESS, scale: 1 } });
    rows.push(...result.rows);
    if (result.meanConfidence != null) confidences.push(result.meanConfidence);
    engine = result.engine;
  }
  if (!rows.length) return null;
  const analysis = analyzeSheet(fileName, rows, '', '');
  const item = buildSourceItem({ type: 'pdf', fileName, sheetName: '扫描件', rows: analysis.rows, analysis });
  item.ocr = {
    engine: engine ?? 'local',
    meanConfidence: confidences.length
      ? Math.round((confidences.reduce((s, c) => s + c, 0) / confidences.length) * 10) / 10
      : null,
  };
  return item;
}

/** 从 PDF 提取数据源条目（整个文件视为一个数据表，跨页行顺序拼接） */
export async function parsePdfSource(data: ArrayBuffer, fileName: string): Promise<SourceItemData[]> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  try {
    const rows: Rows = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height });
      }
      rows.push(...pdfTextItemsToRows(items));
    }
    if (!rows.length) {
      // 文字版提取为空 → 浏览器内降级「渲染成图 → OCR」；Node 测试环境或降级后
      // 仍无文字时，保持原可读报错口径（引导换 Excel/CSV）
      const fallback = await ocrScannedPages(doc, fileName);
      if (!fallback) {
        throw new Error('未能从 PDF 提取到文字，可能是扫描件/图片型 PDF；请改用 Excel 或 CSV 文件');
      }
      return [fallback];
    }
    // analyzeSheet 的月份/年份提示参数为 legacy 保留签名（当前未参与评分），传空即可
    const analysis = analyzeSheet('PDF', rows, '', '');
    return [buildSourceItem({ type: 'pdf', fileName, sheetName: 'PDF', rows: analysis.rows, analysis })];
  } finally {
    doc.destroy();
  }
}
