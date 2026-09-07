# 模版转换工具项目拆分设计

- 日期：2026-09-07
- 状态：已确认（用户已批准设计方向与本文档）
- 修订：2026-09-07 v2 —— 采纳 TypeScript 全量（strict）
- 范围：将 `template-converter.html`（4503 行单文件）拆分为可挂网部署的 Vite 工程，完成解耦与模版注册表重构

## 1. 背景与现状

当前项目是一个纯前端单文件应用：

- `template-converter.html`：4503 行 / 188KB，包含全部 CSS（~250 行）、HTML 骨架（~80 行）与 JS（~4170 行）
- 功能：上传 CSV/Excel → 智能识别列 → 转换为四个目标模版（移步到岗 / 身边云 / 云杉公司 / 自定义）→ 支持合并/按文件/按数据表三种导出模式
- 依赖：SheetJS 0.20.1（sheetjs.com CDN）、ExcelJS 4.4.0（jsDelivr CDN）
- 存储：知识库（商社/任务数据）存 localStorage，靠"导出备份/导入备份"文件在用户间传递
- 文件保存：File System Access API（`showSaveFilePicker`，记住上次目录），带自动下载降级
- 耦合点：所有函数挂在 `window` 全局，HTML 内联 `onclick` 直接调用（118 处）；模版逻辑散落在十余处 `if (targetTemplate === 'xxx')` 分支中

单文件已不可维护，且 CDN 依赖导致无法在隔离网络使用。

## 2. 目标与非目标

### 目标

1. 源码拆分为 core / ui / io 三层模块，单文件不超过约 400 行
2. 四个目标模版收敛为**模版注册表**，主流程不含模版特判分支；新增平台模版 = 新增一个文件 + 注册一行
3. 纯逻辑层（core）全部可单测；重构后行为 100% 不变，以样例文件对比导出产物验证
4. `npm run build` 产出纯静态 `dist/`，可部署 GitHub Pages 或任意内网静态服务器

### 非目标（本期不做）

- 不引入前端框架、状态管理库、事件总线
- 不做后端 / 云端知识库共享（io 层留适配接口，实现留待下期）
- 不改任何 UI 外观与交互流程，不新增功能
- 不处理 `待开发问题文档.docx` 中的新功能需求

## 3. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 技术栈 | Vite + 原生 ES Modules，不引入框架 |
| file:// 直开兼容 | 放弃。挂网为主，本地开发用 Vite dev server |
| 知识库存储 | 本期保持 localStorage，io 层预留适配接口 |
| 回归保障 | Vitest 核心逻辑单测 + 重构前后样例导出产物对比 |
| 拆分方案 | 方案 A：core/ui/io 三层 + 功能化模块 + 模版注册表 |
| 语言 | TypeScript 全量（strict），搬移时直接产出 .ts；类型化策略见 5.5 |

## 4. 目标目录结构

