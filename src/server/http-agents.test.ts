import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { CodexAppServerNotification } from "../core/codex-app-server.js";
import type { AppServerTaskRuntimeSession } from "../core/app-server-task-runtime.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { ManagedAgentExecutionService } from "../core/managed-agent-execution-service.js";
import { addOpenAICompatibleProvider } from "../core/openai-compatible-provider.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  runtime: CodexTaskRuntime;
  runtimeStore: SqliteCodexSessionRegistry;
}

const OPENAI_COMPAT_ENV_KEYS = [
  "THEMIS_OPENAI_COMPAT_BASE_URL",
  "THEMIS_OPENAI_COMPAT_API_KEY",
  "THEMIS_OPENAI_COMPAT_MODEL",
  "THEMIS_OPENAI_COMPAT_NAME",
  "THEMIS_OPENAI_COMPAT_ENDPOINT_CANDIDATES",
  "THEMIS_OPENAI_COMPAT_WIRE_API",
  "THEMIS_OPENAI_COMPAT_SUPPORTS_WEBSOCKETS",
  "THEMIS_OPENAI_COMPAT_MODEL_CATALOG_JSON",
] as const;

function withClearedOpenAICompatEnv<T>(fn: () => T): T {
  const savedEnv = new Map<string, string | undefined>();

  for (const key of OPENAI_COMPAT_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function buildIdentityPayload(channelUserId: string): {
  channel: string;
  channelUserId: string;
  displayName: string;
} {
  return {
    channel: "web",
    channelUserId,
    displayName: "Owner",
  };
}

async function withHttpServer(run: (context: TestServerContext) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-agents-"));
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

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out while waiting for async condition.");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createManagedAgent(
  baseUrl: string,
  authHeaders: Record<string, string>,
  channelUserId: string,
  agent: {
    departmentRole: string;
    displayName?: string;
    mission?: string;
  },
): Promise<{
  organizationId: string;
  principalId: string;
  agentId: string;
}> {
  const response = await postJson(baseUrl, "/api/agents/create", {
    ...buildIdentityPayload(channelUserId),
    agent,
  }, authHeaders);

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

test("POST /api/agents/create、/list、/detail 会创建并返回 managed agent", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const createResponse = await postJson(baseUrl, "/api/agents/create", {
      ...buildIdentityPayload("owner-managed-agent"),
      agent: {
        departmentRole: "后端",
        displayName: "后端·衡",
        mission: "负责服务端实现与维护。",
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json() as {
      identity?: { principalId?: string };
      organization?: { organizationId?: string };
      principal?: { principalId?: string; kind?: string; organizationId?: string };
      agent?: { agentId?: string; displayName?: string; departmentRole?: string; mission?: string };
    };
    assert.ok(createPayload.identity?.principalId);
    assert.ok(createPayload.organization?.organizationId);
    assert.ok(createPayload.principal?.principalId);
    assert.equal(createPayload.principal?.kind, "managed_agent");
    assert.equal(createPayload.principal?.organizationId, createPayload.organization?.organizationId);
    assert.ok(createPayload.agent?.agentId);
    assert.equal(createPayload.agent?.displayName, "后端·衡");
    assert.equal(createPayload.agent?.departmentRole, "后端");

    const listResponse = await postJson(
      baseUrl,
      "/api/agents/list",
      buildIdentityPayload("owner-managed-agent"),
      authHeaders,
    );

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      organizations?: Array<{ organizationId?: string }>;
      agents?: Array<{ agentId?: string; displayName?: string }>;
    };
    assert.equal(listPayload.organizations?.length, 1);
    assert.equal(listPayload.organizations?.[0]?.organizationId, createPayload.organization?.organizationId);
    assert.deepEqual(
      listPayload.agents?.map((agent) => ({
        agentId: agent.agentId,
        displayName: agent.displayName,
      })),
      [
        {
          agentId: createPayload.agent?.agentId,
          displayName: "后端·衡",
        },
      ],
    );

    const detailResponse = await postJson(baseUrl, "/api/agents/detail", {
      ...buildIdentityPayload("owner-managed-agent"),
      agentId: createPayload.agent?.agentId,
    }, authHeaders);

    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      organization?: { organizationId?: string };
      principal?: { principalId?: string; kind?: string };
      agent?: { agentId?: string; displayName?: string; mission?: string };
    };
    assert.equal(detailPayload.organization?.organizationId, createPayload.organization?.organizationId);
    assert.equal(detailPayload.principal?.principalId, createPayload.principal?.principalId);
    assert.equal(detailPayload.principal?.kind, "managed_agent");
    assert.equal(detailPayload.agent?.agentId, createPayload.agent?.agentId);
    assert.equal(detailPayload.agent?.mission, "负责服务端实现与维护。");
  });
});

test("POST /api/agents/detail 在 agent 不存在时返回错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const response = await postJson(baseUrl, "/api/agents/detail", {
      ...buildIdentityPayload("owner-managed-agent-missing"),
      agentId: "agent-missing",
    }, authHeaders);

    assert.equal(response.status, 400);
    const payload = await response.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "Managed agent does not exist.");
  });
});

test("POST /api/agents/detail 和 /execution-boundary/update 会返回并持久化默认执行边界", async () => {
  await withClearedOpenAICompatEnv(async () => {
    await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
      const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
      runtimeStore.saveAuthAccount({
        accountId: "acct-http",
        label: "Web 账号",
        codexHome: join(runtime.getWorkingDirectory(), "infra/local/codex-auth/acct-http"),
        isActive: true,
        createdAt: "2026-04-07T12:30:00.000Z",
        updatedAt: "2026-04-07T12:30:00.000Z",
      });
      addOpenAICompatibleProvider(runtime.getWorkingDirectory(), {
        id: "gateway-http",
        name: "Gateway HTTP",
        baseUrl: "https://gateway-http.example.com/v1",
        apiKey: "sk-gateway-http",
      }, runtimeStore);

      const created = await createManagedAgent(baseUrl, authHeaders, "owner-managed-agent-boundary", {
        departmentRole: "后端",
        displayName: "后端·衡",
      });
      const detailResponse = await postJson(baseUrl, "/api/agents/detail", {
        ...buildIdentityPayload("owner-managed-agent-boundary"),
        agentId: created.agentId,
      }, authHeaders);

      assert.equal(detailResponse.status, 200);
      const detailPayload = await detailResponse.json() as {
        workspacePolicy?: { workspacePath?: string };
        runtimeProfile?: { accessMode?: string; authAccountId?: string };
        authAccounts?: Array<{ accountId?: string }>;
        thirdPartyProviders?: Array<{ id?: string }>;
      };
      assert.equal(detailPayload.workspacePolicy?.workspacePath, runtime.getWorkingDirectory());
      assert.equal(detailPayload.runtimeProfile?.accessMode, "auth");
      assert.equal(detailPayload.runtimeProfile?.authAccountId, "acct-http");
      assert.ok((detailPayload.authAccounts?.length ?? 0) >= 1);
      assert.ok(detailPayload.authAccounts?.some((account) => account.accountId === "acct-http"));
      assert.ok(detailPayload.thirdPartyProviders?.some((provider) => provider.id === "gateway-http"));

      const workspacePath = join(runtime.getWorkingDirectory(), "workspace/http-backend");
      const sharedPath = join(runtime.getWorkingDirectory(), "workspace/http-shared");
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(sharedPath, { recursive: true });
      const updateResponse = await postJson(baseUrl, "/api/agents/execution-boundary/update", {
        ...buildIdentityPayload("owner-managed-agent-boundary"),
        agentId: created.agentId,
        boundary: {
          workspacePolicy: {
            workspacePath,
            additionalDirectories: [sharedPath],
            allowNetworkAccess: false,
          },
          runtimeProfile: {
            accessMode: "third-party",
            thirdPartyProviderId: "gateway-http",
            model: "gpt-5.4-mini",
            reasoning: "high",
            memoryMode: "confirm",
            sandboxMode: "danger-full-access",
            approvalPolicy: "on-request",
            webSearchMode: "disabled",
            networkAccessEnabled: false,
          },
        },
      }, authHeaders);

      assert.equal(updateResponse.status, 200);
      const updatePayload = await updateResponse.json() as {
        workspacePolicy?: { workspacePath?: string; additionalDirectories?: string[]; allowNetworkAccess?: boolean };
        runtimeProfile?: {
          accessMode?: string;
          thirdPartyProviderId?: string;
          model?: string;
          sandboxMode?: string;
          approvalPolicy?: string;
          webSearchMode?: string;
          networkAccessEnabled?: boolean;
        };
      };
      assert.equal(updatePayload.workspacePolicy?.workspacePath, workspacePath);
      assert.deepEqual(updatePayload.workspacePolicy?.additionalDirectories, [sharedPath]);
      assert.equal(updatePayload.workspacePolicy?.allowNetworkAccess, false);
      assert.equal(updatePayload.runtimeProfile?.accessMode, "third-party");
      assert.equal(updatePayload.runtimeProfile?.thirdPartyProviderId, "gateway-http");
      assert.equal(updatePayload.runtimeProfile?.model, "gpt-5.4-mini");
      assert.equal(updatePayload.runtimeProfile?.sandboxMode, "danger-full-access");
      assert.equal(updatePayload.runtimeProfile?.approvalPolicy, "on-request");
      assert.equal(updatePayload.runtimeProfile?.webSearchMode, "disabled");
      assert.equal(updatePayload.runtimeProfile?.networkAccessEnabled, false);
    });
  });
});

