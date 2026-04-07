# Themis

Themis 是一个以 `codex app-server` 为主执行链路、面向内部协作的 Codex 壳项目。

当前目标不是再包一层通用平台，而是把 Codex 的能力收敛成更适合内部员工使用的 Web / 飞书入口，并把项目现状、决策、任务和长期可复用结论持续留在仓库里。

## 当前状态

- 员工主入口已经是 LAN Web 聊天工作台，飞书已接入并与 Web 共享通信层、运行时和本地持久化。
- 默认任务执行链路已经切到 `codex app-server`；`@openai/codex-sdk` 仅保留显式兼容路径。
- `路线图 / 阶段 5 / 兼容入口收敛` 已完成：Web / HTTP / 飞书普通任务这些公共任务入口现在只接受 `app-server`；显式 `runtimeEngine: "sdk"` 会直接拒绝，`sdk` 只保留给历史 session 的 fork / action / review / 恢复兼容。
- `路线图 / 阶段 6 / 发布级验收与运营闭环` 已完成：`./themis doctor release` 已成为统一发布就绪入口，发布验收矩阵、灰度与回退、值班与 onboarding 文档都已补齐。
- Web 已具备认证、多账号、历史、分叉、运行参数、第三方兼容接入和长期画像等核心壳层能力；SQLite 历史现已支持服务端搜索、归档和分支来源元数据。
- 阶段 4 的共享输入主线已完成前五刀，并把这轮“多附件组合 + MIME/异常边界”基本收口：共享 PDF 资产加工、Web 输入资产预览 / 历史回放闭环、文本型文档接入共享输入资产层、文档执行契约收缩为“只给文件事实和本地路径”、以及真实 runtime `turn input / compile summary` 持久化都已完成；随后又补齐了飞书 `post` 混合输入顺序保真、`app-server` `localImage` 协议对齐、模型 / transport 能力求交、compile warning 的飞书用户态解释，以及 `doctor smoke web` 对共享多模态边界的固定复验。
- 飞书第二阶段第一刀已收口：群聊默认 `smart` 路由、可切换的 `always` 路由、`personal / shared` 会话策略、`/group` 最小管理员控制，以及 shared 群会话下 `/new`、`/use`、`/workspace` 的管理员限制都已接进主链路。
- 长期记忆现已补齐独立候选池、自动经验提炼和人工确认流；`codex runtime` 与 `app-server runtime` 会在已完成任务收口后保守提炼候选，Web 设置面板也可对“当前会话最近完成任务”手动补提炼，正式主记忆和候选建议仍保持分开持久化，`/api/actors/memory-candidates/*` 已支持 suggest / list / extract / approve / reject / archive。
- `持久化 agent` 的 `P3 / 自动创建与治理`、`P4 / 协作与交接`、`P5 / 运行边界与执行` 已全部收口：自动创建、护栏、审计、bootstrap onboarding、idle recovery、`handoff` 时间线、父子 `work item` 汇总、manager 最小协作面都已接进主链；最新这轮又把执行边界真正落到了运行时，当前每个长期 agent 都会持久化自己的默认 `workspace policy` 和 `runtime profile`，新派工会自动继承 `workspacePolicySnapshot / runtimeProfileSnapshot`，执行时会校验工作区、写入 session workspace、合并附加目录、收紧网络开关，并按 `auth / third-party provider` 隔离 `app-server` 会话环境。HTTP 已新增 `POST /api/agents/execution-boundary/update`，`POST /api/agents/detail` 也会直接返回 `workspacePolicy / runtimeProfile / authAccounts / thirdPartyProviders`，Web `Agents` 面板现已可直接查看和更新默认执行边界。当前没有新的阻塞型主线；如果后续继续深挖持久化 agent，优先转入 `P6 / 后续路线图`，评估更强的物理隔离、远端执行节点和更重的 manager 治理面，而不是继续扩第二套壳层。
- 项目级 CLI 提供 `init / status / doctor / config / auth / skill` 等运维入口；`doctor smoke web|feishu|all` 已成为正式的低成本真实链路复跑入口，`doctor release` 也已成为统一发布就绪检查，diagnostics 与 HTTP 共用数据源，`doctor service` 也已开始直接暴露最近多模态输入的 compile 事实摘要。
- 运行时上下文构建器与 Markdown memory service 已接入任务主链路。
- Web 主链路自动化测试、`router` 与 `Web stream` 回归已补齐。
- `结构化输出 / 自动化接口` 已完成：`POST /api/tasks/automation/run` 已作为独立自动化入口落地，当前支持稳定结果 envelope、`text/json` 两种输出模式、更完整的高频 JSON Schema 校验词汇、结构化 `issues` 列表，以及 `onInvalidJson / onSchemaMismatch` 的 `report / reject` 失败收口语义。
- `云端 / 远程执行能力评估` 已完成：当前结论是 Themis 如需引入远程 / 共享执行节点，应优先沿“远端 websocket `codex app-server`”方向推进；`codex cloud` 暂不作为现有 Web / 飞书聊天主链。除非后续出现明确共享节点或长任务托管需求，否则当前没有新的阻塞型主线。

