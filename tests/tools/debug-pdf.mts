// 调试脚本（不入库）：用真实 PDF 走生产管线 parsePdfSource，验证几何重建与列映射
import { readFileSync } from 'node:fs';
import { parsePdfSource } from '../../src/core/parser/pdf';

const file = process.argv[2];
if (!file) { console.error('usage: tsx debug-pdf.mts <pdf>'); process.exit(1); }
const data = readFileSync(file);
const t0 = Date.now();
const items = await parsePdfSource(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), file.split(/[\\/]/).pop() ?? file);
console.log('elapsed ms:', Date.now() - t0);
const src = items[0];
console.log('type:', src.type, '| sheet:', src.sheetName, '| rows:', src.rows.length, '| dataRows:', src.analysis?.dataRowsCount ?? '-', '| headerRowIndex:', src.analysis?.headerRowIndex ?? '-', '| score:', src.analysis?.score ?? '-', '| filtered:', src.analysis?.filteredCount ?? '-');
console.log('---- 全部行 ----');
src.rows.forEach((r, i) => console.log(String(i).padStart(2), JSON.stringify(r)));
console.log('---- 自动映射 ----');
const am = src.analysis?.autoMap;
if (am) {
  Object.entries(am.cols).forEach(([ci, col]) => console.log(`col${ci}: [${col.type || '-'}] ${col.header} | samples: ${col.samples.join(' / ')}`));
  console.log('amountCol:', am.amountCol, 'nameCol:', am.nameCol);
}
