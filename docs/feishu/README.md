# 飞书 Bot 调研与接入建议

更新日期：2026-04-08

相关实现文档：

- [Themis 飞书渠道说明](./themis-feishu-channel.md)
- [Themis 飞书卡片交互 PoC 草案](./themis-feishu-card-poc-draft.md)
- [Themis 飞书审批卡实施计划](./themis-feishu-approval-card-implementation-plan.md)
- [飞书审批卡第一轮的 HTTP 回调约束](../memory/2026/04/feishu-approval-card-http-callback-route.md)
- [飞书相关改动的固定复跑顺序](../memory/2026/04/feishu-stability-rerun-order.md)
- [飞书群聊路由、共享会话与管理员控制](../memory/2026/04/feishu-group-routing-and-session-admin-controls.md)
- [飞书与 Web 跨端 waiting action 恢复边界](../memory/2026/03/feishu-cross-channel-action-recovery-boundary.md)
- [飞书消息入口去重与顺序保护](../memory/2026/03/feishu-message-ingress-ordering.md)
- [飞书 waiting user-input 直接文本接管约束](../memory/2026/03/feishu-direct-text-user-input-takeover.md)

手工验收入口：

- [飞书真实旅程 Smoke 剧本](./themis-feishu-real-journey-smoke.md)
- [card.action.trigger 暂不进入实现阶段的长期记忆](../memory/2026/03/feishu-card-action-trigger-entry-criteria.md)

## 当前落地状态

- 飞书第二阶段第一刀已经完成；阶段 5、阶段 6、`结构化输出 / 自动化接口` 和 `云端 / 远程执行能力评估` 也都已收口。当前结论不是把远程执行或 `codex cloud` 混进飞书主链，而是继续守住现有群路由、shared 会话和诊断复验边界；除审批卡第一轮外，其余卡片化范围仍保持 gated evaluation。
- Themis 已接入飞书长连接，`im.message.receive_v1` 能进入现有 runtime 主链路。
- 当前已支持飞书文本收发、`/help`、`/sessions`、`/new`、`/use`、`/current`、`/review`、`/steer`、`/workspace`、`/group`、`/link`、`/settings` 命令树、`/msgupdate`、`/quota`，以及 `/account`、`/sandbox`、`/search`、`/network`、`/approval` 这些兼容入口；其中 `/settings account` 已支持设备码登录、退出账号和取消登录。
- Codex 在飞书里已改成“占位槽位 + 顺序延迟缓冲”体验：用户发消息后先立刻返回 `处理中...`；第一条中途回复先缓存；只有切到新的正文 item、静默超时或最终结果收口时，缓存才会真正发送；同一 `agent_message itemId` 的连续 delta 只会覆盖当前缓存，不会把半句增量一条条刷到飞书里。
- 飞书移动端第一轮产品化表达已落地：`task.action_required` 会转成可直接执行的 waiting action 文本面，状态类 `task.progress` 会额外输出任务状态摘要，`/sessions`、`/use`、`/current` 会回显当前 native thread 摘要。
- 飞书审批卡第一轮已经落地：仅覆盖 `task.action_required(approval)`，机器人会把审批等待面升级成 interactive 卡片；点击后通过 `POST /api/feishu/card-action` 回调复用现有审批提交流程，同时保留 `/approve` / `/deny` 文本降级链。
- 飞书第二阶段第一刀已落地：群聊默认 `smart` 路由、可切换 `always` 路由、`personal / shared` 会话策略、`/group` 最小管理员控制，以及 shared 群会话下 `/new`、`/use`、`/workspace` 的管理员限制都已经接进主链路。
- waiting `user-input` 现在优先走直接回复文本；只有当前 `sessionId + principalId` scope 里存在且仅存在一条 `user-input` pending action、并且没有 `approval` pending action 时，普通文本才会自动接管，同一 principal 下的 Web / 飞书入口共用这套范围。
- 当当前 `sessionId + principalId` 作用域里仍有 `approval` pending action 时，普通文本不会被当成补充输入自动接管，而是继续走现有普通任务链；审批仍建议显式 `/approve` / `/deny`。
- `/reply <actionId> <内容>` 的优先级已经降到兜底路径，主要用于显式指定 actionId 或处理多条 `user-input` 并存的歧义。
- 普通任务回复会优先转换成飞书 `post` 富文本，渲染列表、加粗、代码块和外链；本地文件链接会降级成普通文本显示。
- Web 与飞书当前都统一采用“新消息默认打断旧任务”的跟进行为。
- 飞书与 Web 现在默认共享同一套 conversation 视图；飞书 `/sessions` 可看到 Web 创建的会话，切到同一个 `conversationId` 后会继续复用后端已有上下文。
- 当前激活会话不会跨端自动同步；Web 和飞书各自保留“当前正在聊哪一条”的本地状态，需要手动切到目标 `conversationId`。
- 飞书与 Web 现在共用同一份 principal 级 Themis 默认任务配置；`sandbox / search / network / approval / account` 都不再是会话配置，而是会同时影响两个渠道后续新任务的长期默认值。
- Web 仍保留浏览器级 identity 与绑定码，但它已降级为可选能力，主要用于认领旧浏览器身份，不再是跨渠道共享会话的前提。
- 默认任务执行主链路已经切到 `codex app-server`；飞书当前用户可达路径走默认 runtime，`@openai/codex-sdk` 仅保留显式兼容入口。

