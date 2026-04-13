# Themis 三层并行开发约定

## 目标

在当前 Themis 形态下，把下面三层收成可以并行推进、但不会重新混成一锅的协作约定：

1. 平台层
2. 主 Themis 层
3. 数字员工 / Worker Node 层

这里的“并行开发”不是把仓库拆成三个互不相干的项目，而是：

- 继续在同一个仓库里开发
- 每层有自己明确的职责和主目录
- 跨层改动按契约联调

## 总原则

- 平台层负责“能不能、在哪里、怎么治理、怎么审计”。
- 主 Themis 负责“该不该、谁来做、怎么组织协作”。
- Worker Node 负责“在某台机器上真实执行”。
- 主 Themis 仍是组织级主 Agent，不因为平台独立而退化成纯转发壳。
- 平台层是控制面，不在“没有匹配节点”时本机兜底执行数字员工任务。
- Worker Node 不绕过平台直接写共享控制面事实。

## 每层主要负责什么

### 1. 平台层

主要负责：

- 独立平台进程
- shared control plane
- `/api/platform/*`
- 节点注册、心跳、调度、租约、回收
- 项目绑定、组织级治理、平台鉴权

当前主要目录和文件：

- `src/server/platform-main.ts`
- `src/server/http-platform.ts`
- `src/core/managed-agent-scheduler-service.ts`
- `src/core/managed-agent-node-service.ts`
- `src/core/managed-agent-worker-service.ts`
- `src/core/managed-agent-control-plane-*`
- `src/storage/*managed-agent-control-plane*`
- `src/storage/codex-session-registry.ts`

默认不应该顺手改进去的东西：

- Web / 飞书产品壳交互
- 主 Themis 的组织主责判断
- Worker 本地环境探测和本地执行细节

### 2. 主 Themis 层

主要负责：

- Web / 飞书入口
- 人类对话
- 任务理解、拆解、派工和协作
- 主 Agent 自己执行时的行为
- 对平台事实的 product-shell 映射

当前主要目录和文件：

- `src/server/main.ts`
- `src/server/http-agents.ts`
- `src/core/managed-agent-platform-gateway-client.ts`
- `src/core/managed-agents-service.ts`
- `src/core/managed-agent-coordination-service.ts`
- `apps/web/modules/agents.*`
- 飞书入口相关文件

默认不应该顺手改进去的东西：

- 平台节点租约和后台 reclaim 细节
- Worker daemon 本地 heartbeat / pull / complete 实现
- MySQL mirror wiring 细节

### 3. Worker Node 层

主要负责：

- 节点预检
- `register -> heartbeat -> pull -> execute -> report`
- 本地工作区、credential、provider 能力声明
- 本地执行边界校验
- 节点值守和治理 CLI

当前主要目录和文件：

- `src/core/managed-agent-worker-daemon.ts`
- `src/core/managed-agent-worker-execution-service.ts`
- `src/core/managed-agent-platform-worker-client.ts`
- `src/diagnostics/worker-node-diagnostics.ts`
- `src/diagnostics/worker-fleet-diagnostics.ts`
- `src/diagnostics/worker-fleet-governance.ts`
- `src/cli/main.ts` 里 `worker-node / worker-fleet / doctor worker-*`

默认不应该顺手改进去的东西：

- 平台 shared control plane 存储结构
- 主 Themis 的产品壳接口语义
- 人类侧组织协作和 manager 视图

## 三类共享契约

三层可以并行开发，但下面三类契约一改就不能只看单层：

### 1. 平台 API 契约

包括：

- `/api/platform/*`
- Bearer token 角色边界
- 主 Themis 的 platform-first 读写行为

涉及文件通常包括：

- `src/server/http-platform.ts`
- `src/server/http-agents.ts`
- `src/core/managed-agent-platform-gateway-client.ts`

### 2. 节点协议契约

包括：

- `worker/runs/pull`
- `worker/runs/update`
- `worker/runs/complete`
- node heartbeat / drain / offline / reclaim
- lease 语义

涉及文件通常包括：

- `src/core/managed-agent-worker-service.ts`
- `src/core/managed-agent-worker-daemon.ts`
- `src/core/managed-agent-scheduler-service.ts`
- `src/server/http-platform.ts`

### 3. 项目连续性契约

包括：

- `ProjectWorkspaceBinding`
- `workspacePolicySnapshot`
- `preferredNodeId / lastActiveNodeId`
- `continuityMode`
- 执行边界保存与执行期本地校验

涉及文件通常包括：

