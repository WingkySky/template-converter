// 步骤 0 附属：配置数据管理弹层（「管理配置」按钮）。
// 对税源地/平台/签约主体映射/平台税源地映射/任务清单做单条增删改，保存即生效。
// 视图遵循「所见即生效」：列表字段未上传过时展示 DEFAULT_CONFIG 的运行时兜底值
// （与 getConfigLists 同口径），首次编辑该字段前先以生效值种子化 configData，
// 避免编辑结果与运行时兜底两套数据并存。
import { escapeHTML, delegateAction } from '../dom';
import { loadKB, saveKB } from '../../io/kb-storage';
import { DEFAULT_CONFIG, type KB, type KBConfigData } from '../../core/kb/model';

type ListSection = 'taxSources' | 'platforms';

// ==================== 生效值视图与种子化 ====================

function configOf(kb: KB): KBConfigData {
  if (!kb.configData) kb.configData = { taxSources: [], platforms: [] };
  return kb.configData;
}

// 与 getConfigLists 同口径：platforms 非空视为「已上传」，否则两个列表都回落 DEFAULT_CONFIG
function isListsUploaded(kb: KB): boolean {
  return !!(kb.configData && kb.configData.platforms && kb.configData.platforms.length > 0);
}

function effectiveLists(kb: KB): { taxSources: string[]; platforms: string[] } {
  if (isListsUploaded(kb)) {
    return { taxSources: kb.configData.taxSources || [], platforms: kb.configData.platforms };
  }
  return { taxSources: [...DEFAULT_CONFIG.taxSources], platforms: [...DEFAULT_CONFIG.platforms] };
}

function effectiveSignEntity(kb: KB): Record<string, string[]> {
  return kb.configData?.signEntityMapping ?? DEFAULT_CONFIG.signEntityMapping ?? {};
}

function effectivePlatTaxSource(kb: KB): Record<string, string> {
  return kb.configData?.platformTaxSourceMapping ?? DEFAULT_CONFIG.platformTaxSourceMapping ?? {};
}

// 首次编辑前把「生效值」落进 configData，保证编辑基于当前实际生效的数据
function seedLists(kb: KB): KBConfigData {
  const cd = configOf(kb);
  if (!isListsUploaded(kb)) {
    cd.taxSources = [...DEFAULT_CONFIG.taxSources];
    cd.platforms = [...DEFAULT_CONFIG.platforms];
  }
  return cd;
}

function seedSignEntity(kb: KB): KBConfigData {
  const cd = configOf(kb);
  if (!cd.signEntityMapping) {
    cd.signEntityMapping = Object.fromEntries(
      Object.entries(DEFAULT_CONFIG.signEntityMapping ?? {}).map(([k, v]) => [k, [...v]]),
    );
  }
  return cd;
}

function seedPlatTaxSource(kb: KB): KBConfigData {
  const cd = configOf(kb);
  if (!cd.platformTaxSourceMapping) {
    cd.platformTaxSourceMapping = { ...(DEFAULT_CONFIG.platformTaxSourceMapping ?? {}) };
  }
  return cd;
}

function commit(kb: KB): void {
  saveKB(kb);
  renderKBConfigPanel();
}

function splitKeywords(raw: string): string[] {
  return raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
}

// ==================== 增删改动作（返回 true 表示已写入） ====================

export function kbConfigAddListItem(section: ListSection, rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) { alert('内容不能为空'); return false; }
  const kb = loadKB();
  const cd = seedLists(kb);
  const list = section === 'taxSources' ? (cd.taxSources ||= []) : (cd.platforms ||= []);
  if (list.includes(value)) { alert(`「${value}」已存在`); return false; }
  list.push(value);
  commit(kb);
  return true;
}

export function kbConfigUpdateListItem(section: ListSection, index: number, rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) { alert('内容不能为空，如需删除请使用删除按钮'); return false; }
  const kb = loadKB();
  const cd = seedLists(kb);
  const list = section === 'taxSources' ? cd.taxSources : cd.platforms;
  if (!list || !list[index]) return false;
  if (list[index] !== value && list.includes(value)) { alert(`「${value}」已存在`); return false; }
  list[index] = value;
  commit(kb);
  return true;
}

