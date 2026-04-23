# Themis

[English](./README.en.md)

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
- `2026-04-23` 起，主 Themis Web 设置面板里的“运营中枢”已经不只是方向页；当前已补上 `Asset / Decision / Risk / Cadence / Commitment` 五类最小对象首版，并新增 `OperationEdge` 关系边、对象图查询入口与 `BossView` 只读老板视图：SQLite 新增 `themis_principal_assets / themis_principal_decisions / themis_principal_risks / themis_principal_cadences / themis_principal_commitments / themis_principal_operation_edges`，HTTP 已补 `/api/operations/assets/*`、`/api/operations/decisions/*`、`/api/operations/risks/*`、`/api/operations/cadences/*`、`/api/operations/commitments/*`、`/api/operations/edges/*`、`/api/operations/graph/query` 与 `/api/operations/boss-view`，`Decision / Risk / Cadence / Commitment` 保存时会自动同步基础关系边，`Commitment` 已能维护 `progressPercent / milestones / evidenceRefs` 并从 `work_item` 证据生成 `evidence_for` 反链，Web 已能维护最小资产台账、节奏记录、承诺目标、决策记录、风险记录和对象关系边，展示对象详情反链、一跳 / 二跳影响范围，以及只读对象关系子图和可选最短路径，并基于这些事实生成老板视图和运营中枢快照。
- 本仓后续重点是主 Themis 自己的产品能力，以及通过共享契约消费平台事实的最小客户端能力。

## 当前定位

- 当前主要面向自托管、同机或局域网部署场景。
- 当前主执行链路是 `codex app-server`；仓库已不再依赖 `@openai/codex-sdk`。
- 当前全局默认运行模型是 `gpt-5.4`，默认思维强度是 `xhigh`；如需偏离，改会话设置、运行边界或底层 `config.toml` 即可。
- 公开 GitHub 仓是正式版本源；`themis status` 会检查 GitHub 最新提交并给出升级建议。
- 当前不是通用云服务，也不是以 npm 包发布为目标的项目。
- 主 Themis 当前更接近“数字公司控制面 / 运营中枢”的第一版，而不是完整的“数字公司操作系统”；当前已接通的重点仍是执行、协作、治理和知识沉淀。

## 本仓负责什么

- 提供本地 / 局域网 Web 聊天工作台，支持认证、多账号、历史、分叉、运行参数和长期画像。
- 提供飞书机器人入口，并和 Web 共享运行时、通信层与 SQLite 持久化。
- 提供主 Themis 自己的会话、历史、身份、配置、任务入口与自动化接口。
- 提供 `status / doctor / doctor smoke / doctor release` 这套运维诊断入口。
- 提供 `POST /api/tasks/automation/run` 这类自动化接口。
- 提供单次定时任务、员工治理与运营中枢机器协议，并通过 `themis mcp-server` 暴露 `create_scheduled_task / list_scheduled_tasks / cancel_scheduled_task`、`list_managed_agents / get_managed_agent_detail / create_managed_agent / update_managed_agent_card / update_managed_agent_execution_boundary / dispatch_work_item / update_managed_agent_lifecycle`，以及 `list_operation_objects / create_operation_object / update_operation_object / list_operation_edges / create_operation_edge / update_operation_edge / query_operation_graph / get_operations_boss_view` 给 Codex 调用。
- 提供平台会议室 gateway 与 Web 主持台，支持 `status / list / create / detail / participants/add / resolutions/create / resolutions/promote / close / message/stream` 这组内部会议能力，让 Themis 能以管理者身份拉多个数字员工进入同一个会议室讨论，并按轮次排队、定向发言、带上下文入场和会议收口；平台页的会议室观察台会直接读取平台真相源，并提供只读观察与终止会议能力。
- 提供 `运营中枢` 的最小资产台账、节奏记录、承诺目标、决策记录、风险记录、对象关系边、对象图查询与只读老板视图。该系统定位为 Themis 与数字员工自用的机器原生运营账本，不是给人类填表的任务管理 UI；人类主要通过 Web / BossView 观察、审计，并在必要时通过员工生命周期和执行边界做紧急刹车。当前支持 `Asset / Cadence / Commitment / Decision / Risk / OperationEdge` 的 `list / create / update`，自动从对象字段同步基础关系边；`Commitment` 还支持进度、里程碑和证据引用，并可从 `work_item` 证据补出 `evidence_for` 关系；Web 会基于已加载 active 关系边为对象卡片展开一跳 / 二跳影响范围，`/api/operations/graph/query` 可按根对象查询小深度关系子图和可选最短路径；通过 `/api/operations/boss-view` 把这些事实聚合成红黄绿状态、关键指标、今日焦点、关键关系和近期拍板，其中已解决风险 / 已完成承诺不会继续制造当前阻塞红灯。

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

- 本地工作区当前部署速查：`docs/local/current-deployment.md`（本地专用，不纳入版本控制）
- 本地工作区部署文档索引：`docs/local/README.md`（本地专用，不纳入版本控制）
- [仓库运维文档索引](./docs/repository/README.md)
- [正式版部署说明](./docs/repository/themis-systemd-prod-service.md)
- [平台层 systemd 服务说明](./docs/repository/themis-platform-systemd-service.md)
- [Worker Node 常驻部署说明](./docs/repository/themis-worker-node-systemd-service.md)
- [发布验收矩阵](./docs/repository/themis-release-acceptance-matrix.md)
- [发布、灰度与回退说明](./docs/repository/themis-release-rollout-and-rollback.md)

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
- `THEMIS_PLATFORM_WEB_ACCESS_TOKEN` 当前负责主 Themis 的管理者 gateway：除了 `agents / projects / work-items / runs`，还可访问节点观察/治理接口 `nodes/list|detail|drain|offline|reclaim`；节点运行态 `nodes/register|heartbeat`、`/api/platform/worker/*` 和 `worker-node run` 仍统一使用 `worker` 角色的平台服务令牌。
- Worker Node、平台值班和多机场景的完整入口，先看 [仓库运维文档索引](./docs/repository/README.md)；如果要回看首轮三机联调记录，再看 `docs/repository/archive/themis-first-lan-joint-test-checklist.md`。

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
- 平台层 MySQL、runtime snapshot、execution runtime 这类部署级变量，直接看 [平台层切 MySQL 操作说明](./docs/repository/themis-platform-mysql-control-plane-cutover.md)；跨机场景和历史联调细节见 [仓库运维文档索引](./docs/repository/README.md)

## 文档导航

- [文档总索引](./docs/README.md)
- 本地部署文档目录：`docs/local/`（本地专用，不纳入版本控制）
- [仓库运维文档索引](./docs/repository/README.md)
- [飞书接入总览](./docs/feishu/README.md)
- [飞书通道说明](./docs/feishu/themis-feishu-channel.md)
- [产品规划文档索引](./docs/product/README.md)
- [持久化 agent 架构](./docs/product/themis-persistent-agent-architecture.md)
- 长期专题记忆见 `docs/memory/YYYY/MM/`

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
