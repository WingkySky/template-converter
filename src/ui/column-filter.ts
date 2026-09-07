// 导出面板 · 列筛选 —— 自 src/legacy.js 逐字搬移（阶段 3 分区 D）。
// 原 legacy.js 锚点：normalizeSearchText L915、getColumnUniqueValues L920、
// _activeFilterCol L929、toggleColumnFilter L931、closeAllFilterPanels L973、
// closeFilterOnOutsideClick L979、filterFilterList L987、toggleFilterSelectAll L998、
// toggleFilterValue L1004、applyColumnFilter L1008、resetColumnFilter L1033、
// clearAllColumnFilters L1041、applyColumnFilters L1048、updateFilterSummary L1087。
// 唯一渲染差异：内联 onclick/onchange/oninput → data-action + data-*（事件委托，
// 见 dom.ts delegateAction）；applyColumnFilters 中按 onclick 正则识别列号的逻辑
// 相应改为读 data-action/data-col-idx。其余逐字保真。
import { state } from '../state';
import { escapeHTML, delegateAction, byId } from './dom';

export function normalizeSearchText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function getColumnUniqueValues(colIdx: number): string[] {
  const values = new Set<string>();
  for (const row of state.outputRows || []) {
    const v = row[colIdx];
    values.add(v != null ? String(v) : '');
  }
  return Array.from(values).sort();
}

let _activeFilterCol = -1;

