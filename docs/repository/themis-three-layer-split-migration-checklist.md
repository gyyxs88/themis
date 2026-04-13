# Themis 三层拆仓迁移清单

## 目标

把当前仓库里混放的三层代码，收敛成下面四类独立产物：

1. `themis-platform`
2. `themis-main`
3. `themis-worker-node`
4. `themis-contracts`

这里的重点不是“把目录搬干净”，而是：

- 平台、Themis、Worker 不再共用业务源码
- 页面和组件不再跨层复用
- 三层之间只通过显式契约联调

## 最终目标形态

### 1. `themis-platform`

负责：

- control plane
- `/api/platform/*`
- node / execution lease / scheduler / oncall
- 全局 managed-agent 治理
- 平台管理员页面
- 平台鉴权、审计、监控、备份恢复

### 2. `themis-main`

负责：

- 主 Themis 的 Web / 飞书入口
- 人类对话
- 当前 Themis 自己的历史、身份、配置、会话、运行参数
- 主 Agent 的任务理解、组织安排、派工
- 必要时主 Themis 自执行

### 3. `themis-worker-node`

负责：

- `register -> heartbeat -> pull -> execute -> report`
- Worker 本机预检
- 本机工作区 / credential / provider 能力声明
- 本机执行边界校验
- Worker 常驻与节点本机运维

### 4. `themis-contracts`

负责：

- 平台 API 契约
- Worker 协议契约
- 公共错误码 / DTO / schema
- 生成给 Themis / Worker 用的 client 或 SDK

这个仓可以是协议仓，也可以是由平台仓导出的独立契约包；但不能继续靠直接 import 平台或 Themis 业务源码来复用。

## 当前仓库里最危险的混层点

### 1. `src/server/http-server.ts`

当前问题：

- 同一个 HTTP server 同时挂 `Themis` 路由、`/api/platform/*` 路由和同一套静态页面。

当前进展：

- `2026-04-13` 首刀已完成：`platform-main` 现在显式以 `platform surface` 启动，`/` 不再回落到 `apps/web` 的主 Themis 静态壳，而是返回平台占位入口页；这一步只先切断“平台进程继续冒充主 Themis Web”的问题，平台独立后台仓与独立前端仍待后续迁移。
- `2026-04-13` 第二刀已完成：`platform surface` 现在会在 `/api/health` 之后直接拦掉所有非 `/api/platform/*` 的剩余 API，请求主 Themis 的 `runtime / task / history / identity` 这类接口时会返回 `PLATFORM_ROUTE_NOT_FOUND`，不再把 Themis 自己的 HTTP 能力顺手挂到平台进程上。

迁移目标：

- `themis-main` 只保留 Themis 自己的路由与页面。
- `themis-platform` 独立提供平台 API 与平台页面。

### 2. `src/server/platform-main.ts`

当前问题：

- 平台进程复用同一套 `createThemisHttpServer(...)`，导致技术上会挂出和 Themis 一样的页面壳。

当前进展：

- `2026-04-13` 已把 `platform-main` 切到独立 surface 语义：登录文案、`/api/health` 标识和根路径页面都改成 `Themis Platform`，并且不会再把 `apps/web` 静态资源直接暴露出来。

迁移目标：

- 平台仓单独维护平台 server 入口，不再复用 Themis Web 壳。

### 3. `apps/web/modules/agents.*` 与 `apps/web/index.html` 里的 `Agents` 面板

当前问题：

- 这块页面展示的已经不是“当前 Themis 自己的内容”，而是组织级 managed-agent 治理。
- 按新边界，这块应归平台层，不应继续留在主 Themis 页面里。

当前进展：

- `2026-04-13` 已补第一层语义收缩：当前主 Themis UI 已把这块显式改名为 `Platform Agents`，并通过 `/api/agents/list` 返回的 `compatibility` 状态与状态栏提示，把它标成“平台兼容面板”，不再继续伪装成主 Themis 的原生页面。
- `2026-04-13` 同日已继续做页面归属剥离：`Platform Agents` 不再留在主 Themis 的原生设置分类里，而是单独放到“外部平台兼容入口”；兼容状态里也会透出 `ownerPrincipalId`，让主 Themis 能直接跳去平台独立页。

迁移目标：

- 从 `themis-main` 剥离。
- 进入 `themis-platform` 的独立平台后台页面。

### 4. `src/server/http-agents.ts`

当前问题：

- 这层是 `Themis` 产品壳对 managed-agent / 平台事实的包装。
- 在新边界下，凡是全局 managed-agent 治理相关能力，都不应继续从主 Themis 暴露。

当前进展：

- `2026-04-13` 已补兼容状态显式化：`/api/agents/list` 现在会返回 `compatibility` 字段，明确区分 `platform_gateway / local_legacy / invalid_gateway_config` 三种兼容模式，用来告诉前端“这是平台兼容入口，不是主 Themis 自有面板”。
- `2026-04-13` 同日已继续补跳转上下文：`compatibility` 现在还会显式透出当前 `ownerPrincipalId`，让主 Themis 只保留“跳平台”的兼容职责，不再继续承担平台页面自己的入口状态装配。

