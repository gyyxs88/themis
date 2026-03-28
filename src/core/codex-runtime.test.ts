import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ThreadOptions } from "@openai/codex-sdk";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskEvent, TaskRequest } from "../types/index.js";
import { CodexTaskRuntime } from "./codex-runtime.js";
import type { CodexThreadSessionStore } from "./codex-session-store.js";
import type { OpenAICompatibleProviderConfig } from "./openai-compatible-provider.js";
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

function writeRuntimeFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${content}\n`, "utf8");
}
