// 知识库数据模型单测 —— mergeKnowledgeRows 合并/更新计数为 git 修复历史高危区。
import { describe, it, expect } from 'vitest';
import {
  KB_STORAGE_KEY, KB_SCHEMA_VERSION, KB_MAIN_HEADERS, DEFAULT_CONFIG,
  getConfigLists, migrateKB, mergeKnowledgeRows, knowledgeRowsFromKB,
  applyConfigSheetRows, applyTaskListSheetRows, type KB,
} from '../../../src/core/kb/model';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

function makeKB(): KB {
  return { shangSheMap: {}, configData: { taxSources: [], platforms: [] }, taskListData: [], lastUpdated: null, schemaVersion: 1 };
}

describe('KB 常量', () => {
  it('存储键 / 版本号 / 主表头与 legacy 一致', () => {
    expect(KB_STORAGE_KEY).toBe('lg_knowledge_base');
    expect(KB_SCHEMA_VERSION).toBe(1);
    expect(KB_MAIN_HEADERS).toEqual(['商社编号','商社简称','商社全称','一级业务类型','二级业务类型','纳税人识别号','签约费率','签约主体','任务名称','服务内容']);
  });
});

describe('migrateKB', () => {
  it('补写缺失/过低版本号', () => {
    const kb = makeKB() as KB;
    expect(migrateKB(kb).schemaVersion).toBe(1);
    const old = { ...makeKB(), schemaVersion: 0 } as KB;
    expect(migrateKB(old).schemaVersion).toBe(1);
  });
});

describe('mergeKnowledgeRows（git 高危区：合并/更新计数）', () => {
  it('首次合并计新增，再次合并同数据计更新', () => {
    const kb = makeKB();
    const rows = [
      KB_MAIN_HEADERS,
      ['0000913','甲乙商贸（灵活用工）','甲乙商贸（广州）有限公司','','','91440101F0E3LB8770','6','佛山云杉人力资源服务有限公司','保洁服务','打扫'],
    ];
    expect(mergeKnowledgeRows(rows, kb)).toEqual({ newCount: 1, updateCount: 0 });
    expect(mergeKnowledgeRows(rows, kb)).toEqual({ newCount: 0, updateCount: 1 });
  });

  it('同名同内容任务不重复追加；不同内容追加', () => {
    const kb = makeKB();
    const row = (task: string, content: string) => [
      KB_MAIN_HEADERS, ['0001','甲','甲公司','','','T1','6','佛山云杉', task, content],
    ];
    mergeKnowledgeRows(row('保洁', '打扫'), kb);
    mergeKnowledgeRows(row('保洁', '打扫'), kb); // 完全相同 → 不追加
    expect(kb.shangSheMap['0001'].tasks).toEqual([{ name: '保洁', content: '打扫' }]);
    mergeKnowledgeRows(row('保洁', '擦玻璃'), kb); // 同名不同内容 → 追加
    expect(kb.shangSheMap['0001'].tasks).toHaveLength(2);
  });

  it('空字段不覆盖已有值；feeRate 仅在有值时更新', () => {
    const kb = makeKB();
    mergeKnowledgeRows([KB_MAIN_HEADERS, ['0001','甲','甲公司','','','T1','6','佛山云杉','','']], kb);
    mergeKnowledgeRows([KB_MAIN_HEADERS, ['0001','','','','','','','','','']], kb); // 全空 → 不覆盖
    const entry = kb.shangSheMap['0001'];
    expect(entry.shortName).toBe('甲');
    expect(entry.taxId).toBe('T1');
    expect(entry.feeRate).toBe(6);
  });

  it('商社编号为空的行跳过；行缺失容忍（row || []）', () => {
    const kb = makeKB();
    const result = mergeKnowledgeRows([KB_MAIN_HEADERS, [], ['', 'x'], [undefined, 'y'], ['0002','乙']], kb);
    expect(result).toEqual({ newCount: 1, updateCount: 0 });
    expect(Object.keys(kb.shangSheMap)).toEqual(['0002']);
  });

  it('数值型费率字符串解析（parseFloat 兜底 0）', () => {
    const kb = makeKB();
    mergeKnowledgeRows([KB_MAIN_HEADERS, ['0001','甲','甲公司','','','T1','8.5','佛山云杉','','']], kb);
    expect(kb.shangSheMap['0001'].feeRate).toBe(8.5);
    mergeKnowledgeRows([KB_MAIN_HEADERS, ['0002','乙','乙公司','','','T2','abc','佛山云杉','','']], kb);
    expect(kb.shangSheMap['0002'].feeRate).toBe(0);
  });
});

