import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskEvent, TaskRequest, TaskResult } from "../types/index.js";
import { createThemisHttpServer, type ThemisServerRuntimeRegistry } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: AppServerTaskRuntime;
  authHeaders: Record<string, string>;
}

const HISTORY_SESSION_COUNT = 101;
const HISTORY_BASE_TIME = Date.UTC(2026, 2, 28, 10, 0, 0);

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
  createRuntimeRegistry?: (context: TestServerContext) => ThemisServerRuntimeRegistry | undefined,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-history-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const context = {
    baseUrl: "",
    root,
    runtimeStore,
    runtime,
    authHeaders: {},
  };
  const runtimeRegistry = createRuntimeRegistry?.(context);
  const server = createThemisHttpServer({
    runtime,
    ...(runtimeRegistry ? { runtimeRegistry } : {}),
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeaders = await createAuthenticatedWebHeaders({
    baseUrl,
    runtimeStore,
  });

  try {
    await run({
      baseUrl,
      root,
      runtimeStore,
      runtime,
      authHeaders,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

test("GET /api/history/sessions 会使用默认 limit、拒绝非法 limit 并截断上限", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    await seedRecentSessions(runtimeStore, HISTORY_SESSION_COUNT);

    const defaultResponse = await fetch(`${baseUrl}/api/history/sessions`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(defaultResponse.status, 200);
    const defaultPayload = await defaultResponse.json() as {
      sessions?: Array<{
        sessionId?: string;
      }>;
    };
    assert.equal(defaultPayload.sessions?.length, 24);
    assert.equal(defaultPayload.sessions?.[0]?.sessionId, "session-history-101");
    assert.equal(defaultPayload.sessions?.at(-1)?.sessionId, "session-history-078");

    const invalidResponse = await fetch(`${baseUrl}/api/history/sessions?limit=abc`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(invalidResponse.status, 200);
    const invalidPayload = await invalidResponse.json() as {
      sessions?: Array<{
        sessionId?: string;
      }>;
    };
    assert.equal(invalidPayload.sessions?.length, 24);

    const clampedResponse = await fetch(`${baseUrl}/api/history/sessions?limit=200`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(clampedResponse.status, 200);
    const clampedPayload = await clampedResponse.json() as {
      sessions?: Array<{
        sessionId?: string;
      }>;
    };
    assert.equal(clampedPayload.sessions?.length, 100);
    assert.equal(clampedPayload.sessions?.[0]?.sessionId, "session-history-101");
    assert.equal(clampedPayload.sessions?.at(-1)?.sessionId, "session-history-002");
  });
});

test("GET /api/history/sessions 与 archive 接口会支持 query/originKind/includeArchived", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    await seedRecentSessions(runtimeStore, 3);
    runtimeStore.saveSessionHistoryMetadata({
      sessionId: "session-history-002",
      originKind: "fork",
      originSessionId: "session-history-001",
      originLabel: "fork 自 session-history-001",
      createdAt: timestamp(120),
      updatedAt: timestamp(120),
    });
    runtimeStore.archiveSessionHistory("session-history-003", timestamp(121));

    const filteredResponse = await fetch(`${baseUrl}/api/history/sessions?query=fork%20%E8%87%AA%20session-history-001&originKind=fork`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(filteredResponse.status, 200);
    const filteredPayload = await filteredResponse.json() as {
      sessions?: Array<{
        sessionId?: string;
        originKind?: string;
        originSessionId?: string;
        originLabel?: string;
      }>;
    };
    assert.deepEqual(filteredPayload.sessions?.map((item) => item.sessionId), ["session-history-002"]);
    assert.equal(filteredPayload.sessions?.[0]?.originKind, "fork");
    assert.equal(filteredPayload.sessions?.[0]?.originSessionId, "session-history-001");
    assert.equal(filteredPayload.sessions?.[0]?.originLabel, "fork 自 session-history-001");

    const defaultResponse = await fetch(`${baseUrl}/api/history/sessions?limit=10`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(defaultResponse.status, 200);
    const defaultPayload = await defaultResponse.json() as {
      sessions?: Array<{
        sessionId?: string;
      }>;
    };
    assert.deepEqual(defaultPayload.sessions?.map((item) => item.sessionId), [
      "session-history-002",
      "session-history-001",
    ]);

    const archivedResponse = await fetch(`${baseUrl}/api/history/sessions?includeArchived=1&query=session-history-003`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(archivedResponse.status, 200);
    const archivedPayload = await archivedResponse.json() as {
      sessions?: Array<{
        sessionId?: string;
        archivedAt?: string;
      }>;
    };
    assert.equal(archivedPayload.sessions?.some((item) => item.sessionId === "session-history-003"), true);
    assert.equal(
      archivedPayload.sessions?.find((item) => item.sessionId === "session-history-003")?.archivedAt,
      timestamp(121),
    );

    const detailResponse = await fetch(`${baseUrl}/api/history/sessions/session-history-002`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      session?: {
        originKind?: string;
        originSessionId?: string;
        originLabel?: string;
      };
    };
    assert.equal(detailPayload.session?.originKind, "fork");
    assert.equal(detailPayload.session?.originSessionId, "session-history-001");
    assert.equal(detailPayload.session?.originLabel, "fork 自 session-history-001");

    const archiveResponse = await fetch(`${baseUrl}/api/history/sessions/session-history-001/archive`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(archiveResponse.status, 200);
    const archivePayload = await archiveResponse.json() as {
      session?: {
        sessionId?: string;
        archivedAt?: string;
      };
    };
    assert.equal(archivePayload.session?.sessionId, "session-history-001");
    assert.ok(typeof archivePayload.session?.archivedAt === "string");

    const unarchiveResponse = await fetch(`${baseUrl}/api/history/sessions/session-history-001/archive`, {
      method: "DELETE",
      headers: authHeaders,
    });
    assert.equal(unarchiveResponse.status, 200);
    const unarchivePayload = await unarchiveResponse.json() as {
      session?: {
        sessionId?: string;
        archivedAt?: string | null;
      };
    };
    assert.equal(unarchivePayload.session?.sessionId, "session-history-001");
    assert.equal(unarchivePayload.session?.archivedAt ?? null, null);
  });
});

test("GET /api/history/sessions/:id 会返回 400 / 404 / 200，并带上 events 和 touchedFiles", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const sessionId = "session-history-detail";
    const requestId = "request-history-detail";
    const taskId = "task-history-detail";
    const request = buildTaskRequest({
      sessionId,
      requestId,
      taskId,
      createdAt: timestamp(20),
    });

    runtimeStore.upsertTurnFromRequest(request, taskId);
    runtimeStore.appendTaskEvent(buildTaskEvent({
      requestId,
      taskId,
      type: "task.accepted",
      status: "running",
      timestamp: timestamp(21),
    }));
    runtimeStore.appendTaskEvent(buildTaskEvent({
      requestId,
      taskId,
      type: "task.started",
      status: "running",
      timestamp: timestamp(22),
    }));
    runtimeStore.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId,
        taskId,
        touchedFiles: [
          "/workspace/src/a.ts",
          "/workspace/src/b.ts",
        ],
        completedAt: timestamp(23),
      }),
      sessionMode: "resumed",
      threadId: "thread-history-detail",
    });

    const invalidResponse = await fetch(`${baseUrl}/api/history/sessions/%20%20`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(invalidResponse.status, 400);
    const invalidPayload = await invalidResponse.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(invalidPayload.error?.code, "INVALID_REQUEST");
    assert.equal(invalidPayload.error?.message, "Missing session id.");

    const notFoundResponse = await fetch(`${baseUrl}/api/history/sessions/session-history-missing`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(notFoundResponse.status, 404);
    const notFoundPayload = await notFoundResponse.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(notFoundPayload.error?.code, "NOT_FOUND");
    assert.equal(notFoundPayload.error?.message, "No stored history was found for this session.");

    const response = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      session?: {
        sessionId?: string;
        turnCount?: number;
      };
      turns?: Array<{
        requestId?: string;
        events?: Array<{
          eventId?: string;
          type?: string;
          status?: string;
        }>;
        touchedFiles?: string[];
      }>;
    };

    assert.equal(payload.session?.sessionId, sessionId);
    assert.equal(payload.session?.turnCount, 1);
    assert.equal(payload.turns?.length, 1);
    assert.equal(payload.turns?.[0]?.requestId, requestId);
    assert.deepEqual(payload.turns?.[0]?.events?.map((event) => event.type), [
      "task.accepted",
      "task.started",
    ]);
    assert.deepEqual(payload.turns?.[0]?.events?.map((event) => event.status), [
      "running",
      "running",
    ]);
    assert.deepEqual(payload.turns?.[0]?.touchedFiles, [
      "/workspace/src/a.ts",
      "/workspace/src/b.ts",
    ]);
  });
});