export function kbConfigDeleteListItem(section: ListSection, index: number): boolean {
  const kb = loadKB();
  const lists = effectiveLists(kb);
  const value = (section === 'taxSources' ? lists.taxSources : lists.platforms)[index];
  if (value === undefined) return false;
  const label = section === 'taxSources' ? '税源地' : '平台';
  if (!confirm(`确定删除${label}「${value}」吗？此操作立即生效。`)) return false;
  const cd = seedLists(kb);
  const list = section === 'taxSources' ? cd.taxSources : cd.platforms;
  list.splice(index, 1);
  commit(kb);
  return true;
}

export function kbConfigAddSignEntity(rawKey: string, rawKeywords: string): boolean {
  const key = rawKey.trim();
  const keywords = splitKeywords(rawKeywords);
  if (!key || keywords.length === 0) { alert('签约主体名称与关键词均不能为空'); return false; }
  const kb = loadKB();
  const cd = seedSignEntity(kb);
  if (key in cd.signEntityMapping!) { alert(`签约主体「${key}」已存在`); return false; }
  cd.signEntityMapping![key] = keywords;
  commit(kb);
  return true;
}

export function kbConfigUpdateSignEntity(origKey: string, rawNewKey: string, rawKeywords: string): boolean {
  const newKey = rawNewKey.trim();
  const keywords = splitKeywords(rawKeywords);
  if (!newKey || keywords.length === 0) { alert('签约主体名称与关键词均不能为空'); return false; }
  const kb = loadKB();
  const cd = seedSignEntity(kb);
  const mapping = cd.signEntityMapping!;
  if (!(origKey in mapping)) return false;
  if (newKey !== origKey && newKey in mapping) { alert(`签约主体「${newKey}」已存在`); return false; }
  // 重命名按 entries 重建以保持原顺序
  const rebuilt: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(mapping)) {
    rebuilt[k === origKey ? newKey : k] = (k === origKey ? keywords : v);
  }
  cd.signEntityMapping = rebuilt;
  commit(kb);
  return true;
}

export function kbConfigDeleteSignEntity(key: string): boolean {
  const kb = loadKB();
  if (!(key in effectiveSignEntity(kb))) return false;
  if (!confirm(`确定删除签约主体「${key}」的映射吗？此操作立即生效。`)) return false;
  const cd = seedSignEntity(kb);
  delete cd.signEntityMapping![key];
  commit(kb);
  return true;
}

export function kbConfigAddPlatTaxSource(rawKey: string, rawTaxSource: string): boolean {
  const key = rawKey.trim();
  const taxSource = rawTaxSource.trim();
  if (!key || !taxSource) { alert('平台关键词与税源地均不能为空'); return false; }
  const kb = loadKB();
  const cd = seedPlatTaxSource(kb);
  if (key in cd.platformTaxSourceMapping!) { alert(`关键词「${key}」已存在`); return false; }
  cd.platformTaxSourceMapping![key] = taxSource;
  commit(kb);
  return true;
}

export function kbConfigUpdatePlatTaxSource(origKey: string, rawNewKey: string, rawTaxSource: string): boolean {
  const newKey = rawNewKey.trim();
  const taxSource = rawTaxSource.trim();
  if (!newKey || !taxSource) { alert('平台关键词与税源地均不能为空'); return false; }
  const kb = loadKB();
  const cd = seedPlatTaxSource(kb);
  const mapping = cd.platformTaxSourceMapping!;
  if (!(origKey in mapping)) return false;
  if (newKey !== origKey && newKey in mapping) { alert(`关键词「${newKey}」已存在`); return false; }
  const rebuilt: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapping)) {
    rebuilt[k === origKey ? newKey : k] = (k === origKey ? taxSource : v);
  }
  cd.platformTaxSourceMapping = rebuilt;
  commit(kb);
  return true;
}

export function kbConfigDeletePlatTaxSource(key: string): boolean {
  const kb = loadKB();
  if (!(key in effectivePlatTaxSource(kb))) return false;
  if (!confirm(`确定删除关键词「${key}」的税源地映射吗？此操作立即生效。`)) return false;
  const cd = seedPlatTaxSource(kb);
  delete cd.platformTaxSourceMapping![key];
  commit(kb);
  return true;
}

export function kbConfigAddTaskEntry(rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) { alert('内容不能为空'); return false; }
  const kb = loadKB();
  if (!kb.taskListData) kb.taskListData = [];
  if (kb.taskListData.includes(value)) { alert('该任务条目已存在'); return false; }
  kb.taskListData.push(value);
  commit(kb);
  return true;
}

