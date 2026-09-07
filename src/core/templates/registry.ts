// 模版注册表（设计文档 5.1）—— 四个目标模版收敛为统一 TemplateDefinition，
// buildWorkbookForTemplate / buildFileNameForTemplate 查表分发，主流程不再含模版特判分支；
// 新增平台模版 = 新增一个模版文件 + 在 TEMPLATES 注册一行。
// buildFileName 返回不含扩展名的文件名主体，扩展名由 buildFileNameForTemplate 统一追加
// （原 getExportFileNameForTemplate：批次号存在 → `${batchNo}_${name}.${ext}`，
//   否则 → `${name}_转换结果_${getTodayStr()}.${ext}`）。
import type { Rows, OutputRowMeta } from '../../types';
import type { KB } from '../kb/model';
import type { WorkbookLike } from '../export/zip';
import { yidaoTemplate } from './yidao';
import { shenbianyunTemplate } from './shenbianyun';
import { youyiTemplate } from './youyi';
import { customTemplate } from './custom';

/** 模版构建上下文（调用方从 state 构造；core 不读 state） */
export interface TemplateContext {
  headers: string[];
  rows: Rows;
  meta: OutputRowMeta[];
  batchNo: string;
  kb: KB;
  options: { showBatchInfo: boolean; plainAmount: boolean };
  templateFile?: ArrayBuffer | Uint8Array;
}

/** 单个目标模版的注册表条目 */
export interface TemplateDefinition {
  key: string;
  name: string;
  icon: string;
  desc: string;
  headers: string[];
  fieldMap: Record<string, string>;
  buildWorkbook(ctx: TemplateContext): Promise<WorkbookLike>;
  buildFileName(ctx: TemplateContext): string;
  supportsSplit: boolean;          // custom 为 true（跟随通用拆分）
  supportsBatchNo: boolean;        // yidao/shenbianyun true，youyi/custom false
}

// 模版注册表（key 顺序即模版选择卡片的展示顺序，与原 TEMPLATES 一致）
export const TEMPLATES: Record<string, TemplateDefinition> = {
  yidao: yidaoTemplate,
  shenbianyun: shenbianyunTemplate,
  youyi: youyiTemplate,
  custom: customTemplate,
};

/** 按 key 查模版定义 */
export function getTemplate(key: string): TemplateDefinition {
  return TEMPLATES[key];
}

/** 查表分发：构建目标模版工作簿 */
export async function buildWorkbookForTemplate(key: string, ctx: TemplateContext): Promise<WorkbookLike> {
  return getTemplate(key).buildWorkbook(ctx);
}

/** 查表分发：目标模版导出文件名（ext 为不带点的扩展名） */
export function buildFileNameForTemplate(key: string, ext: string, ctx: TemplateContext): string {
  return `${getTemplate(key).buildFileName(ctx)}.${ext}`;
}
