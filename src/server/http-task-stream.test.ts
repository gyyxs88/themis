import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
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

test("/api/tasks/stream 显式传 runtimeEngine 为 null 时会返回 INVALID_REQUEST 且不执行任何 runtime", async () => {
  let defaultRuntimeRunCount = 0;
  let sdkRunCount = 0;

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
        goal: "请检查 runtimeEngine 为 null 的情况",
        sessionId: "session-task-stream-null-runtime",
        options: {
          runtimeEngine: null,
        },
      }),
    });

    assert.equal(response.status, 200);

    const lines = parseNdjson(await response.text());
    assert.deepEqual(lines.map((line) => line.kind), ["error", "fatal"]);
    assert.equal(lines[0]?.title, "INVALID_REQUEST");
    assert.match(String(lines[0]?.text ?? ""), /Invalid runtimeEngine: null/);
    assert.equal(defaultRuntimeRunCount, 0);
    assert.equal(sdkRunCount, 0);
  }, {
    authenticated: false,
    requiresOpenaiAuth: false,
  }, ({ runtimeStore, runtime }) => {
    const defaultRuntime = {
      runTask: async (request: Parameters<CodexTaskRuntime["runTask"]>[0]) => {
        defaultRuntimeRunCount += 1;
        return {
          taskId: request.taskId ?? "task-stream-null-runtime-default",
          requestId: request.requestId,
          status: "completed" as const,
          summary: "default runtime should not run",
          completedAt: "2026-03-28T09:00:01.000Z",
        };
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => runtime.getIdentityLinkService(),
      getPrincipalSkillsService: () => runtime.getPrincipalSkillsService(),
    };

    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (request) => {
      sdkRunCount += 1;
      return {
        taskId: request.taskId ?? "task-stream-null-runtime-sdk",
        requestId: request.requestId,
        status: "completed",
        summary: "sdk runtime should not run",
        completedAt: "2026-03-28T09:00:01.000Z",
      };
    };

    return {
      defaultRuntime,
      runtimes: {
        sdk: runtime,
        "app-server": defaultRuntime,
      },
    };
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
      new AppServerActionBridge(),
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

test("handleTaskStream 在 task.action_required 后 close 不会中止 waiting action，并保留 pending action 供后续提交", async () => {
  let capturedTaskId = "";
  let capturedRequestId = "";
  let abortMessage: string | null = null;
  const actionBridge = new AppServerActionBridge();
  let resolveRuntimeCompleted!: () => void;
  const runtimeCompleted = new Promise<void>((resolve) => {
    resolveRuntimeCompleted = resolve;
  });

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
        goal: "请在等待 action 时断开连接",
        sessionId: "session-task-stream-action-disconnect",
      }),
    });

    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = createNdjsonStreamReader(response.body!);
    const partialLines = await reader.readUntil((lines) => lines.some((line) => line.title === "task.action_required"));
    const actionRequiredLine = partialLines.find((line) => line.title === "task.action_required");

    assert.ok(actionRequiredLine);
    await reader.cancel();

    await waitFor(() => capturedTaskId.length > 0 && capturedRequestId.length > 0);
    await waitFor(() => actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-detached-1") !== null);

    assert.equal(abortMessage, null);
    assert.ok(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-detached-1"));

    assert.equal(actionBridge.resolve({
      taskId: capturedTaskId,
      requestId: capturedRequestId,
      actionId: "approval-detached-1",
      decision: "approve",
    }), true);

    await runtimeCompleted;

    assert.equal(abortMessage, null);
    assert.equal(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-detached-1"), null);
  }, {
    authenticated: false,
    requiresOpenaiAuth: false,
  }, ({ runtimeStore, runtime }) => {
    const actionRuntime = {
      runTask: async (taskRequest: Parameters<CodexTaskRuntime["runTask"]>[0], hooks: Parameters<CodexTaskRuntime["runTask"]>[1] = {}) => {
        const { onEvent, signal } = hooks;
        assert.ok(signal);
        capturedTaskId = taskRequest.taskId ?? "task-stream-action-disconnect";
        capturedRequestId = taskRequest.requestId;

        const action = actionBridge.register({
          taskId: capturedTaskId,
          requestId: capturedRequestId,
          actionId: "approval-detached-1",
          actionType: "approval",
          prompt: "Need approval",
        });
        const submission = actionBridge.waitForSubmission(capturedTaskId, capturedRequestId, action.actionId);
        assert.ok(submission);

        signal.addEventListener("abort", () => {
          abortMessage = signal.reason instanceof Error
            ? signal.reason.message
            : String(signal.reason);
          actionBridge.discard(capturedTaskId, capturedRequestId, action.actionId);
        }, { once: true });

        await onEvent?.({
          eventId: "event-action-required-1",
          taskId: capturedTaskId,
          requestId: capturedRequestId,
          type: "task.action_required",
          status: "waiting",
          message: "Need approval",
          payload: {
            actionId: action.actionId,
            actionType: action.actionType,
          },
          timestamp: "2026-03-29T09:00:00.000Z",
        });

        const payload = await submission;
        resolveRuntimeCompleted();

        return {
          taskId: capturedTaskId,
          requestId: capturedRequestId,
          status: signal.aborted ? "cancelled" as const : "completed" as const,
          summary: signal.aborted ? "任务已取消" : `已处理 ${payload.decision}`,
          completedAt: "2026-03-29T09:00:02.000Z",
        };
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => runtime.getIdentityLinkService(),
      getPrincipalSkillsService: () => runtime.getPrincipalSkillsService(),
    };

    return {
      defaultRuntime: actionRuntime,
      runtimes: {
        sdk: runtime,
      },
    };
  });
});

