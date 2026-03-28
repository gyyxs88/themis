import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  AppServerTaskRuntimeOptions,
  AppServerTaskRuntimeSession,
} from "./app-server-task-runtime.js";
import { AppServerTaskRuntime } from "./app-server-task-runtime.js";

interface SessionDoubleState {
  initialized: number;
  started: Array<{ cwd: string }>;
  resumed: Array<{ threadId: string; cwd: string }>;
  closed: number;
  notificationHandler: ((notification: { method: string; params?: unknown }) => void) | null;
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
  resumeThreadId?: string;
  startTurn?: (state: SessionDoubleState) => Promise<{ turnId: string }>;
  close?: (state: SessionDoubleState) => Promise<void>;
} = {}): {
  state: SessionDoubleState;
  sessionFactory: AppServerTaskRuntimeOptions["sessionFactory"];
} {
  const state: SessionDoubleState = {
    initialized: 0,
    started: [],
    resumed: [],
    closed: 0,
    notificationHandler: null,
  };

  return {
    state,
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {
        state.initialized += 1;
      },
      startThread: async (params) => {
        state.started.push({ cwd: params.cwd });
        return { threadId: overrides.startThreadId ?? "thread-app-start" };
      },
      resumeThread: async (threadId, params) => {
        state.resumed.push({ threadId, cwd: params.cwd });
        return { threadId: overrides.resumeThreadId ?? threadId };
      },
      startTurn: async () => {
        if (overrides.startTurn) {
          return await overrides.startTurn(state);
        }
        return { turnId: "turn-app-1" };
      },
      close: async () => {
        state.closed += 1;
        await overrides.close?.(state);
      },
      onNotification: (handler) => {
        state.notificationHandler = handler;
      },
      onServerRequest: () => {},
    }),
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
