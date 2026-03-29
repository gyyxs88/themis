# Themis

Themis 是一个以 `codex app-server` 为主执行链路、面向内部协作的 Codex 壳项目。

当前目标不是再包一层通用平台，而是把 Codex 的能力收敛成更适合内部员工使用的 Web / 飞书入口，并把项目现状、决策、任务和长期可复用结论持续留在仓库里。

## 当前状态

- 员工主入口已经是 LAN Web 聊天工作台，飞书已接入并与 Web 共享通信层、运行时和本地持久化。
- 默认任务执行链路已经切到 `codex app-server`；`@openai/codex-sdk` 仅保留显式兼容路径。
- Web 已具备认证、多账号、历史、分叉、运行参数、第三方兼容接入和长期画像等核心壳层能力。
- 项目级 CLI 提供 `init / status / doctor / config / auth / skill` 等运维入口，diagnostics 与 HTTP 共用数据源。
- 运行时上下文构建器与 Markdown memory service 已接入任务主链路。
- Web 主链路自动化测试、`router` 与 `Web stream` 回归已补齐。

## 当前总览入口

- 项目当前总览与 Codex 能力对齐主表：[`memory/project/codex-alignment.md`](./memory/project/codex-alignment.md)
- 任务明细台账：[`memory/tasks/backlog.md`](./memory/tasks/backlog.md)、[`memory/tasks/in-progress.md`](./memory/tasks/in-progress.md)、[`memory/tasks/done.md`](./memory/tasks/done.md)
- 当前实现边界：[`memory/architecture/overview.md`](./memory/architecture/overview.md)

`README.md` 继续承担项目简介、运行方式和仓库导航；详细的能力对齐状态、风险和下一步优先级统一以 `memory/project/codex-alignment.md` 为准。

## 目录说明

- `src/`：后端运行时、HTTP 服务、通信层、渠道适配器。
- `apps/web/`：员工向 Web 聊天工作台。
- `docs/`：设计文档、专题说明、渠道说明和长期记忆。
- `docs/memory/YYYY/MM/`：已验证、可长期复用的专题记忆。
- `memory/`：共享项目工作台，存放项目概览、架构现状、任务状态、决策记录和当前会话。
- `infra/`：本地数据库、生成配置和环境相关文件。
- `src/**/*.test.ts`：当前基础自动化测试，已覆盖 Web modules、CLI、Feishu、server、core、context、memory、diagnostics 与 mcp；`session store`、`fork transcript`、`history API`、`router`、`Web stream` 与 Web 主链路第一波混合式跨模块回归这几轮都已补齐。
- `temp/`：临时脚本和一次性辅助文件。

## 文档与记忆分层

当前仓库同时保留 `memory/` 和 `docs/memory/`，但职责已经统一为两层：

- `README.md`：仓库入口和稳定摘要，不承担详细状态主表职责。
- `memory/project/codex-alignment.md`：项目当前状态、Codex 能力对齐、风险与下一步优先级的事实主表。
- `memory/project/`：项目目标、阶段、干系人等共享背景。
- `memory/architecture/`：当前实现形态、运行路径和边界。
- `memory/tasks/`：`backlog / in-progress / done` 工作台。
- `memory/decisions/`：项目级长期决策记录。
- `memory/sessions/`：当前会话上下文目录；仓库默认只提交说明文件，实际 `active.md` 为本地会话文件，按需创建且不纳入版本控制。
- `docs/memory/YYYY/MM/`：经过验证、后续大概率还会反复使用的结论、坑点、接口特性和操作前提。
- `docs/product/`：产品和架构规划文档，表达设计意图，不直接等同当前实现。
- `docs/feishu/`：飞书渠道的当前接入说明。

如果不同文档之间出现冲突，当前建议按下面的优先级判断：

1. 代码实现。
2. 动态状态主表：`memory/project/codex-alignment.md`。
3. 当前实现文档：`README.md`、`memory/architecture/`、`docs/feishu/`、`docs/memory/`。
4. 规划文档：`docs/product/`。

