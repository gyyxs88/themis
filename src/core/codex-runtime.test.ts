import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/index.js";
import { CodexTaskRuntime } from "./codex-runtime.js";
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
