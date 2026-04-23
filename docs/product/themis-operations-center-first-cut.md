# Themis 运营中枢 / 当前阶段产品定义与首刀实施

更新时间：2026-04-23（已包含 Asset / Decision / Risk / Cadence / Commitment / OperationEdge / BossView / GraphQuery、机器原生 MCP 协议与第十三刀）

## 结论

- 当前更准确的产品口径是：`数字公司控制面 / 运营中枢`
- `数字公司操作系统` 作为最终形态保留，但不应拿来描述当前实现
- 当前第一优先级不是再造一个更大的“任务系统”，而是把现有执行、协作、治理、知识沉淀收成同一块诚实的控制面
- `Asset / Decision / Risk / Cadence / Commitment` 的最小对象、`OperationEdge` 关系边、自动补边、对象详情反链、一跳 / 二跳影响范围、后端对象图查询入口和 `BossView` 只读老板视图现在已经落地：主 Themis 已有 SQLite 台账、HTTP 接口、Web 录入入口、对象图查询面板和基于事实聚合的经营晨报；`Commitment` 已补进度、里程碑和证据引用
- 运营中枢不是给人类填表使用的任务管理 UI；主使用者是 Themis 与数字员工，人类只需要观测、审计和在异常时紧急刹车
- `themis mcp-server` 现在已经把运营中枢补成机器原生工具面：Themis 可直接创建 / 更新 / 查询运营对象、维护关系边、查询对象图和读取 BossView

## 为什么不是“数字公司操作系统”

现在 Themis 已经有：

- 持久化数字员工、派工、运行边界与治理
- `work item / run / artifact / scheduled task`
- 内部会议室、会议结论、结论提升为正式执行项
- 会话历史、长期记忆候选、本地中文文档工作台

但现在还没有被完整做深的，是更高一层的公司事实：

- `Asset`：现在已补最小台账，并开始作为决策、风险的挂点，但还没接节奏的广泛反链
- `Decision`：现在已补最小记录，但还没接 richer lifecycle、证据链和批量关系视图
- `Risk / Incident`：现在已补最小风险卡，但还没接 richer lifecycle、告警聚合和跨对象联动
- `Cadence`：现在已补最小记录，但还没接自动触发、完成回写和跨对象联动
- `OperationEdge`：现在已补最小关系边，并能从 `Decision / Risk / Cadence / Commitment` 字段自动同步基础边；Web 已能基于 active edges 展开对象的一跳 / 二跳影响范围，后端已能做小深度关系子图查询和可选最短路径；但还没做复杂路径搜索、跨对象筛选和完整对象详情页
- `BossView`：现在已补只读聚合视图，并已消费 `Commitment` 指标和焦点；`blocks` 关系会按对象当前状态过滤，已解决风险 / 已完成承诺不会继续拉红灯，但还没做自动推送、可配置权重和跨 principal / 跨组织总览
- `Commitment`：现在已补公司层承诺对象，并能记录进度百分比、里程碑和证据引用

所以现在如果直接叫“数字公司操作系统”，会把产品说大，但真相源还不够完整。

## 当前阶段定义

### 产品定位

当前主 Themis 应被理解为：

1. 顶层 Themis 的聊天主入口
2. 数字员工执行与协作的控制面
3. 知识沉淀与治理入口

它不是：

1. 完整的公司级对象总表
2. 全量财务 / 增长 / 合规系统
3. 所有平台治理都留在主仓页面里的超级大后台
4. 给人类手工填表、排期和维护状态的传统任务管理系统

### 使用者边界

运营中枢的主入口应该是机器协议，不是人类表单：

1. Themis 在任务推进时自己维护承诺、风险、决策、节奏、资产和关系边
2. managed agent 在执行和交接时把工作项、证据和阻塞关系挂回运营账本
3. 人类通过 Web / BossView / 对象图观察状态、审计事实和理解影响面
4. 真正需要人类动手的，是暂停员工、冻结执行边界、取消调度、终止会议这类紧急刹车动作

### 当前已接通的四层底座

1. `Execution`
   - 真实对象：`work item / run / artifact / scheduled task / resolution`
   - 目标：回答“谁在做、做到哪、证据在哪”