## 推荐复跑顺序

飞书相关改动的固定复跑顺序已经收口为：

1. `./themis doctor feishu`
2. `./themis doctor smoke web`
3. `./themis doctor smoke feishu`
4. 手工 A/B 验收

这个顺序的分工是：

- `doctor feishu`：先看主诊断和深层排障信息，判断是服务、会话、action 还是消息顺序问题。
- `doctor smoke web`：只验证真实 Web / HTTP 主链路，确认还能稳定进入 `task.action_required` 并收口为 `completed`。
- `doctor smoke feishu`：只做飞书前置检查和手工 smoke 接力提示，不假装自己是全自动飞书 E2E。
- 手工 A/B：最后才在飞书里继续真实接管和收口。

当前固定飞书复验矩阵已经统一成四个主场景，加三类支撑护栏：

- 自动化 `Web -> 飞书 direct-text takeover`
- 自动化 `approval -> user-input -> 飞书 direct-text takeover`
- `./themis doctor smoke web` 对真实业务 prompt 的低成本探针
- `./themis doctor smoke feishu` + 手工 A/B 的最后一跳接力验收
- `/use` 切会话后的 waiting action 绑定护栏
- `duplicate / stale message` 忽略护栏
- `doctor feishu` 的常见失败诊断分支

如果想用一个命令串起来，可以跑 `./themis doctor smoke all`：

- 它会先执行 Web smoke。
- 只有 Web smoke 通过后，才继续输出 Feishu smoke 前置检查。
- 如果 Web smoke 没过，CLI 会明确提示“Feishu smoke 已跳过”，避免误以为飞书侧也已经验证过。

## 诊断边界

- `doctor feishu` 现在已经能输出主诊断、诊断摘要、建议动作、当前会话、recent window、最后一次 action 尝试、最近被忽略消息和最近 5 条事件轨迹。
- `doctor feishu` 现在还会额外输出“当前接管判断”，直接告诉你当前是 `direct_text_ready`、`reply_required`、`blocked_by_approval` 还是 `approval_required`，以及下一步该用普通文本、`/reply` 还是先处理审批。
- `doctor feishu` 现在还会给出“排障剧本”，把常见诊断翻成更具体的操作步骤，例如先 `/approve` 哪个 action、再 `/reply` 哪个 action，或者提示不要重发哪条旧消息；当前会话里如果已经有可继续的 `user-input`，剧本也会尽量直接带出 `sessionId / actionId / messageId`。
- `doctor smoke feishu` 现在带统一 `next steps` 和 `diagnosis` 字段，但它仍然只是前置检查 + 手工接力入口。
- `doctor smoke web` 负责真实 Web / HTTP 金路径，不负责飞书最后一跳。
- `doctor smoke feishu` 负责飞书最后一跳的前置检查，不负责自动发消息。

## 目标

为 Themis 后续制作飞书 Bot 插件准备资料，收集范围覆盖：

- 飞书官方 API / 事件 / 回调 /教程文档
- Node/TypeScript 方向的官方 SDK 与实现方式
- GitHub 上可借鉴的同类项目
- 面向当前仓库的落地建议

## 这次先得出的结论

