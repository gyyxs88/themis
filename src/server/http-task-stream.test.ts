import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { AppServerTaskRuntime, type AppServerTaskRuntimeSession } from "../core/app-server-task-runtime.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { handleTaskStream } from "./http-task-handlers.js";
import { createThemisHttpServer, type ThemisServerRuntimeRegistry } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: CodexTaskRuntime;
}

interface AppServerSessionDoubleState {
  started: Array<{ cwd: string }>;
  resumed: Array<{ threadId: string; cwd: string }>;
}

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
  authSnapshot: {
    authenticated: boolean;
    requiresOpenaiAuth: boolean;
  } = {
    authenticated: false,
    requiresOpenaiAuth: false,
  },
  createRuntimeRegistry?: (context: Omit<TestServerContext, "baseUrl">) => ThemisServerRuntimeRegistry | undefined,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-stream-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const authRuntime = createAuthRuntime(authSnapshot);
  const runtimeRegistry = createRuntimeRegistry?.({
    root,
    runtimeStore,
    runtime,
  });
  const server = createThemisHttpServer({
    runtime,
    ...(runtimeRegistry ? { runtimeRegistry } : {}),
    authRuntime,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run({
      baseUrl,
      root,
      runtimeStore,
      runtime,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

test("/api/tasks/stream 会按 ack -> event* -> result -> done 顺序返回 NDJSON", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (request, hooks = {}) => {
      const { onEvent } = hooks;

      await onEvent?.({
        eventId: "event-stream-1",
        taskId: request.taskId ?? "task-stream-1",
        requestId: request.requestId,
        type: "task.started",
        status: "running",
        message: "任务已开始",
        timestamp: "2026-03-28T09:00:00.000Z",
      });

      return {
        taskId: request.taskId ?? "task-stream-1",
        requestId: request.requestId,
        status: "completed",
        summary: "任务已完成",
        output: "stream output",
        touchedFiles: ["src/server/http-task-stream.test.ts"],
        structuredOutput: {
          reply: "ok",
        },
        completedAt: "2026-03-28T09:00:01.000Z",
      };
    };

    const response = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查流式顺序",
        sessionId: "session-task-stream-order",
      }),
    });

    assert.equal(response.status, 200);

    const lines = parseNdjson(await response.text());
    assert.deepEqual(lines.map((line) => line.kind), ["ack", "event", "result", "done"]);

    const done = lines[3];
    assert.deepEqual(done?.result, {
      status: "completed",
      summary: "任务已完成",
      output: "stream output",
      touchedFiles: ["src/server/http-task-stream.test.ts"],
      structuredOutput: {
        reply: "ok",
      },
    });
  }, {
    authenticated: false,
    requiresOpenaiAuth: false,
  }, ({ runtime }) => ({
    defaultRuntime: runtime,
    runtimes: {
      sdk: runtime,
    },
  }));
});