2. `Governance`
   - 真实对象：`managed_agent / execution boundary / waiting / mailbox / handoff`
   - 目标：回答“谁能做、谁卡住了、谁该被治理”
3. `Collaboration`
   - 真实对象：`meeting room / resolution / promote / close`
   - 目标：回答“多人讨论如何收口成正式执行项”
4. `Knowledge`
   - 真实对象：`conversation history / memory candidates / docs / memory`
   - 目标：回答“哪些经验应该沉淀，哪些只是聊天流水”

## 第一批对象模型

### A. Asset

优先级：已完成最小首版

原因：

- 现在很多真实业务问题最后都落到“到底是哪台机器、哪个域名、哪个账号、哪个站点”
- 没有资产对象，任务和证据就很难挂回真实世界

当前已落地字段：

- `assetId`
- `kind`
- `name`
- `status`
- `ownerPrincipalId`
- `summary`
- `tags`
- `refs`
  - 当前先挂 `domain / host / repo / provider resource / doc / url / workspace`

当前已落地入口：

- SQLite：`themis_principal_assets`
- HTTP：`/api/operations/assets/list|create|update`
- Web：设置面板 `运营中枢 -> 资产台账`

### B. Decision

优先级：已完成最小首版

原因：

- 老板拍板现在大量存在聊天里
- 后续接管时最难补的是“为什么这样做”

当前已落地字段：

- `decisionId`
- `title`
- `status`
- `summary`
- `decidedBy`
- `decidedAt`
- `relatedAssetIds`
- `relatedWorkItemIds`

当前已落地入口：

- SQLite：`themis_principal_decisions`
- HTTP：`/api/operations/decisions/list|create|update`
- Web：设置面板 `运营中枢 -> 决策记录`

### C. Risk / Incident

优先级：已完成最小首版

原因：

- 风险和故障现在大多被塞进任务描述或聊天补充
- 没有单独对象，就很难做“当前最危险的三件事”

当前已落地字段：

- `riskId`
- `type`
- `title`
- `severity`
- `status`
- `summary`
- `detectedAt`
- `relatedAssetIds`
- `linkedDecisionIds`
- `ownerPrincipalId`
- `relatedWorkItemIds`

当前已落地入口：

- SQLite：`themis_principal_risks`
- HTTP：`/api/operations/risks/list|create|update`
- Web：设置面板 `运营中枢 -> 风险 / 事故`

### D. Cadence

优先级：已完成最小首版

原因：

- 很多真实业务不是一次性任务，而是重复发生的固定动作
- 只靠单次 `scheduled task` 不够表达长期节奏

当前已落地字段：

- `cadenceId`
- `title`
- `frequency`
- `status`
- `nextRunAt`
- `ownerPrincipalId`
- `relatedAssetIds`
- `playbookRef`
- `summary`

当前已落地入口：

- SQLite：`themis_principal_cadences`
- HTTP：`/api/operations/cadences/list|create|update`
- Web：设置面板 `运营中枢 -> 节奏记录`

### E. Commitment

优先级：已完成最小首版

原因：

- 它更接近公司层目标
- 如果在 `Asset / Decision / Risk / Cadence` 之前做，容易先长成空的 OKR 面板
- 现在前面四类对象和关系边已经落地，可以把承诺挂回真实资产、决策、风险、节奏和执行项，而不是只做愿景卡片

当前已落地字段：

- `commitmentId`
- `title`
- `status`
- `ownerPrincipalId`
- `startsAt`
- `dueAt`
- `progressPercent`
- `summary`
- `milestones`
- `evidenceRefs`
- `relatedAssetIds`
- `linkedDecisionIds`
- `linkedRiskIds`
- `relatedCadenceIds`
- `relatedWorkItemIds`

当前已落地入口：

- SQLite：`themis_principal_commitments`
- HTTP：`/api/operations/commitments/list|create|update`
- Web：设置面板 `运营中枢 -> 承诺目标`
- 自动补边：`Commitment` 保存时会同步基础 `OperationEdge`
- 证据反链：`work_item` 类型证据会同步 `WorkItem -> Commitment` 的 `evidence_for` 自动边
- 老板视图：已把进行中、at_risk 和逾期承诺纳入关键指标与焦点事项

### F. OperationEdge

优先级：已完成最小首版

原因：