test("GET /api/history/sessions/:id 在 app-server 会话下会附加 nativeThread 增强数据", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const sessionId = "session-history-native";
    const requestId = "request-history-native";
    const taskId = "task-history-native";
    const request = buildTaskRequest({
      sessionId,
      requestId,
      taskId,
      createdAt: timestamp(60),
    });

    runtimeStore.upsertTurnFromRequest(request, taskId);
    runtimeStore.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId,
        taskId,
        completedAt: timestamp(61),
        structuredOutput: {
          session: {
            engine: "app-server",
            threadId: "thread-history-native",
          },
        },
      }),
      sessionMode: "resumed",
      threadId: "thread-history-native",
    });

    const response = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      nativeThread?: {
        threadId?: string;
        preview?: string;
        turnCount?: number;
      };
    };

    assert.deepEqual(payload.nativeThread, {
      threadId: "thread-history-native",
      preview: "native preview",
      turnCount: 2,
    });
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => {
        throw new Error("default runtime should not run");
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
    runtimes: {
      "app-server": {
        runTask: async () => {
          throw new Error("app-server runTask should not run");
        },
        getRuntimeStore: () => runtimeStore,
        getIdentityLinkService: () => ({}),
        getPrincipalSkillsService: () => ({}),
        readThreadSnapshot: async () => ({
          threadId: "thread-history-native",
          preview: "native preview",
          status: "idle",
          cwd: "/workspace/native",
          createdAt: "2026-03-29T12:00:00.000Z",
          updatedAt: "2026-03-29T12:30:00.000Z",
          turnCount: 2,
          turns: [],
        }),
      },
    },
  }));
});

