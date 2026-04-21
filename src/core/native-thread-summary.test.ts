import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest, TaskResult, TaskRuntimeFacade, TaskRuntimeRegistry } from "../types/index.js";
import { readSessionNativeThreadSummary } from "./native-thread-summary.js";

const BASE_TIME = Date.UTC(2026, 2, 30, 10, 0, 0);

test("readSessionNativeThreadSummary 会返回 app-server thread 的完整摘要", async () => {
  await withRuntimeStore(async (store) => {
    const sessionId = "session-native-1";
    const requestId = "request-native-1";
    const taskId = "task-native-1";
    const threadId = "thread-native-1";
    const request = buildTaskRequest({
      sessionId,
      requestId,
      taskId,
      createdAt: timestamp(0),
    });

    store.upsertTurnFromRequest(request, taskId);
    store.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId,
        taskId,
        completedAt: timestamp(1),
        structuredOutput: {
          session: {
            engine: "app-server",
            threadId,
          },
        },
      }),
      sessionMode: "resumed",
      threadId,
    });

    const summary = await readSessionNativeThreadSummary(store, sessionId, createRuntimeRegistry(store, {
      readThreadSnapshot: async () => ({
        threadId,
        preview: "mobile thread preview",
        status: "running",
        cwd: "/workspace/themis",
        createdAt: timestamp(0),
        updatedAt: timestamp(1),
        turnCount: 4,
        turns: [],
      }),
    }));

    assert.deepEqual(summary, {
      engine: "app-server",
      threadId,
      preview: "mobile thread preview",
      status: "running",
      cwd: "/workspace/themis",
      turnCount: 4,
    });
  });
});

test("readSessionNativeThreadSummary 会把历史 sdk thread 归并成 app-server 摘要", async () => {
  await withRuntimeStore(async (store) => {
    const sessionId = "session-native-sdk";
    const request = buildTaskRequest({
      sessionId,
      requestId: "request-native-sdk",
      taskId: "task-native-sdk",
      createdAt: timestamp(2),
    });

    store.upsertTurnFromRequest(request, request.taskId ?? "task-native-sdk");
    store.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId: request.requestId,
        taskId: request.taskId ?? "task-native-sdk",
        completedAt: timestamp(3),
        structuredOutput: {
          session: {
            engine: "sdk",
            threadId: "thread-sdk-1",
          },
        },
      }),
      sessionMode: "resumed",
      threadId: "thread-sdk-1",
    });

    const summary = await readSessionNativeThreadSummary(store, sessionId, createRuntimeRegistry(store, {
      readThreadSnapshot: async () => ({
        threadId: "thread-sdk-1",
        turnCount: 1,
        turns: [],
      }),
    }));

    assert.deepEqual(summary, {
      engine: "app-server",
      threadId: "thread-sdk-1",
      turnCount: 1,
    });
  });
});

test("readSessionNativeThreadSummary 在 runtime 读取异常时返回 null", async () => {
  await withRuntimeStore(async (store) => {
    const sessionId = "session-native-error";
    const requestId = "request-native-error";
    const taskId = "task-native-error";
    const threadId = "thread-native-error";
    const request = buildTaskRequest({
      sessionId,
      requestId,
      taskId,
      createdAt: timestamp(4),
    });

    store.upsertTurnFromRequest(request, taskId);
    store.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId,
        taskId,
        completedAt: timestamp(5),
        structuredOutput: {
          session: {
            engine: "app-server",
            threadId,
          },
        },
      }),
      sessionMode: "resumed",
      threadId,
    });

    const summary = await readSessionNativeThreadSummary(store, sessionId, createRuntimeRegistry(store, {
      readThreadSnapshot: async () => {
        throw new Error("snapshot unavailable");
      },
    }));

    assert.equal(summary, null);
  });
});

test("readSessionNativeThreadSummary 在仅有预绑定 threadId 的进行中会话里也能回退读取 app-server 摘要", async () => {
  await withRuntimeStore(async (store) => {
    const sessionId = "session-native-prebound";
    const threadId = "thread-native-prebound";

    store.saveSession({
      sessionId,
      threadId,
      createdAt: timestamp(6),
      updatedAt: timestamp(7),
    });

    const summary = await readSessionNativeThreadSummary(store, sessionId, createRuntimeRegistry(store, {
      readThreadSnapshot: async () => ({
        threadId,
        preview: "prebound running thread",
        status: "running",
        cwd: "/workspace/prebound",
        createdAt: timestamp(6),
        updatedAt: timestamp(7),
        turnCount: 1,
        turns: [],
      }),
    }));

    assert.deepEqual(summary, {
      engine: "app-server",
      threadId,
      preview: "prebound running thread",
      status: "running",
      cwd: "/workspace/prebound",
      turnCount: 1,
    });
  });
});

async function withRuntimeStore(
  run: (store: SqliteCodexSessionRegistry) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-native-thread-summary-"));
  const store = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    await run(store);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function createRuntimeRegistry(
  store: SqliteCodexSessionRegistry,
  overrides: Partial<TaskRuntimeFacade> = {},
): TaskRuntimeRegistry {
  const runtime = {
    runTask: async () => {
      throw new Error("runTask should not be called in native thread summary tests");
    },
    getRuntimeStore: () => store,
    getIdentityLinkService: () => ({}),
    getPrincipalSkillsService: () => ({}),
    ...overrides,
  } satisfies TaskRuntimeFacade;

  return {
    defaultRuntime: runtime,
    runtimes: {
      "app-server": runtime,
    },
  };
}

function buildTaskRequest(input: {
  sessionId: string;
  requestId: string;
  taskId: string;
  createdAt: string;
}): TaskRequest {
  return {
    requestId: input.requestId,
    taskId: input.taskId,
    sourceChannel: "web",
    user: {
      userId: "native-thread-user",
    },
    goal: `Task for ${input.sessionId}`,
    channelContext: {
      sessionId: input.sessionId,
    },
    createdAt: input.createdAt,
  };
}

function buildTaskResult(input: {
  requestId: string;
  taskId: string;
  structuredOutput?: TaskResult["structuredOutput"];
  completedAt: string;
}): TaskResult {
  return {
    requestId: input.requestId,
    taskId: input.taskId,
    status: "completed",
    summary: "native thread summary test completed",
    ...(input.structuredOutput ? { structuredOutput: input.structuredOutput } : {}),
    completedAt: input.completedAt,
  };
}

function timestamp(offsetMinutes: number): string {
  return new Date(BASE_TIME + (offsetMinutes * 60_000)).toISOString();
}
