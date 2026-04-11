import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  server: Server;
  baseUrl: string;
  root: string;
  runtime: CodexTaskRuntime;
  authHeaders: Record<string, string>;
}

async function withPluginsServer(
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-plugins-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
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

test("POST /api/plugins/list 会返回当前运行环境可见的 marketplaces", async () => {
  await withPluginsServer(async ({ baseUrl, runtime, authHeaders }) => {
    const service = runtime.getPluginService() as ReturnType<CodexTaskRuntime["getPluginService"]> & {
      listPlugins?: ReturnType<CodexTaskRuntime["getPluginService"]>["listPlugins"];
    };

    service.listPlugins = async (options) => {
      assert.equal(options?.cwd, "/workspace/demo");
      assert.equal(options?.forceRemoteSync, true);
      return {
        target: {
          targetKind: "auth-account",
          targetId: "default",
        },
        marketplaces: [{
          name: "openai-curated",
          path: "/tmp/openai-curated/marketplace.json",
          interface: { displayName: "OpenAI Curated" },
          plugins: [{
            id: "github@openai-curated",
            name: "github",
            sourceType: "local",
            sourcePath: "/tmp/plugins/github",
            installed: false,
            enabled: false,
            installPolicy: "AVAILABLE",
            authPolicy: "ON_INSTALL",
            interface: null,
          }],
        }],
        marketplaceLoadErrors: [],
        remoteSyncError: null,
        featuredPluginIds: [],
      };
    };

    const response = await postJson(baseUrl, "/api/plugins/list", {
      cwd: "/workspace/demo",
      forceRemoteSync: true,
    }, authHeaders);
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        marketplaces?: Array<{ name?: string }>;
        target?: { targetId?: string };
      };
    };

    assert.equal(payload.result?.target?.targetId, "default");
    assert.equal(payload.result?.marketplaces?.[0]?.name, "openai-curated");
  });
});

test("POST /api/plugins/read 会返回 plugin 详情", async () => {
  await withPluginsServer(async ({ baseUrl, runtime, authHeaders }) => {
    const service = runtime.getPluginService() as ReturnType<CodexTaskRuntime["getPluginService"]> & {
      readPlugin?: ReturnType<CodexTaskRuntime["getPluginService"]>["readPlugin"];
    };

    service.readPlugin = async (input) => {
      assert.equal(input.marketplacePath, "/tmp/openai-curated/marketplace.json");
      assert.equal(input.pluginName, "github");
      return {
        target: {
          targetKind: "auth-account",
          targetId: "default",
        },
        plugin: {
          marketplaceName: "openai-curated",
          marketplacePath: "/tmp/openai-curated/marketplace.json",
          summary: {
            id: "github@openai-curated",
            name: "github",
            sourceType: "local",
            sourcePath: "/tmp/plugins/github",
            installed: true,
            enabled: true,
            installPolicy: "AVAILABLE",
            authPolicy: "ON_INSTALL",
            interface: null,
          },
          description: "GitHub workflows",
          skills: [{
            name: "github-review",
            description: "review PRs",
            shortDescription: "review",
            path: "/tmp/plugins/github/skills/review",
            enabled: true,
          }],
          apps: [],
          mcpServers: ["github"],
        },
      };
    };

    const response = await postJson(baseUrl, "/api/plugins/read", {
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
    }, authHeaders);
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        plugin?: {
          summary?: { id?: string };
          mcpServers?: string[];
        };
      };
    };

    assert.equal(payload.result?.plugin?.summary?.id, "github@openai-curated");
    assert.deepEqual(payload.result?.plugin?.mcpServers, ["github"]);
  });
});

test("POST /api/plugins/install 和 /api/plugins/uninstall 会调用对应写操作", async () => {
  await withPluginsServer(async ({ baseUrl, runtime, authHeaders }) => {
    const service = runtime.getPluginService() as ReturnType<CodexTaskRuntime["getPluginService"]> & {
      installPlugin?: ReturnType<CodexTaskRuntime["getPluginService"]>["installPlugin"];
      uninstallPlugin?: ReturnType<CodexTaskRuntime["getPluginService"]>["uninstallPlugin"];
    };

    service.installPlugin = async (input) => {
      assert.equal(input.marketplacePath, "/tmp/openai-curated/marketplace.json");
      assert.equal(input.pluginName, "github");
      return {
        target: {
          targetKind: "auth-account",
          targetId: "default",
        },
        pluginName: "github",
        marketplacePath: "/tmp/openai-curated/marketplace.json",
        authPolicy: "ON_INSTALL",
        appsNeedingAuth: [],
        plugin: null,
      };
    };

    service.uninstallPlugin = async (input) => {
      assert.equal(input.pluginId, "github@openai-curated");
      return {
        target: {
          targetKind: "auth-account",
          targetId: "default",
        },
        pluginId: "github@openai-curated",
      };
    };

    const installResponse = await postJson(baseUrl, "/api/plugins/install", {
      marketplacePath: "/tmp/openai-curated/marketplace.json",
      pluginName: "github",
    }, authHeaders);
    assert.equal(installResponse.status, 200);

    const installPayload = await installResponse.json() as {
      result?: {
        authPolicy?: string;
        pluginName?: string;
      };
    };
    assert.equal(installPayload.result?.pluginName, "github");
    assert.equal(installPayload.result?.authPolicy, "ON_INSTALL");

    const uninstallResponse = await postJson(baseUrl, "/api/plugins/uninstall", {
      pluginId: "github@openai-curated",
    }, authHeaders);
    assert.equal(uninstallResponse.status, 200);

    const uninstallPayload = await uninstallResponse.json() as {
      result?: {
        pluginId?: string;
      };
    };
    assert.equal(uninstallPayload.result?.pluginId, "github@openai-curated");
  });
});

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
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
