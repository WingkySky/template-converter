// 导出面板 · 预览表格 —— 自 src/legacy.js 逐字搬移（阶段 3 分区 D）。
// 原 legacy.js 锚点：visiblePreviewRowCount L1686、showMorePreviewRows L1690、
// showAllPreviewRows L1696、collapsePreviewRows L1701；renderPreviewTable() 为
// showExportStep（L1112）中「预览表格渲染」段（headHTML/bodyHTML/分页按钮，
// L1194-1266 + 表格容器 L1476-1478）的等价拆出，行文逐字保真。
// 唯一渲染差异：内联 onclick/onchange/oninput → data-action + data-*（事件委托）。
// showExportStep 依赖经 set/init 注入（不 import legacy.js、不挂 window）。
// 注：renderPreviewTable 内需要的 allPlatforms/allTaxSources 按原 L1170-1176 的
// 取数路径（loadKB + getConfigLists/uniqueTaxSources）重算，值与原一致。
import { state, DEFAULT_PREVIEW_ROW_LIMIT, PREVIEW_ROW_INCREMENT } from '../../state';
import { escapeHTML, delegateAction, byId } from '../dom';
import { getTasksForShangShe } from '../legacy-bridge';
import { loadKB } from '../../io/kb-storage';
import { getConfigLists } from '../../core/kb/model';
import { uniqueTaxSources } from '../../core/kb/tax-source';
import { getColumnUniqueValues } from '../column-filter';

export function visiblePreviewRowCount(): number {
  return Math.min((state.outputRows || []).length, Math.max(DEFAULT_PREVIEW_ROW_LIMIT, Number(state.previewRowLimit) || DEFAULT_PREVIEW_ROW_LIMIT));
}

export function showMorePreviewRows(): void {
  const total = (state.outputRows || []).length;
  state.previewRowLimit = Math.min(total, visiblePreviewRowCount() + PREVIEW_ROW_INCREMENT);
  showExportStep();
}

export function showAllPreviewRows(): void {
  state.previewRowLimit = (state.outputRows || []).length;
  showExportStep();
}

export function collapsePreviewRows(): void {
  state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
  showExportStep();
}

