// 列类型识别 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 A），
// 仅补充类型注解与显式 export，不改变任何行为。
// COL_KEYWORDS / COL_TYPE_LABELS 在 legacy.js 中为隐式全局常量（legacy.js L1217/L1232），
// 供本模块与 smartDetectTable、UI 层共同引用。
import type { Row, Rows } from '../../types';
import { getAmountColumnScore, isAmountLikeNumber } from './amount-score';

export const COL_KEYWORDS: Record<string, RegExp> = {
  name:       /姓名|户名|名称|人员|收款人|员工|name|person/i,
  idCard:     /身份证|身份证号|身份证号码|id\s*card|idcard|证件号/i,
  phone:      /电话|phone|手机|mobile|联系电话/i,
  bankName:   /开户行|开户银行|银行名称|bank\s*name/i,
  bankCard:   /银行|bank|卡号|bankcard|账号|账户|个人银行卡号/i,
  amount:     /金额|amount|收入|income|报酬|pay|税前金额|税前收入|税后收入|应发金额|实发金额|计划发放收入|发放金额|付款金额|应发金额\(含税\)|应发金额（含税）/i,
  gender:     /性别|gender|sex/i,
  location:   /开户地|开户所属地|银行所属地|税源地/i,
  note:       /备注|note|说明|remark/i,
  shangSheId: /商社编号|商社代码|商户编号/i,
  clientName: /客户名称|公司名称|委托方名称?|甲方名称?/i,
  taxId: /纳税人识别号|统一信用代码|统一社会信用代码|税号|信用代码/i,
};

export const COL_TYPE_LABELS: Record<string, string> = {
  '':         '— 不识别 —',
  name:       '姓名',
  idCard:     '身份证',
  phone:      '手机号',
  bankName:   '开户银行',
  bankCard:   '银行卡号',
  amount:     '税前金额',
  gender:     '性别',
  location:   '开户地/税源地',
  note:       '备注',
  shangSheId: '商社编号',
  clientName: '客户名称',
  taxId: '纳税人识别号',
};

/** detectColumnMapping 返回的单列识别信息（type 为空串表示未识别，与 legacy 行为一致） */
export interface DetectedColumn {
  header: string;
  type: string;
  samples: string[];
}

/**
 * detectColumnMapping 的返回。
 * amountCol / nameCol 由 analyzeSheet 在识别后补写（legacy 中为动态挂载属性），
 * detectColumnMapping 本身只返回 { cols }，故为可选属性。
 */
export interface ColumnMapping {
  cols: Record<string, DetectedColumn>;
  amountCol?: number | null;
  nameCol?: number | null;
}

export function detectColumnMapping(headerRow: Row, dataRows: Rows): ColumnMapping {
  const mapping: Record<number, string | undefined> = {};
  const used = new Set<string>();

  headerRow.forEach((cell, i) => {
    const v = String(cell || '').trim();
    if (!v) return;
    for (const [type, re] of Object.entries(COL_KEYWORDS)) {
      if (type === 'amount') continue;
      if (!used.has(type) && re.test(v)) { mapping[i] = type; used.add(type); break; }
    }
  });

  let bestIdx: number | null = null, bestScore = -Infinity;
  headerRow.forEach((cell, i) => {
    if (mapping[i]) return;
    const s = getAmountColumnScore(cell, dataRows, i);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  });
  if (bestIdx != null && bestScore >= 5) { mapping[bestIdx] = 'amount'; used.add('amount'); }

  if (!used.has('amount')) {
    for (let ci = 0; ci < headerRow.length; ci++) {
      if (mapping[ci]) continue;
      let n = 0;
      for (let ri = 0; ri < Math.min(dataRows.length, 10); ri++) {
        if (isAmountLikeNumber(dataRows[ri]?.[ci])) n++;
      }
      if (n >= Math.min(dataRows.length, 10) * 0.5) { mapping[ci] = 'amount'; used.add('amount'); break; }
    }
  }

  const cols: Record<string, DetectedColumn> = {};
  headerRow.forEach((cell, i) => {
    const v = String(cell || '').trim();
    if (!v && mapping[i] == null) return;
    const samples: string[] = [];
    for (let ri = 0; ri < Math.min(dataRows.length, 3); ri++) {
      const sv = dataRows[ri]?.[i];
      if (sv != null && String(sv).trim()) samples.push(String(sv).trim());
    }
    cols[i] = { header: v || `列${i+1}`, type: mapping[i] || '', samples };
  });
  return { cols };
}
