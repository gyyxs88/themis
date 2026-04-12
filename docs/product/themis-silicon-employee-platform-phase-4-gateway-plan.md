# Themis 局域网多节点硅基员工平台 / Phase 4 主 Themis Gateway 化实施计划

更新时间：2026-04-12 23:40 CST
文档性质：实施计划 / 完成记录。目标是把平台化路线里的 `Phase 4 / 主 Themis Gateway 化` 收成已验证的一阶段结果。

当前状态补充（2026-04-12）：

- `Phase 1 / 控制面底座` 已完成：控制面 `store` 抽象、SQLite/MySQL 原型、控制面门面，以及最小 `/api/platform/*` 已落地。
- `Phase 2 / 节点模型与调度租约` 已完成：`node / execution_lease`、节点注册/心跳/治理、TTL 自动下线，以及 scheduler 最小节点匹配都已落地。
- `Phase 3 / 远端执行闭环` 已完成：Worker Node daemon、平台 HTTP client、`themis worker-node run`、`doctor worker-node`、`doctor worker-fleet`、`worker-fleet drain|offline|reclaim` 和部署/值守手册都已接通。
- 当前 Phase 4 首阶段已完成：
  - 已新增 `THEMIS_PLATFORM_BASE_URL / THEMIS_PLATFORM_OWNER_PRINCIPAL_ID / THEMIS_PLATFORM_WEB_ACCESS_TOKEN`
  - 已新增 `ManagedAgentPlatformGatewayClient`
  - 已把 `POST /api/agents/list|detail|spawn-suggestions|idle-suggestions|waiting/list|governance-overview|collaboration-dashboard|work-items/list|work-items/detail|handoffs/list|mailbox/list|runs/list|runs/detail` 全部切成“配置平台上游后优先读 `/api/platform/*`”
  - 平台侧已新增相应读出口：`/api/platform/agents/spawn-suggestions|idle-suggestions|waiting/list|governance-overview|collaboration-dashboard|handoffs/list|mailbox/list` 与 `/api/platform/work-items/list`
  - 未配置平台上游时，当前仍保持本地回退，避免打断开发链路
  - 已补齐 gateway 模式与平台扩展读接口测试，并通过 `http-agents / http-platform / apps/web/modules/agents` 回归

补充更新（2026-04-12 22:50 CST）：

- 在首阶段读模式收口后，主线又继续完成了第二刀“写路径 Gateway 化”。
- 平台侧已新增写出口：`/api/platform/agents/execution-boundary/update|spawn-policy/update|spawn-approve|spawn-ignore|spawn-reject|spawn-restore|idle-approve|pause|resume|archive|mailbox/pull|mailbox/ack|mailbox/respond` 与 `/api/platform/work-items/cancel|respond|escalate`。
- 主 Themis 已把 `POST /api/agents/create|execution-boundary/update|spawn-policy/update|spawn-approve|spawn-ignore|spawn-reject|spawn-restore|idle-approve|pause|resume|archive|dispatch|work-items/cancel|work-items/respond|work-items/escalate|mailbox/pull|mailbox/ack|mailbox/respond` 切成“配置平台上游后优先写 `/api/platform/*`、未配置则本地回退”。
- 新增验证已通过：`node --test --import tsx src/server/http-agents.test.ts`、`node --test --import tsx src/server/http-platform.test.ts`、`node --test apps/web/modules/agents.test.js`、`npm run typecheck`、`npm run build`。
- 本文后续“先切读路径、不切写路径”的表述只对应首阶段历史计划；截至这次更新，读写两刀都已完成。后续主线应转向“平台服务间鉴权 / 凭据边界加固”。

补充更新（2026-04-12 23:40 CST）：

- 写路径 Gateway 化完成后，第 2 条差口“平台服务间鉴权 / 凭据边界加固”也已完成首轮收口。
- 平台服务不再复用 `/api/web-auth/login + themis_web_session` 人类登录态；`ManagedAgentPlatformGatewayClient` 与 `ManagedAgentPlatformWorkerClient` 现在统一对 `/api/platform/*` 发送 `Authorization: Bearer <token>`。
- 存储层已为访问口令新增 `token_kind / owner_principal_id / service_role` 字段，当前支持两类口令：`web_login` 与 `platform_service`。
- 平台 Bearer 令牌当前固定分成两种角色：
  - `gateway`：允许访问 `/api/platform/agents/*`、`/api/platform/work-items/*`、`/api/platform/runs/*`
  - `worker`：允许访问 `/api/platform/nodes/*`、`/api/platform/worker/*`
