// generateOutput 的纯转换部分 —— 自 src/legacy.js generateOutput（L348-522）逐字搬移（阶段 4）。
// 仅做以下注入/参数化改动，其余逐字保真：
//  1. `state.x` 读 → `input.x`；`loadKB()` → `input.kb`（core 禁读 state/localStorage）；
//  2. `TEMPLATES[state.targetTemplate]` → 查模版注册表（core/templates/registry）；
//  3. custom 模版的 early-return（showCustomMappingUI）不进 core——由 ui 调用方先行判断；
//  4. batchMatch 分支中的 state 写入（applyBatchShangShe / 三字段清空 / shangSheCandidates）
//     不进 core——经 GenerateResult.batchMatch / shangSheCandidates 返回，由 ui 调用方写入；
//  5. detectBestShangSheMatch / detectSourceClientInfo 的原第二参兜底
//     `state.sources.filter(s => s.selected)` → input.sources 显式传入（扫描源文件头部
//     客户名称/税号用，与 mappingState.sourcesData 不等价：0 数据行的选中源只在前者中）。
import type { Rows, Row, OutputRowMeta } from '../../types';
import type { SourceDataEntry } from '../../state';
import type { KB } from '../kb/model';
import { getTemplate, TEMPLATES } from '../templates/registry';
import { sanitizeAmount, cleanValue } from '../clean/values';
import { inferGenderFromIdCard } from '../parser/table-detect';
import {
  kbLookupShangShe, kbLookupShangSheByTaxId, kbLookupShangSheByNameAll,
  kbGetShangSheIdFromLookup, kbDetectSourceClientInfo, kbDetectBestShangSheMatch,
  type ShangSheLookup, type NameMatchResult, type ScanSource,
  type BestShangSheMatch,
} from '../kb/shangshe';
import { kbFillShangSheInfoForRow, inferBankLocationFromBranch, type ShangSheColIndex, type FillRowContext } from '../kb/shangshe-fill';

export interface GenerateInput {
  targetTemplate: string;
  sourcesData: SourceDataEntry[];
  /** 原 `state.sources.filter(s => s.selected)`（客户名称/税号头部扫描用） */
  sources: ScanSource[];
  kb: KB;
  sbyOptions: { showBatchInfo: boolean; plainAmount: boolean };
}

export interface GenerateResult {
  headers: string[];
  rows: Rows;
  meta: OutputRowMeta[];
  cleanCount: number;
  unmatchedRows: unknown[];
  shangSheCandidates: { id: string; label: string; matchType?: string }[];
  /** detectBestShangSheMatch 的结果（仅 yidao/shenbianyun；state 写入由 ui 调用方执行） */
  batchMatch: BestShangSheMatch | null;
}

