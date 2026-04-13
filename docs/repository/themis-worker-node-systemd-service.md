# Themis Worker Node 常驻部署说明

## 目标

把 `Worker Node daemon` 作为长期运行的局域网执行节点挂到 `systemd --user` 下常驻运行。

这条链路和主 Themis Web 正式实例不同：

- 它不是 `npm run start:web`
- 它不暴露 Web / 飞书入口
- 它的职责是 `register -> heartbeat -> pull -> execute -> report`
- 它同样需要单独目录、单独 `infra/local/` 运行态，以及和本地真实环境一致的 capability 声明

仓库里已经提供了可直接修改的模板：

```text
infra/systemd/themis-worker-node.service.example
```

## 推荐目录

建议把节点目录放到类似下面的位置：

```text
~/services/themis-worker-node
```

这样能和开发仓 `~/projects/themis`、主 Themis 正式实例 `~/services/themis-prod` 分开。

## 1. 获取节点代码

推荐在节点机器上单独 clone 一份仓库：

```bash
mkdir -p ~/services
git clone git@github.com:gyyxs88/themis.git ~/services/themis-worker-node
cd ~/services/themis-worker-node
npm ci
npm run build
```

如果这台机器只是执行节点，不需要再启动 Web 服务。

## 2. 准备节点本地前提

至少先确认三件事：

1. 节点工作区目录真实存在
2. 节点声明的 `credentialCapabilities` 对应本地真实可用账号
3. 如果声明了 `providerCapabilities`，本地也真的能读到对应 provider 配置

当前最稳妥的启动前顺序是先跑预检：

```bash
cd ~/services/themis-worker-node
./themis doctor worker-node \
  --platform http://192.168.31.208:3100 \
  --owner-principal principal-owner \
  --token <platformToken> \
  --workspace /home/you/services/themis-worker-node \
  --credential default
```

看到下面这些状态时，不要直接启动 daemon：

- `workspace=missing / not_directory`
- `credential=missing`
- `provider=missing / read_error`
- `platform.status=failed`

如果这是台 fresh 节点，但对应 `CODEX_HOME` 或 `infra/local/codex-auth/<id>` 里已经有真实 `auth.json`，当前 `doctor worker-node` 也会直接把该 credential 判成 `ok`，不需要先跑一次 daemon 才让预检通过。

## 3. 准备 credential bootstrap

`--credential` 不是“纯调度标签”，它必须和节点本地实际可用账号对齐。

当前 `themis worker-node run` 会在本地 runtime store 自动补账号记录：

- `--credential default`
  - 对应默认 `CODEX_HOME`
  - 如果没显式设置 `CODEX_HOME`，就是 `~/.codex`
- `--credential <id>`
  - 会落到当前节点目录下的 `infra/local/codex-auth/<id>`

这只解决“本地 runtime store 里有账号槽位”这件事，不等于认证已经准备好。你仍然要确保对应 `codex-home` 里有真实可用的认证材料。

当前 `doctor worker-node` 会同时看 runtime store 里的 auth account 记录，以及对应 `codex-home` 下是否已经存在 `auth.json`。所以对 fresh 节点来说，只要认证材料已经在位，预检就会把 credential 判成可用，而不是一律报缺失。

## 4. 先做一次单次启动验证

正式挂常驻前，先跑一次 `--once`：

```bash
cd ~/services/themis-worker-node
./themis worker-node run \
  --platform http://192.168.31.208:3100 \
  --owner-principal principal-owner \
  --token <platformToken> \
  --name worker-node-a \
  --workspace /home/you/services/themis-worker-node \
  --credential default \
  --once
```

这一步至少要确认：

- 节点能成功 `register`
- 节点能成功 `heartbeat`
- 没有任务时能稳定返回 `结果：idle`

如果这里都过不去，不要直接上 `systemd`。

## 5. 安装 systemd 用户服务

先复制模板：

```bash
mkdir -p ~/.config/systemd/user
cp ~/services/themis-worker-node/infra/systemd/themis-worker-node.service.example \
  ~/.config/systemd/user/themis-worker-node.service
```

模板默认包含这些关键字段：

```ini
[Service]
WorkingDirectory=%h/services/themis-worker-node
Environment="THEMIS_WORKER_PLATFORM=http://127.0.0.1:3100"
Environment="THEMIS_WORKER_OWNER_PRINCIPAL=principal-owner"
Environment="THEMIS_WORKER_TOKEN=replace-with-platform-worker-token"
Environment="THEMIS_WORKER_NAME=worker-node-a"
Environment="THEMIS_WORKER_NODE_ID=node-worker-a"
Environment="THEMIS_WORKER_WORKSPACE=%h/services/themis-worker-node"
Environment="THEMIS_WORKER_CREDENTIAL=default"
Environment="THEMIS_WORKER_SLOT_CAPACITY=1"
ExecStart=%h/services/themis-worker-node/themis worker-node run ...
```

至少按真实环境替换这些项：

