# 图片识别导入设计

日期：2026-10-13 · 状态：已与用户逐节确认（brainstorming 产出）

## 1. 背景与目标

工具目前支持 CSV / XLSX / 文字版 PDF 三种数据源。实际业务中经常只拿到**截图或扫描件**
（如微信传来的明细表截图），目前只能手工重录成 Excel 再导入。

本期目标：**图片成为第 4 种数据源**，识别后走与 PDF 导入完全相同的
「表头识别 → 列映射 → 校对 → 导出」管线。

### 已确认的关键决策（2026-10-13 与用户逐项确认）

1. 图片形态：**屏幕截图 + 扫描件**（两类都常见；不含严重倾斜的拍照场景）。
2. 数据边界：**本地识别为默认**——纯前端、GitHub Pages 挂网可用、身份证/卡号/金额不出网；
   **云端识别为可选开关**，用户自填 key。
3. 云端方向：接 **OpenAI 兼容的多模态 LLM**（用户自备免费视觉模型即可），而非传统 OCR API
   ——省成本、准确率更高，同时为后续 AI 化铺路。
4. **扫描 PDF 纳入本期**：文字版提取为空时自动降级「页面渲染成图 → OCR 管线」，
   覆盖全部扫描件形态。
5. 付款数据零容错：识别结果**必须经人工校对**（mapping 预览高亮 + 可编辑），不静默入表。

### 非目标（本期不做）

- 手机拍照的透视/倾斜矫正（暂无此形态需求）
- 多图并行识别（串行即可，避免内存峰值）
- 任何形式的代理后端（保持纯静态挂网；云引擎要求所选服务支持浏览器 CORS 直连）
- 内置 API key 或模型文件
- 多云厂商专用适配（统一走 OpenAI 兼容协议，一个 Provider 通吃）

## 2. 关键事实（选型依据）

- **管线同构**：OCR 引擎输出的词块（text + x/y/w/h + confidence）与
  `src/core/parser/pdf-text.ts` 的 `pdfTextItemsToRows()` 输入几何同构 →
  表格重建、列带归位、`smartDetectTable`、`analyzeSheet`（表头识别 + 自动列映射）整条管线可复用。
  图片识别 = 给解析层加新入口，不动下游。
- **OCR 实测质量**（2026-10-13，Windows OCR 跑 1367×261 真实明细截图）：
  中文姓名/证件号/手机号基本全对；**金额小数点与个别数字误读率高**
  （`&`↔`.`、`日`↔`0`、`L`↔`1`；小字号数字仅 10px 高）→
  前处理放大 + 校验层是硬需求，纯靠引擎准确率不可行。
- **Tesseract.js v7**：资源（worker / WASM core / 语言包）运行时走 jsDelivr CDN，
  可用 Cache API 缓存（二次使用离线可用）；v5 起中文模型体积 -73%；v6+ word 级输出需显式开启。
- 现有上传区 `accept=".csv,.xlsx,.xls,.pdf"`，PDF 分支已是「动态 import，仅该分支触达」模式，图片分支照搬。
- pdf.js 主线程 fake worker 的先例：内联约 1MB worker 是体积上限参考——
  Tesseract 模型（数 MB 级）**不内联**，运行时 CDN 拉取。

## 3. 架构与数据流

```
图片文件 / 剪贴板粘贴（png,jpg,jpeg,webp,bmp）        扫描 PDF（文字提取为空时降级）
  │                                                      │ pdf.js 渲染页面 → 图
  ▼                                                      ▼
upload.ts 图片分支（动态 import） ──────────────► ImageOcrService（引擎选择/调度/错误归一化）
                                                    │
                    ┌───────────────────────────────┴───────────────────────────────┐
                    ▼                                                               ▼
          LocalTesseractProvider（默认）                                  LlmVisionProvider（可选开关）
          前处理（放大≥3x/灰度/对比度/按需二值化）                          图片 dataURL → OpenAI 兼容
          → Tesseract.js word 词块{文本,x,y,w,h,confidence}               /chat/completions（自填 baseURL/key/model）
          → ocrWordsToRows() 几何重建（复用 pdf-text 几何核心）            → 表格 JSON 直接成行（自带结构理解）
                    └───────────────────────────────┬───────────────────────────────┘
                                                    ▼
                                    统一 OcrResult { rows, per-cell 置信度/问题标记 }
                                                    ▼
                    validate.ts 校验层（两引擎共用：字段级 + 结构级）
                                                    ▼
                    analyzeSheet()（与 PDF 导入同路径：表头识别 + 自动列映射）
                                                    ▼
                    buildSourceItem({ type: 'image' }) → 现有 mapping 校对步骤
                                        （低置信度/校验失败格高亮，可编辑，人工确认）
```