/** 预览表格 HTML 片段（含筛选表头、云杉模版下拉列、备注输入列、分页按钮）。 */
export function renderPreviewTable(): string {
  const headers = state.outputHeaders!;
  const rows = state.outputRows!;
  const unmatchedSet = new Set(state.unmatchedRows || []);
  const noteColIdx = headers.findIndex(h => /备注|note|说明|remark/i.test(String(h || '')));
  const hasNoteColumn = noteColIdx >= 0;
  const selectedNoteSet = new Set(state.selectedNoteRows || []);

  // 云杉模版：找到商社编号列索引用于高亮
  const shangSheColIdx = (state.targetTemplate === 'youyi') ? headers.indexOf('商社编号') : -1;

  // 云杉模版：获取平台和任务清单数据用于下拉框
  const isYouyi = state.targetTemplate === 'youyi';
  let allPlatforms: string[] = [];
  let allTaxSources: string[] = [];
  if (isYouyi) {
    const config = getConfigLists(loadKB());
    allPlatforms = config.platforms;
    allTaxSources = uniqueTaxSources(config.taxSources);
  }

  const previewLimit = Math.max(DEFAULT_PREVIEW_ROW_LIMIT, Number(state.previewRowLimit) || DEFAULT_PREVIEW_ROW_LIMIT);
  const pv = Math.min(rows.length, previewLimit);
  let headHTML = headers.map((h, ci) => {
    const hasFilter = state.columnFilters[ci] && state.columnFilters[ci].size < getColumnUniqueValues(ci).length;
    return `<th><span>${escapeHTML(h)}</span><button class="col-filter-btn${hasFilter ? ' active' : ''}" title="筛选" data-action="toggleColumnFilter" data-col-idx="${ci}">🔽</button></th>`;
  }).join('');
  if (hasNoteColumn) {
    const allVisibleSelected = visiblePreviewRowCount() > 0 && Array.from({ length: visiblePreviewRowCount() }, (_, i) => i).every(i => selectedNoteSet.has(i));
    headHTML = `<th style="width:44px;text-align:center;"><input type="checkbox" id="select-all-visible-checkbox" title="选择当前预览行" ${allVisibleSelected ? 'checked' : ''} data-action="toggleVisibleNoteRows"></th>` + headHTML;
  }
  let bodyHTML = '';
  for (let ri = 0; ri < pv; ri++) {
    const isUnmatched = unmatchedSet.has(ri);
    const rowClass = isUnmatched ? ' class="unmatched-row"' : '';
    let rowHTML = '';
    if (hasNoteColumn) {
      rowHTML += `<td style="text-align:center;"><input type="checkbox" data-row-idx="${ri}" ${selectedNoteSet.has(ri) ? 'checked' : ''} data-action="toggleNoteRow"></td>`;
    }
    rowHTML += rows[ri].map((c, ci) => {
      let cellContent = c ? escapeHTML(c) : '<span style="color:var(--text2);opacity:0.4;">—</span>';

      // 云杉模版：平台列显示下拉框
      if (isYouyi && ci === state.colIndex.platform) {
        const currentVal = c || '';
        let optionsHTML = '<option value="">未选择</option>';
        for (const p of allPlatforms) {
          optionsHTML += `<option value="${escapeHTML(p)}" ${p === currentVal ? 'selected' : ''}>${escapeHTML(p)}</option>`;
        }
        cellContent = `<select data-row-idx="${ri}" data-col-idx="${ci}" data-action="onPlatformChange">${optionsHTML}</select>`;
      }
      // 云杉模版：任务清单列显示下拉框
      else if (isYouyi && ci === state.colIndex.taskList) {
        const currentVal = c || '';
        const shangSheId = (rows[ri][state.colIndex.shangSheId] || '') as string;
        const matchedTasks = getTasksForShangShe(shangSheId);
        let optionsHTML = '<option value="">未选择</option>';
        for (const task of matchedTasks) {
          optionsHTML += `<option value="${escapeHTML(task.fullString)}" ${task.fullString === currentVal ? 'selected' : ''}>${escapeHTML(task.fullString)}</option>`;
        }
        cellContent = `<select data-row-idx="${ri}" data-col-idx="${ci}" data-action="onTaskChange">${optionsHTML}</select>`;
      }
      // 云杉模版：税源地列显示下拉框，允许手动覆盖平台预匹配结果
      else if (isYouyi && ci === state.colIndex.taxSource) {
        const currentVal = c || '';
        let optionsHTML = '<option value="">未选择</option>';
        for (const taxSource of allTaxSources) {
          optionsHTML += `<option value="${escapeHTML(taxSource)}" ${taxSource === currentVal ? 'selected' : ''}>${escapeHTML(taxSource)}</option>`;
        }
        cellContent = `<select data-row-idx="${ri}" data-col-idx="${ci}" data-action="onTaxSourceChange">${optionsHTML}</select>`;
      }
      // 未匹配行的商社编号列添加"未匹配"标记
      else if (isUnmatched && ci === shangSheColIdx && c) {
        cellContent = escapeHTML(c) + '<span class="unmatched-badge">未匹配</span>';
      }
      // 备注列：允许单行直接编辑
      else if (ci === noteColIdx) {
        cellContent = `<input class="note-input" data-row-idx="${ri}" data-col-idx="${ci}" value="${escapeHTML(c || '')}" placeholder="填写备注" data-action="onNoteChange">`;
      }
      return `<td>${cellContent}</td>`;
    }).join('');
    bodyHTML += `<tr data-row-idx="${ri}"${rowClass}>${rowHTML}</tr>`;
  }
  const hiddenRowCount = rows.length - pv;
  if (rows.length > DEFAULT_PREVIEW_ROW_LIMIT) {
    const previewControls = `
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;">
        <span style="color:var(--text2);font-size:12px;">已预览 ${pv} / ${rows.length} 行${hiddenRowCount > 0 ? `，还有 ${hiddenRowCount} 行` : ''}</span>
        ${hiddenRowCount > 0 ? `<button class="btn btn-secondary btn-sm" data-action="showMorePreviewRows">预览更多</button>` : ''}
        ${hiddenRowCount > 0 ? `<button class="btn btn-secondary btn-sm" data-action="showAllPreviewRows">全部展开</button>` : ''}
        ${pv > DEFAULT_PREVIEW_ROW_LIMIT ? `<button class="btn btn-secondary btn-sm" data-action="collapsePreviewRows">收起预览</button>` : ''}
      </div>`;
    bodyHTML += `<tr><td colspan="${headers.length + (hasNoteColumn ? 1 : 0)}" style="text-align:center;padding:12px;">${previewControls}</td></tr>`;
  }
  return `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:16px;">
      <table class="result-table"><thead><tr>${headHTML}</tr></thead><tbody>${bodyHTML}</tbody></table>
    </div>`;
}

// ---- 依赖注入（showExportStep 仍留在 legacy.js / 后续 steps/export.ts，本模块不反向 import） ----
export interface PreviewTableDeps {
  showExportStep(): void;
}

let showExportStep: () => void = () => {
  throw new Error('preview-table: showExportStep 依赖未注入（先调用 setPreviewTableDeps / initPreviewTableHandlers）');
};

export function setPreviewTableDeps(deps: PreviewTableDeps): void {
  showExportStep = deps.showExportStep;
}

/**
 * 事件委托接线：#export-content 上监听 click，分发预览表格里的分页按钮。
 * 表格内其余 data-action（toggleNoteRow/toggleVisibleNoteRows/onNoteChange/onPlatformChange/
 * onTaskChange/onTaxSourceChange/toggleColumnFilter）分别由 remark-panel/controls/column-filter
 * 的 init 接线。必须在 DOM 就绪后调用。
 */
export function initPreviewTableHandlers(deps: PreviewTableDeps): void {
  setPreviewTableDeps(deps);
  const container = byId('export-content');
  delegateAction(container, 'click', {
    showMorePreviewRows: () => showMorePreviewRows(),
    showAllPreviewRows: () => showAllPreviewRows(),
    collapsePreviewRows: () => collapsePreviewRows(),
  });
}
