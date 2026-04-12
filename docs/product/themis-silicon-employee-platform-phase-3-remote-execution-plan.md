# Themis 局域网多节点硅基员工平台 / Phase 3 远端执行闭环实施计划

更新时间：2026-04-12 19:34 CST
文档性质：实施计划稿。目标是把平台化路线里的 `Phase 3 / 远端执行闭环` 收成可开工的第一版方案。

当前状态补充（2026-04-12）：

- `Phase 1 / 控制面底座` 已完成当前计划范围：控制面 `store` 抽象、SQLite/MySQL 原型、控制面门面，以及最小平台 API 已落地。
- `Phase 2 / 节点模型与调度租约` 已完成当前计划范围：
  - `node / execution_lease` 类型与 store 接口已固定
  - SQLite/MySQL 节点与租约 schema 已补齐
  - 平台 API 已新增 `/api/platform/nodes/register|heartbeat|list|detail|drain|offline`
  - scheduler 已接入最小节点匹配、`execution_lease` 回填，以及 TTL 过期节点自动收敛为 `offline`
- 当前第一刀已补到“平台侧 worker 协议”这一层：
  - 新增 `ManagedAgentWorkerService`
  - 平台 API 已新增：
    - `POST /api/platform/worker/runs/pull`
    - `POST /api/platform/worker/runs/update`
    - `POST /api/platform/worker/runs/complete`
  - `ManagedAgentExecutionService.runNext(...)` 现在遇到“已绑定节点租约”的 claim 时，会只做 claim，不再由平台主进程本机直接执行
- 当前第二刀也已补上“进程内 Worker Execution 原型”：
  - 新增 `ManagedAgentWorkerExecutionService`
  - 已能在 Worker 侧复用现有 `ManagedAgentExecutionService.executeClaim(...)`，把 `pull assigned run -> 本地执行 -> 既有 run/work_item/lease 状态机收口` 接成最小闭环
  - `waiting_human / waiting_agent` 恢复时，旧 `execution_lease` 会先释放，scheduler 会优先把同一 `work item` 重新派回最近一次 `WAITING_RESUME_TRIGGERED` 对应的原节点
- 当前第三刀也已补上“真正独立跑起来的 Worker Node daemon / HTTP client / CLI 首版”：
  - 新增 `ManagedAgentPlatformWorkerClient`
  - 新增 `ManagedAgentWorkerDaemon`
  - 新增 `themis worker-node run`
  - Worker Node 现在已经会通过平台 HTTP 完成 `register / heartbeat / pull / update / complete`
  - 节点本地会按派工快照同步 `managed_agent / workspace policy / runtime profile`，并在 CLI 启动时把 `--credential` 声明的 auth account 预写到本地 runtime store
  - 平台侧 worker `update/complete` 也已直接驱动 waiting / 完成 / 失败副作用收口
- 当前第四刀又补上了“Worker Node 启动前预检 / 诊断入口”：
  - 新增 `WorkerNodeDiagnosticsService`
  - 新增 `themis doctor worker-node`
  - 当前会直接检查 SQLite 运行态、本地 `workspace / credential / provider` 能力声明，以及平台可达性与节点列表探测
  - CLI 会直接输出主诊断和建议动作，便于在 daemon 真启动前先排掉本地环境问题
- 当前第五刀又补上了“失联节点 lease 显式回收治理动作”：
  - 新增 `POST /api/platform/nodes/reclaim`
  - 新增 `ManagedAgentNodeService.reclaimNodeLeases(...)`
  - 当前只允许对 `offline` 节点执行，避免在线节点误回收导致重复执行
  - 运行中的 `work item` 会重新排回 `queued`，`waiting_human / waiting_agent` 会保留等待态，只回收对应活动租约
- 当前第六刀又补上了“失联节点 lease 自动回收”：
  - 新增共享 `managed-agent-lease-recovery` helper
  - scheduler tick 现在会先枚举活动 `execution_lease`
  - 对 `offline` 或心跳 TTL 已过期的节点，会先把节点状态收敛为 `offline + slotAvailable = 0`
  - 随后自动把对应活动 lease 收口成 `revoked`，把运行中的 `work item` 重新排回 `queued`，并保留等待态
- 当前第七刀又补上了“Worker Node 部署 / 常驻运行手册”：
  - 新增 `infra/systemd/themis-worker-node.service.example`
  - 新增 `docs/repository/themis-worker-node-systemd-service.md`
  - README 已补 Worker Node 最小启动顺序与常驻文档入口