## 4. 模块清单与职责

新增（core/image 一层，与 core/parser 平级）：

| 模块 | 职责 |
|---|---|
| `src/core/image/types.ts` | `OcrProvider` 接口、`OcrResult`、`OcrCellMeta`（坐标/置信度/问题标记） |
| `src/core/image/preprocess.ts` | 前处理纯函数（ImageData → ImageData）：放大/灰度/对比度/二值化，参数集中常量表，可单测 |
| `src/core/image/ocr-words.ts` | OCR 词块 → Rows 薄适配（过滤空词/统一坐标系），几何核心抽自 pdf-text.ts |
| `src/core/image/providers/tesseract-provider.ts` | 本地引擎：createWorker、资源 CDN+缓存、word 级输出、progress 回调 |
| `src/core/image/providers/llm-provider.ts` | LLM 引擎：请求组装、prompt 契约、响应解析（剥围栏）、重试 |
| `src/core/image/ocr-service.ts` | 引擎选择（读设置）、调度（Worker 单实例复用、多图串行）、错误归一化 |
| `src/core/image/validate.ts` | 字段级 + 结构级校验，产出 per-cell 问题标记 |
| `src/io/ocr-settings.ts` | 云引擎设置存取（localStorage：baseURL/apiKey/model/启用开关） |
| `src/ui/ocr-settings-panel.ts` | 设置 UI + 隐私风险明示；**入口固定在上传步骤的图片提示区**（识别发生在上传环节，设置就近可见；KB 配置面板职责不同，不并入） |

改动：

| 文件 | 改动 |
|---|---|
| `src/ui/steps/upload.ts` | 图片分支 + document paste 监听：**仅当剪贴板含图片文件时**接管为图片导入（文本粘贴不受任何影响），实现微信截图 Ctrl+V 直达 |
| `src/core/parser/pdf.ts` | 文字为空时不再直接报错，降级渲染成图走 OCR 管线 |
| `src/core/parser/source-item.ts` / `src/types.ts` | SourceItem 新增 `type: 'image'` |
| `index.html` | accept 扩展图片后缀 + 文案更新 |
| `package.json` | dependencies + `tesseract.js` |

## 5. 引擎细节

### 5.1 本地 Tesseract.js

- **动态 import**，仅图片/扫描 PDF 分支触达，主 bundle 不增重（与 pdf.js 同取舍）。
- 资源运行时从 jsDelivr CDN 拉取（worker/core/`chi_sim` 语言包）+ **Cache API 缓存**；
  挂网 https 与 file:// 单文件均可走（jsDelivr ACAO:*）。**首次使用需联网**，UI 明示
  「首次识别需下载模型（约数 MB），之后缓存离线可用」。模型不内联进 single 产物。
- 语言 `chi_sim+eng`（中英混排：金额数字、字母）；v6+ 需显式开启 word 级 blocks/bbox/confidence。
- 前处理：短边放大 ≥3 倍（实测小数字仅 10px 高）、灰度、对比度线性拉伸；扫描件灰底加二值化。
  **阈值/参数按真实样张标定**（延续 PDF 导入的标定方法论）。
- Worker 全局单实例复用、多图串行识别，progress 回调接 UI 进度提示。

### 5.2 LLM 视觉引擎（OpenAI 兼容）

- 配置三件套 `baseURL + apiKey + model`，localStorage **明文存储**；
  设置面板红字明示两件事：① key 仅存本浏览器；② 开启即身份证/卡号/金额发送至所填服务。
