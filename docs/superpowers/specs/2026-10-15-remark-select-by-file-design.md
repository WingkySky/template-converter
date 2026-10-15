# 批量备注：按文件快速选行 设计

日期：2026-10-15 · 状态：已与用户确认方案 A（brainstorming 产出）

## 1. 背景与目标

多文件一起转换时，所有源文件的行合并进同一张导出预览表（`state.outputRows` +
`state.outputRowMeta`）。批量备注工具条目前的选择手段只有：勾单行、选择当前预览
（前 8 行或已展开范围）、全选全部记录。想「只给某个文件的所有行写一句备注」时，
行分散在 206 行的混合表里，只能手动翻页勾选，很慢。

数据基础是现成的：每行输出在 `outputRowMeta[i]` 已带 `fileName` / `sheetName`
（`state.ts:26-31`），且随模版切换有整套缓存/恢复机制
（`export.ts` clone/cache/restore）。缺的只是一个「按文件选行」的交互。

目标：在批量备注工具条加一个下拉，点一下即把某文件的全部行设为已选，
随后按常规流程选备注内容、应用。

### 已确认的关键决策（2026-10-15 与用户确认）

1. **粒度按文件**：一个 Excel 文件的多个 Sheet 行合并为一个条目（用户选「按文件」，
   而非按文件+Sheet 的数据表粒度）。
2. **替换语义**：点文件 A 就只选 A 的行，再点 B 换成 B；给多个文件写同一句备注
   就分两次应用。不做多选累加。
3. **方案 A：工具条下拉动作**（用户选定）。否决的备选：
   - B 表格上方文件胶囊条——胶囊是「看似有状态」的元素，用户随手勾几行后
     「当前选择属于哪个文件」说不清，高亮会失真，且占垂直空间；
   - C 列筛选联动——两步操作，且要改动核心选择函数去感知视觉隐藏，过重。

### 非目标（本期不做）

- 按 Sheet 粒度选择、多文件累加选择（下拉复选框）
- 下拉内搜索（文件很多时再说，现有 search-dropdown 可后续复用）
- 选中后自动滚动/展开预览到该文件首行（「已选 N 行」计数已足够确认）
- 选择与列筛选的任何联动（维持现状：选择类操作无视视觉筛选，与「全选全部记录」口径一致）

## 2. 交互设计

工具条「清除选择」右侧新增一个 `<select id="note-file-select">`：

- 占位项「按文件选行…」（value=""），select 加 `title="按文件快速选中该文件全部行"`。
- 选项 = 当前 `outputRowMeta` 中出现过的文件，**按首次出现（上传）顺序**排列；
  每项显示 `文件名（N 行）`，option 带 `title`（完整文件名，防截断看不全）。
- 选中即**替换**当前选择为该文件全部行，随后 select **弹回占位符**——它是动作
  不是状态；「已选 N 行」计数与行复选框经现有 `updateNoteSelectionUI()` 局部刷新，
  不整页重渲染。
- 当前输出只含 **≤1 个文件时不渲染该下拉**（此时「全选全部记录」已等价）。
- 长文件名不影响工具条布局：收起态只显示占位符，宽度稳定。

## 3. 数据与逻辑（全部落在 `src/ui/export/remark-panel.ts`）

新增三个函数 + 渲染插入 + 委托接线一行：

1. `getOutputFileGroups(): { fileName: string; rowIdxs: number[] }[]`
   遍历 `state.outputRowMeta`，按 `m.fileName || '未命名文件'` 分组、保序
   （首次出现顺序）。空名兜底口径与 `getSplitGroupCounts`（export.ts:499）一致。
   纯函数，读 state，便于 node 单测。
2. `selectNoteRowsByFile(fileName: string)`
   按名取组的 `rowIdxs` → `setSelectedNoteRows(rowIdxs)`（现有函数天然去重/
   过滤越界/升序）→ `updateNoteSelectionUI()`。找不到对应组（理论不可能，
   下拉选项即由它生成）则不清空选择、静默返回。
3. `onNoteFileSelect(el: HTMLSelectElement)`
   读 `el.value` → 空值直接 return → 否则 `el.value = ''` 弹回占位符后调
   `selectNoteRowsByFile`。
4. `renderRemarkPanel()`：工具条「清除选择」按钮后插入下拉 HTML，
   仅当 `getOutputFileGroups().length > 1`；option value 与文案均经 `escapeHTML`。
5. `initRemarkPanelHandlers()`：change 委托表加
   `onNoteFileSelect: (el) => onNoteFileSelect(el as HTMLSelectElement)`。

模版切换无需特殊处理：文件列表每次渲染从当前 `outputRowMeta` 现算，切换预览
模版后下拉自动跟随；选择集本身已有按模版缓存/恢复机制（export.ts:136/160）。

## 4. 改动范围与边界

- **源码只改 `src/ui/export/remark-panel.ts`**。无新 state 字段、无 CSS 改动
  （复用 note-toolbar 里 select 的现有样式与事件委托管线）。
- 边界：
  - meta 缺失或 `fileName` 为空的行 → 归入「未命名文件」组；
  - 工具条整体只在「有备注列且有行」时渲染（现有分支），下拉自然跟随；
  - 列筛选只视觉隐藏行，按文件选择选的是该文件全部行，不受筛选影响；
  - 应用/清空备注后 `showExportStep()` 全量重渲染，选择集在 state 中保留，
    下拉因弹回占位符而不残留状态。

## 5. 测试

`tests/unit/ui/remark-panel.test.ts` 追加（node 环境，不依赖 DOM）：

- `getOutputFileGroups`：多文件分组计数正确、按首次出现保序、空名兜底「未命名文件」。
- `selectNoteRowsByFile`：选中对应行集且为升序、替换旧选择（先全选再按文件选）。
- `renderRemarkPanel`：多文件时含 `id="note-file-select"` 与
  `data-action="onNoteFileSelect"`、选项带行数文案；单文件时不渲染下拉。

回归门槛：`npm run typecheck`、`npm test`、`npm run compare`（行为对比，改行为后必跑）、
`npm run build`。
