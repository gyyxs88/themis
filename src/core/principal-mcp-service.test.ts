import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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

    const overrides = service.buildRuntimeConfigOverrides(PRINCIPAL_ID);

    assert.deepEqual(overrides, {
      "mcp_servers.github": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        cwd: "/srv/github",
        env: { GITHUB_TOKEN: "secret" },
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
  const { service, workingDirectory } = createService();
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
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
