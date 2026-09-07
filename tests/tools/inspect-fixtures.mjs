// 一次性检查：样例文件结构（用 fs 读 buffer，绕开 xlsx 内部对中文路径的处理差异）
import { readFileSync, readdirSync } from 'node:fs';
import * as XLSX from 'xlsx';

const files = readdirSync('.').filter(f => f.endsWith('.xlsx'));
for (const f of files) {
  const wb = XLSX.read(readFileSync(f), { type: 'buffer' });
  console.log('===', f, '→ sheets:', wb.SheetNames.join(' | '));
  for (const sn of wb.SheetNames.slice(0, 4)) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false }).slice(0, 3);
    console.log('  [' + sn + ']', JSON.stringify(rows).slice(0, 260));
  }
}
