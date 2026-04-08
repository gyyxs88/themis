# Themis P6 / manager 治理面 v2 / 组织级摘要、筛选与治理动作计划

更新时间：2026-04-08
状态：已完成；`2026-04-08` 已按本文落成实装，用于承接“组织级跨父任务汇总台”之后的下一轮 manager 治理面。

相关文档：

- [Themis P6 / manager 治理面 / 组织级跨父任务汇总台计划](./themis-p6-manager-governance-dashboard-plan.md)
- [Themis 持久化合伙人 / 数字员工架构设计](./themis-persistent-agent-architecture.md)
- [持久化 agent 的组织级跨父任务协作汇总台](../memory/2026/04/themis-managed-agent-organization-collaboration-dashboard.md)

## 为什么现在做这一轮

`P3 / P4 / P5` 和 `P6` 第一刀都已经收口，当前真正缺的不是“还能不能看见组织级协作事实”，而是“顶层 Themis 打开 `Agents` 面板后，能不能更快知道先处理谁、筛掉谁、直接做什么治理动作”。

现在仓库里已经有三块可复用地基：

- 组织级 waiting queue：能看 `waiting_human / waiting_agent`，也能直接提交治理回复或升级。
- 组织级跨父任务汇总台：能按父任务看到 `attentionLevel / attentionReasons / lastActivity*`。
- 单 agent 详情页：已经有 `pause / resume / archive`、`cancel work item`、`handoff / timeline`、执行边界等治理动作。

但它们目前还是三块并排能力，不是一个真正可操作的“治理工作台”。

## `2026-04-08` 实装结果

- 服务层已新增 `getOrganizationGovernanceOverview(ownerPrincipalId, filters)`，用于返回组织级治理摘要与 `managerHotspots`。
- `listOrganizationWaitingQueue(...)` 与 `listOrganizationCollaborationDashboard(...)` 现已共享 `organizationId / managerAgentId / attentionLevels / waitingFor / staleOnly / failedOnly / limit` 这套筛选语义，并返回过滤后的 summary。
- 组织级 waiting item 现已补齐 `managerAgent / parentWorkItem / waitingFor / isStale / relatedFailedChildCount / relatedStaleChildCount / attentionLevel / attentionReasons`；协作卡片现已补齐 `waitingHumanChildCount / waitingAgentChildCount / failedChildCount / staleChildCount / managerStatus / latestWaiting*`。
- HTTP 已新增 `POST /api/agents/governance-overview`，并扩了 `POST /api/agents/waiting/list` 与 `POST /api/agents/collaboration-dashboard` 的共享筛选 payload。
- Web `Agents` 面板已改造成治理工作台形态：新增治理摘要条、共享筛选栏、manager 热点区，并在 waiting / collaboration 卡片上补齐“查看等待项 / 查看父任务 / 暂停或恢复 manager”等总览层治理动作。
- 回归已固定覆盖服务层、HTTP、Web controller 与 UI 渲染，详见 `memory/tasks/done.md` 中 `2026-04-08` 的完成记录。

## 当前基线

### 已经有的能力

- `ManagedAgentCoordinationService.listOrganizationWaitingQueue(ownerPrincipalId)`：
  - 会返回组织级 waiting summary 和 item 列表。
  - Web 已支持在 waiting 卡片里直接提交治理回复，或把 `waiting_agent` 升级到顶层治理。
- `ManagedAgentCoordinationService.listOrganizationCollaborationDashboard(ownerPrincipalId, filters)`：
  - 会按父任务聚合出协作卡片。
  - 当前筛选只有 `managerAgentId`、`attentionOnly`、`limit`。
- Web `Agents` 面板：
  - 已同时显示“组织级待治理”和“组织级跨父任务汇总台”。
  - 当前协作卡片动作只有“查看父任务详情”“切到 manager”。

### 当前不够的地方

- 组织级 waiting queue 没有筛选能力，只能整包看。
- 协作汇总台没有组织级热点摘要，用户仍然要自己扫卡片。
- waiting queue 和父任务卡片没有共享筛选状态，不能回答“只看某个 manager 的待治理项”。
- 可直接在总览层完成的治理动作还偏少，仍然经常需要跳进 detail 页。
- Web 现在更像“能看见”，还不是“能高效治理”。

## v2 目标

