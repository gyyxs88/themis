# Themis 持久化合伙人 / 数字员工架构设计

更新时间：2026-04-12 12:05 CST

补充说明：

- 本文主要描述“当前 Themis 内部的持久化数字员工架构”和其设计边界。
- 如果后续要把这套能力继续上收成“局域网统一控制面 + 多入口 Themis + 多执行节点”的公司级平台，另见：[Themis 局域网多节点硅基员工平台方案（V1 草案）](./themis-silicon-employee-platform-v1.md)。
- 路线与阶段计划见：[分阶段落地计划](./themis-silicon-employee-platform-roadmap-plan.md)、[Phase 1 控制面底座实施计划](./themis-silicon-employee-platform-phase-1-control-plane-plan.md)、[Phase 2 节点模型与调度租约实施计划](./themis-silicon-employee-platform-phase-2-node-model-plan.md)。

## 0. 当前实现快照

- `P3 / 持久化 agent / 自动创建与治理` 已整体收口，自动创建、护栏、审计、bootstrap onboarding、idle recovery 都已接进主链路。
- `P4 / 持久化 agent / 协作与交接` 已整体收口：
  - `handoff` 已从单纯的 `messageType` 升级成独立持久化实体，SQLite 已落表 `themis_agent_handoffs`
  - `ManagedAgentCoordinationService` / `ManagedAgentExecutionService` 已生成并查询 handoff 记录与最小时间线
  - HTTP 已新增 `POST /api/agents/handoffs/list`
  - Web `Agents` 面板已新增 `Handoffs & Timeline` 视图
  - `work item detail` 已新增 `parentWorkItem / parentTargetAgent / childSummary / childWorkItems`
  - 当前父任务下派 agent 子任务时会自动补上 `parentWorkItemId`
  - Web `Agents` 详情面板已能直接渲染“父任务”和“下游协作汇总”
- `P6 / manager 治理面` 已完成两轮收口：
  - 第一轮已落成“组织级跨父任务汇总台”，`ManagedAgentCoordinationService` 已新增 `listOrganizationCollaborationDashboard(...)`
  - 第二轮已落成“组织级治理工作台”，新增 `getOrganizationGovernanceOverview(...)`、共享筛选模型，以及治理摘要条 / manager 热点 / 总览层治理动作
  - 第一版 `attentionLevel / attentionReasons / lastActivity*` 规则已固定为可解释规则
  - HTTP 已新增 `POST /api/agents/governance-overview` 与增强版 `POST /api/agents/collaboration-dashboard`
  - Web `Agents` 面板现已同时具备“治理摘要 + 共享筛选 + waiting queue + 跨父任务汇总台”的完整工作台形态
- `P5 / 持久化 agent / 运行边界与执行` 现已完成：
  - 每个长期 agent 都会持久化自己的默认 `workspace policy` 与 `runtime profile`
  - legacy agent 在 `create / list / detail` 链路也会自动补齐默认执行边界
  - 新派工默认继承 `workspacePolicySnapshot / runtimeProfileSnapshot`
  - 执行时会校验工作区、写入 session workspace、合并附加目录、收紧网络开关
  - `AppServerTaskRuntime` 已按 `auth / third-party provider` 隔离 session env 与 CLI config
  - 边界非法时，run 会以 `MANAGED_AGENT_EXECUTION_BOUNDARY_INVALID` 失败收口，并降级非 bootstrap agent
  - HTTP 已新增 `POST /api/agents/execution-boundary/update`
  - Web `Agents` 面板已新增默认执行边界治理区
- “更强物理隔离首刀” 也已完成：
  - 长期 agent 执行时会使用 `infra/local/managed-agents/<agentId>/codex-home` 作为独立 `CODEX_HOME`
  - auth 模式会从认证账号 home 复制 `auth.json`，并复用技能目录
  - third-party 模式也会使用 agent 独立 home
  - 这意味着 app-server 的运行态、配置和本地历史现在已经按 agent 物理拆开
- 当前下一步优先项：当前没有新的默认优先项。远端 websocket `app-server` 节点方向已经完成评估，但目前暂缓；只有在出现共享执行节点、跨机器工作区或长任务托管需求时，才重新把它拉回主线，而不是回头重复补已经收口的 manager 治理面、执行边界或本地物理隔离首刀。

## 0.1 术语速记

- `Codex subagent`
  - 指 Codex 原生的一次任务内短生命周期执行主体。
  - 不自带 Themis 这套长期组织、治理、持久化身份和工作队列语义。
- `actor`
  - 指 Themis 当前较轻的一层内部协作 / 记忆模型。
  - 主要承载数字员工档案、task scope、runtime memory、timeline / takeover 摘要，以及长期记忆候选流。
  - 它适合表达“某个任务里的员工视角”和“接管现场”，但不是完整长期工作主体。
- `managed_agent`
  - 指 Themis 当前真正的持久化数字员工主体。
  - 它有独立 `principal` 身份、长期默认配置、工作队列、治理动作、运行边界和执行历史。
  - 用户在 Web `Agents` 面板里真正管理的，是这一层。

一句话区分：

- `actor` 更像任务内的数字员工视角和记忆基座。
- `managed_agent` 才是长期存在、可治理的数字员工。
- 两者都不是 Codex 原生产品能力，而是 Themis 在 `codex app-server` 之上补出的扩展层。

## 1. 设计目标

这份文档要解决的不是“在一次 Codex 任务里临时拉几个 subagent”，而是下面这件事：

