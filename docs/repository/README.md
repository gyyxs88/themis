# 仓库运维文档索引

## 服务安装

- 主 Themis 正式机：[正式版部署说明](./themis-systemd-prod-service.md)
- 平台控制面：[平台层 systemd 服务说明](./themis-platform-systemd-service.md)
- Worker Node：[Worker Node 常驻部署说明](./themis-worker-node-systemd-service.md)
- 单机把三层先跑通：[单机三角色部署总览](./themis-single-host-three-role-deployment.md)

## 日常值守

- 接手值班先读：[值班接手总览](./themis-operator-onboarding.md)
- 平台监控与恢复：[平台层监控、告警、备份与恢复手册](./themis-platform-monitoring-and-backup-runbook.md)
- 节点巡检与排障：[Worker Node 运维手册](./themis-worker-node-operations-runbook.md)

## 发布升级

- 发布前验收：[发布验收矩阵](./themis-release-acceptance-matrix.md)
- 灰度与回退：[发布、灰度与回退说明](./themis-release-rollout-and-rollback.md)
- 公开发布边界：[公开发布边界与导出规则](./github-safe-publish.md)

## 专题文档

- [平台层切 MySQL 操作说明](./themis-platform-mysql-control-plane-cutover.md)
- [开发模式 systemd 说明](./themis-systemd-dev-service.md)

## 阅读规则

- 要装服务，看 `systemd *service` 这组文档。
- 要值班排障，看 `*runbook.md` 和 `themis-operator-onboarding.md`。
- 要发布，先看 `themis-release-acceptance-matrix.md`，再看 `themis-release-rollout-and-rollback.md`。
- 要找历史过程，不要在现役文档里翻，直接去 `archive/`。

## 历史归档

- 阶段性联调、拆仓和历史验收文档统一见 [archive/README.md](./archive/README.md)

## 额外说明

- `themis-platform` 和 `themis-worker-node` 已拆到独立仓；这里保留的是主仓镜像或背景文档。
- 需要改真实 `systemd` 模板或按独立仓当前实现操作时，以对应独立仓文档为准。
