# Themis

Themis 是一个围绕 `codex app-server` 构建的自托管协作壳。

它把 Codex 的能力收敛成更适合长期使用的 Web 和飞书入口，并补上本地持久化、诊断、自动化接口和定时任务这些“正式使用”需要的外围能力。

## 它能做什么

- 提供本地 / 局域网 Web 聊天工作台，支持认证、多账号、历史、分叉、运行参数和长期画像。
- 提供飞书机器人入口，并和 Web 共享运行时、通信层与 SQLite 持久化。
- 提供 `status / doctor / doctor smoke / doctor release` 这套运维诊断入口。
- 提供 `POST /api/tasks/automation/run` 这类自动化接口。
- 提供单次定时任务能力，并通过 `themis mcp-server` 暴露 `create_scheduled_task / list_scheduled_tasks / cancel_scheduled_task` 给 Codex 调用。

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

4. 在浏览器打开：

```text
http://localhost:3100
```

## 常用命令

```bash
./themis status
./themis doctor
./themis doctor smoke web
./themis doctor smoke feishu
./themis doctor smoke all
./themis doctor release
./themis mcp-server
```

如果你希望像 `codex` 一样直接输入 `themis`，可以在仓库根目录执行一次：

```bash
./themis install
```

之后就可以直接运行：

```bash
themis
themis status
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
- `CODEX_HOME`
- `CODEX_API_KEY`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_PROGRESS_FLUSH_TIMEOUT_MS`
- `THEMIS_OPENAI_COMPAT_BASE_URL`
- `THEMIS_OPENAI_COMPAT_API_KEY`
- `THEMIS_OPENAI_COMPAT_MODEL`
- `THEMIS_BUILD_COMMIT`
- `THEMIS_UPDATE_REPO`
- `THEMIS_UPDATE_DEFAULT_BRANCH`

## 公开文档

- [飞书接入总览](./docs/feishu/README.md)
- [飞书通道说明](./docs/feishu/themis-feishu-channel.md)
- [持久化 agent 架构](./docs/product/themis-persistent-agent-architecture.md)
- [公开发布边界与导出规则](./docs/repository/github-safe-publish.md)
- [systemd 正式常驻示例](./docs/repository/themis-systemd-prod-service.md)
- [systemd 开发常驻示例](./docs/repository/themis-systemd-dev-service.md)

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

## 开发模式补充

`dev:web` 会监听后端 TypeScript 变更并自动重启；前端静态资源修改后仍需要手动刷新浏览器页面。

如果你希望把开发模式常驻到 `systemd --user` 并保留后端热更新，可参考：

- [systemd service 示例](./infra/systemd/themis-dev.service.example)
- [systemd 使用说明](./docs/repository/themis-systemd-dev-service.md)

如果你要部署长期使用的正式实例，可参考：

- [正式版 systemd service 示例](./infra/systemd/themis-prod.service.example)
- [正式版部署说明](./docs/repository/themis-systemd-prod-service.md)
