import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";
import { createThemisHttpServer } from "./http-server.js";

interface TestServerContext {
  server: Server;
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: AppServerTaskRuntime;
  authHeaders: Record<string, string>;
}

function buildIdentityPayload(): {
  channel: string;
  channelUserId: string;
  displayName: string;
} {
  return {
    channel: "web",
    channelUserId: "browser-user-1",
    displayName: "owner",
  };
}

async function withScheduledTaskServer(
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-scheduled-tasks-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const authRuntime = new CodexAuthRuntime({
    workingDirectory: root,
    registry: runtimeStore,
  });
  const server = createThemisHttpServer({ runtime, authRuntime });
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
      server: listeningServer,
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

async function listenServer(server: Server): Promise<Server> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  return server;
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

async function postJson(
  baseUrl: string,
  pathname: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

test("POST /api/scheduled-tasks/create、list、cancel 会形成最小闭环", async () => {
  await withScheduledTaskServer(async ({ baseUrl, authHeaders, runtime }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildIdentityPayload());
    const scheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    assert.equal(identity.principalId, "principal-local-owner");

    const createResponse = await postJson(baseUrl, "/api/scheduled-tasks/create", {
      ...buildIdentityPayload(),
      sessionId: "web-session-scheduled-1",
      goal: "明早检查 staging 健康状态",
      inputText: "把异常服务列出来",
      timezone: "Asia/Shanghai",
      scheduledAt,
      options: {
        model: "gpt-5.4",
      },
      automation: {
        outputMode: "json",
        jsonSchema: {
          type: "object",
        },
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);

    const createPayload = await createResponse.json() as {
      task?: {
        scheduledTaskId?: string;
        status?: string;
        sessionId?: string;
        goal?: string;
        timezone?: string;
      };
    };
    assert.equal(createPayload.task?.status, "scheduled");
    assert.equal(createPayload.task?.sessionId, "web-session-scheduled-1");
    assert.equal(createPayload.task?.goal, "明早检查 staging 健康状态");
    assert.equal(createPayload.task?.timezone, "Asia/Shanghai");
    assert.ok(createPayload.task?.scheduledTaskId);

    const listResponse = await postJson(baseUrl, "/api/scheduled-tasks/list", buildIdentityPayload(), authHeaders);
    assert.equal(listResponse.status, 200);

    const listPayload = await listResponse.json() as {
      tasks?: Array<{
        scheduledTaskId?: string;
        status?: string;
        scheduledAt?: string;
      }>;
    };
    assert.equal(listPayload.tasks?.length, 1);
    assert.equal(listPayload.tasks?.[0]?.scheduledTaskId, createPayload.task?.scheduledTaskId);
    assert.equal(listPayload.tasks?.[0]?.scheduledAt, scheduledAt);

    const cancelResponse = await postJson(baseUrl, "/api/scheduled-tasks/cancel", {
      ...buildIdentityPayload(),
      scheduledTaskId: createPayload.task?.scheduledTaskId,
    }, authHeaders);
    assert.equal(cancelResponse.status, 200);

    const cancelPayload = await cancelResponse.json() as {
      task?: {
        status?: string;
        cancelledAt?: string;
      };
    };
    assert.equal(cancelPayload.task?.status, "cancelled");
    assert.ok(cancelPayload.task?.cancelledAt);
  });
});