export function generateOutputData(input: GenerateInput): GenerateResult {
  const { sourcesData } = input;

  const tpl = getTemplate(input.targetTemplate);

  // Generate output rows using per-source column mappings
  const outputRows: Rows = [];
  const outputRowMeta: OutputRowMeta[] = [];
  let cleanCount = 0;
  sourcesData.forEach(({ dataRows, typeToCol, source }) => {
    // Build source-type → dest-column mapping for this source
    const srcToDest: Record<string, number> = {};
    for (const [type, destName] of Object.entries(tpl.fieldMap)) {
      const destIdx = tpl.headers.indexOf(destName);
      if (destIdx >= 0 && typeToCol[type] != null) srcToDest[type] = destIdx;
    }

    dataRows.forEach(row => {
      const out = new Array(tpl.headers.length).fill('');
      for (const [type, destIdx] of Object.entries(srcToDest)) {
        let val = row[typeToCol[type] as number];
        const raw = val != null ? String(val) : '';
        if (type === 'amount') val = sanitizeAmount(val);
        else val = cleanValue(val, type);
        // Count cleaned values (had spaces/whitespace removed)
        if (val !== raw.trim() && val.length < raw.trim().length) cleanCount++;
        out[destIdx] = val != null ? String(val).trim() : '';
      }
      if (!out.some(v => v)) return;
      const hasIdentity = (srcToDest.name != null && out[srcToDest.name]) ||
                          (srcToDest.idCard != null && out[srcToDest.idCard]) ||
                          (srcToDest.bankCard != null && out[srcToDest.bankCard]);
      if (!hasIdentity) return;
      // Auto-infer gender from ID card if gender column exists but is empty
      {
        const genderIdx = tpl.headers.indexOf(tpl.fieldMap.gender || '性别');
        if (genderIdx >= 0 && !out[genderIdx]) {
          const idCardIdx = tpl.headers.indexOf(tpl.fieldMap.idCard);
          if (idCardIdx >= 0 && out[idCardIdx]) {
            const inferred = inferGenderFromIdCard(out[idCardIdx]);
            if (inferred) out[genderIdx] = inferred;
          }
        }
        // 云杉模版: set 个税金额 and 商业保险 to 0 for rows with data
        if (input.targetTemplate === 'youyi') {
          const taxIdx = tpl.headers.indexOf('个税金额');
          const insuranceIdx = tpl.headers.indexOf('商业保险');
          const bankNameIdx = tpl.headers.indexOf('银行名称');
          const bankLocationIdx = tpl.headers.indexOf('银行所属地');
          if (taxIdx >= 0) out[taxIdx] = '0';
          if (insuranceIdx >= 0) out[insuranceIdx] = '0';
          if (bankNameIdx >= 0 && !out[bankNameIdx]) {
            out[bankNameIdx] = '0';
          }
          if (bankLocationIdx >= 0 && !out[bankLocationIdx]) {
            out[bankLocationIdx] = inferBankLocationFromBranch(bankNameIdx >= 0 ? out[bankNameIdx] : '');
          }
        }
      }
      outputRows.push(out);
      outputRowMeta.push({
        fileName: source?.fileName || '',
        sheetName: source?.sheetName || '',
        rawRow: row,
        typeToCol
      });
    });
  });

  const batchMatch = TEMPLATES[input.targetTemplate]?.supportsBatchNo
    ? kbDetectBestShangSheMatch(input.kb, sourcesData, input.sources)
    : null;
  // 原 `state.shangSheCandidates = batchMatch.candidates || []`（ui 调用方据返回值写入）
  let shangSheCandidates: { id: string; label: string; matchType?: string }[] = [];
  if (batchMatch) {
    shangSheCandidates = batchMatch.candidates || [];
    // 原 applyBatchShangShe / 三字段清空 → GenerateResult.batchMatch，由 ui 调用方写入 state
  }

  // 云杉模版：知识库自动填充
  const unmatchedRows: number[] = [];
  if (input.targetTemplate === 'youyi') {
    // 云杉模版列索引：0-出错信息, 1-平台, 2-商社编号, 3-姓名, 4-身份证号码,
    //   5-性别, 6-任务清单, 7-税源地, 8-工种, 9-手机号码, 10-账号,
    //   11-银行名称, 12-银行所属地, 13-税前金额, 14-个税金额, 15-商业保险, 16-备注
    const platformIdx = tpl.headers.indexOf('平台');       // 1
    const shangSheIdx = tpl.headers.indexOf('商社编号');   // 2
    const taskListIdx = tpl.headers.indexOf('任务清单');   // 6
    const taxSourceIdx = tpl.headers.indexOf('税源地');    // 7
    const workTypeIdx = tpl.headers.indexOf('工种');       // 8

    // 尝试从源文件头部行中检测客户名称和纳税人识别号
    const clientInfo = kbDetectSourceClientInfo(sourcesData, input.sources);
    const clientName = clientInfo.clientName || '';
    const taxIdValue = clientInfo.taxId || '';

    // 通过纳税人识别号查找
    let taxIdLookup: ShangSheLookup | null = null;
    if (taxIdValue) {
      taxIdLookup = kbLookupShangSheByTaxId(input.kb, taxIdValue);
    }

    // 通过客户名称查找（可能返回多个匹配）
    let clientNameLookups: NameMatchResult[] = [];
    if (clientName) {
      clientNameLookups = kbLookupShangSheByNameAll(input.kb, clientName);
    }

    // 构建候选列表：自动检测到的命中均转为候选，不直接锁定行，
    // 以便本公司内部同一公司存在多个编号时可手动切换。
    let candidates: { id: string; label: string; matchType?: string }[] = [];
    if (taxIdLookup) {
      const id = kbGetShangSheIdFromLookup(input.kb, taxIdLookup);
      candidates.push({ id, label: `${id} - ${taxIdLookup.shortName || taxIdLookup.fullName}`, matchType: '税号精确' });
    } else if (clientNameLookups.length > 0) {
      candidates = clientNameLookups.map(c => ({ id: c.id, label: `${c.id} - ${c.lookup.shortName || c.lookup.fullName}`, matchType: c.matchType }));
    }

    // 原 `state.shangSheCandidates = candidates`（ui 调用方据返回值写入）
    shangSheCandidates = candidates;

    // 填充商社信息的辅助函数
    function fillShangSheInfo(out: Row, lookup: ShangSheLookup, rowContext: FillRowContext) {
      if (!lookup) return false;
      const colIndex: ShangSheColIndex = { platform: platformIdx, taxSource: taxSourceIdx, taskList: taskListIdx, workType: workTypeIdx };
      kbFillShangSheInfoForRow(input.kb, out, lookup, colIndex, (idx, val) => { out[idx] = val; }, rowContext);
      // 如果商社编号列为空，也填充商社编号
      if (shangSheIdx >= 0 && !out[shangSheIdx]) {
        // 从lookup中获取商社编号（需要从KB中查找）
        const kb = input.kb;
        for (const [id, entry] of Object.entries(kb.shangSheMap)) {
          if (entry.fullName === lookup.fullName || entry.shortName === lookup.shortName) {
            out[shangSheIdx] = id;
            break;
          }
        }
      }
      return true;
    }

    outputRows.forEach((out, rowIdx) => {
      const rowContext = (outputRowMeta[rowIdx] || {}) as FillRowContext;
      const shangSheId = shangSheIdx >= 0 ? out[shangSheIdx] as string : '';
      if (shangSheId) {
        const lookup = kbLookupShangShe(input.kb, shangSheId);
        if (lookup) { fillShangSheInfo(out, lookup, rowContext); return; }
      }
      // 自动检测候选不直接填充，保持未匹配状态供手动选择器确认/切换
      unmatchedRows.push(rowIdx);
    });
  }

  // 身边云: do NOT auto-fill merchant order number (leave empty per user request)

  return {
    headers: tpl.headers,
    rows: outputRows,
    meta: outputRowMeta,
    cleanCount,
    unmatchedRows,
    shangSheCandidates,
    batchMatch,
  };
}
