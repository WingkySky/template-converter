// upload 单测：resetAll 接缝、行数统计、不支持格式告警、解析完成回调、
// 累加条渲染与 data-action 委托、剪贴板粘贴路由（载荷判别/分发/守卫）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../../../src/state';
import {
  setResetAllHandler, invokeResetAll, handleFiles, onFileParsed,
  updateAccumIndicator, countSelectedRows, initAccumIndicatorDelegate,
  detectClipboardPayload, handlePasteEvent,
} from '../../../src/ui/steps/upload';
import { stubDom, resetState } from './test-support';
import type { StubDom } from './test-support';
import type { ClipboardLike } from '../../../src/ui/steps/upload';

let dom: StubDom;
beforeEach(() => { dom = stubDom(); resetState(); });
afterEach(() => vi.unstubAllGlobals());

function pasteEvt(clipboard: ClipboardLike | null): ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return { clipboardData: clipboard, target: null, preventDefault: vi.fn() } as unknown as ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

describe('resetAll 接缝（setResetAllHandler / invokeResetAll）', () => {
  it('未注册时为空操作，不抛错', () => {
    expect(() => invokeResetAll()).not.toThrow();
  });

  it('注册后委托到最新实现，可替换', () => {
    const a = vi.fn();
    const b = vi.fn();
    setResetAllHandler(a);
    invokeResetAll();
    setResetAllHandler(b);
    invokeResetAll();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('countSelectedRows', () => {
  it('只汇总选中数据源的行数', () => {
    state.sources.push(
      { id: 'a', type: 'csv', fileName: 'a.csv', sheetName: '', rows: [['x'], ['y']], selected: true, analysis: null },
      { id: 'b', type: 'csv', fileName: 'b.csv', sheetName: '', rows: [['x'], ['y'], ['z']], selected: false, analysis: null },
    );
    expect(countSelectedRows()).toBe(2);
  });
});

describe('handleFiles', () => {
  it('不支持的扩展名：行内失败（无 alert、无重试按钮），pendingFiles 回落，累加计数保留', () => {
    handleFiles([{ name: 'notes.txt' } as File]);
    expect(dom.alertMock).not.toHaveBeenCalled();
    expect(state.pendingFiles).toBe(0);
    expect(state.accumFileCount).toBe(1);
    const html = dom.el('upload-tasks').innerHTML;
    expect(html).toContain('不支持的文件格式');
    expect(html).toContain('notes.txt');
    expect(html).not.toContain('data-action="retryTask"');
  });
});

describe('onFileParsed', () => {
  it('计数归零时刷新累加条、进入映射步骤并清空 file-input', () => {
    state.pendingFiles = 1;
    onFileParsed();
    expect(state.pendingFiles).toBe(0);
    expect(dom.el('file-input').value).toBe('');
    expect(dom.el('mapping-content').innerHTML).toContain('请至少勾选一个数据表以继续列映射');
  });

  it('计数未归零时也刷新累加条并渲染映射步骤（首个成功即进入，不等全部落定）', () => {
    state.pendingFiles = 3;
    state.accumFileCount = 1; // resetState 归零后显式给出累加（原写法隐式依赖上一用例泄漏，基线即红）
    dom.el('file-input').value = '待清';
    onFileParsed();
    expect(state.pendingFiles).toBe(2);
    expect(dom.el('accum-indicator').innerHTML).toContain('data-action="resetAll"');
    expect(dom.el('mapping-content').innerHTML).not.toBe('');
    expect(dom.el('file-input').value).toBe('待清');
  });
});

describe('updateAccumIndicator', () => {
  it('有累加时展示并输出 data-action="resetAll" 清空按钮', () => {
    state.accumFileCount = 2;
    updateAccumIndicator();
    expect(dom.el('accum-indicator').classList.contains('hidden')).toBe(false);
    expect(dom.el('accum-indicator').innerHTML).toContain('data-action="resetAll"');
    expect(dom.el('accum-indicator').innerHTML).toContain('已累加 2 个文件');
  });

  it('无累加时保持隐藏', () => {
    state.accumFileCount = 0;
    updateAccumIndicator();
    expect(dom.el('accum-indicator').classList.contains('hidden')).toBe(true);
  });
});

describe('initAccumIndicatorDelegate', () => {
  it('click 委托：data-action="resetAll" 经接缝调用注册的 resetAll', () => {
    const reset = vi.fn();
    setResetAllHandler(reset);
    initAccumIndicatorDelegate();
    const handlers = dom.el('accum-indicator').listeners.get('click');
    expect(handlers?.length).toBe(1);
    handlers![0]({ target: { closest: () => ({ dataset: { action: 'resetAll' } }) } });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('detectClipboardPayload（剪贴板载荷判别）', () => {
  it('空 clipboardData / 可编辑目标 → null（不接管）', () => {
    expect(detectClipboardPayload(null, false)).toBeNull();
    expect(detectClipboardPayload({ getData: () => 'a\tb' }, true)).toBeNull();
  });

  it('P1 文件优先：files 非空即返回 files 载荷（图片/表格载荷让位）', () => {
    const f = new File(['x'], '表.xlsx');
    const data: ClipboardLike = {
      files: [f],
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }],
      getData: () => 'a\tb',
    };
    expect(detectClipboardPayload(data, false)).toEqual({ kind: 'files', files: [f] });
  });

  it('P2 图片：无文件时取首个 kind=file 且 type=image/* 的 item', () => {
    const f = new File(['x'], 'shot.png', { type: 'image/png' });
    const data: ClipboardLike = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => f },
      ],
      getData: () => '',
    };
    expect(detectClipboardPayload(data, false)).toEqual({ kind: 'image', file: f });
  });

  it('P3 表格：text/plain 含制表符 → parseCSV("\\t") 行（TSV 兜底路径）', () => {
    const data: ClipboardLike = { getData: (t: string) => (t === 'text/plain' ? '姓名\t税前金额\n张三\t5200' : '') };
    expect(detectClipboardPayload(data, false)).toEqual({
      kind: 'table',
      rows: [['姓名', '税前金额'], ['张三', '5200']],
    });
  });

  it('纯文本（无 \\t、html 无 <table>）→ null 静默忽略', () => {
    const data: ClipboardLike = { getData: () => '普通一段话' };
    expect(detectClipboardPayload(data, false)).toBeNull();
  });
});

describe('handlePasteEvent（粘贴路由分发）', () => {
  it('TSV 粘贴：preventDefault、伪源进映射、累加计数 +1 且 pendingFiles 回落', () => {
    const evt = pasteEvt({ getData: (t: string) => (t === 'text/plain' ? '姓名\t税前金额\n张三\t5200' : '') });
    handlePasteEvent(evt);
    expect(evt.preventDefault).toHaveBeenCalledTimes(1);
    expect(state.sources).toHaveLength(1);
    expect(state.sources[0].type).toBe('csv');
    expect(state.sources[0].fileName).toContain('剪贴板表格_');
    expect(state.accumFileCount).toBe(1);
    expect(state.pendingFiles).toBe(0);
    expect(dom.el('mapping-content').innerHTML).not.toBe('');
  });

  it('全空白 TSV（解析后 0 行）→ 失败行「不是有效表格」，无重试按钮', () => {
    const evt = pasteEvt({ getData: () => '\t' });
    handlePasteEvent(evt);
    expect(evt.preventDefault).toHaveBeenCalledTimes(1);
    const html = dom.el('upload-tasks').innerHTML;
    expect(html).toContain('剪贴板内容不是有效表格');
    expect(html).not.toContain('data-action="retryTask"');
  });

  it('可编辑目标内粘贴不接管：不 preventDefault、不建源', () => {
    const evt = pasteEvt({ getData: () => 'a\tb' });
    (evt as unknown as { target: unknown }).target = { tagName: 'INPUT' };
    handlePasteEvent(evt);
    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(state.sources).toHaveLength(0);
  });

  it('文件粘贴（不支持格式）走现有 unknown 失败行', () => {
    const evt = pasteEvt({ files: [{ name: 'notes.txt' } as File] });
    handlePasteEvent(evt);
    expect(evt.preventDefault).toHaveBeenCalledTimes(1);
    expect(dom.el('upload-tasks').innerHTML).toContain('不支持的文件格式');
  });

  it('截图粘贴：无名图片兜底命名「剪贴板图片_*.png」建行', () => {
    vi.stubGlobal('FileReader', class { onerror: unknown = null; onload: unknown = null; readAsText(): void {} readAsArrayBuffer(): void {} });
    const f = new File(['x'], '', { type: 'image/png' });
    const evt = pasteEvt({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => f }] });
    handlePasteEvent(evt);
    expect(evt.preventDefault).toHaveBeenCalledTimes(1);
    expect(dom.el('upload-tasks').innerHTML).toContain('剪贴板图片_');
  });
});
