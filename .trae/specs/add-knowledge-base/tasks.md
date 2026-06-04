# Tasks

- [x] Task 1: 知识库数据结构与持久化层
  - [x] 1.1: 定义知识库数据结构（商社列表、任务列表、配置表数据、签约主体-平台映射表）
  - [x] 1.2: 实现 localStorage 读写函数（loadKB / saveKB / clearKB）
  - [x] 1.3: 实现 JSON 文件导出/导入函数（exportKBToJSON / importKBFromJSON）
  - [x] 1.4: 实现知识库合并逻辑（按商社编号去重合并）

- [x] Task 2: 知识库管理界面
  - [x] 2.1: 在页面顶部新增知识库管理卡片（状态显示 + 上传/导出/导入/清空按钮）
  - [x] 2.2: 实现上传知识库 Excel 文件的解析逻辑（提取商社编号、简称、全称、签约费率、签约主体、任务名称、服务内容）
  - [x] 2.3: 实现知识库状态显示（商社数量、任务数量、最后更新时间）
  - [x] 2.4: 实现导出备份 JSON 和导入备份 JSON 的交互

- [x] Task 3: 商社编号列识别
  - [x] 3.1: 在 COL_KEYWORDS 中新增 shangSheId 关键词匹配
  - [x] 3.2: 在 COL_TYPE_LABELS 中新增商社编号标签
  - [x] 3.3: 在云杉模板 fieldMap 中关联商社编号字段

- [x] Task 4: 云杉模板自动填充逻辑
  - [x] 4.1: 实现签约主体到平台的映射函数（含模糊匹配）
  - [x] 4.2: 实现商社编号查知识库函数（返回平台、税源地、任务清单、工种）
  - [x] 4.3: 修改 generateOutput 函数，云杉模板生成时调用自动填充逻辑
  - [x] 4.4: 匹配失败的行在预览中橙色高亮提示

- [x] Task 5: 动态生成配置表和任务清单
  - [x] 5.1: 实现从知识库生成配置表数据（税源地+平台列表）
  - [x] 5.2: 实现从知识库生成任务清单数据（序号.任务名(商社编号)格式）
  - [x] 5.3: 修改 exportYouyi 函数，使用动态生成的配置表和任务清单

- [x] Task 6: 导出时自动附带知识库备份
  - [x] 6.1: 修改 exportYouyi，在知识库非空时同时下载 JSON 备份文件

# Task Dependencies
- Task 2 depends on Task 1
- Task 4 depends on Task 1, Task 3
- Task 5 depends on Task 1
- Task 6 depends on Task 1, Task 5
