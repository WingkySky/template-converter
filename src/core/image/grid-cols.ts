// 格线感知分列（2026-10-14，用户反馈「分列不行」）：Excel/表格截图普遍带完整表格线，
// 竖线即天然列边界。共享几何管线（pdfTextItemsToRows）的列带推断按 x 区间重叠融合，
// 对「表头左对齐 + 数字右对齐」的截图会表头/数据错位一格（真实样张实测：第一笔的值
// 落进凭空的「列3」、整列第二笔丢失）——格线区直接对齐可根治，且不碰共享管线
// （compare 基线零变化）。检测失败（无框线截图/扫描件）由调用方回落推断路径。
import type { GrayImage } from './preprocess';
import type { OcrWord } from './types';
import { normalizeCellText } from '../parser/pdf-text';
import type { Rows } from '../../types';

/** 竖线判定：内容高度上暗像素（lum < DARK_LUM）覆盖率 ≥ LINE_FRAC。
 *  实测标定（2026-10-14 真实样张）：边框线覆盖率 0.98~1.0，最密文本列（19 位卡号）仅
 *  0.68——0.85 居中，两侧留档。 */
const DARK_LUM = 240;
const LINE_FRAC = 0.85;

/** 聚簇相邻的线像素列（线宽 1~3px），返回中心 x */
function clusterColumns(cols: number[]): number[] {
  const centers: number[] = [];
  let start = -1, prev = -1;
  for (const x of cols) {
    if (start < 0) { start = x; prev = x; continue; }
    if (x - prev <= 2) { prev = x; continue; }
    centers.push(Math.round((start + prev) / 2));
    start = x; prev = x;
  }
  if (start >= 0) centers.push(Math.round((start + prev) / 2));
  return centers;
}

/**
 * 检测竖直表格线（画布 x 坐标）。只统计 [yMin, yMax] 内容行范围（词块 y 覆盖范围，
 * 排除页边距噪声）。少于 3 条返回空数组（不足两个列区，视为无可用框线）。
 */
export function detectColumnBorders(image: GrayImage, yMin: number, yMax: number): number[] {
  const { width: W, data } = image;
  const y0 = Math.max(0, Math.floor(yMin));
  const y1 = Math.min(image.height - 1, Math.ceil(yMax));
  const contentH = y1 - y0 + 1;
  if (contentH < 10) return [];
  const cols: number[] = [];
  for (let x = 0; x < W; x++) {
    let dark = 0;
    for (let y = y0; y <= y1; y++) {
      const i = (y * W + x) * 4;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < DARK_LUM) dark++;
    }
    if (dark / contentH >= LINE_FRAC) cols.push(x);
  }
  const centers = clusterColumns(cols);
  return centers.length >= 3 ? centers : [];
}

/**
 * 词块 → 表格行（格线路径）：行按 y 中心单链聚类（容差 0.75×字号中位数，与共享管线
 * 同口径）；列按格线区归属（取最大重叠区，零重叠归最近区）；同区多个横向分离条目
 * （如漏检边框两侧的身份列/电话列）按 0.75×字号间隙再拆子格——子格序按 x 排名在行间
 * 保持一致。多片段同格以空格连接后统一走 normalizeCellText（卡号去空白同共享管线）。
 */
export function wordsToGridRows(words: OcrWord[], borders: number[]): { rows: Rows; usedWords: number } {
  const real = words.filter(w => w.text && w.text.trim() && w.w > 0 && w.h > 0);
  if (!real.length || borders.length < 3) return { rows: [], usedWords: 0 };

  // 行聚类：y 中心单链（词块为图片坐标 y 向下，行序 = y 升序 = 自上而下）
  const mh = median(real.map(w => (w.h > 0 ? w.h : 10)));
  const lineTol = 0.75 * mh;
  const sorted = [...real].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const lines: OcrWord[][] = [];
  let line: OcrWord[] = [];
  let lastCenter = NaN;
  for (const w of sorted) {
    const c = w.y + w.h / 2;
    if (line.length && c - lastCenter > lineTol) { lines.push(line); line = []; }
    line.push(w);
    lastCenter = c;
  }
  if (line.length) lines.push(line);

  // 区间：borders 相邻成对；首末线外侧不算区（表格外内容忽略）
  const regions: { x0: number; x1: number }[] = [];
  for (let i = 0; i < borders.length - 1; i++) regions.push({ x0: borders[i], x1: borders[i + 1] });

  // 先归区 + 区内拆子格；列布局按「每区全局最大子格数」固定（行间同一第 k 子格对齐同一列）
  const linesRegionCells = lines.map(l => splitRegionCells(l, regions, lineTol));
  const regionSubs = regions.map((_, r) => Math.max(1, ...linesRegionCells.map(cells => cells[r].length)));
  const regionOffset: number[] = [];
  let offset = 0;
  for (let r = 0; r < regions.length; r++) { regionOffset.push(offset); offset += regionSubs[r]; }

  const rows: Rows = [];
  for (const regionCells of linesRegionCells) {
    const cells: string[] = new Array(offset).fill('');
    regionCells.forEach((groups, r) => {
      groups.forEach((text, sub) => { cells[regionOffset[r] + sub] = text; });
    });
    const row = cells.map(normalizeCellText);
    if (row.some(v => v !== '')) rows.push(row);
  }
  return { rows, usedWords: real.length };
}

/** 一行词块 → 各区的子格文本数组（区内按 x 排序，正向间隙 > subCellTol 即新子格） */
function splitRegionCells(line: OcrWord[], regions: { x0: number; x1: number }[], subCellTol: number): string[][] {
  const byRegion: OcrWord[][] = regions.map(() => []);
  for (const w of line) {
    let best = -1, bestOverlap = 0;
    regions.forEach((r, i) => {
      const overlap = Math.min(w.x + w.w, r.x1) - Math.max(w.x, r.x0);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
    });
    if (best < 0 || bestOverlap <= 0) {
      // 零重叠（跨区溢出文本等）：归中心最近区
      const center = w.x + w.w / 2;
      let bestDist = Infinity;
      regions.forEach((r, i) => {
        const dist = Math.abs(center - (r.x0 + r.x1) / 2);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      best = best < 0 ? 0 : best;
    }
    byRegion[best].push(w);
  }
  return byRegion.map(ws => {
    const sorted = [...ws].sort((a, b) => a.x - b.x);
    const groups: OcrWord[][] = [];
    for (const w of sorted) {
      const last = groups[groups.length - 1];
      if (last) {
        const prev = last[last.length - 1];
        if (w.x - (prev.x + prev.w) <= subCellTol) { last.push(w); continue; }
      }
      groups.push([w]);
    }
    return groups.map(g => g.map(w => w.text).join(' '));
  });
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
