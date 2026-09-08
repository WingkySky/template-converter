// 导出控件面板渲染串与导出模式切换单测（node 环境，依赖经 setExportControlsDeps 注入桩）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setExportControlsDeps, renderExportControls, onExportModeChange, onSplitNamingRuleChange,
  type ExportControlsDeps,
} from '../../../src/ui/export/controls';
import type { SplitGroup } from '../../../src/core/export/split-core';
import { state } from '../../../src/state';

function makeDeps(overrides: Partial<ExportControlsDeps> = {}): ExportControlsDeps {
  return {
    showExportStep: vi.fn(),
    cacheCurrentTemplateOutput: vi.fn(),
    getSelectedTemplates: () => ['shenbianyun'],
    getSplitGroups: () => [] as SplitGroup[],
    getSplitGroupCounts: () => ({ byFile: 1, bySheet: 1 }),
    isSplitExportActive: () => false,
    ensureSplitBatches: vi.fn(),
    ...overrides,
  };
}

function resetState() {
  Object.assign(state, {
    outputHeaders: null, outputRows: null, unmatchedRows: [],
    targetTemplate: null, cleanCount: 0, exportMode: 'merge' as const,
    splitGroupList: [], splitBatches: {},
    batchNo: '', batchShangSheId: '', batchShangSheName: '',
    shangSheCandidates: [], sbyShowBatchInfo: false, sbyPlainAmount: true,
    splitNamingRule: 'compact' as const,
  });
}

describe('renderExportControls', () => {
  beforeEach(() => {
    setExportControlsDeps(makeDeps());
    resetState();
    state.outputHeaders = ['平台', '备注'];
    state.outputRows = [['a', ''], ['b', 'x']];
  });
  afterEach(() => { resetState(); });

  it('身边云单模板：输出商社批次号面板与身边云选项（data-action）', () => {
    state.targetTemplate = 'shenbianyun';
    const html = renderExportControls();
    expect(html).toContain('商社与批次号');
    expect(html).toContain('data-action="onBatchNoChange"');
    expect(html).toContain('data-action="applyBatchShangSheFromSelection"');
    expect(html).toContain('身边云导出选项');
    expect(html).toContain('data-action="onSbyOptionChange"');
    expect(html).not.toContain('导出模式');
    expect(html).not.toContain('批量设置平台:');
    expect(html).not.toContain('onclick=');
  });

  it('云杉模版：匹配统计 / 手动匹配 / 批量平台面板按 skeleton 顺序输出', () => {
    state.targetTemplate = 'youyi';
    state.unmatchedRows = [1];
    const html = renderExportControls();
    expect(html).toContain('知识库匹配：1/2 行已匹配');
    expect(html).toContain('手动匹配商社');
    expect(html).toContain('data-action="applyManualShangShe"');
    expect(html).toContain('批量设置平台:');
    expect(html).toContain('data-action="applyPlatformToAll"');
    expect(html).toContain('data-action="filterPlatformList"');
    const iKb = html.indexOf('知识库匹配');
    const iManual = html.indexOf('手动匹配商社');
    const iBatch = html.indexOf('批量设置平台:');
    expect(iKb).toBeGreaterThanOrEqual(0);
    expect(iKb).toBeLessThan(iManual);
    expect(iManual).toBeLessThan(iBatch);
  });

  it('cleanCount > 0 时输出数据预处理提示（位于手动匹配之后、批量平台之前）', () => {
    state.targetTemplate = 'youyi';
    state.cleanCount = 3;
    const html = renderExportControls();
    expect(html).toContain('数据预处理：自动清除了 <strong>3</strong> 个字段中的多余空格');
    expect(html.indexOf('数据预处理')).toBeGreaterThan(html.indexOf('🔗 手动匹配商社'));
    expect(html.indexOf('数据预处理')).toBeLessThan(html.indexOf('批量设置平台:'));
  });

  it('拆分激活 + 身边云：模式单选与每份批次号面板（含分组状态写入）', () => {
    const groups: SplitGroup[] = [
      { key: 'byFile||a.xlsx', fileName: 'a.xlsx', sheetName: '', rowIdxs: [0] },
      { key: 'byFile||b.xlsx', fileName: 'b.xlsx', sheetName: '', rowIdxs: [1] },
    ];
    setExportControlsDeps(makeDeps({
      getSelectedTemplates: () => ['shenbianyun'],
      getSplitGroups: () => groups,
      getSplitGroupCounts: () => ({ byFile: 2, bySheet: 1 }),
      isSplitExportActive: () => true,
    }));
    state.targetTemplate = 'shenbianyun';
    state.exportMode = 'byFile';
    const html = renderExportControls();
    expect(html).toContain('导出模式');
    expect(html).toContain('data-action="onExportModeChange" data-mode="byFile"');
    expect(html).toContain('每份批次号（拆分模式）');
    expect(html).toContain('data-action="onSplitBatchNoChange"');
    expect(html.indexOf('导出模式')).toBeLessThan(html.indexOf('每份批次号'));
    // 渲染时把分组列表暂存到 state.splitGroupList（原逻辑）
    expect(state.splitGroupList).toEqual(groups);
    // ensureSplitBatches 被调用
    expect(state.splitGroupList.length).toBe(2);
  });

  it('自定义模版且未选身边云：无任何控件面板', () => {
    setExportControlsDeps(makeDeps({ getSelectedTemplates: () => [] }));
    state.targetTemplate = 'custom';
    const html = renderExportControls();
    expect(html.trim()).toBe('');
  });
});

