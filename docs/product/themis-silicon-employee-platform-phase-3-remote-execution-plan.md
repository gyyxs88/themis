# Themis 局域网多节点硅基员工平台 / Phase 3 远端执行闭环实施计划

更新时间：2026-04-12 20:05 CST
文档性质：实施计划稿。目标是把平台化路线里的 `Phase 3 / 远端执行闭环` 收成可开工的第一版方案。

当前状态补充（2026-04-12）：

- `Phase 1 / 控制面底座` 已完成当前计划范围：控制面 `store` 抽象、SQLite/MySQL 原型、控制面门面，以及最小平台 API 已落地。
- `Phase 2 / 节点模型与调度租约` 已完成当前计划范围：
  - `node / execution_lease` 类型与 store 接口已固定
  - SQLite/MySQL 节点与租约 schema 已补齐
  - 平台 API 已新增 `/api/platform/nodes/register|heartbeat|list|detail|drain|offline`
  - scheduler 已接入最小节点匹配、`execution_lease` 回填，以及 TTL 过期节点自动收敛为 `offline`
- 当前还没有完成的是：**真正把一个已绑定到某个节点的 `run` 交给对应 Worker Node 去执行，并把执行状态回传到平台。**
- 当前第一刀已补到“平台侧 worker 协议”这一层：
  - 新增 `ManagedAgentWorkerService`
  - 平台 API 已新增：
    - `POST /api/platform/worker/runs/pull`
    - `POST /api/platform/worker/runs/update`
    - `POST /api/platform/worker/runs/complete`
  - `ManagedAgentExecutionService.runNext(...)` 现在遇到“已绑定节点租约”的 claim 时，会只做 claim，不再由平台主进程本机直接执行
- 当前还没有完成的是：**真正独立跑起来的 Worker Node 执行原型**。也就是说，平台现在已经能表达“节点拉任务 + 状态回传”的协议，但还没有把轻量 daemon / worker loop 本身接出来。

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

### 2.4 当前还没有真正的 Worker Node 运行形态

虽然平台现在已经知道“应该去哪台 node 跑”，但没有真正的轻量节点进程负责：

- 拉取被分配给自己的 run
- 调起本地 runtime 执行
- 把状态和结果回传平台

## 3. Phase 3 范围

这一阶段建议只做 5 件事：

- 轻量 Worker Node 最小进程
- 节点领取本节点待执行 run 的最小协议
- 节点对 run 状态的回传
- waiting / resume 的节点亲和性
- 节点失联后的最小租约恢复

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
4. 下一刀：新增 Worker Node 轻量执行原型
5. 先只支持一种最小执行路径：
   `managed agent -> app-server runtime`

这样第一包先验证 3 个问题：

- 平台和 Worker Node 的职责边界是否顺手
- 远端执行状态是否能平稳写回现有 `run/work_item` 状态机
- waiting 后的 node affinity 是否能保住

当前第一刀已经先验证了前两个问题里的“协议层”部分，下一刀再验证真正的 Worker 执行原型与 waiting node affinity。

## 7. 完成标准

这一阶段结束时，至少要满足：

- 平台能把某条已绑定节点的 run 发给对应 Worker Node
- Worker Node 能回传 `running / waiting / completed / failed`
- 人类回复后，任务优先回到原节点继续执行
- 节点失联时，lease 和 run 能收口到可解释状态

## 8. 验证方案

建议至少保住下面这组验证：

- `npm run typecheck`
- Worker Node 最小协议测试
- 平台 run 状态回传测试
- waiting / resume 节点亲和性测试
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
