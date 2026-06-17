const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '2026年6月服务结算汇总表（佛山分公司）-对外给云杉.xlsx');
const wb = XLSX.readFile(filePath);

console.log('Sheet names:', wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  console.log(`\n=== Sheet: ${sheetName} ===`);
  console.log(`Total rows: ${rows.length}`);
  console.log('\n--- First 10 rows ---`);
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    console.log(`Row ${i}:`, JSON.stringify(rows[i]));
  }
  // Also show merges if any
  if (ws['!merges']) {
    console.log('\n--- Merges ---');
    console.log(JSON.stringify(ws['!merges']));
  }
}
