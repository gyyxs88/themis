# Themis 局域网多节点硅基员工平台 / Phase 1 控制面底座实施计划

更新时间：2026-04-12 12:33 CST
文档性质：实施计划稿。目标是把“平台化路线里的 Phase 1 / 控制面底座”继续下收成可开工的改造计划。

当前状态补充（2026-04-12）：

- 本文计划范围内的首轮实现已经落地：控制面 `store` 接口、SQLite 适配器、控制面门面、`http-agents` 主链收敛、MySQL schema 原型、最小平台 API 原型都已完成。
- 当前验证已覆盖 `npm run typecheck`、`managed-agent/http-agents/platform` 相关回归测试，以及本地 `mysql:8.4` round-trip 烟测。

## 1. 目标

这一阶段只解决一件事：

**把数字员工相关的控制面事实，从“默认绑定单机 Themis 本地 registry”收成“服务层可依赖的稳定控制面接口”。**

换句话说，这一阶段不是要完成多节点执行，也不是要先做 MySQL 全量切换，而是要先把后面的平台化入口打开。

完成后应该达到的效果是：

- `ManagedAgentsService`
- `ManagedAgentCoordinationService`
- `ManagedAgentSchedulerService`

不再直接依赖 `SqliteCodexSessionRegistry` 这个具体实现，而是依赖更窄、更稳定的控制面存储接口。

## 2. 当前代码事实

基于当前仓库实现，Phase 1 需要面对的事实已经很明确：

### 2.1 服务层直接绑定 `SqliteCodexSessionRegistry`

当前 4 个核心服务都直接把具体 registry 类型写进构造参数：

- [managed-agents-service.ts](/home/leyi/projects/themis/src/core/managed-agents-service.ts:1)
- [managed-agent-coordination-service.ts](/home/leyi/projects/themis/src/core/managed-agent-coordination-service.ts:1)
- [managed-agent-scheduler-service.ts](/home/leyi/projects/themis/src/core/managed-agent-scheduler-service.ts:1)
- [managed-agent-execution-service.ts](/home/leyi/projects/themis/src/core/managed-agent-execution-service.ts:1)

这意味着当前“平台控制面事实”天然等于“本地 SQLite registry 事实”。

### 2.2 runtime 装配也默认假设本地 registry 是唯一真相来源

当前 `AppServerTaskRuntime` 会直接 new 出依赖 registry 的数字员工服务：

- [app-server-task-runtime.ts](/home/leyi/projects/themis/src/core/app-server-task-runtime.ts:225)

所以如果不先抽持久化边界，后面无论加多少“平台”概念，本质仍然是单机 runtime 在管理一切。

### 2.3 HTTP handler 也直接穿透到 runtime store

当前 `http-agents.ts` 不只是调服务，还会直接读取 `runtime.getRuntimeStore()` 上的对象：

- principal / organization
- authAccounts
- agent message
- mailbox entry

见 [http-agents.ts](/home/leyi/projects/themis/src/server/http-agents.ts:328) 一带。

这说明 Phase 1 不能只改服务构造器，还要顺手收敛 handler 对底层 store 的直接穿透。

### 2.4 现有 SQLite registry 已经包含完整 agent 控制面语义

当前 [codex-session-registry.ts](/home/leyi/projects/themis/src/storage/codex-session-registry.ts:1938) 已经把下面这些对象都落了存储方法：

- `organization`
- `managed_agent`
- `workspace_policy`
- `runtime_profile`
- `work_item`
- `run`
- `mailbox`
- `message`
- `handoff`
- `audit_log`
- `spawn_policy`
- `spawn_suggestion_state`

所以 Phase 1 不需要推翻现有对象语义，重点是“把访问方式抽象出来”。

## 3. Phase 1 范围

### 3.1 包含

- 控制面对象边界冻结
- 服务层到存储层的接口抽象
- SQLite 适配器首版
- 最小 MySQL schema 原型
- 最小平台 API 原型
- 现有 handler 对底层 runtime store 穿透的收敛

### 3.2 不包含

- Worker Node
- `node` 心跳与能力模型
- `execution_lease`
- 远端执行
- 主 Themis gateway 化
- Personal Themis 接入
- 全量数据迁移脚本

## 4. 设计原则

### 4.1 先抽接口，不先改业务对象

这一阶段不建议把：

- `managed_agent`
- `work_item`
- `mailbox`
- `handoff`
- `run`

这些对象全部重命名成平台风格的新名字。先保持现有语义，优先抽访问边界。

### 4.2 接口按服务职责切，不做一个巨型万能 store

当前最自然的切法不是再造一个更大的 `registry`，而是按服务边界拆成几个窄接口：

- `ManagedAgentsStore`
- `ManagedAgentCoordinationStore`
- `ManagedAgentSchedulerStore`
- `ManagedAgentExecutionStateStore`

这样改造时每个服务只依赖自己真正需要的方法，后续 MySQL 适配也更容易渐进推进。

