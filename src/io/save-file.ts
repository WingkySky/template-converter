// io 层：文件保存（File System Access API + 自动下载降级）。
import * as XLSX from 'xlsx';
import type { WorkbookLike } from '../core/export/zip';
import { state } from '../state';

/**
 * Save workbook using File System Access API (lets user pick directory),
 * falls back to auto-download for unsupported browsers.
 */
export async function saveWorkbook(wb: WorkbookLike | null, defaultName: string): Promise<boolean> {
  // ExcelJS buffer 结果（身边云模版）
  if (wb && '__exceljsBuffer' in wb && wb.__exceljsBuffer) {
    const data = wb.__exceljsBuffer;
    if (window.showSaveFilePicker) {
      try {
        const opts: { suggestedName: string; startIn?: FileSystemFileHandleLike | string; types: { description?: string; accept: Record<string, string[]> }[] } = {
          suggestedName: defaultName,
          types: [{ description: 'Excel 文件', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
        };
        if (state.lastSaveDir) opts.startIn = state.lastSaveDir;
        const handle = await window.showSaveFilePicker(opts);
        state.lastSaveDir = handle;
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        return true;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return false;
        console.warn('showSaveFilePicker failed, falling back:', e);
      }
    }
    const blob = new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  }
  if (window.showSaveFilePicker) {
    try {
      const opts: { suggestedName: string; startIn?: FileSystemFileHandleLike | string; types: { description?: string; accept: Record<string, string[]> }[] } = {
        suggestedName: defaultName,
        types: [{ description: 'Excel 文件', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
      };
      if (state.lastSaveDir) opts.startIn = state.lastSaveDir;
      const handle = await window.showSaveFilePicker(opts);
      // 记住本次保存的目录
      state.lastSaveDir = handle;
      const writable = await handle.createWritable();
      const data = XLSX.write(wb as XLSX.WorkBook, { bookType: 'xlsx', type: 'array' });
      await writable.write(data);
      await writable.close();
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false; // user cancelled
      console.warn('showSaveFilePicker failed, falling back:', e);
    }
  }
  // Fallback: auto-download
  XLSX.writeFile(wb as XLSX.WorkBook, defaultName);
  return true;
}

/**
 * Save CSV using File System Access API, falls back to auto-download.
 */
export async function saveCSV(csvContent: string, defaultName: string): Promise<boolean> {
  if (window.showSaveFilePicker) {
    try {
      const opts: { suggestedName: string; startIn?: FileSystemFileHandleLike | string; types: { description?: string; accept: Record<string, string[]> }[] } = {
        suggestedName: defaultName,
        types: [{ description: 'CSV 文件', accept: { 'text/csv': ['.csv'] } }],
      };
      if (state.lastSaveDir) opts.startIn = state.lastSaveDir;
      const handle = await window.showSaveFilePicker(opts);
      state.lastSaveDir = handle;
      const writable = await handle.createWritable();
      await writable.write(csvContent);
      await writable.close();
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
      console.warn('showSaveFilePicker failed, falling back:', e);
    }
  }
  // Fallback
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  return true;
}

export async function saveBlobAsFile(blob: Blob, defaultName: string, description: string, accept: Record<string, string[]>): Promise<boolean> {
  if (window.showSaveFilePicker) {
    try {
      const opts: { suggestedName: string; startIn?: FileSystemFileHandleLike | string; types: { description?: string; accept: Record<string, string[]> }[] } = {
        suggestedName: defaultName,
        types: [{ description, accept }],
      };
      if (state.lastSaveDir) opts.startIn = state.lastSaveDir;
      const handle = await window.showSaveFilePicker(opts);
      state.lastSaveDir = handle;
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
      console.warn('showSaveFilePicker failed, falling back:', e);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