- 当请求命中 Bearer 平台令牌时，服务端会额外强校验 payload `ownerPrincipalId` 必须与令牌绑定的 `ownerPrincipalId` 一致；这一步不影响浏览器仍通过 cookie 访问现有 Web 页面。
- CLI 已补齐 `themis auth platform list|add|remove|rename`，用于专门管理 Gateway / Worker 令牌；`auth web` 与 `auth platform` 的列表和管理口径已经分离。
- 相关验证已通过：`node --test --import tsx src/core/web-access.test.ts`、`src/server/http-web-access.test.ts`、`src/server/http-agents.test.ts`、`src/core/managed-agent-worker-daemon.test.ts`、`src/diagnostics/worker-node-diagnostics.test.ts`、`src/diagnostics/worker-fleet-diagnostics.test.ts`、`src/cli/web-auth-cli.test.ts`、`src/cli/doctor-cli.test.ts` 与 `npm run typecheck`。
- 到这一步，平台“读写 Gateway 化 + 服务鉴权硬边界”都已完成，下一条主线应切到“监控、告警、备份与恢复方案”。

## 0. 当前结论

`2026-04-12` 的代码事实已经说明：**主 Themis Gateway 化的读写两刀都已完成。**

当前可以明确说：

- Web `Agents` 面板继续走现有 `/api/agents/*` 产品壳契约
- 但在配置平台上游后，核心治理读面已经统一改读平台事实
- 主 Themis 在这一阶段里已经不再把本地控制面当这些读路径的唯一真相来源
- 首阶段曾刻意不碰关键写路径，但该限制已经在同日第二刀中解除

如果后续还要继续扩这条线，下一题不该再叫“写路径 Gateway 化”，而应转向“平台服务间鉴权 / 凭据边界加固”或更明确的下一阶段。

## 1. 目标

这一阶段只解决一件事：

**让主 Themis 开始通过平台事实提供数字员工治理视图，而不是继续把本地 runtime 当唯一真相来源。**

第一版完成后，应至少达到：

- 主 Themis 仍保留 Web / 飞书入口与身份映射
- 但 `Agents` 面板的核心读路径开始改读平台事实
- 主 Themis 就算不再持有本地控制面真相，也仍能看见组织级状态

## 2. 当前代码事实

进入 Phase 4 前，当前仓库已经具备 3 条关键前提：

### 2.1 平台 API 已经能承载控制面读事实

当前 `/api/platform/*` 已能读写：

- `agents/create|list|detail|spawn-suggestions|idle-suggestions|waiting/list|governance-overview|collaboration-dashboard|handoffs/list|mailbox/list`
- `work-items/dispatch|list|detail`
- `runs/list|detail`
- `nodes/register|heartbeat|list|detail|drain|offline|reclaim`
- `worker/runs/pull|update|complete`

这意味着“平台事实没有出口”已经不是问题。

### 2.2 Web Agents 面板已经是显式治理入口

当前 Web 已经有：

- agent 列表
- agent 详情
- organization waiting queue
- governance overview
- collaboration dashboard
- work item / run 详情

也就是说，产品面已经具备了 Gateway 化最需要的读入口，不需要先重写 UI。

### 2.3 当前 `/api/agents/*` 已变成“产品壳协议 -> 平台事实 / 本地回退”的双态边界

当前 `http-agents.ts` 的核心读路径已经不再固定直连本地 runtime：

- 已配置 `THEMIS_PLATFORM_*` 时，改读 `/api/platform/*`
- 未配置时，显式回退本地 `ManagedAgentControlPlaneFacade`
- 飞书与 Web 继续共用同一套 `/api/agents/*` 契约，不需要感知平台协议细节

当前仍保留在本地的，主要是关键写路径与少量非本阶段题目。

## 3. Phase 4 范围

这一阶段实际完成了 4 件事：

- 主 Themis 增加“平台上游”读取能力
- `Agents` 面板核心读路径改读平台事实
- 主 Themis 保留现有身份映射、认证和产品壳
- 在未配置平台上游时继续允许本地回退，避免一次切断开发路径

本阶段明确不做：

- 不先切 `create / dispatch / respond waiting` 这类关键写路径
- 不引入 Personal Themis
- 不重写 Web / 飞书产品壳
- 不在这一步重做鉴权体系

## 4. 推荐第一刀

### 4.1 先切读路径，不切写路径

第一刀建议只把下面这些接口改成“优先读平台”：

- `POST /api/agents/list`
- `POST /api/agents/detail`
- `POST /api/agents/waiting/list`
- `POST /api/agents/governance-overview`
- `POST /api/agents/collaboration-dashboard`
- `POST /api/agents/work-items/detail`
- `POST /api/agents/runs/list`
- `POST /api/agents/runs/detail`

先不碰：

- `POST /api/agents/create`
- `POST /api/agents/dispatch`
- `POST /api/agents/work-items/respond`
- `POST /api/agents/work-items/escalate`
- `POST /api/agents/execution-boundary/update`