export function toggleColumnFilter(event: Event, colIdx: number): void {
  event.stopPropagation();
  closeAllFilterPanels();
  if (_activeFilterCol === colIdx) {
    _activeFilterCol = -1;
    return;
  }
  _activeFilterCol = colIdx;
  const th = (event.target as HTMLElement).closest('th');
  if (!th) return;
  const panel = document.createElement('div');
  panel.className = 'col-filter-panel';
  panel.id = 'col-filter-panel';
  const uniqueValues = getColumnUniqueValues(colIdx);
  const currentFilter = state.columnFilters[colIdx];
  const allChecked = !currentFilter || currentFilter.size === uniqueValues.length;

  panel.innerHTML = `
    <input class="filter-search" placeholder="搜索..." data-action="filterFilterList" data-col-idx="${colIdx}">
    <div style="display:flex;align-items:center;gap:6px;padding:2px 4px;">
      <input type="checkbox" id="filter-select-all" ${allChecked ? 'checked' : ''} data-action="toggleFilterSelectAll" data-col-idx="${colIdx}">
      <label for="filter-select-all" style="font-size:12px;color:var(--text2);cursor:pointer;">全选/取消全选</label>
    </div>
    <div class="filter-list" id="filter-value-list">
      ${uniqueValues.map(v => {
        const checked = !currentFilter || currentFilter.has(v);
        return `<div class="filter-item" data-value="${escapeHTML(v)}">
          <input type="checkbox" ${checked ? 'checked' : ''} data-action="toggleFilterValue" data-col-idx="${colIdx}" data-value="${escapeHTML(v)}">
          <span class="filter-value" title="${escapeHTML(v)}">${v ? escapeHTML(v) : '<span style="color:var(--text2);opacity:0.5;">(空)</span>'}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="filter-actions">
      <button data-action="resetColumnFilter" data-col-idx="${colIdx}">重置</button>
      <button data-action="applyColumnFilter" data-col-idx="${colIdx}">确定</button>
    </div>`;
  th.style.position = 'relative';
  th.appendChild(panel);
  setTimeout(() => document.addEventListener('click', closeFilterOnOutsideClick), 0);
}

export function closeAllFilterPanels(): void {
  const panel = document.getElementById('col-filter-panel');
  if (panel) panel.remove();
  document.removeEventListener('click', closeFilterOnOutsideClick);
}

export function closeFilterOnOutsideClick(e: Event): void {
  const panel = document.getElementById('col-filter-panel');
  if (panel && !panel.contains(e.target as Node) && !(e.target as HTMLElement).classList.contains('col-filter-btn')) {
    closeAllFilterPanels();
    _activeFilterCol = -1;
  }
}

export function filterFilterList(searchText: string, colIdx: number): void {
  const list = document.getElementById('filter-value-list');
  if (!list) return;
  const items = list.querySelectorAll<HTMLElement>('.filter-item');
  const lower = searchText.toLowerCase();
  items.forEach(item => {
    const value = item.dataset.value || '';
    item.style.display = !searchText || value.toLowerCase().includes(lower) ? '' : 'none';
  });
}

export function toggleFilterSelectAll(colIdx: number, checked: boolean): void {
  const list = document.getElementById('filter-value-list');
  if (!list) return;
  list.querySelectorAll<HTMLInputElement>('.filter-item input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
}

export function toggleFilterValue(colIdx: number, value: string, checked: boolean): void {
  // 即时更新复选框状态，但不立即应用筛选
}

export function applyColumnFilter(colIdx: number): void {
  const list = document.getElementById('filter-value-list');
  if (!list) return;
  const checkboxes = list.querySelectorAll<HTMLInputElement>('.filter-item input[type="checkbox"]');
  const uncheckedValues = new Set<string>();
  checkboxes.forEach(cb => {
    if (!cb.checked) {
      const value = (cb.closest('.filter-item') as HTMLElement).dataset.value;
      uncheckedValues.add(value!);
    }
  });

  if (uncheckedValues.size === 0) {
    delete state.columnFilters[colIdx];
  } else {
    const uniqueValues = getColumnUniqueValues(colIdx);
    state.columnFilters[colIdx] = new Set(uniqueValues.filter(v => !uncheckedValues.has(v)));
  }

  closeAllFilterPanels();
  _activeFilterCol = -1;
  applyColumnFilters();
  updateFilterSummary();
}

export function resetColumnFilter(colIdx: number): void {
  delete state.columnFilters[colIdx];
  closeAllFilterPanels();
  _activeFilterCol = -1;
  applyColumnFilters();
  updateFilterSummary();
}

export function clearAllColumnFilters(): void {
  state.columnFilters = {};
  applyColumnFilters();
  updateFilterSummary();
  document.querySelectorAll('.col-filter-btn.active').forEach(btn => btn.classList.remove('active'));
}

export function applyColumnFilters(): void {
  const tbody = document.querySelector('#export-content .result-table tbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll<HTMLElement>('tr[data-row-idx]');
  const filters = state.columnFilters;
  const hasAnyFilter = Object.keys(filters).length > 0;

  rows.forEach(tr => {
    const ri = parseInt(tr.dataset.rowIdx!);
    if (isNaN(ri)) return;
    const row = state.outputRows?.[ri];
    if (!row) return;

    let visible = true;
    if (hasAnyFilter) {
      for (const [colIdxStr, allowedSet] of Object.entries(filters)) {
        const ci = parseInt(colIdxStr);
        const cellValue = row[ci] != null ? String(row[ci]) : '';
        if (!allowedSet.has(cellValue)) {
          visible = false;
          break;
        }
      }
    }
    tr.style.display = visible ? '' : 'none';
  });

  // 更新表头筛选按钮的 active 状态（原按 onclick 属性正则取列号，现读 data-*）
  document.querySelectorAll<HTMLElement>('.col-filter-btn').forEach(btn => {
    if (btn.dataset.action === 'toggleColumnFilter') {
      const colIdx = parseInt(btn.dataset.colIdx || '');
      const hasFilter = filters[colIdx] && filters[colIdx].size < getColumnUniqueValues(colIdx).length;
      btn.classList.toggle('active', !!hasFilter);
    }
  });
}

export function updateFilterSummary(): void {
  const filters = state.columnFilters;
  const headers = state.outputHeaders || [];
  const summaryEl = document.getElementById('filter-summary');
  if (!summaryEl) return;

  const entries = Object.entries(filters);
  if (entries.length === 0) {
    summaryEl.innerHTML = '';
    return;
  }

  let html = '<span style="color:var(--text2);">🔍 筛选:</span>';
  for (const [colIdxStr, allowedSet] of entries) {
    const ci = parseInt(colIdxStr);
    const colName = headers[ci] || `列${ci+1}`;
    const total = getColumnUniqueValues(ci).length;
    const selected = allowedSet.size;
    html += `<span class="filter-tag">${escapeHTML(colName)}: ${selected}/${total}<button data-action="resetColumnFilter" data-col-idx="${ci}">✕</button></span>`;
  }
  html += `<button class="clear-all-btn" data-action="clearAllColumnFilters">清除全部</button>`;
  summaryEl.innerHTML = html;
}

/**
 * 事件委托接线：#export-content 上监听 click/change/input，
 * 把本模块渲染产物中的 data-action 分发到对应函数。
 * 必须在 DOM 就绪后调用（main.ts 统一装配）。
 */
export function initColumnFilterHandlers(): void {
  const container = byId('export-content');
  delegateAction(container, 'click', {
    toggleColumnFilter: (el, e) => toggleColumnFilter(e, Number(el.dataset.colIdx)),
    resetColumnFilter: (el) => resetColumnFilter(Number(el.dataset.colIdx)),
    applyColumnFilter: (el) => applyColumnFilter(Number(el.dataset.colIdx)),
    clearAllColumnFilters: () => clearAllColumnFilters(),
  });
  delegateAction(container, 'change', {
    toggleFilterSelectAll: (el) => toggleFilterSelectAll(Number(el.dataset.colIdx), (el as HTMLInputElement).checked),
    toggleFilterValue: (el) => toggleFilterValue(Number(el.dataset.colIdx), el.dataset.value || '', (el as HTMLInputElement).checked),
  });
  delegateAction(container, 'input', {
    filterFilterList: (el) => filterFilterList((el as HTMLInputElement).value, Number(el.dataset.colIdx)),
  });
}

/** 点击面板外部时关闭筛选面板（由 main.ts 在装配时调用一次）。 */
export function initColumnFilterOutsideClick(): void {
  document.addEventListener('click', closeFilterOnOutsideClick);
}
