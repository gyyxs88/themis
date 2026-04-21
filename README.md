# Themis

Themis 是一个围绕 `codex app-server` 构建的自托管协作壳。

当前公开仓 `themis` 主要负责 Web 与飞书入口、人类对话、历史、身份、运行参数等主产品语义，并通过 `/api/platform/*` 消费平台控制面事实。平台控制面、执行节点和共享契约当前由相关仓库分别承载。

## 相关组件

- `themis`（本仓）：主 Themis 产品壳，负责 Web / 飞书入口、会话、历史、身份、运行参数、自动化接口，以及必要的平台 gateway。
- `themis-platform`：平台控制面与平台后台，负责 `/api/platform/*`、nodes / execution lease / scheduler / oncall / 组织级治理。
- `themis-worker-node`：Worker Node 本机预检、常驻执行，以及 `register -> heartbeat -> pull -> execute -> report`。
- `themis-contracts`：共享契约、DTO、错误码与 schema。

## 当前状态

- 截至 `2026-04-15`，平台控制面、执行节点与真实局域网联调已经完成首轮验证；当前不再把这条线视为部署级阻塞。
- 主 Themis 已不再保留 `Platform Agents` 页面，也不再暴露 `/api/agents/*` 这层平台兼容路由。
- 平台值班、节点治理、`worker-fleet` 与 `nodes/*` 统一归 `themis-platform`。
- `2026-04-18` 起，主 Themis Web 设置面板已新增“内部会议室”页，并通过 `/api/meeting-rooms/*` 作为平台会议室 gateway；Themis 现在可以作为唯一管理者创建会议室、按 `discussionMode / entryMode` 组织多员工讨论、查看实时消息流、沉淀 `resolution`、提升为正式 `work item`，并关闭房间收口。平台页则新增“会议室观察台”，负责只读观察与必要时的强制终止，不承担主持发言。
- 本仓后续重点是主 Themis 自己的产品能力，以及通过共享契约消费平台事实的最小客户端能力。

## 当前定位

- 当前主要面向自托管、同机或局域网部署场景。
- 当前主执行链路是 `codex app-server`；仓库已不再依赖 `@openai/codex-sdk`。
- 公开 GitHub 仓是正式版本源；`themis status` 会检查 GitHub 最新提交并给出升级建议。
- 当前不是通用云服务，也不是以 npm 包发布为目标的项目。

## 本仓负责什么

- 提供本地 / 局域网 Web 聊天工作台，支持认证、多账号、历史、分叉、运行参数和长期画像。
- 提供飞书机器人入口，并和 Web 共享运行时、通信层与 SQLite 持久化。
- 提供主 Themis 自己的会话、历史、身份、配置、任务入口与自动化接口。
- 提供 `status / doctor / doctor smoke / doctor release` 这套运维诊断入口。
- 提供 `POST /api/tasks/automation/run` 这类自动化接口。
- 提供单次定时任务与员工治理能力，并通过 `themis mcp-server` 暴露 `create_scheduled_task / list_scheduled_tasks / cancel_scheduled_task / list_managed_agents / get_managed_agent_detail / create_managed_agent / update_managed_agent_execution_boundary / dispatch_work_item / update_managed_agent_lifecycle` 给 Codex 调用。
- 提供平台会议室 gateway 与 Web 主持台，支持 `status / list / create / detail / participants/add / resolutions/create / resolutions/promote / close / message/stream` 这组内部会议能力，让 Themis 能以管理者身份拉多个数字员工进入同一个会议室讨论，并按轮次排队、定向发言、带上下文入场和会议收口；平台页的会议室观察台会直接读取平台真相源，并提供只读观察与终止会议能力。

## 数字员工边界

