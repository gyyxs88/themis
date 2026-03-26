import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ThreadOptions } from "@openai/codex-sdk";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/index.js";
import { CodexTaskRuntime } from "./codex-runtime.js";
import type { CodexThreadSessionStore } from "./codex-session-store.js";
import type { OpenAICompatibleProviderConfig } from "./openai-compatible-provider.js";

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
  const sessionStore = createSessionStoreDouble(runtimeStore, capturedThreadOptions);
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

function createSessionStoreDouble(
  runtimeStore: SqliteCodexSessionRegistry,
  capturedThreadOptions: ThreadOptions[],
): CodexThreadSessionStore {
  return {
    getSessionRegistry: () => runtimeStore,
    resolveThreadId: async () => null,
    acquire: async (_request: TaskRequest, threadOptions: ThreadOptions) => {
      capturedThreadOptions.push(threadOptions);

      return {
        sessionId: _request.channelContext.sessionId,
        threadId: "thread-1",
        sessionMode: "created",
        thread: {
          id: "thread-1",
          runStreamed: async () => ({
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
          }),
        } as never,
        release: async () => {},
      };
    },
  } as unknown as CodexThreadSessionStore;
}
