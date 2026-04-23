# Themis 平台层切换到 MySQL shared control plane 的操作说明

## 这篇文档负责什么

- 只负责“平台已经是独立进程后，怎么切到 MySQL shared control plane”。
- 不重复平台 `systemd` 安装与目录准备；那部分看 `themis-platform-systemd-service.md`。
- 不负责日常值班和备份恢复；那部分看 `themis-platform-monitoring-and-backup-runbook.md`。

## 目标

把平台层从“本地 SQLite shared control plane”切到“本地 shared cache SQLite + MySQL 真相源”的独立进程形态。

当前固定结构是：

- 平台进程本地仍保留一份 `shared cache SQLite`
- 启动时通过 `ManagedAgentControlPlaneMirror` 在本地 cache 和 MySQL 之间做 bootstrap
- 平台 `/api/platform/*` 写请求成功后立即回刷 MySQL
- 本地 `session task settings`、thread/history、auth 运行态仍留在当前 runtime store，不进入 MySQL

## 适用范围

- 适用于当前单平台写入者模型
- 适用于主 Themis 继续走 `/api/platform/*`
- 适用于 Worker Node 继续通过平台 API 拉 run、回传状态

## 1. 切换前准备

至少准备下面这些信息：

- 平台服务监听地址和端口
- MySQL 连接方式
- 平台 owner principalId
- 平台 Web Access token

推荐先确认 Docker MySQL 烟测与平台主链回归都能过：

```bash
npm run typecheck
node --test --import tsx \
  src/storage/mysql-managed-agent-control-plane-store.test.ts \
  src/core/managed-agent-control-plane-mirror.mysql.test.ts \
  src/server/http-platform.test.ts
npm run build
```

## 2. 切换涉及的配置增量

平台独立进程至少配置：

```bash
THEMIS_HOST=0.0.0.0
THEMIS_PORT=3100
THEMIS_UPDATE_SYSTEMD_SERVICE=themis-platform.service

THEMIS_PLATFORM_CONTROL_PLANE_DRIVER=mysql
THEMIS_PLATFORM_MYSQL_DATABASE=themis_platform
THEMIS_PLATFORM_MYSQL_URI=mysql://user:password@127.0.0.1:3306/themis_platform

THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE=infra/platform/control-plane.db
```

如果不用完整 URI，也可以拆成：

```bash
THEMIS_PLATFORM_MYSQL_HOST=127.0.0.1
THEMIS_PLATFORM_MYSQL_PORT=3306
THEMIS_PLATFORM_MYSQL_USER=root
THEMIS_PLATFORM_MYSQL_PASSWORD=root
THEMIS_PLATFORM_MYSQL_DATABASE=themis_platform
```

其中：

- `THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE` 在这里不再表示“真相源 SQLite”，而是平台进程本地 shared cache 文件
- `infra/local/themis.db` 仍继续承载本地 execution state、auth、thread/history
- `THEMIS_UPDATE_SYSTEMD_SERVICE=themis-platform.service` 用来让受控升级完成后自动重启平台层，而不是默认的 `themis-prod.service`

## 3. 切换时怎么启动

开发态：

```bash
npm run dev:platform
```

编译产物：

```bash
npm ci
npm run build
npm run start:platform
```

如果走 `systemd --user`，`ExecStart` 改为：

```ini
ExecStart=/usr/bin/npm run start:platform
```

如果要直接套模板，使用：

```text
infra/systemd/themis-platform.service.example
```

## 4. 切换后最小烟测

先看启动日志里是否出现这两条关键信息：

- `Control plane driver mysql`
- `Mirror bootstrap source ...`

然后检查健康接口：

```bash
curl -sS http://127.0.0.1:3100/api/health
```

再跑平台总览巡检：

```bash
./themis doctor worker-fleet \
  --platform http://127.0.0.1:3100 \
  --owner-principal <principalId> \
  --token <platformWorkerToken>
```

如果已经有节点，还应该至少验证一轮：

- `nodes/list`
- `nodes/detail`
- `agents/list`
- `work-items/list`

最简单的做法是直接用现有 CLI / Web 面板走通一遍；如果要手工打平台 API，可以用：

```bash
curl -sS http://127.0.0.1:3100/api/platform/nodes/list \
  -H "Authorization: Bearer <platformWorkerToken>" \
  -H "Content-Type: application/json" \
  -d '{"ownerPrincipalId":"<principalId>"}'
```

## 5. 回退步骤

如果切到 MySQL 后出现异常，回退顺序固定如下：

1. 停掉平台进程
2. 去掉 `THEMIS_PLATFORM_CONTROL_PLANE_DRIVER=mysql`
3. 去掉 `THEMIS_PLATFORM_MYSQL_*` 配置
4. 如需继续使用独立 SQLite 平台控制面，保留：

```bash
THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE=infra/platform/control-plane.db
```

5. 重新启动平台进程

这样会回到“本地独立 SQLite shared control plane + 本地 execution state”模式。

## 6. 当前验收结论

当前这条切换链已经固定验证了三类事实：

- MySQL store 自身的控制面 round-trip 与 claim 语义
- `ManagedAgentControlPlaneMirror` 在真实 MySQL 上的 bootstrap / restore / flush 闭环
- 平台 `/api/platform/*` 主链回归

因此当前切换重点不再是“能不能连上 MySQL”，而是：

- 平台进程是否按独立入口启动
- 日志里是否明确落到 `mysql` driver
- 切换后平台写请求、scheduler tick 和 Worker Node 回传是否都还正常
