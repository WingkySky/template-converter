# 上传反馈统一：文件任务行（修 PDF 假死）设计

日期：2026-10-14 · 状态：已与用户逐节确认（brainstorming 产出）

## 1. 背景与目标

现状两个问题叠加，造成「上传 PDF 像假死，用户重复上传」：

1. **PDF 分支零反馈**：图片上传有 `#ocr-progress` 单行提示（`OcrProgress {percent, stage, detail}`
   回调驱动，阶段文案如「下载本地识别组件 45%」「识别中」）；PDF 从 FileReader 读取到
   `parsePdfSource` 完成之间没有任何 UI 反馈。慢的阶段有三个——`getDocument` 文档解析、
   逐页 `getTextContent` 提取、扫描件降级（逐页 3 倍渲染 + OCR，多页可达数十秒，本地引擎
   还要先下载识别组件）——全部静默。
2. **收到确认缺失**：累加条（`updateAccumIndicator`）只在**所有**文件解析完成后才刷新，
   上传瞬间连「文件已收到」都没有。

目标：统一**所有文件类型**的上传反馈为「每文件一行任务行」——上传瞬间即建行，解析过程
实时更新阶段文案，成功折叠进现有累加条，失败行内显示原因并可重试（取代 alert 弹窗）。

### 已确认的关键决策（2026-10-14 与用户逐项确认）

1. **布局方案 A**：处理期间/失败的文件逐行显示，成功后折叠进现有「已累加」摘要条；
   不做常驻清单（方案 B）、不做单行摘要（方案 C）。
2. **失败行内化 + 行内重试**，去掉 alert 弹窗（含「不支持的文件格式」提示）。
3. **实现方案 1：任务注册表 + 回调透传**——复用 `OcrProgress` 结构与既有回调注入模式；
   不引入事件总线（YAGNI，core 层一贯回调注入）；不把解析挪进 Web Worker
   （`pdf.ts` 头注已说明 file:// 单文件构建下真 Worker 的兼容性取舍，PaddleOCR 引擎
   自带 worker 管理，为反馈条做此手术不值；主线程解析期间 CSS spinner 走合成器线程
   不受阻塞，逐页 await 亦有余裕）。

### 非目标（本期不做）

- 解析 Web Worker 化 / 改动 pdf.js 主线程 fake worker 模式
- 成功行常驻展示（成功即折叠，文件明细不追溯）
- 并发任务限流、取消进行中的解析
- CSV/XLSX 分段进度（读取+解析通常亚秒级，行一闪而过可接受）

## 2. 数据结构与渲染（upload.ts）

任务列表是上传 UI 的**局部状态**，放 `upload.ts` 模块级（与 `IMAGE_EXTS` 同级），
不进 `state.ts`：

```ts
type UploadTaskStatus = 'parsing' | 'failed';   // 完成即从列表移除，不留 done 状态
interface UploadTask {
  id: number;            // 自增
  file: File;            // 保留引用，重试用
  fileName: string;
  kind: 'csv' | 'excel' | 'pdf' | 'image' | 'unknown';
  stage: string;         // parsing 阶段文案
  errorHint?: string;    // failed 原因
}
```

- **容器**：`index.html` 现有 `#ocr-progress` 单行提示**删除**，原位换成
  `<div id="upload-tasks"></div>`（上传区内、累加条之上）——旧单行机制被任务行**取代**，
  不并存；`updateOcrProgress` / `hideOcrProgress` 随之删除。
- **渲染**：`renderTasks()` 全量重建 `#upload-tasks` 的 innerHTML（未折叠任务通常个位数）；
  任何任务状态变化（建行/阶段更新/折叠/失败）立即重渲。容器缺失时静默——沿用现有
  `#ocr-progress` 对 Node 测试桩的兼容口径。