迁移目标：

- 组织级 managed-agent 治理读写迁到 `themis-platform`。
- `themis-main` 如果还需要派工或查看“当前 Themis 自己的任务视角”，应重新定义 Themis 自己的最小语义，而不是继续借全局 `Agents` 面板。

### 5. `src/cli/main.ts` 里的平台与 Worker 命令混放

当前问题：

- `worker-node`、`worker-fleet`、`doctor worker-*` 与 Themis 主 CLI 当前仍混在同一个入口。

当前进展：

- `2026-04-13` 已补 `Phase 3` 第一刀：当前仓库已新增 `themis-platform` 与 `themis-worker-node` 两个独立 CLI 入口，以及 `src/cli/platform-main.ts` / `src/cli/worker-node-main.ts` 两个装配点；主 `themis` 入口里的 `auth platform`、`doctor worker-node`、`doctor worker-fleet`、`worker-node`、`worker-fleet` 仍可作为兼容别名使用，但会显式提示应迁往新入口。

迁移目标：

- `worker-node` 本机预检与常驻命令进入 `themis-worker-node`。
- `worker-fleet`、节点巡检和值班治理命令进入 `themis-platform`。
- `themis-main` 只保留 Themis 自己的 CLI。

## 当前代码迁移归属

下面这份归属不是“最终文件名设计”，而是“这批能力以后属于哪层”。

### A. 应迁到 `themis-platform`

- `src/server/platform-main.ts`
- `src/server/http-platform.ts`
- `src/server/http-web-access.ts` 里 `/api/platform/*` 鉴权相关逻辑
- `src/core/managed-agent-control-plane-*`
- `src/core/managed-agent-scheduler-service.ts`
- `src/core/managed-agent-node-service.ts`
- `src/core/managed-agent-lease-recovery.ts`
- `src/core/managed-agents-service.ts`
- `src/core/managed-agent-coordination-service.ts`
- `src/core/managed-agent-execution-service.ts`
- `src/storage/*managed-agent-control-plane*`
- `src/diagnostics/platform-backup.ts`
- `src/diagnostics/worker-fleet-diagnostics.ts`
- `src/diagnostics/worker-fleet-governance.ts`
- `apps/web/modules/agents.*`
- `apps/web/index.html` 里 `Agents` 面板相关 DOM
- `apps/web/modules/ui.js` / `dom.js` / `ui-markup.js` 里仅服务 `Agents` 治理台的部分

说明：

- `managed-agent` 的组织级治理、节点调度和值班语义都算平台层，不再算主 Themis 页面功能。

### B. 应留在 `themis-main`

- `apps/web/` 里除 `Agents` 治理台外，属于主 Themis 自己的页面
- `src/server/main.ts`
- `src/server/http-assets.ts`
- `src/server/http-auth.ts`
- `src/server/http-history.ts`
- `src/server/http-identity.ts`
- `src/server/http-runtime-config.ts`
- `src/server/http-task-*`
- `src/server/http-session-handlers.ts`
- `src/server/http-input-assets.ts`
- `src/server/http-updates.ts`
- `src/server/http-skills.ts`
- `src/server/http-mcp.ts`
- `src/server/http-plugins.ts`
- `src/server/http-actors.ts`
- `src/core/codex-*`
- `src/core/conversation-service.ts`
- `src/core/identity-link-service.ts`
- `src/core/principal-*`
- `src/core/session-*`
- `src/core/runtime-*`
- `src/core/task-*`
- `src/channels/feishu/*`
- 主 Themis 自己的 diagnostics / release / update 相关能力

说明：

- 主 Themis 仍保留主 Agent 身份和自执行能力，但不再托管平台全局后台。

### C. 应迁到 `themis-worker-node`

- `src/core/managed-agent-platform-worker-client.ts`
- `src/core/managed-agent-worker-daemon.ts`
- `src/core/managed-agent-worker-execution-service.ts`
- `src/core/managed-agent-worker-execution-contract.ts`
- `src/core/managed-agent-worker-service.ts` 里纯 Worker 本机执行相关部分
- `src/diagnostics/worker-node-diagnostics.ts`
- `src/cli/main.ts` 里 `worker-node` 和节点本机预检相关命令实现

说明：

- Worker 只关心怎么在本机执行，不关心平台后台页面，也不关心主 Themis 的人类入口。

### D. 应提取到 `themis-contracts`

- `src/contracts/managed-agent-platform-worker.ts`
- `managed-agent-platform-gateway-client.ts` 里的 DTO 和请求 shape
- `managed-agent-platform-worker-client.ts` 里的协议 shape
- `/api/platform/*` 对应 DTO、错误码、鉴权头约定
- Worker `pull / update / complete` 协议
- `ProjectWorkspaceBinding`、`continuityMode` 等跨层对象的 schema

当前进展：