## 本地运行

1. 安装依赖：

```bash
npm install
```

2. 初始化本地配置入口：

```bash
./themis
```

或显式执行子命令：

```bash
npm run themis -- init
```

常用 CLI：

```bash
./themis status
./themis config list
./themis config set FEISHU_APP_ID cli_xxx
```

常用 skills CLI：

```bash
./themis skill list
./themis skill curated list
./themis skill install local /srv/skills/demo-skill
./themis skill install url https://github.com/openai/codex/tree/main/skills/example
./themis skill install repo openai/codex skills/example main
./themis skill install curated python-setup
./themis skill sync demo-skill --force
```

如果希望像 `codex` 一样直接输入 `themis`，推荐在仓库根目录执行一次：

```bash
./themis install
```

之后就可以直接运行：

```bash
themis
themis status
```

保留的 npm 方式：

```bash
npm run themis -- status
npm run themis -- config list
npm run themis -- config set FEISHU_APP_ID cli_xxx
npm run themis -- skill list
npm run themis -- skill install curated python-setup
```

`init` 会优先从仓库根目录的 `.env.example` 生成 `.env.local`。服务启动时会自动加载 `.env` / `.env.local`；真实 shell 环境变量优先级更高。

3. 确保本机已有可用的 Codex 认证。

常见方式：

- 本机已有 Codex / ChatGPT 登录态。
- 或者在 shell / `.env.local` 里提供 `CODEX_API_KEY`。
- 多账号模式下，默认账号会沿用当前 `CODEX_HOME` 或 `~/.codex`；当 Themis 在 ChatGPT 登录态下检测到一个新账号时，会自动创建对应槽位并把认证文件保存到 `infra/local/codex-auth/<accountId>/`，同时默认强制 `cli_auth_credentials_store = "file"`。如果你先在 VS Code Codex、桌面版 Codex 或 CLI 里切了 ChatGPT 账号，再回到 Themis，Themis 会在下次读取认证状态或发送任务时自动识别并同步。纯 API Key 登录不在这套自动建槽/换号范围里。

4. 如果需要飞书渠道，再额外配置：

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

也可以改用 CLI 写入 `.env.local`：

```bash
npm run themis -- config set FEISHU_APP_ID cli_xxx
npm run themis -- config set FEISHU_APP_SECRET xxx
```

5. 启动服务：

```bash
npm run dev:web
```

`dev:web` 目前会监听后端 TypeScript 变更并自动重启；前端静态资源修改后仍需要手动刷新浏览器页面。

如果你希望把开发模式常驻到 `systemd --user` 并保留后端热更新，可参考：

- [`infra/systemd/themis-dev.service.example`](./infra/systemd/themis-dev.service.example)
- [`docs/repository/themis-systemd-dev-service.md`](./docs/repository/themis-systemd-dev-service.md)

6. 在浏览器打开：

```text
http://localhost:3100
```

常用环境变量：

- `THEMIS_HOST`
- `THEMIS_PORT`
- `THEMIS_TASK_TIMEOUT_MS`
- `CODEX_HOME`
- `CODEX_API_KEY`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_PROGRESS_FLUSH_TIMEOUT_MS`
- `THEMIS_OPENAI_COMPAT_BASE_URL`
- `THEMIS_OPENAI_COMPAT_API_KEY`
- `THEMIS_OPENAI_COMPAT_MODEL`

## 建议阅读顺序

- [`memory/project/codex-alignment.md`](./memory/project/codex-alignment.md)
- [`memory/project/overview.md`](./memory/project/overview.md)
- [`memory/architecture/overview.md`](./memory/architecture/overview.md)
- [`docs/feishu/themis-feishu-channel.md`](./docs/feishu/themis-feishu-channel.md)
- [`docs/memory/2026/03/repository-doc-system-and-memory-boundaries.md`](./docs/memory/2026/03/repository-doc-system-and-memory-boundaries.md)
- [`memory/tasks/backlog.md`](./memory/tasks/backlog.md)