describe('knowledgeRowsFromKB', () => {
  it('无任务商社输出一行空任务列；每任务一行', () => {
    const kb = makeKB();
    kb.shangSheMap['0001'] = { id: '0001', shortName: '甲', fullName: '甲公司', taxId: 'T1', feeRate: 6, signEntity: '佛山云杉', tasks: [{ name: '保洁', content: '打扫' }, { name: '搬运', content: '搬货' }] };
    kb.shangSheMap['0002'] = { id: '0002', shortName: '乙', fullName: '乙公司', taxId: 'T2', feeRate: '', signEntity: '', tasks: [] };
    const rows = knowledgeRowsFromKB(kb);
    expect(rows[0]).toEqual(KB_MAIN_HEADERS);
    expect(rows[1]).toEqual(['0001','甲','甲公司','','','T1',6,'佛山云杉','保洁','打扫']);
    expect(rows[2]).toEqual(['0001','甲','甲公司','','','T1',6,'佛山云杉','搬运','搬货']);
    expect(rows[3]).toEqual(['0002','乙','乙公司','','','T2','','','','']);
    expect(rows).toHaveLength(4);
  });
});

describe('applyConfigSheetRows / applyTaskListSheetRows', () => {
  it('写入配置表数据；全空行不覆盖', () => {
    const kb = makeKB();
    applyConfigSheetRows([['税源地','平台'], ['0001.湖南','278.甲乙科技'], ['','']], kb);
    expect(kb.configData).toEqual({ taxSources: ['0001.湖南'], platforms: ['278.甲乙科技'] });
    const before = kb.configData;
    applyConfigSheetRows([['税源地','平台'], ['','']], kb);
    expect(kb.configData).toBe(before); // 未覆盖
    applyConfigSheetRows([['仅表头']], kb); // <2 行 no-op
    expect(kb.configData).toBe(before);
  });

  it('写入任务清单；空清单不覆盖', () => {
    const kb = makeKB();
    applyTaskListSheetRows([['任务清单'], ['1.保洁(0001)'], [''], ['2.搬运(0002)']], kb);
    expect(kb.taskListData).toEqual(['1.保洁(0001)', '2.搬运(0002)']);
    const before = kb.taskListData;
    applyTaskListSheetRows([['任务清单'], ['']], kb);
    expect(kb.taskListData).toBe(before);
  });
});

describe('getConfigLists', () => {
  it('未上传配置时回落 DEFAULT_CONFIG', () => {
    const { platforms, taxSources, hasUploadedPlatforms } = getConfigLists(makeKB());
    expect(platforms).toEqual(DEFAULT_CONFIG.platforms);
    expect(taxSources).toEqual(DEFAULT_CONFIG.taxSources);
    expect(hasUploadedPlatforms).toBeFalsy();
  });

  it('已上传配置时优先使用知识库数据', () => {
    const kb = makeKB();
    kb.configData = { taxSources: ['0009.测试'], platforms: ['P1', 'P2'] };
    const { platforms, taxSources, hasUploadedPlatforms } = getConfigLists(kb);
    expect(platforms).toEqual(['P1', 'P2']);
    expect(taxSources).toEqual(['0009.测试']);
    expect(hasUploadedPlatforms).toBeTruthy();
  });
});

describe('fixture 全量合并（灵工商社数据(1).xlsx）', () => {
  it('390 个商社全部入库；二次合并全部计更新', () => {
    const fixture = fileURLToPath(new URL('../../fixtures/灵工商社数据(1).xlsx', import.meta.url));
    const wb = XLSX.read(readFileSync(fixture), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, raw: false }) as never[];
    const kb = makeKB();
    expect(mergeKnowledgeRows(rows, kb)).toEqual({ newCount: 390, updateCount: 0 });
    expect(Object.keys(kb.shangSheMap)).toHaveLength(390);
    // 二次合并：全部命中已有商社 → 全部计更新
    expect(mergeKnowledgeRows(rows, kb)).toEqual({ newCount: 0, updateCount: 390 });
  });
});
