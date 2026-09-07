// 导出面板 · 导出控件区 —— 自 src/legacy.js 逐字搬移（阶段 3 分区 D）。
// 原 legacy.js 锚点：onPlatformChange L1527、onTaxSourceChange L1538、onTaskChange L1543、
// applyPlatformToAll L1558、onBatchNoChange L1580、onExportModeChange L1585、
// onSplitBatchNoChange L1593、onSbyOptionChange L1599、applyBatchShangSheFromSelection L1607、
// applyManualShangShe L1637；renderExportControls() 为 showExportStep（L1112）中
// 「导出控件面板」段（kbMatchHTML L1269-1274、splitModeHTML L1276-1301、splitBatchHTML
// L1303-1334、batchNoHTML L1336-1357、manualShangSheHTML L1359-1387、batchControlsHTML
// L1389-1404、sbyOptionsHTML L1406-1421、cleanCount 提示 L1472）的等价拆出，行文逐字保真，
// 返回串按原 skeleton（L1462-1487）中的出现顺序拼装，保证 DOM 顺序不变。
// 唯一渲染差异：内联 onclick/onchange/oninput/onfocus → data-action + data-*（事件委托）。
// 仍留在 legacy.js 的编排函数（showExportStep/cacheCurrentTemplateOutput/getSelectedTemplates/
// getSplitGroups/getSplitGroupCounts/isSplitExportActive/ensureSplitBatches）经 set/init 注入，
// 不 import legacy.js、不挂 window。
import { state, type AppState } from '../../state';
import { icon } from '../icons';
import { escapeHTML, delegateAction, byId } from '../dom';
import {
  updateOutputRow, taxSourceForPlatform, getTasksForShangShe, applyBatchShangShe,
  fillShangSheInfoForRow, lookupShangShe, splitGroupLabelBridge,
} from '../steps/export';
import { parseTaskString, inferWorkType } from '../../core/kb/task';
import type { FillRowContext } from '../../core/kb/shangshe-fill';
import type { SplitGroup } from '../../core/export/split-core';
import { createShangSheSearchHTML } from '../search-dropdown';
import { initColumnFilterHandlers, initColumnFilterOutsideClick } from '../column-filter';
import { initSearchDropdownHandlers, initSearchDropdownOutsideClick } from '../search-dropdown';
import { initPreviewTableHandlers } from './preview-table';
import { initRemarkPanelHandlers } from './remark-panel';

// 平台切换处理（保留兼容）
export function onPlatformChange(selectEl: HTMLSelectElement, rowIdx: number): void {
  const newVal = selectEl.value;
  updateOutputRow(rowIdx, state.colIndex.platform, newVal);

  const taxSource = taxSourceForPlatform(newVal);
  if (taxSource) {
    updateOutputRow(rowIdx, state.colIndex.taxSource, taxSource);
  }
  showExportStep();
}

export function onTaxSourceChange(selectEl: HTMLSelectElement, rowIdx: number): void {
  updateOutputRow(rowIdx, state.colIndex.taxSource, selectEl.value);
}

// 任务切换处理
export function onTaskChange(selectEl: HTMLSelectElement, rowIdx: number): void {
  const newVal = selectEl.value;
  updateOutputRow(rowIdx, state.colIndex.taskList, newVal);

  // 根据任务名称、服务内容和源行备注推断工种
  if (newVal) {
    const parsed = parseTaskString(newVal);
    const shangSheId = (parsed?.shangSheId || state.outputRows![rowIdx][state.colIndex.shangSheId] || '') as string;
    const task = getTasksForShangShe(shangSheId).find(t => t.fullString === newVal) || parsed || newVal;
    const rowContext = (state.outputRowMeta?.[rowIdx] || {}) as FillRowContext;
    updateOutputRow(rowIdx, state.colIndex.workType, inferWorkType(task, rowContext.rawRow, rowContext.typeToCol));
  }
}

// 批量设置平台到所有行
export function applyPlatformToAll(): void {
  const hidden = document.getElementById('platform-selected-val') as HTMLInputElement | null;
  const platformVal = hidden ? hidden.value : '';
  if (!platformVal) {
    alert('请先选择一个平台');
    return;
  }

  const taxSource = taxSourceForPlatform(platformVal);

  // 应用到所有行
  for (let i = 0; i < state.outputRows!.length; i++) {
    updateOutputRow(i, state.colIndex.platform, platformVal);
    if (taxSource) {
      updateOutputRow(i, state.colIndex.taxSource, taxSource);
    }
  }

  // 刷新预览
  showExportStep();
}