- 四类对象已经有了，但只靠各自字段里的 `related*Ids` 难以形成可查询的公司对象图
- 老板视图需要直接消费关系事实，而不是临时解析每个对象里的散字段

当前已落地字段：

- `edgeId`
- `fromObjectType`
- `fromObjectId`
- `toObjectType`
- `toObjectId`
- `relationType`
- `status`
- `label`
- `summary`

当前已落地入口：

- SQLite：`themis_principal_operation_edges`
- HTTP：`/api/operations/edges/list|create|update`
- 图查询 HTTP：`/api/operations/graph/query`
- Web：设置面板 `运营中枢 -> 关系边`
- Web 图查询：设置面板 `运营中枢 -> 对象详情 / 图查询`
- 自动补边：`Decision / Risk / Cadence / Commitment` 保存时会同步基础 `OperationEdge`
- Web 反链：对象卡片会显示已加载 active 关系边的入 / 出摘要
- 后端图查询：基于 active 关系边做小深度 BFS 子图，并在指定目标对象时返回最短路径

### G. BossView

优先级：已完成只读首版

原因：

- 只有对象台账还不够，老板需要直接看到“今天先看什么”
- 老板视图应该消费 `Asset / Decision / Risk / Cadence / Commitment / OperationEdge` 事实，而不是再做一套人工填报表

当前已落地能力：

- 后端：`PrincipalOperationsBossViewService`
- HTTP：`/api/operations/boss-view`
- Web：设置面板 `运营中枢 -> 老板视图`
- 聚合内容：
  - 红黄绿 headline
  - 关键指标
  - 今日焦点
  - 关键关系
  - 近期拍板
- 有效阻塞口径：只有 active `blocks` 且两端对象仍处于未关闭状态时才算当前红灯；`resolved / archived` 风险与 `done / archived` 承诺不会继续制造 BossView 误报

当前明确还没做的，是：

- 老板视图自动推送或日报化
- 指标权重和排序规则可配置
- 跨 principal / 跨组织总览

### H. 对象图查询

优先级：已完成只读首版

原因：

- 对象卡片的一跳 / 二跳影响范围只能消费当前前端已加载的关系边
- 后续真正做对象详情页时，需要一个后端统一入口来回答“从这个对象出发能触达哪些事实”
- 这一步必须继续复用 `OperationEdge`，不能产生第二套关系真相源

当前已落地能力：

- 后端：`PrincipalOperationEdgesService.queryGraph`
- HTTP：`/api/operations/graph/query`
- Web：设置面板 `运营中枢 -> 对象详情 / 图查询`
- 查询输入：根对象类型 / id、可选目标对象类型 / id、最大深度
- 查询输出：节点、关系边、目标可达性，以及可选最短路径

当前明确还没做的，是：

- 独立对象详情路由和对象完整资料面板
- 复杂路径搜索、多条件过滤和跨对象全文搜索
- 跨 principal / 跨组织关系图

### I. 机器原生 MCP 协议

优先级：已完成首版

原因：

- 运营中枢本身是给 Themis 和数字公司员工使用的执行基建，不应依赖人类在 Web 表单里补事实
- 如果只有 HTTP / Web，Themis 知道“有这个系统”，但不能可靠地自己维护运营账本
- 机器协议必须和自动批准白名单一起落地，否则内部工具会被误判成人类审批等待

当前已落地能力：

- MCP 对象工具：
  - `list_operation_objects`
  - `create_operation_object`
  - `update_operation_object`
- MCP 关系工具：
  - `list_operation_edges`
  - `create_operation_edge`
  - `update_operation_edge`
- MCP 观测工具：
  - `query_operation_graph`
  - `get_operations_boss_view`
- Runtime prompt 已注入运营中枢使用规则，明确这是 `machine-native operating ledger`
- AppServerTaskRuntime 已把这些 Themis 内部 operations MCP 工具纳入自动批准白名单，不再生成 `task.action_required`

当前明确还没做的，是：

- 独立 emergency-brake 总开关面板
- 运营中枢对象变更的更细审计流
- managed agent 自动执行结束后按规则回写 Commitment / Risk / Evidence 的策略层

## 首刀 UI 范围

本轮只做主 Themis 里最诚实的一刀：