## 当前总览入口

- 项目当前总览与 Codex 能力对齐主表：[`memory/project/codex-alignment.md`](./memory/project/codex-alignment.md)
- 进度主台账：Todoist `Themis` 项目
- 仓库内任务镜像：[`memory/tasks/backlog.md`](./memory/tasks/backlog.md)、[`memory/tasks/in-progress.md`](./memory/tasks/in-progress.md)、[`memory/tasks/done.md`](./memory/tasks/done.md)
- 当前实现边界：[`memory/architecture/overview.md`](./memory/architecture/overview.md)

`README.md` 继续承担项目简介、运行方式和仓库导航；详细的能力对齐状态、风险和下一步优先级统一以 `memory/project/codex-alignment.md` 为准。自 `2026-04-02` 起，项目进度主台账改为 Todoist，仓库内 `memory/tasks/*` 仅保留本地镜像与补充说明，不再作为唯一进度来源。

## 目录说明

- `src/`：后端运行时、HTTP 服务、通信层、渠道适配器。
- `apps/web/`：员工向 Web 聊天工作台。
- `docs/`：设计文档、专题说明、渠道说明和长期记忆。
- `docs/memory/YYYY/MM/`：已验证、可长期复用的专题记忆。
- `memory/`：共享项目工作台，存放项目概览、架构现状、任务状态、决策记录和当前会话。
- `infra/`：本地数据库、生成配置和环境相关文件。
- `scripts/`：仓库级维护脚本；当前包含“从本地开发仓 A 导出到公开仓 B”的白名单发布脚本。
- `src/**/*.test.ts`：当前基础自动化测试，已覆盖 Web modules、CLI、Feishu、server、core、context、memory、diagnostics 与 mcp；`session store`、`fork transcript`、`history API`、`router`、`Web stream` 与 Web 主链路第一波混合式跨模块回归这几轮都已补齐。
- `temp/`：临时脚本和一次性辅助文件。

## 文档与记忆分层

当前仓库同时保留 `memory/` 和 `docs/memory/`，但职责已经统一为两层：

- `README.md`：仓库入口和稳定摘要，不承担详细状态主表职责。
- `memory/project/codex-alignment.md`：项目当前状态、Codex 能力对齐、风险与下一步优先级的事实主表。
- `memory/project/`：项目目标、阶段、干系人等共享背景。
- `memory/architecture/`：当前实现形态、运行路径和边界。
- `memory/tasks/`：Todoist 任务盘的仓库内镜像与补充说明，不再是唯一进度主台账。
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
./themis doctor
./themis doctor smoke web
./themis doctor smoke feishu
./themis doctor smoke all
./themis doctor release
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

公开发布到兄弟目录 GitHub 仓：

```bash
npm run publish:public -- ../themis-public
```

当前固定要求：

- `A = /home/leyi/projects/themis` 只做本地 git 开发仓，不再配置公开 GitHub remote。
- `B = /home/leyi/projects/themis-public` 是唯一允许连接并推送 GitHub 的公开仓。
- 公开内容只能通过 `A -> publish:public -> B -> git push` 这条链路发布。

