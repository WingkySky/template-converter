// 导出面板 · 备注编辑/行选择 —— 自 src/legacy.js 逐字搬移（阶段 3 分区 D）。
// 原 legacy.js 锚点：getNoteColIdx L1682、setSelectedNoteRows L1706、toggleNoteRow L1711、
// toggleVisibleNoteRows L1719、selectVisibleNoteRows L1729、selectAllNoteRows L1736、
// clearNoteRowSelection L1741、updateNoteSelectionUI L1747、onNoteChange L1772、
// onNotePresetChange L1778、applyBatchRemark L1795、clearSelectedRemarks L1828；
// renderRemarkPanel() 为 showExportStep（L1112）中「批量备注工具条」段
// （noteControlsHTML，L1423-1446）的等价拆出，行文逐字保真。
// 唯一渲染差异：内联 onclick/onchange/oninput → data-action（事件委托）。
// showExportStep 依赖经 set/init 注入（不 import legacy.js、不挂 window）。
import { state } from '../../state';
import { delegateAction, byId } from '../dom';
import { updateOutputRow, getRemarkPresetValue } from '../legacy-bridge';
import { visiblePreviewRowCount } from './preview-table';

export function getNoteColIdx(): number {
  return (state.outputHeaders || []).findIndex(h => /备注|note|说明|remark/i.test(String(h || '')));
}

export function setSelectedNoteRows(rows: number[]): void {
  const max = (state.outputRows || []).length;
  state.selectedNoteRows = Array.from(new Set(rows.filter(i => i >= 0 && i < max))).sort((a, b) => a - b);
}

export function toggleNoteRow(rowIdx: number, checked: boolean): void {
  const selected = new Set(state.selectedNoteRows || []);
  if (checked) selected.add(rowIdx);
  else selected.delete(rowIdx);
  setSelectedNoteRows(Array.from(selected));
  updateNoteSelectionUI();
}

export function toggleVisibleNoteRows(checked: boolean): void {
  const selected = new Set(state.selectedNoteRows || []);
  for (let i = 0; i < visiblePreviewRowCount(); i++) {
    if (checked) selected.add(i);
    else selected.delete(i);
  }
  setSelectedNoteRows(Array.from(selected));
  updateNoteSelectionUI();
}

export function selectVisibleNoteRows(): void {
  const selected = new Set(state.selectedNoteRows || []);
  for (let i = 0; i < visiblePreviewRowCount(); i++) selected.add(i);
  setSelectedNoteRows(Array.from(selected));
  updateNoteSelectionUI();
}

export function selectAllNoteRows(): void {
  setSelectedNoteRows((state.outputRows || []).map((_, i) => i));
  updateNoteSelectionUI();
}

export function clearNoteRowSelection(): void {
  state.selectedNoteRows = [];
  updateNoteSelectionUI();
}

// 局部更新备注行选择的 UI（复选框状态和计数），不触发全量重渲染
export function updateNoteSelectionUI(): void {
  const container = document.getElementById('export-content');
  if (!container) return;
  const selectedSet = new Set(state.selectedNoteRows || []);
  const pv = visiblePreviewRowCount();

  // 更新每行复选框的 checked 状态
  const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-row-idx]');
  checkboxes.forEach(cb => {
    const ri = parseInt(cb.dataset.rowIdx!, 10);
    if (!isNaN(ri)) cb.checked = selectedSet.has(ri);
  });

  // 更新表头全选复选框
  const headerCb = document.getElementById('select-all-visible-checkbox') as HTMLInputElement | null;
  if (headerCb) {
    const allVisibleSelected = pv > 0 && Array.from({ length: pv }, (_, i) => i).every(i => selectedSet.has(i));
    headerCb.checked = allVisibleSelected;
  }

  // 更新已选行数
  const countEl = document.getElementById('selected-note-count');
  if (countEl) countEl.textContent = String(selectedSet.size);
}

export function onNoteChange(inputEl: HTMLInputElement, rowIdx: number): void {
  const noteIdx = getNoteColIdx();
  if (noteIdx < 0 || !state.outputRows?.[rowIdx]) return;
  updateOutputRow(rowIdx, noteIdx, inputEl.value);
}

export function onNotePresetChange(): void {
  const preset = (document.getElementById('note-preset') as HTMLSelectElement | null)?.value || '';
  const custom = document.getElementById('note-custom-text');
  if (custom) custom.classList.toggle('hidden', preset !== 'custom');
}

