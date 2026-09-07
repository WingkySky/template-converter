// 导出原语（ZIP）单测 —— 重点覆盖手写 ZIP 的高危区：createZipBlob 产物必须能被标准
// ZIP 结构解开且文件内容逐字节一致。node:zlib 的 unzipSync 只解 zlib/gzip/deflate 流、
// 并不解析 ZIP 归档（对 SheetJS 自身产出的 xlsx 也会报 incorrect header check），
// 故此处实现一个仅针对「存储模式（method=0）」的最小 ZIP 读取器：
// 走 EOCD → 中央目录 → 本地文件头完整链路，并逐条目校验 CRC-32 与内容。
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  workbookToArray, crc32, dosDateTime, u16, u32, concatBytes, createZipBlob,
} from '../../../src/core/export/zip';

function minimalWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['列A', '列B'], ['a1', 'b1']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

function u16at(bytes: Uint8Array, off: number): number {
  return bytes[off] | (bytes[off + 1] << 8);
}

function u32at(bytes: Uint8Array, off: number): number {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

function sigIs(bytes: Uint8Array, off: number, sig: [number, number, number, number]): boolean {
  return bytes[off] === sig[0] && bytes[off + 1] === sig[1] && bytes[off + 2] === sig[2] && bytes[off + 3] === sig[3];
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 仅支持存储模式（method=0）的最小 ZIP 读取器：EOCD → 中央目录 → 本地文件头 → 数据 */
function readZipEntries(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  // EOCD（无注释时固定位于末尾 22 字节）
  const eocd = zip.length - 22;
  expect(sigIs(zip, eocd, [0x50, 0x4b, 0x05, 0x06])).toBe(true);
  const total = u16at(zip, eocd + 10);
  expect(u16at(zip, eocd + 8)).toBe(total); // 本盘条目数一致
  const cdOffset = u32at(zip, eocd + 16);
  expect(cdOffset + u32at(zip, eocd + 12)).toBe(eocd); // 中央目录紧贴 EOCD

  const decoder = new TextDecoder();
  const entries: { name: string; data: Uint8Array }[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    expect(sigIs(zip, p, [0x50, 0x4b, 0x01, 0x02])).toBe(true); // 中央目录签名
    const method = u16at(zip, p + 10);
    const crcField = u32at(zip, p + 16);
    const compSize = u32at(zip, p + 20);
    const nameLen = u16at(zip, p + 28);
    const extraLen = u16at(zip, p + 30);
    const commentLen = u16at(zip, p + 32);
    const localOff = u32at(zip, p + 42);
    const name = decoder.decode(zip.slice(p + 46, p + 46 + nameLen));

    // 本地文件头：签名、存储模式、尺寸，且与中央目录一致
    expect(sigIs(zip, localOff, [0x50, 0x4b, 0x03, 0x04])).toBe(true);
    expect(u16at(zip, localOff + 8)).toBe(method);
    expect(method).toBe(0); // createZipBlob 只用存储模式
    expect(u32at(zip, localOff + 14)).toBe(crcField);
    expect(u32at(zip, localOff + 18)).toBe(compSize);
    expect(u32at(zip, localOff + 22)).toBe(compSize);
    const lNameLen = u16at(zip, localOff + 26);
    const lExtraLen = u16at(zip, localOff + 28);
    expect(decoder.decode(zip.slice(localOff + 30, localOff + 30 + lNameLen))).toBe(name);

    const data = zip.slice(localOff + 30 + lNameLen + lExtraLen, localOff + 30 + lNameLen + lExtraLen + compSize);
    expect(crc32(data)).toBe(crcField); // 数据 CRC 校验
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  expect(p).toBe(eocd); // 中央目录遍历恰好耗尽
  return entries;
}

describe('crc32', () => {
  it('标准 CRC-32 校验值："123456789" → 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });

  it('空输入为 0；查表惰性初始化为 256 项并在多次调用间复用', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32.table).toBeInstanceOf(Uint32Array);
    expect(crc32.table!.length).toBe(256);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });
});

describe('u16 / u32 / concatBytes', () => {
  it('u16/u32 小端字节序', () => {
    expect(Array.from(u16(0x1234))).toEqual([0x34, 0x12]);
    expect(Array.from(u16(20))).toEqual([20, 0]);
    expect(Array.from(u32(0x12345678))).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it('concatBytes 按序拼接并保持偏移', () => {
    expect(Array.from(concatBytes([u16(1), u32(2), new Uint8Array([9])])))
      .toEqual([1, 0, 2, 0, 0, 0, 9]);
  });
});

describe('dosDateTime', () => {
  it('DOS 时间/日期位域（秒按 2s 粒度，年份自 1980 起）', () => {
    const { time, date } = dosDateTime(new Date(2026, 8, 7, 15, 30, 8));
    expect(time).toBe((15 << 11) | (30 << 5) | Math.floor(8 / 2));
    expect(date).toBe(((2026 - 1980) << 9) | (9 << 5) | 7);
  });
});

describe('workbookToArray', () => {
  it('SheetJS 工作簿 → xlsx 字节：type:"array" 返回 ArrayBuffer，PK 头', () => {
    const bytes = workbookToArray(minimalWorkbook());
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    const u8 = new Uint8Array(bytes);
    expect(u8.length).toBeGreaterThan(0);
    expect([u8[0], u8[1]]).toEqual([0x50, 0x4b]); // "PK"
  });

  it('ExcelJS buffer 包装形状（{ __exceljsBuffer }）直通返回（同一引用）', () => {
    const passthrough = new Uint8Array([1, 2, 3]);
    expect(workbookToArray({ __exceljsBuffer: passthrough })).toBe(passthrough);
  });
});

describe('createZipBlob', () => {
  it('单文件：本地文件头/EOCD 字节结构正确，解包后内容逐字节一致', async () => {
    const data = workbookToArray(minimalWorkbook());
    const blob = createZipBlob([{ name: 'test.xlsx', data }]);
    expect(blob.type).toBe('application/zip');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const u8 = new Uint8Array(data);

    // 本地文件头：签名 PK\x03\x04 + 版本 20 + UTF-8 文件名标志 0x0800 + 存储 method 0
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(u16at(bytes, 4)).toBe(20);
    expect(u16at(bytes, 6)).toBe(0x0800);
    expect(u16at(bytes, 8)).toBe(0);
    expect(u32at(bytes, 14)).toBe(crc32(u8));           // CRC-32
    expect(u32at(bytes, 18)).toBe(u8.length);           // 压缩尺寸（存储 = 原始）
    expect(u32at(bytes, 22)).toBe(u8.length);           // 未压缩尺寸
    expect(u16at(bytes, 26)).toBe('test.xlsx'.length);  // 文件名长度
    expect(new TextDecoder().decode(bytes.slice(30, 30 + 'test.xlsx'.length))).toBe('test.xlsx');

    // EOCD（无注释时位于末尾 22 字节）：条目数、中央目录尺寸与偏移自洽
    const eocd = bytes.length - 22;
    expect([bytes[eocd], bytes[eocd + 1], bytes[eocd + 2], bytes[eocd + 3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(u16at(bytes, eocd + 8)).toBe(1);   // 本盘条目数
    expect(u16at(bytes, eocd + 10)).toBe(1);  // 总条目数
    expect(u32at(bytes, eocd + 12)).toBe(46 + 'test.xlsx'.length); // 中央目录尺寸（46 定长 + 文件名）
    expect(u32at(bytes, eocd + 16)).toBe(30 + 'test.xlsx'.length + u8.length); // 中央目录偏移 = 本地记录总长

    const entries = readZipEntries(bytes);
    expect(entries.map(e => e.name)).toEqual(['test.xlsx']);
    expect(bytesEqual(entries[0].data, u8)).toBe(true);
  });

  it('多文件（含中文文件名）：两份内容各自一致', async () => {
    const a = new Uint8Array(workbookToArray(minimalWorkbook()));
    const b = new TextEncoder().encode('列1,列2\n1,2\n');
    const blob = createZipBlob([
      { name: '第一份.xlsx', data: a },
      { name: '第二份.csv', data: b },
    ]);
    const entries = readZipEntries(new Uint8Array(await blob.arrayBuffer()));
    expect(entries.map(e => e.name).sort()).toEqual(['第一份.xlsx', '第二份.csv'].sort());
    expect(bytesEqual(entries[0].data, entries[0].name === '第一份.xlsx' ? a : b)).toBe(true);
    expect(bytesEqual(entries[1].data, entries[1].name === '第一份.xlsx' ? a : b)).toBe(true);
  });

  it('data 为 ArrayBuffer（非 Uint8Array）时同样可打包（XLSX.write 实际返回形状）', async () => {
    const raw = new TextEncoder().encode('hello zip');
    const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const blob = createZipBlob([{ name: 'a.txt', data: ab }]);
    const entries = readZipEntries(new Uint8Array(await blob.arrayBuffer()));
    expect(entries.map(e => e.name)).toEqual(['a.txt']);
    expect(new TextDecoder().decode(entries[0].data)).toBe('hello zip');
  });
});
