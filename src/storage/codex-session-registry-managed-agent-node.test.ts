import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ManagedAgentCoordinationService } from "../core/managed-agent-coordination-service.js";
import { ManagedAgentsService } from "../core/managed-agents-service.js";
import { ManagedAgentSchedulerService } from "../core/managed-agent-scheduler-service.js";
import { SqliteCodexSessionRegistry } from "./index.js";

function createRegistryContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-agent-node-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  const managedAgentsService = new ManagedAgentsService({
    registry,
    workingDirectory: root,
  });
  const coordinationService = new ManagedAgentCoordinationService({ registry });
  const schedulerService = new ManagedAgentSchedulerService({ registry });

  return {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    schedulerService,
  };
}

test("SqliteCodexSessionRegistry 会持久化 managed agent node 与 execution lease", () => {
  const {
    root,
    registry,
    managedAgentsService,
    coordinationService,
    schedulerService,
  } = createRegistryContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "平台负责人",
      createdAt: "2026-04-12T04:00:00.000Z",
      updatedAt: "2026-04-12T04:00:00.000Z",
    });

    const created = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "平台值班员",
      departmentRole: "平台工程",
      mission: "负责节点与租约落库验证。",
      now: "2026-04-12T04:01:00.000Z",
    });

    registry.saveManagedAgentNode({
      nodeId: "node-platform-a",
      organizationId: created.organization.organizationId,
      displayName: "Platform Node A",
      status: "online",
      slotCapacity: 6,
      slotAvailable: 5,
      labels: ["linux", "ssd"],
      workspaceCapabilities: [join(root, "workspace/platform")],
      credentialCapabilities: ["acct-default"],
      providerCapabilities: ["gateway-a"],
      heartbeatTtlSeconds: 30,
      lastHeartbeatAt: "2026-04-12T04:02:00.000Z",
      createdAt: "2026-04-12T04:02:00.000Z",
      updatedAt: "2026-04-12T04:02:00.000Z",
    });

    const node = registry.getManagedAgentNode("node-platform-a");
    assert.equal(node?.displayName, "Platform Node A");
    assert.deepEqual(node?.labels, ["linux", "ssd"]);

    const listedNodes = registry.listManagedAgentNodesByOrganization(created.organization.organizationId);
    assert.equal(listedNodes.length, 1);
    assert.equal(listedNodes[0]?.nodeId, "node-platform-a");

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: created.agent.agentId,
      dispatchReason: "registry-node-lease-test",
      goal: "验证 execution lease 落库。",
      now: "2026-04-12T04:03:00.000Z",
    });
    const claim = schedulerService.claimNextRunnableWorkItem({
      schedulerId: "scheduler-node-registry-test",
      now: "2026-04-12T04:04:00.000Z",
    });

    assert.ok(claim?.run.runId);

    registry.saveAgentExecutionLease({
      leaseId: "lease-platform-a",
      runId: claim?.run.runId ?? "",
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: created.agent.agentId,
      nodeId: "node-platform-a",
      status: "active",
      leaseToken: "lease-token-platform-a",
      leaseExpiresAt: "2026-04-12T04:05:00.000Z",
      lastHeartbeatAt: "2026-04-12T04:04:30.000Z",
      createdAt: "2026-04-12T04:04:00.000Z",
      updatedAt: "2026-04-12T04:04:30.000Z",
    });

    const activeLease = registry.getActiveAgentExecutionLeaseByRun(claim?.run.runId ?? "");
    assert.equal(activeLease?.leaseId, "lease-platform-a");
    assert.equal(activeLease?.nodeId, "node-platform-a");

    const byRun = registry.listAgentExecutionLeasesByRun(claim?.run.runId ?? "");
    assert.equal(byRun.length, 1);
    assert.equal(byRun[0]?.status, "active");

    const byNode = registry.listAgentExecutionLeasesByNode("node-platform-a");
    assert.equal(byNode.length, 1);
    assert.equal(byNode[0]?.runId, claim?.run.runId);

    registry.saveAgentExecutionLease({
      leaseId: "lease-platform-a",
      runId: claim?.run.runId ?? "",
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: created.agent.agentId,
      nodeId: "node-platform-a",
      status: "released",
      leaseToken: "lease-token-platform-a",
      leaseExpiresAt: "2026-04-12T04:05:00.000Z",
      lastHeartbeatAt: "2026-04-12T04:04:45.000Z",
      createdAt: "2026-04-12T04:04:00.000Z",
      updatedAt: "2026-04-12T04:05:00.000Z",
    });

    assert.equal(registry.getActiveAgentExecutionLeaseByRun(claim?.run.runId ?? ""), null);
    const releasedLease = registry.getAgentExecutionLease("lease-platform-a");
    assert.equal(releasedLease?.status, "released");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