```
template-converter/
├── index.html                    # 仅骨架（5 个步骤卡片容器）
├── vite.config.ts                # base: './'
├── tsconfig.json                 # strict: true
├── package.json                  # 新增 vite / vitest / typescript / typescript-eslint devDependencies
├── public/vendor/                # 本地化第三方库（见第 7 节）
│   ├── xlsx.full.min.js          # SheetJS 0.20.1
│   └── exceljs.min.js            # ExcelJS 4.4.0
├── tests/
│   ├── fixtures/                 # 样例 Excel/CSV（含 GBK 样例）+ 基线导出产物
│   └── unit/                     # Vitest 单测（.test.ts），镜像 core/ 结构
├── docs/superpowers/specs/       # 本设计文档
└── src/
    ├── main.ts                   # 入口：初始化各步骤模块、全局拖拽事件
    ├── state.ts                  # 全局 state 对象 + AppState 接口 + 常量
    ├── types.ts                  # 共享领域类型：Cell/Rows、KB、ShangSheLookup、TemplateDefinition 等
    ├── vite-env.d.ts             # Vite 客户端类型与 vendor 库声明
    ├── legacy.js                 # （过渡）阶段 0–4 旧代码桥接，allowJs + @ts-nocheck，阶段 5 删除
    ├── core/                     # ★ 纯逻辑：禁止 import DOM / localStorage / 文件 API
    │   ├── parser/
    │   │   ├── parse-csv.ts          # parseCSV、isGarbled（UTF-8/GBK）
    │   │   ├── excel.ts              # analyzeWorkbookSheets、analyzeSheet
    │   │   ├── table-detect.ts       # smartDetectTable、isSummaryLikeRow、isHeaderContinuation、
    │   │   │                         #   mergeHeaderRows、hasIdentityField、inferGenderFromIdCard
    │   │   └── file-orchestrator.ts  # handleFiles/processFile 的解析编排（多文件合并、构建 sources）
    │   ├── mapping/
    │   │   ├── column-detect.ts      # detectColumnMapping
    │   │   └── amount-score.ts       # getAmountColumnScore、isAmountLikeNumber
    │   ├── clean/
    │   │   └── values.ts             # sanitizeAmount、cleanValue、身份证 X 形近字符归一
    │   ├── kb/
    │   │   ├── model.ts              # migrateKB、mergeKnowledgeRows、knowledgeRowsFromKB、
    │   │   │                         #   applyConfigSheetRows、applyTaskListSheetRows
    │   │   ├── shangshe.ts           # lookupShangShe 系列、detectSourceClientInfo、
    │   │   │                         #   detectBestShangSheMatch、signEntityToPlatform
    │   │   ├── tax-source.ts         # inferTaxSourceByPlatformName、taxSourceForPlatform、uniqueTaxSources
    │   │   ├── task.ts               # parseTaskString、normalizeTaskNameToWorkType、inferWorkType、
    │   │   │                         #   findTaskContent、generateConfigSheet、generateTaskListSheet
    │   │   └── batch.ts              # chineseInitial、buildBatchNoFromShangShe、dedupeBatchNo
    │   ├── generate/
    │   │   ├── generate-output.ts    # generateOutput 的纯转换部分（行/列/meta 计算）
    │   │   └── shangshe-fill.ts      # fillShangSheInfo、fillShangSheInfoForRow、getRemarkPresetValue
    │   ├── templates/
    │   │   ├── registry.ts           # TEMPLATES 注册表 + get(key) 查询 API
    │   │   ├── yidao.ts              # 移步到岗
    │   │   ├── shenbianyun.ts        # 身边云（含批次行/纯数字金额选项定义）
    │   │   ├── youyi.ts              # 云杉（含配置表/任务清单 sheet、银行空补 0）
    │   │   └── custom.ts             # 自定义（动态列映射）
    │   └── export/
    │       ├── naming.ts             # getExportFileNameForTemplate、getTodayStr、sanitizeFileNamePart
    │       ├── split.ts              # 拆分分组、ensureSplitBatches、allocSplitFileName、
    │       │                         #   buildSplitFilesForTemplates、rowsToCSV
    │       ├── workbook.ts           # buildWorkbookForTemplate（查注册表分发）、workbookToArray
    │       └── zip.ts                # crc32、dosDateTime、u16/u32、createZipBlob
    ├── io/                       # 副作用层：存储/文件系统，全部收敛在此
    │   ├── kb-storage.ts             # localStorage 读写（loadKB/saveKB/clearKB）
    │   ├── kb-transfer.ts            # 知识库 Excel/JSON 导入导出、样例下载（调 core/kb/model）
    │   └── save-file.ts              # showSaveFilePicker + 降级下载（saveWorkbook/saveCSV/saveBlobAsFile）
    └── ui/                       # 渲染 + 事件：只调 core/io，不写业务规则
        ├── dom.ts                    # escapeHTML、el()、事件委托辅助
        ├── steps/
        │   ├── kb-panel.ts           # 知识库卡片
        │   ├── upload.ts             # 上传区（文件选择、拖拽、累计指示）
        │   ├── mapping.ts            # 第 2 步：映射确认
        │   ├── template.ts           # 第 3 步：模版选择（含自定义字段编辑）
        │   └── export.ts             # 第 4 步编排（薄壳）
        ├── export/                   # export.ts 内部拆分
        │   ├── preview-table.ts      # 预览表格渲染、分页
        │   ├── controls.ts           # 平台/任务/批次/导出模式/身边云选项控件
        │   ├── remark-panel.ts       # 备注列编辑、批量备注、行选择
        │   └── search-dropdown.ts    # 商社/平台通用搜索下拉（参数化复用）
        └── column-filter.ts          # 通用列筛选面板
```

## 5. 关键设计

### 5.1 模版注册表

每个模版文件默认导出统一形状，`registry.ts` 聚合并提供查询：

