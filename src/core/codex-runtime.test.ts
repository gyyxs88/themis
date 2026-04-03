import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ThreadOptions } from "@openai/codex-sdk";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskEvent, TaskRequest } from "../types/index.js";
import type { CompiledTaskInput } from "./runtime-input-compiler.js";
import { CodexTaskRuntime } from "./codex-runtime.js";
import * as codexRuntimeModule from "./codex-runtime.js";
import type { CodexThreadSessionStore } from "./codex-session-store.js";
import {
  addOpenAICompatibleProvider,
  addOpenAICompatibleProviderModel,
  type OpenAICompatibleProviderConfig,
} from "./openai-compatible-provider.js";
import type { ContextBuildResult } from "../types/context.js";

function createProviderConfig(): OpenAICompatibleProviderConfig {
  return {
    id: "gateway",
    name: "Gateway",
    baseUrl: "https://example.com/v1",
    apiKey: "sk-test",
    endpointCandidates: ["https://backup.example.com/v1"],
    defaultModel: "gpt-5.4",
    wireApi: "responses",
    supportsWebsockets: false,
    modelCatalogPath: null,
    source: "db",
    models: [
      {
        model: "gpt-5.4",
        isDefault: true,
        profile: {
          displayName: "GPT-5.4",
          description: "",
          defaultReasoningLevel: "medium",
          supportedReasoningLevels: ["low", "medium", "high"],
          contextWindow: 1234,
          truncationMode: "tokens",
          truncationLimit: 4096,
          capabilities: {
            textInput: true,
            imageInput: false,
            nativeTextInput: true,
            nativeImageInput: false,
            nativeDocumentInput: false,
            supportedDocumentMimeTypes: [],
            supportsPdfTextExtraction: false,
            supportsDocumentPageRasterization: false,
            supportsCodexTasks: true,
            supportsReasoningSummaries: false,
            supportsVerbosity: false,
            supportsParallelToolCalls: false,
            supportsSearchTool: false,
            supportsImageDetailOriginal: false,
          },
        },
      },
    ],
  };
}

function createRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    requestId: "req-1",
    taskId: "task-1",
    sourceChannel: "web",
    user: {
      userId: "user-1",
      displayName: "User",
    },
    goal: "test",
    channelContext: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
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

