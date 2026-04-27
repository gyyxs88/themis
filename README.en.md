# Themis

[Simplified Chinese](./README.md)

Themis is a self-hosted collaboration shell built around `codex app-server`.

The public `themis` repository owns the main product shell: Web and Feishu entrypoints, human conversations, history, identity, runtime settings, automation APIs, and the minimal platform gateway needed to consume `/api/platform/*` facts. The platform control plane, worker nodes, and shared contracts currently live in sibling repositories.

## Related Components

- `themis` (this repository): the main Themis product shell for Web / Feishu entrypoints, sessions, history, identity, runtime settings, automation APIs, and the required platform gateway.
- `themis-platform`: the platform control plane and background service for `/api/platform/*`, nodes, execution leases, scheduler, on-call, and organization-level governance.
- `themis-worker-node`: worker-node local preflight, daemon execution, and the `register -> heartbeat -> pull -> execute -> report` loop.
- `themis-contracts`: shared contracts, DTOs, error codes, and schemas.

## Current Status

- As of `2026-04-15`, the platform control plane, worker nodes, and real LAN joint test have completed the first validation round; this line is no longer treated as a deployment blocker.
- Main Themis no longer keeps the `Platform Agents` page and no longer exposes the `/api/agents/*` platform compatibility route.
- Platform on-call, node governance, `worker-fleet`, and `nodes/*` belong to `themis-platform`.
- Since `2026-04-18`, the main Themis Web settings panel includes an "internal meeting rooms" page, exposed through `/api/meeting-rooms/*` as a platform meeting-room gateway. Themis can act as the manager that creates rooms, organizes multi-employee discussion through `discussionMode / entryMode`, reads the live message stream, records `resolution` facts, promotes them into formal `work item`s, and closes rooms. The platform page provides a read-only meeting-room observatory plus forced termination when needed; it does not host the discussion.
- Since `2026-04-23`, the Web "operations center" is no longer just a direction page. The first cut now includes `Asset / Decision / Risk / Cadence / Commitment` objects, `OperationEdge` relationship edges, graph query, and the read-only `BossView`. SQLite now has `themis_principal_assets / themis_principal_decisions / themis_principal_risks / themis_principal_cadences / themis_principal_commitments / themis_principal_operation_edges`; HTTP exposes `/api/operations/assets/*`, `/api/operations/decisions/*`, `/api/operations/risks/*`, `/api/operations/cadences/*`, `/api/operations/commitments/*`, `/api/operations/edges/*`, `/api/operations/graph/query`, and `/api/operations/boss-view`. `Decision / Risk / Cadence / Commitment` writes automatically sync base relationship edges. `Commitment` can maintain `progressPercent / milestones / evidenceRefs` and build `evidence_for` reverse links from `work_item` evidence. The Web UI can maintain the minimal operations ledger, show object backlinks, one-hop / two-hop impact, read-only relationship subgraphs, optional shortest paths, BossView, and operations snapshots.
- The next focus of this repository is the main Themis product surface itself, plus the minimal client capability needed to consume platform facts through shared contracts.

## Product Positioning

- Themis currently targets self-hosted, same-machine, or LAN deployments.
- The main execution chain is `codex app-server`; the repository no longer depends on `@openai/codex-sdk`.
- The current global default model is `gpt-5.4`, with default reasoning effort `xhigh`. Session settings, runtime boundaries, or the underlying `config.toml` can override that.
- The public GitHub repository is the formal version source; `themis status` checks the latest GitHub commit and reports upgrade advice.
- Themis is not a general cloud service and is not intended to be published as an npm package.
- Themis is currently closer to the first version of a "digital company control plane / operations center" than a complete "digital company operating system". The connected focus is execution, collaboration, governance, and durable knowledge.

## What This Repository Owns

