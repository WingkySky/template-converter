# 粘贴上传：剪贴板统一路由（文件 / 截图 / 表格数据）设计

日期：2026-10-15 · 状态：已与用户逐节确认（brainstorming 产出）

## 1. 背景与目标

上传入口现状只有点击选择与拖拽两种。图片粘贴其实已支持——2026-10-13 图片识别上线时在
`upload.ts` 的 `initUploadArea()` 里加了 document 级 paste 监听（`upload.ts:123-138`），
微信截图 Ctrl+V 可直接导入——但它只认 `image/*` 载荷，另外两类粘贴被静默忽略：

1. **资源管理器复制的文件**：在 Explorer 里复制 .xlsx/.csv/.pdf 后 Ctrl+V，浏览器
   `clipboardData.files` 里有完整 File 对象，当前代码不处理；
2. **Excel/WPS 复制的单元格 / 网页表格**：载荷是 `text/html`（含 `<table>`）+
   `text/plain`（TSV），当前代码不处理。

目标：把现有 paste 监听重构为**统一剪贴板路由**，覆盖全部三类粘贴场景，
与点击/拖拽并列成为第三种上传入口，反馈与文件路径完全一致（复用文件任务行）。

### 已确认的关键决策（2026-10-15 与用户逐项确认）

1. **场景全覆盖**：资源管理器文件、Excel/WPS 表格数据、网页表格数据三个场景都要。
2. **直接导入**：检测到表格数据立即进解析→映射流程，不弹确认条；靠「可编辑目标
   不接管」守卫 + 表格签名判别（`\t` 或 `<table>`）控制误粘风险。
3. **方案 A：统一路由**——一个 paste 监听按优先级分发文件→图片→表格，与现有
   `handleFiles()` 复用同一管线；不做显式粘贴按钮（`navigator.clipboard.read()`
   要权限弹窗、对文件/HTML 支持反而更差）。

### 非目标（本期不做）

- HTML 表格的 colspan/嵌套表支持（取 textContent，复杂单元格按原样摊平）
- 粘贴数据的重命名、多表拆分、去重（重复粘贴各自成独立伪源）
- Firefox 下 Explorer 文件粘贴的兼容（浏览器拿不到 File，提示文案注明限 Chrome/Edge）

## 2. 剪贴板路由（upload.ts）

`initUploadArea()` 内现有图片 paste 监听重构成一个路由函数，仍为 document 级、
随 `initUploadArea` 装配一次、全局生效（映射步骤进行中也能粘贴追加，与现状一致）：

```
paste 事件
  ├─ 守卫：target 可编辑（input/textarea/contenteditable）→ return，原生粘贴不受影响
  ├─ P1 文件：e.clipboardData.files 非空 → handleFiles(files)，preventDefault
  │          （Explorer 复制的文件；图片文件也走这里，与拖拽同路径）
  ├─ P2 图片：无文件但 items 含 kind=file && type=image/* → 现有截图逻辑原样保留
  │          （无名图片兜底命名 剪贴板图片_<ts>.png）→ handleFiles，preventDefault
  └─ P3 表格：text/html 含 <table> 或 text/plain 含 \t → 解析成伪源，preventDefault
             （均不满足 → 静默忽略，不 preventDefault）
```

- **优先级即互斥**：Excel 复制单元格不带 `files`，截图粘贴不带表格文本，Explorer
  文件优先级最高，三类实际不撞车。
- **P1/P2 零新管线**：都进现有 `handleFiles()` → `processFile()`，仅截图命名兜底逻辑
  从旧监听原样搬入。
- **P3 是唯一新增路径**：见 §3。
- 载荷判别抽纯函数 `detectClipboardPayload(data: DataTransfer | 桩): Payload | null`
  （返回 `{kind: 'files'|'image'|'table', ...}`），便于 node 单测。

## 3. 粘贴数据解析（P3）

- **HTML 表格优先**：`getData('text/html')` 经 `DOMParser` 解析，取第一个 `<table>`，
  逐 `tr` → 逐 `td`/`th` 取 `textContent` 去首尾空白，得 `Rows`。Excel/WPS 复制与
  网页复制都带 text/html，一条路覆盖两场景。