export function kbConfigUpdateTaskEntry(index: number, rawValue: string): boolean {
  const value = rawValue.trim();
  if (!value) { alert('内容不能为空，如需删除请使用删除按钮'); return false; }
  const kb = loadKB();
  const list = kb.taskListData || [];
  if (!list[index]) return false;
  if (list[index] !== value && list.includes(value)) { alert('该任务条目已存在'); return false; }
  list[index] = value;
  commit(kb);
  return true;
}

export function kbConfigDeleteTaskEntry(index: number): boolean {
  const kb = loadKB();
  const list = kb.taskListData || [];
  if (!list[index]) return false;
  if (!confirm(`确定删除任务「${list[index]}」吗？此操作立即生效。`)) return false;
  list.splice(index, 1);
  commit(kb);
  return true;
}

// ==================== 渲染 ====================

function listSection(title: string, section: ListSection, items: string[]): string {
  const rows = items.length === 0
    ? '<div class="kbcm-empty">（空）</div>'
    : `<div class="kbcm-rows">${items.map((v, i) => `
      <div class="kbcm-row">
        <input type="text" value="${escapeHTML(v)}" data-action="kbcmListChange" data-section="${section}" data-idx="${i}">
        <button type="button" class="btn btn-red btn-sm" data-action="kbcmListDelete" data-section="${section}" data-idx="${i}">删</button>
      </div>`).join('')}</div>`;
  return `
    <div class="kbcm-section">
      <div class="kbcm-sec-head"><span class="kbcm-sec-title">${title}</span><span class="kbcm-sec-count">${items.length} 项</span></div>
      ${rows}
      <div class="kbcm-add-row">
        <input type="text" id="kbcm-add-${section}" placeholder="新增${title}" data-action="kbcmListAddEnter" data-section="${section}">
        <button type="button" class="btn btn-secondary btn-sm" data-action="kbcmListAdd" data-section="${section}">添加</button>
      </div>
    </div>`;
}

function signEntitySection(mapping: Record<string, string[]>): string {
  const entries = Object.entries(mapping);
  const rows = entries.length === 0
    ? '<div class="kbcm-empty">（空）</div>'
    : `<div class="kbcm-rows">${entries.map(([k, kws]) => `
      <div class="kbcm-row">
        <input type="text" class="kbcm-key-input" value="${escapeHTML(k)}" title="签约主体名称" data-action="kbcmSeKeyChange" data-key="${escapeHTML(k)}">
        <input type="text" value="${escapeHTML((kws || []).join(','))}" title="匹配关键词，多个用逗号分隔" data-action="kbcmSeKwChange" data-key="${escapeHTML(k)}">
        <button type="button" class="btn btn-red btn-sm" data-action="kbcmSeDelete" data-key="${escapeHTML(k)}">删</button>
      </div>`).join('')}</div>`;
  return `
    <div class="kbcm-section">
      <div class="kbcm-sec-head"><span class="kbcm-sec-title">签约主体映射</span><span class="kbcm-sec-count">${entries.length} 条</span></div>
      ${rows}
      <div class="kbcm-add-row">
        <input type="text" id="kbcm-se-add-key" class="kbcm-key-input" placeholder="签约主体名称">
        <input type="text" id="kbcm-se-add-kw" placeholder="关键词，多个用逗号分隔">
        <button type="button" class="btn btn-secondary btn-sm" data-action="kbcmSeAdd">添加</button>
      </div>
    </div>`;
}

function platSection(mapping: Record<string, string>): string {
  const entries = Object.entries(mapping);
  const rows = entries.length === 0
    ? '<div class="kbcm-empty">（空）</div>'
    : `<div class="kbcm-rows">${entries.map(([k, v]) => `
      <div class="kbcm-row">
        <input type="text" class="kbcm-key-input" value="${escapeHTML(k)}" title="平台关键词" data-action="kbcmPtKeyChange" data-key="${escapeHTML(k)}">
        <input type="text" value="${escapeHTML(v)}" title="匹配到的税源地" data-action="kbcmPtValChange" data-key="${escapeHTML(k)}">
        <button type="button" class="btn btn-red btn-sm" data-action="kbcmPtDelete" data-key="${escapeHTML(k)}">删</button>
      </div>`).join('')}</div>`;
  return `
    <div class="kbcm-section">
      <div class="kbcm-sec-head"><span class="kbcm-sec-title">平台税源地映射</span><span class="kbcm-sec-count">${entries.length} 条</span></div>
      ${rows}
      <div class="kbcm-add-row">
        <input type="text" id="kbcm-pt-add-key" class="kbcm-key-input" placeholder="平台关键词">
        <input type="text" id="kbcm-pt-add-val" placeholder="税源地，如 0007.天津">
        <button type="button" class="btn btn-secondary btn-sm" data-action="kbcmPtAdd">添加</button>
      </div>
    </div>`;
}

