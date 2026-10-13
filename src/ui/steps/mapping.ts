// 第二步：确认列映射（自 src/legacy.js 逐字搬移，阶段 3 E 分区）。
// 动态 HTML 的内联 onchange/onclick → data-action + initMappingDelegates() 事件委托
// （change 与 click 两个事件类型都挂在 #mapping-content 容器上，容器本身不随渲染重建）。
import { escapeHTML, byId, delegateAction } from '../dom';
import { icon } from '../icons';
import { state } from '../../state';
import type { SourceDataEntry } from '../../state';
import type { Row, Rows } from '../../types';
import { smartDetectTable } from '../../core/parser/table-detect';
import { detectColumnMapping, applyInferredNameByData, COL_TYPE_LABELS } from '../../core/mapping/column-detect';
import type { ColumnMapping } from '../../core/mapping/column-detect';
import { expandAmountSplitRows } from '../../core/mapping/row-expand';
import { computeOcrValidation } from '../../core/image/validate';
import { cleanNameCell } from '../../core/clean/names';
import { updateAccumIndicator, invokeResetAll } from './upload';

// 拆分行备注标注来源的开关（2026-10-15 用户要求默认关）：记忆到本浏览器
const SPLIT_NOTE_KEY = 'tc-split-note-labels';

function splitNoteLabelsOn(): boolean {
  try { return localStorage.getItem(SPLIT_NOTE_KEY) === '1'; } catch { return false; }
}
import { showTemplateStep } from './template';