1. 在 Web 设置面板新增 `运营中枢` 入口
2. 明确展示：
   - 当前阶段定位
   - 当前已接通的事实底座
   - 第一批对象模型
   - 当前实例快照
3. 提供从 `运营中枢` 跳到：
   - `内部会议室`
   - `记忆候选`
   - `运行参数`
   - `模式切换`

## 首刀明确不做

- 不新增后端 schema
- 不伪造“资产 / 风险 / 决策 / 节奏已经上线”
- 不把主 Themis 再膨胀成新的平台治理后台
- 不做大而全的老板总览屏

## 第二刀：Asset 最小对象

在首刀 UI 之后，已经继续补上 `Asset` 的最小闭环：

1. SQLite 新增 `themis_principal_assets`
2. 主 runtime 新增 `PrincipalAssetsService`
3. HTTP 新增 `/api/operations/assets/list|create|update`
4. Web `运营中枢` 新增 `资产台账` 区块
5. 运营中枢首页快照会显示当前资产台账状态

这一步的目标不是一次把“公司资产系统”做完，而是先让域名、站点、服务器、数据库、账号、工作区这些对象能被稳定记住、查看和更新。

当前明确还没做的，是：

- 从 `Asset / Decision / Risk / Incident / Cadence` 已有字段自动补边
- 基于资产的老板总览、告警聚合和节奏看板
- 跨 principal / 跨组织的更复杂所有权模型

## 第三刀：Decision 最小对象

在 `Asset` 之后，已经继续补上 `Decision` 的最小闭环：

1. SQLite 新增 `themis_principal_decisions`
2. 主 runtime 新增 `PrincipalDecisionsService`
3. HTTP 新增 `/api/operations/decisions/list|create|update`
4. Web `运营中枢` 新增 `决策记录` 区块
5. 运营中枢首页快照会显示当前决策记录状态

这一步的目标也不是一次做完“公司决策系统”，而是先让关键拍板、决定人、决定时间，以及和 `asset / work item` 的最小关联稳定留下来。

当前明确还没做的，是：

- 决策的 richer lifecycle，比如 `proposed / approved / rejected`
- 决策背后的证据、附件、会议纪要和更强反链
- 决策、风险、节奏之间的二阶关系图

## 第四刀：Risk / Incident 最小对象

在 `Decision` 之后，已经继续补上 `Risk / Incident` 的最小闭环：

1. SQLite 新增 `themis_principal_risks`
2. 主 runtime 新增 `PrincipalRisksService`
3. HTTP 新增 `/api/operations/risks/list|create|update`
4. Web `运营中枢` 新增 `风险 / 事故` 区块
5. 运营中枢首页快照会显示当前风险记录状态

这一步的目标也不是一次做完“公司风险系统”，而是先让异常、故障、权限风险、合规风险这些高危险事项能被独立记录，并且先挂回 `asset / decision / work item`。

当前明确还没做的，是：

- 风险的 richer lifecycle，比如 `accepted / mitigating / escalated`
- 自动告警接入、聚合视图和老板危险榜
- 风险、节奏、承诺之间的联动规则

## 第五刀：Cadence 最小对象

在 `Risk / Incident` 之后，已经继续补上 `Cadence` 的最小闭环：

1. SQLite 新增 `themis_principal_cadences`
2. 主 runtime 新增 `PrincipalCadencesService`
3. HTTP 新增 `/api/operations/cadences/list|create|update`
4. Web `运营中枢` 新增 `节奏记录` 区块
5. 运营中枢首页快照会显示当前节奏记录状态

这一步的目标也不是一次做完“公司节奏系统”，而是先让周检、续费、备份抽查、账单复盘这类固定动作有独立对象，并且先挂回 `asset / playbook`。

当前明确还没做的，是：

- 节奏和真实 `scheduled task`、完成回写之间的自动联动
- 节奏执行历史、负责人交接和逾期提醒
- 节奏、风险、承诺之间的联动规则

## 第六刀：OperationEdge 最小关系边

在 `Cadence` 之后，已经继续补上 `OperationEdge` 的最小闭环：

1. SQLite 新增 `themis_principal_operation_edges`
2. 主 runtime 新增 `PrincipalOperationEdgesService`
3. HTTP 新增 `/api/operations/edges/list|create|update`
4. Web `运营中枢` 新增 `关系边` 区块
5. 运营中枢首页快照会显示当前关系边状态

