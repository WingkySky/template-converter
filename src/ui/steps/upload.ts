// 第一步：上传样例文件（自 src/legacy.js 逐字搬移，阶段 3 E 分区）。
// 静态上传区拖拽接线 → initUploadArea()；累加条动态 HTML 的内联
// onclick="resetAll()" → data-action="resetAll" + initAccumIndicatorDelegate() 事件委托。
// 上传任务行（设计 §2）：每文件一行实时反馈——上传即建行、解析阶段实时更新、
// 成功折叠进累加条、失败行内展示原因并可重试（取代 alert）。
import * as XLSX from 'xlsx';
import { icon } from '../icons';
import { byId, delegateAction, escapeHTML } from '../dom';
import { state } from '../../state';
import { parseCSV, isGarbled } from '../../core/parser/parse-csv';
import { analyzeWorkbookSheets, buildCsvSource } from '../../core/parser/excel';
import { showMappingStep } from './mapping';
import type { OcrProgress } from '../../core/image/types';
import type { Rows } from '../../types';

// ---- resetAll 接缝 ----
// resetAll 本体随导出/重置侧归属主智能体（steps/export.ts，尚未落位），此处不得
// 直接 import（会标红）。装配期由主智能体调用 setResetAllHandler(resetAll) 一次性接线；
// 本模块与 mapping.ts 的委托处理器统一经 invokeResetAll() 间接调用，不依赖 window。
let resetAllHandler: (() => void) | null = null;

/** 注册 resetAll 实现（装配期由主智能体调用一次） */
export function setResetAllHandler(fn: () => void): void {
  resetAllHandler = fn;
}

/** 调用已注册的 resetAll（未注册时为空操作） */
export function invokeResetAll(): void {
  resetAllHandler?.();
}

// ---- 上传任务行（设计 §2：上传 UI 的局部状态，不进 state.ts）----
type UploadTaskKind = 'csv' | 'excel' | 'pdf' | 'image' | 'paste' | 'unknown';
// 完成即从列表移除（折叠进累加条），不留 done 状态
type UploadTaskStatus = 'parsing' | 'failed';

interface UploadTask {
  id: number;
  file?: File; // 保留引用，行内重试用；paste 任务无文件（不可重试）
  fileName: string;
  kind: UploadTaskKind;
  status: UploadTaskStatus;
  stage: string; // parsing 阶段文案
  errorHint?: string; // failed 原因
}

const uploadTasks: UploadTask[] = [];
let uploadTaskSeq = 0;

function findTask(id: number): UploadTask | undefined {
  return uploadTasks.find(t => t.id === id);
}

function renderTasks(): void {
  const el = document.getElementById('upload-tasks');
  if (!el) return; // 容器缺失时静默（Node 测试桩兼容口径，同旧 #ocr-progress）
  el.innerHTML = uploadTasks.map(t => {
    if (t.status === 'failed') {
      // unknown（不支持的格式）与 paste（剪贴板可能已变）重试无意义，不提供重试按钮（设计 §4）
      const retry = t.kind !== 'unknown' && t.kind !== 'paste'
        ? `<button class="btn btn-secondary btn-sm" data-action="retryTask" data-task-id="${t.id}">${icon('refresh', 13)} 重试</button>`
        : '';
      return `<div class="upload-task-row failed">${icon('x', 14)} <span class="ut-name">${escapeHTML(t.fileName)}</span><span class="ut-stage">${escapeHTML(t.errorHint || '')}</span>${retry}</div>`;
    }
    return `<div class="upload-task-row parsing"><span class="ut-spin"></span><span class="ut-name">${escapeHTML(t.fileName)}</span><span class="ut-stage">${escapeHTML(t.stage)}</span></div>`;
  }).join('');
}

