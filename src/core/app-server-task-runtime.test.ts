import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TaskEvent } from "../types/index.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { AppServerActionBridge } from "./app-server-action-bridge.js";
import type {
  AppServerThreadStartParams,
  CodexRuntimeCatalog,
} from "./codex-app-server.js";
import type {
  AppServerSessionFactoryOptions,
  AppServerTaskRuntimeOptions,
  AppServerTaskRuntimeSession,
} from "./app-server-task-runtime.js";
import {
  APP_SERVER_TASK_CONFIG_OVERRIDES,
  AppServerTaskRuntime,
} from "./app-server-task-runtime.js";
import { addOpenAICompatibleProvider } from "./openai-compatible-provider.js";

interface SessionDoubleState {
  initialized: number;
  factoryCalls: number;
  started: AppServerThreadStartParams[];
  resumed: Array<{ threadId: string; params: AppServerThreadStartParams }>;
  turns: Array<{
    threadId: string;
    prompt: string | null;
    input: string | Array<{
      type: "text" | "localImage";
      text?: string;
      text_elements?: [];
      path?: string;
    }>;
  }>;
  reviews: Array<{ threadId: string; instructions: string }>;
  steers: Array<{ threadId: string; turnId: string; message: string }>;
  readThreads: Array<{ threadId: string; includeTurns: boolean }>;
  closed: number;
  notificationHandler: ((notification: { method: string; params?: unknown }) => void) | null;
  serverRequestHandler: ((request: { id: string | number; method: string; params?: unknown }) => void) | null;
  respondedServerRequests: Array<{ id: string | number; result: unknown }>;
  rejectedServerRequests: Array<{ id: string | number; message: string }>;
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

function createRuntimeFixture(overrides: {
  sessionFactory?: AppServerTaskRuntimeOptions["sessionFactory"];
  runtimeCatalogReader?: AppServerTaskRuntimeOptions["runtimeCatalogReader"];
  createContextBuilder?: AppServerTaskRuntimeOptions["createContextBuilder"];
  createMemoryService?: AppServerTaskRuntimeOptions["createMemoryService"];
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "themis-app-server-runtime-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
    ...(overrides.sessionFactory ? { sessionFactory: overrides.sessionFactory } : {}),
    ...(overrides.runtimeCatalogReader ? { runtimeCatalogReader: overrides.runtimeCatalogReader } : {}),
    ...(overrides.createContextBuilder ? { createContextBuilder: overrides.createContextBuilder } : {}),
    ...(overrides.createMemoryService ? { createMemoryService: overrides.createMemoryService } : {}),
  });