- Themis 作为公司的长期合伙人，能在判断有必要时创建新的持久化数字员工。
- 新数字员工是“另一个 Themis”，不是一次任务里的临时子进程，也不是 Codex 内置的短生命周期 subagent。
- 新数字员工可以长期存在、独立运作、被暂停/恢复/归档、被接管、被复盘。
- 数字员工可以按职能存在，例如运维、后端、前端、营销、内容、招聘、法务支持等。
- 数字员工不止能创建一个，也可以按业务需要创建多个同类员工。
- 如果用户没有指定名字，Themis 自己负责命名，并保证名称可读、稳定、不冲突。
- 除最高层组织级 Themis 外，其余 agent 默认不直接和人类对话，而是通过受控的 agent 间通信链路协作。

这份设计默认把“另一个 Themis”解释为：

- 逻辑上是独立工作主体；
- 有自己的长期画像、长期记忆、默认任务配置、技能集合、工作队列和运行历史；
- 但在第一阶段不要求它一定是单独部署的物理服务进程。

也就是说，第一阶段优先做“逻辑独立”，不是一上来做“每个 agent 都是独立 Node 进程或独立机器”。

这里还包含一个明确产品边界：

- 人类默认只和组织级入口 Themis 交互；
- 子 agent 默认只和其他 agent 或系统组件交互；
- 人类查看/接管某个子 agent，是治理动作，不等于该子 agent 本身成为公开聊天对象。

## 2. 当前实现与根本缺口

当前仓库已经有一批可复用地基，但还不是你要的“持久化另一个 Themis”：

- 现有 `principal` 已有长期画像、默认任务配置、技能、会话、历史等持久化能力。
- 现有 `actor memory v1` 已有 actor、task scope、runtime memory、takeover 摘要等基础模型。
- 现有 `AppServerTaskRuntime` 已有 `sessionFactory` 扩展点，后续可以换成本地或远端执行会话。
- 现有 Web / 飞书 / CLI / diagnostics / history 基础壳层已经成型。

但当前缺口是结构性的：

- 现有 `actor` 只是“数字员工档案 + 派工包 + 运行期草稿 + 接管摘要”，不是独立长期工作主体。
- 现有 actor 不是独立主记忆主体，无法承载“另一个 Themis”的长期人格和长期职责。
- 当前没有 agent 调度器、没有持久化工作队列、没有 agent 生命周期状态机、没有自主创建闭环。
- 当前没有“父 Themis 给子 Themis 派工后自动启动执行”的产品链路。
- 当前没有“多个持久化 agent 并行工作，再由上级 agent 汇总”的运行链路。

结论很直接：

- 不能在现有 `actor memory v1` 上只补几个字段就硬说它是“另一个 Themis”。
- 推荐做法是：把“持久化数字员工”定义成新的一级运行主体，而不是继续把它塞在当前 actor 边界里。

## 3. 推荐总方案

推荐采用两层主体模型：

1. `Organization`：公司或团队边界
2. `Managed Principal`：被 Themis 托管的长期工作主体

在这个模型里：

- 公司级 Themis 合伙人是一个特殊的 `Managed Principal`
- 运维 Themis、后端 Themis、前端 Themis、营销 Themis 也是各自独立的 `Managed Principal`
- 组织级 Themis 是默认唯一的 `human-facing` 主体
- 其他 `managed_agent` 默认是 `agent-facing` 主体
- 人类用户不是这些 agent 本身，而是可以和组织级 Themis 交互的外部操作者

因此，推荐把“新的 agent”实现成：

- 不是旧 `actor`
- 而是 `principal` 体系里的新类型：`principal.kind = managed_agent`

这样做的原因很硬：

- `principal` 已经天然具备长期画像、默认配置、技能、会话、历史、跨渠道身份这些长期主体特征
- 这和“另一个 Themis”高度一致
- 如果继续把 agent 做成 actor，会不断重复发明“actor 版 persona / actor 版 skills / actor 版 defaults / actor 版 sessions”，最后模型会裂开

## 4. 设计原则

### 4.1 逻辑独立优先于物理独立

第一阶段要求：

- 独立身份
- 独立记忆
- 独立任务队列
- 独立运行状态
- 独立可接管

第一阶段不要求：

- 每个 agent 都是独立进程
- 每个 agent 都是独立机器

如果后续真要做物理隔离，再沿现有 `sessionFactory` 和远端 websocket `app-server` 方向扩展。

### 4.2 公司记忆、agent 记忆、任务草稿严格分层

不能再延续“所有 agent 共用一个大记忆池”的思路。

必须拆成至少四层：

- 组织级长期记忆
- agent 级长期记忆
- 任务级运行期记忆
- 交接快照与审计记录

### 4.3 创建 agent 是显式架构动作，不是随手 fork 线程

`thread/fork`、`review/start`、`turn/steer` 仍然有用，但它们只解决单线程任务控制，不解决长期主体管理。

“创建另一个 Themis”必须是：

- 新主体建档
- 新默认配置
- 新技能视图
- 新任务队列
- 新运行历史

而不是“fork 一条 thread 就算新 agent”。

### 4.4 默认允许自治，但必须有预算和护栏

如果允许 Themis 自己不断创建更多 Themis，很容易失控。

因此自治能力必须带这些护栏：

- 组织级最大活跃 agent 数
- 同角色最大并发数
- 自动创建前的理由记录
- 空闲回收策略
- 预算上限
- 需要人工审批的危险动作边界

### 4.5 产品面先做管理闭环，再做花哨协作

先做：

