# 本地 OCR 引擎替换为 PaddleOCR 官方浏览器 SDK 实施计划

日期：2026-10-14 · 设计依据：[2026-10-14-paddle-local-engine-design.md](../specs/2026-10-14-paddle-local-engine-design.md)

## Spike 验证结论（2026-10-14 实测，scratch 页 + IAB/Edge，不涉主线代码）

设计 §3 的四项验证，三项已定论、一项待样张：

| 项 | 结论 | 证据 |
|---|---|---|
| ① 资源可控性 | **通过** | 模型托管 paddle-model-ecology.bj.bcebos.com（百度 BOS），GET/OPTIONS 均回 `Access-Control-Allow-Origin`（反射任意 Origin）——GitHub Pages 挂网直接可用，无需迁移模型；det 4.8MB + rec 16.7MB；SDK 支持自定义模型 URL（`ModelAsset.url`，须为含 `inference.onnx`+`inference.yml` 的未压缩 tar）作为后备。ORT wasm 默认 jsDelivr 12.4MB（纯 wasm）/ 25MB（jsep 含 WebGPU）；worker entry jsDelivr 11.3MB（ACAO:*） |
| ② 构建/加载 | **通过** | 主入口 dist/index.mjs 仅 81KB 但带 3 个裸依赖（js-yaml/clipper-lib/@techstark/opencv-js）——**生产集成用 import map + CDN 直载**（见下），不进 single 产物；`vite-plugin-singlefile` 会内联 dynamic import（opencv ~8MB 会撑爆单文件），故不走 npm runtime 依赖。全链路冒烟：合成表格 20 个文本行**全部识别正确**（表头/18 位身份证/金额小数点全对），pipeline 就绪 3~13s、wasm 推理 3.4~6.2s |
| ③ 真实样张 | **待样张** | 需用户提供（红线：仅本地调试，严禁入库/制夹具）；作为实施阶段 0 的验收门槛 |
| ④ 后端/兼容 | **通过** | wasm 后端可用且稳定；webgpu 可用（det/rec 均 webgpu provider）但首跑 12s 慢于 wasm 6.2s（预热/软渲染）——**默认 `backend: 'wasm'`**，webgpu 留作后续实验。前处理交互未测（合成图未走现有 preprocess 管线），实施时按真实样张调 `PreprocessParams` |

### Spike 过程中的关键发现（实施必须遵守）

1. **跨域 Worker 两连坑 → blob module worker 方案**：
   - `new Worker(跨域 URL, {type:'module'})` 直接被浏览器 SecurityError 拒绝；
   - 经典 worker + `importScripts(CDN)` 对小文件可行，但对该 11.3MB worker-entry 实测
     NetworkError（同 URL 页面内 fetch 正常，疑为 webview 大文件 importScripts 限制，原因未深究）；
   - **解法**：主线程 `fetch()` worker 代码文本（CORS 通过，可读流报下载进度）→
     `new Worker(URL.createObjectURL(new Blob([code])), { type: 'module' })`。
     worker-entry 含 `import.meta`（ORT 的 wasm 路径解析），**必须 module 类型**。
2. **`ortOptions.wasmPaths` 必须显式绝对地址**（`https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/`）：
   worker-entry 打包基于 ORT 1.24.3（SDK 声明 ^1.22.0），blob 上下文中 import.meta.url 相对解析失效。
3. **`OcrResultItem.poly` 运行时是 `[x, y]` 数值数组**（每点 `Array[2]`），README 的
   `Point2D {x, y}` 类型标注与实际不符——映射函数按数组下标读，并做最小类型投影防漂移
   （沿 tesseract-provider 手法）。
4. **`createWorker` 工厂是同步签名**，fetch 需在 `PaddleOCR.create` 之前完成。
5. **主入口加载 = import map + `@vite-ignore` 动态 import CDN URL**；类型检查走
   devDependency 的 `import type`。file:// 单文件模式下 blob module worker 可能被禁
   （Chromium 对 file:// worker 限制）——实施时验证；该模式定位是测试用，不可用则提示
   改用 `npx vite preview` 本地起服。
6. 进度：模型下载可经注入 fetch 报百分比；predict 阶段 SDK 无进度钩子 → indeterminate（-1）。

## 阶段与任务

### 阶段 0：真实样张对比（Spike③ 收口，实施门槛）

