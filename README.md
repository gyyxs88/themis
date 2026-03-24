# Themis

Themis is a secondary development project built on top of the Codex SDK.

Its goal is to provide a personalized and easier-to-use shell for the owner and employees, while keeping project knowledge, decisions, tasks, and collaboration records persistently stored in the repository.

## Current Focus

- Build a usable shell experience on top of the Codex SDK
- Lower the learning and usage cost for internal team members
- Preserve project memory in Markdown so context is not lost across sessions

## Repository Structure

- `src`: core application code
- `apps`: runnable apps, demos, and interfaces
- `tests`: automated tests
- `scripts`: local helper scripts
- `docs`: design notes and documentation
- `infra`: deployment and environment files
- `memory`: persistent project memory stored as Markdown

## Markdown Memory System

The project now includes a file-based persistent memory system under [`memory/`](/home/gyyxs88/Projects/Themis/memory).

This system is designed to support ongoing work by keeping important information close to the codebase:

- project goals and scope
- active and completed work
- architectural notes
- decision records
- session handoff notes
- reusable templates

## Memory Entry Points

- [`memory/index.md`](/home/gyyxs88/Projects/Themis/memory/index.md): memory navigation hub
- [`memory/project/overview.md`](/home/gyyxs88/Projects/Themis/memory/project/overview.md): project intent, scope, and current phase
- [`memory/tasks/in-progress.md`](/home/gyyxs88/Projects/Themis/memory/tasks/in-progress.md): work currently being executed
- [`memory/tasks/backlog.md`](/home/gyyxs88/Projects/Themis/memory/tasks/backlog.md): upcoming work candidates
- [`memory/decisions/`](/home/gyyxs88/Projects/Themis/memory/decisions): durable decision records
- [`memory/sessions/active.md`](/home/gyyxs88/Projects/Themis/memory/sessions/active.md): current working context
- [`memory/operations/working-agreement.md`](/home/gyyxs88/Projects/Themis/memory/operations/working-agreement.md): rules for keeping memory up to date

## Recommended Update Flow

When meaningful work happens, update the memory files together with the code:

1. Update [`memory/sessions/active.md`](/home/gyyxs88/Projects/Themis/memory/sessions/active.md) during active work.
2. Move task status across backlog, in-progress, and done files.
3. Record important decisions in [`memory/decisions/`](/home/gyyxs88/Projects/Themis/memory/decisions).
4. Refresh project-level docs when goals, scope, or architecture change.

## Collaboration Notes

This repository is intended to be usable by both the owner and internal employees.

The memory system is intentionally plain Markdown so it can be:

- edited in any editor
- reviewed in Git
- searched with simple tools
- extended without introducing a database or service dependency

## LAN Web UI

The project now includes a first end-to-end LAN web UI path:

- chat-style task composer with a single-surface input area
- local thread history in the browser
- thread switching from the left sidebar
- a simplified sidebar that focuses on recent conversations and navigation
- a main-surface `分叉` action plus a simplified workspace modal whose model picker is loaded from `codex app-server`
- desktop sidebar collapse and resize, plus a mobile drawer sidebar
- real backend multi-turn session reuse keyed by `sessionId`
- backend request normalization
- Codex SDK execution
- incremental event delivery back to the browser
- browser-side task cancellation
- server-side timeout and disconnect handling
- final result delivery back to the browser in the same conversation surface

### Run Locally

1. Install dependencies:

```bash
npm install
```

2. Make sure Codex authentication is available on this machine.

Examples:

- existing Codex / ChatGPT login already works locally
- or `CODEX_API_KEY` is available in the environment

3. Start the LAN web UI:

```bash
npm run dev:web
```

`dev:web` now runs in watch mode and will auto-restart when backend TypeScript files change. Browser assets still need a page refresh to reflect new HTML/CSS/JS.

4. Open the printed local or LAN address in a browser.

Default address:

```text
http://localhost:3100
```

Typical LAN address example:

```text
http://192.168.x.x:3100
```

You can override bind host and port with:

- `THEMIS_HOST`
- `THEMIS_PORT`
- `THEMIS_TASK_TIMEOUT_MS`

### What You Should See

- A layout closer to Codex app or ChatGPT, with a left sidebar and a central conversation area
- A recent-conversations list in the sidebar, with local history preserved in the browser
- Thread status shown on each conversation item in the sidebar instead of the workspace header
- A `分叉` action in the workspace header, while `设置` only keeps runtime parameters and loads the real model picker from `codex app-server`
- A desktop sidebar that can collapse or be resized, and a drawer-style sidebar on mobile
- A chat-style task composer at the bottom of the workspace, with hints and actions embedded into the same input surface and no separate context panel
- A live execution timeline inside the assistant response card while Codex is still working
- 中途 assistant commentary 会直接显示在同一张响应卡片里，不再只看到通用进度标记
- 默认界面更精简，只保留结论、必要进展，以及少量运行参数设置
- A final result section that stays inside the same conversation turn
- A `取消` button that aborts the browser request and stops the corresponding task
- Forking that prefers real Codex session transcript replay over summary-only bootstrapping
- A running web task no longer locks the whole UI: you can switch, create, or fork threads while it runs, and sending a new message will interrupt the current run before automatically sending the new request

### Current Thread Model

- The web UI now keeps conversation threads in browser local storage
- Switching threads changes the visible conversation without losing recent local history
- Each new task request includes a `sessionId`
- The backend now maps that `sessionId` to a real Codex thread and resumes it on later turns
- Session-to-thread mapping is now persisted locally at `infra/local/themis.db`
- The same SQLite database now also keeps task-turn records, streamed event history, and touched-file indexes for local recovery and inspection
- Forking a session creates a new local thread and tries to bootstrap its first backend turn from the persisted Codex session transcript
- If the persisted Codex transcript is unavailable, the UI falls back to a browser-local turn-by-turn transcript instead of a short summary
- This is closer to Codex app style branching, but it is still transcript replay into a fresh thread rather than a low-level SDK thread clone

### LAN Troubleshooting

If `localhost` works but another device times out when opening `http://<LAN-IP>:3100`, check the host firewall first.

If the homepage loads but `/styles/*.css` or `/modules/*.js` return `404`, first confirm the current `npm run dev:web` watch process has restarted after your backend change. If you are still connected to an older server instance, restart it once manually.

For Ubuntu systems using `ufw`, a typical fix is:

```bash
sudo ufw allow 3100/tcp
sudo ufw reload
sudo ufw status
```

If you only want to allow the current subnet, use a narrower rule such as:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 3100 proto tcp
```