- A local / LAN Web chat workspace with authentication, multiple accounts, history, forks, runtime settings, and long-term profiles.
- A Feishu bot entrypoint that shares the runtime, communication layer, and SQLite persistence with Web.
- The main Themis session, history, identity, configuration, task entrypoint, and automation APIs.
- Operational diagnostics through `status / doctor / doctor smoke / doctor release`.
- Automation APIs such as `POST /api/tasks/automation/run`.
- One-off scheduled tasks, managed-employee governance, and operations-center machine protocol. `themis mcp-server` exposes `create_scheduled_task / list_scheduled_tasks / cancel_scheduled_task`, `list_managed_agents / get_managed_agent_detail / create_managed_agent / update_managed_agent_card / update_managed_agent_execution_boundary / dispatch_work_item / update_managed_agent_lifecycle`, plus `list_operation_objects / create_operation_object / update_operation_object / list_operation_edges / create_operation_edge / update_operation_edge / query_operation_graph / get_operations_boss_view` for Codex.
- The platform meeting-room gateway and Web manager console for `status / list / create / detail / participants/add / resolutions/create / resolutions/promote / close / message/stream`.
- The operations-center minimum ledger: assets, cadences, commitments, decisions, risks, relationship edges, graph query, and read-only BossView. This is a machine-native operations ledger for Themis and its digital employees, not a human form-filling task manager. Humans mainly observe and audit through Web / BossView, and use employee lifecycle or execution boundaries as an emergency brake when needed.

## Digital Employee Boundary

- The "digital employee / persistent agent" capability in Themis is not a native Codex product feature. It is a long-lived identity, governance, and persistence layer that Themis adds on top of `codex app-server`.
- Native Codex execution is closer to short-lived task agents inside a single task. Themis adds organization, long-term identity, work queues, governance surfaces, long-term memory, and execution boundaries.
- Two related terms appear in this repository:
  - `actor`: a lighter internal collaboration and memory model for task scope, timeline / takeover, and long-term memory candidates. It is not the full long-lived digital employee.
  - `managed_agent`: the real long-lived digital employee entity that can receive work, be paused / resumed / archived, and be governed.
- The detailed design lives in [Persistent agent architecture](./docs/product/themis-persistent-agent-architecture.md).

## Quick Start

These steps are for local development or a single-machine experience in this repository. For platform-layer or Worker Node joint tests, use the deployment and operations docs below.

1. Install dependencies:

```bash
npm install
```

2. Initialize local configuration:

```bash
./themis
```

or:

```bash
npm run themis -- init
```

3. Start the Web service:

```bash
npm run dev:web
```

If you also need to validate the platform surface locally from this repository:

```bash
npm run dev:platform
```

4. Open:

```text
http://localhost:3100
```

## Deployment And Joint-Test Docs

- Local workspace deployment notes: `docs/local/current-deployment.md` and `docs/local/README.md` are local-only and are not version-controlled.
- [Repository operations docs index](./docs/repository/README.md)
- [Production systemd deployment](./docs/repository/themis-systemd-prod-service.md)
- [Platform-layer systemd service](./docs/repository/themis-platform-systemd-service.md)
- [Worker Node daemon deployment](./docs/repository/themis-worker-node-systemd-service.md)
- [Release acceptance matrix](./docs/repository/themis-release-acceptance-matrix.md)
- [Release, canary, and rollback](./docs/repository/themis-release-rollout-and-rollback.md)

## Common Commands

```bash
./themis status
./themis doctor
./themis doctor release
./themis update check
./themis update apply
./themis update rollback
./themis-platform auth platform list
./themis-platform doctor worker-fleet --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken>
./themis-platform worker-fleet <drain|offline|reclaim> --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken> --node <nodeId> [--node <nodeId> ...] --yes
./themis-worker-node doctor worker-node --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken> --workspace <path>
./themis-worker-node worker-node run --platform <baseUrl> --owner-principal <principalId> --token <platformWorkerToken> --name <displayName> [--once]
./themis mcp-server
npm run dev:platform
npm run start:platform
```

Notes:

- Compatibility aliases still exist under `./themis` for `auth platform`, `doctor worker-node`, `doctor worker-fleet`, `worker-node`, and `worker-fleet`, but daily use should move to the dedicated entrypoints.
- Platform on-call, platform tokens, and `worker-fleet`: `./themis-platform`
- Worker Node local preflight and daemon execution: `./themis-worker-node`
- `themis`, `themis-platform`, and `themis-worker-node` currently depend on shared contracts through `file:../themis-contracts`. For real deployment, place `themis-contracts` as a sibling directory before running `npm ci`.
- `THEMIS_PLATFORM_WEB_ACCESS_TOKEN` is the manager gateway token for main Themis. Besides `agents / projects / work-items / runs`, it can access manager-view node observation and governance endpoints: `nodes/list|detail|drain|offline|reclaim`. Node runtime endpoints such as `nodes/register|heartbeat`, `/api/platform/worker/*`, and `worker-node run` still use a platform service token with the `worker` role.

