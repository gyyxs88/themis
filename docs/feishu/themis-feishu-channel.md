# Themis 飞书渠道说明

更新日期：2026-04-21

## 当前实现

Themis 已接入飞书长连接渠道，特点如下：

- 使用飞书官方 Node SDK 长连接模式接收 `im.message.receive_v1`
- 飞书普通文本消息会作为 Themis 任务输入
- 飞书入站 `post` 富文本当前会提取其中的文本和图片节点；如果同一条 `post` 里同时有正文和图片，会直接把正文与图片一起作为本次任务输入
- 飞书真实入站 `post` 已验证会出现顶层 `{"title":"","content":[...]}` 结构，而不一定带 `zh_cn` 这类 locale 包裹；当前解析已兼容这两种形态
- 飞书 `image` / `file` 消息会先下载到当前会话实际执行工作目录下的 `temp/feishu-attachments/<sessionId>/<messageId>/`
- 下载到本地的 PDF 现在会继续走共享 PDF 资产加工：统一回填 `TaskInputAsset.textExtraction`、`metadata.pageCount` 与持久 sidecar 文本路径，供 runtime / 历史 / diagnostics 复用
- 飞书附件不会立刻起任务，而是先按 `chatId + scopedConversationUserId + activeSessionId` 写入本地附件草稿；默认 `scopedConversationUserId = userId`，群聊切到 `shared` 会话策略后会改成整群共享作用域。草稿当前以 `parts + assets` 作为 canonical 结构，等下一条真正进入普通任务路径的文本时会构造 `inputEnvelope`，同时保留 legacy `attachments[]` 兼容
- 命令和 waiting action 恢复优先级高于附件草稿消费；只有普通任务文本才会自动拼接附件
- 附件任务真正开始执行后会清空已消费草稿；附件下载失败会直接返回错误且不留下脏草稿
- 飞书结果附件现在只支持显式发送：只有当 Themis 在最终输出末尾附带隐藏的 `themis-feishu-attachments` 指令块时，桥接层才会执行飞书附件发送
- 普通本地绝对路径链接和 runtime `touchedFiles` 现在都只作为上下文或历史产物，不再自动触发飞书附件回传
- 当前显式回传策略是：图片优先走飞书 IM `image`；其余白名单文件走飞书 IM `file`；源码文件、工作区外路径和非白名单文件会被拒绝并追加 `[附件回传]` 说明
- 当前回传大小限制按飞书 IM 能力收口：图片 `10MB`，其他文件 `30MB`；超限或上传失败时不会中断正文回复，而是补一条 `[附件回传]` 文本说明
- 群聊默认采用 `smart` 路由：首条普通文本如果没有显式触达（@ 机器人、同一用户当前有 waiting action、同一用户当前有运行中任务，或最近 10 分钟刚命中过群路由），会被静默忽略并写入 diagnostics；切到 `always` 后，群聊普通文本会默认直接进入 Themis
- 群聊会话策略支持 `personal / shared`：`personal` 继续按人隔离当前会话与附件草稿，`shared` 则改为整群共用一条当前会话和同一份附件草稿
- 飞书已补 `/group` 最小管理员控制：可查看和修改当前群的路由、会话策略与管理员名单；当前群还没有管理员时，首次成功修改群设置的人会自动成为首个管理员
- 当群聊处于 `shared` 会话策略时，只有群管理员可以执行 `/new`、`/use`、`/workspace`，避免整群当前会话被随手切乱
- 飞书已补 `/update` 运维入口：`/update` 可查看当前实例更新状态，`/update apply confirm` / `/update rollback confirm` 可在单聊里触发后台升级或回滚；高风险动作默认要求显式 `confirm`
- 飞书发任务前会读取当前 principal 保存的 Themis 默认任务配置，并带上对应 `options`
- 飞书支持会话级工作区：`/workspace`（别名 `/ws`）会写当前激活会话的 `workspacePath`，不改 principal 默认配置
- 如果当前 principal 还没有长期协作档案，首次普通消息会先进入一次性人格 bootstrap
- 用户发消息后，飞书会立刻收到一条 `处理中...` 占位消息
- 飞书正文现在只认“已经完整”的中间消息：只有 `item/completed(agentMessage, commentary)` 才会立刻落成一个正文气泡；`item/agentMessage/delta` 只作为内部累计快照，不再直接驱动飞书正文展示
- 每条完整正文一旦到达，就会立刻把当前 `处理中...` 占位落成正文，并再补一条新的 `处理中...` 状态消息
- 不再使用正文缓存、soft flush / hard flush 定时，或“同一条正文消息按节拍持续编辑变长”的桥接策略
- 每一条完整 commentary 都会落成独立正文气泡；如果随后最终结果与上一条正文一致，尾部 `处理中...` 会直接收口成 `已完成`
- 工具事件现在走独立的工具轨迹通道：`traceKind=tool` 的 `task.progress` 不会混进正文，也不会被包装成 `任务状态更新`
- 同一条工具轨迹气泡会按 `traceBucketId` 原地更新；当前 bucket 最多容纳 `10` 行工具摘要，并按 `1` 秒聚合节流，超出条数或编辑预算后会滚到下一个 bucket
- 工具轨迹默认展示精简状态行，例如 `正在运行 ...`、`已运行 ...`、`等待审批 ...`、`等待输入 ...`、`执行失败 ...`、`中断 ...`，不展开 stdout / patch / 长参数
- 如果最终结果和上一条正文不同，桥接层会先发最终正文，再收口终态
- 当前只保留飞书单条消息长度限制带来的硬性安全拆分；这类拆分只为保证消息发得出去，不再承担流式渐进展示职责
- 如果某条正文已经露出，随后最终结果与这条已显示正文完全一致，桥接层不会再重复发送一次正文；尾部那条 `处理中...` 会收口为 `已完成`
- 飞书 / Web 这类公开入口现在按“进度间静默超时”执行：`THEMIS_TASK_TIMEOUT_MS` 不再按总墙钟时间硬砍，只要持续有新事件进入公开桥接链就会自动续期；只有静默超过窗口才会取消任务
- 飞书日志现在会额外记录两类耗时：`斜杠命令完成`（命令总耗时）以及 `飞书消息发送完成/失败`（单次消息 create / update 接口耗时）
- 最终结果到达时，如果与上一条正文一致但只是多了额度尾注，桥接层只会把最后一条占位消息收口为 `已完成`，不再额外发送重复正文
- 最终结果到达时，如果最后一条已显示正文与最终结果不同，桥接层会先补最终正文，再把尾部状态收口为 `已完成`
- 普通任务回复会优先按飞书 `post` 富文本发送，尽量渲染标题、列表、加粗、代码块和外链
- 飞书当前默认走 `app-server` runtime；这一执行链现在会把完整任务 prompt 送进 `startTurn(...)`，不会再把附件、history 或 task context 丢成只剩一句 `goal`
- 指向本地绝对路径或相对仓库路径的 Markdown 链接，不会在飞书里保留为超链接，而是降级成普通代码样式文本
- 失败、异常和取消会直接落到当前最后一条占位消息上
- `task.action_required` 会转成移动端友好的 waiting action 文本，直接带出 actionId、命令提示和当前会话 / 线程摘要
- `task.action_required` 里的 `user-input` 现在支持 direct-text takeover：如果当前 `sessionId + principalId` 作用域下只有 1 条 `user-input` pending action，且不存在 `approval` pending action，飞书里直接回复普通文本即可继续；如果同一作用域下有多条 `user-input` pending action，普通文本不会自动接管，会提示改用 `/reply <actionId> <内容>`
- `resolvePendingActionScope(...)` 现在按 `sessionId + principalId` 匹配，不再要求 `sourceChannel = "feishu"` 作为前提；同一 principal 下的 Web-origin `user-input` 和 `approval` pending action 也可以由飞书接管，不同 principal 即使 `sessionId` 一样也不会命中
- 审批和补充输入提交成功后的确认消息现在直接发送纯文本 `已提交审批。` / `已提交补充输入。`，不再额外附加 `[处理中]` 标签；真正的流式占位仍由原来的 `处理中...` 桥接链负责
- 状态类 `task.progress` 会额外发出任务状态摘要，不会打断原来的 `处理中...` 占位链
- app-server 的 `item/agentMessage/delta` 在翻译成统一 `task.progress` 时，现在会显式保留 `threadEventType = item.delta`；真正驱动飞书正文的是 `item/completed(agentMessage, commentary)` 这一层
- `/new` 会继承当前激活会话的 `workspacePath`（只继承工作区字段）
- `/sessions`、`/use`、`/current` 会展示当前会话与 native thread 摘要，`/use` 切换成功后会自动回显当前会话状态
- 已支持 `/review <指令>`、`/steer <指令>` 对当前会话发起最小控制动作
- `/current` 会展示当前会话 ID、工作区、principal、认证账号、最近任务状态和 native thread 摘要
- `themis doctor feishu` 现在会额外输出飞书深层诊断：
  - 主诊断和诊断摘要：先把问题归类成服务、会话、action、消息顺序或恢复边界问题
  - 建议动作：给出下一步该看什么，而不是只贴原始状态
  - 当前会话快照：`sessionId / principalId / threadId / threadStatus / lastMessageId / lastEventType / pendingActions`
  - 当前接管判断：额外给出 `takeoverState / takeoverHint`，直接说明当前是可以 direct-text takeover、必须 `/reply` 指定 actionId，还是仍被 approval 阻塞
  - 排障剧本：把主诊断进一步翻成可执行步骤，例如先 `/approve <actionId>`、再 `/reply <actionId> <内容>`，或提示不要重发哪条被窗口忽略的旧消息；如果当前会话里已经有可继续的 `user-input`，剧本会尽量直接带出对应 `sessionId / actionId / messageId`
  - 最近窗口统计：`recentWindow.duplicateIgnoredCount / staleIgnoredCount / approvalSubmittedCount / replySubmittedCount / takeoverSubmittedCount / pendingInputNotFoundCount / pendingInputAmbiguousCount`
  - 最近一次 action 尝试：`lastActionAttempt.type / requestId`，并附带 `actionId / sessionId / principalId / createdAt / summary`；这里既可能是 `*.submitted`，也可能是 `*.submit_failed`
  - 最近一次被忽略消息：`lastIgnoredMessage.type / messageId`，并附带 `createdAt / summary`
  - 最近 `5` 条事件轨迹：只保留对排障最有用的最近事件，不会把完整本地事件表都打印出来
