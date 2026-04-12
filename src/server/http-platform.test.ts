import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  runtime: CodexTaskRuntime;
  runtimeStore: SqliteCodexSessionRegistry;
}

async function withHttpServer(run: (context: TestServerContext) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-platform-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({ runtime });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  try {
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      runtime,
      runtimeStore,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

async function postJson(
  baseUrl: string,
  pathname: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

test("POST /api/platform/* 会暴露控制面最小主链", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ownerPrincipalId = "principal-platform-owner";
    const now = new Date().toISOString();

    runtimeStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Platform Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const createResponse = await postJson(baseUrl, "/api/platform/agents/create", {
      ownerPrincipalId,
      agent: {
        departmentRole: "平台工程",
        displayName: "平台值班员",
        mission: "负责验证 platform API 原型。",
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json() as {
      organization?: { organizationId?: string };
      principal?: { principalId?: string };
      agent?: { agentId?: string; displayName?: string };
    };
    assert.ok(createPayload.organization?.organizationId);
    assert.ok(createPayload.principal?.principalId);
    assert.ok(createPayload.agent?.agentId);
    assert.equal(createPayload.agent?.displayName, "平台值班员");

    const executionBoundary = runtime.getManagedAgentsService().getManagedAgentExecutionBoundary(
      ownerPrincipalId,
      createPayload.agent?.agentId ?? "",
    );
    assert.ok(executionBoundary);
    const workspaceCapabilities = [
      executionBoundary?.workspacePolicy.workspacePath ?? runtime.getWorkingDirectory(),
      ...(executionBoundary?.workspacePolicy.additionalDirectories ?? []),
    ];
    const credentialCapabilities = executionBoundary?.runtimeProfile.authAccountId
      ? [executionBoundary.runtimeProfile.authAccountId]
      : [];
    const providerCapabilities = executionBoundary?.runtimeProfile.thirdPartyProviderId
      ? [executionBoundary.runtimeProfile.thirdPartyProviderId]
      : [];

    const nodeRegisterResponse = await postJson(baseUrl, "/api/platform/nodes/register", {
      ownerPrincipalId,
      node: {
        organizationId: createPayload.organization?.organizationId,
        displayName: "Platform Node A",
        slotCapacity: 2,
        slotAvailable: 1,
        workspaceCapabilities,
        credentialCapabilities,
        providerCapabilities,
      },
    }, authHeaders);

    assert.equal(nodeRegisterResponse.status, 200);
    const nodeRegisterPayload = await nodeRegisterResponse.json() as {
      node?: { nodeId?: string };
    };
    assert.ok(nodeRegisterPayload.node?.nodeId);

    const listResponse = await postJson(baseUrl, "/api/platform/agents/list", {
      ownerPrincipalId,
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      organizations?: Array<{ organizationId?: string }>;
      agents?: Array<{ agentId?: string; displayName?: string }>;
    };
    assert.equal(listPayload.organizations?.[0]?.organizationId, createPayload.organization?.organizationId);
    assert.deepEqual(
      listPayload.agents?.map((agent) => ({
        agentId: agent.agentId,
        displayName: agent.displayName,
      })),
      [
        {
          agentId: createPayload.agent?.agentId,
          displayName: "平台值班员",
        },
      ],
    );

    const detailResponse = await postJson(baseUrl, "/api/platform/agents/detail", {
      ownerPrincipalId,
      agentId: createPayload.agent?.agentId,
    }, authHeaders);

    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      agent?: { agentId?: string };
      workspacePolicy?: { ownerAgentId?: string };
      runtimeProfile?: { ownerAgentId?: string };
    };
    assert.equal(detailPayload.agent?.agentId, createPayload.agent?.agentId);
    assert.equal(detailPayload.workspacePolicy?.ownerAgentId, createPayload.agent?.agentId);
    assert.equal(detailPayload.runtimeProfile?.ownerAgentId, createPayload.agent?.agentId);

    const dispatchResponse = await postJson(baseUrl, "/api/platform/work-items/dispatch", {
      ownerPrincipalId,
      workItem: {
        targetAgentId: createPayload.agent?.agentId,
        dispatchReason: "platform-smoke",
        goal: "验证 platform work item dispatch 与 detail。",
        contextPacket: { source: "platform-api-smoke" },
      },
    }, authHeaders);

    assert.equal(dispatchResponse.status, 200);
    const dispatchPayload = await dispatchResponse.json() as {
      workItem?: { workItemId?: string; sourcePrincipalId?: string };
    };
    assert.ok(dispatchPayload.workItem?.workItemId);
    assert.equal(dispatchPayload.workItem?.sourcePrincipalId, ownerPrincipalId);

    const workItemDetailResponse = await postJson(baseUrl, "/api/platform/work-items/detail", {
      ownerPrincipalId,
      workItemId: dispatchPayload.workItem?.workItemId,
    }, authHeaders);

    assert.equal(workItemDetailResponse.status, 200);
    const workItemDetailPayload = await workItemDetailResponse.json() as {
      workItem?: { workItemId?: string };
      sourcePrincipal?: { principalId?: string };
      collaboration?: { childSummary?: { totalCount?: number } };
    };
    assert.equal(workItemDetailPayload.workItem?.workItemId, dispatchPayload.workItem?.workItemId);
    assert.equal(workItemDetailPayload.sourcePrincipal?.principalId, ownerPrincipalId);
    assert.equal(workItemDetailPayload.collaboration?.childSummary?.totalCount, 0);

    const claim = runtime.getManagedAgentSchedulerService().claimNextRunnableWorkItem({
      schedulerId: "scheduler-platform-test",
    });
    assert.ok(claim?.run.runId);
    assert.equal(claim?.node?.nodeId, nodeRegisterPayload.node?.nodeId);
    assert.equal(claim?.executionLease?.nodeId, nodeRegisterPayload.node?.nodeId);

    const runListResponse = await postJson(baseUrl, "/api/platform/runs/list", {
      ownerPrincipalId,
      agentId: createPayload.agent?.agentId,
    }, authHeaders);

    assert.equal(runListResponse.status, 200);
    const runListPayload = await runListResponse.json() as {
      runs?: Array<{ runId?: string; targetAgentId?: string }>;
    };
    assert.deepEqual(runListPayload.runs?.map((run) => run.runId), [claim?.run.runId]);
    assert.equal(runListPayload.runs?.[0]?.targetAgentId, createPayload.agent?.agentId);

    const runDetailResponse = await postJson(baseUrl, "/api/platform/runs/detail", {
      ownerPrincipalId,
      runId: claim?.run.runId,
    }, authHeaders);

    assert.equal(runDetailResponse.status, 200);
    const runDetailPayload = await runDetailResponse.json() as {
      run?: { runId?: string };
      workItem?: { workItemId?: string };
      targetAgent?: { agentId?: string };
      executionLease?: { leaseId?: string; nodeId?: string; status?: string };
      node?: { nodeId?: string; displayName?: string };
    };
    assert.equal(runDetailPayload.run?.runId, claim?.run.runId);
    assert.equal(runDetailPayload.workItem?.workItemId, dispatchPayload.workItem?.workItemId);
    assert.equal(runDetailPayload.targetAgent?.agentId, createPayload.agent?.agentId);
    assert.equal(runDetailPayload.executionLease?.nodeId, nodeRegisterPayload.node?.nodeId);
    assert.equal(runDetailPayload.executionLease?.status, "active");
    assert.equal(runDetailPayload.node?.nodeId, nodeRegisterPayload.node?.nodeId);
    assert.equal(runDetailPayload.node?.displayName, "Platform Node A");
  });
});

test("POST /api/platform/nodes/* 会暴露节点注册、续心跳与列表能力", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ownerPrincipalId = "principal-platform-node-owner";
    const now = new Date().toISOString();

    runtimeStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Platform Node Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const createResponse = await postJson(baseUrl, "/api/platform/agents/create", {
      ownerPrincipalId,
      agent: {
        departmentRole: "平台工程",
        displayName: "平台调度员",
        mission: "负责节点与租约的治理。",
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json() as {
      organization?: { organizationId?: string };
    };
    assert.ok(createPayload.organization?.organizationId);

    const registerResponse = await postJson(baseUrl, "/api/platform/nodes/register", {
      ownerPrincipalId,
      node: {
        organizationId: createPayload.organization?.organizationId,
        displayName: "Node A",
        slotCapacity: 4,
        slotAvailable: 3,
        labels: ["linux", "build", "linux"],
        workspaceCapabilities: ["/workspace/platform", "/workspace/platform"],
        credentialCapabilities: ["acct-default"],
        providerCapabilities: ["gateway-a"],
        heartbeatTtlSeconds: 45,
      },
    }, authHeaders);

    assert.equal(registerResponse.status, 200);
    const registerPayload = await registerResponse.json() as {
      node?: {
        nodeId?: string;
        organizationId?: string;
        displayName?: string;
        status?: string;
        slotCapacity?: number;
        slotAvailable?: number;
        labels?: string[];
      };
    };
    assert.ok(registerPayload.node?.nodeId);
    assert.equal(registerPayload.node?.organizationId, createPayload.organization?.organizationId);
    assert.equal(registerPayload.node?.displayName, "Node A");
    assert.equal(registerPayload.node?.status, "online");
    assert.equal(registerPayload.node?.slotCapacity, 4);
    assert.equal(registerPayload.node?.slotAvailable, 3);
    assert.deepEqual(registerPayload.node?.labels, ["linux", "build"]);

    const listResponse = await postJson(baseUrl, "/api/platform/nodes/list", {
      ownerPrincipalId,
      organizationId: createPayload.organization?.organizationId,
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      nodes?: Array<{
        nodeId?: string;
        status?: string;
        slotAvailable?: number;
      }>;
    };
    assert.equal(listPayload.nodes?.length, 1);
    assert.equal(listPayload.nodes?.[0]?.nodeId, registerPayload.node?.nodeId);
    assert.equal(listPayload.nodes?.[0]?.status, "online");
    assert.equal(listPayload.nodes?.[0]?.slotAvailable, 3);

    const heartbeatResponse = await postJson(baseUrl, "/api/platform/nodes/heartbeat", {
      ownerPrincipalId,
      node: {
        nodeId: registerPayload.node?.nodeId,
        status: "draining",
        slotAvailable: 1,
        labels: ["linux", "gpu"],
        workspaceCapabilities: ["/workspace/platform", "/workspace/shared"],
        credentialCapabilities: ["acct-default", "acct-backup"],
        providerCapabilities: ["gateway-a", "gateway-b"],
        heartbeatTtlSeconds: 90,
      },
    }, authHeaders);

    assert.equal(heartbeatResponse.status, 200);
    const heartbeatPayload = await heartbeatResponse.json() as {
      node?: {
        nodeId?: string;
        status?: string;
        slotAvailable?: number;
        labels?: string[];
        credentialCapabilities?: string[];
        providerCapabilities?: string[];
        heartbeatTtlSeconds?: number;
      };
    };
    assert.equal(heartbeatPayload.node?.nodeId, registerPayload.node?.nodeId);
    assert.equal(heartbeatPayload.node?.status, "draining");
    assert.equal(heartbeatPayload.node?.slotAvailable, 1);
    assert.deepEqual(heartbeatPayload.node?.labels, ["linux", "gpu"]);
    assert.deepEqual(heartbeatPayload.node?.credentialCapabilities, ["acct-default", "acct-backup"]);
    assert.deepEqual(heartbeatPayload.node?.providerCapabilities, ["gateway-a", "gateway-b"]);
    assert.equal(heartbeatPayload.node?.heartbeatTtlSeconds, 90);
  });
});

test("POST /api/platform/nodes/detail|drain|offline 会暴露节点治理动作与详情视图", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ownerPrincipalId = "principal-platform-node-governance-owner";
    const now = new Date().toISOString();

    runtimeStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Platform Node Governance Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const createResponse = await postJson(baseUrl, "/api/platform/agents/create", {
      ownerPrincipalId,
      agent: {
        departmentRole: "平台工程",
        displayName: "平台值班经理",
        mission: "负责节点治理动作验证。",
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json() as {
      organization?: { organizationId?: string };
      agent?: { agentId?: string };
    };
    assert.ok(createPayload.organization?.organizationId);
    assert.ok(createPayload.agent?.agentId);

    const executionBoundary = runtime.getManagedAgentsService().getManagedAgentExecutionBoundary(
      ownerPrincipalId,
      createPayload.agent?.agentId ?? "",
    );
    assert.ok(executionBoundary);

    const registerResponse = await postJson(baseUrl, "/api/platform/nodes/register", {
      ownerPrincipalId,
      node: {
        organizationId: createPayload.organization?.organizationId,
        displayName: "Node Gov",
        slotCapacity: 2,
        slotAvailable: 1,
        workspaceCapabilities: [
          executionBoundary?.workspacePolicy.workspacePath ?? runtime.getWorkingDirectory(),
          ...(executionBoundary?.workspacePolicy.additionalDirectories ?? []),
        ],
        credentialCapabilities: executionBoundary?.runtimeProfile.authAccountId
          ? [executionBoundary.runtimeProfile.authAccountId]
          : [],
        providerCapabilities: executionBoundary?.runtimeProfile.thirdPartyProviderId
          ? [executionBoundary.runtimeProfile.thirdPartyProviderId]
          : [],
      },
    }, authHeaders);

    assert.equal(registerResponse.status, 200);
    const registerPayload = await registerResponse.json() as {
      node?: { nodeId?: string };
    };
    assert.ok(registerPayload.node?.nodeId);

    const dispatchResponse = await postJson(baseUrl, "/api/platform/work-items/dispatch", {
      ownerPrincipalId,
      workItem: {
        targetAgentId: createPayload.agent?.agentId,
        dispatchReason: "platform-node-detail-smoke",
        goal: "验证节点 detail 与治理动作。",
      },
    }, authHeaders);
    assert.equal(dispatchResponse.status, 200);

    const claim = runtime.getManagedAgentSchedulerService().claimNextRunnableWorkItem({
      schedulerId: "scheduler-platform-node-governance",
    });
    assert.ok(claim?.executionLease?.leaseId);
    assert.equal(claim?.node?.nodeId, registerPayload.node?.nodeId);

    const detailResponse = await postJson(baseUrl, "/api/platform/nodes/detail", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
    }, authHeaders);
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      organization?: { organizationId?: string };
      node?: { nodeId?: string; status?: string };
      leaseSummary?: { totalCount?: number; activeCount?: number };
      activeExecutionLeases?: Array<{
        lease?: { leaseId?: string; nodeId?: string };
        run?: { runId?: string };
        targetAgent?: { agentId?: string };
      }>;
    };
    assert.equal(detailPayload.organization?.organizationId, createPayload.organization?.organizationId);
    assert.equal(detailPayload.node?.nodeId, registerPayload.node?.nodeId);
    assert.equal(detailPayload.node?.status, "online");
    assert.equal(detailPayload.leaseSummary?.totalCount, 1);
    assert.equal(detailPayload.leaseSummary?.activeCount, 1);
    assert.equal(detailPayload.activeExecutionLeases?.[0]?.lease?.leaseId, claim?.executionLease?.leaseId);
    assert.equal(detailPayload.activeExecutionLeases?.[0]?.lease?.nodeId, registerPayload.node?.nodeId);
    assert.equal(detailPayload.activeExecutionLeases?.[0]?.run?.runId, claim?.run.runId);
    assert.equal(detailPayload.activeExecutionLeases?.[0]?.targetAgent?.agentId, createPayload.agent?.agentId);

    const drainResponse = await postJson(baseUrl, "/api/platform/nodes/drain", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
    }, authHeaders);
    assert.equal(drainResponse.status, 200);
    const drainPayload = await drainResponse.json() as {
      node?: { status?: string };
    };
    assert.equal(drainPayload.node?.status, "draining");

    const offlineResponse = await postJson(baseUrl, "/api/platform/nodes/offline", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
    }, authHeaders);
    assert.equal(offlineResponse.status, 200);
    const offlinePayload = await offlineResponse.json() as {
      node?: { status?: string; slotAvailable?: number };
    };
    assert.equal(offlinePayload.node?.status, "offline");
    assert.equal(offlinePayload.node?.slotAvailable, 0);
  });
});