- `WorkingDirectory`
- `THEMIS_WORKER_PLATFORM`
- `THEMIS_WORKER_OWNER_PRINCIPAL`
- `THEMIS_WORKER_TOKEN`
- `THEMIS_WORKER_NAME`
- `THEMIS_WORKER_NODE_ID`
- `THEMIS_WORKER_WORKSPACE`
- `THEMIS_WORKER_CREDENTIAL`
- `THEMIS_WORKER_SLOT_CAPACITY`

`THEMIS_WORKER_NAME` 建议直接用不带空格的稳定标识，例如 `worker-node-a`，这样 systemd 模板和手工命令都更不容易踩到参数转义问题。

`THEMIS_WORKER_NODE_ID` 也建议固定下来，例如 `node-worker-a`。如果长期常驻节点不传稳定 `--node-id`，每次重启都会注册成新的 node 记录，平台里会留下同名但不同 `nodeId` 的 offline 节点，后续值班和诊断会变乱。

如果你还要声明更多能力，可以继续往 `ExecStart` 里追加：

- `--workspace <path>` 多次
- `--credential <id>` 多次
- `--provider <id>` 多次
- `--label <value>` 多次
- `--heartbeat-ttl-seconds <n>`
- `--poll-interval-ms <n>`
- `--heartbeat-interval-ms <n>`

## 6. 启用常驻

```bash
systemctl --user daemon-reload
systemctl --user enable --now themis-worker-node.service
```

如果希望退出图形会话或 SSH 断开后仍继续运行，再执行：

```bash
loginctl enable-linger "$USER"
```

## 7. 验证

最小验证顺序：

```bash
systemctl --user status themis-worker-node.service
journalctl --user -u themis-worker-node.service -f
```

再在节点目录里补一轮手工预检，确认配置没漂：

```bash
cd ~/services/themis-worker-node
./themis doctor worker-node \
  --platform http://192.168.31.208:3100 \
  --owner-principal principal-owner \
  --token <platformToken> \
  --workspace /home/you/services/themis-worker-node \
  --credential default
```

如果平台侧也在值守，建议再配合看：

- `POST /api/platform/nodes/list`
- `POST /api/platform/nodes/detail`
- 平台主进程日志里是否出现节点 heartbeat 或自动 reclaim 提示

## 8. 日常操作

重启：

```bash
systemctl --user restart themis-worker-node.service
```

停止：

```bash
systemctl --user stop themis-worker-node.service
```

停机后如果希望平台立刻回收该节点上的活动 lease，当前优先执行：

```bash
./themis worker-fleet reclaim \
  --platform http://127.0.0.1:3100 \
  --owner-principal principal-owner \
  --token <platformToken> \
  --node <nodeId> \
  --yes
```

如果不手动治理，scheduler tick 也会在后续自动回收 `offline` 或 TTL 过期节点上的活动 lease。

## 9. 常见坑

### 9.1 预检通过，但真正执行时报 `Auth account does not exist.`

说明节点声明了 `--credential`，但对应本地账号目录或认证材料并没准备好。优先检查：

- `default` 是否真的指向你想要的 `CODEX_HOME`
- 非默认账号目录下是否已有认证材料
- 节点当前工作目录是不是你以为的那一份 clone

### 9.2 节点一直注册成功，但拉不到任务

优先检查：

- 任务的 `workspace / credential / provider` 需求是否真的和节点 capability 对齐
- 节点是否已经被手动打成 `draining` 或 `offline`
- 是否还有别的节点更先被匹配命中

### 9.3 节点掉线后任务卡住

当前正确预期是：

- 节点停机时会尽量发送一次 `offline` heartbeat
- 如果节点是异常断开，平台会在 heartbeat TTL 到期后把节点收敛为 `offline`
- scheduler tick 会自动回收该节点上的活动 lease
- 运行中的任务会重新排回 `queued`
- `waiting_human / waiting_agent` 会保留等待态，只回收 lease

## 相关文档

- [README](../../README.md)
- [Themis Worker Node 巡检、排障与多节点值守手册](./themis-worker-node-operations-runbook.md)
- [Themis doctor worker-fleet 会批量汇总节点 attention、心跳状态与建议动作](../memory/2026/04/themis-worker-fleet-doctor-summary.md)
- [Themis worker-fleet 已提供平台侧 drain / offline / reclaim 批量治理入口](../memory/2026/04/themis-worker-fleet-governance-cli.md)
- [Themis Worker Node 启动前应先跑 doctor worker-node 预检](../memory/2026/04/themis-worker-node-preflight-diagnostics.md)
- [Themis Worker Node 的 credentialCapabilities 必须和本地 auth account 对齐](../memory/2026/04/themis-worker-node-credential-bootstrap.md)
- [Themis 平台节点会在读路径与调度路径上按心跳 TTL 自动收敛为 offline，并自动回收失联节点 lease](../memory/2026/04/themis-platform-node-heartbeat-ttl-offline-reconciliation.md)