- 飞书深层诊断数据保存在：

```text
infra/local/feishu-diagnostics.json
```

- 这份 JSON 只承担本地排障快照用途，CLI 和 HTTP diagnostics 都会从它读出当前会话与最近事件；它不是审计日志，也不是长期存档。
- 如果 `recentWindow` 统计缺失，优先看 `infra/local/feishu-diagnostics.json` 是否存在且内容有效。
- 如果 `threadId / threadStatus` 缺失，再看 `infra/local/feishu-sessions.json` 和 `infra/local/themis.db` 是否同步到了同一条会话。

## 配置方式

运行前设置环境变量：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

长连接排障时，可额外打开 SDK 调试日志：

```bash
export FEISHU_LOG_LEVEL="debug"
```

当前 Themis 默认会让飞书 SDK 直连，不继承系统里的 `HTTP_PROXY` / `HTTPS_PROXY`，避免某些代理环境下 `axios` 调飞书长连接配置接口时出现 400。
如果你所在网络必须走代理，再显式开启：

```bash
export FEISHU_USE_ENV_PROXY="1"
```

然后正常启动 Themis：

```bash
npm run dev:web
```

启动后如果配置了飞书凭证，会额外拉起飞书长连接服务。

## 常见排障

### 先按固定复跑顺序来

