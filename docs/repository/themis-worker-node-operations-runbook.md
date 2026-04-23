# Themis Worker Node 巡检、排障与多节点值守手册

## 这篇文档负责什么

- 只负责“节点已经部署好之后，日常怎么巡检、排障和做治理动作”。
- 不重复 Worker Node 的安装和 `systemd` 配置；那部分看 `themis-worker-node-systemd-service.md`。
- 如果你是第一次接手值班，不确定先看哪篇，先回到 `themis-operator-onboarding.md`。

## 目标

把 `Worker Node` 的日常值守顺序、平台治理动作和多节点约定固定下来，避免排障时一会儿看 `systemd`、一会儿猜平台调度，最后谁都说不清。

这份手册默认建立在下面这些前提已经成立的基础上：

- 节点已经按 [Themis Worker Node 常驻部署说明](./themis-worker-node-systemd-service.md) 部署
- 平台侧已经具备 `nodes/list|detail|drain|offline|reclaim`
- scheduler tick 已会自动回收 `offline` 或 TTL 过期节点上的活动 lease

## 一页顺序

值班时固定按这个顺序排：

1. 先跑 `./themis doctor worker-fleet` 看平台总览
2. 再看具体节点本机 `systemd --user` 状态和最近日志
3. 再跑 `./themis doctor worker-node` 看本地 capability 和平台可达性
4. 最后再看平台 `nodes/list` 和 `nodes/detail`
5. 必要时才执行 `./themis worker-fleet <drain|offline|reclaim>`

不要一上来就先 `reclaim`，也不要只看平台列表就跳过节点本机日志。

## 0. 先看平台总览

如果已经有多台节点在线，值班时先跑：

```bash
./themis doctor worker-fleet \
  --platform http://192.168.31.208:3100 \
  --owner-principal principal-owner \
  --token <platformToken>
```

这条命令会先把平台侧 `status / heartbeat / active lease` 汇总出来，值班时优先用它挑出“要盯哪一台”，再下钻单节点。

## 1. 节点本机先看什么

最小顺序：

```bash
systemctl --user status themis-worker-node.service
journalctl --user -u themis-worker-node.service -n 100 --no-pager
```

优先看这几类信号：

- 服务是否 `active (running)`
- 最近是否持续出现 `Worker Node 已启动`
- 是否有平台登录失败、拉任务失败、执行失败之类的错误
- 进程是否频繁重启

如果服务根本没起来，先修本机问题，不要先去平台侧猜调度。

## 2. 启动前预检现在该怎么看

节点目录里固定补一轮：

```bash
cd ~/services/themis-worker-node
./themis doctor worker-node \
  --platform http://192.168.31.208:3100 \
  --owner-principal principal-owner \
  --token <platformToken> \
  --workspace /home/you/services/themis-worker-node \
  --credential default
```

当前重点关注：

- `sqlite.exists`
- `workspace[*].status`
- `credential[*].status`
- `platform.status`
- `platform.nodeCount`

判断规则：

- `workspace=missing / not_directory`：先修本地目录或 capability 声明
- `credential=missing`：先修本地 auth 材料或 credential 目录
- `platform.status=failed`：优先查平台地址、token、网络
- `platform.status=ok` 但节点仍长期不在线：再去看平台 detail 和本机日志

对 fresh 节点来说，只要默认 `CODEX_HOME` 或 `infra/local/codex-auth/<id>` 里已经有真实 `auth.json`，当前预检就会把该 credential 判成 `ok`，不需要先跑一次 daemon 才过。

## 3. 什么时候还需要直接看平台治理 API

当前值守的第一选择已经是：

- `./themis doctor worker-fleet`
- `./themis worker-fleet drain|offline|reclaim`

只有在你要直接看原始 HTTP payload，或者需要临时旁路 CLI 时，才需要手工调用平台 API。

如果还没有节点治理令牌，先在平台宿主机上创建一条 `worker` 角色平台服务令牌：

