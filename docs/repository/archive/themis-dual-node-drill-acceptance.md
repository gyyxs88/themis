# Themis 双节点长跑与故障演练验收

## 目标

把多节点平台第 4 条差口“双节点实机长跑与故障演练验收”固定成可重复执行的仓库验收，而不是继续停留在口头判断。

这份验收文档默认建立在下面前提已经成立的基础上：

- 平台服务与 `Worker Node daemon` 已可正常运行
- 平台 Bearer 令牌边界已经切到 `platform_service`
- `doctor worker-fleet`、`worker-fleet offline|reclaim`、`ManagedAgentWorkerDaemon` 都已可用

## 1. 当前仓库已固定的自动化验收

最小自动化验收命令：

```bash
node --test --import tsx src/core/managed-agent-worker-daemon.test.ts
```

当前这组测试已经固定验证下面几件事：

- 两个独立 `Worker runtime` 会通过真实 `/api/platform/*` HTTP 链路注册成两个节点
- 两个节点都能正常心跳、拉取分配给自己的 `run` 并完成结果回传
- 两条任务会在两个节点之间分摊，而不是只落到单一节点
- 某个节点被显式打成 `offline` 并执行 `reclaim` 后，平台会把相关 `work item` 重新排回 `queued`
- 被回收的任务会由另一台仍在线的节点接管并最终收口成 `completed`

## 2. 当前验收刻意固定的约束

为了让双节点验收稳定且贴近真实平台约束，当前仓库固定了这几个前提：

- 两条并行任务要派给两个不同的执行 agent
- 两个节点都要声明能访问同一份工作区 capability
- 两个节点都要声明同一份 credential capability

其中第一条很重要：

- 同一个目标 agent 不能同时存在两条活跃 `run`
- 所以双节点并行验收不要把两条任务都派给同一个执行 agent，否则第二条任务不会进入并行执行

## 3. 值守侧建议复验顺序

如果要在真实局域网环境复验，建议固定按这个顺序排：

1. 先用 `./themis doctor worker-fleet --json --fail-on warning` 确认两台节点都在线
2. 再确认两台节点的 `workspace / credential / provider` capability 一致且真实可用
3. 用主 Themis 或平台入口给两个不同的执行 agent 各派一条任务
4. 确认两台节点都各自吃到一条任务，而不是只有单节点持续满槽
5. 选中其中一台节点执行 `offline`
6. 紧接着执行 `reclaim`
7. 确认被回收的任务重新进入可调度状态，并由另一台在线节点接管完成

## 4. 当前验收结论

截至 `2026-04-12`，仓库已经把下面这条结论固定成可复跑事实：

- Themis 局域网多节点平台已经具备“两个 Worker Node 分摊派工 + 单节点离线后由另一节点接管恢复”的最小可运维能力

但当前结论仍然只覆盖局域网 V1：

- 不包含公网节点
- 不包含跨节点热迁移会话
- 不包含自动工作区同步
- 不把复杂负载均衡和高可用扩面当默认前提

## 相关文档

- [Themis Worker Node 巡检、排障与多节点值守手册](../themis-worker-node-operations-runbook.md)
- [Themis 多节点平台监控、告警、备份与恢复手册](../themis-platform-monitoring-and-backup-runbook.md)
- [Themis Worker Node 常驻部署说明](../themis-worker-node-systemd-service.md)
