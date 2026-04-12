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
  const managedAgentsService = new ManagedAgentsService({ registry, workingDirectory: root });
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

test("ManagedAgentSchedulerService 有可用节点时会创建 execution lease，并在 run 收口后释放节点槽位", () => {
  const { root, registry, managedAgentsService, coordinationService, schedulerService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-12T05:00:00.000Z",
      updatedAt: "2026-04-12T05:00:00.000Z",
    });

    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责节点调度最小匹配。",
      now: "2026-04-12T05:01:00.000Z",
    });

    registry.saveManagedAgentNode({
      nodeId: "node-platform-a",
      organizationId: backend.organization.organizationId,
      displayName: "Platform Node A",
      status: "online",
      slotCapacity: 2,
      slotAvailable: 1,
      labels: ["linux"],
      workspaceCapabilities: [root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-12T05:01:30.000Z",
      createdAt: "2026-04-12T05:01:30.000Z",
      updatedAt: "2026-04-12T05:01:30.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      dispatchReason: "scheduler-node-match",
      goal: "验证 claim 时会绑定 node 与 execution lease。",
      now: "2026-04-12T05:02:00.000Z",
    });

    const claim = schedulerService.claimNextRunnableWorkItem({
      schedulerId: "scheduler-node-test",
      now: "2026-04-12T05:03:00.000Z",
    });

    assert.equal(claim?.node?.nodeId, "node-platform-a");
    assert.equal(claim?.executionLease?.status, "active");
    assert.equal(claim?.executionLease?.nodeId, "node-platform-a");
    assert.equal(
      registry.getActiveAgentExecutionLeaseByRun(claim?.run.runId ?? "")?.leaseId,
      claim?.executionLease?.leaseId,
    );
    assert.equal(registry.getManagedAgentNode("node-platform-a")?.slotAvailable, 0);

    const detail = schedulerService.getRunDetailView("principal-owner", claim?.run.runId ?? "");
    assert.equal(detail?.node?.nodeId, "node-platform-a");
    assert.equal(detail?.executionLease?.status, "active");
    assert.equal(detail?.workItem?.workItemId, dispatched.workItem.workItemId);

    schedulerService.completeRun(
      claim?.run.runId ?? "",
      claim?.run.leaseToken ?? "",
      "2026-04-12T05:04:00.000Z",
    );

    assert.equal(registry.getActiveAgentExecutionLeaseByRun(claim?.run.runId ?? ""), null);
    assert.equal(registry.getManagedAgentNode("node-platform-a")?.slotAvailable, 1);
    assert.equal(registry.getAgentExecutionLease(claim?.executionLease?.leaseId ?? "")?.status, "released");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentSchedulerService 在节点能力不满足时会回退为无节点租约的 claim", () => {
  const { root, registry, managedAgentsService, coordinationService, schedulerService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-12T05:10:00.000Z",
      updatedAt: "2026-04-12T05:10:00.000Z",
    });

    registry.saveAuthAccount({
      accountId: "acct-node-required",
      label: "节点专用账号",
      codexHome: join(root, "infra/local/codex-auth/acct-node-required"),
      isActive: true,
      createdAt: "2026-04-12T05:10:10.000Z",
      updatedAt: "2026-04-12T05:10:10.000Z",
    });

    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责节点能力不足时的 fallback 验证。",
      now: "2026-04-12T05:11:00.000Z",
    });

    const isolatedWorkspace = join(root, "workspace/isolated");
    mkdirSync(isolatedWorkspace, { recursive: true });
    managedAgentsService.updateManagedAgentExecutionBoundary({
      ownerPrincipalId: "principal-owner",
      agentId: backend.agent.agentId,
      workspacePolicy: {
        workspacePath: isolatedWorkspace,
        additionalDirectories: [],
        allowNetworkAccess: true,
      },
      runtimeProfile: {
        accessMode: "auth",
        authAccountId: "acct-node-required",
      },
      now: "2026-04-12T05:11:30.000Z",
    });

    registry.saveManagedAgentNode({
      nodeId: "node-platform-b",
      organizationId: backend.organization.organizationId,
      displayName: "Platform Node B",
      status: "online",
      slotCapacity: 2,
      slotAvailable: 2,
      labels: ["linux"],
      workspaceCapabilities: [root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-12T05:12:00.000Z",
      createdAt: "2026-04-12T05:12:00.000Z",
      updatedAt: "2026-04-12T05:12:00.000Z",
    });

    coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      dispatchReason: "scheduler-node-capability-miss",
      goal: "验证节点能力不够时不会误绑 execution lease。",
      now: "2026-04-12T05:13:00.000Z",
    });

    const claim = schedulerService.claimNextRunnableWorkItem({
      schedulerId: "scheduler-node-fallback-test",
      now: "2026-04-12T05:14:00.000Z",
    });

    assert.ok(claim?.run.runId);
    assert.equal(claim?.node, null);
    assert.equal(claim?.executionLease, null);
    assert.equal(registry.getActiveAgentExecutionLeaseByRun(claim?.run.runId ?? ""), null);
    assert.equal(registry.getManagedAgentNode("node-platform-b")?.slotAvailable, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentSchedulerService 会在 waiting 恢复后优先回原节点，并释放上一条 run 的 execution lease", () => {
  const { root, registry, managedAgentsService, coordinationService, schedulerService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-12T07:00:00.000Z",
      updatedAt: "2026-04-12T07:00:00.000Z",
    });

    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责 waiting 恢复后的节点亲和性。",
      now: "2026-04-12T07:01:00.000Z",
    });

    registry.saveManagedAgentNode({
      nodeId: "node-worker-a",
      organizationId: backend.organization.organizationId,
      displayName: "Worker Node A",
      status: "online",
      slotCapacity: 1,
      slotAvailable: 1,
      labels: ["linux"],
      workspaceCapabilities: [root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-12T07:01:30.000Z",
      createdAt: "2026-04-12T07:01:30.000Z",
      updatedAt: "2026-04-12T07:01:30.000Z",
    });
    registry.saveManagedAgentNode({
      nodeId: "node-worker-b",
      organizationId: backend.organization.organizationId,
      displayName: "Worker Node B",
      status: "online",
      slotCapacity: 1,
      slotAvailable: 1,
      labels: ["linux"],
      workspaceCapabilities: [root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-12T07:01:40.000Z",
      createdAt: "2026-04-12T07:01:40.000Z",
      updatedAt: "2026-04-12T07:01:40.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      dispatchReason: "waiting-node-affinity",
      goal: "验证 waiting 恢复后优先回原节点。",
      now: "2026-04-12T07:02:00.000Z",
    });

    const firstClaim = schedulerService.claimNextRunnableWorkItem({
      schedulerId: "scheduler-node-affinity",
      now: "2026-04-12T07:03:00.000Z",
    });

    const firstNodeId = firstClaim?.node?.nodeId ?? "";
    const fallbackNodeId = firstNodeId === "node-worker-a" ? "node-worker-b" : "node-worker-a";

    assert.ok(firstNodeId);
    assert.equal(firstClaim?.executionLease?.status, "active");
    assert.equal(registry.getManagedAgentNode(firstNodeId)?.slotAvailable, 0);

    schedulerService.markRunStarting(
      firstClaim?.run.runId ?? "",
      firstClaim?.run.leaseToken ?? "",
      "2026-04-12T07:03:10.000Z",
    );
    schedulerService.markRunWaiting(
      firstClaim?.run.runId ?? "",
      firstClaim?.run.leaseToken ?? "",
      "human",
      "2026-04-12T07:03:20.000Z",
    );

    const resumed = coordinationService.respondToHumanWaitingWorkItem({
      ownerPrincipalId: "principal-owner",
      workItemId: dispatched.workItem.workItemId,
      decision: "approve",
      inputText: "继续执行",
      now: "2026-04-12T07:04:00.000Z",
    });

    assert.equal(resumed.workItem.status, "queued");
    assert.equal(resumed.resumedRuns.length, 1);
    assert.equal(resumed.resumedRuns[0]?.status, "interrupted");
    assert.equal(registry.getManagedAgentNode(firstNodeId)?.slotAvailable, 1);
    assert.equal(registry.getAgentExecutionLease(firstClaim?.executionLease?.leaseId ?? "")?.status, "released");

    const secondClaim = schedulerService.claimNextRunnableWorkItem({
      schedulerId: "scheduler-node-affinity",
      now: "2026-04-12T07:05:00.000Z",
    });

    assert.equal(secondClaim?.workItem.workItemId, dispatched.workItem.workItemId);
    assert.equal(secondClaim?.node?.nodeId, firstNodeId);
    assert.equal(secondClaim?.executionLease?.status, "active");
    assert.equal(registry.getManagedAgentNode(firstNodeId)?.slotAvailable, 0);
    assert.equal(registry.getManagedAgentNode(fallbackNodeId)?.slotAvailable, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentSchedulerService 不会选择 TTL 已过期的节点，并会把它落成 offline", () => {
  const { root, registry, managedAgentsService, coordinationService, schedulerService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-12T05:20:00.000Z",
      updatedAt: "2026-04-12T05:20:00.000Z",
    });

    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责 TTL 过期节点过滤验证。",
      now: "2026-04-12T05:21:00.000Z",
    });

    registry.saveManagedAgentNode({
      nodeId: "node-platform-stale",
      organizationId: backend.organization.organizationId,
      displayName: "Platform Node Stale",
      status: "online",
      slotCapacity: 2,
      slotAvailable: 2,
      labels: ["linux"],
      workspaceCapabilities: [root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 10,
      lastHeartbeatAt: "2026-04-12T05:21:00.000Z",
      createdAt: "2026-04-12T05:21:00.000Z",
      updatedAt: "2026-04-12T05:21:00.000Z",
    });

    coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      dispatchReason: "scheduler-node-stale-filter",
      goal: "验证过期节点不会被 claim。",
      now: "2026-04-12T05:21:30.000Z",
    });

    const claim = schedulerService.claimNextRunnableWorkItem({
      schedulerId: "scheduler-node-stale-test",
      now: "2026-04-12T05:21:15.500Z",
    });

    assert.ok(claim?.run.runId);
    assert.equal(claim?.node, null);
    assert.equal(claim?.executionLease, null);
    assert.equal(registry.getManagedAgentNode("node-platform-stale")?.status, "offline");
    assert.equal(registry.getManagedAgentNode("node-platform-stale")?.slotAvailable, 0);
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
