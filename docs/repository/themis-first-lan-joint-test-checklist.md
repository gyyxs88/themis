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

- 按 [平台层切 MySQL 操作说明](./themis-platform-mysql-control-plane-cutover.md) 准备好 `.env.local`
- 按 [平台层 systemd 用户服务说明](./themis-platform-systemd-service.md) 准备好常驻模板

### 主 Themis

- 按 [正式版 systemd 用户服务说明](./themis-systemd-prod-service.md) 准备独立目录
- `.env.local` 里补：

```bash
THEMIS_PLATFORM_BASE_URL=http://<platform-host>:3100
THEMIS_PLATFORM_OWNER_PRINCIPAL_ID=<principalId>
THEMIS_PLATFORM_WEB_ACCESS_TOKEN=<platformToken>
```

### Worker Node

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
- `curl http://127.0.0.1:3100/api/health` 正常返回

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
- `/api/agents/*` 创建、列表、派工都能走通

## 3. 起第一个 Worker

在 `W1` 上先跑一次预检：

```bash
./themis doctor worker-node \
  --platform http://<platform-host>:3100 \
  --owner-principal <principalId> \
  --token <platformToken> \
  --workspace <workspace-path> \
  --credential default
```

再跑一次单次启动：

```bash
./themis worker-node run \
  --platform http://<platform-host>:3100 \
  --owner-principal <principalId> \
  --token <platformToken> \
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
./themis worker-fleet reclaim \
  --platform http://<platform-host>:3100 \
  --owner-principal <principalId> \
  --token <platformToken> \
  --node <nodeId-of-w1> \
  --yes
```

确认：

- 平台 lease 被回收
- 后续可接管任务能被 `W2` 接住
- `sticky` 项目如果没有可接受的新节点，不会偷偷乱漂

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
- 平台重启后控制面事实不丢

## 8. 如果联调失败，优先记录这几类信息

- 平台层启动日志
- 主 Themis 启动日志
- Worker Node `doctor worker-node` 输出
- `nodes/detail`
- `runs/detail`
- `work-items/detail`
- 是否命中了正确的 `projectId / workspace binding / preferred node`

这轮联调里，最关键的不是 UI，而是：

- 平台控制面事实有没有稳定进 MySQL
- 主 Themis 有没有真的走平台
- 节点调度、waiting/resume、项目连续性有没有保持原语义
