# Themis

Themis 是一个围绕 `codex app-server` 构建的自托管协作壳。

它把 Codex 的能力收敛成更适合长期使用的 Web 和飞书入口，并补上本地持久化、诊断、自动化接口和定时任务这些“正式使用”需要的外围能力。

## 它能做什么

- 提供本地 / 局域网 Web 聊天工作台，支持认证、多账号、历史、分叉、运行参数和长期画像。
- 提供飞书机器人入口，并和 Web 共享运行时、通信层与 SQLite 持久化。
- 提供 Themis 自己的持久化数字员工能力，支持创建、派工、治理和长期运行历史。
- 提供 `status / doctor / doctor smoke / doctor release` 这套运维诊断入口。
- 提供 `POST /api/tasks/automation/run` 这类自动化接口。
- 提供单次定时任务能力，并通过 `themis mcp-server` 暴露 `create_scheduled_task / list_scheduled_tasks / cancel_scheduled_task` 给 Codex 调用。

## 数字员工边界

- Themis 当前支持的“数字员工 / 持久化 agent”能力不是 Codex 原生产品能力，而是 Themis 在 `codex app-server` 之上补出来的长期主体、治理和持久化层。
- Codex 原生能力更接近一次任务里的短生命周期执行主体；Themis 额外补了组织、长期身份、工作队列、治理面、长期记忆和运行边界。
- 仓库里有两个相关名词：
  - `actor`：更轻的内部协作与记忆模型，用于任务 scope、timeline / takeover 和长期记忆候选，不等于完整长期数字员工。
  - `managed_agent`：真正长期存在、可派工、可暂停 / 恢复 / 归档、可治理的数字员工主体。
- 详细设计见 [持久化 agent 架构](./docs/product/themis-persistent-agent-architecture.md)。

## 当前定位

- 当前主要面向自托管、同机或局域网部署场景。
- 当前主执行链路是 `codex app-server`；`@openai/codex-sdk` 只保留历史兼容路径。
- 公开 GitHub 仓是正式版本源；`themis status` 现在会直接检查 GitHub 最新提交并给出升级建议。
- 当前不是通用云服务，也不是以 npm 包发布为目标的项目。

## 快速开始

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

如果要单独启动平台层进程，改用：

```bash
npm run dev:platform
```

平台进程当前保留独立的 `Themis Platform` 前端壳、Web 鉴权、`/api/health` 和 `/api/platform/*` 控制面接口，不再复用主 `Themis Workspace` 的 Web 静态壳，也不会继续暴露主 Themis 的任务、历史、身份等 HTTP API。当前平台页已接入 Worker Nodes、governance overview、waiting queue、collaboration/handoffs、recent runs，以及 `work-items + mailbox` 的最小读写闭环；后续继续把 `agents/projects` 真实控制面与更完整值班面板收口到这里。

主 Themis 里的 `Platform Agents` 当前也已收口成纯兼容 gateway：`/api/agents/list` 只负责暴露平台兼容状态与跳转上下文；如果没有有效的 `THEMIS_PLATFORM_*` 配置，其余 `/api/agents/*` 不再回退本地平台治理，而会明确提示去配置平台 gateway 或直接使用独立 `themis-platform` 页面。与此同时，主 Themis Web 里的 `Platform Agents` 页面也已进一步降成“纯跳转入口”：现在只保留入口状态刷新与独立平台页直达链接，不再承载任何组织级治理、派工、mailbox、handoff 或 execution boundary 表单。

4. 在浏览器打开：

```text
http://localhost:3100
```

## 常用命令