```bash
cd ~/services/themis-prod
./themis auth platform add worker-node-ops \
  --role worker \
  --owner-principal principal-owner
```

后续临时旁路 CLI 时，统一直接带 Bearer 头：

```bash
export THEMIS_PLATFORM_TOKEN='<platformToken>'

curl -sS \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${THEMIS_PLATFORM_TOKEN}" \
  -d '{"ownerPrincipalId":"principal-owner"}' \
  http://127.0.0.1:3100/api/platform/nodes/list
```

## 4. 先看列表，再看详情

列所有节点：

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${THEMIS_PLATFORM_TOKEN}" \
  -d '{"ownerPrincipalId":"principal-owner"}' \
  http://127.0.0.1:3100/api/platform/nodes/list
```

优先看这些字段：

- `displayName`
- `status`
- `slotCapacity`
- `slotAvailable`
- `lastHeartbeatAt`
- `heartbeatTtlSeconds`
- `workspaceCapabilities`
- `credentialCapabilities`
- `providerCapabilities`

判断要点：

- `status=online` 且 `slotAvailable>0`：节点当前可继续接新任务
- `status=online` 且 `slotAvailable=0`：节点可能忙、满槽，或者实现上故意不再宣告空闲
- `status=draining`：不再接新任务，但老 lease 可能还在跑
- `status=offline`：已经退出调度面；如果还有活动 lease，再看 detail 或直接决定是否 `reclaim`

查单节点详情：

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${THEMIS_PLATFORM_TOKEN}" \
  -d '{"ownerPrincipalId":"principal-owner","nodeId":"node-xxxx"}' \
  http://127.0.0.1:3100/api/platform/nodes/detail
```

详情重点看：

- `leaseSummary.activeCount`
- `leaseSummary.revokedCount`
- `activeExecutionLeases`
- `recentExecutionLeases`
- 每条 lease 对应的 `run / work_item / targetAgent`

如果列表里只看到“节点不对劲”，但不知道它卡在哪，优先转去看 detail，不要只盯列表。

## 5. 什么时候用 drain / offline / reclaim

### `drain`

适用场景：

- 你准备维护节点，但想让它先别接新任务
- 你希望老任务自然跑完，再停机

CLI：

```bash
./themis worker-fleet drain \
  --platform http://127.0.0.1:3100 \
  --owner-principal principal-owner \
  --token <platformToken> \
  --node node-xxxx \
  --yes
```

### `offline`

适用场景：

- 节点确定要下线
- 节点已经停了，想先把调度面状态显式打成 `offline`

CLI：

```bash
./themis worker-fleet offline \
  --platform http://127.0.0.1:3100 \
  --owner-principal principal-owner \
  --token <platformToken> \
  --node node-xxxx \
  --yes
```

当前语义：

- 会把 `status` 落成 `offline`
- 会把 `slotAvailable` 归零
- 不会主动回收现有活动 lease

### `reclaim`

适用场景：

- 节点已经 `offline`
- 你不想等下一轮 scheduler tick 自动恢复
- 你要立刻把失联节点上的活动 lease 收口

CLI：

```bash
./themis worker-fleet reclaim \
  --platform http://127.0.0.1:3100 \
  --owner-principal principal-owner \
  --token <platformToken> \
  --node node-xxxx \
  --yes
```

当前语义：

- 只允许对 `offline` 节点执行
- 活动 `execution_lease` 会收口成 `revoked`
- 运行中的 `work item` 会重新排回 `queued`
- `waiting_human / waiting_agent` 会保留等待态，只回收 lease

如果只是想“让节点不要再接新任务”，用 `drain` 或 `offline`；如果是“这台节点已经死了，我现在就要把租约收回来”，才用 `reclaim`。

如果你确实需要直接看原始平台接口，就沿用上面的 Bearer 令牌，再手工调用 `nodes/drain|offline|reclaim`。

## 6. 常见排障场景

### 6.1 服务是 `inactive` 或频繁重启

先看：

- `systemctl --user status themis-worker-node.service`
- `journalctl --user -u themis-worker-node.service -n 100 --no-pager`

