// File System Access API 最小类型（vite-env.d.ts 的独立类型载体，
// 供 state.ts 等 import type 使用——d.ts 内的类型默认全局可用，
// 但显式导出一份便于工具链追溯）。
export interface FileSystemWritableFileStreamLike {
  write(data: unknown): Promise<void>;
  close(): Promise<void>;
}
export interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}
