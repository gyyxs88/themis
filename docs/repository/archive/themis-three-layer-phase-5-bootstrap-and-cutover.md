# Themis 三层拆仓 Phase 5：新仓初始化与迁移切换演练

## 目标

在真正搬代码前，先把四个独立仓的最小骨架、CI 约束、发布边界和切换演练清单固定下来，避免拆仓时一边搬代码一边临时发明目录、脚本和门槛。

本阶段只做三件事：

1. 初始化四个 sibling repo 骨架
2. 固定每个仓的最小 CI / 发布 / 回归门槛
3. 先跑一次本地切换演练，确认后续迁移顺序可执行

## 本机初始化

当前仓库已提供本地 bootstrap 脚本：

```bash
bash scripts/bootstrap-split-repos.sh ..
```

默认会在当前仓库同级目录下生成：

- `../themis-platform`
- `../themis-main`
- `../themis-worker-node`
- `../themis-contracts`

脚本行为固定为：

- 目标目录不存在时自动创建
- 目标目录存在但为空时继续初始化
- 目标目录非空时直接拒绝覆盖
- 每个新仓都会自动 `git init`
- 每个新仓都会写入最小 `README.md`、`.gitignore`、`package.json`、`tsconfig.json`、入口占位文件和 `.github/workflows/ci.yml`

## 四个仓的最小骨架

### 1. `themis-platform`

- 入口占位：`src/server/platform-main.ts`
- 最小 scripts：`typecheck`、`build`、`dev:platform`、`start:platform`
- 后续第一批迁入对象：
  - `apps/platform/`
  - `src/server/http-platform.ts`
  - 平台 surface / 平台 CLI / 节点治理能力

### 2. `themis-main`

- 入口占位：`src/server/main.ts`
- 最小 scripts：`typecheck`、`build`、`dev:web`、`start:web`
- 后续第一批迁入对象：
  - 主 Themis Web / 飞书入口
  - 历史、身份、会话、运行参数
  - 收缩后的 `http-agents` gateway 语义

### 3. `themis-worker-node`

- 入口占位：`src/cli/worker-node-main.ts`
- 最小 scripts：`typecheck`、`build`、`themis:worker-node`
- 后续第一批迁入对象：
  - Worker daemon
  - `doctor worker-node`
  - 本机工作区 / credential / provider 能力声明

### 4. `themis-contracts`

- 入口占位：`src/index.ts`
- 最小 scripts：`typecheck`、`build`
- 后续第一批迁入对象：
  - `src/contracts/managed-agent-platform-worker.ts`
  - `src/contracts/managed-agent-platform-projects.ts`
  - `src/contracts/managed-agent-platform-work-items.ts`
  - `src/contracts/managed-agent-platform-collaboration.ts`
  - `src/contracts/managed-agent-platform-agents.ts`
  - `src/contracts/managed-agent-platform-access.ts`

## 最小门槛

### CI 门槛

每个新仓最小 CI 都必须至少执行：

```bash
npm install
npm run typecheck
npm run build
```

当前 bootstrap 脚本生成的 `.github/workflows/ci.yml` 已固定这三步。

### 发布门槛

- `themis-platform`、`themis-main`、`themis-worker-node` 必须各自独立发布，不再共用当前单仓 build 产物
- `themis-contracts` 应作为显式契约包或独立导出产物发布
- 三层之间只允许通过显式 contracts / generated client 联调，不允许直接引用对方业务源码

### 回归门槛

- `themis-platform`：至少覆盖 `/api/platform/*`、平台 Bearer 鉴权、平台页面静态壳
- `themis-main`：至少覆盖主 Themis 自己的 Web / 飞书 / runtime / history 主链
- `themis-worker-node`：至少覆盖 `register -> heartbeat -> pull -> execute -> report` 主链
- `themis-contracts`：至少覆盖 DTO、鉴权头、平台专用错误码和 package exports

## 切换演练清单

正式迁移前，先按下面顺序做一次本地 rehearsal：

1. 运行 `bash scripts/bootstrap-split-repos.sh ..`，确认四个 sibling repo 成功生成
2. 确认再次运行时会因为非空目录而 fail-fast，不会覆盖已有骨架
3. 逐仓确认最小入口、CI workflow、package scripts 是否齐备
4. 在当前单仓里把拟迁模块按四类重新点名，避免搬运时临时判断归属
5. 先迁 `themis-contracts`，再迁 `themis-platform`，最后再收 `themis-main` / `themis-worker-node`
6. 每迁一段都要求当前仓和目标仓都能独立 `typecheck + build`
7. 真正切仓前，先确认平台机、主 Themis、Worker 节点的部署目录和发布入口都能对应到新仓名

## 当前结论

- `Phase 4` 的显式契约抽取已经把 DTO、鉴权头和平台专用错误码收成首轮完整契约面
- `Phase 5` 现在不再缺“从哪开始拆”的入口，当前已经有脚本、最小骨架和切换演练清单
- 下一步应优先把 `themis-contracts` 真正从当前仓导出，再开始分批迁移平台层源码
