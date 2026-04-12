# Themis 局域网多节点硅基员工平台 / Phase 2 节点模型与调度租约实施计划

更新时间：2026-04-12 14:12 CST
文档性质：实施计划稿。目标是把平台化路线里的 `Phase 2 / 节点模型与调度租约` 收成可开工的第一版实现方案。

当前状态补充（2026-04-12）：

- 第一包已经完成前 4 项里的前 3 项：`node / execution_lease` 类型与 store 接口、SQLite 节点与租约 schema/适配器，以及 `/api/platform/nodes/register|heartbeat|list` 平台 API 都已落地。
- 这一包同时补齐了节点服务、SQLite 持久化与平台 HTTP 回归，当前验证已通过：
  - `npm run typecheck`
  - `node --test --import tsx src/core/managed-agent-node-service.test.ts src/storage/codex-session-registry-managed-agent-node.test.ts src/core/managed-agents-service.test.ts src/core/managed-agent-coordination-service.test.ts src/core/managed-agent-scheduler-service.test.ts src/server/http-agents.test.ts src/server/http-platform.test.ts`
  - `git diff --check`
- 当前仍未进入的是“调度器最小节点匹配”。也就是说，平台已经能认识节点并持久化租约对象，但 `ManagedAgentSchedulerService` 还没有在 claim 时真正选节点并回填 `nodeId / execution_lease`。

## 1. 目标

这一阶段只解决一件事：

**让平台能够认识“机器”这种执行资源，并把一次 `run` 的执行归属明确绑定到某个节点租约上。**

换句话说，这一阶段不是要把任务真正远端跑完，也不是要先做复杂调度，而是先把下面这组事实落成平台对象：

- `node`
- 节点心跳
- 节点能力
- `execution_lease`

完成后应该达到的效果是：

- 平台知道局域网里有哪些节点在线
- 平台知道每个节点大概能跑什么、还能接多少任务
- 调度器可以从“本机可跑”升级成“有根据地选节点”

## 2. 当前代码事实

基于当前仓库实现，进入 Phase 2 前已经有三条明确前提：

### 2.1 Phase 1 已完成

当前已具备：

- 控制面 `store` 抽象
- SQLite 控制面适配器
- `ManagedAgentControlPlaneFacade`
- 最小平台 API 原型
- MySQL 控制面 schema 原型与最小 round-trip

这意味着“平台对象”和“单机 runtime”之间已经有了第一层边界。

### 2.2 调度器现在仍然只认识本地执行

当前 `ManagedAgentSchedulerService` 的 claim 逻辑仍然是：

- 从队列里找可执行 `work_item`
- 创建或恢复本地 `run`
- 默认由当前 `ManagedAgentExecutionService` 在本地继续推进

也就是说，当前还没有显式的“节点归属”概念。

### 2.3 `run` 已经天然需要节点亲和性

现有执行模型里，`waiting_human` / `waiting_agent` 回复后会继续复用同一条 work item 的上下文和运行态。

这意味着：

- 后续恢复执行时，最好优先回到原节点
- `execution_lease` 不能只是调度瞬时变量，而要成为持久化事实

## 3. Phase 2 范围

这一阶段建议只做 5 件事：

- 节点数据模型
- 节点注册与心跳
- 节点能力快照
- `execution_lease` 数据模型
- 调度器的最小节点匹配

当前不做：

- Worker Node 真执行
- 跨节点热迁移
- 公网节点
- 复杂负载均衡

## 4. 推荐对象模型

### 4.1 `node`

建议先固定最小字段：

- `nodeId`
- `organizationId`
- `displayName`
- `status`
  - `online`
  - `draining`
  - `offline`
- `slotCapacity`
- `slotAvailable`
- `labels`
- `workspaceCapabilities`
- `credentialCapabilities`
- `providerCapabilities`
- `heartbeatTtlSeconds`
- `lastHeartbeatAt`
- `createdAt`
- `updatedAt`

### 4.2 `execution_lease`

建议单独建模，不和 `run` 混成一个字段包：

- `leaseId`
- `runId`
- `workItemId`
- `targetAgentId`
- `nodeId`
- `status`
  - `active`
  - `expired`
  - `released`
  - `revoked`
- `leaseToken`
- `leaseExpiresAt`
- `lastHeartbeatAt`
- `createdAt`
- `updatedAt`

这样后续节点失联、租约回收、waiting 恢复，都会更容易解释。

## 5. 推荐模块边界

### 5.1 store 层

建议新增：

- `ManagedAgentNodeStore`
- `ManagedAgentLeaseStore`

SQLite 和 MySQL 都先给最小实现。

### 5.2 服务层

建议新增：

- `ManagedAgentNodeRegistryService`
  - 注册节点
  - 心跳续约
  - 标记下线 / draining
  - 读取节点列表
- `ManagedAgentLeaseService`
  - 创建租约
  - 续约
  - 释放
  - 回收超时租约

### 5.3 调度层

`ManagedAgentSchedulerService` 这一阶段只做一件事：

**claim 前先选节点，再创建 run + lease。**

但这一步仍然只做到“调度知道该选谁”，不要求节点已经真的能远端执行。

## 6. 推荐第一包

如果按当前实现继续推进，Phase 2 第一包的状态已经可以固定成：

1. 已完成：固定 `node / execution_lease` 类型与 store 接口
2. 已完成：SQLite 最小实现
3. 已完成：新增平台 API：
   - `POST /api/platform/nodes/register`
   - `POST /api/platform/nodes/heartbeat`
   - `POST /api/platform/nodes/list`
4. 下一刀：让调度器开始读取节点列表，并在 claim 结果里回填目标 `nodeId`

这样第一包已经先验证了：

- 节点模型是不是顺手
- 控制面、SQLite 与平台 HTTP 口径是不是一致
- 后续远端执行是不是有清晰挂点

而下一刀的验证重点会切到：

- 调度器有没有被新模型打乱
- claim 时的节点选择是否可解释
- `run` 与 `execution_lease` 的绑定是不是开始进入主链

## 7. 完成标准

这一阶段结束时，至少要满足：

- 节点可以注册、续心跳、读取列表
- 平台能知道节点在线状态和基本能力
- 一条 `run` 最多只有一个有效 `execution_lease`
- 调度器做出的节点选择是可解释的

## 8. 验证方案

建议至少保住下面这组验证：

- `npm run typecheck`
- `node --test --import tsx src/core/managed-agent-scheduler-service.test.ts`
- `node --test --import tsx src/server/http-platform.test.ts`
- 新增节点 / 租约相关测试
- `git diff --check`

## 9. 当前不建议在 Phase 2 做的事

- 不做节点主动拉任务和执行回传
- 不做 waiting 后跨节点恢复
- 不做跨网接入
- 不做自动工作区同步
- 不做复杂节点打分算法

## 10. 与现有文档的关系

- 总路线：见 [Themis 局域网多节点硅基员工平台 / 分阶段落地计划](./themis-silicon-employee-platform-roadmap-plan.md)
- Phase 1：见 [Themis 局域网多节点硅基员工平台 / Phase 1 控制面底座实施计划](./themis-silicon-employee-platform-phase-1-control-plane-plan.md)
- 当前单机数字员工实现：见 [Themis 持久化合伙人 / 数字员工架构设计](./themis-persistent-agent-architecture.md)