- 请求：`POST {baseURL}/chat/completions`，vision 消息（图片 dataURL + 指令文本），
  temperature 0；prompt 契约要求**严格 JSON**（表头数组 + 行数组）；响应剥离 ```json 围栏；
  解析失败重试 1 次。解析后的行同样过校验层，不因「LLM 更聪明」而免检。
- 硬约束：所选服务必须**支持浏览器 CORS 直连**，否则被浏览器拦截
  （报错文案解释原因并给排查建议）；**不做代理后端**。

### 5.3 云端服务选型记录（2026-10-13 用户提供三个方向，按项目硬约束取舍）

- **采纳：Agnes AI `agnes-3.0-flash`**（`https://apihub.agnes-ai.com/v1`，OpenAI 兼容
  chat/completions，支持 image_url 图片输入，文档现价 $0、需自注册 API key）——
  满足全部硬约束（OpenAI 兼容 / 图片输入 / 免费 / key 自填），作为**首发目标服务**与
  设置面板的默认示例文案；配置仍是通用 `baseURL/key/model` 三件套，任何兼容视觉服务可替换。
- **不采用（本期）：AiBridge**（WingkySky/AiBridge，Rust 核心 + napi-rs 原生绑定的多模型
  SDK，38+ providers 含 agnes）——JS 绑定为 Node 原生模块，**无法在浏览器/纯静态挂网环境
  运行**；且本项目仅需一次 OpenAI 兼容 fetch，引 SDK 属过度设计。**未来方向**：若做 Node 端
  批量转换 CLI（离线批处理、无浏览器），AiBridge 是合适底座，届时 Provider 抽象可直接迁移。
- **排除：Agnes-Media-Create**（WingkySky/Agnes-Media-Create，Agnes Image/Video API 的媒体
  **生成** Python CLI skill，文生图/图生视频）——与表格**识别**方向无关，且为 Python CLI，
  无法嵌入纯前端。

## 6. 校验层（两引擎共用，零容错的兜底）

- 字段级：金额格式（数字 + 两位小数）、身份证 **17 位加权校验位验算**、手机号 `1[3-9]` 开头 11 位、
  卡号 16~19 位、数字格不得混入全角/字母。
- 结构级：图内自带 小计/合计 行 → **列合计自动核对**，不平整列标红
  （实测样张自带小计，这是自动揪出 OCR 误读的金标准）。
- 高频误读**一键候选修正**：数字格内 `日→0、L→1、&→.` 在校验失败时给出候选——
  仅数字格生效、用户点选确认，**绝不静默修改**。
- 校验产出 per-cell 问题标记 → mapping 预览表格高亮 + 可编辑；LLM 引擎无 confidence 时以校验层为准。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 模型下载失败（无网/CDN 故障） | 明确提示「首次使用需联网下载模型，或配置云引擎」，不静默失败 |
| 识别 0 行 / 纯图形图 | 与 PDF 空文本报错同口径，引导换引擎或换图 |
| LLM 超时 / 401 / 403 / 429 / 非 JSON 响应 / CORS 拦截 | 归一化中文报错（含原因与排查建议），失败重试 1 次 |
| 单图过大（>20MB） | 前置拒绝并提示压缩 |
| 引擎选择 | localStorage 记忆用户上次选择，默认本地 |

## 8. 构建与部署影响

- bundle：tesseract.js 加载器动态 import，主包增量小；WASM/语言包运行时 CDN，不进 bundle。
- `build:single`：单文件内联加载器；模型首用联网下载后 Cache 缓存；file:// 可用。
- GitHub Pages：无新增后端/构建流程改动，符合纯静态现状。
- `dependencies` 仅新增 `tesseract.js`；devDependencies 不变。

## 9. 测试与验收

### 单测（Vitest，node 环境）

- `preprocess`：ImageData 纯函数（放大/灰度/二值化）变换正确性。
- `ocr-words`：合成词块 JSON 夹具 → 行重建（含列带归位、行碎片、数字去空白）。
- `validate`：身份证校验位、金额格式、小计核对、误读候选修正。
- `llm-provider`：响应解析（mock fetch：正常 JSON / 围栏包裹 / 非 JSON / 401 / 429）。
- 扫描 PDF 降级路径：文字为空 → 触发渲染分支（mock 渲染结果）。

### 红线与基线

