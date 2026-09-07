// 工作簿/工作表解析与评分 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），
// 仅补充类型注解与显式 import/export（原代码读全局 XLSX，改为模块导入），不改变任何行为。
import * as XLSX from 'xlsx';
import type { Row, Rows } from '../../types';
import { buildSourceItem } from './source-item';
import type { SourceItemData } from './source-item';
import { smartDetectTable } from './table-detect';
import { detectColumnMapping } from '../mapping/column-detect';
import type { ColumnMapping } from '../mapping/column-detect';
import { isAmountLikeNumber } from '../mapping/amount-score';

/** analyzeSheet 的返回（数据源分析结果） */
export interface SheetAnalysis {
  sheetName: string;
  rows: Rows;
  score: number;
  dataRowsCount: number;
  headerRowIndex: number;
  autoMap: ColumnMapping;
  filteredCount?: number;
}

export function analyzeWorkbookSheets(wb: XLSX.WorkBook, fileName: string): SourceItemData[] {
  let monthHint = '', yearHint = '';
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: false }).slice(0, 20);
    for (const row of rows) {
      for (const cell of row || []) {
        const t = String(cell || '').trim();
        if (!t) continue;
        if (!yearHint) { const m = t.match(/(20\d{2})/); if (m) yearHint = m[1]; }
        if (!monthHint) {
          const m2 = t.match(/(?:^|[^\d])(20\d{2}\s*年\s*\d{1,2}\s*月)/) || t.match(/(?:^|[^\d])(20\d{2}[-\/.]\d{1,2})/);
          if (m2) monthHint = m2[1];
        }
      }
    }
  }

  const analyzed = wb.SheetNames.map(sn => {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: false });
    return analyzeSheet(sn, rows, monthHint, yearHint);
  }).filter(item => item.rows.length > 0);

  if (!analyzed.length) return [];
  analyzed.sort((a, b) => b.score - a.score);
  const topScore = analyzed[0].score;
  let selected = analyzed.filter(item =>
    item.score >= 30 && item.dataRowsCount >= 1 && item.score >= topScore - 15 &&
    !/(汇总|总表|说明|模板|图表|透视|summary|chart|cover|封面|配置表|任务清单)/i.test(item.sheetName)
  );
  if (!selected.length) selected = [analyzed[0]];
  const selNames = new Set(selected.map(item => item.sheetName));

  return analyzed.map(item => buildSourceItem({
    type: 'excel-sheet', fileName, sheetName: item.sheetName,
    rows: item.rows, selected: selNames.has(item.sheetName), analysis: item
  }));
}

export function analyzeSheet(sheetName: string, rows: Rows, monthHint: string, yearHint: string): SheetAnalysis {
  const nonEmpty = (rows || []).filter(row => row.some(cell => String(cell || '').trim() !== ''));
  if (!nonEmpty.length) return { sheetName, rows: [], score: -999, dataRowsCount: 0, headerRowIndex: 0, autoMap: { cols: {} } };

  const { headerRow, headerRowIndex, dataRows, filteredCount } = smartDetectTable(nonEmpty);
  const autoMap: ColumnMapping = detectColumnMapping(headerRow, dataRows);

  let headerScore = 0;
  Object.values(autoMap.cols || {}).forEach(col => {
    if (col.type === 'amount') headerScore += 25;
    else if (col.type === 'name') headerScore += 20;
    else if (col.type) headerScore += 10;
  });

  const reverseMap: Record<string, number | undefined> = {};
  Object.entries(autoMap.cols || {}).forEach(([ci, col]) => {
    if (col.type && reverseMap[col.type] == null) reverseMap[col.type] = Number(ci);
  });
  autoMap.amountCol = reverseMap.amount;
  autoMap.nameCol = reverseMap.name;

  let dataScore = 0;
  const sample = dataRows.slice(0, 50);
  if (sample.length >= 3) dataScore += 8;
  let amtHits = 0, idHits = 0;
  sample.forEach(row => {
    if (autoMap.amountCol != null && isAmountLikeNumber(row?.[autoMap.amountCol])) amtHits++;
    if (autoMap.nameCol != null && String(row?.[autoMap.nameCol] || '').trim()) idHits++;
  });
  dataScore += Math.round((amtHits / Math.max(sample.length, 1)) * 18);
  dataScore += Math.round((idHits / Math.max(sample.length, 1)) * 12);

  let nameScore = 0;
  if (/(费用明细|工资|报酬|劳务|发放|明细)/i.test(sheetName)) nameScore += 8;
  if (/(汇总|总表|配置|任务)/i.test(sheetName)) nameScore -= 12;

  return {
    sheetName, rows: nonEmpty, score: headerScore + dataScore + nameScore,
    dataRowsCount: dataRows.length, headerRowIndex, autoMap, filteredCount: filteredCount || 0
  };
}
