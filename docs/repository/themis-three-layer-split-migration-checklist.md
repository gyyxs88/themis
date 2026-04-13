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

迁移目标：

- 从 `themis-main` 剥离。
- 进入 `themis-platform` 的独立平台后台页面。

### 4. `src/server/http-agents.ts`

当前问题：

- 这层是 `Themis` 产品壳对 managed-agent / 平台事实的包装。
- 在新边界下，凡是全局 managed-agent 治理相关能力，都不应继续从主 Themis 暴露。

迁移目标：

- 组织级 managed-agent 治理读写迁到 `themis-platform`。
- `themis-main` 如果还需要派工或查看“当前 Themis 自己的任务视角”，应重新定义 Themis 自己的最小语义，而不是继续借全局 `Agents` 面板。

### 5. `src/cli/main.ts` 里的平台与 Worker 命令混放

当前问题：

- `worker-node`、`worker-fleet`、`doctor worker-*` 与 Themis 主 CLI 当前仍混在同一个入口。

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

- `managed-agent-platform-gateway-client.ts` 里的 DTO 和请求 shape
- `managed-agent-platform-worker-client.ts` 里的协议 shape
- `/api/platform/*` 对应 DTO、错误码、鉴权头约定
- Worker `pull / update / complete` 协议
- `ProjectWorkspaceBinding`、`continuityMode` 等跨层对象的 schema

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
