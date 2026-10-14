# 映射页直接导出（识别导出）设计

日期：2026-10-14 · 状态：已与用户逐节确认（brainstorming 产出）

## 1. 背景与目标

图片识别（及 Excel/PDF 导入）在映射页完成列映射确认与人工校对后，唯一出路是走完
「确认映射 → 选模版 → 转换 → 导出」管线，生成目标平台发放表。没有一条**不换模版、
直接把识别到的表格落盘**的短路径——用户拿到识别/校对结果想原样留存或交给下游
其他系统时，只能绕道模版流程。

目标：在映射页底部按钮行增加直接导出能力，提供两种口径：

1. **导出原表**——所见即所得，与数据预览表逐格一致；
2. **导出整理表**——按确认的列映射整理：标准字段名表头 + 值清洗 + 丢弃未识别列。

### 已确认的关键决策（2026-10-14 与用户逐项确认）

1. **导出内容两种都要**（原表 + 整理表），不接受单选。
2. **按钮位置在底部按钮行**（与确认映射/重置同排），不放预览表标题行。
3. **对所有数据源开放**（图片/Excel/PDF 同一套预览与映射流程，无理由只给图片源）。
4. **仅导出 Excel（.xlsx）**，CSV 本期不做。
5. **仅导出当前预览源**（`state.mappingState` 所持源）：所见即所得、行为可预期；
   非预览源只有自动检测结果、未经校对，一并导出易混入误识别数据。
6. **多列金额不拆行**：拆行是确认映射后模版管线的职责（见
   `2026-10-15-amount-split-rows-design.md`），直接导出保持识别原样，多列全保留。
7. **方案 A：两个次级按钮 + core 纯函数模块**；单按钮+弹出菜单（无现成菜单组件、
   为两个菜单项新写交互属过度设计）与只做原表导出（整理要走 3 步模版流程）均被否。

### 非目标（本期不做）

- CSV / 其他格式导出
- 多源打包导出（勾选多源各导一个文件/sheet）
- 导出前弹独立确认或预览弹窗（预览表就是预览）
- 拆行、KB 填充、批次号等模版管线逻辑

## 2. 交互设计

映射页底部按钮行变为：

```
[✓ 确认映射 (flex:1)] [⬇ 导出原表] [⬇ 导出整理表] [↻ 重置]
```

- 两个导出按钮 `btn-secondary`（次级样式，不与主行动作「确认映射」竞争视觉）；
- `.btn-row` 自带 `flex-wrap: wrap`，窄窗口自动换行，无布局风险；
- 事件走现有 `data-action` 委托（`initMappingDelegates` 注册 `exportDirectRaw` /
  `exportDirectMapped`），与 confirmMapping/editCell 同模式。

## 3. 两种导出的口径

数据直接取 `state.mappingState`（`headerRow` / `dataRows` / `mapping.cols` / `source`）。
`dataRows` 已含人工校对覆盖（`source.dataRowsOverride`，见 showMappingStep 同口径），
故原表导出的"所见即所得"天然成立。

### 3.1 原表（buildRawDirectTable）

- 列 = 映射页识别到的全部列（`mapping.cols` 键，含合计列），列序按列号升序——与
  预览表 `colIndices` 一致；
- 表头 = `cols[ci].header`（识别到的原始表头，如「9月」「代扣款后」）；
- **姓名列清洗与预览同口径**：未经人工编辑的源（无 `dataRowsOverride`）对姓名列
  应用 `cleanNameCell`，预览悬停提示里展示的清洗值即导出值；编辑过的源视为已人工
  校对，保持原样；
- **导出全部数据行**：预览的 50 行上限（图片源）只是显示层截断，导出不受其限，
  一律落盘 `dataRows` 全量。

### 3.2 整理表（buildMappedDirectTable）

- 每个已识别类型一列，列序按列号升序；表头用现成 `COL_TYPE_LABELS` 标准名
  （姓名/身份证/手机号/开户银行/银行卡号/税前金额/备注…）；
