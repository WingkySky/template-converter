// template 单测：模版选择/自定义列逻辑、confirmTemplate 校验与 generateOutput 接缝、
// #template-content click + keydown 事件委托。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../../../src/state';
import {
  getSelectedTemplates, selectTemplate, addCF, rmCF, goBack, confirmTemplate,
  setGenerateOutputHandler, initTemplateDelegates,
} from '../../../src/ui/steps/template';
import { stubDom, resetState } from './test-support';
import type { StubDom } from './test-support';

let dom: StubDom;
beforeEach(() => { dom = stubDom(); resetState(); });
afterEach(() => vi.unstubAllGlobals());

describe('getSelectedTemplates', () => {
  it('优先返回 selectedTemplates，否则回退 targetTemplate 单元素数组', () => {
    state.selectedTemplates = ['yidao', 'youyi'];
    expect(getSelectedTemplates()).toEqual(['yidao', 'youyi']);
    state.selectedTemplates = [];
    state.targetTemplate = 'shenbianyun';
    expect(getSelectedTemplates()).toEqual(['shenbianyun']);
    state.targetTemplate = null;
    expect(getSelectedTemplates()).toEqual([]);
  });
});

describe('selectTemplate', () => {
  it('普通模版多选切换，targetTemplate 跟随最后选择', () => {
    selectTemplate('yidao');
    expect(state.selectedTemplates).toEqual(['yidao']);
    expect(state.targetTemplate).toBe('yidao');
    selectTemplate('youyi');
    expect(state.selectedTemplates).toEqual(['yidao', 'youyi']);
    expect(state.targetTemplate).toBe('youyi');
    selectTemplate('youyi'); // 再点一次取消
    expect(state.selectedTemplates).toEqual(['yidao']);
    expect(state.targetTemplate).toBe('yidao');
  });

  it('custom 独占选择', () => {
    selectTemplate('yidao');
    selectTemplate('custom');
    expect(state.selectedTemplates).toEqual(['custom']);
    expect(state.targetTemplate).toBe('custom');
  });

  it('渲染的卡片使用 data-action / data-key，无内联 onclick', () => {
    selectTemplate('yidao');
    const html = dom.el('template-content').innerHTML;
    expect(html).toContain('data-action="selectTemplate"');
    expect(html).toContain('data-key="yidao"');
    expect(html).toContain('template-card selected');
    expect(html).not.toContain('onclick');
  });
});

describe('自定义列 addCF / rmCF', () => {
  it('addCF 去首尾空白、去重、清空输入框', () => {
    state.targetTemplate = 'custom';
    dom.el('cf-input').value = '  列A  ';
    addCF();
    expect(state.customFields).toEqual(['列A']);
    expect(dom.el('cf-input').value).toBe('');
    dom.el('cf-input').value = '列A';
    addCF();
    expect(state.customFields).toEqual(['列A']);
  });

  it('rmCF 按索引删除', () => {
    state.customFields = ['列A', '列B', '列C'];
    rmCF(1);
    expect(state.customFields).toEqual(['列A', '列C']);
  });
});

describe('goBack', () => {
  it('隐藏指定步骤卡片', () => {
    goBack('step-template');
    expect(dom.el('step-template').classList.contains('hidden')).toBe(true);
  });
});

describe('confirmTemplate 与 generateOutput 接缝', () => {
  it('未选模版时 alert 拦截', () => {
    confirmTemplate();
    expect(dom.alertMock).toHaveBeenCalledWith('请选择模版');
  });

  it('已选模版时经接缝调用 generateOutput', () => {
    const gen = vi.fn();
    setGenerateOutputHandler(gen);
    state.selectedTemplates = ['yidao'];
    state.targetTemplate = 'yidao';
    confirmTemplate();
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it('custom 模版未添加列名时 alert 拦截', () => {
    const gen = vi.fn();
    setGenerateOutputHandler(gen);
    state.selectedTemplates = ['custom'];
    state.targetTemplate = 'custom';
    confirmTemplate();
    expect(dom.alertMock).toHaveBeenCalledWith('请添加列名');
    expect(gen).not.toHaveBeenCalled();
  });

  it('custom 模版已添加列名时放行到 generateOutput', () => {
    const gen = vi.fn();
    setGenerateOutputHandler(gen);
    state.selectedTemplates = ['custom'];
    state.targetTemplate = 'custom';
    state.customFields = ['列A'];
    confirmTemplate();
    expect(gen).toHaveBeenCalledTimes(1);
  });
});

describe('initTemplateDelegates', () => {
  it('click 委托：模版卡片 data-key 分发到 selectTemplate', () => {
    initTemplateDelegates();
    // delegateAction 对 click 事件只挂一个分发器，内部按 data-action 分发五个处理器
    const clickHandlers = dom.el('template-content').listeners.get('click');
    expect(clickHandlers?.length).toBe(1);
    clickHandlers![0]({ target: { closest: () => ({ dataset: { action: 'selectTemplate', key: 'yidao' } }) } });
    expect(state.selectedTemplates).toEqual(['yidao']);
    expect(state.targetTemplate).toBe('yidao');
  });

  it('click 委托：rmCF 按 data-idx 分发、goBack 按 data-target 分发', () => {
    state.customFields = ['列A', '列B'];
    initTemplateDelegates();
    const clickHandler = dom.el('template-content').listeners.get('click')![0];
    clickHandler({ target: { closest: () => ({ dataset: { action: 'rmCF', idx: '0' } }) } });
    expect(state.customFields).toEqual(['列B']);
    clickHandler({ target: { closest: () => ({ dataset: { action: 'goBack', target: 'step-template' } }) } });
    expect(dom.el('step-template').classList.contains('hidden')).toBe(true);
  });

  it('keydown 委托：cf-input 回车触发 addCF 并 preventDefault', () => {
    state.targetTemplate = 'custom';
    initTemplateDelegates();
    const keyHandlers = dom.el('template-content').listeners.get('keydown');
    expect(keyHandlers?.length).toBe(1);
    dom.el('cf-input').value = '列X';
    const preventDefault = vi.fn();
    keyHandlers![0]({
      target: { closest: () => ({ dataset: { action: 'cfEnter' } }) },
      key: 'Enter',
      preventDefault,
    });
    expect(state.customFields).toEqual(['列X']);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
