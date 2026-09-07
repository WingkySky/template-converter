// 过渡期共享浏览器环境桩：供 tests/tools 下的 Node 工具脚本模拟浏览器全局。
// 阶段 3 完成事件解耦后，此处只需覆盖 io 层（localStorage 等），DOM 桩可逐步删除。

function stubElement() {
  const el = {
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {},
    value: '', textContent: '', innerHTML: '',
    appendChild() {}, removeChild() {}, remove() {},
    click() {}, focus() {}, blur() {}, select() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {}, getAttribute: () => null,
    files: [],
  };
  return el;
}

export function setupBrowserStubs() {
  globalThis.window = globalThis;
  const document = {
    getElementById: () => stubElement(),
    createElement: () => stubElement(),
    addEventListener() {}, removeEventListener() {},
    body: stubElement(),
    documentElement: stubElement(),
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
  };
  globalThis.document = document;
  const storage = new Map();
  globalThis.localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    clear: () => storage.clear(),
    _map: storage,
  };
  // 同步版 FileReader 桩：processFile 的回调在赋值 onload 后立即触发，
  // 与浏览器异步行为等价（harness 只关心最终状态，不关心事件时序）。
  globalThis.FileReader = class {
    readAsText(file, enc) {
      this.onload({ target: { result: new TextDecoder(enc || 'utf-8').decode(file._buf) } });
    }
    readAsArrayBuffer(file) {
      this.onload({ target: { result: file._buf } });
    }
  };
  globalThis.alert = () => {};
  globalThis.confirm = () => true;
  if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:stub';
  if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: {} }, configurable: true });
  } catch { /* Node 自带 navigator 时沿用 */ }
  return { document, localStorage: globalThis.localStorage };
}

export function stubVendorGlobals(XLSX, ExcelJS) {
  Object.assign(globalThis.window, { XLSX, ExcelJS });
}
