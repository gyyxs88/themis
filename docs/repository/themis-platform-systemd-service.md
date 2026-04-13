# Themis 平台层 systemd 用户服务说明

## 目标

把独立平台层进程挂到 `systemd --user` 下常驻运行，并让它以 `MySQL shared control plane + 本地 shared cache SQLite` 的方式提供平台控制面。

这条链路和主 Themis 正式实例不同：

- 它不是 `npm run start:web`
- 它的入口是 `npm run start:platform`
- 它负责平台控制面、scheduler tick、Worker Node 接入和 `/api/platform/*`
- 它不等于主 Themis 对话入口

仓库里已经提供了模板：

```text
infra/systemd/themis-platform.service.example
```

## 推荐目录

建议把平台层独立目录放到类似下面的位置：

```text
~/services/themis-platform
```

这样能和主 Themis 正式实例 `~/services/themis-prod`、执行节点 `~/services/themis-worker-node` 分开。

## 1. 获取平台代码

```bash
mkdir -p ~/services
git clone git@github.com:gyyxs88/themis.git ~/services/themis-platform
cd ~/services/themis-platform
npm ci
npm run build
```

## 2. 准备平台配置

至少在 `.env.local` 里确认下面这些键：

```bash
THEMIS_HOST=0.0.0.0
THEMIS_PORT=3100

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

当前这组配置的含义是：

- MySQL 承载 shared control plane 真相源
- `THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE` 是平台本地 shared cache SQLite
- `infra/local/themis.db` 仍继续承载本地 execution state、auth、thread/history

## 3. 先做一次前台启动验证

正式挂常驻前，先直接前台跑：

```bash
cd ~/services/themis-platform
npm run start:platform
```

至少确认日志里有这几条：

- `Shared control plane platform is ready.`
- `Control plane driver mysql`
- `Mirror bootstrap source ...`

然后再检查健康接口：

```bash
curl -sS http://127.0.0.1:3100/api/health
```

## 4. 安装 systemd 用户服务

先复制模板：

```bash
mkdir -p ~/.config/systemd/user
cp ~/services/themis-platform/infra/systemd/themis-platform.service.example \
  ~/.config/systemd/user/themis-platform.service
```

至少检查这两项：

- `WorkingDirectory`
- `ExecStart`

模板默认内容是：

```ini
[Service]
WorkingDirectory=%h/services/themis-platform
ExecStart=/usr/bin/npm run start:platform
```

如果你的 `npm` 不在 `/usr/bin/npm`，先执行：

```bash
which npm
```

然后改成真实绝对路径。

## 5. 启用常驻

```bash
systemctl --user daemon-reload
systemctl --user enable --now themis-platform.service
```

如果希望退出图形会话或 SSH 断开后仍继续运行，再执行：

```bash
loginctl enable-linger "$USER"
```

## 6. 验证

先看服务状态：

```bash
systemctl --user status themis-platform.service
journalctl --user -u themis-platform.service -f
```

再跑平台最小巡检：

```bash
./themis doctor worker-fleet \
  --platform http://127.0.0.1:3100 \
  --owner-principal <principalId> \
  --token <platformToken>
```

如果平台层刚切到 MySQL，建议再顺手复验一轮：

- `/api/platform/nodes/list`
- `/api/platform/agents/list`
- `/api/platform/work-items/list`

## 7. 回退

如果平台层切到 MySQL 后出现异常，优先走：

1. `systemctl --user stop themis-platform.service`
2. 去掉 `THEMIS_PLATFORM_CONTROL_PLANE_DRIVER=mysql`
3. 去掉 `THEMIS_PLATFORM_MYSQL_*`
4. 如需保留独立 SQLite 平台控制面，则保留：

```bash
THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE=infra/platform/control-plane.db
```

5. `systemctl --user start themis-platform.service`

这会回到“独立 SQLite 平台控制面 + 本地 execution state”的模式。