test("POST /api/agents/spawn-suggestions 会基于当前负载返回自动创建建议", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-spawn-suggestions", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责发布和值班。",
    });

    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-1",
      organizationId: ops.organizationId,
      targetAgentId: ops.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "发布巡检",
      goal: "处理本周发布巡检",
      priority: "urgent",
      status: "running",
      createdAt: "2026-04-07T08:20:00.000Z",
      updatedAt: "2026-04-07T08:20:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-2",
      organizationId: ops.organizationId,
      targetAgentId: ops.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "值班交接",
      goal: "处理值班交接",
      priority: "high",
      status: "waiting_human",
      createdAt: "2026-04-07T08:21:00.000Z",
      updatedAt: "2026-04-07T08:21:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-3",
      organizationId: ops.organizationId,
      targetAgentId: ops.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "监控看板调整",
      goal: "处理监控看板调整",
      priority: "normal",
      status: "queued",
      createdAt: "2026-04-07T08:22:00.000Z",
      updatedAt: "2026-04-07T08:22:00.000Z",
    });

    const response = await postJson(baseUrl, "/api/agents/spawn-suggestions", {
      ...buildIdentityPayload("owner-agent-spawn-suggestions"),
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      spawnPolicies?: Array<{
        organizationId?: string;
        maxActiveAgents?: number;
        maxActiveAgentsPerRole?: number;
      }>;
      suggestions?: Array<{
        departmentRole?: string;
        displayName?: string;
        supportingAgentId?: string;
        openWorkItemCount?: number;
        waitingWorkItemCount?: number;
        highPriorityWorkItemCount?: number;
        guardrail?: {
          blocked?: boolean;
          organizationActiveAgentCount?: number;
          roleActiveAgentCount?: number;
        };
      }>;
      recentAuditLogs?: Array<{
        auditLogId?: string;
      }>;
    };
    assert.equal(payload.spawnPolicies?.length, 1);
    assert.equal(payload.spawnPolicies?.[0]?.organizationId, ops.organizationId);
    assert.equal(payload.spawnPolicies?.[0]?.maxActiveAgents, 12);
    assert.equal(payload.spawnPolicies?.[0]?.maxActiveAgentsPerRole, 3);
    assert.equal(payload.suggestions?.length, 1);
    assert.equal(payload.recentAuditLogs?.length, 0);
    assert.equal(payload.suggestions?.[0]?.departmentRole, "运维");
    assert.match(payload.suggestions?.[0]?.displayName ?? "", /^运维·/);
    assert.equal(payload.suggestions?.[0]?.supportingAgentId, ops.agentId);
    assert.equal(payload.suggestions?.[0]?.openWorkItemCount, 3);
    assert.equal(payload.suggestions?.[0]?.waitingWorkItemCount, 1);
    assert.equal(payload.suggestions?.[0]?.highPriorityWorkItemCount, 2);
    assert.equal(payload.suggestions?.[0]?.guardrail?.blocked, false);
    assert.equal(payload.suggestions?.[0]?.guardrail?.organizationActiveAgentCount, 1);
    assert.equal(payload.suggestions?.[0]?.guardrail?.roleActiveAgentCount, 1);
  });
});

test("POST /api/agents/spawn-policy/update 会持久化当前组织的自动创建护栏", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-spawn-policy-update", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责发布和值班。",
    });

    const response = await postJson(baseUrl, "/api/agents/spawn-policy/update", {
      ...buildIdentityPayload("owner-agent-spawn-policy-update"),
      policy: {
        organizationId: ops.organizationId,
        maxActiveAgents: 5,
        maxActiveAgentsPerRole: 2,
      },
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      policy?: {
        organizationId?: string;
        maxActiveAgents?: number;
        maxActiveAgentsPerRole?: number;
      };
    };
    assert.equal(payload.policy?.organizationId, ops.organizationId);
    assert.equal(payload.policy?.maxActiveAgents, 5);
    assert.equal(payload.policy?.maxActiveAgentsPerRole, 2);

    const stored = runtimeStore.getAgentSpawnPolicy(ops.organizationId);
    assert.equal(stored?.maxActiveAgents, 5);
    assert.equal(stored?.maxActiveAgentsPerRole, 2);
  });
});

test("POST /api/agents/spawn-approve 会创建 auto 模式的 managed agent，并返回 bootstrap work item", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-spawn-approve", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责发布和值班。",
    });

    const response = await postJson(baseUrl, "/api/agents/spawn-approve", {
      ...buildIdentityPayload("owner-agent-spawn-approve"),
      agent: {
        departmentRole: "运维",
        displayName: "运维·砺",
        mission: "负责运维值班与巡检分流。",
        organizationId: ops.organizationId,
        supervisorAgentId: ops.agentId,
      },
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      agent?: {
        agentId?: string;
        displayName?: string;
        creationMode?: string;
        status?: string;
        mission?: string;
        supervisorPrincipalId?: string;
        bootstrapProfile?: {
          state?: string;
        };
      };
      bootstrapWorkItem?: {
        workItemId?: string;
        targetAgentId?: string;
        status?: string;
      };
      auditLog?: {
        eventType?: string;
        subjectAgentId?: string;
        summary?: string;
      };
    };
    assert.ok(payload.agent?.agentId);
    assert.equal(payload.agent?.displayName, "运维·砺");
    assert.equal(payload.agent?.creationMode, "auto");
    assert.equal(payload.agent?.status, "bootstrapping");
    assert.equal(payload.agent?.mission, "负责运维值班与巡检分流。");
    assert.equal(payload.agent?.bootstrapProfile?.state, "pending");
    assert.equal(payload.bootstrapWorkItem?.targetAgentId, payload.agent?.agentId);
    assert.equal(payload.bootstrapWorkItem?.status, "queued");
    assert.equal(payload.auditLog?.eventType, "spawn_suggestion_approved");
    assert.equal(payload.auditLog?.subjectAgentId, payload.agent?.agentId);
    assert.match(payload.auditLog?.summary ?? "", /已批准自动创建/);

    const supervisor = runtimeStore.getManagedAgent(ops.agentId);
    assert.equal(payload.agent?.supervisorPrincipalId, supervisor?.principalId);
  });
});

test("POST /api/agents/spawn-ignore、/spawn-reject、/spawn-restore 会治理自动创建建议并维护 suppressed 列表", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-spawn-governance", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责发布和值班。",
    });

    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-governance-1",
      organizationId: ops.organizationId,
      targetAgentId: ops.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "发布巡检",
      goal: "处理本周发布巡检",
      priority: "urgent",
      status: "running",
      createdAt: "2026-04-07T08:40:00.000Z",
      updatedAt: "2026-04-07T08:40:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-governance-2",
      organizationId: ops.organizationId,
      targetAgentId: ops.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "值班交接",
      goal: "处理值班交接",
      priority: "high",
      status: "waiting_human",
      createdAt: "2026-04-07T08:41:00.000Z",
      updatedAt: "2026-04-07T08:41:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-governance-3",
      organizationId: ops.organizationId,
      targetAgentId: ops.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "监控看板调整",
      goal: "处理监控看板调整",
      priority: "normal",
      status: "queued",
      createdAt: "2026-04-07T08:42:00.000Z",
      updatedAt: "2026-04-07T08:42:00.000Z",
    });

    const suggestionsResponse = await postJson(baseUrl, "/api/agents/spawn-suggestions", {
      ...buildIdentityPayload("owner-agent-spawn-governance"),
    }, authHeaders);
    const suggestionsPayload = await suggestionsResponse.json() as {
      suggestions?: Array<Record<string, unknown>>;
    };
    const firstSuggestion = suggestionsPayload.suggestions?.[0];
    assert.ok(firstSuggestion);

    const ignoreResponse = await postJson(baseUrl, "/api/agents/spawn-ignore", {
      ...buildIdentityPayload("owner-agent-spawn-governance"),
      suggestion: firstSuggestion,
    }, authHeaders);
    assert.equal(ignoreResponse.status, 200);
    const ignorePayload = await ignoreResponse.json() as {
      suppressedSuggestion?: {
        suppressionState?: string;
      };
      auditLog?: {
        eventType?: string;
      };
    };
    assert.equal(ignorePayload.suppressedSuggestion?.suppressionState, "ignored");
    assert.equal(ignorePayload.auditLog?.eventType, "spawn_suggestion_ignored");

    const afterIgnoreResponse = await postJson(baseUrl, "/api/agents/spawn-suggestions", {
      ...buildIdentityPayload("owner-agent-spawn-governance"),
    }, authHeaders);
    const afterIgnorePayload = await afterIgnoreResponse.json() as {
      suggestions?: Array<unknown>;
      suppressedSuggestions?: Array<{
        suggestionId?: string;
      }>;
    };
    assert.equal(afterIgnorePayload.suggestions?.length, 0);
    assert.equal(afterIgnorePayload.suppressedSuggestions?.length, 1);

    const restoreResponse = await postJson(baseUrl, "/api/agents/spawn-restore", {
      ...buildIdentityPayload("owner-agent-spawn-governance"),
      suggestion: {
        suggestionId: afterIgnorePayload.suppressedSuggestions?.[0]?.suggestionId,
        organizationId: ops.organizationId,
      },
    }, authHeaders);
    assert.equal(restoreResponse.status, 200);
    const restorePayload = await restoreResponse.json() as {
      auditLog?: {
        eventType?: string;
      };
    };
    assert.equal(restorePayload.auditLog?.eventType, "spawn_suggestion_restored");

    const suggestionsAgainResponse = await postJson(baseUrl, "/api/agents/spawn-suggestions", {
      ...buildIdentityPayload("owner-agent-spawn-governance"),
    }, authHeaders);
    const suggestionsAgainPayload = await suggestionsAgainResponse.json() as {
      suggestions?: Array<Record<string, unknown>>;
      suppressedSuggestions?: Array<unknown>;
    };
    assert.equal(suggestionsAgainPayload.suggestions?.length, 1);
    assert.equal(suggestionsAgainPayload.suppressedSuggestions?.length, 0);

    const rejectResponse = await postJson(baseUrl, "/api/agents/spawn-reject", {
      ...buildIdentityPayload("owner-agent-spawn-governance"),
      suggestion: suggestionsAgainPayload.suggestions?.[0],
    }, authHeaders);
    assert.equal(rejectResponse.status, 200);
    const rejectPayload = await rejectResponse.json() as {
      suppressedSuggestion?: {
        suppressionState?: string;
      };
      auditLog?: {
        eventType?: string;
      };
    };
    assert.equal(rejectPayload.suppressedSuggestion?.suppressionState, "rejected");
    assert.equal(rejectPayload.auditLog?.eventType, "spawn_suggestion_rejected");
  });
});

