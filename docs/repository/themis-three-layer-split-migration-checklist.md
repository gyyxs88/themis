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

- `2026-04-13` 已补兼容状态显式化：`/api/agents/list` 现在会返回 `compatibility` 字段，明确区分 `platform_gateway / gateway_required / invalid_gateway_config` 三种兼容模式，用来告诉前端“这是平台兼容入口，不是主 Themis 自有面板”。
- `2026-04-13` 同日已继续补跳转上下文：`compatibility` 现在还会显式透出当前 `ownerPrincipalId`，让主 Themis 只保留“跳平台”的兼容职责，不再继续承担平台页面自己的入口状态装配。
- `2026-04-14` 已补第二刀纯 gateway 收口：当前主仓 `http-agents` 已不再回退本地 managed-agent 控制面，除了 `/api/agents/list` 仍保留兼容状态占位外，其余 `/api/agents/*` 都要求显式配置 `THEMIS_PLATFORM_*` 后再转发到平台控制面；未配置时会统一返回 `PLATFORM_AGENTS_GATEWAY_UNAVAILABLE`。同时 Web `Platform Agents` 兼容页也已改成“先读 `/api/agents/list`，若拿到 `gateway_required / invalid_gateway_config` 就停止继续请求治理接口”，因此主 Themis 当前只剩兼容入口，不再继续自己托管平台治理读写。
- `2026-04-14` 同日又补了页面层的第二刀：当前主 Themis Web 里的 `Platform Agents` 页面已经彻底降成纯跳转入口，只保留入口状态刷新与独立平台页直达链接；原先残留在主 Themis 里的组织级治理摘要、waiting queue、collaboration dashboard、spawn / idle recovery、dispatch、mailbox、handoff 和 execution boundary 表单都已从这页移除。到这一步，“主 Themis 继续宿主平台治理页面”这层旧语义也已经被切断。
- `2026-04-14` 同日又补了第三刀彻底收口：当前主仓已从运行时删除 `Platform Agents` 页面入口与控制器绑定，`/api/agents/*` 兼容路由也已整体下线并改成对 themis surface 的显式 `404 ROUTE_NOT_FOUND`；`src/server/http-agents.ts` 与 `apps/web/modules/agents.*` 也已从主仓删除。到这一步，`themis-main` 已不再保留平台页面入口或平台兼容 API，这组历史兼容层只剩文档/测试里的迁移痕迹。

迁移目标：

