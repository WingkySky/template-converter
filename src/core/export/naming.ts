// 导出文件命名 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 C），仅补充类型注解，不改变任何行为。
// 位置锚点：getTodayStr legacy.js L3089。
// getExportFileName / getExportFileNameForTemplate / getBatchNoForTemplate 读写
// state/TEMPLATES，留在 legacy.js 不搬（阶段 4 收敛进模版注册表）。

export function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
