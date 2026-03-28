# Themis

Themis 是一个构建在 Codex SDK 之上的内部协作壳项目。

当前目标不是再包一层通用平台，而是把 Codex 的能力收敛成更适合内部员工使用的 Web / 飞书入口，并把项目现状、决策、任务和长期可复用结论持续留在仓库里。

## 当前状态

- 员工主入口已经是 LAN Web 聊天工作台。
- 飞书长连接渠道已经接入，可与 Web 共享同一套通信层、运行时和本地持久化。
- 后端围绕 `@openai/codex-sdk` 做会话复用、流式输出、分叉上下文和历史恢复。
- 本地 SQLite `infra/local/themis.db` 负责持久化 conversation、turn、event、touched files、identity 和第三方兼容 provider 配置。
- Web 端已支持 Codex 认证、设备码登录、多账号自动建槽与管理、会话级手动切号、历史加载、会话分叉、第三方兼容接入、首次对话长期画像建档、principal 级长期人格配置和运行参数设置。
- LAN Web 页面和受保护 API 现在要求 owner 访问口令登录；登录后由服务端 session 配合 `HttpOnly` cookie 维持 30 天，会话失效后需要重新登录。
- 删除命名访问口令后，关联的 Web 会话会在下一次请求时立即失效。
- 关键动作安全审计已落地。
- 项目级 CLI 已提供可直接执行的 `themis` 入口；无参数进入交互模式，也支持 `init / status / doctor / config / auth / skill` 子命令。
- 统一 diagnostics 视图已落地：CLI `themis doctor` 和 HTTP `GET /api/diagnostics` / `GET /api/diagnostics/mcp` / `POST /api/diagnostics/mcp/probe` / `POST /api/diagnostics/mcp/reload` 共享同一套运行时诊断数据源。
- 运行时上下文构建器与 Markdown memory service 已接入任务主链路，任务开始/收口阶段会更新 `memory/sessions/active.md` 与 `memory/tasks/*`。
- `session store`、`fork transcript` 与 `history API` 的自动化测试已经补齐，后续重点缺口收敛到 `router` 与 `Web stream` 主链路。

## 目录说明

- `src/`：后端运行时、HTTP 服务、通信层、渠道适配器。
- `apps/web/`：员工向 Web 聊天工作台。
- `docs/`：设计文档、专题说明、渠道说明和长期记忆。
- `docs/memory/YYYY/MM/`：已验证、可长期复用的专题记忆。
- `memory/`：共享项目工作台，存放项目概览、架构现状、任务状态、决策记录和当前会话。
- `infra/`：本地数据库、生成配置和环境相关文件。
- `src/**/*.test.ts`：当前基础自动化测试，已覆盖 Web modules、CLI、Feishu、server、core、context、memory、diagnostics 与 mcp；剩余重点缺口收敛到 `router` 与 `Web stream` 主链路。
- `temp/`：临时脚本和一次性辅助文件。

## 文档与记忆分层

当前仓库同时保留 `memory/` 和 `docs/memory/`，但职责已经统一为两层：

- `README.md`：仓库入口和当前实现总览。
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
2. 当前实现文档：`README.md`、`memory/architecture/`、`docs/feishu/`、`docs/memory/`。
3. 规划文档：`docs/product/`。

## 当前已落地能力

- 聊天式 Web 工作台：本地线程、历史列表、会话切换、底部输入区、分叉、设置。
- 统一会话层：外部渠道先提供 `channelSessionKey`，运行时再解析成统一 `conversationId`。
- 后端 Codex thread 复用：同一 `conversationId` 会恢复到同一条 Codex thread。
- 会话级工作区绑定：`workspacePath` 属于会话级设置，不属于 `principal` 级默认配置；Web 和飞书都支持按会话读写，新会话会继承当前激活会话的 `workspacePath`。
- 会话工作区冻结：会话一旦出现后端已执行痕迹（例如已确认的 turn / 已有服务端历史），就不能再修改 `workspacePath`，只能新建会话后再改。
- 执行目录解析：运行时每次执行任务会按会话解析工作区目录；如果当前会话没设置工作区会回退到 Themis 启动目录。Themis 自身 SQLite、认证账号槽位和第三方 provider 配置仍固定在控制目录体系下管理。
- NDJSON 流式任务输出：支持中途事件、最终结果、取消和断连中止。
- 回复额度尾注：认证模式下，Web / 飞书最终回复会附带当前认证返回的额度剩余尾注；当前 ChatGPT 常见会显示 `5h` 和 `1w` 两个窗口。
- 多账号认证池：当前只针对 ChatGPT 登录态做多账号自动建槽；Themis 会按真实账号邮箱自动创建并命名账号槽位，自动把认证文件归档到对应 `CODEX_HOME`；再次检测到同邮箱时会直接复用已有槽位。Web 和飞书现在共享同一份 `principal` 级默认认证账号与任务配置；飞书支持 `/settings account ...` 命令树，同时保留 `/account ...` 兼容入口。
- 飞书长连接主链路：普通文本消息、会话切换、命令、额度查询，以及“处理中占位槽位 + 顺序延迟 progress 缓冲 + 消息编辑更新 + 飞书富文本渲染”的回复桥接。
- 身份与会话辅助：Web 浏览器身份、一次性绑定码、跨端接入已有 `conversationId`。
- 长期协作档案：首次对话会进入一次性 bootstrap，用 4 轮分组采集称呼、长期背景、协作偏好，以及 Themis 的长期人格字段（语言风格 / 性格标签 / 补充说明 / SOUL），并按 `principal` 持久化；后续跨 Web / 飞书、跨会话复用。
- principal 重置：Web 顶部按钮和飞书 `/reset confirm` 都可以清空当前 principal 的人格档案、对话历史、默认任务配置和后端线程索引，并重新开始。
- 风格系统：不再内置固定人格预设；当前把语言风格、MBTI / 性格标签、补充风格说明和 `SOUL` 统一按 `principal` 保存为长期默认人格，所有会话都会自动继承，直到重置。
- 第三方兼容接入：供应商/模型管理、真实只读任务探测、`supportsCodexTasks` 写回、候选端点探活与自动切主端点。

## 当前未落地能力

- 更完整的自动化测试覆盖；当前已覆盖 Web modules、CLI、Feishu、server、core 的基础用例，`session store`、`fork transcript` 与 `history API` 这轮已补齐，后续重点收敛到 `router` 与 `Web stream` 主链路。
- 更完整的配置 / 运维与排障能力；当前已提供项目级 `init / status / doctor / config / auth / skill` 与 MCP 基础检查入口，但更细粒度的历史查询、端到端链路巡检和自动化修复仍未完成。CLI 不负责实际任务执行，任务入口仍然聚焦在 Web / 飞书渠道。

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

- [`memory/project/overview.md`](./memory/project/overview.md)
- [`memory/architecture/overview.md`](./memory/architecture/overview.md)
- [`docs/feishu/themis-feishu-channel.md`](./docs/feishu/themis-feishu-channel.md)
- [`docs/memory/2026/03/repository-doc-system-and-memory-boundaries.md`](./docs/memory/2026/03/repository-doc-system-and-memory-boundaries.md)
- [`memory/tasks/backlog.md`](./memory/tasks/backlog.md)