- agent 列表
- 状态
- 队列
- 任务
- 日志
- 接管
- 暂停/恢复

后做：

- 复杂卡片
- 多层组织树
- 复杂 KPI 仪表盘

### 4.6 默认单入口对人，子 agent 只对 agent

这条是你刚澄清后必须写进架构硬约束的一条原则。

默认规则：

- 人类请求只进入组织级入口 Themis
- 子 agent 不直接暴露独立聊天窗口
- 子 agent 需要更多信息时，先向上级 agent 或组织级入口发起结构化请求
- 子 agent 需要人类审批时，发的是升级请求，不是直接开口和人类聊天

例外只允许两类：

- 管理员接管
- 明确标记为 `direct_human_exception` 的少数外联型 agent

即使存在例外，也应该是显式配置，不是默认行为。

### 4.7 agent 间通信必须“带目的、带对象、带审计”

不允许把 agent 间协作设计成无限制自由群聊。

至少要满足：

- 每条通信都能落到 `workItem`、`run` 或治理事件
- 每条通信都知道 `from`、`to`、`type`、`reason`
- 每次升级、交接、审批请求都能追溯
- 默认只共享必要上下文，不共享完整私有草稿

## 5. 领域模型

### 5.1 Organization

新增 `organization` 作为公司级边界。

职责：

- 容纳一组人类用户和一组托管 agent
- 管理组织级记忆、权限、预算、工作区边界
- 提供“公司的合伙人 Themis”这一默认入口

为什么必须有它：

- 如果没有组织层，当前所有长期状态都会继续绑在人类 `principalId` 上
- 那样一旦换 owner、多人协作、共享数字员工、权限分层，模型会立刻出问题

### 5.2 Principal

把当前 `principal` 扩成多类型主体：

- `human_user`
- `managed_agent`
- `system`

其中：

- `human_user`：真实员工/管理员/owner
- `managed_agent`：持久化数字员工，也就是“另一个 Themis”
- `system`：内部探针、定时器、迁移器等系统主体

### 5.3 AgentProfile

`managed_agent` 需要单独的扩展资料：

- `agentId`
- `principalId`
- `organizationId`
- `displayName`
- `slug`
- `aliases`
- `departmentRole`
- `mission`
- `status`
- `autonomyLevel`
- `creationMode = manual | auto`
- `createdByPrincipalId`
- `supervisorAgentId`
- `defaultWorkspacePolicyId`
- `defaultRuntimeProfileId`
- `spawnPolicyId`
- `exposurePolicy = gateway_only | admin_takeover_only | direct_human_exception`
- `communicationPolicyId`
- `agentCardVersion`

这里的关键不是“多一张表”，而是明确：

- 名字是 agent 自身资产，不再只是 actor 的展示字段
- 每个 agent 都有“使命”和“职责边界”，不是只有一个 role 枚举
- 默认只有组织级 Themis 对人，子 agent 的默认暴露策略应是 `gateway_only`

### 5.4 AgentRelationship

需要显式保存 agent 之间的关系：

- 谁监督谁
- 谁属于哪个组织
- 谁能给谁派工
- 谁能读取谁的交接结果

至少支持：

- `reports_to`
- `collaborates_with`
- `owns_domain`
- `shadow_of`

### 5.5 WorkItem

持久化任务单元，不再直接等同于一次聊天输入。

字段至少包括：

- `workItemId`
- `organizationId`
- `targetAgentId`
- `sourceType = human | agent | system`
- `sourcePrincipalId`
- `parentWorkItemId`
- `dispatchReason`
- `goal`
- `contextPacket`
- `priority`
- `status`
- `workspacePolicySnapshot`
- `runtimeProfileSnapshot`
- `createdAt`
- `scheduledAt`
- `startedAt`
- `completedAt`

### 5.6 AgentRun

一次真正的运行实例，和 `WorkItem` 不是一回事。

一个 `WorkItem` 可能有多次 `AgentRun`：

- 第一次执行失败后重试
- 被人工接管后继续
- 换 runtime 后恢复

字段建议：

- `runId`
- `workItemId`
- `agentId`
- `runtimeEngine`
- `runtimeTarget`
- `sessionId`
- `threadId`
- `status`
- `attempt`
- `startedAt`
- `endedAt`
- `failureCode`
- `failureSummary`

### 5.7 Handoff

交接不是 runtime memory 的副产品，而是显式一等对象。

字段建议：

- `handoffId`
- `fromAgentId`
- `toAgentId`
- `workItemId`
- `summary`
- `blockers`
- `recommendedNextActions`
- `attachedArtifacts`
- `createdAt`

### 5.8 AgentCard

每个 `managed_agent` 需要一张内部能力卡，供组织级入口和其他 agent 判断“这个 agent 能不能接这个活”。

这里建议借 A2A 的 `Agent Card` 思路，但第一阶段先做组织内部版本，不急着变成公网协议。

字段建议：

- `agentId`
- `displayName`
- `mission`
- `skillsSummary`
- `acceptedWorkTypes`
- `acceptedArtifactTypes`
- `approvalBoundaries`
- `workspaceSummary`
- `runtimeSummary`
- `supervisorAgentId`
- `exposurePolicy`
- `version`

关键点：

- `AgentCard` 是“如何和它协作”的契约，不是宣传文案
- 其他 agent 读卡片，不等于能读它全部记忆
- 第一阶段通过内部 `Agent Registry` 查询卡片即可，不要求一开始就做 HTTP discovery

### 5.9 AgentMessage

