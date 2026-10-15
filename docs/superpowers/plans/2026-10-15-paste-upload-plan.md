# 粘贴上传：剪贴板统一路由实施计划

日期：2026-10-15 · 设计依据：[2026-10-15-paste-upload-design.md](../specs/2026-10-15-paste-upload-design.md)

## 实施要点

1. **parse-csv 加分隔符**：`parseCSV(text, delimiter = ',')`，逗号判断改用参数；引号/转义
   处理零改动。
2. **载荷判别纯函数** `detectClipboardPayload(data, editableTarget)`（upload.ts 导出）：
   守卫（可编辑目标/空 clipboardData → null）→ files → 首个 image item → 表格
   （text/html 含 `<table>` 取行数最多的表逐 tr/td 收 textContent，空结果回落 TSV；
   text/plain 含 `\t` 走 `parseCSV(text, '\t')`）→ 都不满足 null。
3. **路由接线**：`initUploadArea()` 的 paste 监听改为调 `handlePasteEvent(e)`（导出便于
   node 桩测）：preventDefault 后按载荷分发——files → `handleFiles`；image → 现有
   无名兜底命名后 `handleFiles`；table → `importPastedTable`。
4. **P3 粘贴表导入**：建 `kind: 'paste'` 任务行（`剪贴板表格_${Date.now()}`），同步推
   `buildSourceItem({ type: 'csv', ... })`，`completeTask` 走现有折叠/进映射；空表 →
   `failTask('剪贴板内容不是有效表格')`，paste 类型与 unknown 同款无重试按钮；
   pendingFiles/accumFileCount 计数与文件路径一致。
5. **文案**：上传区标题/描述补第三入口（Ctrl+V 粘贴；文件粘贴限 Chrome/Edge）。

## 阶段

1. parse-csv delimiter 参数 + TSV 单测（引号内含制表符/换行、默认逗号不回归）
2. detectClipboardPayload + handlePasteEvent + importPastedTable + 任务行 kind 扩展
   + upload.test.ts 桩测（五类载荷、可编辑守卫、TSV 入源、preventDefault 时机）
3. index.html 文案 + 质量门：typecheck / vitest 全量 / compare 零变化 / build:single
4. 浏览器验收：build:single + preview:single（127.0.0.1:8931）+ IAB DataTransfer
   注入三类粘贴（截图图片/合成文件/HTML 表格+TSV）+ 输入框焦点不劫持；
   DOMParser 分支（jsdom 未装）由本阶段真实覆盖

## 红线

- 可编辑目标内粘贴永不接管；纯文本（无 `\t` 无 `<table>`）静默忽略
- 点击/拖拽/截图粘贴现有行为零变化（parseCSV 默认逗号字节级不变，compare 208 产物零变化）
- paste 任务行无重试按钮（剪贴板可能已变）