test("POST /api/agents/spawn-approve 会在同角色达到上限时被护栏拦住，并写入 blocked 审计", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const primaryOps = await createManagedAgent(baseUrl, authHeaders, "owner-agent-spawn-blocked", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责发布和值班。",
    });
    await createManagedAgent(baseUrl, authHeaders, "owner-agent-spawn-blocked", {
      departmentRole: "运维",
      displayName: "运维·砺",
      mission: "负责巡检。",
    });
    await createManagedAgent(baseUrl, authHeaders, "owner-agent-spawn-blocked", {
      departmentRole: "运维",
      displayName: "运维·岚",
      mission: "负责监控。",
    });

    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-blocked-1",
      organizationId: primaryOps.organizationId,
      targetAgentId: primaryOps.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "发布巡检",
      goal: "处理本周发布巡检",
      priority: "urgent",
      status: "running",
      createdAt: "2026-04-07T08:40:00.000Z",
      updatedAt: "2026-04-07T08:40:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-blocked-2",
      organizationId: primaryOps.organizationId,
      targetAgentId: primaryOps.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "值班交接",
      goal: "处理值班交接",
      priority: "high",
      status: "waiting_human",
      createdAt: "2026-04-07T08:41:00.000Z",
      updatedAt: "2026-04-07T08:41:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-spawn-blocked-3",
      organizationId: primaryOps.organizationId,
      targetAgentId: primaryOps.agentId,
      sourceType: "human",
      sourcePrincipalId: "principal-local-owner",
      dispatchReason: "监控看板调整",
      goal: "处理监控看板调整",
      priority: "normal",
      status: "queued",
      createdAt: "2026-04-07T08:42:00.000Z",
      updatedAt: "2026-04-07T08:42:00.000Z",
    });

    const response = await postJson(baseUrl, "/api/agents/spawn-approve", {
      ...buildIdentityPayload("owner-agent-spawn-blocked"),
      agent: {
        departmentRole: "运维",
        displayName: "运维·策",
        mission: "负责运维值班与巡检分流。",
        organizationId: primaryOps.organizationId,
        supervisorAgentId: primaryOps.agentId,
      },
    }, authHeaders);

    assert.equal(response.status, 400);
    const errorPayload = await response.json() as {
      error?: {
        message?: string;
      };
    };
    assert.equal(errorPayload.error?.message, "当前 运维 角色已达到活跃 agent 上限。");

    const suggestionsResponse = await postJson(baseUrl, "/api/agents/spawn-suggestions", {
      ...buildIdentityPayload("owner-agent-spawn-blocked"),
    }, authHeaders);
    assert.equal(suggestionsResponse.status, 200);
    const suggestionsPayload = await suggestionsResponse.json() as {
      suggestions?: Array<{
        guardrail?: { blocked?: boolean; roleActiveAgentCount?: number };
      }>;
      recentAuditLogs?: Array<{
        eventType?: string;
        summary?: string;
      }>;
    };
    assert.equal(suggestionsPayload.suggestions?.[0]?.guardrail?.blocked, true);
    assert.equal(suggestionsPayload.suggestions?.[0]?.guardrail?.roleActiveAgentCount, 3);
    assert.equal(suggestionsPayload.recentAuditLogs?.[0]?.eventType, "spawn_suggestion_blocked");
    assert.match(suggestionsPayload.recentAuditLogs?.[0]?.summary ?? "", /护栏拦截/);
  });
});

test("POST /api/agents/idle-suggestions、/idle-approve 会返回空闲回收建议并完成 pause 治理", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const supervisor = await createManagedAgent(baseUrl, authHeaders, "owner-agent-idle-recovery", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责发布和值班。",
    });
    const ownerPrincipalId = runtimeStore.getChannelIdentity("web", "owner-agent-idle-recovery")?.principalId;
    assert.ok(ownerPrincipalId);

    const autoAgent = runtime.getManagedAgentsService().createManagedAgent({
      ownerPrincipalId: ownerPrincipalId as string,
      organizationId: supervisor.organizationId,
      displayName: "运维·砺",
      departmentRole: "运维",
      mission: "负责运维值班与巡检分流。",
      creationMode: "auto",
      status: "active",
      now: "2026-03-12T08:00:00.000Z",
    });

    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-idle-http-1",
      organizationId: supervisor.organizationId,
      targetAgentId: autoAgent.agent.agentId,
      sourceType: "agent",
      sourcePrincipalId: supervisor.principalId,
      sourceAgentId: supervisor.agentId,
      dispatchReason: "补巡检脚本",
      goal: "完成巡检脚本收尾",
      priority: "normal",
      status: "completed",
      createdAt: "2026-04-03T07:00:00.000Z",
      completedAt: "2026-04-03T08:00:00.000Z",
      updatedAt: "2026-04-03T08:00:00.000Z",
    });
    runtimeStore.saveAgentMessage({
      messageId: "message-idle-http-1",
      organizationId: supervisor.organizationId,
      fromAgentId: autoAgent.agent.agentId,
      toAgentId: supervisor.agentId,
      workItemId: "work-item-idle-http-1",
      messageType: "handoff",
      payload: {
        summary: "巡检脚本已完成交接。",
      },
      artifactRefs: [],
      priority: "normal",
      requiresAck: false,
      createdAt: "2026-04-03T09:00:00.000Z",
    });

    const suggestionsResponse = await postJson(baseUrl, "/api/agents/idle-suggestions", {
      ...buildIdentityPayload("owner-agent-idle-recovery"),
    }, authHeaders);
    assert.equal(suggestionsResponse.status, 200);
    const suggestionsPayload = await suggestionsResponse.json() as {
      suggestions?: Array<{
        suggestionId?: string;
        agentId?: string;
        recommendedAction?: string;
      }>;
      recentAuditLogs?: Array<unknown>;
    };
    assert.equal(suggestionsPayload.suggestions?.length, 1);
    assert.equal(suggestionsPayload.suggestions?.[0]?.agentId, autoAgent.agent.agentId);
    assert.equal(suggestionsPayload.suggestions?.[0]?.recommendedAction, "pause");
    assert.equal(suggestionsPayload.recentAuditLogs?.length, 0);

    const approveResponse = await postJson(baseUrl, "/api/agents/idle-approve", {
      ...buildIdentityPayload("owner-agent-idle-recovery"),
      suggestion: {
        suggestionId: suggestionsPayload.suggestions?.[0]?.suggestionId,
        organizationId: supervisor.organizationId,
        agentId: autoAgent.agent.agentId,
        action: "pause",
      },
    }, authHeaders);
    assert.equal(approveResponse.status, 200);
    const approvePayload = await approveResponse.json() as {
      agent?: { status?: string; agentId?: string };
      auditLog?: { eventType?: string; subjectAgentId?: string };
    };
    assert.equal(approvePayload.agent?.agentId, autoAgent.agent.agentId);
    assert.equal(approvePayload.agent?.status, "paused");
    assert.equal(approvePayload.auditLog?.eventType, "idle_recovery_pause_approved");
    assert.equal(approvePayload.auditLog?.subjectAgentId, autoAgent.agent.agentId);
  });
});

