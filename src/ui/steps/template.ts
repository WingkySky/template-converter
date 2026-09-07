// 第三步：选择目标模版（自 src/legacy.js 逐字搬移，阶段 3 E 分区）。
// 动态 HTML 的内联 onclick/onkeydown → data-action + initTemplateDelegates() 事件委托
// （click 与 keydown 两个事件类型都挂在 #template-content 容器上）。
import { escapeHTML, byId, delegateAction } from '../dom';
import { state } from '../../state';
import { TEMPLATES } from '../../core/templates/registry';

// ---- generateOutput 接缝 ----
// generateOutput 本体仍在 legacy.js（阶段 3 主智能体第二批随 steps/export.ts 落位），
// 此处不得直接 import（会标红）。装配期由主智能体调用
// setGenerateOutputHandler(generateOutput) 接线；confirmTemplate 经
// invokeGenerateOutput() 间接调用，不依赖 window。
let generateOutputHandler: (() => void) | null = null;

/** 注册 generateOutput 实现（装配期由主智能体调用一次） */
export function setGenerateOutputHandler(fn: () => void): void {
  generateOutputHandler = fn;
}

// 调用已注册的 generateOutput（未注册时为空操作）
function invokeGenerateOutput(): void {
  generateOutputHandler?.();
}

export function showTemplateStep(): void {
  const container = byId('template-content');
  byId('step-template').classList.remove('hidden');

  const selectedTemplates = getSelectedTemplates();
  let cardsHTML = '';
  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    const selected = selectedTemplates.includes(key);
    cardsHTML += `<div class="template-card ${selected?'selected':''}" data-action="selectTemplate" data-key="${key}">
      <input class="multi-check" type="checkbox" ${selected?'checked':''} tabindex="-1">
      <div class="name">${tpl.icon} ${tpl.name}</div>
      <div class="fields">${tpl.desc}</div>
      ${key!=='custom'?`<div style="margin-top:8px;font-size:11px;color:var(--text2);">${escapeHTML(tpl.headers.slice(0,6).join('、'))}${tpl.headers.length>6?'…':''}</div>`:''}
    </div>`;
  }

  let customHTML = '';
  if (state.targetTemplate === 'custom') {
    const tags = state.customFields.map((f,i)=>`<div class="custom-field-tag">${escapeHTML(f)} <span class="remove" data-action="rmCF" data-idx="${i}">✕</span></div>`).join('');
    customHTML = `<div style="background:var(--surface2);border-radius:8px;padding:14px;border:1px solid var(--border);margin-top:12px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">自定义列名</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="custom-field-input" id="cf-input" placeholder="输入列名，回车添加" data-action="cfEnter">
        <button class="btn btn-secondary btn-sm" data-action="addCF">添加</button>
      </div>
      <div class="custom-fields">${tags}</div>
    </div>`;
  }

  container.innerHTML = `<div class="template-grid">${cardsHTML}</div>${customHTML}
    ${selectedTemplates.length > 1 ? `<div class="status-msg info">已选择 ${selectedTemplates.length} 个模版：${selectedTemplates.map(k => TEMPLATES[k].name).join('、')}。下一步先预览 ${TEMPLATES[state.targetTemplate!].name}，导出时可一次导出全部所选模版。</div>` : ''}
    <div class="btn-row">
      <button class="btn btn-primary" style="flex:1;padding:12px;font-size:15px;" data-action="confirmTemplate" ${!selectedTemplates.length?'disabled':''}>${state.targetTemplate==='custom'?'✅ 映射自定义列':'✅ 生成转换结果'}</button>
      <button class="btn btn-secondary" data-action="goBack" data-target="step-template">⬅️ 返回</button>
    </div>`;
}

export function getSelectedTemplates(): string[] {
  if (Array.isArray(state.selectedTemplates) && state.selectedTemplates.length) return state.selectedTemplates;
  return state.targetTemplate ? [state.targetTemplate] : [];
}

export function selectTemplate(key: string): void {
  if (key === 'custom') {
    state.selectedTemplates = ['custom'];
    state.targetTemplate = 'custom';
    showTemplateStep();
    return;
  }

  let selected = getSelectedTemplates().filter(k => k !== 'custom');
  if (selected.includes(key)) {
    selected = selected.filter(k => k !== key);
  } else {
    selected.push(key);
  }

  state.selectedTemplates = selected;
  // 原式为 selected.includes(state.targetTemplate)；仅补 null 守卫以过 strict
  // （targetTemplate 为 null 时 includes 本就返回 false，运行时等价）
  state.targetTemplate = (state.targetTemplate !== null && selected.includes(state.targetTemplate)) ? state.targetTemplate : (selected[0] || null);
  if (selected.includes(key)) state.targetTemplate = key;
  showTemplateStep();
}
export function addCF(): void {
  const input = byId('cf-input') as HTMLInputElement;
  const v = input.value.trim();
  if (v && !state.customFields.includes(v)) { state.customFields.push(v); input.value = ''; showTemplateStep(); }
}
export function rmCF(i: number): void { state.customFields.splice(i,1); showTemplateStep(); }
export function goBack(id: string): void { byId(id).classList.add('hidden'); }

export function confirmTemplate(): void {
  const selectedTemplates = getSelectedTemplates();
  if (!selectedTemplates.length) { alert('请选择模版'); return; }
  state.selectedTemplates = selectedTemplates;
  state.targetTemplate = state.targetTemplate || selectedTemplates[0];
  if (state.targetTemplate === 'custom' && !state.customFields.length) { alert('请添加列名'); return; }
  invokeGenerateOutput();
}

// 模版容器事件委托：原内联 onclick/onkeydown 全部改为 data-action 分发。
// click   ：selectTemplate（模版卡片，data-key）、rmCF（删除自定义列，data-idx）、
//           addCF（添加按钮）、confirmTemplate（生成）、goBack（返回，data-target）
// keydown ：cfEnter（#cf-input 回车添加自定义列，原 onkeydown 内联逐字等价）
export function initTemplateDelegates(): void {
  const container = byId('template-content');
  delegateAction(container, 'click', {
    selectTemplate: el => selectTemplate(el.dataset.key || ''),
    rmCF: el => rmCF(Number(el.dataset.idx)),
    addCF: () => addCF(),
    confirmTemplate: () => confirmTemplate(),
    goBack: el => goBack(el.dataset.target || ''),
  });
  delegateAction(container, 'keydown', {
    cfEnter: (el, e) => {
      if ((e as KeyboardEvent).key === 'Enter') { addCF(); e.preventDefault(); }
    },
  });
}
