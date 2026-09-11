// kb-config-panel 单测：生效值视图、五类数据的增删改语义、DEFAULT 种子化、弹层开关与委托接线。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  openKBConfigPanel, closeKBConfigPanel, renderKBConfigPanel, initKBConfigPanel,
  kbConfigAddListItem, kbConfigUpdateListItem, kbConfigDeleteListItem,
  kbConfigAddSignEntity, kbConfigUpdateSignEntity, kbConfigDeleteSignEntity,
  kbConfigAddPlatTaxSource, kbConfigDeletePlatTaxSource,
  kbConfigAddTaskEntry, kbConfigUpdateTaskEntry, kbConfigDeleteTaskEntry,
} from '../../../src/ui/steps/kb-config-panel';
import { invalidateKBCache } from '../../../src/io/kb-storage';
import { DEFAULT_CONFIG } from '../../../src/core/kb/model';
import { stubDom } from './test-support';
import type { StubDom } from './test-support';

let dom: StubDom;
beforeEach(() => { dom = stubDom(); invalidateKBCache(); });
afterEach(() => vi.unstubAllGlobals());

// 预置 localStorage 中的知识库（默认已上传一份最小配置）
function seedStorage(overrides: { configData?: Record<string, unknown>; taskListData?: string[] } = {}): void {
  const kb = {
    shangSheMap: {},
    configData: overrides.configData ?? { taxSources: ['0001.湖南'], platforms: ['278.甲乙科技'] },
    taskListData: overrides.taskListData ?? [],
    lastUpdated: null,
    schemaVersion: 1,
  };
  dom.ls.getItem.mockImplementation(() => JSON.stringify(kb));
}

// 取最近一次 saveKB 写入的内容
function lastSaved(): {
  configData: { taxSources: string[]; platforms: string[]; signEntityMapping?: Record<string, string[]>; platformTaxSourceMapping?: Record<string, string> };
  taskListData: string[];
} {
  const calls = dom.ls.setItem.mock.calls;
  return JSON.parse(calls[calls.length - 1][1]);
}

describe('弹层开关与渲染', () => {
  it('未上传配置时展示 DEFAULT_CONFIG 生效值，弹层可见', () => {
    openKBConfigPanel(); // getItem 默认返回 null → 空 KB
    const html = dom.el('kb-config-panel-body').innerHTML;
    expect(html).toContain('税源地');
    expect(html).toContain('平台');
    expect(html).toContain('签约主体映射');
    expect(html).toContain('平台税源地映射');
    expect(html).toContain('任务清单');
    expect(html).toContain('0001.湖南');   // DEFAULT 列表
    expect(html).toContain('278.甲乙科技');
    expect(html).toContain('佛山云杉');    // DEFAULT 签约主体映射
    expect(dom.el('kb-config-modal').classList.contains('hidden')).toBe(false);
  });

  it('已上传配置时渲染上传值与任务清单', () => {
    seedStorage({ taskListData: ['1.保洁(0001)'] });
    renderKBConfigPanel();
    const html = dom.el('kb-config-panel-body').innerHTML;
    expect(html).toContain('0001.湖南');
    expect(html).toContain('1.保洁(0001)');
    expect(html).toContain('data-action="kbcmListDelete"');
    expect(html).toContain('data-action="kbcmTaskChange"');
    // 映射未上传时展示 DEFAULT 兜底（与 tax-source 运行时口径一致）
    expect(html).toContain('佛山云杉');
  });

  it('closeKBConfigPanel 隐藏弹层', () => {
    openKBConfigPanel();
    closeKBConfigPanel();
    expect(dom.el('kb-config-modal').classList.contains('hidden')).toBe(true);
  });
});

describe('税源地/平台列表增删改', () => {
  it('添加写入并保存；重复添加被拒绝', () => {
    seedStorage();
    expect(kbConfigAddListItem('taxSources', '0008.江西')).toBe(true);
    const kb = lastSaved();
    expect(kb.configData.taxSources).toEqual(['0001.湖南', '0008.江西']);
    expect(kb.configData.platforms).toEqual(['278.甲乙科技']);
    expect(kbConfigAddListItem('taxSources', '0008.江西')).toBe(false);
    expect(dom.alertMock).toHaveBeenCalledWith('「0008.江西」已存在');
  });

  it('未上传配置时首次编辑以 DEFAULT 生效值种子化（所见即生效）', () => {
    seedStorage({ configData: { taxSources: [], platforms: [] } });
    kbConfigAddListItem('taxSources', '0008.江西');
    const kb = lastSaved();
    expect(kb.configData.taxSources).toEqual([...DEFAULT_CONFIG.taxSources, '0008.江西']);
    expect(kb.configData.platforms).toEqual(DEFAULT_CONFIG.platforms);
  });

  it('更新指定项；更新为已存在的其他值被拒绝', () => {
    seedStorage({ configData: { taxSources: ['0001.湖南', '0002.海南'], platforms: ['P1'] } });
    expect(kbConfigUpdateListItem('taxSources', 1, '0002.海南东')).toBe(true);
    expect(lastSaved().configData.taxSources).toEqual(['0001.湖南', '0002.海南东']);
    expect(kbConfigUpdateListItem('taxSources', 1, '0001.湖南')).toBe(false);
    expect(dom.alertMock).toHaveBeenCalledWith('「0001.湖南」已存在');
  });

  it('删除需确认：取消不动，确认后移除', () => {
    seedStorage();
    dom.confirmMock.mockReturnValue(false);
    expect(kbConfigDeleteListItem('taxSources', 0)).toBe(false);
    expect(dom.ls.setItem).not.toHaveBeenCalled();
    dom.confirmMock.mockReturnValue(true);
    expect(kbConfigDeleteListItem('taxSources', 0)).toBe(true);
    expect(lastSaved().configData.taxSources).toEqual([]);
  });
});