  return {
    root,
    runtimeStore,
    runtime,
    cleanup(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function seedCompletedPrincipalPersona(
  runtime: AppServerTaskRuntime,
  input: {
    channel: string;
    channelUserId: string;
    displayName?: string;
  },
): string {
  const now = "2026-04-09T00:00:00.000Z";
  const identity = runtime.getIdentityLinkService().ensureIdentity({
    channel: input.channel,
    channelUserId: input.channelUserId,
    ...(input.displayName ? { displayName: input.displayName } : {}),
  });

  runtime.getRuntimeStore().savePrincipalPersonaProfile({
    principalId: identity.principalId,
    profile: {
      preferredAddress: input.displayName ?? input.channelUserId,
      workSummary: "在做长期协作开发。",
      collaborationStyle: "先给结论，再补关键细节。",
      assistantLanguageStyle: "直接、清楚、不过度客套。",
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  });

  return identity.principalId;
}

function createSessionFactory(overrides: {
  startThreadId?: string;
  startThread?: (
    params: AppServerThreadStartParams,
    state: SessionDoubleState,
  ) => Promise<{ threadId: string }>;
  resumeThreadId?: string;
  readThread?: (
    threadId: string,
    options: { includeTurns?: boolean } | undefined,
    state: SessionDoubleState,
  ) => Promise<{
    threadId: string;
    turnCount: number;
    turns: Array<{ turnId: string; status?: string }>;
  }>;
  startReview?: (threadId: string, instructions: string, state: SessionDoubleState) => Promise<{
    reviewThreadId: string;
    turnId: string;
  }>;
  steerTurn?: (threadId: string, turnId: string, message: string, state: SessionDoubleState) => Promise<{
    turnId: string;
  }>;
  startTurn?: (state: SessionDoubleState) => Promise<{ turnId: string }>;
  close?: (state: SessionDoubleState) => Promise<void>;
} = {}): {
  state: SessionDoubleState;
  sessionFactory: AppServerTaskRuntimeOptions["sessionFactory"];
} {
  const state: SessionDoubleState = {
    initialized: 0,
    factoryCalls: 0,
    started: [],
    resumed: [],
    turns: [],
    reviews: [],
    steers: [],
    readThreads: [],
    closed: 0,
    notificationHandler: null,
    serverRequestHandler: null,
    respondedServerRequests: [],
    rejectedServerRequests: [],
  };

  return {
    state,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => {
      state.factoryCalls += 1;

      return {
      initialize: async () => {
        state.initialized += 1;
      },
      startThread: async (params) => {
        state.started.push({ ...params });
        if (overrides.startThread) {
          return await overrides.startThread(params, state);
        }
        return { threadId: overrides.startThreadId ?? "thread-app-start" };
      },
      resumeThread: async (threadId, params) => {
        state.resumed.push({ threadId, params: { ...params } });
        return { threadId: overrides.resumeThreadId ?? threadId };
      },
      startReview: async (threadId, instructions) => {
        state.reviews.push({ threadId, instructions });
        if (overrides.startReview) {
          return await overrides.startReview(threadId, instructions, state);
        }
        return {
          reviewThreadId: `${threadId}-review`,
          turnId: "turn-app-review-1",
        };
      },
      steerTurn: async (threadId, turnId, message) => {
        state.steers.push({ threadId, turnId, message });
        if (overrides.steerTurn) {
          return await overrides.steerTurn(threadId, turnId, message, state);
        }
        return { turnId };
      },
      readThread: async (threadId, options) => {
        state.readThreads.push({ threadId, includeTurns: options?.includeTurns === true });
        if (overrides.readThread) {
          return await overrides.readThread(threadId, options, state);
        }
        return {
          threadId,
          turnCount: 1,
          turns: [{ turnId: "turn-app-active-1", status: "running" }],
        };
      },
      startTurn: async (threadId, prompt) => {
        state.turns.push({
          threadId,
          prompt: typeof prompt === "string" ? prompt : null,
          input: prompt,
        });
        if (overrides.startTurn) {
          return await overrides.startTurn(state);
        }
        const started = { turnId: "turn-app-1" };
        scheduleCompletedTurn(state, started.turnId);
        return started;
      },
      close: async () => {
        state.closed += 1;
        await overrides.close?.(state);
      },
      onNotification: (handler) => {
        state.notificationHandler = handler;
      },
      onServerRequest: (handler) => {
        state.serverRequestHandler = handler;
      },
      respondToServerRequest: async (id, result) => {
        state.respondedServerRequests.push({ id, result });
      },
      rejectServerRequest: async (id, error) => {
        state.rejectedServerRequests.push({
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      },
      };
    },
  };
}

function createRuntimeCatalog(overrides: {
  model?: string;
  defaultsModel?: string;
  capabilities?: Partial<CodexRuntimeCatalog["models"][number]["capabilities"]>;
} = {}): CodexRuntimeCatalog {
  const model = overrides.model ?? "gpt-5.4";
  const capabilities = {
    textInput: true,
    imageInput: true,
    nativeTextInput: true,
    nativeImageInput: true,
    nativeDocumentInput: false,
    supportedDocumentMimeTypes: [],
    supportsPdfTextExtraction: true,
    supportsDocumentPageRasterization: false,
    supportsCodexTasks: true,
    supportsReasoningSummaries: false,
    supportsVerbosity: false,
    supportsParallelToolCalls: false,
    supportsSearchTool: false,
    supportsImageDetailOriginal: false,
    ...(overrides.capabilities ?? {}),
  };

  return {
    models: [{
      id: model,
      model,
      displayName: model,
      description: "",
      hidden: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "medium",
      contextWindow: null,
      capabilities,
      supportsPersonality: false,
      supportsCodexTasks: capabilities.supportsCodexTasks,
      isDefault: true,
    }],
    defaults: {
      profile: null,
      model: overrides.defaultsModel ?? model,
      reasoning: null,
      approvalPolicy: null,
      sandboxMode: null,
      webSearchMode: null,
      networkAccessEnabled: null,
    },
    provider: {
      type: "codex-default",
      name: "Codex CLI",
      baseUrl: null,
      model: overrides.defaultsModel ?? model,
      lockedModel: false,
    },
    accessModes: [{
      id: "auth",
      label: "认证",
      description: "通过 Codex / ChatGPT 认证运行任务。",
    }],
    thirdPartyProviders: [],
    personas: [],
  };
}

function readSessionPayload(result: Awaited<ReturnType<AppServerTaskRuntime["runTask"]>>): {
  sessionId: string | null;
  conversationId?: string | null;
  threadId: string;
  engine: string;
  mode?: string;
  accessMode?: string;
  authAccountId?: string;
  thirdPartyProviderId?: string;
  assistantStyle?: Record<string, string>;
} {
  return result.structuredOutput?.session as {
    sessionId: string | null;
    conversationId?: string | null;
    threadId: string;
    engine: string;
    mode?: string;
    accessMode?: string;
    authAccountId?: string;
    thirdPartyProviderId?: string;
    assistantStyle?: Record<string, string>;
  };
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function scheduleCompletedTurn(
  state: SessionDoubleState,
  turnId: string,
  options: {
    threadId?: string;
    status?: "completed" | "failed" | "interrupted";
    errorMessage?: string | null;
  } = {},
): void {
  setTimeout(() => {
    state.notificationHandler?.({
      method: "turn/completed",
      params: {
        threadId: options.threadId ?? "thread-app-test",
        turn: {
          id: turnId,
          items: [],
          status: options.status ?? "completed",
          error: options.errorMessage
            ? {
              message: options.errorMessage,
              codexErrorInfo: null,
              additionalDetails: null,
            }
            : null,
        },
      },
    });
  }, 0);
}

test("AppServerTaskRuntime 会按真实 Web channelSessionKey 解析 conversation，并以 created 模式启动线程", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-created",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const result = await fixture.runtime.runTask({
      requestId: "req-app-1",
      taskId: "task-app-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "hello",
      channelContext: { channelSessionKey: "web-session-created-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    });

    assert.equal(state.started.length, 1);
    assert.equal(state.resumed.length, 0);
    assert.equal(readSessionPayload(result).sessionId, "web-session-created-1");
    assert.equal(readSessionPayload(result).conversationId, "web-session-created-1");
    assert.equal(readSessionPayload(result).threadId, "thread-app-created");
    assert.equal(readSessionPayload(result).engine, "app-server");
    assert.equal(readSessionPayload(result).mode, "created");
    assert.equal(readSessionPayload(result).accessMode, "auth");
    assert.equal(fixture.runtimeStore.resolveThreadId("web-session-created-1"), "thread-app-created");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会把 assistant style 写进 structuredOutput.session", async () => {
  const { sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-structured-style-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const result = await fixture.runtime.runTask({
      requestId: "req-app-structured-style-1",
      taskId: "task-app-structured-style-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "hello",
      options: {
        profile: "mentor",
        languageStyle: "直接",
        assistantMbti: "INTJ",
        styleNotes: "先给结论",
      },
      channelContext: { sessionId: "web-session-structured-style-1" },
      createdAt: "2026-04-09T10:20:00.000Z",
    });

    assert.deepEqual(readSessionPayload(result).assistantStyle, {
      legacyProfile: "mentor",
      languageStyle: "直接",
      assistantMbti: "INTJ",
      styleNotes: "先给结论",
    });
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会在首轮 principal 任务时进入 persona onboarding，并把等待状态写入结果", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-onboarding",
  });
  const fixture = createRuntimeFixture({ sessionFactory });
  const emittedEvents: Array<{ type: string; status: string; payload?: Record<string, unknown> }> = [];

  try {
    const result = await fixture.runtime.runTask({
      requestId: "req-app-onboarding-1",
      taskId: "task-app-onboarding-1",
      sourceChannel: "feishu",
      user: {
        userId: "feishu-user-onboarding-1",
        displayName: "小段",
      },
      goal: "帮我整理今天的计划",
      channelContext: {
        sessionId: "feishu-session-onboarding-1",
      },
      createdAt: "2026-04-09T15:40:00.000Z",
    }, {
      onEvent: async (event) => {
        emittedEvents.push({
          type: event.type,
          status: event.status,
          ...(event.payload ? { payload: event.payload } : {}),
        });
      },
    });

    const promptInput = state.turns[0]?.input;
    const promptText = typeof promptInput === "string"
      ? promptInput
      : (promptInput?.find((part) => part.type === "text")?.text ?? "");
    const principalId = fixture.runtimeStore.getChannelIdentity("feishu", "feishu-user-onboarding-1")?.principalId;

    assert.equal(state.started.length, 1);
    assert.ok(principalId);
    assert.match(promptText, /first-run persona bootstrap mode/);
    assert.match(promptText, /Latest user message:\n帮我整理今天的计划/);
    assert.deepEqual(result.structuredOutput?.personaOnboarding, {
      status: "question",
      phase: "started",
      stepIndex: 0,
      stepNumber: 1,
      totalSteps: 4,
      questionKey: "identity",
      questionPrompt: "先认识一下。以后我怎么称呼你比较顺手？如果你也想顺手给我起个名字，可以一起告诉我。",
    });
    assert.equal(fixture.runtimeStore.getPrincipalPersonaOnboarding(principalId ?? "")?.state.stepIndex, 0);
    const actionRequiredEvent = [...emittedEvents].reverse().find((event) => event.type === "task.action_required");
    assert.equal(actionRequiredEvent?.type, "task.action_required");
    assert.equal(actionRequiredEvent?.status, "waiting");
    assert.deepEqual(actionRequiredEvent?.payload?.personaOnboarding, {
      status: "question",
      phase: "started",
      stepIndex: 0,
      stepNumber: 1,
      totalSteps: 4,
      questionKey: "identity",
      questionPrompt: "先认识一下。以后我怎么称呼你比较顺手？如果你也想顺手给我起个名字，可以一起告诉我。",
    });
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 完成后会自动提炼长期记忆候选，并返回 memoryUpdates", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-memory-candidate",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const identity = fixture.runtime.getIdentityLinkService().ensureIdentity({
      channel: "web",
      channelUserId: "web-memory-candidate",
      displayName: "Owner",
    });
    const events: Array<{ type?: string; status?: string; payload?: Record<string, unknown> }> = [];
    const result = await fixture.runtime.runTask({
      requestId: "req-app-memory-candidate-1",
      taskId: "task-app-memory-candidate-1",
      sourceChannel: "web",
      user: {
        userId: "web-memory-candidate",
        displayName: "Owner",
      },
      goal: "以后默认中文回复。以后先给结论再展开。",
      options: {
        memoryMode: "off",
      },
      channelContext: { sessionId: "web-session-memory-candidate-1" },
      createdAt: "2026-04-06T09:00:00.000Z",
    }, {
      onEvent: (event) => {
        events.push(event);
      },
    });

    assert.equal(state.started.length, 1);
    assert.equal(result.memoryUpdates?.length, 2);
    const candidates = fixture.runtime.getPrincipalActorsService().listMainMemoryCandidates({
      principalId: identity.principalId,
      limit: 10,
    });
    assert.deepEqual(
      candidates.map((candidate) => candidate.title).sort(),
      ["回答先给结论", "默认中文沟通"],
    );
    assert.ok(events.some((event) =>
      event.type === "task.memory_updated"
      && event.status === "completed"
      && Array.isArray(event.payload?.updates)
      && event.payload.updates.length === 2
    ));
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 成功时会写 memory updates、发 task.memory_updated，并落到 execution workspace", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-memory-runtime-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });
  const workspace = join(fixture.root, "workspace-memory-runtime-1");

  mkdirSync(join(fixture.root, "memory", "architecture"), { recursive: true });
  mkdirSync(join(workspace, "memory", "architecture"), { recursive: true });
  writeFileSync(join(fixture.root, "AGENTS.md"), "control-rule", "utf8");
  writeFileSync(join(fixture.root, "README.md"), "# control", "utf8");
  writeFileSync(join(fixture.root, "memory", "architecture", "overview.md"), "# control architecture", "utf8");
  writeFileSync(join(workspace, "AGENTS.md"), "session-rule", "utf8");
  writeFileSync(join(workspace, "README.md"), "# session", "utf8");
  writeFileSync(join(workspace, "memory", "architecture", "overview.md"), "# session architecture", "utf8");

  try {
    fixture.runtimeStore.saveSessionTaskSettings({
      sessionId: "web-session-memory-runtime-1",
      settings: {
        workspacePath: workspace,
      },
      createdAt: "2026-04-09T10:10:00.000Z",
      updatedAt: "2026-04-09T10:10:00.000Z",
    });

    const events: TaskEvent[] = [];
    const result = await fixture.runtime.runTask({
      requestId: "req-app-memory-runtime-1",
      taskId: "task-app-memory-runtime-1",
      sourceChannel: "web",
      user: {
        userId: "web-memory-runtime",
        displayName: "Owner",
      },
      goal: "实现 app-server memory runtime 集成",
      channelContext: { sessionId: "web-session-memory-runtime-1" },
      createdAt: "2026-04-09T10:11:00.000Z",
    }, {
      onEvent: (event) => {
        events.push(event);
      },
    });

    assert.equal(state.started.length, 1);
    assert.equal(result.status, "completed");
    assert.ok((result.memoryUpdates?.length ?? 0) > 0);
    const memoryEvents = events.filter((event) => event.type === "task.memory_updated");
    assert.ok(memoryEvents.length >= 2);
    assert.ok(memoryEvents.some((event) => event.status === "running"));
    assert.ok(memoryEvents.some((event) => event.status === "completed"));
    assert.ok(memoryEvents.some((event) => Array.isArray(event.payload?.updates)));

    const workspaceDone = readFileSync(join(workspace, "memory", "tasks", "done.md"), "utf8");
    assert.match(workspaceDone, /task-app-memory-runtime-1/);
    assert.match(workspaceDone, /当前已完成模块/);
    assert.equal(lstatSync(join(fixture.root, "memory")).isDirectory(), true);
    assert.equal(lstatSync(join(workspace, "memory")).isDirectory(), true);
    assert.equal(readFileSync(join(workspace, "memory", "sessions", "active.md"), "utf8").includes("状态：completed"), true);
    assert.equal(join(fixture.root, "memory", "tasks", "done.md") !== join(workspace, "memory", "tasks", "done.md"), true);
    assert.equal(
      (() => {
        try {
          return readFileSync(join(fixture.root, "memory", "tasks", "done.md"), "utf8").includes("task-app-memory-runtime-1");
        } catch {
          return false;
        }
      })(),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime memory 写回失败时任务仍 completed，并发 task.memory_updated failed 事件", async () => {
  const { sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-memory-write-failed-1",
  });
  const fixture = createRuntimeFixture({
    sessionFactory,
    createMemoryService: () => ({
      recordTaskStart: () => [],
      recordTaskCompletion: () => {
        throw new Error("memory completion failed");
      },
    }) as never,
  });

  try {
    const events: TaskEvent[] = [];
    const result = await fixture.runtime.runTask({
      requestId: "req-app-memory-write-failed-1",
      taskId: "task-app-memory-write-failed-1",
      sourceChannel: "web",
      user: { userId: "web-memory-write-failed" },
      goal: "hello",
      channelContext: { sessionId: "web-session-memory-write-failed-1" },
      createdAt: "2026-04-09T10:12:00.000Z",
    }, {
      onEvent: (event) => {
        events.push(event);
      },
    });

    assert.equal(result.status, "completed");
    const failedEvent = events.find((event) =>
      event.type === "task.memory_updated" && event.status === "failed"
    );
    assert.ok(failedEvent);
    assert.equal(failedEvent?.payload?.errorCode, "MEMORY_UPDATE_FAILED");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime start 已写回后任务普通失败，不会残留 running active 与 in-progress", async () => {
  const { sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-memory-terminal-failed-1",
    startTurn: async () => {
      throw new Error("模拟失败");
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  mkdirSync(join(fixture.root, "memory", "architecture"), { recursive: true });
  writeFileSync(join(fixture.root, "AGENTS.md"), "rule", "utf8");
  writeFileSync(join(fixture.root, "README.md"), "# control", "utf8");
  writeFileSync(join(fixture.root, "memory", "architecture", "overview.md"), "# architecture", "utf8");

  try {
    await assert.rejects(async () => await fixture.runtime.runTask({
      requestId: "req-app-memory-terminal-failed-1",
      taskId: "task-app-memory-terminal-failed-1",
      sourceChannel: "web",
      user: { userId: "web-memory-terminal-failed" },
      goal: "故意失败任务",
      channelContext: { sessionId: "web-session-memory-terminal-failed-1" },
      createdAt: "2026-04-09T10:13:00.000Z",
    }), /模拟失败/);

    const active = readFileSync(join(fixture.root, "memory", "sessions", "active.md"), "utf8");
    const inProgress = readFileSync(join(fixture.root, "memory", "tasks", "in-progress.md"), "utf8");
    assert.match(active, /状态：failed/);
    assert.doesNotMatch(active, /状态：running/);
    assert.doesNotMatch(inProgress, /task-app-memory-terminal-failed-1/);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会把图片附件写进 startTurn prompt", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-image-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    seedCompletedPrincipalPersona(fixture.runtime, {
      channel: "feishu",
      channelUserId: "feishu-user-1",
    });

    await fixture.runtime.runTask({
      requestId: "req-app-image-1",
      taskId: "task-app-image-1",
      sourceChannel: "feishu",
      user: { userId: "feishu-user-1" },
      goal: "帮我看看这张图",
      attachments: [{
        id: "img-1",
        type: "image",
        name: "receipt.jpg",
        value: "/workspace/temp/feishu-attachments/session-1/message-1/receipt.jpg",
      }],
      channelContext: { sessionId: "feishu-session-image-1" },
      createdAt: "2026-04-01T10:55:00.000Z",
    });

    assert.equal(state.turns.length, 1);
    assert.match(state.turns[0]?.prompt ?? "", /帮我看看这张图/);
    assert.match(state.turns[0]?.prompt ?? "", /Attachments:/);
    assert.match(state.turns[0]?.prompt ?? "", /receipt\.jpg/);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会把 inputEnvelope 里的图片作为 native image input 传给 app-server", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-native-image-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const imageDirectory = join(fixture.root, "temp", "input-assets");
    mkdirSync(imageDirectory, { recursive: true });
    const imagePath = join(imageDirectory, "shot.png");
    writeFileSync(imagePath, "fake-image");

    await fixture.runtime.runTask({
      requestId: "req-app-native-image-1",
      taskId: "task-app-native-image-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "帮我看图",
      inputEnvelope: {
        envelopeId: "env-app-native-image-1",
        sourceChannel: "web",
        parts: [
          { partId: "part-1", type: "text", role: "user", order: 1, text: "帮我看图" },
          { partId: "part-2", type: "image", role: "user", order: 2, assetId: "asset-image-1" },
        ],
        assets: [
          {
            assetId: "asset-image-1",
            kind: "image",
            mimeType: "image/png",
            localPath: imagePath,
            sourceChannel: "web",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-01T11:05:00.000Z",
      },
      channelContext: { sessionId: "web-session-native-image-1" },
      createdAt: "2026-04-01T11:05:00.000Z",
    });

    assert.equal(state.turns.length, 1);
    assert.equal(Array.isArray(state.turns[0]?.input), true);
    const input = state.turns[0]?.input as Array<{
      type: "text" | "localImage";
      text?: string;
      path?: string;
    }>;
    assert.equal(input[0]?.type, "text");
    assert.match(input[0]?.text ?? "", /帮我看图/);
    assert.equal(input.some((part) => part.type === "localImage"), true);
    assert.equal(
      input.find((part) => part.type === "localImage")?.path,
      imagePath,
    );
    const storedInput = fixture.runtimeStore.getTurnInput("req-app-native-image-1");
    assert.equal(storedInput?.envelope.assets[0]?.assetId, "asset-image-1");
    assert.equal(storedInput?.compileSummary?.runtimeTarget, "app-server");
    assert.equal(storedInput?.compileSummary?.degradationLevel, "native");
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.modelCapabilities, null);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.transportCapabilities?.nativeImageInput, true);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.effectiveCapabilities.nativeImageInput, true);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.assetFacts[0]?.handling, "native");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会在图片缺少可信本地路径时直接阻止 native image input", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-image-missing-path-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    await assert.rejects(
      fixture.runtime.runTask({
        requestId: "req-app-image-missing-path-1",
        taskId: "task-app-image-missing-path-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "帮我看图",
        inputEnvelope: {
          envelopeId: "env-app-image-missing-path-1",
          sourceChannel: "web",
          parts: [
            { partId: "part-1", type: "text", role: "user", order: 1, text: "帮我看图" },
            { partId: "part-2", type: "image", role: "user", order: 2, assetId: "asset-image-1" },
          ],
          assets: [
            {
              assetId: "asset-image-1",
              kind: "image",
              mimeType: "image/png",
              localPath: join(fixture.root, "temp", "input-assets", "missing-shot.png"),
              sourceChannel: "web",
              ingestionStatus: "ready",
            },
          ],
          createdAt: "2026-04-03T18:10:00.000Z",
        },
        channelContext: { sessionId: "web-session-image-missing-path-1" },
        createdAt: "2026-04-03T18:10:00.000Z",
      }),
      /可信本地路径/,
    );

    assert.equal(state.factoryCalls, 0);
    const storedInput = fixture.runtimeStore.getTurnInput("req-app-image-missing-path-1");
    assert.equal(storedInput?.compileSummary?.runtimeTarget, "app-server");
    assert.equal(storedInput?.compileSummary?.degradationLevel, "blocked");
    assert.equal(storedInput?.compileSummary?.warnings[0]?.code, "IMAGE_PATH_UNAVAILABLE");
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.assetFacts[0]?.localPathStatus, "unavailable");
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.assetFacts[0]?.handling, "blocked");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会根据当前模型能力阻止不支持图片输入的 image envelope", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-image-blocked-by-model",
  });
  const fixture = createRuntimeFixture({
    sessionFactory,
    runtimeCatalogReader: async () => createRuntimeCatalog({
      capabilities: {
        imageInput: false,
        nativeImageInput: false,
      },
    }),
  });

  try {
    await assert.rejects(
      fixture.runtime.runTask({
        requestId: "req-app-image-blocked-by-model",
        taskId: "task-app-image-blocked-by-model",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "帮我看图",
        inputEnvelope: {
          envelopeId: "env-app-image-blocked-by-model",
          sourceChannel: "web",
          parts: [
            { partId: "part-1", type: "text", role: "user", order: 1, text: "帮我看图" },
            { partId: "part-2", type: "image", role: "user", order: 2, assetId: "asset-image-1" },
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
          createdAt: "2026-04-03T16:10:00.000Z",
        },
        options: {
          model: "gpt-5.4",
        },
        channelContext: { sessionId: "web-session-image-blocked-by-model" },
        createdAt: "2026-04-03T16:10:00.000Z",
      }),
      /图片原生输入/,
    );

    assert.equal(state.factoryCalls, 0);
    const storedInput = fixture.runtimeStore.getTurnInput("req-app-image-blocked-by-model");
    assert.equal(storedInput?.compileSummary?.runtimeTarget, "app-server");
    assert.equal(storedInput?.compileSummary?.degradationLevel, "blocked");
    assert.equal(storedInput?.compileSummary?.warnings[0]?.code, "IMAGE_NATIVE_INPUT_REQUIRED");
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.modelCapabilities?.nativeImageInput, false);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.transportCapabilities?.nativeImageInput, true);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.effectiveCapabilities.nativeImageInput, false);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.assetFacts[0]?.handling, "blocked");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会把模型和关键运行参数透传给 thread/start", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-request-options-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    await fixture.runtime.runTask({
      requestId: "req-app-request-options-1",
      taskId: "task-app-request-options-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "hello",
      options: {
        model: "gpt-5.4",
        reasoning: "high",
        approvalPolicy: "on-failure",
        sandboxMode: "danger-full-access",
        webSearchMode: "live",
        networkAccessEnabled: false,
        additionalDirectories: ["/shared/a", "/shared/b"],
      },
      channelContext: { sessionId: "web-session-request-options-1" },
      createdAt: "2026-04-03T16:20:00.000Z",
    });

