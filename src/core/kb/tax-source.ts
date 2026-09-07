// 税源地/平台/签约主体推断 —— 自 src/legacy.js 逐字搬移（阶段 1 分区 B）。
// 原 legacy.js 锚点：uniqueTaxSources L122、inferTaxSourceByPlatformName L126、
// taxSourceForPlatform L145、signEntityToPlatform L156。
// 去 loadKB 化说明（唯一结构性改动）：
//  - inferTaxSourceByPlatformName / signEntityToPlatform 原函数体内的 `const kb = loadKB()`
//    改为 kb 提升为第一个参数，导出名加 kb 前缀；legacy.js 保留原签名包装函数。
//  - taxSourceForPlatform 原第二参 kb 为可选兜底（`kb || loadKB()`），改为必传首参
//    （同时统一 kb 在前），legacy 包装函数里做 `kb || loadKB()` 兜底，调用点零改动。
import type { KB } from './model';
import { DEFAULT_CONFIG, getConfigLists } from './model';

export function uniqueTaxSources(taxSources?: string[] | null): string[] {
  return Array.from(new Set([...(taxSources || []), ...DEFAULT_CONFIG.taxSources].filter(Boolean)));
}

export function kbInferTaxSourceByPlatformName(kb: KB, platform: string): string {
  const name = String(platform || '');
  if (!name) return '';
  // 优先使用知识库配置
  if (kb.configData && kb.configData.platformTaxSourceMapping) {
    for (const [keyword, taxSource] of Object.entries(kb.configData.platformTaxSourceMapping)) {
      if (name.includes(keyword)) return taxSource;
    }
  }
  // 兜底：使用 DEFAULT_CONFIG 中的映射
  if (DEFAULT_CONFIG.platformTaxSourceMapping) {
    for (const [keyword, taxSource] of Object.entries(DEFAULT_CONFIG.platformTaxSourceMapping)) {
      if (name.includes(keyword)) return taxSource;
    }
  }
  return '';
}

export function kbTaxSourceForPlatform(kb: KB, platform: string): string {
  if (!platform) return '';
  const { platforms, taxSources, hasUploadedPlatforms } = getConfigLists(kb);
  const platIdx = platforms.indexOf(platform);
  if (hasUploadedPlatforms && platIdx >= 0 && taxSources[platIdx]) {
    return taxSources[platIdx];
  }
  return kbInferTaxSourceByPlatformName(kb, platform);
}

// 签约主体 → 平台映射
export function kbSignEntityToPlatform(kb: KB, signEntity: string | null | undefined, platforms?: string[]): string {
  if (!signEntity) return '';
  const allPlatforms = platforms || DEFAULT_CONFIG.platforms;
  // 优先使用知识库配置
  if (kb.configData && kb.configData.signEntityMapping) {
    const mapping = kb.configData.signEntityMapping;
    // 按键长度降序排列，优先匹配更具体的签约主体（如"广州南沙云杉"优先于"广州云杉"）
    const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (signEntity.includes(key)) {
        const keywords = mapping[key];
        for (const keyword of keywords) {
          const found = allPlatforms.find(p => p.includes(keyword));
          if (found) return found;
        }
      }
    }
  }
  // 兜底：使用 DEFAULT_CONFIG 中的映射
  if (DEFAULT_CONFIG.signEntityMapping) {
    const mapping = DEFAULT_CONFIG.signEntityMapping;
    const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (signEntity.includes(key)) {
        const keywords = mapping[key];
        for (const keyword of keywords) {
          const found = allPlatforms.find(p => p.includes(keyword));
          if (found) return found;
        }
      }
    }
  }
  // 最终兜底：模糊匹配
  const keywords = signEntity.replace(/有限公司|人力资源|服务|广州|佛山/g, '').slice(0, 4);
  if (keywords) {
    const match = allPlatforms.find(p => p.includes(keywords));
    if (match) return match;
  }
  return '';
}
