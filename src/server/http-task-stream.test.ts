import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { handleTaskStream } from "./http-task-handlers.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: CodexTaskRuntime;
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
  const server = createThemisHttpServer({ runtime, authRuntime });
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
    assert.equal(lines.length, 4);
    assert.equal(lines[0]?.kind, "ack");
    assert.equal(lines[1]?.kind, "event");
    assert.equal(lines[2]?.kind, "result");
    assert.equal(lines[3]?.kind, "done");
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
  });
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
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.kind, "error");
    assert.equal(lines[1]?.kind, "fatal");
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

function parseNdjson(body: string): Array<{ kind?: string; title?: string; result?: unknown }> {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind?: string; title?: string; result?: unknown });
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