test("POST /api/agents/handoffs/list 会返回 handoff 历史与交接时间线", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-handoffs", {
      departmentRole: "前端",
      displayName: "前端·岚",
      mission: "负责 Web 工作台。",
    });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-handoffs", {
      departmentRole: "后端",
      displayName: "后端·衡",
      mission: "负责接口与存储。",
    });

    runtimeStore.saveAgentWorkItem({
      workItemId: "work-item-handoff-http-1",
      organizationId: frontend.organizationId,
      targetAgentId: backend.agentId,
      sourceType: "agent",
      sourcePrincipalId: frontend.principalId,
      sourceAgentId: frontend.agentId,
      dispatchReason: "前端等待 handoff 时间线",
      goal: "补 handoff HTTP 闭环",
      priority: "high",
      status: "completed",
      createdAt: "2026-04-07T10:00:00.000Z",
      completedAt: "2026-04-07T10:30:00.000Z",
      updatedAt: "2026-04-07T10:30:00.000Z",
    });
    runtimeStore.saveAgentMessage({
      messageId: "message-handoff-http-1",
      organizationId: frontend.organizationId,
      fromAgentId: backend.agentId,
      toAgentId: frontend.agentId,
      workItemId: "work-item-handoff-http-1",
      messageType: "answer",
      payload: {
        status: "completed",
        summary: "handoff 历史接口已完成。",
      },
      artifactRefs: ["src/server/http-agents.ts"],
      priority: "high",
      requiresAck: false,
      createdAt: "2026-04-07T10:31:00.000Z",
    });
    runtimeStore.saveAgentHandoff({
      handoffId: "handoff-message-handoff-http-1",
      organizationId: frontend.organizationId,
      fromAgentId: backend.agentId,
      toAgentId: frontend.agentId,
      workItemId: "work-item-handoff-http-1",
      sourceMessageId: "message-handoff-http-1",
      sourceRunId: "run-handoff-http-1",
      summary: "handoff 历史接口已完成。",
      blockers: ["还差 Web timeline 面板"],
      recommendedNextActions: ["把 handoff 历史挂到 Agents 页面"],
      attachedArtifacts: ["src/server/http-agents.ts"],
      createdAt: "2026-04-07T10:31:00.000Z",
      updatedAt: "2026-04-07T10:31:00.000Z",
    });

    const response = await postJson(baseUrl, "/api/agents/handoffs/list", {
      ...buildIdentityPayload("owner-agent-handoffs"),
      agentId: frontend.agentId,
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      handoffs?: Array<{
        handoffId?: string;
        summary?: string;
        counterpartyDisplayName?: string;
      }>;
      timeline?: Array<{
        kind?: string;
        handoffId?: string;
        workItemId?: string;
      }>;
    };
    assert.equal(payload.handoffs?.length, 1);
    assert.equal(payload.handoffs?.[0]?.handoffId, "handoff-message-handoff-http-1");
    assert.equal(payload.handoffs?.[0]?.summary, "handoff 历史接口已完成。");
    assert.equal(payload.handoffs?.[0]?.counterpartyDisplayName, "后端·衡");
    assert.equal(payload.timeline?.[0]?.kind, "handoff");
    assert.equal(payload.timeline?.[0]?.handoffId, "handoff-message-handoff-http-1");
    assert.equal(payload.timeline?.[0]?.workItemId, "work-item-handoff-http-1");
  });
});

test("POST /api/agents/pause、/resume、/archive 会更新 managed agent lifecycle", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-lifecycle", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责部署与值班。",
    });

    const pauseResponse = await postJson(baseUrl, "/api/agents/pause", {
      ...buildIdentityPayload("owner-agent-lifecycle"),
      agentId: ops.agentId,
    }, authHeaders);
    assert.equal(pauseResponse.status, 200);
    const pausePayload = await pauseResponse.json() as {
      agent?: { status?: string };
    };
    assert.equal(pausePayload.agent?.status, "paused");

    const resumeResponse = await postJson(baseUrl, "/api/agents/resume", {
      ...buildIdentityPayload("owner-agent-lifecycle"),
      agentId: ops.agentId,
    }, authHeaders);
    assert.equal(resumeResponse.status, 200);
    const resumePayload = await resumeResponse.json() as {
      agent?: { status?: string };
    };
    assert.equal(resumePayload.agent?.status, "active");

    const archiveResponse = await postJson(baseUrl, "/api/agents/archive", {
      ...buildIdentityPayload("owner-agent-lifecycle"),
      agentId: ops.agentId,
    }, authHeaders);
    assert.equal(archiveResponse.status, 200);
    const archivePayload = await archiveResponse.json() as {
      agent?: { status?: string };
    };
    assert.equal(archivePayload.agent?.status, "archived");
  });
});

test("POST /api/agents/dispatch 会拒绝给非 active agent 派工", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-dispatch-paused", {
      departmentRole: "后端",
      displayName: "后端·衡",
      mission: "负责服务端实现。",
    });

    const pauseResponse = await postJson(baseUrl, "/api/agents/pause", {
      ...buildIdentityPayload("owner-agent-dispatch-paused"),
      agentId: backend.agentId,
    }, authHeaders);
    assert.equal(pauseResponse.status, 200);

    const dispatchResponse = await postJson(baseUrl, "/api/agents/dispatch", {
      ...buildIdentityPayload("owner-agent-dispatch-paused"),
      workItem: {
        targetAgentId: backend.agentId,
        dispatchReason: "尝试给暂停中的 agent 派工",
        goal: "这条请求应该被拒绝",
      },
    }, authHeaders);

    assert.equal(dispatchResponse.status, 400);
    const payload = await dispatchResponse.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "Managed agent is not active.");
  });
});

test("POST /api/agents/dispatch、/work-items/list、/work-items/detail 会返回最小 work item 治理闭环", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-dispatch-human", {
      departmentRole: "后端",
      displayName: "后端·序",
      mission: "负责服务端落地。",
    });

    const dispatchResponse = await postJson(baseUrl, "/api/agents/dispatch", {
      ...buildIdentityPayload("owner-agent-dispatch-human"),
      workItem: {
        targetAgentId: backend.agentId,
        dispatchReason: "先把 HTTP 治理闭环接出来",
        goal: "补 dispatch / work-item detail / mailbox pull 接口",
        contextPacket: {
          source: "todoist",
          milestone: "phase-a-http",
        },
        priority: "high",
      },
    }, authHeaders);

    assert.equal(dispatchResponse.status, 200);
    const dispatchPayload = await dispatchResponse.json() as {
      workItem?: { workItemId?: string; status?: string; priority?: string; sourceType?: string };
      dispatchMessage?: unknown;
      mailboxEntry?: unknown;
    };
    assert.ok(dispatchPayload.workItem?.workItemId);
    assert.equal(dispatchPayload.workItem?.status, "queued");
    assert.equal(dispatchPayload.workItem?.priority, "high");
    assert.equal(dispatchPayload.workItem?.sourceType, "human");
    assert.equal(dispatchPayload.dispatchMessage, undefined);
    assert.equal(dispatchPayload.mailboxEntry, undefined);

    const listResponse = await postJson(baseUrl, "/api/agents/work-items/list", {
      ...buildIdentityPayload("owner-agent-dispatch-human"),
      agentId: backend.agentId,
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      workItems?: Array<{ workItemId?: string; targetAgentId?: string }>;
    };
    assert.equal(listPayload.workItems?.length, 1);
    assert.equal(listPayload.workItems?.[0]?.workItemId, dispatchPayload.workItem?.workItemId);
    assert.equal(listPayload.workItems?.[0]?.targetAgentId, backend.agentId);

    const detailResponse = await postJson(baseUrl, "/api/agents/work-items/detail", {
      ...buildIdentityPayload("owner-agent-dispatch-human"),
      workItemId: dispatchPayload.workItem?.workItemId,
    }, authHeaders);

    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      workItem?: { workItemId?: string; sourceType?: string; goal?: string; contextPacket?: { milestone?: string } };
      targetAgent?: { agentId?: string };
      sourcePrincipal?: { principalId?: string };
      messages?: Array<unknown>;
    };
    assert.equal(detailPayload.workItem?.workItemId, dispatchPayload.workItem?.workItemId);
    assert.equal(detailPayload.workItem?.sourceType, "human");
    assert.equal(detailPayload.workItem?.goal, "补 dispatch / work-item detail / mailbox pull 接口");
    assert.equal(detailPayload.workItem?.contextPacket?.milestone, "phase-a-http");
    assert.equal(detailPayload.targetAgent?.agentId, backend.agentId);
    assert.ok(detailPayload.sourcePrincipal?.principalId);
    assert.deepEqual(detailPayload.messages, []);
  });
});

test("POST /api/agents/work-items/detail 会返回父子 work item 汇总与最近 handoff", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const manager = await createManagedAgent(baseUrl, authHeaders, "owner-agent-work-item-summary", {
      departmentRole: "经理",
      displayName: "经理·曜",
      mission: "负责拆解任务与汇总结果。",
    });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-work-item-summary", {
      departmentRole: "后端",
      displayName: "后端·衡",
      mission: "负责接口与存储。",
    });

    const parent = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: manager.agentId,
      dispatchReason: "汇总协作进展",
      goal: "把下游子任务状态汇总到 detail 面板",
      priority: "high",
      now: "2026-04-07T11:00:00.000Z",
    });
    const child = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: backend.agentId,
      sourceType: "agent",
      sourceAgentId: manager.agentId,
      sourcePrincipalId: manager.principalId,
      parentWorkItemId: parent.workItem.workItemId,
      dispatchReason: "补 detail 汇总接口",
      goal: "补 parent-child collaboration summary",
      priority: "high",
      now: "2026-04-07T11:05:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...child.workItem,
      status: "completed",
      completedAt: "2026-04-07T11:20:00.000Z",
      updatedAt: "2026-04-07T11:20:00.000Z",
    });
    runtimeStore.saveAgentHandoff({
      handoffId: "handoff-work-item-summary-1",
      organizationId: manager.organizationId,
      fromAgentId: backend.agentId,
      toAgentId: manager.agentId,
      workItemId: child.workItem.workItemId,
      summary: "子任务已完成并交回给经理。",
      blockers: [],
      recommendedNextActions: ["进入验收"],
      attachedArtifacts: ["src/server/http-agents.ts"],
      createdAt: "2026-04-07T11:21:00.000Z",
      updatedAt: "2026-04-07T11:21:00.000Z",
    });

    const detailResponse = await postJson(baseUrl, "/api/agents/work-items/detail", {
      ...buildIdentityPayload("owner-agent-work-item-summary"),
      workItemId: parent.workItem.workItemId,
    }, authHeaders);

    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      childSummary?: {
        totalCount?: number;
        openCount?: number;
        completedCount?: number;
      };
      childWorkItems?: Array<{
        workItem?: { workItemId?: string };
        targetAgent?: { displayName?: string };
        latestHandoff?: { summary?: string };
      }>;
    };
    assert.equal(detailPayload.childSummary?.totalCount, 1);
    assert.equal(detailPayload.childSummary?.openCount, 0);
    assert.equal(detailPayload.childSummary?.completedCount, 1);
    assert.equal(detailPayload.childWorkItems?.[0]?.workItem?.workItemId, child.workItem.workItemId);
    assert.equal(detailPayload.childWorkItems?.[0]?.targetAgent?.displayName, "后端·衡");
    assert.equal(detailPayload.childWorkItems?.[0]?.latestHandoff?.summary, "子任务已完成并交回给经理。");

    const childDetailResponse = await postJson(baseUrl, "/api/agents/work-items/detail", {
      ...buildIdentityPayload("owner-agent-work-item-summary"),
      workItemId: child.workItem.workItemId,
    }, authHeaders);
    assert.equal(childDetailResponse.status, 200);
    const childDetailPayload = await childDetailResponse.json() as {
      parentWorkItem?: { workItemId?: string };
      parentTargetAgent?: { displayName?: string };
    };
    assert.equal(childDetailPayload.parentWorkItem?.workItemId, parent.workItem.workItemId);
    assert.equal(childDetailPayload.parentTargetAgent?.displayName, "经理·曜");
  });
});

