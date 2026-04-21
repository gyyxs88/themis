# Themis 首轮局域网联调清单

## 目标

在真实环境里把下面三层连成闭环：

1. 平台层  
   独立平台进程 + MySQL shared control plane
2. 主 Themis 层  
   通过 `/api/platform/*` 读写平台控制面
3. 数字员工层  
   1 到 2 台 Ubuntu Worker Node 承接执行

## 机器分工建议

- `P`：平台层机器  
  负责 `npm run start:platform`
- `T`：主 Themis 机器  
  负责 `npm run start:web`
- `W1`：第一个 Worker Node
- `W2`：第二个 Worker Node

如果资源紧张，`P` 和 MySQL 可以先放同一台机器；`T` 和 `W1` 也可以先同机，但第一轮最好至少保证有两台不同角色机器。

## 0. 联调前准备

### 平台层

- 机器上需要同时准备 sibling repo：`~/services/themis-contracts` 与 `~/services/themis-platform`；当前 `themis-platform/package.json` 仍通过 `file:../themis-contracts` 依赖共享契约
- 按 [平台层切 MySQL 操作说明](./themis-platform-mysql-control-plane-cutover.md) 准备好 `.env.local`
- 按 [平台层 systemd 用户服务说明](./themis-platform-systemd-service.md) 准备好常驻模板
- 如果平台机启用了 `ufw` 且默认拒绝入站，先放行 `3100/tcp` 给局域网
- 先确认 shared control plane 里已经存在后续 `gateway / worker` 会使用的 `ownerPrincipalId` 及默认组织；只发平台服务令牌还不够，否则 Worker 侧接口会报 `Owner principal not found.`

### 主 Themis

- 按 [正式版 systemd 用户服务说明](./themis-systemd-prod-service.md) 准备独立目录
- `.env.local` 里补：

```bash
THEMIS_PLATFORM_BASE_URL=http://<platform-host>:3100
THEMIS_PLATFORM_OWNER_PRINCIPAL_ID=<principalId>
THEMIS_PLATFORM_WEB_ACCESS_TOKEN=<platformGatewayToken>
```

说明：

- `platformGatewayToken` 当前供主 Themis 自己的 `/api/platform/agents|projects|work-items|runs` gateway 使用
- `platformWorkerToken` 当前供 `worker-node run`、`doctor worker-node`、`doctor worker-fleet`、`worker-fleet drain|offline|reclaim` 与 `nodes/*` 使用

### Worker Node

- 机器上需要同时准备 sibling repo：`~/services/themis-contracts` 与 `~/services/themis-worker-node`；当前 `themis-worker-node/package.json` 仍通过 `file:../themis-contracts` 依赖共享契约
- 按 [Worker Node 常驻部署说明](./themis-worker-node-systemd-service.md) 准备目录和账号材料
- 先确保每台节点各自的工作区路径真实存在

## 1. 起平台层

在 `P` 上：

```bash
cd ~/services/themis-platform
npm ci
npm run build
npm run start:platform
```

确认：

- 日志里出现 `Control plane driver mysql`
- 日志里出现 `Mirror bootstrap source ...`
- `curl http://127.0.0.1:3100/api/health` 至少能拿到 HTTP 响应；如果返回 `WEB_ACCESS_REQUIRED`，继续用 Bearer 令牌检查 `/api/platform/agents/list` 与 `/api/platform/nodes/list`

## 2. 起主 Themis

在 `T` 上：

```bash
cd ~/services/themis-prod
npm ci
npm run build
npm run start:web
```

确认：

- Web 页面能打开
- 主 Themis 能正常读平台 facts，而不是退回本地 SQLite
- `POST /api/agents/list` 继续稳定返回 `404 ROUTE_NOT_FOUND`
- 主 Themis 本地 `POST /api/platform/agents/list|work-items/list|projects/workspace-binding/list` 能读到平台真数据
- 主 Themis 本地 `POST /api/platform/work-items/dispatch` 能派工，随后可通过主 Themis 本地 `POST /api/platform/runs/list|detail` 回看到真实 run
- 主 Themis 本地 `POST /api/platform/nodes/list|detail|drain|offline|reclaim` 现在也属于 manager-side gateway 验收范围；节点运行态 `nodes/register|heartbeat` 与 `/api/platform/worker/*` 继续只归独立 `themis-platform` / `themis-worker-node`