- Themis 当前支持的“数字员工 / 持久化 agent”能力不是 Codex 原生产品能力，而是 Themis 在 `codex app-server` 之上补出来的长期主体、治理和持久化层。
- Codex 原生能力更接近一次任务里的短生命周期执行主体；Themis 额外补了组织、长期身份、工作队列、治理面、长期记忆和运行边界。
- 仓库里有两个相关名词：
  - `actor`：更轻的内部协作与记忆模型，用于任务 scope、timeline / takeover 和长期记忆候选，不等于完整长期数字员工。
  - `managed_agent`：真正长期存在、可派工、可暂停 / 恢复 / 归档、可治理的数字员工主体。
- 详细设计见 [持久化 agent 架构](./docs/product/themis-persistent-agent-architecture.md)。

## 快速开始

以下步骤默认面向当前仓库的本地开发或单机体验；如果你要做平台层 / Worker Node 联调，直接看下方的部署与联调文档。

1. 安装依赖：

```bash
npm install
```

2. 初始化本地配置：

```bash
./themis
```

或：

```bash
npm run themis -- init
```

3. 启动服务：

```bash
npm run dev:web
```

如果你同时在本仓里本地验证平台层 surface，可额外启动：

```bash
npm run dev:platform
```

4. 在浏览器打开：

```text
http://localhost:3100
```

## 部署与联调文档

- [首轮局域网联调清单](./docs/repository/themis-first-lan-joint-test-checklist.md)
- [单机三角色部署方案](./docs/repository/themis-single-host-three-role-deployment.md)
- [Worker Node 常驻部署说明](./docs/repository/themis-worker-node-systemd-service.md)
- [平台层切 MySQL 操作说明](./docs/repository/themis-platform-mysql-control-plane-cutover.md)

## 常用命令

```bash
./themis status
./themis doctor
./themis doctor release
./themis update check
./themis update apply
./themis update rollback
./themis-platform auth platform list
./themis-platform doctor worker-fleet --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken>
./themis-platform worker-fleet <drain|offline|reclaim> --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken> --node <nodeId> [--node <nodeId> ...] --yes
./themis-worker-node doctor worker-node --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken> --workspace <path>
./themis-worker-node worker-node run --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken> --name <displayName> [--once]
./themis mcp-server
npm run dev:platform
npm run start:platform
```

说明：

- `./themis` 里的 `auth platform`、`doctor worker-node`、`doctor worker-fleet`、`worker-node`、`worker-fleet` 当前仍保留兼容别名，但日常使用已推荐切到独立入口；后续会继续收口兼容层。
- 平台侧值班 / 平台令牌 / `worker-fleet`：`./themis-platform`
- Worker Node 本机预检 / 常驻执行：`./themis-worker-node`
- `themis-platform` 与 `themis-worker-node` 当前都通过 `file:../themis-contracts` 依赖共享契约；真实部署时要把 `themis-contracts` 放到同级目录，再执行 `npm ci`。
- `THEMIS_PLATFORM_WEB_ACCESS_TOKEN` 只负责 `agents / projects / work-items / runs` 这组业务 gateway；`nodes/*`、`worker-fleet` 和 `worker-node run` 统一使用 `worker` 角色的平台服务令牌。
- Worker Node、平台值班和三机联调的完整命令顺序，直接看 [首轮局域网联调清单](./docs/repository/themis-first-lan-joint-test-checklist.md)、[Worker Node 常驻部署说明](./docs/repository/themis-worker-node-systemd-service.md) 和 [Worker Node 运维手册](./docs/repository/themis-worker-node-operations-runbook.md)。

如果你希望像 `codex` 一样直接输入 `themis`，可以在仓库根目录执行一次：

```bash
./themis install
```

之后就可以直接运行：

```bash
themis
themis status
themis update
themis mcp-server
```

## 飞书配置

如果需要飞书渠道，请配置：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

也可以改用 CLI 写入 `.env.local`：

```bash
npm run themis -- config set FEISHU_APP_ID cli_xxx
npm run themis -- config set FEISHU_APP_SECRET xxx
```

## 常用环境变量

