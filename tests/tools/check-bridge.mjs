// 过渡期工具：验证 index.html 与 legacy.js 中内联处理器引用的全部函数
// 都已挂到 window（阶段 3 移除内联 onclick 后可删除）。
// 用法：node tests/tools/check-bridge.mjs
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { setupBrowserStubs, stubVendorGlobals } from './browser-stubs.mjs';

setupBrowserStubs();
stubVendorGlobals(XLSX, ExcelJS);
await import('../../src/legacy.js');

const src = readFileSync('index.html', 'utf8') + readFileSync('src/legacy.js', 'utf8');
const called = new Set();
for (const m of src.matchAll(/\bon[a-z]+="([^"]*)"/g)) {
  for (const c of m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) called.add(c[1]);
}
for (const fp of ['if', 'for', 'while', 'getElementById', 'click', 'preventDefault']) called.delete(fp);
const missing = [...called].filter(name => typeof window[name] !== 'function');
console.log('内联处理器引用函数数:', called.size);
console.log('window 桥缺失:', missing.length ? missing.join(', ') : '无 ✓');
console.log('__legacy.state 字段数:', Object.keys(window.__legacy.state).length);
console.log('__legacy.TEMPLATES:', Object.keys(window.__legacy.TEMPLATES).join(','));
if (missing.length) process.exit(1);