- `2026-04-13` 已补 `Phase 4` 第一刀：当前仓库已新增 `src/contracts/managed-agent-platform-worker.ts`，先把 `nodes/register|heartbeat|list|detail|reclaim` 与 `worker/runs/pull|update|complete` 这组共享 DTO / payload 收到独立契约文件里；`src/server/http-platform.ts` 与 `src/core/managed-agent-platform-worker-client.ts` 已改成共同依赖这份契约，`ManagedAgentWorkerDaemon` 也不再继续传那些只为迁就旧 client 签名而存在的 `ownerPrincipalId` 空占位。当前这一步还没有覆盖 `gateway` DTO、平台错误码全集和 `ProjectWorkspaceBinding` schema，但已经先把平台层与 Worker 层最重的协议耦合点从业务实现里缝开。
- `2026-04-13` 同日已继续补 `Phase 4` 第二刀：当前仓库又新增 `src/contracts/managed-agent-platform-projects.ts`，把 `projects/workspace-binding/list|detail|upsert` 这组 DTO / payload 也从 `http-platform` 里抽出；与此同时，`ManagedAgentPlatformGatewayClient` 已正式补上 `list/get/upsert project workspace binding` 三个方法，并通过独立的 fake-fetch 测试把请求 shape 固定下来。到这一步，跨平台层 / 主 Themis / Worker 的共享契约已经不再只覆盖节点协议，也开始覆盖 `ProjectWorkspaceBinding` 这类真正的跨层连续性对象。
- `2026-04-13` 同日又补 `Phase 4` 第三刀：当前仓库已新增 `src/contracts/managed-agent-platform-work-items.ts`，把 `work-items/list|dispatch|detail|cancel|respond|escalate` 这组 DTO / payload / 结果类型从平台 server 本地接口里抽成独立契约；`http-platform` 与 `ManagedAgentPlatformGatewayClient` 已共同依赖这份契约，gateway client 测试也已把 `list / dispatch / respond / escalate / detail` 这组真实请求 shape 固定下来。这样主 Themis 当前正在用的协作主链路，也开始脱离“直接依赖平台业务源码里手写 payload”的旧模式。
- `2026-04-13` 同日继续补 `Phase 4` 第四刀：当前仓库已新增 `src/contracts/managed-agent-platform-collaboration.ts`，把 `runs/list|detail`、`agents/handoffs/list`、`agents/mailbox/list|pull|ack|respond` 这组 DTO / payload / 结果类型也从平台 server 本地接口里抽成独立契约；`http-platform` 与 `ManagedAgentPlatformGatewayClient` 已共同依赖该契约，gateway client 测试也已补齐 `runs / handoffs / mailbox` 这组 fake-fetch 覆盖。到这一步，主 Themis 当前正在用的核心协作读写主链，除了 `agents` 治理面和错误码外，已经基本都切到了显式契约。

说明：

- 这里共享的是契约产物，不是平台层业务实现源码。

## 迁移顺序

### 第 1 步：冻结新的混层扩张

- 不再往 `apps/web/modules/agents.*` 增加新平台功能。
- 不再往主 Themis 页面里加节点、租约、调度、值班面板。
- 不再往单一 `http-server.ts` 里堆新的跨层入口。

### 第 2 步：先抽契约

- 先固定平台 API、Worker 协议、错误码、DTO。
- 让 Themis 与 Worker 都改成依赖契约产物，而不是依赖平台业务源码。

### 第 3 步：先拆平台后台

- 单独建立 `themis-platform`。
- 把平台 API、节点调度、租约恢复、平台鉴权迁走。
- 把当前 `Agents` 治理台拆成平台后台页面。

### 第 4 步：再收缩主 Themis

- 从主 Themis 页面删除全局 `Agents` 治理台。
- 重新定义“主 Themis 自己该展示什么”。
- 保留对平台的调度调用，但不再保留平台后台职责。

### 第 5 步：拆 Worker 仓

- 把 Worker daemon、本机预检、本机执行链、节点常驻 CLI 拆出去。
- 平台侧的 `worker-fleet` 值班命令不要跟着进 Worker 仓。

### 第 6 步：清理过渡胶水

- 删除单仓里只为临时兼容存在的桥接层。
- 删除跨层页面组件复用。
- 删除“平台和 Themis 共用一套前端壳”的实现。

## 迁移完成标准

- 平台、Themis、Worker 各有独立代码仓。
- 平台页面不再出现在主 Themis 页面里。
- `platform-main` 不再复用 Themis Web 壳。
- Worker 仓不再携带人类页面。
- 三层之间不再直接 import 对方业务源码。
- 任何跨层依赖都能指向显式契约或生成 client。

## 过渡期规则

- 允许修 bug，但不允许继续把新能力堆进混层文件。
- 允许为拆分加过渡适配层，但适配层要标明“迁移用”，不能当长期架构。
- 新需求如果天然属于平台层，不要再先落进 Themis 页面再说。
- 新需求如果天然属于 Worker 本机执行，不要再挂到主 Themis CLI 里。
