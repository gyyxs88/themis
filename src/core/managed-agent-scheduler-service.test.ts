import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { ManagedAgentCoordinationService } from "./managed-agent-coordination-service.js";
import { ManagedAgentsService } from "./managed-agents-service.js";
import { ManagedAgentSchedulerService } from "./managed-agent-scheduler-service.js";

function createServiceContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-scheduler-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  const managedAgentsService = new ManagedAgentsService({ registry });
  const coordinationService = new ManagedAgentCoordinationService({ registry });
  const schedulerService = new ManagedAgentSchedulerService({
    registry,
    leaseTtlMs: 60_000,
  });

  return {
    root,
    databaseFile,
    registry,
    managedAgentsService,
    coordinationService,
    schedulerService,
  };
}

test("ManagedAgentSchedulerService 会 claim queued work item、创建 run lease，并推进到 completed", () => {
  const { root, registry, managedAgentsService, coordinationService, schedulerService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T08:20:00.000Z",
      updatedAt: "2026-04-06T08:20:00.000Z",
    });

    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责服务端实现。",
      now: "2026-04-06T08:21:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      dispatchReason: "把 scheduler 最小闭环接出来",
      goal: "实现 run lease 与状态推进",
      priority: "urgent",
      now: "2026-04-06T08:22:00.000Z",
    });

    const tick = schedulerService.tick({
      schedulerId: "scheduler-alpha",
      now: "2026-04-06T08:23:00.000Z",
    });

    assert.equal(tick.recoveredRuns.length, 0);
    assert.equal(tick.claimed?.workItem.workItemId, dispatched.workItem.workItemId);
    assert.equal(tick.claimed?.workItem.status, "planning");
    assert.equal(tick.claimed?.run.schedulerId, "scheduler-alpha");
    assert.equal(tick.claimed?.run.status, "created");

    const listed = schedulerService.listRuns({
      ownerPrincipalId: "principal-owner",
      agentId: backend.agent.agentId,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.runId, tick.claimed?.run.runId);

    const runDetail = schedulerService.getRun("principal-owner", tick.claimed?.run.runId ?? "");
    assert.equal(runDetail?.workItemId, dispatched.workItem.workItemId);

    const starting = schedulerService.markRunStarting(
      tick.claimed?.run.runId ?? "",
      tick.claimed?.run.leaseToken ?? "",
      "2026-04-06T08:23:10.000Z",
    );
    assert.equal(starting.status, "starting");

    const running = schedulerService.markRunRunning(
      tick.claimed?.run.runId ?? "",
      tick.claimed?.run.leaseToken ?? "",
      "2026-04-06T08:23:20.000Z",
    );
    assert.equal(running.status, "running");
    assert.equal(running.startedAt, "2026-04-06T08:23:20.000Z");

    const heartbeat = schedulerService.heartbeatRun(
      tick.claimed?.run.runId ?? "",
      tick.claimed?.run.leaseToken ?? "",
      "2026-04-06T08:23:40.000Z",
    );
    assert.equal(heartbeat.lastHeartbeatAt, "2026-04-06T08:23:40.000Z");

    const completed = schedulerService.completeRun(
      tick.claimed?.run.runId ?? "",
      tick.claimed?.run.leaseToken ?? "",
      "2026-04-06T08:24:00.000Z",
    );
    assert.equal(completed.status, "completed");
    assert.equal(completed.completedAt, "2026-04-06T08:24:00.000Z");

    const completedWorkItem = registry.getAgentWorkItem(dispatched.workItem.workItemId);
    assert.equal(completedWorkItem?.status, "completed");
    assert.equal(completedWorkItem?.completedAt, "2026-04-06T08:24:00.000Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentSchedulerService 会回收过期 lease，把 work item 重新排回队列并重新 claim", () => {
  const { root, registry, managedAgentsService, coordinationService, schedulerService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T08:30:00.000Z",
      updatedAt: "2026-04-06T08:30:00.000Z",
    });

    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·砺",
      departmentRole: "运维",
      mission: "负责部署与值班。",
      now: "2026-04-06T08:31:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      dispatchReason: "排查线上告警",
      goal: "确认当前 release 是否需要回滚",
      priority: "high",
      now: "2026-04-06T08:32:00.000Z",
    });

    const firstTick = schedulerService.tick({
      schedulerId: "scheduler-alpha",
      now: "2026-04-06T08:33:00.000Z",
    });
    assert.ok(firstTick.claimed);

    const running = schedulerService.markRunRunning(
      firstTick.claimed?.run.runId ?? "",
      firstTick.claimed?.run.leaseToken ?? "",
      "2026-04-06T08:33:10.000Z",
    );
    assert.equal(running.leaseExpiresAt, "2026-04-06T08:34:10.000Z");

    const secondTick = schedulerService.tick({
      schedulerId: "scheduler-alpha",
      now: "2026-04-06T08:34:11.000Z",
    });

    assert.equal(secondTick.recoveredRuns.length, 1);
    assert.equal(secondTick.recoveredRuns[0]?.runId, firstTick.claimed?.run.runId);
    assert.equal(secondTick.recoveredRuns[0]?.status, "interrupted");
    assert.equal(secondTick.recoveredRuns[0]?.failureCode, "LEASE_EXPIRED");
    assert.equal(secondTick.claimed?.workItem.workItemId, dispatched.workItem.workItemId);
    assert.notEqual(secondTick.claimed?.run.runId, firstTick.claimed?.run.runId);
    assert.equal(secondTick.claimed?.run.status, "created");

    const workItem = registry.getAgentWorkItem(dispatched.workItem.workItemId);
    assert.equal(workItem?.status, "planning");

    const runs = schedulerService.listRuns({
      ownerPrincipalId: "principal-owner",
      workItemId: dispatched.workItem.workItemId,
    });
    assert.equal(runs.length, 2);
    assert.equal(runs[0]?.runId, secondTick.claimed?.run.runId);
    assert.equal(runs[1]?.runId, firstTick.claimed?.run.runId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentSchedulerService 不会 claim paused agent 的 queued work item，resume 后才会继续执行", () => {
  const { root, registry, managedAgentsService, coordinationService, schedulerService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T02:00:00.000Z",
      updatedAt: "2026-04-07T02:00:00.000Z",
    });

    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·砺",
      departmentRole: "运维",
      mission: "负责部署与值班。",
      now: "2026-04-07T02:01:00.000Z",
    });

    coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      dispatchReason: "排查生产告警",
      goal: "确认是否需要暂停发布",
      now: "2026-04-07T02:02:00.000Z",
    });

    const paused = managedAgentsService.pauseManagedAgent(
      "principal-owner",
      ops.agent.agentId,
      "2026-04-07T02:03:00.000Z",
    );
    assert.equal(paused.status, "paused");

    const blockedTick = schedulerService.tick({
      schedulerId: "scheduler-alpha",
      now: "2026-04-07T02:04:00.000Z",
    });
    assert.equal(blockedTick.claimed, null);

    managedAgentsService.resumeManagedAgent(
      "principal-owner",
      ops.agent.agentId,
      "2026-04-07T02:05:00.000Z",
    );

    const resumedTick = schedulerService.tick({
      schedulerId: "scheduler-alpha",
      now: "2026-04-07T02:06:00.000Z",
    });
    assert.equal(resumedTick.claimed?.targetAgent.agentId, ops.agent.agentId);
    assert.equal(resumedTick.claimed?.workItem.status, "planning");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("schema 19 迁移会创建 agent run 表", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-scheduler-schema-"));
  const databaseFile = join(root, "infra/local/themis.db");
  mkdirSync(join(root, "infra/local"), { recursive: true });
  const bootstrap = new Database(databaseFile);

  try {
    bootstrap.exec(`
      PRAGMA user_version = 18;

      CREATE TABLE themis_principals (
        principal_id TEXT PRIMARY KEY,
        display_name TEXT,
        principal_kind TEXT NOT NULL DEFAULT 'human_user',
        organization_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } finally {
    bootstrap.close();
  }

  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  void registry;

  const verify = new Database(databaseFile, { readonly: true });

  try {
    const runsTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_runs'
      `)
      .get() as { name: string } | undefined;

    assert.equal(runsTable?.name, "themis_agent_runs");
  } finally {
    verify.close();
    rmSync(root, { recursive: true, force: true });
  }
});
