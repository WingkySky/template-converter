// PDF 文本项几何重建：把 pdf.js 提取的带坐标文本项还原成二维表格（纯逻辑，无 pdf.js/DOM 依赖，可独立单测）。
// 阈值按身边云「服务结算明细」类 Word 表格 PDF 实测标定（2026-09，字号 9~13pt）：
//  1) 视觉行聚类用单链法：相邻文本项 y 差 ≤ 0.75×字号中位数 归同一行——垂直居中的
//     单行表头与上/下换行表头片段的 y 差约 0.55×行距，会并成一行，同列多段拼回原词
//     （服务人员+姓名 → 服务人员姓名）；正文行距 ≥1.5×字号，不受影响。
//  2) 纯空白文本项只作「拼接胶水」，不参与 x 区间/间隙计算——导出器会把这类项写成
//     巨大宽度（实测 w 达 14433），按矩形参与计算会跨列粘连。
//  3) 同一视觉行内相邻文本项 x 间隙 ≤ max(7, 字号中位数) 判为同格：实测格内空格间隙
//     ≈0.5×字号（卡号 6217 0018…），列间隙 ≥2×字号；跨行片段（Δy>行距容差）直接
//     拼接不留空格，同行片段经胶水以空格衔接。
//  4) 列对齐用全页 x 区间聚类，但只有「稠密行」（格数 ≥ 0.6×最大格数）参与建带，
//     防止标题等跨列长文本把相邻列带粘连；每格按最大重叠归带，零重叠取中心最近带。
//  5) 「纯数字+空白」格去除内部空白（卡号/证件号被空格排版的情况），其余格保留原空格。
import type { Rows } from '../../types';

/** pdf.js 文本项的极简几何投影（x/y 为页面用户空间坐标，y 轴向上） */
export interface PdfTextItem {
  str: string;
  /** 左端 x（transform[4]） */
  x: number;
  /** 基线 y（transform[5]） */
  y: number;
  /** 宽度（item.width） */
  w: number;
  /** 字号近似高（item.height） */
  h: number;
}

/** 行内分格阶段的草稿格：文本片段 + x 区间 + 拼接状态 */
interface CellDraft {
  parts: string[];
  pendingSpace: boolean;
  lastY: number;
  x0: number;
  x1: number;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 折叠空白并规整格文本；纯数字+空白且去空格后 ≥10 位的视为卡号/证件号排版，去掉内部空白 */
function finalizeCell(cell: CellDraft): string {
  // \s 已含 NBSP/全角空格/BOM/各类 Unicode 空白；\u200B-\u200D 零宽字符单独剔除
  let text = cell.parts.join('').replace(/[\u200B\u200C\u200D]/g, '').replace(/\s+/g, ' ').trim();
  if (/^\d[\d\s]*$/.test(text) && text.replace(/\s/g, '').length >= 10) {
    text = text.replace(/\s/g, '');
  }
  return text;
}

export function pdfTextItemsToRows(items: PdfTextItem[]): Rows {
  // 1) 分离实体项与空白胶水项（全空串项丢弃）
  const real: PdfTextItem[] = [];
  const glue: PdfTextItem[] = [];
  for (const it of items) {
    if (!it.str) continue;
    if (!it.str.trim()) { glue.push(it); continue; }
    real.push(it);
  }
  if (!real.length) return [];

  const mh = median(real.map(it => (it.h > 0 ? it.h : 10)));
  const lineTol = 0.75 * mh;        // 视觉行 y 容差
  const gapTol = Math.max(7, mh);   // 同格 x 间隙阈值

  // 2) 视觉行聚类（单链：相邻项 y 差 ≤ lineTol 即同行；同 y 按 x 升序）
  const all = [...real, ...glue].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines: PdfTextItem[][] = [];
  let line: PdfTextItem[] = [];
  let lastY = NaN;
  for (const it of all) {
    if (line.length && lastY - it.y > lineTol) { lines.push(line); line = []; }
    line.push(it);
    lastY = it.y;
  }
  if (line.length) lines.push(line);

  // 3) 行内分格
  const linesOfCells: CellDraft[][] = lines.map(items2 => {
    const sorted = [...items2].sort((a, b) => (a.x - b.x) || (b.y - a.y));
    const cells: CellDraft[] = [];
    let cell: CellDraft | null = null;
    for (const it of sorted) {
      if (!it.str.trim()) {
        // 空白胶水：只挂到当前格，不扩区间（宽度不可信）
        if (cell) cell.pendingSpace = true;
        continue;
      }
      if (!cell || it.x - cell.x1 > gapTol) {
        cell = { parts: [it.str], pendingSpace: false, lastY: it.y, x0: it.x, x1: it.x + it.w };
        cells.push(cell);
        continue;
      }
      // 间隙足够近 → 同格；跨行片段（Δy>lineTol）直接连接并丢弃待拼空格
      if (cell.lastY - it.y > lineTol) {
        cell.pendingSpace = false;
      } else if (cell.pendingSpace) {
        cell.parts.push(' ');
        cell.pendingSpace = false;
      }
      cell.parts.push(it.str);
      cell.lastY = it.y;
      cell.x0 = Math.min(cell.x0, it.x);
      cell.x1 = Math.max(cell.x1, it.x + it.w);
    }
    return cells;
  });

  // 4) 全页列带：只用稠密行建带
  const maxCells = Math.max(...linesOfCells.map(cells => cells.length));
  const denseLines = linesOfCells.filter(cells => cells.length >= Math.max(2, maxCells * 0.6));
  const bandSource = denseLines.length ? denseLines : linesOfCells;
  const bands: { x0: number; x1: number }[] = [];
  for (const cell of bandSource.flat().slice().sort((a, b) => a.x0 - b.x0)) {
    const last = bands[bands.length - 1];
    if (last && cell.x0 <= last.x1) last.x1 = Math.max(last.x1, cell.x1);
    else bands.push({ x0: cell.x0, x1: cell.x1 });
  }

  // 5) 逐行归带 → 矩阵
  const rows: Rows = [];
  for (const cells of linesOfCells) {
    const columns: string[][] = bands.map(() => []);
    for (const cell of cells) {
      const text = finalizeCell(cell);
      if (!text) continue;
      let best = 0, bestOverlap = -Infinity;
      bands.forEach((band, i) => {
        const overlap = Math.min(cell.x1, band.x1) - Math.max(cell.x0, band.x0);
        if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
      });
      if (bestOverlap <= 0) {
        // 零重叠：取中心最近带
        const center = (cell.x0 + cell.x1) / 2;
        let bestDist = Infinity;
        bands.forEach((band, i) => {
          const dist = Math.abs(center - (band.x0 + band.x1) / 2);
          if (dist < bestDist) { bestDist = dist; best = i; }
        });
      }
      columns[best].push(text);
    }
    const row = columns.map(pieces => pieces.join(' '));
    if (row.some(v => v !== '')) rows.push(row);
  }
  return rows;
}
