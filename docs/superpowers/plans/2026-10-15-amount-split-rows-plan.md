# 多列金额拆分发放（拆行）实施计划

日期：2026-10-15 · 设计依据：[2026-10-15-amount-split-rows-design.md](../specs/2026-10-15-amount-split-rows-design.md)

## 实施要点

1. **拆行纯函数** `src/core/mapping/row-expand.ts`：`expandAmountSplitRows(dataRows, opts)`
   → `{ rows, noteCol, mismatches, expandedRowCount }`；金额列 ≤1 返回原引用（compare 零变化）；
   金额解析用宽松数值化（剥离千分位/币符/空白 → Number，NaN/0 视同空）。
2. **新类型** `amountTotal`：仅加 COL_TYPE_LABELS（下拉可标），detectColumnMapping 自动识别
   永不标它；confirmMapping 收集后**不写入 typeToCol 导出面**（核对完即弃）。
3. **confirmMapping**：typeToCol 构建改为收集全部税前金额列（升序，amount=最左）；
   ≥2 列时拆行并写回 typeToCol.note；合计核对不平 → confirm 弹窗（返回修改/仍要继续）。
4. **showMappingStep**：统计条 dry-run 预警（预估行数 + 核对明细）；`onMapChange` 后
   重渲染映射页（保留滚动位置）让预警实时跟随用户标注。
5. **导出面零改动**：export.ts/备注面板/KB 匹配消费拆行后规范单金额行。

## 阶段

1. row-expand.ts + 单测（拆行/归一/清空/跳空/0元/全空保留/备注追加/虚拟列/合计核对/单列原引用）
2. COL_TYPE_LABELS + confirmMapping 多列收集与拆行接线 + 核对弹窗
3. showMappingStep dry-run 统计条 + onMapChange 实时重渲染
4. 质量门：typecheck / vitest 全量 / compare 零变化 / build:single
5. 浏览器验收：合成 CSV（两笔拆分 + 合计列，含故意不平行）走完整流程核对行数与备注

## 红线

- compare 208 产物零变化（单金额列字节级不变）
- 合计列永不进导出金额（重复发放的根除点）
- 核对不平时数据不静默下发（弹窗明示）