- 组织级 managed-agent 治理读写迁到 `themis-platform`。
- `themis-main` 如果还需要派工或查看“当前 Themis 自己的任务视角”，应重新定义 Themis 自己的最小语义，而不是继续借全局 `Agents` 面板。
- `2026-04-14` 当前这组兼容层在主仓里已实质迁完；后续只剩三仓联调和切换演练，不再需要回头给主 Themis 补任何 `/api/agents/*` 或 `Platform Agents` 页面壳。

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
- `2026-04-13` 同日继续补 `Phase 4` 第五刀：当前仓库已新增 `src/contracts/managed-agent-platform-agents.ts`，把 `agents/create|detail|execution-boundary/update|spawn-policy/update|spawn-approve|spawn-ignore|spawn-reject|spawn-restore|idle-approve|pause|resume|archive`，以及 `governance-overview|waiting/list|collaboration-dashboard` 这组治理 DTO / payload / 结果类型也从平台 server 本地接口与 gateway client 局部手写类型里抽成独立契约；`http-platform` 与 `ManagedAgentPlatformGatewayClient` 已共同依赖该契约，gateway client 测试也已补上 `agents/create / execution-boundary/update / spawn-policy/update / waiting/list` 这组 fake-fetch 覆盖。到这一步，主 Themis 当前仍在走的组织级治理主链，除了平台鉴权/错误码约定外，也已经收进显式契约。
- `2026-04-13` 同日继续补 `Phase 4` 第六刀：当前仓库已新增 `src/contracts/managed-agent-platform-access.ts`，把平台服务 Bearer 鉴权头格式，以及 `PLATFORM_ROUTE_NOT_FOUND / PLATFORM_SERVICE_AUTH_DENIED / PLATFORM_SERVICE_FORBIDDEN / PLATFORM_SERVICE_OWNER_MISMATCH` 这组平台专用错误响应也收成共享契约；`http-web-access`、`http-platform`、`http-server`、`ManagedAgentPlatformGatewayClient`、`ManagedAgentPlatformWorkerClient` 现已统一依赖这份契约，新补的 `src/contracts/managed-agent-platform-access.test.ts` 也把 header 与错误响应固定下来。到这一步，`/api/platform/*` 当前拆仓真正需要的 DTO、鉴权头和平台专用错误码，已经形成首轮完整的显式契约面。
- `2026-04-13` 同日已补 `Phase 5` 第一刀：当前仓库已新增 `scripts/bootstrap-split-repos.sh` 与 `scripts/bootstrap-split-repos.test.ts`，把 `themis-platform / themis-main / themis-worker-node / themis-contracts` 四个 sibling repo 的最小初始化流程固定成可复跑脚本；同时又新增 `docs/repository/themis-three-layer-phase-5-bootstrap-and-cutover.md`，把 CI / 发布 / 回归门槛与切换演练顺序固化下来。实机已验证：执行 `bash scripts/bootstrap-split-repos.sh ..` 后，当前仓同级目录已真实生成 `../themis-platform`、`../themis-main`、`../themis-worker-node`、`../themis-contracts` 四个 git 仓骨架；再次执行同一命令时，会按预期以“拒绝覆盖非空目录” fail-fast 收口。
- `2026-04-13` 同日已进入真实迁仓第一阶段：当前 sibling repo `../themis-contracts` 已不再只是骨架，现已落入 standalone 首包，包含 `managed-agent-platform-worker / projects / work-items / collaboration / agents / access` 六组模块、包根 `exports`、声明文件输出、最小测试与 CI；并已真实通过 `npm run test`、`npm run typecheck`、`npm run build`。这说明拆仓当前已经不止“准备好新目录”，而是已经开始把跨层显式契约真正移出主仓。
- `2026-04-13` 同日已继续推进真实迁仓第二阶段：当前 sibling repo `../themis-platform` 已开始直接通过 `file:../themis-contracts` 消费共享 `managed-agent-platform-access` 契约，落入独立 `src/server/platform-app.ts` 最小 server，并用共享 `PLATFORM_ROUTE_NOT_FOUND` 错误响应锁住非平台 API；这说明平台仓已经不再只是目录骨架，而是开始验证“平台 surface 直接依赖显式契约”的最小运行形态。
- `2026-04-13` 同日已继续推进真实迁仓第三阶段：当前 sibling repo `../themis-main` 已开始直接通过 `file:../themis-contracts` 消费共享治理与访问契约，落入 `src/platform/platform-gateway.ts` 的 waiting queue gateway 请求装配；sibling repo `../themis-worker-node` 也已开始通过同一依赖消费共享节点协议契约，落入 `src/platform/platform-worker-access.ts` 的 `nodes/register|heartbeat` 请求装配。三仓当前均已真实通过各自的 `npm run test`、`npm run typecheck`、`npm run build`，说明主 Themis / Worker 对独立契约仓的最小消费链路已经成立。
- `2026-04-14` 同日已继续推进 `themis-worker-node` 的真实执行主链：当前 `../themis-worker-node` 已新增 `src/platform/platform-worker-client.ts`、`src/worker/worker-node-daemon.ts`、最小 `worker-node run` CLI，以及 `src/diagnostics/worker-node-diagnostics.ts` 与 `doctor worker-node` 预检，开始自己承接 `register -> heartbeat -> pull -> execute -> report` 首版闭环，并能直接在新仓内检查本地 `workspace / credential / provider` 能力与平台可达性；同时也保留了共享契约驱动的请求装配层，并新增 daemon / diagnostics / CLI 自动化测试。到这一步，Worker 线已不再只是“会拼协议请求”，而是开始拥有真实执行循环和独立预检入口；当前剩余差口已收敛到真实本机执行器替换与更细的 `execute -> report` 回传。
- `2026-04-14` 同日已继续推进 `themis-worker-node` 的真实执行主链第二刀：当前 `../themis-worker-node` 已新增 `src/worker/worker-node-local-executor.ts`，会在本机真实检查目标工作区、采集 Git 摘要，并把执行结果落成 `infra/local/worker-runs/<runId>/report.json` 后再通过平台 `complete` 回传；`worker-node run` CLI 也已支持 `--report-root` 并会直接打印报告文件路径。到这一步，Worker 线已经不再只是“能拉任务再回一段字符串”，而是开始拥有真正的本机 report 产物；当前剩余差口已切到 `systemd` 模板/部署文档迁入与本地 runtime / `credential / provider` 装配继续收口。
- `2026-04-14` 同日已继续推进 `themis-worker-node` 的真实执行主链第三刀：当前 `../themis-worker-node` 已把 `infra/systemd/themis-worker-node.service.example` 与 `docs/worker-node-systemd-service.md` 一起迁入独立仓，节点常驻模板、`--report-root` 落点和部署顺序都开始由 worker 仓自己维护；主仓里的 `themis-worker-node` 部署说明与 systemd 经验文档也已明确改成镜像口径。到这一步，Worker 线当前剩余差口只剩本地 runtime / `credential / provider` 装配继续收口。
- `2026-04-14` 同日已继续推进 `themis-worker-node` 的真实执行主链第四刀：当前 `../themis-worker-node` 已把 credential/provider 解析抽成共享 runtime helper，并在执行前真实落下 `infra/local/worker-runtime/<runId>/runtime-context.json`、按需复制 `codex-home/auth.json` 与 `provider.json`；本机执行器和预检现在都走同一套本地装配语义。到这一步，这条 Worker 拆仓顺序线已经收口，不再留有“credential/provider 只停在字符串声明层”的尾巴。
- `2026-04-14` 同日已继续推进三仓切换演练前置 smoke：当前已确认四个 sibling repo 工作区都干净，`themis-platform / themis-worker-node` 仍直接消费 `file:../themis-contracts`，并已通过一次 `git fetch origin` 收平 `themis-worker-node` 之前因一次性 URL 推送留下的远端跟踪滞后。随后又用独立 `platform-home / main-home / worker-home` 跑通了最小本地联调：`themis-platform` 可独立返回 `/api/health`，`themis-main` 登录后对 `/api/agents/list` 稳定返回 `404 ROUTE_NOT_FOUND`，`themis-worker-node doctor worker-node` 与 `worker-node run --once` 能真实把节点注册到本地 platform，`themis-platform doctor worker-fleet` 也已能看到在线节点 `smoke-worker-node`。到这一步，`顺序 4` 已不再停留在“仓库都在”层面，而是开始有真实跨仓 smoke 事实支撑。
- `2026-04-14` 同日已继续推进真实部署联调准备：当前 `../themis-platform` 已补入独立 `infra/systemd/themis-platform.service.example`、`docs/themis-platform-systemd-service.md` 与运行态 `.gitignore` 规则；`../themis-worker-node` 也已补入根目录 `./themis-worker-node` 可执行入口、`bin` 映射与部署文档对齐。与此同时，主仓的 `README`、平台/Worker 镜像部署文档和首轮局域网联调清单也已统一改成 split repos 真实部署口径，并明确写死“`themis-platform` 与 `themis-worker-node` 当前都需要 sibling repo `../themis-contracts` 才能安装”。到这一步，真实部署前最大的入口级坑已经从“代码没拆出来”收敛到“后续是否继续把 contracts 从 file 依赖升级成正式发布产物”。
- `2026-04-14` 同日已继续推进真实三机部署联调：Worker W1（本机）与 Worker W2（`192.168.31.208`）都已成功从 monorepo 目录切到 split repo `themis-worker-node@0cc2420`，并分别补齐 sibling repo `themis-contracts@28c2fd3`；切换后两台机器都已通过 `themis-worker-node doctor worker-node` 复验，平台侧 `themis-platform doctor worker-fleet` 也确认 `node-4pjylh69` 与 `node-themis-prod-local` 继续在线。与此同时，主 Themis 机 `192.168.31.208` 也已从 `047127a` fast-forward 到公开仓 `89d4230`，复验后 Web 登录正常，`POST /api/agents/list` 已回到 `404 ROUTE_NOT_FOUND`。平台机 `192.168.31.212` 当前也已完成 split repo staging：`~/services/themis-contracts@28c2fd3`、`~/services/themis-platform-split-20260414@616dc22` 可独立 build，并已在 `127.0.0.1:3201` 跑通 bootstrap `/api/health`；但现网平台服务仍不能切到独立仓，因为当前 `themis-platform` 还缺真实 MySQL/shared control plane、现网 `Web Access + Bearer` 鉴权链与 scheduler/runtime 主链。到这一步，真实部署主阻塞已经从 Worker/Main 的“是否可独立部署”收敛到 `themis-platform` 独立仓的生产级 wiring 迁移。
- `2026-04-14` 同日已继续推进 `6.1.a / themis-platform 迁入真实 platform-main 与 runtime wiring` 第一刀：当前 `../themis-platform` 已补入 `src/config/project-env.ts`，并把 `src/server/platform-main.ts` 从固定 `127.0.0.1:3200` 的 bootstrap 启动改成会先读取仓库根目录 `.env/.env.local`，再按 `THEMIS_HOST / THEMIS_PORT` 起服务；默认监听也已改成更贴近现网部署的 `0.0.0.0:3100`，同时会输出可访问地址列表。该仓当前已真实通过 `src/server/platform-main.test.ts`、`npm run test`、`npm run typecheck`、`npm run build`。这说明平台独立仓的服务入口语义已经开始向真实 daemon 收口，但平台事实本身仍是 in-memory，离可替换现网平台还有 `Web Access/Bearer + MySQL shared control plane + scheduler/runtime` 三束主链差口。
- `2026-04-14` 同日又继续推进 `6.1.b / themis-platform 迁入 Web Access 与 Bearer 鉴权链` 第一刀：当前 `../themis-platform` 已补入 `src/server/platform-web-access.ts`、`src/server/platform-cookies.ts`，并把 `src/cli/platform-token-store.ts` 扩展到可做 Bearer secret 校验；`src/server/platform-app.ts` 也已新增 `protected` 访问模式，受保护平台路由现在支持最小 `Web 口令登录 + session cookie`，以及 `Platform Service Bearer` 的 `worker/gateway` 路由权限与 `ownerPrincipalId` 越权拦截。`src/server/platform-auth.test.ts` 已把“未登录拦截 / Web 登录 / Worker Bearer / owner&role 校验”锁住，且整仓 `npm run test`、`npm run typecheck`、`npm run build` 全部通过。到这一步，平台独立仓已不再缺最小登录与 Bearer 边界；当前平台机现网切换主阻塞进一步收敛到 `MySQL shared control plane + scheduler/runtime` 这两束主链。
- `2026-04-14` 同日又继续推进 `6.1.c / themis-platform 迁入 scheduler/runtime 主链` 第一刀：当前 `../themis-platform` 已在 `platform-workflow-service` 补入 `claimNextQueuedWorkItem(...)`，并在 `platform-worker-run-service` 新增 `assignQueuedWorkItem(...)`；`src/server/platform-app.ts` 的 `/api/platform/worker/runs/pull` 现在会在节点没有现成 assigned run 时，按所属组织挑选最高优先级 `queued work-item`，再结合 `projects/workspace-binding` 的 `lastActiveWorkspacePath / canonicalWorkspacePath` 自动生成新的 `run + execution lease + executionContract`。新增 `src/server/platform-app-runtime.test.ts` 已把“dispatch -> pull -> 自动分配 run/lease”最小闭环锁住，且整仓 `npm run test`、`npm run typecheck`、`npm run build` 全部通过。到这一步，平台独立仓已不再缺最小 scheduler/runtime 闭环；当前平台机现网切换主阻塞进一步收敛到 `MySQL shared control plane、runtime 持久化、scheduler tick` 这三束生产级 wiring。
- `2026-04-14` 同日又继续推进 `6.1.c / themis-platform 迁入 scheduler/runtime 主链` 第二刀：当前 `../themis-platform` 已新增 `platform-scheduler-service`，并让 `src/server/platform-main.ts` 按 `THEMIS_PLATFORM_SCHEDULER_INTERVAL_MS` 定期执行 `scheduler tick`；独立平台仓现在会自动扫描 `offline / draining` 节点上的 active lease，把对应 `run` 标成 `interrupted`、`execution lease` 标成 `revoked`，再把 `work-item` 重新排回 `queued`，供后续在线节点重新拉取。新增 `src/server/platform-scheduler-service.test.ts` 已把“离线 lease 自动回收 -> work-item 重新排队 -> 在线节点重新分配”最小闭环锁住，且整仓 `npm run test`、`npm run typecheck`、`npm run build` 全部通过。到这一步，平台独立仓已不再缺最小 scheduler tick；当前平台机现网切换主阻塞进一步收敛到 `MySQL shared control plane` 与 `runtime 持久化` 这两束生产级 wiring。
- `2026-04-13` 同日已确认远端仓映射：现有 `gyyxs88/themis` 直接作为 `themis-main` 正式仓继续收敛，不再额外新建一个同义的 `themis-main` GitHub 仓；本机 `../themis-main` 仅作为迁移演练 sibling repo 保留。与此同时，`../themis-platform` 与 `../themis-worker-node` 已分别接到 `gyyxs88/themis-platform` 与 `gyyxs88/themis-worker-node` 远端，并已把首个根提交推送到远端 `main`。
- `2026-04-14` 已继续推进平台仓真实迁移首刀：当前 `../themis-platform` 已开始直接托管 `apps/platform/*` 独立前端壳，并在本仓落入最小 `nodes/register|heartbeat|list|detail` API、内存节点仓与静态资源服务；该仓当前已真实通过 `npm run test`、`npm run typecheck`、`npm run build`。这意味着平台仓已经从“最小 JSON bootstrap”继续往前走到“独立平台页 + 最小节点控制面都开始由新仓自己提供”的阶段。
- `2026-04-14` 同日已继续补节点治理动作：当前 `../themis-platform` 已把 `nodes/drain|offline` API 和平台页对应按钮也迁入本仓，说明平台仓现在已经不只是“能看节点”，而是开始承接最小节点治理动作。`reclaim` 仍暂留在后续，因为主仓当前返回 shape 与 `themis-contracts` 里的共享类型还有一层差口，继续推进前应先补契约收口。
- `2026-04-14` 同日已继续收口 `nodes reclaim` 差口：当前 `../themis-contracts` 已把节点 detail / reclaim 的共享类型对齐到主仓真实返回 shape，随后 `../themis-platform` 也已基于新契约补入 `nodes/reclaim` API、平台页 `Reclaim` 按钮与 summary 展示。到这一步，平台仓的节点控制面已经从“只读列表”推进到“读 + drain/offline/reclaim 最小治理闭环”。
- `2026-04-14` 同日已继续收口 `worker-runs` 契约与平台迁移：当前 `../themis-contracts` 已把 `worker/runs/update|complete` 的共享结果结构、`run / executionLease` 状态枚举，以及 `waitingAction / completion result` payload 对齐到主仓真实 API；随后 `../themis-platform` 也已基于新契约补入 `worker/runs/pull|update|complete` 最小 API、内存 run 仓与 `pull -> starting -> running -> complete` 回归测试。到这一步，平台仓已不再只承接节点治理面，而是开始自己承接最小节点执行主链。
- `2026-04-14` 同日已继续把最小治理读面也往平台仓收口：当前 `../themis-platform` 已补入 `agents/governance-overview|waiting/list` 两组平台 API、`platform-governance-service` 派生层，以及独立平台页上的治理摘要、manager hotspots 和 waiting queue 面板。底层这次没有再平行造一套假数据，而是直接复用平台仓现有的 in-memory `workerRunService` 状态来派生治理摘要，因此 worker run 状态变化后，独立平台页的 waiting summary 也会一起刷新。到这一步，平台仓已经开始自己承接最小平台治理读面，而不再只停留在 nodes + worker-runs。
- `2026-04-14` 同日已继续把 recent runs 读面也往平台仓收口：当前 `../themis-platform` 已补入 `/api/platform/runs/list|detail` 两组 API，并在独立平台页上接入 recent runs 列表与当前选中 run detail。底层这次仍直接复用平台仓现有的 `workerRunService` 状态来提供 runs 列表和 detail，因此 recent runs、governance overview、waiting queue 现在都共享同一套平台事实，不再各自平行造内存视图。
- `2026-04-14` 同日已继续收口 `themis-platform` 独立 CLI：当前 `../themis-platform` 已新增独立 `themis-platform` CLI 入口、本地平台服务令牌存储、`doctor worker-fleet` 巡检摘要，以及 `worker-fleet drain|offline|reclaim` 最小治理命令；对应的节点读取/治理 client 和 diagnostics/governance 测试也已在新仓落下并真实通过 `npm run test`、`npm run typecheck`、`npm run build`。到这一步，平台仓已开始自己承接平台值班入口，而不再依赖主仓里的兼容 CLI。
- `2026-04-14` 同日已继续把协作读面也往平台仓收口：当前 `../themis-platform` 已补入 `/api/platform/agents/collaboration-dashboard|handoffs/list` 两组平台 API、`platform-collaboration-service` 派生层，以及独立平台页上的“父任务协作分组 + 当前选中 agent 的 handoff 时间线”首版只读面。与此同时，`../themis-contracts` 也已把 handoff / timeline 最小展示字段补齐到共享契约里，避免平台仓为了这组页面又回头依赖主仓本地类型。到这一步，平台仓当前的独立前端已经从 `nodes + governance + waiting + runs` 扩到 `nodes + governance + waiting + collaboration + handoffs + runs` 这一束。
- `2026-04-14` 同日已继续把 `mailbox + work-items` 协作读写面也往平台仓收口：当前 `../themis-contracts` 已把 mailbox item、`leased` 状态与 mailbox respond result 这组共享 shape 对齐到平台真实返回；`../themis-platform` 随后新增了 `platform-workflow-service`，补入 `/api/platform/work-items/list|detail|dispatch|respond|escalate|cancel` 与 `/api/platform/agents/mailbox/list|pull|ack|respond`，并在独立平台页里接入 `work-items` 列表/详情/派发/响应/升级/取消，以及 `mailbox` 的 agent inbox / pull / ack / respond。到这一步，平台仓当前的独立前端已经从 `nodes + governance + waiting + collaboration + handoffs + runs` 进一步扩到 `nodes + governance + waiting + collaboration + handoffs + work-items + mailbox + runs` 这一束。
- `2026-04-14` 同日已继续把 `agents + projects` 真实控制面也往平台仓收口：当前 `../themis-platform` 已新增 `platform-control-plane-service`，补入 `/api/platform/agents/list|detail|create|execution-boundary/update|spawn-policy/update|pause|resume|archive` 与 `/api/platform/projects/workspace-binding/list|detail|upsert`，并在独立平台页里接入 `agents` 列表/详情/创建，以及 `projects` 工作区绑定读写首版。到这一步，平台仓当前的独立前端已经从 `nodes + governance + waiting + collaboration + handoffs + work-items + mailbox + runs` 进一步扩到 `agents + projects + nodes + governance + waiting + collaboration + handoffs + work-items + mailbox + runs` 这一束。
- `2026-04-14` 同日已继续把 `oncall/summary` 值班建议面板也往平台仓收口：当前 `../themis-contracts` 已新增 `managed-agent-platform-oncall`，补齐 diagnosis / recommendation / counts 这组共享 shape；`../themis-platform` 随后新增 `platform-oncall-service`，补入 `/api/platform/oncall/summary`，并在独立平台页里接入统一的值班建议面板，直接汇总 Worker Node attention、waiting 风险、runs 卡点与 paused agents 容量提示。到这一步，平台仓当前的独立前端已经从 `agents + projects + nodes + governance + waiting + collaboration + handoffs + work-items + mailbox + runs` 进一步扩到 `agents + projects + nodes + governance + waiting + collaboration + handoffs + oncall + work-items + mailbox + runs` 这一束；平台线当前主差口已不再是“缺页面控制面”，而是“平台鉴权事实与真实持久化控制面继续收口”。

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
