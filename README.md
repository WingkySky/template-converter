# 灵工发放模版转换工具

一款基于浏览器的在线工具，用于将 CSV/Excel 数据文件快速转换为多个灵活用工平台的导入模版。纯前端实现，无需后端。

## 功能特性

### 智能识别
- 自动识别数据列类型：姓名、身份证、手机号、开户银行、银行卡号、税前金额、性别、开户地/税源地、备注
- 支持 CSV（UTF-8/GBK 自动重试）和 Excel（.xlsx/.xls）
- 多文件上传，自动合并分析；智能跳过费用/汇总行，支持双行表头
- 知识库（商社/任务数据）自动填充商社编号、平台、税源地、任务清单、工种、批次号

### 目标模版
- **移步到岗**：简洁 6 列表格
- **身边云**：保留说明行和批次信息（ExcelJS 保留原版样式，可选批次行/纯数字金额）
- **本公司**：完整配置表和任务清单
- **自定义模版**：自由定义列名和顺序

新增平台模版只需在 `src/core/templates/` 增加一个模版文件并在注册表注册一行。

### 导出模式
- **合并导出**：全部数据一份文件
- **按文件拆分 / 按数据表拆分**（一源一单）：与来源一一对应，ZIP 打包下载
- 四模版可多选，一次打包导出

## 快速开始

```bash
npm install        # 安装依赖（xlsx 来自 SheetJS 官方 tarball，exceljs 4.4.0）
npm run dev        # 本地开发（http://localhost:5173）
npm run build      # 产出纯静态 dist/（相对路径，任意静态托管可用）
npm run build:single  # 产出单文件 dist-single/index.html（全内联，双击即可打开）
npm run preview    # 本地预览构建产物
```

部署：把 `dist/` 拷贝到任意静态服务器（nginx / GitHub Pages / 内网文件服务器）即可，无需 Node 环境与外网。

### 双击使用（免部署）

`npm run build:single` 产出约 1.5MB 的 `dist-single/index.html`，JS/CSS/xlsx/exceljs 全部内联、零外部请求，**双击即可在浏览器中打开使用**（file:// 下内联模块不受 CORS 限制，已用无头浏览器实测）。适合邮件/IM 分发给同事单机使用。注意：单文件模式下 localStorage 按文件来源隔离，与挂网版本的知识库互不相通。

## 测试与回归保障

```bash
npm run test       # Vitest 单元测试（270+，覆盖解析/映射/知识库/导出全链路）
npm run compare    # 样例对比：32 用例 × 4 模版 × 6 导出模式，与基线产物逐格比对
npm run baseline   # 重新生成基线（仅在有意变更行为时执行）
```

基线产物存于 `tests/fixtures/baseline/`（已入库）。**重构或升级依赖后必须跑 `npm run compare`，全绿才可发布。**

## 架构

```
src/
├── main.ts            # 入口：装配各步骤 init、编排接缝注入
├── state.ts           # 全局状态（AppState 接口）——core 层禁止 import
├── types.ts           # 共享领域类型
├── core/              # ★ 纯逻辑：无 DOM/localStorage 依赖，全部可单测
│   ├── parser/        # CSV(GBK)/Excel 解析、智能表格识别、双行表头
│   ├── mapping/       # 列类型推断、金额列打分
│   ├── clean/         # 金额清洗、身份证形近字符归一
│   ├── kb/            # 知识库模型、商社匹配、税源/任务/批次推断
│   ├── generate/      # generateOutputData 纯转换
│   ├── templates/     # ★ 模版注册表（yidao/shenbianyun/youyi/custom）
│   └── export/        # 工作簿构建、拆分分组、手写 ZIP、命名
├── io/                # 副作用层：localStorage 知识库、文件保存（FSA API + 降级）
└── ui/                # 渲染 + 事件：data-action 事件委托，无内联 onclick
    ├── steps/         # 五个向导步骤（kb-panel/upload/mapping/template/export）
    └── export/        # 导出面板子模块（预览表/控件/备注/筛选/搜索下拉）
```

分层规则：`core` 不碰 DOM/storage/state（数据经参数进出）；`ui` 只调 core/io；未来接云端知识库只需替换 `io/kb-storage.ts` 实现。

详细设计见 `docs/superpowers/specs/`，实施计划与阶段记录见 `docs/superpowers/plans/`。

## 使用方法

1. **上传样例文件**：点击或拖拽，支持多文件
2. **确认列映射**：系统自动识别，可手动改选
3. **选择目标模版**：可多选；自定义模版在此定义列
4. **预览 & 导出**：逐行编辑平台/任务/批次/备注，列筛选，选导出模式后导出

## 注意事项

- 文件保存优先使用 File System Access API（Chrome/Edge，记住上次目录），其他浏览器自动降级为直接下载
- 知识库按浏览器本地存储（localStorage），跨用户/设备用「导出备份 / 导入备份」传递
- 导出文件格式为 Excel（.xlsx）或 CSV（UTF-8 BOM）
