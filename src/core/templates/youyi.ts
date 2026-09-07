// 模版：云杉公司 —— 自 src/templates.ts（元数据）与 legacy.js 的 buildYouyiWorkbook 包装
// （原直调 loadKB() → 改经 ctx.kb 传入）与 getExportFileNameForTemplate（命名分支，
// 云杉模版不参与批次号命名）收敛而来（阶段 4 模版注册表）。
// buildFileName 不含 .${ext} 后缀（后缀由 registry.buildFileNameForTemplate 统一追加）。
import { buildYouyiWorkbook } from '../export/builders';
import { generateConfigSheet, generateTaskListSheet } from '../kb/task';
import { getTodayStr } from '../export/naming';
import type { TemplateDefinition } from './registry';

const name = '云杉公司';

export const youyiTemplate: TemplateDefinition = {
  key: 'youyi',
  name,
  icon: '🤝',
  desc: '详细模版（保留配置表和任务清单）',
  headers: ['出错信息', '平台', '商社编号', '姓名', '身份证号码', '性别', '任务清单', '税源地', '工种', '手机号码', '账号', '银行名称', '银行所属地', '税前金额', '个税金额', '商业保险', '备注'],
  fieldMap: { name: '姓名', idCard: '身份证号码', gender: '性别', phone: '手机号码', bankCard: '账号', bankName: '银行名称', location: '银行所属地', amount: '税前金额', note: '备注', shangSheId: '商社编号' },
  async buildWorkbook(ctx) {
    // deps 的 generateConfigSheet/generateTaskListSheet 形参在 builders.ts 中标注为 types.KB，
    // 而实参为 core/kb/model 的 KB（运行时同源）——沿用 ui/legacy-bridge 的 as never 对齐
    return buildYouyiWorkbook(ctx.headers, ctx.rows, { kb: ctx.kb, generateConfigSheet, generateTaskListSheet } as never);
  },
  buildFileName() {
    return `${name}_转换结果_${getTodayStr()}`;
  },
  supportsSplit: true,
  supportsBatchNo: false,
};
