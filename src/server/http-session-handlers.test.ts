import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  server: Server;
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  authHeaders: Record<string, string>;
}

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-session-settings-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({ runtime });
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
      authHeaders,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

test("PUT /api/sessions/:id/settings 会保存合法 workspacePath", async () => {
  await withHttpServer(async ({ baseUrl, root, authHeaders }) => {
    const workspace = join(root, "workspace");
    mkdirSync(workspace);

    const response = await fetch(`${baseUrl}/api/sessions/session-http-1/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          profile: "dev",
          workspacePath: workspace,
        },
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as Record<string, unknown>;
    assert.equal(payload.ok, true);
    assert.equal(payload.sessionId, "session-http-1");
    assert.deepEqual(payload.settings, {
      profile: "dev",
      workspacePath: workspace,
    });
  });
});

test("PUT /api/sessions/:id/settings 会拒绝相对路径 workspacePath", async () => {
  await withHttpServer(async ({ baseUrl, authHeaders }) => {
    const response = await fetch(`${baseUrl}/api/sessions/session-http-2/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          workspacePath: "relative/project",
        },
      }),
    });

    assert.equal(response.status, 400);

    const payload = await response.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.match(payload.error?.message ?? "", /绝对路径/);
  });
});

test("PUT /api/sessions/:id/settings 在冻结会话改成非法路径时返回冻结错误", async () => {
  await withHttpServer(async ({ baseUrl, root, runtimeStore, authHeaders }) => {
    const workspace = join(root, "workspace");
    mkdirSync(workspace);

    const saveResponse = await fetch(`${baseUrl}/api/sessions/session-http-frozen/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          workspacePath: workspace,
        },
      }),
    });
    assert.equal(saveResponse.status, 200);

    runtimeStore.upsertTurnFromRequest({
      requestId: "request-http-frozen-1",
      sourceChannel: "web",
      user: {
        userId: "user-http-frozen-1",
      },
      goal: "hello",
      channelContext: {
        sessionId: "session-http-frozen",
      },
      createdAt: "2026-03-26T00:00:00.000Z",
    }, "task-http-frozen-1");

    const response = await fetch(`${baseUrl}/api/sessions/session-http-frozen/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          workspacePath: "relative/project",
        },
      }),
    });

    assert.equal(response.status, 400);

    const payload = await response.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "当前会话已经执行过任务，不能再修改工作区；请先新建会话。");
  });
});

test("PUT /api/sessions/:id/settings 支持用空白 workspacePath 删除该字段", async () => {
  await withHttpServer(async ({ baseUrl, root, runtimeStore, authHeaders }) => {
    const workspace = join(root, "workspace");
    mkdirSync(workspace);

    const saveResponse = await fetch(`${baseUrl}/api/sessions/session-http-clear-workspace/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          profile: "dev",
          workspacePath: workspace,
        },
      }),
    });
    assert.equal(saveResponse.status, 200);

    const clearResponse = await fetch(`${baseUrl}/api/sessions/session-http-clear-workspace/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          workspacePath: "   ",
        },
      }),
    });

    assert.equal(clearResponse.status, 200);

    const payload = await clearResponse.json() as {
      settings?: {
        profile?: string;
        workspacePath?: string;
      } | null;
    };
    assert.deepEqual(payload.settings, {
      profile: "dev",
    });
    assert.equal(runtimeStore.getSessionTaskSettings("session-http-clear-workspace")?.settings.workspacePath, undefined);
  });
});

test("PUT /api/sessions/:id/settings 支持用 null 删除 networkAccessEnabled", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, authHeaders }) => {
    const saveResponse = await fetch(`${baseUrl}/api/sessions/session-http-clear-network/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          networkAccessEnabled: true,
          webSearchMode: "disabled",
        },
      }),
    });
    assert.equal(saveResponse.status, 200);

    const clearResponse = await fetch(`${baseUrl}/api/sessions/session-http-clear-network/settings`, {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          networkAccessEnabled: null,
        },
      }),
    });

    assert.equal(clearResponse.status, 200);

    const payload = await clearResponse.json() as {
      settings?: {
        webSearchMode?: string;
        networkAccessEnabled?: boolean;
      } | null;
    };
    assert.deepEqual(payload.settings, {
      webSearchMode: "disabled",
    });
    assert.equal(
      runtimeStore.getSessionTaskSettings("session-http-clear-network")?.settings.networkAccessEnabled,
      undefined,
    );
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
