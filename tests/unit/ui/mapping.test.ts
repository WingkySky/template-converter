// mapping 单测：渲染 HTML 的 data-action 改造、勾选/预览切换、列类型修改、
// confirmMapping 的 sourcesData 组装、#mapping-content 事件委托、直接导出（识别导出）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { state } from '../../../src/state';
import {
  showMappingStep, toggleSrc, setPreview, onMapChange, confirmMapping, initMappingDelegates,
  applyUserTypeOverrides,
} from '../../../src/ui/steps/mapping';
import { detectColumnMapping } from '../../../src/core/mapping/column-detect';
import { getTodayStr } from '../../../src/core/export/naming';
import { workbookToArray } from '../../../src/core/export/zip';
import * as XLSX from 'xlsx';
import { saveWorkbook } from '../../../src/io/save-file';
import { stubDom, resetState } from './test-support';
import type { StubDom } from './test-support';

// 直接导出走 io/save-file 落盘：桩环境无 window，mock 掉以断言文件名与工作簿内容
vi.mock('../../../src/io/save-file', () => ({
  saveWorkbook: vi.fn(async () => true),
}));

/** 工作簿读回为二维行数组（与 builders.test.ts 的 readBack 同款：XLSX.read 后逐行取） */
function sheetRows(wb: unknown): string[][] {
  const read = XLSX.read(workbookToArray(wb as never), { type: 'array' });
  return XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]], { header: 1, raw: false }) as string[][];
}

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

describe('applyUserTypeOverrides（2026-10-15 回归：重渲染冲掉手动标注）', () => {
  const header = ['姓名', '第一笔', '第二笔', '合计'];
  const rows = [
    ['王辉', '100.00', '200.00', '300.00'],
    ['吴佐生', '150.00', '250.00', '400.00'],
  ];

  it('用户标注覆盖自动检测结果（含改成其他类型）', () => {
    const autoMap = detectColumnMapping(header, rows);
    applyUserTypeOverrides(autoMap, { '2': 'amountTotal' }, header);
    expect(autoMap.cols['2'].type).toBe('amountTotal');
  });

  it('手动清空为「不识别」（空串）必须保留，不得被自动结果冲回（本次回归核心）', () => {
    const autoMap = detectColumnMapping(header, rows);
    // 自动检测把「合计」标成了 amount（或任何类型），用户手动清空
    autoMap.cols['3'].type = 'amount';
    applyUserTypeOverrides(autoMap, { '3': '' }, header);
    expect(autoMap.cols['3'].type).toBe('');
  });

  it('未标注列保持自动结果；标注自动未识别的新列时补建卡片', () => {
    const autoMap = detectColumnMapping(header, rows);
    applyUserTypeOverrides(autoMap, { '2': 'note' }, header);
    expect(autoMap.cols['1'].type).not.toBe('note'); // 未标注列不动
    // 现有 cols 键中删除 2 再标注，验证补建
    delete autoMap.cols['2'];
    applyUserTypeOverrides(autoMap, { '2': 'note' }, header);
    expect(autoMap.cols['2']).toMatchObject({ type: 'note', header: '第二笔' });
  });

  it('userTypes 缺省时不动任何自动结果', () => {
    const autoMap = detectColumnMapping(header, rows);
    const before = JSON.stringify(autoMap);
    applyUserTypeOverrides(autoMap, undefined, header);
    expect(JSON.stringify(autoMap)).toBe(before);
  });
});