- `src/core/managed-agent-coordination-service.ts`
- `src/core/managed-agents-service.ts`
- `src/core/managed-agent-scheduler-service.ts`
- `src/core/session-workspace.ts`
- `src/core/managed-agent-worker-daemon.ts`

## 目录归属和改动判断

后续接任务时，先判断它属于哪一层：

- 如果核心问题是“平台怎么调度、怎么回收、怎么治理”，按平台层任务处理。
- 如果核心问题是“主 Themis 怎么理解任务、怎么对人交互、怎么派工”，按主 Themis 任务处理。
- 如果核心问题是“节点怎么预检、怎么执行、怎么上报状态”，按 Worker 任务处理。
- 如果一个任务同时改动上述两层以上的共享契约，直接标记为“跨层契约任务”，不要假装它只是单层小改。

## 每层最小准入验证

所有层都先过这两个基础检查：

```bash
npm run typecheck
npm run build
```

### 平台层改动

至少补跑：

```bash
node --test --import tsx \
  src/server/http-platform.test.ts \
  src/core/managed-agent-scheduler-service.test.ts \
  src/core/managed-agent-control-plane-facade.test.ts
```

如果动到 MySQL mirror / shared control plane，再加：

```bash
node --test --import tsx \
  src/core/managed-agent-control-plane-mirror.test.ts \
  src/core/managed-agent-control-plane-mirror.mysql.test.ts \
  src/storage/mysql-managed-agent-control-plane-store.test.ts
```

### 主 Themis 层改动

至少补跑：

```bash
node --test --import tsx \
  src/server/http-agents.test.ts \
  src/core/managed-agents-service.test.ts \
  src/core/managed-agent-coordination-service.test.ts

node --test apps/web/modules/agents.test.js
```

如果动到执行边界或主 Agent 自执行，再补：

```bash
node --test --import tsx src/core/managed-agent-execution-service.test.ts
```

### Worker Node 层改动

至少补跑：

```bash
node --test --import tsx \
  src/core/managed-agent-worker-daemon.test.ts \
  src/core/managed-agent-worker-service.test.ts \
  src/diagnostics/worker-node-diagnostics.test.ts \
  src/diagnostics/worker-fleet-diagnostics.test.ts
```

如果动到节点执行链，再补：

```bash
node --test --import tsx src/core/managed-agent-worker-execution-service.test.ts
```

## 什么情况下必须做跨层验证

下面这些改动，不能只跑单层测试：

- 改 `/api/platform/*` 的请求或响应 shape
- 改 node / lease / reclaim 语义
- 改 `ProjectWorkspaceBinding`、`continuityMode`、`preferredNodeId` 相关逻辑
- 改执行边界保存和执行期工作区校验边界
- 改 `platform-main` 的后台 scheduler 或 execution wiring
- 改 Worker pull/update/complete 协议

这类改动至少要补跑受影响层的测试合集；如果改动碰到真实调度语义，优先再做一次局域网实机复验。

## 什么情况下需要重新做局域网实机联调

出现下面任一情况，优先复跑真实环境：

- 平台 scheduler 匹配逻辑改了
- sticky / replicated 连续性逻辑改了
- 节点 offline / reclaim / lease recovery 改了
- 平台层和 Worker 之间的协议改了
- 主 Themis 到平台的 project / workspace / dispatch 语义改了
- 同机三角色部署或双节点共享工作区约束改了

当前实机联调基线见：

- [首轮局域网联调清单](./themis-first-lan-joint-test-checklist.md)
- [单机三角色部署方案](./themis-single-host-three-role-deployment.md)

## 当前必须守住的边界

- 平台层独立后，平台不是公司合伙人，只是控制面。
- 主 Themis 接平台事实后，仍保留组织级主 Agent 身份和必要时自执行能力。
- Worker Node 负责本地校验工作区存在性；保存执行边界时只做绝对路径规范化，不要求控制面本机存在该目录。
- 共享工作区当前按节点上报的绝对路径字符串匹配；如果两台节点路径不一样，当前不会自动视为同一个工作区。
- 平台专用 scheduler 当前必须禁止 `node-less claim`；没有匹配节点时应保持排队或等待治理，而不是平台本机下场执行。

## 推荐的任务组织方式

以后新任务建议先标成下面四类之一：

- 平台层任务
- 主 Themis 任务
- Worker Node 任务
- 跨层契约任务

如果是跨层契约任务，在任务标题或说明里至少写清楚：

- 改了哪一层
- 触碰了哪条共享契约
- 需要跑哪些单测
- 是否需要做局域网实机复验

这样做的目的不是增加流程，而是避免后面再次出现“我以为只是平台层小改，结果把双节点 sticky 语义打穿了”这种回归。
