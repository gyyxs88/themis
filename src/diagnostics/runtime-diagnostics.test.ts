import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/task.js";
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
    assert.ok(summary.service.multimodal);
    assert.ok(summary.mcp);
    assert.ok(Array.isArray(summary.mcp.servers));
    assert.equal(summary.context.files.some((item) => item.path === "README.md" && item.status === "ok"), true);
    assert.equal(summary.context.files.some((item) => item.path === "AGENTS.md" && item.status === "missing"), true);
    assert.equal(summary.provider.activeMode === "auth" || summary.provider.activeMode === "third-party", true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService.readSummary 可按需输出 Codex runtime catalog 只读能力摘要", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-catalog-"));

  try {
    const runtimeStore = new SqliteCodexSessionRegistry({
      databaseFile: join(root, "infra/local/themis.db"),
    });
    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
      mcpInspector: {
        list: async () => ({ servers: [] }),
      } as never,
      runtimeCatalogReader: async () => ({
        models: [{
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          description: "",
          hidden: false,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "xhigh",
          contextWindow: null,
          capabilities: {
            textInput: true,
            imageInput: true,
            nativeTextInput: true,
            nativeImageInput: true,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
            supportsPdfTextExtraction: false,
            supportsDocumentPageRasterization: false,
            supportsCodexTasks: true,
            supportsReasoningSummaries: false,
            supportsVerbosity: false,
            supportsParallelToolCalls: false,
            supportsSearchTool: true,
            supportsImageDetailOriginal: false,
          },
          supportsPersonality: false,
          supportsCodexTasks: true,
          isDefault: true,
        }],
        defaults: {
          profile: null,
          model: "gpt-5.5",
          reasoning: "xhigh",
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
          webSearchMode: "live",
          networkAccessEnabled: true,
        },
        provider: null,
        accessModes: [],
        thirdPartyProviders: [],
        personas: [],
        providerCapabilities: {
          available: true,
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
          readError: null,
        },
        runtimeHooks: {
          entries: [],
          totalHookCount: 0,
          enabledHookCount: 0,
          warningCount: 0,
          errorCount: 0,
          readError: null,
        },
      }),
    });

    const skipped = await service.readSummary({ includeRuntimeCatalog: false });
    assert.equal(skipped.service.runtimeCatalog.available, false);
    assert.equal(skipped.service.runtimeCatalog.modelCount, 0);

    const summary = await service.readSummary({ includeRuntimeCatalog: true });

    assert.equal(summary.service.runtimeCatalog.available, true);
    assert.equal(summary.service.runtimeCatalog.modelCount, 1);
    assert.equal(summary.service.runtimeCatalog.defaultModel, "gpt-5.5");
    assert.equal(summary.service.runtimeCatalog.providerCapabilities?.namespaceTools, true);
    assert.equal(summary.service.runtimeCatalog.runtimeHooks?.totalHookCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService.readSummary 在公开仓运行形态不要求开发仓记忆文件", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-public-"));

  try {
    writeFileSync(join(root, "README.md"), "# demo\n", "utf8");
    mkdirSync(join(root, "memory", "sessions"), { recursive: true });
    mkdirSync(join(root, "memory", "tasks"), { recursive: true });
    writeFileSync(join(root, "memory", "sessions", "active.md"), "# active\n", "utf8");
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

    assert.deepEqual(summary.context.files.map((item) => item.path), ["README.md"]);
    assert.deepEqual(summary.memory.files.map((item) => item.path), [
      "memory/sessions/active.md",
      "memory/tasks/in-progress.md",
      "memory/tasks/done.md",
    ]);
    assert.equal(summary.overview.hotspots.some((item) => item.id === "context_files_missing"), false);
    assert.equal(summary.overview.hotspots.some((item) => item.id === "memory_files_missing"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService.readSummary 会汇总最近 turn input 的多模态事实", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-multimodal-"));

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

    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-1",
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T09:10:00.000Z",
    });
    runtimeStore.saveSession({
      sessionId: "session-2",
      threadId: "thread-2",
      createdAt: "2026-04-03T09:20:00.000Z",
      updatedAt: "2026-04-03T09:30:00.000Z",
    });

    runtimeStore.upsertTurnFromRequest(createTaskRequest("feishu", "session-1", "request-native-image", "2026-04-03T09:10:00.000Z"), "task-native-image");
    runtimeStore.saveTurnInput({
      requestId: "request-native-image",
      createdAt: "2026-04-03T09:10:01.000Z",
      envelope: {
        envelopeId: "envelope-native-image",
        sourceChannel: "feishu",
        sourceSessionId: "session-1",
        createdAt: "2026-04-03T09:10:01.000Z",
        parts: [
          {
            partId: "part-text-1",
            type: "text",
            role: "user",
            order: 1,
            text: "请看图",
          },
          {
            partId: "part-image-1",
            type: "image",
            role: "user",
            order: 2,
            assetId: "asset-image-1",
          },
        ],
        assets: [
          {
            assetId: "asset-image-1",
            kind: "image",
            mimeType: "image/png",
            localPath: "/tmp/native-image.png",
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

    runtimeStore.upsertTurnFromRequest(createTaskRequest("web", "session-1", "request-document-fallback", "2026-04-03T09:15:00.000Z"), "task-document-fallback");
    runtimeStore.saveTurnInput({
      requestId: "request-document-fallback",
      createdAt: "2026-04-03T09:15:01.000Z",
      envelope: {
        envelopeId: "envelope-document-fallback",
        sourceChannel: "web",
        sourceSessionId: "session-1",
        createdAt: "2026-04-03T09:15:01.000Z",
        parts: [
          {
            partId: "part-document-1",
            type: "document",
            role: "user",
            order: 1,
            assetId: "asset-document-1",
          },
        ],
        assets: [
          {
            assetId: "asset-document-1",
            kind: "document",
            mimeType: "application/pdf",
            localPath: "/tmp/fallback-document.pdf",
            sourceChannel: "web",
            ingestionStatus: "ready",
          },
        ],
      },
      compileSummary: {
        runtimeTarget: "app-server",
        degradationLevel: "controlled_fallback",
        warnings: [
          {
            code: "DOCUMENT_NATIVE_INPUT_FALLBACK",
            message: "当前 runtime 未声明支持原生文档输入，文档已退化为路径提示。",
            assetId: "asset-document-1",
          },
        ],
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
              assetId: "asset-document-1",
              kind: "document",
              mimeType: "application/pdf",
              localPathStatus: "ready",
              modelNativeSupport: true,
              transportNativeSupport: false,
              effectiveNativeSupport: false,
              modelMimeTypeSupported: true,
              transportMimeTypeSupported: null,
              effectiveMimeTypeSupported: null,
              handling: "path_fallback",
            },
          ],
        },
      },
    });

    runtimeStore.upsertTurnFromRequest(createTaskRequest("feishu", "session-2", "request-image-blocked", "2026-04-03T09:30:00.000Z"), "task-image-blocked");
    runtimeStore.saveTurnInput({
      requestId: "request-image-blocked",
      createdAt: "2026-04-03T09:30:01.000Z",
      envelope: {
        envelopeId: "envelope-image-blocked",
        sourceChannel: "feishu",
        sourceSessionId: "session-2",
        createdAt: "2026-04-03T09:30:01.000Z",
        parts: [
          {
            partId: "part-image-2",
            type: "image",
            role: "user",
            order: 1,
            assetId: "asset-image-2",
          },
        ],
        assets: [
          {
            assetId: "asset-image-2",
            kind: "image",
            mimeType: "image/jpeg",
            localPath: "/tmp/blocked-image.jpg",
            sourceChannel: "feishu",
            ingestionStatus: "ready",
          },
        ],
      },
      compileSummary: {
        runtimeTarget: "codex-sdk",
        degradationLevel: "blocked",
        warnings: [
          {
            code: "IMAGE_NATIVE_INPUT_REQUIRED",
            message: "当前 runtime 不支持 native image input。",
            assetId: "asset-image-2",
          },
        ],
        capabilityMatrix: {
          modelCapabilities: null,
          transportCapabilities: {
            nativeTextInput: true,
            nativeImageInput: false,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          effectiveCapabilities: {
            nativeTextInput: true,
            nativeImageInput: false,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
          },
          assetFacts: [
            {
              assetId: "asset-image-2",
              kind: "image",
              mimeType: "image/jpeg",
              localPathStatus: "ready",
              modelNativeSupport: null,
              transportNativeSupport: false,
              effectiveNativeSupport: false,
              modelMimeTypeSupported: null,
              transportMimeTypeSupported: null,
              effectiveMimeTypeSupported: null,
              handling: "blocked",
            },
          ],
        },
      },
    });

    runtimeStore.saveSession({
      sessionId: "runtime-smoke-web-session-newer",
      threadId: "thread-smoke",
      createdAt: "2026-04-03T09:40:00.000Z",
      updatedAt: "2026-04-03T09:40:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(
      createTaskRequest("web", "runtime-smoke-web-session-newer", "runtime-smoke-web-request-newer", "2026-04-03T09:40:00.000Z"),
      "runtime-smoke-web-task-newer",
    );
    runtimeStore.saveTurnInput({
      requestId: "runtime-smoke-web-request-newer",
      createdAt: "2026-04-03T09:40:01.000Z",
      envelope: {
        envelopeId: "runtime-smoke-web-envelope-newer",
        sourceChannel: "web",
        sourceSessionId: "runtime-smoke-web-session-newer",
        createdAt: "2026-04-03T09:40:01.000Z",
        parts: [
          {
            partId: "runtime-smoke-web-image-part",
            type: "image",
            role: "user",
            order: 1,
            assetId: "runtime-smoke-web-image",
          },
        ],
        assets: [
          {
            assetId: "runtime-smoke-web-image",
            kind: "image",
            mimeType: "image/jpeg",
            localPath: "/tmp/runtime-smoke.jpg",
            sourceChannel: "web",
            ingestionStatus: "ready",
          },
        ],
      },
      compileSummary: {
        runtimeTarget: "app-server",
        degradationLevel: "blocked",
        warnings: [
          {
            code: "IMAGE_NATIVE_INPUT_REQUIRED",
            message: "runtime smoke should not dominate service diagnostics",
          },
        ],
      },
    });

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
      mcpInspector: {
        list: async () => ({ servers: [] }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.equal(summary.service.multimodal.available, true);
    assert.equal(summary.service.multimodal.sampleWindowSize, 24);
    assert.equal(summary.service.multimodal.recentTurnInputCount, 3);
    assert.deepEqual(summary.service.multimodal.assetCounts, {
      image: 2,
      document: 1,
    });
    assert.deepEqual(summary.service.multimodal.degradationCounts, {
      native: 1,
      losslessTextualization: 0,
      controlledFallback: 1,
      blocked: 1,
      unknown: 0,
    });
    assert.deepEqual(summary.service.multimodal.sourceChannelCounts, [
      { sourceChannel: "feishu", count: 2 },
      { sourceChannel: "web", count: 1 },
    ]);
    assert.deepEqual(summary.service.multimodal.runtimeTargetCounts, [
      { runtimeTarget: "app-server", count: 2 },
      { runtimeTarget: "codex-sdk", count: 1 },
    ]);
    assert.deepEqual(summary.service.multimodal.warningCodeCounts, [
      { code: "DOCUMENT_NATIVE_INPUT_FALLBACK", count: 1 },
      { code: "IMAGE_NATIVE_INPUT_REQUIRED", count: 1 },
    ]);
    assert.equal(summary.service.multimodal.lastTurn?.requestId, "request-image-blocked");
    assert.equal(summary.service.multimodal.lastTurn?.sourceChannel, "feishu");
    assert.equal(summary.service.multimodal.lastTurn?.sessionId, "session-2");
    assert.equal(summary.service.multimodal.lastTurn?.runtimeTarget, "codex-sdk");
    assert.equal(summary.service.multimodal.lastTurn?.degradationLevel, "blocked");
    assert.deepEqual(summary.service.multimodal.lastTurn?.partTypes, ["image"]);
    assert.deepEqual(summary.service.multimodal.lastTurn?.assetKinds, ["image"]);
    assert.deepEqual(summary.service.multimodal.lastTurn?.warningCodes, ["IMAGE_NATIVE_INPUT_REQUIRED"]);
    assert.deepEqual(summary.service.multimodal.lastTurn?.warningMessages, ["当前 runtime 不支持 native image input。"]);
    assert.equal(summary.service.multimodal.lastTurn?.capabilityMatrix?.modelCapabilities, null);
    assert.equal(summary.service.multimodal.lastTurn?.capabilityMatrix?.transportCapabilities?.nativeImageInput, false);
    assert.equal(summary.service.multimodal.lastTurn?.capabilityMatrix?.effectiveCapabilities.nativeImageInput, false);
    assert.equal(summary.service.multimodal.lastTurn?.capabilityMatrix?.assetFacts[0]?.handling, "blocked");
    assert.equal(summary.service.multimodal.lastBlockedTurn?.requestId, "request-image-blocked");
    assert.equal(summary.service.multimodal.lastBlockedTurn?.runtimeTarget, "codex-sdk");
    assert.equal(summary.service.multimodal.lastBlockedTurn?.degradationLevel, "blocked");
    assert.deepEqual(summary.service.multimodal.lastBlockedTurn?.warningCodes, ["IMAGE_NATIVE_INPUT_REQUIRED"]);
    assert.deepEqual(summary.service.multimodal.lastBlockedTurn?.warningMessages, ["当前 runtime 不支持 native image input。"]);
    assert.equal(summary.service.multimodal.lastBlockedTurn?.capabilityMatrix?.assetFacts[0]?.handling, "blocked");
    assert.equal(summary.overview.hotspots.some((item) => item.id === "multimodal_inputs_blocked"), true);
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
    themisBaseUrl: process.env.THEMIS_BASE_URL,
  };
  let server: ReturnType<typeof createServer> | null = null;
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

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
    runtimeStore.saveSession({
      sessionId: "session-2",
      threadId: "thread-2",
      createdAt: "2026-04-01T00:59:00.000Z",
      updatedAt: "2026-04-01T01:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-2", "request-2"), "task-2");
    runtimeStore.appendTaskEvent({
      eventId: "event-runtime-1",
      taskId: "task-2",
      requestId: "request-2",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-2",
        },
      },
      timestamp: "2026-04-01T01:00:01.000Z",
    });
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
              updatedAt: "2026-04-01T00:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-1",
                  actionType: "approval",
                  taskId: "task-1",
                  requestId: "request-1",
                  sourceChannel: "feishu",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
            {
              key: "chat-2::user-2",
              chatId: "chat-2",
              userId: "user-2",
              principalId: "principal-2",
              activeSessionId: "session-2",
              lastMessageId: "message-2",
              lastEventType: "message.received",
              updatedAt: "2026-04-01T01:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-2",
                  actionType: "approval",
                  taskId: "task-2",
                  requestId: "request-2",
                  sourceChannel: "web",
                  sessionId: "session-2",
                  principalId: "principal-2",
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
              actionId: "action-1",
              requestId: "request-1",
              summary: "收到第一条消息",
              createdAt: "2026-04-01T00:00:01.000Z",
            },
            {
              id: "event-2",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "任务推进中",
              createdAt: "2026-04-01T01:00:01.000Z",
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
    assert.deepEqual(summary.feishu.diagnostics.store, {
      path: "infra/local/feishu-diagnostics.json",
      status: "ok",
    });
    assert.deepEqual(summary.feishu.diagnostics.currentConversation, {
      key: "chat-2::user-2",
      chatId: "chat-2",
      userId: "user-2",
      principalId: "principal-2",
      activeSessionId: "session-2",
      threadId: "thread-2",
      threadStatus: "running",
      multimodalSampleCount: 0,
      multimodalWarningCodeCounts: [],
      lastMultimodalInput: null,
      lastBlockedMultimodalInput: null,
      lastMessageId: "message-2",
      lastEventType: "message.received",
      pendingActionCount: 1,
      pendingActions: [
        {
          actionId: "action-2",
          actionType: "approval",
          taskId: "task-2",
          requestId: "request-2",
          sourceChannel: "web",
          sessionId: "session-2",
          principalId: "principal-2",
        },
      ],
      updatedAt: "2026-04-01T01:00:00.000Z",
    });
    assert.deepEqual(summary.feishu.diagnostics.recentEvents[1], {
      id: "event-2",
      type: "task.progress",
      chatId: "chat-2",
      userId: "user-2",
      sessionId: "session-2",
      principalId: "principal-2",
      messageId: null,
      actionId: null,
      requestId: null,
      summary: "任务推进中",
      createdAt: "2026-04-01T01:00:01.000Z",
    });
    assert.deepEqual(summary.feishu.diagnostics.recentEvents.map((event) => event.id), ["event-1", "event-2"]);
    assert.equal(summary.feishu.docs.smokeDocExists, true);
  } finally {
    restoreEnv("FEISHU_APP_ID", previousEnv.feishuAppId);
    restoreEnv("FEISHU_APP_SECRET", previousEnv.feishuAppSecret);
    restoreEnv("FEISHU_USE_ENV_PROXY", previousEnv.feishuUseEnvProxy);
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

test("RuntimeDiagnosticsService.readSummary 会透出飞书最近窗口统计和最后一次 action / ignored message", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-feishu-window-"));
  const previousEnv = {
    feishuAppId: process.env.FEISHU_APP_ID,
    feishuAppSecret: process.env.FEISHU_APP_SECRET,
    feishuUseEnvProxy: process.env.FEISHU_USE_ENV_PROXY,
    themisBaseUrl: process.env.THEMIS_BASE_URL,
  };
  let server: ReturnType<typeof createServer> | null = null;
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

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
              parts: [],
              assets: [],
              attachments: [],
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
              updatedAt: "2026-04-01T00:00:05.000Z",
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
              type: "message.duplicate_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-5",
              summary: "重复消息被忽略",
              createdAt: "2026-04-01T00:00:01.000Z",
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
              createdAt: "2026-04-01T00:00:02.000Z",
            },
            {
              id: "event-2",
              type: "pending_input.not_found",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              summary: "没有找到匹配的 pending action",
              createdAt: "2026-04-01T00:00:02.500Z",
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
              createdAt: "2026-04-01T00:00:03.000Z",
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
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
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
      timestamp: "2026-04-01T00:00:01.000Z",
    });

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
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
    process.env.THEMIS_BASE_URL = `http://127.0.0.1:${address.port}`;

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
      mcpInspector: {
        list: async () => ({ servers: [] }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.equal(summary.feishu.diagnostics.recentWindowStats.duplicateIgnoredCount, 1);
    assert.equal(summary.feishu.diagnostics.recentWindowStats.staleIgnoredCount, 1);
    assert.equal(summary.feishu.diagnostics.recentWindowStats.takeoverSubmittedCount, 1);
    assert.equal(summary.feishu.diagnostics.lastActionAttempt?.type, "takeover.submitted");
    assert.equal(summary.feishu.diagnostics.lastActionAttempt?.requestId, "request-1");
    assert.equal(summary.feishu.diagnostics.lastIgnoredMessage?.type, "message.stale_ignored");
    assert.equal(summary.feishu.diagnostics.lastIgnoredMessage?.messageId, "message-6");
    assert.equal(summary.feishu.diagnostics.primaryDiagnosis?.id, "pending_input_not_found");
    assert.ok(summary.feishu.diagnostics.secondaryDiagnoses.some((item) => item.id === "ignored_message_window"));
    assert.ok(summary.feishu.diagnostics.recommendedNextSteps.length > 0);
  } finally {
    restoreEnv("FEISHU_APP_ID", previousEnv.feishuAppId);
    restoreEnv("FEISHU_APP_SECRET", previousEnv.feishuAppSecret);
    restoreEnv("FEISHU_USE_ENV_PROXY", previousEnv.feishuUseEnvProxy);
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

test("RuntimeDiagnosticsService.readSummary 会把失败 action 纳入 feishu lastActionAttempt", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-feishu-failed-action-"));
  const previousEnv = {
    feishuAppId: process.env.FEISHU_APP_ID,
    feishuAppSecret: process.env.FEISHU_APP_SECRET,
    feishuUseEnvProxy: process.env.FEISHU_USE_ENV_PROXY,
    themisBaseUrl: process.env.THEMIS_BASE_URL,
  };
  let server: ReturnType<typeof createServer> | null = null;
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

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
              lastEventType: "reply.submit_failed",
              updatedAt: "2026-04-01T00:00:05.000Z",
              pendingActions: [],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "reply.submit_failed",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              actionId: "action-1",
              requestId: "request-1",
              summary: "reply 提交失败",
              createdAt: "2026-04-01T00:00:01.000Z",
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
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
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
      timestamp: "2026-04-01T00:00:01.000Z",
    });

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
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
    process.env.THEMIS_BASE_URL = `http://127.0.0.1:${address.port}`;

    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
      mcpInspector: {
        list: async () => ({ servers: [] }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.equal(summary.feishu.diagnostics.lastActionAttempt?.type, "reply.submit_failed");
    assert.equal(summary.feishu.diagnostics.lastActionAttempt?.requestId, "request-1");
    assert.equal(summary.feishu.diagnostics.lastActionAttempt?.actionId, "action-1");
    assert.equal(summary.feishu.diagnostics.lastActionAttempt?.summary, "reply 提交失败");
    assert.equal(summary.feishu.diagnostics.primaryDiagnosis?.id, "action_submit_failed");
  } finally {
    restoreEnv("FEISHU_APP_ID", previousEnv.feishuAppId);
    restoreEnv("FEISHU_APP_SECRET", previousEnv.feishuAppSecret);
    restoreEnv("FEISHU_USE_ENV_PROXY", previousEnv.feishuUseEnvProxy);
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

test("RuntimeDiagnosticsService.readSummary 会汇总总览热点和 mcp 诊断建议", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-overview-"));
  const previousEnv = {
    feishuAppId: process.env.FEISHU_APP_ID,
    feishuAppSecret: process.env.FEISHU_APP_SECRET,
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
              lastMessageId: "message-3",
              lastEventType: "pending_input.not_found",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [
                {
                  actionId: "input-1",
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
              type: "pending_input.not_found",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              summary: "没有匹配到 pending action",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
            {
              id: "event-2",
              type: "message.stale_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-2",
              summary: "旧消息被忽略",
              createdAt: "2026-04-02T09:00:02.000Z",
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
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
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
    process.env.THEMIS_BASE_URL = `http://127.0.0.1:${address.port}`;

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
              transport: "stdio",
              command: "npx",
              args: ["-y", "@upstash/context7-mcp"],
              auth: "authenticated",
            },
            {
              id: "figma",
              name: "Figma",
              status: "degraded",
              transport: "sse",
              auth: "login_required",
              message: "OAuth login required",
            },
          ],
        }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.equal(summary.overview.primaryFocus?.scope, "feishu");
    assert.equal(summary.overview.primaryFocus?.id, "feishu_pending_input_not_found");
    assert.ok(summary.overview.hotspots.some((item) => item.scope === "mcp"));
    assert.ok(summary.overview.suggestedCommands.includes("./themis doctor feishu"));
    assert.ok(summary.overview.suggestedCommands.includes("./themis doctor mcp"));
    assert.equal(summary.mcp.diagnostics.statusCounts.healthyCount, 1);
    assert.equal(summary.mcp.diagnostics.statusCounts.abnormalCount, 1);
    assert.equal(summary.mcp.diagnostics.primaryDiagnosis?.id, "server_degraded");
    assert.equal(summary.mcp.diagnostics.serverDiagnoses[0]?.classification, "healthy");
    assert.equal(summary.mcp.diagnostics.serverDiagnoses[0]?.server.transport, "stdio");
    assert.equal(summary.mcp.diagnostics.serverDiagnoses[1]?.classification, "auth_required");
    assert.match(summary.mcp.diagnostics.serverDiagnoses[1]?.summary ?? "", /OAuth|认证|登录/);
    assert.ok(summary.mcp.diagnostics.serverDiagnoses[1]?.recommendedActions.includes("./themis doctor mcp"));
    assert.ok(summary.mcp.diagnostics.serverDiagnoses[1]?.recommendedActions.includes("补齐对应 MCP server 的认证或重新执行 OAuth 登录。"));
    assert.ok(summary.mcp.diagnostics.recommendedNextSteps.includes("./themis doctor service"));
  } finally {
    restoreEnv("FEISHU_APP_ID", previousEnv.feishuAppId);
    restoreEnv("FEISHU_APP_SECRET", previousEnv.feishuAppSecret);
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
              args: [],
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
        args: [],
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeDiagnosticsService 会把 authStatus 驱动的 available MCP 视为健康，不误报 unknown", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-diagnostics-mcp-available-"));

  try {
    const service = new RuntimeDiagnosticsService({
      workingDirectory: root,
      runtimeStore: null,
      mcpInspector: {
        list: async () => ({
          servers: [
            {
              id: "codex_apps",
              name: "codex_apps",
              status: "available",
              args: [],
              auth: "bearerToken",
            },
            {
              id: "todoist",
              name: "todoist",
              status: "available",
              args: [],
              auth: "unsupported",
            },
          ],
        }),
      } as never,
    });
    const summary = await service.readSummary();

    assert.equal(summary.mcp.diagnostics.statusCounts.healthyCount, 2);
    assert.equal(summary.mcp.diagnostics.statusCounts.abnormalCount, 0);
    assert.equal(summary.mcp.diagnostics.primaryDiagnosis?.id, "healthy");
    assert.equal(summary.mcp.diagnostics.serverDiagnoses[0]?.classification, "healthy");
    assert.equal(summary.mcp.diagnostics.serverDiagnoses[1]?.classification, "healthy");
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

function createFeishuTaskRequest(sessionId: string, requestId: string): TaskRequest {
  return createTaskRequest("feishu", sessionId, requestId, "2026-04-01T01:00:00.000Z");
}

function createTaskRequest(
  sourceChannel: TaskRequest["sourceChannel"],
  sessionId: string,
  requestId: string,
  createdAt: string,
): TaskRequest {
  return {
    requestId,
    taskId: requestId.replace("request", "task"),
    sourceChannel,
    user: {
      userId: "user-1",
    },
    goal: "diagnostics",
    channelContext: {
      sessionId,
    },
    createdAt,
  };
}
