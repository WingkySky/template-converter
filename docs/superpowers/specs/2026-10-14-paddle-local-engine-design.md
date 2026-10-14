# 本地 OCR 引擎替换为 PaddleOCR 官方浏览器 SDK 设计

日期：2026-10-14 · 状态：已与用户确认方案选型与设计（brainstorming 产出）

## 1. 背景与目标

图片识别导入（2026-10-13）上线后的双引擎实测结论：云端 LLM 完胜本地 Tesseract
（8 列完美分离/表头全对 vs 列粘连无表头）。本地兜底引擎的差距是**模型代差问题**：
Tesseract LSTM 是上一代架构，中文+表格是其最弱场景，调参无法弥合。

2026 年市场调研结论（OmniDocBench v1.6 榜单等）：

- 传统管线中 **PaddleOCR（PP-OCRv5/v6）是中文 OCR 公认最强开源方案**（91k stars，Apache-2.0）；
- 官方已出浏览器 SDK **`@paddleocr/paddleocr-js`**（v0.4.2，2026-06 更新，ONNX Runtime Web
  + OpenCV.js，支持 WebGPU/WASM，月下载约 4.6 万）；
- 文档解析小模型 VLM（PaddleOCR-VL 0.9B、GLM-OCR 0.9B 等）精度虽高，但**排除**：
  Ollama/Umi-OCR 路线要求访客本机装软件，与挂网纯静态形态冲突；浏览器内跑 2B 级
  VLM 需下载数 GB，对兜底引擎不划算。

本期目标：**本地兜底引擎从 Tesseract.js 替换为官方 PaddleOCR 浏览器 SDK**，
使无 LLM key 的访客获得明显更好的中文表格识别。

### 已确认的关键决策（2026-10-14 与用户确认）

1. **挂网形态优先**：纯静态单页应用、GitHub Pages、无后端；单文件本地模式仅作测试。
   引擎选型必须在此形态下可实操（浏览器内推理 + CDN 资源）。
2. **引擎定位：云端主、本地兜底**——本地不需追平云端，验收线是
   「真实样张上明显好于 Tesseract」（列分离/数字准确率/表头可辨）。
3. **替换而非并存**：移除 Tesseract，不留隐藏回退（双引擎只多两条 CDN 依赖与代码路径；
   git 历史留档）。
4. 资源策略沿用既有模式：**模型/WASM 钉版 jsDelivr CDN，懒加载，不进 single 产物**
   （不突破 pdf.js 1MB worker 内联的体积先例）。

### 非目标（本期不做）

- 云端 LLM 通道的任何改动（provider、设置、回落逻辑均不动）
- 归行/列映射/清洗管线改动（`pdfTextItemsToRows`、`cleanOcrRows` 零改动）
- 前处理算法重做（仅按 spike 结论决定参数是否微调）
- 方案 2 的管线补课（表格线去除等）——仅作为 spike 失败时的 Plan B

## 2. 架构与数据流

只替换 `OcrProvider` 接口的一个实现点，接口与数据流完全不变：

```
canvas → preprocess（服务层，现有）→ paddle-provider（新）→ OcrWord[]
  → ocrWordsToRows → pdfTextItemsToRows（几何管线，零改动）→ analyzeSheet
```

### 涉及文件

| 动作 | 文件 | 说明 |
|---|---|---|
| 新增 | `src/core/image/providers/paddle-provider.ts` | 实现 `OcrProvider`，engine id 保持 `'local'` |
| 删除 | `src/core/image/providers/tesseract-provider.ts` | 连同其钉版常量与 Tesseract 类型投影 |
| 基本不动 | `src/core/image/ocr-service.ts` | `pickEngineOrder`/回落提示无需改动；仅 spike 结论要求时微调前处理调用参数（`PreprocessParams`，不动算法） |
| 不动 | `src/io/ocr-settings.ts`、`src/ui/ocr-settings-panel.ts` | 本地引擎无配置项；文案仍称「本地引擎」 |
| 修改 | `package.json` | 移除 `tesseract.js@7.0.0`，新增 `@paddleocr/paddleocr-js`（钉版） |

**engine id 保持 `'local'` 的理由**：`pickEngineOrder`、auto 回落文案
（「已自动回落本地引擎」）、`item.ocr.engine` 取值全部无需改动，
UI 与既有数据的兼容面最小。

### 映射细节

