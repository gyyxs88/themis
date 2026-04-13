import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { createManagedAgentControlPlaneStoreFromEnv, THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE_ENV_KEY } from "../core/managed-agent-control-plane-bootstrap.js";
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

test("createThemisHttpServer 会优先复用 runtimeRegistry 里的 app-server runtime 作为平台控制面", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-platform-runtime-registry-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const controlPlaneStore = createManagedAgentControlPlaneStoreFromEnv({
    workingDirectory: root,
    runtimeStore,
    env: {
      [THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE_ENV_KEY]: "infra/platform/control-plane.db",
    },
  });
  const appServerRuntime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
    managedAgentControlPlaneStore: controlPlaneStore,
  });
  const server = createThemisHttpServer({
    runtime,
    runtimeRegistry: {
      defaultRuntime: appServerRuntime,
      runtimes: {
        sdk: runtime,
        "app-server": appServerRuntime,
      },
    },
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
  const ownerPrincipalId = "principal-platform-owner";
  const now = new Date().toISOString();

  try {
    controlPlaneStore.managedAgentsStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Platform Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const response = await postJson(baseUrl, "/api/platform/agents/create", {
      ownerPrincipalId,
      agent: {
        departmentRole: "平台工程",
        displayName: "平台运行时",
        mission: "验证 server 会复用外部 app-server runtime。",
      },
    }, authHeaders);

    assert.equal(response.status, 200);
    assert.equal(runtimeStore.listManagedAgentsByOwnerPrincipal(ownerPrincipalId).length, 0);
    assert.equal(controlPlaneStore.managedAgentsStore.listManagedAgentsByOwnerPrincipal(ownerPrincipalId).length, 1);
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

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

async function createPlatformManagedAgent(
  baseUrl: string,
  headers: Record<string, string>,
  ownerPrincipalId: string,
  agent: {
    departmentRole: string;
    displayName?: string;
    mission?: string;
    organizationId?: string;
    supervisorAgentId?: string;
  },
): Promise<{
  organizationId: string;
  principalId: string;
  agentId: string;
}> {
  const response = await postJson(baseUrl, "/api/platform/agents/create", {
    ownerPrincipalId,
    agent,
  }, headers);

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    organization?: { organizationId?: string };
    principal?: { principalId?: string };
    agent?: { agentId?: string };
  };

  assert.ok(payload.organization?.organizationId);
  assert.ok(payload.principal?.principalId);
  assert.ok(payload.agent?.agentId);

  return {
    organizationId: payload.organization.organizationId as string,
    principalId: payload.principal.principalId as string,
    agentId: payload.agent.agentId as string,
  };
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

test("platform surface 不再复用主 Themis Web 静态页面", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-platform-surface-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({
    runtime,
    surface: "platform",
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const homeResponse = await fetch(`${baseUrl}/`, {
      headers: authHeaders,
    });
    assert.equal(homeResponse.status, 200);
    assert.match(homeResponse.headers.get("content-type") ?? "", /^text\/html\b/i);
    const homeHtml = await homeResponse.text();
    assert.match(homeHtml, /Themis Platform/);
    assert.match(homeHtml, /平台控制面入口占位页/);
    assert.equal(homeHtml.includes("Themis Workspace"), false);

    const assetResponse = await fetch(`${baseUrl}/styles.css`, {
      headers: authHeaders,
    });
    assert.equal(assetResponse.status, 404);
    assert.deepEqual(await assetResponse.json(), {
      error: {
        code: "NOT_FOUND",
        message: "Unknown platform asset: /styles.css",
      },
    });

    const healthResponse = await fetch(`${baseUrl}/api/health`, {
      headers: authHeaders,
    });
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      service: "themis-platform",
    });

    const blockedRuntimeConfigResponse = await fetch(`${baseUrl}/api/runtime/config`, {
      headers: authHeaders,
    });
    assert.equal(blockedRuntimeConfigResponse.status, 404);
    assert.deepEqual(await blockedRuntimeConfigResponse.json(), {
      error: {
        code: "PLATFORM_ROUTE_NOT_FOUND",
        message: "Platform surface does not expose /api/runtime/config.",
      },
    });

    const blockedTaskResponse = await fetch(`${baseUrl}/api/tasks/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "should-be-blocked",
      }),
    });
    assert.equal(blockedTaskResponse.status, 404);
    assert.deepEqual(await blockedTaskResponse.json(), {
      error: {
        code: "PLATFORM_ROUTE_NOT_FOUND",
        message: "Platform surface does not expose /api/tasks/run.",
      },
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("POST /api/platform/projects/workspace-binding/* 会持久化项目连续性，并让 dispatch 命中 projectId", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ownerPrincipalId = "principal-platform-project-owner";
    const now = new Date().toISOString();

    runtimeStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Project Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const created = await createPlatformManagedAgent(baseUrl, authHeaders, ownerPrincipalId, {
      departmentRole: "前端",
      displayName: "前端·澄",
      mission: "负责官网 site-foo。",
    });
    const boundary = runtime.getManagedAgentsService().getManagedAgentExecutionBoundary(
      ownerPrincipalId,
      created.agentId,
    );
    const nodeRegisterResponse = await postJson(baseUrl, "/api/platform/nodes/register", {
      ownerPrincipalId,
      node: {
        organizationId: created.organizationId,
        displayName: "Site Node A",
        slotCapacity: 1,
        workspaceCapabilities: [boundary?.workspacePolicy.workspacePath ?? runtime.getWorkingDirectory()],
      },
    }, authHeaders);
    assert.equal(nodeRegisterResponse.status, 200);
    const nodeRegisterPayload = await nodeRegisterResponse.json() as {
      node?: { nodeId?: string };
    };
    assert.ok(nodeRegisterPayload.node?.nodeId);

    const upsertResponse = await postJson(baseUrl, "/api/platform/projects/workspace-binding/upsert", {
      ownerPrincipalId,
      binding: {
        projectId: "project-site-foo",
        displayName: "官网 site-foo",
        organizationId: created.organizationId,
        owningAgentId: created.agentId,
        workspacePolicyId: boundary?.workspacePolicy.policyId,
        preferredNodeId: nodeRegisterPayload.node?.nodeId,
        continuityMode: "sticky",
      },
    }, authHeaders);

    assert.equal(upsertResponse.status, 200);
    const upsertPayload = await upsertResponse.json() as {
      binding?: {
        projectId?: string;
        workspacePolicyId?: string;
        canonicalWorkspacePath?: string;
        preferredNodeId?: string;
      };
    };
    assert.equal(upsertPayload.binding?.projectId, "project-site-foo");
    assert.equal(upsertPayload.binding?.workspacePolicyId, boundary?.workspacePolicy.policyId);
    assert.equal(upsertPayload.binding?.canonicalWorkspacePath, boundary?.workspacePolicy.workspacePath);
    assert.equal(upsertPayload.binding?.preferredNodeId, nodeRegisterPayload.node?.nodeId);

    const listResponse = await postJson(baseUrl, "/api/platform/projects/workspace-binding/list", {
      ownerPrincipalId,
    }, authHeaders);
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      bindings?: Array<{ projectId?: string }>;
    };
    assert.equal(listPayload.bindings?.[0]?.projectId, "project-site-foo");

    const detailResponse = await postJson(baseUrl, "/api/platform/projects/workspace-binding/detail", {
      ownerPrincipalId,
      projectId: "project-site-foo",
    }, authHeaders);
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      binding?: { displayName?: string };
    };
    assert.equal(detailPayload.binding?.displayName, "官网 site-foo");

    const dispatchResponse = await postJson(baseUrl, "/api/platform/work-items/dispatch", {
      ownerPrincipalId,
      workItem: {
        targetAgentId: created.agentId,
        projectId: "project-site-foo",
        dispatchReason: "continue-site-foo",
        goal: "继续在原项目工作区推进开发。",
      },
    }, authHeaders);
    assert.equal(dispatchResponse.status, 200);
    const dispatchPayload = await dispatchResponse.json() as {
      workItem?: {
        projectId?: string;
        workspacePolicySnapshot?: { workspacePath?: string };
      };
    };
    assert.equal(dispatchPayload.workItem?.projectId, "project-site-foo");
    assert.equal(dispatchPayload.workItem?.workspacePolicySnapshot?.workspacePath, boundary?.workspacePolicy.workspacePath);
  });
});

test("POST /api/platform/agents 写治理接口会暴露执行边界、spawn policy 与 lifecycle 变更", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ownerPrincipalId = "principal-platform-agent-write-owner";
    const now = new Date().toISOString();

    runtimeStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Platform Agent Write Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const agent = await createPlatformManagedAgent(baseUrl, authHeaders, ownerPrincipalId, {
      departmentRole: "平台工程",
      displayName: "平台编排",
      mission: "负责验证 platform 写治理接口。",
    });
    runtimeStore.saveAuthAccount({
      accountId: "acct-platform-write",
      label: "Platform 写接口账号",
      codexHome: join(runtime.getWorkingDirectory(), "infra/local/codex-auth/acct-platform-write"),
      isActive: true,
      createdAt: "2026-04-12T11:59:00.000Z",
      updatedAt: "2026-04-12T11:59:00.000Z",
    });

    const workspacePath = join(runtime.getWorkingDirectory(), "workspace/platform-write-agent");
    const sharedPath = join(runtime.getWorkingDirectory(), "workspace/platform-write-shared");
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(sharedPath, { recursive: true });

    const boundaryResponse = await postJson(baseUrl, "/api/platform/agents/execution-boundary/update", {
      ownerPrincipalId,
      agentId: agent.agentId,
      boundary: {
        workspacePolicy: {
          workspacePath,
          additionalDirectories: [sharedPath],
          allowNetworkAccess: false,
        },
        runtimeProfile: {
          accessMode: "auth",
          authAccountId: "acct-platform-write",
          model: "gpt-5.4-mini",
          sandboxMode: "danger-full-access",
          approvalPolicy: "on-request",
          webSearchMode: "disabled",
          networkAccessEnabled: false,
        },
      },
    }, authHeaders);
    assert.equal(boundaryResponse.status, 200);
    const boundaryPayload = await boundaryResponse.json() as {
      workspacePolicy?: { workspacePath?: string; additionalDirectories?: string[]; allowNetworkAccess?: boolean };
      runtimeProfile?: {
        accessMode?: string;
        authAccountId?: string;
        model?: string;
        sandboxMode?: string;
        approvalPolicy?: string;
        webSearchMode?: string;
        networkAccessEnabled?: boolean;
      };
    };
    assert.equal(boundaryPayload.workspacePolicy?.workspacePath, workspacePath);
    assert.deepEqual(boundaryPayload.workspacePolicy?.additionalDirectories, [sharedPath]);
    assert.equal(boundaryPayload.workspacePolicy?.allowNetworkAccess, false);
    assert.equal(boundaryPayload.runtimeProfile?.accessMode, "auth");
    assert.equal(boundaryPayload.runtimeProfile?.authAccountId, "acct-platform-write");
    assert.equal(boundaryPayload.runtimeProfile?.model, "gpt-5.4-mini");
    assert.equal(boundaryPayload.runtimeProfile?.sandboxMode, "danger-full-access");
    assert.equal(boundaryPayload.runtimeProfile?.approvalPolicy, "on-request");
    assert.equal(boundaryPayload.runtimeProfile?.webSearchMode, "disabled");
    assert.equal(boundaryPayload.runtimeProfile?.networkAccessEnabled, false);

    const spawnPolicyResponse = await postJson(baseUrl, "/api/platform/agents/spawn-policy/update", {
      ownerPrincipalId,
      policy: {
        organizationId: agent.organizationId,
        maxActiveAgents: 4,
        maxActiveAgentsPerRole: 2,
      },
    }, authHeaders);
    assert.equal(spawnPolicyResponse.status, 200);
    const spawnPolicyPayload = await spawnPolicyResponse.json() as {
      policy?: {
        organizationId?: string;
        maxActiveAgents?: number;
        maxActiveAgentsPerRole?: number;
      };
    };
    assert.equal(spawnPolicyPayload.policy?.organizationId, agent.organizationId);
    assert.equal(spawnPolicyPayload.policy?.maxActiveAgents, 4);
    assert.equal(spawnPolicyPayload.policy?.maxActiveAgentsPerRole, 2);

    const pauseResponse = await postJson(baseUrl, "/api/platform/agents/pause", {
      ownerPrincipalId,
      agentId: agent.agentId,
    }, authHeaders);
    assert.equal(pauseResponse.status, 200);
    const pausePayload = await pauseResponse.json() as {
      agent?: { agentId?: string; status?: string };
    };
    assert.equal(pausePayload.agent?.agentId, agent.agentId);
    assert.equal(pausePayload.agent?.status, "paused");

    const resumeResponse = await postJson(baseUrl, "/api/platform/agents/resume", {
      ownerPrincipalId,
      agentId: agent.agentId,
    }, authHeaders);
    assert.equal(resumeResponse.status, 200);
    const resumePayload = await resumeResponse.json() as {
      agent?: { status?: string };
    };
    assert.equal(resumePayload.agent?.status, "active");

    const archiveResponse = await postJson(baseUrl, "/api/platform/agents/archive", {
      ownerPrincipalId,
      agentId: agent.agentId,
    }, authHeaders);
    assert.equal(archiveResponse.status, 200);
    const archivePayload = await archiveResponse.json() as {
      agent?: { status?: string };
    };
    assert.equal(archivePayload.agent?.status, "archived");
  });
});

test("POST /api/platform 扩展治理读接口会暴露 waiting、collaboration、mailbox 与 handoff 事实", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ownerPrincipalId = "principal-platform-read-owner";
    const now = new Date().toISOString();

    runtimeStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Platform Read Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const managerCreateResponse = await postJson(baseUrl, "/api/platform/agents/create", {
      ownerPrincipalId,
      agent: {
        departmentRole: "管理",
        displayName: "平台经理",
        mission: "负责父任务治理。",
      },
    }, authHeaders);
    assert.equal(managerCreateResponse.status, 200);
    const managerCreatePayload = await managerCreateResponse.json() as {
      organization?: { organizationId?: string };
      principal?: { principalId?: string };
      agent?: { agentId?: string };
    };
    assert.ok(managerCreatePayload.organization?.organizationId);
    assert.ok(managerCreatePayload.principal?.principalId);
    assert.ok(managerCreatePayload.agent?.agentId);

    const workerCreateResponse = await postJson(baseUrl, "/api/platform/agents/create", {
      ownerPrincipalId,
      agent: {
        departmentRole: "执行",
        displayName: "平台执行",
        mission: "负责子任务执行。",
        organizationId: managerCreatePayload.organization?.organizationId,
      },
    }, authHeaders);
    assert.equal(workerCreateResponse.status, 200);
    const workerCreatePayload = await workerCreateResponse.json() as {
      principal?: { principalId?: string };
      agent?: { agentId?: string };
    };
    assert.ok(workerCreatePayload.principal?.principalId);
    assert.ok(workerCreatePayload.agent?.agentId);

    const parentDispatchResponse = await postJson(baseUrl, "/api/platform/work-items/dispatch", {
      ownerPrincipalId,
      workItem: {
        targetAgentId: managerCreatePayload.agent?.agentId,
        dispatchReason: "platform-parent",
        goal: "创建一个父任务用于治理读面验证。",
      },
    }, authHeaders);
    assert.equal(parentDispatchResponse.status, 200);
    const parentDispatchPayload = await parentDispatchResponse.json() as {
      workItem?: { workItemId?: string };
    };
    assert.ok(parentDispatchPayload.workItem?.workItemId);

    const childDispatchResponse = await postJson(baseUrl, "/api/platform/work-items/dispatch", {
      ownerPrincipalId,
      workItem: {
        targetAgentId: workerCreatePayload.agent?.agentId,
        sourceType: "agent",
        sourceAgentId: managerCreatePayload.agent?.agentId,
        sourcePrincipalId: managerCreatePayload.principal?.principalId,
        parentWorkItemId: parentDispatchPayload.workItem?.workItemId,
        dispatchReason: "platform-child",
        goal: "创建一个需要等待人工决策的子任务。",
      },
    }, authHeaders);
    assert.equal(childDispatchResponse.status, 200);
    const childDispatchPayload = await childDispatchResponse.json() as {
      mailboxEntry?: { mailboxEntryId?: string };
      workItem?: { workItemId?: string };
    };
    assert.ok(childDispatchPayload.mailboxEntry?.mailboxEntryId);
    assert.ok(childDispatchPayload.workItem?.workItemId);

    runtime.getManagedAgentCoordinationService().createAgentHandoff({
      ownerPrincipalId,
      fromAgentId: managerCreatePayload.agent?.agentId ?? "",
      toAgentId: workerCreatePayload.agent?.agentId ?? "",
      workItemId: childDispatchPayload.workItem?.workItemId ?? "",
      summary: "平台经理已补齐上下文并交接给执行 agent。",
      blockers: ["等待人工确认"],
      recommendedNextActions: ["确认执行边界", "恢复执行"],
    });

    const workerBoundary = runtime.getManagedAgentsService().getManagedAgentExecutionBoundary(
      ownerPrincipalId,
      workerCreatePayload.agent?.agentId ?? "",
    );
    assert.ok(workerBoundary);
    const workerWorkspaceCapabilities = [
      workerBoundary?.workspacePolicy.workspacePath ?? runtime.getWorkingDirectory(),
      ...(workerBoundary?.workspacePolicy.additionalDirectories ?? []),
    ];
    const workerCredentialCapabilities = workerBoundary?.runtimeProfile.authAccountId
      ? [workerBoundary.runtimeProfile.authAccountId]
      : [];
    const workerProviderCapabilities = workerBoundary?.runtimeProfile.thirdPartyProviderId
      ? [workerBoundary.runtimeProfile.thirdPartyProviderId]
      : [];
    const nodeRegisterResult = runtime.getManagedAgentControlPlaneFacade().registerNode({
      ownerPrincipalId,
      organizationId: managerCreatePayload.organization?.organizationId,
      displayName: "Platform Read Node",
      slotCapacity: 1,
      slotAvailable: 1,
      workspaceCapabilities: workerWorkspaceCapabilities,
      credentialCapabilities: workerCredentialCapabilities,
      providerCapabilities: workerProviderCapabilities,
    });
    const claimed = runtime.getManagedAgentSchedulerService().tick({
      schedulerId: "scheduler-platform-read",
      targetAgentId: workerCreatePayload.agent?.agentId,
      now: "2026-04-12T13:00:00.000Z",
    }).claimed;
    assert.ok(claimed?.run.runId);
    assert.equal(claimed?.workItem.workItemId, childDispatchPayload.workItem?.workItemId);

    const executionLease = claimed?.executionLease;
    assert.ok(executionLease?.leaseToken);
    runtime.getManagedAgentControlPlaneFacade().updateWorkerRunStatus({
      ownerPrincipalId,
      nodeId: nodeRegisterResult.node.nodeId,
      runId: claimed?.run.runId ?? "",
      leaseToken: executionLease?.leaseToken ?? "",
      status: "waiting_human",
      waitingAction: {
        actionType: "approval_request",
        message: "请顶层治理确认执行边界。",
      },
      now: "2026-04-12T13:01:00.000Z",
    });

    const spawnSuggestionsResponse = await postJson(baseUrl, "/api/platform/agents/spawn-suggestions", {
      ownerPrincipalId,
    }, authHeaders);
    assert.equal(spawnSuggestionsResponse.status, 200);
    const spawnSuggestionsPayload = await spawnSuggestionsResponse.json() as {
      suggestions?: unknown[];
      recentAuditLogs?: unknown[];
    };
    assert.ok(Array.isArray(spawnSuggestionsPayload.suggestions));
    assert.ok(Array.isArray(spawnSuggestionsPayload.recentAuditLogs));

    const idleSuggestionsResponse = await postJson(baseUrl, "/api/platform/agents/idle-suggestions", {
      ownerPrincipalId,
    }, authHeaders);
    assert.equal(idleSuggestionsResponse.status, 200);
    const idleSuggestionsPayload = await idleSuggestionsResponse.json() as {
      suggestions?: unknown[];
      recentAuditLogs?: unknown[];
    };
    assert.ok(Array.isArray(idleSuggestionsPayload.suggestions));
    assert.ok(Array.isArray(idleSuggestionsPayload.recentAuditLogs));

    const waitingResponse = await postJson(baseUrl, "/api/platform/agents/waiting/list", {
      ownerPrincipalId,
      waitingFor: "human",
    }, authHeaders);
    assert.equal(waitingResponse.status, 200);
    const waitingPayload = await waitingResponse.json() as {
      summary?: { waitingHumanCount?: number };
      items?: Array<{ workItem?: { workItemId?: string } }>;
    };
    assert.equal(waitingPayload.summary?.waitingHumanCount, 1);
    assert.equal(waitingPayload.items?.[0]?.workItem?.workItemId, childDispatchPayload.workItem?.workItemId);

    const overviewResponse = await postJson(baseUrl, "/api/platform/agents/governance-overview", {
      ownerPrincipalId,
      waitingFor: "human",
    }, authHeaders);
    assert.equal(overviewResponse.status, 200);
    const overviewPayload = await overviewResponse.json() as {
      overview?: { waitingHumanCount?: number; managerHotspots?: Array<{ managerAgent?: { agentId?: string } }> };
    };
    assert.equal(overviewPayload.overview?.waitingHumanCount, 1);
    assert.equal(
      overviewPayload.overview?.managerHotspots?.[0]?.managerAgent?.agentId,
      managerCreatePayload.agent?.agentId,
    );

    const collaborationResponse = await postJson(baseUrl, "/api/platform/agents/collaboration-dashboard", {
      ownerPrincipalId,
      waitingFor: "human",
    }, authHeaders);
    assert.equal(collaborationResponse.status, 200);
    const collaborationPayload = await collaborationResponse.json() as {
      items?: Array<{ parentWorkItem?: { workItemId?: string } }>;
    };
    assert.equal(
      collaborationPayload.items?.[0]?.parentWorkItem?.workItemId,
      parentDispatchPayload.workItem?.workItemId,
    );

    const workItemsResponse = await postJson(baseUrl, "/api/platform/work-items/list", {
      ownerPrincipalId,
      agentId: workerCreatePayload.agent?.agentId,
    }, authHeaders);
    assert.equal(workItemsResponse.status, 200);
    const workItemsPayload = await workItemsResponse.json() as {
      workItems?: Array<{ workItemId?: string; status?: string }>;
    };
    assert.equal(workItemsPayload.workItems?.[0]?.workItemId, childDispatchPayload.workItem?.workItemId);
    assert.equal(workItemsPayload.workItems?.[0]?.status, "waiting_human");

    const mailboxResponse = await postJson(baseUrl, "/api/platform/agents/mailbox/list", {
      ownerPrincipalId,
      agentId: workerCreatePayload.agent?.agentId,
    }, authHeaders);
    assert.equal(mailboxResponse.status, 200);
    const mailboxPayload = await mailboxResponse.json() as {
      agent?: { agentId?: string };
      items?: Array<{ entry?: { mailboxEntryId?: string } }>;
    };
    assert.equal(mailboxPayload.agent?.agentId, workerCreatePayload.agent?.agentId);
    assert.equal(mailboxPayload.items?.[0]?.entry?.mailboxEntryId, childDispatchPayload.mailboxEntry?.mailboxEntryId);

    const handoffResponse = await postJson(baseUrl, "/api/platform/agents/handoffs/list", {
      ownerPrincipalId,
      agentId: workerCreatePayload.agent?.agentId,
    }, authHeaders);
    assert.equal(handoffResponse.status, 200);
    const handoffPayload = await handoffResponse.json() as {
      agent?: { agentId?: string };
      handoffs?: Array<{ summary?: string }>;
      timeline?: Array<{ kind?: string }>;
    };
    assert.equal(handoffPayload.agent?.agentId, workerCreatePayload.agent?.agentId);
    assert.equal(handoffPayload.handoffs?.[0]?.summary, "平台经理已补齐上下文并交接给执行 agent。");
    assert.equal(handoffPayload.timeline?.[0]?.kind, "handoff");
  });
});

test("POST /api/platform/work-items/* 与 mailbox 写接口会暴露协作收口动作", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ownerPrincipalId = "principal-platform-workflow-write-owner";
    const now = new Date().toISOString();

    runtimeStore.savePrincipal({
      principalId: ownerPrincipalId,
      displayName: "Platform Workflow Write Owner",
      kind: "human_user",
      createdAt: now,
      updatedAt: now,
    });

    const manager = await createPlatformManagedAgent(baseUrl, authHeaders, ownerPrincipalId, {
      departmentRole: "管理",
      displayName: "平台经理",
      mission: "负责协作治理。",
    });
    const backend = await createPlatformManagedAgent(baseUrl, authHeaders, ownerPrincipalId, {
      departmentRole: "后端",
      displayName: "平台后端",
      mission: "负责服务端执行。",
      organizationId: manager.organizationId,
    });
    const frontend = await createPlatformManagedAgent(baseUrl, authHeaders, ownerPrincipalId, {
      departmentRole: "前端",
      displayName: "平台前端",
      mission: "负责界面确认。",
      organizationId: manager.organizationId,
    });

    const waitingHuman = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId,
      targetAgentId: backend.agentId,
      dispatchReason: "等待人工审批",
      goal: "确认是否允许继续发布。",
      priority: "urgent",
      now: "2026-04-12T12:00:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...waitingHuman.workItem,
      status: "waiting_human",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许继续执行发布",
        choices: ["approve", "deny"],
      },
      updatedAt: "2026-04-12T12:01:00.000Z",
    });
    runtimeStore.saveAgentRun({
      runId: "run-platform-human-write-1",
      organizationId: waitingHuman.workItem.organizationId,
      workItemId: waitingHuman.workItem.workItemId,
      targetAgentId: backend.agentId,
      schedulerId: "scheduler-platform-write",
      leaseToken: "lease-platform-human-write-1",
      leaseExpiresAt: "2026-04-12T12:10:00.000Z",
      status: "waiting_action",
      startedAt: "2026-04-12T12:01:00.000Z",
      lastHeartbeatAt: "2026-04-12T12:01:00.000Z",
      createdAt: "2026-04-12T12:01:00.000Z",
      updatedAt: "2026-04-12T12:01:00.000Z",
    });

    const respondResponse = await postJson(baseUrl, "/api/platform/work-items/respond", {
      ownerPrincipalId,
      workItemId: waitingHuman.workItem.workItemId,
      response: {
        decision: "approve",
        inputText: "可以继续，但先确认监控正常。",
      },
    }, authHeaders);
    assert.equal(respondResponse.status, 200);
    const respondPayload = await respondResponse.json() as {
      workItem?: { workItemId?: string; status?: string; latestHumanResponse?: { decision?: string } };
      resumedRuns?: Array<{ runId?: string; status?: string; failureCode?: string }>;
    };
    assert.equal(respondPayload.workItem?.workItemId, waitingHuman.workItem.workItemId);
    assert.equal(respondPayload.workItem?.status, "queued");
    assert.equal(respondPayload.workItem?.latestHumanResponse?.decision, "approve");
    assert.equal(respondPayload.resumedRuns?.[0]?.runId, "run-platform-human-write-1");
    assert.equal(respondPayload.resumedRuns?.[0]?.status, "interrupted");
    assert.equal(respondPayload.resumedRuns?.[0]?.failureCode, "WAITING_RESUME_TRIGGERED");

    const waitingAgent = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId,
      targetAgentId: backend.agentId,
      sourceType: "agent",
      sourceAgentId: manager.agentId,
      sourcePrincipalId: manager.principalId,
      dispatchReason: "等待经理确认",
      goal: "确认是否切换到发布窗口。",
      priority: "high",
      now: "2026-04-12T12:10:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...waitingAgent.workItem,
      status: "waiting_agent",
      updatedAt: "2026-04-12T12:11:00.000Z",
    });
    runtimeStore.saveAgentRun({
      runId: "run-platform-agent-write-1",
      organizationId: waitingAgent.workItem.organizationId,
      workItemId: waitingAgent.workItem.workItemId,
      targetAgentId: backend.agentId,
      schedulerId: "scheduler-platform-write",
      leaseToken: "lease-platform-agent-write-1",
      leaseExpiresAt: "2026-04-12T12:20:00.000Z",
      status: "waiting_action",
      startedAt: "2026-04-12T12:11:00.000Z",
      lastHeartbeatAt: "2026-04-12T12:11:00.000Z",
      createdAt: "2026-04-12T12:11:00.000Z",
      updatedAt: "2026-04-12T12:11:00.000Z",
    });
    const waitingAgentMailbox = runtime.getManagedAgentCoordinationService().sendAgentMessage({
      ownerPrincipalId,
      fromAgentId: backend.agentId,
      toAgentId: manager.agentId,
      workItemId: waitingAgent.workItem.workItemId,
      runId: "run-platform-agent-write-1",
      messageType: "approval_request",
      payload: {
        prompt: "请经理确认是否切到发布窗口。",
      },
      priority: "high",
      requiresAck: true,
      now: "2026-04-12T12:11:30.000Z",
    });

    const escalateResponse = await postJson(baseUrl, "/api/platform/work-items/escalate", {
      ownerPrincipalId,
      workItemId: waitingAgent.workItem.workItemId,
      escalation: {
        inputText: "请顶层治理接手。",
      },
    }, authHeaders);
    assert.equal(escalateResponse.status, 200);
    const escalatePayload = await escalateResponse.json() as {
      workItem?: { workItemId?: string; status?: string };
      latestWaitingMessage?: { messageId?: string };
      ackedMailboxEntries?: Array<{ mailboxEntryId?: string }>;
    };
    assert.equal(escalatePayload.workItem?.workItemId, waitingAgent.workItem.workItemId);
    assert.equal(escalatePayload.workItem?.status, "waiting_human");
    assert.equal(escalatePayload.latestWaitingMessage?.messageId, waitingAgentMailbox.message.messageId);
    assert.equal(
      escalatePayload.ackedMailboxEntries?.[0]?.mailboxEntryId,
      waitingAgentMailbox.mailboxEntry.mailboxEntryId,
    );

    const ackMailbox = runtime.getManagedAgentCoordinationService().sendAgentMessage({
      ownerPrincipalId,
      fromAgentId: backend.agentId,
      toAgentId: frontend.agentId,
      messageType: "status_update",
      payload: {
        summary: "请确认最近一次构建状态。",
      },
      priority: "normal",
      requiresAck: true,
      now: "2026-04-12T12:20:00.000Z",
    });

    const mailboxPullResponse = await postJson(baseUrl, "/api/platform/agents/mailbox/pull", {
      ownerPrincipalId,
      agentId: frontend.agentId,
    }, authHeaders);
    assert.equal(mailboxPullResponse.status, 200);
    const mailboxPullPayload = await mailboxPullResponse.json() as {
      item?: {
        entry?: { mailboxEntryId?: string; status?: string };
        message?: { messageId?: string };
      } | null;
    };
    assert.equal(mailboxPullPayload.item?.entry?.mailboxEntryId, ackMailbox.mailboxEntry.mailboxEntryId);
    assert.equal(mailboxPullPayload.item?.entry?.status, "leased");
    assert.equal(mailboxPullPayload.item?.message?.messageId, ackMailbox.message.messageId);

    const mailboxAckResponse = await postJson(baseUrl, "/api/platform/agents/mailbox/ack", {
      ownerPrincipalId,
      agentId: frontend.agentId,
      mailboxEntryId: ackMailbox.mailboxEntry.mailboxEntryId,
    }, authHeaders);
    assert.equal(mailboxAckResponse.status, 200);
    const mailboxAckPayload = await mailboxAckResponse.json() as {
      mailboxEntry?: { mailboxEntryId?: string; status?: string };
      message?: { messageId?: string };
    };
    assert.equal(mailboxAckPayload.mailboxEntry?.mailboxEntryId, ackMailbox.mailboxEntry.mailboxEntryId);
    assert.equal(mailboxAckPayload.mailboxEntry?.status, "acked");
    assert.equal(mailboxAckPayload.message?.messageId, ackMailbox.message.messageId);

    const mailboxWaiting = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId,
      targetAgentId: backend.agentId,
      sourceType: "agent",
      sourceAgentId: frontend.agentId,
      sourcePrincipalId: frontend.principalId,
      dispatchReason: "等待前端确认",
      goal: "确认是否可以继续发布。",
      priority: "urgent",
      now: "2026-04-12T12:30:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...mailboxWaiting.workItem,
      status: "waiting_agent",
      updatedAt: "2026-04-12T12:31:00.000Z",
    });
    runtimeStore.saveAgentRun({
      runId: "run-platform-mailbox-write-1",
      organizationId: mailboxWaiting.workItem.organizationId,
      workItemId: mailboxWaiting.workItem.workItemId,
      targetAgentId: backend.agentId,
      schedulerId: "scheduler-platform-write",
      leaseToken: "lease-platform-mailbox-write-1",
      leaseExpiresAt: "2026-04-12T12:40:00.000Z",
      status: "waiting_action",
      startedAt: "2026-04-12T12:31:00.000Z",
      lastHeartbeatAt: "2026-04-12T12:31:00.000Z",
      createdAt: "2026-04-12T12:31:00.000Z",
      updatedAt: "2026-04-12T12:31:00.000Z",
    });
    const mailboxWaitingMessage = runtime.getManagedAgentCoordinationService().sendAgentMessage({
      ownerPrincipalId,
      fromAgentId: backend.agentId,
      toAgentId: frontend.agentId,
      workItemId: mailboxWaiting.workItem.workItemId,
      runId: "run-platform-mailbox-write-1",
      messageType: "approval_request",
      payload: {
        prompt: "是否允许继续执行发布",
      },
      priority: "urgent",
      requiresAck: true,
      now: "2026-04-12T12:31:30.000Z",
    });

    const mailboxRespondResponse = await postJson(baseUrl, "/api/platform/agents/mailbox/respond", {
      ownerPrincipalId,
      agentId: frontend.agentId,
      mailboxEntryId: mailboxWaitingMessage.mailboxEntry.mailboxEntryId,
      response: {
        decision: "approve",
        inputText: "可以继续，请同步 release note。",
        priority: "urgent",
      },
    }, authHeaders);
    assert.equal(mailboxRespondResponse.status, 200);
    const mailboxRespondPayload = await mailboxRespondResponse.json() as {
      sourceMailboxEntry?: { status?: string };
      responseMessage?: { messageType?: string; toAgentId?: string };
      responseMailboxEntry?: { ownerAgentId?: string; status?: string };
      resumedWorkItem?: { workItemId?: string; status?: string };
      resumedRuns?: Array<{ runId?: string; status?: string; failureCode?: string }>;
    };
    assert.equal(mailboxRespondPayload.sourceMailboxEntry?.status, "acked");
    assert.equal(mailboxRespondPayload.responseMessage?.messageType, "approval_result");
    assert.equal(mailboxRespondPayload.responseMessage?.toAgentId, backend.agentId);
    assert.equal(mailboxRespondPayload.responseMailboxEntry?.ownerAgentId, backend.agentId);
    assert.equal(mailboxRespondPayload.responseMailboxEntry?.status, "acked");
    assert.equal(mailboxRespondPayload.resumedWorkItem?.workItemId, mailboxWaiting.workItem.workItemId);
    assert.equal(mailboxRespondPayload.resumedWorkItem?.status, "queued");
    assert.equal(mailboxRespondPayload.resumedRuns?.[0]?.runId, "run-platform-mailbox-write-1");
    assert.equal(mailboxRespondPayload.resumedRuns?.[0]?.status, "interrupted");
    assert.equal(mailboxRespondPayload.resumedRuns?.[0]?.failureCode, "WAITING_RESUME_TRIGGERED");

    const cancellable = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId,
      targetAgentId: backend.agentId,
      dispatchReason: "取消平台写路径测试任务",
      goal: "验证 platform cancel write 接口。",
      now: "2026-04-12T12:40:00.000Z",
    });

    const cancelResponse = await postJson(baseUrl, "/api/platform/work-items/cancel", {
      ownerPrincipalId,
      workItemId: cancellable.workItem.workItemId,
    }, authHeaders);
    assert.equal(cancelResponse.status, 200);
    const cancelPayload = await cancelResponse.json() as {
      workItem?: { workItemId?: string; status?: string };
    };
    assert.equal(cancelPayload.workItem?.workItemId, cancellable.workItem.workItemId);
    assert.equal(cancelPayload.workItem?.status, "cancelled");
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

test("POST /api/platform/nodes/detail|drain|offline|reclaim 会暴露节点治理动作、详情视图与 lease 回收", async () => {
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

    const reclaimResponse = await postJson(baseUrl, "/api/platform/nodes/reclaim", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
    }, authHeaders);
    assert.equal(reclaimResponse.status, 200);
    const reclaimPayload = await reclaimResponse.json() as {
      node?: { status?: string; slotAvailable?: number };
      summary?: {
        activeLeaseCount?: number;
        reclaimedRunCount?: number;
        requeuedWorkItemCount?: number;
      };
      reclaimedLeases?: Array<{
        lease?: { status?: string };
        run?: { status?: string; failureCode?: string };
        workItem?: { status?: string };
        recoveryAction?: string;
      }>;
    };
    assert.equal(reclaimPayload.node?.status, "offline");
    assert.equal(reclaimPayload.node?.slotAvailable, 0);
    assert.equal(reclaimPayload.summary?.activeLeaseCount, 1);
    assert.equal(reclaimPayload.summary?.reclaimedRunCount, 1);
    assert.equal(reclaimPayload.summary?.requeuedWorkItemCount, 1);
    assert.equal(reclaimPayload.reclaimedLeases?.[0]?.lease?.status, "revoked");
    assert.equal(reclaimPayload.reclaimedLeases?.[0]?.run?.status, "interrupted");
    assert.equal(reclaimPayload.reclaimedLeases?.[0]?.run?.failureCode, "NODE_LEASE_RECLAIMED");
    assert.equal(reclaimPayload.reclaimedLeases?.[0]?.workItem?.status, "queued");
    assert.equal(reclaimPayload.reclaimedLeases?.[0]?.recoveryAction, "requeued");

    const detailAfterReclaimResponse = await postJson(baseUrl, "/api/platform/nodes/detail", {
      ownerPrincipalId,
      nodeId: registerPayload.node?.nodeId,
    }, authHeaders);
    assert.equal(detailAfterReclaimResponse.status, 200);
    const detailAfterReclaimPayload = await detailAfterReclaimResponse.json() as {
      leaseSummary?: { activeCount?: number; revokedCount?: number };
      activeExecutionLeases?: Array<unknown>;
    };
    assert.equal(detailAfterReclaimPayload.leaseSummary?.activeCount, 0);
    assert.equal(detailAfterReclaimPayload.leaseSummary?.revokedCount, 1);
    assert.equal(detailAfterReclaimPayload.activeExecutionLeases?.length, 0);
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