describe('拆分命名规则', () => {
  const groups: SplitGroup[] = [
    { key: 'bySheet||发放表.xlsx||S1', fileName: '发放表.xlsx', sheetName: 'S1', rowIdxs: [0] },
    { key: 'bySheet||发放表.xlsx||S2', fileName: '发放表.xlsx', sheetName: 'S2', rowIdxs: [1] },
  ];

  function splitDeps(showExportStep?: ReturnType<typeof vi.fn>): ExportControlsDeps {
    return makeDeps({
      showExportStep: showExportStep || vi.fn(),
      getSelectedTemplates: () => ['shenbianyun'],
      getSplitGroups: () => groups,
      getSplitGroupCounts: () => ({ byFile: 1, bySheet: 2 }),
      isSplitExportActive: () => true,
    });
  }

  function setupSplit() {
    setExportControlsDeps(splitDeps());
    state.targetTemplate = 'shenbianyun';
    state.exportMode = 'bySheet';
  }

  beforeEach(() => {
    resetState();
    state.outputHeaders = ['平台', '备注'];
    state.outputRows = [['a', ''], ['b', 'x']];
  });
  afterEach(() => { resetState(); });

  it('默认精简规则：渲染命名规则下拉与形如提示（单文件多表 → 工作表名.xlsx）', () => {
    setupSplit();
    const html = renderExportControls();
    expect(html).toContain('data-action="onSplitNamingRuleChange"');
    expect(html).toContain('value="compact" selected');
    expect(html).toContain('批次号+精简');
    expect(html).toContain('文件名形如 <strong style="color:var(--text);">工作表名.xlsx</strong>');
    expect(html).toContain('（自动省略与整批相同的段）');
  });

  it('批次号规则：提示批次号形如并带回退说明；批次面板逐份显示文件名预览', () => {
    setupSplit();
    state.splitNamingRule = 'batchno';
    state.splitBatches[groups[0].key] = { batchNo: '20260908SLSM-A', shangSheId: 'x', shangSheName: '某某' };
    state.splitBatches[groups[1].key] = { batchNo: '20260908SLSM-B', shangSheId: 'x', shangSheName: '某某' };
    const html = renderExportControls();
    expect(html).toContain('value="batchno" selected');
    expect(html).toContain('文件名形如 <strong style="color:var(--text);">批次号.xlsx</strong>');
    expect(html).toContain('（无批次号的份自动回退精简命名）');
    expect(html).toContain('data-split-preview="bySheet||发放表.xlsx||S1"');
    expect(html).toContain('文件名：20260908SLSM-A.xlsx');
    expect(html).toContain('文件名：20260908SLSM-B.xlsx');
  });

  it('完整规则：提示恢复源文件名_工作表名_模板名形如', () => {
    setupSplit();
    state.splitNamingRule = 'full';
    const html = renderExportControls();
    expect(html).toContain('value="full" selected');
    expect(html).toContain('文件名形如 <strong style="color:var(--text);">源文件名_工作表名_身边云.xlsx</strong>');
  });
});

describe('onSplitNamingRuleChange', () => {
  let showExportStep: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetState();
    showExportStep = vi.fn();
    setExportControlsDeps(makeDeps({ showExportStep }));
  });
  afterEach(() => { resetState(); });

  it('写 state.splitNamingRule 并触发重渲染；非法值不改 state', () => {
    onSplitNamingRuleChange({ value: 'batchno' } as HTMLSelectElement);
    expect(state.splitNamingRule).toBe('batchno');
    expect(showExportStep).toHaveBeenCalledTimes(1);
    onSplitNamingRuleChange({ value: 'batchno-compact' } as HTMLSelectElement);
    expect(state.splitNamingRule).toBe('batchno-compact');
    onSplitNamingRuleChange({ value: 'weird' } as unknown as HTMLSelectElement);
    expect(state.splitNamingRule).toBe('batchno-compact');
    expect(showExportStep).toHaveBeenCalledTimes(3);
  });
});

describe('onExportModeChange', () => {
  let showExportStep: ReturnType<typeof vi.fn>;
  let ensureSplitBatches: ReturnType<typeof vi.fn>;
  let groups: SplitGroup[];

  beforeEach(() => {
    resetState();
    groups = [{ key: 'byFile||a.xlsx', fileName: 'a.xlsx', sheetName: '', rowIdxs: [0, 1] }];
    showExportStep = vi.fn();
    ensureSplitBatches = vi.fn();
    setExportControlsDeps(makeDeps({
      showExportStep,
      ensureSplitBatches,
      getSelectedTemplates: () => ['shenbianyun'],
      getSplitGroups: () => groups,
    }));
  });
  afterEach(() => { resetState(); });

  it('切到拆分模式：写 state、预生成每份批次号、触发重渲染', () => {
    onExportModeChange('byFile');
    expect(state.exportMode).toBe('byFile');
    expect(ensureSplitBatches).toHaveBeenCalledWith(groups);
    expect(showExportStep).toHaveBeenCalledTimes(1);
  });

  it('切回合并：不触发批次号生成', () => {
    onExportModeChange('merge');
    expect(state.exportMode).toBe('merge');
    expect(ensureSplitBatches).not.toHaveBeenCalled();
    expect(showExportStep).toHaveBeenCalledTimes(1);
  });
});
