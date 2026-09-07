// 商社查找/匹配单测 —— 以 tests/fixtures/灵工商社数据(1).xlsx 为种子构建知识库
// （XLSX.read(readFileSync(p), {type:'buffer'})，不用 XLSX.readFile 以规避中文路径问题）。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { mergeKnowledgeRows, type KB } from '../../../src/core/kb/model';
import {
  kbLookupShangShe, kbLookupShangSheByTaxId, kbLookupShangSheByNameAll,
  kbLookupShangSheByName, kbGetShangSheIdFromLookup,
  kbDetectSourceClientInfo, kbDetectBestShangSheMatch,
} from '../../../src/core/kb/shangshe';

function makeKB(): KB {
  return { shangSheMap: {}, configData: { taxSources: [], platforms: [] }, taskListData: [], lastUpdated: null, schemaVersion: 1 };
}

let kb: KB;

beforeAll(() => {
  const fixture = fileURLToPath(new URL('../../fixtures/灵工商社数据(1).xlsx', import.meta.url));
  const wb = XLSX.read(readFileSync(fixture), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, raw: false }) as never[];
  kb = makeKB();
  mergeKnowledgeRows(rows, kb);
});

describe('kbLookupShangShe（fixture 种子）', () => {
  it('按商社编号查找：平台/税源地/费率/签约主体推断正确', () => {
    const lookup = kbLookupShangShe(kb, '0000913');
    expect(lookup).not.toBeNull();
    // 签约主体"佛山云杉人力资源服务有限公司" → 默认映射 ['佛山','甲乙'] → 甲乙 → 278.甲乙科技
    expect(lookup!.platform).toBe('278.甲乙科技');
    // 平台名含"甲乙" → 默认平台税源地映射 → 0001.湖南
    expect(lookup!.taxSource).toBe('0001.湖南');
    expect(lookup!.feeRate).toBe(9);
    expect(lookup!.shortName).toBe('甲乙商贸（灵活用工）');
    expect(lookup!.fullName).toBe('甲乙商贸（广州）有限公司');
    expect(lookup!.signEntity).toBe('佛山云杉人力资源服务有限公司');
    expect(lookup!.taxId).toBe('91440101F0E3LB8770');
  });

  it('任务回退：taskListData 为空时回退到商社自带 tasks，序号取自全局任务清单', () => {
    const lookup = kbLookupShangShe(kb, '0000913')!;
    expect(lookup.tasks).toHaveLength(1);
    expect(lookup.matchedTasks[0].name).toBe('保洁服务');
    expect(lookup.matchedTasks[0].shangSheId).toBe('0000913');
    expect(lookup.matchedTasks[0].content).toContain('保洁服务');
    expect(lookup.matchedTasks[0].fullString).toMatch(/^\d+\.保洁服务\(0000913\)$/);
    // 内容取自 KB tasks
    expect(lookup.matchedTasks[0].content).toBe(lookup.tasks[0].content);
  });

  it('空编号 / 未知编号返回 null；编号两端空白容忍', () => {
    expect(kbLookupShangShe(kb, '')).toBeNull();
    expect(kbLookupShangShe(kb, undefined)).toBeNull();
    expect(kbLookupShangShe(kb, '9999999')).toBeNull();
    expect(kbLookupShangShe(kb, ' 0000913 ')!.shortName).toBe('甲乙商贸（灵活用工）');
  });
});

describe('kbLookupShangSheByTaxId（fixture 种子）', () => {
  it('纳税人识别号精确匹配（忽略大小写与首尾空白）', () => {
    expect(kbLookupShangSheByTaxId(kb, '91440101F0E3LB8770')!.shortName).toBe('甲乙商贸（灵活用工）');
    expect(kbLookupShangSheByTaxId(kb, '  91440101f0e3lb8770 ')!.shortName).toBe('甲乙商贸（灵活用工）');
    expect(kbLookupShangSheByTaxId(kb, 'NOT-EXIST')).toBeNull();
    expect(kbLookupShangSheByTaxId(kb, '')).toBeNull();
  });
});