```bash
./themis status
./themis update
./themis update check
./themis update apply
./themis update rollback
./themis doctor
./themis doctor worker-node
./themis doctor worker-fleet
./themis doctor smoke web
./themis doctor smoke feishu
./themis doctor smoke all
./themis doctor release
./themis-platform auth platform list
./themis-platform doctor worker-fleet --platform <baseUrl> --owner-principal <principalId> --token <webAccessToken>
./themis-platform worker-fleet <drain|offline|reclaim> --platform <baseUrl> --owner-principal <principalId> --token <webAccessToken> --node <nodeId> [--node <nodeId> ...] --yes
./themis-worker-node doctor worker-node --platform <baseUrl> --owner-principal <principalId> --token <webAccessToken> --workspace <path>
./themis-worker-node worker-node run --platform <baseUrl> --owner-principal <principalId> --token <webAccessToken> --name <displayName> [--once]
./themis mcp-server
npm run dev:platform
npm run start:platform
```

说明：

- `./themis` 里的 `auth platform`、`doctor worker-node`、`doctor worker-fleet`、`worker-node`、`worker-fleet` 当前仍保留兼容别名，但已经明确进入迁移期。
- 新的推荐入口是：
  - 平台侧值班 / 平台令牌 / `worker-fleet`：`./themis-platform`
  - Worker Node 本机预检 / 常驻执行：`./themis-worker-node`

如果你要把某台机器接成局域网执行节点，推荐先按这个顺序验证：

```bash
./themis doctor worker-node \
  --platform <baseUrl> \
  --owner-principal <principalId> \
  --token <webAccessToken> \
  --workspace <absolutePath> \
  --credential <id>

./themis worker-node run \
  --platform <baseUrl> \
  --owner-principal <principalId> \
  --token <webAccessToken> \
  --name <displayName> \
  --workspace <absolutePath> \
  --credential <id> \
  --once
```

长期常驻、`systemd --user` 模板和常见坑，见下文的 Worker Node 部署说明；日常巡检、排障和多节点值守顺序，见 Worker Node 运维手册。

如果你已经有多台节点在线，想先从平台侧看一眼整体现状，可以直接运行：

```bash
./themis doctor worker-fleet \
  --platform <baseUrl> \
  --owner-principal <principalId> \
  --token <webAccessToken>
```

这条命令会批量读取 `nodes/list + nodes/detail`，汇总每台节点的 `status / heartbeat / active lease`，并直接给出值班建议动作。

如果已经确认要对节点做平台侧治理，可以直接运行：

```bash
./themis worker-fleet drain \
  --platform <baseUrl> \
  --owner-principal <principalId> \
  --token <webAccessToken> \
  --node <nodeId> \
  --yes
```

同一组参数下也支持 `offline` 和 `reclaim`；`reclaim` 还可以额外传 `--failure-code` 与 `--failure-message`。当前 CLI 会逐节点输出成功/失败摘要，不需要再手工登录平台取 cookie 后拼 `curl`。

如果这是台 fresh 节点，但对应默认 `CODEX_HOME` 或托管 credential 目录里已经有真实 `auth.json`，`./themis doctor worker-node` 现在会直接把该 credential 判成可用，不需要先跑一次 daemon 才过预检。

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

