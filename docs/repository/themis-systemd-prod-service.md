# Themis 正式版 systemd 用户服务说明

## 这篇文档负责什么

- 只负责主 Themis 正式实例的安装、常驻、验证和受控升级。
- 不负责描述“当前这台机器现在实际跑在哪里”；现网入口看本地专用 `docs/local/current-deployment.md`。
- 不重复发布验收矩阵和灰度回退步骤；发布前后流程分别看 `themis-release-acceptance-matrix.md` 与 `themis-release-rollout-and-rollback.md`。

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

如果你当前机器上已经有一个历史正式目录，但它不是 `git clone`，不要直接在原目录里硬改。更稳的一次性迁移方式是：

```bash
cd ~/services
git clone https://github.com/gyyxs88/themis.git themis-prod-next
cd ~/services/themis-prod-next
npm ci --include=dev
npm run build

systemctl --user stop themis-prod.service
cp ~/services/themis-prod/.env.local ~/services/themis-prod-next/.env.local
cp -a ~/services/themis-prod/.codex ~/services/themis-prod-next/.codex
cp -a ~/services/themis-prod/infra/local ~/services/themis-prod-next/infra/local

mkdir -p ~/services/themis-prod-backups
mv ~/services/themis-prod ~/services/themis-prod-backups/$(date +%Y%m%d-%H%M%S)
mv ~/services/themis-prod-next ~/services/themis-prod
systemctl --user start themis-prod.service
```

这条迁移路径的目的不是“省一步 clone”，而是把正式目录补成后续 `./themis update apply` 可识别的公开仓 `git clone`。旁路先 build、最后再停服务切换，能把停机时间压到最短。

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

如果你计划直接使用 `./themis update apply` 做受控升级，也建议在 `.env.local` 里固定：

```bash
THEMIS_UPDATE_CHANNEL=release
THEMIS_UPDATE_SYSTEMD_SERVICE=themis-prod.service
```

这样正式实例会跟随 GitHub 最新正式 release，而不是默认分支头提交；升级成功后，CLI 也会直接重启这条 `systemd --user` 服务。如果你的正式服务名不是 `themis-prod.service`，就在这里改成真实名字。

飞书 `/ops restart confirm` 和后台升级 / 回滚后的重启请求会写 `infra/local/themis-restart-request.json`。默认会等待 `systemctl --user restart` 最多 15 秒来捕获非 0 退出码；如果 marker 超过 120 秒仍未被新进程确认，`/ops status` 会把它收口成 failed。需要调整时可设置 `THEMIS_UPDATE_RESTART_EXIT_WAIT_MS` 和 `THEMIS_RESTART_CONFIRM_TIMEOUT_MS`。

正式实例通常不需要开发仓里的 `TODOIST_API_TOKEN` 之类本地运维变量，建议不要直接原样复制整份 `.env.local`。

如果你希望正式实例自动继承当前系统用户已有的 Codex / ChatGPT 登录态，也不要显式设置 `CODEX_HOME`。保持未配置时，Themis 会按默认逻辑读取 `~/.codex`。

只有在你明确想把正式版的认证目录和本机默认登录态隔离开时，才应该手动设置 `CODEX_HOME`。

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

正式版目录保留 `git clone`，这样可以直接检查更新并执行受控升级。

先检查是否有新版本：

```bash
cd ~/services/themis-prod
./themis update check
```

如果你走的是 `THEMIS_UPDATE_CHANNEL=release`，这里看到的会是 “GitHub 最新 release + 对应提交”；如果不配，默认仍是“默认分支最新提交”。

如果这里直接提示“当前更新源还没有正式 release”，说明公开仓还没发布第一条 published full release；这时要么先在 GitHub 发 release，要么临时切回 `THEMIS_UPDATE_CHANNEL=branch`。

如果确认要升级，第一版推荐直接走受控升级：

```bash
cd ~/services/themis-prod
./themis update apply
```

如果你已经能登录这台正式实例的 Web，也可以直接在“运行参数 -> 实例升级”里点“后台升级 / 回滚上一版”；飞书单聊里也可以用 `/update`、`/update apply confirm`、`/update rollback confirm` 作为同一条受控升级链的入口。它们不会在 HTTP / 飞书请求里直接执行重活，而是会把进度落到 `infra/local/themis-update-operation.json`，后台完成版本切换后再请求重启当前 `systemd --user` 服务。单独查看实例状态和最近一次重启确认使用飞书 `/ops status`，单独请求重启当前服务使用 `/ops restart confirm`。

它会按顺序执行：

- 校验当前目录仍是公开仓 `git clone`
- 拒绝脏工作区、非默认分支或分叉状态
- `git fetch origin <default-branch>`
- `git pull --ff-only origin <default-branch>`
- `npm ci`
- `npm run build`
- 回写 `.env.local` 里的 `THEMIS_BUILD_COMMIT / THEMIS_BUILD_BRANCH`
- 重启 `systemd --user` 服务

如果这条升级链是从 Web / 飞书后台 worker 发起的，且服务本身运行在 `NODE_ENV=production` 的 `systemd --user` 环境里，当前实现会显式用 `npm ci --include=dev`，避免 build 阶段因为缺少 `tsc` 这类 devDependencies 而失败。

如果你临时不想自动重启，也可以：

```bash
cd ~/services/themis-prod
./themis update apply --no-restart
```

如果新版本已经拉起但确认要立刻退回上一版，第一版也支持受控回滚：

```bash
cd ~/services/themis-prod
./themis update rollback
```

当前回滚边界：

- 只回退最近一次成功升级。
- 只在当前 `HEAD` 仍然等于那次升级后的提交时允许继续。
- 回滚成功后会清掉这条最近升级记录，避免重复对同一条记录来回切换。

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
- 如果你要在本机做“旧版 -> 新版”的升级演练，建议另起 `~/services/themis-prod-clean` 这类干净目录，配独立 `systemd --user` 服务名和端口，并且不要接正式实例正在使用的飞书机器人。
