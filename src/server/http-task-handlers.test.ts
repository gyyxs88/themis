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
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-handlers-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const authRuntime = {
    readSnapshot: async () => ({
      authenticated: false,
      requiresOpenaiAuth: false,
    }),
    readThirdPartyProviderProfile: () => null,
  } as unknown as CodexAuthRuntime;
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

test("/api/tasks/run 会记录任务已接受和 cancelled 审计", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (request) => ({
      taskId: request.taskId ?? "task-run-audit",
      requestId: request.requestId,
      status: "cancelled",
      summary: "任务已取消",
      completedAt: "2026-03-28T09:00:00.000Z",
    });

    const response = await fetch(`${baseUrl}/api/tasks/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查审计",
        sessionId: "session-task-run-audit",
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        status?: string;
      };
    };
    assert.equal(payload.result?.status, "cancelled");

    const events = runtimeStore.listWebAuditEvents();
    const accepted = events.find((event) => event.eventType === "web_access.task_accepted");
    const cancelled = events.find((event) => event.eventType === "web_access.task_cancelled");

    assert.ok(accepted);
    assert.ok(cancelled);
    assert.equal(accepted?.remoteIp, "127.0.0.1");
    assert.equal(cancelled?.remoteIp, "127.0.0.1");
  });
});

test("/api/tasks/stream 会记录任务已接受审计", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    (runtime as CodexTaskRuntime & {
      runTask: CodexTaskRuntime["runTask"];
    }).runTask = async (request) => ({
      taskId: request.taskId ?? "task-stream-audit",
      requestId: request.requestId,
      status: "completed",
      summary: "任务已完成",
      completedAt: "2026-03-28T09:00:00.000Z",
    });

    const response = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查流式审计",
        sessionId: "session-task-stream-audit",
      }),
    });

    assert.equal(response.status, 200);

    const body = await response.text();
    assert.match(body, /"kind":"ack"/);
    assert.match(body, /"kind":"done"/);

    const accepted = runtimeStore
      .listWebAuditEvents()
      .find((event) => event.eventType === "web_access.task_accepted");

    assert.ok(accepted);
    assert.equal(accepted?.remoteIp, "127.0.0.1");
  });
});

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