- 对 Themis 来说，首选方案是：`企业自建应用 + 机器人能力 + Node 官方 SDK + 长连接接收事件/回调`。
- 原因很直接：当前仓库本身就是 Node/TypeScript，且本地开发并没有稳定公网回调地址；长连接模式更适合先把闭环跑通。
- 飞书官方旧仓库 `larksuite/oapi-sdk-nodejs` 已经废弃并归档；当前应以 npm 包 `@larksuiteoapi/node-sdk` 和新仓库 `larksuite/node-sdk` 为准。
- 已用当前提供的应用凭证实际调用过 `tenant_access_token/internal`，2026-03-18 验证通过，返回 `code=0`、`expire=7200`。为了避免后续误提交，`app_secret` 没有写入仓库文档。
- 在当前 runtime 结构下，飞书第一阶段以“长连接 + 文本/富文本消息 + 会话命令 + 默认打断旧任务”为宜，不继续追桌面版的 guide 模式。

## 飞书 Bot 最小闭环

1. 创建企业自建应用。
2. 给应用开启机器人能力。
3. 为应用申请最小权限。
4. 发布应用版本，让配置真正生效。
5. 订阅 `im.message.receive_v1` 事件。
6. 用长连接或 Webhook 接收消息。
7. 调用发送消息接口回复用户或群聊。
8. 如果要做交互卡片，再补 `card.action.trigger` 回调。

## 官方文档整理

