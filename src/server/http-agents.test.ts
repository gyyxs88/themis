import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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

interface MockPlatformGatewayServer {
  baseUrl: string;
  calls: Array<{
    pathname: string;
    body: Record<string, unknown>;
  }>;
  close: () => Promise<void>;
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

const PLATFORM_GATEWAY_ENV_KEYS = [
  "THEMIS_PLATFORM_BASE_URL",
  "THEMIS_PLATFORM_OWNER_PRINCIPAL_ID",
  "THEMIS_PLATFORM_WEB_ACCESS_TOKEN",
] as const;

async function withClearedOpenAICompatEnv<T>(fn: () => Promise<T> | T): Promise<T> {
  const savedEnv = new Map<string, string | undefined>();

  for (const key of OPENAI_COMPAT_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    return await fn();
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

async function withClearedPlatformGatewayEnv<T>(fn: () => Promise<T> | T): Promise<T> {
  const savedEnv = new Map<string, string | undefined>();

  for (const key of PLATFORM_GATEWAY_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    return await fn();
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
  await withClearedOpenAICompatEnv(async () => {
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
  });
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

async function createMockPlatformGatewayServer(): Promise<MockPlatformGatewayServer> {
  const calls: MockPlatformGatewayServer["calls"] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await readRequestBody(request);
    calls.push({
      pathname: url.pathname,
      body,
    });

    assert.equal(request.headers.authorization, "Bearer gateway-secret");
    assert.equal(body.ownerPrincipalId, "principal-platform-owner");

    if (url.pathname === "/api/platform/agents/list") {
      writeJson(response, 200, {
        organizations: [
          {
            organizationId: "org-platform",
            displayName: "平台组织",
          },
        ],
        agents: [
          {
            agentId: "agent-platform-1",
            organizationId: "org-platform",
            principalId: "principal-platform-agent-1",
            displayName: "平台·后端",
            departmentRole: "后端",
            mission: "来自平台控制面的详情。",
            status: "active",
          },
        ],
      });
      return;
    }

    if (url.pathname === "/api/platform/agents/detail") {
      writeJson(response, 200, {
        organization: {
          organizationId: "org-platform",
          displayName: "平台组织",
        },
        principal: {
          principalId: "principal-platform-agent-1",
          kind: "managed_agent",
        },
        agent: {
          agentId: "agent-platform-1",
          organizationId: "org-platform",
          principalId: "principal-platform-agent-1",
          displayName: "平台·后端",
          departmentRole: "后端",
          mission: "来自平台控制面的详情。",
          status: "active",
        },
        workspacePolicy: {
          workspacePath: "/workspace/platform",
        },
        runtimeProfile: {
          model: "gpt-5.4",
        },
        authAccounts: [],
        thirdPartyProviders: [],
      });
      return;
    }

    if (url.pathname === "/api/platform/agents/create") {
      writeJson(response, 200, {
        organization: {
          organizationId: "org-platform",
          displayName: "平台组织",
        },
        principal: {
          principalId: "principal-platform-created",
          kind: "managed_agent",
        },
        agent: {
          agentId: "agent-platform-created",
          organizationId: "org-platform",
          principalId: "principal-platform-created",
          displayName: body.agent && typeof body.agent === "object" && "displayName" in body.agent
            ? body.agent.displayName
            : "平台·新建",
          departmentRole: body.agent && typeof body.agent === "object" && "departmentRole" in body.agent
            ? body.agent.departmentRole
            : "平台工程",
          mission: body.agent && typeof body.agent === "object" && "mission" in body.agent
            ? body.agent.mission
            : "",
          status: "active",
        },
      });
      return;
    }

    if (url.pathname === "/api/platform/agents/waiting/list") {
      writeJson(response, 200, {
        summary: {
          totalCount: 1,
          waitingHumanCount: 1,
          waitingAgentCount: 0,
          escalationCount: 0,
        },
        items: [
          {
            workItem: {
              workItemId: "work-item-platform-1",
              organizationId: "org-platform",
              targetAgentId: "agent-platform-1",
              status: "waiting_human",
              goal: "等待顶层治理确认。",
            },
            targetAgent: {
              agentId: "agent-platform-1",
              displayName: "平台·后端",
            },
            managerAgent: null,
            attentionLevel: "urgent",
            attentionReasons: ["等待人工确认"],
          },
        ],
      });
      return;
    }

    if (url.pathname === "/api/platform/work-items/cancel") {
      writeJson(response, 200, {
        organization: {
          organizationId: "org-platform",
          displayName: "平台组织",
        },
        targetAgent: {
          agentId: "agent-platform-1",
          displayName: "平台·后端",
        },
        workItem: {
          workItemId: body.workItemId,
          organizationId: "org-platform",
          targetAgentId: "agent-platform-1",
          status: "cancelled",
          goal: "已取消",
        },
        ackedMailboxEntries: [],
      });
      return;
    }

    writeJson(response, 404, {
      error: {
        message: `Unexpected platform route: ${url.pathname}`,
      },
    });
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve mock platform gateway server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: async () => {
      await closeServer(listeningServer);
    },
  };
}

test("POST /api/agents/list、/detail 在配置平台上游后会走纯 gateway 读平台事实", async () => {
  await withClearedPlatformGatewayEnv(async () => {
    const platformServer = await createMockPlatformGatewayServer();
    process.env.THEMIS_PLATFORM_BASE_URL = platformServer.baseUrl;
    process.env.THEMIS_PLATFORM_OWNER_PRINCIPAL_ID = "principal-platform-owner";
    process.env.THEMIS_PLATFORM_WEB_ACCESS_TOKEN = "gateway-secret";

    try {
      await withHttpServer(async ({ baseUrl, runtimeStore }) => {
        const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
        const listResponse = await postJson(
          baseUrl,
          "/api/agents/list",
          buildIdentityPayload("owner-managed-agent-gateway"),
          authHeaders,
        );

        assert.equal(listResponse.status, 200);
        const listPayload = await listResponse.json() as {
          identity?: { principalId?: string };
          compatibility?: {
            panelOwnership?: string;
            accessMode?: string;
            statusLevel?: string;
            platformBaseUrl?: string;
            ownerPrincipalId?: string;
          };
          organizations?: Array<{ organizationId?: string; displayName?: string }>;
          agents?: Array<{ agentId?: string; displayName?: string }>;
        };
        assert.equal(listPayload.compatibility?.panelOwnership, "platform");
        assert.equal(listPayload.compatibility?.accessMode, "platform_gateway");
        assert.equal(listPayload.compatibility?.statusLevel, "warning");
        assert.equal(listPayload.compatibility?.platformBaseUrl, platformServer.baseUrl);
        assert.equal(listPayload.compatibility?.ownerPrincipalId, listPayload.identity?.principalId);
        assert.deepEqual(listPayload.organizations, [
          {
            organizationId: "org-platform",
            displayName: "平台组织",
          },
        ]);
        assert.equal(listPayload.agents?.[0]?.agentId, "agent-platform-1");

        const detailResponse = await postJson(baseUrl, "/api/agents/detail", {
          ...buildIdentityPayload("owner-managed-agent-gateway"),
          agentId: "agent-platform-1",
        }, authHeaders);

        assert.equal(detailResponse.status, 200);
        const detailPayload = await detailResponse.json() as {
          organization?: { organizationId?: string };
          principal?: { principalId?: string; kind?: string };
          agent?: { agentId?: string; mission?: string };
          workspacePolicy?: { workspacePath?: string };
          runtimeProfile?: { model?: string };
        };
        assert.equal(detailPayload.organization?.organizationId, "org-platform");
        assert.equal(detailPayload.principal?.principalId, "principal-platform-agent-1");
        assert.equal(detailPayload.principal?.kind, "managed_agent");
        assert.equal(detailPayload.agent?.agentId, "agent-platform-1");
        assert.equal(detailPayload.agent?.mission, "来自平台控制面的详情。");
        assert.equal(detailPayload.workspacePolicy?.workspacePath, "/workspace/platform");
        assert.equal(detailPayload.runtimeProfile?.model, "gpt-5.4");

        assert.deepEqual(
          platformServer.calls.map((entry) => entry.pathname),
          [
            "/api/platform/agents/list",
            "/api/platform/agents/detail",
          ],
        );
      });
    } finally {
      await platformServer.close();
    }
  });
});

test("POST /api/agents/list 在未配置平台 gateway 时只返回兼容状态占位", async () => {
  await withClearedPlatformGatewayEnv(async () => {
    await withHttpServer(async ({ baseUrl, runtimeStore }) => {
      const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
      const listResponse = await postJson(
        baseUrl,
        "/api/agents/list",
        buildIdentityPayload("owner-managed-agent-compatibility"),
        authHeaders,
      );

      assert.equal(listResponse.status, 200);
      const payload = await listResponse.json() as {
        compatibility?: {
          panelOwnership?: string;
          accessMode?: string;
          statusLevel?: string;
          message?: string;
        };
        organizations?: unknown[];
        agents?: unknown[];
      };
      assert.equal(payload.compatibility?.panelOwnership, "platform");
      assert.equal(payload.compatibility?.accessMode, "gateway_required");
      assert.equal(payload.compatibility?.statusLevel, "error");
      assert.match(payload.compatibility?.message ?? "", /纯 gateway/);
      assert.deepEqual(payload.organizations, []);
      assert.deepEqual(payload.agents, []);
    });
  });
});

test("POST /api/agents/detail 在未配置平台 gateway 时会明确拒绝", async () => {
  await withClearedPlatformGatewayEnv(async () => {
    await withHttpServer(async ({ baseUrl, runtimeStore }) => {
      const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
      const detailResponse = await postJson(baseUrl, "/api/agents/detail", {
        ...buildIdentityPayload("owner-managed-agent-no-gateway"),
        agentId: "agent-platform-1",
      }, authHeaders);

      assert.equal(detailResponse.status, 503);
      const payload = await detailResponse.json() as {
        error?: {
          code?: string;
          message?: string;
        };
        compatibility?: {
          accessMode?: string;
        };
      };
      assert.equal(payload.error?.code, "PLATFORM_AGENTS_GATEWAY_UNAVAILABLE");
      assert.match(payload.error?.message ?? "", /纯 gateway/);
      assert.equal(payload.compatibility?.accessMode, "gateway_required");
    });
  });
});

test("POST /api/agents/list 在平台 gateway 配置不完整时会暴露 invalid_gateway_config", async () => {
  await withClearedPlatformGatewayEnv(async () => {
    process.env.THEMIS_PLATFORM_BASE_URL = "http://platform.invalid";

    await withHttpServer(async ({ baseUrl, runtimeStore }) => {
      const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
      const listResponse = await postJson(
        baseUrl,
        "/api/agents/list",
        buildIdentityPayload("owner-managed-agent-invalid-gateway"),
        authHeaders,
      );

      assert.equal(listResponse.status, 200);
      const payload = await listResponse.json() as {
        compatibility?: {
          accessMode?: string;
          statusLevel?: string;
          message?: string;
        };
      };
      assert.equal(payload.compatibility?.accessMode, "invalid_gateway_config");
      assert.equal(payload.compatibility?.statusLevel, "error");
      assert.match(payload.compatibility?.message ?? "", /必须同时配置/);
    });
  });
});

test("POST /api/agents/create、/waiting/list、/work-items/cancel 在配置平台上游后会走纯 gateway 写路径", async () => {
  await withClearedPlatformGatewayEnv(async () => {
    const platformServer = await createMockPlatformGatewayServer();
    process.env.THEMIS_PLATFORM_BASE_URL = platformServer.baseUrl;
    process.env.THEMIS_PLATFORM_OWNER_PRINCIPAL_ID = "principal-platform-owner";
    process.env.THEMIS_PLATFORM_WEB_ACCESS_TOKEN = "gateway-secret";

    try {
      await withHttpServer(async ({ baseUrl, runtimeStore }) => {
        const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

        const createResponse = await postJson(baseUrl, "/api/agents/create", {
          ...buildIdentityPayload("owner-managed-agent-create"),
          agent: {
            departmentRole: "平台工程",
            displayName: "平台·新建",
            mission: "负责平台控制面迁移。",
          },
        }, authHeaders);
        assert.equal(createResponse.status, 200);
        const createPayload = await createResponse.json() as {
          agent?: { agentId?: string; displayName?: string };
        };
        assert.equal(createPayload.agent?.agentId, "agent-platform-created");
        assert.equal(createPayload.agent?.displayName, "平台·新建");

        const waitingResponse = await postJson(baseUrl, "/api/agents/waiting/list", {
          ...buildIdentityPayload("owner-managed-agent-create"),
          organizationId: "org-platform",
        }, authHeaders);
        assert.equal(waitingResponse.status, 200);
        const waitingPayload = await waitingResponse.json() as {
          summary?: { totalCount?: number; waitingHumanCount?: number };
          items?: Array<{ workItem?: { workItemId?: string } }>;
        };
        assert.equal(waitingPayload.summary?.totalCount, 1);
        assert.equal(waitingPayload.summary?.waitingHumanCount, 1);
        assert.equal(waitingPayload.items?.[0]?.workItem?.workItemId, "work-item-platform-1");

        const cancelResponse = await postJson(baseUrl, "/api/agents/work-items/cancel", {
          ...buildIdentityPayload("owner-managed-agent-create"),
          workItemId: "work-item-platform-1",
        }, authHeaders);
        assert.equal(cancelResponse.status, 200);
        const cancelPayload = await cancelResponse.json() as {
          workItem?: { workItemId?: string; status?: string };
        };
        assert.equal(cancelPayload.workItem?.workItemId, "work-item-platform-1");
        assert.equal(cancelPayload.workItem?.status, "cancelled");

        assert.deepEqual(
          platformServer.calls.map((entry) => entry.pathname),
          [
            "/api/platform/agents/create",
            "/api/platform/agents/waiting/list",
            "/api/platform/work-items/cancel",
          ],
        );
      });
    } finally {
      await platformServer.close();
    }
  });
});

function writeJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();

  if (!text) {
    return {};
  }

  return JSON.parse(text) as Record<string, unknown>;
}

async function listenServer(server: Server): Promise<Server> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
