import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodexRuntimeCatalog } from "../../core/codex-app-server.js";
import type { CodexTaskRuntime } from "../../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../../storage/index.js";
import { FeishuChannelService } from "./service.js";
import { FeishuSessionStore } from "./session-store.js";

test("帮助文本不再展示 default 选项", async () => {
  const harness = createHarness();

  try {
    await harness.sendHelp();

    assert.equal(harness.messages.length, 1);
    const message = harness.messages[0];
    assert.ok(message);
    assert.match(message, /\/sandbox <read-only\|workspace-write\|danger-full-access>/);
    assert.match(message, /\/search <disabled\|cached\|live>/);
    assert.match(message, /\/network <on\|off>/);
    assert.match(message, /\/approval <never\|on-request\|on-failure\|untrusted>/);
    assert.doesNotMatch(message, /<default\|/);
  } finally {
    harness.cleanup();
  }
});

test("default 参数会被视为非法输入", async () => {
  const harness = createHarness();

  try {
    const expectations = [
      {
        name: "sandbox",
        usage: "用法：/sandbox <read-only|workspace-write|danger-full-access>",
      },
      {
        name: "search",
        usage: "用法：/search <disabled|cached|live>",
      },
      {
        name: "network",
        usage: "用法：/network <on|off>",
      },
      {
        name: "approval",
        usage: "用法：/approval <never|on-request|on-failure|untrusted>",
      },
    ] as const;

    for (const expectation of expectations) {
      harness.messages.length = 0;

      await harness.handleCommand(expectation.name, ["default"]);

      assert.deepEqual(harness.messages, [expectation.usage]);
    }
  } finally {
    harness.cleanup();
  }
});

test("/settings 只展示当前生效值，不展示 default 占位", async () => {
  const harness = createHarness();

  try {
    harness.activateSession("session-1");
    harness.saveSessionSettings("session-1", {
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
    });

    await harness.sendSettings();

    assert.equal(harness.messages.length, 1);
    const message = harness.messages[0];
    assert.ok(message);
    assert.match(message, /接入方式：auth/);
    assert.match(message, /模型：gpt-5.4/);
    assert.match(message, /推理强度：medium/);
    assert.match(message, /审批策略：never/);
    assert.match(message, /沙箱模式：workspace-write/);
    assert.match(message, /联网搜索：live/);
    assert.match(message, /网络访问：开启/);
    assert.doesNotMatch(message, /：默认/);
    assert.doesNotMatch(message, /当前没有单独配置/);
  } finally {
    harness.cleanup();
  }
});

test("/settings 会展示 Themis 全局默认配置", async () => {
  const harness = createHarness(createImplicitDefaultsRuntimeCatalog());

  try {
    harness.activateSession("session-2");

    await harness.sendSettings();

    assert.equal(harness.messages.length, 1);
    const message = harness.messages[0];
    assert.ok(message);
    assert.match(message, /当前可确认配置：/);
    assert.match(message, /模型：gpt-5.4/);
    assert.match(message, /审批策略：never/);
    assert.match(message, /沙箱模式：workspace-write/);
    assert.match(message, /联网搜索：live/);
    assert.match(message, /网络访问：开启/);
  } finally {
    harness.cleanup();
  }
});

test("任务 payload 会显式带上 Themis 全局默认配置", () => {
  const harness = createHarness(createImplicitDefaultsRuntimeCatalog());

  try {
    harness.activateSession("session-3");

    const payload = harness.createTaskPayload("session-3", "hello");
    assert.deepEqual(payload.options, {
      sandboxMode: "workspace-write",
      webSearchMode: "live",
      networkAccessEnabled: true,
      approvalPolicy: "never",
    });
  } finally {
    harness.cleanup();
  }
});

