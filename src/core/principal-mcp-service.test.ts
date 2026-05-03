import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodexAppServerNotification } from "./codex-app-server.js";
import {
  PrincipalMcpService,
  type PrincipalMcpCreateSessionInput,
} from "./principal-mcp-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

const PRINCIPAL_ID = "principal-local-owner";

function createService(): {
  service: PrincipalMcpService;
  registry: SqliteCodexSessionRegistry;
  workingDirectory: string;
} {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-principal-mcp-service-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const now = "2026-04-11T00:00:00.000Z";

  registry.savePrincipal({
    principalId: PRINCIPAL_ID,
    displayName: "Tester",
    createdAt: now,
    updatedAt: now,
  });

  return {
    service: new PrincipalMcpService({ registry }),
    registry,
    workingDirectory,
  };
}

test("upsertPrincipalMcpServer 会保存 principal 级 MCP 定义，并默认开启", () => {
  const { service, workingDirectory } = createService();

  try {
    const result = service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "secret" },
      now: "2026-04-11T00:00:01.000Z",
    });

    assert.equal(result.serverName, "github");
    assert.equal(result.enabled, true);
    assert.equal(result.transportType, "stdio");
    assert.equal(result.argsJson, JSON.stringify(["-y", "@modelcontextprotocol/server-github"]));
    assert.equal(result.envJson, JSON.stringify({ GITHUB_TOKEN: "secret" }));
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("listPrincipalMcpServers 会返回 materializations 和汇总", () => {
  const { service, workingDirectory } = createService();

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      command: "npx",
      args: ["-y"],
      now: "2026-04-11T00:00:01.000Z",
    });

    service.savePrincipalMcpMaterialization({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      targetKind: "auth-account",
      targetId: "default",
      state: "synced",
      authState: "authenticated",
      lastSyncedAt: "2026-04-11T00:00:02.000Z",
    });
    service.savePrincipalMcpMaterialization({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      targetKind: "managed-agent",
      targetId: "agent-1",
      state: "missing",
      authState: "auth_required",
      lastError: "oauth required",
    });

    const [item] = service.listPrincipalMcpServers(PRINCIPAL_ID);

    assert.equal(item?.summary.totalTargets, 2);
    assert.equal(item?.summary.readyCount, 1);
    assert.equal(item?.summary.authRequiredCount, 1);
    assert.equal(item?.summary.failedCount, 0);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("buildRuntimeConfigOverrides 只返回 enabled 的 MCP 配置", () => {
  const { service, workingDirectory } = createService();

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      cwd: "/srv/github",
      env: { GITHUB_TOKEN: "secret" },
      enabled: true,
    });
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "disabled_demo",
      command: "uvx",
      args: ["demo"],
      enabled: false,
    });
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "remote_docs",
      transportType: "streamable_http",
      url: "https://mcp.example.com/docs",
      enabled: true,
    });

    const overrides = service.buildRuntimeConfigOverrides(PRINCIPAL_ID);

    assert.deepEqual(overrides, {
      "mcp_servers.github": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        cwd: "/srv/github",
        env: { GITHUB_TOKEN: "secret" },
      },
      "mcp_servers.remote_docs": {
        url: "https://mcp.example.com/docs",
      },
    });
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("removePrincipalMcpServer 会删除定义和对应物化状态", () => {
  const { service, workingDirectory } = createService();

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      command: "npx",
    });
    service.savePrincipalMcpMaterialization({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      targetKind: "auth-account",
      targetId: "default",
      state: "synced",
      authState: "authenticated",
    });

    const result = service.removePrincipalMcpServer(PRINCIPAL_ID, "github");

    assert.equal(result.removedDefinition, true);
    assert.equal(result.removedMaterializations, 1);
    assert.equal(service.getPrincipalMcpServer(PRINCIPAL_ID, "github"), null);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("reloadPrincipalMcpServers 会用当前 auth 槽位 reload，并回写 runtime 物化状态", async () => {
  const { service, workingDirectory } = createService();
  const sessionCalls: Array<{ method: string; params: unknown }> = [];
  let sessionInput: PrincipalMcpCreateSessionInput | null = null;

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      enabled: true,
    });

    const result = await service.reloadPrincipalMcpServers(PRINCIPAL_ID, {
      workingDirectory,
      activeAuthAccount: {
        accountId: "acc-1",
        codexHome: join(workingDirectory, "infra/local/codex-auth/acc-1"),
      },
      now: "2026-04-11T00:00:10.000Z",
      createSession: async (input: PrincipalMcpCreateSessionInput) => {
        sessionInput = input;
        return {
          async initialize() {},
          async request(method: string, params: unknown) {
            sessionCalls.push({ method, params });

            if (method === "config/mcpServer/reload") {
              return {};
            }

            if (method === "mcpServerStatus/list") {
              return {
                data: [{
                  id: "github",
                  name: "github",
                  status: "available",
                  command: "npx",
                  args: ["-y", "@modelcontextprotocol/server-github"],
                  auth: "authenticated",
                }],
              };
            }

            throw new Error(`unexpected method: ${method}`);
          },
          async close() {},
        };
      },
    });

    assert.deepEqual(sessionCalls, [
      { method: "config/mcpServer/reload", params: {} },
      { method: "mcpServerStatus/list", params: {} },
    ]);
    assert.ok(sessionInput, "reload 之后应该拿到 createSession 入参");
    const capturedSessionInput = sessionInput as PrincipalMcpCreateSessionInput;
    assert.equal(capturedSessionInput.target.targetId, "acc-1");
    assert.equal(capturedSessionInput.env?.CODEX_HOME, join(workingDirectory, "infra/local/codex-auth/acc-1"));
    assert.equal(capturedSessionInput.configOverrides["cli_auth_credentials_store"], "file");
    assert.deepEqual(capturedSessionInput.configOverrides["mcp_servers.github"], {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    });
    assert.equal(result.target.targetId, "acc-1");
    assert.equal(result.runtimeServers[0]?.name, "github");
    assert.equal(result.servers[0]?.materializations[0]?.state, "synced");
    assert.equal(result.servers[0]?.materializations[0]?.authState, "authenticated");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("startPrincipalMcpOauthLogin 会发起 OAuth 登录并返回授权链接", async () => {
  const { service, registry, workingDirectory } = createService();
  const sessionCalls: Array<{ method: string; params: unknown }> = [];

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      command: "npx",
      enabled: true,
    });

    const result = await service.startPrincipalMcpOauthLogin(PRINCIPAL_ID, "github", {
      workingDirectory,
      activeAuthAccount: {
        accountId: "acc-1",
        codexHome: join(workingDirectory, "infra/local/codex-auth/acc-1"),
      },
      now: "2026-04-11T00:00:12.000Z",
      mcpOauthCallbackBaseUrl: "https://themis.example.com",
      createSession: async () => ({
        async initialize() {},
        async request(method: string, params: unknown) {
          sessionCalls.push({ method, params });

          if (method === "mcpServer/oauth/login") {
            return {
              authorizationUrl: "https://example.com/oauth/github",
            };
          }

          throw new Error(`unexpected method: ${method}`);
        },
        async close() {},
      }),
    });

    assert.deepEqual(sessionCalls, [{
      method: "mcpServer/oauth/login",
      params: {
        name: "github",
      },
    }]);
    assert.equal(result.authorizationUrl, "https://example.com/oauth/github");
    assert.equal(result.target.targetId, "acc-1");
    assert.equal(result.server.materializations[0]?.authState, "auth_required");
    assert.equal(result.attempt.status, "waiting");
    assert.equal(result.attempt.authorizationUrl, "https://example.com/oauth/github");
    assert.equal(result.sessionRetained, false);
    assert.equal(result.callbackBridge, undefined);
    assert.equal(
      registry.getLatestPrincipalMcpOauthAttempt(PRINCIPAL_ID, "github")?.attemptId,
      result.attempt.attemptId,
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("startPrincipalMcpOauthLogin 会保留支持通知的 OAuth 会话并在 completed 通知后收口", async () => {
  const { service, registry, workingDirectory } = createService();
  const notificationHandlers: Array<(notification: CodexAppServerNotification) => void> = [];
  let closeCount = 0;

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      command: "npx",
      enabled: true,
    });

    const result = await service.startPrincipalMcpOauthLogin(PRINCIPAL_ID, "github", {
      workingDirectory,
      activeAuthAccount: {
        accountId: "acc-1",
        codexHome: join(workingDirectory, "infra/local/codex-auth/acc-1"),
      },
      now: "2026-04-11T00:00:12.000Z",
      createSession: async () => ({
        async initialize() {},
        onNotification(handler) {
          notificationHandlers.push(handler);
          return () => {
            notificationHandlers.length = 0;
          };
        },
        async request(method: string) {
          if (method === "mcpServer/oauth/login") {
            return {
              authorizationUrl: "https://example.com/oauth/github",
            };
          }

          throw new Error(`unexpected method: ${method}`);
        },
        async close() {
          closeCount += 1;
        },
      }),
    });

    assert.equal(result.sessionRetained, true);
    assert.equal(closeCount, 0);
    const handler = notificationHandlers[0];
    assert.ok(handler);

    handler({
      method: "mcpServer/oauthLogin/completed",
      params: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(closeCount, 1);
    assert.equal(registry.getLatestPrincipalMcpOauthAttempt(PRINCIPAL_ID, "github")?.status, "completed");
    assert.equal(
      registry.listPrincipalMcpMaterializations(PRINCIPAL_ID, "github")[0]?.authState,
      "authenticated",
    );
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("handlePrincipalMcpOauthCallback 会把公开 callback 桥接到本地 Codex callback 端口", async () => {
  const { service, workingDirectory } = createService();
  const notificationHandlers: Array<(notification: CodexAppServerNotification) => void> = [];
  const localCallbackServer = createServer((request, response) => {
    assert.equal(request.url, "/callback?code=ok&state=demo");
    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Authentication complete. You may close this window.");
  });
  const listeningServer = await listenServer(localCallbackServer);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve local callback server address.");
  }

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "remote_docs",
      transportType: "streamable_http",
      url: "https://mcp.example.com/docs",
      enabled: true,
    });

    const result = await service.startPrincipalMcpOauthLogin(PRINCIPAL_ID, "remote_docs", {
      workingDirectory,
      mcpOauthCallbackBaseUrl: "https://themis.example.com",
      mcpOauthCallbackPort: address.port,
      createSession: async (input: PrincipalMcpCreateSessionInput) => {
        assert.equal(typeof input.configOverrides["mcp_oauth_callback_url"], "string");
        assert.match(
          String(input.configOverrides["mcp_oauth_callback_url"]),
          /^https:\/\/themis\.example\.com\/api\/mcp\/oauth\/callback\//,
        );
        assert.equal(input.configOverrides["mcp_oauth_callback_port"], address.port);

        return {
          async initialize() {},
          onNotification(handler) {
            notificationHandlers.push(handler);
            return () => {
              notificationHandlers.length = 0;
            };
          },
          async request(method: string) {
            if (method === "mcpServer/oauth/login") {
              return {
                authorizationUrl: "https://example.com/oauth/remote_docs",
              };
            }

            throw new Error(`unexpected method: ${method}`);
          },
          async close() {},
        };
      },
    });
    const bridge = result.callbackBridge;

    assert.ok(bridge);
    assert.equal(result.sessionRetained, true);
    assert.equal(bridge.localCallbackPort, address.port);
    assert.equal(bridge.publicCallbackUrl.startsWith("https://themis.example.com/api/mcp/oauth/callback/"), true);

    const callbackResult = await service.handlePrincipalMcpOauthCallback(
      bridge.bridgeId,
      "?code=ok&state=demo",
    );

    assert.equal(callbackResult.statusCode, 200);
    assert.match(callbackResult.body, /Authentication complete/);

    const handler = notificationHandlers[0];
    assert.ok(handler);
    handler({
      method: "mcpServer/oauthLogin/completed",
      params: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    await closeServer(listeningServer);
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("handlePrincipalMcpOauthCallback 对已完成但桥已清理的 callback 返回完成提示", async () => {
  const { service, registry, workingDirectory } = createService();
  const bridgeId = "b320f487-28fa-4a1f-bc09-d101b447f589";

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "todoist",
      transportType: "streamable_http",
      url: "https://mcp.todoist.com/mcp",
      enabled: true,
    });

    registry.savePrincipalMcpOauthAttempt({
      attemptId: "attempt-completed",
      principalId: PRINCIPAL_ID,
      serverName: "todoist",
      targetKind: "auth-account",
      targetId: "owner@example.com",
      status: "completed",
      authorizationUrl: `https://todoist.com/oauth/authorize?redirect_uri=https%3A%2F%2Fthemis.example.com%2Fapi%2Fmcp%2Foauth%2Fcallback%2F${bridgeId}`,
      startedAt: "2026-05-03T00:28:55.454Z",
      updatedAt: "2026-05-03T00:33:55.459Z",
      completedAt: "2026-05-03T00:33:55.459Z",
    });

    const callbackResult = await service.handlePrincipalMcpOauthCallback(
      bridgeId,
      "?code=already-used",
    );

    assert.equal(callbackResult.statusCode, 200);
    assert.match(callbackResult.body, /already completed/);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("getPrincipalMcpOauthStatus 会刷新 runtime 并收口最近一次授权尝试", async () => {
  const { service, registry, workingDirectory } = createService();

  try {
    service.upsertPrincipalMcpServer({
      principalId: PRINCIPAL_ID,
      serverName: "github",
      command: "npx",
      enabled: true,
    });

    const login = await service.startPrincipalMcpOauthLogin(PRINCIPAL_ID, "github", {
      workingDirectory,
      activeAuthAccount: {
        accountId: "acc-1",
        codexHome: join(workingDirectory, "infra/local/codex-auth/acc-1"),
      },
      now: "2026-04-11T00:00:12.000Z",
      createSession: async () => ({
        async initialize() {},
        async request(method: string) {
          if (method === "mcpServer/oauth/login") {
            return {
              authorizationUrl: "https://example.com/oauth/github",
            };
          }

          throw new Error(`unexpected method: ${method}`);
        },
        async close() {},
      }),
    });

    const status = await service.getPrincipalMcpOauthStatus(PRINCIPAL_ID, "github", {
      workingDirectory,
      activeAuthAccount: {
        accountId: "acc-1",
        codexHome: join(workingDirectory, "infra/local/codex-auth/acc-1"),
      },
      now: "2026-04-11T00:00:13.000Z",
      createSession: async () => ({
        async initialize() {},
        async request(method: string) {
          if (method === "config/mcpServer/reload") {
            return {};
          }

          if (method === "mcpServerStatus/list") {
            return {
              data: [{
                id: "github",
                name: "github",
                status: "available",
                command: "npx",
                auth: "authenticated",
              }],
            };
          }

          throw new Error(`unexpected method: ${method}`);
        },
        async close() {},
      }),
    });

    assert.equal(status.status, "completed");
    assert.equal(status.attempt?.attemptId, login.attempt.attemptId);
    assert.equal(status.attempt?.completedAt, "2026-04-11T00:00:13.000Z");
    assert.equal(status.materialization?.state, "synced");
    assert.equal(status.materialization?.authState, "authenticated");
    assert.equal(registry.getLatestPrincipalMcpOauthAttempt(PRINCIPAL_ID, "github")?.status, "completed");
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
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
