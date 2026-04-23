# Themis 值班接手总览

## 适用对象

- 新加入 Themis 维护的同学
- 临时接手值班或排障的同学
- 需要快速知道“先看哪篇文档”的协作者

## 这篇文档负责什么

- 只负责接手顺序、阅读入口和最小上手路径。
- 不重复发布验收矩阵里的逐项通过标准。
- 不重复灰度与回退文档里的放量/止血步骤。

## 第一天要读什么

1. [README.md](../../README.md)
2. [docs/README.md](../README.md)
3. [themis-persistent-agent-architecture.md](../product/themis-persistent-agent-architecture.md)
4. [themis-feishu-channel.md](../feishu/themis-feishu-channel.md)
5. [docs/repository/README.md](./README.md)

如果你在内部开发仓接手，再补读 `memory/project/codex-alignment.md`。

## 按角色怎么读

### 只接发布

1. 先读 [themis-release-acceptance-matrix.md](./themis-release-acceptance-matrix.md)
2. 再读 [themis-release-rollout-and-rollback.md](./themis-release-rollout-and-rollback.md)
3. 如果是正式机升级，再补 [themis-systemd-prod-service.md](./themis-systemd-prod-service.md)

### 只接日常值班

1. 先跑 `./themis doctor`
2. 再读 [themis-feishu-channel.md](../feishu/themis-feishu-channel.md)
3. 需要排节点时，再读 [themis-worker-node-operations-runbook.md](./themis-worker-node-operations-runbook.md)

### 接手局域网执行节点

1. 先读 [themis-worker-node-systemd-service.md](./themis-worker-node-systemd-service.md)
2. 再读 [themis-worker-node-operations-runbook.md](./themis-worker-node-operations-runbook.md)
3. 如果还要看历史联调背景，再去 `docs/repository/archive/`

## 先建立名词心智

- Themis 当前“数字员工”能力不是 Codex 原生能力，而是 Themis 在 `codex app-server` 外补出的长期主体和治理层。
- `actor` 是较轻的内部协作 / 记忆模型，主要服务 task scope、timeline / takeover 和长期记忆候选。
- `managed_agent` 才是 Web `Agents` 面板里真正被创建、派工、暂停 / 恢复 / 归档和治理的长期数字员工。
- 如果值班时看到 `actor` 和 `managed_agent` 混在一起，先按上面这层级拆开，不要把它们当同一个东西。

## 第一天要会的命令

```bash
./themis status
./themis doctor
./themis doctor feishu
./themis doctor smoke web
./themis doctor smoke feishu
```

如果你要接手节点值班，再补：

```bash
./themis doctor worker-fleet
./themis doctor worker-fleet --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken> --json --fail-on warning
./themis worker-fleet reclaim --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken> --node <nodeId> --yes
./themis backup create
```

## 最小上手路径

### Web

1. 启动服务后登录 Web。
2. 新建会话，发一条普通任务。
3. 看懂 waiting action、history/detail 和诊断入口。

### 飞书

1. 确认机器人配置、权限和事件都已经发布。
2. 先跑 `./themis doctor feishu`。
3. 再跑 `./themis doctor smoke feishu`，然后按手工 A/B 文档接力。

## 值班时的固定顺序

1. 先看 `./themis doctor`
2. 再看 `./themis doctor feishu`
3. 再跑 `./themis doctor smoke web`
4. 最后跑 `./themis doctor smoke feishu`

不要一上来就猜飞书平台有问题，也不要跳过 Web smoke。

## 常见判断

- Web smoke 先挂：优先按共享 runtime / app-server 主链路排。
- 飞书前置检查挂：先看配置、服务可达性和当前 pending action。
- 群聊行为异常：先确认是不是 `smart / always` 路由或 `personal / shared` 会话策略引起。
- 多节点平台值守：先看 `doctor worker-fleet --json --fail-on warning` 的退出码，再下钻单节点。
- 这里的 `platformWorkerToken` 仍是 `worker` 角色的平台服务令牌，主要给 `worker-node run`、节点自报和 `/api/platform/worker/*` 用；主 Themis 自己的 `platform-gateway` 令牌现在已经可以直接看管 `nodes/*`，但不负责节点运行态上报。

## 交接最少要留什么

- 当前 commit hash
- 最近一次 `./themis doctor release` 结果
- 当前是否在小范围灰度
- 是否存在已知阻塞或临时回退策略