这一步的目标不是一次做完整图数据库，而是先让 `asset / decision / risk / cadence / work_item` 之间的事实关系能被独立维护，并为老板视图提供一层可直接消费的关系事实。

当前明确还没做的，是：

- 复杂路径搜索、跨对象搜索入口和完整对象详情页

## 第七刀：BossView 只读老板视图

在 `OperationEdge` 之后，已经继续补上 `BossView` 的只读首版：

1. 主 runtime 新增 `PrincipalOperationsBossViewService`
2. HTTP 新增 `/api/operations/boss-view`
3. Web `运营中枢` 新增 `老板视图` 区块
4. 运营中枢首页快照会显示老板视图状态

这一步的目标不是做一个新的可编辑总表，而是先把已有 `Asset / Decision / Risk / Cadence / Commitment / OperationEdge` 事实聚合成老板能直接消费的经营晨报：红黄绿状态、关键指标、今日焦点、关键关系和近期拍板。

当前明确还没做的，是：

- 自动推送日报或飞书主动提醒
- 指标权重、焦点排序和过滤规则的可配置化
- 跨 principal / 跨组织的老板总览

## 第八刀：自动补边与对象反链

在 `BossView` 之后，已经继续补上自动补边与对象卡片反链：

1. `PrincipalOperationEdgesService` 新增 `syncGeneratedEdgesForObject`
2. `Decision / Risk / Cadence / Commitment` 保存时会自动同步基础关系边
3. 自动边使用确定性 id，重复保存会幂等更新
4. 当对象关联字段变更或对象归档时，过期自动边会转为 `archived`
5. Web 对象卡片会基于已加载 active edges 显示入 / 出反链摘要

当前自动规则先保持克制：

- `Decision -> Asset / WorkItem`：`relates_to`
- `Risk -> Asset`：`relates_to`
- `Decision -> Risk`：`mitigates`
- `WorkItem -> Risk`：`tracks`
- `Cadence -> Asset`：`tracks`
- `Commitment -> Asset`：`relates_to`
- `Commitment -> Decision / WorkItem`：`depends_on`
- `Risk -> Commitment`：未收口风险阻塞未完成承诺时用 `blocks`；已解决风险或已完成承诺只保留 `relates_to`
- `Cadence -> Commitment`：`tracks`

这一步的目标不是做完整图查询，而是先让对象字段不再只是散字段：它们会变成可维护、可聚合、可被老板视图消费的关系事实。

当前明确还没做的，是：

- 独立对象详情页
- 复杂路径搜索和跨对象筛选
- 自动补边规则的可配置化

## 第九刀：Commitment 公司层对象

在自动补边和对象反链之后，已经继续补上 `Commitment` 的最小闭环：

1. SQLite 新增 `themis_principal_commitments`
2. 主 runtime 新增 `PrincipalCommitmentsService`
3. HTTP 新增 `/api/operations/commitments/list|create|update`
4. Web `运营中枢` 新增 `承诺目标` 区块
5. 运营中枢首页快照会显示当前承诺目标状态
6. `OperationEdge` 的对象类型新增 `commitment`
7. `BossView` 会把承诺目标纳入指标和焦点事项

这一步的目标不是做完整 OKR 系统，而是先让季度主线、阶段承诺和必须完成的公司级目标成为一等事实，并且能挂回 `asset / decision / risk / cadence / work item`。

当前自动规则先保持克制：

- `Commitment -> Asset`：`relates_to`
- `Commitment -> Decision`：`depends_on`
- `Risk -> Commitment`：未收口风险阻塞未完成承诺时用 `blocks`；已解决风险或已完成承诺只保留 `relates_to`
- `Cadence -> Commitment`：`tracks`
- `Commitment -> WorkItem`：`depends_on`

这一刀完成后仍明确没做的，是：

- 负责人交接流程
- 承诺和会议结论之间的自动关联
- 承诺维度的独立详情页、复杂路径搜索和日报推送

## 第十刀：Commitment 兑现追踪与对象详情反链

在 `Commitment` 成为一等对象之后，已经继续补上“兑现追踪”这一层：