- 主服务：`THEMIS_HOST`、`THEMIS_PORT`、`THEMIS_TASK_TIMEOUT_MS`
  - `THEMIS_TASK_TIMEOUT_MS` 表示单个任务的进度间静默超时，单位毫秒；持续有新进度时会自动续期，默认 `300000`
- Codex 认证：`CODEX_HOME`、`CODEX_API_KEY`
- 平台 gateway：`THEMIS_PLATFORM_BASE_URL`、`THEMIS_PLATFORM_OWNER_PRINCIPAL_ID`、`THEMIS_PLATFORM_WEB_ACCESS_TOKEN`
- 飞书：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_PROGRESS_FLUSH_TIMEOUT_MS`
- OpenAI-compatible provider：`THEMIS_OPENAI_COMPAT_BASE_URL`、`THEMIS_OPENAI_COMPAT_API_KEY`、`THEMIS_OPENAI_COMPAT_MODEL`
- 升级与版本：`THEMIS_BUILD_COMMIT`、`THEMIS_BUILD_BRANCH`、`THEMIS_UPDATE_REPO`、`THEMIS_UPDATE_CHANNEL`、`THEMIS_UPDATE_DEFAULT_BRANCH`、`THEMIS_UPDATE_SYSTEMD_SERVICE`、`THEMIS_GITHUB_TOKEN`
- 平台层 MySQL、runtime snapshot、execution runtime 这类部署级变量，直接看 [平台层切 MySQL 操作说明](./docs/repository/themis-platform-mysql-control-plane-cutover.md) 与 [首轮局域网联调清单](./docs/repository/themis-first-lan-joint-test-checklist.md)

## 文档导航

- [飞书接入总览](./docs/feishu/README.md)
- [飞书通道说明](./docs/feishu/themis-feishu-channel.md)
- [持久化 agent 架构](./docs/product/themis-persistent-agent-architecture.md)
- [公开发布边界与导出规则](./docs/repository/github-safe-publish.md)
- [正式版部署说明](./docs/repository/themis-systemd-prod-service.md)
- [开发模式 systemd 说明](./docs/repository/themis-systemd-dev-service.md)
- [平台层切 MySQL 操作说明](./docs/repository/themis-platform-mysql-control-plane-cutover.md)
- [单机三角色部署方案](./docs/repository/themis-single-host-three-role-deployment.md)
- [首轮局域网联调清单](./docs/repository/themis-first-lan-joint-test-checklist.md)
- [Worker Node 常驻部署说明](./docs/repository/themis-worker-node-systemd-service.md)
- [Worker Node 运维手册](./docs/repository/themis-worker-node-operations-runbook.md)
- [平台层监控、备份与恢复手册](./docs/repository/themis-platform-monitoring-and-backup-runbook.md)

## 许可证

本项目采用 [Apache-2.0](./LICENSE) 许可证。

## 发布与更新

当前公开发布采用“双仓”方式：开发仓负责日常开发与本地资料，公开仓负责 GitHub 可公开内容。

导出公开仓：

```bash
npm run publish:public -- ../themis-public
```

然后在公开仓执行：

```bash
git status
git add -A
git commit -m "..."
git push origin main
```

正式实例常用命令：

```bash
./themis status
./themis update check
./themis update apply
./themis update rollback
```

- `THEMIS_UPDATE_CHANNEL` 支持 `branch` 和 `release`；默认仍是 `branch`。
- 受控升级当前只支持公开仓 `git clone` 的正式实例、默认分支 `ff-only` 快进升级，以及干净工作区。
- Web 已支持“运行参数 -> 实例升级”，飞书也已支持 `/update`、`/update apply confirm`、`/update rollback confirm`。
- 详细边界、灰度与回滚流程，直接看 [发布、灰度与回退说明](./docs/repository/themis-release-rollout-and-rollback.md) 和 [正式版部署说明](./docs/repository/themis-systemd-prod-service.md)。
