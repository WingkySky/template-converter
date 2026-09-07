// 导出原语（ZIP 打包）—— 自 src/legacy.js 逐字搬移（阶段 1 分区 C），仅补充类型注解
// 与显式 import，不改变任何行为。
// 位置锚点：workbookToArray legacy.js L3229，crc32 L3234，dosDateTime L3250，
// u16 L3256，u32 L3263，concatBytes L3272，createZipBlob L3283。
import * as XLSX from 'xlsx';

/** workbookToArray 的入参：SheetJS 工作簿，或身边云 ExcelJS 导出的 { __exceljsBuffer } 包装 */
export type WorkbookLike = XLSX.WorkBook | { __exceljsBuffer: ArrayBuffer | Uint8Array };

// 运行时：XLSX.write({ type: 'array' }) 返回 ArrayBuffer；ExcelJS 分支为 ArrayBuffer/Uint8Array。
// 故返回类型为联合（原 createZipBlob 的 instanceof Uint8Array 分支即为此设计）。
export function workbookToArray(wb: WorkbookLike): ArrayBuffer | Uint8Array {
  const wbView = wb as XLSX.WorkBook & { __exceljsBuffer?: ArrayBuffer | Uint8Array };
  if (wbView && wbView.__exceljsBuffer) return wbView.__exceljsBuffer;
  return XLSX.write(wbView, { bookType: 'xlsx', type: 'array' });
}

export function crc32(bytes: Uint8Array): number {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32.table[i] = c >>> 0;
    }
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crc32.table[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}
// 与函数声明合并：承载原版挂在函数属性上的惰性查表缓存（crc32.table）
export namespace crc32 {
  export let table: Uint32Array | undefined;
}

export function dosDateTime(date: Date = new Date()): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

export function u16(value: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = value & 0xff;
  b[1] = (value >>> 8) & 0xff;
  return b;
}

export function u32(value: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = value & 0xff;
  b[1] = (value >>> 8) & 0xff;
  b[2] = (value >>> 16) & 0xff;
  b[3] = (value >>> 24) & 0xff;
  return b;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

/** createZipBlob 的入参文件项（data 为原始字节） */
export interface ZipEntry {
  name: string;
  data: Uint8Array | ArrayBuffer | ArrayLike<number>;
}

export function createZipBlob(files: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const { time, date } = dosDateTime();
  let offset = 0;

  files.forEach(file => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data as ArrayLike<number>);
    const crc = crc32(dataBytes);
    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length), u16(0), nameBytes
    ]);
    localParts.push(localHeader, dataBytes);

    const centralHeader = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(offset), u16(0)
  ]);

  // TS 5.7 DOM lib 的 BlobPart 仅接受 ArrayBuffer 支撑的视图，此处仅类型收窄，运行时不变
  return new Blob([...localParts, ...centralParts, endRecord] as BlobPart[], { type: 'application/zip' });
}