1. `themis_principal_commitments` 升级到 schema 40，新增 `progress_percent / milestones_json / evidence_refs_json`
2. `PrincipalCommitmentsService` 已支持 `progressPercent / milestones / evidenceRefs`
3. HTTP `/api/operations/commitments/list|create|update` 已透传并规范化这些字段
4. Web `承诺目标` 编辑区新增进度、里程碑和证据引用输入
5. 承诺卡片新增进度条、里程碑摘要、证据摘要和对象详情反链块
6. `work_item` 类型证据会生成 `WorkItem -> Commitment` 的 `evidence_for` 自动边

这一步的目标仍不是做完整 OKR，也不是做独立详情页；它先解决一个更基础的问题：承诺不能只停在“说了什么”，还要能看出“做到哪一步、卡在哪个里程碑、有哪些执行证据支撑”。

当前里程碑和证据仍保持轻量：

- 里程碑字段：`title / status / dueAt / completedAt / summary / evidenceRefs`
- 证据字段：`kind / value / label / capturedAt`
- 当前只有 `kind = work_item` 的证据会进入自动补边
- 对象详情反链仍复用对象卡片，不另起详情页

## 第十一刀：对象影响范围展开

在对象详情反链之后，已经继续补上基于关系边的一跳 / 二跳影响范围：

1. Web 对象卡片会基于已加载 active `OperationEdge` 即时推导影响面
2. `Asset / Decision / Risk / Cadence / Commitment` 都已展示同一套影响范围块
3. 一跳展示与当前对象直接相连的对象、方向、关系类型和关系标签
4. 二跳展示经由一跳对象继续扩散到的对象，以及中间对象和关系来源
5. 展示层限制样本数量，避免关系多时把对象卡片撑爆

这一步仍不新建表，也不新增后端图查询接口。它只是让当前已有关系事实在对象卡片里多看一层：从“这个对象和谁直接有关”推进到“这个对象可能影响到哪里”。

当前边界：

- 只使用当前前端已经加载到的 active 关系边
- 不做跨页懒加载、路径搜索和多跳图算法
- 不把影响范围写回数据库
- 不把 `work_item` 做成独立对象详情页，只在影响范围里作为节点展示

## 第十二刀：对象详情 / 后端图查询入口

在对象卡片影响范围之后，已经继续补上只读后端图查询入口：

1. `PrincipalOperationEdgesService` 新增 `queryGraph`
2. HTTP 新增 `/api/operations/graph/query`
3. Web `运营中枢` 新增 `对象详情 / 图查询` 区块
4. 查询输入支持根对象类型 / id、可选目标对象类型 / id、最大深度
5. 查询结果展示子图摘要、节点、关系边和目标最短路径
6. 运营中枢首页快照会显示最近一次对象图查询状态

这一步仍不新建表，也不写回数据库。它把第十一刀的前端即时影响范围，推进成后端统一查询入口：当前只读 active `OperationEdge`，用小深度 BFS 返回关系子图；指定目标对象时，再给出当前深度内的最短路径。

当前边界：

- 默认只读 active 关系边，不把 archived 边混进 Web 首版查询
- 最大深度限制在 1 到 4，避免首版直接退化成大图扫描
- 只做 relation graph，不拉取每个对象的完整资料详情
- 不做复杂路径搜索、跨对象全文搜索、路径过滤和跨 principal / 跨组织关系图

## 当前实现边界

首刀 UI 的“当前实例快照”只允许引用已经存在的事实：

- 当前活跃会话和本机会话池
- 当前执行工作区与接入方式
- 内部会议室入口状态
- 长期记忆候选状态
- 当前老板视图、资产台账、节奏记录、承诺目标、承诺进度/里程碑/证据、决策记录、风险记录、关系边状态、对象一跳 / 二跳影响范围与对象图查询结果

这轮不额外发明假数据，也不把历史规划稿伪装成当前产品能力。

## 下一步

如果继续推进，推荐顺序是：

1. 先把对象图查询升级成完整对象详情页和跨对象搜索 / 路径过滤
2. 再补承诺和会议结论、执行 run / artifact 之间的自动证据关联
3. 最后再做老板视图的日报推送、权重配置和跨组织总览

一句话收口：

**先把 Themis 做成诚实的数字公司控制面，再让它长成数字公司操作系统。**