test("handleTaskStream 在 user-input task.action_required 后 close 不会丢失 pending action，后续 inputText 提交仍能收口", async () => {
  let capturedTaskId = "";
  let capturedRequestId = "";
  let abortMessage: string | null = null;
  const actionBridge = new AppServerActionBridge();
  let resolveRuntimeCompleted!: () => void;
  const runtimeCompleted = new Promise<void>((resolve) => {
    resolveRuntimeCompleted = resolve;
  });

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
        goal: "请在等待补充输入时断开连接",
        sessionId: "session-task-stream-input-disconnect",
      }),
    });

    assert.equal(response.status, 200);
    assert.ok(response.body);

    const reader = createNdjsonStreamReader(response.body!);
    const partialLines = await reader.readUntil((lines) => lines.some((line) => line.title === "task.action_required"));
    const actionRequiredLine = partialLines.find((line) => line.title === "task.action_required");

    assert.ok(actionRequiredLine);
    await reader.cancel();

    await waitFor(() => capturedTaskId.length > 0 && capturedRequestId.length > 0);
    await waitFor(() => actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "input-detached-1") !== null);

    assert.equal(abortMessage, null);
    assert.ok(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "input-detached-1"));

    assert.equal(actionBridge.resolve({
      taskId: capturedTaskId,
      requestId: capturedRequestId,
      actionId: "input-detached-1",
      inputText: "补充 detached 输入",
    }), true);

    await runtimeCompleted;

    assert.equal(abortMessage, null);
    assert.equal(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "input-detached-1"), null);
  }, {
    authenticated: false,
    requiresOpenaiAuth: false,
  }, ({ runtimeStore, runtime }) => {
    const inputRuntime = {
      runTask: async (taskRequest: Parameters<CodexTaskRuntime["runTask"]>[0], hooks: Parameters<CodexTaskRuntime["runTask"]>[1] = {}) => {
        const { onEvent, signal } = hooks;
        assert.ok(signal);
        capturedTaskId = taskRequest.taskId ?? "task-stream-input-disconnect";
        capturedRequestId = taskRequest.requestId;

        const action = actionBridge.register({
          taskId: capturedTaskId,
          requestId: capturedRequestId,
          actionId: "input-detached-1",
          actionType: "user-input",
          prompt: "Please add detail",
        });
        const submission = actionBridge.waitForSubmission(capturedTaskId, capturedRequestId, action.actionId);
        assert.ok(submission);

        signal.addEventListener("abort", () => {
          abortMessage = signal.reason instanceof Error
            ? signal.reason.message
            : String(signal.reason);
          actionBridge.discard(capturedTaskId, capturedRequestId, action.actionId);
        }, { once: true });

        await onEvent?.({
          eventId: "event-input-required-1",
          taskId: capturedTaskId,
          requestId: capturedRequestId,
          type: "task.action_required",
          status: "waiting",
          message: "Please add detail",
          payload: {
            actionId: action.actionId,
            actionType: action.actionType,
          },
          timestamp: "2026-03-31T09:00:00.000Z",
        });

        const payload = await submission;
        assert.equal(payload.inputText, "补充 detached 输入");
        resolveRuntimeCompleted();

        return {
          taskId: capturedTaskId,
          requestId: capturedRequestId,
          status: signal.aborted ? "cancelled" as const : "completed" as const,
          summary: signal.aborted ? "任务已取消" : `已处理 ${payload.inputText}`,
          completedAt: "2026-03-31T09:00:02.000Z",
        };
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => runtime.getIdentityLinkService(),
      getPrincipalSkillsService: () => runtime.getPrincipalSkillsService(),
    };

    return {
      defaultRuntime: inputRuntime,
      runtimes: {
        sdk: runtime,
      },
    };
  });
});

