/// <reference types="vite/client" />

// File System Access API 最小类型声明（Chrome/Edge；其余浏览器走自动下载降级，
// 代码以 window.showSaveFilePicker 存在性判断）
interface FileSystemWritableFileStreamLike {
  write(data: unknown): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}
interface Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    startIn?: FileSystemFileHandleLike | string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandleLike>;
}