// OcrProgress → 任务行阶段文案（拼接口径同旧 updateOcrProgress：xx% / · detail）
function updateTaskProgress(id: number, p: OcrProgress): void {
  const task = findTask(id);
  if (!task || task.status !== 'parsing') return;
  const pct = p.percent >= 0 ? ` ${p.percent}%` : '';
  const detail = p.detail ? ` · ${p.detail}` : '';
  task.stage = `${p.stage}${pct}${detail}`;
  renderTasks();
}

function completeTask(task: UploadTask): void {
  const i = uploadTasks.indexOf(task);
  if (i >= 0) uploadTasks.splice(i, 1);
  renderTasks();
  onFileParsed();
}

function failTask(task: UploadTask, errorHint: string): void {
  task.status = 'failed';
  task.errorHint = errorHint;
  state.pendingFiles--;
  renderTasks();
  onPendingSettled();
}

// 失败路径归零收尾（全部文件失败/落定，且无成功可提前进入时兜底）
function onPendingSettled(): void {
  if (state.pendingFiles > 0) return;
  updateAccumIndicator();
  showMappingStep();
  (byId('file-input') as HTMLInputElement).value = '';
}

// 行内重试：行转回 parsing、pendingFiles 重新计数，复用任务保留的 File 引用重走解析
function retryTask(task: UploadTask): void {
  task.status = 'parsing';
  task.errorHint = undefined;
  task.stage = '读取文件…';
  state.pendingFiles++;
  renderTasks();
  processOne(task);
}

// ---- 静态上传区拖拽接线（legacy.js 顶层三段 addEventListener 逐字迁入）----
export function initUploadArea(): void {
  const uploadArea = byId('upload-area');
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault(); uploadArea.classList.remove('dragover');
    if (e.dataTransfer!.files.length) handleFiles(e.dataTransfer!.files);
  });
  // 剪贴板粘贴上传（设计：剪贴板统一路由）：document 级监听随 initUploadArea 装配一次，
  // 按载荷优先级分发——文件（Explorer 复制）→ 图片（截图）→ 表格（Excel/网页复制）；
  // 可编辑目标内粘贴完全不接管，无表格签名（无 \t、无 <table>）静默忽略。
  document.addEventListener('paste', handlePasteEvent);
}

// ---- 剪贴板载荷判别（纯函数，node 桩测可直调）----
export type ClipboardPayload =
  | { kind: 'files'; files: File[] }
  | { kind: 'image'; file: File }
  | { kind: 'table'; rows: Rows };

/** 鸭子类型口径：真实 DataTransfer 或测试桩（files/items/getData 皆可选） */
export interface ClipboardLike {
  files?: ArrayLike<File>;
  items?: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }>;
  getData?: (type: string) => string;
}

/** 可编辑目标（输入框/文本域/contenteditable）内粘贴不接管，原生行为优先 */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

export function detectClipboardPayload(data: ClipboardLike | null, editableTarget: boolean): ClipboardPayload | null {
  if (!data || editableTarget) return null;
  // P1 文件（Explorer 复制；图片文件亦走此路，与拖拽同管线）
  if (data.files && data.files.length) return { kind: 'files', files: Array.from(data.files) };
  // P2 图片（截图；只取第一张，与旧监听同口径）
  if (data.items) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return { kind: 'image', file };
      }
    }
  }
  // P3 表格：text/html 含 <table> 优先（Excel/WPS 与网页复制都带），取行数最多的表
  // （Excel 剪贴板里可能有包装/元数据小表），空结果回落 TSV；text/plain 含 \t 即表格签名
  const html = data.getData?.('text/html') || '';
  if (/<table[\s>]/i.test(html)) {
    const rows = extractHtmlTableRows(html);
    if (rows.length) return { kind: 'table', rows };
  }
  const text = data.getData?.('text/plain') || '';
  if (text.includes('\t')) return { kind: 'table', rows: parseCSV(text, '\t') };
  return null;
}

