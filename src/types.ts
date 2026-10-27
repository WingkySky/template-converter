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

/** 单列的识别结果（type 与 core/mapping/column-detect 的 DetectedColumn 对齐：string，空串表示未识别） */
export interface ColumnInfo {
  type: string | null;
  header: string;
  samples: string[];
}

/** 按列索引（字符串键）组织的列识别结果 */
export interface ColumnTypeMap {
  [colIdx: string]: ColumnInfo;
}

/** detectColumnMapping 的返回（amountCol/nameCol 由 analyzeSheet 事后补写，故为可选） */
export interface AutoMap {
  cols: ColumnTypeMap;
  amountCol?: number | null;
  nameCol?: number | null;
}

/** 输出行元数据（generateOutput 产出的 outputRowMeta 元素；state.ts 的同名接口与此形状一致） */
export interface OutputRowMeta {
  fileName: string;
  sheetName: string;
  rawRow: unknown[];
  typeToCol: Record<string, number | null>;
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

/** 图片/扫描 PDF 源的识别元数据：不可变的引擎事实（校验问题渲染时现算，见 core/image/validate.ts） */
export interface OcrSourceMeta {
  engine: 'local' | 'llm';
  /** 词块置信度均值（0~100）；LLM 引擎为 null */
  meanConfidence: number | null;
  /** 引擎编排提示（如 auto 模式云端失败回落本地的原因），随校验横幅展示 */
  notice?: string;
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
  /** 图片/扫描 PDF 源的识别元数据（ocr-service 写入） */
  ocr?: OcrSourceMeta;
  /** 图片源的人工编辑覆盖：mapping 预览与 confirmMapping 统一优先取本字段
   * （直接改智能检测结果会被 confirmMapping 的重检测丢弃） */
  dataRowsOverride?: Rows;
  /** 用户对该源的手动列类型标注（含「不识别」空串），键为列索引字符串；
   *  与 dataRowsOverride 同级同寿命（会话内记忆，切预览源不丢） */
  userTypes?: Record<string, string>;
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