- `THEMIS_HOST`
- `THEMIS_PORT`
- `THEMIS_TASK_TIMEOUT_MS`
- `THEMIS_PLATFORM_BASE_URL`
- `THEMIS_PLATFORM_OWNER_PRINCIPAL_ID`
- `THEMIS_PLATFORM_WEB_ACCESS_TOKEN`
- `THEMIS_PLATFORM_CONTROL_PLANE_DRIVER`
- `THEMIS_PLATFORM_MYSQL_URI`
- `THEMIS_PLATFORM_MYSQL_HOST`
- `THEMIS_PLATFORM_MYSQL_PORT`
- `THEMIS_PLATFORM_MYSQL_USER`
- `THEMIS_PLATFORM_MYSQL_PASSWORD`
- `THEMIS_PLATFORM_MYSQL_DATABASE`
- `THEMIS_PLATFORM_MYSQL_CONNECTION_LIMIT`
- `THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE`
- `CODEX_HOME`
- `CODEX_API_KEY`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_PROGRESS_FLUSH_TIMEOUT_MS`
- `THEMIS_OPENAI_COMPAT_BASE_URL`
- `THEMIS_OPENAI_COMPAT_API_KEY`
- `THEMIS_OPENAI_COMPAT_MODEL`
- `THEMIS_BUILD_COMMIT`
- `THEMIS_BUILD_BRANCH`
- `THEMIS_UPDATE_REPO`
- `THEMIS_UPDATE_CHANNEL`
- `THEMIS_UPDATE_DEFAULT_BRANCH`
- `THEMIS_UPDATE_SYSTEMD_SERVICE`
- `THEMIS_GITHUB_TOKEN`

如果要先把平台层独立成单独进程，但暂时还没把 shared control plane 切到 MySQL，可以额外配置：

```bash
THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE=infra/platform/control-plane.db
```

这会把 `managed_agent / work_item / run / node / execution_lease` 这类共享控制面事实切到独立 SQLite 文件；本地 `session task settings` 等执行态仍留在当前 runtime store，不会跟平台真相源混在一起。

如果要把平台层切到 MySQL 真相源，推荐单独起平台进程，并配置：

```bash
THEMIS_PLATFORM_CONTROL_PLANE_DRIVER=mysql
THEMIS_PLATFORM_MYSQL_DATABASE=themis_platform
THEMIS_PLATFORM_MYSQL_URI=mysql://user:password@127.0.0.1:3306/themis_platform
THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE=infra/platform/control-plane.db
```

然后启动：

```bash
npm run dev:platform
```

这时平台进程会把 managed-agent shared control plane 先落到本地 `SQLite cache`，启动时从 MySQL 拉快照，平台写操作和 scheduler tick 再持续回刷 MySQL；本地 `session task settings`、线程/history、认证运行态仍留在当前 runtime store，不会被搬进 MySQL。

## 公开文档

- [飞书接入总览](./docs/feishu/README.md)
- [飞书通道说明](./docs/feishu/themis-feishu-channel.md)
- [持久化 agent 架构](./docs/product/themis-persistent-agent-architecture.md)
- [公开发布边界与导出规则](./docs/repository/github-safe-publish.md)
- [平台层切 MySQL 操作说明](./docs/repository/themis-platform-mysql-control-plane-cutover.md)
- [单机三角色部署方案](./docs/repository/themis-single-host-three-role-deployment.md)
- [systemd 正式常驻示例](./docs/repository/themis-systemd-prod-service.md)
- [systemd 开发常驻示例](./docs/repository/themis-systemd-dev-service.md)
- [Worker Node 常驻部署说明](./docs/repository/themis-worker-node-systemd-service.md)

## 许可证

本项目采用 [Apache-2.0](./LICENSE) 许可证。

## 发布与更新

当前公开发布采用“双仓”方式：

- 开发仓负责日常开发与本地资料。
- 公开仓负责对 GitHub 发布可公开内容。

导出命令：

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

如果你只是在正式实例上检查是否需要升级，直接运行：

```bash
./themis status
```

它会显示当前提交、GitHub 最新提交、比较结果和升级建议。

如果当前实例就是公开仓 `git clone` 的正式目录，也可以直接执行受控升级：

```bash
./themis update apply
```

如果你的正式目录还不是 `git clone`，先按 `docs/repository/themis-systemd-prod-service.md` 里的迁移步骤切到公开仓 clone，再使用这条受控升级链。

如果你已经登录了 Web，也可以在“运行参数 -> 实例升级”里直接触发后台升级或回滚；Themis 会把进度写到 `infra/local/themis-update-operation.json`，版本切换完成后再请求重启当前 `systemd --user` 服务。飞书侧也已支持 `/update`、`/update apply confirm`、`/update rollback confirm` 作为运维入口，其中高风险动作默认要求显式 `confirm`。

当前受控升级已经支持两条更新轨道：

- `THEMIS_UPDATE_CHANNEL=branch`
  含义：跟随更新源默认分支的最新提交。
- `THEMIS_UPDATE_CHANNEL=release`
  含义：跟随 GitHub `latest release` 对应的提交，适合更稳的正式发布节奏。

默认仍是 `branch`。如果你要让正式实例只跟正式 release，直接在 `.env.local` 写：

```bash
THEMIS_UPDATE_CHANNEL=release
```

前提是公开 GitHub 仓已经至少发布过一条 published full release；如果还没有，`./themis update check` 会明确提示 “当前更新源还没有正式 release”。

当前版本的受控升级有这些边界：

- 只支持公开仓 `git clone` 的正式实例。
- 只支持默认分支上的 `ff-only` 快进升级。
- 工作区必须干净；有本地改动会直接拒绝继续。
- `release` 渠道当前只跟随 GitHub 最新正式 release，不含 prerelease / draft，也还不支持固定某个 tag。
- 默认会在成功后尝试重启 `systemd --user` 下的 `themis-prod.service`；如服务名不同，可通过 `THEMIS_UPDATE_SYSTEMD_SERVICE` 或 `./themis update apply --service <name>` 指定。
- 升级成功后会自动执行 `npm ci`、`npm run build`，并把 `.env.local` 里的 `THEMIS_BUILD_COMMIT / THEMIS_BUILD_BRANCH` 回写到新提交。

当前还支持一条“只回退最近一次成功升级”的受控回滚：

```bash
./themis update rollback
```

回滚的第一版边界：

- 只会回退最近一次成功升级记录，不支持多级历史选择。
- 只有当当前 `git HEAD` 仍然等于那次升级后的提交时，才允许继续回滚。
- 回滚成功后会清掉这条“最近一次升级记录”；如果还想再次回退，需要先执行新的受控升级或手工处理。

## 开发模式补充

`dev:web` 会监听后端 TypeScript 变更并自动重启；前端静态资源修改后仍需要手动刷新浏览器页面。

如果你希望把开发模式常驻到 `systemd --user` 并保留后端热更新，可参考：

- [systemd service 示例](./infra/systemd/themis-dev.service.example)
- [systemd 使用说明](./docs/repository/themis-systemd-dev-service.md)

如果你要部署长期使用的正式实例，可参考：

- [正式版 systemd service 示例](./infra/systemd/themis-prod.service.example)
- [正式版部署说明](./docs/repository/themis-systemd-prod-service.md)

如果你要把平台层单独部署成独立控制面，可参考：

- [平台层 systemd service 示例](./infra/systemd/themis-platform.service.example)
- [平台层 systemd 使用说明](./docs/repository/themis-platform-systemd-service.md)
- [平台层切 MySQL 操作说明](./docs/repository/themis-platform-mysql-control-plane-cutover.md)
- [三层拆仓 Phase 5：新仓初始化与切换演练](./docs/repository/themis-three-layer-phase-5-bootstrap-and-cutover.md)

如果你要把另一台机器部署成 `Worker Node daemon`，可参考：

- [Worker Node systemd service 示例](./infra/systemd/themis-worker-node.service.example)
- [Worker Node 常驻部署说明](./docs/repository/themis-worker-node-systemd-service.md)

如果你是小公司或个人部署，准备把“平台层 + 主 Themis + Worker Node”放在同一台机器上，可直接参考：

- [单机三角色部署方案](./docs/repository/themis-single-host-three-role-deployment.md)

如果你要做第一轮真实环境联调，可直接照着：

- [首轮局域网联调清单](./docs/repository/themis-first-lan-joint-test-checklist.md)

如果你准备按“平台层 / 主 Themis / Worker Node”三层拆仓推进后续开发，可直接参考：

- [三层拆仓开发约定](./docs/repository/themis-three-layer-parallel-development-contract.md)
- [三层拆仓迁移清单](./docs/repository/themis-three-layer-split-migration-checklist.md)
