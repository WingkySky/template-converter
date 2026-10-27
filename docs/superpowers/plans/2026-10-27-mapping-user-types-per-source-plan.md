# 列映射标注按源记忆 实施计划

日期：2026-10-27 · 设计依据：[2026-10-27-mapping-user-types-per-source-design.md](../specs/2026-10-27-mapping-user-types-per-source-design.md)

## 实施要点

1. **`src/types.ts`**：`SourceItem` 新增可选字段
   `userTypes?: Record<string, string>`（注释：含「不识别」空串，键为列索引
   字符串，与 dataRowsOverride 同级同寿命）。
2. **`src/state.ts`**：`mappingState` 删除 `userTypes` 字段及 2026-10-15 注释
   （事实源移至源对象，不留双份）。
3. **`mapping.ts / showMappingStep`**：删除 `sameSource` 守卫，改
   `const userTypes = source.userTypes;`；`state.mappingState` 重建时不再写
   `userTypes`。渲染顺序不变：检测 → applyUserTypeOverrides → OCR 推断。
4. **`mapping.ts / onMapChange`**：第二处写入改
   `const src = state.mappingState.source; if (src) src.userTypes = { ...(src.userTypes || {}), [ci]: sel.value };`
   （stub 测试可无 source，须守卫）。
5. **`mapping.ts / confirmMapping`**：新增局部 `srcHeaderRow(src)` 与
   `colsForSource(src)`——逐条目克隆 `src.analysis?.autoMap?.cols`（值对象
   `{ ...col }`，防 applyUserTypeOverrides 原地改 ColumnInfo.type 污染
   autoMap）→ `applyUserTypeOverrides({ cols }, src.userTypes, srcHeaderRow(src))`
   → 返回 cols。非预览源 `cols` 用它替换裸 `analysis.autoMap`；合并/拆行
   两处 `labelOf` 的表头改用各源自己的 `srcHeaderRow(src)`（预览源
   `mappingState.headerRow` 与源表头同源等价，统一口径）。

## 阶段

1. types.ts + state.ts + mapping.ts（仅此三个源码文件）
2. `tests/unit/ui/mapping.test.ts` 追加 3 例：
   - **切源隔离**（核心回归）：s1 标注 → setPreview s2 → setPreview s1，
     s1 列类型保持用户值、s2 为自动值（渲染下拉 selected 断言或读 mappingState）
   - **确认各自生效**：双源不同表头，s2 非预览带 userTypes → confirmMapping
     后 sourcesData[1].typeToCol 用标注值；且 s2.analysis.autoMap 不被污染
   - **「不识别」空串**：标注 '' 后切走切回仍为不识别
3. 质量门：typecheck / vitest 全量 / compare 零变化 / build
4. 浏览器冒烟：build:single → preview:single（127.0.0.1:8931）+ IAB 双 xlsx
   不同表头：逐表调整映射 → 切回验证恢复 → 一次确认 → 核对输出行数与内容

## 红线

- 未手动改映射的源（含全部现有 compare 夹具）行为零变化
- dataRowsOverride / applyInferredNameByData / editCell / resetAll 行为不变
- 数据源卡片与映射页渲染结构不动（仅标注恢复语义变化）
- 预览源确认路径结果与现状一致（mappingState.mapping.cols 原样使用）