export function onBatchNoChange(inputEl: HTMLInputElement): void {
  state.batchNo = String(inputEl.value || '').trim();
  cacheCurrentTemplateOutput();
}

export function onExportModeChange(mode: AppState['exportMode']): void {
  state.exportMode = mode;
  if (mode !== 'merge' && getSelectedTemplates().includes('shenbianyun')) {
    ensureSplitBatches(getSplitGroups());
  }
  showExportStep();
}

export function onSplitBatchNoChange(inputEl: HTMLInputElement): void {
  const key = inputEl.dataset.groupKey;
  if (!key || !state.splitBatches[key]) return;
  state.splitBatches[key].batchNo = String(inputEl.value || '').trim();
}

export function onSbyOptionChange(): void {
  const showBatchEl = document.getElementById('sby-show-batch-info') as HTMLInputElement | null;
  const plainAmountEl = document.getElementById('sby-plain-amount') as HTMLInputElement | null;
  // state.ts 的 satisfies 使这两个布尔字段被收窄为字面量类型，改经 Object.assign 写入（语义不变）
  Object.assign(state, {
    sbyShowBatchInfo: showBatchEl ? showBatchEl.checked : false,
    sbyPlainAmount: plainAmountEl ? plainAmountEl.checked : true,
  });
  cacheCurrentTemplateOutput();
}

export function applyBatchShangSheFromSelection(): void {
  const hidden = document.getElementById('batch-shangshe-selected-id') as HTMLInputElement | null;
  const batchInput = document.getElementById('batch-no-input') as HTMLInputElement | null;
  const selectedId = hidden ? hidden.value : '';
  if (!selectedId) {
    alert('请先选择一个商社');
    return;
  }
  const lookup = lookupShangShe(selectedId);
  if (!lookup) {
    alert('未找到该商社的信息');
    return;
  }
  // 读取用户可能手动编辑过的批次号
  const editedBatchNo = batchInput ? String(batchInput.value || '').trim() : '';
  applyBatchShangShe(lookup, selectedId);
  // 如果用户手动编辑过批次号，以用户编辑的为准
  if (editedBatchNo && editedBatchNo !== state.batchNo) {
    state.batchNo = editedBatchNo;
  }
  cacheCurrentTemplateOutput();
  showExportStep();
}

// 手动匹配商社 - 将选中的商社信息应用到所有未匹配行
export function applyManualShangShe(): void {
  const hidden = document.getElementById('manual-shangshe-selected-id') as HTMLInputElement | null;
  const selectedId = hidden ? hidden.value : '';
  if (!selectedId) {
    alert('请先选择一个商社');
    return;
  }

  const lookup = lookupShangShe(selectedId);
  if (!lookup) {
    alert('未找到该商社的信息');
    return;
  }

  const headers = state.outputHeaders!;
  const shangSheIdx = headers.indexOf('商社编号');   // 2
  const platformIdx = headers.indexOf('平台');       // 1
  const taskListIdx = headers.indexOf('任务清单');   // 6
  const taxSourceIdx = headers.indexOf('税源地');    // 7
  const workTypeIdx = headers.indexOf('工种');       // 8

  const unmatchedSet = new Set(state.unmatchedRows || []);

  const colIndex = { platform: platformIdx, taxSource: taxSourceIdx, taskList: taskListIdx, workType: workTypeIdx };

  // 对所有未匹配行应用商社信息
  state.outputRows!.forEach((out, rowIdx) => {
    if (!unmatchedSet.has(rowIdx)) return;

    // 填充商社编号
    if (shangSheIdx >= 0) {
      updateOutputRow(rowIdx, shangSheIdx, selectedId);
    }
    // 填充平台、税源地、任务清单、工种
    const rowContext = (state.outputRowMeta?.[rowIdx] || {}) as FillRowContext;
    fillShangSheInfoForRow(out, lookup, colIndex, (idx, val) => { updateOutputRow(rowIdx, idx, val); }, rowContext);
  });

  // 从未匹配列表中移除已处理的行
  state.unmatchedRows = state.unmatchedRows.filter(rowIdx => !unmatchedSet.has(rowIdx));

  // 刷新预览
  showExportStep();
}

