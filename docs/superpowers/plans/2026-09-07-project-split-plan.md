# 项目拆分实施计划

- 日期：2026-09-07
- 依据：[2026-09-07-project-split-design.md](../specs/2026-09-07-project-split-design.md)（v2，TS 全量）
- 执行方式：主智能体负责串行主干（脚手架、legacy.js/index.html/main.ts 收口、集成验证），阶段 1/3 以**文件所有权分区**并行派发子智能体

## 执行策略：多智能体分区并行

- 子智能体只创建**各自拥有的新文件**（模块 + 测试），不改 `legacy.js` / `index.html` / `main.ts` / `state.ts`
- 主智能体在子智能体返回后串行收口：从 legacy.js 移除已抽取代码、补 import 桥接、跑验收闸门
- 统一验收闸门（每阶段）：
  1. `tsc --noEmit` 零错误
  2. `vitest run` 全绿
  3. `npm run compare`（样例对比）无差异
  4. `npm run dev` 页面行为不变
- 每阶段结束独立提交到 main

## 阶段 0：脚手架与基线（串行）

- [ ] 0.1 package.json：deps（`xlsx` 用 SheetJS 官方 CDN tarball 0.20.1、`exceljs` 固定 4.4.0）；devDeps（vite、typescript、vitest、typescript-eslint）；scripts（dev/build/preview/test/compare）
  - 规格修正：spec 第 7 节原定 `public/vendor/` 本地文件。实际采用 npm tarball 作为运行时依赖由 Vite 打包——tarball 与 CDN 是**同一官方 0.20.1 产物**，版本严格一致且安装后离线可用，Node 侧 harness 也能直接 import，优于全局脚本方案
- [ ] 0.2 tsconfig.json（strict、allowJs legacy、moduleResolution bundler）+ vite.config.ts（base './'、vitest node 环境）+ eslint.config.js
- [ ] 0.3 index.html：从原 HTML 迁移 `<style>`（→ src/style.css）与 `<body>` 骨架；`<script type="module" src="/src/main.ts">`
- [ ] 0.4 src/legacy.js：原 `<script>` 内容**逐字**迁入，临时改为显式挂 window（保证内联 onclick 可用）
- [ ] 0.5 基线 harness：tests/tools/baseline.mjs（Node 直接 import xlsx/exceljs + legacy.js 的纯函数管道，绕过 UI）+ tests/fixtures/（仓库 5 个样例文件 + GBK CSV）；生成基线产物存 tests/fixtures/baseline/
- [ ] 0.6 compare 脚本：tests/tools/compare.mjs，逐格断言（SheetJS 读回）
- [ ] 0.7 原文件 template-converter.html **保持不动**直至阶段 5（迁移期间双入口均可用，原文件是行为参照）
- 验收：闸门 1/2 通过（首个冒烟单测）、闸门 3 基线生成成功、闸门 4 页面可用

## 阶段 1：core 抽取（三路并行）

| 分区 | 子智能体拥有文件 | 原代码行区间 |
|---|---|---|
| A 解析/映射/清洗 | core/parser/*（4 文件）、core/mapping/*（2）、core/clean/values.ts + 对应 .test.ts | 1622–2134、2059–2134、2642–2687、2049–2058 |
| B 知识库/商社/批次 | core/kb/*（5 文件）+ 对应 .test.ts | 386–518、590–688、1079–1621（纯函数部分） |
| C 导出/生成 | core/export/*（4）、core/generate/*（2）+ 对应 .test.ts | 3996–4274（zip/split/命名）、4275–4488（构建器临时直出，注册表阶段 4 再收敛）、2345–2604（generateOutput 纯部分）、2642 起 shangshe-fill |

- 共同约定：函数签名与行为**逐字保真**（仅补类型注解与显式 import/export）；core 禁止 import DOM/localStorage/state；子智能体不跑 dev server
- 主智能体收口：legacy.js 删除已抽取函数 → `import` 新模块并挂 window 桥 → 闸门全跑 → 提交
- 顺序：先 A（parser 是 B/C 测试的输入侧依赖）→ B、C 并行

## 阶段 2：io 抽取（串行，小）

- io/kb-storage.ts、io/kb-transfer.ts、io/save-file.ts；legacy.js 对应段删除；闸门；提交

## 阶段 3：UI 拆分（两批并行）

- 先行（主智能体）：ui/dom.ts（escapeHTML、el()、委托分发器 `delegate(container, 'click', '[data-action]', handler)`）——事件委托模式定调
- 第一批（两个子智能体并行）：
  - D：ui/widgets 侧——search-dropdown.ts、column-filter.ts、preview-table.ts、remark-panel.ts
  - E：ui/steps 侧——kb-panel.ts、upload.ts、mapping.ts、template.ts
- 第二批（主智能体）：steps/export.ts + export/（preview-table/controls/remark-panel 接线，~400 行巨函数按子模块重组）
- main.ts 装配五步骤 init()；删除 window 桥与全部内联 onclick；index.html 骨架瘦身为纯容器
- 验收：闸门全跑 + 6 项手动走查清单（spec 第 8 节）

## 阶段 4：模版注册表收敛（串行）

- templates/registry.ts + yidao/shenbianyun/youyi/custom.ts（`satisfies TemplateDefinition`）；buildWorkbookForTemplate / getExportFileNameForTemplate / 选项面板全部改查注册表；generateOutput 签名纯化收尾
- 验收：闸门全跑 + `grep -rn "=== 'youyi'" src/` 类特判清零（选项渲染等由注册表字段承载）

## 阶段 5：部署收尾（串行）

- build/preview 验证 dist/、删除 template-converter.html 与 legacy 残留、README 重写（挂网使用说明 + 部署方法）、spec/plan 状态更新
- 可选：GitHub Actions 部署 workflow（不阻塞）

## 提交规范

- 每阶段一次提交：`refactor(stage-N): <内容>`；文档类 `docs:`；闸门未过不提交
