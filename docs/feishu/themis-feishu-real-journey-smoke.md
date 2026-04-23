# 飞书真实旅程 Smoke 剧本

更新日期：2026-04-02

整个固定飞书复验矩阵目前收口为四个主场景：

- 自动化 `Web -> 飞书 direct-text takeover`
- 自动化 `approval -> user-input -> 飞书 direct-text takeover`
- `./themis doctor smoke web` 的真实业务 prompt 低成本探针
- `./themis doctor smoke feishu` + 本文里的手工 A/B 接力验收

这份剧本本身只展开最后一项，也就是两条真实手工路径：

- A. `Web -> 飞书 direct-text takeover`
- B. `approval -> user-input -> 飞书 direct-text takeover`

不要把它扩展成全量回归，也不要在这里验证飞书自动同步当前激活会话。

## 推荐入口

优先从正式 CLI 入口开始，而不是直接找 `temp/` 脚本。推荐定位顺序是：

1. `./themis doctor feishu`
2. `./themis doctor smoke web`
3. `./themis doctor smoke feishu`
4. 再走下面的手工 A/B 路径

```bash
./themis doctor smoke feishu
```

`doctor smoke feishu` 只输出飞书 smoke 所需的前置检查、诊断上下文和手工接力提示，不会替你在飞书里自动发消息。

如果只想单独执行某一层：

```bash
./themis doctor feishu
./themis doctor smoke web
./themis doctor smoke feishu
```

- `doctor feishu`：先看飞书主诊断和深层诊断，确认问题是落在服务、会话、action、消息顺序还是恢复边界。
- `doctor smoke web`：自动验证真实 Web / HTTP 主链路会不会进入 `task.action_required`，并在 action 提交后收口为 `completed`。
- `doctor smoke feishu`：再看 smoke 入口输出，确认 CLI 已把主诊断摘要、服务状态、计数和统一 next steps 带出来，方便定位问题，但它仍然只是前置检查 + 手工接力入口。
- `temp/feishu-real-journey-smoke.sh` 继续保留为本地起服务辅助脚本，但不再是推荐主入口。

## 前置条件

### A. `Web -> 飞书 direct-text takeover`

- 已配置 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`
- 如果凭证保存在项目根目录的 `.env` 或 `.env.local`，`temp/feishu-real-journey-smoke.sh` 会自动读取，不需要额外 `export`
- `principal` 已完成 bootstrap
- Web / 飞书当前激活会话不会自动同步
- Web 端支持 synthetic smoke 命令 `/smoke user-input`

### B. `approval -> user-input -> 飞书 direct-text takeover`

- 已配置 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`
- 如果凭证保存在项目根目录的 `.env` 或 `.env.local`，`temp/feishu-real-journey-smoke.sh` 会自动读取，不需要额外 `export`
- `principal` 已完成 bootstrap
- Web / 飞书当前激活会话不会自动同步
- Web 端支持 synthetic smoke 命令 `/smoke mixed`
- synthetic smoke 的两段 waiting action 都会落在同一个 `sessionId + principalId` scope

## 准备

1. 启动验收环境。
   - 如果本机已经有同仓库的 Themis 服务占着 `3100`，不要再直接起第二个实例；优先复用当前服务，或者临时改用 `THEMIS_PORT=<其他端口> bash temp/feishu-real-journey-smoke.sh`。
2. 如果当前还没有可复用服务，再运行：

```bash
bash temp/feishu-real-journey-smoke.sh
```

3. 确认日志里出现飞书长连接启动成功、事件接收已就绪之类的启动信息。
4. 先运行 `./themis doctor feishu`，看主诊断、诊断摘要、建议动作和当前会话。
5. 再运行 `./themis doctor smoke web`，确认真实 Web / HTTP 主链路仍能稳定进入 `task.action_required` 并收口。
6. 再运行 `./themis doctor smoke feishu`，确认 smoke 输出已经带出主诊断摘要、服务状态、计数和统一 next steps。
7. 在飞书里执行 `/msgupdate`，确认命令链路可正常返回。
8. 准备好一条新的 Web 会话，用来依次执行：
   - `/smoke user-input`
   - `/smoke mixed`

## 低成本真实 prompt 复跑

如果这次不是想验 synthetic smoke，而是想先快速确认“真实业务 prompt 会不会真的进入 waiting `user-input`”，优先运行：

```bash
./themis doctor smoke web
```

这条正式探针会直接复用当前 `3100` 服务，自动完成：

- 创建临时 Web 访问口令并登录
- 发起一条真实业务 prompt
- 等到 `task.action_required`
- 自动提交文件路径
- 确认 `history/detail` 最终收口为 `completed`

适用范围：

- 它只验证真实 Web / HTTP 主链路，不验证飞书最后一跳
- 如果这条探针都进不了 `task.action_required`，先不要去飞书手工试，先回头看 app-server feature gate、runtime 与日志
- 如果这条探针已通过，再去做下面的飞书手工接管，定位会更干净
- `temp/repro-real-web-user-input-http.ts` 仍可保留给开发调试，但平时复跑优先走 `doctor smoke web`

