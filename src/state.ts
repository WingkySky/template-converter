// 全局应用状态：单一可变对象（设计文档 5.2）+ AppState 接口。
// core 模块禁止 import 本文件；ui/io 模块可自由读写。
import type { Rows, SheetAnalysis, SourceItem } from './types';
import type { FileSystemFileHandleLike } from './vite-env-type';

export const DEFAULT_PREVIEW_ROW_LIMIT = 8;
export const PREVIEW_ROW_INCREMENT = 20;

/** 单个数据源的列映射（confirmMapping 后的 sourcesData 元素） */
export interface SourceDataEntry {
  dataRows: Rows;
  typeToCol: Record<string, number | null>;
  source: SourceItem;
}

/** 模版输出缓存（templateOutputs 的值） */
export interface TemplateOutputCache {
  outputHeaders: string[] | null;
  outputRows: Rows | null;
  outputRowMeta: OutputRowMeta[];
  batchNo?: string;
  sbyShowBatchInfo?: boolean;
  sbyPlainAmount?: boolean;
}

/** 输出行元数据（outputRowMeta 的元素） */
export interface OutputRowMeta {
  fileName: string;
  sheetName: string;
  rawRow: unknown[];
  typeToCol: Record<string, number | null>;
}

export interface AppState {
  sources: SourceItem[];
  previewSourceId: string;
  pendingFiles: number;
  accumFileCount: number;
  mappingState: null | {
    headerRow?: unknown[];
    headerRowIndex?: number;
    dataRows?: unknown[];
    mapping?: { cols: Record<string, { type?: string; header?: string; samples?: string[] }> };
    source?: SourceItem;
    filteredCount?: number;
    sourcesData?: SourceDataEntry[];
  };
  targetTemplate: string | null;
  selectedTemplates: string[];
  templateOutputs: Record<string, TemplateOutputCache>;
  customFields: string[];
  outputRows: Rows | null;
  outputHeaders: string[] | null;
  outputRowMeta: OutputRowMeta[];
  selectedNoteRows: number[];
  previewRowLimit: number;
  batchNo: string;
  batchShangSheId: string;
  batchShangSheName: string;
  cleanCount: number;
  templateFiles: Record<string, ArrayBuffer | Uint8Array>;
  unmatchedRows: unknown[];
  shangSheCandidates: { id: string; label: string; matchType?: string }[];
  shangSheFullList: { id: string; label: string; lookup?: unknown }[];
  platformFullList: unknown[];
  lastSaveDir: FileSystemFileHandleLike | null;
  colIndex: Record<string, number>;
  columnFilters: Record<string, Set<string>>;
  sbyShowBatchInfo: boolean;
  sbyPlainAmount: boolean;
  exportMode: 'merge' | 'byFile' | 'bySheet';
  splitBatches: Record<string, { batchNo: string; shangSheId: string; shangSheName: string }>;
  splitGroupList: { key: string; fileName: string; sheetName: string; count: number }[];
}

export const state = {
  sources: [] as SourceItem[],
  previewSourceId: '',
  pendingFiles: 0,
  accumFileCount: 0,
  mappingState: null as AppState['mappingState'],
  targetTemplate: null as string | null,
  selectedTemplates: [] as string[],
  templateOutputs: {} as AppState['templateOutputs'],
  customFields: [] as string[],
  outputRows: null as Rows | null,
  outputHeaders: null as string[] | null,
  outputRowMeta: [] as OutputRowMeta[],
  selectedNoteRows: [] as number[],
  previewRowLimit: DEFAULT_PREVIEW_ROW_LIMIT,
  batchNo: '',
  batchShangSheId: '',
  batchShangSheName: '',
  cleanCount: 0,
  // Template file data (ArrayBuffer) for preservation-based export
  templateFiles: {} as Record<string, ArrayBuffer | Uint8Array>,
  // 知识库匹配状态：记录哪些输出行未匹配到知识库
  unmatchedRows: [] as unknown[],
  // 缩小范围的候选商社（供手动选择器使用）
  shangSheCandidates: [] as AppState['shangSheCandidates'],
  // 商社全量列表（供搜索下拉框使用）
  shangSheFullList: [] as AppState['shangSheFullList'],
  // 平台全量列表（供搜索下拉框使用）
  platformFullList: [] as unknown[],
  // 记住上次保存文件的目录
  lastSaveDir: null as FileSystemFileHandleLike | null,
  // 列索引常量，由 showExportStep() 动态计算
  colIndex: {} as Record<string, number>,
  // 列筛选状态：{ colIdx: Set(允许的值) }
  columnFilters: {} as Record<string, Set<string>>,
  // 身边云导出选项
  sbyShowBatchInfo: false,   // 是否显示总笔数和总金额行（默认不显示）
  sbyPlainAmount: true,      // 金额使用纯数字格式（默认纯数字，不带¥符号）
  // 导出模式: 'merge' 合并为一份 | 'byFile' 按文件拆分 | 'bySheet' 按数据表拆分
  exportMode: 'merge' as AppState['exportMode'],
  // 拆分模式下每份的商社/批次号: { [groupKey]: { batchNo, shangSheId, shangSheName } }
  splitBatches: {} as AppState['splitBatches'],
  // 渲染拆分批次面板时暂存的分组列表（供下拉框回调定位分组）
  splitGroupList: [] as AppState['splitGroupList'],
} satisfies AppState;

export type { SheetAnalysis };
