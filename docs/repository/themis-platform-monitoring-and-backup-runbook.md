# Themis 多节点平台监控、告警、备份与恢复手册

## 这篇文档负责什么

- 只负责平台侧监控、告警、备份和恢复。
- 不重复平台进程安装或 MySQL 切换步骤；那部分分别看 `themis-platform-systemd-service.md` 和 `themis-platform-mysql-control-plane-cutover.md`。
- 具体到单个 Worker 的日常巡检和治理动作，优先看 `themis-worker-node-operations-runbook.md`。

## 目标

把多节点平台第 3 条差口“监控、告警、备份与恢复方案”收成可执行的日常值守手册，而不是只停在路线图描述。

这份手册默认建立在下面前提已经成立的基础上：

- 平台服务与主 Themis 已正常运行
- `gateway / worker` 平台服务令牌已经配置完成
- `doctor worker-fleet`、`worker-fleet drain|offline|reclaim`、`backup create|restore` 都已可用

## 1. 监控探针

当前最小可执行的监控入口就是：

```bash
./themis doctor worker-fleet \
  --platform http://127.0.0.1:3100 \
  --owner-principal principal-owner \
  --token <platformWorkerToken> \
  --json \
  --fail-on warning
```

当前语义：

- `--json`：输出完整 JSON 摘要，适合旁路保存或接别的告警系统
- `--fail-on error`：只要出现 `error attention` 就返回非 `0`
- `--fail-on warning`：只要出现 `error` 或 `warning attention` 就返回非 `0`

推荐的默认值守策略：

- 日常巡检：`--fail-on warning`
- 如果你只想对硬故障报警：`--fail-on error`

## 2. 当前重点监控项

值班时优先盯这几类信号：

- `attention.errorCount`
- `attention.warningCount`
- `status.offline`
- `heartbeat.stale`
- `heartbeat.expired`
- 节点 detail 读取失败

当前最需要立即处理的典型场景：

- `offline_active_lease`
  - 节点已经 `offline`，但仍挂着 `active lease`
  - 一般需要确认节点是否真的停机，并决定是否立刻 `reclaim`
- `heartbeat_expired`
  - 节点心跳已超过 TTL，但还没稳定收口
  - 先查节点本机 `systemd --user` 和日志，再决定是否手动 `offline`
- `detail_failed`
  - 平台能列出节点，但读 detail 失败
  - 先查平台主进程日志、`worker` 角色平台服务令牌与网络

## 3. 推荐告警动作

收到告警后固定按这个顺序排：

1. 先跑一遍不带 `--json` 的 `./themis doctor worker-fleet`
2. 再去目标节点本机看 `systemctl --user status` 和 `journalctl`
3. 再跑 `./themis doctor worker-node`
4. 最后才决定是不是 `drain / offline / reclaim`

不要一看到 `offline active lease` 就直接 `reclaim`；先确认是不是节点短暂抖动、服务正在恢复。

## 4. 备份

当前平台 SQLite 备份命令：

```bash
./themis backup create
```

默认行为：

- 默认备份当前实例的 `infra/local/themis.db`
- 默认输出到 `infra/backups/`
- 输出会打印：
  - `sourcePath`
  - `outputPath`
  - `createdAt`
  - `sizeBytes`

如果你想把快照落到指定路径：

```bash
./themis backup create --output /path/to/themis-snapshot.db
```

## 5. 恢复

恢复前，先停掉主服务：

```bash
systemctl --user stop themis-prod.service
```

然后执行：

```bash
./themis backup restore \
  --input /path/to/themis-snapshot.db \
  --yes
```

当前恢复行为：

- 会先把当前目标库再备份一份到 `infra/backups/`
- 再把指定快照恢复到目标 SQLite
- 输出会打印：
  - `inputPath`
  - `targetPath`
  - `restoredAt`
  - `sizeBytes`
  - `previousBackupPath`

恢复后建议固定补两步：

```bash
systemctl --user start themis-prod.service
./themis doctor worker-fleet --platform http://127.0.0.1:3100 --owner-principal principal-owner --token <platformToken>
```

## 6. 恢复后的最小验收

恢复完成后，至少确认：

- `./themis doctor worker-fleet` 能正常读出节点列表
- `./themis doctor worker-node` 仍能读到平台
- 关键节点没有全部掉成 `offline`
- 若此前存在 `waiting_human / waiting_agent`，相关 work item 仍保留等待态，而不是消失

## 相关文档

- [Themis 双节点长跑与故障演练验收](./archive/themis-dual-node-drill-acceptance.md)
- [Themis Worker Node 巡检、排障与多节点值守手册](./themis-worker-node-operations-runbook.md)
- [Themis Worker Node 常驻部署说明](./themis-worker-node-systemd-service.md)
- [Themis 值班接手总览](./themis-operator-onboarding.md)
