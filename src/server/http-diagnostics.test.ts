import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/task.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

test("GET /api/diagnostics 会返回结构化 summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-diagnostics-"));
  const previousEnv = {
    baseUrl: process.env.THEMIS_OPENAI_COMPAT_BASE_URL,
    apiKey: process.env.THEMIS_OPENAI_COMPAT_API_KEY,
    model: process.env.THEMIS_OPENAI_COMPAT_MODEL,
  };
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({
    runtime,
    createMcpInspector: () => ({
      list: async () => ({
        servers: [
          {
            id: "context7",
            name: "Context 7",
            status: "healthy",
            transport: "stdio",
            args: ["-y", "@upstash/context7-mcp"],
            auth: "authenticated",
          },
        ],
      }),
      probe: async () => ({
        servers: [
          {
            id: "context7",
            name: "Context 7",
            status: "healthy",
            transport: "stdio",
            args: ["-y", "@upstash/context7-mcp"],
            auth: "authenticated",
          },
        ],
      }),
      reload: async () => ({
        servers: [
          {
            id: "context7",
            name: "Context 7",
            status: "healthy",
            transport: "stdio",
            args: ["-y", "@upstash/context7-mcp"],
            auth: "authenticated",
          },
        ],
      }),
    }),
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    process.env.THEMIS_OPENAI_COMPAT_BASE_URL = "https://example.com/v1";
    process.env.THEMIS_OPENAI_COMPAT_API_KEY = "sk-test";
    process.env.THEMIS_OPENAI_COMPAT_MODEL = "gpt-5.4";
    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-1",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:05:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-1", "request-1"), "task-1");
    runtimeStore.saveTurnInput({
      requestId: "request-1",
      createdAt: "2026-04-02T00:00:01.000Z",
      envelope: {
        envelopeId: "envelope-http-diagnostics-1",
        sourceChannel: "feishu",
        sourceSessionId: "session-1",
        createdAt: "2026-04-02T00:00:01.000Z",
        parts: [
          {
            partId: "part-image-1",
            type: "image",
            role: "user",
            order: 1,
            assetId: "asset-image-1",
          },
        ],
        assets: [
          {
            assetId: "asset-image-1",
            kind: "image",
            mimeType: "image/png",
            localPath: "/tmp/http-diagnostics-image.png",
            sourceChannel: "feishu",
            ingestionStatus: "ready",
          },
        ],
      },
      compileSummary: {
        runtimeTarget: "app-server",
        degradationLevel: "native",
        warnings: [],
        capabilityMatrix: {
          modelCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: true,
            supportedDocumentMimeTypes: ["application/pdf"],
          },
          transportCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          effectiveCapabilities: {
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          assetFacts: [
            {
              assetId: "asset-image-1",
              kind: "image",
              mimeType: "image/png",
              localPathStatus: "ready",
              modelNativeSupport: true,
              transportNativeSupport: true,
              effectiveNativeSupport: true,
              modelMimeTypeSupported: null,
              transportMimeTypeSupported: null,
              effectiveMimeTypeSupported: null,
              handling: "native",
            },
          ],
        },
      },
    });
    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const response = await fetch(`${baseUrl}/api/diagnostics`, {
      method: "GET",
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      summary?: {
        workingDirectory?: string;
        auth?: unknown;
        provider?: {
          activeMode?: string;
          providerCount?: number;
        };
        context?: unknown;
        memory?: unknown;
        overview?: {
          hotspots?: Array<{
            scope?: string;
          }>;
        };
        service?: {
          multimodal?: {
            recentTurnInputCount?: number;
            lastTurn?: {
              degradationLevel?: string;
              capabilityMatrix?: {
                effectiveCapabilities?: {
                  nativeImageInput?: boolean;
                };
                assetFacts?: Array<{
                  handling?: string;
                }>;
              };
            };
          };
        };
        mcp?: {
          servers?: Array<{
            id?: string;
            transport?: string;
          }>;
          diagnostics?: {
            statusCounts?: {
              healthyCount?: number;
            };
            serverDiagnoses?: Array<{
              classification?: string;
            }>;
          };
        };
      };
    };
    assert.ok(payload.summary);
    assert.ok(payload.summary?.auth);
    assert.ok(payload.summary?.provider);
    assert.ok(payload.summary?.context);
    assert.ok(payload.summary?.memory);
    assert.ok(payload.summary?.overview);
    assert.ok(payload.summary?.service);
    assert.ok(payload.summary?.mcp);
    assert.equal(payload.summary?.workingDirectory, root);
    assert.equal(payload.summary?.provider?.activeMode, "third-party");
    assert.equal(payload.summary?.provider?.providerCount, 1);
    assert.equal(payload.summary?.service?.multimodal?.recentTurnInputCount, 1);
    assert.equal(payload.summary?.service?.multimodal?.lastTurn?.degradationLevel, "native");
    assert.equal(payload.summary?.service?.multimodal?.lastTurn?.capabilityMatrix?.effectiveCapabilities?.nativeImageInput, true);
    assert.equal(payload.summary?.service?.multimodal?.lastTurn?.capabilityMatrix?.assetFacts?.[0]?.handling, "native");
    assert.equal(payload.summary?.mcp?.servers?.[0]?.id, "context7");
    assert.equal(payload.summary?.mcp?.servers?.[0]?.transport, "stdio");
    assert.equal(payload.summary?.mcp?.diagnostics?.statusCounts?.healthyCount, 1);
    assert.equal(payload.summary?.mcp?.diagnostics?.serverDiagnoses?.[0]?.classification, "healthy");
  } finally {
    restoreEnv("THEMIS_OPENAI_COMPAT_BASE_URL", previousEnv.baseUrl);
    restoreEnv("THEMIS_OPENAI_COMPAT_API_KEY", previousEnv.apiKey);
    restoreEnv("THEMIS_OPENAI_COMPAT_MODEL", previousEnv.model);
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("GET /api/diagnostics 会返回 feishu summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-diagnostics-feishu-"));
  const previousEnv = {
    baseUrl: process.env.THEMIS_BASE_URL,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    useEnvProxy: process.env.FEISHU_USE_ENV_PROXY,
    progressFlushTimeoutMs: process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS,
  };
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({
    runtime,
    createMcpInspector: () => ({
      list: async () => ({
        servers: [],
      }),
      probe: async () => ({
        servers: [],
      }),
      reload: async () => ({
        servers: [],
      }),
    }),
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    process.env.THEMIS_BASE_URL = baseUrl;
    process.env.FEISHU_APP_ID = "cli_xxx";
    process.env.FEISHU_APP_SECRET = "secret_xxx";
    process.env.FEISHU_USE_ENV_PROXY = "true";
    process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS = "1500";
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
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra", "local", "feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-1",
              lastEventType: "message.created",
              updatedAt: "2026-04-02T00:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-1",
                  actionType: "user-input",
                  taskId: "task-1",
                  requestId: "request-1",
                  sourceChannel: "web",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "message.created",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-1",
              summary: "收到第一条消息",
              createdAt: "2026-04-02T00:00:01.000Z",
            },
            {
              id: "event-2",
              type: "task.progress",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              summary: "任务推进中",
              createdAt: "2026-04-02T00:00:02.000Z",
            },
          ],
        },
        null,
        2,
        ),
      "utf8",
    );
    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-1",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-1", "request-1"), "task-1");
    runtimeStore.appendTaskEvent({
      eventId: "event-runtime-1",
      taskId: "task-1",
      requestId: "request-1",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-1",
        },
      },
      timestamp: "2026-04-02T00:00:01.000Z",
    });
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
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const response = await fetch(`${baseUrl}/api/diagnostics`, {
      method: "GET",
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      summary?: {
        overview?: {
          hotspots?: Array<{
            scope?: string;
          }>;
        };
        feishu?: {
          env?: {
            appIdConfigured?: boolean;
            useEnvProxy?: boolean;
          };
          service?: {
            serviceReachable?: boolean;
          };
          state?: {
            sessionBindingCount?: number;
          };
          diagnostics?: {
            store?: {
              status?: string;
              conversations?: Array<{
                key?: string;
              }>;
            };
            currentConversation?: {
              key?: string;
            } | null;
            recentEvents?: Array<{
              id?: string;
            }>;
          };
          docs?: {
            smokeDocExists?: boolean;
          };
        };
      };
    };
    assert.ok(payload.summary?.overview);
    assert.equal(payload.summary?.feishu?.env?.appIdConfigured, true);
    assert.equal(payload.summary?.feishu?.env?.useEnvProxy, true);
    assert.equal(payload.summary?.feishu?.service?.serviceReachable, true);
    assert.equal(payload.summary?.feishu?.state?.sessionBindingCount, 1);
    assert.deepEqual(payload.summary?.feishu?.diagnostics?.store, {
      path: "infra/local/feishu-diagnostics.json",
      status: "ok",
    });
    assert.deepEqual(payload.summary?.feishu?.diagnostics?.currentConversation, {
      key: "chat-1::user-1",
      chatId: "chat-1",
      userId: "user-1",
      principalId: "principal-1",
      activeSessionId: "session-1",
      threadId: "thread-1",
      threadStatus: "running",
      multimodalSampleCount: 0,
      multimodalWarningCodeCounts: [],
      lastMultimodalInput: null,
      lastBlockedMultimodalInput: null,
      lastMessageId: "message-1",
      lastEventType: "message.created",
      pendingActionCount: 1,
      pendingActions: [
        {
          actionId: "action-1",
          actionType: "user-input",
          taskId: "task-1",
          requestId: "request-1",
          sourceChannel: "web",
          sessionId: "session-1",
          principalId: "principal-1",
        },
      ],
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    assert.deepEqual(payload.summary?.feishu?.diagnostics?.recentEvents?.[1], {
      id: "event-2",
      type: "task.progress",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      messageId: null,
      actionId: null,
      requestId: null,
      summary: "任务推进中",
      createdAt: "2026-04-02T00:00:02.000Z",
    });
    assert.deepEqual(payload.summary?.feishu?.diagnostics?.recentEvents?.map((event) => event.id), ["event-1", "event-2"]);
    assert.equal(payload.summary?.feishu?.docs?.smokeDocExists, true);
  } finally {
    restoreEnv("THEMIS_BASE_URL", previousEnv.baseUrl);
    restoreEnv("FEISHU_APP_ID", previousEnv.appId);
    restoreEnv("FEISHU_APP_SECRET", previousEnv.appSecret);
    restoreEnv("FEISHU_USE_ENV_PROXY", previousEnv.useEnvProxy);
    restoreEnv("FEISHU_PROGRESS_FLUSH_TIMEOUT_MS", previousEnv.progressFlushTimeoutMs);
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("GET /api/diagnostics 会返回失败 action 的 feishu summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-diagnostics-feishu-failed-action-"));
  const previousEnv = {
    baseUrl: process.env.THEMIS_BASE_URL,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    useEnvProxy: process.env.FEISHU_USE_ENV_PROXY,
    progressFlushTimeoutMs: process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS,
  };
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({
    runtime,
    createMcpInspector: () => ({
      list: async () => ({
        servers: [],
      }),
      probe: async () => ({
        servers: [],
      }),
      reload: async () => ({
        servers: [],
      }),
    }),
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    process.env.THEMIS_BASE_URL = baseUrl;
    process.env.FEISHU_APP_ID = "cli_xxx";
    process.env.FEISHU_APP_SECRET = "secret_xxx";
    process.env.FEISHU_USE_ENV_PROXY = "true";
    process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS = "1500";
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
              updatedAt: "2026-04-02T00:00:00.000Z",
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
          drafts: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra", "local", "feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-7",
              lastEventType: "takeover.submit_failed",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "takeover.submit_failed",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              actionId: "action-1",
              requestId: "request-1",
              summary: "takeover 提交失败",
              createdAt: "2026-04-02T09:00:03.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-1",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-1", "request-1"), "task-1");
    runtimeStore.appendTaskEvent({
      eventId: "event-runtime-1",
      taskId: "task-1",
      requestId: "request-1",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-1",
        },
      },
      timestamp: "2026-04-02T09:00:00.000Z",
    });

    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const response = await fetch(`${baseUrl}/api/diagnostics`, {
      method: "GET",
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      summary?: {
        feishu?: {
          diagnostics?: {
            lastActionAttempt?: {
              type?: string;
              requestId?: string | null;
            } | null;
          };
        };
      };
    };
    assert.equal(payload.summary?.feishu?.diagnostics?.lastActionAttempt?.type, "takeover.submit_failed");
    assert.equal(payload.summary?.feishu?.diagnostics?.lastActionAttempt?.requestId, "request-1");
  } finally {
    restoreEnv("THEMIS_BASE_URL", previousEnv.baseUrl);
    restoreEnv("FEISHU_APP_ID", previousEnv.appId);
    restoreEnv("FEISHU_APP_SECRET", previousEnv.appSecret);
    restoreEnv("FEISHU_USE_ENV_PROXY", previousEnv.useEnvProxy);
    restoreEnv("FEISHU_PROGRESS_FLUSH_TIMEOUT_MS", previousEnv.progressFlushTimeoutMs);
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("GET /api/diagnostics 会返回 feishu 最近窗口统计和最后一次 action / ignored message", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-diagnostics-feishu-window-"));
  const previousEnv = {
    baseUrl: process.env.THEMIS_BASE_URL,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    useEnvProxy: process.env.FEISHU_USE_ENV_PROXY,
    progressFlushTimeoutMs: process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS,
  };
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({
    runtime,
    createMcpInspector: () => ({
      list: async () => ({
        servers: [],
      }),
      probe: async () => ({
        servers: [],
      }),
      reload: async () => ({
        servers: [],
      }),
    }),
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    process.env.THEMIS_BASE_URL = baseUrl;
    process.env.FEISHU_APP_ID = "cli_xxx";
    process.env.FEISHU_APP_SECRET = "secret_xxx";
    process.env.FEISHU_USE_ENV_PROXY = "true";
    process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS = "1500";
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
              updatedAt: "2026-04-02T00:00:00.000Z",
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
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra", "local", "feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-6",
              lastEventType: "takeover.submitted",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-1",
                  actionType: "user-input",
                  taskId: "task-1",
                  requestId: "request-1",
                  sourceChannel: "web",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
                {
                  actionId: "action-2",
                  actionType: "approval",
                  taskId: "task-2",
                  requestId: "request-2",
                  sourceChannel: "feishu",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "message.duplicate_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-5",
              summary: "重复消息被忽略",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
            {
              id: "event-2",
              type: "message.stale_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-6",
              summary: "旧消息被忽略",
              createdAt: "2026-04-02T09:00:02.000Z",
            },
            {
              id: "event-3",
              type: "takeover.submitted",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              actionId: "action-1",
              requestId: "request-1",
              summary: "takeover 已提交",
              createdAt: "2026-04-02T09:00:03.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-1",
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-1", "request-1"), "task-1");
    runtimeStore.appendTaskEvent({
      eventId: "event-runtime-1",
      taskId: "task-1",
      requestId: "request-1",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-1",
        },
      },
      timestamp: "2026-04-02T09:00:00.000Z",
    });
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
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const response = await fetch(`${baseUrl}/api/diagnostics`, {
      method: "GET",
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      summary?: {
        feishu?: {
          diagnostics?: {
            recentWindowStats?: {
              duplicateIgnoredCount?: number;
              staleIgnoredCount?: number;
              takeoverSubmittedCount?: number;
            };
            lastActionAttempt?: {
              type?: string;
              requestId?: string | null;
            } | null;
            lastIgnoredMessage?: {
              type?: string;
              messageId?: string | null;
            } | null;
          };
        };
      };
    };
    assert.equal(payload.summary?.feishu?.diagnostics?.recentWindowStats?.duplicateIgnoredCount, 1);
    assert.equal(payload.summary?.feishu?.diagnostics?.recentWindowStats?.staleIgnoredCount, 1);
    assert.equal(payload.summary?.feishu?.diagnostics?.recentWindowStats?.takeoverSubmittedCount, 1);
    assert.equal(payload.summary?.feishu?.diagnostics?.lastActionAttempt?.type, "takeover.submitted");
    assert.equal(payload.summary?.feishu?.diagnostics?.lastActionAttempt?.requestId, "request-1");
    assert.equal(payload.summary?.feishu?.diagnostics?.lastIgnoredMessage?.type, "message.stale_ignored");
    assert.equal(payload.summary?.feishu?.diagnostics?.lastIgnoredMessage?.messageId, "message-6");
  } finally {
    restoreEnv("THEMIS_BASE_URL", previousEnv.baseUrl);
    restoreEnv("FEISHU_APP_ID", previousEnv.appId);
    restoreEnv("FEISHU_APP_SECRET", previousEnv.appSecret);
    restoreEnv("FEISHU_USE_ENV_PROXY", previousEnv.useEnvProxy);
    restoreEnv("FEISHU_PROGRESS_FLUSH_TIMEOUT_MS", previousEnv.progressFlushTimeoutMs);
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("GET /api/diagnostics/mcp 与 POST /api/diagnostics/mcp/probe/reload 可用", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-diagnostics-mcp-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({
    runtime,
    createMcpInspector: () => ({
      list: async () => ({
        servers: [
          {
            id: "context7",
            name: "Context 7",
            status: "healthy",
            transport: "stdio",
            args: ["-y", "@upstash/context7-mcp"],
            auth: "authenticated",
          },
        ],
      }),
      probe: async () => ({
        servers: [
          {
            id: "context7",
            name: "Context 7",
            status: "healthy",
            transport: "stdio",
            args: ["-y", "@upstash/context7-mcp"],
            auth: "authenticated",
          },
        ],
      }),
      reload: async () => ({
        servers: [
          {
            id: "context7",
            name: "Context 7",
            status: "healthy",
            transport: "stdio",
            args: ["-y", "@upstash/context7-mcp"],
            auth: "authenticated",
          },
        ],
      }),
    }),
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const mcpResponse = await fetch(`${baseUrl}/api/diagnostics/mcp`, {
      method: "GET",
      headers,
    });
    assert.equal(mcpResponse.status, 200);
    const mcpPayload = await mcpResponse.json() as {
      summary?: {
        servers?: Array<{
          id?: string;
          name?: string;
          status?: string;
          transport?: string;
        }>;
        diagnostics?: {
          serverDiagnoses?: Array<{
            classification?: string;
          }>;
        };
      };
    };
    assert.ok(Array.isArray(mcpPayload.summary?.servers));
    assert.equal(mcpPayload.summary?.servers?.[0]?.id, "context7");
    assert.equal(mcpPayload.summary?.servers?.[0]?.transport, "stdio");
    assert.equal(mcpPayload.summary?.diagnostics?.serverDiagnoses?.[0]?.classification, "healthy");

    const probeResponse = await fetch(`${baseUrl}/api/diagnostics/mcp/probe`, {
      method: "POST",
      headers,
    });
    assert.equal(probeResponse.status, 200);
    const probePayload = await probeResponse.json() as {
      summary?: {
        servers?: Array<{
          id?: string;
        }>;
      };
    };
    assert.ok(Array.isArray(probePayload.summary?.servers));
    assert.equal(probePayload.summary?.servers?.[0]?.id, "context7");

    const reloadResponse = await fetch(`${baseUrl}/api/diagnostics/mcp/reload`, {
      method: "POST",
      headers,
    });
    assert.equal(reloadResponse.status, 200);
    const reloadPayload = await reloadResponse.json() as {
      summary?: {
        servers?: Array<{
          id?: string;
        }>;
      };
    };
    assert.ok(Array.isArray(reloadPayload.summary?.servers));
    assert.equal(reloadPayload.summary?.servers?.[0]?.id, "context7");
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

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === "string") {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}

function createFeishuTaskRequest(sessionId: string, requestId: string): TaskRequest {
  return {
    requestId,
    taskId: requestId.replace("request", "task"),
    sourceChannel: "feishu",
    user: {
      userId: "user-1",
    },
    goal: "diagnostics",
    channelContext: {
      sessionId,
    },
    createdAt: "2026-04-02T00:00:00.000Z",
  };
}
