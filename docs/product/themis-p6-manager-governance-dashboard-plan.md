# Themis P6 / manager 治理面 / 组织级跨父任务汇总台计划

更新时间：2026-04-07

## 当前状态

- 已完成实现并通过回归。
- 已落地内容：
  - `ManagedAgentCoordinationService.listOrganizationCollaborationDashboard(...)`
  - `POST /api/agents/collaboration-dashboard`
  - Web `Agents` 面板里的“组织级跨父任务汇总台”
  - `attentionLevel / attentionReasons / lastActivity*` 第一版规则
- 已完成验证：
  - `node --test --import tsx src/core/managed-agent-coordination-service.test.ts`
  - `node --test --import tsx src/server/http-agents.test.ts`
  - `node --test apps/web/modules/agents.test.js apps/web/modules/ui.test.js`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`

## 目标

把当前分散在三处的协作事实收成一个真正可治理的组织级视图：

- 组织级 waiting queue
- 单条 `work item detail` 的父子协作汇总
- 当前 agent 的 `handoffs / timeline`

这轮不是再补 `P4` 已有的“单条父任务详情页”，而是补“跨父任务 / 跨 manager”的总览层，让顶层 Themis 能直接回答：

- 当前组织里哪些父任务最值得先看
- 哪些 manager 手上有最多等待项或阻塞
- 最近哪些 handoff、升级、治理回复正在堆积
- 点进某一条汇总卡后，如何快速跳回已有 `work item detail`

## 当前事实

- 已有组织级 waiting queue：可以看 `waiting_human / waiting_agent / escalationCount`，但不能按父任务或 manager 汇总。
- 已有单条 `work item detail` 协作摘要：可以看 `parentWorkItem / childSummary / childWorkItems / latestHandoff`，但只能一条一条点开看。
- 已有当前 agent 的 `Handoffs & Timeline`：可以看交接、治理回复、等待和收口，但缺少组织级聚合入口。
- 已有 `P4` 首刀：足够支持“某条父任务的协作详情”，不够支持“整个组织当前最该治理的几条父任务”。

## 本轮范围

### 要做

- 新增组织级“协作汇总”聚合模型。
- 新增 HTTP 聚合接口，直接返回可渲染的 dashboard DTO。
- Web `Agents` 面板新增“组织级跨父任务汇总台”区块。
- 明确第一版 manager 升级策略，只做可解释、可测试的规则，不做黑盒打分。
- 补齐服务端、HTTP、前端状态与 UI 回归测试。

### 不做

- 不做新的物理隔离或远端执行节点。
- 不做新的 agent 自动创建逻辑。
- 不做复杂多层组织树。
- 不做独立 KPI 仪表盘。
- 不把飞书重新拉进这轮主线。
- 不把 human governance 回复强行重写成统一 `handoff` 对象；继续保留 `governance` 时间线语义。

## 实现拆分

### Step 1：定义组织级协作汇总 DTO

在 `ManagedAgentCoordinationService` 上新增组织级聚合入口，建议形态：

- `listOrganizationCollaborationDashboard(ownerPrincipalId, filters)`

第一版聚合单位建议直接按“父任务”组织，而不是按 agent 或 message：

- 只要某条 `work item` 下面存在子任务，就视为一条可治理的“父任务卡片”
- 每张卡片返回：
  - `parentWorkItem`
  - `managerAgent`
  - `childSummary`
  - `latestHandoff`
  - `latestWaitingMessage`
  - `latestGovernanceResponse`
  - `lastActivityAt`
  - `attentionLevel`
  - `attentionReasons`

这样能和现有 `work item detail` 直接对上，不需要再发明第二套主键。

### Step 2：落地第一版 manager 升级策略

第一版不要做复杂评分，直接用显式规则：

- `urgent`
  - 任一子任务 `waiting_human`
  - 任一子任务 `failed`
- `attention`
  - 任一子任务 `waiting_agent`
  - 最近事件是 `escalation`
  - 有打开中的子任务但超过阈值没有新的 `handoff / governance / response`
- `normal`
  - 其余情况

同时返回 `attentionReasons`，例如：

- `waiting_human`
- `waiting_agent`
- `recent_escalation`
- `failed_child`
- `stale_open_children`

要求是：

- 前端不用猜
- 测试可以直接断言
- 文档能解释为什么这张卡被排到前面

### Step 3：新增 HTTP 聚合接口

建议新增：

- `POST /api/agents/collaboration-dashboard`

建议支持的最小筛选参数：

- `managerAgentId?`
- `attentionOnly?`
- `limit?`

建议返回：

- `summary`
  - `totalCount`
  - `urgentCount`
  - `attentionCount`
  - `normalCount`
- `items`
  - 上面 Step 1 的父任务聚合卡列表

这里不要让前端自己扫 `workItems + handoffs + waiting queue` 拼装。

### Step 4：Web 新增组织级跨父任务汇总台

在 `Agents` 面板新增一个独立区块，位置建议放在：

- `组织级待治理`
- `组织级跨父任务汇总台`
- `当前 agent 的 Handoffs & Timeline`

每张卡片至少展示：

- 父任务标题 / goal
- manager agent 名称
- 子任务统计
- 最新 handoff / escalation / governance 摘要
- attention badge
- 最近活跃时间

同时提供两个动作：

- “查看父任务详情”
  - 直接跳到现有 `work item detail`
- “聚焦该 manager”
  - 切换右侧当前 agent 到对应 manager，并保留已有 detail 交互

这样复用现有面板，不再新开第二套详情页。

### Step 5：测试与文档

至少补齐：

- `src/core/managed-agent-coordination-service.test.ts`
  - 聚合分组
  - `attentionLevel / attentionReasons`
  - `lastActivityAt`
- `src/server/http-agents.test.ts`
  - 新接口返回值
  - 筛选条件
- `apps/web/modules/agents.test.js`
  - load 流程新增 dashboard 拉取
- `apps/web/modules/ui.test.js`
  - 新区块渲染
  - badge / 摘要 / 跳转动作

文档同步至少包括：

- 本计划文档
- `memory/tasks/in-progress.md`
- 如有稳定结论，再写入 `docs/memory/2026/04/`

## 建议执行顺序

1. 先补服务层聚合和测试，确认“按父任务聚合”这套 DTO 够不够用。
2. 再补 HTTP 接口，把数据契约固定住。
3. 再接 Web 区块，复用已有 `work item detail` 跳转。
4. 最后统一补文档和回归。

## 风险与边界

- 当前 `child` 关系只靠 `parentWorkItemId`；第一版聚合应继续沿这个主索引，不要退回靠 message 猜父子关系。
- `governance` 与 `handoff` 语义目前并存；第一版 dashboard 应并列展示，不要强行合并成一种事件。
- 如果直接做成“按 manager 聚合”而不保留“父任务”粒度，后续很容易失去跳回现有 `work item detail` 的入口。
- 如果这轮把页面做成新的大控制台，容易和现有 `Agents` 面板重复；第一版应优先做“组织级列表 + 复用现有详情页”。

## 完成标准

- 顶层 Themis 打开 `Agents` 面板后，不点进单条 work item，也能先看到当前组织最该治理的几条父任务。
- 每张汇总卡都能解释“为什么它排在前面”。
- 从汇总卡能直接跳回现有 `work item detail`，不需要重造详情页。
- 新增回归测试通过，且 `npm run typecheck`、`npm run build` 通过。