describe('按源记忆（2026-10-27：列类型标注挂 SourceItem，切预览源不丢）', () => {
  function changeType(col: string, value: string): void {
    onMapChange({
      dataset: { col },
      value,
      parentElement: { classList: { toggle: vi.fn() } },
    } as unknown as HTMLSelectElement);
  }

  it('核心回归：s1 标注 → 切 s2 → 切回 s1，s1 保持用户标注且 s2 不被串', () => {
    pushSource('s1', [['姓名', '手机号'], ['张三', '13800138000']]);
    pushSource('s2', [['姓名', '手机号'], ['李四', '13900139000']]);
    showMappingStep(); // 预览 s1
    changeType('1', 'bankCard');
    expect(state.sources[0].userTypes).toEqual({ '1': 'bankCard' });
    expect(dom.el('mapping-content').innerHTML).toContain('<option value="bankCard" selected>');
    setPreview('s2');
    expect(state.sources[1].userTypes).toBeUndefined();
    expect(dom.el('mapping-content').innerHTML).not.toContain('<option value="bankCard" selected>');
    setPreview('s1');
    expect(state.sources[0].userTypes).toEqual({ '1': 'bankCard' });
    expect(dom.el('mapping-content').innerHTML).toContain('<option value="bankCard" selected>');
  });

  it('confirmMapping：非预览源用各自标注，analysis.autoMap 不被污染', () => {
    pushSource('s1', [['姓名', '手机号'], ['张三', '13800138000']]);
    pushSource('s2', [['甲', '乙'], ['李四', '13900139000']]);
    state.sources[1].analysis = {
      sheetName: '', rows: [], score: 0, dataRowsCount: 1, headerRowIndex: 0,
      autoMap: { cols: { '0': { type: '', header: '甲', samples: [] }, '1': { type: 'phone', header: '乙', samples: [] } } },
    };
    setPreview('s2');
    changeType('0', 'name'); // 用户把 s2 的「甲」列标为姓名
    setPreview('s1');
    confirmMapping();
    const sd = state.mappingState!.sourcesData!;
    expect(sd).toHaveLength(2);
    expect(sd[0].typeToCol.name).toBe(0);
    // 旧实现非预览源裸用 autoMap，此处只会得到 { phone: 1 }
    expect(sd[1].typeToCol).toEqual({ name: 0, phone: 1 });
    // 合并走的是克隆，analysis.autoMap 保持纯自动结果：甲列仍为未识别
    expect(state.sources[1].analysis!.autoMap.cols['0'].type).toBe('');
  });

  it('「不识别」空串标注切走切回不丢', () => {
    pushSource('s1', [['姓名', '手机号'], ['张三', '13800138000']]);
    pushSource('s2', [['姓名', '手机号'], ['李四', '13900139000']]);
    showMappingStep();
    changeType('1', '');
    setPreview('s2');
    setPreview('s1');
    expect(state.sources[0].userTypes).toEqual({ '1': '' });
    expect(dom.el('mapping-content').innerHTML).toContain('<option value="" selected>');
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

describe('直接导出（识别导出）', () => {
  // 样例行须过 smartDetectTable 的非人员行过滤（强身份标识：16 位以上卡号）
  const header = ['姓名', '备注', '账号', '金额'];
  const rows = [
    ['王辉2', '甲', '6222000011112222', '¥1,234.50'],
    ['施丽华', '', '6222000033334444', '88.90'],
  ];

  beforeEach(() => { vi.mocked(saveWorkbook).mockClear(); });

  function clickAction(action: string): void {
    const clickHandlers = dom.el('mapping-content').listeners.get('click');
    clickHandlers![0]({ target: { closest: () => ({ dataset: { action } }) } });
  }

  it('渲染两个导出按钮（data-action 进 btn-row）', () => {
    pushSource('s1', [header, ...rows]);
    showMappingStep();
    const html = dom.el('mapping-content').innerHTML;
    expect(html).toContain('data-action="exportDirectRaw"');
    expect(html).toContain('data-action="exportDirectMapped"');
    expect(html).toContain('导出原表');
    expect(html).toContain('导出整理表');
  });

  it('exportDirectRaw：文件名 {源名去扩展}_识别原表_{日期}.xlsx，内容所见即所得（仅姓名清洗）', async () => {
    pushSource('s1', [header, ...rows]);
    showMappingStep();
    initMappingDelegates();
    clickAction('exportDirectRaw');
    await vi.waitFor(() => expect(saveWorkbook).toHaveBeenCalledTimes(1));
    const [wb, fileName] = vi.mocked(saveWorkbook).mock.calls[0];
    expect(fileName).toBe(`s1_识别原表_${getTodayStr()}.xlsx`);
    const sheet = sheetRows(wb);
    expect(sheet[0]).toEqual(['姓名', '备注', '账号', '金额']);
    // 原表：仅姓名注记清洗，其余逐格原样（¥ 符号/格式保留）
    expect(sheet[1]).toEqual(['王辉', '甲', '6222000011112222', '¥1,234.50']);
    expect(sheet[2]).toEqual(['施丽华', '', '6222000033334444', '88.90']);
  });

  it('exportDirectMapped：标准表头+值清洗（金额归一），姓名注记剥离', async () => {
    pushSource('s1', [header, ...rows]);
    showMappingStep();
    initMappingDelegates();
    clickAction('exportDirectMapped');
    await vi.waitFor(() => expect(saveWorkbook).toHaveBeenCalledTimes(1));
    const [wb, fileName] = vi.mocked(saveWorkbook).mock.calls[0];
    expect(fileName).toBe(`s1_整理表_${getTodayStr()}.xlsx`);
    const sheet = sheetRows(wb);
    expect(sheet[0]).toEqual(['姓名', '备注', '银行卡号', '税前金额']);
    expect(sheet[1]).toEqual(['王辉', '甲', '6222000011112222', '1234.5']);
    expect(sheet[2]).toEqual(['施丽华', '', '6222000033334444', '88.9']);
  });

  it('mappingState 为空时 alert 拦截，不落盘', async () => {
    pushSource('s1', [header, ...rows]);
    initMappingDelegates();
    clickAction('exportDirectRaw');
    await Promise.resolve();
    expect(dom.alertMock).toHaveBeenCalledWith('没有可导出的数据');
    expect(saveWorkbook).not.toHaveBeenCalled();
  });

  it('整理表无任何已识别列时 alert 拦截，不落盘', async () => {
    state.mappingState = { mapping: { cols: { '0': { type: '', header: '甲', samples: [] } } }, dataRows: [['x']] };
    initMappingDelegates();
    clickAction('exportDirectMapped');
    await Promise.resolve();
    expect(dom.alertMock).toHaveBeenCalledWith('没有已识别的列，请先在上方确认列映射');
    expect(saveWorkbook).not.toHaveBeenCalled();
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
