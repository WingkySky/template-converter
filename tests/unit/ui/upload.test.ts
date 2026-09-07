// upload 单测：resetAll 接缝、行数统计、不支持格式告警、解析完成回调、
// 累加条渲染与 data-action 委托。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../../../src/state';
import {
  setResetAllHandler, invokeResetAll, handleFiles, onFileParsed,
  updateAccumIndicator, countSelectedRows, initAccumIndicatorDelegate,
} from '../../../src/ui/steps/upload';
import { stubDom, resetState } from './test-support';
import type { StubDom } from './test-support';

let dom: StubDom;
beforeEach(() => { dom = stubDom(); resetState(); });
afterEach(() => vi.unstubAllGlobals());

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
  it('不支持的扩展名：alert 告警且 pendingFiles 回落，累加计数保留', () => {
    handleFiles([{ name: 'notes.txt' } as File]);
    expect(dom.alertMock).toHaveBeenCalledWith('不支持的文件格式');
    expect(state.pendingFiles).toBe(0);
    expect(state.accumFileCount).toBe(1);
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

  it('计数未归零时不触发渲染', () => {
    state.pendingFiles = 3;
    onFileParsed();
    expect(state.pendingFiles).toBe(2);
    expect(dom.el('mapping-content').innerHTML).toBe('');
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
