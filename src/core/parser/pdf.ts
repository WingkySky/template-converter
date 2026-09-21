// PDF 数据源解析（pdf.js 接线）：文本项几何重建 → 复用 analyzeSheet 智能表格管线。
// pdf.js 以主线程 fake worker 方式运行（下方注入 globalThis.pdfjsWorker，pdf.mjs 的
// #mainThreadWorkerMessageHandler 会优先读取该全局）：避免真实 Worker/Blob 在
// file:// 单文件构建下的兼容性问题，与 xlsx/exceljs 同为主线程解析的取舍，
// 代价是 worker 脚本（约 1MB）内联进 bundle。
import * as pdfjsLib from 'pdfjs-dist';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs';
import type { Rows } from '../../types';
import { buildSourceItem } from './source-item';
import type { SourceItemData } from './source-item';
import { analyzeSheet } from './excel';
import { pdfTextItemsToRows } from './pdf-text';
import type { PdfTextItem } from './pdf-text';

// 必须在首次 getDocument 之前注入（PDFWorker 初始化时读取一次）
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

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
      throw new Error('未能从 PDF 提取到文字，可能是扫描件/图片型 PDF；请改用 Excel 或 CSV 文件');
    }
    // analyzeSheet 的月份/年份提示参数为 legacy 保留签名（当前未参与评分），传空即可
    const analysis = analyzeSheet('PDF', rows, '', '');
    return [buildSourceItem({ type: 'pdf', fileName, sheetName: 'PDF', rows: analysis.rows, analysis })];
  } finally {
    doc.destroy();
  }
}
