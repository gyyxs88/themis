# Themis 飞书审批卡实施计划

更新日期：2026-04-08
状态：第一轮已实现；本文档保留为实现对照与后续扩面边界。

相关文档：

- [Themis 飞书卡片交互 PoC 草案](./themis-feishu-card-poc-draft.md)
- [飞书 `card.action.trigger` 进入条件](../memory/2026/03/feishu-card-action-trigger-entry-criteria.md)
- [Themis 飞书渠道说明](./themis-feishu-channel.md)

## 目标

把“审批卡”收成飞书卡片交互的第一张实现卡，前提是不打散现有文本审批链：

- 当前文本链：`task.action_required -> renderFeishuWaitingActionSurface -> /approve | /deny`
- 目标卡片链：`task.action_required(approval) -> 审批卡 -> card.action.trigger -> 复用现有审批提交逻辑`

第一轮只解决审批动作本身，不顺手扩到 `user-input`、`review / steer`、状态卡或 agent 治理卡。

## 范围冻结

### 本轮要做

- `approval` waiting action 的卡片渲染
- `批准 / 拒绝` 两个按钮
- 卡片回调接线
- 幂等与 token 生命周期最小治理
- 失败时安全退回文本命令链

### 本轮不做

- `user-input` 自由文本补充卡
- `review / steer` 卡片化
- 运行中 / 阻塞状态卡
- agent 治理卡
- 群聊复杂管理员卡片编排
- 飞书内长任务流式卡片刷新
- “打开 Web 详情”这类依赖稳定 deeplink 的按钮

最后这条不做不是因为没价值，而是当前仓库里还没有一个稳定、跨环境一致的飞书 -> Web deeplink 约定；如果硬塞进第一轮，会把 PoC 范围拉歪。

## 当前事实基线

审批卡必须严格复用现有事实，不自己再造一套审批状态。

当前已经存在的链路：

- `src/channels/feishu/service.ts`
  - `decorateDeliveryMessageForMobile(...)` 会把 `task.action_required` 转成移动端文本面。
  - `resolvePendingApproval(...)` 已经完整处理 `/approve` / `/deny` 的 scope、action 查找、提交、诊断事件和失败提示。
- `src/channels/feishu/mobile-surface.ts`
  - `renderFeishuWaitingActionSurface(...)` 已经把审批等待面收成标准文本模板。
- `src/channels/feishu/task-message-bridge.ts`
  - 当前只支持文本消息的创建、更新和终态收口。
- `src/channels/feishu/service.ts`
  - 当前长连接继续只处理 `im.message.receive_v1`；审批卡回调第一轮已确认走 HTTP webhook `POST /api/feishu/card-action`，不复用长连接入口。
- `src/types/channel.ts`
  - `ChannelContext.callbackToken` 已预留，但还没有生产使用。

这意味着第一刀不能只写卡片 JSON，还必须把“卡片发送/回调/持久化”接到现有飞书渠道层里。

## 用户路径

### 正常路径

1. runtime 产出 `task.action_required`，且 `actionType = approval`。
2. 飞书渠道识别为“审批卡候选”。
3. 机器人发送一张审批卡，卡上展示审批摘要、影响范围、`actionId` 和文本降级命令。
4. 用户点击 `批准` 或 `拒绝`。
5. 飞书回调进入 Themis。
6. Themis 复用现有审批提交逻辑完成 `actionBridge.resolve(...)`。
7. 原卡被更新成终态卡，按钮失效，并显示“审批已提交”或“审批已拒绝”。

### 降级路径

以下任一场景命中时，直接退回文本链：

- 卡片发送失败
- 回调超时
- token 过期
- 更新次数耗尽
- 重复点击
- 目标 action 已失效

降级文案固定带上：

- 当前 action 状态
- `/approve <actionId>`
- `/deny <actionId>`

## 卡片内容建议

### 字段

- 标题：`等待你确认`
- 会话：`sessionId`
- 任务状态：如果已有最近状态则展示
- 审批摘要：直接取 waiting prompt
- 影响范围：优先从现有元数据抽工作区、网络、账号等；第一轮如果没有结构化字段，就先只显示 prompt
- `actionId`
- 文本降级提示：`/approve <actionId>`、`/deny <actionId>`

