// 商社/平台通用搜索下拉 —— 自 src/legacy.js 逐字搬移（阶段 3 分区 D）。
// 原 legacy.js 锚点：createShangSheSearchHTML L1851、showShangSheDropdown L1864、
// filterShangSheList L1868、selectShangSheFromItem L1915、selectShangShe L1920、
// filterPlatformList L1957、selectPlatformFromItem L1984、showPlatformDropdown L1988、
// selectPlatform L1992、顶层「点击外部关闭下拉框」L2002-2017。
// 唯一渲染差异：内联 onclick/oninput/onfocus → data-action + data-*（事件委托）。
// 同一搜索输入框原有两个内联事件（oninput + onfocus），改用同一 data-action、
// 按 'input' / 'focusin' 两种事件类型分别分发（oninput → filterXxxList，onfocus → showXxxDropdown）。
// selectShangShe 的 showExportStep 依赖经 set/init 注入（不 import legacy.js、不挂 window）。
import { state } from '../state';
import { escapeHTML, delegateAction, byId } from './dom';
import { normalizeSearchText } from './column-filter';
import { lookupShangShe } from './steps/export';
import { dedupeBatchNo, buildBatchNoFromShangShe } from '../core/kb/batch';

/** state.shangSheFullList 元素的运行时完整形状（state.ts 的声明是旧窄形状，此处按原字段读取） */
interface ShangSheSearchItem {
  id: string;
  label: string;
  taxId?: string;
  fullName?: string;
  shortName?: string;
  searchText?: string;
}

/** state.platformFullList 元素的运行时形状（state.ts 声明为 unknown[]） */
interface PlatformSearchItem {
  value: string;
  label: string;
  searchText?: string;
}

// 通用商社搜索下拉组件生成函数，根据 prefix 生成唯一 DOM ID
export function createShangSheSearchHTML(prefix: string, placeholder: string, inputValue: string, hiddenValue: string): string {
  return `
    <div style="position:relative;">
      <input type="text" id="${prefix}-shangshe-search" placeholder="${placeholder}"
        style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none;"
        data-action="filterShangSheList" data-prefix="${prefix}" autocomplete="off"
        value="${escapeHTML(inputValue || '')}">
      <input type="hidden" id="${prefix}-shangshe-selected-id" value="${escapeHTML(hiddenValue || '')}">
      <div id="${prefix}-shangshe-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;margin-top:2px;max-height:240px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:6px;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,0.3);"></div>
    </div>`;
}

// 商社搜索下拉框
export function showShangSheDropdown(prefix: string): void {
  filterShangSheList(prefix);
}

export function filterShangSheList(prefix: string): void {
  const input = document.getElementById(prefix + '-shangshe-search') as HTMLInputElement | null;
  const dropdown = document.getElementById(prefix + '-shangshe-dropdown');
  if (!input || !dropdown) return;

  const query = normalizeSearchText(input.value);
  // Always search the full knowledge base for comprehensive filtering
  const fullList = (state.shangSheFullList || []) as ShangSheSearchItem[];

  // Build candidate set for highlighting
  const candidateIds = new Set<string>();
  if (state.shangSheCandidates && state.shangSheCandidates.length > 0) {
    state.shangSheCandidates.forEach(c => candidateIds.add(c.id));
  }

  let filtered = fullList;
  if (query) {
    filtered = fullList.filter(item => (item.searchText || normalizeSearchText([
      item.id,
      item.label,
      item.taxId,
      item.fullName,
      item.shortName
    ].join(' '))).includes(query));
  }

  filtered = filtered.slice(0, 50);

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text2);font-size:12px;">无匹配结果</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.style.display = 'block';
  dropdown.innerHTML = filtered.map(item => {
    const isCandidate = candidateIds.has(item.id);
    const candStyle = isCandidate ? 'background:var(--orange-soft);' : '';
    const candBadge = isCandidate ? '<span style="color:var(--orange);font-size:10px;margin-left:4px;">候选</span>' : '';
    return `<div class="ss-dropdown-item" data-ss-id="${escapeHTML(item.id)}" data-ss-label="${escapeHTML(item.label || item.id)}" data-ss-prefix="${prefix}" data-action="selectShangSheFromItem" style="${candStyle}">
      <span class="ss-id">${escapeHTML(item.id)}${candBadge}</span>
      <span class="ss-name">${escapeHTML(item.shortName || item.label || '')}</span>
      ${item.taxId ? `<span class="ss-taxid">税号: ${escapeHTML(item.taxId)}</span>` : ''}
    </div>`;
  }).join('');
}

export function selectShangSheFromItem(itemEl: HTMLElement): void {
  const prefix = itemEl.dataset.ssPrefix || 'batch';
  selectShangShe(itemEl.dataset.ssId || '', itemEl.dataset.ssLabel || '', prefix);
}