agent 间通信不走自由文本聊天模型，而走结构化消息信封。

字段建议：

- `messageId`
- `organizationId`
- `fromAgentId`
- `toAgentId`
- `workItemId`
- `runId`
- `parentMessageId`
- `messageType`
- `payload`
- `artifactRefs`
- `priority`
- `requiresAck`
- `createdAt`

`messageType` 至少支持：

- `dispatch`
- `status_update`
- `question`
- `answer`
- `handoff`
- `escalation`
- `approval_request`
- `approval_result`
- `artifact_offer`
- `cancel`

### 5.10 AgentMailbox

每个 agent 都需要内部信箱，而不是直接彼此读写对方 thread。

职责：

- 收取待处理消息
- 对消息做 ack / lease / retry
- 处理幂等和去重
- 支持按 `workItem` 和 `priority` 拉取

这层是后续接远端 agent 节点时最值钱的抽象之一。

## 6. 推荐运行拓扑

```text
人类用户 / Web / 飞书
        |
        v
组织级入口 Themis（唯一默认对人）
        |
        +--> Agent Planner
        |        |
        |        +--> 复用已有 agent
        |        |
        |        +--> 自动创建新 agent
        |
        +--> Dispatch & Communication Center
                 |
                 +--> Agent Registry / Agent Cards
                 +--> Work Queue
                 +--> Agent Mailboxes
                 +--> Policy Router
                 +--> Agent Scheduler
                 +--> Run Controller
                 +--> Handoff Summarizer
                 +--> Audit / Memory Services
```

### 6.1 Organization Gateway

组织级入口负责：

- 作为默认唯一的人类对话入口
- 接收人类输入
- 识别当前对话属于哪个组织
- 判断是自己处理还是转给已有 agent
- 决定是否创建新 agent
- 接收子 agent 的升级请求与审批请求
- 把内部结构化消息转换成人类可理解的卡片或摘要
- 再把人类决定回写成内部消息

### 6.2 Agent Planner

这是“会不会新建 agent”的决策器。

职责：

- 识别任务是否跨职能或长期化
- 判断现有 agent 是否覆盖该职责
- 需要时生成新 agent 的职责草案、名字草案、默认配置草案

输出不是直接执行，而是：

- `plan = handle_self | delegate_existing | create_and_delegate`

### 6.3 Dispatch & Communication Center

统一派工和通信中枢。

职责：

- 创建 `WorkItem`
- 绑定目标 agent
- 注入上下文包
- 处理优先级、依赖、父子任务关系
- 路由 agent 间消息
- 校验通信权限与升级边界
- 维护 inbox / outbox / ack / retry
- 区分任务、状态、交接、审批、升级这几类通信

### 6.4 Agent Scheduler

后台调度器负责让持久化 agent 真正“活起来”。

职责：

- 拉取待执行任务
- 判断 agent 当前是否可运行
- 控制并行度
- 恢复中断任务
- 处理定时任务和空闲唤醒

这是“独立运作”的关键模块。没有它，agent 仍只是静态档案。

### 6.5 Run Controller

它把一个 `WorkItem` 变成真实执行。

职责：

- 创建或恢复 agent 自己的会话
- 选择 runtime
- 绑定工作区
- 订阅事件
- 收口结果
- 生成 handoff 和审计事实

第一阶段直接复用现有 `AppServerTaskRuntime` / `CodexTaskRuntime`。

## 7. 为什么不推荐直接把现有 actor 升级成持久化 agent

不推荐方案：

- 在 `themis_principal_actors` 上继续加字段
- 再给 actor 补 persona、skills、defaults、sessions、history
- 试图让 actor 兼任“临时派工对象”和“长期独立主体”

问题：

- 会和当前 `principal` 职责严重重叠
- 会产生两套长期画像、两套默认配置、两套技能管理、两套会话体系
- 未来 Web / 飞书 / diagnostics 会同时面对两种“主体”模型，复杂度会失控

推荐方案：

- `managed_agent` 直接成为 `principal` 的一种
- 现有 actor 模型保留为更轻量的内部草稿/派工/运行期记忆层，或者在后续逐步弱化

一句话：

- “另一个 Themis”应该是 `managed principal`
- 不是“打了补丁的 actor”

## 8. agent 创建流程

### 8.1 手动创建

用户明确说：

- 创建一个运维 Themis
- 创建两个前端 Themis
- 创建一个营销 Themis，名字你来取

流程：

1. 组织级入口解析需求
2. 校验组织预算和数量上限
3. 生成或接收 agent 名称
4. 创建 `managed_agent principal`
5. 初始化画像、默认配置、默认工作区策略、默认技能视图
6. 创建默认会话和欢迎任务
7. 返回新 agent 卡片

### 8.2 自动创建

当合伙人 Themis 判断任务已经长期化时，允许自动创建：

- 比如“最近 3 周持续出现前端改版任务”
- 比如“营销类任务进入持续运营”
- 比如“运维值班/巡检已经形成重复性工作”

自动创建也必须落审计：

- 为什么创建
- 预期负责范围
- 为什么现有 agent 不够
- 命名依据

### 8.3 自动命名

命名服务单独存在，避免每次都在 prompt 里随缘生成。

建议规则：

- 默认格式：`职能 + 风格名`
- 例：`前端·澄`、`运维·砺`、`营销·岚`
- 保存字段：
  - `displayName`
  - `slug`
  - `aliases`
- 命名冲突时自动加序号或地盘后缀

## 9. agent 生命周期

### 9.1 Agent 生命周期状态