test("POST /api/platform/worker/runs/* 会暴露节点拉任务与状态回传最小闭环", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ownerPrincipalId = "principal-platform-worker-owner";
    const now = new Date().toISOString();

    runtimeStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Platform Worker Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const createResponse = await postJson(baseUrl, "/api/platform/agents/create", {
      ownerPrincipalId,
      agent: {
        departmentRole: "平台工程",
        displayName: "平台远端执行经理",
        mission: "负责 Worker Node 最小协议验证。",
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json() as {
      organization?: { organizationId?: string };
      agent?: { agentId?: string };
    };
    assert.ok(createPayload.organization?.organizationId);
    assert.ok(createPayload.agent?.agentId);

    const executionBoundary = runtime.getManagedAgentsService().getManagedAgentExecutionBoundary(
      ownerPrincipalId,
      createPayload.agent?.agentId ?? "",
    );
    assert.ok(executionBoundary);

    const registerResponse = await postJson(baseUrl, "/api/platform/nodes/register", {
      ownerPrincipalId,
      node: {
        organizationId: createPayload.organization?.organizationId,
        displayName: "Worker Node A",
        slotCapacity: 2,
        slotAvailable: 1,
        heartbeatTtlSeconds: 86400,
        workspaceCapabilities: [
          executionBoundary?.workspacePolicy.workspacePath ?? runtime.getWorkingDirectory(),
          ...(executionBoundary?.workspacePolicy.additionalDirectories ?? []),
        ],
        credentialCapabilities: executionBoundary?.runtimeProfile.authAccountId
          ? [executionBoundary.runtimeProfile.authAccountId]
          : [],
        providerCapabilities: executionBoundary?.runtimeProfile.thirdPartyProviderId
          ? [executionBoundary.runtimeProfile.thirdPartyProviderId]
          : [],
      },
    }, authHeaders);

    assert.equal(registerResponse.status, 200);
    const registerPayload = await registerResponse.json() as {
      node?: { nodeId?: string };
    };
    assert.ok(registerPayload.node?.nodeId);

    const dispatchResponse = await postJson(baseUrl, "/api/platform/work-items/dispatch", {
      ownerPrincipalId,
      workItem: {
        targetAgentId: createPayload.agent?.agentId,
        dispatchReason: "platform-worker-smoke",
        goal: "验证 Worker 拉任务与状态回传。",
      },
    }, authHeaders);
    assert.equal(dispatchResponse.status, 200);

    const claim = runtime.getManagedAgentSchedulerService().claimNextRunnableWorkItem({
      schedulerId: "scheduler-platform-worker-http-test",
      now: "2026-04-12T12:10:00.000Z",
    });
    assert.ok(claim?.executionLease?.leaseId);

    const pullResponse = await postJson(baseUrl, "/api/platform/worker/runs/pull", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
    }, authHeaders);
    assert.equal(pullResponse.status, 200);
    const pullPayload = await pullResponse.json() as {
      run?: { runId?: string; leaseToken?: string; status?: string };
      executionLease?: { leaseId?: string; nodeId?: string };
      node?: { nodeId?: string };
    };
    assert.equal(pullPayload.run?.runId, claim?.run.runId);
    assert.equal(pullPayload.run?.status, "created");
    assert.equal(pullPayload.executionLease?.leaseId, claim?.executionLease?.leaseId);
    assert.equal(pullPayload.node?.nodeId, registerPayload.node?.nodeId);

    const startingResponse = await postJson(baseUrl, "/api/platform/worker/runs/update", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
      runId: pullPayload.run?.runId,
      leaseToken: claim?.run.leaseToken,
      status: "starting",
    }, authHeaders);
    assert.equal(startingResponse.status, 200);

    const runningResponse = await postJson(baseUrl, "/api/platform/worker/runs/update", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
      runId: pullPayload.run?.runId,
      leaseToken: claim?.run.leaseToken,
      status: "running",
    }, authHeaders);
    assert.equal(runningResponse.status, 200);
    const runningPayload = await runningResponse.json() as {
      run?: { status?: string };
      workItem?: { status?: string };
    };
    assert.equal(runningPayload.run?.status, "running");
    assert.equal(runningPayload.workItem?.status, "running");

    const completeResponse = await postJson(baseUrl, "/api/platform/worker/runs/complete", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
      runId: pullPayload.run?.runId,
      leaseToken: claim?.run.leaseToken,
    }, authHeaders);
    assert.equal(completeResponse.status, 200);
    const completePayload = await completeResponse.json() as {
      run?: { status?: string };
      workItem?: { status?: string };
      executionLease?: { status?: string };
    };
    assert.equal(completePayload.run?.status, "completed");
    assert.equal(completePayload.workItem?.status, "completed");
    assert.equal(completePayload.executionLease?.status, "released");
  });
});

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
