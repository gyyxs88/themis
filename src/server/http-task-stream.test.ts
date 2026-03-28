import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
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
    }).runTask = async (request, hooks) => {
      await hooks.onEvent?.({
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
    assert.deepEqual(lines.map((line) => line.kind), ["error", "fatal"]);
    assert.equal(lines[0]?.title, "AUTH_REQUIRED");
    assert.equal(lines[1]?.title, "AUTH_REQUIRED");
  }, {
    authenticated: false,
    requiresOpenaiAuth: true,
  });
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