| 主题 | 关键结论 | 文档 |
| --- | --- | --- |
| 开放平台文档首页 | 服务端 API 列表、事件列表、权限列表、机器人教程入口都从这里汇总 | [开发文档首页](https://open.feishu.cn/document/home/index) |
| 自建应用开发流程 | 自建应用是企业内使用；能力、权限、事件与回调变更后都需要重新发布版本 | [企业自建应用开发流程](https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process) |
| 启用机器人能力 | Bot 能力不是默认开的，需要在开发者后台手动添加并发布 | [如何启用机器人能力](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-enable-bot-ability) |
| 自建应用取 token | `tenant_access_token` 最大有效期 2 小时；剩余有效期小于 30 分钟时会发新 token | [自建应用获取 tenant_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal) |
| 发送消息 | 发送前必须开启机器人能力；支持文本、卡片、图片等；可用 `uuid` 做 1 小时内去重 | [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create) |
| 接收消息事件 | 事件类型是 `im.message.receive_v1`；单聊、群里 @ 机器人、群全量消息依赖不同权限；去重要用 `message_id`，不要只看 `event_id` | [接收消息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive) |
| 事件概述 | 官方支持长连接和 Webhook 两种模式；事件 3 秒内要响应，否则会按 15 秒、5 分钟、1 小时、6 小时重试，最多 4 次 | [事件概述](https://open.feishu.cn/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM) |
| Webhook 事件模式 | 需要 IPv4 公网地址；配置时会发 `challenge`，必须在 1 秒内原样返回；可配置 Encrypt Key 和 Verification Token | [将事件发送至开发者服务器](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/choose-a-subscription-mode/send-notifications-to-developers-server) |
| 回调概述 | 回调和事件不同，回调是同步交互，3 秒内必须返回内容，且没有补推机制 | [回调概述](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/callback-subscription/callback-overview) |
| 卡片交互回调 | 回调类型是 `card.action.trigger`；回调里会带卡片更新 token；该 token 有效 30 分钟，最多更新 2 次 | [卡片回传交互回调](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication) |
| Echo Bot 教程 | 官方最短路径示例，覆盖创建应用、发布、长连接收消息、自动回复 | [开发自动回复机器人](https://open.feishu.cn/document/uAjLw4CM/uMzNwEjLzcDMx4yM3ATM/develop-an-echo-bot/introduction) |
| 卡片 Bot 教程 | 官方最短路径示例，覆盖欢迎卡片、交互卡片、回调处理与更新卡片 | [开发卡片交互机器人](https://open.feishu.cn/document/uAjLw4CM/uMzNwEjLzcDMx4yM3ATM/develop-a-card-interactive-bot/introduction) |
| API / 事件 / 权限总表 | 做精确查表时最有用 | [服务端 API 列表](https://open.feishu.cn/document/ukTMukTMukTM/uYTM5UjL2ETO14iNxkTN/server-api-list) / [事件列表](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-list) / [应用权限列表](https://open.feishu.cn/document/ukTMukTMukTM/uYTM5UjL2ETO14iNxkTN/scope-list) |

## 制作 Bot 时最容易踩的坑

- 应用配置改了不等于立刻生效。权限、能力、事件、回调改完都要重新发布版本。
- 用户搜不到 Bot、Bot 收不到消息，最常见原因不是代码，而是应用可用范围没放开。
- 如果走 Webhook 模式，请求地址必须是公网 IPv4 地址；这和当前仓库常见的本地/LAN 调试方式天然不匹配。
- waiting `user-input` 现在默认走直接回复文本，不要再把 `/reply` 当成唯一主路径；如果 scope 里同时挂着多条 `user-input`，普通文本不会自动接管，而是提示用 `/reply <actionId> <内容>` 消歧；如果还有 `approval`，普通文本会继续走原任务链，审批仍建议显式 `/approve` / `/deny`。
- 事件需要幂等处理。官方明确提示消息接收场景要用 `message_id` 去重，不要只依赖 `event_id`。
- 事件推送只要求“收到”即可，3 秒内返回 200；回调则要在 3 秒内返回“处理结果”，两者不要混着写。
- 发送消息接口对同一用户和同一群的限频都是 5 QPS，不能把大模型流式输出直接粗暴拆成高频消息刷出去。
- 发消息时建议始终带 `uuid`，避免重复发送。
- 卡片交互返回的更新 token 只有 30 分钟有效，且最多更新 2 次，做长时间任务时不能把它当长期会话句柄。

## Node / TypeScript 方向的关键结论

### 官方 SDK 现状

- 旧仓库：[`larksuite/oapi-sdk-nodejs`](https://github.com/larksuite/oapi-sdk-nodejs)
  - 已标记 `Deprecated`
  - README 明确要求改用 `https://github.com/larksuite/node-sdk`
  - 仓库已归档
- 新仓库：[`larksuite/node-sdk`](https://github.com/larksuite/node-sdk)
  - 仍在维护
  - npm 包名：[`@larksuiteoapi/node-sdk`](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)
  - 2026-03-18 实查 `npm view`：`latest = 1.59.0`

### 对 Themis 的推荐模式

- 开发阶段优先用长连接。
  - 优点：不需要公网回调地址，和本地开发更匹配。
  - 官方 Bot 教程也是围绕长连接示例展开。
- 生产阶段如果将来有稳定公网域名，可以再评估是否切到 Webhook。
  - 适合云函数、统一网关、固定公网服务。
  - 但要自己处理 URL 校验、解密、验签、重试和超时约束。

## 推荐最小权限

如果第一版目标只是“单聊和群里 @ 机器人后，把消息转给 Themis，再回复结果”，建议先只开这些：

- `im:message:send_as_bot` 或 `im:message:send`
- `im:message.p2p_msg:readonly`
- `im:message.group_at_msg:readonly`

按需再补：

- `im:message.group_msg`
  - 只有当你确实要接收群里所有消息时才开，这个范围更大。
- `im:user_agent:read`
  - 只有你确实要做客户端来源识别时才开。
- `contact:user.employee_id:readonly`
  - 只有你必须拿 `user_id` 时才开；多数 Bot 场景直接用 `open_id` 足够。

## GitHub 同类项目整理

以下信息按 2026-03-18 抓取。

| 项目 | 技术栈 | 借鉴价值 | 链接 |
| --- | --- | --- | --- |
| 官方 Node SDK | TypeScript | 最适合直接作为 Themis 的底座；提供语义化 API 调用、分页、文件上传下载等封装 | [larksuite/node-sdk](https://github.com/larksuite/node-sdk) |
| 飞书 Agent 网关 | JavaScript | 很贴近 Themis 的目标，重点是“每个线程绑定 runtime / model / session”和卡片流式更新 | [mybolide/feishu-agent-bridge](https://github.com/mybolide/feishu-agent-bridge) |
| 插件式个人 AI 助手 | TypeScript | 把飞书当成渠道插件来做，适合参考“渠道层”和“插件层”的边界设计 | [GuLu9527/flashclaw](https://github.com/GuLu9527/flashclaw) |
| 轻量 OpenAI 飞书 Bot | JavaScript | 适合看最小可用版：接消息、调模型、消息卡片包装、数据库记录问答 | [forkpath/openai-feishu-bot](https://github.com/forkpath/openai-feishu-bot) |
| 资讯互动卡片 Bot | Python | 适合专门参考卡片交互、点赞回调、SQLite 映射、长连接收 `card.action.trigger` | [Matys1009/feishu_daily_news_card](https://github.com/Matys1009/feishu_daily_news_card) |
| 生产级多平台 Bot 平台 | Python | 适合看大架构：多平台、多插件、控制台、监控、知识库；但对 Themis 第一版来说太重 | [langbot-app/LangBot](https://github.com/langbot-app/LangBot) |

### 这些项目里最值得抄的不是“代码”，而是“分层”

- `feishu-agent-bridge`
  - 值得抄：线程级 session 持久化、runtime 路由、流式卡片更新。
- `flashclaw`
  - 值得抄：把飞书做成渠道插件，而不是把飞书逻辑散落到主流程里。
- `openai-feishu-bot`
  - 值得抄：MVP 闭环非常短，适合快速验证链路。
- `feishu_daily_news_card`
  - 值得抄：卡片交互事件与本地存储映射关系。
- `LangBot`
  - 值得抄：生产级监控、权限、插件生态思路；不值得直接整套照搬。

## 面向 Themis 的建议落地方式

建议单独收口到飞书渠道目录，不要把飞书 API 调用散到现有 HTTP server 和 Codex runtime 逻辑里。

可考虑的模块拆分：

- `src/channels/feishu/feishu-client.ts`
  - 负责 SDK client、token、基础配置。
- `src/channels/feishu/feishu-gateway.ts`
  - 负责长连接启动、事件分发、生命周期管理。
- `src/channels/feishu/feishu-normalizer.ts`
  - 把 `im.message.receive_v1` 转成仓库内部统一消息结构。
- `src/channels/feishu/feishu-session-store.ts`
  - 把 `chat_id/open_id/message_id` 映射到 Themis 的 `sessionId`。
- `src/channels/feishu/feishu-reply.ts`
  - 负责文本、卡片、错误提示、节流和幂等。
- `src/channels/feishu/feishu-card-callback.ts`
  - 如后续进入 `card.action.trigger` PoC 再做；当前仍不在实现主线。

### 第一版实际落地结果

- 已支持文本收发。
- 已支持单聊和群里 @ 机器人进入任务链路。
- 已把飞书消息转成 Themis 现有任务请求，并改成“处理中占位 -> 真实内容更新 -> 下一个处理中占位”的桥接策略。
- 已为普通任务回复补上飞书专用 Markdown 渲染层，优先输出 `post` 富文本而不是裸 `text`。
- 当前已落地审批卡第一轮，但仍不把 `user-input`、状态卡、agent 卡或飞书内长任务卡片刷新拉进主链。

### 卡片交互的受控评估方向

- 只有在 `docs/memory/2026/03/feishu-card-action-trigger-entry-criteria.md` 里的准入条件满足后，才再评估 `card.action.trigger` 的 PoC。
- 当前已经补了一份面向未来 PoC 的收敛草案：优先级固定为“审批卡 -> 运行中 / 阻塞状态卡 -> agent 治理卡”，具体字段、按钮、回调和降级策略见 [`themis-feishu-card-poc-draft.md`](./themis-feishu-card-poc-draft.md)。
- 其中第一张审批卡已经完成第一轮实现，实施与验收边界见 [`themis-feishu-approval-card-implementation-plan.md`](./themis-feishu-approval-card-implementation-plan.md)；当前范围仍只覆盖审批卡，不把 `user-input`、状态卡或 agent 卡一起拉进来。
- 当前启用审批卡时，需要同时配置飞书应用凭据和卡片回调安全字段：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_VERIFICATION_TOKEN`、`FEISHU_ENCRYPT_KEY`；回调入口固定为 `POST /api/feishu/card-action`。
- 如果进入 PoC，优先看运行中状态卡片是否真的能补足文本态不擅长的场景，再决定要不要继续做“取消任务 / 新开会话 / 重试” 这类按钮。
- 群会话与单聊会话的不同路由策略、以及最小管理员控制，已经进入当前实现；后续如要继续做更重的卡片化群协作体验，再单独评估是否值得扩面。

## 下一步建议

1. 在保持 `doctor feishu -> doctor smoke web -> doctor smoke feishu -> 手工 A/B` 固定复跑顺序的前提下，主线切向 `路线图 / 阶段 5 / 兼容入口收敛`。
2. 飞书侧继续围绕已落地的群路由、共享会话和管理员控制做低成本复验，不把主线重新拉回输入边界零碎补丁。
3. 审批卡之外的 `card.action.trigger` 扩面先不做；如果以后要追更重的交互引导，再单独评估状态卡、agent 卡和值不值得继续拉开。

## 本次实际验证记录

- 2026-03-18 已调用：
  - `POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`
- 结果：
  - `code=0`
  - `expire=7200`
- 说明：
  - 当前提供的应用凭证至少在“获取自建应用 tenant_access_token”这一步是可用的。
  - 本文档不记录明文 `app_secret`，避免后续被误提交到 Git。
