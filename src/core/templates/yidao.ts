// 模版：移步到岗 —— 自 src/templates.ts（元数据）与 legacy.js buildWorkbookForTemplate/
// getExportFileNameForTemplate（构建/命名分支）收敛而来（阶段 4 模版注册表）。
// 行为保真说明：
//  - buildWorkbook 即原 buildYidaoWorkbook(headers, rows)（core/export/builders）；
//  - buildFileName 即原 getExportFileNameForTemplate 的 yidao 分支（不含 .${ext} 后缀，
//    后缀由 registry.buildFileNameForTemplate 统一追加）：
//    批次号存在 → `${batchNo}_${name}`，否则 `${name}_转换结果_${getTodayStr()}`。
import { buildYidaoWorkbook } from '../export/builders';
import { getTodayStr } from '../export/naming';
import type { TemplateDefinition } from './registry';

const name = '移步到岗';

export const yidaoTemplate: TemplateDefinition = {
  key: 'yidao',
  name,
  icon: '🚀',
  desc: '简洁模版，6列核心信息（保留模版结构）',
  headers: ['姓名', '身份证', '手机号', '开户银行', '银行卡号', '税前金额'],
  fieldMap: { name: '姓名', idCard: '身份证', phone: '手机号', bankName: '开户银行', bankCard: '银行卡号', amount: '税前金额' },
  async buildWorkbook(ctx) {
    return buildYidaoWorkbook(ctx.headers, ctx.rows);
  },
  buildFileName(ctx) {
    if (ctx.batchNo) return `${ctx.batchNo}_${name}`;
    return `${name}_转换结果_${getTodayStr()}`;
  },
  supportsSplit: true,
  supportsBatchNo: true,
};