### 4.3 先做 SQLite 适配器，再做 MySQL 原型

第一步不是直接让服务层吃 MySQL，而是：

1. 先让服务层依赖抽象接口
2. 用现有 SQLite registry 做第一个适配器
3. 再在此基础上补 MySQL 原型

这样 Phase 1 结束时，主链还能继续跑现有实现，不会因为平台化第一刀把当前链路打断。

### 4.4 平台 API 首刀必须可复用，不要绑死当前主 HTTP server

平台 API 原型的目标不是“在现有 Themis UI 里再加几条接口”，而是为后续独立控制面服务留边界。

所以建议 Phase 1 就把相关 handler 写成可复用模块，后续既能挂在当前 server，也能挂在独立 platform server。

## 5. 推荐模块边界

### 5.1 新增：控制面 store 接口定义

建议新增：

- `src/storage/managed-agent-control-plane-store.ts`

职责：

- 定义数字员工控制面相关的窄接口
- 不包含 SQLite / MySQL 细节

建议至少包含 4 组接口：

1. `ManagedAgentsStore`
   负责 organization、principal、managed agent、spawn policy、workspace/runtime profile。
2. `ManagedAgentCoordinationStore`
   负责 work item、message、mailbox、handoff、按 work item 的 run 查询。
3. `ManagedAgentSchedulerStore`
   负责 runnable claim、stale run recovery、run / work item 状态流转。
4. `ManagedAgentExecutionStateStore`
   负责执行层仍然需要的少量状态读写，例如 `getAgentWorkItem`、`getManagedAgent`、session task settings 读写。

### 5.2 新增：SQLite 控制面适配器

建议新增：

- `src/storage/sqlite-managed-agent-control-plane-store.ts`

职责：

- 包装现有 `SqliteCodexSessionRegistry`
- 实现上面的 4 组窄接口
- 把 Phase 1 的服务改造风险压到最小

这个适配器本质上是：

- 现有 SQLite 真相来源不变
- 但服务层不再知道它具体叫 `SqliteCodexSessionRegistry`

### 5.3 新增：MySQL 控制面原型

建议新增：

- `src/storage/mysql-managed-agent-control-plane-store.ts`

职责：

- 只先覆盖 Phase 1 必需的最小对象
- 先做 schema 映射与基本 CRUD / 查询原型
- 不在 Phase 1 承诺全量替换现有 SQLite 行为

Phase 1 的 MySQL 原型建议只覆盖：

- `principal`
- `organization`
- `managed_agent`
- `agent_workspace_policy`
- `agent_runtime_profile`
- `agent_work_item`
- `agent_run`

`mailbox / message / handoff / audit_log / spawn policy` 可以先保留 schema 设计，不要求首刀全部跑通。

### 5.4 新增：控制面门面

建议新增：

- `src/core/managed-agent-control-plane-facade.ts`

职责：

- 组合 `ManagedAgentsService`、`ManagedAgentCoordinationService`、`ManagedAgentSchedulerService`
- 为未来平台 API 暴露稳定入口
- 减少 `http-agents.ts` 直接去摸 runtime store 的情况

这层不是为了重新实现业务，而是为了：

- 把 HTTP 和 runtime 装配解耦
- 把“控制面能力集合”抽成一个未来可独立部署的边界

### 5.5 修改：核心服务构造器

建议修改：

- `src/core/managed-agents-service.ts`
- `src/core/managed-agent-coordination-service.ts`
- `src/core/managed-agent-scheduler-service.ts`
- `src/core/managed-agent-execution-service.ts`

目标：

- 从接收 `SqliteCodexSessionRegistry`
- 改成接收窄 store 接口

其中 `ManagedAgentExecutionService` 可以保守一点，先只把它改成依赖：

- `ManagedAgentExecutionStateStore`
- `ManagedAgentCoordinationService`
- `ManagedAgentSchedulerService`

不要在这一阶段把执行层也改成新的大门面。

### 5.6 修改：runtime 装配

建议修改：

- `src/core/app-server-task-runtime.ts`

目标：

- 统一通过 `SqliteManagedAgentControlPlaneStore` 构建数字员工相关服务
- 把后续切换 MySQL / platform store 的入口集中到这里

### 5.7 修改：HTTP handler

建议修改：

- `src/server/http-agents.ts`
- `src/server/http-server.ts`

目标：

- 尽量让 handler 走控制面门面或服务，而不是直接拿 `runtime.getRuntimeStore()`
- 为后续“当前 Themis 调远端平台 API”保留形状一致的调用边界

## 6. 分步实施顺序

### Step A：做方法盘点与接口冻结

先做一件很朴素但必须做的事：

- 把 4 个服务当前实际用到的 `registry.*` 方法列出来
- 按服务分组
- 冻结成窄接口

当前已确认的现实情况是：

