import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { ThemisServerRuntimeRegistry } from "./http-server.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: CodexTaskRuntime;
  authHeaders: Record<string, string>;
}

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
  createRuntimeRegistry?: (context: TestServerContext) => ThemisServerRuntimeRegistry | undefined,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-session-handlers-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const context: TestServerContext = {
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

test("POST /api/sessions/fork-context 在 app-server 会话下会优先原生 fork 并预绑定 target session", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const sessionId = "session-native-source-1";
    const sourceThreadId = "thread-native-source-1";
    const targetSessionId = "session-native-child-1";
    const request = buildTaskRequest({
      sessionId,
      requestId: "req-native-source-1",
      taskId: "task-native-source-1",
      createdAt: "2026-03-29T09:00:00.000Z",
    });

    runtimeStore.upsertTurnFromRequest(request, request.taskId!);
    runtimeStore.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId: request.requestId,
        taskId: request.taskId!,
        completedAt: "2026-03-29T09:00:30.000Z",
        structuredOutput: {
          session: {
            sessionId,
            threadId: sourceThreadId,
            engine: "app-server",
          },
        },
      }),
      sessionMode: "resumed",
      threadId: sourceThreadId,
    });

    const response = await fetch(`${baseUrl}/api/sessions/fork-context`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        sessionId,
        targetSessionId,
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      strategy?: string;
      sourceThreadId?: string;
      threadId?: string;
      targetSessionId?: string;
    };

    assert.deepEqual(payload, {
      ok: true,
      sessionId,
      targetSessionId,
      strategy: "native-thread-fork",
      sourceThreadId,
      threadId: "thread-native-child-1",
    });
    assert.equal(runtimeStore.getSession(targetSessionId)?.threadId, "thread-native-child-1");
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
        forkThread: async () => ({
          strategy: "native-thread-fork",
          sourceThreadId: "thread-native-source-1",
          threadId: "thread-native-child-1",
        }),
      },
    },
  }));
});

test("POST /api/sessions/fork-context 不允许覆盖已有 target session 的真实 thread 绑定", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const sourceSessionId = "session-native-source-2";
    const sourceThreadId = "thread-native-source-2";
    const targetSessionId = "session-native-existing-1";
    const sourceRequest = buildTaskRequest({
      sessionId: sourceSessionId,
      requestId: "req-native-source-2",
      taskId: "task-native-source-2",
      createdAt: "2026-03-29T10:00:00.000Z",
    });
    const targetRequest = buildTaskRequest({
      sessionId: targetSessionId,
      requestId: "req-native-target-1",
      taskId: "task-native-target-1",
      createdAt: "2026-03-29T10:10:00.000Z",
    });

    runtimeStore.upsertTurnFromRequest(sourceRequest, sourceRequest.taskId!);
    runtimeStore.completeTaskTurn({
      request: sourceRequest,
      result: buildTaskResult({
        requestId: sourceRequest.requestId,
        taskId: sourceRequest.taskId!,
        completedAt: "2026-03-29T10:00:30.000Z",
        structuredOutput: {
          session: {
            sessionId: sourceSessionId,
            threadId: sourceThreadId,
            engine: "app-server",
          },
        },
      }),
      sessionMode: "resumed",
      threadId: sourceThreadId,
    });

    runtimeStore.upsertTurnFromRequest(targetRequest, targetRequest.taskId!);
    runtimeStore.saveSession({
      sessionId: targetSessionId,
      threadId: "thread-native-existing-1",
      createdAt: "2026-03-29T10:10:00.000Z",
      updatedAt: "2026-03-29T10:10:30.000Z",
    });
    runtimeStore.completeTaskTurn({
      request: targetRequest,
      result: buildTaskResult({
        requestId: targetRequest.requestId,
        taskId: targetRequest.taskId!,
        completedAt: "2026-03-29T10:10:30.000Z",
        structuredOutput: {
          session: {
            sessionId: targetSessionId,
            threadId: "thread-native-existing-1",
            engine: "app-server",
          },
        },
      }),
      sessionMode: "resumed",
      threadId: "thread-native-existing-1",
    });

    const response = await fetch(`${baseUrl}/api/sessions/fork-context`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        sessionId: sourceSessionId,
        targetSessionId,
      }),
    });

    assert.equal(response.status, 409);
    const payload = await response.json() as {
      error?: {
        code?: string;
      };
    };
    assert.equal(payload.error?.code, "SESSION_CONFLICT");
    assert.equal(runtimeStore.getSession(targetSessionId)?.threadId, "thread-native-existing-1");
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
        forkThread: async () => ({
          strategy: "native-thread-fork",
          sourceThreadId: "thread-native-source-2",
          threadId: "thread-native-should-not-bind",
        }),
      },
    },
  }));
});

test("POST /api/sessions/fork-context 在历史 sdk 会话且 optimistic 条件具备时会借 app-server runtime 走 native fork", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const sessionId = "session-sdk-source-1";
    const sourceThreadId = "thread-sdk-source-1";
    const targetSessionId = "session-sdk-child-1";
    const request = buildTaskRequest({
      sessionId,
      requestId: "req-sdk-source-1",
      taskId: "task-sdk-source-1",
      createdAt: "2026-03-30T13:00:00.000Z",
    });

    runtimeStore.upsertTurnFromRequest(request, request.taskId!);
    runtimeStore.completeTaskTurn({
      request,
      result: buildTaskResult({
        requestId: request.requestId,
        taskId: request.taskId!,
        completedAt: "2026-03-30T13:00:30.000Z",
        structuredOutput: {
          session: {
            sessionId,
            threadId: sourceThreadId,
            engine: "sdk",
          },
        },
      }),
      sessionMode: "resumed",
      threadId: sourceThreadId,
    });

    const response = await fetch(`${baseUrl}/api/sessions/fork-context`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        sessionId,
        targetSessionId,
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      ok?: boolean;
      sessionId?: string;
      strategy?: string;
      sourceThreadId?: string;
      targetSessionId?: string;
      threadId?: string;
    };

    assert.deepEqual(payload, {
      ok: true,
      sessionId,
      targetSessionId,
      strategy: "native-thread-fork",
      sourceThreadId,
      threadId: "thread-sdk-child-1",
    });
    assert.equal(runtimeStore.getSession(targetSessionId)?.threadId, "thread-sdk-child-1");
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
        forkThread: async () => ({
          strategy: "native-thread-fork",
          sourceThreadId: "thread-sdk-source-1",
          threadId: "thread-sdk-child-1",
        }),
      },
    },
  }));
});

function buildTaskRequest(overrides: {
  sessionId: string;
  requestId: string;
  taskId: string;
  createdAt: string;
}) {
  return {
    requestId: overrides.requestId,
    taskId: overrides.taskId,
    sourceChannel: "web",
    user: {
      userId: "web-user",
    },
    goal: "seed native session",
    channelContext: {
      sessionId: overrides.sessionId,
    },
    createdAt: overrides.createdAt,
  };
}

function buildTaskResult(overrides: {
  requestId: string;
  taskId: string;
  completedAt: string;
  structuredOutput: Record<string, unknown>;
}) {
  return {
    taskId: overrides.taskId,
    requestId: overrides.requestId,
    status: "completed" as const,
    summary: "seed native result",
    structuredOutput: overrides.structuredOutput,
    completedAt: overrides.completedAt,
  };
}

async function listenServer(server: Server): Promise<Server> {
  return await new Promise<Server>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
