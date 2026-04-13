# Themis 单机三角色部署方案

## 目标

把下面三层角色收在同一台主机上：

1. 平台层  
   独立控制面 + MySQL shared control plane
2. 主 Themis 层  
   负责对话、组织管理、派工与必要时自执行
3. Worker Node 层  
   把同一台机器同时注册成一个可治理的执行节点

这适合：

- 小公司
- 个人部署
- 第一阶段先把整套链路跑通

这里的关键不是“必须三台机器”，而是“必须三个独立角色”。
单机部署时，也仍然建议拆成三条 `systemd --user` 服务，而不是混成一个进程。

## 推荐拓扑

同一台机器上，推荐这样放：

```text
MySQL                 127.0.0.1:3306
平台层                127.0.0.1:3200
主 Themis Web         0.0.0.0:3100
Worker Node           不开端口，主动连平台层
```

推荐目录：

```text
~/services/themis-platform
~/services/themis-prod
~/services/themis-worker-node
```

其中 `~/services/themis-worker-node` 建议是独立 clone，不要一上来就把 `~/services/themis-prod` 直接暴露给同机 Worker。
主 Themis 目录优先继续只承载人类入口、平台网关和主 Agent 自身运行态；Worker 需要可治理节点身份时，再给它单独工作区。

推荐服务名：

```text
themis-platform.service
themis-prod.service
themis-worker-node.service
```

这套端口安排的目的很简单：

- 浏览器、飞书、人类入口只碰主 Themis `3100`
- 平台层只给本机 `Themis / Worker` 调用，先收在 `127.0.0.1:3200`
- Worker 不暴露入口，只负责 `register -> heartbeat -> pull -> execute -> report`

## 为什么同机也要拆目录

就算三者在同一台主机，也不要共用一个目录。

至少要分开这三类运行态：

- 主 Themis 的 `infra/local/`
- 平台层的 `infra/local/` 与 `infra/platform/`
- Worker 的 `infra/local/`

否则很容易出现：

- SQLite 运行态互相污染
- `systemd` 升级/回滚误伤别的角色
- Worker capability 和主 Themis 本地状态混在一起

## 1. 起平台层

目录：

```bash
mkdir -p ~/services
git clone git@github.com:gyyxs88/themis.git ~/services/themis-platform
cd ~/services/themis-platform
npm ci
npm run build
```

`.env.local` 最小建议：

```bash
THEMIS_HOST=127.0.0.1
THEMIS_PORT=3200
THEMIS_UPDATE_SYSTEMD_SERVICE=themis-platform.service

THEMIS_PLATFORM_CONTROL_PLANE_DRIVER=mysql
THEMIS_PLATFORM_MYSQL_URI=mysql://user:password@127.0.0.1:3306/themis_platform
THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE=infra/platform/control-plane.db
```

如果你确认以后还会接别的局域网 Worker，再把 `THEMIS_HOST` 改成 `0.0.0.0`。

平台层常驻说明见：
- [Themis 平台层 systemd 用户服务说明](./themis-platform-systemd-service.md)

## 2. 起主 Themis

目录：

```bash
git clone git@github.com:gyyxs88/themis.git ~/services/themis-prod
cd ~/services/themis-prod
npm ci
npm run build
```

`.env.local` 最小建议：

```bash
THEMIS_HOST=0.0.0.0
THEMIS_PORT=3100
THEMIS_UPDATE_SYSTEMD_SERVICE=themis-prod.service

THEMIS_PLATFORM_BASE_URL=http://127.0.0.1:3200
THEMIS_PLATFORM_OWNER_PRINCIPAL_ID=<principalId>
THEMIS_PLATFORM_WEB_ACCESS_TOKEN=<gatewayToken>
```

这里主 Themis 虽然和平台层同机，但仍然应该走 `http://127.0.0.1:3200/api/platform/*`，不要再回退本地控制面。

主 Themis 常驻说明见：
- [Themis 正式版 systemd 用户服务说明](./themis-systemd-prod-service.md)

## 3. 起 Worker Node

目录：

```bash
git clone git@github.com:gyyxs88/themis.git ~/services/themis-worker-node
cd ~/services/themis-worker-node
npm ci
npm run build
```

推荐先跑一次预检：

```bash
./themis doctor worker-node \
  --platform http://127.0.0.1:3200 \
  --owner-principal <principalId> \
  --token <workerToken> \
  --workspace /home/you/services/themis-worker-node \
  --credential default
```

`systemd` 常驻时，最小配置建议等价于：

```bash
./themis worker-node run \
  --platform http://127.0.0.1:3200 \
  --owner-principal <principalId> \
  --token <workerToken> \
  --name worker-node-local \
  --node-id node-worker-local \
  --workspace /home/you/services/themis-worker-node \
  --credential default
```

几点建议：

- `--node-id` 一定固定
- 同机部署第一阶段，优先把 `--workspace` 指向独立的 `~/services/themis-worker-node`
- 不建议默认把 `~/services/themis-prod` 直接加进 Worker `--workspace`；只有确认主 Themis 目录也应该被节点化执行时，再显式追加
- `--workspace` 可以配多次，不必只指向 Worker 自己目录
- 小型部署可以先复用同一用户的默认 `~/.codex`
- 如果以后想更强隔离，再拆专用 credential 或专用 `CODEX_HOME`

Worker 常驻说明见：
- [Themis Worker Node 常驻部署说明](./themis-worker-node-systemd-service.md)

## 4. 启动顺序

推荐固定顺序：

1. `themis-platform.service`
2. `themis-prod.service`
3. `themis-worker-node.service`

原因是：

- Worker 要先连平台
- 主 Themis 也要先连平台
- 平台层没起来时，后两者都容易误判

## 5. 最小验收

平台层：

```bash
curl -sS -X POST http://127.0.0.1:3200/api/platform/agents/list \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <gatewayToken>' \
  --data '{"ownerPrincipalId":"<principalId>"}'
```

主 Themis：

- 打开 `http://<host>:3100/login`
- 登录后确认 `/api/agents/list` 返回平台 facts

Worker：

```bash
curl -sS -X POST http://127.0.0.1:3200/api/platform/nodes/list \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <workerToken>' \
  --data '{"ownerPrincipalId":"<principalId>"}'
```

至少要看到：

- 节点在线
- 节点 `workspaceCapabilities` 正确
- 主 Themis 新派的任务能被本机 Worker claim

实机参考：`2026-04-13` 已在 `192.168.31.208` 上验证“主 Themis + 同机 Worker”闭环成立，Worker 以独立目录 `/home/abner/services/themis-worker-node` 运行，真实任务 `work-item-gqyz0ldv` 已由同机节点 claim 成 `run-nqslkfzs` 并完成。

## 6. 这个形态下，主 Themis 还会不会自己执行

会。

这点不要搞反：

- 主 Themis 本来就是组织级主 Agent，本来就保留自执行能力
- 同机再跑一个 Worker，不是为了“剥夺主 Themis 的执行能力”
- 而是为了让这台机器同时具备“平台可治理节点”的身份，能被 lease、drain、reclaim、sticky continuity 这些机制纳入统一治理

所以单机三角色不是冲突关系，而是：

- 主 Themis 继续是主 Agent
- Worker 继续是节点化执行面
- 平台层继续是控制面

## 7. 后续怎么扩容

如果这套单机版先跑通了，后续扩容最自然：

- 平台层不动
- 主 Themis 不动
- 继续增加新的 Worker Node 机器

也就是说，单机三角色是完全可演进的起点，不是临时凑合方案。