### 按钮

- `批准`
- `拒绝`

第一轮不加第三个按钮，避免分散预算和实现注意力。

## 更新预算策略

审批卡和状态卡不同，第一轮预算要更省：

- 不做“处理中”卡片更新。
- 回调 `3` 秒内只返回同步 ack / toast。
- 原卡只做一次最终更新：
  - `已提交批准`
  - `已提交拒绝`
  - 或 `提交失败，请改用文本命令`

这样能把审批卡的一次点击稳定控制在 `1` 次卡片更新内，比状态卡更适合作为第一张 PoC。

## 持久化策略

### 第一轮建议

先用飞书渠道本地 JSON store，不急着上 SQLite。

原因：

- 当前飞书渠道已有 `feishu-chat-settings.json`、`feishu-diagnostics.json`、`feishu-attachment-drafts.json` 这类本地状态文件。
- 审批卡第一轮只服务飞书渠道，不需要跨渠道查询。
- 先把 PoC 做薄，后续如果扩到状态卡 / agent 卡，再考虑统一进 SQLite。

### 建议文件

- `infra/local/feishu-card-state.json`

### 第一轮最小字段

- `cardKey`
- `messageId`
- `chatId`
- `sessionId`
- `principalId`
- `taskId`
- `requestId`
- `actionId`
- `actionType`
- `callbackToken`
- `tokenExpiresAt`
- `updateCount`
- `lastCallbackDedupKey`
- `status`
- `createdAt`
- `updatedAt`

## 文件级实施清单

### 1. 补卡片渲染层

文件：

- 新增 `src/channels/feishu/card-renderer.ts`

职责：

- 根据审批 waiting action 事实输出飞书 interactive card payload。
- 输出终态卡 payload。
- 统一卡片里文本降级命令的文案格式。

说明：

- 不要把卡片 JSON 直接散在 `service.ts`。
- 第一轮只支持审批卡，不提前泛化成“万能卡片 DSL”。

### 2. 补卡片状态存储

文件：

- 新增 `src/channels/feishu/approval-card-state-store.ts`

职责：

- 保存审批卡绑定关系和 token 元数据。
- 记录审批卡和 `actionId / sessionId / messageId` 的绑定关系。
- 保存回调 token、open message id、操作者和终态结果。

说明：

- 第一轮只需要针对审批卡够用的读写接口，不要提前做大而全仓库。

### 3. 扩飞书消息发送能力

文件：

- `src/channels/feishu/service.ts`
- `src/channels/feishu/task-message-bridge.ts`

需要改动：

- 在 `service.ts` 增加 `createCardMessage(...)`、`updateCardMessage(...)`。
- 让 `FeishuTaskMessageBridge` 除文本外也能发送“终态等待面卡片”。
- 保留当前文本消息接口不动，卡片发送失败时立即回退到现有文本面。

说明：

- 当前 bridge 的 `createText / updateText / sendText` 能力不够，需要最小扩容。
- 不要因为审批卡把所有 progress/update 逻辑都卡片化；只针对 `task.action_required(approval)` 分支扩。

### 4. 补审批卡候选识别

文件：

- `src/channels/feishu/service.ts`
- 视需要补 `src/channels/feishu/types.ts`

需要改动：

- 在 `decorateDeliveryMessageForMobile(...)` 或其相邻流程里，把 `approval` waiting action 标记成“可卡片化”。
- metadata 里补足渲染审批卡所需的最小字段。

说明：

- 第一轮仍保留 `renderFeishuWaitingActionSurface(...)` 作为文本降级出口。
- 不要删现有文本 waiting action 面。

### 5. 接 `card.action.trigger` 回调

文件：

- `src/channels/feishu/service.ts`
- `src/server/http-server.ts`

需要改动：

- 在 HTTP 服务里额外放行 `POST /api/feishu/card-action`，确保它先于 Web 鉴权处理。
- 回调进入后统一在 `service.ts` 内完成：
  - payload 解析
  - 操作者身份提取
  - 审批卡状态查找
  - 动作路由

说明：

- 已验证 Node SDK 下审批卡回调更适合直接走 `CardActionHandler.invoke(...)` + HTTP webhook；第一轮不把 `card.action.trigger` 塞进长连接 dispatcher。