```ts
// core/templates/youyi.ts 示意
import type { TemplateDefinition, TemplateContext } from '../../types';

export default {
  key: 'youyi',
  name: '云杉公司',
  buildWorkbook: async (ctx: TemplateContext) => Workbook,
  // ctx: { headers, rows, meta, batchNo, kb, options, templateFile }
  buildFileName: (ctx: TemplateContext) => string,
  renderOptions: null,      // 身边云返回选项渲染定义，其余为 null
  supportsSplit: true,
} satisfies TemplateDefinition;
```

- `buildWorkbookForTemplate` 变为查注册表分发
- `getExportFileNameForTemplate`、模版选项面板、导出模式支持性均从注册表取
- 自定义模版是注册表成员之一，其动态列由 `custom.ts` 内部处理
- `satisfies TemplateDefinition` 保证四个模版文件形状一致：漏实现字段在编码期即报错

### 5.2 state 策略

- 保留单一 `state` 对象（`src/state.ts` 导出，可变引用），不做响应式改造；形状由 `AppState` 接口约束，UI 层所有读写即获编译期检查
- **core 模块禁止 import state**：所需数据从参数传入，结果经返回值给出（如 `generateOutput(input)` → `{ headers, rows, meta }`）。搬移时违反者顺手修正
- UI 模块可自由读写 state
- 不引入 store 库、不搞发布订阅

### 5.3 事件迁移（118 处内联 onclick）

分两类：

1. 静态 HTML 中的（知识库卡片、上传区）：各步骤模块提供 `init()`，`main.ts` 统一调用并 `addEventListener`
2. 动态生成的 HTML 字符串中的（预览表、导出控件）：改为**事件委托**——容器监听 click/change，按 `data-action` + `data-idx` 分发。消除"渲染函数必须把处理函数挂 window"的耦合，这是本次解耦的最大单点收益

### 5.4 io 适配层

`kb-storage.ts` 只暴露 `loadKB / saveKB / clearKB`，签名与存储介质无关。未来接云端存储时实现同签名适配器替换，core/ui 一行不动。

### 5.5 TypeScript 类型策略（TS 全量）

- `tsconfig.json` 开 `strict: true`；Excel 行数据等动态结构用务实类型：`type Cell = string | number | boolean | null`、`type Rows = Cell[][]`，不为单元格建精确类型
- 必须完整类型化的公共面：`AppState`（state.ts）、共享领域类型与 `TemplateDefinition`（types.ts）、各 core 模块的入参与返回值、io 层函数签名
- 模块内部局部变量不强制标注，避免陷入"给一切标类型"的泥潭
- 过渡文件 `src/legacy.js` 以 `allowJs` + 文件头 `@ts-nocheck` 纳入编译，阶段 5 随旧代码一并删除
- 质量闸门：各阶段验收均含 `tsc --noEmit` 零错误；typescript-eslint 开 `no-explicit-any`（警告级，确需 any 时行内豁免并注释原因）

## 6. 迁移计划

每阶段结束应用完整可用，独立提交，可随时中止。

| 阶段 | 内容 | 验证 |
|---|---|---|
| 0 脚手架 | Vite 初始化；tsconfig（strict）+ vite-env.d.ts；SheetJS 类型以开发依赖 tarball 引入；HTML 骨架 + CSS 迁移；整段 JS 暂存 `src/legacy.js`（allowJs + @ts-nocheck）挂全局；样例文件生成基线导出产物存 `tests/fixtures/` | 页面行为与现状一致；`tsc --noEmit` 通过 |
| 1 core 抽取 | 按 parser → clean → mapping → kb → zip → split → templates 顺序机械搬移为 .ts 并即时补单测（.test.ts）；legacy.js 逐步 import | 单测绿 + 行为不变 + `tsc --noEmit` 通过 |
| 2 io 抽取 | kb-storage / kb-transfer / save-file 迁移；校验 core 无 localStorage / 文件 API 引用 | 单测绿 + 行为不变 |
| 3 UI 拆分 | 自底向上：dom.ts → search-dropdown → column-filter → preview-table → remark-panel → controls → 五步骤模块；事件委托替换内联 onclick | 手动全流程走查 + `tsc --noEmit` 通过 |
| 4 模版注册表 | 四模版分支收敛进注册表；generateOutput 签名纯化 | 样例对比通过 |
| 5 部署收尾 | build/preview 脚本、`base: './'`、部署验证、README 重写、删除 legacy 残留 | `dist/` 部署后全流程走查 |