    const threadConfig = state.started[0]?.config as {
      "features.default_mode_request_user_input"?: boolean;
      model_reasoning_effort?: string;
      web_search?: string;
      sandbox_workspace_write?: {
        network_access?: boolean;
        writable_roots?: string[];
      };
    } | undefined;

    assert.equal(state.started.length, 1);
    assert.equal(state.started[0]?.cwd?.length ? true : false, true);
    assert.equal(state.started[0]?.model, "gpt-5.4");
    assert.equal(state.started[0]?.approvalPolicy, "on-failure");
    assert.equal(state.started[0]?.sandbox, "danger-full-access");
    assert.equal(threadConfig?.["features.default_mode_request_user_input"], true);
    assert.equal(threadConfig?.model_reasoning_effort, "high");
    assert.equal(threadConfig?.web_search, "live");
    assert.equal(threadConfig?.sandbox_workspace_write?.network_access, false);
    assert.deepEqual(threadConfig?.sandbox_workspace_write?.writable_roots, ["/shared/a", "/shared/b"]);
    assert.equal(state.started[0]?.persistExtendedHistory, true);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会在 task.started 前发出单次 task.context_built，并把结构化上下文注入 prompt", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-context-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    mkdirSync(join(fixture.root, "memory", "architecture"), { recursive: true });
    mkdirSync(join(fixture.root, "docs", "memory", "2026", "03"), { recursive: true });
    writeFileSync(join(fixture.root, "AGENTS.md"), "始终使用中文回复。", "utf8");
    writeFileSync(join(fixture.root, "README.md"), "# Demo\n\n```ts\nconst provider = true;\n```", "utf8");
    writeFileSync(join(fixture.root, "memory", "architecture", "overview.md"), "# 架构", "utf8");
    writeFileSync(join(fixture.root, "docs", "memory", "2026", "03", "provider-search.md"), "# Provider Search\n\nsearch tool 约束", "utf8");