- 先跑 `./themis doctor feishu`
- 再跑 `./themis doctor smoke web`
- 再跑 `./themis doctor smoke feishu`
- 最后才做手工 A/B

这个顺序的核心不是追求更长的自动化链路，而是先用最便宜的方式确认问题落在哪一层。

当前固定飞书复验矩阵统一为：

- 自动化 `Web -> 飞书 direct-text takeover`
- 自动化 `approval -> user-input -> 飞书 direct-text takeover`
- `./themis doctor smoke web` 的真实业务 prompt 低成本探针
- `./themis doctor smoke feishu` + 手工 A/B 的最后一跳接力验收

### 斜杠命令已收到，但飞书回复明显偏慢

- 先看 Themis 日志里的两类耗时：
  - `斜杠命令完成`：整条命令总耗时
  - `飞书消息发送完成/失败`：单次飞书 `create / update` 接口耗时
- 如果两条日志都集中在同一段耗时，例如消息收到后很快进入命令处理，但 `飞书消息发送完成 elapsedMs` 接近总耗时，优先怀疑 `Themis -> open.feishu.cn` 这段网络路径，而不是命令本身。
- `FEISHU_USE_ENV_PROXY` 只控制飞书 SDK 是否继承 `HTTP_PROXY / HTTPS_PROXY` 这类环境变量；如果机器侧用了 `v2rayA` 的 `tproxy` 或 DNS hijack，它并不能绕开系统层代理/解析接管。
- 当前已在 Ubuntu + `v2rayA 2.2.7.5` + Xray 上实测到一种典型慢路径：`open.feishu.cn` 的 `AAAA` 查询在 `127.2.0.17` 这层被拖慢，导致 Node `dns.lookup()` 到飞书域名需要 `4s - 6s`，而 `dns.resolve4()` 或固定 IP 请求却很快。
- 这类场景下，单纯补飞书直连白名单通常不够，因为慢点不在流量路由，而在 DNS 查询策略。当前验证可用的修复方式是给 v2rayA 配置 `core hook`，在生成的 Xray 配置里强制写入 `dns.queryStrategy = "UseIPv4"`；需要时再配合 `V2RAYA_IPV6_SUPPORT=off`。
- 详细结论、验证信号和修复步骤见：
  - [`docs/memory/2026/03/v2raya-dns-hijack-slows-feishu-open-platform.md`](../memory/2026/03/v2raya-dns-hijack-slows-feishu-open-platform.md)

