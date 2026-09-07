// 过渡桥：阶段 1B/1C 抽取 core 时留下的原签名包装（读 state/loadKB 的部分）。
// 阶段 3 期间 ui 各模块统一从这里 import；阶段 4 收敛注册表时逐步溶解，
// 调用方改为直连 core（显式传 kb）。
import {
  kbInferTaxSourceByPlatformName, kbTaxSourceForPlatform, kbSignEntityToPlatform,
} from '../core/kb/tax-source';
import {
  kbLookupShangShe, kbLookupShangSheByTaxId, kbLookupShangSheByNameAll, kbLookupShangSheByName,
  kbGetShangSheIdFromLookup, kbDetectSourceClientInfo, kbDetectBestShangSheMatch,
} from '../core/kb/shangshe';
import type { MappingSourceData } from '../core/kb/shangshe';
import { kbGetTasksForShangShe } from '../core/kb/task';
import { kbComputeBatchShangShe } from '../core/kb/batch';
import { kbFillShangSheInfoForRow, kbGetRemarkPresetValue } from '../core/kb/shangshe-fill';
import { loadKB } from '../io/kb-storage';
import { state } from '../state';
import { buildShenbianyunWorkbookCore, buildYouyiWorkbook as buildYouyiWorkbookCore } from '../core/export/builders';
import { getSplitGroupsFromMeta as getSplitGroupsFromMetaCore, splitGroupLabel as splitGroupLabelCore } from '../core/export/split-core';
import { getSplitFileBaseName as getSplitFileBaseNameCore, allocSplitFileName as allocSplitFileNameCore } from '../core/export/split-core';
import { generateConfigSheet, generateTaskListSheet } from '../core/kb/task';
import { TEMPLATES } from '../templates';

// ---- tax-source ----
export function inferTaxSourceByPlatformName(platform: string): string {
  return kbInferTaxSourceByPlatformName(loadKB(), platform);
}
export function taxSourceForPlatform(platform: string, kb?: import('../core/kb/model').KB): string {
  return kbTaxSourceForPlatform(kb || loadKB(), platform);
}
export function signEntityToPlatform(signEntity: string | null | undefined, platforms?: string[]): string {
  return kbSignEntityToPlatform(loadKB(), signEntity, platforms);
}

// ---- 商社查找 ----
export function lookupShangShe(shangSheId: string) {
  return kbLookupShangShe(loadKB(), shangSheId);
}
export function lookupShangSheByTaxId(taxId: string) {
  return kbLookupShangSheByTaxId(loadKB(), taxId);
}
export function lookupShangSheByNameAll(name: string) {
  return kbLookupShangSheByNameAll(loadKB(), name);
}
export function lookupShangSheByName(name: string) {
  return kbLookupShangSheByName(loadKB(), name);
}
export function getShangSheIdFromLookup(lookup: Parameters<typeof kbGetShangSheIdFromLookup>[1]): string {
  return kbGetShangSheIdFromLookup(loadKB(), lookup);
}
export function detectSourceClientInfo(sourcesData: MappingSourceData[], sourcesOverride?: Parameters<typeof kbDetectSourceClientInfo>[1]) {
  return kbDetectSourceClientInfo(sourcesData, sourcesOverride || state.sources.filter(s => s.selected));
}
export function detectBestShangSheMatch(sourcesData: MappingSourceData[], sourcesOverride?: Parameters<typeof kbDetectBestShangSheMatch>[2]) {
  return kbDetectBestShangSheMatch(loadKB(), sourcesData, sourcesOverride || state.sources.filter(s => s.selected));
}
export function getTasksForShangShe(shangSheId: string) {
  return kbGetTasksForShangShe(loadKB(), shangSheId);
}

// ---- 批次 ----
export function applyBatchShangShe(lookup: Parameters<typeof kbComputeBatchShangShe>[1], id: string): void {
  const r = kbComputeBatchShangShe(loadKB(), lookup, id);
  state.batchShangSheId = r.batchShangSheId;
  state.batchShangSheName = r.batchShangSheName;
  state.batchNo = r.batchNo;
}

// ---- 行级填充 ----
export function fillShangSheInfoForRow(out: unknown, lookup: Parameters<typeof kbFillShangSheInfoForRow>[2], colIndex: Parameters<typeof kbFillShangSheInfoForRow>[3], setter: Parameters<typeof kbFillShangSheInfoForRow>[4], rowContext: Parameters<typeof kbFillShangSheInfoForRow>[5]): void {
  return kbFillShangSheInfoForRow(loadKB(), out as never, lookup, colIndex, setter, rowContext);
}
export function getRemarkPresetValue(rowIdx: number, preset: string): string {
  return kbGetRemarkPresetValue(loadKB(), preset, {
    row: state.outputRows?.[rowIdx] || [],
    metaFileName: (state.outputRowMeta?.[rowIdx] || {}).fileName,
    selectedFileNames: state.sources.filter(s => s.selected).map(s => s.fileName),
    outputHeaders: state.outputHeaders || [],
    customText: (document.getElementById('note-custom-text') as HTMLInputElement | null)?.value.trim() || '',
  });
}

// ---- 输出行编辑 ----
export function updateOutputRow(rowIdx: number, colIdx: number, value: string): void {
  if (state.outputRows && state.outputRows[rowIdx]) {
    state.outputRows[rowIdx][colIdx] = value;
  }
}

// ---- 拆分/构建器包装（读 state） ----
export function splitTplName(templateKey: string): string {
  return templateKey === 'custom' ? '自定义' : (TEMPLATES[templateKey]?.name || '转换结果');
}
export function getSplitGroupsFromMetaBridge(meta: Parameters<typeof getSplitGroupsFromMetaCore>[0]) {
  return getSplitGroupsFromMetaCore(meta, state.exportMode);
}
export function splitGroupLabelBridge(g: Parameters<typeof splitGroupLabelCore>[0]) {
  return splitGroupLabelCore(g, state.exportMode);
}
export function getSplitFileBaseNameBridge(g: Parameters<typeof getSplitFileBaseNameCore>[0], templateKey: string) {
  return getSplitFileBaseNameCore(g, splitTplName(templateKey), state.exportMode);
}
export function allocSplitFileNameBridge(g: Parameters<typeof allocSplitFileNameCore>[0], templateKey: string, ext: string, usedNames: Set<string>) {
  return allocSplitFileNameCore(g, ext, usedNames, splitTplName(templateKey), state.exportMode);
}
export function buildShenbianyunWorkbookBridge(headers: string[], rows: import('../types').Rows, batchNo = '') {
  return buildShenbianyunWorkbookCore(headers, rows, batchNo, { showBatchInfo: state.sbyShowBatchInfo, plainAmount: state.sbyPlainAmount });
}
export function buildYouyiWorkbookBridge(headers: string[], rows: import('../types').Rows) {
  return buildYouyiWorkbookCore(headers, rows, { kb: loadKB(), generateConfigSheet, generateTaskListSheet } as never);
}