工作量分布：阶段 3 约占 60%，其余阶段约各占 5–15%。阶段 3 的安全性由阶段 1 的单测兜底。

## 7. 依赖处理

- SheetJS 必须本地文件而非 npm 包：npm registry 上的 `xlsx` 停留在 0.18.x，与现用 sheetjs.com CDN 的 0.20.1 存在行为差异风险。下载 0.20.1 的 `xlsx.full.min.js` 放入 `public/vendor/`
- ExcelJS 4.4.0 虽在 npm 有同版本，为统一处理同样本地化到 `public/vendor/`（其类型声明随包自带）
- SheetJS 类型来源：`npm i -D https://cdn.sheetjs.com/xlsx-0.20.1/xlsx-0.20.1.tgz` 仅作开发依赖取 d.ts，运行时仍用 `public/vendor/` 本地文件，版本严格一致
- `index.html` 以普通 `<script>` 引入两者；隔离网络环境无需外网
- 升级这两个库时需重跑样例对比验证

## 8. 测试与回归保障

### 单测（Vitest，node 环境，`.test.ts`）

覆盖 core 全部模块，重点用例直接取自 git 修复历史（高危区）：

- 身份证末位 X 形近字符归一（罗马数字 Ⅹ/ⅹ、西里尔 Х/х → 大写 X）
- 双行表头检测与合并（`isHeaderContinuation` / `mergeHeaderRows`）
- 货币格式金额识别（¥ 前缀、千分位）
- 费用行与人员记录区分（`isSummaryLikeRow`）
- 云杉模版银行名称空补 0
- 批次号生成与去重（`dedupeBatchNo`、`buildBatchNoFromShangShe`）
- 金额清洗 `sanitizeAmount`、拆分分组 `getSplitGroupsFromMeta`、ZIP 产物字节结构
- CSV GBK 乱码检测 `isGarbled`

### 样例对比

- fixtures：仓库内 5 个样例文件（身边云模板_测试样例、批量导入灵活用工费用模板、灵工商社数据、2026 年灵工发放表格、南沙云杉支付明细）+ GBK 编码 CSV 样例
- 方法：重构前（阶段 0）对每个模版 × 每种导出模式生成基线导出产物并存档；阶段 1/3/4 结束后重跑同一输入，用 SheetJS 读回逐格断言或 JSON 快照比对
- 提供 `npm run compare` 脚本自动化比对

### 手动走查清单（阶段 3、5 各一遍）

1. 上传：单文件 CSV（UTF-8 与 GBK 各一）、多文件 Excel 合并、双行表头文件
2. 映射：自动识别正确性、手动改选列类型、取消勾选数据源
3. 模版：四模版逐一预览切换、自定义模版增删字段
4. 导出：三模式（合并/按文件/按数据表）× 拆分批次号编辑、身边云选项切换、批量备注
5. 知识库：上传、更新配置、导出备份、导入备份、清空；商社/平台搜索下拉选择
6. 文件保存：Chrome 下 File System Access 记住目录行为、降级下载

## 9. 部署

- `vite.config.ts` 设 `base: './'`（相对路径产物），同一份 `dist/` 适用于 GitHub Pages 仓库子路径、内网 nginx、任意静态托管
- `npm run dev` 本地开发；`npm run build` + `npm run preview` 本地验证构建产物
- GitHub Actions 自动部署列为可选项，不阻塞本期
- 上线后知识库仍为各用户浏览器本地存储，团队间传递依赖现有备份文件机制

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| UI 事件重接线遗漏（最大风险） | 统一事件委托分发模式，每个容器仅一处绑定；走查清单兜底 |
| `showExportStep`（~400 行）与 `generateOutput`（~150 行）两个巨函数 | 阶段 1 只抽纯转换部分；阶段 3 将 showExportStep 按四个子模块重组而非整体搬移；阶段 4 收敛签名 |
| 函数间隐式 window 全局互调 | 搬移时以显式 import 替换；tsc 未知标识符检查 + typescript-eslint 辅助发现遗漏 |
| SheetJS 版本差异引入行为变化 | 坚持 0.20.1 本地文件，禁用 npm registry 版本；升级必须重跑样例对比 |
| 类型化范围失控拖慢迁移 | 严守 5.5 务实类型规则：仅公共面强制完整类型，行数据用 Cell/Rows 形状，局部变量不强制 |
| GBK 编码类问题单测难覆盖 | 保留真实 GBK 样例文件做 fixture，纳入对比验证 |
