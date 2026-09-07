// CSV 序列化 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 C），仅补充类型注解，不改变任何行为。
// 位置锚点：rowsToCSV legacy.js L3421。
import type { Row, Rows } from '../../types';

export function rowsToCSV(headers: Row, rows: Rows): string {
  return [headers, ...rows].map(row =>
    row.map(cell => {
      const s = String(cell || '');
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')
  ).join('\n');
}