/** 导出控件面板 HTML 片段（模式选择/匹配统计/拆分批次/商社批次号/身边云选项/手动匹配/批量平台）。 */
export function renderExportControls(): string {
  const rows = state.outputRows!;
  const unmatchedSet = new Set(state.unmatchedRows || []);

  // 云杉模版：显示知识库匹配统计
  const isYouyi = state.targetTemplate === 'youyi';
  let kbMatchHTML = '';
  if (isYouyi && unmatchedSet.size > 0) {
    kbMatchHTML = `<div class="status-msg info">${icon('alert', 14)} 知识库匹配：${rows.length - unmatchedSet.size}/${rows.length} 行已匹配，${unmatchedSet.size} 行商社编号未在知识库中找到（橙色高亮行）</div>`;
  } else if (isYouyi && rows.length > 0) {
    kbMatchHTML = `<div class="status-msg success">${icon('check', 14)} 知识库匹配：全部 ${rows.length} 行已成功匹配</div>`;
  }

  // ===== 拆分导出（一源一单）：模式选择 + 每份批次号 =====
  const splitCounts = getSplitGroupCounts();
  const splitActive = isSplitExportActive();
  const showSplitModePanel = rows.length > 0 && (splitCounts.byFile > 1 || splitCounts.bySheet > 1);
  let splitModeHTML = '';
  if (showSplitModePanel) {
    const mode = state.exportMode || 'merge';
    const radio = (value: string, label: string, count: number) => {
      const disabled = value !== 'merge' && count <= 1;
      return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:${disabled?'not-allowed':'pointer'};${disabled?'opacity:0.45;':''}">
        <input type="radio" name="export-mode" value="${value}" ${mode===value?'checked':''} ${disabled?'disabled':''} data-action="onExportModeChange" data-mode="${value}" style="accent-color:var(--accent);">
        ${label}${value!=='merge'&&count>1?`（${count} 份）`:''}
      </label>`;
    };
    const activeGroups = splitActive ? getSplitGroups().length : 0;
    splitModeHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${icon('package', 14)} 导出模式</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;">
        ${radio('merge', '合并为一份', 0)}
        ${radio('byFile', '按文件拆分', splitCounts.byFile)}
        ${radio('bySheet', '按数据表拆分', splitCounts.bySheet)}
      </div>
      ${splitActive ? `<div style="font-size:12px;color:var(--text2);margin-top:8px;">将生成 <strong style="color:var(--accent2);">${activeGroups}</strong> 个文件（与来源一一对应），打包为 ZIP 下载；命名规则：<strong>源文件名${state.exportMode==='bySheet'?'_工作表名':''}_模板名.xlsx</strong>。</div>` : ''}
    </div>`;
  }

  let splitBatchHTML = '';
  const showSplitBatchPanel = splitActive && getSelectedTemplates().includes('shenbianyun');
  if (showSplitBatchPanel) {
    const groups = getSplitGroups();
    ensureSplitBatches(groups);
    state.splitGroupList = groups as unknown as AppState['splitGroupList'];
    splitBatchHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${icon('tag', 14)} 每份批次号（拆分模式）</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:6px;">每份已按来源单独检测商社并生成批次号（同一商社多份时自动 -A/-B 区分），可搜索更换商社或直接修改批次号。</div>
      ${groups.map((g, gi) => {
        const b = state.splitBatches[g.key] || {};
        const status = b.shangSheName
          ? `<span style="color:var(--green);">✓ ${escapeHTML(b.shangSheName)}</span>`
          : '<span style="color:var(--orange);">未匹配到商社，可搜索选择</span>';
        return `
        <div style="display:grid;grid-template-columns:minmax(140px,1.1fr) minmax(200px,1.5fr) minmax(170px,1fr);gap:10px;align-items:center;padding:8px 0;${gi>0?'border-top:1px solid var(--border);':''}">
          <div style="min-width:0;" title="${escapeHTML(splitGroupLabelBridge(g))}（${g.rowIdxs.length} 行）">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(splitGroupLabelBridge(g))}</div>
            <div style="font-size:11px;color:var(--text2);">${g.rowIdxs.length} 行</div>
          </div>
          <div style="min-width:0;">
            <div style="font-size:11px;margin-bottom:3px;">${status}</div>
            ${createShangSheSearchHTML('split' + gi, '搜索商社（编号/名称/税号）...', b.shangSheName, b.shangSheId)}
          </div>
          <input data-group-key="${escapeHTML(g.key)}" value="${escapeHTML(b.batchNo || '')}" placeholder="批次号（可修改）"
            style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none;"
            data-action="onSplitBatchNoChange">
        </div>`;
      }).join('')}
    </div>`;
  }

  const supportsBatchNo = ['yidao', 'shenbianyun'].includes(state.targetTemplate as string);
  const shangSheCandidates = (state.shangSheCandidates || []).filter(Boolean);
  let batchNoHTML = '';
  if (supportsBatchNo && !splitActive) {
    const candidateHint = shangSheCandidates.length > 0
      ? `<div style="font-size:12px;color:var(--orange);margin-bottom:6px;">${icon('info', 12)} 已根据客户信息缩小范围，找到 ${shangSheCandidates.length} 个候选商社（也可搜索其他商社）</div>`
      : '';
    const batchStatus = state.batchShangSheName
      ? `已匹配商社：${escapeHTML(state.batchShangSheName)}`
      : '未自动匹配到商社，可手动搜索选择';
    batchNoHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${icon('tag', 14)} 商社与批次号</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;">${batchStatus}</div>
      ${candidateHint}
      <div style="display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr) auto;gap:10px;align-items:center;">
        ${createShangSheSearchHTML('batch', '输入编号、名称或税号搜索商社...', state.batchShangSheName, state.batchShangSheId)}
        <input id="batch-no-input" value="${escapeHTML(state.batchNo || '')}" placeholder="批次号"
          style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none;"
          data-action="onBatchNoChange">
        <button class="btn btn-primary btn-sm" data-action="applyBatchShangSheFromSelection">应用商社</button>
      </div>
    </div>`;
  }

  // 云杉模版：手动匹配商社选择器（仅在有未匹配行时显示）- 可搜索下拉框
  let manualShangSheHTML = '';
  if (isYouyi && unmatchedSet.size > 0) {
    // Build candidates: if we have narrowed candidates from auto-matching, show those first
    const candidateList = shangSheCandidates;

    const candidateHint = candidateList.length > 0
      ? `<div style="font-size:12px;color:var(--orange);margin-bottom:6px;">${icon('info', 12)} 已根据客户信息缩小范围，找到 ${candidateList.length} 个候选商社（也可搜索其他商社）</div>`
      : '';

    // 仅当唯一候选时预填搜索框，保留可切换的入口
    const defaultCandidate = candidateList.length === 1 ? candidateList[0] : null;

    manualShangSheHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">${icon('search', 14)} 手动匹配商社</div>
      ${candidateHint}
      <div style="position:relative;">
        <div style="display:flex;gap:10px;align-items:center;">
          <div style="flex:1;">
            ${createShangSheSearchHTML('manual', '输入编号、名称或税号搜索...', defaultCandidate?.label || '', defaultCandidate?.id || '')}
          </div>
          <button class="btn btn-primary btn-sm" data-action="applyManualShangShe">应用</button>
        </div>
      </div>
    </div>`;
  }

  // 云杉模版：批量设置平台控件 - 可搜索下拉框
  let batchControlsHTML = '';
  if (isYouyi && rows.length > 0) {
    batchControlsHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;position:relative;">
      <span style="font-size:13px;font-weight:600;color:var(--text2);">批量设置平台:</span>
      <div style="position:relative;min-width:200px;">
        <input type="text" id="platform-search" placeholder="搜索平台..."
          style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:6px 10px;color:var(--text);font-size:13px;outline:none;"
          data-action="filterPlatformList" autocomplete="off">
        <input type="hidden" id="platform-selected-val" value="">
        <div id="platform-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;margin-top:2px;max-height:200px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:6px;z-index:200;box-shadow:var(--shadow-pop);"></div>
      </div>
      <button class="btn btn-secondary btn-sm" data-action="applyPlatformToAll">应用到所有行</button>
    </div>`;
  }

  // 身边云导出选项
  let sbyOptionsHTML = '';
  if (state.targetTemplate === 'shenbianyun' || getSelectedTemplates().includes('shenbianyun')) {
    sbyOptionsHTML = `
    <div style="background:var(--surface2);border-radius:8px;padding:12px 16px;border:1px solid var(--border);margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">${icon('cloud', 14)} 身边云导出选项</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:8px;">
        <input type="checkbox" id="sby-show-batch-info" data-action="onSbyOptionChange" ${state.sbyShowBatchInfo?'checked':''} style="accent-color:var(--accent);">
        填写总笔数和总金额（不勾选则留空）
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
        <input type="checkbox" id="sby-plain-amount" data-action="onSbyOptionChange" ${state.sbyPlainAmount?'checked':''} style="accent-color:var(--accent);">
        金额使用纯数字格式（不带 ¥ 符号）
      </label>
    </div>`;
  }

  return `
    ${splitModeHTML}
    ${kbMatchHTML}
    ${splitBatchHTML}
    ${batchNoHTML}
    ${sbyOptionsHTML}
    ${manualShangSheHTML}
    ${state.cleanCount > 0 ? `<div class="status-msg info">${icon('eraser', 14)} 数据预处理：自动清除了 <strong>${state.cleanCount}</strong> 个字段中的多余空格（姓名、身份证、手机号、银行卡号等）</div>` : ''}
    ${batchControlsHTML}`;
}

// ---- 依赖注入（编排函数仍留在 legacy.js / 后续 steps/export.ts，本模块不反向 import） ----
export interface ExportControlsDeps {
  showExportStep(): void;
  cacheCurrentTemplateOutput(): void;
  getSelectedTemplates(): string[];
  getSplitGroups(): SplitGroup[];
  getSplitGroupCounts(): { byFile: number; bySheet: number };
  isSplitExportActive(): boolean;
  ensureSplitBatches(groups: SplitGroup[], force?: boolean): void;
}

let showExportStep: () => void = () => {
  throw new Error('controls: showExportStep 依赖未注入（先调用 setExportControlsDeps / initExportControlsHandlers）');
};
let cacheCurrentTemplateOutput: () => void = () => {
  throw new Error('controls: cacheCurrentTemplateOutput 依赖未注入');
};
let getSelectedTemplates: () => string[] = () => {
  throw new Error('controls: getSelectedTemplates 依赖未注入');
};
let getSplitGroups: () => SplitGroup[] = () => {
  throw new Error('controls: getSplitGroups 依赖未注入');
};
let getSplitGroupCounts: () => { byFile: number; bySheet: number } = () => {
  throw new Error('controls: getSplitGroupCounts 依赖未注入');
};
let isSplitExportActive: () => boolean = () => {
  throw new Error('controls: isSplitExportActive 依赖未注入');
};
let ensureSplitBatches: (groups: SplitGroup[], force?: boolean) => void = () => {
  throw new Error('controls: ensureSplitBatches 依赖未注入');
};

export function setExportControlsDeps(deps: ExportControlsDeps): void {
  showExportStep = deps.showExportStep;
  cacheCurrentTemplateOutput = deps.cacheCurrentTemplateOutput;
  getSelectedTemplates = deps.getSelectedTemplates;
  getSplitGroups = deps.getSplitGroups;
  getSplitGroupCounts = deps.getSplitGroupCounts;
  isSplitExportActive = deps.isSplitExportActive;
  ensureSplitBatches = deps.ensureSplitBatches;
}

/**
 * 事件委托接线：#export-content 上监听 click/change/input，
 * 分发导出控件面板与预览表格平台/任务/税源下拉的 data-action。
 * 必须在 DOM 就绪后调用。
 */
export function initExportControlsHandlers(deps: ExportControlsDeps): void {
  setExportControlsDeps(deps);
  const container = byId('export-content');
  delegateAction(container, 'click', {
    applyBatchShangSheFromSelection: () => applyBatchShangSheFromSelection(),
    applyManualShangShe: () => applyManualShangShe(),
    applyPlatformToAll: () => applyPlatformToAll(),
  });
  delegateAction(container, 'change', {
    onPlatformChange: (el) => onPlatformChange(el as HTMLSelectElement, Number(el.dataset.rowIdx)),
    onTaxSourceChange: (el) => onTaxSourceChange(el as HTMLSelectElement, Number(el.dataset.rowIdx)),
    onTaskChange: (el) => onTaskChange(el as HTMLSelectElement, Number(el.dataset.rowIdx)),
    onExportModeChange: (el) => onExportModeChange((el.dataset.mode || 'merge') as AppState['exportMode']),
    onSbyOptionChange: () => onSbyOptionChange(),
    onBatchNoChange: (el) => onBatchNoChange(el as HTMLInputElement),
    onSplitBatchNoChange: (el) => onSplitBatchNoChange(el as HTMLInputElement),
  });
  delegateAction(container, 'input', {
    onBatchNoChange: (el) => onBatchNoChange(el as HTMLInputElement),
    onSplitBatchNoChange: (el) => onSplitBatchNoChange(el as HTMLInputElement),
  });
}

/** 聚合装配入口：一次调用接好导出面板全部 5 个模块的事件委托与外部关闭监听。 */
export type ExportPanelDeps = ExportControlsDeps;

export function initExportPanelHandlers(deps: ExportPanelDeps): void {
  initColumnFilterHandlers();
  initColumnFilterOutsideClick();
  initSearchDropdownHandlers({ showExportStep: deps.showExportStep });
  initSearchDropdownOutsideClick();
  initPreviewTableHandlers({ showExportStep: deps.showExportStep });
  initRemarkPanelHandlers({ showExportStep: deps.showExportStep });
  initExportControlsHandlers(deps);
}
