// 批次号生成单测 —— chineseInitial / buildBatchNoFromShangShe / dedupeBatchNo 为 git 修复历史高危区。
import { describe, it, expect } from 'vitest';
import {
  chineseInitial, shortNameForBatch, initialsForBatchName,
  buildBatchNoFromShangShe, dedupeBatchNo, kbComputeBatchShangShe,
} from '../../../src/core/kb/batch';
import type { KB } from '../../../src/core/kb/model';
import type { ShangSheLookup } from '../../../src/core/kb/shangshe';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

describe('chineseInitial（git 高危区）', () => {
  it('常见汉字取拼音首字母', () => {
    expect(chineseInitial('陈')).toBe('C');
    expect(chineseInitial('丰')).toBe('F');
    expect(chineseInitial('田')).toBe('T');
    expect(chineseInitial('商')).toBe('S');
    expect(chineseInitial('灵')).toBe('L');
    expect(chineseInitial('佛')).toBe('F');
  });

  it('多音字特殊映射表优先', () => {
    expect(chineseInitial('晟')).toBe('S');
    expect(chineseInitial('重')).toBe('C');
    expect(chineseInitial('厦')).toBe('X');
    expect(chineseInitial('单')).toBe('S');
    expect(chineseInitial('长')).toBe('C');
  });

  it('字母大写、非汉字返回空', () => {
    expect(chineseInitial('a')).toBe('A');
    expect(chineseInitial('Z')).toBe('Z');
    expect(chineseInitial('1')).toBe('');
    expect(chineseInitial('')).toBe('');
    expect(chineseInitial('￥')).toBe('');
  });
});

describe('shortNameForBatch', () => {
  it('取最后一个"-"分段并去除公司后缀', () => {
    expect(shortNameForBatch('某某有限公司-广州分公司')).toBe('广州分');
    expect(shortNameForBatch('A-B-C')).toBe('C');
    expect(shortNameForBatch('全角－分隔—也可以')).toBe('也可以');
  });
  it('无公司后缀时原样返回；空值返回空串', () => {
    expect(shortNameForBatch('甲乙商贸（灵活用工）')).toBe('甲乙商贸（灵活用工）');
    expect(shortNameForBatch('  ')).toBe('');
    expect(shortNameForBatch(null)).toBe('');
  });
});

describe('initialsForBatchName', () => {
  it('逐字取首字母；空串回退 UNKNOWN', () => {
    expect(initialsForBatchName('甲乙商贸（灵活用工）')).toBe('JYSMLHYG');
    expect(initialsForBatchName('佛山云杉')).toBe('FSYS');
    expect(initialsForBatchName('ABC')).toBe('ABC');
    expect(initialsForBatchName('')).toBe('UNKNOWN');
  });
});

describe('buildBatchNoFromShangShe', () => {
  it('今日日期 + 简称首字母 + "-A"', () => {
    const lookup = { shortName: '甲乙商贸（灵活用工）', fullName: '甲乙商贸（广州）有限公司' } as ShangSheLookup;
    expect(buildBatchNoFromShangShe(lookup)).toBe(`${todayStr()}JYSMLHYG-A`);
  });
  it('简称缺失时用全称；lookup 为空返回空串', () => {
    const lookup = { fullName: '某某有限公司-佛山分公司' } as ShangSheLookup;
    // 分段后"佛山分公司"去公司后缀 → "佛山分" → 首字母 FSF
    expect(buildBatchNoFromShangShe(lookup)).toBe(`${todayStr()}FSF-A`);
    expect(buildBatchNoFromShangShe(null)).toBe('');
    expect(buildBatchNoFromShangShe(undefined)).toBe('');
  });
});

describe('dedupeBatchNo（git 高危区）', () => {
  it('无冲突原样返回', () => {
    expect(dedupeBatchNo('20260907FSYS-A', new Set())).toBe('20260907FSYS-A');
    expect(dedupeBatchNo('20260907FSYS-A', new Set(['20260907FSYS-B']))).toBe('20260907FSYS-A');
  });
  it('冲突时按字母递增 -B/-C', () => {
    expect(dedupeBatchNo('20260907FSYS-A', new Set(['20260907FSYS-A']))).toBe('20260907FSYS-B');
    expect(dedupeBatchNo('20260907FSYS-A', new Set(['20260907FSYS-A', '20260907FSYS-B']))).toBe('20260907FSYS-C');
  });
  it('无 -X 后缀的批次号冲突时追加 -A 起步', () => {
    expect(dedupeBatchNo('20260907X', new Set(['20260907X']))).toBe('20260907X-A');
  });
});

describe('kbComputeBatchShangShe（applyBatchShangShe 纯核心）', () => {
  const kb: KB = {
    shangSheMap: {
      '0000913': { id: '0000913', shortName: '甲乙商贸（灵活用工）', fullName: '甲乙商贸（广州）有限公司' },
    },
    configData: { taxSources: [], platforms: [] },
    taskListData: [],
    lastUpdated: null,
    schemaVersion: 1,
  };
  const lookup = { shortName: '甲乙商贸（灵活用工）', fullName: '甲乙商贸（广州）有限公司' } as ShangSheLookup;

  it('显式 id 优先；名称与批次号正确', () => {
    expect(kbComputeBatchShangShe(kb, lookup, '0000913')).toEqual({
      batchShangSheId: '0000913',
      batchShangSheName: '甲乙商贸（灵活用工）',
      batchNo: `${todayStr()}JYSMLHYG-A`,
    });
  });

  it('id 缺省时按 lookup 反查商社编号', () => {
    expect(kbComputeBatchShangShe(kb, lookup, '').batchShangSheId).toBe('0000913');
    expect(kbComputeBatchShangShe(kb, null, '').batchShangSheId).toBe('');
    expect(kbComputeBatchShangShe(kb, null, '').batchShangSheName).toBe('');
    expect(kbComputeBatchShangShe(kb, null, '').batchNo).toBe('');
  });

  it('简称缺失时名称回退全称', () => {
    const onlyFullName = { fullName: '某某公司' } as ShangSheLookup;
    expect(kbComputeBatchShangShe(kb, onlyFullName, '0000913').batchShangSheName).toBe('某某公司');
  });
});