- 当前第八刀又补上了“真实节点部署演练 + fresh credential 预检补齐”：
  - 已在独立目录里完成 `doctor worker-node -> worker-node run --once -> systemd --user enable --now` 的真实本地演练
  - 平台能看到对应在线节点，证明 `register / heartbeat / 常驻运行` 主链路已经通
  - `WorkerNodeDiagnosticsService` 现在会在 runtime store 之外继续检查对应 `codex-home/auth.json`，fresh 节点只要认证材料已经在位，就不会再被误判成缺失 credential
- 当前第九刀又补上了“巡检 / 排障 / 多节点值守手册”：
  - 已新增独立 `Worker Node` 运维 runbook
  - 当前值守顺序已经固定成 `systemd --user -> doctor worker-node -> nodes/list -> nodes/detail -> drain/offline/reclaim`
  - 多节点场景下也已固定“独立目录、独立服务名、稳定节点名、能力声明真实对齐”这套值守约定
- 当前下一步已经切到运维闭环剩余项：继续补更贴近真实值班的巡检动作和批量治理，而不是再重复设计 daemon 协议。

## 1. 目标

这一阶段只解决一件事：

**让“节点归属”从平台中的静态事实，升级成真实可运行的远端执行闭环。**

完成后应该达到的效果是：

- 平台能把某个已绑定节点的 `run` 交给对应 Worker Node
- Worker Node 能把 `running / waiting / completed / failed` 回传给平台
- `waiting_human` 或 `waiting_agent` 恢复时，优先回到原节点继续执行

## 2. 当前代码事实

进入 Phase 3 前，当前仓库已经具备 4 条关键前提：

### 2.1 平台已经能表达“哪台机器应该执行”

当前 scheduler claim 后已经会创建 `execution_lease`，并把 `run -> node` 绑定成持久化事实。

### 2.2 平台已经能治理节点

当前节点不仅能注册、续心跳、列列表，还已经具备：

- TTL 过期自动下线
- 显式 `draining`
- 显式 `offline`
- 带租约上下文的 detail 视图

### 2.3 执行模型天然需要节点亲和性

当前 managed agent 执行里，`waiting_human` / `waiting_agent` 恢复后会继续复用同一条 work item 的上下文。

这意味着：

- 任务恢复时最好优先回原节点
- `execution_lease` 不能只是“调度瞬间变量”，而要继续参与恢复逻辑

### 2.4 当前已有 Worker Node 运行形态与预检入口首版，而且真实部署演练已跑通，但部署与运维面还没完全收口

虽然平台现在已经有真正的轻量节点进程首版，但后续仍需要把部署前提与运维动作固定清楚：

- 节点本地凭据、provider 与 capability 声明要保持一致
- daemon 启动前需要有固定的预检入口，避免带着错误配置直接进运行环
- 失联节点上的活动 lease 不能只停在 `offline` 状态，既要能人工治理，也要能在 scheduler tick 内自动收口
- daemon 部署和启动参数要有固定说明
- 节点失联后的部署诊断、巡检和人工治理动作还要继续补齐

## 3. Phase 3 范围

这一阶段建议只做 7 件事：

- 轻量 Worker Node 最小进程
- 节点领取本节点待执行 run 的最小协议
- 节点对 run 状态的回传
- waiting / resume 的节点亲和性
- 节点失联后的最小租约恢复
- 节点启动前的本地预检与平台可达性诊断
- 失联节点 lease 的自动恢复

当前不做：

- 跨节点热迁移
- 自动工作区同步
- 跨公网节点
- 多种 transport 并行

## 4. 推荐运行模型

这一阶段更推荐 **平台中心调度 + Worker Node 轮询拉取**，而不是一开始就做平台主动推送。

原因很简单：

- 局域网 V1 更容易部署
- 不需要先解决平台主动连入每台节点的复杂网络问题
- 更适合后续演进成跨机器 daemon

推荐的最小链路是：

1. 平台 scheduler 继续负责 claim queued work item，并创建 `run + execution_lease`
2. Worker Node 通过 `nodeId` 周期性轮询“分配给我、但尚未开始执行”的 run
3. Worker Node 拉到 run 后，在本机用受限 runtime 执行
4. Worker Node 把 `starting / running / waiting / completed / failed` 回传平台
5. 如果 run 进入 waiting，平台保留 node affinity；恢复时优先再派回同一节点

## 5. 推荐对象与接口边界

### 5.1 Worker Node 进程

建议先做一个轻量 daemon，而不是完整 Themis 实例。

它至少要负责：