- `ManagedAgentsService` 主要依赖 organization / principal / managed agent / spawn / boundary 相关方法
- `ManagedAgentCoordinationService` 主要依赖 work item / message / mailbox / handoff / run 查询
- `ManagedAgentSchedulerService` 主要依赖 runnable claim、stale run、run 与 work item 状态写回
- `ManagedAgentExecutionService` 额外依赖少量 session task settings

这一步的产出不是代码量，而是避免后面接口越抽越大。

### Step B：先落 SQLite 适配器，再改服务构造器

顺序建议是：

1. 新增控制面接口文件
2. 新增 SQLite 适配器
3. 改服务构造器签名
4. 让现有测试继续全部跑在 SQLite 适配器上

不要反过来先散改服务体内逻辑，否则很容易把改造做成大范围文本替换。

### Step C：补控制面门面，收敛 HTTP handler 穿透

重点收敛这些场景：

- handler 既调 service 又直接去 `runtimeStore` 取 principal / organization
- handler 自己拼装跨对象响应
- handler 未来难以平移到独立 platform server

这一步不要求把所有 handler 一次改完，但至少要先收敛：

- create / list / detail
- dispatch / work item detail / waiting respond
- run list / run detail

因为这些就是未来主 Themis 调平台时最先用到的主链。

### Step D：补 MySQL schema 与最小原型

这一刀建议保守：

- 先固定 schema
- 再做最小 CRUD / 查询
- 最后只跑最小 smoke，不做切主

这一步的目标不是立刻生产可用，而是验证 Phase 1 的抽象边界没有把 MySQL 适配逼成一团 if/else。

### Step E：补最小平台 API 原型

建议先做一组只覆盖主链的控制面接口原型，例如：

- `POST /api/platform/agents/create`
- `POST /api/platform/agents/list`
- `POST /api/platform/work-items/dispatch`
- `POST /api/platform/work-items/detail`
- `POST /api/platform/runs/list`

这组接口的意义不是替换现有 `/api/agents/*`，而是：

- 验证控制面是否已经能独立暴露
- 为后续主 Themis gateway 化预留调用面

## 7. 推荐里程碑

### Milestone 1：接口抽象完成，功能不变

完成标准：

- 3 个核心控制面服务不再引用 `SqliteCodexSessionRegistry` 类型
- 现有 managed-agent 相关测试仍通过

### Milestone 2：HTTP 主链不再直接摸 runtime store

完成标准：

- create / list / detail / dispatch / detail / runs 这几条主链不再直接穿透底层 store
- handler 主要依赖控制面门面或服务

### Milestone 3：MySQL 原型能跑最小读写

完成标准：

- MySQL 适配器至少能读写 `principal / organization / managed_agent / work_item / run`
- 有最小 contract 测试或 smoke 验证

### Milestone 4：平台 API 原型可独立挂载

完成标准：

- 控制面 API handler 不强耦合当前 `AppServerTaskRuntime`
- 未来可以抽到独立 platform server 进程

## 8. 验证方案

Phase 1 结束前，至少要保住下面这组验证：

- `npm run typecheck`
- `node --test --import tsx src/core/managed-agents-service.test.ts`
- `node --test --import tsx src/core/managed-agent-coordination-service.test.ts`
- `node --test --import tsx src/core/managed-agent-scheduler-service.test.ts`
- `node --test --import tsx src/core/managed-agent-execution-service.test.ts`
- `node --test --import tsx src/server/http-agents.test.ts`
- `node --test apps/web/modules/agents.test.js`
- `git diff --check`

如果引入了 MySQL 原型，还建议额外补：

- store contract test
- 最小平台 API smoke

## 9. 当前推荐的首个实施包

如果现在就要开工，我建议第一包只做下面 4 件事：

1. 定义 4 组控制面 store 接口。
2. 写 SQLite 控制面适配器。
3. 把 `ManagedAgentsService`、`ManagedAgentCoordinationService`、`ManagedAgentSchedulerService` 改成依赖窄接口。
4. 让 `AppServerTaskRuntime` 通过 SQLite 适配器装配这些服务。

这样做的好处是：

- 改动面可控
- 不会同时引入 MySQL 和 HTTP 重构
- 一旦这一包跑通，后面的 MySQL 原型和平台 API 都有落点

## 10. 当前不建议在 Phase 1 做的事

- 不要把 `ManagedAgentExecutionService` 一口气重构成“远端执行框架”
- 不要在这一阶段强推全量 MySQL 切主
- 不要先建独立 platform server 再回头补边界
- 不要先把前端改成调一个新的远端 API
- 不要顺手把对象名称、DTO 和返回结构全部推翻

## 11. 与其他文档的关系

- 平台方向与边界：见 [Themis 局域网多节点硅基员工平台方案（V1 草案）](./themis-silicon-employee-platform-v1.md)
- 总路线与阶段顺序：见 [Themis 局域网多节点硅基员工平台 / 分阶段落地计划](./themis-silicon-employee-platform-roadmap-plan.md)
- 当前单机实现事实：见 [Themis 持久化合伙人 / 数字员工架构设计](./themis-persistent-agent-architecture.md)