    const events: TaskEvent[] = [];
    await fixture.runtime.runTask({
      requestId: "req-app-context-1",
      taskId: "task-app-context-1",
      sourceChannel: "web",
      user: { userId: "browser-user-context" },
      goal: "请检查 provider search 支持",
      channelContext: { sessionId: "web-session-context-1" },
      createdAt: "2026-04-09T10:00:00.000Z",
    }, {
      onEvent: (event) => {
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

    assert.equal(state.turns.length, 1);
    assert.match(state.turns[0]?.prompt ?? "", /Task context blocks:/);
    assert.match(state.turns[0]?.prompt ?? "", /kind: repoRules/);
    assert.match(state.turns[0]?.prompt ?? "", /source: AGENTS\.md/);
    assert.match(state.turns[0]?.prompt ?? "", /title: Repository rules/);
    assert.match(state.turns[0]?.prompt ?? "", /\| ```ts/);
    assert.match(state.turns[0]?.prompt ?? "", /Response guidance:/);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在 context build 阶段收到 abort 会尽快取消且不初始化 session", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-context-abort-1",
  });
  const fixture = createRuntimeFixture({
    sessionFactory,
    createContextBuilder: () => ({
      build: async (input: { signal?: AbortSignal }) => {
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
    const result = await fixture.runtime.runTask({
      requestId: "req-app-context-abort-1",
      taskId: "task-app-context-abort-1",
      sourceChannel: "web",
      user: { userId: "browser-user-context-abort" },
      goal: "hello",
      channelContext: { sessionId: "web-session-context-abort-1" },
      createdAt: "2026-04-09T10:05:00.000Z",
    }, {
      signal: abortController.signal,
    });

    assert.equal(result.status, "cancelled");
    assert.equal(state.factoryCalls, 0);
    assert.equal(state.initialized, 0);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会在 app-server 主链路合并请求参数、principal 默认和 Themis 全局默认", async () => {
  const { state, sessionFactory: baseSessionFactory } = createSessionFactory({
    startThreadId: "thread-app-principal-defaults-1",
  });
  const delegateSessionFactory = baseSessionFactory as NonNullable<AppServerTaskRuntimeOptions["sessionFactory"]>;
  const factoryOptionsHistory: AppServerSessionFactoryOptions[] = [];
  const fixture = createRuntimeFixture({
    sessionFactory: async (options) => {
      factoryOptionsHistory.push(options ?? {});
      return await delegateSessionFactory();
    },
  });

  try {
    fixture.runtimeStore.saveAuthAccount({
      accountId: "acct-principal-defaults",
      label: "默认账号",
      codexHome: join(fixture.root, "infra/local/codex-auth/acct-principal-defaults"),
      isActive: false,
      createdAt: "2026-04-09T09:00:00.000Z",
      updatedAt: "2026-04-09T09:00:00.000Z",
    });

    const identity = fixture.runtime.getIdentityLinkService().ensureIdentity({
      channel: "web",
      channelUserId: "browser-user-principal-defaults",
    });

    fixture.runtimeStore.savePrincipalTaskSettings({
      principalId: identity.principalId,
      settings: {
        authAccountId: "acct-principal-defaults",
        sandboxMode: "danger-full-access",
      },
      createdAt: "2026-04-09T09:01:00.000Z",
      updatedAt: "2026-04-09T09:01:00.000Z",
    });

    await fixture.runtime.runTask({
      requestId: "req-app-principal-defaults-1",
      taskId: "task-app-principal-defaults-1",
      sourceChannel: "web",
      user: { userId: "browser-user-principal-defaults" },
      goal: "hello",
      options: {
        approvalPolicy: "on-failure",
      },
      channelContext: { sessionId: "web-session-principal-defaults-1" },
      createdAt: "2026-04-09T09:02:00.000Z",
    });

    const threadConfig = state.started[0]?.config as {
      "features.default_mode_request_user_input"?: boolean;
      web_search?: string;
      sandbox_workspace_write?: {
        network_access?: boolean;
      };
    } | undefined;

    assert.equal(state.started.length, 1);
    assert.equal(state.started[0]?.approvalPolicy, "on-failure");
    assert.equal(state.started[0]?.sandbox, "danger-full-access");
    assert.equal(threadConfig?.["features.default_mode_request_user_input"], true);
    assert.equal(threadConfig?.web_search, "live");
    assert.equal(threadConfig?.sandbox_workspace_write?.network_access, true);
    assert.equal(factoryOptionsHistory.length, 1);
    assert.equal(
      factoryOptionsHistory[0]?.env?.CODEX_HOME,
      join(fixture.root, "infra/local/codex-auth/acct-principal-defaults"),
    );
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在 auth 模式下会把账号隔离环境传给 sessionFactory", async () => {
  const { state, sessionFactory: baseSessionFactory } = createSessionFactory({
    startThreadId: "thread-app-auth-boundary-1",
  });
  const delegateSessionFactory = baseSessionFactory as NonNullable<AppServerTaskRuntimeOptions["sessionFactory"]>;
  const factoryOptionsHistory: AppServerSessionFactoryOptions[] = [];
  const fixture = createRuntimeFixture({
    sessionFactory: async (options) => {
      factoryOptionsHistory.push(options ?? {});
      return await delegateSessionFactory();
    },
  });

  try {
    fixture.runtimeStore.saveAuthAccount({
      accountId: "acct-runtime",
      label: "运行账号",
      codexHome: join(fixture.root, "infra/local/codex-auth/acct-runtime"),
      isActive: true,
      createdAt: "2026-04-07T12:20:00.000Z",
      updatedAt: "2026-04-07T12:20:00.000Z",
    });

    const result = await fixture.runtime.runTask({
      requestId: "req-app-auth-boundary-1",
      taskId: "task-app-auth-boundary-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "hello",
      options: {
        accessMode: "auth",
        authAccountId: "acct-runtime",
      },
      channelContext: { sessionId: "web-session-auth-boundary-1" },
      createdAt: "2026-04-07T12:21:00.000Z",
    });

    assert.equal(state.started.length, 1);
    assert.equal(factoryOptionsHistory.length, 1);
    assert.equal(
      factoryOptionsHistory[0]?.env?.CODEX_HOME,
      join(fixture.root, "infra/local/codex-auth/acct-runtime"),
    );
    assert.equal(factoryOptionsHistory[0]?.configOverrides?.cli_auth_credentials_store, "file");
    assert.equal(readSessionPayload(result).accessMode, "auth");
    assert.equal(readSessionPayload(result).authAccountId, "acct-runtime");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会把 Themis 定时任务 MCP server 注入 sessionFactory 配置", async () => {
  const { state, sessionFactory: baseSessionFactory } = createSessionFactory({
    startThreadId: "thread-app-mcp-scheduled-1",
  });
  const delegateSessionFactory = baseSessionFactory as NonNullable<AppServerTaskRuntimeOptions["sessionFactory"]>;
  const factoryOptionsHistory: AppServerSessionFactoryOptions[] = [];
  const fixture = createRuntimeFixture({
    sessionFactory: async (options) => {
      factoryOptionsHistory.push(options ?? {});
      return await delegateSessionFactory();
    },
  });

  try {
    await fixture.runtime.runTask({
      requestId: "req-app-mcp-scheduled-1",
      taskId: "task-app-mcp-scheduled-1",
      sourceChannel: "web",
      user: {
        userId: "browser-user-1",
        displayName: "Owner",
      },
      goal: "请帮我安排一个定时任务",
      channelContext: {
        sessionId: "session-web-mcp-scheduled-1",
        channelSessionKey: "session-web-mcp-scheduled-1",
      },
      createdAt: "2026-04-09T12:00:00.000Z",
    });

    assert.equal(state.started.length, 1);
    assert.equal(factoryOptionsHistory.length, 1);
    const scheduledMcpConfig = factoryOptionsHistory[0]?.configOverrides?.["mcp_servers.themis_scheduled_tasks"] as {
      command?: string;
      args?: string[];
    } | undefined;
    assert.match(scheduledMcpConfig?.command ?? "", /\/themis$/);
    assert.deepEqual(scheduledMcpConfig?.args, [
      "mcp-server",
      "--channel",
      "web",
      "--user",
      "browser-user-1",
      "--name",
      "Owner",
      "--session",
      "session-web-mcp-scheduled-1",
      "--channel-session-key",
      "session-web-mcp-scheduled-1",
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会在 prompt 里明确注入定时任务工具使用说明", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-scheduled-prompt-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    seedCompletedPrincipalPersona(fixture.runtime, {
      channel: "feishu",
      channelUserId: "feishu-user-1",
      displayName: "飞书用户",
    });

    await fixture.runtime.runTask({
      requestId: "req-app-scheduled-prompt-1",
      taskId: "task-app-scheduled-prompt-1",
      sourceChannel: "feishu",
      user: {
        userId: "feishu-user-1",
        displayName: "飞书用户",
      },
      goal: "明天早上提醒我检查发布状态",
      channelContext: {
        sessionId: "session-feishu-scheduled-prompt-1",
        channelSessionKey: "session-feishu-scheduled-prompt-1",
      },
      createdAt: "2026-04-09T12:05:00.000Z",
    });

    assert.equal(state.turns.length, 1);
    assert.match(state.turns[0]?.prompt ?? "", /Themis scheduled task tools are available in this session/);
    assert.match(state.turns[0]?.prompt ?? "", /use the scheduled task tools instead of saying you cannot do it/);
    assert.match(state.turns[0]?.prompt ?? "", /sourceChannel=feishu/);
    assert.match(state.turns[0]?.prompt ?? "", /channelUserId=feishu-user-1/);
    assert.match(state.turns[0]?.prompt ?? "", /sessionId=session-feishu-scheduled-prompt-1/);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在 third-party 模式下会把 provider 隔离配置传给 sessionFactory", async () => {
  await withClearedOpenAICompatEnv(async () => {
    const { state, sessionFactory: baseSessionFactory } = createSessionFactory({
      startThreadId: "thread-app-provider-boundary-1",
    });
    const delegateSessionFactory = baseSessionFactory as NonNullable<AppServerTaskRuntimeOptions["sessionFactory"]>;
    const factoryOptionsHistory: AppServerSessionFactoryOptions[] = [];
    const fixture = createRuntimeFixture({
      sessionFactory: async (options) => {
        factoryOptionsHistory.push(options ?? {});
        return await delegateSessionFactory();
      },
    });

    try {
      addOpenAICompatibleProvider(fixture.root, {
        id: "gateway-a",
        name: "Gateway A",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "sk-gateway-a",
        wireApi: "responses",
        supportsWebsockets: true,
      }, fixture.runtimeStore);

      const result = await fixture.runtime.runTask({
        requestId: "req-app-provider-boundary-1",
        taskId: "task-app-provider-boundary-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "hello",
        options: {
          accessMode: "third-party",
          thirdPartyProviderId: "gateway-a",
        },
        channelContext: { sessionId: "web-session-provider-boundary-1" },
        createdAt: "2026-04-07T12:22:00.000Z",
      });

      assert.equal(state.started.length, 1);
      assert.equal(factoryOptionsHistory.length, 1);
      assert.equal(factoryOptionsHistory[0]?.env?.THEMIS_OPENAI_COMPAT_API_KEY, "sk-gateway-a");
      assert.equal(factoryOptionsHistory[0]?.env?.CODEX_HOME, undefined);
      assert.equal(factoryOptionsHistory[0]?.configOverrides?.model_provider, "gateway-a");
      assert.deepEqual(factoryOptionsHistory[0]?.configOverrides?.model_providers, {
        "gateway-a": {
          name: "Gateway A",
          base_url: "https://gateway.example.com/v1",
          wire_api: "responses",
          env_key: "THEMIS_OPENAI_COMPAT_API_KEY",
          supports_websockets: true,
        },
      });
      assert.equal(readSessionPayload(result).accessMode, "third-party");
      assert.equal(readSessionPayload(result).thirdPartyProviderId, "gateway-a");
    } finally {
      fixture.cleanup();
    }
  });
});

test("AppServerTaskRuntime 在 managed agent 的 auth 模式下会使用 agent 独立 CODEX_HOME", async () => {
  const { state, sessionFactory: baseSessionFactory } = createSessionFactory({
    startThreadId: "thread-app-managed-auth-1",
  });
  const delegateSessionFactory = baseSessionFactory as NonNullable<AppServerTaskRuntimeOptions["sessionFactory"]>;
  const factoryOptionsHistory: AppServerSessionFactoryOptions[] = [];
  const fixture = createRuntimeFixture({
    sessionFactory: async (options) => {
      factoryOptionsHistory.push(options ?? {});
      return await delegateSessionFactory();
    },
  });

  try {
    fixture.runtimeStore.savePrincipal({
      principalId: "principal-owner",
      displayName: "Owner",
      kind: "human_user",
      createdAt: "2026-04-08T10:00:00.000Z",
      updatedAt: "2026-04-08T10:00:00.000Z",
    });
    const accountHome = join(fixture.root, "infra/local/codex-auth/acct-managed");
    mkdirSync(join(accountHome, "skills"), { recursive: true });
    writeFileSync(join(accountHome, "auth.json"), "{\"token\":\"acct-managed\"}", "utf8");
    writeFileSync(join(accountHome, "skills/demo-skill.txt"), "demo", "utf8");
    fixture.runtimeStore.saveAuthAccount({
      accountId: "acct-managed",
      label: "运行账号",
      codexHome: accountHome,
      isActive: true,
      createdAt: "2026-04-08T10:00:00.000Z",
      updatedAt: "2026-04-08T10:00:00.000Z",
    });
    const created = fixture.runtime.getManagedAgentsService().createManagedAgent({
      ownerPrincipalId: "principal-owner",
      departmentRole: "后端",
      displayName: "后端·衡",
      now: "2026-04-08T10:01:00.000Z",
    });

    const result = await fixture.runtime.runTaskAsPrincipal({
      requestId: "req-app-managed-auth-1",
      taskId: "task-app-managed-auth-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "hello",
      options: {
        accessMode: "auth",
        authAccountId: "acct-managed",
      },
      channelContext: { sessionId: "web-session-managed-auth-1" },
      createdAt: "2026-04-08T10:02:00.000Z",
    }, {
      principalId: created.agent.principalId,
      conversationId: "managed-conversation-auth-1",
    });

    const managedHome = join(fixture.root, "infra/local/managed-agents", created.agent.agentId, "codex-home");
    assert.equal(result.status, "completed");
    assert.equal(result.structuredOutput?.personaOnboarding, undefined);
    assert.equal(state.started.length, 1);
    assert.equal(factoryOptionsHistory.length, 1);
    assert.equal(factoryOptionsHistory[0]?.env?.CODEX_HOME, managedHome);
    assert.equal(factoryOptionsHistory[0]?.configOverrides?.cli_auth_credentials_store, "file");
    assert.equal(readFileSync(join(managedHome, "auth.json"), "utf8"), "{\"token\":\"acct-managed\"}");
    assert.equal(lstatSync(join(managedHome, "skills")).isSymbolicLink(), true);
    assert.equal(readFileSync(join(managedHome, "config.toml"), "utf8").includes("managed-agent runtime isolation"), true);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在 managed agent 的 third-party 模式下也会使用 agent 独立 CODEX_HOME", async () => {
  await withClearedOpenAICompatEnv(async () => {
    const { state, sessionFactory: baseSessionFactory } = createSessionFactory({
      startThreadId: "thread-app-managed-provider-1",
    });
    const delegateSessionFactory = baseSessionFactory as NonNullable<AppServerTaskRuntimeOptions["sessionFactory"]>;
    const factoryOptionsHistory: AppServerSessionFactoryOptions[] = [];
    const fixture = createRuntimeFixture({
      sessionFactory: async (options) => {
        factoryOptionsHistory.push(options ?? {});
        return await delegateSessionFactory();
      },
    });

    try {
      fixture.runtimeStore.savePrincipal({
        principalId: "principal-owner",
        displayName: "Owner",
        kind: "human_user",
        createdAt: "2026-04-08T10:10:00.000Z",
        updatedAt: "2026-04-08T10:10:00.000Z",
      });
      addOpenAICompatibleProvider(fixture.root, {
        id: "gateway-a",
        name: "Gateway A",
        baseUrl: "https://gateway.example.com/v1",
        apiKey: "sk-gateway-a",
        wireApi: "responses",
        supportsWebsockets: true,
      }, fixture.runtimeStore);
      const created = fixture.runtime.getManagedAgentsService().createManagedAgent({
        ownerPrincipalId: "principal-owner",
        departmentRole: "运维",
        displayName: "运维·砺",
        now: "2026-04-08T10:11:00.000Z",
      });

      await fixture.runtime.runTaskAsPrincipal({
        requestId: "req-app-managed-provider-1",
        taskId: "task-app-managed-provider-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "hello",
        options: {
          accessMode: "third-party",
          thirdPartyProviderId: "gateway-a",
        },
        channelContext: { sessionId: "web-session-managed-provider-1" },
        createdAt: "2026-04-08T10:12:00.000Z",
      }, {
        principalId: created.agent.principalId,
        conversationId: "managed-conversation-provider-1",
      });

      const managedHome = join(fixture.root, "infra/local/managed-agents", created.agent.agentId, "codex-home");
      assert.equal(state.started.length, 1);
      assert.equal(factoryOptionsHistory.length, 1);
      assert.equal(factoryOptionsHistory[0]?.env?.CODEX_HOME, managedHome);
      assert.equal(factoryOptionsHistory[0]?.env?.THEMIS_OPENAI_COMPAT_API_KEY, "sk-gateway-a");
      assert.equal(readFileSync(join(managedHome, "config.toml"), "utf8").includes("managed-agent runtime isolation"), true);
    } finally {
      fixture.cleanup();
    }
  });
});

test("AppServerTaskRuntime 会把 document envelope 的路径 fallback 持久化到 turn input", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-document-fallback-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    seedCompletedPrincipalPersona(fixture.runtime, {
      channel: "feishu",
      channelUserId: "feishu-user-1",
    });

    const documentDirectory = join(fixture.root, "temp", "input-assets");
    mkdirSync(documentDirectory, { recursive: true });
    const documentPath = join(documentDirectory, "brief.md");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(documentPath, "# Brief\n\nhello"));

    await fixture.runtime.runTask({
      requestId: "req-app-document-fallback-1",
      taskId: "task-app-document-fallback-1",
      sourceChannel: "feishu",
      user: { userId: "feishu-user-1" },
      goal: "帮我看看文档",
      inputEnvelope: {
        envelopeId: "env-app-document-fallback-1",
        sourceChannel: "feishu",
        parts: [
          { partId: "part-1", type: "text", role: "user", order: 1, text: "帮我看看文档" },
          { partId: "part-2", type: "document", role: "user", order: 2, assetId: "asset-doc-1" },
        ],
        assets: [
          {
            assetId: "asset-doc-1",
            kind: "document",
            name: "brief.md",
            mimeType: "text/markdown",
            localPath: documentPath,
            sourceChannel: "feishu",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-03T15:00:00.000Z",
      },
      channelContext: { sessionId: "feishu-session-document-fallback-1" },
      createdAt: "2026-04-03T15:00:00.000Z",
    });

    assert.equal(Array.isArray(state.turns[0]?.input), true);
    const input = state.turns[0]?.input as Array<{
      type: "text" | "localImage";
      text?: string;
    }>;
    assert.equal(input[0]?.type, "text");
    assert.match(input[0]?.text ?? "", /Attached document paths:/);
    assert.match(input[0]?.text ?? "", /brief\.md/);
    const storedInput = fixture.runtimeStore.getTurnInput("req-app-document-fallback-1");
    assert.equal(storedInput?.compileSummary?.runtimeTarget, "app-server");
    assert.equal(storedInput?.compileSummary?.degradationLevel, "controlled_fallback");
    assert.deepEqual(
      storedInput?.compileSummary?.warnings.map((warning) => warning.code),
      ["DOCUMENT_NATIVE_INPUT_FALLBACK"],
    );
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.modelCapabilities, null);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.transportCapabilities?.nativeDocumentInput, false);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.assetFacts[0]?.handling, "path_fallback");
    assert.equal(storedInput?.envelope.parts[1]?.type, "document");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 即使模型声明 nativeDocumentInput 也会按 app-server transport 边界走路径 fallback", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-document-transport-fallback-1",
  });
  const fixture = createRuntimeFixture({
    sessionFactory,
    runtimeCatalogReader: async () => createRuntimeCatalog({
      capabilities: {
        nativeDocumentInput: true,
        supportedDocumentMimeTypes: ["text/markdown"],
      },
    }),
  });

  try {
    seedCompletedPrincipalPersona(fixture.runtime, {
      channel: "feishu",
      channelUserId: "feishu-user-1",
    });

    const documentDirectory = join(fixture.root, "temp", "input-assets");
    mkdirSync(documentDirectory, { recursive: true });
    const documentPath = join(documentDirectory, "capability-brief.md");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(documentPath, "# Brief\n\nhello"));

    await fixture.runtime.runTask({
      requestId: "req-app-document-transport-fallback-1",
      taskId: "task-app-document-transport-fallback-1",
      sourceChannel: "feishu",
      user: { userId: "feishu-user-1" },
      goal: "帮我看看文档",
      inputEnvelope: {
        envelopeId: "env-app-document-transport-fallback-1",
        sourceChannel: "feishu",
        parts: [
          { partId: "part-1", type: "text", role: "user", order: 1, text: "帮我看看文档" },
          { partId: "part-2", type: "document", role: "user", order: 2, assetId: "asset-doc-1" },
        ],
        assets: [
          {
            assetId: "asset-doc-1",
            kind: "document",
            name: "capability-brief.md",
            mimeType: "text/markdown",
            localPath: documentPath,
            sourceChannel: "feishu",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-03T17:20:00.000Z",
      },
      options: {
        model: "gpt-5.4",
      },
      channelContext: { sessionId: "feishu-session-document-transport-fallback-1" },
      createdAt: "2026-04-03T17:20:00.000Z",
    });

    assert.equal(Array.isArray(state.turns[0]?.input), true);
    const input = state.turns[0]?.input as Array<{
      type: "text" | "localImage";
      text?: string;
    }>;
    assert.equal(input[0]?.type, "text");
    assert.match(input[0]?.text ?? "", /Attached document paths:/);
    assert.match(input[0]?.text ?? "", /capability-brief\.md/);
    const storedInput = fixture.runtimeStore.getTurnInput("req-app-document-transport-fallback-1");
    assert.equal(storedInput?.compileSummary?.degradationLevel, "controlled_fallback");
    assert.deepEqual(
      storedInput?.compileSummary?.warnings.map((warning) => warning.code),
      ["DOCUMENT_NATIVE_INPUT_FALLBACK"],
    );
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.modelCapabilities?.nativeDocumentInput, true);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.transportCapabilities?.nativeDocumentInput, false);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.effectiveCapabilities.nativeDocumentInput, false);
    assert.equal(storedInput?.compileSummary?.capabilityMatrix?.assetFacts[0]?.handling, "path_fallback");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会把 item/completed 里的 final_answer 收口成最终结果，而不是回退成用户 goal", async () => {
  const { sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-final-answer",
    startTurn: async (state) => {
      state.notificationHandler?.({
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "msg-commentary-1",
            text: "先检查上下文。",
            phase: "commentary",
            memoryCitation: null,
          },
          threadId: "thread-app-final-answer",
          turnId: "turn-app-final-answer-1",
        },
      });
      state.notificationHandler?.({
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "msg-final-1",
            text: "你好\n\n这里是最终回答。",
            phase: "final_answer",
            memoryCitation: null,
          },
          threadId: "thread-app-final-answer",
          turnId: "turn-app-final-answer-1",
        },
      });
      scheduleCompletedTurn(state, "turn-app-final-answer-1", {
        threadId: "thread-app-final-answer",
      });
      return { turnId: "turn-app-final-answer-1" };
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const result = await fixture.runtime.runTask({
      requestId: "req-app-final-answer-1",
      taskId: "task-app-final-answer-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "请打个招呼",
      channelContext: { channelSessionKey: "web-session-final-answer-1" },
      createdAt: "2026-04-01T10:00:00.000Z",
    });

    assert.equal(result.summary, "你好");
    assert.equal(result.output, "你好\n\n这里是最终回答。");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会等待异步到达的 turn/completed，再用 final_answer 收口", async () => {
  const { sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-async-final-answer",
    startTurn: async (state) => {
      setTimeout(() => {
        state.notificationHandler?.({
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              id: "msg-final-async-1",
              text: "你好\n\n这是异步完成的最终回答。",
              phase: "final_answer",
              memoryCitation: null,
            },
            threadId: "thread-app-async-final-answer",
            turnId: "turn-app-async-final-answer-1",
          },
        });
        state.notificationHandler?.({
          method: "turn/completed",
          params: {
            threadId: "thread-app-async-final-answer",
            turn: {
              id: "turn-app-async-final-answer-1",
              items: [],
              status: "completed",
              error: null,
            },
          },
        });
      }, 0);

      return { turnId: "turn-app-async-final-answer-1" };
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const result = await fixture.runtime.runTask({
      requestId: "req-app-async-final-answer-1",
      taskId: "task-app-async-final-answer-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "请异步打个招呼",
      channelContext: { channelSessionKey: "web-session-async-final-answer-1" },
      createdAt: "2026-04-01T10:05:00.000Z",
    });

    assert.equal(result.summary, "你好");
    assert.equal(result.output, "你好\n\n这是异步完成的最终回答。");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 恢复会话时会使用存储里的 threadId，而不是拿 conversationId 直接 resume", async () => {
  const { state, sessionFactory } = createSessionFactory({
    resumeThreadId: "thread-app-stored-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-resume-1",
      threadId: "thread-app-stored-1",
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    });
    fixture.runtimeStore.upsertTurnFromRequest({
      requestId: "req-app-old-2",
      taskId: "task-app-old-2",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "old app-server turn",
      channelContext: { sessionId: "web-session-resume-1" },
      createdAt: "2026-03-28T11:59:00.000Z",
    }, "task-app-old-2");
    fixture.runtimeStore.completeTaskTurn({
      request: {
        requestId: "req-app-old-2",
        taskId: "task-app-old-2",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "old app-server turn",
        channelContext: { sessionId: "web-session-resume-1" },
        createdAt: "2026-03-28T11:59:00.000Z",
      },
      result: {
        taskId: "task-app-old-2",
        requestId: "req-app-old-2",
        status: "completed",
        summary: "app-server result",
        structuredOutput: {
          session: {
            sessionId: "web-session-resume-1",
            threadId: "thread-app-stored-1",
            engine: "app-server",
          },
        },
        completedAt: "2026-03-28T11:59:30.000Z",
      },
      sessionMode: "resumed",
      threadId: "thread-app-stored-1",
    });

    const result = await fixture.runtime.runTask({
      requestId: "req-app-2",
      taskId: "task-app-2",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "resume",
      channelContext: { channelSessionKey: "web-session-resume-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    });

    assert.equal(state.started.length, 0);
    assert.equal(state.resumed.length, 1);
    assert.equal(state.resumed[0]?.threadId, "thread-app-stored-1");
    assert.equal(readSessionPayload(result).sessionId, "web-session-resume-1");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 遇到 SDK 旧会话 threadId 时会降级 startThread，而不是跨引擎 resume", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-new-engine",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-cross-engine-1",
      threadId: "thread-sdk-old-1",
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    });

    fixture.runtimeStore.upsertTurnFromRequest({
      requestId: "req-sdk-old-1",
      taskId: "task-sdk-old-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "old sdk turn",
      channelContext: { sessionId: "web-session-cross-engine-1" },
      createdAt: "2026-03-28T11:59:00.000Z",
    }, "task-sdk-old-1");
    fixture.runtimeStore.completeTaskTurn({
      request: {
        requestId: "req-sdk-old-1",
        taskId: "task-sdk-old-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "old sdk turn",
        channelContext: { sessionId: "web-session-cross-engine-1" },
        createdAt: "2026-03-28T11:59:00.000Z",
      },
      result: {
        taskId: "task-sdk-old-1",
        requestId: "req-sdk-old-1",
        status: "completed",
        summary: "sdk result",
        structuredOutput: {
          session: {
            sessionId: "web-session-cross-engine-1",
            threadId: "thread-sdk-old-1",
            engine: "sdk",
          },
        },
        completedAt: "2026-03-28T11:59:30.000Z",
      },
      sessionMode: "resumed",
      threadId: "thread-sdk-old-1",
    });

    const result = await fixture.runtime.runTask({
      requestId: "req-app-cross-1",
      taskId: "task-app-cross-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "new app server turn",
      channelContext: { channelSessionKey: "web-session-cross-engine-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    });

    assert.equal(state.resumed.length, 0);
    assert.equal(state.started.length, 1);
    assert.equal(readSessionPayload(result).threadId, "thread-app-new-engine");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 遇到没有 engine 标记的 legacy session 时会降级 startThread", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-legacy-new",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-legacy-1",
      threadId: "thread-legacy-old-1",
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    });

    fixture.runtimeStore.upsertTurnFromRequest({
      requestId: "req-legacy-old-1",
      taskId: "task-legacy-old-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "legacy turn",
      channelContext: { sessionId: "web-session-legacy-1" },
      createdAt: "2026-03-28T11:59:00.000Z",
    }, "task-legacy-old-1");
    fixture.runtimeStore.completeTaskTurn({
      request: {
        requestId: "req-legacy-old-1",
        taskId: "task-legacy-old-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "legacy turn",
        channelContext: { sessionId: "web-session-legacy-1" },
        createdAt: "2026-03-28T11:59:00.000Z",
      },
      result: {
        taskId: "task-legacy-old-1",
        requestId: "req-legacy-old-1",
        status: "completed",
        summary: "legacy result",
        structuredOutput: {
          session: {
            sessionId: "web-session-legacy-1",
            threadId: "thread-legacy-old-1",
          },
        },
        completedAt: "2026-03-28T11:59:30.000Z",
      },
      sessionMode: "resumed",
      threadId: "thread-legacy-old-1",
    });

    const result = await fixture.runtime.runTask({
      requestId: "req-app-legacy-1",
      taskId: "task-app-legacy-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "legacy fallback",
      channelContext: { channelSessionKey: "web-session-legacy-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    });

    assert.equal(state.resumed.length, 0);
    assert.equal(state.started.length, 1);
    assert.equal(readSessionPayload(result).threadId, "thread-app-legacy-new");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在没有 completed/failed turn 时会恢复预绑定的 session threadId", async () => {
  const { state, sessionFactory } = createSessionFactory({
    resumeThreadId: "thread-app-prebound-1",
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-prebound-1",
      threadId: "thread-app-prebound-1",
      createdAt: "2026-03-29T10:00:00.000Z",
      updatedAt: "2026-03-29T10:00:00.000Z",
    });

    const result = await fixture.runtime.runTask({
      requestId: "req-app-prebound-1",
      taskId: "task-app-prebound-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "resume prebound forked session",
      channelContext: { channelSessionKey: "web-session-prebound-1" },
      createdAt: "2026-03-29T10:01:00.000Z",
    });

    assert.equal(state.started.length, 0);
    assert.equal(state.resumed.length, 1);
    assert.equal(state.resumed[0]?.threadId, "thread-app-prebound-1");
    assert.equal(readSessionPayload(result).threadId, "thread-app-prebound-1");
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在旧 sdk turn 后切到预绑定 app-server thread 时仍会使用新的 thread", async () => {
  const { state, sessionFactory } = createSessionFactory();
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.upsertTurnFromRequest({
      requestId: "req-app-mixed-sdk-1",
      taskId: "task-app-mixed-sdk-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "previous sdk turn",
      channelContext: { sessionId: "web-session-mixed-runtime-1" },
      createdAt: "2026-03-29T11:00:00.000Z",
    }, "task-app-mixed-sdk-1");
    fixture.runtimeStore.completeTaskTurn({
      request: {
        requestId: "req-app-mixed-sdk-1",
        taskId: "task-app-mixed-sdk-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "previous sdk turn",
        channelContext: { sessionId: "web-session-mixed-runtime-1" },
        createdAt: "2026-03-29T11:00:00.000Z",
      },
      result: {
        taskId: "task-app-mixed-sdk-1",
        requestId: "req-app-mixed-sdk-1",
        status: "completed",
        summary: "sdk completed",
        structuredOutput: {
          session: {
            sessionId: "web-session-mixed-runtime-1",
            threadId: "thread-sdk-legacy-1",
            engine: "sdk",
          },
        },
        completedAt: "2026-03-29T11:00:30.000Z",
      },
      sessionMode: "resumed",
      threadId: "thread-sdk-legacy-1",
    });
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-mixed-runtime-1",
      threadId: "thread-app-migrated-1",
      createdAt: "2026-03-29T11:00:00.000Z",
      updatedAt: "2026-03-29T11:01:00.000Z",
    });

    await fixture.runtime.startReview({
      sessionId: "web-session-mixed-runtime-1",
      instructions: "review migrated session",
    });

    assert.deepEqual(state.reviews, [{
      threadId: "thread-app-migrated-1",
      instructions: "review migrated session",
    }]);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在旧 sdk 会话首次切 app-server 且 startThread 失败时不会污染后续判定", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThread: async () => {
      throw new Error("APP_SERVER_START_FAILED");
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.upsertTurnFromRequest({
      requestId: "req-app-mixed-fail-sdk-1",
      taskId: "task-app-mixed-fail-sdk-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "previous sdk turn",
      channelContext: { sessionId: "web-session-mixed-fail-1" },
      createdAt: "2026-03-29T11:10:00.000Z",
    }, "task-app-mixed-fail-sdk-1");
    fixture.runtimeStore.completeTaskTurn({
      request: {
        requestId: "req-app-mixed-fail-sdk-1",
        taskId: "task-app-mixed-fail-sdk-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "previous sdk turn",
        channelContext: { sessionId: "web-session-mixed-fail-1" },
        createdAt: "2026-03-29T11:10:00.000Z",
      },
      result: {
        taskId: "task-app-mixed-fail-sdk-1",
        requestId: "req-app-mixed-fail-sdk-1",
        status: "completed",
        summary: "sdk completed",
        structuredOutput: {
          session: {
            sessionId: "web-session-mixed-fail-1",
            threadId: "thread-sdk-legacy-fail-1",
            engine: "sdk",
          },
        },
        completedAt: "2026-03-29T11:10:30.000Z",
      },
      sessionMode: "resumed",
      threadId: "thread-sdk-legacy-fail-1",
    });
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-mixed-fail-1",
      threadId: "thread-sdk-legacy-fail-1",
      createdAt: "2026-03-29T11:10:00.000Z",
      updatedAt: "2026-03-29T11:10:30.000Z",
    });

    await assert.rejects(async () => await fixture.runtime.runTask({
      requestId: "req-app-mixed-fail-app-1",
      taskId: "task-app-mixed-fail-app-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "switch to app-server but fail before thread",
      channelContext: { channelSessionKey: "web-session-mixed-fail-1" },
      createdAt: "2026-03-29T11:11:00.000Z",
    }), /APP_SERVER_START_FAILED/);

    const failedTurn = fixture.runtimeStore.getTurn("req-app-mixed-fail-app-1");
    assert.equal(failedTurn?.structuredOutputJson, undefined);
    await assert.rejects(async () => await fixture.runtime.startReview({
      sessionId: "web-session-mixed-fail-1",
      instructions: "should still be treated as sdk",
    }), /可用的 app-server thread/);
    assert.equal(state.reviews.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会阻止历史 sdk 会话在 startReview 时接入 app-server thread", async () => {
  const { state, sessionFactory } = createSessionFactory();
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-sdk-review-1",
      threadId: "thread-sdk-review-1",
      createdAt: "2026-03-29T11:20:00.000Z",
      updatedAt: "2026-03-29T11:20:00.000Z",
    });
    fixture.runtimeStore.upsertTurnFromRequest({
      requestId: "req-sdk-review-1",
      taskId: "task-sdk-review-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "completed sdk turn",
      channelContext: { sessionId: "web-session-sdk-review-1" },
      createdAt: "2026-03-29T11:19:00.000Z",
    }, "task-sdk-review-1");
    fixture.runtimeStore.completeTaskTurn({
      request: {
        requestId: "req-sdk-review-1",
        taskId: "task-sdk-review-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "completed sdk turn",
        channelContext: { sessionId: "web-session-sdk-review-1" },
        createdAt: "2026-03-29T11:19:00.000Z",
      },
      result: {
        taskId: "task-sdk-review-1",
        requestId: "req-sdk-review-1",
        status: "completed",
        summary: "sdk completed",
        structuredOutput: {
          session: {
            sessionId: "web-session-sdk-review-1",
            threadId: "thread-sdk-review-1",
            engine: "sdk",
          },
        },
        completedAt: "2026-03-29T11:19:30.000Z",
      },
      sessionMode: "resumed",
      threadId: "thread-sdk-review-1",
    });

    await assert.rejects(async () => await fixture.runtime.startReview({
      sessionId: "web-session-sdk-review-1",
      instructions: "should stay on delete gate",
    }), /可用的 app-server thread/);

    assert.equal(state.factoryCalls, 0);
    assert.equal(state.initialized, 0);
    assert.equal(state.reviews.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 支持 review/start 与 turn/steer 最小入口", async () => {
  const { state, sessionFactory } = createSessionFactory();
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-review-steer-1",
      threadId: "thread-app-review-steer-1",
      createdAt: "2026-03-29T12:00:00.000Z",
      updatedAt: "2026-03-29T12:00:00.000Z",
    });

    await fixture.runtime.startReview({
      sessionId: "web-session-review-steer-1",
      instructions: "please review current diff",
    });
    await fixture.runtime.steerTurn({
      sessionId: "web-session-review-steer-1",
      message: "focus on tests only",
    });

    assert.deepEqual(state.reviews, [{
      threadId: "thread-app-review-steer-1",
      instructions: "please review current diff",
    }]);
    assert.deepEqual(state.readThreads, [{
      threadId: "thread-app-review-steer-1",
      includeTurns: true,
    }]);
    assert.deepEqual(state.steers, [{
      threadId: "thread-app-review-steer-1",
      turnId: "turn-app-active-1",
      message: "focus on tests only",
    }]);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会把 approval reverse request 转成等待中的 action，并在提交后回包", async () => {
  const actionBridge = new AppServerActionBridge();
  const approvalResolved = createDeferred();
  const { state, sessionFactory } = createSessionFactory({
    startTurn: async (sessionState) => {
      sessionState.serverRequestHandler?.({
        id: "server-approval-1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-app-approval-1",
          turnId: "turn-app-approval-1",
          itemId: "item-app-approval-1",
          approvalId: "approval-1",
          command: "rm -rf tmp",
          reason: "Need approval",
        },
      });
      await approvalResolved.promise;
      scheduleCompletedTurn(sessionState, "turn-app-approval-1", {
        threadId: "thread-app-approval-1",
      });
      return { turnId: "turn-app-approval-1" };
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });
  (fixture.runtime as unknown as { actionBridge: AppServerActionBridge }).actionBridge = actionBridge;
  let resolveActionRequired!: (value: {
    actionId?: string;
    actionType?: string;
    prompt?: string;
  }) => void;
  const actionRequiredPromise = new Promise<{
    actionId?: string;
    actionType?: string;
    prompt?: string;
  }>((resolve) => {
    resolveActionRequired = resolve;
  });
  const runTaskPromise = fixture.runtime.runTask({
    requestId: "req-app-approval-1",
    taskId: "task-app-approval-1",
    sourceChannel: "web",
    user: { userId: "webui" },
    goal: "please wait for approval",
    channelContext: { channelSessionKey: "web-session-approval-1" },
    createdAt: "2026-03-29T14:00:00.000Z",
  }, {
    onEvent: async (event) => {
      if (event.type === "task.action_required") {
        const actionRequired: {
          actionId?: string;
          actionType?: string;
          prompt?: string;
        } = {};

        if (typeof event.payload?.actionId === "string") {
          actionRequired.actionId = event.payload.actionId;
        }

        if (typeof event.payload?.actionType === "string") {
          actionRequired.actionType = event.payload.actionType;
        }

        if (typeof event.payload?.prompt === "string") {
          actionRequired.prompt = event.payload.prompt;
        }

        resolveActionRequired(actionRequired);
      }
    },
  });

  try {
    const actionRequired = await Promise.race([
      actionRequiredPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("missing action_required")), 80);
      }),
    ]);

    assert.equal(actionRequired.actionId, "approval-1");
    assert.equal(actionRequired.actionType, "approval");
    assert.match(actionRequired.prompt ?? "", /rm -rf tmp|Need approval/);
    assert.equal(actionBridge.find("approval-1", {
      sessionId: "web-session-approval-1",
      principalId: "principal-local-owner",
    })?.taskId, "task-app-approval-1");
    assert.equal(actionBridge.find("approval-1", {
      sessionId: "web-session-approval-1",
      principalId: "principal-other",
    }), null);

    actionBridge.resolve({
      taskId: "task-app-approval-1",
      requestId: "req-app-approval-1",
      actionId: "approval-1",
      decision: "approve",
    });
    approvalResolved.resolve();

    await runTaskPromise;
    assert.deepEqual(state.respondedServerRequests, [{
      id: "server-approval-1",
      result: {
        decision: "accept",
      },
    }]);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在 waiting action 所在任务 abort 后会清理 pending action", async () => {
  const actionBridge = new AppServerActionBridge();
  const controller = new AbortController();
  const actionRequiredSeen = createDeferred();
  const { state, sessionFactory } = createSessionFactory({
    startTurn: async (sessionState) => {
      sessionState.serverRequestHandler?.({
        id: "server-approval-abort-1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-app-abort-1",
          turnId: "turn-app-abort-1",
          itemId: "item-app-abort-1",
          approvalId: "approval-abort-1",
          command: "rm -rf tmp",
          reason: "Need approval",
        },
      });
      return { turnId: "turn-app-abort-1" };
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });
  (fixture.runtime as unknown as { actionBridge: AppServerActionBridge }).actionBridge = actionBridge;

  try {
    const runTaskPromise = fixture.runtime.runTask({
      requestId: "req-app-abort-1",
      taskId: "task-app-abort-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "please abort waiting action",
      channelContext: { channelSessionKey: "web-session-abort-1" },
      createdAt: "2026-03-29T14:10:00.000Z",
    }, {
      signal: controller.signal,
      onEvent: async (event) => {
        if (event.type === "task.action_required") {
          actionRequiredSeen.resolve();
        }
      },
    });

    await actionRequiredSeen.promise;
    controller.abort(new Error("ACTION_ABORT"));

    const result = await runTaskPromise;
    assert.equal(result.status, "cancelled");
    assert.equal(result.summary, "任务已被取消。");
    assert.equal(actionBridge.find("approval-abort-1"), null);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在 task.action_required 发射失败时会清理 pending action", async () => {
  const actionBridge = new AppServerActionBridge();
  const { state, sessionFactory } = createSessionFactory({
    startTurn: async (sessionState) => {
      sessionState.serverRequestHandler?.({
        id: "server-approval-leak-1",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-app-leak-1",
          turnId: "turn-app-leak-1",
          itemId: "item-app-leak-1",
          approvalId: "approval-leak-1",
          command: "rm -rf tmp",
          reason: "Need approval",
        },
      });
      return { turnId: "turn-app-leak-1" };
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });
  (fixture.runtime as unknown as { actionBridge: AppServerActionBridge }).actionBridge = actionBridge;

  try {
    await assert.rejects(async () => await fixture.runtime.runTask({
      requestId: "req-app-leak-1",
      taskId: "task-app-leak-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "emit failure should cleanup action",
      channelContext: { channelSessionKey: "web-session-leak-1" },
      createdAt: "2026-03-29T14:20:00.000Z",
    }, {
      onEvent: async (event) => {
        if (event.type === "task.action_required") {
          throw new Error("ACTION_REQUIRED_EMIT_FAILED");
        }
      },
    }), /ACTION_REQUIRED_EMIT_FAILED/);

    assert.equal(actionBridge.find("approval-leak-1"), null);
    assert.deepEqual(state.rejectedServerRequests, [{
      id: "server-approval-leak-1",
      message: "ACTION_REQUIRED_EMIT_FAILED",
    }]);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在找不到 active turn 时不会把 steer 落到已完成的旧 turn", async () => {
  const { sessionFactory } = createSessionFactory({
    readThread: async (threadId) => ({
      threadId,
      turnCount: 1,
      turns: [{ turnId: "turn-app-completed-1", status: "completed" }],
    }),
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    fixture.runtimeStore.saveSession({
      sessionId: "web-session-steer-no-active-1",
      threadId: "thread-app-steer-no-active-1",
      createdAt: "2026-03-29T12:00:00.000Z",
      updatedAt: "2026-03-29T12:00:00.000Z",
    });

    await assert.rejects(async () => await fixture.runtime.steerTurn({
      sessionId: "web-session-steer-no-active-1",
      message: "focus on tests only",
    }), /可引导的 app-server turn/);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会按顺序等待异步 onEvent，再进入 finalizeResult 和返回结果", async () => {
  const progressGate = createDeferred();
  let progressStarted!: () => void;
  const progressStartedPromise = new Promise<void>((resolve) => {
    progressStarted = resolve;
  });
  const order: string[] = [];
  const { sessionFactory } = createSessionFactory({
    startTurn: async (state) => {
      state.notificationHandler?.({
        method: "item/agentMessage/delta",
        params: {
          itemId: "item-app-3",
          delta: "hello from app server",
        },
      });
      scheduleCompletedTurn(state, "turn-app-3");
      return { turnId: "turn-app-3" };
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const runTaskPromise = fixture.runtime.runTask({
      requestId: "req-app-3",
      taskId: "task-app-3",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "hello",
      channelContext: { channelSessionKey: "web-session-events-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    }, {
      onEvent: async (event) => {
        if (event.type === "task.progress" && event.payload?.itemId === "item-app-3") {
          order.push("progress:start");
          progressStarted();
          await progressGate.promise;
          order.push("progress:end");
          return;
        }

        order.push(event.type);
      },
      finalizeResult: async (_request, result) => {
        order.push("finalize");
        return result;
      },
    }).then((result) => {
      order.push("returned");
      return result;
    });

    await progressStartedPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(order.includes("finalize"), false);

    progressGate.resolve();
    await runTaskPromise;

    assert.ok(order.indexOf("progress:end") < order.indexOf("finalize"));
    assert.ok(order.indexOf("finalize") < order.indexOf("returned"));
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会按 session workspace 解析执行目录", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startThreadId: "thread-app-workspace",
  });
  const fixture = createRuntimeFixture({ sessionFactory });
  const workspace = join(fixture.root, "workspace-session-1");
  mkdirSync(workspace, { recursive: true });

  try {
    fixture.runtimeStore.saveSessionTaskSettings({
      sessionId: "web-session-workspace-1",
      settings: {
        workspacePath: workspace,
      },
      createdAt: "2026-03-28T12:00:00.000Z",
      updatedAt: "2026-03-28T12:00:00.000Z",
    });

    await fixture.runtime.runTask({
      requestId: "req-app-4",
      taskId: "task-app-4",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "workspace",
      channelContext: { channelSessionKey: "web-session-workspace-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    });

    assert.equal(state.started.length, 1);
    assert.equal(state.started[0]?.cwd, workspace);
    assert.notEqual(state.started[0]?.cwd, fixture.root);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 会把同一 agentMessage item 的 delta 累计成完整文本并持久化", async () => {
  const progressEvents: Array<{ message: string | undefined; itemText: string | undefined }> = [];
  const { sessionFactory } = createSessionFactory({
    startTurn: async (state) => {
      state.notificationHandler?.({
        method: "item/agentMessage/delta",
        params: {
          itemId: "item-app-accumulate-1",
          delta: "你",
        },
      });
      state.notificationHandler?.({
        method: "item/agentMessage/delta",
        params: {
          itemId: "item-app-accumulate-1",
          delta: "好",
        },
      });
      state.notificationHandler?.({
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "msg-final-accumulate-1",
            text: "你好",
            phase: "final_answer",
            memoryCitation: null,
          },
          threadId: "thread-app-accumulate-1",
          turnId: "turn-app-accumulate-1",
        },
      });
      scheduleCompletedTurn(state, "turn-app-accumulate-1", {
        threadId: "thread-app-accumulate-1",
      });
      return { turnId: "turn-app-accumulate-1" };
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    await fixture.runtime.runTask({
      requestId: "req-app-accumulate-1",
      taskId: "task-app-accumulate-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "请打个招呼",
      channelContext: { channelSessionKey: "web-session-accumulate-1" },
      createdAt: "2026-04-01T10:15:00.000Z",
    }, {
      onEvent: async (event) => {
        if (event.type !== "task.progress") {
          return;
        }

        progressEvents.push({
          message: event.message,
          itemText: typeof event.payload?.itemText === "string" ? event.payload.itemText : undefined,
        });
      },
    });

    assert.deepEqual(progressEvents, [
      {
        message: "你",
        itemText: "你",
      },
      {
        message: "你好",
        itemText: "你好",
      },
    ]);

    const storedProgressEvents = fixture.runtimeStore
      .listTurnEvents("req-app-accumulate-1")
      .filter((event) => event.type === "task.progress");

    assert.equal(storedProgressEvents.length, 1);
    assert.equal(storedProgressEvents[0]?.message, "你好");
    assert.deepEqual(JSON.parse(storedProgressEvents[0]?.payloadJson ?? "{}"), {
      threadEventType: "item.completed",
      itemType: "agent_message",
      itemId: "item-app-accumulate-1",
      itemText: "你好",
    });
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在 onEvent 阻塞时也会响应外部 abort", { timeout: 400 }, async () => {
  const controller = new AbortController();
  const { state, sessionFactory } = createSessionFactory({
    startTurn: async () => ({ turnId: "turn-app-event-blocked" }),
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    setTimeout(() => {
      controller.abort(new Error("EVENT_QUEUE_ABORT"));
    }, 20);

    const result = await fixture.runtime.runTask({
      requestId: "req-app-5",
      taskId: "task-app-5",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "event blocked",
      channelContext: { channelSessionKey: "web-session-timeout-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    }, {
      signal: controller.signal,
      onEvent: async (event) => {
        if (event.type === "task.received") {
          await new Promise<void>(() => {});
        }
      },
    });

    assert.equal(result.status, "cancelled");
    assert.equal(result.summary, "任务已被取消。");
    assert.equal(state.factoryCalls, 0);
    assert.equal(state.initialized, 0);
    assert.equal(state.closed, 0);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 的 timeoutMs 会打断 event queue 阻塞", { timeout: 400 }, async () => {
  const { state, sessionFactory } = createSessionFactory({
    startTurn: async () => ({ turnId: "turn-app-event-timeout" }),
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const result = await fixture.runtime.runTask({
      requestId: "req-app-timeout-event-1",
      taskId: "task-app-timeout-event-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "event queue timeout",
      channelContext: { channelSessionKey: "web-session-timeout-event-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    }, {
      timeoutMs: 20,
      onEvent: async (event) => {
        if (event.type === "task.received") {
          await new Promise<void>(() => {});
        }
      },
    });

    assert.equal(result.status, "cancelled");
    assert.match(result.summary, /任务因超时被取消/);
    assert.equal(state.factoryCalls, 0);
    assert.equal(state.initialized, 0);
    assert.equal(state.closed, 0);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 的 timeoutMs 会打断 notification event queue 阻塞", { timeout: 400 }, async () => {
  const { state, sessionFactory } = createSessionFactory({
    startTurn: async (sessionState) => {
      sessionState.notificationHandler?.({
        method: "item/agentMessage/delta",
        params: {
          itemId: "item-app-timeout-notification",
          delta: "progress from notification",
        },
      });
      scheduleCompletedTurn(sessionState, "turn-app-notification-timeout");
      return { turnId: "turn-app-notification-timeout" };
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    const result = await fixture.runtime.runTask({
      requestId: "req-app-timeout-notification-1",
      taskId: "task-app-timeout-notification-1",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "notification queue timeout",
      channelContext: { channelSessionKey: "web-session-timeout-notification-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    }, {
      timeoutMs: 20,
      onEvent: async (event) => {
        if (event.type === "task.progress" && event.payload?.itemId === "item-app-timeout-notification") {
          await new Promise<void>(() => {});
        }
      },
    });

    assert.equal(result.status, "cancelled");
    assert.match(result.summary, /任务因超时被取消/);
    assert.equal(state.closed, 1);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 在执行失败时也会关闭 session", async () => {
  const { state, sessionFactory } = createSessionFactory({
    startTurn: async () => {
      throw new Error("turn failed");
    },
  });
  const fixture = createRuntimeFixture({ sessionFactory });

  try {
    await assert.rejects(async () => await fixture.runtime.runTask({
      requestId: "req-app-6",
      taskId: "task-app-6",
      sourceChannel: "web",
      user: { userId: "webui" },
      goal: "hello",
      channelContext: { channelSessionKey: "web-session-close-1" },
      createdAt: "2026-03-28T12:00:00.000Z",
    }), /turn failed/);

    assert.equal(state.closed, 1);
  } finally {
    fixture.cleanup();
  }
});

test("AppServerTaskRuntime 默认会为真实任务 session 打开 request_user_input feature gate", () => {
  assert.deepEqual(APP_SERVER_TASK_CONFIG_OVERRIDES, {
    "features.default_mode_request_user_input": true,
  });
});
