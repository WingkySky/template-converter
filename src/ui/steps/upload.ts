// 第一步：上传样例文件（自 src/legacy.js 逐字搬移，阶段 3 E 分区）。
// 静态上传区拖拽接线 → initUploadArea()；累加条动态 HTML 的内联
// onclick="resetAll()" → data-action="resetAll" + initAccumIndicatorDelegate() 事件委托。
import * as XLSX from 'xlsx';
import { icon } from '../icons';
import { byId, delegateAction, escapeHTML } from '../dom';
import { state } from '../../state';
import { parseCSV, isGarbled } from '../../core/parser/parse-csv';
import { buildSourceItem } from '../../core/parser/source-item';
import { analyzeWorkbookSheets } from '../../core/parser/excel';
import { showMappingStep } from './mapping';

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

// 静态上传区拖拽接线（legacy.js 顶层三段 addEventListener 逐字迁入）
export function initUploadArea(): void {
  const uploadArea = byId('upload-area');
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault(); uploadArea.classList.remove('dragover');
    if (e.dataTransfer!.files.length) handleFiles(e.dataTransfer!.files);
  });
  // 剪贴板粘贴上传（设计 §4）：仅当剪贴板含图片文件时接管（微信截图 Ctrl+V 直达），
  // 文本粘贴不受任何影响。document 级监听，随 initUploadArea 装配一次。
  document.addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const named = new File([file], file.name || `剪贴板图片_${Date.now()}.png`, { type: file.type });
          handleFiles([named]);
          e.preventDefault();
        }
        break; // 只取第一张图片
      }
    }
  });
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
  if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target as FileReader).result as string;
      if (isGarbled(text)) {
        const r2 = new FileReader();
        r2.onload = e2 => {
          state.sources.push(buildSourceItem({ type: 'csv', fileName: file.name, rows: parseCSV((e2.target as FileReader).result as string) }));
          onFileParsed();
        };
        r2.readAsText(file, 'gbk');
      } else {
        state.sources.push(buildSourceItem({ type: 'csv', fileName: file.name, rows: parseCSV(text) }));
        onFileParsed();
      }
    };
    reader.readAsText(file, 'utf-8');
  } else if (['xlsx', 'xls'].includes(ext)) {
    const reader = new FileReader();
    reader.onload = e => {
      const data = (e.target as FileReader).result as ArrayBuffer;
      const wb = XLSX.read(data, { type: 'array' });
      const sheetItems = analyzeWorkbookSheets(wb, file.name);
      sheetItems.forEach(item => state.sources.push(item));
      // Store raw ArrayBuffer for template-based export
      state.templateFiles[file.name] = data;
      onFileParsed();
    };
    reader.readAsArrayBuffer(file);
  } else if (ext === 'pdf') {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const data = (e.target as FileReader).result as ArrayBuffer;
        // 按需加载 pdf.js（仅 PDF 分支触达；Node 回归驱动器不会执行到这里）
        const { parsePdfSource } = await import('../../core/parser/pdf');
        const items = await parsePdfSource(data, file.name);
        items.forEach(item => state.sources.push(item));
        onFileParsed();
      } catch (err) {
        console.error('PDF 解析失败', err);
        alert(`PDF 解析失败：${err instanceof Error ? err.message : String(err)}`);
        state.pendingFiles--;
        hideOcrProgress();
        if (state.pendingFiles <= 0) updateAccumIndicator();
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (IMAGE_EXTS.includes(ext)) {
    // 图片分支（设计 §3）：识别可能耗时数秒~数十秒，进度提示 + 完成后进入同一条映射管线
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const data = (e.target as FileReader).result as ArrayBuffer;
        // 按需加载 OCR 编排（与 pdf.js 同模式：仅图片分支触达；含本地/LLM 双引擎选择）
        const { importImageSource } = await import('../../core/image/ocr-service');
        const item = await importImageSource(
          new Blob([data], { type: file.type || 'image/png' }),
          file.name,
          { onProgress: p => updateOcrProgress(file.name, p) },
        );
        state.sources.push(item);
        onFileParsed();
      } catch (err) {
        console.error('图片识别失败', err);
        alert(`图片识别失败：${err instanceof Error ? err.message : String(err)}`);
        state.pendingFiles--;
        hideOcrProgress();
        if (state.pendingFiles <= 0) updateAccumIndicator();
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    alert('不支持的文件格式');
    state.pendingFiles--;
  }
}

// 支持识别的图片扩展名（设计 §4；.gif 不支持——动图无 OCR 意义）
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];

// —— OCR 进度提示（识别耗时数秒~数十秒，给明确等待反馈；元素缺失时静默，兼容测试桩）——
// percent < 0 表示不确定进度（LLM 流式接收），不显示百分比；detail 为实时输出预览
function updateOcrProgress(fileName: string, p: { percent: number; stage: string; detail?: string }): void {
  const el = document.getElementById('ocr-progress');
  if (!el) return;
  el.classList.remove('hidden');
  const pct = p.percent >= 0 ? ` ${p.percent}%` : '';
  const detail = p.detail ? ` · ${escapeHTML(p.detail)}` : '';
  el.innerHTML = `<div class="status-msg info">${icon('cloud', 14)} 正在识别 ${escapeHTML(fileName)}：${escapeHTML(p.stage)}${pct}${detail}</div>`;
}

function hideOcrProgress(): void {
  document.getElementById('ocr-progress')?.classList.add('hidden');
}

export function onFileParsed(): void {
  state.pendingFiles--;
  if (state.pendingFiles <= 0) {
    hideOcrProgress();
    updateAccumIndicator();
    showMappingStep();
    (byId('file-input') as HTMLInputElement).value = '';
  }
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

// 累加条按钮委托（原 onclick="resetAll()" → data-action="resetAll"；
// resetAll 经 setResetAllHandler 接缝注入，见文件头部说明）
export function initAccumIndicatorDelegate(): void {
  delegateAction(byId('accum-indicator'), 'click', {
    resetAll: () => invokeResetAll(),
  });
}