- 节点注册 / heartbeat
- 拉取 assigned run
- 启动本地执行器
- 回传运行状态

### 5.2 平台 API

这一阶段建议新增 3 组最小接口：

- 节点拉任务：
  - 例如 `POST /api/platform/worker/runs/pull`
- 节点回传状态：
  - 例如 `POST /api/platform/worker/runs/update`
- 节点提交完成结果：
  - 例如 `POST /api/platform/worker/runs/complete`

当前不要求 API 名字完全固定，但职责边界要固定：

- “谁来拉活”
- “状态怎么上报”
- “完成后如何收口”

### 5.3 本地执行器

Worker Node 第一刀优先复用现有 `AppServerTaskRuntime` / managed agent 执行主链，而不是另起一套执行协议。

原则是：

- 优先复用现有 session / thread 语义
- 优先沿用当前 `run/work_item` 状态机
- 不在这一步重写 managed agent 执行核心

## 6. 推荐第一包

如果按当前实现继续推进，Phase 3 第一包建议固定成：

1. 已完成：新增“节点拉自己待执行 run”的最小平台接口
2. 已完成：新增“节点回传 run 状态 / 完成收口”的最小平台接口
3. 已完成：平台主进程遇到 node-bound claim 时不再本机直接执行
4. 已完成：新增 Worker Node 轻量执行原型
5. 已完成：waiting / resume 会释放旧租约并优先回原节点
6. 已完成：把 Worker Execution 原型从进程内 service 抽成真正 daemon / worker loop
7. 已完成：补 `themis doctor worker-node`，让节点在启动前先校验本地能力与平台可达性
8. 已完成：补 `POST /api/platform/nodes/reclaim`，让 `offline` 节点上的活动 lease 能显式收口
9. 已完成：scheduler tick 会自动回收 `offline` 或 TTL 过期节点上的活动 lease
10. 先只支持一种最小执行路径：
   `managed agent -> app-server runtime`

这样第一包先验证 4 个问题：

- 平台和 Worker Node 的职责边界是否顺手
- 远端执行状态是否能平稳写回现有 `run/work_item` 状态机
- waiting 后的 node affinity 是否能保住
- 旧 waiting run 的租约与节点槽位是否能正确释放后再重派
- 独立节点按文档部署后，预检、一次性启动和 `systemd --user` 常驻是否真能跑通

当前这一包已经把“协议层 -> 执行原型 -> daemon 化 -> 启动前预检 -> 失联 lease 显式回收 -> scheduler 自动回收 -> 部署与常驻说明 -> 真实 systemd 演练 / fresh credential 预检补齐 -> 巡检/排障/多节点值守手册”这九个最小环节都接通；下一刀不再是重复补协议，而是继续做更细的巡检治理与运维文档收口。

## 7. 完成标准

这一阶段结束时，至少要满足：

- 平台能把某条已绑定节点的 run 发给对应 Worker Node
- Worker Node 能回传 `running / waiting / completed / failed`
- 人类回复后，任务优先回到原节点继续执行
- 节点失联时，lease 和 run 能收口到可解释状态
- 当前已完成到“独立 Worker Node daemon + `doctor worker-node` 启动前预检 + `nodes/reclaim` 显式 lease 回收 + scheduler 自动失联恢复 + 部署 / systemd 常驻文档 + 真实 `systemd --user` 演练 + 运维 runbook”；后续主要只差更完整的常驻运维 / 巡检动作

## 8. 验证方案

建议至少保住下面这组验证：

- `npm run typecheck`
- Worker Node 最小协议测试
- Worker Node 预检 / 诊断测试
- 节点 reclaim 治理测试
- scheduler 自动失联恢复测试
- 平台 run 状态回传测试
- waiting / resume 节点亲和性测试
- `themis doctor worker-node` CLI 回归
- `git diff --check`

## 9. 当前不建议在 Phase 3 做的事

- 不做多 transport 并存
- 不做跨网节点
- 不做跨节点无感迁移
- 不做节点本地目录同步成分布式文件系统

## 10. 与现有文档的关系

- 总路线：见 [Themis 局域网多节点硅基员工平台 / 分阶段落地计划](./themis-silicon-employee-platform-roadmap-plan.md)
- Phase 1：见 [Themis 局域网多节点硅基员工平台 / Phase 1 控制面底座实施计划](./themis-silicon-employee-platform-phase-1-control-plane-plan.md)
- Phase 2：见 [Themis 局域网多节点硅基员工平台 / Phase 2 节点模型与调度租约实施计划](./themis-silicon-employee-platform-phase-2-node-model-plan.md)