## 3. 起第一个 Worker

在 `W1` 上先跑一次预检：

```bash
./themis-worker-node doctor worker-node \
  --platform http://<platform-host>:3100 \
  --owner-principal <principalId> \
  --token <platformWorkerToken> \
  --workspace <workspace-path> \
  --credential default
```

再跑一次单次启动：

```bash
./themis-worker-node worker-node run \
  --platform http://<platform-host>:3100 \
  --owner-principal <principalId> \
  --token <platformWorkerToken> \
  --name worker-node-a \
  --workspace <workspace-path> \
  --credential default \
  --once
```

确认：

- 节点成功注册
- 节点能 heartbeat
- 空闲时结果为 `idle`

## 4. 起第二个 Worker

在 `W2` 上重复和 `W1` 一样的预检与 `--once` 验证。

确认：

- `nodes/list` 能看到两台节点
- `nodes/detail` 里 capability 与本地实际一致

## 5. 第一轮业务联调

### 用一个真实项目做连续性验证

建议选一个明确项目，例如“官网”。

先在平台或主 Themis 里确认：

- 有对应长期员工
- 有 `ProjectWorkspaceBinding`
- 绑定了明确工作区
- `continuityMode=sticky`

### 验证一：首次派工

派一个简单任务，例如：

- “继续修改官网首页”

确认：

- 任务进入目标员工
- scheduler 能 claim
- 任务落到有对应工作区的节点
- run 能进入 `running` 或 `waiting_*`

### 验证二：同项目再次派工

再派一个同项目任务，例如：

- “继续完善官网导航”

确认：

- `projectId` 命中同一个项目绑定
- 优先回到同一节点 / 同一工作区语义
- 不会静默漂移到无关工作区
- 如果当前要做双节点共享工作区，这两台节点当前最稳妥的做法仍是声明同一个绝对路径；仅凭“内容看起来是同一个仓库”还不够

### 验证三：waiting / resume

制造一条需要人工响应的任务。

确认：

- 平台 waiting queue 能看到它
- 响应后 run 能恢复
- 恢复时优先回原节点

## 6. 故障联调

### 验证四：节点下线接管

让 `W1` 停掉，执行：

```bash
./themis-platform worker-fleet reclaim \
  --platform http://<platform-host>:3100 \
  --owner-principal <principalId> \
  --token <platformWorkerToken> \
  --node <nodeId-of-w1> \
  --yes
```

确认：

- 平台 lease 被回收
- 后续可接管任务能被 `W2` 接住
- `sticky` 项目如果没有可接受的新节点，不会偷偷乱漂
- `sticky` 项目在首选节点离线时应保持 `queued`，不能被平台层后台 tick 本机 claim 后直接执行

### 验证五：平台进程重启

重启平台层：

```bash
systemctl --user restart themis-platform.service
```

确认：

- 平台启动后仍显示 `Control plane driver mysql`
- mirror bootstrap 正常
- MySQL 里的组织、项目绑定、节点、work item、run 事实没有丢
- 主 Themis 与 Worker 能继续工作

## 7. 验收标准

首轮联调通过的最低标准是：

- 平台层独立启动成功
- 主 Themis 正常走平台控制面
- 至少 1 台 Worker 成功执行任务
- 至少 2 台 Worker 成功完成节点治理 / 接管验证
- 同一项目的再次派工能保住工作区连续性
- `sticky` 项目在首选节点离线时会继续排队，等首选节点恢复后再执行
- 平台重启后控制面事实不丢

## 8. 如果联调失败，优先记录这几类信息

- 平台层启动日志
- 主 Themis 启动日志
- Worker Node `doctor worker-node` 输出
- `nodes/detail`
- `runs/detail`
- `work-items/detail`
- 是否命中了正确的 `projectId / workspace binding / preferred node`
- 如果 `sticky` 项目在首选节点离线时直接 `failed`，先检查平台层是否误 claim 了没有匹配节点的 work item

这轮联调里，最关键的不是 UI，而是：

- 平台控制面事实有没有稳定进 MySQL
- 主 Themis 有没有真的走平台
- 节点调度、waiting/resume、项目连续性有没有保持原语义