export function applyBatchRemark(): void {
  const noteIdx = getNoteColIdx();
  if (noteIdx < 0) {
    alert('当前模版没有备注列');
    return;
  }
  const selected = state.selectedNoteRows || [];
  if (!selected.length) {
    alert('请先选择要添加备注的记录，或点击“全选全部记录”');
    return;
  }
  const preset = (document.getElementById('note-preset') as HTMLSelectElement | null)?.value || 'filename';
  const mode = (document.getElementById('note-write-mode') as HTMLSelectElement | null)?.value || 'replace';
  if (preset === 'custom' && !(document.getElementById('note-custom-text') as HTMLInputElement | null)?.value.trim()) {
    alert('请输入自定义备注');
    return;
  }

  selected.forEach(rowIdx => {
    const row = state.outputRows![rowIdx];
    if (!row) return;
    const nextVal = getRemarkPresetValue(rowIdx, preset);
    if (!nextVal) return;
    if (mode === 'append' && row[noteIdx]) {
      updateOutputRow(rowIdx, noteIdx, `${row[noteIdx]} ${nextVal}`.trim());
    } else {
      updateOutputRow(rowIdx, noteIdx, nextVal);
    }
  });

  showExportStep();
}

export function clearSelectedRemarks(): void {
  const noteIdx = getNoteColIdx();
  if (noteIdx < 0) {
    alert('当前模版没有备注列');
    return;
  }
  const selected = state.selectedNoteRows || [];
  if (!selected.length) {
    alert('请先选择要清空备注的记录，或点击“全选全部记录”');
    return;
  }

  selected.forEach(rowIdx => {
    const row = state.outputRows?.[rowIdx];
    if (row) updateOutputRow(rowIdx, noteIdx, '');
  });

  showExportStep();
}

/** 批量备注工具条 HTML 片段（原 noteControlsHTML）。 */
export function renderRemarkPanel(): string {
  const rows = state.outputRows!;
  const noteColIdx = getNoteColIdx();
  const hasNoteColumn = noteColIdx >= 0;
  const selectedNoteSet = new Set(state.selectedNoteRows || []);

  let noteControlsHTML = '';
  if (hasNoteColumn && rows.length > 0) {
    noteControlsHTML = `
    <div class="note-toolbar">
      <span style="font-size:13px;font-weight:600;color:var(--text2);">批量备注:</span>
      <button class="btn btn-secondary btn-sm" data-action="selectVisibleNoteRows">选择当前预览</button>
      <button class="btn btn-secondary btn-sm" data-action="selectAllNoteRows">全选全部记录</button>
      <button class="btn btn-secondary btn-sm" data-action="clearNoteRowSelection">清除选择</button>
      <span style="font-size:12px;color:var(--text2);">已选 <strong id="selected-note-count" style="color:var(--accent2);">${selectedNoteSet.size}</strong> 行</span>
      <select id="note-preset" data-action="onNotePresetChange">
        <option value="filename">文件名</option>
        <option value="date">日期</option>
        <option value="shangshe">商社简称</option>
        <option value="custom">自定义</option>
      </select>
      <input id="note-custom-text" class="hidden" placeholder="输入自定义备注">
      <select id="note-write-mode" title="写入方式">
        <option value="replace">覆盖备注</option>
        <option value="append">追加备注</option>
      </select>
      <button class="btn btn-primary btn-sm" data-action="applyBatchRemark">应用备注</button>
      <button class="btn btn-red btn-sm" data-action="clearSelectedRemarks">清空备注</button>
    </div>`;
  }
  return noteControlsHTML;
}

// ---- 依赖注入（showExportStep 仍留在 legacy.js / 后续 steps/export.ts，本模块不反向 import） ----
export interface RemarkPanelDeps {
  showExportStep(): void;
}

let showExportStep: () => void = () => {
  throw new Error('remark-panel: showExportStep 依赖未注入（先调用 setRemarkPanelDeps / initRemarkPanelHandlers）');
};

export function setRemarkPanelDeps(deps: RemarkPanelDeps): void {
  showExportStep = deps.showExportStep;
}

/**
 * 事件委托接线：#export-content 上监听 click/change/input，
 * 分发备注工具条与预览表格备注列的 data-action。必须在 DOM 就绪后调用。
 */
export function initRemarkPanelHandlers(deps: RemarkPanelDeps): void {
  setRemarkPanelDeps(deps);
  const container = byId('export-content');
  delegateAction(container, 'click', {
    selectVisibleNoteRows: () => selectVisibleNoteRows(),
    selectAllNoteRows: () => selectAllNoteRows(),
    clearNoteRowSelection: () => clearNoteRowSelection(),
    applyBatchRemark: () => applyBatchRemark(),
    clearSelectedRemarks: () => clearSelectedRemarks(),
  });
  delegateAction(container, 'change', {
    toggleNoteRow: (el) => toggleNoteRow(Number(el.dataset.rowIdx), (el as HTMLInputElement).checked),
    toggleVisibleNoteRows: (el) => toggleVisibleNoteRows((el as HTMLInputElement).checked),
    onNotePresetChange: () => onNotePresetChange(),
  });
  delegateAction(container, 'input', {
    onNoteChange: (el) => onNoteChange(el as HTMLInputElement, Number(el.dataset.rowIdx)),
  });
}