test("GET /api/history/sessions/:id 在最新 failed turn 未写 engine 时仍保留 nativeThread 增强", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const sessionId = "session-history-native-failed";
    const threadId = "thread-history-native-failed-1";
    const completedRequestId = "request-history-native-completed";
    const completedTaskId = "task-history-native-completed";
    const failedRequestId = "request-history-native-failed";
    const failedTaskId = "task-history-native-failed";
    const completedRequest = buildTaskRequest({
      sessionId,
      requestId: completedRequestId,
      taskId: completedTaskId,
      createdAt: timestamp(62),
    });
    const failedRequest = buildTaskRequest({
      sessionId,
      requestId: failedRequestId,
      taskId: failedTaskId,
      createdAt: timestamp(63),
    });

    runtimeStore.upsertTurnFromRequest(completedRequest, completedTaskId);
    runtimeStore.completeTaskTurn({
      request: completedRequest,
      result: buildTaskResult({
        requestId: completedRequestId,
        taskId: completedTaskId,
        completedAt: timestamp(62, 30),
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

    runtimeStore.upsertTurnFromRequest(failedRequest, failedTaskId);
    runtimeStore.failTaskTurn({
      request: failedRequest,
      taskId: failedTaskId,
      message: "app-server turn failed",
      completedAt: timestamp(63, 30),
      sessionMode: "resumed",
      threadId,
    });
    runtimeStore.saveSession({
      sessionId,
      threadId,
      createdAt: timestamp(62),
      updatedAt: timestamp(63, 30),
    });

    const response = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      nativeThread?: {
        threadId?: string;
        preview?: string;
        turnCount?: number;
      };
    };

    assert.deepEqual(payload.nativeThread, {
      threadId,
      preview: "failed but still native",
      turnCount: 2,
    });
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => {
        throw new Error("default runtime should not run");
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
    runtimes: {
      "app-server": {
        runTask: async () => {
          throw new Error("app-server runTask should not run");
        },
        getRuntimeStore: () => runtimeStore,
        getIdentityLinkService: () => ({}),
        getPrincipalSkillsService: () => ({}),
        readThreadSnapshot: async () => ({
          threadId: "thread-history-native-failed-1",
          preview: "failed but still native",
          status: "idle",
          cwd: "/workspace/native",
          createdAt: "2026-03-29T12:00:00.000Z",
          updatedAt: "2026-03-29T12:30:00.000Z",
          turnCount: 2,
          turns: [],
        }),
      },
    },
  }));
});

