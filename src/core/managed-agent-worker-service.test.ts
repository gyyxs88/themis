import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { ManagedAgentCoordinationService } from "./managed-agent-coordination-service.js";
import { ManagedAgentsService } from "./managed-agents-service.js";
import { ManagedAgentSchedulerService } from "./managed-agent-scheduler-service.js";
import { ManagedAgentWorkerService } from "./managed-agent-worker-service.js";

function createServiceContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-worker-service-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const managedAgentsService = new ManagedAgentsService({
    registry,
    workingDirectory: root,
  });
  const coordinationService = new ManagedAgentCoordinationService({ registry });
  const schedulerService = new ManagedAgentSchedulerService({
    registry,
    leaseTtlMs: 60_000,
  });
  const workerService = new ManagedAgentWorkerService({
    registry,
    schedulerService,
  });

  return {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    schedulerService,
    workerService,
  };
}

test("ManagedAgentWorkerService 会拉取分配给节点的 created run，并允许节点回传 running/completed", () => {
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    schedulerService,
    workerService,
  } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      createdAt: "2026-04-12T10:00:00.000Z",
      updatedAt: "2026-04-12T10:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端经理",
      departmentRole: "后端",
      mission: "负责 Worker Node 协议验证。",
      now: "2026-04-12T10:01:00.000Z",
    });

    const registeredNode = registry.saveManagedAgentNode({
      nodeId: "node-worker-a",
      organizationId: created.organization.organizationId,
      displayName: "Worker Node A",
      status: "online",
      slotCapacity: 2,
      slotAvailable: 1,
      labels: ["linux"],
      workspaceCapabilities: [root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-12T10:01:30.000Z",
      createdAt: "2026-04-12T10:01:30.000Z",
      updatedAt: "2026-04-12T10:01:30.000Z",
    });
    void registeredNode;

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: created.agent.agentId,
      dispatchReason: "worker-protocol-test",
      goal: "验证 Worker 拉任务与状态回传。",
      now: "2026-04-12T10:02:00.000Z",
    });

    const claim = schedulerService.claimNextRunnableWorkItem({
      schedulerId: "scheduler-worker-protocol",
      now: "2026-04-12T10:03:00.000Z",
    });
    assert.equal(claim?.node?.nodeId, "node-worker-a");
    assert.equal(claim?.executionLease?.status, "active");

    const pulled = workerService.pullAssignedRun({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      now: "2026-04-12T10:03:10.000Z",
    });
    assert.equal(pulled?.run.runId, claim?.run.runId);
    assert.equal(pulled?.executionLease.leaseId, claim?.executionLease?.leaseId);
    assert.equal(pulled?.workItem.workItemId, dispatched.workItem.workItemId);

    const starting = workerService.updateRunStatus({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      runId: claim?.run.runId ?? "",
      leaseToken: claim?.run.leaseToken ?? "",
      status: "starting",
      now: "2026-04-12T10:03:20.000Z",
    });
    assert.equal(starting.run.status, "starting");

    const running = workerService.updateRunStatus({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      runId: claim?.run.runId ?? "",
      leaseToken: claim?.run.leaseToken ?? "",
      status: "running",
      now: "2026-04-12T10:03:30.000Z",
    });
    assert.equal(running.run.status, "running");
    assert.equal(running.workItem.status, "running");

    const completed = workerService.completeRun({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      runId: claim?.run.runId ?? "",
      leaseToken: claim?.run.leaseToken ?? "",
      now: "2026-04-12T10:04:00.000Z",
    });
    assert.equal(completed.run.status, "completed");
    assert.equal(completed.workItem.status, "completed");
    assert.equal(completed.executionLease.status, "released");
    assert.equal(registry.getManagedAgentNode("node-worker-a")?.slotAvailable, 1);

    const pulledAgain = workerService.pullAssignedRun({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      now: "2026-04-12T10:04:10.000Z",
    });
    assert.equal(pulledAgain, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentWorkerService 只会拉取本节点 active lease 对应的 created run，并拒绝错误节点更新", () => {
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    schedulerService,
    workerService,
  } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      createdAt: "2026-04-12T11:00:00.000Z",
      updatedAt: "2026-04-12T11:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端经理",
      departmentRole: "后端",
      mission: "负责 Worker Node 拒绝非法更新。",
      now: "2026-04-12T11:01:00.000Z",
    });

    registry.saveManagedAgentNode({
      nodeId: "node-worker-a",
      organizationId: created.organization.organizationId,
      displayName: "Worker Node A",
      status: "online",
      slotCapacity: 2,
      slotAvailable: 1,
      labels: ["linux"],
      workspaceCapabilities: [root],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-12T11:01:30.000Z",
      createdAt: "2026-04-12T11:01:30.000Z",
      updatedAt: "2026-04-12T11:01:30.000Z",
    });
    registry.saveManagedAgentNode({
      nodeId: "node-worker-b",
      organizationId: created.organization.organizationId,
      displayName: "Worker Node B",
      status: "online",
      slotCapacity: 2,
      slotAvailable: 2,
      labels: ["linux"],
      workspaceCapabilities: [join(root, "other-workspace")],
      credentialCapabilities: [],
      providerCapabilities: [],
      heartbeatTtlSeconds: 300,
      lastHeartbeatAt: "2026-04-12T11:01:40.000Z",
      createdAt: "2026-04-12T11:01:40.000Z",
      updatedAt: "2026-04-12T11:01:40.000Z",
    });

    coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: created.agent.agentId,
      dispatchReason: "worker-protocol-filter",
      goal: "验证只会拉取本节点 created run。",
      now: "2026-04-12T11:02:00.000Z",
    });

    const claim = schedulerService.claimNextRunnableWorkItem({
      schedulerId: "scheduler-worker-protocol-filter",
      now: "2026-04-12T11:03:00.000Z",
    });
    assert.equal(claim?.node?.nodeId, "node-worker-a");

    workerService.updateRunStatus({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      runId: claim?.run.runId ?? "",
      leaseToken: claim?.run.leaseToken ?? "",
      status: "starting",
      now: "2026-04-12T11:03:10.000Z",
    });

    const noCreatedRun = workerService.pullAssignedRun({
      ownerPrincipalId: "principal-owner",
      nodeId: "node-worker-a",
      now: "2026-04-12T11:03:20.000Z",
    });
    assert.equal(noCreatedRun, null);

    assert.throws(
      () => workerService.updateRunStatus({
        ownerPrincipalId: "principal-owner",
        nodeId: "node-worker-b",
        runId: claim?.run.runId ?? "",
        leaseToken: claim?.run.leaseToken ?? "",
        status: "running",
        now: "2026-04-12T11:03:30.000Z",
      }),
      /Execution lease does not belong to the node\./,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