test("POST /api/agents/waiting/list 会返回组织级等待队列与摘要", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-waiting-list", {
      departmentRole: "前端",
      displayName: "前端·序",
      mission: "负责 Web 工作台。",
    });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-waiting-list", {
      departmentRole: "运维",
      displayName: "运维·衡",
      mission: "负责发布和值班。",
    });

    const dispatched = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: ops.agentId,
      sourceType: "agent",
      sourceAgentId: frontend.agentId,
      sourcePrincipalId: frontend.principalId,
      dispatchReason: "等待发布审批",
      goal: "确认是否可以继续部署",
      priority: "urgent",
      now: "2026-04-06T14:40:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "waiting_agent",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许执行 deploy production",
      },
      updatedAt: "2026-04-06T14:41:00.000Z",
    });
    runtime.getManagedAgentCoordinationService().sendAgentMessage({
      ownerPrincipalId: "principal-local-owner",
      fromAgentId: ops.agentId,
      toAgentId: frontend.agentId,
      workItemId: dispatched.workItem.workItemId,
      messageType: "approval_request",
      payload: {
        prompt: "是否允许执行 deploy production",
      },
      priority: "urgent",
      requiresAck: true,
      now: "2026-04-06T14:41:30.000Z",
    });

    const response = await postJson(
      baseUrl,
      "/api/agents/waiting/list",
      buildIdentityPayload("owner-agent-waiting-list"),
      authHeaders,
    );

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      summary?: {
        totalCount?: number;
        waitingHumanCount?: number;
        waitingAgentCount?: number;
        escalationCount?: number;
      };
      items?: Array<{
        workItem?: { workItemId?: string; status?: string };
        targetAgent?: { agentId?: string };
        managerAgent?: { agentId?: string };
        sourceAgent?: { agentId?: string };
        latestWaitingMessage?: { messageType?: string };
      }>;
    };
    assert.equal(payload.summary?.totalCount, 1);
    assert.equal(payload.summary?.waitingHumanCount, 0);
    assert.equal(payload.summary?.waitingAgentCount, 1);
    assert.equal(payload.items?.length, 1);
    assert.equal(payload.items?.[0]?.workItem?.workItemId, dispatched.workItem.workItemId);
    assert.equal(payload.items?.[0]?.workItem?.status, "waiting_agent");
    assert.equal(payload.items?.[0]?.targetAgent?.agentId, ops.agentId);
    assert.equal(payload.items?.[0]?.managerAgent?.agentId, ops.agentId);
    assert.equal(payload.items?.[0]?.sourceAgent?.agentId, frontend.agentId);
    assert.equal(payload.items?.[0]?.latestWaitingMessage?.messageType, "approval_request");
  });
});

test("POST /api/agents/collaboration-dashboard 会返回跨父任务汇总台，并支持 attentionOnly 过滤", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const manager = await createManagedAgent(baseUrl, authHeaders, "owner-agent-collaboration-dashboard", {
      departmentRole: "经理",
      displayName: "经理·曜",
      mission: "负责拆解任务与汇总结果。",
    });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-collaboration-dashboard", {
      departmentRole: "后端",
      displayName: "后端·衡",
      mission: "负责接口与存储。",
    });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-collaboration-dashboard", {
      departmentRole: "前端",
      displayName: "前端·岚",
      mission: "负责页面联调。",
    });

    const urgentParent = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: manager.agentId,
      dispatchReason: "推进 manager dashboard",
      goal: "把组织级跨父任务汇总挂到 Agents 面板",
      priority: "urgent",
      now: "2026-04-07T15:00:00.000Z",
    });
    const urgentChild = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: frontend.agentId,
      sourceType: "agent",
      sourceAgentId: manager.agentId,
      sourcePrincipalId: manager.principalId,
      parentWorkItemId: urgentParent.workItem.workItemId,
      dispatchReason: "补 Web 汇总卡片",
      goal: "补 attention badge 与跳转动作",
      priority: "high",
      now: "2026-04-07T15:05:00.000Z",
    });
    const normalParent = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: manager.agentId,
      dispatchReason: "同步文档说明",
      goal: "把实现说明落到文档",
      priority: "normal",
      now: "2026-04-07T15:06:00.000Z",
    });
    const normalChild = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: backend.agentId,
      sourceType: "agent",
      sourceAgentId: manager.agentId,
      sourcePrincipalId: manager.principalId,
      parentWorkItemId: normalParent.workItem.workItemId,
      dispatchReason: "补文档内容",
      goal: "同步 P6 dashboard 实现细节",
      priority: "normal",
      now: "2026-04-07T15:07:00.000Z",
    });

    runtimeStore.saveAgentWorkItem({
      ...urgentChild.workItem,
      status: "waiting_human",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许直接把 dashboard 默认暴露在 Agents 面板？",
        choices: ["approve", "deny"],
      },
      updatedAt: "2026-04-07T15:10:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...normalChild.workItem,
      status: "completed",
      completedAt: "2026-04-07T15:12:00.000Z",
      updatedAt: "2026-04-07T15:12:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...normalParent.workItem,
      status: "completed",
      completedAt: "2026-04-07T15:12:20.000Z",
      updatedAt: "2026-04-07T15:12:20.000Z",
    });

    runtime.getManagedAgentCoordinationService().sendAgentMessage({
      ownerPrincipalId: "principal-local-owner",
      fromAgentId: frontend.agentId,
      toAgentId: manager.agentId,
      workItemId: urgentChild.workItem.workItemId,
      messageType: "escalation",
      payload: {
        summary: "当前 UI 交互还需要顶层治理拍板。",
      },
      priority: "high",
      now: "2026-04-07T15:10:30.000Z",
    });
    runtime.getManagedAgentCoordinationService().createAgentHandoff({
      ownerPrincipalId: "principal-local-owner",
      fromAgentId: backend.agentId,
      toAgentId: manager.agentId,
      workItemId: normalChild.workItem.workItemId,
      summary: "文档同步已收口。",
      blockers: [],
      recommendedNextActions: ["继续做界面联调"],
      attachedArtifacts: ["docs/product/themis-p6-manager-governance-dashboard-plan.md"],
      now: "2026-04-07T15:12:30.000Z",
    });

    const response = await postJson(
      baseUrl,
      "/api/agents/collaboration-dashboard",
      {
        ...buildIdentityPayload("owner-agent-collaboration-dashboard"),
        managerAgentId: manager.agentId,
        attentionOnly: true,
        limit: 10,
      },
      authHeaders,
    );

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      summary?: {
        totalCount?: number;
        urgentCount?: number;
        attentionCount?: number;
        normalCount?: number;
      };
      items?: Array<{
        parentWorkItem?: { workItemId?: string; goal?: string };
        managerAgent?: { agentId?: string; displayName?: string };
        waitingHumanChildCount?: number;
        latestWaitingWorkItemId?: string;
        latestWaitingTargetAgentId?: string;
        latestWaitingActionType?: string;
        attentionLevel?: string;
        attentionReasons?: string[];
        latestWaitingMessage?: { messageType?: string };
        lastActivityKind?: string;
      }>;
    };
    assert.equal(payload.summary?.totalCount, 1);
    assert.equal(payload.summary?.urgentCount, 1);
    assert.equal(payload.summary?.attentionCount, 0);
    assert.equal(payload.summary?.normalCount, 0);
    assert.equal(payload.items?.length, 1);
    assert.equal(payload.items?.[0]?.parentWorkItem?.workItemId, urgentParent.workItem.workItemId);
    assert.equal(payload.items?.[0]?.parentWorkItem?.goal, "把组织级跨父任务汇总挂到 Agents 面板");
    assert.equal(payload.items?.[0]?.managerAgent?.agentId, manager.agentId);
    assert.equal(payload.items?.[0]?.managerAgent?.displayName, "经理·曜");
    assert.equal(payload.items?.[0]?.waitingHumanChildCount, 1);
    assert.equal(payload.items?.[0]?.latestWaitingWorkItemId, urgentChild.workItem.workItemId);
    assert.equal(payload.items?.[0]?.latestWaitingTargetAgentId, frontend.agentId);
    assert.equal(payload.items?.[0]?.latestWaitingActionType, "approval");
    assert.equal(payload.items?.[0]?.attentionLevel, "urgent");
    assert.match(payload.items?.[0]?.attentionReasons?.join("；") ?? "", /等待顶层治理/);
    assert.equal(payload.items?.[0]?.latestWaitingMessage?.messageType, "escalation");
    assert.equal(payload.items?.[0]?.lastActivityKind, "waiting");
  });
});

