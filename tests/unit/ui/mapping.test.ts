// mapping 单测：渲染 HTML 的 data-action 改造、勾选/预览切换、列类型修改、
// confirmMapping 的 sourcesData 组装、#mapping-content 事件委托。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../../../src/state';
import {
  showMappingStep, toggleSrc, setPreview, onMapChange, confirmMapping, initMappingDelegates,
} from '../../../src/ui/steps/mapping';
import { stubDom, resetState } from './test-support';
import type { StubDom } from './test-support';

let dom: StubDom;
beforeEach(() => { dom = stubDom(); resetState(); });
afterEach(() => vi.unstubAllGlobals());

function pushSource(id: string, rows: string[][], selected = true): void {
  state.sources.push({ id, type: 'csv', fileName: `${id}.csv`, sheetName: '', rows, selected, analysis: null });
}

describe('showMappingStep 渲染', () => {
  it('多源时渲染数据源卡片与列映射，全部改为 data-action', () => {
    pushSource('s1', [['姓名', '手机号', '税前金额'], ['张三', '13800138000', '100']]);
    pushSource('s2', [['姓名', '手机号', '税前金额'], ['李四', '13900139000', '200']]);
    showMappingStep();
    const html = dom.el('mapping-content').innerHTML;
    expect(html).toContain('data-action="toggleSrc"');
    expect(html).toContain('data-action="setPreview"');
    expect(html).toContain('data-action="onMapChange"');
    expect(html).toContain('data-action="confirmMapping"');
    expect(html).toContain('data-action="resetAll"');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onchange');
    expect(state.mappingState).not.toBeNull();
  });

  it('全部取消勾选时提示需要重新勾选', () => {
    pushSource('s1', [['姓名'], ['张三']], false);
    pushSource('s2', [['姓名'], ['李四']], false);
    showMappingStep();
    expect(dom.el('mapping-content').innerHTML).toContain('请至少勾选一个数据表以继续列映射');
  });
});

describe('toggleSrc / setPreview', () => {
  it('toggleSrc 勾选时同步预览源，取消勾选时预览回退到首个选中源（legacy 行为）', () => {
    pushSource('s1', [['姓名'], ['张三']]);
    pushSource('s2', [['姓名'], ['李四']]);
    toggleSrc('s2', true);
    expect(state.sources[1].selected).toBe(true);
    expect(state.previewSourceId).toBe('s2');
    toggleSrc('s2', false);
    expect(state.sources[1].selected).toBe(false);
    // showMappingStep 对预览源做 sel.find(...) || sel[0] 兜底：取消勾选预览源后
    // 预览回退到首个选中源 —— 与 legacy.js 原逻辑一致
    expect(state.previewSourceId).toBe('s1');
  });

  it('setPreview 强制选中并切换预览源', () => {
    pushSource('s1', [['姓名'], ['张三']]);
    pushSource('s2', [['姓名'], ['李四']], false);
    setPreview('s2');
    expect(state.sources[1].selected).toBe(true);
    expect(state.previewSourceId).toBe('s2');
  });
});

describe('onMapChange', () => {
  it('写回 mappingState 中对应列的类型并切换 selected 样式', () => {
    state.mappingState = { mapping: { cols: { '1': { type: '', header: '手机号', samples: [] } } } };
    const toggle = vi.fn();
    const sel = {
      dataset: { col: '1' },
      value: 'name',
      parentElement: { classList: { toggle } },
    } as unknown as HTMLSelectElement;
    onMapChange(sel);
    expect(state.mappingState!.mapping!.cols['1'].type).toBe('name');
    expect(toggle).toHaveBeenCalledWith('selected', true);
  });
});

describe('confirmMapping', () => {
  it('为预览源使用用户修改的映射并写入 sourcesData，进入模版步骤', () => {
    pushSource('s1', [['姓名', '手机号'], ['张三', '13800138000']]);
    state.previewSourceId = 's1';
    state.mappingState = { mapping: { cols: { '0': { type: 'name', header: '姓名', samples: [] } } } };
    confirmMapping();
    expect(state.mappingState!.sourcesData).toHaveLength(1);
    expect(state.mappingState!.sourcesData![0].typeToCol).toEqual({ name: 0 });
    // showTemplateStep 已执行（模版卡片渲染进 stub 容器）
    expect(dom.el('template-content').innerHTML).toContain('template-card');
  });

  it('无有效数据行时 alert 拦截', () => {
    pushSource('s1', []); // 空行 → smartDetectTable 无数据行
    state.previewSourceId = 's1';
    state.mappingState = { mapping: { cols: {} } };
    confirmMapping();
    expect(dom.alertMock).toHaveBeenCalledWith('没有有效数据行');
    expect(dom.el('template-content').innerHTML).toBe('');
  });
});

describe('initMappingDelegates', () => {
  it('change 委托：单一分发器按 data-action 路由（勾选框 → toggleSrc）', () => {
    pushSource('s1', [['姓名'], ['张三']]);
    initMappingDelegates();
    // delegateAction 对 change 事件只挂一个分发器，内部按 data-action 分发 toggleSrc / onMapChange
    const changeHandlers = dom.el('mapping-content').listeners.get('change');
    expect(changeHandlers?.length).toBe(1);
    changeHandlers![0]({ target: { closest: () => ({ dataset: { action: 'toggleSrc', id: 's1' }, checked: false }) } });
    expect(state.sources[0].selected).toBe(false);
  });

  it('click 委托：确认映射按钮分发到 confirmMapping', () => {
    pushSource('s1', [['姓名', '手机号'], ['张三', '13800138000']]);
    state.previewSourceId = 's1';
    state.mappingState = { mapping: { cols: { '0': { type: 'name', header: '姓名', samples: [] } } } };
    initMappingDelegates();
    const clickHandlers = dom.el('mapping-content').listeners.get('click');
    expect(clickHandlers?.length).toBe(1);
    clickHandlers![0]({ target: { closest: () => ({ dataset: { action: 'confirmMapping' } }) } });
    expect(dom.el('template-content').innerHTML).toContain('template-card');
  });
});