function taskSection(tasks: string[]): string {
  const rows = tasks.length === 0
    ? '<div class="kbcm-empty">（空，未上传任务清单时导出会按商社任务自动生成）</div>'
    : `<div class="kbcm-rows kbcm-rows-scroll">${tasks.map((v, i) => `
      <div class="kbcm-row">
        <input type="text" value="${escapeHTML(v)}" data-action="kbcmTaskChange" data-idx="${i}">
        <button type="button" class="btn btn-red btn-sm" data-action="kbcmTaskDelete" data-idx="${i}">删</button>
      </div>`).join('')}</div>`;
  return `
    <div class="kbcm-section">
      <div class="kbcm-sec-head"><span class="kbcm-sec-title">任务清单</span><span class="kbcm-sec-count">${tasks.length} 条</span></div>
      ${rows}
      <div class="kbcm-add-row">
        <input type="text" id="kbcm-task-add-input" placeholder="新增任务条目，格式：序号.任务名(商社编号)" data-action="kbcmTaskAddEnter">
        <button type="button" class="btn btn-secondary btn-sm" data-action="kbcmTaskAdd">添加</button>
      </div>
    </div>`;
}

export function renderKBConfigPanel(): void {
  const body = document.getElementById('kb-config-panel-body');
  if (!body) return;
  const kb = loadKB();
  const lists = effectiveLists(kb);
  body.innerHTML = `
    <div class="kbcm-hint">直接编辑下方数据，修改即时保存并生效（下拉选项与税源地匹配规则均使用此处数据）。删除需确认且不可撤销；大范围调整仍建议「导出备份」后在 Excel 中完成再重新上传。</div>
    ${listSection('税源地', 'taxSources', lists.taxSources)}
    ${listSection('平台', 'platforms', lists.platforms)}
    ${signEntitySection(effectiveSignEntity(kb))}
    ${platSection(effectivePlatTaxSource(kb))}
    ${taskSection(kb.taskListData || [])}
  `;
}

// ==================== 弹层开关与事件接线 ====================

export function openKBConfigPanel(): void {
  renderKBConfigPanel();
  document.getElementById('kb-config-modal')?.classList.remove('hidden');
}

export function closeKBConfigPanel(): void {
  document.getElementById('kb-config-modal')?.classList.add('hidden');
}

// 读取映射行内的全部输入框（真实 DOM：closest 行内 querySelectorAll；stub 环境返回空由调用方守卫）
function readRowInputs(el: HTMLElement): HTMLInputElement[] {
  const row = el.closest('.kbcm-row');
  if (!row || typeof row.querySelectorAll !== 'function') return [];
  return Array.from(row.querySelectorAll('input')) as HTMLInputElement[];
}

const addInputValue = (id: string): string | null => {
  const input = document.getElementById(id) as HTMLInputElement | null;
  return input ? input.value : null;
};