test("POST /api/agents/governance-overview 会返回组织级治理摘要与 manager 热点", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const manager = await createManagedAgent(baseUrl, authHeaders, "owner-agent-governance-overview", {
      departmentRole: "经理",
      displayName: "经理·曜",
      mission: "负责拆解任务与汇总结果。",
    });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-governance-overview", {
      departmentRole: "前端",
      displayName: "前端·岚",
      mission: "负责页面联调。",
    });

    const parent = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: manager.agentId,
      dispatchReason: "推进治理工作台",
      goal: "把 overview、筛选和热点卡接进 Agents 面板",
      priority: "urgent",
      now: "2026-04-08T09:00:00.000Z",
    });
    const child = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: frontend.agentId,
      sourceType: "agent",
      sourceAgentId: manager.agentId,
      sourcePrincipalId: manager.principalId,
      parentWorkItemId: parent.workItem.workItemId,
      dispatchReason: "补治理摘要 UI",
      goal: "显示组织级摘要与 manager 热点",
      priority: "high",
      now: "2026-04-08T09:01:00.000Z",
    });

    runtimeStore.saveAgentWorkItem({
      ...child.workItem,
      status: "waiting_human",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许把治理摘要条默认显示在 Agents 面板顶端？",
        choices: ["approve", "deny"],
      },
      updatedAt: "2026-04-08T09:05:00.000Z",
    });

    const response = await postJson(
      baseUrl,
      "/api/agents/governance-overview",
      buildIdentityPayload("owner-agent-governance-overview"),
      authHeaders,
    );

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      overview?: {
        urgentParentCount?: number;
        attentionParentCount?: number;
        waitingHumanCount?: number;
        waitingAgentCount?: number;
        managersNeedingAttentionCount?: number;
        managerHotspots?: Array<{
          managerAgent?: { agentId?: string; displayName?: string };
          urgentParentCount?: number;
          waitingCount?: number;
        }>;
      };
    };
    assert.equal(payload.overview?.urgentParentCount, 1);
    assert.equal(payload.overview?.attentionParentCount, 0);
    assert.equal(payload.overview?.waitingHumanCount, 1);
    assert.equal(payload.overview?.waitingAgentCount, 0);
    assert.equal(payload.overview?.managersNeedingAttentionCount, 1);
    assert.equal(payload.overview?.managerHotspots?.[0]?.managerAgent?.agentId, manager.agentId);
    assert.equal(payload.overview?.managerHotspots?.[0]?.managerAgent?.displayName, "经理·曜");
    assert.equal(payload.overview?.managerHotspots?.[0]?.urgentParentCount, 1);
    assert.equal(payload.overview?.managerHotspots?.[0]?.waitingCount, 1);
  });
});

test("POST /api/agents/work-items/escalate 会把 waiting_agent 升级成顶层治理并关闭待回复 mailbox", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-waiting-escalate", {
      departmentRole: "前端",
      displayName: "前端·序",
      mission: "负责 Web 工作台。",
    });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-waiting-escalate", {
      departmentRole: "运维",
      displayName: "运维·衡",
      mission: "负责发布和值班。",
    });

    const dispatched = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: ops.agentId,
      sourceType: "agent",
      sourceAgentId: frontend.agentId,
      sourcePrincipalId: frontend.principalId,
      dispatchReason: "等待发布审批",
      goal: "确认是否可以继续部署",
      priority: "urgent",
      now: "2026-04-07T09:00:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "waiting_agent",
      waitingActionRequest: {
        waitingFor: "agent",
        actionType: "approval",
        prompt: "是否允许执行 deploy production",
        choices: ["approve", "deny"],
      },
      updatedAt: "2026-04-07T09:01:00.000Z",
    });
    const waiting = runtime.getManagedAgentCoordinationService().sendAgentMessage({
      ownerPrincipalId: "principal-local-owner",
      fromAgentId: ops.agentId,
      toAgentId: frontend.agentId,
      workItemId: dispatched.workItem.workItemId,
      runId: "run-http-escalate-1",
      messageType: "approval_request",
      payload: {
        prompt: "是否允许执行 deploy production",
        choices: ["approve", "deny"],
      },
      priority: "urgent",
      requiresAck: true,
      now: "2026-04-07T09:01:30.000Z",
    });

    const response = await postJson(baseUrl, "/api/agents/work-items/escalate", {
      ...buildIdentityPayload("owner-agent-waiting-escalate"),
      workItemId: dispatched.workItem.workItemId,
      escalation: {
        inputText: "上游 agent 暂时无响应，先转给顶层治理。",
      },
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      workItem?: {
        workItemId?: string;
        status?: string;
        waitingActionRequest?: { waitingFor?: string; sourceType?: string; escalationInputText?: string };
      };
      latestWaitingMessage?: { messageId?: string; messageType?: string };
      ackedMailboxEntries?: Array<{ mailboxEntryId?: string; status?: string }>;
    };
    assert.equal(payload.workItem?.workItemId, dispatched.workItem.workItemId);
    assert.equal(payload.workItem?.status, "waiting_human");
    assert.equal(payload.workItem?.waitingActionRequest?.waitingFor, "human");
    assert.equal(payload.workItem?.waitingActionRequest?.sourceType, "agent_escalation");
    assert.equal(payload.workItem?.waitingActionRequest?.escalationInputText, "上游 agent 暂时无响应，先转给顶层治理。");
    assert.equal(payload.latestWaitingMessage?.messageId, waiting.message.messageId);
    assert.equal(payload.latestWaitingMessage?.messageType, "approval_request");
    assert.equal(payload.ackedMailboxEntries?.length, 1);
    assert.equal(payload.ackedMailboxEntries?.[0]?.mailboxEntryId, waiting.mailboxEntry.mailboxEntryId);
    assert.equal(payload.ackedMailboxEntries?.[0]?.status, "acked");
    assert.equal(runtimeStore.getAgentMailboxEntry(waiting.mailboxEntry.mailboxEntryId)?.status, "acked");
  });
});

test("POST /api/agents/runs/list、/runs/detail 会返回 scheduler claim 之后的 run 视图", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-runs", {
      departmentRole: "后端",
      displayName: "后端·澄",
      mission: "负责服务端执行。",
    });

    const dispatchResponse = await postJson(baseUrl, "/api/agents/dispatch", {
      ...buildIdentityPayload("owner-agent-runs"),
      workItem: {
        targetAgentId: backend.agentId,
        dispatchReason: "让 scheduler 先把 queued item claim 起来",
        goal: "补 runs/list 与 runs/detail 的最小观察面",
        priority: "high",
      },
    }, authHeaders);

    assert.equal(dispatchResponse.status, 200);
    const dispatchPayload = await dispatchResponse.json() as {
      workItem?: { workItemId?: string };
    };
    assert.ok(dispatchPayload.workItem?.workItemId);

    const claimed = runtime.getManagedAgentSchedulerService().tick({
      schedulerId: "scheduler-http",
      now: "2026-04-06T08:50:00.000Z",
    }).claimed;
    assert.ok(claimed);

    const listResponse = await postJson(baseUrl, "/api/agents/runs/list", {
      ...buildIdentityPayload("owner-agent-runs"),
      workItemId: dispatchPayload.workItem?.workItemId,
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as {
      runs?: Array<{ runId?: string; workItemId?: string; targetAgentId?: string; schedulerId?: string; status?: string }>;
    };
    assert.equal(listPayload.runs?.length, 1);
    assert.equal(listPayload.runs?.[0]?.runId, claimed?.run.runId);
    assert.equal(listPayload.runs?.[0]?.workItemId, dispatchPayload.workItem?.workItemId);
    assert.equal(listPayload.runs?.[0]?.targetAgentId, backend.agentId);
    assert.equal(listPayload.runs?.[0]?.schedulerId, "scheduler-http");
    assert.equal(listPayload.runs?.[0]?.status, "created");

    const detailResponse = await postJson(baseUrl, "/api/agents/runs/detail", {
      ...buildIdentityPayload("owner-agent-runs"),
      runId: claimed?.run.runId,
    }, authHeaders);

    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      run?: { runId?: string; schedulerId?: string; status?: string };
      workItem?: { workItemId?: string; status?: string };
      targetAgent?: { agentId?: string };
      organization?: { organizationId?: string };
    };
    assert.equal(detailPayload.run?.runId, claimed?.run.runId);
    assert.equal(detailPayload.run?.schedulerId, "scheduler-http");
    assert.equal(detailPayload.run?.status, "created");
    assert.equal(detailPayload.workItem?.workItemId, dispatchPayload.workItem?.workItemId);
    assert.equal(detailPayload.workItem?.status, "planning");
    assert.equal(detailPayload.targetAgent?.agentId, backend.agentId);
    assert.ok(detailPayload.organization?.organizationId);
  });
});

