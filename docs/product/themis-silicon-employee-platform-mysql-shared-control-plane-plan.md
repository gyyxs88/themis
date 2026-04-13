# Themis 局域网多节点硅基员工平台 / MySQL Shared Control Plane 下一阶段实施计划

更新时间：2026-04-13 11:10 CST  
文档性质：实施计划稿。目标是把“平台层真正独立出来”的下一阶段收成可开工的工程任务，而不是继续停留在口头共识。

## 1. 这份计划解决什么问题

上一轮已经完成两件关键准备：

- `ProjectWorkspaceBinding` 首轮闭环已经接通，平台现在能把“这个项目继续在哪个工作区、偏好哪台节点”持久化成控制面事实。
- managed-agent runtime 装配已经拆出 `shared control plane` 与 `local execution state` 的边界，并支持先把 shared control plane 指到独立 SQLite 文件。

因此下一阶段不该再泛泛说“以后上 MySQL”，而应该明确成这件事：

**让平台进程真正把 managed-agent shared control plane 落到 MySQL，同时继续把本地 `session task settings` 等执行态留在各自节点本机。**

这一步做完后，平台层才算从“逻辑独立 + 物理上仍偏 SQLite 原型”进入“独立平台服务 + MySQL 真控制面”的可切主状态。

## 2. 当前代码事实

### 2.1 已经具备的前提

- `CodexTaskRuntime` 与 `AppServerTaskRuntime` 已支持注入统一的 `ManagedAgentControlPlaneStore`。
- 当前已支持通过 `createSplitManagedAgentExecutionStateStore(...)` 拆开：
  - `sharedStore`
  - `executionStateStore`
- 当前已支持通过 `THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE` 把 managed-agent shared control plane 切到独立 SQLite 文件。
- `createThemisHttpServer(...)` 已会优先复用显式注册的 `app-server` runtime，不会再偷偷 new 一套默认本地 runtime 把平台路由绕回 SQLite。

这意味着“平台层独立 wiring”这条缝已经开出来了，后面不需要再先拆运行时边界。

### 2.2 当前 MySQL store 仍然只是异步原型，不是可切主实现

当前 [src/storage/mysql-managed-agent-control-plane-store.ts](/home/leyi/projects/themis/src/storage/mysql-managed-agent-control-plane-store.ts) 已经覆盖了这些对象的最小 round-trip：

- `principal`
- `organization`
- `managed_agent`
- `workspace_policy`
- `runtime_profile`
- `work_item`
- `run`
- `node`
- `execution_lease`

但它现在仍然有两个硬缺口：

1. 方法集合不完整  
当前还没补齐 `ProjectWorkspaceBinding`、`mailbox / message / handoff`、`spawn policy / spawn suggestion`、`audit log` 等现有平台主链真实依赖的控制面对象和查询。

2. 调用模型不兼容  
当前 `MySqlManagedAgentControlPlaneStore` 是 `async/await + Promise` 风格，而现有 `ManagedAgentsService / ManagedAgentCoordinationService / ManagedAgentSchedulerService` 仍是同步 store 接口。

也就是说，**现在不能直接把 `MySqlManagedAgentControlPlaneStore` 塞进现有 managed-agent service。**

### 2.3 当前真正该切到 MySQL 的只有 shared control plane

下一阶段不要把所有运行时数据都搬进 MySQL。

当前必须继续留在本机 SQLite / runtime store 的，至少包括：

- `session task settings`
- thread/session/history
- 本机 auth 运行态
- 本机 `CODEX_HOME` 相关执行材料

换句话说，下一阶段要切的是：

- `managed_agent / project_binding / work_item / run / node / execution_lease / mailbox / handoff / audit`

而不是把 Themis 整个 runtime 数据库都 MySQL 化。

## 3. 下一阶段目标

下一阶段只解决三件事：

1. 让平台进程能把 shared control plane 真正落到 MySQL  
2. 保持本地 execution state 继续留在本机 runtime store  
3. 让平台 API 在不改变业务语义的前提下，读写 MySQL 真相源

如果这三件事都做到，平台层就算真正独立出去了。

## 4. 明确不做什么

本阶段不做下面这些事：

- 不让主 Themis 直接连 MySQL 读写控制面  
  主 Themis 继续优先走 `/api/platform/*`
- 不让 Worker Node 直接连 MySQL  
  Worker 继续通过平台 API 拉 run、回传状态
- 不把 thread/session/history/auth 全部迁到 MySQL
- 不在同一阶段同时做 Personal Themis 接入
- 不在同一阶段同时做公网节点、高可用控制面或多控制面共识

## 5. 推荐拆分顺序

### Step A：先抽异步 shared control plane 契约

第一刀不要先补更多 SQL。

