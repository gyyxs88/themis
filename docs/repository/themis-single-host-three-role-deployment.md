# Themis 单机三角色部署总览

## 目标

在同一台主机上先把下面三层角色跑通：

1. 平台层
2. 主 Themis
3. Worker Node

这篇文档只负责回答“单机形态应该长什么样”。具体安装、`systemd`、值守和回退步骤，不再在这里重复展开。

## 当前结论

- 单机部署不等于单进程，也不等于单目录。
- 即使三层在同一台机器，也仍然应该是三条独立 `systemd --user` 服务。
- 当前真实仓库边界已经是：
  - `themis`：主 Themis
  - `themis-platform`：平台控制面
  - `themis-worker-node`：Worker Node
  - `themis-contracts`：共享契约
- 不要再按旧口径直接 clone `themis.git` 来起平台层或 Worker。

## 推荐拓扑

```text
MySQL                 127.0.0.1:3306
平台层                127.0.0.1:3200
主 Themis Web         0.0.0.0:3100
Worker Node           不开端口，主动连接平台层
```

推荐目录：

```text
~/services/themis-contracts
~/services/themis-platform
~/services/themis-prod
~/services/themis-worker-node
```

推荐服务名：

```text
themis-platform.service
themis-prod.service
themis-worker-node.service
```

## 为什么同机也要拆开

至少要分开这些运行态：

- 主 Themis 的 `infra/local/`
- 平台层的 `infra/local/` 与 `infra/platform/`
- Worker 的 `infra/local/`

否则很容易出现：

- SQLite 运行态互相污染
- 升级或回退误伤别的角色
- Worker capability 和主 Themis 本地状态混在一起

## 最小依赖关系

### 平台层

- 仓库：`~/services/themis-platform`
- sibling 契约仓：`~/services/themis-contracts`
- 关键配置：
  - `THEMIS_HOST=127.0.0.1` 或 `0.0.0.0`
  - `THEMIS_PORT=3200`
  - `THEMIS_UPDATE_SYSTEMD_SERVICE=themis-platform.service`
  - `THEMIS_PLATFORM_CONTROL_PLANE_DRIVER=mysql`
  - `THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE=infra/platform/control-plane.db`

### 主 Themis

- 仓库：`~/services/themis-prod`
- 关键配置：
  - `THEMIS_HOST=0.0.0.0`
  - `THEMIS_PORT=3100`
  - `THEMIS_UPDATE_SYSTEMD_SERVICE=themis-prod.service`
  - `THEMIS_PLATFORM_BASE_URL=http://127.0.0.1:3200`
  - `THEMIS_PLATFORM_OWNER_PRINCIPAL_ID=<principalId>`
  - `THEMIS_PLATFORM_WEB_ACCESS_TOKEN=<gatewayToken>`

### Worker Node

- 仓库：`~/services/themis-worker-node`
- sibling 契约仓：`~/services/themis-contracts`
- 关键配置：
  - `--platform http://127.0.0.1:3200`
  - `--owner-principal <principalId>`
  - `--token <workerToken>`
  - `--name worker-node-local`
  - `--node-id node-worker-local`
  - `--workspace /home/you/services/themis-worker-node`
  - `--credential default`

## 启动顺序

推荐固定为：

1. `themis-platform.service`
2. `themis-prod.service`
3. `themis-worker-node.service`

原因很简单：

- 主 Themis 和 Worker 都依赖平台层
- 平台层没起来时，后两者的报错会更像“误报”

## 最小验收

至少确认下面三件事：

### 1. 平台层正常响应

```bash
curl -sS -X POST http://127.0.0.1:3200/api/platform/agents/list \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <gatewayToken>' \
  --data '{"ownerPrincipalId":"<principalId>"}'
```

### 2. 主 Themis 走的是平台 facts

- 打开 `http://<host>:3100/login`
- 登录后确认主 Themis 的平台读面正常
- 不要再把它当成本地控制面

### 3. Worker 已注册成可治理节点

```bash
curl -sS -X POST http://127.0.0.1:3200/api/platform/nodes/list \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <workerToken>' \
  --data '{"ownerPrincipalId":"<principalId>"}'
```

至少要看到：

- 节点在线
- 节点 capability 正确
- 主 Themis 派出的任务能被本机 Worker claim

## 不要这样做

- 不要把三层放进同一个目录。
- 不要直接 clone `themis.git` 当平台层或 Worker。
- 不要默认把 `~/services/themis-prod` 直接作为 Worker 工作区。
- 不要省掉固定 `--node-id`，否则平台里会不断留下新的 offline 节点记录。

## 详细操作文档

- [平台层 systemd 服务说明](./themis-platform-systemd-service.md)
- [正式版 systemd 用户服务说明](./themis-systemd-prod-service.md)
- [Worker Node 常驻部署说明](./themis-worker-node-systemd-service.md)
- [Worker Node 运维手册](./themis-worker-node-operations-runbook.md)
- [值班接手总览](./themis-operator-onboarding.md)
