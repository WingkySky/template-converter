// 第二步：确认列映射（自 src/legacy.js 逐字搬移，阶段 3 E 分区）。
// 动态 HTML 的内联 onchange/onclick → data-action + initMappingDelegates() 事件委托
// （change 与 click 两个事件类型都挂在 #mapping-content 容器上，容器本身不随渲染重建）。
import { escapeHTML, byId, delegateAction } from '../dom';
import { icon } from '../icons';
import { state } from '../../state';
import type { SourceDataEntry } from '../../state';
import { smartDetectTable } from '../../core/parser/table-detect';
import { detectColumnMapping, COL_TYPE_LABELS } from '../../core/mapping/column-detect';
import { updateAccumIndicator, invokeResetAll } from './upload';
import { showTemplateStep } from './template';

export function showMappingStep(): void {
  const container = byId('mapping-content');
  byId('step-mapping').classList.remove('hidden');

  const sel = state.sources.filter(s => s.selected);

  // Source selection cards：多源时始终展示；全部取消勾选时也展示，便于重新勾选
  let sourceHTML = '';
  if (state.sources.length > 1 || !sel.length) {
    const cards = state.sources.map(item => {
      const desc = item.type === 'excel-sheet' ? `${item.fileName} / ${item.sheetName}` : item.fileName;
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

  const { headerRow, headerRowIndex, dataRows, filteredCount } = smartDetectTable(source.rows);
  const autoMap = detectColumnMapping(headerRow, dataRows);
  state.mappingState = { headerRow, headerRowIndex, dataRows, mapping: autoMap, source, filteredCount: filteredCount || 0 };

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

  // Preview
  const pv = Math.min(dataRows.length, 5);
  let pvBody = '';
  for (let ri = 0; ri < pv; ri++) {
    pvBody += '<tr>' + colIndices.map(ci => {
      const v = String((dataRows[ri]||[])[ci]||'');
      return `<td>${v?escapeHTML(v):'<span style="color:var(--text2);opacity:0.4;">—</span>'}</td>`;
    }).join('') + '</tr>';
  }
  if (dataRows.length > pv) pvBody += `<tr><td colspan="${colIndices.length}" style="text-align:center;color:var(--text2);font-size:12px;padding:8px;">… 还有 ${dataRows.length-pv} 行</td></tr>`;

  container.innerHTML = `
    ${sourceHTML}
    <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
      <div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">${icon('table', 14)} <strong style="color:var(--accent2);">${dataRows.length}</strong> 行有效数据</div>
      <div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">${icon('list', 14)} 识别 <strong style="color:var(--accent2);">${colIndices.length}</strong> 列</div>
      ${headerRowIndex>0?`<div style="background:var(--surface2);padding:8px 14px;border-radius:8px;font-size:13px;">${icon('arrowLeft', 12)} 跳过前 ${headerRowIndex} 行</div>`:''}
      ${filteredCount>0?`<div style="background:var(--orange-soft);border:1px solid var(--orange-border);padding:8px 14px;border-radius:8px;font-size:13px;color:var(--orange);">${icon('filter', 14)} 已自动过滤 <strong>${filteredCount}</strong> 行非人员记录（如平台服务费、合计等费用/汇总行）</div>`:''}
    </div>
    <div style="font-size:14px;font-weight:600;margin-bottom:10px;">${icon('list', 14)} 列映射 — 请确认或修改</div>
    <div class="mapping-grid">${colsHTML}</div>
    <div style="margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:8px;">${icon('table', 13)} 数据预览</div>
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
  if (state.mappingState) state.mappingState.mapping!.cols[ci].type = sel.value;
  sel.parentElement!.classList.toggle('selected', !!sel.value);
}

export function confirmMapping(): void {
  // Collect data rows WITH per-source column mappings
  // This is critical for multi-sheet files where each sheet has different column layout
  const sourcesData: SourceDataEntry[] = [];
  state.sources.filter(s => s.selected).forEach(src => {
    const { dataRows } = smartDetectTable(src.rows);
    if (dataRows.length === 0) return;

    // Use user-modified mapping for preview source, auto-detected for others
    let typeToCol: Record<string, number | null> = {};
    if (src.id === state.previewSourceId) {
      const cols = state.mappingState!.mapping!.cols;
      Object.entries(cols).forEach(([ci, col]) => { if (col.type) typeToCol[col.type] = Number(ci); });
    } else if (src.analysis?.autoMap?.cols) {
      Object.entries(src.analysis.autoMap.cols).forEach(([ci, col]) => { if (col.type) typeToCol[col.type] = Number(ci); });
    }

    sourcesData.push({ dataRows, typeToCol, source: src });
  });

  if (!sourcesData.length) { alert('没有有效数据行'); return; }
  state.mappingState!.sourcesData = sourcesData;
  showTemplateStep();
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
  });
  delegateAction(container, 'click', {
    setPreview: el => setPreview(el.dataset.id || ''),
    confirmMapping: () => confirmMapping(),
    resetAll: () => invokeResetAll(),
  });
}