- **行样式**（`style.css` 新增 `.upload-task-row` 变体）：
  - parsing：spinner + 文件名 + 阶段文案；`percent >= 0` 时附 ` xx%`，`-1` 不显示百分比；
    `detail` 存在时附 ` · {detail}`（与现 `updateOcrProgress` 拼接口径一致）。
  - failed：红 `✕`（图标 `x`）+ 文件名 + `errorHint` + 「重试」按钮（图标 `refresh`，
    `data-action="retryTask"` + `data-task-id`；`kind='unknown'` 的失败行无重试按钮，
    见 §4）。重试走容器上的 `delegateAction`
    事件委托（同 `accum-indicator` 模式）。
- **行生命周期（所有类型统一）**：
  1. `processFile` 入口即建行，stage=「读取文件…」——上传瞬间即有反馈，假死感的直接解药；
  2. CSV/XLSX 读解析完即折叠；PDF/图片解析回调实时接到行文案；
  3. `pendingFiles` 归零后照旧刷新累加条 + 进入映射步骤。
  - 剪贴板粘贴上传走 `handleFiles`，自动获得同一套反馈，无额外接线。

## 3. PDF 进度点（pdf.ts）

`parsePdfSource(data, fileName, onProgress?)` 增加可选第三参，类型复用
`core/image/types.ts` 的 `OcrProgress`；不传零开销，现有 Node 测试不受影响：

| 时机 | 上报内容 |
|---|---|
| `getDocument` 之前 | `{ percent: -1, stage: '解析文档结构…' }` |
| 逐页文字提取 | `提取文字 第 p/N 页`，percent = (p-1)/N×100 |
| 扫描件降级每页渲染前 | `扫描件 第 p/N 页 · 渲染中`，percent 同上 |
| 扫描件降级 OCR 中 | 透传 `recognizeCanvasRaw` 内部进度，合成为 `扫描件 第 p/N 页 · {内部stage}`，内部 `detail` 同样透传；总 percent = ((p-1) + 内部percent/100)/N×100；内部为 -1 时整体保持 -1 |

- `ocrScannedPages` 同步增加 `onProgress` 参数并向下透传给 `recognizeCanvasRaw`。
- `analyzeSheet` 毫秒级完成，不上报。
- 图片分支：`importImageSource` 已有 `onProgress`，接到任务行即可，零新增 core 改动。

## 4. 失败与重试

- 「读取+解析」封装为 `processOne(task)`；`processFile` = 建行 + `processOne(task)`。
  重试 = 行转回 parsing（stage=「读取文件…」）+ 再调 `processOne(task)`，
  File 引用一直保留在任务里。
- 各分支 `catch`：任务行转失败态，`errorHint` = 错误 message；**删除 PDF/图片分支的
  alert**；「不支持的文件格式」行内化（`kind='unknown'`，无重试按钮——重试无意义）。
- `pendingFiles` 语义不变：失败减一、重试加一；归零仍触发累加条刷新 + `showMappingStep`。
  重试成功 = 该行折叠，若归零则正常进入映射。
- 失败行保留至重试成功折叠或 `resetAll` 清空；后续批次追加新行，不影响旧行。
- `resetAll` 接线：`upload.ts` 导出 `resetUploadTasks()`，`export.ts` 的 `resetAll`
  （约 `:713`）加一行调用（export→upload 单向引用，无环）。

## 5. 测试与回归

- `tests/unit/parser/pdf.test.ts`：新增 `onProgress` 用例——合成 2 页夹具依序收到
  「提取文字 第 1/2 页」「第 2/2 页」，percent 单调不减；不传 `onProgress` 的现有
  用例保持通过。
- `tests/unit/ui/upload.test.ts`：「不支持的扩展名」用例（`:44`）改断言行内失败
  （`errorHint='不支持的文件格式'`、无 alert、`pendingFiles` 回落、累加计数保留）；
  `stubDom` 补 `#upload-tasks` 元素；alertMock 相关断言移除。
- IAB 冒烟（127.0.0.1:8931）：拖入大 PDF 瞬间出行；扫描件 PDF 显示逐页 OCR 进度；
  失败行重试成功；全程无 alert。
- `npm run compare` 行为回归必跑。