test("HEAD /api/history/sessions 与 HEAD /api/history/sessions/:id 不返回 body", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const sessionId = "session-history-head";
    const requestId = "request-history-head";
    const taskId = "task-history-head";
    const request = buildTaskRequest({
      sessionId,
      requestId,
      taskId,
      createdAt: timestamp(40),
    });

    runtimeStore.upsertTurnFromRequest(request, taskId);
    runtimeStore.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId,
        taskId,
        completedAt: timestamp(41),
      }),
    });

    const listResponse = await fetch(`${baseUrl}/api/history/sessions`, {
      method: "HEAD",
      headers: authHeaders,
    });
    assert.equal(listResponse.status, 200);
    assert.equal(await listResponse.text(), "");

    const detailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "HEAD",
      headers: authHeaders,
    });
    assert.equal(detailResponse.status, 200);
    assert.equal(await detailResponse.text(), "");
  });
});

test("HEAD /api/history/sessions/:id/archive 不会修改归档状态", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const sessionId = "session-history-head-archive";
    const requestId = "request-history-head-archive";
    const taskId = "task-history-head-archive";
    const request = buildTaskRequest({
      sessionId,
      requestId,
      taskId,
      createdAt: timestamp(42),
    });

    runtimeStore.upsertTurnFromRequest(request, taskId);
    runtimeStore.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId,
        taskId,
        completedAt: timestamp(43),
      }),
    });

    const archiveResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}/archive`, {
      method: "HEAD",
      headers: authHeaders,
    });
    assert.equal(archiveResponse.status, 200);
    assert.equal(await archiveResponse.text(), "");

    const detailResponse = await fetch(`${baseUrl}/api/history/sessions/${sessionId}`, {
      method: "GET",
      headers: authHeaders,
    });
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json() as {
      session?: {
        sessionId?: string;
        archivedAt?: string | null;
      };
    };
    assert.equal(detailPayload.session?.sessionId, sessionId);
    assert.equal(detailPayload.session?.archivedAt ?? null, null);
  });
});

async function seedRecentSessions(store: SqliteCodexSessionRegistry, count: number): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    const sessionId = formatSessionId(index);
    const requestId = `request-history-${formatSessionId(index)}`;
    const taskId = `task-history-${formatSessionId(index)}`;
    const request = buildTaskRequest({
      sessionId,
      requestId,
      taskId,
      createdAt: timestamp(index),
    });

    store.upsertTurnFromRequest(request, taskId);
    store.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId,
        taskId,
        completedAt: timestamp(index, 30),
      }),
    });
  }
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
      userId: "user-history",
      displayName: "History User",
    },
    goal: `History test ${input.sessionId}`,
    channelContext: {
      sessionId: input.sessionId,
    },
    createdAt: input.createdAt,
  };
}

function buildTaskEvent(input: {
  requestId: string;
  taskId: string;
  type: TaskEvent["type"];
  status: TaskEvent["status"];
  timestamp: string;
}): TaskEvent {
  return {
    eventId: `${input.requestId}-${input.type}-${input.timestamp}`,
    requestId: input.requestId,
    taskId: input.taskId,
    type: input.type,
    status: input.status,
    timestamp: input.timestamp,
  };
}

function buildTaskResult(input: {
  requestId: string;
  taskId: string;
  touchedFiles?: string[];
  structuredOutput?: TaskResult["structuredOutput"];
  completedAt: string;
}): TaskResult {
  return {
    requestId: input.requestId,
    taskId: input.taskId,
    status: "completed",
    summary: "History test completed.",
    ...(input.touchedFiles ? { touchedFiles: input.touchedFiles } : {}),
    ...(input.structuredOutput ? { structuredOutput: input.structuredOutput } : {}),
    completedAt: input.completedAt,
  };
}

function formatSessionId(index: number): string {
  return `session-history-${index.toString().padStart(3, "0")}`;
}

function timestamp(offsetMinutes: number, offsetSeconds = 0): string {
  return new Date(HISTORY_BASE_TIME + (offsetMinutes * 60_000) + (offsetSeconds * 1_000)).toISOString();
}

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
