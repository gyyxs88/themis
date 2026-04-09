# Themis 正式版 systemd 用户服务说明

## 目标

把 Themis 作为长期使用的正式实例挂到 `systemd --user` 下常驻运行。

这套方式和开发模式不同：

- 正式版使用公开仓 clone，而不是直接跑开发仓。
- 正式版使用 `npm run start:web` 跑编译产物，而不是 `npm run dev:web`。
- 正式版建议单独目录、单独 `.env.local`、单独 `infra/local/` 数据目录。

仓库里已经提供了一个可直接修改的模板：

```text
infra/systemd/themis-prod.service.example
```

## 推荐目录

建议把正式实例放到类似下面的位置：

```text
~/services/themis-prod
```

这样能和开发仓 `~/projects/themis` 清晰分开。

## 1. 获取正式代码

优先直接 clone 公开发布仓：

```bash
mkdir -p ~/services
git clone git@github.com:gyyxs88/themis.git ~/services/themis-prod
cd ~/services/themis-prod
npm ci
npm run build
```

## 2. 准备正式配置

至少确认下面这些键：

```bash
./themis config set THEMIS_PORT 3100
./themis config set FEISHU_APP_ID cli_xxx
./themis config set FEISHU_APP_SECRET xxx
```

如果你希望诊断命令显式命中正式实例，也建议在 `.env.local` 里补：

```bash
THEMIS_BASE_URL=http://127.0.0.1:3100
```

正式实例通常不需要开发仓里的 `TODOIST_API_TOKEN` 之类本地运维变量，建议不要直接原样复制整份 `.env.local`。

## 3. 如果要从开发版迁移已有数据

如果你之前一直在开发仓里使用 Themis，可以把运行数据迁到正式目录。推荐顺序：

1. 先停掉开发版服务，避免 SQLite 在写入中复制。
2. 把开发仓的 `infra/local/` 整体同步到正式目录。
3. 如果认证账号槽位使用的是受管 `codex-auth` 目录，要把 SQLite 里保存的绝对路径改成正式目录。

示例：

```bash
systemctl --user stop themis-dev.service
rsync -a --delete ~/projects/themis/infra/local/ ~/services/themis-prod/infra/local/
sqlite3 ~/services/themis-prod/infra/local/themis.db "
update themis_auth_accounts
set codex_home = replace(
  codex_home,
  '/home/you/projects/themis/infra/local/codex-auth',
  '/home/you/services/themis-prod/infra/local/codex-auth'
)
where codex_home like '/home/you/projects/themis/infra/local/codex-auth/%';
"
```

如果不做这一步，正式实例可能会继续引用开发仓里的认证目录。

## 4. 安装 systemd 用户服务

先复制模板：

```bash
mkdir -p ~/.config/systemd/user
cp ~/services/themis-prod/infra/systemd/themis-prod.service.example ~/.config/systemd/user/themis-prod.service
```

至少检查这两项：

- `WorkingDirectory`
- `ExecStart`

模板默认内容是：

```ini
[Service]
WorkingDirectory=%h/services/themis-prod
ExecStart=/usr/bin/npm run start:web
```

如果你的 `npm` 不在 `/usr/bin/npm`，先执行：

```bash
which npm
```

然后替换成真实绝对路径。

## 5. 启用常驻

```bash
systemctl --user daemon-reload
systemctl --user enable --now themis-prod.service
```

如果你希望退出图形会话或 SSH 断开后仍继续运行，再执行：

```bash
loginctl enable-linger "$USER"
```

## 6. 验证

最小验证顺序：

```bash
./themis status
./themis doctor feishu
THEMIS_BASE_URL=http://127.0.0.1:3100 ./themis doctor smoke web
THEMIS_BASE_URL=http://127.0.0.1:3100 ./themis doctor smoke feishu
```

再看服务状态和日志：

```bash
systemctl --user status themis-prod.service
journalctl --user -u themis-prod.service -f
```

## 7. 升级

正式版目录保留 `git clone`，这样可以直接检查更新并执行受控升级：

```bash
cd ~/services/themis-prod
git fetch origin
git status -sb
./themis status
git pull --ff-only
npm ci
npm run build
systemctl --user restart themis-prod.service
```

升级后按同样顺序复跑：

```bash
./themis doctor feishu
THEMIS_BASE_URL=http://127.0.0.1:3100 ./themis doctor smoke web
THEMIS_BASE_URL=http://127.0.0.1:3100 ./themis doctor smoke feishu
```

## 8. 与开发版并存的建议

- 正式版占用主端口，例如 `3100`。
- 开发版如需继续开常驻，建议改到别的端口，例如 `3210`。
- 如果正式版已经长期接入飞书，不要再让第二个实例同时带同一套飞书凭据并行启动。
