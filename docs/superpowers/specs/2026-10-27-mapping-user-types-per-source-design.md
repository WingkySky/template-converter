# 列映射标注按源记忆 设计

日期：2026-10-27 · 状态：已与用户确认方案一（brainstorming 产出）

## 1. 背景与目标

多表格（多源）识别时，列映射步骤里用户为每个数据源手动调整的列类型标注
（含「不识别」空串）存在两个丢失场景，均为当前实现的真实行为（用户实操反馈）：

1. **切换预览即丢**：手动标注存在全局单槽 `state.mappingState.userTypes` 里，
   重渲染时只有 `sameSource`（`mapping.ts:83-84`）才回填；点「预览」切到另一源
   会整体重建 `state.mappingState`（`mapping.ts:153-162`），旧源的标注随之丢弃。
   表1 标注 → 切表2 → 切回表1，回到自动检测默认值。
2. **确认时非预览源用不上标注**：`confirmMapping` 只对确认那一刻正在预览的源
   使用用户修改，其余勾选源一律用上传时冻结的 `analysis.autoMap`
   （`mapping.ts:305-307`）。即使逐表调好再点「确认映射」，非预览表的调整也
   不进输出。

`confirmMapping` 的按源收集架构（`sourcesData` + 每源 `typeToCol`）本身是为
多表不同列布局设计的，缺的只是「用户标注按源落地」。

单元格人工修正已有按源先例：`editCell` 写 `source.dataRowsOverride`，切走不丢。
本设计把列类型标注对齐到同一模式。

### 已确认的关键决策（2026-10-27 与用户确认）

1. **语义：按源记忆 + 确认各自生效**。切换预览时自动记住每源标注，切回自动
   恢复；确认映射时每个勾选源用各自最后一次的用户标注，没改过的用自动检测。
   由此「逐表调整 → 一次确认」的工作流才成立。否决的备选：
   - 只修切回丢失（确认语义不变）——调好表1切到表2直接确认，表1修改依旧丢；
   - 显式保存 + 状态徽章——交互步烦增多，且徽章是「看似有状态」的元素。
2. **技术方案：标注挂到 `SourceItem`**（新增 `userTypes` 可选字段），与
   `dataRowsOverride` 同构。否决的备选：
   - 全局旁路表 `mappingUserTypesBySource[sourceId]`——事实分裂成两个容器，
     resetAll/重选源要双清，长期同步隐患；
   - 切走时快照整份 `cols`——快照把用户没碰过的自动列也冻进去，「手动清空 vs
     自动未识别」再度混淆（正是 2026-10-15 那次回归的根源），且数据被
     editCell 修改后快照过期。

### 非目标（本期不做）

- 「已自定义映射」状态徽章或任何卡片 UI 变化（数据源卡片渲染不动）
- 跨会话持久化（与 `dataRowsOverride` 同级：会话内记忆即可）
- 标注的清除/恢复自动入口（「不识别」即显式选择，已覆盖需求）
- 模版步骤与上传步骤的任何改动

## 2. 状态模型

- `src/types.ts` `SourceItem` 新增可选字段：

  ```ts
  /** 用户对该源的手动列类型标注（含「不识别」空串），键为列索引字符串；
   *  与 dataRowsOverride 同级同寿命（会话内记忆，切源不丢） */
  userTypes?: Record<string, string>;
  ```

- `state.mappingState.userTypes` 删除（`state.ts:48-50` 注释一并更新）——
  标注的唯一事实源在源对象上；`mappingState.source` 本就引用 `state.sources`
  里的对象，留双份必然漂移。
- `SourceItem` 为纯内存会话状态（`io/kb-storage.ts`、`io/kb-transfer.ts` 均不
  涉及），新字段无持久化泄漏；各源创建点（`buildCsvSource`、
  `analyzeWorkbookSheets`、PDF/图片路径）为普通对象字面量，可选字段向后兼容，
  无需改动。

## 3. 渲染与标注写入（`src/ui/steps/mapping.ts`）