## 触发方式

- 不再依赖自然语言 prompt 猜测 `requestUserInput`
- A 路径固定用 `/smoke user-input`
- B 路径固定用 `/smoke mixed`
- `/smoke user-input` 会直接生成一条真正的 waiting `user-input`
- `/smoke mixed` 会先生成 `approval`，审批通过后再生成 `user-input`

## 验收步骤

### A. `Web -> 飞书 direct-text takeover`

1. 在 Web 新会话里发送 `/smoke user-input`。
2. 记下这次任务对应的 `sessionId` 和 `conversationId`。
3. 在飞书里执行 `/sessions`，找到刚才那条会话。
4. 执行 `/use <conversationId|sessionId>`，切到同一条会话。
5. 直接发送一条普通文本，不要再用 `/reply`。
6. 观察飞书侧是否返回 `已提交补充输入。`。
7. 回到 Web 或 `history`，确认该任务最终收口为 `completed`。

### B. `approval -> user-input -> 飞书 direct-text takeover`

1. 在 Web 新会话里发送 `/smoke mixed`。
2. 记下这次任务对应的 `sessionId` 和 `conversationId`。
3. 在飞书里执行 `/sessions`，找到刚才那条会话。
4. 执行 `/use <conversationId|sessionId>`，切到同一条会话。
5. 执行 `/approve <actionId>` 处理这条 `approval`。
6. 观察到新的 waiting `user-input` 或 `task.action_required` 摘要已经出现，且当前会话里不再提示 `/approve` `/deny`，再发送普通文本，不要再用 `/reply`。
7. 直接发送一条普通文本。
8. 观察飞书侧是否返回 `已提交补充输入。`。
9. 回到 Web 或 `history`，确认该任务最终收口为 `completed`。

## 预期结果

### A. `Web -> 飞书 direct-text takeover`

- 飞书长连接正常启动
- `/msgupdate` 正常返回
- `doctor feishu -> doctor smoke web -> doctor smoke feishu -> 手工 A/B` 的顺序能帮你快速定位问题在哪一层
- `Web -> 飞书 direct-text takeover` 能直接接住 waiting `user-input`
- 飞书侧能看到 `已提交补充输入。`
- Web / `history` 最终状态是 `completed`
- `已提交补充输入。` 这条确认消息本身不再额外带 `[处理中]`

### B. `approval -> user-input -> 飞书 direct-text takeover`

- 飞书长连接正常启动
- `/msgupdate` 正常返回
- `approval` 先被显式处理掉，不再阻挡后续 direct-text takeover
- 后续 waiting `user-input` 仍能被普通文本接住
- 飞书侧能看到 `已提交补充输入。`
- Web / `history` 最终状态是 `completed`
- `已提交审批。` / `已提交补充输入。` 这两条确认消息本身都不再额外带 `[处理中]`

## 失败定位

### A. `Web -> 飞书 direct-text takeover`

- 如果长连接没有起来，先看飞书启动日志、`FEISHU_APP_ID` / `FEISHU_APP_SECRET` 和网络环境
- 如果 smoke 脚本在 ready 检查前就失败，且日志里是 `listen EADDRINUSE ...:3100`，说明本机已经有别的 Themis 进程占了默认端口；优先复用现有服务，或者用 `THEMIS_PORT=<其他端口>` 临时绕开
- 如果 `/msgupdate` 失败，先看命令是否进入正确的 principal / 会话上下文
- 如果 `/sessions` 找不到目标会话，先确认 Web 侧的 `/smoke user-input` 是否已经真正进入 waiting
- 如果 `/use` 后普通文本没有接管，优先检查当前 scope 里是否不止一条 `user-input` pending action，或者是不是还挂着 `approval`
- 如果飞书侧没有出现 `已提交补充输入。`，再回头看 Web / 飞书当前是否已经切到同一条会话，以及 `conversationId` / `sessionId` 是否记错
- 如果 Web / `history` 没有收口成 `completed`，继续看后端任务链、runtime 日志和该条任务的最终状态回写

### B. `approval -> user-input -> 飞书 direct-text takeover`

- 如果 `approval` 还在 scope 里没被显式处理，普通文本不会进入 direct-text takeover，这是预期行为，不是失败
- 如果已经处理掉 `approval`，但普通文本还是没有接住后续 `user-input`，优先检查当前 scope 里是不是同时挂了多条 `user-input` pending action
- 如果 `/sessions` 或 `/use` 之后切错了会话，先核对 `sessionId`、`conversationId` 和当前 principal 是否一致
- 如果飞书侧没有出现 `已提交补充输入。`，再看 `/smoke mixed` 是否真的已经从审批态切到了 waiting `user-input`
- 如果 Web / `history` 没有收口成 `completed`，继续看审批后续分支、runtime 日志和该条任务的最终状态回写