const clickHandlers: Record<string, (el: HTMLElement, e: Event) => void> = {
  kbcmClose: () => closeKBConfigPanel(),
  kbcmListAdd: (el) => {
    const section = el.dataset.section as ListSection | undefined;
    if (!section) return;
    const value = addInputValue(`kbcm-add-${section}`);
    if (value === null) return;
    if (kbConfigAddListItem(section, value)) {
      (document.getElementById(`kbcm-add-${section}`) as HTMLInputElement | null)!.value = '';
    }
  },
  kbcmSeAdd: () => {
    const key = addInputValue('kbcm-se-add-key');
    const kw = addInputValue('kbcm-se-add-kw');
    if (key === null || kw === null) return;
    if (kbConfigAddSignEntity(key, kw)) {
      (document.getElementById('kbcm-se-add-key') as HTMLInputElement | null)!.value = '';
      (document.getElementById('kbcm-se-add-kw') as HTMLInputElement | null)!.value = '';
    }
  },
  kbcmPtAdd: () => {
    const key = addInputValue('kbcm-pt-add-key');
    const val = addInputValue('kbcm-pt-add-val');
    if (key === null || val === null) return;
    if (kbConfigAddPlatTaxSource(key, val)) {
      (document.getElementById('kbcm-pt-add-key') as HTMLInputElement | null)!.value = '';
      (document.getElementById('kbcm-pt-add-val') as HTMLInputElement | null)!.value = '';
    }
  },
  kbcmTaskAdd: () => {
    const value = addInputValue('kbcm-task-add-input');
    if (value === null) return;
    if (kbConfigAddTaskEntry(value)) {
      (document.getElementById('kbcm-task-add-input') as HTMLInputElement | null)!.value = '';
    }
  },
  kbcmListDelete: (el) => {
    const section = el.dataset.section as ListSection | undefined;
    const idx = Number(el.dataset.idx);
    if (section && Number.isInteger(idx)) kbConfigDeleteListItem(section, idx);
  },
  kbcmSeDelete: (el) => {
    const key = el.dataset.key;
    if (key !== undefined) kbConfigDeleteSignEntity(key);
  },
  kbcmPtDelete: (el) => {
    const key = el.dataset.key;
    if (key !== undefined) kbConfigDeletePlatTaxSource(key);
  },
  kbcmTaskDelete: (el) => {
    const idx = Number(el.dataset.idx);
    if (Number.isInteger(idx)) kbConfigDeleteTaskEntry(idx);
  },
};

const changeHandlers: Record<string, (el: HTMLElement, e: Event) => void> = {
  kbcmListChange: (el) => {
    const section = el.dataset.section as ListSection | undefined;
    const idx = Number(el.dataset.idx);
    if (section && Number.isInteger(idx)) {
      kbConfigUpdateListItem(section, idx, (el as HTMLInputElement).value);
    }
  },
  kbcmTaskChange: (el) => {
    const idx = Number(el.dataset.idx);
    if (Number.isInteger(idx)) kbConfigUpdateTaskEntry(idx, (el as HTMLInputElement).value);
  },
  // 映射行：名称/关键词任一输入框提交时，整行一起读取（两框可同时修改）
  kbcmSeKeyChange: (el) => {
    const origKey = el.dataset.key;
    const [keyInput, kwInput] = readRowInputs(el);
    if (!origKey || !keyInput || !kwInput) return;
    kbConfigUpdateSignEntity(origKey, keyInput.value, kwInput.value);
  },
  kbcmSeKwChange: (el) => {
    const origKey = el.dataset.key;
    const [keyInput, kwInput] = readRowInputs(el);
    if (!origKey || !keyInput || !kwInput) return;
    kbConfigUpdateSignEntity(origKey, keyInput.value, kwInput.value);
  },
  kbcmPtKeyChange: (el) => {
    const origKey = el.dataset.key;
    const [keyInput, valInput] = readRowInputs(el);
    if (!origKey || !keyInput || !valInput) return;
    kbConfigUpdatePlatTaxSource(origKey, keyInput.value, valInput.value);
  },
  kbcmPtValChange: (el) => {
    const origKey = el.dataset.key;
    const [keyInput, valInput] = readRowInputs(el);
    if (!origKey || !keyInput || !valInput) return;
    kbConfigUpdatePlatTaxSource(origKey, keyInput.value, valInput.value);
  },
};

const keydownHandlers: Record<string, (el: HTMLElement, e: Event) => void> = {
  kbcmListAddEnter: (el, e) => {
    if ((e as KeyboardEvent).key === 'Enter') clickHandlers.kbcmListAdd(el, e);
  },
  kbcmTaskAddEnter: (el, e) => {
    if ((e as KeyboardEvent).key === 'Enter') clickHandlers.kbcmTaskAdd(el, e);
  },
};

export function initKBConfigPanel(): void {
  document.getElementById('kb-btn-manage-config')?.addEventListener('click', () => openKBConfigPanel());

  const body = document.getElementById('kb-config-panel-body');
  if (body) {
    delegateAction(body, 'click', clickHandlers);
    delegateAction(body, 'change', changeHandlers);
    delegateAction(body, 'keydown', keydownHandlers);
  }

  // 点击遮罩空白处关闭（点击弹层本身不关闭）
  const overlay = document.getElementById('kb-config-modal');
  overlay?.addEventListener('click', (e) => {
    if ((e as MouseEvent).target === overlay) closeKBConfigPanel();
  });

  // Escape 关闭
  document.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Escape') return;
    const el = document.getElementById('kb-config-modal');
    if (el && !el.classList.contains('hidden')) closeKBConfigPanel();
  });
}