- 值清洗与模版管线同款（generate-output.ts L66-67 口径）：金额 `sanitizeAmount`，
  其余 `cleanValue`，输出值 trim；
- 「不识别」（空串 type）列丢弃；`amountTotal` 合计列丢弃（其标签本即
  「仅核对，不导出」）；
- **多列金额全部保留、不拆行**：第 2 列起表头命名「税前金额2」「税前金额3」……
- 空值导出为空串，与预览的「—」占位区分（占位仅是显示层）；
- **不做行过滤**：不套用模版管线的「无身份列丢弃 / 全空行跳过」规则（generate-output
  的 `hasIdentity`/`out.some(v=>v)` 过滤服务于发放语义），整理表保留全部数据行——
  规则最简单，也与原表口径一致。

## 4. 技术设计

### 4.1 `src/core/export/direct-export.ts`（新增，纯函数）

```ts
export interface DirectTable { headers: string[]; rows: Rows; }

export function buildRawDirectTable(
  dataRows: Rows,
  cols: Record<string, { header: string; type: string }>,
  opts: { nameColIndex: number | null },   // 预览同口径的姓名清洗开关
): DirectTable

export function buildMappedDirectTable(
  dataRows: Rows,
  cols: Record<string, { header: string; type: string }>,
): DirectTable
```

- 不读 state/localStorage，输入输出皆参数——可直接 vitest 单测；
- 列序均按 `Object.keys(cols)` 数值升序；
- `buildMappedDirectTable` 复用 `COL_TYPE_LABELS`（core/mapping/column-detect.ts）、
  `sanitizeAmount`/`cleanValue`（core/clean/values.ts），零新常量；
- `buildRawDirectTable` 复用 `cleanNameCell`（core/clean/names.ts）。

### 4.2 UI 层（`src/ui/steps/mapping.ts` 修改）

- `showMappingStep` 按钮行 HTML 增加两个 `btn-secondary` 按钮
  （`data-action="exportDirectRaw"` / `"exportDirectMapped"`）；
- 新增薄壳 handler：取 `state.mappingState` → 调 core 函数 →
  `buildGenericWorkbook`（core/export/builders.ts，表头+数据+列宽自适应，sheet 名「数据」）
  → `saveWorkbook`（io/save-file.ts，选目录保存 + 无权限自动下载降级，全部现成）；
- `initMappingDelegates` 注册两个 click 委托。

### 4.3 文件命名

`{源文件名去扩展名}_识别原表_{YYYYMMDD}.xlsx` / `{源文件名去扩展名}_整理表_{YYYYMMDD}.xlsx`；
源文件名缺失时兜底「识别结果」。日期复用 `getTodayStr`（core/export/naming.ts）。

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| `mappingState` 为空或无数据行 | `alert('没有可导出的数据')`，不落盘 |
| 整理表无任何已识别列（全空 type） | `alert('没有已识别的列，请先在上方确认列映射')` |
| 保存对话框取消（AbortError） | 静默返回（saveWorkbook 现有行为） |
| 原表全为不识别列 | 仍可导出（原表语义即"识别到的表"，列来自 cols；cols 为空时归入无数据行分支报错） |

## 6. 测试

- 新增 `tests/direct-export.test.ts`（vitest，core 纯函数单测）：
  - 原表：列序/表头原样、姓名清洗口径（无覆盖清洗、有覆盖不清洗）、空值；
  - 整理表：标准表头命名、不识别列与合计列丢弃、多列金额保留与「税前金额2」重命名、
    `sanitizeAmount`/`cleanValue` 清洗、trim、全部空值行保留；
- 纯新增路径，不触碰现有管线：交付前跑 `npm run compare` 确认零变化（项目惯例）；
- UI 手动冒烟：图片源/Excel 源各导一次原表与整理表，核对与预览逐格一致。
