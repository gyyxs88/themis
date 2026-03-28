import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppServerTaskRuntimeOptions,
  AppServerTaskRuntimeSession,
} from "./app-server-task-runtime.js";
import { AppServerTaskRuntime } from "./app-server-task-runtime.js";

function createRuntime(overrides: {
  sessionFactory?: AppServerTaskRuntimeOptions["sessionFactory"];
} = {}) {
  return new AppServerTaskRuntime({
    workingDirectory: process.cwd(),
    sessionFactory: overrides.sessionFactory ?? (async () => ({
      initialize: async () => {},
      startThread: async () => ({ threadId: "thread-app-1" }),
      resumeThread: async () => ({ threadId: "thread-app-1" }),
      startTurn: async () => ({ turnId: "turn-app-1" }),
      close: async () => {},
      onNotification: () => {},
      onServerRequest: () => {},
    })),
  });
}

test("AppServerTaskRuntime 会按现有 TaskResult 契约收口普通 Web 任务", async () => {
  const runtime = createRuntime();

  const result = await runtime.runTask({
    requestId: "req-app-1",
    taskId: "task-app-1",
    sourceChannel: "web",
    user: { userId: "webui" },
    goal: "hello",
    channelContext: { sessionId: "session-app-1" },
    createdAt: "2026-03-28T12:00:00.000Z",
  });

  assert.equal(result.status, "completed");
  assert.ok(result.structuredOutput?.session);
});

test("AppServerTaskRuntime 会把 app-server notification 翻译成 task.progress 事件", async () => {
  let notificationHandler: ((notification: { method: string; params?: unknown }) => void) | null = null;
  const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  const runtime = createRuntime({
    sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
      initialize: async () => {},
      startThread: async () => ({ threadId: "thread-app-2" }),
      resumeThread: async () => ({ threadId: "thread-app-2" }),
      startTurn: async () => {
        notificationHandler?.({
          method: "item/agentMessage/delta",
          params: {
            itemId: "item-app-1",
            delta: "hello from app server",
          },
        });
        return { turnId: "turn-app-2" };
      },
      close: async () => {},
      onNotification: (handler: (notification: { method: string; params?: unknown }) => void) => {
        notificationHandler = handler;
      },
      onServerRequest: () => {},
    }),
  });

  await runtime.runTask({
    requestId: "req-app-2",
    taskId: "task-app-2",
    sourceChannel: "web",
    user: { userId: "webui" },
    goal: "hello",
    channelContext: {},
    createdAt: "2026-03-28T12:00:00.000Z",
  }, {
    onEvent: (event) => {
      if (event.payload) {
        events.push({
          type: event.type,
          payload: event.payload,
        });
        return;
      }

      events.push({
        type: event.type,
      });
    },
  });

  assert.ok(events.some((event) => event.type === "task.progress" && event.payload?.itemId === "item-app-1"));
});

test("AppServerTaskRuntime 会应用 finalizeResult 钩子", async () => {
  const runtime = createRuntime();

  const result = await runtime.runTask({
    requestId: "req-app-3",
    taskId: "task-app-3",
    sourceChannel: "web",
    user: { userId: "webui" },
    goal: "hello",
    channelContext: {},
    createdAt: "2026-03-28T12:00:00.000Z",
  }, {
    finalizeResult: (_request, taskResult) => ({
      ...taskResult,
      summary: "finalized",
    }),
  });

  assert.equal(result.summary, "finalized");
});

test("AppServerTaskRuntime 在执行失败时也会关闭 session", async () => {
  let closed = false;
  const runtime = createRuntime({
    sessionFactory: async () => ({
      initialize: async () => {},
      startThread: async () => ({ threadId: "thread-app-4" }),
      resumeThread: async () => ({ threadId: "thread-app-4" }),
      startTurn: async () => {
        throw new Error("turn failed");
      },
      close: async () => {
        closed = true;
      },
      onNotification: () => {},
      onServerRequest: () => {},
    }),
  });

  await assert.rejects(async () => runtime.runTask({
    requestId: "req-app-4",
    taskId: "task-app-4",
    sourceChannel: "web",
    user: { userId: "webui" },
    goal: "hello",
    channelContext: {},
    createdAt: "2026-03-28T12:00:00.000Z",
  }), /turn failed/);

  assert.equal(closed, true);
});