export function selectShangShe(id: string, label: string, prefix: string): void {
  const input = document.getElementById(prefix + '-shangshe-search') as HTMLInputElement | null;
  const hidden = document.getElementById(prefix + '-shangshe-selected-id') as HTMLInputElement | null;
  const dropdown = document.getElementById(prefix + '-shangshe-dropdown');
  const batchInput = document.getElementById('batch-no-input') as HTMLInputElement | null;
  if (input) input.value = label;
  if (hidden) hidden.value = id;
  if (dropdown) dropdown.style.display = 'none';
  // 拆分模式：为对应分组更换商社并重新生成该份批次号
  if (prefix.startsWith('split') && id) {
    const gi = Number(prefix.slice(5));
    const g = (state.splitGroupList || [])[gi];
    if (g) {
      const lookup = lookupShangShe(id);
      const existing = new Set((state.splitGroupList || [])
        .filter(x => x.key !== g.key)
        .map(x => state.splitBatches[x.key]?.batchNo).filter(Boolean) as string[]);
      state.splitBatches[g.key] = {
        batchNo: dedupeBatchNo(buildBatchNoFromShangShe(lookup), existing),
        shangSheId: id,
        shangSheName: lookup?.shortName || lookup?.fullName || ''
      };
      showExportStep();
    }
    return;
  }
  // 选择商社后立即预览批次号（仅 batch 前缀时）
  if (prefix === 'batch' && id && batchInput) {
    const lookup = lookupShangShe(id);
    if (lookup) {
      const previewBatchNo = buildBatchNoFromShangShe(lookup);
      batchInput.value = previewBatchNo;
    }
  }
}

// 平台搜索下拉框
export function filterPlatformList(): void {
  const input = document.getElementById('platform-search') as HTMLInputElement | null;
  const dropdown = document.getElementById('platform-dropdown');
  if (!input || !dropdown) return;

  const query = normalizeSearchText(input.value);
  const list = (state.platformFullList || []) as PlatformSearchItem[];

  let filtered = list;
  if (query) {
    filtered = list.filter(item => (item.searchText || normalizeSearchText(item.label)).includes(query));
  }

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text2);font-size:12px;">无匹配结果</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.style.display = 'block';
  dropdown.innerHTML = filtered.map(item => {
    return `<div class="ss-dropdown-item" data-platform-value="${escapeHTML(item.value)}" data-action="selectPlatformFromItem">
      <span class="ss-name">${escapeHTML(item.label)}</span>
    </div>`;
  }).join('');
}

export function selectPlatformFromItem(itemEl: HTMLElement): void {
  selectPlatform(itemEl.dataset.platformValue || '');
}

export function showPlatformDropdown(): void {
  filterPlatformList();
}

export function selectPlatform(value: string): void {
  const input = document.getElementById('platform-search') as HTMLInputElement | null;
  const hidden = document.getElementById('platform-selected-val') as HTMLInputElement | null;
  const dropdown = document.getElementById('platform-dropdown');
  if (input) input.value = value;
  if (hidden) hidden.value = value;
  if (dropdown) dropdown.style.display = 'none';
}

// ---- 依赖注入（showExportStep 仍留在 legacy.js / 后续 steps/export.ts，本模块不反向 import） ----
export interface SearchDropdownDeps {
  showExportStep(): void;
}

let showExportStep: () => void = () => {
  throw new Error('search-dropdown: showExportStep 依赖未注入（先调用 setSearchDropdownDeps / initSearchDropdownHandlers）');
};

export function setSearchDropdownDeps(deps: SearchDropdownDeps): void {
  showExportStep = deps.showExportStep;
}

/**
 * 事件委托接线：#export-content 上监听 click/input/focusin，
 * 分发本组件渲染产物中的 data-action。必须在 DOM 就绪后调用。
 */
export function initSearchDropdownHandlers(deps: SearchDropdownDeps): void {
  setSearchDropdownDeps(deps);
  const container = byId('export-content');
  delegateAction(container, 'click', {
    selectShangSheFromItem: (el) => selectShangSheFromItem(el),
    selectPlatformFromItem: (el) => selectPlatformFromItem(el),
  });
  delegateAction(container, 'input', {
    filterShangSheList: (el) => filterShangSheList(el.dataset.prefix || ''),
    filterPlatformList: () => filterPlatformList(),
  });
  // 原内联 onfocus：focus 事件不冒泡，委托用等价的 focusin
  delegateAction(container, 'focusin', {
    filterShangSheList: (el) => showShangSheDropdown(el.dataset.prefix || ''),
    filterPlatformList: () => showPlatformDropdown(),
  });
}

/** 点击外部关闭下拉框（原 legacy.js 顶层语句 L2002-2017 原样迁入，由 main.ts 装配时调用一次）。 */
export function initSearchDropdownOutsideClick(): void {
  document.addEventListener('click', function(e) {
    // 关闭商社下拉框（两个前缀实例）
    ['batch', 'manual'].forEach(function(prefix) {
      const ssDropdown = document.getElementById(prefix + '-shangshe-dropdown');
      const ssInput = document.getElementById(prefix + '-shangshe-search');
      if (ssDropdown && ssInput && !ssInput.contains(e.target as Node) && !ssDropdown.contains(e.target as Node)) {
        ssDropdown.style.display = 'none';
      }
    });
    // 关闭平台下拉框
    const pDropdown = document.getElementById('platform-dropdown');
    const pInput = document.getElementById('platform-search');
    if (pDropdown && pInput && !pInput.contains(e.target as Node) && !pDropdown.contains(e.target as Node)) {
      pDropdown.style.display = 'none';
    }
  });
}
