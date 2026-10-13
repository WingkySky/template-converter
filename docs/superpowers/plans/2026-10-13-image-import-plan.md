# 图片识别导入实施计划

日期：2026-10-13 · 设计依据：[2026-10-13-image-import-design.md](../specs/2026-10-13-image-import-design.md)

## 实施要点沉淀（设计与实现的偏差修正）

1. **几何重建不抽公共函数**：`ocrWordsToRows` 做坐标适配（图片 y 向下 → 翻转成 PDF 的
   y 向上基线近似）后**直接调用** `pdfTextItemsToRows()`——零改动、零重构，compare 零风险。
   阈值（0.75×字号中位数行容差、0.6×字号格内间隙）为比例制，对 OCR 词块天然适用。
2. **per-cell 置信度降级为整体均值**：`pdfTextItemsToRows` 不回传词块→格的溯源，为不复制
   管线，置信度只提供**全图均值**（提示用户重点核对），格级问题完全由校验层标记。
3. **可编辑数据的落点**：`confirmMapping` 会重跑 `smartDetectTable(src.rows)`，编辑直接改
   `mappingState.dataRows` 会被丢弃——图片源引入 `source.dataRowsOverride`，确认映射与
   预览渲染统一走 `dataRowsOverride ?? 智能检测结果`。
4. **模型缓存**：语言包/WASM 由 jsDelivr + tessdata.projectnaptha.com 的 HTTP 缓存承载
   （强缓存头），首次联网后重复使用不再下载；完全离线复用需 Service Worker，超出本期。
5. **扫描 PDF 在 Node 测试环境保持原报错**：`typeof document === 'undefined'` 时不走
   渲染降级，pdf.test.ts 的 `/扫描件/` 断言不动。

## 阶段与任务

### 阶段 1：纯逻辑 core（先行可测）
- `src/core/image/types.ts` — OcrWord / OcrEngineResult / OcrProgress / Provider 入参
- `src/core/image/preprocess.ts` — enhance（灰度/对比度/二值化，ImageData 纯函数）+ drawScaled
- `src/core/image/ocr-words.ts` — 词块坐标适配 + 调 pdfTextItemsToRows + 均值置信度
- `src/core/image/validate.ts` — 字段级（身份证校验位/手机号/卡号/金额）+ 小计列合计核对
  + 高频误读候选（日→0、L→1、&→.、O→0、，→.），仅对已识别类型的数字格生效
- `src/core/parser/source-item.ts` / `src/types.ts` — SourceItem 增可选 `ocr`、`dataRowsOverride`
- 单测：tests/unit/image/{preprocess,ocr-words,validate}.test.ts

### 阶段 2：引擎与设置
- `src/core/image/providers/tesseract-provider.ts` — v7.0.0，worker/core/lang 路径钉 jsDelivr，
  blocks 显式开启，worker 单实例复用，logger 接进度
- `src/core/image/providers/llm-provider.ts` — OpenAI 兼容 chat/completions，dataURL 图片，
  严格 JSON 契约 + 围栏剥离 + 一次重试 + 归一化错误（CORS/401/429/超时 120s）
- `src/core/image/ocr-service.ts` — 引擎选择（读设置）、blob→canvas→预处理→识别→analyzeSheet
  → SourceItemData 组装；`recognizeCanvas` 供扫描 PDF 复用
- `src/io/ocr-settings.ts` — localStorage（tc-ocr-settings-v1），默认值含 Agnes 示例配置
- 单测：tests/unit/image/llm-provider.test.ts（mock fetch）

### 阶段 3：接线
- `src/ui/steps/upload.ts` — 图片分支（png/jpg/jpeg/webp/bmp）+ document paste 监听
  （仅剪贴板含图片时接管）+ OCR 进度条
- `src/core/parser/pdf.ts` — 空文字时浏览器内渲染页面成图走 OCR（Node 环境保持原报错）
- `src/ui/ocr-settings-panel.ts` — 识别设置弹层（modal-* 既有样式），入口在上传步骤
- `src/ui/steps/mapping.ts` — 图片源预览格高亮（校验问题）+ 点击编辑（prompt 预填候选）
  + 列合计不平横幅
- `index.html` — accept 扩展、文案、设置按钮、进度条容器；`src/main.ts` 接线
- `src/style.css` — .ocr-issue 等少量样式

### 阶段 4：质量门
- `npm run typecheck`、`npm test`、`npm run compare`（零变化硬门槛）、`npm run build:single`
- dev 冒烟：真实样张（2026-10-12 微信截图，仅本地）走本地引擎逐格核对

## 版本钉

- tesseract.js 7.0.0（dependencies，精确版本，与 exceljs/pdfjs-dist 同策略）
- workerPath: cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js
- corePath: cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0
- langPath: tessdata.projectnaptha.com/4.0.0（chi_sim+eng）
