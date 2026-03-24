# GitHub 安全发布说明

## 目标

把项目接到 GitHub 时，尽量避免误发布下面这些内容：

- 个人 Agent 规则
- 个人会话上下文
- 密钥和凭证
- 本机配置

## 当前默认排除项

仓库默认忽略这些类别：

- `AGENTS.md`
- `memory/sessions/*.md`，但保留 `memory/sessions/README.md`
- `memory/local/`
- `docs/local/`
- `docs/private/`
- `.env*`，但保留 `.env.example`
- `.codex/`
- `.vscode/`、`.idea/` 等编辑器目录
- 证书和密钥文件
- `*.local.*` 这类本地覆盖文件

## 共享内容建议放哪里

适合进入仓库、并可安全共享的项目知识，优先放在：

- `docs/`
- `docs/memory/`
- `memory/project/`
- `memory/architecture/`
- `memory/decisions/`
- `memory/tasks/`

个人或机器相关内容应继续放在被忽略的位置。

## 推送前检查

推送前至少检查下面几点：

1. `git status --short` 里没有个人文件。
2. 暂存区里没有密钥、令牌或本机凭证。
3. `memory/sessions/active.md` 这类会话文件没有被误提交。
4. 准备共享的文档已经去掉仅本机有效的信息。

## 后续可选改进

如果后面需要，可以增加本地 pre-commit 或 pre-push 检查，直接拦截：

- `AGENTS.md`
- `memory/sessions/active.md`
- `.env*`
- 各类密钥文件