先把“平台 shared control plane 应该暴露什么能力”单独抽成异步契约，例如：

- `ManagedAgentSharedControlPlaneStoreAsync`
- 或更窄的 `ManagedAgentsStoreAsync / ManagedAgentCoordinationStoreAsync / ManagedAgentSchedulerStoreAsync`

目标是把“平台真相源”从当前同步 SQLite 形态中解开。

这一刀完成标准：

- 平台层依赖的 store 契约已经允许 Promise
- 本地 `executionStateStore` 仍保持同步、本地
- 运行时装配可以显式表达“shared async + local sync”的双通道

### Step B：补齐 MySQL 控制面对象覆盖面

第二刀再补 MySQL 侧缺的对象和查询，不要反过来。

至少要补齐：

- `ProjectWorkspaceBinding`
- `message`
- `mailbox`
- `handoff`
- `audit_log`
- `spawn_policy`
- `spawn_suggestion_state`

还要补齐现有服务真实依赖的 list/query 视图，例如：

- 按 owner / organization / target / parent 查询
- runnable claim / stale run recovery 相关查询
- waiting / governance / collaboration 读面所需查询

这一刀完成标准：

- 当前平台 API 主链依赖的控制面事实，MySQL 都已有可用实现
- 不再停留在 “只会 get/save 单条记录” 的原型态

### Step C：把平台 service/facade 接到异步 shared control plane

第三刀才是 service 层适配。

推荐方向不是硬把现有所有 service 全改成 async，而是优先收敛平台路径：

- 平台进程使用 async shared control plane service/facade
- 本地 execution service 继续使用本地 execution state
- 必要时通过适配层把现有同步业务对象语义迁到异步 shared store

这一刀完成标准：

- 平台 API 已经能用 MySQL 真相源跑主链
- 本地 execution state 没被误搬到 MySQL
- `scheduler / node / lease / project binding` 仍保持现有业务语义

### Step D：补独立平台进程入口与配置

在 service 能跑之后，再补真正的独立入口。

建议新增明确的平台启动入口与配置，例如：

- `THEMIS_PLATFORM_CONTROL_PLANE_DRIVER=sqlite|mysql`
- `THEMIS_PLATFORM_MYSQL_URI`
- 或 `HOST / PORT / USER / PASSWORD / DATABASE`

同时固定：

- 平台进程如何 `ensureSchema`
- 平台进程如何启动 scheduler tick
- 平台进程如何装配 shared MySQL + local execution state SQLite

这一刀完成标准：

- 平台进程能独立启动
- MySQL 是平台控制面真相源
- 本地 runtime store 仍只负责本地执行态

### Step E：补烟测、回归和切换文档

最后再补：

- MySQL round-trip 烟测扩到当前真实主链对象
- 平台 API 回归
- `claim / lease / reclaim / waiting resume / sticky project binding` 回归
- 切换文档和回退文档

这一刀完成标准：

- 可以在正式切换前做一套固定验收
- 出问题时知道怎么从 MySQL 平台回退

## 6. 建议的 Todoist 子任务

建议按下面四个子任务推进：

1. `MySQL shared control plane 契约与运行时适配`
2. `MySQL control plane 补齐项目绑定与协作事实`
3. `平台进程独立启动入口与 MySQL wiring`
4. `MySQL 控制面烟测、回归与切换文档`

## 7. 风险点

### 7.1 最大风险不是 SQL，而是调用模型

当前最大的技术风险不是 MySQL schema，而是：

- 现有 service 是同步接口
- 现有 MySQL store 是异步接口

如果这一层不先设计清楚，后面很容易出现：

- 一半同步一半异步
- service 里混进大量 if/else 分支
- 平台路径和本地路径逻辑分叉

### 7.2 调度语义不能在切库时变形

尤其要保住这些语义：

- `sticky` 项目连续性不能静默漂移
- 一个 run 最多一个 active execution lease
- waiting 恢复优先回原节点
- offline / reclaim 后的重排与接管

如果切 MySQL 时把这些语义做丢了，平台层虽然“物理独立”了，但行为会退化。

## 8. 完成标志

当下面几件事同时成立时，下一阶段才算完成：

- 平台进程默认使用 MySQL 作为 shared control plane 真相源
- 本地 execution state 仍明确留在本地 runtime store
- 平台 API 主链已经在 MySQL 上回归通过
- 主 Themis 与 Worker Node 不需要直连 MySQL
- 有固定的切换、验收和回退步骤

## 9. 一句话结论

下一阶段不是“把 SQLite 换成 MySQL”这么简单，而是：

**把平台控制面正式升级成“异步 shared control plane + 本地 execution state 分离”的结构，并让 MySQL 只承担它该承担的那一层真相源。**
