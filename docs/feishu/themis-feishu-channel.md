# Themis 飞书渠道说明

更新日期：2026-03-24

## 当前实现

Themis 已接入飞书长连接渠道，特点如下：

- 使用飞书官方 Node SDK 长连接模式接收 `im.message.receive_v1`
- 飞书普通文本消息会作为 Themis 任务输入
- 飞书发任务前会读取当前会话保存的服务端配置，并带上对应 `options`
- Codex 运行过程中产生的中途文本回复会立即推送到飞书
- 最终结果也会单独推送到飞书
- 推送消息末尾会追加标志
  - 中途回复：`[中途回复]`
  - 最终结果：`[最终回复]`
  - 失败：`[任务失败]`
  - 异常：`[执行异常]`
  - 取消：`[任务已取消]`

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
- 当前实现会为“同一个飞书聊天中的同一个用户”维护一个当前激活的 conversation 指针。
- 这个“当前激活会话指针”保存在：

```text
infra/local/feishu-sessions.json
```

- 这个 JSON 文件只负责记录飞书侧当前激活的是哪条 conversation。
- 真正的统一 conversation、channel binding、identity 和历史数据都保存在：

```text
infra/local/themis.db
```

这样可以支持：

- 在同一个飞书聊天里新开会话
- 在已有会话之间切换
- 不影响现有 Web 端会话历史
- 使用同一个 `conversationId` 时，与 Web 复用同一条服务端会话和上下文

## 飞书命令

所有命令都使用 `/xxx` 形式。

### `/help`

查看帮助。

### `/sessions`

查看最近的全局会话列表，包含 Web 和飞书创建的 conversation。

注意：

- 这里只共享“可进入的会话池”，不自动同步两端当前激活的是哪一条。
- 想在飞书继续某条 Web 会话，仍需手动执行 `/use <conversationId>` 或 `/use <序号>`。

### `/new`

创建并切换到一个新会话。

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

### `/link <绑定码>`

可选能力。默认情况下，飞书和 Web 已共享同一个私人助理 principal；只有需要认领旧 Web 浏览器身份时，才需要它。

典型流程：

1. 在 Web 设置里为当前浏览器生成绑定码。
2. 在飞书发送 `/link <绑定码>`。
3. 之后这个浏览器再发 Web 请求时，会自动落到同一个私人助理 principal。

### `/settings`

查看当前会话保存的服务端配置。

当前会展示：

- 接入方式
- 模型
- 第三方供应商 / 模型
- 推理强度
- 审批策略
- 沙箱模式
- 联网搜索
- 网络访问

未设置的项会回退到运行时默认值。

### `/sandbox <default|read-only|workspace-write|danger-full-access>`

设置当前会话的沙箱模式。

### `/search <default|disabled|cached|live>`

设置当前会话的联网搜索模式。

### `/network <default|on|off>`

设置当前会话的网络访问开关。

### `/approval <default|never|on-request|on-failure|untrusted>`

设置当前会话的审批策略。

### `/quota`

查看当前 Codex / ChatGPT 认证对应的额度信息，包括：

- 认证方式
- 账号
- 套餐
- 主额度剩余百分比
- 次额度剩余百分比
- 附加 credits

## 普通消息行为

- 直接发送普通文本：进入当前会话
- 如果当前还没有激活会话：自动创建新会话
- 如果当前会话保存过服务端配置，这些配置会随任务请求一起带入 Codex runtime
- 当前实现只处理文本消息
- 非文本消息暂不进入任务执行链路
- 如果同一会话里上一条任务还没跑完，新消息会先打断旧任务，再自动进入当前会话
- 被打断的旧任务仍会按实际状态回推一条 `任务已取消`

## 代码入口

- 飞书服务入口：`src/channels/feishu/service.ts`
- 飞书当前激活会话指针：`src/channels/feishu/session-store.ts`
- 飞书请求适配：`src/channels/feishu/adapter.ts`
- 统一会话解析：`src/core/conversation-service.ts`
- 启动挂载：`src/server/main.ts`

## 已完成验证

- `npm run typecheck`
- `npm run build`
- `timeout 5s npm run dev:web:once`
- 带飞书凭证启动冒烟

其中冒烟启动已验证：

- HTTP 主服务可正常启动
- 未配置飞书凭证时会优雅跳过飞书长连接服务
- 配置飞书凭证后，SDK 会尝试建立长连接

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
