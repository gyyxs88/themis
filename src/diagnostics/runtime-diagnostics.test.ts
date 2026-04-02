import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { RuntimeDiagnosticsService } from "./runtime-diagnostics.js";

test("RuntimeDiagnosticsService.readSummary 返回 auth/provider/context/memory/service 基本字段", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-"));

  try {
    writeFileSync(join(root, "README.md"), "# demo\n", "utf8");
    mkdirSync(join(root, "memory", "architecture"), { recursive: true });
    writeFileSync(join(root, "memory", "architecture", "overview.md"), "# arch\n", "utf8");
    mkdirSync(join(root, "memory", "tasks"), { recursive: true });
    writeFileSync(join(root, "memory", "tasks", "backlog.md"), "# backlog\n", "utf8");
    writeFileSync(join(root, "memory", "tasks", "in-progress.md"), "# in-progress\n", "utf8");
    writeFileSync(join(root, "memory", "tasks", "done.md"), "# done\n", "utf8");
    const runtimeStore = new SqliteCodexSessionRegistry({
      databaseFile: join(root, "infra/local/themis.db"),
    });

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
      mcpInspector: {
        list: async () => ({ servers: [] }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.ok(summary.generatedAt);
    assert.equal(summary.workingDirectory, root);
    assert.ok(summary.auth);
    assert.ok(summary.provider);
    assert.ok(summary.context);
    assert.ok(summary.memory);
    assert.ok(summary.service);
    assert.ok(summary.mcp);
    assert.ok(Array.isArray(summary.mcp.servers));
    assert.equal(summary.context.files.some((item) => item.path === "README.md" && item.status === "ok"), true);
    assert.equal(summary.context.files.some((item) => item.path === "AGENTS.md" && item.status === "missing"), true);
    assert.equal(summary.provider.activeMode === "auth" || summary.provider.activeMode === "third-party", true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService.readSummary 会汇总 feishu diagnostics 快照", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-feishu-"));
  const previousEnv = {
    feishuAppId: process.env.FEISHU_APP_ID,
    feishuAppSecret: process.env.FEISHU_APP_SECRET,
    feishuUseEnvProxy: process.env.FEISHU_USE_ENV_PROXY,
    feishuProgressFlushTimeoutMs: process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS,
    themisBaseUrl: process.env.THEMIS_BASE_URL,
  };
  let server: ReturnType<typeof createServer> | null = null;

  try {
    writeFileSync(join(root, "README.md"), "# demo\n", "utf8");
    mkdirSync(join(root, "memory", "architecture"), { recursive: true });
    writeFileSync(join(root, "memory", "architecture", "overview.md"), "# arch\n", "utf8");
    mkdirSync(join(root, "memory", "tasks"), { recursive: true });
    writeFileSync(join(root, "memory", "tasks", "backlog.md"), "# backlog\n", "utf8");
    writeFileSync(join(root, "memory", "tasks", "in-progress.md"), "# in-progress\n", "utf8");
    writeFileSync(join(root, "memory", "tasks", "done.md"), "# done\n", "utf8");
    mkdirSync(join(root, "docs", "feishu"), { recursive: true });
    writeFileSync(join(root, "docs", "feishu", "themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(
      join(root, "infra", "local", "feishu-sessions.json"),
      JSON.stringify(
        {
          version: 1,
          bindings: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              activeSessionId: "session-1",
              updatedAt: "2026-04-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra", "local", "feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [
            {
              key: "chat-1::user-1::session-1",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              parts: [
                {
                  type: "text",
                  role: "user",
                  order: 1,
                  text: "hello",
                },
              ],
              assets: [
                {
                  id: "asset-1",
                  type: "image",
                  value: "/tmp/asset-1.png",
                  createdAt: "2026-04-01T00:00:00.000Z",
                },
              ],
              attachments: [
                {
                  id: "draft-1",
                  type: "image",
                  name: "asset-1.png",
                  value: "/tmp/asset-1.png",
                  sourceMessageId: "message-1",
                  createdAt: "2026-04-01T00:00:00.000Z",
                },
              ],
              createdAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-01T00:00:00.000Z",
              expiresAt: "2026-04-01T01:00:00.000Z",
            },
            {
              key: "chat-2::user-2::session-2",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              parts: [
                {
                  type: "text",
                  role: "user",
                  order: 1,
                  text: "world",
                },
              ],
              assets: [
                {
                  id: "asset-2",
                  type: "document",
                  value: "/tmp/asset-2.pdf",
                  createdAt: "2026-04-01T00:00:00.000Z",
                },
              ],
              attachments: [
                {
                  id: "draft-2",
                  type: "document",
                  name: "asset-2.pdf",
                  value: "/tmp/asset-2.pdf",
                  sourceMessageId: "message-2",
                  createdAt: "2026-04-01T00:00:00.000Z",
                },
              ],
              createdAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-01T00:00:00.000Z",
              expiresAt: "2026-04-01T01:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(302, {
          Location: "/login",
        });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    process.env.FEISHU_APP_ID = "cli_xxx";
    process.env.FEISHU_APP_SECRET = "secret_xxx";
    process.env.FEISHU_USE_ENV_PROXY = "1";
    process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS = "60000";
    process.env.THEMIS_BASE_URL = `http://127.0.0.1:${address.port}`;

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore: null,
      mcpInspector: {
        list: async () => ({ servers: [] }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.ok(summary.feishu);
    assert.equal(summary.feishu.env.appIdConfigured, true);
    assert.equal(summary.feishu.env.appSecretConfigured, true);
    assert.equal(summary.feishu.env.useEnvProxy, true);
    assert.equal(summary.feishu.service.serviceReachable, true);
    assert.equal(summary.feishu.service.statusCode, 302);
    assert.equal(summary.feishu.state.sessionStore.status, "ok");
    assert.equal(summary.feishu.state.attachmentDraftStore.status, "ok");
    assert.equal(summary.feishu.state.sessionBindingCount, 1);
    assert.equal(summary.feishu.state.attachmentDraftCount, 2);
    assert.equal(summary.feishu.docs.smokeDocExists, true);
  } finally {
    restoreEnv("FEISHU_APP_ID", previousEnv.feishuAppId);
    restoreEnv("FEISHU_APP_SECRET", previousEnv.feishuAppSecret);
    restoreEnv("FEISHU_USE_ENV_PROXY", previousEnv.feishuUseEnvProxy);
    restoreEnv("FEISHU_PROGRESS_FLUSH_TIMEOUT_MS", previousEnv.feishuProgressFlushTimeoutMs);
    restoreEnv("THEMIS_BASE_URL", previousEnv.themisBaseUrl);

    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService 会接入 mcp inspector 输出", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-mcp-"));

  try {
    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore: null,
      mcpInspector: {
        list: async () => ({
          servers: [
            {
              id: "context7",
              name: "Context 7",
              status: "healthy",
            },
          ],
        }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.deepEqual(summary.mcp.servers, [
      {
        id: "context7",
        name: "Context 7",
        status: "healthy",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService 在无 SQLite 时也能识别环境变量 provider", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-env-provider-"));
  const previousEnv = {
    baseUrl: process.env.THEMIS_OPENAI_COMPAT_BASE_URL,
    apiKey: process.env.THEMIS_OPENAI_COMPAT_API_KEY,
    model: process.env.THEMIS_OPENAI_COMPAT_MODEL,
  };

  try {
    process.env.THEMIS_OPENAI_COMPAT_BASE_URL = "https://example.com/v1";
    process.env.THEMIS_OPENAI_COMPAT_API_KEY = "sk-test";
    process.env.THEMIS_OPENAI_COMPAT_MODEL = "gpt-5.4";

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore: null,
      mcpInspector: {
        list: async () => ({ servers: [] }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.equal(summary.provider.providerCount, 1);
    assert.deepEqual(summary.provider.providerIds, ["themis_openai_compatible"]);
    assert.equal(summary.provider.activeMode, "third-party");
  } finally {
    restoreEnv("THEMIS_OPENAI_COMPAT_BASE_URL", previousEnv.baseUrl);
    restoreEnv("THEMIS_OPENAI_COMPAT_API_KEY", previousEnv.apiKey);
    restoreEnv("THEMIS_OPENAI_COMPAT_MODEL", previousEnv.model);
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService 在传入 authRuntime 时优先以当前模式判断 activeMode", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-auth-mode-"));
  const previousEnv = {
    baseUrl: process.env.THEMIS_OPENAI_COMPAT_BASE_URL,
    apiKey: process.env.THEMIS_OPENAI_COMPAT_API_KEY,
    model: process.env.THEMIS_OPENAI_COMPAT_MODEL,
  };

  try {
    process.env.THEMIS_OPENAI_COMPAT_BASE_URL = "https://example.com/v1";
    process.env.THEMIS_OPENAI_COMPAT_API_KEY = "sk-test";
    process.env.THEMIS_OPENAI_COMPAT_MODEL = "gpt-5.4";

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore: null,
      mcpInspector: {
        list: async () => ({ servers: [] }),
      } as never,
      authRuntime: {
        readSnapshot: async () => ({
          authenticated: false,
          requiresOpenaiAuth: false,
        }),
        readThirdPartyProviderProfile: () => null,
      } as never,
    });
    const summary = await service.readSummary();

    assert.equal(summary.provider.providerCount, 1);
    assert.equal(summary.provider.activeMode, "auth");
  } finally {
    restoreEnv("THEMIS_OPENAI_COMPAT_BASE_URL", previousEnv.baseUrl);
    restoreEnv("THEMIS_OPENAI_COMPAT_API_KEY", previousEnv.apiKey);
    restoreEnv("THEMIS_OPENAI_COMPAT_MODEL", previousEnv.model);
    rmSync(root, { recursive: true, force: true });
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === "string") {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}