## 飞书开放平台侧要求

1. 应用类型使用企业自建应用
2. 开启机器人能力
3. 订阅事件 `im.message.receive_v1`
4. 事件订阅方式选择长连接
5. 发布应用版本
6. 确保测试账号在应用可用范围内
7. 确保已申请最小权限

建议最小权限：

- `im:message:send_as_bot` 或 `im:message:send`
- `im:message.p2p_msg:readonly`
- `im:message.group_at_msg:readonly`
## 会话规则

- Themis 不再把飞书 `chat_id` 直接当成唯一会话 ID。
- 飞书消息先带着渠道侧会话键进入 runtime，再由统一会话层解析成真正的 `conversationId`。
- 当前实现会为“同一个飞书聊天中的当前会话作用域用户”维护一个当前激活的 conversation 指针；默认仍按真实 `userId` 隔离，群聊切到 `shared` 会话策略后会改成整群共用作用域。
- `workspacePath` 是会话级设置，不是 principal 级默认配置。
- 当前会话执行过任务后，`workspacePath` 会冻结；需要改目录时必须新建会话。
- 这个“当前激活会话指针”保存在：

```text
infra/local/feishu-sessions.json
```

- 这个 JSON 文件只负责记录飞书侧当前激活的是哪条 conversation。
- 群聊路由、会话策略和管理员名单保存在：

```text
infra/local/feishu-chat-settings.json
```

- 当前默认值是：单聊 `always + personal`，群聊 `smart + personal`。
- 飞书附件草稿保存在：

```text
infra/local/feishu-attachment-drafts.json
```

- 这个 JSON 只保存待发送附件元数据，不保存附件二进制；当前 canonical 结构是 `parts + assets`，`attachments[]` 只作为 legacy 兼容视图；真实文件落在当前会话执行目录下的 `temp/feishu-attachments/...`
- 如果附件是 PDF，真实文件旁边还会生成同目录 sidecar 文本文件，作为共享 PDF 资产加工的 `textPath`
- 真正的统一 conversation、channel binding、identity 和历史数据都保存在：

```text
infra/local/themis.db
```

这样可以支持：

- 在同一个飞书聊天里新开会话
- 在已有会话之间切换
- 不影响现有 Web 端会话历史
- 使用同一个 `conversationId` 时，与 Web 复用同一条服务端会话和上下文

## 附件草稿规则

- 飞书附件草稿按 `chatId + scopedConversationUserId + activeSessionId` 隔离；默认 `scopedConversationUserId = userId`，群聊 `shared` 会话策略下则改成整群共享作用域。
- 草稿文件保存在：

```text
infra/local/feishu-attachment-drafts.json
```