原因很简单：

- 读路径更容易验证“平台是不是已经成为真相来源”
- 写路径一旦切错，直接影响派工、waiting 恢复和治理动作
- 先把“看状态”切稳，再切“改状态”，风险最低

### 4.2 主 Themis 需要一个明确的平台上游配置

要让主 Themis 真正做 Gateway，至少要固定一组平台上游配置，例如：

- `THEMIS_PLATFORM_BASE_URL`
- `THEMIS_PLATFORM_OWNER_PRINCIPAL_ID`
- `THEMIS_PLATFORM_WEB_ACCESS_TOKEN`

第一刀不一定要求命名完全固定，但必须先解决两个问题：

- 主 Themis 到底连哪一个平台
- 主 Themis 以什么身份去读平台事实

### 4.3 先在服务端切，不先在前端切

推荐路径是：

1. Web 继续请求现有 `/api/agents/*`
2. 服务端在 `http-agents.ts` 内部判断是否启用 Gateway 读模式
3. 启用时由服务端去请求平台 API，再把结果转成现有前端契约

这样第一刀的优点是：

- 前端改动最小
- 飞书和 Web 可以继续共用一套服务端边界
- 可以逐个接口平滑切换，而不是一次替换整个面板

## 5. 推荐对象与边界

### 5.1 新增“主 Themis -> 平台”的服务端客户端

建议新增一层专门的 server-side gateway client，而不是让 `http-agents.ts` 直接拼 `fetch`：

- 负责平台 URL、鉴权头、错误归一化
- 负责把 `/api/platform/*` 结果转成主 Themis 现有读接口需要的 shape
- 负责后续从“读路径首刀”扩到“写路径第二刀”

### 5.2 现有 `/api/agents/*` 继续保留为产品壳契约

第一刀不要要求 Web / 飞书直接改调 `/api/platform/*`。

更合理的边界是：

- `/api/platform/*` 继续是平台控制面原生协议
- `/api/agents/*` 继续是主 Themis 的产品壳协议
- 只是主 Themis 内部逐步把“产品壳协议 -> 本地真相”的实现，替换成“产品壳协议 -> 平台事实”

### 5.3 本地回退要显式，而不是静默

如果未配置平台上游，建议保持本地读路径可用；
但如果配置了平台上游却请求失败，应该显式报错，不要静默回退成本地真相。

否则会出现最危险的状态：

- 用户以为自己看到的是平台事实
- 实际看到的还是主 Themis 本地状态

## 6. 实际完成包

Phase 4 首阶段最终按下面这个包收口：

1. 新增主 Themis 平台上游配置读取
2. 新增平台读客户端
3. 接通 `agents/list|detail|spawn-suggestions|idle-suggestions`
4. 接通 `governance-overview|waiting/list|collaboration-dashboard`
5. 接通 `work-items/list|detail|handoffs/list|mailbox/list|runs/list|runs/detail`
6. 为 gateway 读模式与平台扩展读接口补独立测试
7. 保留未配置上游时的本地开发回退

这意味着首阶段已经验证了 4 个问题：

- 主 Themis 是否已经能在不断产品壳的前提下读平台事实
- 组织级治理视图是否还能保持现有产品语义
- 平台上游出错时，错误是否可解释
- 本地开发模式是否不会被 Gateway 化第一刀直接打断

## 7. 完成标准

这一阶段当前已满足：

- 主 Themis 在配置平台上游后，`Agents` 面板能看见完整组织级状态与选中 agent 读面
- 这些状态来自平台 API，而不是主 Themis 本地控制面
- Web 前端无需知道平台 API 的存在
- 未配置平台上游时，本地开发模式仍可工作
- gateway 模式失败时，用户能看到明确错误，而不是 silently fallback

## 8. 验证建议

本阶段已完成这些验证：

- `node --test --import tsx src/server/http-agents.test.ts`
- `node --test --import tsx src/server/http-platform.test.ts`
- `node --test apps/web/modules/agents.test.js`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

## 9. 当前不建议提前开的题

这一步先不要提前混入下面这些题：

- `create / dispatch / respond waiting` 写路径切换
- Personal Themis
- 跨网节点
- 新的前端大改版
- 平台鉴权体系全面重做

## 10. 与现有文档的关系

- 方向与边界：见 [Themis 局域网多节点硅基员工平台方案（V1 草案）](./themis-silicon-employee-platform-v1.md)
- 阶段路线：见 [Themis 局域网多节点硅基员工平台 / 分阶段落地计划](./themis-silicon-employee-platform-roadmap-plan.md)
- Phase 3 当前完成面：见 [Themis 局域网多节点硅基员工平台 / Phase 3 远端执行闭环实施计划](./themis-silicon-employee-platform-phase-3-remote-execution-plan.md)
