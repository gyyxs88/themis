# Themis 灰度与回退

## 这篇文档负责什么

- 只负责“验收已经通过之后，怎么灰度、怎么观察、怎么回退”。
- 发布前是否已经达标，先看 [themis-release-acceptance-matrix.md](./themis-release-acceptance-matrix.md)。

## 当前原则

- Themis 目前没有独立的产品灰度开关，灰度靠“先给谁用”和“何时扩大范围”来做，不靠隐藏分支逻辑。
- 先守住飞书端，因为日常最常用的是飞书；Web 作为诊断和控制面继续保留。

## 进入前提

开始灰度前，至少已经满足：

1. [themis-release-acceptance-matrix.md](./themis-release-acceptance-matrix.md) 全部通过。
2. `./themis doctor release` 返回 `0`。
3. 本次放量 commit hash 已记录。

## 灰度步骤

### 第 0 步：发布前基线

1. 确认验收矩阵仍然成立，没有临时改动漂移。
2. 保存本次 commit hash。
3. 确认当前实例可执行 `./themis update rollback` 或其他已验证回退路径。

### 第 1 步：owner 小范围灰度

1. 先只让 owner 和维护同学使用最新版本。
2. 重点观察 `./themis doctor feishu`、`./themis doctor smoke web`、`./themis doctor smoke feishu`。
3. 观察窗口至少一个工作日。

### 第 2 步：小群灰度

1. 扩到少量真实飞书群和私聊用户。
2. 重点盯群聊 `smart / always` 路由、`personal / shared` 会话、管理员限制是否串线。
3. 观察窗口至少半天。

### 第 3 步：扩大放量

1. 在前两步稳定后，再扩大到更多群和团队成员。
2. 仍保持每天至少一次 `./themis doctor release` 或 `./themis doctor smoke all`。

## 重点观察项

- Web 真实 smoke 是否仍能进入 `task.action_required` 并收口。
- 飞书 direct-text takeover 和 mixed recovery 是否还稳定。
- 群聊 shared 会话是否出现串会话、串工作区、非管理员误操作。
- `doctor` 是否出现新的 error 级热点。

## 立即回退触发条件

- `./themis doctor smoke web` 失败。
- 飞书高频主链路连续出现真实 blocked / submit_failed。
- 群聊 shared 会话出现串线，已经影响真实协作。
- 发布后出现新的 error 级诊断热点，且无法在短时间内止血。

## 回退动作

1. 先停止扩大使用范围，不再继续通知更多人接入。
2. 记录当前异常现象、最近 commit hash 和最近一次 `doctor release` 结果。
3. 如果当前实例刚做过 `./themis update apply`，优先直接执行 `./themis update rollback` 回退最近一次成功升级；否则再手工回退到上一个已验证 commit。
   如果此时人已经在 Web 或飞书里，也可以分别走“运行参数 -> 实例升级 -> 回滚上一版”或 `/update rollback confirm`；三者最终复用的是同一条受控回滚链。
4. 重新跑：
   - `./themis doctor`
   - `./themis doctor smoke web`
   - `./themis doctor smoke feishu`
5. 如果问题集中在飞书最后一跳，优先把协作切回 Web 或暂停飞书推广，不要硬扛。

## 回退后复盘

- 明确是代码回归、配置漂移，还是飞书/外部环境变化。
- 把可复用结论补进 `docs/memory/`。
- 未补完自动化或 smoke 之前，不重新开始放量。
