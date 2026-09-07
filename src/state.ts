// 全局应用状态：单一可变对象（设计文档 5.2）。
// core 模块禁止 import 本文件；ui/io 模块可自由读写。
export const DEFAULT_PREVIEW_ROW_LIMIT = 8;
export const PREVIEW_ROW_INCREMENT = 20;

export const state = {
  sources: [],
  previewSourceId: '',
  pendingFiles: 0,
  accumFileCount: 0,
  mappingState: null,
  targetTemplate: null,
  selectedTemplates: [],
  templateOutputs: {},
  customFields: [],
  outputRows: null,
  outputHeaders: null,
  outputRowMeta: [],
  selectedNoteRows: [],
  previewRowLimit: DEFAULT_PREVIEW_ROW_LIMIT,
  batchNo: '',
  batchShangSheId: '',
  batchShangSheName: '',
  cleanCount: 0,
  // Template file data (ArrayBuffer) for preservation-based export
  templateFiles: {},
  // 知识库匹配状态：记录哪些输出行未匹配到知识库
  unmatchedRows: [],
  // 缩小范围的候选商社（供手动选择器使用）
  shangSheCandidates: [],
  // 商社全量列表（供搜索下拉框使用）
  shangSheFullList: [],
  // 平台全量列表（供搜索下拉框使用）
  platformFullList: [],
  // 记住上次保存文件的目录（File System Access API 句柄，见 vite-env.d.ts）
  lastSaveDir: null as FileSystemFileHandleLike | null,
  // 列索引常量，由 showExportStep() 动态计算
  colIndex: {},
  // 列筛选状态：{ colIdx: Set(允许的值) }
  columnFilters: {},
  // 身边云导出选项
  sbyShowBatchInfo: false,   // 是否显示总笔数和总金额行（默认不显示）
  sbyPlainAmount: true,      // 金额使用纯数字格式（默认纯数字，不带¥符号）
  // 导出模式: 'merge' 合并为一份 | 'byFile' 按文件拆分 | 'bySheet' 按数据表拆分
  exportMode: 'merge',
  // 拆分模式下每份的商社/批次号: { [groupKey]: { batchNo, shangSheId, shangSheName } }
  splitBatches: {},
  // 渲染拆分批次面板时暂存的分组列表（供下拉框回调定位分组）
  splitGroupList: [],
};
