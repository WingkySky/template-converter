// CSV 解析与编码乱码检测 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），
// 仅补充类型注解，不改变任何行为。
import type { Rows } from '../../types';

export function parseCSV(text: string): Rows {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // 检查是否为转义双引号 ""
        if (i + 1 < text.length && text[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          // 结束引号
          inQuotes = false;
          i++;
        }
      } else {
        cell += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
        i++;
      } else if (ch === '\r') {
        // 处理 \r\n 或 \r
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
        i++;
        if (i < text.length && text[i] === '\n') i++;
      } else if (ch === '\n') {
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        cell += ch;
        i++;
      }
    }
  }

  // 处理最后一行（无换行结尾）
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // 过滤空行
  return rows.filter(row => row.some(cell => cell !== ''));
}

export function isGarbled(text: string): boolean {
  if (/[\uFFFD]{2,}/.test(text)) return true;
  let s = 0;
  for (let i = 0; i < Math.min(text.length, 500); i++) {
    const c = text.charCodeAt(i);
    if (c > 255 && !(c >= 0x4E00 && c <= 0x9FFF) && !(c >= 0x3000 && c <= 0x303F)) s++;
  }
  return s > 10;
}
