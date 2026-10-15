# 批量备注：按文件快速选行实施计划

日期：2026-10-15 · 设计依据：[2026-10-15-remark-select-by-file-design.md](../specs/2026-10-15-remark-select-by-file-design.md)

## 实施要点

1. **分组纯函数** `getOutputFileGroups()`：遍历 `state.outputRowMeta`，按
   `m.fileName || '未命名文件'` 分组、按首次出现保序，返回
   `{ fileName, rowIdxs }[]`；不写 state。
2. **选行动作** `selectNoteRowsByFile(fileName)`：取组 `rowIdxs` →
   `setSelectedNoteRows`（去重/越界/升序现成）→ `updateNoteSelectionUI()`；
   找不到组静默返回。
3. **下拉动作包装** `onNoteFileSelect(el)`：value 空 return，否则弹回
   `''` 再调选行（动作语义不残留状态）。
4. **渲染插入**：`renderRemarkPanel()` 在「清除选择」按钮后插
   `<select id="note-file-select" data-action="onNoteFileSelect">`，仅
   `getOutputFileGroups().length > 1`；占位项「按文件选行…」、选项文案
   `文件名（N 行）`、value 与文案均 `escapeHTML`，option 带 `title`。
5. **接线一行**：`initRemarkPanelHandlers()` change 委托表加
   `onNoteFileSelect`。

## 阶段

1. remark-panel.ts：三个函数 + 渲染插入 + 委托接线（唯一源码改动文件）
2. remark-panel.test.ts 追加：分组计数/保序/空名兜底、按文件选行替换旧选择、
   渲染含 data-action 与行数文案、单文件不渲染下拉
3. 质量门：typecheck / vitest 全量 / compare 零变化 / build
4. 浏览器冒烟：preview:single（127.0.0.1:8931）+ IAB 注入两个文件走通
   上传→映射→导出，验证下拉出现、按文件选行计数正确、弹回占位符、
   应用备注只落被选行

## 红线

- 现有选择类按钮（选择当前预览/全选全部记录/清除选择/勾行）、备注应用与清空
  行为零变化（compare 零变化）
- 无新 state 字段、无 CSS 改动；工具条其余控件不动
- ≤1 个文件时不渲染下拉（单文件用户界面零变化）
- 列筛选与按文件选择互不影响（选择口径与「全选全部记录」一致）
