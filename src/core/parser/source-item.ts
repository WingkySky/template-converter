// 数据源条目构造 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），仅补充类型注解。
// 独立小模块：只依赖类型，不含解析逻辑，避免 excel.ts ↔ file-orchestrator 循环依赖。
import type { Rows } from '../../types';
import type { SheetAnalysis } from './excel';

/** 数据源条目（legacy 中 state.sources 的元素形状） */
export interface SourceItemData {
  id: string;
  type: string;
  fileName: string;
  sheetName: string;
  rows: Rows;
  selected: boolean;
  analysis: SheetAnalysis | null;
}

export interface BuildSourceItemParams {
  type: string;
  fileName: string;
  sheetName?: string;
  rows?: Rows;
  selected?: boolean;
  analysis?: SheetAnalysis | null;
}

export function buildSourceItem({ type, fileName, sheetName = '', rows = [], selected = true, analysis = null }: BuildSourceItemParams): SourceItemData {
  return {
    id: `${type}:${fileName}:${sheetName || 'default'}:${Math.random().toString(36).slice(2, 8)}`,
    type, fileName, sheetName, rows, selected, analysis
  };
}
