# Themis 开发模式 systemd 用户服务说明

## 目标

把 `npm run dev:web` 挂到 `systemd --user` 下长期运行，让 Themis 后端在开发模式下保持常驻，并继续依赖 `tsx watch` 做代码热更新。

仓库里已经提供了一个可直接修改的模板：

```text
infra/systemd/themis-dev.service.example
```

这套方式优先面向开发机本地使用，不建议直接替代正式生产服务。

## 什么时候适合用

- 你希望 Themis 开发模式常驻，不想每次手动开一个终端窗口。
- 你改的是后端 TypeScript 代码，希望保存后自动重启。
- 你希望进程异常退出后自动拉起。

## 已知边界

- `src/**/*.ts` 这类后端 TypeScript 变更，`npm run dev:web` 会自动重启。
- 前端静态资源变更后，浏览器仍需要手动刷新页面。
- `.env.local`、Node / npm 路径、`npm install` 后的依赖树变化，不属于热更新范围；这类改动后仍需要手动重启服务。

## 推荐做法

优先使用 `systemctl --user`，不要先上系统级服务。这样更贴近开发机场景，也更容易处理当前用户自己的 Node / npm 环境。

### 1. 复制模板

```bash
mkdir -p ~/.config/systemd/user
cp /home/leyi/projects/themis/infra/systemd/themis-dev.service.example ~/.config/systemd/user/themis-dev.service
```

如果你的仓库不在 `/home/leyi/projects/themis`，把上面的路径改成你自己的实际目录。

### 2. 按本机情况改 unit

至少检查下面两项：

- `WorkingDirectory`
- `ExecStart`

模板默认内容是：

```ini
[Service]
WorkingDirectory=%h/projects/themis
ExecStart=/usr/bin/env npm run dev:web
```

说明：

- 如果你的仓库正好就在 `~/projects/themis`，`WorkingDirectory=%h/projects/themis` 可以直接用。
- 如果 `systemd --user` 里找不到 `npm`，把 `ExecStart` 改成你机器上的绝对路径。最简单的办法是先在 shell 里执行：

```bash
which npm
```

然后把结果替换进去，例如：

```ini
ExecStart=/usr/bin/npm run dev:web
```

如果你的 OpenAI / Codex 访问依赖代理，也建议直接把代理环境写进 unit，例如：

```ini
Environment=HTTP_PROXY=http://127.0.0.1:20171
Environment=HTTPS_PROXY=http://127.0.0.1:20171
Environment=NO_PROXY=127.0.0.1,localhost,192.168.0.10
```

`.env.local` 里的业务配置仍会由 Themis 启动时自行加载，所以一般不需要额外写 `EnvironmentFile=`。

### 3. 载入并启动

```bash
systemctl --user daemon-reload
systemctl --user enable --now themis-dev
```

### 4. 查看状态和日志

```bash
systemctl --user status themis-dev
journalctl --user -u themis-dev -f
```

### 5. 什么时候需要手动重启

下面这些改动后，建议直接重启服务：

```bash
systemctl --user restart themis-dev
```

典型场景：

- 你改了 `.env.local`
- 你执行了 `npm install`
- 你切了 Node 版本
- 你改了 unit 文件本身

如果改的是 unit 文件，先执行：

```bash
systemctl --user daemon-reload
systemctl --user restart themis-dev
```

## 可选项

如果你希望退出图形会话或 SSH 断开后，用户级服务仍继续运行，可以再执行一次：

```bash
loginctl enable-linger "$USER"
```

这个不是必须项；只有你明确需要“退出登录后还常驻”时再开。

## 常见问题

### 服务启动后提示找不到 npm

大概率是 `systemd --user` 的 PATH 和你交互 shell 不一样。优先把 `ExecStart` 改成 `which npm` 查到的绝对路径。

### 改了代码但飞书行为没变

先确认你改的是不是后端 TypeScript 文件。如果是 `.env.local` 或其他环境相关文件，`tsx watch` 不会替你重新装载环境，还是要手动 `restart`。

### 飞书或 Codex 认证在终端里正常，服务里不正常

优先检查代理环境是不是只加在交互 shell 里，没有写进 unit。需要长期生效的代理变量，建议直接放到 `systemd` unit。