test("/api/tasks/stream 会按 runtimeEngine 选择对应 runtime，并保持 NDJSON 契约", async () => {
  let appServerState: AppServerSessionDoubleState | null = null;

  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (request) => ({
      taskId: request.taskId ?? "task-stream-runtime-engine-sdk",
      requestId: request.requestId,
      status: "completed",
      summary: "sdk runtime finished",
      structuredOutput: {
        runtimeEngine: "sdk",
      },
      completedAt: "2026-03-28T09:00:01.000Z",
    });

    for (const runtimeEngine of ["sdk", "app-server"] as const) {
      const response = await fetch(`${baseUrl}/api/tasks/stream`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          goal: `请检查 ${runtimeEngine} stream parity`,
          sessionId: `session-task-stream-engine-${runtimeEngine}`,
          options: {
            runtimeEngine,
          },
        }),
      });

      assert.equal(response.status, 200);

      const lines = parseNdjson(await response.text());
      assert.deepEqual(lines.slice(0, 1).map((line) => line.kind), ["ack"]);
      assert.ok(lines.some((line) => line.kind === "result"));
      assert.deepEqual(lines.slice(-1).map((line) => line.kind), ["done"]);

      const result = lines.find((line) => line.kind === "result");
      assert.equal(result?.metadata && typeof result.metadata === "object"
        ? (result.metadata as { structuredOutput?: { runtimeEngine?: string; session?: { engine?: string } } }).structuredOutput?.runtimeEngine
          ?? (result.metadata as { structuredOutput?: { runtimeEngine?: string; session?: { engine?: string } } }).structuredOutput?.session?.engine
        : undefined,
      runtimeEngine);
    }

    assert.equal(appServerState?.started.length, 1);
    assert.equal(appServerState?.resumed.length, 0);
  }, {
    authenticated: false,
    requiresOpenaiAuth: false,
  }, ({ root, runtimeStore, runtime }) => {
    appServerState = createAppServerSessionDoubleState();
    const currentAppServerState = appServerState;
    const appServerRuntime = new AppServerTaskRuntime({
      workingDirectory: root,
      runtimeStore,
      sessionFactory: async (): Promise<AppServerTaskRuntimeSession> => ({
        initialize: async () => {},
        startThread: async (params) => {
          currentAppServerState.started.push({ cwd: params.cwd });
          return { threadId: "thread-app-server-stream-1" };
        },
        resumeThread: async (threadId, params) => {
          currentAppServerState.resumed.push({ threadId, cwd: params.cwd });
          return { threadId };
        },
        startTurn: async () => ({ turnId: "turn-app-server-stream-1" }),
        close: async () => {},
        onNotification: () => {},
        onServerRequest: () => {},
      }),
    });

    return {
      defaultRuntime: runtime,
      runtimes: {
        "app-server": appServerRuntime,
      },
    };
  });
});

test("/api/tasks/stream 在未传 runtimeRegistry 时默认走内建 app-server runtime", async () => {
  let sdkCalls = 0;
  let appServerCalls = 0;
  const originalAppServerRunTask = AppServerTaskRuntime.prototype.runTask;

  AppServerTaskRuntime.prototype.runTask = async function patchedRunTask(request) {
    appServerCalls += 1;
    return {
      taskId: request.taskId ?? "task-app-default-built-in-1",
      requestId: request.requestId,
      status: "completed",
      summary: "built-in app-server default",
      structuredOutput: {
        session: {
          engine: "app-server",
        },
      },
      completedAt: "2026-03-29T16:00:00.000Z",
    };
  };

  try {
    await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
      const authHeaders = await createAuthenticatedWebHeaders({
        baseUrl,
        runtimeStore,
      });

      (runtime as CodexTaskRuntime & {
        runTask: CodexTaskRuntime["runTask"];
      }).runTask = async (request) => {
        sdkCalls += 1;
        return {
          taskId: request.taskId ?? "task-sdk-should-not-run",
          requestId: request.requestId,
          status: "completed",
          summary: "sdk should not run",
          completedAt: "2026-03-29T16:00:01.000Z",
        };
      };

      const response = await fetch(`${baseUrl}/api/tasks/stream`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          goal: "请走内建 app-server runtime",
          sessionId: "session-http-built-in-default-runtime-1",
        }),
      });

      assert.equal(response.status, 200);

      const lines = parseNdjson(await response.text());
      const result = lines.find((line) => line.kind === "result");
      assert.equal(appServerCalls, 1);
      assert.equal(sdkCalls, 0);
      assert.equal(
        (result?.metadata as { structuredOutput?: { session?: { engine?: string } } } | undefined)?.structuredOutput?.session?.engine,
        "app-server",
      );
    }, {
      authenticated: true,
      requiresOpenaiAuth: true,
    });
  } finally {
    AppServerTaskRuntime.prototype.runTask = originalAppServerRunTask;
  }
});