export function showMappingStep(): void {
  const container = byId('mapping-content');
  byId('step-mapping').classList.remove('hidden');

  const sel = state.sources.filter(s => s.selected);

  // Source selection cards：多源时始终展示；全部取消勾选时也展示，便于重新勾选
  let sourceHTML = '';
  if (state.sources.length > 1 || !sel.length) {
    const cards = state.sources.map(item => {
      const desc = item.type === 'excel-sheet' || item.type === 'pdf' ? `${item.fileName} / ${item.sheetName}` : item.fileName;
      const isP = item.id === state.previewSourceId;
      return `
        <div style="padding:10px;border:1px solid ${isP?'var(--accent)':(item.selected?'var(--border-strong)':'var(--border)')};border-radius:8px;background:${isP?'var(--accent-soft)':(item.selected?'var(--surface)':'var(--surface2)')};">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            <input type="checkbox" ${item.selected?'checked':''} data-action="toggleSrc" data-id="${escapeHTML(item.id)}" style="margin-top:2px;accent-color:var(--accent);">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;word-break:break-word;">${escapeHTML(desc)}</div>
              <div style="font-size:12px;color:var(--text2);margin-top:2px;">${(item.analysis?.dataRowsCount||item.rows.length)} 行</div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;" data-action="setPreview" data-id="${escapeHTML(item.id)}">${isP?'✓ 预览中':'预览'}</button>
        </div>`;
    }).join('');
    sourceHTML = `<div style="background:var(--surface2);border-radius:8px;padding:14px;border:1px solid var(--border);margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">${icon('folder', 14)} 数据源</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">${cards}</div>
    </div>`;
  }

  if (!sel.length) {
    container.innerHTML = `
      ${sourceHTML}
      <div class="status-msg error">${icon('alert', 14)} 请至少勾选一个数据表以继续列映射</div>`;
    return;
  }

  const source = sel.find(s => s.id === state.previewSourceId) || sel[0];
  state.previewSourceId = source.id;

  const detected = smartDetectTable(source.rows);
  // 图片源的人工编辑覆盖优先（confirmMapping 同口径；直接改检测结果会被重检测丢弃）
  const dataRows = source.dataRowsOverride ?? detected.dataRows;
  const autoMap = detectColumnMapping(detected.headerRow, dataRows);
  // 同源保留用户的手动标注（含「不识别」空串）——重渲染合并时用户选择一律优先于自动检测；
  // 切换预览源不串。见 applyUserTypeOverrides（2026-10-15 用户反馈：手动清空被冲回自动结果）。
  const sameSource = state.mappingState?.source?.id === source.id;
  const userTypes = sameSource ? state.mappingState?.userTypes : undefined;
  applyUserTypeOverrides(autoMap, userTypes, detected.headerRow as Row | undefined);
  // 图片源：表头非「姓名」（如「9月」月份标注）时按数据特征推断姓名列（opt-in，仅 source.ocr）
  if (source.ocr) applyInferredNameByData(detected.headerRow, dataRows, autoMap);
  // 姓名列清洗统计（与 confirmMapping 同口径：用户编辑过的源不自动清洗）
  const nameCiEntry = Object.entries(autoMap.cols).find(([, col]) => col.type === 'name');
  const nameCi = nameCiEntry ? Number(nameCiEntry[0]) : null;
  let nameCleanCount = 0;
  if (nameCi != null && !source.dataRowsOverride) {
    dataRows.forEach(r => {
      const raw = String(r?.[nameCi] ?? '').trim();
      if (raw && cleanNameCell(raw) !== raw) nameCleanCount++;
    });
  }
  // 多列税前金额拆分预警 + 合计核对（dry-run，与 confirmMapping 同一纯函数，确认前可见）
  const amountColsSel = Object.entries(autoMap.cols)
    .filter(([, col]) => col.type === 'amount')
    .map(([ci]) => Number(ci))
    .sort((a, b) => a - b);
  const totalColEntry = Object.entries(autoMap.cols).find(([, col]) => col.type === 'amountTotal');
  const totalColSel = totalColEntry ? Number(totalColEntry[0]) : null;
  let splitChipHTML = '';
  if (amountColsSel.length >= 2) {
    const labelNote = splitNoteLabelsOn();
    const dry = expandAmountSplitRows(dataRows, {
      amountCols: amountColsSel,
      totalCol: totalColSel,
      noteCol: null,
      labelOf: ci => String(detected.headerRow?.[ci] || '').trim() || `第 ${ci + 1} 列`,
      labelNote,
    });
    const mismatchTxt = totalColSel != null
      ? (dry.mismatches.length
          ? `；<strong>合计核对 ${dry.mismatches.length} 行不平</strong>（${dry.mismatches.slice(0, 3).map(m => `第 ${m.rowIndex + 1} 行 ${m.sum}≠${m.declared}`).join('、')}${dry.mismatches.length > 3 ? '…' : ''}）`
          : '；合计核对通过')
      : '';
    // 备注标注来源开关（默认关，记忆到本浏览器）
    const noteToggle = `<label style="margin-left:10px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;"><input type="checkbox" data-action="splitNoteToggle" ${labelNote ? 'checked' : ''} style="accent-color:var(--accent);">备注标注来源</label>`;
    splitChipHTML = `<div style="background:var(--blue-soft);border:1px solid var(--blue-border);padding:8px 14px;border-radius:8px;font-size:13px;color:var(--blue);">${icon('list', 14)} 检测到 <strong>${amountColsSel.length}</strong> 列税前金额，确认后将展开为 <strong>${dry.expandedRowCount}</strong> 行发放记录（跳过空金额）${mismatchTxt}${noteToggle}</div>`;
  }
  // 图片源校验（设计 §6）：字段级格式/校验位 + 高频误读候选 + 列合计核对，渲染时现算
  const ocrValidation = source.ocr ? computeOcrValidation(source.rows, dataRows, autoMap.cols) : null;
  state.mappingState = {
    headerRow: detected.headerRow,
    headerRowIndex: detected.headerRowIndex,
    dataRows,
    mapping: autoMap,
    source,
    filteredCount: detected.filteredCount || 0,
    ocrValidation: ocrValidation ?? undefined,
    userTypes: userTypes || {},
  };

  // Column mapping
  const colIndices = Object.keys(autoMap.cols).map(Number).sort((a,b)=>a-b);
  let colsHTML = '';
  colIndices.forEach(ci => {
    const col = autoMap.cols[ci];
    colsHTML += `<div class="mapping-col ${col.type?'selected':''}">
      <div class="col-idx">第 ${ci+1} 列</div>
      <div class="col-header">${escapeHTML(col.header)}</div>
      <select data-col="${ci}" data-action="onMapChange">
        ${Object.entries(COL_TYPE_LABELS).map(([k,v])=>`<option value="${k}" ${k===col.type?'selected':''}>${v}</option>`).join('')}
      </select>
      <div class="col-sample">${col.samples.map(s=>`<span>${escapeHTML(s.length>15?s.slice(0,15)+'…':s)}</span>`).join(' ')}</div>
    </div>`;
  });

  // Preview（图片源展示全部行——校对是识别流程的一环，只给 5 行没法校对；上限 50 防扫描 PDF 卡顿）
  const pv = Math.min(dataRows.length, source.ocr ? 50 : 5);
  let pvBody = '';
  for (let ri = 0; ri < pv; ri++) {
    pvBody += '<tr>' + colIndices.map(ci => {
      // 姓名列清洗预览（所见即所得）：展示清洗值，悬停见原值；所有源均可点击修改
      const rawV = String((dataRows[ri]||[])[ci]||'');
      let v = rawV;
      let cleanTip = '';
      if (nameCi != null && ci === nameCi && rawV && !source.dataRowsOverride) {
        const cleaned = cleanNameCell(rawV);
        if (cleaned !== rawV) {
          v = cleaned;
          cleanTip = `姓名清洗：${rawV} → ${cleaned}（点击可修改）`;
        }
      }
      // 图片源：校验问题格标红（一键候选预填 prompt，确认后才写入——绝不静默改）
      const issue = ocrValidation?.issues[`${ri}:${ci}`];
      const classes = [issue ? 'ocr-issue' : '', cleanTip ? 'name-cleaned' : ''].filter(Boolean).join(' ');
      const cls = classes ? ` class="${classes}"` : '';
      const tip = issue
        ? ` title="${escapeHTML(issue.msg + (issue.fix ? `（点击可修正为 ${issue.fix}）` : '（点击可修正）'))}"`
        : cleanTip ? ` title="${escapeHTML(cleanTip)}"` : '';
      return `<td${cls}${tip} data-action="editCell" data-ri="${ri}" data-ci="${ci}">${v?escapeHTML(v):'<span style="color:var(--text2);opacity:0.4;">—</span>'}</td>`;
    }).join('') + '</tr>';
  }
  if (dataRows.length > pv) pvBody += `<tr><td colspan="${colIndices.length}" style="text-align:center;color:var(--text2);font-size:12px;padding:8px;">… 还有 ${dataRows.length-pv} 行</td></tr>`;

  container.innerHTML = `
    ${sourceHTML}
    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
      <div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">${icon('table', 14)} <strong style="color:var(--accent2);">${dataRows.length}</strong> 行有效数据</div>
      <div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">${icon('list', 14)} 识别 <strong style="color:var(--accent2);">${colIndices.length}</strong> 列</div>
      ${detected.headerRowIndex>0?`<div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">${icon('arrowLeft', 12)} 跳过前 ${detected.headerRowIndex} 行</div>`:''}
      ${detected.filteredCount>0?`<div style="background:var(--orange-soft);border:1px solid var(--orange-border);padding:8px 14px;border-radius:8px;font-size:13px;color:var(--orange);">${icon('filter', 14)} 已自动过滤 <strong>${detected.filteredCount}</strong> 行非人员记录（如平台服务费、合计等费用/汇总行）</div>`:''}
      ${nameCleanCount>0?`<div style="background:var(--orange-soft);border:1px solid var(--orange-border);padding:8px 14px;border-radius:8px;font-size:13px;color:var(--orange);">${icon('eraser', 14)} 姓名列已清洗 <strong>${nameCleanCount}</strong> 处注记（预览格悬停可见原值，点击可修改）</div>`:''}
      ${splitChipHTML}
    </div>
    ${ocrValidation ? `<div class="status-msg ${ocrValidation.sumMismatchCols.length ? 'error' : 'info'}" style="margin-bottom:12px;">${icon('search', 14)} 图片识别校验（引擎：${source.ocr?.engine === 'llm' ? '云端 LLM' : '本地 Tesseract'}${source.ocr?.meanConfidence != null ? `，整体置信度 ${source.ocr.meanConfidence}%，仅供参考` : ''}）${source.ocr?.notice ? `：${escapeHTML(source.ocr.notice)}` : ''}：${Object.keys(ocrValidation.issues).length ? `疑似误读 <strong>${Object.keys(ocrValidation.issues).length}</strong> 格（预览中标红，点击可按候选修正）` : '未见异常格'}${ocrValidation.sumMismatchCols.length ? `；<strong>第 ${ocrValidation.sumMismatchCols.map(c => c + 1).join('、')} 列</strong>的数据合计与图内合计行不符，请逐格核对！` : ''}</div>` : ''}
    <div style="font-size:14px;font-weight:600;margin-bottom:10px;">${icon('list', 14)} 列映射 — 请确认或修改</div>
    <div class="mapping-grid">${colsHTML}</div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px;">${icon('table', 13)} 数据预览${source.ocr ? '（图片源：标红格为疑似识别错误，点击可修正）' : ''}</div>
      <div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;">
        <table class="result-table" style="font-size:12px;">
          <thead><tr>${colIndices.map(ci=>`<th>${escapeHTML(autoMap.cols[ci].header)}</th>`).join('')}</tr></thead>
          <tbody>${pvBody}</tbody>
        </table>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" data-action="confirmMapping">${icon('check', 14)} 确认映射</button>
      <button class="btn btn-secondary" data-action="resetAll">${icon('refresh', 14)} 重置</button>
    </div>`;
}

export function toggleSrc(id: string, checked: boolean): void {
  const t = state.sources.find(s=>s.id===id);
  if (t) t.selected = checked;
  if (checked) state.previewSourceId = id;
  updateAccumIndicator(); showMappingStep();
}

export function setPreview(id: string): void {
  const t = state.sources.find(s=>s.id===id);
  if (t) { if (!t.selected) t.selected = true; state.previewSourceId = id; }
  updateAccumIndicator(); showMappingStep();
}

export function onMapChange(sel: HTMLSelectElement): void {
  const ci = sel.dataset.col as string;
  if (state.mappingState) {
    state.mappingState.mapping!.cols[ci].type = sel.value;
    // 用户显式标注（含「不识别」空串）单独记录：重渲染合并时用户选择优先，
    // 否则重新自动检测会把「手动清空」冲回自动结果（2026-10-15 用户反馈回归）
    state.mappingState.userTypes = { ...(state.mappingState.userTypes || {}), [ci]: sel.value };
  }
  sel.parentElement!.classList.toggle('selected', !!sel.value);
  // 拆分预警/合计核对需跟随用户标注实时更新：重渲染映射页（尽力保留滚动位置；
  // scrollTo 在测试桩环境缺失，可选调用兜底）
  const y = typeof window !== 'undefined' && typeof window.scrollY === 'number' ? window.scrollY : 0;
  showMappingStep();
  try { window.scrollTo?.({ top: y }); } catch { /* 测试桩无 scrollTo */ }
}

/**
 * 用户手动标注回填（重渲染合并，2026-10-15 回归修复）：
 * 重渲染会重新自动检测；若只按 cols 的 type 回填，「手动清空为不识别（''）」与
 * 「自动未识别」无法区分，用户的清空选择会被自动结果冲回（表现为下拉锁死）。
 * 故用户标注单独记录于 userTypes（含空串），一律覆盖自动值；未标注列保持自动结果。
 */
export function applyUserTypeOverrides(
  autoMap: ColumnMapping,
  userTypes: Record<string, string> | undefined,
  headerRow: Row | undefined,
): void {
  if (!userTypes) return;
  Object.entries(userTypes).forEach(([ci, type]) => {
    const nci = Number(ci);
    if (autoMap.cols[ci]) autoMap.cols[ci].type = type;
    else {
      autoMap.cols[ci] = {
        header: String(headerRow?.[nci] || '').trim() || `列${nci + 1}`,
        type,
        samples: [],
      };
    }
  });
}

export function confirmMapping(): void {
  // Collect data rows WITH per-source column mappings
  // This is critical for multi-sheet files where each sheet has different column layout
  const sourcesData: SourceDataEntry[] = [];
  let splitMismatchSummary: string | null = null;
  state.sources.filter(s => s.selected).forEach(src => {
    // 图片源优先取人工编辑覆盖（与预览同口径）
    const dataRows = src.dataRowsOverride ?? smartDetectTable(src.rows).dataRows;
    if (dataRows.length === 0) return;

    // 列类型收集：税前金额允许多列（多列标记不互相覆盖）；合计金额仅核对、不进导出面。
    // Use user-modified mapping for preview source, auto-detected for others
    const cols = src.id === state.previewSourceId
      ? state.mappingState!.mapping!.cols
      : (src.analysis?.autoMap?.cols || {});
    let typeToCol: Record<string, number | null> = {};
    const amountCols: number[] = [];
    let amountTotalCol: number | null = null;
    Object.entries(cols).forEach(([ci, col]) => {
      if (!col.type) return;
      if (col.type === 'amount') { amountCols.push(Number(ci)); return; }
      if (col.type === 'amountTotal') { amountTotalCol = Number(ci); return; }
      typeToCol[col.type] = Number(ci);
    });
    amountCols.sort((a, b) => a - b);
    if (amountCols.length) typeToCol['amount'] = amountCols[0];

    // 姓名列清洗（全数据源通用）：剥离 王辉2/陈建新8月/王辉（补发）类注记——
    // 原样导出会被目标平台拒收。生成新行数组，绝不原地改源数据；
    // 用户手动编辑过的源（dataRowsOverride 存在）视为已人工校对，不再自动清洗
    let outRows = dataRows;
    if (typeToCol.name != null && !src.dataRowsOverride) {
      const nameIdx = typeToCol.name;
      outRows = dataRows.map(r => {
        const c = [...r];
        const raw = String(c[nameIdx] ?? '').trim();
        c[nameIdx] = cleanNameCell(raw);
        return c;
      });
    }

    // 多列税前金额 → 拆行（设计 docs/superpowers/specs/2026-10-15-amount-split-rows-design.md）：
    // 金额归一写入最左拆分列（= typeToCol.amount），其余拆分列清空，备注写来源列头——
    // 导出管线的单金额列假设零改动
    if (amountCols.length >= 2) {
      const headerRow = (state.mappingState!.headerRow as Row | undefined) || [];
      const labelNote = splitNoteLabelsOn();
      const res = expandAmountSplitRows(outRows, {
        amountCols,
        totalCol: amountTotalCol,
        noteCol: typeToCol['note'] != null ? typeToCol['note'] : null,
        labelOf: ci => String(headerRow[ci] || '').trim() || `第 ${ci + 1} 列`,
        labelNote,
      });
      outRows = res.rows;
      if (labelNote && typeToCol['note'] == null && res.noteCol != null) typeToCol['note'] = res.noteCol;
      if (res.mismatches.length) {
        // 发钱场景零容错：核对不平不静默下发，弹窗明示、用户可返回修改
        const lines = res.mismatches.slice(0, 5)
          .map(m => `第 ${m.rowIndex + 1} 行：拆分合计 ${m.sum} ≠ 合计 ${m.declared}`)
          .join('\n');
        splitMismatchSummary = `数据源「${src.fileName}${src.sheetName ? ' / ' + src.sheetName : ''}」有 ${res.mismatches.length} 行拆分金额之和与合计列不符：\n${lines}${res.mismatches.length > 5 ? '\n…' : ''}`;
      }
    }

    sourcesData.push({ dataRows: outRows, typeToCol, source: src });
  });

  if (!sourcesData.length) { alert('没有有效数据行'); return; }
  if (splitMismatchSummary) {
    if (!confirm(`${splitMismatchSummary}\n\n仍要继续导出吗？（取消可返回映射页修正后重新确认）`)) return;
  }
  state.mappingState!.sourcesData = sourcesData;
  showTemplateStep();
}

/**
 * 单元格人工修正（预览格点击，全数据源开放，2026-10-15 从图片源泛化）：
 * prompt 预填图片源误读候选（validate.ts）或当前值，用户确认后才写入
 * source.dataRowsOverride 覆盖层——绝不静默修改。写完重渲染（重校验，所见即生效）。
 * 用户编辑过的源在 confirmMapping 不再被自动姓名清洗（视为已人工校对）。
 */
export function editCell(el: HTMLElement): void {
  const ms = state.mappingState;
  if (!ms?.source || !ms.dataRows) return;
  const dataRows = ms.dataRows as Rows;
  const ri = Number(el.dataset.ri);
  const ci = Number(el.dataset.ci);
  if (!Number.isInteger(ri) || !Number.isInteger(ci)) return;
  const current = String(dataRows[ri]?.[ci] ?? '');
  const issue = ms.ocrValidation?.issues[`${ri}:${ci}`];
  const prefill = issue?.fix ?? current;
  const input = prompt(`修改第 ${ri + 1} 行「${ms.mapping?.cols?.[String(ci)]?.header || `第 ${ci + 1} 列`}」${issue ? `（${issue.msg}）` : ''}：`, prefill);
  if (input === null) return;
  const src = ms.source;
  if (!src.dataRowsOverride) src.dataRowsOverride = dataRows.map(r => [...r]);
  const row = src.dataRowsOverride[ri];
  if (row) row[ci] = input.trim();
  showMappingStep();
}

// 映射容器事件委托：原内联 onchange/onclick 全部改为 data-action 分发。
// change：toggleSrc（数据源勾选框）、onMapChange（列类型下拉框）
// click ：setPreview（预览按钮）、confirmMapping（确认映射）、resetAll（重置，
//         经 setResetAllHandler 接缝调用主智能体的 resetAll，见 upload.ts 头部说明）
export function initMappingDelegates(): void {
  const container = byId('mapping-content');
  delegateAction(container, 'change', {
    toggleSrc: el => toggleSrc(el.dataset.id || '', (el as HTMLInputElement).checked),
    onMapChange: el => onMapChange(el as HTMLSelectElement),
    // 拆分行备注标注来源开关：写 localStorage 后重渲染（预警条勾选态跟随）
    splitNoteToggle: el => {
      try { localStorage.setItem(SPLIT_NOTE_KEY, (el as HTMLInputElement).checked ? '1' : '0'); } catch { /* 隐私模式忽略 */ }
      showMappingStep();
    },
  });
  delegateAction(container, 'click', {
    setPreview: el => setPreview(el.dataset.id || ''),
    confirmMapping: () => confirmMapping(),
    resetAll: () => invokeResetAll(),
    editCell: el => editCell(el),
  });
}
