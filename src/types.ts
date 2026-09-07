// 共享领域类型：由主智能体维护（阶段 1 期间子智能体只读引用，需要的类型
// 缺失时在交付说明里列出，由主智能体统一补充）。

/** Excel 单元格（sheet_to_json raw:false 后为字符串，raw 读取可能出现数字/布尔） */
export type Cell = string | number | boolean | null | undefined;

/** 一行数据 */
export type Row = Cell[];

/** 二维表格数据 */
export type Rows = Row[];

/** 列类型标识（COL_TYPE_LABELS 的键） */
export type ColType =
  | 'name' | 'idCard' | 'phone' | 'bankName' | 'bankCard' | 'amount'
  | 'gender' | 'bankLocation' | 'taxSource' | 'note' | 'clientName' | 'taxId'
  | string;

/** 单列的识别结果 */
export interface ColumnInfo {
  type: ColType | null;
  header: string;
  samples: string[];
}

/** 按列索引（字符串键）组织的列识别结果 */
export interface ColumnTypeMap {
  [colIdx: string]: ColumnInfo;
}

/** detectColumnMapping 的返回 */
export interface AutoMap {
  cols: ColumnTypeMap;
  amountCol: number | null;
  nameCol: number | null;
}

/** analyzeSheet 的返回（数据源分析结果） */
export interface SheetAnalysis {
  sheetName: string;
  rows: Rows;
  score: number;
  dataRowsCount: number;
  headerRowIndex: number;
  autoMap: AutoMap;
  filteredCount?: number;
}

/** 数据源条目（state.sources 的元素） */
export interface SourceItem {
  id: string;
  type: 'csv' | 'excel-sheet' | string;
  fileName: string;
  sheetName: string;
  rows: Rows;
  selected: boolean;
  analysis: SheetAnalysis | null;
}

/** 知识库商社条目（shangSheMap 的值） */
export interface ShangSheEntry {
  id: string;
  shortName?: string;
  fullName?: string;
  businessType1?: string;
  businessType2?: string;
  taxId?: string;
  rate?: string;
  signEntity?: string;
  tasks?: { name: string; content: string }[];
  [k: string]: unknown;
}

/** 知识库整体结构 */
export interface KB {
  shangSheMap: Record<string, ShangSheEntry>;
  configData: { taxSources: string[]; platforms: string[] };
  taskListData: unknown[];
  lastUpdated: string | null;
  schemaVersion?: number;
}