### 6. 复用现有审批提交逻辑

文件：

- `src/channels/feishu/service.ts`

需要改动：

- 把 `resolvePendingApproval(...)` 拆成：
  - 文本命令入口
  - 可复用的审批提交核心函数

建议目标形态：

- `resolvePendingApprovalFromCommand(...)`
- `submitPendingApproval(...)`

说明：

- 卡片回调和 `/approve` / `/deny` 必须共用一套 scope 校验、action 查找、`actionBridge.resolve(...)`、diagnostics 事件和错误口径。
- 不允许写出第二套“卡片版审批提交逻辑”。

### 7. 补失败与降级处理

文件：

- `src/channels/feishu/card-callback.ts`
- `src/channels/feishu/service.ts`

必须覆盖：

- action 已失效
- token 过期
- 更新次数耗尽
- 重复点击
- 非审批 action 误命中
- 当前操作者不在允许 scope

统一结果：

- 尝试更新原卡；如果失败，就发文本 follow-up。
- follow-up 文本必须带现有命令链，不能只说“请稍后再试”。

### 8. 补测试

文件：

- 新增 `src/channels/feishu/card-renderer.test.ts`
- 新增 `src/channels/feishu/card-state-store.test.ts`
- 更新 `src/channels/feishu/service.test.ts`
- 更新 `src/channels/feishu/task-message-bridge.test.ts`

至少覆盖：

- 审批 waiting action 会走卡片发送分支
- 卡片发送失败会回退到文本面
- `批准 / 拒绝` 回调会命中现有审批逻辑
- 重复点击不会重复提交
- token 过期会走文本降级
- action 已失效会更新失败态或发 follow-up

## 建议实施顺序

1. 先补 `card-renderer.ts` 和 `card-state-store.ts`
2. 再扩 `service.ts` 的卡片创建/更新能力
3. 再扩 `task-message-bridge.ts` 的等待面分支
4. 再接 `card.action.trigger`
5. 最后把 `/approve` / `/deny` 逻辑抽成共享函数

这样做的好处是：每一刀都能独立验证，不会一上来就把“卡片发送、卡片回调、审批提交”三件事缠在一起。

## 验证清单

建议最少跑：

- `node --test src/channels/feishu/card-renderer.test.ts`
- `node --test src/channels/feishu/card-state-store.test.ts`
- `node --test --import tsx src/channels/feishu/service.test.ts`
- `node --test src/channels/feishu/task-message-bridge.test.ts`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

如果首轮实现涉及真实飞书配置，再补：

- `./themis doctor feishu`
- `./themis doctor smoke feishu`
- 手工审批卡点击验收

## 风险与取舍

### 1. 长连接下 `card.action.trigger` 的 SDK 接形

这是第一刀要先验证的技术事实。  
如果长连接接法和当前消息事件不同，优先补适配层，不要用一堆 if/else 把 `service.ts` 写乱。

### 2. 更新预算

审批卡第一轮故意不做“处理中”更新，就是为了把预算压到最低。  
如果后面真的需要中间态，宁可发文本 follow-up，也不要先把卡片更新预算耗光。

### 3. 持久化位置

第一轮先用本地 JSON store 是为了收敛范围。  
如果第二轮继续做状态卡或 agent 治理卡，再统一评估是否迁到 SQLite。

### 4. Web deeplink

现在不把“打开 Web 详情”塞进第一轮，是一个刻意收窄，不是遗漏。  
等审批卡走通后，再单独决定要不要补飞书 -> Web deeplink 约定。

## 交付完成的判断标准

只有同时满足下面这些条件，才算审批卡第一轮真的完成：

- 审批 waiting action 默认会优先发卡，而不是只发文本。
- 卡片点击 `批准 / 拒绝` 后能复用现有审批链正常收口。
- 重复点击、token 过期、action 失效都能安全降级。
- 文本命令链仍然完好可用。
- 现有群路由、shared 会话和 principal scope 语义没有被卡片链路打散。

## 当前建议

- 这份计划可以直接作为下一轮实现任务的底稿。
- 真正开工时，先从“审批卡 + 文本降级”做起，不要同时拉上状态卡和 agent 卡。