test("/api/tasks/stream 未显式传 runtimeEngine 时会遵循 runtimeRegistry.defaultRuntime", async () => {
  let appServerCalls = 0;

  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请走默认 app-server runtime",
        sessionId: "session-http-default-runtime-1",
      }),
    });

    assert.equal(response.status, 200);

    const lines = parseNdjson(await response.text());
    const result = lines.find((line) => line.kind === "result");
    assert.equal(appServerCalls, 1);
    assert.equal(
      (result?.metadata as { structuredOutput?: { session?: { engine?: string } } } | undefined)?.structuredOutput?.session?.engine,
      "app-server",
    );
  }, {
    authenticated: true,
    requiresOpenaiAuth: true,
  }, ({ runtimeStore, runtime }) => {
    const appServerRuntime = {
      runTask: async (request: Parameters<CodexTaskRuntime["runTask"]>[0]) => {
        appServerCalls += 1;
        return {
          taskId: request.taskId ?? "task-app-default-1",
          requestId: request.requestId,
          status: "completed" as const,
          summary: "app-server default",
          structuredOutput: {
            session: {
              engine: "app-server",
            },
          },
          completedAt: "2026-03-29T15:00:00.000Z",
        };
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => runtime.getIdentityLinkService(),
      getPrincipalSkillsService: () => runtime.getPrincipalSkillsService(),
    };

    return {
      defaultRuntime: appServerRuntime,
      runtimes: {
        sdk: runtime,
        "app-server": appServerRuntime,
      },
    };
  });
});

test("/api/tasks/stream 显式请求未注册的 app-server runtime 时会 fail-fast，不会静默回退到 sdk", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    let sdkRunCount = 0;

    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (request) => {
      sdkRunCount += 1;
      return {
        taskId: request.taskId ?? "task-stream-missing-runtime",
        requestId: request.requestId,
        status: "completed",
        summary: "should not run",
        completedAt: "2026-03-28T09:00:01.000Z",
      };
    };

    const response = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查未注册 runtime fail-fast",
        sessionId: "session-task-stream-missing-runtime",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(response.status, 200);

    const lines = parseNdjson(await response.text());
    assert.deepEqual(lines.map((line) => line.kind), ["error", "fatal"]);
    assert.equal(lines[0]?.title, "INVALID_REQUEST");
    assert.match(String(lines[0]?.text ?? ""), /app-server|runtime/i);
    assert.equal(sdkRunCount, 0);
  }, {
    authenticated: false,
    requiresOpenaiAuth: false,
  }, ({ runtime }) => ({
    defaultRuntime: runtime,
    runtimes: {
      sdk: runtime,
    },
  }));
});

test("/api/tasks/stream 显式传非法 runtimeEngine 时会返回 INVALID_REQUEST", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    let sdkRunCount = 0;

    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (request) => {
      sdkRunCount += 1;
      return {
        taskId: request.taskId ?? "task-stream-invalid-runtime",
        requestId: request.requestId,
        status: "completed",
        summary: "should not run",
        completedAt: "2026-03-28T09:00:01.000Z",
      };
    };

    const response = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查非法 runtimeEngine",
        sessionId: "session-task-stream-invalid-runtime",
        options: {
          runtimeEngine: "bogus-engine",
        },
      }),
    });

    assert.equal(response.status, 200);

    const lines = parseNdjson(await response.text());
    assert.deepEqual(lines.map((line) => line.kind), ["error", "fatal"]);
    assert.equal(lines[0]?.title, "INVALID_REQUEST");
    assert.match(String(lines[0]?.text ?? ""), /runtimeEngine|bogus-engine/i);
    assert.equal(sdkRunCount, 0);
  });
});

test("/api/tasks/stream 在 runtime.runTask() 抛错时会先 ack，再 error，最后 fatal，并正常结束", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async () => {
      throw new Error("runtime exploded");
    };

    const response = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请模拟运行时异常",
        sessionId: "session-task-stream-runtime-error",
      }),
    });

    assert.equal(response.status, 200);

    const lines = parseNdjson(await response.text());
    assert.deepEqual(lines.map((line) => line.kind), ["ack", "error", "fatal"]);
    assert.equal(lines[1]?.title, "CORE_RUNTIME_ERROR");
    assert.equal(lines[2]?.title, "CORE_RUNTIME_ERROR");
  }, {
    authenticated: false,
    requiresOpenaiAuth: false,
  }, ({ runtime }) => ({
    defaultRuntime: runtime,
    runtimes: {
      sdk: runtime,
    },
  }));
});

test("/api/tasks/stream 在认证前置失败时不会发 ack，但会发 adapter error 和 fatal", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请模拟认证失败",
        sessionId: "session-task-stream-auth-failed",
      }),
    });

    assert.equal(response.status, 200);

    const lines = parseNdjson(await response.text());
    assert.deepEqual(lines.map((line) => line.kind), ["error", "fatal"]);
    assert.equal(lines[0]?.title, "AUTH_REQUIRED");
    assert.equal(lines[1]?.title, "AUTH_REQUIRED");
  }, {
    authenticated: false,
    requiresOpenaiAuth: true,
  });
});

