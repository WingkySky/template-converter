// 税源地/平台/签约主体推断单测
import { describe, it, expect } from 'vitest';
import {
  uniqueTaxSources, kbInferTaxSourceByPlatformName,
  kbTaxSourceForPlatform, kbSignEntityToPlatform,
} from '../../../src/core/kb/tax-source';
import { DEFAULT_CONFIG, type KB } from '../../../src/core/kb/model';

function makeKB(): KB {
  return { shangSheMap: {}, configData: { taxSources: [], platforms: [] }, taskListData: [], lastUpdated: null, schemaVersion: 1 };
}

describe('uniqueTaxSources', () => {
  it('知识库税源在前、默认税源补充在后、去重且过滤空值', () => {
    expect(uniqueTaxSources(['0001.湖南', '', '0009.测试'])).toEqual([
      '0001.湖南', '0009.测试', ...DEFAULT_CONFIG.taxSources.filter(t => t !== '0001.湖南'),
    ]);
    expect(uniqueTaxSources(null)).toEqual(DEFAULT_CONFIG.taxSources);
    expect(uniqueTaxSources([])).toEqual(DEFAULT_CONFIG.taxSources);
  });
});

describe('kbInferTaxSourceByPlatformName', () => {
  it('知识库 platformTaxSourceMapping 优先于默认映射', () => {
    const kb = makeKB();
    kb.configData.platformTaxSourceMapping = { '甲乙': '0009.自定义' };
    expect(kbInferTaxSourceByPlatformName(kb, '278.甲乙科技')).toBe('0009.自定义');
  });

  it('无知识库映射时回落 DEFAULT_CONFIG', () => {
    expect(kbInferTaxSourceByPlatformName(makeKB(), '278.甲乙科技')).toBe('0001.湖南');
    expect(kbInferTaxSourceByPlatformName(makeKB(), '409.天津税地（身边云）5.6%')).toBe('0007.天津');
    expect(kbInferTaxSourceByPlatformName(makeKB(), '486.河南茂丰源（5.4%）')).toBe('0003.河南');
  });

  it('未知平台与空值', () => {
    expect(kbInferTaxSourceByPlatformName(makeKB(), '未知平台XYZ')).toBe('');
    expect(kbInferTaxSourceByPlatformName(makeKB(), '')).toBe('');
  });
});

describe('kbTaxSourceForPlatform', () => {
  it('已上传配置时按平台索引取税源地', () => {
    const kb = makeKB();
    kb.configData = { taxSources: ['0009.测试', '0008.测试二'], platforms: ['P1', 'P2'] };
    expect(kbTaxSourceForPlatform(kb, 'P1')).toBe('0009.测试');
    expect(kbTaxSourceForPlatform(kb, 'P2')).toBe('0008.测试二');
  });

  it('未上传配置时按平台名推断', () => {
    expect(kbTaxSourceForPlatform(makeKB(), '278.甲乙科技')).toBe('0001.湖南');
    expect(kbTaxSourceForPlatform(makeKB(), '')).toBe('');
  });

  it('索引越界时回落名称推断', () => {
    const kb = makeKB();
    kb.configData = { taxSources: [], platforms: ['278.甲乙科技'] };
    // hasUploadedPlatforms=true 但 taxSources[0] 为空 → 名称推断
    expect(kbTaxSourceForPlatform(kb, '278.甲乙科技')).toBe('0001.湖南');
  });
});

describe('kbSignEntityToPlatform', () => {
  it('知识库映射优先', () => {
    const kb = makeKB();
    kb.configData.signEntityMapping = { '自定义主体': ['星薪'] };
    expect(kbSignEntityToPlatform(kb, '自定义主体服务有限公司')).toBe('481.星薪平台（6.1%）');
  });

  it('默认映射：签约主体包含关键词 → 平台列表中找包含关键词的平台', () => {
    expect(kbSignEntityToPlatform(makeKB(), '佛山云杉人力资源服务有限公司')).toBe('278.甲乙科技');
  });

  it('platforms 参数覆盖默认平台列表', () => {
    expect(kbSignEntityToPlatform(makeKB(), '佛山云杉人力资源服务有限公司', ['my-甲乙-item'])).toBe('my-甲乙-item');
  });

  it('键长降序匹配更具体主体', () => {
    const kb = makeKB();
    kb.configData.signEntityMapping = {
      '佛山云杉': ['星薪'],
      '佛山云杉总店': ['潮涌'],
    };
    expect(kbSignEntityToPlatform(kb, '佛山云杉总店有限公司')).toBe('468.潮涌（8.2%）');
  });

  it('最终兜底：去除修饰词后模糊匹配', () => {
    expect(kbSignEntityToPlatform(makeKB(), '合用工有限公司')).toBe('375.湖南合用工');
  });

  it('完全无匹配返回空串；空主体返回空串', () => {
    expect(kbSignEntityToPlatform(makeKB(), '广州南沙云杉人力资源服务有限公司')).toBe('');
    expect(kbSignEntityToPlatform(makeKB(), '')).toBe('');
    expect(kbSignEntityToPlatform(makeKB(), undefined)).toBe('');
  });
});
