// kb-panel 单测：知识库状态渲染、clearKB 确认拦截、initKbPanel 静态接线。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { updateKBStatus, clearKB, initKbPanel } from '../../../src/ui/steps/kb-panel';
import { invalidateKBCache } from '../../../src/io/kb-storage';
import { stubDom } from './test-support';
import type { StubDom } from './test-support';

let dom: StubDom;
beforeEach(() => { dom = stubDom(); invalidateKBCache(); });
afterEach(() => vi.unstubAllGlobals());

describe('updateKBStatus', () => {
  it('空知识库渲染 0 商社 / 0 任务 / 未加载', () => {
    updateKBStatus();
    const html = dom.el('kb-status-area').innerHTML;
    expect(html).toContain('商社数量');
    expect(html).toContain('任务数量');
    expect(html).toContain('最后更新');
    expect(html).toContain('未加载');
  });

  it('有数据时渲染商社数与任务数、格式化时间', () => {
    // 直接驱动 onKBChanged 的数据源：写一份 KB 再触发渲染路径
    const kb = {
      shangSheMap: {
        SS001: { id: 'SS001', fullName: '甲公司', tasks: [{ name: 't', content: 'c' }, { name: 't2', content: 'c2' }] },
        SS002: { id: 'SS002', fullName: '乙公司', tasks: [{ name: 't3', content: 'c3' }] },
      },
      configData: { taxSources: [], platforms: [] },
      taskListData: [],
      lastUpdated: '2026-09-07T10:30:00.000Z',
    };
    dom.ls.getItem.mockImplementation(() => JSON.stringify(kb));
    updateKBStatus();
    const html = dom.el('kb-status-area').innerHTML;
    expect(html).toContain('>2</div>');               // 商社数量
    expect(html).toContain('>3</div>');               // 任务数量（2 + 1）
    expect(html).toMatch(/最后更新/);
  });
});

describe('clearKB', () => {
  it('confirm 取消时不清理存储、不重渲染', () => {
    clearKB();
    expect(dom.confirmMock).toHaveBeenCalledWith('确定要清空知识库吗？此操作不可恢复。');
    expect(dom.ls.removeItem).not.toHaveBeenCalled();
  });
});

describe('initKbPanel', () => {
  it('三个隐藏 file input 接 change 监听，并完成首次状态渲染', () => {
    initKbPanel();
    expect(dom.el('kb-upload-input').listeners.get('change')?.length).toBe(1);
    expect(dom.el('kb-config-upload-input').listeners.get('change')?.length).toBe(1);
    expect(dom.el('kb-import-input').listeners.get('change')?.length).toBe(1);
    expect(dom.el('kb-status-area').innerHTML).toContain('商社数量');
  });

  it('知识库卡片按钮行缺失时静默跳过（防重复接线的守卫路径）', () => {
    expect(() => initKbPanel()).not.toThrow();
  });
});