// DOMParser 提取表格行：逐 tr → 逐 td/th 取 textContent 去首尾空白，跳过全空行。
// colspan/嵌套表不支持（取摊平文本）；node 环境无 DOMParser，由浏览器验收覆盖。
function extractHtmlTableRows(html: string): Rows {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));
  let best: Element | null = null;
  for (const t of tables) {
    if (!best || t.querySelectorAll('tr').length > best.querySelectorAll('tr').length) best = t;
  }
  if (!best) return [];
  const rows: string[][] = [];
  best.querySelectorAll('tr').forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td,th')).map(td => (td.textContent || '').trim());
    if (cells.some(c => c !== '')) rows.push(cells);
  });
  return rows;
}

// paste 事件入口：判别载荷 → preventDefault（仅接管时）→ 分发
export function handlePasteEvent(e: ClipboardEvent): void {
  const payload = detectClipboardPayload(
    e.clipboardData as unknown as ClipboardLike | null,
    isEditableTarget(e.target),
  );
  if (!payload) return;
  e.preventDefault();
  if (payload.kind === 'files') {
    handleFiles(payload.files);
  } else if (payload.kind === 'image') {
    const f = payload.file;
    const named = new File([f], f.name || `剪贴板图片_${Date.now()}.png`, { type: f.type });
    handleFiles([named]);
  } else {
    importPastedTable(`剪贴板表格_${Date.now()}`, payload.rows);
  }
}

// P3 粘贴表导入：任务行反馈与文件路径一致（同步解析，通常瞬间折叠进累加条）；
// paste 任务无 File 引用不可重试，失败同 unknown 无重试按钮
function importPastedTable(fileName: string, rows: Rows): void {
  state.pendingFiles++;
  state.accumFileCount++;
  const task: UploadTask = { id: ++uploadTaskSeq, fileName, kind: 'paste', status: 'parsing', stage: '解析粘贴数据…' };
  uploadTasks.push(task);
  renderTasks();
  if (!rows.length) {
    failTask(task, '剪贴板内容不是有效表格');
    return;
  }
  state.sources.push(buildCsvSource(fileName, rows));
  completeTask(task);
}

export function handleFileInput(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length) handleFiles(input.files);
}

export function handleFiles(fileList: FileList | File[]): void {
  const files = Array.from(fileList);
  state.pendingFiles += files.length;
  state.accumFileCount += files.length;
  files.forEach(f => processFile(f));
}

export function processFile(file: File): void {
  const ext = file.name.split('.').pop()!.toLowerCase();
  const kind: UploadTaskKind = ext === 'csv' ? 'csv'
    : ['xlsx', 'xls'].includes(ext) ? 'excel'
    : ext === 'pdf' ? 'pdf'
    : IMAGE_EXTS.includes(ext) ? 'image'
    : 'unknown';
  const task: UploadTask = { id: ++uploadTaskSeq, file, fileName: file.name, kind, status: 'parsing', stage: '读取文件…' };
  uploadTasks.push(task);
  renderTasks();
  processOne(task);
}

// 支持识别的图片扩展名（设计 §4；.gif 不支持——动图无 OCR 意义）
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];

