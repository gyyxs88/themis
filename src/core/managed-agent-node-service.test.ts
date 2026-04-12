import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { ManagedAgentsService } from "./managed-agents-service.js";
import { ManagedAgentNodeService } from "./managed-agent-node-service.js";

function createServiceContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-node-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  const managedAgentsService = new ManagedAgentsService({
    registry,
    workingDirectory: root,
  });
  const nodeService = new ManagedAgentNodeService({ registry });

  return {
    root,
    registry,
    managedAgentsService,
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