- `provisioning`
- `bootstrapping`
- `active`
- `paused`
- `degraded`
- `archived`

语义：

- `provisioning`：主体刚创建，配置未齐
- `bootstrapping`：正在做首次职责建档与能力初始化
- `active`：可正常接单
- `paused`：保留主体，但不接新任务
- `degraded`：配置损坏、工作区失效、认证失效等
- `archived`：长期冻结，不再调度

### 9.2 WorkItem 状态

- `queued`
- `planning`
- `running`
- `waiting_human`
- `waiting_agent`
- `blocked`
- `handoff_pending`
- `completed`
- `failed`
- `cancelled`

### 9.3 AgentRun 状态

- `created`
- `starting`
- `running`
- `waiting_action`
- `interrupted`
- `completed`
- `failed`
- `cancelled`

## 10. 记忆体系设计

这是整套架构最容易做歪的地方。

### 10.1 组织级长期记忆

组织共享事实：

- 公司背景
- 品牌原则
- 产品线
- 长期目标
- 公开政策
- 团队协作规则

这层不是某个 agent 私有的。

### 10.2 agent 级长期记忆

每个 `managed_agent` 自己有独立长期记忆：

- 角色使命
- 行事风格
- 常见策略
- 负责领域的长期事实
- 对外协作习惯

这层才真正符合“另一个 Themis”。

### 10.3 任务级运行期记忆

沿用当前 runtime memory 的思路，但归属从“principal 下的 actor”改成“agent 自己的工作项”。

记录：

- progress
- observation
- blocker
- result
- handoff

### 10.4 候选池仍然要保留

无论组织级还是 agent 级长期记忆，都不要允许任务直接改长期记忆。

继续沿用当前已验证的机制：

- 先产出 memory candidate
- 再人工或上级 agent 审批
- 批准后才晋升到长期记忆

### 10.5 读取边界

默认读取顺序建议：

1. 组织级长期记忆
2. 当前 agent 的长期记忆
3. 当前 WorkItem 的运行期记忆
4. 需要协作时再按授权读取其他 agent 的 handoff

不允许默认读：

- 其他 agent 的完整长期记忆
- 其他 agent 的完整运行期草稿
- 其他 agent 的完整内部消息流

## 11. 工作区与权限模型

### 11.1 工作区不能只沿用“当前会话一个 workspacePath”

当前实现里，`workspacePath` 是会话级字段，且执行后冻结。这个规则对单人聊天没问题，但对长期 agent 不够。

而且在多节点场景里，只靠“当前对话里提过哪个路径”也不够，因为主 Themis 后续再次安排同一个项目时，需要知道：

- 这是不是同一个长期项目
- 这个项目当前应该落在哪个工作区
- 这个工作区通常由哪类节点承接
- 后续是必须优先回原节点，还是允许在副本节点间切换

新架构建议拆成四层：

- `WorkspaceRootPolicy`
- `ProjectWorkspaceBinding`
- `AgentWorkspacePolicy`
- `SessionWorkspaceBinding`

### 11.2 WorkspaceRootPolicy

组织级维护可用工作区根目录，例如：

- `/home/leyi/projects/themis`
- `/srv/marketing-assets`
- `/srv/ops-playbooks`

### 11.3 ProjectWorkspaceBinding

这是多节点长期连续性的关键层。

它表达的不是“某个 agent 默认能访问哪些目录”，而是：

- 某个长期项目当前归属哪套工作区事实
- 后续新任务为什么应该继续回到同一工作区
- 这个项目对节点连续性的要求是什么

典型例子：

- 某个网站一直在 `A` 服务器的 `/srv/site-foo` 目录开发
- 主 Themis 后续再次安排“继续开发这个网站”
- 不应该靠聊天历史猜“上次可能是在 A 上做的”
- 而应该先命中这个网站对应的 `ProjectWorkspaceBinding`

建议至少记录：

- `projectId`
- `organizationId`
- `displayName`
- `owningAgentId`
- `workspaceRootId`
- `workspacePolicyId` 或 `canonicalWorkspacePath`
- `preferredNodeId` 或 `preferredNodePool`
- `lastActiveNodeId`
- `lastActiveWorkspacePath`
- `continuityMode`

`continuityMode` 建议至少支持：

- `sticky`
  默认优先同一节点同一路径，原节点不可用时先显式治理，不自动漂移
- `replicated`
  允许在多个已知副本节点间切换，但仍要求命中同一项目绑定
- `portable`
  工作区本身可迁移，节点约束最弱

这层对象要解决的核心问题是：

- “继续做那个网站”的后续任务，不能只靠 agent 默认工作区
- 同一个 agent 可能同时负责多个项目，默认工作区不足以表达项目级连续性
- 项目连续性应该成为平台控制面的结构化事实，而不是对话里的隐式记忆

当前代码里，已经有两块可以直接沿用的地基：

- 新 `work item` 会持久化 `workspacePolicySnapshot / runtimeProfileSnapshot`
- `waiting / resume` 已经会优先回原节点

但这两块仍然不等于“项目级工作区绑定”，因为它们主要解决：

- 当前这条 `work item` 在哪执行
- 这名 agent 默认倾向在哪执行

而不是解决：

- 下周新开一条“继续做这个网站”的任务时，为什么还能稳定回到同一项目工作区

### 11.4 AgentWorkspacePolicy

每个 agent 拥有自己的允许范围：

