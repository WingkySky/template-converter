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
  icon: 'cloud',
  desc: '付款模版（保留说明行、批次号行和表头）',
  // 2026-09 新版批量付款导入模板：新增「任务ID」列（源数据无对应字段，恒留空），
  // 「个人银行卡号（必填）」更名「收款账号（条件必填）」，总笔数/总金额字段下线。
  headers: ['商户订单号（非必填）', '任务ID（条件必填）', '收款人姓名（必填）', '身份证号（必填）', '收款账号（条件必填）', '付款金额（元，必填）', '手机号（必填）', '备注（非必填）', '自定义备注（非必填）'],
  fieldMap: { name: '收款人姓名（必填）', idCard: '身份证号（必填）', bankCard: '收款账号（条件必填）', amount: '付款金额（元，必填）', phone: '手机号（必填）', note: '备注（非必填）' },
  async buildWorkbook(ctx) {
    return buildShenbianyunWorkbookCore(ctx.headers, ctx.rows, ctx.batchNo, {
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
