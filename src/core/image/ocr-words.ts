// OCR 词块 → 表格行：与 PDF 导入同构（设计 §2），坐标适配后直接调用 pdfTextItemsToRows
// 复用其几何管线（视觉行单链聚类/细粒度分格/列带归位/数字去空白），零改动零重构，
// npm run compare 零风险。适配点：
//  1) 图片坐标 y 向下且为包围盒左上角；PDF 坐标 y 向上且为基线——用 (imgH - y - h)
//     近似基线（基线与盒底差一个降部，行容差 0.75×字高可吸收；阈值为比例制，对
//     OCR 词块与 PDF 文本项同样适用）；
//  2) 过滤空白/零尺寸词块（OCR 偶发空壳）；
//  3) 全图平均置信度在此计算（词块级）。格级问题不在此层——pdfTextItemsToRows 不回传
//     词块溯源，为不复制几何管线，格级标记完全交给 validate.ts（实施计划要点 2/3）。
import type { Rows } from '../../types';
import { pdfTextItemsToRows } from '../parser/pdf-text';
import type { OcrWord } from './types';

export interface OcrWordsToRowsResult {
  rows: Rows;
  /** 词块置信度均值（0~100，1 位小数）；无有效词块时为 null */
  meanConfidence: number | null;
}

export function ocrWordsToRows(words: OcrWord[], imageHeight: number): OcrWordsToRowsResult {
  const real = words.filter(w => w.text && w.text.trim() && w.w > 0 && w.h > 0);
  if (!real.length) return { rows: [], meanConfidence: null };
  const meanConfidence = Math.round(
    (real.reduce((s, w) => s + w.confidence, 0) / real.length) * 10,
  ) / 10;
  const items = real.map(w => ({
    str: w.text,
    x: w.x,
    y: imageHeight - (w.y + w.h),
    w: w.w,
    h: w.h,
  }));
  return { rows: pdfTextItemsToRows(items), meanConfidence };
}