function createHarness(runtimeCatalog = createRuntimeCatalog()) {
  const workingDirectory = mkdtempSync(join(tmpdir(), "themis-feishu-service-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(workingDirectory, "infra/local/themis.db"),
  });
  const sessionStore = new FeishuSessionStore({
    filePath: join(workingDirectory, "infra/local/feishu-sessions.json"),
  });
  const runtime = {
    getRuntimeStore: () => runtimeStore,
    readRuntimeConfig: async (): Promise<CodexRuntimeCatalog> => runtimeCatalog,
  } as unknown as CodexTaskRuntime;
  const service = new FeishuChannelService({
    runtime,
    authRuntime: {
      listAccounts: () => [],
      getActiveAccount: () => null,
    } as never,
    taskTimeoutMs: 5_000,
    sessionStore,
    logger: createLogger(),
  });
  const messages: string[] = [];

  (service as unknown as { safeSendText: (chatId: string, text: string) => Promise<void> }).safeSendText = async (
    _chatId,
    text,
  ) => {
    messages.push(text);
  };

  const context = {
    chatId: "chat-1",
    messageId: "message-1",
    userId: "user-1",
    text: "",
  };

  return {
    messages,
    activateSession(sessionId: string) {
      sessionStore.setActiveSessionId({ chatId: context.chatId, userId: context.userId }, sessionId);
    },
    saveSessionSettings(sessionId: string, settings: Record<string, unknown>) {
      runtimeStore.saveSessionTaskSettings({
        sessionId,
        settings,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
    async handleCommand(name: string, args: string[]) {
      await (service as unknown as {
        handleCommand(command: { name: string; args: string[]; raw: string }, incomingContext: typeof context): Promise<void>;
      }).handleCommand({ name, args, raw: `/${name} ${args.join(" ")}`.trim() }, context);
    },
    async sendHelp() {
      await (service as unknown as {
        sendHelp(chatId: string, incomingContext: typeof context): Promise<void>;
      }).sendHelp(context.chatId, context);
    },
    async sendSettings() {
      await (service as unknown as {
        sendSessionSettings(chatId: string, incomingContext: typeof context): Promise<void>;
      }).sendSessionSettings(context.chatId, context);
    },
    createTaskPayload(sessionId: string, text: string) {
      return (service as unknown as {
        createTaskPayload(incomingContext: typeof context, currentSessionId: string): { options?: Record<string, unknown> };
      }).createTaskPayload({ ...context, text }, sessionId);
    },
    cleanup() {
      rmSync(workingDirectory, { recursive: true, force: true });
    },
  };
}

function createRuntimeCatalog(): CodexRuntimeCatalog {
  return {
    models: [createRuntimeModel("gpt-5.4", "medium", true)],
    defaults: {
      profile: null,
      model: "gpt-5.4",
      reasoning: "medium",
      approvalPolicy: null,
      sandboxMode: null,
      webSearchMode: null,
      networkAccessEnabled: null,
    },
    provider: {
      type: "codex-default",
      name: "Codex CLI",
      baseUrl: null,
      model: "gpt-5.4",
      lockedModel: false,
    },
    accessModes: [
      {
        id: "auth",
        label: "auth",
        description: "auth",
      },
    ],
    thirdPartyProviders: [],
    personas: [],
  };
}

function createImplicitDefaultsRuntimeCatalog(): CodexRuntimeCatalog {
  return {
    models: [createRuntimeModel("gpt-5.4", "high", true)],
    defaults: {
      profile: null,
      model: "gpt-5.4",
      reasoning: "high",
      approvalPolicy: null,
      sandboxMode: null,
      webSearchMode: null,
      networkAccessEnabled: null,
    },
    provider: {
      type: "codex-default",
      name: "Codex CLI",
      baseUrl: null,
      model: "gpt-5.4",
      lockedModel: false,
    },
    accessModes: [
      {
        id: "auth",
        label: "auth",
        description: "auth",
      },
    ],
    thirdPartyProviders: [],
    personas: [],
  };
}

function createRuntimeModel(model: string, defaultReasoningEffort: string, isDefault: boolean) {
  return {
    id: model,
    model,
    displayName: model,
    description: model,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "low" },
      { reasoningEffort: "medium", description: "medium" },
      { reasoningEffort: "high", description: "high" },
      { reasoningEffort: "xhigh", description: "xhigh" },
    ],
    defaultReasoningEffort,
    contextWindow: 200_000,
    capabilities: {
      textInput: true,
      imageInput: false,
      supportsCodexTasks: true,
      supportsReasoningSummaries: false,
      supportsVerbosity: false,
      supportsParallelToolCalls: false,
      supportsSearchTool: true,
      supportsImageDetailOriginal: false,
    },
    supportsPersonality: true,
    supportsCodexTasks: true,
    isDefault,
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}
