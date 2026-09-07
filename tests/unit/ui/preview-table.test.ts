// 预览表格纯逻辑/渲染串单测（node 环境，不依赖 DOM；
// showExportStep 依赖经 setPreviewTableDeps 注入为 spy）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setPreviewTableDeps, visiblePreviewRowCount, showMorePreviewRows, showAllPreviewRows,
  collapsePreviewRows, renderPreviewTable,
} from '../../../src/ui/export/preview-table';
import { state, DEFAULT_PREVIEW_ROW_LIMIT, PREVIEW_ROW_INCREMENT } from '../../../src/state';

function makeRows(n: number): string[][] {
  return Array.from({ length: n }, (_, i) => [`u${i}`, `n${i}`]);
}

describe('visiblePreviewRowCount', () => {
  beforeEach(() => { state.outputRows = makeRows(30); });
  afterEach(() => { state.outputRows = null; });

  it('默认取 DEFAULT_PREVIEW_ROW_LIMIT', () => {
    state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
    expect(visiblePreviewRowCount()).toBe(DEFAULT_PREVIEW_ROW_LIMIT);
  });
  it('previewRowLimit 增大后取其值', () => {
    state.previewRowLimit = 20;
    expect(visiblePreviewRowCount()).toBe(20);
  });
  it('不超过总行数', () => {
    state.previewRowLimit = 100;
    expect(visiblePreviewRowCount()).toBe(30);
  });
});

describe('预览分页动作', () => {
  let rerender: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    rerender = vi.fn();
    setPreviewTableDeps({ showExportStep: rerender });
    state.outputRows = makeRows(30);
    state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
  });
  afterEach(() => {
    state.outputRows = null;
    state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
  });

  it('showMorePreviewRows：+PREVIEW_ROW_INCREMENT 并触发重渲染', () => {
    showMorePreviewRows();
    expect(state.previewRowLimit).toBe(DEFAULT_PREVIEW_ROW_LIMIT + PREVIEW_ROW_INCREMENT);
    expect(rerender).toHaveBeenCalledTimes(1);
  });
  it('showMorePreviewRows 不超过总行数', () => {
    state.previewRowLimit = 25;
    showMorePreviewRows();
    expect(state.previewRowLimit).toBe(30);
  });
  it('showAllPreviewRows：展开全部', () => {
    showAllPreviewRows();
    expect(state.previewRowLimit).toBe(30);
    expect(rerender).toHaveBeenCalledTimes(1);
  });
  it('collapsePreviewRows：收回默认值', () => {
    state.previewRowLimit = 30;
    collapsePreviewRows();
    expect(state.previewRowLimit).toBe(DEFAULT_PREVIEW_ROW_LIMIT);
    expect(rerender).toHaveBeenCalledTimes(1);
  });
});

describe('renderPreviewTable', () => {
  beforeEach(() => {
    state.outputHeaders = ['姓名', '备注'];
    state.outputRows = [['张三', ''], ['李四', '已付']];
    state.colIndex = {};
    state.columnFilters = {};
    state.unmatchedRows = [];
    state.selectedNoteRows = [];
    state.previewRowLimit = DEFAULT_PREVIEW_ROW_LIMIT;
    state.targetTemplate = null;
  });
  afterEach(() => {
    state.outputHeaders = null;
    state.outputRows = null;
    state.columnFilters = {};
    state.unmatchedRows = [];
    state.selectedNoteRows = [];
    state.targetTemplate = null;
  });

  it('基础结构：表格容器/表头筛选按钮 data-action', () => {
    const html = renderPreviewTable();
    expect(html).toContain('<table class="result-table">');
    expect(html).toContain('data-action="toggleColumnFilter" data-col-idx="0"');
    expect(html).toContain('<span>姓名</span>');
    expect(html).not.toContain('onclick=');
  });

  it('备注列：全选开关与行内编辑输入', () => {
    state.selectedNoteRows = [1];
    const html = renderPreviewTable();
    expect(html).toContain('data-action="toggleVisibleNoteRows"');
    expect(html).toContain('data-row-idx="1" checked data-action="toggleNoteRow"');
    expect(html).toContain('data-col-idx="1"');
    expect(html).toContain('placeholder="填写备注" data-action="onNoteChange"');
  });

  it('未匹配行高亮与标记（云杉模版）', () => {
    state.targetTemplate = 'youyi';
    state.unmatchedRows = [0];
    state.outputHeaders = ['商社编号', '备注'];
    state.colIndex = { shangSheId: 0 };
    const html = renderPreviewTable();
    expect(html).toContain('<tr data-row-idx="0" class="unmatched-row">');
    expect(html).toContain('<span class="unmatched-badge">未匹配</span>');
  });

  it('分页按钮：超限出现“预览更多/全部展开”，展开后出现“收起预览”', () => {
    state.outputHeaders = ['姓名'];
    state.outputRows = makeRows(10).map(r => [r[0]]);
    state.selectedNoteRows = [];
    const html1 = renderPreviewTable();
    expect(html1).toContain('data-action="showMorePreviewRows"');
    expect(html1).toContain('data-action="showAllPreviewRows"');
    expect(html1).not.toContain('data-action="collapsePreviewRows"');
    expect(html1).toContain('已预览 8 / 10 行');

    state.previewRowLimit = 10;
    const html2 = renderPreviewTable();
    expect(html2).toContain('data-action="collapsePreviewRows"');
    expect(html2).not.toContain('data-action="showMorePreviewRows"');
  });

  it('表头筛选按钮 active 态', () => {
    state.columnFilters = { 0: new Set(['张三']) };
    const html = renderPreviewTable();
    expect(html).toContain('col-filter-btn active');
  });
});