- 用户提供真实样张（微信截图/扫描件，仅本地调试）。
- 跑法：scratch 冒烟页扩展为「同图分别过 PaddleOCR 与现有 Tesseract 管线」，
  输出两侧 rows 对照（列分离/数字准确率/表头可辨三个维度）。
- **门槛**：PaddleOCR 明显优于 Tesseract 才继续实施；否则停下复盘 Plan B（设计 §6）。
- 同时实测前处理参数：现有 `DEFAULT_PREPROCESS`（≥3x 放大）对 PP-OCR 是助是害，
  确定 `PreprocessParams` 是否按引擎区分。

### 阶段 1：paddle-provider（core 层）

- `src/core/image/providers/paddle-provider.ts`：
  - 资源钉版常量置顶 + 头部注释（策略与坑位，沿 tesseract-provider 格式）：
    worker entry / ORT wasm / 主入口三组 jsDelivr URL + bcebos 模型默认；
  - 加载序：动态 `import(/* @vite-ignore */ CDN_INDEX_URL)`（import map 兜裸依赖）→
    fetch worker 文本（进度回调）→ Blob module worker → `PaddleOCR.create`
    （`lang:'ch'`、`ocrVersion:'PP-OCRv5'`、`backend:'wasm'`、wasmPaths 钉版）；
  - 全局单例 promise 复用 pipeline（失败不缓存 rejected，沿既有模式）；
  - `paddleResultToWords()` 纯函数：poly 数组→包围盒（x=min, y=min, w/ h=跨度）、
    score×100 截断 0-100、纯符号过滤（表格线字符，逻辑平移自 extractWords）；
  - 错误映射：网络类错误 →「本地 OCR 引擎资源加载失败（首次使用需联网下载识别模型…）」；
- `src/core/image/ocr-service.ts`：`getProvider('local')` 指向 paddle-provider（engine id 仍 `'local'`）；
  前处理参数按阶段 0 结论调整（如需）。
- 删除 `src/core/image/providers/tesseract-provider.ts`；`package.json` 移除 `tesseract.js@7.0.0`、
  新增 devDependencies `@paddleocr/paddleocr-js@0.4.2`（仅类型，钉精确版本）。
- 单测：`tests/unit/image/paddle-words.test.ts`（正常映射/空文本/纯符号/置信度截断/poly 数组投影）。

### 阶段 2：接线与页面

- `index.html`：`<script type="importmap">` 三条裸依赖映射（jsDelivr +esm，钉精确版本）。
- 设置面板/上传页文案核查：「本地引擎」称呼不变；如需说明模型来源（首次约 40MB）补一句提示。
- 无其他 UI 改动（engine id、设置结构、回落逻辑全部复用）。

### 阶段 3：质量门

- `npm run typecheck`、`npm test`、`npm run compare`（**零变化硬门槛**）、`npm run build:single`。
- dev 冒烟 + `vite preview` 冒烟：真实样张本地引擎逐项核对（图片上传 + 扫描 PDF 降级两条路径）。
- file:// 单文件模式验证 blob module worker 可用性；不可用则在单文件模式给出明确提示。

## 版本钉

- @paddleocr/paddleocr-js 0.4.2（devDependencies，精确版本，仅类型）
- import map：
  - js-yaml → cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm
  - clipper-lib → cdn.jsdelivr.net/npm/clipper-lib@6.4.2/+esm
  - @techstark/opencv-js → cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/+esm
- 主入口 cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/dist/index.mjs
- worker cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/dist/assets/worker-entry-C9UNuyOJ.js
- ORT wasm cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/
- 模型（默认，勿改）：paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_{det,rec}_onnx_infer.tar

## 风险跟踪（相对设计 §6 的更新）

- worker-entry 文件名含内容哈希（`C9UNuyOJ`）：升级 SDK 版本时必须同步更新钉版 URL——
  在 provider 头部注释中显式标注。
- bcebos 反射式 CORS 属百度侧行为，理论上有变更风险；后备是自制含 inference.onnx+yml 的
  tar 发布到 npm 走 jsDelivr（ModelAsset.url 覆盖），实施不做，仅在 provider 注释中留路径。
- file:// 单文件模式 worker 可用性未定（阶段 3 验证）；挂网 https 与 localhost 均已验证可行。
- 首载体积实测合计约 45-50MB（worker 11.3 + ORT wasm 12.4 + 模型 21.5 + 主入口+依赖 ~10），
  仅本地引擎首次使用时发生，HTTP 缓存承载复用。