- PP-OCR 返回**行级**检测框 + 识别文本 + 置信度（0~1），映射为 `OcrWord[]`：
  `confidence × 100`；行级框直接参与现有几何管线（Tesseract 是词级，
  行级对列带计算通常更稳，spike 实测确认）。
- 保留纯符号过滤（表格边框被识别成 `| — ~` 的场景换引擎后仍可能存在），
  逻辑从 `extractWords` 平移。
- 映射逻辑写成纯函数 `paddleResultToWords()` 并配 Node 单测
  （投影 SDK 输出结构为最小接口，防类型库漂移——沿 tesseract-provider 手法）。

## 3. Spike 验证（实施前置，一票否决点）

用最小代价验证四件事，**任一失败即停下复盘**（备选社区 SDK：
`ffocr`（WebGPU/WASM 自动选择，2026-10 活跃）、`@gutenye/ocr-browser`（1.4.9））：

1. **模型资源可控性**：SDK 的模型/ONNX/WASM 下载 URL 与体积、能否钉到 jsDelivr、
   https 页面（GitHub Pages）跨域是否放行。这是挂网可用性的生死线。
2. **单文件构建兼容**：动态 import + `vite-plugin-singlefile` 下正常工作，
   SDK 自带 worker/wasm 路径在 build 产物中解析正确（dev 与 `build:single` 双验）。
3. **真实样张精度**：用户手头真实样张本地实测（**严禁入库/制夹具**，沿用红线），
   对比 Tesseract：列分离、数字准确率、表头可辨、表格线干扰程度。
4. **兼容性与前处理交互**：无 WebGPU 环境走 WASM 可用；现有前处理
   （≥3 倍放大+灰度+对比度）对 PP-OCR 是助是害，决定参数是否微调
   （改参数只动 `ocr-service.ts` 的调用侧 `PreprocessParams`，不动算法）。

Spike 产出：四项结论 + 选型最终确认（官方 SDK 或备选）→ 再进入实施计划。

## 4. 实施要点

- 新 provider 复用既有模式：
  - 资源钉版常量置顶 + 头部注释说明策略（同 tesseract-provider 头部）；
  - worker/实例全局单例复用，创建失败不缓存 rejected promise（允许重试）；
  - 网络类错误映射为友好文案：「本地 OCR 引擎资源加载失败（首次使用需联网下载
    识别模型，之后浏览器缓存承载复用）：…」。
- 进度回调：SDK 若有下载/识别进度钩子则透传 `OcrProgress`；没有则 `percent: -1`
  走不确定进度（与 LLM 引擎同款，UI 已支持）。
- `package.json` 钉版本号（不用 `^`），与 7.0.0 钉版惯例一致。

## 5. 测试与验收

- `npm run compare` 基线**零变化**（图片源 opt-in 路径，与 2026-10-13 图片导入同隔离手法；
  Node 测试不触达浏览器分支，现有测试零影响）。
- 新增 `paddleResultToWords()` 单测（正常映射/空文本过滤/纯符号过滤/置信度截断）。
- 真实样张手动冒烟（本地调试，不入库）：图片上传 + 扫描 PDF 降级两条路径。
- **验收标准**（三条同时满足）：
  1. 挂网形态（GitHub Pages 静态托管 + CDN 资源）下全流程可用；
  2. 真实样张上列分离/数字准确率明显优于 Tesseract（spike 第 3 项的实测对比留档）；
  3. `npm run compare` 零变化，`npm test` 全绿。

## 6. 风险与回退

| 风险 | 影响 | 对策 |
|---|---|---|
| 官方 SDK v0.4.x 较新 | 行为不稳定/文档缺 | spike 前置一票否决；社区 SDK（ffocr、@gutenye/ocr-browser）为 Plan B |
| jsDelivr 大陆可达性 | 首次加载慢/失败 | 与现状同水平（Tesseract 已在用 jsDelivr），不新增风险；加载失败文案已友好化 |
| 首载体积（OpenCV.js + 模型预计 20-40MB） | 用本地引擎的访客首次等待 | 懒加载隔离：仅本地引擎被实际调用时下载；HTTP 强缓存承载复用 |
| 无 WebGPU 的旧环境 | 推理慢 | SDK 回落 WASM；spike 第 4 项验证可用性 |
| PP-OCR 与现有前处理互斥 | 精度不升反降 | spike 第 4 项实测；必要时前处理参数按引擎区分（仅调用侧参数） |
| spike 整体失败 | 本方案不可行 | Plan B：留在 Tesseract + 管线补课（表格线去除、归行改进，方案 2） |
