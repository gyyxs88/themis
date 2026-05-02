import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

const PRINCIPAL_ID = "principal-local-owner";

interface TestServerContext {
  server: Server;
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: AppServerTaskRuntime;
  authHeaders: Record<string, string>;
}

function buildIdentityPayload(): {
  channel: string;
  channelUserId: string;
  displayName: string;
} {
  return {
    channel: "web",
    channelUserId: "browser-user-1",
    displayName: "owner",
  };
}

async function withMcpServer(
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-mcp-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const authRuntime = new CodexAuthRuntime({
    workingDirectory: root,
    registry: runtimeStore,
  });
  const server = createThemisHttpServer({ runtime, authRuntime });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeaders = await createAuthenticatedWebHeaders({
    baseUrl,
    runtimeStore,
  });

  try {
    await run({
      server: listeningServer,
      baseUrl,
      root,
      runtimeStore,
      runtime,
      authHeaders,
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
  headers: Record<string, string> = {},
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

test("POST /api/mcp/upsert 和 /api/mcp/list 会按当前浏览器身份返回 principal MCP 列表", async () => {
  await withMcpServer(async ({ baseUrl, authHeaders }) => {
    const upsertResponse = await postJson(baseUrl, "/api/mcp/upsert", {
      ...buildIdentityPayload(),
      serverName: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      cwd: "/srv/github",
      env: {
        GITHUB_TOKEN: "secret",
      },
    }, authHeaders);
    assert.equal(upsertResponse.status, 200);

    const listResponse = await postJson(baseUrl, "/api/mcp/list", buildIdentityPayload(), authHeaders);
    assert.equal(listResponse.status, 200);

    const payload = await listResponse.json() as {
      identity?: { principalId?: string };
      servers?: Array<{
        serverName?: string;
        command?: string;
        enabled?: boolean;
        argsJson?: string;
        envJson?: string;
      }>;
    };

    assert.equal(payload.identity?.principalId, PRINCIPAL_ID);
    assert.equal(payload.servers?.length, 1);
    assert.equal(payload.servers?.[0]?.serverName, "github");
    assert.equal(payload.servers?.[0]?.command, "npx");
    assert.equal(payload.servers?.[0]?.enabled, true);
    assert.equal(payload.servers?.[0]?.argsJson, JSON.stringify(["-y", "@modelcontextprotocol/server-github"]));
    assert.equal(payload.servers?.[0]?.envJson, JSON.stringify({ GITHUB_TOKEN: "secret" }));
  });
});

test("POST /api/mcp/upsert 支持 streamable_http MCP server", async () => {
  await withMcpServer(async ({ baseUrl, authHeaders }) => {
    const upsertResponse = await postJson(baseUrl, "/api/mcp/upsert", {
      ...buildIdentityPayload(),
      serverName: "remote_docs",
      transportType: "streamable_http",
      url: "https://mcp.example.com/docs",
    }, authHeaders);
    assert.equal(upsertResponse.status, 200);

    const payload = await upsertResponse.json() as {
      server?: {
        serverName?: string;
        transportType?: string;
        command?: string;
        argsJson?: string;
        envJson?: string;
      };
    };

    assert.equal(payload.server?.serverName, "remote_docs");
    assert.equal(payload.server?.transportType, "streamable_http");
    assert.equal(payload.server?.command, "https://mcp.example.com/docs");
    assert.equal(payload.server?.argsJson, JSON.stringify([]));
    assert.equal(payload.server?.envJson, JSON.stringify({}));
  });
});

test("POST /api/mcp/disable 和 /api/mcp/enable 会切换 principal MCP enabled 状态", async () => {
  await withMcpServer(async ({ baseUrl, runtime, runtimeStore, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload());
    runtime.getPrincipalMcpService().upsertPrincipalMcpServer({
      principalId: identity.principalId,
      serverName: "github",
      command: "npx",
    });

    const disableResponse = await postJson(baseUrl, "/api/mcp/disable", {
      ...buildIdentityPayload(),
      serverName: "github",
    }, authHeaders);
    assert.equal(disableResponse.status, 200);
    assert.equal(runtimeStore.getPrincipalMcpServer(identity.principalId, "github")?.enabled, false);

    const enableResponse = await postJson(baseUrl, "/api/mcp/enable", {
      ...buildIdentityPayload(),
      serverName: "github",
    }, authHeaders);
    assert.equal(enableResponse.status, 200);
    assert.equal(runtimeStore.getPrincipalMcpServer(identity.principalId, "github")?.enabled, true);
  });
});

test("POST /api/mcp/remove 会删除 principal MCP 主记录和物化状态", async () => {
  await withMcpServer(async ({ baseUrl, runtime, runtimeStore, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload());
    runtime.getPrincipalMcpService().upsertPrincipalMcpServer({
      principalId: identity.principalId,
      serverName: "github",
      command: "npx",
    });
    runtime.getPrincipalMcpService().savePrincipalMcpMaterialization({
      principalId: identity.principalId,
      serverName: "github",
      targetKind: "auth-account",
      targetId: "default",
      state: "synced",
      authState: "authenticated",
    });

    const response = await postJson(baseUrl, "/api/mcp/remove", {
      ...buildIdentityPayload(),
      serverName: "github",
    }, authHeaders);
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        removedDefinition?: boolean;
        removedMaterializations?: number;
      };
    };

    assert.equal(payload.result?.removedDefinition, true);
    assert.equal(payload.result?.removedMaterializations, 1);
    assert.equal(runtimeStore.getPrincipalMcpServer(identity.principalId, "github"), null);
    assert.equal(runtimeStore.listPrincipalMcpMaterializations(identity.principalId).length, 0);
  });
});

test("POST /api/mcp/reload 会返回 runtime 槽位和刷新后的 principal MCP 列表", async () => {
  await withMcpServer(async ({ baseUrl, runtime, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload());
    const service = runtime.getPrincipalMcpService() as ReturnType<AppServerTaskRuntime["getPrincipalMcpService"]> & {
      reloadPrincipalMcpServers?: ReturnType<AppServerTaskRuntime["getPrincipalMcpService"]>["reloadPrincipalMcpServers"];
    };

    service.reloadPrincipalMcpServers = async (principalId) => {
      assert.equal(principalId, identity.principalId);
      return {
        target: {
          targetKind: "auth-account",
          targetId: "default",
        },
        runtimeServers: [{
          id: "github",
          name: "github",
          status: "available",
          args: [],
        }],
        servers: [{
          principalId,
          serverName: "github",
          transportType: "stdio",
          command: "npx",
          argsJson: "[]",
          envJson: "{}",
          enabled: true,
          sourceType: "manual",
          createdAt: "2026-04-11T00:00:00.000Z",
          updatedAt: "2026-04-11T00:00:00.000Z",
          materializations: [{
            principalId,
            serverName: "github",
            targetKind: "auth-account",
            targetId: "default",
            state: "synced",
            authState: "authenticated",
          }],
          summary: {
            totalTargets: 1,
            readyCount: 1,
            authRequiredCount: 0,
            failedCount: 0,
          },
        }],
      };
    };

    const response = await postJson(baseUrl, "/api/mcp/reload", buildIdentityPayload(), authHeaders);
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        target?: { targetId?: string };
        runtimeServers?: Array<{ name?: string }>;
      };
    };

    assert.equal(payload.result?.target?.targetId, "default");
    assert.equal(payload.result?.runtimeServers?.[0]?.name, "github");
  });
});

