// 调试工具：全量 dump 一个 xlsx 的结构与内容（表名/合并/列宽/逐格值与样式）。
// 用途：平台导入模板改版时与官方模板文件逐项比对（参考 2026-09 身边云批量付款模板同步）。
// 用法：npx tsx tests/tools/dump-template.mts <xlsx 路径>
import { readFileSync, copyFileSync, rmSync } from 'node:fs';
import ExcelJS from 'exceljs';

const src = process.argv[2];
if (!src) { console.error('usage: tsx dump-template.mts <xlsx>'); process.exit(1); }
// Windows 中文路径防编码坑：先拷到 ASCII 临时名再读
const tmp = 'D:/template-converter/tests/tools/.tmp-dump.xlsx';
copyFileSync(src, tmp);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(tmp);
rmSync(tmp);

for (const ws of wb.worksheets) {
  console.log(`\n===== sheet: "${ws.name}" (state=${ws.state}) rowCount=${ws.rowCount} colCount=${ws.columnCount} =====`);
  console.log('merges:', JSON.stringify(ws.model.merges ?? []));
  const widths: string[] = [];
  ws.columns?.forEach((c, i) => widths.push(`${i + 1}:${c.width}`));
  console.log('colWidths:', widths.join(' '));
  const used: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, cn) => {
      let v: unknown = cell.value;
      if (v && typeof v === 'object') {
        const o = v as { richText?: { text: string }[]; result?: unknown };
        if (o.richText) v = o.richText.map(t => t.text).join('');
        else if (o.result !== undefined) v = o.result;
        else v = JSON.stringify(v);
      }
      const st = cell.style as {
        font?: { name?: string; size?: number; bold?: boolean; color?: { argb?: string } };
        fill?: { type?: string; fgColor?: { argb?: string } };
      };
      const stBits: string[] = [];
      if (st.font) stBits.push(`font=${st.font.name || ''}/${st.font.size || ''}/${st.font.color?.argb || ''}/bold=${!!st.font.bold}`);
      if (st.fill?.type === 'pattern' && st.fill.fgColor) stBits.push(`fill=${st.fill.fgColor.argb}`);
      if (cell.numFmt && cell.numFmt !== 'General') stBits.push(`numFmt=${cell.numFmt}`);
      cells.push(`[${cn}]=${JSON.stringify(v)}${stBits.length ? ' {' + stBits.join(' ') + '}' : ''}`);
    });
    if (cells.length) used.push(`r${rn}(h=${row.height}): ` + cells.join(' | '));
  });
  console.log(used.join('\n'));
}