- 连续发送多个附件时，会累加到同一份草稿。
- 附件文件会在“收到附件消息时”按当时的当前会话工作区落盘；如果之后再执行 `/workspace` 修改工作区，已经收到的附件不会自动迁移，建议重新发送附件。
- 如果同一条入站 `post` 富文本已经同时带了正文和图片，这些图片不会先进草稿，而是会直接和该条正文一起进入任务。
- `/new`、`/use` 切会话后不会把旧草稿带到新会话。
- 附件草稿只有在普通文本真正进入任务路径时才会被消费；命令和 waiting action 恢复不会消费草稿。
- 任务请求会同时携带 `inputEnvelope` 和 legacy `attachments[]`，下游 runtime 先消费 `inputEnvelope`，旧路径仍可继续读 `attachments[]`。

## 结果附件回传规则

- 只有普通任务成功完成后，桥接层才会考虑回传结果附件；失败、取消和 waiting action 不会触发这一层。
- 只有 Themis 显式输出隐藏附件指令块时，桥接层才会发送附件，格式如下：

````text
```themis-feishu-attachments
/absolute/path/to/file-a.md
/absolute/path/to/file-b.png
```
````

- 这个指令块会在桥接层被剥离，不会直接显示给飞书用户。
- 普通本地绝对路径 Markdown 链接和 `touchedFiles` 不再自动触发附件发送；它们现在只作为“提到过哪些文件 / 产出了哪些文件”的上下文。
- 显式发送目前只对白名单产物生效：图片、PDF、Markdown、文本、CSV/JSON、压缩包、Office 文档和常见音视频；源码扩展名会被直接拒绝，不会把 `.ts/.js/.py/...` 当结果附件发回飞书。
- 显式发送的路径必须位于当前任务工作区内；工作区外路径会被拒绝并追加 `[附件回传]` 提示。
- 图片且 `<= 10MB` 时，会走飞书 IM `image` 上传并直接作为图片消息发送。
- 其他文件且 `<= 30MB` 时，会走飞书 IM `file` 上传并直接作为文件消息发送；`pdf/doc/xls/ppt/mp4/opus` 会映射到对应飞书 `file_type`，其余默认走 `stream`。
- 超过 `30MB` 的结果文件当前不会自动分流到云盘，也不会切成分片；桥接层只会补一条 `[附件回传] 结果文件 xxx 超过飞书 IM 附件 30MB 上限，当前没有回传。`
- 单个文件上传失败时，不会影响正文回复和其他附件继续发送；失败信息会汇总到一条 `[附件回传]` 文本说明里。

## 飞书命令

所有命令都使用 `/xxx` 形式。

### `/help`

查看第一层命令。

说明：

- `/help` 只展示第一层命令。
- `/settings` 的子项需要继续下钻查看。

### `/sessions`

查看最近的全局会话列表，包含 Web 和飞书创建的 conversation。

注意：

- 这里只共享“可进入的会话池”，不自动同步两端当前激活的是哪一条。
- 想在飞书继续某条 Web 会话，仍需手动执行 `/use <conversationId>` 或 `/use <序号>`。

### `/new`

创建并切换到一个新会话。

补充规则：

- 如果上一条激活会话设置过 `workspacePath`，`/new` 会自动继承这个工作区到新会话。
- 如果继承失败，会明确提示失败原因，但新会话仍会保留并激活。

### `/use <序号|conversationId>`

切换到已有会话。

示例：

```text
/use 1
/use feishu-1742280000000-abc123xy
```

### `/current`

查看当前激活会话。

这个“当前会话”是飞书端自己的本地激活状态，不会自动跟随 Web 切换。

返回信息会包含：

- 当前会话 ID
- 当前会话工作区（未设置时显示回退到 Themis 启动目录）
- 当前 principal 和当前生效认证账号
- 最近任务状态
- 当前 native thread 摘要（threadId、状态、turn 数）

### `/review <指令>`

对当前激活会话发起 Review。

当前实现会自动按会话选择 runtime；如果当前会话已经绑定 app-server thread，成功后会回显：

- 当前会话 ID
- review thread id
- review turn id

### `/steer <指令>`

对当前激活会话的当前活跃 turn 发送 Steer。

当前实现会自动按会话选择 runtime；如果当前会话已经绑定 app-server thread，成功后会回显：

- 当前会话 ID
- steer 后返回的 turn id