describe('签约主体映射增删改', () => {
  it('无映射时以 DEFAULT 种子化，更新保留其余键', () => {
    seedStorage();
    expect(kbConfigUpdateSignEntity('佛山云杉', '佛山云杉', '佛山，甲乙')).toBe(true);
    const mapping = lastSaved().configData.signEntityMapping!;
    expect(Object.keys(mapping)).toContain('广州云杉'); // DEFAULT 其余键保留
    expect(mapping['佛山云杉']).toEqual(['佛山', '甲乙']);
  });

  it('新增与确认删除', () => {
    seedStorage();
    expect(kbConfigAddSignEntity('测试主体', '测试,关键词')).toBe(true);
    expect(lastSaved().configData.signEntityMapping!['测试主体']).toEqual(['测试', '关键词']);
    dom.confirmMock.mockReturnValue(true);
    expect(kbConfigDeleteSignEntity('测试主体')).toBe(true);
    expect(lastSaved().configData.signEntityMapping!['测试主体']).toBeUndefined();
  });

  it('重命名到已存在的主体被拒绝', () => {
    seedStorage();
    kbConfigAddSignEntity('甲主体', '甲'); // 种子化 DEFAULT 后新增
    expect(kbConfigUpdateSignEntity('甲主体', '广州国联', '甲')).toBe(false);
    expect(dom.alertMock).toHaveBeenCalledWith('签约主体「广州国联」已存在');
  });
});

describe('平台税源地映射增删改', () => {
  it('新增写入；确认删除后移除', () => {
    seedStorage();
    expect(kbConfigAddPlatTaxSource('测试平台', '0007.天津')).toBe(true);
    expect(lastSaved().configData.platformTaxSourceMapping!['测试平台']).toBe('0007.天津');
    dom.confirmMock.mockReturnValue(true);
    expect(kbConfigDeletePlatTaxSource('测试平台')).toBe(true);
    expect(lastSaved().configData.platformTaxSourceMapping!['测试平台']).toBeUndefined();
  });
});

describe('任务清单增删改', () => {
  it('新增/更新/删除；重复条目被拒绝', () => {
    seedStorage({ taskListData: ['1.保洁(0001)'] });
    expect(kbConfigAddTaskEntry('2.搬运(0002)')).toBe(true);
    expect(lastSaved().taskListData).toEqual(['1.保洁(0001)', '2.搬运(0002)']);
    expect(kbConfigAddTaskEntry('2.搬运(0002)')).toBe(false);
    expect(dom.alertMock).toHaveBeenCalledWith('该任务条目已存在');
    expect(kbConfigUpdateTaskEntry(0, '9.保洁(0001)')).toBe(true);
    expect(lastSaved().taskListData[0]).toBe('9.保洁(0001)');
    dom.confirmMock.mockReturnValue(true);
    expect(kbConfigDeleteTaskEntry(1)).toBe(true);
    expect(lastSaved().taskListData).toEqual(['9.保洁(0001)']);
  });
});

describe('事件接线', () => {
  it('initKBConfigPanel 在弹层根节点注册委托与打开按钮', () => {
    initKBConfigPanel();
    const overlay = dom.el('kb-config-modal');
    expect(dom.el('kb-btn-manage-config').listeners.get('click')?.length).toBe(1);
    // click ×2：data-action 委托 + 遮罩空白关闭；change/keydown ×1：委托
    expect(overlay.listeners.get('click')?.length).toBe(2);
    expect(overlay.listeners.get('change')?.length).toBe(1);
    expect(overlay.listeners.get('keydown')?.length).toBe(1);
  });

  it('modal-head 内的关闭按钮经根节点委托关闭弹层（回归：按钮在 body 外）', () => {
    initKBConfigPanel();
    const overlay = dom.el('kb-config-modal');
    overlay.classList.remove('hidden');
    const delegate = overlay.listeners.get('click')![0];
    delegate({ target: { closest: () => ({ dataset: { action: 'kbcmClose' } }) } });
    expect(overlay.classList.contains('hidden')).toBe(true);
  });

  it('点击遮罩自身关闭，点击弹层内部不关闭', () => {
    initKBConfigPanel();
    const overlay = dom.el('kb-config-modal');
    const backdropHandler = overlay.listeners.get('click')![1];
    overlay.classList.remove('hidden');
    backdropHandler({ target: overlay });
    expect(overlay.classList.contains('hidden')).toBe(true);
    overlay.classList.remove('hidden');
    backdropHandler({ target: {} });
    expect(overlay.classList.contains('hidden')).toBe(false);
  });
});
