// 商社信息填充/银行归属地/备注预设值单测
import { describe, it, expect } from 'vitest';
import {
  inferBankLocationFromBranch, kbFillShangSheInfoForRow, kbGetRemarkPresetValue,
  type ShangSheColIndex,
} from '../../../src/core/kb/shangshe-fill';
import type { KB } from '../../../src/core/kb/model';
import type { ShangSheLookup } from '../../../src/core/kb/shangshe';

function makeKB(): KB {
  return { shangSheMap: {}, configData: { taxSources: [], platforms: [] }, taskListData: [], lastUpdated: null, schemaVersion: 1 };
}

function makeLookup(overrides: Partial<ShangSheLookup> = {}): ShangSheLookup {
  return {
    platform: '278.甲乙科技',
    taxSource: '0001.湖南',
    tasks: [],
    matchedTasks: [{ seq: 1, name: '保洁服务', shangSheId: '0000913', content: '打扫', fullString: '1.保洁服务(0000913)' }],
    signEntity: '佛山云杉人力资源服务有限公司',
    feeRate: 6,
    shortName: '甲乙商贸（灵活用工）',
    fullName: '甲乙商贸（广州）有限公司',
    taxId: '91440101F0E3LB8770',
    ...overrides,
  };
}

const COLS: ShangSheColIndex = { platform: 1, taxSource: 7, taskList: 6, workType: 8 };

describe('inferBankLocationFromBranch', () => {
  it('剥离银行修饰词后命中城市', () => {
    expect(inferBankLocationFromBranch('中国工商银行股份有限公司佛山分行')).toBe('佛山');
    expect(inferBankLocationFromBranch('招商银行广州天河支行')).toBe('广州');
    expect(inferBankLocationFromBranch('河北银行石家庄支行')).toBe('石家庄');
  });
  it('无城市命中时回退省份', () => {
    expect(inferBankLocationFromBranch('河南分行')).toBe('河南');
  });
  it('无命中返回 "0"；空值返回 "0"', () => {
    expect(inferBankLocationFromBranch('某某支行')).toBe('0');
    expect(inferBankLocationFromBranch('')).toBe('0');
    expect(inferBankLocationFromBranch(null)).toBe('0');
  });
});

describe('kbFillShangSheInfoForRow', () => {
  it('只填充空单元格（平台/税源地/任务清单/工种）', () => {
    const kb = makeKB();
    const out = new Array(10).fill('');
    const writes: [number, string][] = [];
    kbFillShangSheInfoForRow(kb, out, makeLookup(), COLS, (idx, val) => writes.push([idx, val]), null);
    expect(writes).toEqual([
      [1, '278.甲乙科技'],
      [7, '0001.湖南'],
      [6, '1.保洁服务(0000913)'],
      [8, '保洁'],
    ]);
  });

  it('已有值的单元格不覆盖', () => {
    const kb = makeKB();
    const out = new Array(10).fill('');
    out[1] = '已有平台';
    out[6] = '已有任务';
    const writes: [number, string][] = [];
    kbFillShangSheInfoForRow(kb, out, makeLookup(), COLS, (idx, val) => writes.push([idx, val]), null);
    expect(writes).toEqual([[7, '0001.湖南'], [8, '保洁']]);
  });

  it('行内平台可推断税源地时推断值优先于 lookup.taxSource', () => {
    const kb = makeKB();
    const out = new Array(10).fill('');
    out[1] = '409.天津税地（身边云）5.6%';
    const writes: [number, string][] = [];
    kbFillShangSheInfoForRow(kb, out, makeLookup(), COLS, (idx, val) => writes.push([idx, val]), null);
    expect(writes).toEqual([[7, '0007.天津'], [6, '1.保洁服务(0000913)'], [8, '保洁']]);
  });

  it('行内平台推断不出时回退 lookup.taxSource', () => {
    const kb = makeKB();
    const out = new Array(10).fill('');
    out[1] = '未知平台XYZ';
    const writes: [number, string][] = [];
    kbFillShangSheInfoForRow(kb, out, makeLookup(), COLS, (idx, val) => writes.push([idx, val]), null);
    expect(writes[0]).toEqual([7, '0001.湖南']);
  });

  it('lookup 为空时 no-op；matchedTasks 为空时不填任务', () => {
    const kb = makeKB();
    const out = new Array(10).fill('');
    const writes: [number, string][] = [];
    kbFillShangSheInfoForRow(kb, out, null, COLS, (idx, val) => writes.push([idx, val]), null);
    expect(writes).toEqual([]);
    kbFillShangSheInfoForRow(kb, out, makeLookup({ matchedTasks: [] }), COLS, (idx, val) => writes.push([idx, val]), null);
    expect(writes).toEqual([[1, '278.甲乙科技'], [7, '0001.湖南']]);
  });

  it('rowContext 提供 rawRow/typeToCol 参与工种推断', () => {
    const kb = makeKB();
    const out = new Array(10).fill('');
    const writes: [number, string][] = [];
    kbFillShangSheInfoForRow(
      kb, out, makeLookup({ matchedTasks: [{ seq: 1, name: '其他', shangSheId: 'x', content: '', fullString: '1.其他(x)' }] }),
      COLS, (idx, val) => writes.push([idx, val]),
      { rawRow: ['负责仓储理货'], typeToCol: { note: 0 } },
    );
    expect(writes.filter(w => w[0] === 8)).toEqual([[8, '搬运']]);
  });
});

describe('kbGetRemarkPresetValue', () => {
  const kb = makeKB();
  kb.shangSheMap['0000913'] = { id: '0000913', shortName: '甲乙商贸（灵活用工）', fullName: '甲乙商贸（广州）有限公司' };

  it('filename：meta 文件名优先并去扩展名', () => {
    expect(kbGetRemarkPresetValue(kb, 'filename', {
      row: [], metaFileName: '发放明细.xlsx', selectedFileNames: [],
    })).toBe('发放明细');
  });

  it('filename：回退到选中文件名拼接（仅去最后一个扩展名）', () => {
    expect(kbGetRemarkPresetValue(kb, 'filename', {
      row: [], metaFileName: '', selectedFileNames: ['A.xlsx', 'B.csv'],
    })).toBe('A.xlsx、B');
  });

  it('date：当天日期 YYYY-MM-DD', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    expect(kbGetRemarkPresetValue(kb, 'date', { row: [] })).toBe(expected);
  });

  it('shangshe：按输出表头定位商社编号列，回填简称/全称', () => {
    const ctx = { row: ['x', 'y', '0000913'], outputHeaders: ['出错信息', '平台', '商社编号'] };
    expect(kbGetRemarkPresetValue(kb, 'shangshe', ctx)).toBe('甲乙商贸（灵活用工）');
    const noShort = makeKB();
    noShort.shangSheMap['0002'] = { id: '0002', fullName: '乙公司' };
    expect(kbGetRemarkPresetValue(noShort, 'shangshe', { row: ['0', '0', '0002'], outputHeaders: ['a', 'b', '商社编号'] })).toBe('乙公司');
    expect(kbGetRemarkPresetValue(noShort, 'shangshe', { row: ['0', '0', '不存在'], outputHeaders: ['a', 'b', '商社编号'] })).toBe('');
  });

  it('custom 与未知预设', () => {
    expect(kbGetRemarkPresetValue(kb, 'custom', { row: [], customText: ' 自定义内容 ' })).toBe(' 自定义内容 ');
    expect(kbGetRemarkPresetValue(kb, 'custom', { row: [], customText: '' })).toBe('');
    expect(kbGetRemarkPresetValue(kb, 'unknown', { row: [] })).toBe('');
  });
});