把现有 `Agents` 面板推进到“组织级治理工作台”形态，但继续复用现有 detail 页和现有服务层事实，不重造第二套控制台。

这一轮完成后，顶层 Themis 至少要能直接回答四个问题：

1. 当前组织里最需要先处理的是哪些 manager 或父任务。
2. 我能不能快速只看某个 manager、某类 attention 或某种 waiting 状态。
3. 我能不能在总览层直接完成最常用的安全治理动作。
4. 如果要深入排查，能不能无缝跳回现有 `work item detail` 或当前 manager 详情。

## 本轮范围

### 要做

- 组织级治理摘要
- waiting queue 和协作汇总台的共享筛选模型
- 协作卡片和 manager 热点卡的最小治理动作
- Web `Agents` 面板的治理工作台化改造
- 对应的服务层、HTTP、前端测试和文档更新

### 不做

- 不做新的远端执行或物理隔离
- 不做新的 agent 自动创建策略
- 不做飞书侧 agent 治理卡
- 不做新的独立详情页或多层组织树
- 不做高风险批量动作，例如“一键取消全部”“一键归档全部”
- 不把现有 `waiting / governance / handoff` 语义重新合并成新对象

## 设计原则

- 继续沿“父任务卡片 -> 复用现有 `work item detail`”这条路径扩，不新开第二套详情模型。
- 摘要、筛选、动作三件事都只消费现有服务端事实，不让前端自己拼真相。
- 优先暴露“安全且高频”的治理动作，危险动作仍然留在 detail 页里。
- waiting queue 和协作汇总台必须共用筛选语义，避免两个区块各自说各自的话。
- 第一轮继续用可解释规则，不做黑盒打分或大而全 KPI 面板。

## 任务拆解

### 1. 服务层：补组织级治理摘要

在 `ManagedAgentCoordinationService` 上新增一层组织级治理摘要入口，建议形态：

- `getOrganizationGovernanceOverview(ownerPrincipalId, filters)`

建议返回的最小摘要：

- `urgentParentCount`
- `attentionParentCount`
- `waitingHumanCount`
- `waitingAgentCount`
- `staleParentCount`
- `failedChildCount`
- `managersNeedingAttentionCount`
- `managerHotspots[]`

`managerHotspots[]` 建议至少包含：

- `managerAgentId`
- `displayName`
- `openParentCount`
- `urgentParentCount`
- `waitingCount`
- `staleParentCount`
- `latestActivityAt`

这一步的目的不是做 KPI 仪表盘，而是先把“我该先盯谁”收成明确数据契约。

### 2. 服务层：给 waiting queue 和协作汇总台补共享筛选

当前 waiting queue 没有筛选，协作汇总台只有极少筛选。v2 要把两边收成同一套最小筛选语义。

建议第一轮支持：

- `organizationId?`
- `managerAgentId?`
- `attentionLevels?`
- `waitingFor? = human | agent | any`
- `staleOnly?`
- `failedOnly?`
- `limit?`

建议做法：

- 扩 `listOrganizationWaitingQueue(...)`
- 扩 `OrganizationCollaborationDashboardFilters`
- 保持按父任务聚合，不改主索引

要求是：

- 前端切一次筛选，waiting queue 和协作汇总台都要一起变。
- 服务端直接返回过滤后的 summary，不让前端拿全量数据自己减。

### 3. 服务层：补更可操作的父任务卡字段

当前协作卡已经能看，但还不够“拿来治理”。建议在 `OrganizationCollaborationDashboardItem` 上补这些最小字段：

- `waitingHumanChildCount`
- `waitingAgentChildCount`
- `failedChildCount`
- `staleChildCount`
- `managerStatus`
- `latestWaitingWorkItemId?`
- `latestWaitingTargetAgentId?`
- `latestWaitingActionType?`

这样前端就能在一张父任务卡上更清楚地展示：

- 这张卡到底卡在人、卡在 agent，还是卡在失败/陈旧
- 点击后应该跳去哪里
- 当前 manager 是否处于 `active / paused / degraded`

### 4. HTTP：补治理摘要接口并扩现有筛选参数

建议新增：

- `POST /api/agents/governance-overview`

建议扩已有：

- `POST /api/agents/waiting/list`
- `POST /api/agents/collaboration-dashboard`

接口原则：