- **真实截图/扫描件仅限本地调试标定，严禁入库/制夹具**（延续 PDF 导入数据边界）。
- `npm run compare` 现有基线（PDF/CSV/XLSX 全部场景）**必须零变化**——
  pdf-text.ts 几何核心抽取属重构不改行为，compare 是硬门槛。
- 新增夹具一律用合成 OCR 词块 JSON，不含任何真实个人信息。

### 人工验收

用户提供 2~3 张典型截图与扫描件（含 2026-10-12 微信明细截图）本地验收：
双引擎各跑一遍，逐格与原表核对，金额/证件号/卡号零差错为通过标准。

## 10. 实施顺序（粗粒度）

1. types + validate + ocr-words（纯逻辑，先行可测）
2. tesseract-provider + preprocess + upload 图片分支（本地引擎贯通）
3. pdf.ts 扫描 PDF 降级
4. llm-provider + ocr-settings + 设置面板（云引擎贯通）
5. 校对高亮接入 mapping 预览
6. 真实样张标定（前处理参数、置信度阈值）+ 人工验收

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| LLM 服务 CORS 支持参差 | 文档与报错明示约束；实施首日用候选服务实测连通性；不做代理兜底 |
| Agnes `image_url` 文档仅示例公网 URL，base64 dataURL 未必支持 | 实施首日与 CORS 一并用最小 demo 实测；若不支持则设置面板引导换任一支持 dataURL 的兼容服务（Provider 抽象保证零成本替换） |
| tesseract.js v7 word 级输出 API 与文档偏差 | 实施第 1 天先用最小 demo 验证 createWorker/显式开启 blocks，再接入 |
| 扫描 PDF 大页渲染内存峰值 | 页级串行渲染 + 及时释放；限制单图尺寸 |
| 本地引擎准确率不达标 | 前处理参数标定空间大（放大倍数/二值化阈值）；校验层自动揪错；人工校对是最终防线 |
| 重构 pdf-text.ts 影响现有 PDF 行为 | 只抽不改；`npm run compare` 零变化是合并前置条件 |

## 12. 实施与冒烟记录（2026-10-13 当日实施完成）

对照设计的实施偏差与实测结论：

1. **几何重建不抽公共函数**：`ocr-words.ts` 只做坐标适配（图片 y 向下 → 翻转成 y 向上
   基线近似）后**直接调用** `pdfTextItemsToRows`，pdf-text.ts 零改动——
   `npm run compare` 基线 32 用例 / 208 个产物逐格一致，零变化达成。
2. **per-cell 置信度降级为整体均值**（词块级 0~100）：`pdfTextItemsToRows` 不回传词块溯源，
   为不复制几何管线，格级问题完全由校验层承担。
3. **模型复用靠浏览器 HTTP 缓存**（jsDelivr / tessdata 强缓存头）；完全离线复用需
   Service Worker，超出本期。
4. **LLM 引擎吃前处理后的 canvas dataURL**（默认放大 ~3 倍）；A4 扫描级大图的 base64
   体积可达数 MB，受所选 API 体积上限约束。

### 冒烟结论（真实样张：2026-10-12 微信明细截图，本地 dev + 内置浏览器）

- **端到端全流程验证通过**：DataTransfer 注入 → drop → Tesseract.js v7 按钉版路径从
  CDN 拉取 worker/core/语言包（首次自动下载，之后 HTTP 缓存）→ 词块提取 → 坐标适配 →
  表格重建 → mapping 步骤 + 校验横幅，全程约 25 秒（含首次模型下载）。
- 识别质量：整体置信度 86.8%~88.9%；中文姓名/身份证/手机号/开户行大部分正确。已知缺陷：
  1) **表格边框线被读进词块内部**（如 `39626.05|4563510100864730480` 是单个词块）——
     纯符号词块已过滤，嵌入行内的线字符仍致相邻列带粘连；
  2) **表头被裁掉的截图** → 列类型无法识别 → 字段级校验（校验位/位数）不生效。
- **标定待办（验收阶段，与用户逐格核对）**：表格线污染词块的处理（去线预处理/词块切分）、
  OCR 词块的列带阈值标定、无表头数据的列类型推断（18 位→身份证、`1[3-9]`11 位→手机号等）。
