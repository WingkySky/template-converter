// tests/unit/ui/test-support.ts —— 步骤模块单测共用的最小 DOM / 全局 stub。
// 只覆盖被测路径用到的 API；getElementById 对未知 id 返回 null（byId 调用会
// 显式失败），以暴露模块内的拼写错误。模块本身在 import 时不触碰 DOM。
import { vi } from 'vitest';
import { state } from '../../../src/state';

export interface StubElement {
  id: string;
  innerHTML: string;
  value: string;
  checked: boolean;
  dataset: Record<string, string>;
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    toggle: (cls: string, force?: boolean) => void;
    contains: (cls: string) => boolean;
  };
  listeners: Map<string, Array<(e?: unknown) => void>>;
  addEventListener: (type: string, fn: (e?: unknown) => void) => void;
}

export interface StubDom {
  el: (id: string) => StubElement;
  alertMock: ReturnType<typeof vi.fn>;
  confirmMock: ReturnType<typeof vi.fn>;
  ls: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
}

// 步骤模块运行期会触碰的静态节点（index.html 骨架 + cf-input 动态节点）
const KNOWN_IDS = [
  'kb-status-area', 'kb-upload-input', 'kb-config-upload-input', 'kb-import-input',
  'upload-area', 'file-input', 'accum-indicator',
  'mapping-content', 'template-content', 'export-content',
  'step-mapping', 'step-template', 'step-export',
  'cf-input',
];

function makeStubElement(id: string): StubElement {
  const classes = new Set<string>(['hidden']);
  const listeners = new Map<string, Array<(e?: unknown) => void>>();
  return {
    id,
    innerHTML: '',
    value: '',
    checked: false,
    dataset: {},
    classList: {
      add: cls => { classes.add(cls); },
      remove: cls => { classes.delete(cls); },
      toggle: (cls, force) => {
        const on = force === undefined ? !classes.has(cls) : force;
        if (on) classes.add(cls); else classes.delete(cls);
      },
      contains: cls => classes.has(cls),
    },
    listeners,
    addEventListener: (type, fn) => {
      const arr = listeners.get(type) || [];
      arr.push(fn);
      listeners.set(type, arr);
    },
  };
}

export function stubDom(): StubDom {
  const registry = new Map<string, StubElement>();
  const el = (id: string): StubElement => {
    let e = registry.get(id);
    if (!e) { e = makeStubElement(id); registry.set(id, e); }
    return e;
  };
  const ls = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  const alertMock = vi.fn();
  const confirmMock = vi.fn(() => false);
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('alert', alertMock);
  vi.stubGlobal('confirm', confirmMock);
  vi.stubGlobal('document', {
    getElementById: (id: string) => (KNOWN_IDS.includes(id) ? el(id) : null),
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
    addEventListener: () => {},
    createElement: () => makeStubElement(''),
    body: makeStubElement('body'),
  });
  return { el, alertMock, confirmMock, ls };
}

/** 复位步骤模块用到的 state 单例字段（vitest 按文件隔离，但文件内用例间需复位） */
export function resetState(): void {
  state.sources = [];
  state.previewSourceId = '';
  state.pendingFiles = 0;
  state.accumFileCount = 0;
  state.mappingState = null;
  state.targetTemplate = null;
  state.selectedTemplates = [];
  state.templateOutputs = {};
  state.customFields = [];
}