- 运维 agent：`infra/`、部署脚本、值班文档
- 前端 agent：`apps/web/`
- 后端 agent：`src/server/`、`src/core/`
- 营销 agent：品牌素材目录、内容目录、外部数据抓取空间

允许范围最好支持：

- 仓库根
- 子目录白名单
- 只读/可写
- 是否允许网络

### 11.5 SessionWorkspaceBinding

真正执行时仍然落在具体会话：

- 这样可以复用现有 session / thread / history 机制
- 也方便 agent 长期维护多条任务线

运行时建议按下面顺序解析：

1. 主 Themis 或上级 agent 先判断这是不是已有长期项目
2. 如果命中 `ProjectWorkspaceBinding`，优先取项目绑定的工作区与节点连续性策略
3. 再校验目标 agent 的 `AgentWorkspacePolicy` 是否允许
4. 最后才落到具体 `SessionWorkspaceBinding`

### 11.6 审批策略

审批需要从“只有人类审批”升级成三级：

- `none`
- `supervisor_agent`
- `human_required`

例子：

- 前端 agent 改 `apps/web/` 普通文件：可自动
- 运维 agent 触发生产脚本：必须人类
- 营销 agent 大规模对外发布内容：可先让营销主管 agent 审，再给人类

补一条边界：

- 即使是 `human_required`，子 agent 也不是直接和人类沟通，而是先发 `approval_request` 给上级 agent 或组织级入口，再由入口统一向人类展示

## 12. 运行时设计

### 12.1 第一阶段运行方式

第一阶段不建议每个 agent 单独跑一个 Themis 进程。

推荐：

- 仍由同一个 Themis 服务托管
- 每个 agent 以自己的 `managed principal` 身份运行
- 每次运行独立获取自己的 session / thread / defaults / memory
- 子 agent 的 thread 默认标记为内部线程，不直接出现在人类聊天列表里

这样已经满足“另一个 Themis”的逻辑独立。

### 12.2 第二阶段运行方式

如果后续确实需要：

- 更强隔离
- 更长任务
- 跨机工作区
- 多节点并行

再接：

- 远端 websocket `codex app-server`
- 每个 agent 可绑定不同 runtime target

这和仓库已有的远端执行评估结论是一致的。

### 12.3 为什么不建议把 `codex cloud` 直接当 agent runtime

因为你要的是持续主体，不是 detached 批任务。

`codex cloud` 更适合：

- 异步批处理
- diff 生成
- 离线长跑

不适合直接当“持久化另一个 Themis”的会话主链。

## 13. 调度与自治闭环

### 13.1 派工入口

派工来源有三种：

- 人类显式派工
- 上级 agent 派工
- 系统定时/事件派工

### 13.2 默认通信原则

默认规则建议写死成平台约束：

- 除组织级入口外，agent 默认不直接和人类对话
- agent 间默认不做自由闲聊，只允许围绕任务与治理事件通信
- 跨 agent 通信必须经过 `Dispatch & Communication Center`
- 默认只传必要上下文和产物，不传完整私有上下文
- 广播只允许给小范围订阅组，不允许默认全组织广播

### 13.3 agent 间消息类型

至少需要这几类：

- `dispatch`：正式派工
- `status_update`：进度、风险、已完成节点
- `question`：向其他 agent 请求补充事实或判断
- `answer`：对问题的结构化答复
- `handoff`：阶段性交接
- `escalation`：向上级或组织级入口升级阻塞
- `approval_request`：请求审批
- `approval_result`：审批通过/拒绝/补充条件
- `artifact_offer`：交付文档、代码、素材、报告等产物

### 13.4 路由规则

推荐默认路由：

- worker 默认向自己的 supervisor 发消息
- peer-to-peer 只在关系和权限都允许时放行
- 任何“想问人类”的请求，都先转成 `escalation` 或 `approval_request`
- 组织级入口决定给人类看全文、摘要还是表单化卡片
- 超时未答复的问题自动转 `blocked` 或 `waiting_human`

### 13.5 调度策略

默认策略建议：

- 每个 agent 同时只跑 1 个活跃 `AgentRun`
- 组织内多个 agent 可以并行
- 同一 `WorkItem` 只允许 1 个活跃 `Run lease`

### 13.6 自动创建判定

触发条件建议至少满足 2 类：

- 当前任务明显跨出已有 agent 职责
- 同类任务连续出现并超过频次阈值
- 需要长期跟踪而非一次性交付
- 现有 agent 持续过载

### 13.7 自动归档判定

避免 agent 越来越多：

- 空闲超过阈值
- 无未完成任务
- 无近期 handoff
- 无人类固定关注

可先进入 `paused`，再进入 `archived`。

## 14. 产品面设计

### 14.1 Web 第一优先级

Web 需要新增一个正式的 `Agents` 面，而不是只在设置里塞零散入口。

产品边界先说死：

- 人类主聊天窗口始终只有组织级 Themis
- 子 agent 在 Web 中默认表现为“团队成员”与“工作实体”，不是独立聊天联系人

至少包含：

- agent 列表
- 当前状态
- 负责领域
- 当前任务数
- 最近运行
- 最近阻塞
- 创建入口
- 暂停/恢复
- 接管入口

### 14.2 Agent 详情页

建议包含：

- 基本资料
- 上下级关系
- 默认权限
- 工作区策略
- 技能
- 长期记忆
- 当前队列
- 最近运行
- handoff 历史
- 内部消息流摘要
- 接管控制台

### 14.3 合伙人对话里的交互

组织级 Themis 合伙人可以自然语言完成：