常见原因：

- `WorkingDirectory` 写错
- `ExecStart` 路径写错
- 本机 `node / npm / themis` 路径在 `systemd --user` 下不可见
- 平台地址或 token 配错，启动后立刻失败

### 6.2 预检能过，但平台看不到在线节点

优先检查：

- `journalctl` 里有没有平台登录失败或心跳失败
- `status` 里服务是不是刚起就退出
- `nodes/list` 里是不是已经出现旧 `nodeId`，但状态被 TTL 收敛成 `offline`

如果只是历史残留节点，并且同时满足：

- `status=offline`
- `nodes/detail.leaseSummary.totalCount=0`

现在可以直接在平台节点页执行 `Delete` 删除这条旧记录；只要还有任何 lease 记录，就不要删，继续保留给值班回看。

### 6.3 节点在线，但始终拉不到任务

优先检查：

- `workspaceCapabilities`
- `credentialCapabilities`
- `providerCapabilities`
- 节点是否被打成 `draining`
- `slotAvailable` 是否长期为 `0`

这类问题大多不是“调度坏了”，而是 capability 不匹配或节点本来就不该再接新任务。

### 6.4 节点掉线后任务看起来卡住

先看 detail：

- `leaseSummary.activeCount` 是否仍大于 `0`
- `activeExecutionLeases` 里 run / work item 当前是什么状态

再判断：

- 如果节点只是刚掉线，scheduler tick 往往会在后续自动回收
- 如果你需要立即恢复，再手动 `offline + reclaim`

### 6.5 多节点里某一台总被命中，另一台几乎不吃任务

优先检查：

- 两台机器的 capability 是否真的一致
- 某台是不是一直 `slotAvailable=0`
- 某台是不是被打成 `draining`
- waiting 恢复是不是持续回原节点，导致看起来分配不均

当前实现本来就会保留 waiting 的节点亲和性，所以“不是平均分配”不一定是 bug。

## 7. 多节点值守约定

如果要长期值守多台节点，建议固定这些约定：

- 每台节点一个独立 clone 目录，例如 `~/services/themis-worker-node-a`
- 每台节点一个独立 `systemd --user` 服务名，例如 `themis-worker-node-a.service`
- 每台节点一个稳定 display name，例如 `worker-node-a`
- capability 声明只写真实可用的 `workspace / credential / provider`
- 共享同一平台前，先固定 owner principal，不要值守时临时切不同 owner

如果同一台物理机上跑多条 `Worker Node`，更要避免：

- 共用同一个节点目录
- 共用同一个 `infra/local/`
- 把不同职责节点写成相同的 `displayName`

## 8. 交接最少要留什么

至少留下：

- 平台地址
- owner principal
- 节点服务名
- 节点目录
- 当前节点 `nodeId`
- 当前节点 `status / slotAvailable`
- 最近一次 `doctor worker-node` 结果
- 是否已经执行过 `drain / offline / reclaim`

## 相关文档

- [Themis 双节点长跑与故障演练验收](./archive/themis-dual-node-drill-acceptance.md)
- [Themis Worker Node 常驻部署说明](./themis-worker-node-systemd-service.md)
- [Themis 值班接手总览](./themis-operator-onboarding.md)
- [Themis worker-fleet 已提供平台侧 drain / offline / reclaim 批量治理入口](../memory/2026/04/themis-worker-fleet-governance-cli.md)
- [Themis Worker Node 启动前应先跑 doctor worker-node 预检](../memory/2026/04/themis-worker-node-preflight-diagnostics.md)
- [Themis 平台节点已具备显式治理动作和带租约上下文的 detail 视图](../memory/2026/04/themis-platform-node-governance-actions-and-detail-view.md)
- [Themis 平台节点会在读路径与调度路径上按心跳 TTL 自动收敛为 offline，并自动回收失联节点 lease](../memory/2026/04/themis-platform-node-heartbeat-ttl-offline-reconciliation.md)
