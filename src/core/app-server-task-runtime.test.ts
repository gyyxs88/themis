import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { AppServerActionBridge } from "./app-server-action-bridge.js";
import type {
  AppServerTaskRuntimeOptions,
  AppServerTaskRuntimeSession,
} from "./app-server-task-runtime.js";
import {
  APP_SERVER_TASK_CONFIG_OVERRIDES,
  AppServerTaskRuntime,
} from "./app-server-task-runtime.js";

interface SessionDoubleState {
  initialized: number;
  factoryCalls: number;
  started: Array<{ cwd: string }>;
  resumed: Array<{ threadId: string; cwd: string }>;
  turns: Array<{
    threadId: string;
    prompt: string | null;
    input: string | Array<{
      type: "text" | "image";
      text?: string;
      text_elements?: [];
      assetPath?: string;
      mimeType?: string;
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

function createRuntimeFixture(overrides: {
  sessionFactory?: AppServerTaskRuntimeOptions["sessionFactory"];
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "themis-app-server-runtime-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
    ...(overrides.sessionFactory ? { sessionFactory: overrides.sessionFactory } : {}),
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

function createSessionFactory(overrides: {
  startThreadId?: string;
  startThread?: (
    params: { cwd: string },
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
        state.started.push({ cwd: params.cwd });
        if (overrides.startThread) {
          return await overrides.startThread({ cwd: params.cwd }, state);
        }
        return { threadId: overrides.startThreadId ?? "thread-app-start" };
      },
      resumeThread: async (threadId, params) => {
        state.resumed.push({ threadId, cwd: params.cwd });
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

function readSessionPayload(result: Awaited<ReturnType<AppServerTaskRuntime["runTask"]>>): {
  sessionId: string | null;
  threadId: string;
  engine: string;
} {
  return result.structuredOutput?.session as {
    sessionId: string | null;
    threadId: string;
    engine: string;
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
    assert.equal(readSessionPayload(result).threadId, "thread-app-created");
    assert.equal(fixture.runtimeStore.resolveThreadId("web-session-created-1"), "thread-app-created");
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
            localPath: "/workspace/temp/input-assets/shot.png",
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
      type: "text" | "image";
      text?: string;
      assetPath?: string;
      mimeType?: string;
    }>;
    assert.equal(input[0]?.type, "text");
    assert.match(input[0]?.text ?? "", /帮我看图/);
    assert.equal(input.some((part) => part.type === "image"), true);
    assert.equal(
      input.find((part) => part.type === "image")?.assetPath,
      "/workspace/temp/input-assets/shot.png",
    );
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

    await assert.rejects(async () => await runTaskPromise, /ACTION_ABORT/);
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

    await assert.rejects(async () => await fixture.runtime.runTask({
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
    }), /EVENT_QUEUE_ABORT/);

    assert.equal(state.closed, 1);
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
    await assert.rejects(async () => await fixture.runtime.runTask({
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
    }), /TASK_TIMEOUT:/);

    assert.equal(state.closed, 1);
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
    await assert.rejects(async () => await fixture.runtime.runTask({
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
    }), /TASK_TIMEOUT:/);

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