如果想先预览导出差异：

```bash
bash scripts/export-public-repo.sh --dry-run ../themis-public
```

公开推送示例：

```bash
cd ../themis-public
git status
git add -A
git commit -m "..."
git push origin main
```

这套流程的约束、白名单范围和 `example/local` 配置分层规则见：

- [`docs/repository/github-safe-publish.md`](./docs/repository/github-safe-publish.md)

低成本真实链路复跑：

```bash
./themis doctor
./themis doctor mcp
./themis doctor smoke web
./themis doctor smoke feishu
./themis doctor smoke all
./themis doctor release
```

- `doctor`：默认总览页现在会直接输出 `feishu / service(multimodal) / mcp` 异常热点和建议先看的诊断命令，适合先判断问题更像落在哪一层。
- `doctor service`：会输出 SQLite 状态，以及最近一批已持久化 `turn input` 的多模态摘要，包括图片/文档资产计数、`native / controlled_fallback / blocked` 分布、source channel / runtime target 分布和最后一条输入的 compile 结果。
- `doctor mcp`：会输出当前 Codex `app-server` 可见的 MCP server 状态分布、每个 server 的分类/关键细节/建议动作，以及总诊断，先回答“是不是 app-server / MCP 装载层出问题了，具体卡在哪个 server”；它展示的是当前运行环境里可见的 MCP，不等于 Themis 原生能力清单。
- `doctor smoke web`：自动验证真实 Web / HTTP 主链路是否能进入 `task.action_required`，并在补充输入后收口为 `completed`；同时会再做一轮真实多模态 compile 事实核验，确认图片输入走 `app-server` native 路径、文档输入保持 `controlled_fallback`，以及这些结果已经写进 `history/detail` 的 `turn.input.compileSummary`。CLI 现在会按登录、图片 native smoke、文档 fallback smoke、共享边界校验等阶段持续打印进度，避免长时间静默等待。
- `doctor smoke feishu`：只做飞书前置检查和手工 smoke 接力提示，不会伪装成全自动飞书 E2E。
- `doctor smoke all`：先跑 `web`，通过后再输出飞书手工 smoke 指引；如果 `web` 没过，会明确提示当前已跳过飞书 smoke。CLI 同样会持续打印 Web smoke 的阶段进度。
- `doctor release`：把 `doctor` 总览热点、`doctor smoke web/feishu` 结果和发布级文档齐备性收口到一次发布就绪判断；返回非 `0` 时不进入灰度。由于内部会跑真实 smoke，成功场景可能需要数分钟；CLI 现在会按 `1/3 -> 2/3 -> 3/3` 和阶段耗时持续打印进度。
- `temp/repro-real-web-user-input-http.ts` 仍保留给开发调试使用，但正式入口优先走 `doctor smoke`。

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
- [`docs/memory/2026/04/shared-pdf-input-asset-enrichment.md`](./docs/memory/2026/04/shared-pdf-input-asset-enrichment.md)
- [`docs/memory/2026/04/shared-text-document-input-asset-enrichment.md`](./docs/memory/2026/04/shared-text-document-input-asset-enrichment.md)
- [`docs/memory/2026/04/document-input-path-contract.md`](./docs/memory/2026/04/document-input-path-contract.md)
- [`docs/memory/2026/04/web-input-asset-preview-history-replay.md`](./docs/memory/2026/04/web-input-asset-preview-history-replay.md)
- [`docs/memory/2026/04/principal-main-memory-candidate-flow.md`](./docs/memory/2026/04/principal-main-memory-candidate-flow.md)
- [`docs/memory/2026/04/themis-cloud-remote-execution-assessment.md`](./docs/memory/2026/04/themis-cloud-remote-execution-assessment.md)
- [`docs/memory/2026/03/repository-doc-system-and-memory-boundaries.md`](./docs/memory/2026/03/repository-doc-system-and-memory-boundaries.md)
- [`memory/tasks/backlog.md`](./memory/tasks/backlog.md)