1. `showMappingStep`：删除 `sameSource` 守卫（83-84 行），改为直接
   `const userTypes = source.userTypes;`；`state.mappingState` 重建时不再写
   `userTypes` 字段。渲染顺序保持：自动检测 → `applyUserTypeOverrides`
   （现成纯函数，签名不变）→ OCR 源 `applyInferredNameByData`。
2. `onMapChange`：第二处写入由 `state.mappingState.userTypes` 改为
   `state.mappingState.source.userTypes`（同一对象引用，写即持久到源）：
   `const src = state.mappingState.source; if (src) src.userTypes = { ...(src.userTypes || {}), [ci]: sel.value };`
3. `applyUserTypeOverrides` 函数本体不动（纯函数，输入任意 userTypes）。

## 4. 确认逻辑（`confirmMapping`）

非预览源从「裸用 `analysis.autoMap`」改为「合并该源自己的标注」：

```ts
function colsForSource(src: SourceItem): ColumnTypeMap {
  // 逐条目克隆：applyUserTypeOverrides 会原地改 ColumnInfo.type（mapping.ts:281），
  // 浅拷贝外层记录不足以保住 analysis.autoMap 不被污染
  const cols: ColumnTypeMap = {};
  Object.entries(src.analysis?.autoMap?.cols || {}).forEach(([ci, col]) => {
    cols[ci] = { ...col };
  });
  applyUserTypeOverrides({ cols }, src.userTypes, srcHeaderRow(src)); // 返回 void，原地合并
  return cols;
}
const cols = src.id === state.previewSourceId
  ? state.mappingState!.mapping!.cols                       // 现状不变（已含该源标注）
  : colsForSource(src);
```

- `colsForSource` 合并后 `analysis.autoMap` 保持纯自动结果不被污染。
- 非预览源表头从 `src.rows[src.analysis?.headerRowIndex ?? 0]` 取，供
  `applyUserTypeOverrides` 为「标注了自动检测没有的列」补 header。
- **顺带修既有小瑕疵**：合并/拆行的 `labelOf` 目前统一用预览源的
  `state.mappingState.headerRow`（`mapping.ts:338,359`），多源列结构不同时
  备注标签张冠李戴——改为各源自己的表头。只影响 dry-run 预警与备注文案，
  不影响输出数据行。

## 5. 边界情况

- **resetAll**：sources 整体清空，标注随源消亡，零额外代码。
- **取消勾选再勾选**：标注保留（标注是显式行为，不因勾选状态丢失）。
- **OCR 源**：用户手动标注 name 后，`applyInferredNameByData` 因
  `alreadyNamed` 守卫自动让位，标注优先级最高。
- **单元格修正**：`userTypes` 与 `dataRowsOverride` 独立共存；editCell 不改
  列数，按列索引存储无漂移风险。
- **预览源确认**：`mappingState.mapping.cols` 由「检测 + 该源标注」构成，
  与非预览源合并路径结果一致。

## 6. 测试

`tests/unit`（node 环境）追加 3 例：

1. **切源隔离**（核心回归）：源 A 标注 → `setPreview` 切 B → 切回 A，
   A 的列类型保持用户值；B 为自动检测值。
2. **确认各自生效**：非预览源带 `userTypes` 时其 `typeToCol` 用标注值；
   无标注源走 `analysis.autoMap`；`analysis.autoMap` 本身不被污染。
3. **「不识别」空串**：标注为 `''` 的列切走切回后仍为不识别。

回归门槛：`npm run typecheck`、`npm test`（472 全绿）、`npm run compare`
（改行为后必跑；现有 32 用例夹具均未手动改映射，产物应逐格一致，
有 diff 逐条分析）、`npm run build`。

IAB 冒烟：双 xlsx 不同表头，逐表调整映射 → 切回验证 → 一次确认 → 核对输出
（老规矩：`preview:single` 前先 `build:single`，走 `127.0.0.1:8931`）。
