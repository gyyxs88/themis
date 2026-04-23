# Themis 发布验收矩阵

## 这篇文档负责什么

- 只负责“发布前必须过什么”。
- 不负责灰度顺序、观察窗口和回退动作；那些内容看 [themis-release-rollout-and-rollback.md](./themis-release-rollout-and-rollback.md)。
- 如果你只是临时接手仓库，不确定先看哪篇，先回到 [themis-operator-onboarding.md](./themis-operator-onboarding.md)。

## 阻塞规则

- 任何一条自动化命令失败，都不进入灰度。
- `./themis doctor release` 返回非 `0`，不进入灰度。
- `./themis doctor smoke web` 失败，不继续飞书放量。
- 飞书手工 A/B 未完成，不宣布“飞书端已可推广”。

## 自动化验收

| 类别 | 命令 | 通过标准 |
| --- | --- | --- |
| 类型基线 | `npm run typecheck` | 退出码为 `0` |
| Web 主链路 | `node --test --import tsx src/server/http-web-journey.test.ts` | 真实 Web journey 全绿 |
| 飞书跨端金路径 | `node --test --import tsx src/server/http-feishu-journey.test.ts` | direct-text takeover / mixed recovery 主链路全绿 |
| 飞书服务边界 | `node --test --import tsx src/channels/feishu/service.test.ts` | 路由、会话、管理员、warning 文案回归全绿 |
| 诊断总览 | `./themis doctor` | 没有新的 error 级热点 |
| Web 真实 smoke | `./themis doctor smoke web` | `task.action_required -> completed` 与多模态 compile 事实通过 |
| 飞书 smoke 前置检查 | `./themis doctor smoke feishu` | 配置齐备、服务可达、可继续手工 A/B |
| 发布就绪汇总 | `./themis doctor release` | 返回 `0`，且文档/诊断/smoke 全部通过 |

## 推荐执行顺序

1. 先跑自动化命令。
2. 再跑 `./themis doctor`、`./themis doctor smoke web`、`./themis doctor smoke feishu`。
3. 最后补手工 Web / 飞书验收。

## 飞书固定矩阵

当前飞书固定矩阵仍沿用既有 `7` 条：

1. `Web -> 飞书 direct-text takeover`
2. `approval -> user-input -> 飞书 direct-text takeover`
3. `真实业务 prompt 低成本探针`
4. `doctor smoke feishu + 手工 A/B 接力验收`
5. `/use` 切会话后的 waiting action 绑定
6. `duplicate / stale message 忽略`
7. `submit_failed / blocked_by_approval / ambiguous` 诊断分支

对应代码与入口以 [src/diagnostics/feishu-verification-guide.ts](../../src/diagnostics/feishu-verification-guide.ts) 为准。

## 手工验收

### Web

1. 从未登录态打开 Web，确认登录与会话列表正常。
2. 新建会话，发送普通任务，确认过程消息、waiting action 和最终收口正常。
3. 在同一会话里发送图片或文档，确认历史回放能看到输入摘要。

### 飞书

1. 先运行 `./themis doctor feishu -> ./themis doctor smoke web -> ./themis doctor smoke feishu`。
2. 按 [themis-feishu-real-journey-smoke.md](../feishu/themis-feishu-real-journey-smoke.md) 执行手工 A/B。
3. 至少覆盖一次群聊 shared 会话和一次普通 direct-text takeover。

## 发布前记录

- 记录本次放量 commit hash。
- 记录 `./themis doctor release` 输出时间。
- 记录飞书手工 A/B 的执行人和结论。
- 验收通过后，再进入 [themis-release-rollout-and-rollback.md](./themis-release-rollout-and-rollback.md) 的灰度流程。
