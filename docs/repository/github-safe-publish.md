# GitHub 安全发布说明

## 目标

Themis 后续不再建议直接把日常开发目录推到公开 GitHub。

推荐采用两套目录：

- `A`：内部开发仓。允许保留本地配置、私人文档、运行产物和个人工作痕迹。
- `B`：公开发布仓。只接收明确允许公开的脱敏内容，并单独绑定 GitHub remote。

关键原则只有一条：

- `A` 是真实开发现场。
- `B` 是从 `A` 自动导出的公开镜像，不是手工维护的第二套项目。

## 为什么不能继续只靠 `.gitignore`

`.gitignore` 只能挡住“还没被 Git 跟踪的本地文件”，挡不住下面这些风险：

- 已经被跟踪过的私人文档
- 已经进入提交历史的密钥和凭证
- 本地路径、机器名、账号信息这类不该公开的上下文
- “文件本身必须存在，但真实值不能公开”的配置文件

所以公开边界不能继续靠“推送前手工检查一下”，而要改成固定的发布导出流程。

## 配置文件的处理原则

以后遇到“这个配置文件是项目必须的，但真实内容是私密的”时，统一按下面的分层处理：

### 1. 公开模板文件

- 可以进入 GitHub。
- 只保留字段名、注释、示例值、默认结构。
- 不保留真实 key、真实账号、内网地址、个人路径。

典型命名：

- `.env.example`
- `*.example.json`
- `*.example.yaml`
- `infra/systemd/*.example`

### 2. 本地真实配置

- 只能留在开发仓 `A`。
- 不进入公开仓 `B`。
- 由运行时在本地读取。

典型命名：

- `.env.local`
- `*.local.json`
- `*.local.yaml`
- `infra/local/*`

### 3. 一条硬规则

- 推送的是“配置契约”。
- 不推送“个人配置值”。

如果某个配置文件当前还是“文件名固定 + 内容里有真实秘密”，就先改造成“模板文件 + 本地覆盖文件”的模式，再考虑进入公开仓。

## Themis 当前已具备的分层

目前仓库里已经有一部分安全分层，后续应继续沿用：

- `.env.example`：公开模板
- `.env.local`：本地真实配置
- `infra/systemd/themis-dev.service.example`：公开模板
- `infra/local/`：本地运行数据和本机状态
- `AGENTS.md`、`.codex/`、`memory/sessions/*.md`：个人或会话级文件，不公开

## 公开仓 B 的默认策略

公开仓 `B` 默认采用白名单导出，不采用黑名单排除。

原因：

- 黑名单容易漏掉新文件。
- 白名单只有明确批准的内容才会进入公开仓，风险更低。

当前推荐默认只公开这些类别：

- `src/`
- `apps/web/`
- `README.md`
- `.gitignore`
- `.env.example`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `themis`
- `infra/systemd/themis-dev.service.example`
- 已明确确认可公开的少量仓库说明文档

下面这些默认不进 `B`，除非后续显式评审后再加入白名单：

- `memory/`
- `docs/memory/`
- `docs/superpowers/`
- `docs/openai/`
- 大部分运维内部文档
- 任意本地运行产物和本机状态文件

## 当前导出脚本

仓库已提供公开镜像导出脚本：

```bash
npm run publish:public -- ../themis-public
```

或直接执行：

```bash
bash scripts/export-public-repo.sh ../themis-public
```

说明：

- `../themis-public` 就是你的公开仓 `B`。
- 首次使用前，先在 `B` 目录里单独 `git init` 并绑定 GitHub remote。
- 脚本只会把白名单中的内容同步到 `B`。
- 脚本会保留 `B/.git/`，不会覆盖公开仓自己的 Git 元数据。
- 脚本默认会 `--delete` 公开仓里那些“不再属于白名单”的旧文件，避免历史残留继续留在 `B`。

如果想先看差异，不真正落盘，可以：

```bash
bash scripts/export-public-repo.sh --dry-run ../themis-public
```

## 公开白名单维护规则

白名单规则文件在：

```text
scripts/public-repo-rsync.filter
```

维护时遵循下面的规则：

1. 新增文件默认不公开。
2. 只有确认“内容长期适合公开”后，才加入白名单。
3. 文档目录不要整片放开，尽量按文件精确加入。
4. 如果一个文件的结构需要公开，但真实值不能公开，先拆成 `example/local` 再加入白名单。

## 首次迁移建议

1. 停止用开发仓 `A` 直接推 GitHub。
2. 新建一个兄弟目录作为公开仓 `B`。
3. 在 `B` 里初始化独立 Git 仓库并绑定 GitHub remote。
4. 先执行一次 `--dry-run`，确认白名单范围。
5. 执行正式导出。
6. 在 `B` 里 review 一次差异后再提交、推送。

## 如果敏感内容已经推到 GitHub 过

这时只改目录结构不够，必须补救：

1. 立刻轮换所有相关密钥和凭证。
2. 停止继续从开发仓直接推公开仓。
3. 清理公开仓历史中的敏感文件。
4. 切换到“开发仓 A -> 白名单导出 -> 公开仓 B”的新流程。

## 推送前最少检查

即使已经改成 A/B 双目录，推送公开仓前仍建议检查：

1. `B` 的变更是否全部来自导出脚本，而不是手工补文件。
2. 新增文档是否真的适合公开。
3. 模板文件里是否只有示例值，没有真实值。
4. Git diff 里是否出现个人路径、账号、token、secret、cookie、内网地址。