To install a user-level `themis` command similar to `codex`, run once from the repository root:

```bash
./themis install
```

Then you can run:

```bash
themis
themis status
themis update
themis mcp-server
```

## Feishu Configuration

For the Feishu channel, configure:

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

or write them into `.env.local` through the CLI:

```bash
npm run themis -- config set FEISHU_APP_ID cli_xxx
npm run themis -- config set FEISHU_APP_SECRET xxx
```

## Common Environment Variables

- Main service: `THEMIS_HOST`, `THEMIS_PORT`, `THEMIS_TASK_TIMEOUT_MS`
  - `THEMIS_TASK_TIMEOUT_MS` is the silence timeout between progress events for a single task, in milliseconds. Continuous progress extends the timeout automatically. Default: `300000`.
- Codex auth: `CODEX_HOME`, `CODEX_API_KEY`
- Platform gateway: `THEMIS_PLATFORM_BASE_URL`, `THEMIS_PLATFORM_OWNER_PRINCIPAL_ID`, `THEMIS_PLATFORM_WEB_ACCESS_TOKEN`
- Feishu: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_PROGRESS_FLUSH_TIMEOUT_MS`
- OpenAI-compatible provider: `THEMIS_OPENAI_COMPAT_BASE_URL`, `THEMIS_OPENAI_COMPAT_API_KEY`, `THEMIS_OPENAI_COMPAT_MODEL`
- Update and build metadata: `THEMIS_BUILD_COMMIT`, `THEMIS_BUILD_BRANCH`, `THEMIS_UPDATE_REPO`, `THEMIS_UPDATE_CHANNEL`, `THEMIS_UPDATE_DEFAULT_BRANCH`, `THEMIS_UPDATE_SYSTEMD_SERVICE`, `THEMIS_UPDATE_RESTART_EXIT_WAIT_MS`, `THEMIS_RESTART_CONFIRM_TIMEOUT_MS`, `THEMIS_GITHUB_TOKEN`
- Worker secret injection: `THEMIS_MANAGED_AGENT_WORKER_SECRET_STORE_FILE` overrides the worker secret store path written by Feishu `/secrets worker`; by default it targets sibling `../themis-worker-node/infra/local/worker-secrets.json`.
- Platform-layer MySQL, runtime snapshot, and execution runtime variables are documented in [Platform MySQL control-plane cutover](./docs/repository/themis-platform-mysql-control-plane-cutover.md) and the [repository operations docs index](./docs/repository/README.md).

## Documentation

- [Documentation index](./docs/README.md)
- Local deployment docs: `docs/local/` (local-only, not version-controlled)
- [Repository operations docs index](./docs/repository/README.md)
- [Feishu integration overview](./docs/feishu/README.md)
- [Feishu channel](./docs/feishu/themis-feishu-channel.md)
- [Product docs index](./docs/product/README.md)
- [Persistent agent architecture](./docs/product/themis-persistent-agent-architecture.md)

## License

This project is licensed under [Apache-2.0](./LICENSE).

## Publishing And Updates

Public publishing uses a two-repository workflow: the development repository owns daily development and local material; the public repository owns GitHub-safe content.

Export the public repository:

```bash
npm run publish:public -- ../themis-public
```

Then commit and push from the public repository:

```bash
git status
git add -A
git commit -m "..."
git push origin main
```

Common commands for a formal instance:

```bash
./themis status
./themis update check
./themis update apply
./themis update rollback
```

- `THEMIS_UPDATE_CHANNEL` supports `branch` and `release`; the default is still `branch`.
- Controlled update currently supports only clean public-repository `git clone` deployments on the default branch, with fast-forward-only updates.
- Web supports "runtime settings -> instance update"; Feishu supports `/update`, `/update apply confirm`, `/update rollback confirm`, `/ops status`, `/ops restart confirm`, and `/secrets worker` for worker secret references.
- See [Release, canary, and rollback](./docs/repository/themis-release-rollout-and-rollback.md) and [Production systemd deployment](./docs/repository/themis-systemd-prod-service.md) for boundaries and rollback details.