// 读取 + 解析单个任务（processFile 与行内重试共用；各类型共享同一套任务行反馈）。
// 保留回调式 FileReader（旧代码同构）：CSV/XLSX 在同步 FileReader 桩（Node 回归驱动器）
// 下于 handleFiles 内同步完成；浏览器中依旧异步。onload 内 catch 统一行内失败。
function processOne(task: UploadTask): void {
  const file = task.file;
  if (!file) {
    failTask(task, '缺少文件引用'); // paste 任务不走本函数，防御性兜底
    return;
  }
  if (task.kind === 'unknown') {
    failTask(task, '不支持的文件格式');
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => failTask(task, reader.error?.message || '文件读取失败');
  reader.onload = async e => {
    try {
      if (task.kind === 'csv') {
        const text = (e.target as FileReader).result as string;
        if (isGarbled(text)) {
          const r2 = new FileReader();
          r2.onerror = () => failTask(task, r2.error?.message || '文件读取失败');
          r2.onload = e2 => {
            try {
              state.sources.push(buildCsvSource(file.name, parseCSV((e2.target as FileReader).result as string)));
              completeTask(task);
            } catch (err) {
              console.error(`${task.fileName} 解析失败`, err);
              failTask(task, err instanceof Error ? err.message : String(err));
            }
          };
          r2.readAsText(file, 'gbk');
        } else {
          state.sources.push(buildCsvSource(file.name, parseCSV(text)));
          completeTask(task);
        }
      } else if (task.kind === 'excel') {
        const data = (e.target as FileReader).result as ArrayBuffer;
        const wb = XLSX.read(data, { type: 'array' });
        analyzeWorkbookSheets(wb, file.name).forEach(item => state.sources.push(item));
        // Store raw ArrayBuffer for template-based export
        state.templateFiles[file.name] = data;
        completeTask(task);
      } else if (task.kind === 'pdf') {
        const data = (e.target as FileReader).result as ArrayBuffer;
        // 按需加载 pdf.js（仅 PDF 分支触达；Node 回归驱动器不会执行到这里）
        const { parsePdfSource } = await import('../../core/parser/pdf');
        const items = await parsePdfSource(data, file.name, p => updateTaskProgress(task.id, p));
        items.forEach(item => state.sources.push(item));
        completeTask(task);
      } else if (task.kind === 'image') {
        const data = (e.target as FileReader).result as ArrayBuffer;
        // 按需加载 OCR 编排（与 pdf.js 同模式：仅图片分支触达；含本地/LLM 双引擎选择）
        const { importImageSource } = await import('../../core/image/ocr-service');
        const item = await importImageSource(
          new Blob([data], { type: file.type || 'image/png' }),
          file.name,
          { onProgress: p => updateTaskProgress(task.id, p) },
        );
        state.sources.push(item);
        completeTask(task);
      }
    } catch (err) {
      console.error(`${task.fileName} 解析失败`, err);
      failTask(task, err instanceof Error ? err.message : String(err));
    }
  };
  if (task.kind === 'csv') reader.readAsText(file); else reader.readAsArrayBuffer(file);
}

// 重试按钮委托（data-action="retryTask" data-task-id，同 accum-indicator 的委托模式）
export function initUploadTasksDelegate(): void {
  delegateAction(byId('upload-tasks'), 'click', {
    retryTask: el => {
      const task = findTask(Number(el.dataset.taskId));
      if (task) retryTask(task);
    },
  });
}

export function onFileParsed(): void {
  state.pendingFiles--;
  // 首个成功即进入映射步骤，后续完成自动追加数据表卡片（解析不再阻塞后续步骤）；
  // file-input 复位仍待全部落定
  updateAccumIndicator();
  showMappingStep();
  if (state.pendingFiles <= 0) (byId('file-input') as HTMLInputElement).value = '';
}

export function updateAccumIndicator(): void {
  const el = byId('accum-indicator');
  const sel = state.sources.filter(s => s.selected);
  if (state.accumFileCount > 0) {
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="accum-bar">
        <span>${icon('folder', 14)} 已累加 ${state.accumFileCount} 个文件（${sel.length} 个数据表，${countSelectedRows()} 行数据）</span>
        <button class="btn btn-secondary btn-sm" data-action="resetAll">${icon('trash', 13)} 清空</button>
      </div>`;
  } else { el.classList.add('hidden'); }
}

export function countSelectedRows(): number {
  return state.sources.filter(s => s.selected).reduce((sum, s) => sum + s.rows.length, 0);
}

/** 清空上传任务行（export.ts 的 resetAll 调用；失败行随重置一并清除） */
export function resetUploadTasks(): void {
  uploadTasks.length = 0;
  renderTasks();
}

// 累加条按钮委托（原 onclick="resetAll()" → data-action="resetAll"；
// resetAll 经 setResetAllHandler 接缝注入，见文件头部说明）
export function initAccumIndicatorDelegate(): void {
  delegateAction(byId('accum-indicator'), 'click', {
    resetAll: () => invokeResetAll(),
  });
}
