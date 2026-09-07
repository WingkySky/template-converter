// 备注面板纯逻辑/渲染串单测（node 环境，不依赖 DOM）
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getNoteColIdx, setSelectedNoteRows, renderRemarkPanel } from '../../../src/ui/export/remark-panel';
import { state } from '../../../src/state';

describe('getNoteColIdx', () => {
  afterEach(() => { state.outputHeaders = null; });

  it('命中备注/说明/remark 等列名（不区分大小写）', () => {
    state.outputHeaders = ['平台', '备注'];
    expect(getNoteColIdx()).toBe(1);
    state.outputHeaders = ['平台', '说明'];
    expect(getNoteColIdx()).toBe(1);
    state.outputHeaders = ['平台', 'Remark'];
    expect(getNoteColIdx()).toBe(1);
  });
  it('无备注列返回 -1', () => {
    state.outputHeaders = ['平台', '姓名'];
    expect(getNoteColIdx()).toBe(-1);
  });
  it('outputHeaders 为 null 时返回 -1', () => {
    expect(getNoteColIdx()).toBe(-1);
  });
});

describe('setSelectedNoteRows', () => {
  beforeEach(() => { state.outputRows = [['a'], ['b'], ['c']]; });
  afterEach(() => {
    state.outputRows = null;
    state.selectedNoteRows = [];
  });

  it('过滤越界行、去重并升序', () => {
    setSelectedNoteRows([2, 0, 5, -1, 0]);
    expect(state.selectedNoteRows).toEqual([0, 2]);
  });
});

describe('renderRemarkPanel', () => {
  beforeEach(() => {
    state.outputHeaders = ['姓名', '备注'];
    state.outputRows = [['张三', ''], ['李四', '已付']];
    state.selectedNoteRows = [];
  });
  afterEach(() => {
    state.outputHeaders = null;
    state.outputRows = null;
    state.selectedNoteRows = [];
  });

  it('有备注列时输出批量备注工具条与 data-action', () => {
    const html = renderRemarkPanel();
    expect(html).toContain('批量备注:');
    expect(html).toContain('data-action="selectVisibleNoteRows"');
    expect(html).toContain('data-action="selectAllNoteRows"');
    expect(html).toContain('data-action="clearNoteRowSelection"');
    expect(html).toContain('data-action="onNotePresetChange"');
    expect(html).toContain('data-action="applyBatchRemark"');
    expect(html).toContain('data-action="clearSelectedRemarks"');
    expect(html).toContain('id="selected-note-count"');
    expect(html).not.toContain('onclick=');
  });

  it('已选行数写入计数节点', () => {
    state.selectedNoteRows = [0, 1];
    expect(renderRemarkPanel()).toContain('<strong id="selected-note-count" style="color:var(--accent2);">2</strong>');
  });

  it('无备注列时输出空串', () => {
    state.outputHeaders = ['姓名', '平台'];
    expect(renderRemarkPanel()).toBe('');
  });
});