describe('kbLookupShangSheByName / ByNameAll（fixture 种子）', () => {
  it('简称精确匹配', () => {
    const lookup = kbLookupShangSheByName(kb, '甲乙商贸（灵活用工）');
    expect(lookup!.taxId).toBe('91440101F0E3LB8770');
  });

  it('全称精确匹配', () => {
    const lookup = kbLookupShangSheByName(kb, '甲乙商贸（广州）有限公司');
    expect(lookup!.shortName).toBe('甲乙商贸（灵活用工）');
  });

  it('模糊匹配（包含关系）', () => {
    expect(kbLookupShangSheByName(kb, '厦门分公司')!.fullName).toBe('甲乙商贸（广州）有限公司厦门分公司');
  });

  it('ByNameAll 返回全部匹配并标注匹配类型；空名返回 []', () => {
    const all = kbLookupShangSheByNameAll(kb, '甲乙商贸');
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const r of all) {
      expect(r.matchType).toBe('模糊匹配');
      expect(r.lookup.shortName || r.lookup.fullName).toBeTruthy();
    }
    expect(all.map(r => r.id)).toContain('0000913');
    expect(kbLookupShangSheByNameAll(kb, '')).toEqual([]);
  });
});

describe('kbGetShangSheIdFromLookup', () => {
  it('由 lookup 反查商社编号；null 返回空串', () => {
    const lookup = kbLookupShangShe(kb, '0000913')!;
    expect(kbGetShangSheIdFromLookup(kb, lookup)).toBe('0000913');
    expect(kbGetShangSheIdFromLookup(kb, null)).toBe('');
  });
});

describe('kbDetectSourceClientInfo', () => {
  it('源行内"标签：值"单格检测（客户名称 + 税号）', () => {
    const sources = [{ rows: [['备注', '客户名称：广州某某有限公司', '税号：91440101F0E3LB8770']] }];
    expect(kbDetectSourceClientInfo([], sources)).toEqual({
      clientName: '广州某某有限公司',
      taxId: '91440101F0E3LB8770',
    });
  });

  it('源行内"标签"独立格 + 下一格取值', () => {
    const sources = [{ rows: [['公司名称', '  南沙某公司  ']] }];
    expect(kbDetectSourceClientInfo([], sources).clientName).toBe('南沙某公司');
  });

  it('typeToCol 映射列首值兜底（检测不到时）', () => {
    const sourcesData = [
      { dataRows: [['r0c0', '映射客户', '映射税号']], typeToCol: { clientName: 1, taxId: 2 } },
    ];
    expect(kbDetectSourceClientInfo(sourcesData, [{ rows: [['无标签']] }])).toEqual({
      clientName: '映射客户',
      taxId: '映射税号',
    });
  });

  it('检测值优先于映射值；都无则空串', () => {
    const sourcesData = [{ dataRows: [['x', '映射客户']], typeToCol: { clientName: 1 } }];
    const sources = [{ rows: [['委托方：检测客户']] }];
    expect(kbDetectSourceClientInfo(sourcesData, sources).clientName).toBe('检测客户');
    expect(kbDetectSourceClientInfo([], [{ rows: [['与客户无关']] }])).toEqual({ clientName: '', taxId: '' });
  });
});

describe('kbDetectBestShangSheMatch（fixture 种子）', () => {
  it('映射列直接命中商社编号 → 直接返回 lookup', () => {
    const sourcesData = [{ dataRows: [['0000913']], typeToCol: { shangSheId: 0 } }];
    const match = kbDetectBestShangSheMatch(kb, sourcesData, []);
    expect(match.id).toBe('0000913');
    expect(match.lookup!.shortName).toBe('甲乙商贸（灵活用工）');
    expect(match.candidates).toEqual([]);
  });

  it('税号检测 → 按税号精确命中', () => {
    const sourcesData = [{ dataRows: [['x']], typeToCol: {} }];
    const sources = [{ rows: [['统一社会信用代码：91440101F0E3LB8770']] }];
    const match = kbDetectBestShangSheMatch(kb, sourcesData, sources);
    expect(match.clientName).toBe('');
    expect(match.taxId).toBe('91440101F0E3LB8770');
    expect(match.lookup!.taxId).toBe('91440101F0E3LB8770');
    expect(match.id).toBe('0000913');
  });

  it('客户名称多候选 → 返回 candidates 而不锁定', () => {
    const sourcesData = [{ dataRows: [['x']], typeToCol: {} }];
    const sources = [{ rows: [['客户名称：甲乙商贸']] }];
    const match = kbDetectBestShangSheMatch(kb, sourcesData, sources);
    expect(match.lookup).toBeNull();
    expect(match.id).toBe('');
    expect(match.candidates.length).toBeGreaterThanOrEqual(2);
    expect(match.candidates[0].label).toMatch(/^0000\d+ - /);
    expect(match.candidates[0].matchType).toBe('模糊匹配');
  });
});
