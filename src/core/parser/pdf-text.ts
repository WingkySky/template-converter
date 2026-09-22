// PDF 文本项几何重建：把 pdf.js 提取的带坐标文本项还原成二维表格（纯逻辑，无 pdf.js/DOM 依赖，可独立单测）。
// 阈值按两类真实业务 PDF 实测标定（2026-09）：身边云「服务结算明细」类 Word 表格（字号 9~13pt），
// 以及移步到岗「个税代征明细」类 Excel 密表（字号 5.4pt、16 列、开户行长名居中溢出单元格）：
//  1) 视觉行聚类用单链法：相邻文本项 y 差 ≤ 0.75×字号中位数 归同一行——垂直居中的单行表头
//     与上/下换行表头片段的 y 差约 0.55×行距，会并成一行，同列多段拼回原词（服务人员+姓名 →
//     服务人员姓名）；正文行距 ≥1.5×字号，不受影响。
//  2) 纯空白文本项只作「拼接胶水」，不参与 x 区间/间隙计算——导出器会把这类项写成巨大宽度
//     （实测 w 达 14433），按矩形参与计算会跨列粘连。
//  3) 行内细粒度分格（宁可细分，靠列带归位）：
//     - 正向间隙 ≤ 0.6×字号 → 同格（格内空格排版，如卡号 6217 0018…；实测 ≈0.5×字号，
//       而最小列间隙 ≥1.5×字号）；
//     - 跨行片段（|Δy| > 行距容差，上下两半）→ 直接拼接不留空格；
//     - 同行但与当前格有任何重叠（gap < 0，如居中溢出的长开户行名左压 0.38~5.77pt）→ 判为邻列新格，
//       不得并入（真实案例：15113488208 与溢出的开户行名物理重叠）。
//  4) 列带构建（列结构以此为准）：只用「稠密行」（格数 ≥ 0.75×最大格数，防标题/附表污染）
//     的细格聚类成带。合并判据（两者之一）：显著重叠 ≥ 0.5×较窄者宽度（同列表头/数据、
//     居中溢出文本）；或正向小间隙 ≤ 0.6×字号（同格碎片）。其余一律新带——贪婪链式
//     `x0 ≤ 前带.x1` 会被单个溢出格把相邻两条列带熔接（真实案例：手机号码+开户行全列粘连），
//     严禁使用。建完再做相邻带两两合并的后处理，兜住「先遇到的格窄、后遇到的格把它整个
//     包含」的次序问题（如居中表头 vs 更宽的数据格）。
//  5) 归带：每格按最大重叠归带，零重叠取中心最近带；同带多段按 x 序以空格连接后再做
//     「纯数字+空白去空白」（卡号/证件号被空格排版的情况）——去空白必须在拼接之后，
//     细分格阶段数字组是独立小格。
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

/** 折叠空白；「纯数字+空白」且去空格后 ≥10 位的视为卡号/证件号排版，去掉内部空白 */
function normalizeCellText(text: string): string {
  let t = text.replace(/[\u200B\u200C\u200D]/g, '').replace(/\s+/g, ' ').trim();
  if (/^\d[\d\s]*$/.test(t) && t.replace(/\s/g, '').length >= 10) {
    t = t.replace(/\s/g, '');
  }
  return t;
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
  const lineTol = 0.75 * mh;          // 视觉行 y 容差（也是跨行片段的 |Δy| 门槛）
  const fineTol = 0.75 * mh;          // 同格正向 x 间隙阈值

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

  // 3) 行内细粒度分格
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
      const stacked = !!cell && Math.abs(cell.lastY - it.y) > lineTol; // 上下两半的换行片段
      const gap = cell ? it.x - cell.x1 : Infinity;
      // 跨行片段只免除「重叠分格」一条（同列上下两半允许深重叠）；
      // 正向间隙过大、或与当前格有任何重叠（gap<0）的同行项都是邻列——真实 PDF 中
      // 同行同格的相邻项间隙恒为正（卡号空格组/标题小间隙），负间隙只出现在居中溢出
      // 的邻列文本（冠迪案例：银行名左压手机号格 0.38~5.77pt），零容忍
      if (!cell || gap > fineTol || (!stacked && gap < 0)) {
        cell = { parts: [it.str], pendingSpace: false, lastY: it.y, x0: it.x, x1: it.x + it.w };
        cells.push(cell);
        continue;
      }
      if (stacked) {
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
  const denseMin = Math.max(2, maxCells * 0.75);
  let bandSource = linesOfCells.filter(cells => cells.length >= denseMin);
  if (!bandSource.length) bandSource = linesOfCells.filter(cells => cells.length >= Math.max(2, maxCells * 0.5));
  if (!bandSource.length) bandSource = linesOfCells;
  const bands: { x0: number; x1: number }[] = [];
  const bandWidth = (b: { x0: number; x1: number }) => b.x1 - b.x0;
  // 合并判据：显著重叠（同列）或正向小间隙（同格碎片）
  const shouldFuse = (a: { x0: number; x1: number }, b: { x0: number; x1: number }): boolean => {
    const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    if (overlap >= 0.5 * Math.min(bandWidth(a), bandWidth(b))) return true;
    const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
    return gap > 0 && gap <= fineTol;
  };
  for (const cell of bandSource.flat().slice().sort((a, b) => a.x0 - b.x0)) {
    // 找重叠最大的带；没有则找可桥接（正向小间隙）的带；都没有才开新带
    let best = -1, bestOverlap = 0;
    bands.forEach((band, i) => {
      const overlap = Math.min(cell.x1, band.x1) - Math.max(cell.x0, band.x0);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
    });
    if (best >= 0 && bestOverlap >= 0.5 * Math.min(bandWidth(bands[best]), cell.x1 - cell.x0)) {
      bands[best].x0 = Math.min(bands[best].x0, cell.x0);
      bands[best].x1 = Math.max(bands[best].x1, cell.x1);
      continue;
    }
    let bridge = -1, bridgeGap = Infinity;
    bands.forEach((band, i) => {
      const gap = cell.x0 - band.x1;
      if (gap > 0 && gap <= fineTol && gap < bridgeGap) { bridgeGap = gap; bridge = i; }
    });
    if (bridge >= 0) {
      bands[bridge].x1 = Math.max(bands[bridge].x1, cell.x1);
      continue;
    }
    bands.push({ x0: cell.x0, x1: cell.x1 });
  }
  // 后处理：相邻带两两合并直到收敛（兜住次序问题，如居中表头格晚于更宽的数据格出现）
  let fused = true;
  while (fused) {
    fused = false;
    for (let i = 0; i < bands.length - 1; i++) {
      if (shouldFuse(bands[i], bands[i + 1])) {
        bands[i].x1 = Math.max(bands[i].x1, bands[i + 1].x1);
        bands[i].x0 = Math.min(bands[i].x0, bands[i + 1].x0);
        bands.splice(i + 1, 1);
        fused = true;
      }
    }
  }

  // 5) 逐行归带 → 矩阵（同带多段以空格连接后统一做数字去空白）
  const rows: Rows = [];
  for (const cells of linesOfCells) {
    const columns: string[][] = bands.map(() => []);
    for (const cell of cells) {
      const text = cell.parts.join('').replace(/[\u200B\u200C\u200D]/g, '').replace(/\s+/g, ' ').trim();
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
    const row = columns.map(pieces => normalizeCellText(pieces.join(' ')));
    if (row.some(v => v !== '')) rows.push(row);
  }
  return rows;
}