test("POST /api/agents/mailbox/list、/mailbox/ack 会返回并确认 agent 间结构化消息", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-mailbox", {
      departmentRole: "前端",
      displayName: "前端·澄",
      mission: "负责 Web 工作台。",
    });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-mailbox", {
      departmentRole: "后端",
      displayName: "后端·衡",
      mission: "负责服务端接口。",
    });

    const dispatchResponse = await postJson(baseUrl, "/api/agents/dispatch", {
      ...buildIdentityPayload("owner-agent-mailbox"),
      workItem: {
        targetAgentId: backend.agentId,
        sourceAgentId: frontend.agentId,
        dispatchReason: "前端依赖新接口",
        goal: "提供 agent detail 与 mailbox pull 所需 API",
        contextPacket: {
          ticket: "AGENT-HTTP-1",
        },
        priority: "urgent",
      },
    }, authHeaders);

    assert.equal(dispatchResponse.status, 200);
    const dispatchPayload = await dispatchResponse.json() as {
      workItem?: { workItemId?: string };
      dispatchMessage?: { messageId?: string; messageType?: string; fromAgentId?: string; toAgentId?: string };
      mailboxEntry?: { mailboxEntryId?: string; ownerAgentId?: string; status?: string };
    };
    assert.equal(dispatchPayload.dispatchMessage?.messageType, "dispatch");
    assert.equal(dispatchPayload.dispatchMessage?.fromAgentId, frontend.agentId);
    assert.equal(dispatchPayload.dispatchMessage?.toAgentId, backend.agentId);
    assert.equal(dispatchPayload.mailboxEntry?.ownerAgentId, backend.agentId);
    assert.equal(dispatchPayload.mailboxEntry?.status, "pending");

    const mailboxResponse = await postJson(baseUrl, "/api/agents/mailbox/list", {
      ...buildIdentityPayload("owner-agent-mailbox"),
      agentId: backend.agentId,
    }, authHeaders);

    assert.equal(mailboxResponse.status, 200);
    const mailboxPayload = await mailboxResponse.json() as {
      agent?: { agentId?: string };
      items?: Array<{
        entry?: { mailboxEntryId?: string; status?: string };
        message?: { messageId?: string; messageType?: string; workItemId?: string };
      }>;
    };
    assert.equal(mailboxPayload.agent?.agentId, backend.agentId);
    assert.equal(mailboxPayload.items?.length, 1);
    assert.equal(mailboxPayload.items?.[0]?.entry?.mailboxEntryId, dispatchPayload.mailboxEntry?.mailboxEntryId);
    assert.equal(mailboxPayload.items?.[0]?.message?.messageType, "dispatch");
    assert.equal(mailboxPayload.items?.[0]?.message?.workItemId, dispatchPayload.workItem?.workItemId);

    const detailResponse = await postJson(baseUrl, "/api/agents/work-items/detail", {
      ...buildIdentityPayload("owner-agent-mailbox"),
      workItemId: dispatchPayload.workItem?.workItemId,
    }, authHeaders);

    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      sourceAgent?: { agentId?: string };
      messages?: Array<{ messageType?: string; fromAgentId?: string; toAgentId?: string }>;
    };
    assert.equal(detailPayload.sourceAgent?.agentId, frontend.agentId);
    assert.equal(detailPayload.messages?.length, 1);
    assert.equal(detailPayload.messages?.[0]?.messageType, "dispatch");
    assert.equal(detailPayload.messages?.[0]?.fromAgentId, frontend.agentId);
    assert.equal(detailPayload.messages?.[0]?.toAgentId, backend.agentId);

    const ackResponse = await postJson(baseUrl, "/api/agents/mailbox/ack", {
      ...buildIdentityPayload("owner-agent-mailbox"),
      agentId: backend.agentId,
      mailboxEntryId: dispatchPayload.mailboxEntry?.mailboxEntryId,
    }, authHeaders);

    assert.equal(ackResponse.status, 200);
    const ackPayload = await ackResponse.json() as {
      mailboxEntry?: { mailboxEntryId?: string; status?: string; ackedAt?: string };
      message?: { messageId?: string };
    };
    assert.equal(ackPayload.mailboxEntry?.mailboxEntryId, dispatchPayload.mailboxEntry?.mailboxEntryId);
    assert.equal(ackPayload.mailboxEntry?.status, "acked");
    assert.ok(ackPayload.mailboxEntry?.ackedAt);
    assert.equal(ackPayload.message?.messageId, dispatchPayload.dispatchMessage?.messageId);
  });
});

test("POST /api/agents/mailbox/ack 在 mailbox entry 不存在时返回错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-mailbox-missing", {
      departmentRole: "后端",
      displayName: "后端·曜",
      mission: "负责服务端接口。",
    });

    const response = await postJson(baseUrl, "/api/agents/mailbox/ack", {
      ...buildIdentityPayload("owner-agent-mailbox-missing"),
      agentId: backend.agentId,
      mailboxEntryId: "mailbox-missing",
    }, authHeaders);

    assert.equal(response.status, 400);
    const payload = await response.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "Mailbox entry does not exist.");
  });
});

test("POST /api/agents/mailbox/pull、/mailbox/respond 会 lease 邮箱并把 waiting work item 重新排回队列", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-mailbox-respond", {
      departmentRole: "前端",
      displayName: "前端·序",
      mission: "负责 Web 工作台。",
    });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-mailbox-respond", {
      departmentRole: "后端",
      displayName: "后端·曜",
      mission: "负责服务端接口。",
    });

    const dispatched = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: backend.agentId,
      sourceType: "agent",
      sourceAgentId: frontend.agentId,
      sourcePrincipalId: frontend.principalId,
      dispatchReason: "等待前端确认发布步骤",
      goal: "确认是否可以继续发布",
      priority: "urgent",
      now: "2026-04-06T14:10:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "waiting_agent",
      updatedAt: "2026-04-06T14:11:00.000Z",
    });
    runtimeStore.saveAgentRun({
      runId: "run-http-waiting-1",
      organizationId: dispatched.workItem.organizationId,
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: backend.agentId,
      schedulerId: "scheduler-http",
      leaseToken: "lease-http-waiting-1",
      leaseExpiresAt: "2026-04-06T14:20:00.000Z",
      status: "waiting_action",
      startedAt: "2026-04-06T14:11:00.000Z",
      lastHeartbeatAt: "2026-04-06T14:11:00.000Z",
      createdAt: "2026-04-06T14:11:00.000Z",
      updatedAt: "2026-04-06T14:11:00.000Z",
    });
    const waiting = runtime.getManagedAgentCoordinationService().sendAgentMessage({
      ownerPrincipalId: "principal-local-owner",
      fromAgentId: backend.agentId,
      toAgentId: frontend.agentId,
      workItemId: dispatched.workItem.workItemId,
      runId: "run-http-waiting-1",
      messageType: "approval_request",
      payload: {
        prompt: "是否允许执行 git push origin main",
      },
      priority: "urgent",
      requiresAck: true,
      now: "2026-04-06T14:11:30.000Z",
    });

    const pullResponse = await postJson(baseUrl, "/api/agents/mailbox/pull", {
      ...buildIdentityPayload("owner-agent-mailbox-respond"),
      agentId: frontend.agentId,
    }, authHeaders);

    assert.equal(pullResponse.status, 200);
    const pullPayload = await pullResponse.json() as {
      item?: {
        entry?: { mailboxEntryId?: string; status?: string };
        message?: { messageId?: string; messageType?: string };
      } | null;
    };
    assert.equal(pullPayload.item?.entry?.mailboxEntryId, waiting.mailboxEntry.mailboxEntryId);
    assert.equal(pullPayload.item?.entry?.status, "leased");
    assert.equal(pullPayload.item?.message?.messageType, "approval_request");

    const respondResponse = await postJson(baseUrl, "/api/agents/mailbox/respond", {
      ...buildIdentityPayload("owner-agent-mailbox-respond"),
      agentId: frontend.agentId,
      mailboxEntryId: waiting.mailboxEntry.mailboxEntryId,
      response: {
        decision: "approve",
        inputText: "可以继续，请同步 release note。",
      },
    }, authHeaders);

    assert.equal(respondResponse.status, 200);
    const respondPayload = await respondResponse.json() as {
      sourceMailboxEntry?: { status?: string };
      responseMessage?: { messageType?: string; toAgentId?: string };
      responseMailboxEntry?: { ownerAgentId?: string; status?: string };
      resumedWorkItem?: { workItemId?: string; status?: string };
      resumedRuns?: Array<{ runId?: string; status?: string; failureCode?: string }>;
    };
    assert.equal(respondPayload.sourceMailboxEntry?.status, "acked");
    assert.equal(respondPayload.responseMessage?.messageType, "approval_result");
    assert.equal(respondPayload.responseMessage?.toAgentId, backend.agentId);
    assert.equal(respondPayload.responseMailboxEntry?.ownerAgentId, backend.agentId);
    assert.equal(respondPayload.responseMailboxEntry?.status, "acked");
    assert.equal(respondPayload.resumedWorkItem?.workItemId, dispatched.workItem.workItemId);
    assert.equal(respondPayload.resumedWorkItem?.status, "queued");
    assert.equal(respondPayload.resumedRuns?.length, 1);
    assert.equal(respondPayload.resumedRuns?.[0]?.runId, "run-http-waiting-1");
    assert.equal(respondPayload.resumedRuns?.[0]?.status, "interrupted");
    assert.equal(respondPayload.resumedRuns?.[0]?.failureCode, "WAITING_RESUME_TRIGGERED");
  });
});

