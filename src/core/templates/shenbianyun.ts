// 模版：身边云 —— 自 src/templates.ts（元数据）与 legacy.js 的 buildShenbianyunWorkbook
// 包装（读 state.sbyShowBatchInfo/sbyPlainAmount → 改经 ctx.options 传入）与
// getExportFileNameForTemplate（命名分支）收敛而来（阶段 4 模版注册表）。
// buildFileName 不含 .${ext} 后缀（后缀由 registry.buildFileNameForTemplate 统一追加）。
import { buildShenbianyunWorkbookCore } from '../export/builders';
import { getTodayStr } from '../export/naming';
import type { TemplateDefinition } from './registry';

const name = '身边云';

export const shenbianyunTemplate: TemplateDefinition = {
  key: 'shenbianyun',
  name,
  icon: '☁️',
  desc: '付款模版（保留说明行、批次信息行和表头）',
  headers: ['商户订单号（非必填）', '收款人姓名（必填）', '身份证号（必填）', '个人银行卡号（必填）', '付款金额（元，必填）', '手机号（必填）', '备注（非必填）', '自定义备注（非必填）'],
  fieldMap: { name: '收款人姓名（必填）', idCard: '身份证号（必填）', bankCard: '个人银行卡号（必填）', amount: '付款金额（元，必填）', phone: '手机号（必填）', note: '备注（非必填）' },
  async buildWorkbook(ctx) {
    return buildShenbianyunWorkbookCore(ctx.headers, ctx.rows, ctx.batchNo, {
      showBatchInfo: ctx.options.showBatchInfo,
      plainAmount: ctx.options.plainAmount,
    });
  },
  buildFileName(ctx) {
    if (ctx.batchNo) return `${ctx.batchNo}_${name}`;
    return `${name}_转换结果_${getTodayStr()}`;
  },
  supportsSplit: true,
  supportsBatchNo: true,
};