test("POST /api/mcp/oauth/login 会返回 OAuth 授权链接", async () => {
  await withMcpServer(async ({ baseUrl, runtime, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload());
    const service = runtime.getPrincipalMcpService() as ReturnType<AppServerTaskRuntime["getPrincipalMcpService"]> & {
      startPrincipalMcpOauthLogin?: ReturnType<AppServerTaskRuntime["getPrincipalMcpService"]>["startPrincipalMcpOauthLogin"];
    };

    service.startPrincipalMcpOauthLogin = async (principalId, serverName) => {
      assert.equal(principalId, identity.principalId);
      assert.equal(serverName, "github");
      return {
        target: {
          targetKind: "auth-account",
          targetId: "default",
        },
        authorizationUrl: "https://example.com/oauth/github",
        server: {
          principalId,
          serverName,
          transportType: "stdio",
          command: "npx",
          argsJson: "[]",
          envJson: "{}",
          enabled: true,
          sourceType: "manual",
          createdAt: "2026-04-11T00:00:00.000Z",
          updatedAt: "2026-04-11T00:00:00.000Z",
          materializations: [],
          summary: {
            totalTargets: 0,
            readyCount: 0,
            authRequiredCount: 0,
            failedCount: 0,
          },
        },
      };
    };

    const response = await postJson(baseUrl, "/api/mcp/oauth/login", {
      ...buildIdentityPayload(),
      serverName: "github",
    }, authHeaders);
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        authorizationUrl?: string;
        server?: { serverName?: string };
      };
    };

    assert.equal(payload.result?.authorizationUrl, "https://example.com/oauth/github");
    assert.equal(payload.result?.server?.serverName, "github");
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