- 帮我创建一个运维 Themis
- 再补两个前端 Themis，名字你定
- 以后营销类都交给新建的营销 Themis
- 先暂停法务支持 Themis
- 接管后端 Themis 正在做的发布排查
- 运营 Themis 需要你审批一条公众号发布，先给我看摘要

### 14.4 人类参与与接管

接管不是普通聊天，而是治理动作。

推荐包含：

- 查看该 agent 的当前任务、上下文摘要、最近内部消息
- 对当前 `WorkItem` 做 `approve / reject / steer / pause / resume`
- 允许临时进入 takeover 模式发指令
- takeover 结束后把指令沉淀为 handoff 或审批结果，再交还 agent

因此：

- 管理员可以“接管某个 agent”
- 但不建议产品化成“每个 agent 都是一个常驻聊天窗口”

### 14.5 飞书阶段

飞书第一阶段只做最小入口：

- 查看 agent 列表
- 查看当前阻塞
- 暂停/恢复
- 接管

不要一开始就在飞书做复杂多 agent 卡片编排。

## 15. 数据模型建议

建议新增这些表：

- `themis_organizations`
- `themis_principals` 增加 `kind`、`organization_id`
- `themis_managed_agents`
- `themis_agent_cards`
- `themis_agent_relationships`
- `themis_agent_communication_policies`
- `themis_agent_workspace_policies`
- `themis_agent_runtime_profiles`
- `themis_agent_spawn_policies`
- `themis_agent_work_items`
- `themis_agent_runs`
- `themis_agent_run_events`
- `themis_agent_mailboxes`
- `themis_agent_messages`
- `themis_agent_handoffs`
- `themis_agent_schedules`
- `themis_agent_audit_logs`

现有表可复用：

- `themis_principal_persona_profiles`
- `themis_principal_main_memory`
- `themis_principal_main_memory_candidates`
- `themis_conversations`
- `themis_turns`
- `themis_events`

复用方式：

- `managed_agent` 直接作为 `principal` 使用现有 persona / memory / settings / history 链路
- agent 内部线程仍可复用 `themis_conversations` / `themis_turns`，但需要补 `internal_only` 一类可见性边界

## 16. API 设计建议

### 16.1 人类入口与内部入口分离

默认边界建议：

- 对人公开的聊天入口，仍然只有组织级 Themis
- 子 agent 的通信接口默认走内部服务，不直接暴露成“给人发消息”的公开 API
- 对人开放的只应该是管理、查看、接管、审批这类治理动作

### 16.2 组织与 agent

- `POST /api/organizations/create`
- `POST /api/organizations/list`
- `POST /api/agents/create`
- `POST /api/agents/list`
- `POST /api/agents/detail`
- `POST /api/agents/pause`
- `POST /api/agents/resume`
- `POST /api/agents/archive`

### 16.3 派工与队列

- `POST /api/agents/dispatch`
- `POST /api/agents/work-items/list`
- `POST /api/agents/work-items/detail`
- `POST /api/agents/work-items/cancel`
- `POST /api/agents/work-items/reprioritize`

### 16.4 通信与升级

- `POST /api/agents/escalations/list`
- `POST /api/agents/escalations/respond`
- `POST /internal/agent-comm/send`
- `POST /internal/agent-comm/pull`
- `POST /internal/agent-comm/ack`

### 16.5 运行与接管

- `POST /api/agents/runs/list`
- `POST /api/agents/runs/detail`
- `POST /api/agents/takeover`
- `POST /api/agents/handoffs/list`

### 16.6 自动创建建议

- `POST /api/agents/spawn-suggestions`
- `POST /api/agents/spawn-approve`
- `POST /api/agents/spawn-reject`

第一阶段不需要把所有接口都做完，但设计上应该留出这条边界。

## 17. 与现有代码的映射关系

### 17.1 可以直接复用

- `PrincipalPersonaService`
- `PrincipalSkillsService`
- `Principal task settings`
- `ConversationService`
- `AppServerTaskRuntime`
- `CodexTaskRuntime`
- `sessionFactory` 扩展点
- `memory candidate` 候选池机制
- `history / diagnostics / doctor` 基础链路

### 17.2 不应直接复用为最终模型

- 现有 `PrincipalActorsService` 不能直接当“持久化另一个 Themis”的主模型
- 现有 `/api/actors/*` 不能直接扩成长期 agent API

更合理的做法：

- 保留 `actor memory v1` 作为轻量运行期草稿模型，或者逐步迁入新的 `work item runtime memory`
- 新的持久化 agent 走 `managed principal` 路线
- 新增 `Agent Registry`、`Agent Communication Broker`、`Agent Scheduler` 这三类服务，不要继续塞进 `/api/actors/*`

## 18. 分阶段落地建议

### 阶段 A：模型定型

目标：

- 先把 `organization + managed principal + agent profile + work item + agent message` 建起来

交付：

- SQLite schema
- 最小服务层
- 最小 Web 管理页

### 阶段 B：手动创建与手动派工

目标：

- 人可以显式创建 agent，并把任务派给 agent
- 同时保持“人只和组织级入口对话，子 agent 默认不直接对人”

交付：

- `Agents` 列表
- `create / dispatch / pause / resume / takeover`
- 每个 agent 独立会话与历史

### 阶段 C：后台调度器

目标：

- agent 即使没有人类当前盯着，也能从队列里独立开始工作

交付：

- `AgentScheduler`
- `Run lease`
- 恢复与重试

### 阶段 D：自动创建

目标：

- 合伙人 Themis 能判断什么时候该新建一个长期数字员工