test("第三方模型未声明 search tool 时会阻止带联网搜索的请求", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-runtime-constraints-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory,
    runtimeStore: registry,
    providerConfigs: [createProviderConfig()],
  });

  try {
    assert.throws(() => {
      (runtime as unknown as {
        assertThirdPartyModelSupported(request: TaskRequest, providerConfig: OpenAICompatibleProviderConfig): void;
      }).assertThirdPartyModelSupported(createRequest({
        options: {
          accessMode: "third-party",
          model: "gpt-5.4",
          webSearchMode: "live",
        },
      }), createProviderConfig());
    }, /search tool/);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("第三方模型未声明图片输入时会阻止图片附件请求", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-runtime-constraints-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory,
    runtimeStore: registry,
    providerConfigs: [createProviderConfig()],
  });

  try {
    assert.throws(() => {
      (runtime as unknown as {
        assertThirdPartyModelSupported(request: TaskRequest, providerConfig: OpenAICompatibleProviderConfig): void;
      }).assertThirdPartyModelSupported(createRequest({
        options: {
          accessMode: "third-party",
          model: "gpt-5.4",
        },
        attachments: [
          {
            id: "img-1",
            type: "image",
            value: "fake-image",
          },
        ],
      }), createProviderConfig());
    }, /图片输入/);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("第三方模型未声明图片输入时会阻止 inputEnvelope 里的图片请求", () => {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-runtime-constraints-envelope-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory,
    runtimeStore: registry,
    providerConfigs: [createProviderConfig()],
  });

  try {
    assert.throws(() => {
      (runtime as unknown as {
        assertThirdPartyModelSupported(request: TaskRequest, providerConfig: OpenAICompatibleProviderConfig): void;
      }).assertThirdPartyModelSupported(createRequest({
        options: {
          accessMode: "third-party",
          model: "gpt-5.4",
        },
        inputEnvelope: {
          envelopeId: "env-provider-image-1",
          sourceChannel: "web",
          parts: [
            { partId: "part-1", type: "image", role: "user", order: 1, assetId: "asset-image-1" },
          ],
          assets: [
            {
              assetId: "asset-image-1",
              kind: "image",
              mimeType: "image/png",
              localPath: "/workspace/temp/input-assets/shot.png",
              sourceChannel: "web",
              ingestionStatus: "ready",
            },
          ],
          createdAt: "2026-04-01T10:10:00.000Z",
        },
      }), createProviderConfig());
    }, /图片输入/);
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("buildCodexFallbackPromptSections 只消费路径提示块和额外纯文本 parts", () => {
  const promptSections = (codexRuntimeModule as unknown as {
    buildCodexFallbackPromptSections(request: TaskRequest, compiledInput: CompiledTaskInput | null): string[];
  }).buildCodexFallbackPromptSections(
    createRequest({
      goal: "帮我看文档",
    }),
    {
      nativeInputParts: [
        {
          type: "text",
          text: "这段正文不应被拼进文档 fallback。",
          assetId: "asset-doc-1",
          sourcePartId: "part-doc-text-1",
        },
        {
          type: "text",
          text: "第一段上下文：系统已经切到新会话。",
          sourcePartId: "part-text-1",
        },
        {
          type: "text",
          text: "第二段上下文：请保持同一线程继续处理。",
          sourcePartId: "part-text-2",
        },
      ],
      fallbackPromptSections: [
        "Attached document paths:\n\n- assetId: asset-doc-1\n  name: guide.md\n  mimeType: text/markdown\n  localPath: /workspace/temp/input-assets/guide.md",
      ],
      compileWarnings: [],
      degradationLevel: "controlled_fallback",
    },
  );

  assert.equal(promptSections.length, 2);
  assert.equal(promptSections[0], "Attached document paths:\n\n- assetId: asset-doc-1\n  name: guide.md\n  mimeType: text/markdown\n  localPath: /workspace/temp/input-assets/guide.md");
  assert.match(promptSections[1] ?? "", /Additional envelope text parts:/);
  assert.match(promptSections[1] ?? "", /第一段上下文：系统已经切到新会话。/);
  assert.match(promptSections[1] ?? "", /第二段上下文：请保持同一线程继续处理。/);
  assert.doesNotMatch(promptSections.join("\n\n"), /Document text fallback:/);
  assert.doesNotMatch(promptSections.join("\n\n"), /这段正文不应被拼进文档 fallback。/);
});

test("runTask 在 codex-sdk 路径遇到图片 envelope 时会在 acquire 前阻止", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-envelope-image-blocked-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory);
  writeRuntimeFile(controlDirectory, "README.md", "# control");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  let acquireCalled = false;
  const sessionStore: CodexThreadSessionStore = {
    getSessionRegistry: () => runtimeStore,
    resolveThreadId: async () => null,
    acquire: async () => {
      acquireCalled = true;
      throw new Error("acquire should not be called");
    },
  } as unknown as CodexThreadSessionStore;
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
  });

  try {
    await assert.rejects(
      async () => runtime.runTask(createRequest({
        requestId: "req-sdk-envelope-image-blocked",
        taskId: "task-sdk-envelope-image-blocked",
        goal: "帮我看图",
        inputEnvelope: {
          envelopeId: "env-sdk-image-blocked-1",
          sourceChannel: "web",
          parts: [
            { partId: "part-1", type: "image", role: "user", order: 1, assetId: "asset-image-1" },
          ],
          assets: [
            {
              assetId: "asset-image-1",
              kind: "image",
              mimeType: "image/png",
              localPath: "/workspace/temp/input-assets/shot.png",
              sourceChannel: "web",
              ingestionStatus: "ready",
            },
          ],
          createdAt: "2026-04-01T11:20:00.000Z",
        },
      })),
      /图片原生输入/,
    );
    assert.equal(acquireCalled, false);
    const storedInput = runtimeStore.getTurnInput("req-sdk-envelope-image-blocked");
    assert.equal(storedInput?.envelope.parts[0]?.type, "image");
    assert.equal(storedInput?.compileSummary?.runtimeTarget, "codex-sdk");
    assert.equal(storedInput?.compileSummary?.degradationLevel, "blocked");
    assert.equal(storedInput?.compileSummary?.warnings[0]?.code, "IMAGE_NATIVE_INPUT_REQUIRED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexTaskRuntime 构造时会为现有 auth account 预建 session store，并在 auth 请求中复用", () => {
  withClearedOpenAICompatEnv(() => {
    const workingDirectory = mkdtempSync(join(tmpdir(), "themis-runtime-auth-store-"));
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    registry.saveAuthAccount({
      accountId: "acct-1",
      label: "账户一",
      accountEmail: "acct-1@example.com",
      codexHome: join(workingDirectory, "infra/local/codex-auth/acct-1"),
      isActive: true,
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z",
    });

    const records = createRecordingSessionStoreFactoryRecords();
    const runtime = new CodexTaskRuntime({
      workingDirectory,
      runtimeStore: registry,
      createSessionStore: records.createSessionStore,
    });

    try {
      assert.equal(records.calls.length, 1);
      assert.equal(records.calls[0]?.sessionIdNamespace, "auth:acct-1");
      assert.equal(records.calls[0]?.sessionRegistry, registry);
      assert.ok(records.calls[0]?.codex);
      assert.equal(records.calls.length, 1);

      const target = (runtime as unknown as {
        resolveRuntimeTarget(request: TaskRequest, allowUnsupportedThirdPartyModel?: boolean): {
          accessMode: "auth" | "third-party";
          authAccountId: string | null;
          providerId: string | null;
          providerConfig: OpenAICompatibleProviderConfig | null;
          sessionStore: CodexThreadSessionStore;
        };
      }).resolveRuntimeTarget(createRequest({
        requestId: "req-auth-runtime-1",
        taskId: "task-auth-runtime-1",
      }));

      assert.equal(target.accessMode, "auth");
      assert.equal(target.authAccountId, "acct-1");
      assert.equal(target.sessionStore, records.calls[0]?.store);
      assert.equal(records.calls.length, 1);
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});

test("resetProviderRuntime 会在 reloadProviderConfig 后按新配置重建第三方 session store", () => {
  withClearedOpenAICompatEnv(() => {
    const workingDirectory = mkdtempSync(join(tmpdir(), "themis-runtime-provider-reload-"));
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });

    addOpenAICompatibleProvider(workingDirectory, {
      id: "gateway-a",
      name: "Gateway A",
      baseUrl: "https://gateway-a.example.com/v1",
      apiKey: "sk-test-a",
    }, registry);

    addOpenAICompatibleProviderModel(workingDirectory, {
      providerId: "gateway-a",
      model: "gpt-5.4",
      setAsDefault: true,
    }, registry);

    const records = createRecordingSessionStoreFactoryRecords();
    const runtime = new CodexTaskRuntime({
      workingDirectory,
      runtimeStore: registry,
      createSessionStore: records.createSessionStore,
    });

    try {
      const initialGatewayACalls = records.calls.filter((entry) => entry.sessionIdNamespace === "third-party:gateway-a");
      const initialGatewayAStore = initialGatewayACalls[0]?.store;

      assert.equal(initialGatewayACalls.length, 1);

      addOpenAICompatibleProvider(workingDirectory, {
        id: "gateway-b",
        name: "Gateway B",
        baseUrl: "https://gateway-b.example.com/v1",
        apiKey: "sk-test-b",
      }, registry);

      addOpenAICompatibleProviderModel(workingDirectory, {
        providerId: "gateway-b",
        model: "gpt-5.4",
        setAsDefault: true,
      }, registry);

      runtime.reloadProviderConfig();

      const gatewayACalls = records.calls.filter((entry) => entry.sessionIdNamespace === "third-party:gateway-a");
      const gatewayBCalls = records.calls.filter((entry) => entry.sessionIdNamespace === "third-party:gateway-b");

      assert.equal(gatewayACalls.length, 2);
      assert.equal(gatewayBCalls.length, 1);
      assert.notEqual(gatewayACalls[0]?.store, gatewayACalls[1]?.store);
      assert.equal(gatewayACalls[0]?.store, initialGatewayAStore);

      const target = (runtime as unknown as {
        resolveRuntimeTarget(request: TaskRequest, allowUnsupportedThirdPartyModel?: boolean): {
          accessMode: "auth" | "third-party";
          authAccountId: string | null;
          providerId: string | null;
          providerConfig: OpenAICompatibleProviderConfig | null;
          sessionStore: CodexThreadSessionStore;
        };
      }).resolveRuntimeTarget(createRequest({
        requestId: "req-third-party-runtime-reload",
        taskId: "task-third-party-runtime-reload",
        options: {
          accessMode: "third-party",
          thirdPartyProviderId: "gateway-b",
          model: "gpt-5.4",
        },
      }));

      assert.equal(target.providerId, "gateway-b");
      assert.equal(target.sessionStore, gatewayBCalls[0]?.store);
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});

test("resolveRuntimeTarget 首次命中后补建 auth session store，并在同账号下复用", () => {
  withClearedOpenAICompatEnv(() => {
    const workingDirectory = mkdtempSync(join(tmpdir(), "themis-runtime-auth-lazy-store-"));
    const registry = new SqliteCodexSessionRegistry({
      databaseFile: join(workingDirectory, "infra/local/themis.db"),
    });
    const records = createRecordingSessionStoreFactoryRecords();
    const runtime = new CodexTaskRuntime({
      workingDirectory,
      runtimeStore: registry,
      createSessionStore: records.createSessionStore,
    });

    try {
      const initialCallCount = records.calls.length;
      const defaultAuthCall = records.calls.slice(0, initialCallCount).find((entry) => entry.sessionIdNamespace?.startsWith("auth:"));

      assert.equal(records.calls.filter((entry) => entry.sessionIdNamespace === "auth:managed-2").length, 0);

      registry.saveAuthAccount({
        accountId: "managed-2",
        label: "账户二",
        accountEmail: "managed-2@example.com",
        codexHome: join(workingDirectory, "infra/local/codex-auth/managed-2"),
        isActive: false,
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z",
      });

      const runtimeAsTestDouble = runtime as unknown as {
        resolveRuntimeTarget(request: TaskRequest, allowUnsupportedThirdPartyModel?: boolean): {
          accessMode: "auth" | "third-party";
          authAccountId: string | null;
          providerId: string | null;
          providerConfig: OpenAICompatibleProviderConfig | null;
          sessionStore: CodexThreadSessionStore;
        };
      };

      const firstTarget = runtimeAsTestDouble.resolveRuntimeTarget(createRequest({
        requestId: "req-auth-lazy-1",
        taskId: "task-auth-lazy-1",
        options: {
          authAccountId: "managed-2",
        },
      }));
      const secondTarget = runtimeAsTestDouble.resolveRuntimeTarget(createRequest({
        requestId: "req-auth-lazy-2",
        taskId: "task-auth-lazy-2",
        options: {
          authAccountId: "managed-2",
        },
      }));

      const managed2Calls = records.calls.filter((entry) => entry.sessionIdNamespace === "auth:managed-2");

      assert.equal(managed2Calls.length, 1);
      assert.equal(records.calls.length, initialCallCount + 1);
      assert.equal(managed2Calls[0]?.sessionRegistry, registry);
      assert.ok(managed2Calls[0]?.codex);
      if (defaultAuthCall) {
        assert.notEqual(managed2Calls[0]?.codex, defaultAuthCall.codex);
      }
      assert.equal(firstTarget.authAccountId, "managed-2");
      assert.equal(secondTarget.authAccountId, "managed-2");
      assert.equal(firstTarget.sessionStore, managed2Calls[0]?.store);
      assert.equal(secondTarget.sessionStore, managed2Calls[0]?.store);
      assert.equal(records.calls.length, initialCallCount + 1);
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});

test("runTask 会优先使用会话绑定的工作区", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-session-workspace-"));
  const controlDirectory = join(root, "control");
  const sessionWorkspace = join(root, "session-workspace");
  mkdirSync(controlDirectory);
  mkdirSync(sessionWorkspace);
  mkdirSync(join(controlDirectory, "memory", "architecture"), { recursive: true });
  mkdirSync(join(sessionWorkspace, "memory", "architecture"), { recursive: true });
  writeRuntimeFile(controlDirectory, "AGENTS.md", "control-rule");
  writeRuntimeFile(controlDirectory, "README.md", "# control");
  writeRuntimeFile(controlDirectory, "memory/architecture/overview.md", "# control architecture");
  writeRuntimeFile(sessionWorkspace, "AGENTS.md", "session-rule");
  writeRuntimeFile(sessionWorkspace, "README.md", "# session");
  writeRuntimeFile(sessionWorkspace, "memory/architecture/overview.md", "# session architecture");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  runtimeStore.saveSessionTaskSettings({
    sessionId: "session-runtime-1",
    settings: {
      workspacePath: sessionWorkspace,
    },
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
  });

  const capturedThreadOptions: ThreadOptions[] = [];
  const capturedPrompts: string[] = [];
  const sessionStore = createSessionStoreDouble(runtimeStore, capturedThreadOptions, capturedPrompts);
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
  });

  try {
    await runtime.runTask(createRequest({
      requestId: "req-runtime-1",
      taskId: "task-runtime-1",
      user: {
        userId: "",
        displayName: "User",
      },
      channelContext: {
        sessionId: "session-runtime-1",
      },
    }));

    assert.equal(capturedThreadOptions.length, 1);
    assert.equal(capturedThreadOptions[0]?.workingDirectory, sessionWorkspace);
    assert.match(capturedPrompts[0] ?? "", /session-rule/);
    assert.doesNotMatch(capturedPrompts[0] ?? "", /control-rule/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runTask 会把 inputEnvelope 文档只保留为路径提示，不再拼正文", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-envelope-document-fallback-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory);
  writeRuntimeFile(controlDirectory, "README.md", "# control");

  const documentPath = join(root, "temp", "input-assets", "guide.md");
  mkdirSync(dirname(documentPath), { recursive: true });
  writeFileSync(documentPath, "# Guide\n\nThis is the document body.\n", "utf8");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const capturedThreadOptions: ThreadOptions[] = [];
  const capturedPrompts: string[] = [];
  const sessionStore = createSessionStoreDouble(runtimeStore, capturedThreadOptions, capturedPrompts);
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
  });

  try {
    await runtime.runTask(createRequest({
      requestId: "req-runtime-envelope-document-fallback",
      taskId: "task-runtime-envelope-document-fallback",
      goal: "帮我看文档",
      attachments: [
        {
          id: "doc-1",
          type: "file",
          name: "guide.md",
          value: documentPath,
        },
      ],
      inputEnvelope: {
        envelopeId: "env-runtime-document-fallback-1",
        sourceChannel: "web",
        parts: [
          { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
        ],
        assets: [
          {
            assetId: "asset-doc-1",
            kind: "document",
            mimeType: "text/markdown",
            localPath: documentPath,
            sourceChannel: "web",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-01T11:25:00.000Z",
      },
      channelContext: {
        sessionId: "session-runtime-envelope-document-fallback",
      },
    }));

    assert.equal(capturedPrompts.length, 1);
    assert.match(capturedPrompts[0] ?? "", /Attached document paths:/);
    assert.match(capturedPrompts[0] ?? "", /assetId: asset-doc-1/);
    assert.match(capturedPrompts[0] ?? "", /guide\.md/);
    assert.doesNotMatch(capturedPrompts[0] ?? "", /Document text fallback:/);
    assert.doesNotMatch(capturedPrompts[0] ?? "", /This is the document body\./);
    assert.doesNotMatch(capturedPrompts[0] ?? "", /Attachments:/);
    const storedInput = runtimeStore.getTurnInput("req-runtime-envelope-document-fallback");
    assert.equal(storedInput?.envelope.assets[0]?.assetId, "asset-doc-1");
    assert.equal(storedInput?.compileSummary?.runtimeTarget, "codex-sdk");
    assert.equal(storedInput?.compileSummary?.degradationLevel, "controlled_fallback");
    assert.equal(storedInput?.compileSummary?.warnings.length ?? -1, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runTask 会把 inputEnvelope 里的额外纯文本 parts 编译进 sdk prompt fallback sections", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-envelope-text-fallback-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory);
  writeRuntimeFile(controlDirectory, "README.md", "# control");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const capturedThreadOptions: ThreadOptions[] = [];
  const capturedPrompts: string[] = [];
  const sessionStore = createSessionStoreDouble(runtimeStore, capturedThreadOptions, capturedPrompts);
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
  });

  try {
    await runtime.runTask(createRequest({
      requestId: "req-runtime-envelope-text-fallback",
      taskId: "task-runtime-envelope-text-fallback",
      goal: "请结合这些分段上下文回答",
      inputEnvelope: {
        envelopeId: "env-runtime-text-fallback-1",
        sourceChannel: "web",
        parts: [
          { partId: "part-1", type: "text", role: "user", order: 1, text: "第一段上下文：系统已经切到新会话。" },
          { partId: "part-2", type: "text", role: "user", order: 2, text: "第二段上下文：请保持同一线程继续处理。" },
        ],
        assets: [],
        createdAt: "2026-04-02T10:00:00.000Z",
      },
      channelContext: {
        sessionId: "session-runtime-envelope-text-fallback",
      },
    }));

    assert.equal(capturedPrompts.length, 1);
    assert.match(capturedPrompts[0] ?? "", /Additional envelope text parts:/);
    assert.match(capturedPrompts[0] ?? "", /第一段上下文：系统已经切到新会话。/);
    assert.match(capturedPrompts[0] ?? "", /第二段上下文：请保持同一线程继续处理。/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runTask 在会话工作区失效时会报错", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-session-workspace-invalid-"));
  const controlDirectory = join(root, "control");
  const sessionWorkspace = join(root, "session-workspace");
  mkdirSync(controlDirectory);
  mkdirSync(sessionWorkspace);

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  runtimeStore.saveSessionTaskSettings({
    sessionId: "session-runtime-2",
    settings: {
      workspacePath: sessionWorkspace,
    },
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
  });

  rmSync(sessionWorkspace, { recursive: true, force: true });

  const capturedThreadOptions: ThreadOptions[] = [];
  const sessionStore = createSessionStoreDouble(runtimeStore, capturedThreadOptions);
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
  });

  try {
    await assert.rejects(async () => runtime.runTask(createRequest({
      requestId: "req-runtime-2",
      taskId: "task-runtime-2",
      user: {
        userId: "",
        displayName: "User",
      },
      channelContext: {
        sessionId: "session-runtime-2",
      },
    })), /当前会话绑定的工作区不可用，请新建会话后重新设置。/);

    assert.equal(capturedThreadOptions.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runTask 会在 task.started 前发出单次 task.context_built，并把结构化上下文注入 prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-context-builder-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory);
  mkdirSync(join(controlDirectory, "memory", "architecture"), { recursive: true });
  writeRuntimeFile(controlDirectory, "AGENTS.md", "始终使用中文回复。");
  writeRuntimeFile(controlDirectory, "README.md", "# Demo\n\n```ts\nconst provider = true;\n```");
  writeRuntimeFile(controlDirectory, "memory/architecture/overview.md", "# 架构");
  mkdirSync(join(controlDirectory, "docs", "memory", "2026", "03"), { recursive: true });
  writeRuntimeFile(controlDirectory, "docs/memory/2026/03/provider-search.md", "# Provider Search\n\nsearch tool 约束");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const capturedThreadOptions: ThreadOptions[] = [];
  const capturedPrompts: string[] = [];
  const lifecycleMarkers: string[] = [];
  const sessionStore = createSessionStoreDouble(runtimeStore, capturedThreadOptions, capturedPrompts, lifecycleMarkers);
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
  });

  try {
    const events: TaskEvent[] = [];
    await runtime.runTask(createRequest({
      requestId: "req-runtime-context-1",
      taskId: "task-runtime-context-1",
      goal: "请检查 provider search 支持",
      user: {
        userId: "",
        displayName: "User",
      },
      channelContext: {
        sessionId: "session-runtime-context-1",
      },
    }), {
      onEvent: (event) => {
        if (event.type === "task.context_built") {
          lifecycleMarkers.push("context_built_event");
        }
        events.push(event);
      },
    });

    const contextBuiltEvents = events.filter((event) => event.type === "task.context_built");
    assert.equal(contextBuiltEvents.length, 1);
    assert.equal(contextBuiltEvents[0]?.payload?.blockCount, 4);
    assert.equal(typeof contextBuiltEvents[0]?.payload?.warningCount, "number");
    assert.ok(Array.isArray(contextBuiltEvents[0]?.payload?.sourceStats));

    const contextBuiltIndex = events.findIndex((event) => event.type === "task.context_built");
    const startedIndex = events.findIndex((event) => event.type === "task.started");
    assert.ok(contextBuiltIndex >= 0);
    assert.ok(startedIndex >= 0);
    assert.equal(contextBuiltIndex < startedIndex, true);
    assert.equal(lifecycleMarkers.indexOf("context_built_event") < lifecycleMarkers.indexOf("acquire_called"), true);

    assert.equal(capturedPrompts.length, 1);
    assert.match(capturedPrompts[0] ?? "", /Task context blocks:/);
    assert.match(capturedPrompts[0] ?? "", /kind: repoRules/);
    assert.match(capturedPrompts[0] ?? "", /source: AGENTS\.md/);
    assert.match(capturedPrompts[0] ?? "", /title: Repository rules/);
    assert.match(capturedPrompts[0] ?? "", /\| ```ts/);
    assert.match(capturedPrompts[0] ?? "", /Response guidance:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runTask 在 context build 阶段收到 abort 会尽快取消且不进入 acquire", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-context-abort-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory);
  writeRuntimeFile(controlDirectory, "README.md", "# control");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  let acquireCalled = false;
  const sessionStore: CodexThreadSessionStore = {
    getSessionRegistry: () => runtimeStore,
    resolveThreadId: async () => null,
    acquire: async () => {
      acquireCalled = true;
      throw new Error("acquire should not be called");
    },
  } as unknown as CodexThreadSessionStore;

  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
    createContextBuilder: () => ({
      build: async (input: { signal?: AbortSignal }): Promise<ContextBuildResult> => {
        while (!input.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }

        const abortError = new Error("aborted during context build");
        abortError.name = "AbortError";
        throw abortError;
      },
    }) as never,
  });

  const abortController = new AbortController();
  setTimeout(() => {
    abortController.abort(new Error("manual abort"));
  }, 10);

  try {
    const result = await runtime.runTask(createRequest({
      requestId: "req-runtime-context-abort",
      taskId: "task-runtime-context-abort",
      user: {
        userId: "",
        displayName: "User",
      },
      channelContext: {
        sessionId: "session-runtime-context-abort",
      },
    }), {
      signal: abortController.signal,
    });

    assert.equal(result.status, "cancelled");
    assert.equal(acquireCalled, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runTask 成功时会写 memory updates、发 task.memory_updated，并落到 execution workspace", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-memory-success-"));
  const controlDirectory = join(root, "control");
  const sessionWorkspace = join(root, "session-workspace");
  mkdirSync(controlDirectory);
  mkdirSync(sessionWorkspace);
  mkdirSync(join(controlDirectory, "memory", "architecture"), { recursive: true });
  mkdirSync(join(sessionWorkspace, "memory", "architecture"), { recursive: true });
  writeRuntimeFile(controlDirectory, "AGENTS.md", "control-rule");
  writeRuntimeFile(controlDirectory, "README.md", "# control");
  writeRuntimeFile(controlDirectory, "memory/architecture/overview.md", "# control architecture");
  writeRuntimeFile(sessionWorkspace, "AGENTS.md", "session-rule");
  writeRuntimeFile(sessionWorkspace, "README.md", "# session");
  writeRuntimeFile(sessionWorkspace, "memory/architecture/overview.md", "# session architecture");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  runtimeStore.saveSessionTaskSettings({
    sessionId: "session-runtime-memory-1",
    settings: {
      workspacePath: sessionWorkspace,
    },
    createdAt: "2026-03-28T00:00:00.000Z",
    updatedAt: "2026-03-28T00:00:00.000Z",
  });

  const capturedThreadOptions: ThreadOptions[] = [];
  const sessionStore = createSessionStoreDouble(runtimeStore, capturedThreadOptions);
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
  });

  try {
    const events: TaskEvent[] = [];
    const result = await runtime.runTask(createRequest({
      requestId: "req-runtime-memory-1",
      taskId: "task-runtime-memory-1",
      goal: "实现 memory runtime 集成",
      user: {
        userId: "",
        displayName: "User",
      },
      channelContext: {
        sessionId: "session-runtime-memory-1",
      },
    }), {
      onEvent: (event) => {
        events.push(event);
      },
    });

    assert.equal(result.status, "completed");
    assert.ok((result.memoryUpdates?.length ?? 0) > 0);
    const memoryEvents = events.filter((event) => event.type === "task.memory_updated");
    assert.ok(memoryEvents.length >= 2);
    assert.ok(memoryEvents.some((event) => event.status === "running"));
    assert.ok(memoryEvents.some((event) => event.status === "completed"));
    assert.ok(memoryEvents.some((event) => Array.isArray(event.payload?.updates)));

    const sessionDone = writeFileSyncAndRead(sessionWorkspace, "memory/tasks/done.md");
    assert.match(sessionDone, /task-runtime-memory-1/);
    assert.match(sessionDone, /实现 memory runtime 集成|done/);
    const controlDone = writeFileSyncAndRead(controlDirectory, "memory/tasks/done.md", true);
    assert.equal(controlDone.includes("task-runtime-memory-1"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("memory 写回失败时任务仍 completed，并发 task.memory_updated failed 事件", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-memory-failed-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory);
  mkdirSync(join(controlDirectory, "memory", "architecture"), { recursive: true });
  writeRuntimeFile(controlDirectory, "AGENTS.md", "rule");
  writeRuntimeFile(controlDirectory, "README.md", "# control");
  writeRuntimeFile(controlDirectory, "memory/architecture/overview.md", "# architecture");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const capturedThreadOptions: ThreadOptions[] = [];
  const sessionStore = createSessionStoreDouble(runtimeStore, capturedThreadOptions);
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore,
    createMemoryService: () => ({
      recordTaskStart: () => [],
      recordTaskCompletion: () => {
        throw new Error("memory completion failed");
      },
    }) as never,
  });

  try {
    const events: TaskEvent[] = [];
    const result = await runtime.runTask(createRequest({
      requestId: "req-runtime-memory-failed",
      taskId: "task-runtime-memory-failed",
      user: {
        userId: "",
        displayName: "User",
      },
      channelContext: {
        sessionId: "session-runtime-memory-failed",
      },
    }), {
      onEvent: (event) => {
        events.push(event);
      },
    });

    assert.equal(result.status, "completed");
    const failedEvent = events.find(
      (event) => event.type === "task.memory_updated" && event.status === "failed",
    );
    assert.ok(failedEvent);
    assert.equal(failedEvent?.payload?.errorCode, "MEMORY_UPDATE_FAILED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("start 已写回后任务普通失败，不会残留 running active 与 in-progress", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-memory-terminal-failed-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory);
  mkdirSync(join(controlDirectory, "memory", "architecture"), { recursive: true });
  writeRuntimeFile(controlDirectory, "AGENTS.md", "rule");
  writeRuntimeFile(controlDirectory, "README.md", "# control");
  writeRuntimeFile(controlDirectory, "memory/architecture/overview.md", "# architecture");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore: createFailingSessionStoreDouble(runtimeStore),
  });

  try {
    await assert.rejects(
      async () => runtime.runTask(createRequest({
        requestId: "req-runtime-memory-terminal-failed",
        taskId: "task-runtime-memory-terminal-failed",
        goal: "故意失败任务",
        channelContext: {
          sessionId: "session-runtime-memory-terminal-failed",
        },
      })),
      /模拟失败/,
    );

    const active = writeFileSyncAndRead(controlDirectory, "memory/sessions/active.md");
    const inProgress = writeFileSyncAndRead(controlDirectory, "memory/tasks/in-progress.md", true);
    assert.match(active, /状态：failed/);
    assert.doesNotMatch(active, /状态：running/);
    assert.doesNotMatch(inProgress, /task-runtime-memory-terminal-failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("主任务收口前失败不会提前写入 completed memory", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-memory-no-early-completion-"));
  const controlDirectory = join(root, "control");
  mkdirSync(controlDirectory);
  mkdirSync(join(controlDirectory, "memory", "architecture"), { recursive: true });
  writeRuntimeFile(controlDirectory, "AGENTS.md", "rule");
  writeRuntimeFile(controlDirectory, "README.md", "# control");
  writeRuntimeFile(controlDirectory, "memory/architecture/overview.md", "# architecture");

  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: controlDirectory,
    runtimeStore,
    sessionStore: createSessionStoreDouble(runtimeStore, []),
  });

  try {
    await assert.rejects(
      async () => runtime.runTask(createRequest({
        requestId: "req-runtime-memory-no-early-completion",
        taskId: "task-runtime-memory-no-early-completion",
        goal: "测试收口失败",
        user: {
          userId: "",
          displayName: "User",
        },
        channelContext: {
          sessionId: "session-runtime-memory-no-early-completion",
        },
      }), {
        onEvent: (event) => {
          if (event.type === "task.completed") {
            throw new Error("force completion hook failure");
          }
        },
      }),
      /force completion hook failure/,
    );

    const done = writeFileSyncAndRead(controlDirectory, "memory/tasks/done.md", true);
    const active = writeFileSyncAndRead(controlDirectory, "memory/sessions/active.md");
    assert.doesNotMatch(done, /task-runtime-memory-no-early-completion/);
    assert.doesNotMatch(active, /状态：completed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createSessionStoreDouble(
  runtimeStore: SqliteCodexSessionRegistry,
  capturedThreadOptions: ThreadOptions[],
  capturedPrompts: string[] = [],
  lifecycleMarkers: string[] = [],
): CodexThreadSessionStore {
  return {
    getSessionRegistry: () => runtimeStore,
    resolveThreadId: async () => null,
    acquire: async (_request: TaskRequest, threadOptions: ThreadOptions) => {
      lifecycleMarkers.push("acquire_called");
      capturedThreadOptions.push(threadOptions);

      return {
        sessionId: _request.channelContext.sessionId,
        threadId: "thread-1",
        sessionMode: "created",
        thread: {
          id: "thread-1",
          runStreamed: async (prompt: string) => {
            capturedPrompts.push(prompt);
            return {
              events: (async function* () {
                yield { type: "thread.started", thread_id: "thread-1" };
                yield { type: "turn.started" };
                yield {
                  type: "item.completed",
                  item: {
                    type: "agent_message",
                    id: "item-1",
                    text: "done",
                  },
                };
                yield { type: "turn.completed", usage: {} };
              })(),
            };
          },
        } as never,
        release: async () => {},
      };
    },
  } as unknown as CodexThreadSessionStore;
}

function createFailingSessionStoreDouble(runtimeStore: SqliteCodexSessionRegistry): CodexThreadSessionStore {
  return {
    getSessionRegistry: () => runtimeStore,
    resolveThreadId: async () => null,
    acquire: async (_request: TaskRequest) => ({
      sessionId: _request.channelContext.sessionId,
      threadId: "thread-failed",
      sessionMode: "created",
      thread: {
        id: "thread-failed",
        runStreamed: async () => ({
          events: (async function* () {
            yield { type: "thread.started", thread_id: "thread-failed" };
            yield { type: "turn.started" };
            yield { type: "turn.failed", error: { message: "模拟失败" } };
          })(),
        }),
      } as never,
      release: async () => {},
    }),
  } as unknown as CodexThreadSessionStore;
}

function createRecordingSessionStoreFactoryRecords(): {
  calls: Array<{
    sessionIdNamespace: string | undefined;
    sessionRegistry: SqliteCodexSessionRegistry | undefined;
    codex: unknown;
    store: CodexThreadSessionStore;
  }>;
  createSessionStore: (options: {
    sessionRegistry?: SqliteCodexSessionRegistry;
    codex?: unknown;
    sessionIdNamespace?: string;
  }) => CodexThreadSessionStore;
} {
  const calls: Array<{
    sessionIdNamespace: string | undefined;
    sessionRegistry: SqliteCodexSessionRegistry | undefined;
    codex: unknown;
    store: CodexThreadSessionStore;
  }> = [];

  return {
    calls,
    createSessionStore: (options) => {
      const store = {
        getSessionRegistry: () => options.sessionRegistry ?? null,
        resolveThreadId: async () => null,
        acquire: async () => {
          throw new Error("acquire should not be called in this test");
        },
      } as unknown as CodexThreadSessionStore;

      calls.push({
        sessionIdNamespace: options.sessionIdNamespace,
        sessionRegistry: options.sessionRegistry,
        codex: options.codex,
        store,
      });

      return store;
    },
  };
}

function writeRuntimeFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${content}\n`, "utf8");
}

function writeFileSyncAndRead(root: string, path: string, allowMissing = false): string {
  const absolutePath = join(root, path);
  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    if (allowMissing) {
      return "";
    }
    throw error;
  }
}