### `/workspace [绝对目录]`（别名：`/ws`）

查看或设置当前激活会话的工作区。

规则：

- 无参数：只查看当前会话工作区。
- 有参数：按共享校验规则写入当前会话 `workspacePath`。
- 只影响当前会话，不会改 principal 默认配置，也不会写进任务 `options`。
- 如果当前会话已执行过任务，会返回冻结错误，拒绝修改。

### `/group`

查看或修改当前群聊的路由、会话策略和管理员名单。

规则：

- 单聊里执行会明确提示当前不生效。
- `/group`、`/group status`、`/group show`：查看当前群设置、当前用户权限、管理员名单和当前群会话。
- `/group route <smart|always>`：修改群消息路由。`smart` 表示要先显式触达，或命中当前 waiting action / 运行中任务 / 最近 10 分钟已命中过路由，后续普通文本才会继续进入 Themis；`always` 表示当前群消息默认直接进入 Themis。
- `/group session <personal|shared>`：修改群会话策略。`personal` 继续按人隔离当前会话；`shared` 表示整群共用一条当前会话和同一份附件草稿。
- `/group admin list|add|remove`：查看或维护群管理员名单。
- 当前群还没有管理员时，首次成功修改群设置的人会自动成为首个 Themis 群管理员。
- 当当前群是 `shared` 会话时，只有群管理员可以执行 `/new`、`/use`、`/workspace`。

### `/update`

查看当前实例的版本状态，或在单聊里触发后台升级 / 回滚。

规则：

- `/update`、`/update check`、`/update status`：读取当前版本、GitHub 目标版本、最近一次回滚锚点，以及后台升级任务状态。
- `/update apply confirm`：后台执行受控升级。流程仍然复用 `git fetch/pull(or release tag) + npm ci + npm run build + 请求 systemd --user restart` 这条正式实例升级链。
- `/update rollback confirm`：后台回滚到最近一次成功升级前的版本，再请求重启当前服务。
- `apply / rollback` 只允许在和 Themis 的单聊里执行，避免群聊误触导致实例重启。
- 飞书这里只负责“发起”和“看状态”；进度文件固定写在 `infra/local/themis-update-operation.json`，服务重启期间飞书会短暂中断，稍后再发 `/update` 即可查看最终结果。

### `/link <绑定码>`

可选能力。默认情况下，飞书和 Web 已共享同一个私人助理 principal；只有需要认领旧 Web 浏览器身份时，才需要它。

典型流程：

1. 在 Web 设置里为当前浏览器生成绑定码。
2. 在飞书发送 `/link <绑定码>`。
3. 之后这个浏览器再发 Web 请求时，会自动落到同一个私人助理 principal。

### `/reset confirm`

清空当前 principal 的人格档案、对话历史、默认任务配置和后端会话索引，并重新开始。

执行效果：

1. 如果当前飞书 chat 正有任务在运行，会先中断。
2. 后端按当前 `principalId` 清空长期协作档案和历史上下文。
3. 飞书侧会自动切到一个新的 session id。
4. 下一条普通消息会像新用户一样重新开始 bootstrap。

### `/settings`

查看 `/settings` 这一层的配置树入口。

当前第一层子项是：

- `/settings sandbox`
- `/settings search`
- `/settings network`
- `/settings approval`
- `/settings account`

这些配置都属于当前 principal 的长期默认配置，不再是会话配置。

生效规则：

- 只影响之后新发起的任务
- 不会打断已经在运行中的任务
- Web 和飞书读写同一份默认配置

### `/settings sandbox`

查看当前 principal 默认沙箱模式、来源和可选值。

执行 `/settings sandbox <read-only|workspace-write|danger-full-access>` 才会真正修改。

### `/settings search`

查看当前 principal 默认联网搜索模式、来源和可选值。

执行 `/settings search <disabled|cached|live>` 才会真正修改。

### `/settings network`

查看当前 principal 默认网络访问开关、来源和可选值。

执行 `/settings network <on|off>` 才会真正修改。

### `/settings approval`

查看当前 principal 默认审批策略、来源和可选值。

执行 `/settings approval <never|on-request|on-failure|untrusted>` 才会真正修改。

### `/settings account`

查看认证账号相关的下一层子命令：

- `/settings account current`
- `/settings account list`
- `/settings account use`
- `/settings account login`
- `/settings account logout`
- `/settings account cancel`