- `governance-overview` 只返回摘要和 manager 热点，不返回大列表。
- waiting 和 collaboration 两条列表接口继续各司其职，但吃同一套筛选 payload。
- 所有 summary 都由服务端生成，前端只负责渲染和交互。

### 5. Web：把 `Agents` 面板改成“治理工作台”

页面结构建议收成四层：

1. 组织级治理摘要条
2. 共享筛选栏
3. manager 热点区
4. waiting queue + 跨父任务汇总台

#### 组织级治理摘要条

至少展示：

- `urgent parent`
- `attention parent`
- `waiting human`
- `waiting agent`
- `stale parent`
- `managers needing attention`

这些摘要项要支持一键改筛选，例如点击 `waiting human` 就把当前视图切到只看 `waiting_human`。

#### 共享筛选栏

第一轮建议提供：

- manager 选择
- attention 级别
- waiting 类型
- `stale only`
- `failed only`
- `reset`

这部分筛选状态要由 `apps/web/modules/agents.js` 统一持有，不允许 waiting 区和 collaboration 区各存一份。

#### manager 热点区

每张 manager 热点卡至少展示：

- manager 名称
- 当前状态
- 打开中的父任务数
- waiting 数
- urgent 数
- 最近活动时间

动作建议只有两个：

- `只看该 manager`
- `切到 manager`

如果 manager 当前是 `paused`，卡片上要直接体现，不让用户点进去才发现。

#### 协作卡片增强

在现有“父任务卡片”上补：

- 更细的 waiting / failed / stale 计数
- manager 当前状态
- 更明确的关注原因文案

新增动作建议：

- `查看父任务详情`
- `查看等待项`
- `切到 manager`
- `暂停 manager / 恢复 manager`

这里的 `暂停 / 恢复` 直接复用现有 lifecycle 接口，不新造动作链。

#### waiting 卡片增强

waiting 卡片继续保留现有“直接治理回复 / 升级处理”，但补两件事：

- 显示它属于哪个父任务、哪个 manager
- 提供“回到父任务卡”或等价跳转动作

这样 waiting queue 就不再是孤立列表，而是整个治理工作台的一部分。

### 6. 治理动作边界

v2 在总览层只开放这些安全动作：

- `respond human waiting`
- `escalate waiting_agent -> waiting_human`
- `focus manager`
- `pause manager`
- `resume manager`
- `open parent work item detail`

本轮明确不在总览层做：

- `archive manager`
- `cancel parent work item`
- 批量治理
- 修改执行边界

这些动作仍然保留在 detail 页，避免总览层承担过高风险。

### 7. 测试与回归

至少补齐这些验证：

- `src/core/managed-agent-coordination-service.test.ts`
  - 治理摘要统计
  - `managerHotspots`
  - waiting / collaboration 共享筛选
  - 新增字段如 `waitingHumanChildCount / staleChildCount`
- `src/server/http-agents.test.ts`
  - `POST /api/agents/governance-overview`
  - waiting / collaboration 新筛选 payload
  - 非法筛选参数的边界
- `apps/web/modules/agents.test.js`
  - 共享筛选状态
  - manager 热点交互
  - 从摘要切筛选
  - 协作卡片 pause / resume 动作
- `apps/web/modules/ui.test.js`
  - 治理摘要条渲染
  - manager 热点卡渲染
  - waiting / collaboration 联动渲染

最终固定回归：

- `node --test --import tsx src/core/managed-agent-coordination-service.test.ts`
- `node --test --import tsx src/server/http-agents.test.ts`
- `node --test apps/web/modules/agents.test.js apps/web/modules/ui.test.js`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## 建议执行顺序

1. 先定服务层 DTO 和共享筛选模型。
2. 再落 `governance-overview` 和现有列表接口扩展。
3. 然后改 Web 状态和 UI，先做摘要条与共享筛选。
4. 再把 manager 热点卡和协作卡片动作接起来。
5. 最后统一补测试、文档和 Todoist 口径。

## 完成标准

- 打开 `Agents` 面板后，顶层 Themis 不看 detail 也能先知道“先处理谁”。
- waiting queue 和协作汇总台可以共用一套筛选，而不是两块孤立列表。
- 至少一类 manager 级治理动作能直接在总览层完成，并复用现有接口。
- 从任何摘要卡或父任务卡都能无缝跳回现有 detail 页，不需要第二套详情面。
- 自动化测试、`typecheck`、`build` 都通过。
