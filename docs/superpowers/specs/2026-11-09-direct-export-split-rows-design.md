# 整理表导出即拆行设计

日期：2026-11-09 · 状态：已与用户确认方案（brainstorming 产出）

## 1. 背景与目标

2026-10-14 直接导出设计（`2026-10-14-mapping-direct-export-design.md`）决策 6：整理表
「多列金额全部保留、不拆行」（表头「税前金额、税前金额2」，合计列丢弃）。用户 2026-11-09
提出：希望在映射页列名匹配后点「导出整理表」那一刻，就直接得到**已完成多列拆行**的表格，
无需走「确认映射 → 模板」管线。

目标：`buildMappedDirectTable` 在 ≥2 列税前金额时自动拆行——整理表 = 匹配好 + 拆好行的
标准表。与同日「多列金额自动识别」设计（`2026-11-09-multi-amount-column-detect-design.md`）
衔接后，天九分润类表导入 → 映射 → 导出整理表全程零手动。

### 已确认的关键决策（2026-11-09）

1. **仅整理表变更**：原表导出保持所见即所得（不拆行）。
2. **备注来源标签跟随现有开关**（映射页「备注标注来源」，默认关）：开启时拆分行备注写
   「第一笔/第二笔」；源表无备注列且开启时行尾追加虚拟「备注」列。
3. **合计列先核对后丢弃**：核对不平弹窗（与 confirmMapping 同文案口径），可取消——
   不静默带病落盘。

## 2. 行为设计

`buildMappedDirectTable` 检测到 ≥2 列 `amount` 时：

1. **先拆行**：复用 `expandAmountSplitRows`（core/mapping/row-expand.ts，原值照抄、
   空/0 金额跳过、全空行保留 1 行），`labelOf` 用原始列头（「第一笔」…）；
2. **列集收敛**：金额归一到最左拆分列，其余拆分列清空且**不再输出**——整理表只剩一列
   「税前金额」，不再出现「税前金额2」空列；
3. **合计核对**：`totalCol`（`amountTotal`）逐行核对，mismatches 非空由 UI 层 confirm
   弹窗列出（`第 X 行：拆分合计 A ≠ 合计 B`，X 为原始行号），取消即不落盘；核对通过或
   用户确认后合计列丢弃（标签本即「仅核对，不导出」）；
4. **备注列**：既有 `note` 列原值保留；`labelNote` 开启时拆分行备注追加来源标签
   （追加不覆盖）；无备注列且开启时按 expandAmountSplitRows 返回的虚拟列号行尾追加
   「备注」列；
5. **清洗顺序**：先拆行（原值）后清洗（金额 `sanitizeAmount`、姓名先 `cleanNameCell`
   再 `cleanValue`、其余 `cleanValue`、出参 trim）——与 confirmMapping → generate-output
   净效果同口径。

单金额列（<2 列 amount）行为与现状完全一致（字节级不变）。

## 3. 技术设计

### 3.1 `src/core/export/direct-export.ts`

- `buildMappedDirectTable` opts 扩展：`{ nameColIndex: number | null, labelNote?: boolean }`；
- 内部流程：收集 `amountCols` / `totalCol` / `noteCol` → `amountCols.length ≥ 2` 时
  `expandAmountSplitRows` → 输出列集 = 原 indices − (amountCols − 最左 amount 列)
  （+ 虚拟备注列当 `labelNote` 开启且无 note 列）→ 对拆行后行集逐格清洗输出；
- 返回类型扩展：`{ headers, rows, mismatches }`（mismatches 供 UI 弹窗；纯函数不弹窗）；
- core 不读 state/localStorage 约定不变。

### 3.2 UI 层（`src/ui/steps/mapping.ts`）

- `exportDirectMapped` handler：`labelNote: splitNoteLabelsOn()` 传入；
  `mismatches.length > 0` 时 `confirm(...)` 与 confirmMapping 拆分核对同文案口径，
  取消即中止导出。

## 4. 测试

扩展 `tests/unit/export/direct-export.test.ts`：

- 两列拆行（天九分润真实数据：姓名|税后|第一笔|第二笔|…）→ 单「税前金额」列、行数展开正确；
- 空拆分列跳过、全空行保留 1 行；
- 合计核对 mismatches 内容与行号；
- 虚拟备注列（labelNote 开 + 无 note 列）、开关关闭不写标签、既有备注追加不覆盖；
- 拆行后空拆分列不出现在输出表头；
- 清洗口径（姓名/金额/trim）；
- 单金额列输出与旧实现逐格一致（回归红线）。

交付前 `npm run compare` 全量基线对比零变化（纯新增路径）。

## 5. 非目标

- 原表导出（buildRawDirectTable）不变；
- 不做同人多条合并（确认映射管线 opt-in 功能，整理表语义是"按映射整理"）；
- 不做 CSV；
- 不改确认映射 → 模板管线。
