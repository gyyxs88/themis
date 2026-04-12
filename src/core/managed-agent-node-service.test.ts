import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { ManagedAgentCoordinationService } from "./managed-agent-coordination-service.js";
import { ManagedAgentsService } from "./managed-agents-service.js";
import { ManagedAgentNodeService } from "./managed-agent-node-service.js";
import { ManagedAgentSchedulerService } from "./managed-agent-scheduler-service.js";

function createServiceContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-node-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  const managedAgentsService = new ManagedAgentsService({
    registry,
    workingDirectory: root,
  });
  const coordinationService = new ManagedAgentCoordinationService({ registry });
  const schedulerService = new ManagedAgentSchedulerService({ registry });
  const nodeService = new ManagedAgentNodeService({ registry });

  return {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    schedulerService,
    nodeService,
  };
}

test("ManagedAgentNodeService 支持 register、list 和 heartbeat", () => {
  const {
    root,
    registry,
    managedAgentsService,
    nodeService,
  } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      createdAt: "2026-04-12T02:00:00.000Z",
      updatedAt: "2026-04-12T02:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "平台经理",
      departmentRole: "平台工程",
      mission: "负责 Phase 2 节点模型验证。",
      now: "2026-04-12T02:01:00.000Z",
    });

    const registered = nodeService.registerNode({
      ownerPrincipalId: "principal-owner",
      organizationId: created.organization.organizationId,
      displayName: "Node A",
      slotCapacity: 4,
      slotAvailable: 3,
      labels: ["linux", "build", "linux"],
      workspaceCapabilities: [join(root, "workspace/platform"), join(root, "workspace/platform")],
      credentialCapabilities: ["acct-default"],
      providerCapabilities: ["gateway-a"],
      heartbeatTtlSeconds: 45,
      now: "2026-04-12T02:02:00.000Z",
    });

    assert.equal(registered.organization.organizationId, created.organization.organizationId);
    assert.equal(registered.node.status, "online");
    assert.equal(registered.node.slotCapacity, 4);
    assert.equal(registered.node.slotAvailable, 3);
    assert.deepEqual(registered.node.labels, ["linux", "build"]);
    assert.equal(registered.node.heartbeatTtlSeconds, 45);

    const listed = nodeService.listNodes("principal-owner", undefined, "2026-04-12T02:02:10.000Z");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.nodeId, registered.node.nodeId);
    assert.equal(listed[0]?.displayName, "Node A");

    const heartbeat = nodeService.heartbeatNode({
      ownerPrincipalId: "principal-owner",
      nodeId: registered.node.nodeId,
      status: "draining",
      slotAvailable: 1,
      labels: ["linux", "gpu", "gpu"],
      workspaceCapabilities: [join(root, "workspace/platform"), join(root, "workspace/shared")],
      credentialCapabilities: ["acct-default", "acct-backup"],
      providerCapabilities: ["gateway-a", "gateway-b"],
      heartbeatTtlSeconds: 90,
      now: "2026-04-12T02:03:00.000Z",
    });

    assert.equal(heartbeat.node.status, "draining");
    assert.equal(heartbeat.node.slotAvailable, 1);
    assert.deepEqual(heartbeat.node.labels, ["linux", "gpu"]);
    assert.deepEqual(heartbeat.node.credentialCapabilities, ["acct-default", "acct-backup"]);
    assert.deepEqual(heartbeat.node.providerCapabilities, ["gateway-a", "gateway-b"]);
    assert.equal(heartbeat.node.heartbeatTtlSeconds, 90);
    assert.equal(heartbeat.node.lastHeartbeatAt, "2026-04-12T02:03:00.000Z");

    const stored = nodeService.getNode("principal-owner", registered.node.nodeId, "2026-04-12T02:03:05.000Z");
    assert.equal(stored?.status, "draining");
    assert.equal(stored?.slotAvailable, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentNodeService 会在读取时把 TTL 过期节点收敛为 offline，后续 heartbeat 默认恢复 online", () => {
  const {
    root,
    registry,
    managedAgentsService,
    nodeService,
  } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      createdAt: "2026-04-12T06:00:00.000Z",
      updatedAt: "2026-04-12T06:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "平台经理",
      departmentRole: "平台工程",
      mission: "负责节点 TTL 收敛验证。",
      now: "2026-04-12T06:01:00.000Z",
    });

    const registered = nodeService.registerNode({
      ownerPrincipalId: "principal-owner",
      organizationId: created.organization.organizationId,
      displayName: "Node TTL",
      slotCapacity: 3,
      slotAvailable: 2,
      heartbeatTtlSeconds: 10,
      now: "2026-04-12T06:02:00.000Z",
    });

    const listed = nodeService.listNodes(
      "principal-owner",
      created.organization.organizationId,
      "2026-04-12T06:02:05.000Z",
    );
    assert.equal(listed[0]?.status, "online");
    assert.equal(listed[0]?.slotAvailable, 2);

    const offlineNode = nodeService.getNode(
      "principal-owner",
      registered.node.nodeId,
      "2026-04-12T06:02:20.500Z",
    );
    assert.equal(offlineNode?.status, "offline");
    assert.equal(offlineNode?.slotAvailable, 0);

    const heartbeat = nodeService.heartbeatNode({
      ownerPrincipalId: "principal-owner",
      nodeId: registered.node.nodeId,
      slotAvailable: 3,
      now: "2026-04-12T06:03:00.000Z",
    });
    assert.equal(heartbeat.node.status, "online");
    assert.equal(heartbeat.node.slotAvailable, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentNodeService 支持显式 draining/offline 治理动作，并返回节点详情里的租约上下文", () => {
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    nodeService,
  } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      createdAt: "2026-04-12T08:00:00.000Z",
      updatedAt: "2026-04-12T08:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "平台经理",
      departmentRole: "平台工程",
      mission: "负责节点治理动作验证。",
      now: "2026-04-12T08:01:00.000Z",
    });

    const registered = nodeService.registerNode({
      ownerPrincipalId: "principal-owner",
      organizationId: created.organization.organizationId,
      displayName: "Node Gov",
      slotCapacity: 2,
      slotAvailable: 1,
      workspaceCapabilities: [root],
      heartbeatTtlSeconds: 300,
      now: "2026-04-12T08:02:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: created.agent.agentId,
      sourcePrincipalId: "principal-owner",
      dispatchReason: "node-governance-test",
      goal: "验证节点治理动作与 detail。",
      now: "2026-04-12T08:03:00.000Z",
    });
    registry.saveManagedAgentNode({
      ...registered.node,
      slotAvailable: 0,
      updatedAt: "2026-04-12T08:04:00.000Z",
    });
    registry.saveAgentRun({
      runId: "run-node-governance-test",
      organizationId: created.organization.organizationId,
      targetAgentId: created.agent.agentId,
      workItemId: dispatched.workItem.workItemId,
      schedulerId: "scheduler-node-governance-test",
      status: "running",
      leaseToken: "run-lease-node-governance-test",
      leaseExpiresAt: "2026-04-12T08:10:00.000Z",
      startedAt: "2026-04-12T08:04:00.000Z",
      lastHeartbeatAt: "2026-04-12T08:04:00.000Z",
      createdAt: "2026-04-12T08:04:00.000Z",
      updatedAt: "2026-04-12T08:04:00.000Z",
    });
    registry.saveAgentExecutionLease({
      leaseId: "execution-lease-node-governance-test",
      runId: "run-node-governance-test",
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: created.agent.agentId,
      nodeId: registered.node.nodeId,
      status: "active",
      leaseToken: "run-lease-node-governance-test",
      leaseExpiresAt: "2026-04-12T08:10:00.000Z",
      lastHeartbeatAt: "2026-04-12T08:04:00.000Z",
      createdAt: "2026-04-12T08:04:00.000Z",
      updatedAt: "2026-04-12T08:04:00.000Z",
    });

    const draining = nodeService.markNodeDraining({
      ownerPrincipalId: "principal-owner",
      nodeId: registered.node.nodeId,
      now: "2026-04-12T08:05:00.000Z",
    });
    assert.equal(draining.node.status, "draining");
    assert.equal(draining.node.slotAvailable, 0);

    const detail = nodeService.getNodeDetailView(
      "principal-owner",
      registered.node.nodeId,
      "2026-04-12T08:05:30.000Z",
    );
    assert.equal(detail?.organization.organizationId, created.organization.organizationId);
    assert.equal(detail?.node.status, "draining");
    assert.equal(detail?.leaseSummary.totalCount, 1);
    assert.equal(detail?.leaseSummary.activeCount, 1);
    assert.equal(detail?.activeExecutionLeases.length, 1);
    assert.equal(detail?.activeExecutionLeases[0]?.lease.nodeId, registered.node.nodeId);
    assert.equal(detail?.activeExecutionLeases[0]?.run?.runId, "run-node-governance-test");
    assert.equal(detail?.activeExecutionLeases[0]?.workItem?.workItemId, dispatched.workItem.workItemId);
    assert.equal(detail?.activeExecutionLeases[0]?.targetAgent?.agentId, created.agent.agentId);

    const offline = nodeService.markNodeOffline({
      ownerPrincipalId: "principal-owner",
      nodeId: registered.node.nodeId,
      now: "2026-04-12T08:06:00.000Z",
    });
    assert.equal(offline.node.status, "offline");
    assert.equal(offline.node.slotAvailable, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentNodeService 支持回收 offline 节点上的 active lease，并区分 requeue 与 waiting preserve", () => {
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    nodeService,
  } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      createdAt: "2026-04-12T09:00:00.000Z",
      updatedAt: "2026-04-12T09:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "平台经理",
      departmentRole: "平台工程",
      mission: "负责 lease reclaim 验证。",
      now: "2026-04-12T09:01:00.000Z",
    });

    const registered = nodeService.registerNode({
      ownerPrincipalId: "principal-owner",
      organizationId: created.organization.organizationId,
      displayName: "Node Reclaim",
      slotCapacity: 2,
      slotAvailable: 0,
      workspaceCapabilities: [root],
      heartbeatTtlSeconds: 300,
      now: "2026-04-12T09:02:00.000Z",
    });

    const runningWorkItem = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: created.agent.agentId,
      sourcePrincipalId: "principal-owner",
      dispatchReason: "node-reclaim-running",
      goal: "验证运行中 work item 被重新排队。",
      now: "2026-04-12T09:03:00.000Z",
    }).workItem;
    registry.saveAgentWorkItem({
      ...runningWorkItem,
      status: "running",
      startedAt: "2026-04-12T09:04:00.000Z",
      updatedAt: "2026-04-12T09:04:00.000Z",
    });
    registry.saveAgentRun({
      runId: "run-node-reclaim-running",
      organizationId: created.organization.organizationId,
      targetAgentId: created.agent.agentId,
      workItemId: runningWorkItem.workItemId,
      schedulerId: "scheduler-node-reclaim-test",
      status: "running",
      leaseToken: "run-lease-node-reclaim-running",
      leaseExpiresAt: "2026-04-12T09:12:00.000Z",
      startedAt: "2026-04-12T09:04:00.000Z",
      lastHeartbeatAt: "2026-04-12T09:04:00.000Z",
      createdAt: "2026-04-12T09:04:00.000Z",
      updatedAt: "2026-04-12T09:04:00.000Z",
    });
    registry.saveAgentExecutionLease({
      leaseId: "execution-lease-node-reclaim-running",
      runId: "run-node-reclaim-running",
      workItemId: runningWorkItem.workItemId,
      targetAgentId: created.agent.agentId,
      nodeId: registered.node.nodeId,
      status: "active",
      leaseToken: "run-lease-node-reclaim-running",
      leaseExpiresAt: "2026-04-12T09:12:00.000Z",
      lastHeartbeatAt: "2026-04-12T09:04:00.000Z",
      createdAt: "2026-04-12T09:04:00.000Z",
      updatedAt: "2026-04-12T09:04:00.000Z",
    });

    const waitingWorkItem = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: created.agent.agentId,
      sourcePrincipalId: "principal-owner",
      dispatchReason: "node-reclaim-waiting",
      goal: "验证等待态保留。",
      now: "2026-04-12T09:05:00.000Z",
    }).workItem;
    registry.saveAgentWorkItem({
      ...waitingWorkItem,
      status: "waiting_human",
      waitingActionRequest: {
        waitingFor: "human",
        prompt: "请确认是否继续",
      },
      startedAt: "2026-04-12T09:06:00.000Z",
      updatedAt: "2026-04-12T09:06:00.000Z",
    });
    registry.saveAgentRun({
      runId: "run-node-reclaim-waiting",
      organizationId: created.organization.organizationId,
      targetAgentId: created.agent.agentId,
      workItemId: waitingWorkItem.workItemId,
      schedulerId: "scheduler-node-reclaim-test",
      status: "waiting_action",
      leaseToken: "run-lease-node-reclaim-waiting",
      leaseExpiresAt: "2026-04-12T09:15:00.000Z",
      startedAt: "2026-04-12T09:06:00.000Z",
      lastHeartbeatAt: "2026-04-12T09:06:00.000Z",
      createdAt: "2026-04-12T09:06:00.000Z",
      updatedAt: "2026-04-12T09:06:00.000Z",
    });
    registry.saveAgentExecutionLease({
      leaseId: "execution-lease-node-reclaim-waiting",
      runId: "run-node-reclaim-waiting",
      workItemId: waitingWorkItem.workItemId,
      targetAgentId: created.agent.agentId,
      nodeId: registered.node.nodeId,
      status: "active",
      leaseToken: "run-lease-node-reclaim-waiting",
      leaseExpiresAt: "2026-04-12T09:15:00.000Z",
      lastHeartbeatAt: "2026-04-12T09:06:00.000Z",
      createdAt: "2026-04-12T09:06:00.000Z",
      updatedAt: "2026-04-12T09:06:00.000Z",
    });

    nodeService.markNodeOffline({
      ownerPrincipalId: "principal-owner",
      nodeId: registered.node.nodeId,
      now: "2026-04-12T09:07:00.000Z",
    });

    const reclaimed = nodeService.reclaimNodeLeases({
      ownerPrincipalId: "principal-owner",
      nodeId: registered.node.nodeId,
      now: "2026-04-12T09:08:00.000Z",
    });

    assert.equal(reclaimed.node.status, "offline");
    assert.equal(reclaimed.node.slotAvailable, 0);
    assert.equal(reclaimed.summary.activeLeaseCount, 2);
    assert.equal(reclaimed.summary.reclaimedRunCount, 2);
    assert.equal(reclaimed.summary.requeuedWorkItemCount, 1);
    assert.equal(reclaimed.summary.preservedWaitingCount, 1);
    assert.equal(reclaimed.summary.revokedLeaseOnlyCount, 0);

    const runningLease = reclaimed.reclaimedLeases.find((item) => item.lease.leaseId === "execution-lease-node-reclaim-running");
    assert.equal(runningLease?.recoveryAction, "requeued");
    assert.equal(runningLease?.lease.status, "revoked");
    assert.equal(runningLease?.run?.status, "interrupted");
    assert.equal(runningLease?.run?.failureCode, "NODE_LEASE_RECLAIMED");
    assert.equal(runningLease?.workItem?.status, "queued");

    const waitingLease = reclaimed.reclaimedLeases.find((item) => item.lease.leaseId === "execution-lease-node-reclaim-waiting");
    assert.equal(waitingLease?.recoveryAction, "waiting_preserved");
    assert.equal(waitingLease?.lease.status, "revoked");
    assert.equal(waitingLease?.run?.status, "interrupted");
    assert.equal(waitingLease?.workItem?.status, "waiting_human");

    const detail = nodeService.getNodeDetailView(
      "principal-owner",
      registered.node.nodeId,
      "2026-04-12T09:08:30.000Z",
    );
    assert.equal(detail?.leaseSummary.activeCount, 0);
    assert.equal(detail?.leaseSummary.revokedCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentNodeService 只允许 owner 操作自己 organization 下的节点", () => {
  const {
    root,
    registry,
    managedAgentsService,
    nodeService,
  } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner-a",
      displayName: "Owner A",
      createdAt: "2026-04-12T03:00:00.000Z",
      updatedAt: "2026-04-12T03:00:00.000Z",
    });
    registry.savePrincipal({
      principalId: "principal-owner-b",
      displayName: "Owner B",
      createdAt: "2026-04-12T03:00:00.000Z",
      updatedAt: "2026-04-12T03:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner-a",
      displayName: "Owner A 平台经理",
      departmentRole: "平台工程",
      mission: "负责节点治理。",
      now: "2026-04-12T03:01:00.000Z",
    });
    managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner-b",
      displayName: "Owner B 平台经理",
      departmentRole: "平台工程",
      mission: "负责别的组织。",
      now: "2026-04-12T03:01:30.000Z",
    });

    const registered = nodeService.registerNode({
      ownerPrincipalId: "principal-owner-a",
      organizationId: created.organization.organizationId,
      displayName: "Node A",
      slotCapacity: 2,
      now: "2026-04-12T03:02:00.000Z",
    });

    assert.throws(
      () => nodeService.listNodes("principal-owner-b", created.organization.organizationId),
      /Organization not found\./,
    );
    assert.throws(
      () => nodeService.heartbeatNode({
        ownerPrincipalId: "principal-owner-b",
        nodeId: registered.node.nodeId,
        status: "offline",
        now: "2026-04-12T03:03:00.000Z",
      }),
      /Organization not found\./,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