test("POST /api/agents/work-items/respond 会提交顶层治理回复并把 waiting_human work item 重新排回队列", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-human-respond", {
      departmentRole: "运维",
      displayName: "运维·衡",
      mission: "负责发布和值班。",
    });

    const dispatched = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: ops.agentId,
      dispatchReason: "等待人工审批发布动作",
      goal: "确认是否允许继续执行生产发布",
      priority: "urgent",
      now: "2026-04-06T14:20:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "waiting_human",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许执行 deploy production",
        choices: ["approve", "deny"],
      },
      updatedAt: "2026-04-06T14:21:00.000Z",
    });
    runtimeStore.saveAgentRun({
      runId: "run-http-human-waiting-1",
      organizationId: dispatched.workItem.organizationId,
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: ops.agentId,
      schedulerId: "scheduler-http",
      leaseToken: "lease-http-human-waiting-1",
      leaseExpiresAt: "2026-04-06T14:30:00.000Z",
      status: "waiting_action",
      startedAt: "2026-04-06T14:21:00.000Z",
      lastHeartbeatAt: "2026-04-06T14:21:00.000Z",
      createdAt: "2026-04-06T14:21:00.000Z",
      updatedAt: "2026-04-06T14:21:00.000Z",
    });

    const response = await postJson(baseUrl, "/api/agents/work-items/respond", {
      ...buildIdentityPayload("owner-agent-human-respond"),
      workItemId: dispatched.workItem.workItemId,
      response: {
        decision: "approve",
        inputText: "可以继续，但先确认监控正常。",
      },
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      workItem?: {
        workItemId?: string;
        status?: string;
        latestHumanResponse?: { decision?: string; inputText?: string };
      };
      resumedRuns?: Array<{ runId?: string; status?: string; failureCode?: string }>;
    };
    assert.equal(payload.workItem?.workItemId, dispatched.workItem.workItemId);
    assert.equal(payload.workItem?.status, "queued");
    assert.equal(payload.workItem?.latestHumanResponse?.decision, "approve");
    assert.equal(payload.resumedRuns?.length, 1);
    assert.equal(payload.resumedRuns?.[0]?.runId, "run-http-human-waiting-1");
    assert.equal(payload.resumedRuns?.[0]?.status, "interrupted");
    assert.equal(payload.resumedRuns?.[0]?.failureCode, "WAITING_RESUME_TRIGGERED");
  });
});

test("POST /api/agents/work-items/cancel 会取消安全可收口的 work item，并返回关闭结果", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-work-item-cancel", {
      departmentRole: "前端",
      displayName: "前端·岚",
      mission: "负责 Web 工作台。",
    });
    const backend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-work-item-cancel", {
      departmentRole: "后端",
      displayName: "后端·衡",
      mission: "负责接口与存储。",
    });

    const dispatched = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: backend.agentId,
      sourceAgentId: frontend.agentId,
      dispatchReason: "原定后端任务作废",
      goal: "取消这条尚未开始执行的 agent work item",
      priority: "high",
      now: "2026-04-07T06:00:00.000Z",
    });

    const response = await postJson(baseUrl, "/api/agents/work-items/cancel", {
      ...buildIdentityPayload("owner-agent-work-item-cancel"),
      workItemId: dispatched.workItem.workItemId,
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      workItem?: { workItemId?: string; status?: string; completedAt?: string };
      ackedMailboxEntries?: Array<{ mailboxEntryId?: string; status?: string }>;
      notificationMessage?: { messageType?: string; toAgentId?: string };
      notificationMailboxEntry?: { ownerAgentId?: string; status?: string };
    };
    assert.equal(payload.workItem?.workItemId, dispatched.workItem.workItemId);
    assert.equal(payload.workItem?.status, "cancelled");
    assert.ok(typeof payload.workItem?.completedAt === "string" && payload.workItem.completedAt.length > 0);
    assert.equal(payload.ackedMailboxEntries?.length, 1);
    assert.equal(payload.ackedMailboxEntries?.[0]?.mailboxEntryId, dispatched.mailboxEntry?.mailboxEntryId);
    assert.equal(payload.ackedMailboxEntries?.[0]?.status, "acked");
    assert.equal(payload.notificationMessage?.messageType, "cancel");
    assert.equal(payload.notificationMessage?.toAgentId, frontend.agentId);
    assert.equal(payload.notificationMailboxEntry?.ownerAgentId, frontend.agentId);
    assert.equal(payload.notificationMailboxEntry?.status, "pending");
  });
});

test("POST /api/agents/work-items/cancel 目前会拒绝取消仍有 active run 的 work item", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-work-item-cancel-active", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责发布和值班。",
    });

    const dispatched = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: ops.agentId,
      dispatchReason: "仍在执行的任务",
      goal: "这条 work item 应该先保留到真正中断能力上线",
      priority: "urgent",
      now: "2026-04-07T06:10:00.000Z",
    });
    runtimeStore.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "running",
      startedAt: "2026-04-07T06:11:00.000Z",
      updatedAt: "2026-04-07T06:11:00.000Z",
    });
    runtimeStore.saveAgentRun({
      runId: "run-http-active-cancel-blocked-1",
      organizationId: dispatched.workItem.organizationId,
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: ops.agentId,
      schedulerId: "scheduler-http",
      leaseToken: "lease-http-active-cancel-blocked-1",
      leaseExpiresAt: "2026-04-07T06:20:00.000Z",
      status: "running",
      startedAt: "2026-04-07T06:11:00.000Z",
      lastHeartbeatAt: "2026-04-07T06:11:30.000Z",
      createdAt: "2026-04-07T06:11:00.000Z",
      updatedAt: "2026-04-07T06:11:30.000Z",
    });

    const response = await postJson(baseUrl, "/api/agents/work-items/cancel", {
      ...buildIdentityPayload("owner-agent-work-item-cancel-active"),
      workItemId: dispatched.workItem.workItemId,
    }, authHeaders);

    assert.equal(response.status, 400);
    const payload = await response.json() as {
      error?: { code?: string; message?: string };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "Work item has active runs and cannot be cancelled yet.");
  });
});

test("POST /api/agents/work-items/cancel 会通过共享 execution service 中断真正 running 的 run", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-agents-cancel-running-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const sessionState: {
    notificationHandler: ((notification: CodexAppServerNotification) => void) | null;
    turns: Array<{ threadId: string; input: string }>;
    interruptedTurns: Array<{ threadId: string; turnId: string }>;
  } = {
    notificationHandler: null,
    turns: [],
    interruptedTurns: [],
  };
  const appServerRuntime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {},
      startThread: async () => ({ threadId: "thread-http-running-cancel-1" }),
      resumeThread: async (threadId) => ({ threadId }),
      startTurn: async (threadId, input) => {
        sessionState.turns.push({
          threadId,
          input: typeof input === "string" ? input : JSON.stringify(input),
        });
        return { turnId: "turn-http-running-cancel-1" };
      },
      interruptTurn: async (threadId, turnId) => {
        sessionState.interruptedTurns.push({ threadId, turnId });
        setTimeout(() => {
          sessionState.notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId,
              turn: {
                id: turnId,
                items: [],
                status: "cancelled",
                error: {
                  message: "Turn cancelled by governance.",
                },
              },
            },
          });
        }, 0);
      },
      close: async () => {},
      onNotification: (handler) => {
        sessionState.notificationHandler = handler;
      },
      onServerRequest: () => {},
      respondToServerRequest: async () => {},
      rejectServerRequest: async () => {},
    }),
  });
  const executionService = new ManagedAgentExecutionService({
    registry: runtimeStore,
    runtime: appServerRuntime,
    schedulerService: appServerRuntime.getManagedAgentSchedulerService(),
    coordinationService: appServerRuntime.getManagedAgentCoordinationService(),
  });
  const server = createThemisHttpServer({
    runtime,
    managedAgentExecutionService: executionService,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  try {
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const frontend = await createManagedAgent(baseUrl, authHeaders, "owner-agent-http-running-cancel", {
      departmentRole: "前端",
      displayName: "前端·岚",
      mission: "负责 Web 工作台。",
    });
    const ops = await createManagedAgent(baseUrl, authHeaders, "owner-agent-http-running-cancel", {
      departmentRole: "运维",
      displayName: "运维·曜",
      mission: "负责发布和值班。",
    });

    const dispatched = runtime.getManagedAgentCoordinationService().dispatchWorkItem({
      ownerPrincipalId: "principal-local-owner",
      targetAgentId: ops.agentId,
      sourceType: "agent",
      sourceAgentId: frontend.agentId,
      sourcePrincipalId: frontend.principalId,
      dispatchReason: "发布前检查还在运行",
      goal: "保持 running，直到顶层发起取消",
      priority: "urgent",
      now: "2026-04-07T08:00:00.000Z",
    });

    const runPromise = executionService.runNext({
      schedulerId: "scheduler-http-running-cancel",
      now: "2026-04-07T08:01:00.000Z",
    });

    await waitFor(() => {
      const run = runtimeStore.listAgentRunsByWorkItem(dispatched.workItem.workItemId)[0];
      return sessionState.turns.length === 1 && run?.status === "running";
    });

    const response = await postJson(baseUrl, "/api/agents/work-items/cancel", {
      ...buildIdentityPayload("owner-agent-http-running-cancel"),
      workItemId: dispatched.workItem.workItemId,
    }, authHeaders);
    const settled = await runPromise;

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      workItem?: { status?: string; completedAt?: string };
      notificationMessage?: { messageType?: string; toAgentId?: string };
    };
    assert.equal(payload.workItem?.status, "cancelled");
    assert.ok(typeof payload.workItem?.completedAt === "string" && payload.workItem.completedAt.length > 0);
    assert.equal(payload.notificationMessage?.messageType, "cancel");
    assert.equal(payload.notificationMessage?.toAgentId, frontend.agentId);
    assert.equal(settled.execution?.result, "cancelled");
    assert.equal(settled.execution?.run.status, "cancelled");
    assert.equal(sessionState.interruptedTurns.length, 1);
    assert.equal(sessionState.interruptedTurns[0]?.threadId, "thread-http-running-cancel-1");
    assert.equal(sessionState.interruptedTurns[0]?.turnId, "turn-http-running-cancel-1");
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
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