其中：

- `/settings account current` 查看当前 principal 默认认证账号
- `/settings account list` 查看可用认证账号列表
- `/settings account use` 查看切换说明
- `/settings account use <账号名|邮箱|序号|default>` 真正修改当前 principal 默认认证账号
- `/settings account login` 查看账号登录帮助；飞书端当前只支持设备码登录
- `/settings account login device [账号名|邮箱|序号|default]` 发起设备码登录
- `/settings account logout [账号名|邮箱|序号|default]` 退出账号登录态
- `/settings account cancel [账号名|邮箱|序号|default]` 取消仍在进行中的登录

### 兼容入口

为了兼容旧习惯，下面这些平铺命令当前仍可用，但主路径已经改成 `/settings ...`：

- `/account ...`
- `/sandbox ...`
- `/search ...`
- `/network ...`
- `/approval ...`

### `/msgupdate`

验证飞书是否允许机器人原地更新自己刚刚发送的文本消息。

执行效果：

1. 机器人先发一条短文本探针消息。
2. 约 2 秒后，尝试直接更新这条消息内容。
3. 如果最终你只看到一条消息，但内容发生了变化，说明文本消息 `update` 可用。
4. 如果失败，机器人会再发一条失败说明，并尽量提示是权限、机器人能力还是其他接口限制。

权限注意：

- 飞书官方“编辑消息”接口要求应用至少具备以下任意一项权限：`im:message`、`im:message:send_as_bot`、`im:message:update`。
- 如果当前应用只有 `im:message:send`，发送消息可能正常，但原地更新未必能调用成功。

### `/quota`

查看当前 Codex / ChatGPT 认证对应的额度信息，包括：

- 认证方式
- 账号
- 套餐
- 主额度剩余百分比
- 次额度剩余百分比
- 附加 credits

## Waiting Action 与任务状态表达

- `task.action_required` 到达时，飞书会输出“等待你处理”的摘要消息，并直接给出 `/approve`、`/deny` 或 `/reply` 的命令提示。
- `task.action_required` 到达时，如果当前 `sessionId + principalId` scope 下只有 1 条 `user-input` pending action 且没有 `approval` pending action，飞书会优先把普通文本当成补充输入；如果同一 scope 下有多条 `user-input` pending action，则会明确提示改用 `/reply <actionId> <内容>`。
- waiting action 摘要会同时带出当前 `sessionId` 与 native thread 摘要，减少移动端来回切 `/current` 的成本。
- Web / 飞书之间的 waiting action 虽然支持跨端接管，但边界不是裸 `sessionId`；飞书侧会同时按当前激活 `sessionId` 和当前 `principalId` 查找 pending action，所以同一会话里属于其他 principal 的 action 不会被误接管。
- action 提交后的 `running / restoring / completed / failed` 这类状态变化，会额外落一条状态摘要消息。
- 状态摘要不会打断原有的 `处理中...` 占位链路；正文流和状态流会分开表达。

## 普通消息行为

