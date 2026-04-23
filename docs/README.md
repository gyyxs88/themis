# 文档总索引

## 先看哪里

- 要找当前这套本地/LAN 环境的正式机、平台机、Worker 入口，先看本地专用文档 `docs/local/current-deployment.md`。
- 要找 `systemd`、发布、回退、runbook，先看 [仓库运维文档索引](./repository/README.md)。
- 要看飞书渠道现状、设计和验收入口，先看 [飞书接入总览](./feishu/README.md)。
- 要看产品和架构规划，先看 [产品规划文档索引](./product/README.md)。
- 要看长期可复用、已验证的专题结论，去 `docs/memory/YYYY/MM/`。

## 目录边界

- `docs/local/`
  - 当前这套本地/LAN 环境的机器入口、服务目录、SSH 方式和历史记录。
  - 当前有效入口和历史快照分开维护。
  - 本目录是本地工作区文件，不纳入版本控制。
- `docs/repository/`
  - 面向仓库使用、部署、升级、发布和运维的通用文档。
- `docs/feishu/`
  - 飞书渠道设计、当前行为、实施计划和手工验收入口。
- `docs/product/`
  - 产品和架构规划稿，不等于“当前代码已经做到哪里”。
- `docs/memory/`
  - 已验证、值得长期复用的专题记忆。

## 当前整理约定

- 当前有效入口优先维护在 `README.md`、本页、本地 `docs/local/current-deployment.md` 和 `docs/repository/README.md`。
- 带具体日期的本地部署/联调记录默认视为历史文档，统一放到 `docs/local/archive/`。
- 如果只是补某台机器的当前事实，优先更新 `docs/local/current-deployment.md`，不要再新增一份新的“总表”。