- **TSV 兜底**：无 text/html 或其中无 `<table>` 时取 `text/plain`；`parseCSV()` 加
  可选参数 `delimiter = ','`，传 `'\t'` 复用现成引号/转义处理（引号内含换行/制表符
  不破格）。
- **伪源构造**：`buildSourceItem({ type: 'csv', fileName: 剪贴板表格_${Date.now()}, rows })`
  推入 `state.sources`。`mapping.ts:47` 仅对 `excel-sheet`/`pdf` 类型显示 sheetName，
  csv 类型显示纯文件名——数据表卡片即「剪贴板表格_1728956512000」，走与 CSV 相同的自动映射。
  不进 `state.templateFiles`（无模板文件，不影响基于模板导出）。

## 4. 任务行反馈（复用 2026-10-14 上传反馈统一设计）

- `UploadTaskKind` 增加 `'paste'`；检测到表格载荷即建行（文件名 `剪贴板表格_${Date.now()}`），
  同步解析通常瞬间完成 → 折叠进累加条。
- 解析结果 0 行或无有效单元格 → `failTask(task, '剪贴板内容不是有效表格')`，走现有
  失败行展示；**paste 类型同 unknown 一样不提供重试按钮**（剪贴板可能已变，重试无意义）。
- 不走 `FileReader`（文本已在手上），同步解析后 `completeTask()` → `onFileParsed()` →
  首次成功即进映射步骤，与文件路径一致。
- **提示文案**：上传区 desc 改为三种入口并列（点击/拖拽/Ctrl+V 粘贴），注明粘贴能力
  （截图、复制的文件限 Chrome/Edge、Excel 或网页表格数据）。

## 5. 边界情况

| 场景 | 行为 |
|---|---|
| 焦点在搜索框/映射输入框/识别设置输入框粘贴 | 守卫命中，完全不接管，原生粘贴 |
| 纯文本无 `\t` 无 `<table>`（一段话/文件路径） | 静默忽略，不 preventDefault |
| 复制多个文件后粘贴 | 全部走 `handleFiles`，同拖拽多文件 |
| 复制不支持的文件（如 .docx） | 现有 `unknown` 失败行，无重试按钮 |
| 粘贴时正在解析其他文件 | 正常追加，累加条计数 +1 |
| Excel 单元格是公式 | text/plain 为计算值，所见即所得 |
| Firefox 粘贴 Explorer 文件 | 拿不到 File，静默无反应；文案注明限 Chrome/Edge |
| 同一表格重复粘贴 | 各自成独立伪源（与截图兜底命名同口径 Date.now() + id 随机后缀），累加条累加 |
| 表格几千行 | 同步解析，与 CSV 文件同量级，不特殊处理 |

代码落点：`src/ui/steps/upload.ts`（路由 + P3 分支 + kind 扩展）、
`src/core/parser/parse-csv.ts`（delimiter 参数）、`index.html`（文案一行）。
不新增文件。

## 6. 测试

- **单元测试（vitest，node 环境）**：`parseCSV` TSV 分隔符用例（引号内含换行/制表符）；
  `detectClipboardPayload` 五类载荷判别（文件/图片/HTML 表格/TSV/纯文本）。
- **HTML 表格提取**：依赖 `DOMParser`，node 环境没有——用 `// @vitest-environment jsdom`
  文件级 pragma 单独测；若 jsdom 依赖未装则该部分以 IAB 冒烟覆盖。
- **回归**：`npm run compare` 必跑，确认拆分基线无回归。
- **IAB 冒烟**（127.0.0.1:8931）：DataTransfer 注入模拟三类粘贴（截图图片 / 合成 xlsx
  文件 / TSV 文本）；验证输入框焦点粘贴不被劫持。
- **手工清单**：微信截图 Ctrl+V、资源管理器复制 xlsx Ctrl+V、Excel 全选复制 Ctrl+V、
  网页表格复制、搜索框内粘贴文本。