- 单聊直接发送普通文本：进入当前会话
- 群聊默认 `smart` 路由下，首条普通文本只有在显式触达（@ 机器人）、当前用户在该群会话作用域下有 waiting action、当前用户有运行中任务，或最近 10 分钟刚命中过一次群路由时，才会进入当前会话；否则会被静默忽略并记录 `message.route_ignored`
- 群聊切到 `always` 路由后，普通文本会默认直接进入当前会话
- 群聊会话策略如果是 `personal`，同一群里的不同成员仍各自维护当前会话；如果是 `shared`，则整群共用同一条当前会话和同一份附件草稿
- 如果当前在 waiting `user-input`，并且 `sessionId + principalId` scope 里只有 1 条 `user-input` pending action、且没有 `approval` pending action，普通文本会直接接管这条 waiting input；如果同一 scope 里有多条 `user-input` pending action，会提示改用 `/reply <actionId> <内容>`
- 如果当前还没有激活会话：自动创建新会话
- 如果当前 principal 还没有已完成的长期协作档案，普通文本会先进入一次性 bootstrap，而不是直接执行正式任务
- 如果当前 principal 保存过默认任务配置，这些配置会随任务请求一起带入 Codex runtime
- 飞书 `post` 富文本会按当前实现提取文本与图片节点；如果同一条 `post` 里同时有正文和图片，会直接把正文和图片一起送进本次任务输入
- 飞书 `image` / `file` 消息会先进入附件草稿，等下一条真正进入普通任务路径的文本时再自动合并发送；waiting action 恢复和 slash 命令不会消费草稿
- 相同 `message_id` 的飞书文本事件会在去重窗口内被忽略，当前窗口是 10 分钟，避免长连接重放时重复启动任务或重复提交 action
- 同一 `chatId + userId` 下，如果一条消息的 `message.create_time` 早于最近已处理消息，但又更晚到达服务端，这类延迟旧消息也会在同一个 10 分钟窗口内被静默忽略，避免乱序重放把旧文本或旧 slash 命令重新执行；它不是永久顺序保证
- 如果两条不同消息的 `message.create_time` 恰好相等，它们不会因为这条规则互相误伤，仍会继续按正常消息处理
- 这层 `create_time` 保护是入口级的，所以跨会话更旧的 `/use` 也不会把当前激活会话切回旧 session；同一批次里更旧的 `/use` + 旧普通文本、`/approve` 或 `/reply` 组合晚到时，也会一起被静默吞掉，不再制造“切回旧会话”“追加过时 turn”或“未找到等待中的 action”噪音
- 如果同一会话里上一条任务还没跑完，新消息会先打断旧任务，再自动进入当前会话
- 被打断的旧任务如果已经有回复消息，通常会把那条消息原地改成“任务已取消”

## 代码入口

- 飞书服务入口：`src/channels/feishu/service.ts`
- 飞书当前激活会话指针：`src/channels/feishu/session-store.ts`
- 飞书顺序延迟桥接：`src/channels/feishu/task-message-bridge.ts`
- 飞书请求适配：`src/channels/feishu/adapter.ts`
- 统一会话解析：`src/core/conversation-service.ts`
- 启动挂载：`src/server/main.ts`

## 已完成验证

- `npm run typecheck`
- `npm run build`
- `timeout 5s npm run dev:web:once`
- `node --test --import tsx src/server/http-feishu-cross-channel-journey.test.ts`
- 带飞书凭证启动冒烟

其中冒烟启动已验证：

- HTTP 主服务可正常启动
- 未配置飞书凭证时会优雅跳过飞书长连接服务
- 配置飞书凭证后，SDK 会尝试建立长连接
- shared cross-channel 自动化回归已覆盖真实飞书消息事件入口：通过 `acceptMessageReceiveEvent` 驱动 `/use`、普通文本续跑、重复 `message_id` 去重、`create_time` 延迟旧消息忽略、`create_time` 相等消息不误丢、跨会话旧 `/use` 不回切、旧 `/use` + 旧普通文本 / `/approve` / `/reply` 组合晚到静默忽略，以及旧 `/use` + 旧普通文本 + 旧 `/approve` 小批量晚到静默忽略、`/approve`、`/reply`、`/review`、`/steer`、双 waiting action 长恢复链，以及“Web waiting action 由飞书接管后继续追加新 turn”“Web -> Feishu -> Web 连续三轮 history/detail 一致”和“Web -> Feishu -> Web -> Feishu 连续四轮 history/detail 一致”的长链 E2E，验证 Web / 飞书会继续复用同一 session 与 native thread，并保持跨端恢复语义一致

## 长连接排障

如果启动日志里出现类似下面的错误：

```text
[ws] Request failed with status code 400
```

先注意一个很容易绕进去的顺序问题：

- 飞书控制台这里不是“先保存长连接模式，再去启动代码”
- 官方文档要求的是“先用官方 SDK 启动长连接客户端，并确保连接成功，再回到控制台保存”
- 官方教程里也明确写到，连接成功时控制台应出现类似 `connected to wss://xxxxx` 的成功日志

优先检查：

1. 开发者后台是否已把订阅方式切到“长连接”
2. 当前应用是否为企业自建应用
3. 机器人能力、事件订阅、权限配置是否都已经发布新版本
4. 当前凭证是否对应正确应用
5. 当前进程是否真的已经与飞书建立成功连接，而不是只看到 SDK 初始化完成
6. 当前应用是否处于可体验长连接的企业环境；官方自动回复机器人教程明确说明“测试企业”不支持该教程
