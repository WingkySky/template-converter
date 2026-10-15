// 备注面板纯逻辑/渲染串单测（node 环境，不依赖 DOM）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getNoteColIdx, setSelectedNoteRows, renderRemarkPanel, getOutputFileGroups, selectNoteRowsByFile, onNoteFileSelect } from '../../../src/ui/export/remark-panel';
import { state, type OutputRowMeta } from '../../../src/state';

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

  it('预设下拉含 Sheet 名方案', () => {
    const html = renderRemarkPanel();
    expect(html).toContain('<option value="sheetname">Sheet 名</option>');
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

// ---- 2026-10-15 按文件快速选行 ----
const meta = (fileName: string): OutputRowMeta => ({ fileName, sheetName: '', rawRow: [], typeToCol: {} });

describe('getOutputFileGroups', () => {
  afterEach(() => { state.outputRowMeta = []; });

  it('按 fileName 分组计数并按首次出现保序', () => {
    state.outputRowMeta = [meta('b.xlsx'), meta('a.xlsx'), meta('b.xlsx')];
    expect(getOutputFileGroups()).toEqual([
      { fileName: 'b.xlsx', rowIdxs: [0, 2] },
      { fileName: 'a.xlsx', rowIdxs: [1] },
    ]);
  });

  it('空文件名兜底为「未命名文件」', () => {
    state.outputRowMeta = [meta(''), meta('x.xlsx'), meta('')];
    expect(getOutputFileGroups()).toEqual([
      { fileName: '未命名文件', rowIdxs: [0, 2] },
      { fileName: 'x.xlsx', rowIdxs: [1] },
    ]);
  });

  it('meta 为空返回空数组', () => {
    expect(getOutputFileGroups()).toEqual([]);
  });
});

describe('selectNoteRowsByFile / onNoteFileSelect', () => {
  beforeEach(() => {
    // updateNoteSelectionUI 触碰 document：桩成 getElementById 恒 null 走早退分支（本组只测 state）
    vi.stubGlobal('document', { getElementById: () => null });
    state.outputRows = [['a'], ['b'], ['c']];
    state.outputRowMeta = [meta('a.xlsx'), meta('b.xlsx'), meta('a.xlsx')];
    state.selectedNoteRows = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    state.outputRows = null;
    state.outputRowMeta = [];
    state.selectedNoteRows = [];
  });

  it('选中该文件全部行（升序）', () => {
    selectNoteRowsByFile('a.xlsx');
    expect(state.selectedNoteRows).toEqual([0, 2]);
  });

  it('替换旧选择而非累加', () => {
    setSelectedNoteRows([0, 1, 2]);
    selectNoteRowsByFile('b.xlsx');
    expect(state.selectedNoteRows).toEqual([1]);
  });

  it('未知文件名静默返回（不清空现有选择）', () => {
    setSelectedNoteRows([1]);
    selectNoteRowsByFile('不存在.xlsx');
    expect(state.selectedNoteRows).toEqual([1]);
  });

  it('onNoteFileSelect 读值选行并把下拉弹回占位符', () => {
    const el = { value: 'b.xlsx' } as HTMLSelectElement;
    onNoteFileSelect(el);
    expect(el.value).toBe('');
    expect(state.selectedNoteRows).toEqual([1]);
  });

  it('onNoteFileSelect 空值（占位符）直接返回', () => {
    const el = { value: '' } as HTMLSelectElement;
    onNoteFileSelect(el);
    expect(state.selectedNoteRows).toEqual([]);
  });
});

describe('renderRemarkPanel 按文件选行下拉', () => {
  beforeEach(() => {
    state.outputHeaders = ['姓名', '备注'];
    state.outputRows = [['张三', ''], ['李四', ''], ['王五', '']];
    state.outputRowMeta = [meta('a.xlsx'), meta('b.xlsx'), meta('a.xlsx')];
    state.selectedNoteRows = [];
  });
  afterEach(() => {
    state.outputHeaders = null;
    state.outputRows = null;
    state.outputRowMeta = [];
    state.selectedNoteRows = [];
  });

  it('多文件时渲染下拉、动作与带行数的选项', () => {
    const html = renderRemarkPanel();
    expect(html).toContain('id="note-file-select"');
    expect(html).toContain('data-action="onNoteFileSelect"');
    expect(html).toContain('按文件选行…');
    expect(html).toContain('>a.xlsx（2 行）</option>');
    expect(html).toContain('>b.xlsx（1 行）</option>');
  });

  it('文件名的 option value/title 经 escapeHTML', () => {
    state.outputRowMeta = [meta('<b>.xlsx'), meta('a"x.xlsx')];
    const html = renderRemarkPanel();
    expect(html).toContain('value="&lt;b&gt;.xlsx"');
    expect(html).toContain('title="a&quot;x.xlsx"');
  });

  it('仅一个文件时不渲染下拉', () => {
    state.outputRowMeta = [meta('a.xlsx'), meta('a.xlsx')];
    expect(renderRemarkPanel()).not.toContain('note-file-select');
  });
});