test("handleTaskStream 在 close 后会中止任务并停止继续写流", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-stream-disconnect-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const authRuntime = createAuthRuntime({
    authenticated: false,
    requiresOpenaiAuth: false,
  });
  const request = createTaskStreamRequest({
    goal: "请检查断连流程",
    sessionId: "session-task-stream-disconnect",
  });
  const response = createTaskStreamResponse(() => {
    queueMicrotask(() => {
      request.emit("close");
    });
  });
  let abortMessage: string | null = null;

  try {
    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (taskRequest, hooks = {}) => {
      const { onEvent, signal } = hooks;
      assert.ok(signal);

      const aborted = new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          abortMessage = signal.reason instanceof Error
            ? signal.reason.message
            : String(signal.reason);
          resolve();
        }, { once: true });
      });

      await onEvent?.({
        eventId: "event-disconnect-1",
        taskId: taskRequest.taskId ?? "task-stream-disconnect",
        requestId: taskRequest.requestId,
        type: "task.started",
        status: "running",
        message: "任务已开始",
        timestamp: "2026-03-28T09:00:00.000Z",
      });

      await aborted;

      return {
        taskId: taskRequest.taskId ?? "task-stream-disconnect",
        requestId: taskRequest.requestId,
        status: "cancelled",
        summary: "任务已取消",
        completedAt: "2026-03-28T09:00:01.000Z",
      };
    };

    await handleTaskStream(
      request as unknown as import("node:http").IncomingMessage,
      response as unknown as import("node:http").ServerResponse,
      runtime,
      {
        defaultRuntime: runtime,
      },
      authRuntime,
      5_000,
    );

    assert.equal(abortMessage, "CLIENT_DISCONNECTED");

    const lines = parseNdjson(response.lines.join(""));
    assert.deepEqual(lines.map((line) => line.kind), ["ack", "event"]);
    assert.equal(lines.some((line) => line.kind === "result"), false);
    assert.equal(lines.some((line) => line.kind === "done"), false);
    assert.equal(lines.some((line) => line.kind === "fatal"), false);

    const cancelled = runtimeStore.listWebAuditEvents().find((event) => event.eventType === "web_access.task_cancelled");
    assert.ok(cancelled);
    assert.equal(cancelled?.remoteIp, "127.0.0.1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function parseNdjson(body: string): Array<{ kind?: string; title?: string; text?: unknown; result?: unknown; metadata?: unknown }> {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind?: string; title?: string; text?: unknown; result?: unknown; metadata?: unknown });
}

function createAuthRuntime(snapshot: {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
}): CodexAuthRuntime {
  return {
    readSnapshot: async () => snapshot,
    readThirdPartyProviderProfile: () => null,
  } as unknown as CodexAuthRuntime;
}

function createTaskStreamRequest(payload: Record<string, unknown>): PassThrough {
  const request = new PassThrough();
  request.end(`${JSON.stringify(payload)}\n`);
  (request as PassThrough & {
    socket: { remoteAddress?: string };
  }).socket = {
    remoteAddress: "127.0.0.1",
  };

  return request;
}

function createAppServerSessionDoubleState(): AppServerSessionDoubleState {
  return {
    started: [],
    resumed: [],
  };
}

function createTaskStreamResponse(onFirstWrite: () => void): TaskStreamResponseStub {
  return new TaskStreamResponseStub(onFirstWrite);
}

class TaskStreamResponseStub extends EventEmitter {
  statusCode = 0;
  destroyed = false;
  writableEnded = false;
  readonly lines: string[] = [];
  private wroteFirstChunk = false;

  constructor(private readonly onFirstWrite: () => void) {
    super();
  }

  setHeader(_name: string, _value: string | number | readonly string[]): void {}

  write(chunk: unknown): boolean {
    this.lines.push(String(chunk));

    if (!this.wroteFirstChunk) {
      this.wroteFirstChunk = true;
      this.onFirstWrite();
    }

    return true;
  }

  end(): void {
    this.writableEnded = true;
  }
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
