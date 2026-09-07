// 目标模版定义（自 legacy.js 逐字迁入；阶段 4 将收编为 core/templates 注册表，
// 届时每个模版升级为含 buildWorkbook/buildFileName 的 TemplateDefinition）。
export const TEMPLATES: Record<string, {
  name: string;
  icon: string;
  desc: string;
  headers: string[];
  fieldMap: Record<string, string>;
}> = {
  yidao: {
    name: '移步到岗',
    icon: '🚀',
    desc: '简洁模版，6列核心信息（保留模版结构）',
    headers: ['姓名', '身份证', '手机号', '开户银行', '银行卡号', '税前金额'],
    fieldMap: { name: '姓名', idCard: '身份证', phone: '手机号', bankName: '开户银行', bankCard: '银行卡号', amount: '税前金额' },
  },
  shenbianyun: {
    name: '身边云',
    icon: '☁️',
    desc: '付款模版（保留说明行、批次信息行和表头）',
    headers: ['商户订单号（非必填）', '收款人姓名（必填）', '身份证号（必填）', '个人银行卡号（必填）', '付款金额（元，必填）', '手机号（必填）', '备注（非必填）', '自定义备注（非必填）'],
    fieldMap: { name: '收款人姓名（必填）', idCard: '身份证号（必填）', bankCard: '个人银行卡号（必填）', amount: '付款金额（元，必填）', phone: '手机号（必填）', note: '备注（非必填）' },
  },
  youyi: {
    name: '云杉公司',
    icon: '🤝',
    desc: '详细模版（保留配置表和任务清单）',
    headers: ['出错信息', '平台', '商社编号', '姓名', '身份证号码', '性别', '任务清单', '税源地', '工种', '手机号码', '账号', '银行名称', '银行所属地', '税前金额', '个税金额', '商业保险', '备注'],
    fieldMap: { name: '姓名', idCard: '身份证号码', gender: '性别', phone: '手机号码', bankCard: '账号', bankName: '银行名称', location: '银行所属地', amount: '税前金额', note: '备注', shangSheId: '商社编号' },
  },
  custom: {
    name: '自定义模版',
    icon: '✏️',
    desc: '自由定义列名和顺序',
    headers: [],
    fieldMap: {},
  },
};