test("handleTaskStream 在 pending action resolve 后再次 close 会恢复 CLIENT_DISCONNECTED", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-stream-recovery-window-"));
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
  const actionBridge = new AppServerActionBridge();
  const request = createTaskStreamRequest({
    goal: "请检查恢复窗口结束后再次断流",
    sessionId: "session-task-stream-recovery-window",
  });
  const response = createTaskStreamResponse();
  let abortMessage: string | null = null;
  let capturedTaskId = "";
  let capturedRequestId = "";
  let resolveActionReady!: () => void;
  const actionReady = new Promise<void>((resolve) => {
    resolveActionReady = resolve;
  });
  let resolveSubmissionObserved!: () => void;
  const submissionObserved = new Promise<void>((resolve) => {
    resolveSubmissionObserved = resolve;
  });
  let releaseCompletion!: () => void;
  const completionGate = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });

  try {
    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (taskRequest, hooks = {}) => {
      const { onEvent, signal } = hooks;
      assert.ok(signal);
      capturedTaskId = taskRequest.taskId ?? "task-stream-recovery-window";
      capturedRequestId = taskRequest.requestId;

      signal.addEventListener("abort", () => {
        abortMessage = signal.reason instanceof Error
          ? signal.reason.message
          : String(signal.reason);
      }, { once: true });

      const action = actionBridge.register({
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        actionId: "approval-window-1",
        actionType: "approval",
        prompt: "Need approval",
      });
      const submission = actionBridge.waitForSubmission(capturedTaskId, capturedRequestId, action.actionId);
      assert.ok(submission);

      await onEvent?.({
        eventId: "event-recovery-window-1",
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        type: "task.action_required",
        status: "waiting",
        message: "Need approval",
        payload: {
          actionId: action.actionId,
          actionType: action.actionType,
        },
        timestamp: "2026-03-29T09:00:00.000Z",
      });
      resolveActionReady();

      await submission;
      resolveSubmissionObserved();
      await completionGate;

      return {
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        status: signal.aborted ? "cancelled" : "completed",
        summary: signal.aborted ? "任务已取消" : "任务已完成",
        completedAt: "2026-03-29T09:00:02.000Z",
      };
    };

    const streamPromise = handleTaskStream(
      request as unknown as import("node:http").IncomingMessage,
      response as unknown as import("node:http").ServerResponse,
      runtime,
      {
        defaultRuntime: runtime,
      },
      authRuntime,
      actionBridge,
      5_000,
    );

    await actionReady;
    assert.ok(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-window-1"));

    response.emit("close");
    assert.equal(abortMessage, null);

    assert.equal(actionBridge.resolve({
      taskId: capturedTaskId,
      requestId: capturedRequestId,
      actionId: "approval-window-1",
      decision: "approve",
    }), true);

    await submissionObserved;
    assert.equal(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-window-1"), null);

    response.emit("close");
    assert.equal(abortMessage, "CLIENT_DISCONNECTED");

    releaseCompletion();
    await streamPromise;

    assert.equal(abortMessage, "CLIENT_DISCONNECTED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("handleTaskStream 在 approval resolve 后立刻 close 时会给第二轮 user-input 留恢复窗口", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-stream-detached-mixed-window-"));
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
  const actionBridge = new AppServerActionBridge();
  const request = createTaskStreamRequest({
    goal: "请验证 detached mixed recovery grace window",
    sessionId: "session-task-stream-detached-mixed-window",
  });
  const response = createTaskStreamResponse();
  let abortMessage: string | null = null;
  let capturedTaskId = "";
  let capturedRequestId = "";
  let releaseSecondAction!: () => void;
  const secondActionGate = new Promise<void>((resolve) => {
    releaseSecondAction = resolve;
  });
  let streamFailure: unknown = null;

  try {
    (runtime as CodexTaskRuntime & { runTask: CodexTaskRuntime["runTask"] }).runTask = async (taskRequest, hooks = {}) => {
      const { onEvent, signal } = hooks;
      assert.ok(signal);
      capturedTaskId = taskRequest.taskId ?? "task-stream-detached-mixed-window";
      capturedRequestId = taskRequest.requestId;

      signal.addEventListener("abort", () => {
        abortMessage = signal.reason instanceof Error ? signal.reason.message : String(signal.reason);
      }, { once: true });

      const approval = actionBridge.register({
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        actionId: "approval-detached-mixed-1",
        actionType: "approval",
        prompt: "Need approval 1",
      });
      const approvalSubmission = actionBridge.waitForSubmission(capturedTaskId, capturedRequestId, approval.actionId);
      assert.ok(approvalSubmission);

      await onEvent?.({
        eventId: "event-detached-mixed-approval-1",
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        type: "task.action_required",
        status: "waiting",
        message: "Need approval 1",
        payload: {
          actionId: approval.actionId,
          actionType: approval.actionType,
        },
        timestamp: "2026-03-31T12:00:00.000Z",
      });

      await approvalSubmission;
      await secondActionGate;

      const input = actionBridge.register({
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        actionId: "input-detached-mixed-2",
        actionType: "user-input",
        prompt: "Need final input",
      });
      const inputSubmission = actionBridge.waitForSubmission(capturedTaskId, capturedRequestId, input.actionId);
      assert.ok(inputSubmission);

      await onEvent?.({
        eventId: "event-detached-mixed-input-2",
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        type: "task.action_required",
        status: "waiting",
        message: "Need final input",
        payload: {
          actionId: input.actionId,
          actionType: input.actionType,
        },
        timestamp: "2026-03-31T12:00:01.000Z",
      });

      const inputPayload = await inputSubmission;
      assert.equal(inputPayload.inputText, "来自飞书的恢复补充");

      return {
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        status: "completed",
        summary: "detached mixed recovery completed",
        completedAt: "2026-03-31T12:00:02.000Z",
      };
    };
    const streamPromise = handleTaskStream(
      request as unknown as import("node:http").IncomingMessage,
      response as unknown as import("node:http").ServerResponse,
      runtime,
      { defaultRuntime: runtime },
      authRuntime,
      actionBridge,
      5_000,
    );
    const streamCompletion = streamPromise.then(
      () => undefined,
      (error) => {
        streamFailure = error;
      },
    );

    await waitFor(
      () => actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-detached-mixed-1") !== null,
      "approval detached mixed action did not register",
    );

    assert.equal(actionBridge.resolve({
      taskId: capturedTaskId,
      requestId: capturedRequestId,
      actionId: "approval-detached-mixed-1",
      decision: "approve",
    }), true);

    response.emit("close");
    releaseSecondAction();

    await waitFor(
      () => actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "input-detached-mixed-2") !== null,
      "second detached mixed user-input action did not register",
    );

    assert.equal(abortMessage, null);

    assert.equal(actionBridge.resolve({
      taskId: capturedTaskId,
      requestId: capturedRequestId,
      actionId: "input-detached-mixed-2",
      inputText: "来自飞书的恢复补充",
    }), true);

    await streamCompletion;
    assert.equal(streamFailure, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("handleTaskStream 在连续两轮 task.action_required 下会把恢复窗口滚到第二轮", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-stream-double-recovery-window-"));
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
  const actionBridge = new AppServerActionBridge();
  const request = createTaskStreamRequest({
    goal: "请检查连续 action 恢复窗口",
    sessionId: "session-task-stream-double-recovery-window",
  });
  let capturedTaskId = "";
  let capturedRequestId = "";
  let abortMessage: string | null = null;
  let firstActionReady!: () => void;
  let secondActionReady!: () => void;
  const firstActionObserved = new Promise<void>((resolve) => {
    firstActionReady = resolve;
  });
  const secondActionObserved = new Promise<void>((resolve) => {
    secondActionReady = resolve;
  });
  let firstCloseDone = false;
  const response = createTaskStreamResponse(({ chunk }) => {
    const line = parseNdjson(String(chunk))[0];

    if (line?.title === "task.action_required" && line?.metadata && typeof line.metadata === "object") {
      const actionId = String((line.metadata as { actionId?: string }).actionId ?? "");

      if (actionId === "approval-window-1" && !firstCloseDone) {
        firstCloseDone = true;
        queueMicrotask(() => {
          request.emit("close");
        });
      }
    }
  });

  try {
    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (taskRequest, hooks = {}) => {
      const { onEvent, signal } = hooks;
      assert.ok(signal);
      capturedTaskId = taskRequest.taskId ?? "task-stream-double-recovery-window";
      capturedRequestId = taskRequest.requestId;

      signal.addEventListener("abort", () => {
        abortMessage = signal.reason instanceof Error
          ? signal.reason.message
          : String(signal.reason);
      }, { once: true });

      const firstAction = actionBridge.register({
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        actionId: "approval-window-1",
        actionType: "approval",
        prompt: "Need approval 1",
      });
      const firstSubmission = actionBridge.waitForSubmission(capturedTaskId, capturedRequestId, firstAction.actionId);
      assert.ok(firstSubmission);

      await onEvent?.({
        eventId: "event-window-action-1",
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        type: "task.action_required",
        status: "waiting",
        message: "Need approval 1",
        payload: {
          actionId: firstAction.actionId,
          actionType: firstAction.actionType,
        },
        timestamp: "2026-03-30T11:00:00.000Z",
      });
      firstActionReady();

      await firstSubmission;

      await onEvent?.({
        eventId: "event-window-running-1",
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        type: "task.started",
        status: "running",
        message: "继续处理中",
        timestamp: "2026-03-30T11:00:01.000Z",
      });

      const secondAction = actionBridge.register({
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        actionId: "approval-window-2",
        actionType: "approval",
        prompt: "Need approval 2",
      });
      const secondSubmission = actionBridge.waitForSubmission(capturedTaskId, capturedRequestId, secondAction.actionId);
      assert.ok(secondSubmission);

      await onEvent?.({
        eventId: "event-window-action-2",
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        type: "task.action_required",
        status: "waiting",
        message: "Need approval 2",
        payload: {
          actionId: secondAction.actionId,
          actionType: secondAction.actionType,
        },
        timestamp: "2026-03-30T11:00:02.000Z",
      });
      secondActionReady();

      const secondPayload = await secondSubmission;

      return {
        taskId: capturedTaskId,
        requestId: capturedRequestId,
        status: "completed",
        summary: `已处理 ${secondPayload.decision}`,
        completedAt: "2026-03-30T11:00:03.000Z",
      };
    };

    const streamPromise = handleTaskStream(
      request as unknown as import("node:http").IncomingMessage,
      response as unknown as import("node:http").ServerResponse,
      runtime,
      {
        defaultRuntime: runtime,
      },
      authRuntime,
      actionBridge,
      5_000,
    );

    await firstActionObserved;
    assert.equal(abortMessage, null);
    assert.ok(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-window-1"));

    assert.equal(actionBridge.resolve({
      taskId: capturedTaskId,
      requestId: capturedRequestId,
      actionId: "approval-window-1",
      decision: "approve",
    }), true);

    await secondActionObserved;
    response.emit("close");

    assert.equal(abortMessage, null);
    assert.equal(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-window-1"), null);
    assert.ok(actionBridge.findBySubmission(capturedTaskId, capturedRequestId, "approval-window-2"));

    assert.equal(actionBridge.resolve({
      taskId: capturedTaskId,
      requestId: capturedRequestId,
      actionId: "approval-window-2",
      decision: "approve",
    }), true);

    await streamPromise;

    assert.equal(abortMessage, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("handleTaskStream 仅收到无 bridge pending action 的 task.action_required 时 close 仍会触发 CLIENT_DISCONNECTED", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-stream-non-bridge-action-"));
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
  const actionBridge = new AppServerActionBridge();
  const request = createTaskStreamRequest({
    goal: "请检查非 bridge action_required 断流",
    sessionId: "session-task-stream-non-bridge-action",
  });
  const response = createTaskStreamResponse(({ writeCount, chunk }) => {
    const line = parseNdjson(String(chunk))[0];

    if (writeCount === 2 && line?.title === "task.action_required") {
      request.emit("close");
    }
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
        eventId: "event-non-bridge-action-1",
        taskId: taskRequest.taskId ?? "task-stream-non-bridge-action",
        requestId: taskRequest.requestId,
        type: "task.action_required",
        status: "waiting",
        message: "Need follow-up answer",
        timestamp: "2026-03-29T10:00:00.000Z",
      });

      await aborted;

      return {
        taskId: taskRequest.taskId ?? "task-stream-non-bridge-action",
        requestId: taskRequest.requestId,
        status: "cancelled",
        summary: "任务已取消",
        completedAt: "2026-03-29T10:00:01.000Z",
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
      actionBridge,
      5_000,
    );

    assert.equal(abortMessage, "CLIENT_DISCONNECTED");
    const lines = parseNdjson(response.lines.join(""));
    assert.deepEqual(lines.map((line) => line.kind), ["ack", "event"]);
    assert.equal(actionBridge.findBySubmission(
      lines[1]?.taskId as string,
      lines[1]?.requestId as string,
      "missing-action",
    ), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("handleTaskStream 在 streamClosed 后收到非 bridge 的 task.action_required 不能清掉 grace timer", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-stream-non-bridge-grace-"));
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
  const actionBridge = new AppServerActionBridge();
  const request = createTaskStreamRequest({
    goal: "请检查非 bridge action_required 不应清理 grace",
    sessionId: "session-task-stream-non-bridge-grace",
  });
  const response = createTaskStreamResponse(({ writeCount, chunk }) => {
    const line = parseNdjson(String(chunk))[0];

    if (writeCount === 1 && line?.kind === "ack") {
      request.emit("close");
    }
  });
  let abortMessage: string | null = null;

  try {
    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (taskRequest, hooks = {}) => {
      const { onEvent, signal } = hooks;
      assert.ok(signal);

      const abortObserved = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("timeout waiting CLIENT_DISCONNECTED"));
        }, 200);

        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          abortMessage = signal.reason instanceof Error
            ? signal.reason.message
            : String(signal.reason);
          resolve();
        }, { once: true });
      });

      await onEvent?.({
        eventId: "event-non-bridge-grace-1",
        taskId: taskRequest.taskId ?? "task-stream-non-bridge-grace",
        requestId: taskRequest.requestId,
        type: "task.action_required",
        status: "waiting",
        message: "Need follow-up answer",
        payload: {
          actionId: "fake-non-bridge-grace-1",
          actionType: "approval",
        },
        timestamp: "2026-04-01T09:00:00.000Z",
      });

      await abortObserved;

      return {
        taskId: taskRequest.taskId ?? "task-stream-non-bridge-grace",
        requestId: taskRequest.requestId,
        status: "cancelled",
        summary: "任务已取消",
        completedAt: "2026-04-01T09:00:01.000Z",
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
      actionBridge,
      5_000,
    );

    assert.equal(abortMessage, "CLIENT_DISCONNECTED");
    const lines = parseNdjson(response.lines.join(""));
    assert.deepEqual(lines.map((line) => line.kind), ["ack"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function parseNdjson(body: string): Array<{
  kind?: string;
  title?: string;
  text?: unknown;
  result?: unknown;
  metadata?: unknown;
  taskId?: string;
  requestId?: string;
}> {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      kind?: string;
      title?: string;
      text?: unknown;
      result?: unknown;
      metadata?: unknown;
      taskId?: string;
      requestId?: string;
    });
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

function createTaskStreamResponse(
  onWrite: (payload: { writeCount: number; chunk: string }) => void = () => {},
): TaskStreamResponseStub {
  return new TaskStreamResponseStub(onWrite);
}

class TaskStreamResponseStub extends EventEmitter {
  statusCode = 0;
  destroyed = false;
  writableEnded = false;
  readonly lines: string[] = [];
  private writeCount = 0;

  constructor(private readonly onWrite: (payload: { writeCount: number; chunk: string }) => void) {
    super();
  }

  setHeader(_name: string, _value: string | number | readonly string[]): void {}

  write(chunk: unknown): boolean {
    const renderedChunk = String(chunk);
    this.lines.push(renderedChunk);
    this.writeCount += 1;
    this.onWrite({
      writeCount: this.writeCount,
      chunk: renderedChunk,
    });

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

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("waitFor timeout");
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10);
    });
  }
}

function createNdjsonStreamReader(body: ReadableStream<Uint8Array>): {
  readUntil: (
    predicate: (lines: Array<{ kind?: string; title?: string; text?: unknown; result?: unknown; metadata?: unknown }>) => boolean,
  ) => Promise<Array<{ kind?: string; title?: string; text?: unknown; result?: unknown; metadata?: unknown }>>;
  cancel: () => Promise<void>;
} {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lines: Array<{ kind?: string; title?: string; text?: unknown; result?: unknown; metadata?: unknown }> = [];

  return {
    readUntil: async (predicate) => {
      while (true) {
        if (predicate(lines)) {
          return [...lines];
        }

        const { value, done } = await reader.read();

        if (done) {
          throw new Error("NDJSON stream ended before predicate matched.");
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const trimmed = chunk.trim();

          if (!trimmed) {
            continue;
          }

          lines.push(JSON.parse(trimmed) as { kind?: string; title?: string; text?: unknown; result?: unknown; metadata?: unknown });

          if (predicate(lines)) {
            return [...lines];
          }
        }
      }
    },
    cancel: async () => {
      await reader.cancel();
    },
  };
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