交付：

- 创建建议器
- 命名器
- 预算护栏
- 审批策略

### 阶段 E：多 agent 协作

目标：

- 一个 agent 给另一个 agent 派工
- 上级 agent 汇总下级 agent 结果

交付：

- `AgentMailbox`
- 结构化消息协议
- handoff 一等对象
- 父子 WorkItem
- 汇总视图

当前状态：

- 已完成。`handoff`、父子 `workItem`、manager 汇总视图都已接进现有 SQLite / service / HTTP / Web 治理链路。

### 阶段 F：远端执行节点

目标：

- 需要时把某些 agent 放到远端执行

当前状态：

- 已评估，但当前暂缓。只有在出现共享执行节点、跨机器工作区或长任务托管需求时，才重开这一阶段。

交付：

- 远端 websocket `app-server` runtime profile
- 鉴权与诊断
- 跨机器工作区策略

## 19. 关键风险

### 19.1 不引入组织层会后患无穷

如果继续把所有长期状态绑在人类 principal 下：

- 共享数字员工会很难做
- 多人协作会乱
- 接管边界会混

### 19.2 直接复用 actor 会把模型做裂

这不是小风险，而是高概率架构债。

### 19.3 自主创建如果没有预算，会指数失控

必须从第一天就有：

- 最大活跃 agent 数
- 自动归档
- 审计日志
- 需要人工确认的阈值

### 19.4 工作区与权限如果只按角色粗配，会出安全问题

“前端 agent”不等于默认能写整个仓库。

角色只是语义标签，真正权限要落到：

- 目录白名单
- 只读/可写
- 网络策略
- 审批边界

### 19.5 如果子 agent 直接对人，组织边界会塌

一旦子 agent 都能直接和人类常态聊天：

- 人类会绕过组织级入口直接派工
- supervisor 不再掌握真实上下文
- 审计链和职责链会断
- “谁该负责”会很快说不清

### 19.6 如果 agent 间默认自由群聊，上下文会爆炸

自由广播或共享完整上下文，短期看爽，长期一定出问题：

- token 成本上升
- 责任扩散
- 隐私和权限边界被冲掉
- 交接与审批无法结构化

## 20. 社区参考与借鉴边界

下面这些项目和协议值得参考，但都不应原样照搬：

### 20.1 A2A Protocol

可借：

- `Agent Card / Task / Message / Artifact` 这套对象边界
- 长任务异步状态更新
- 未来远端 agent 节点的协议对齐空间

不直接照搬：

- 第一阶段不需要把内部所有 agent 都暴露成 HTTP A2A 服务
- 先做组织内部 `Agent Registry + Mailbox`，再考虑外联互通

参考：

- https://a2a-protocol.org/latest/topics/key-concepts/

### 20.2 AutoGen Handoffs

可借：

- 显式 handoff 模式
- 事件驱动 runtime
- `topic / subscription` 这种受控路由思路

不直接照搬：

- 我们不做“所有 agent 共享同一大聊天上下文”的默认模式
- 我们的人类入口也不应该像示例里的多个主体那样平铺

参考：

- https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/design-patterns/handoffs.html

### 20.3 CrewAI Hierarchical Process

可借：

- manager / manager_agent 的层级管理思路
- 由 manager 负责计划、派工、校验产出

不直接照搬：

- Themis 不应该把所有工作都做成“预定义 crew”
- 我们要的是长期组织和持久化数字员工，不只是单次流程编排

参考：

- https://docs.crewai.com/en/concepts/processes

### 20.4 LangGraph Supervisor

可借：

- 中央 supervisor 控制通信流
- handoff 工具和消息历史裁剪
- 多层 supervisor 递归管理

不直接照搬：

- 不建议把子 agent 直接作为人类对话参与者暴露
- 需要把 supervisor 模式落进 Themis 自己的持久化主体和审计模型

参考：

- https://github.com/langchain-ai/langgraph-supervisor-py

### 20.5 AgentScope MsgHub

可借：

- message hub 作为通信中枢的抽象
- participant / broadcast / lifecycle 的统一封装

不直接照搬：

- 不能默认全量广播
- Themis 更适合“按任务、按关系、按订阅范围”的受控广播

参考：

- https://java.agentscope.io/en/multi-agent/msghub.html

### 20.6 MetaGPT

可借：

- “软件公司就是一组角色化 agent”的组织隐喻
- 角色使命与 SOP 的显式化

不直接照搬：

- 不建议把 PM / Architect / Engineer 这些固定流水线硬编码成平台主模型
- Themis 需要的是通用的组织/agent/任务/通信底座，让团队自己定义角色

参考：

- https://github.com/FoundationAgents/MetaGPT

## 21. 这份设计的最终结论

如果要实现你要的“另一个 Themis”，推荐结论只有一条：

- 把持久化数字员工设计成 `organization` 下的 `managed principal`
- 并把组织级 Themis 固定为默认唯一对人入口，让下层 agent 通过受控协议协作

而不是：

- 继续在当前 `actor` 模型上缝缝补补
- 或者把 `thread/fork` 误当成长期 agent 创建

这条路线的好处是：

- 贴合“另一个 Themis”的语义
- 最大化复用当前 principal 级能力
- 后续既能继续单机托管，也能平滑演进到远端执行

坏处也很明确：

- 这是一次真正的主体模型升级，不是小修小补

但如果目标真的是“公司的合伙人 Themis 可以长期招人、带人、接管人”，这一步必须走，绕不过去。
