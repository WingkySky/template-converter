// 模版：自定义 —— 自 src/templates.ts（元数据）与 legacy.js buildWorkbookForTemplate 的
// 通用兜底分支（buildGenericWorkbook）与 getExportFileNameForTemplate（custom 特判名
// 「自定义」——注意文件名用的是它而非卡片名「自定义模版」）收敛而来（阶段 4 模版注册表）。
// 动态列映射（showCustomMappingUI/genCustom）留在 ui/steps/export.ts，不进 core。
// buildFileName 不含 .${ext} 后缀（后缀由 registry.buildFileNameForTemplate 统一追加）。
import { buildGenericWorkbook } from '../export/builders';
import { getTodayStr } from '../export/naming';
import type { TemplateDefinition } from './registry';

// 原导出文件名对 custom 的显示名特判（legacy: templateKey === 'custom' ? '自定义' : TEMPLATES[key].name）
const FILE_NAME = '自定义';

export const customTemplate: TemplateDefinition = {
  key: 'custom',
  name: '自定义模版',
  icon: '✏️',
  desc: '自由定义列名和顺序',
  headers: [],
  fieldMap: {},
  async buildWorkbook(ctx) {
    return buildGenericWorkbook(ctx.headers, ctx.rows);
  },
  buildFileName() {
    return `${FILE_NAME}_转换结果_${getTodayStr()}`;
  },
  supportsSplit: true,   // 跟随通用拆分导出
  supportsBatchNo: false,
};
