import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  runtimeStore: SqliteCodexSessionRegistry;
}

async function withHttpServer(
  actionBridge: AppServerActionBridge,
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-actions-"));
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
  const server = createThemisHttpServer({
    runtime,
    authRuntime,
    actionBridge,
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
      runtimeStore,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

test("/api/tasks/actions 提交命中等待中的 action 时返回 ok", async () => {
  const actionBridge = new AppServerActionBridge();
  const resolved: Array<{ actionId: string; payload: Record<string, unknown> }> = [];

  actionBridge.register({
    taskId: "task-1",
    requestId: "req-1",
    actionId: "approval-1",
    actionType: "approval",
    prompt: "Allow command?",
    choices: ["approve", "deny"],
  });

  const originalResolve = actionBridge.resolve.bind(actionBridge);
  actionBridge.resolve = (actionId, payload) => {
    resolved.push({ actionId, payload });
    originalResolve(actionId, payload);
  };

  await withHttpServer(
    actionBridge,
    async ({ baseUrl, runtimeStore }) => {
      const authHeaders = await createAuthenticatedWebHeaders({
        baseUrl,
        runtimeStore,
      });

      const response = await fetch(`${baseUrl}/api/tasks/actions`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: "task-1",
          requestId: "req-1",
          actionId: "approval-1",
          decision: "approve",
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(resolved.length, 1);
      assert.equal(resolved[0]?.actionId, "approval-1");
      assert.equal(actionBridge.find("approval-1"), null);
    },
  );
});

test("/api/tasks/actions 提交未命中的 action 时返回 404", async () => {
  const actionBridge = new AppServerActionBridge();
  const originalResolve = actionBridge.resolve.bind(actionBridge);
  actionBridge.resolve = (...args) => {
    throw new Error(`resolve should not be called: ${JSON.stringify(args)}`);
  };

  await withHttpServer(
    actionBridge,
    async ({ baseUrl, runtimeStore }) => {
      const authHeaders = await createAuthenticatedWebHeaders({
        baseUrl,
        runtimeStore,
      });

      const response = await fetch(`${baseUrl}/api/tasks/actions`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: "task-1",
          requestId: "req-1",
          actionId: "missing-action",
          decision: "approve",
        }),
      });

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        error: {
          code: "INVALID_REQUEST",
          message: "未找到匹配的等待中 action。",
        },
      });
    },
  );

  actionBridge.resolve = originalResolve;
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
