import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer, type ThemisServerRuntimeRegistry } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: CodexTaskRuntime;
}

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
  createRuntimeRegistry?: (context: TestServerContext) => ThemisServerRuntimeRegistry | undefined,
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
  const context = {
    baseUrl: "",
    root,
    runtimeStore,
    runtime,
  };
  const runtimeRegistry = createRuntimeRegistry?.(context);
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
  }, ({ runtime }) => ({
    defaultRuntime: runtime,
    runtimes: {
      sdk: runtime,
    },
  }));
});

test("/api/tasks/run 传 app-server runtimeEngine 时会走 selected runtime，并把审计写进共享 store", async () => {
  let appServerRunCount = 0;

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
        taskId: request.taskId ?? "task-run-sdk-should-not-run",
        requestId: request.requestId,
        status: "completed",
        summary: "sdk should not run",
        completedAt: "2026-03-28T09:00:00.000Z",
      };
    };

    const response = await fetch(`${baseUrl}/api/tasks/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查 run runtime selection",
        sessionId: "session-task-run-selected-runtime",
        options: {
          runtimeEngine: "app-server",
        },
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        status?: string;
        structuredOutput?: {
          runtimeEngine?: string;
        };
      };
    };
    assert.equal(payload.result?.status, "completed");
    assert.equal(payload.result?.structuredOutput?.runtimeEngine, "app-server");
    assert.equal(sdkRunCount, 0);
    assert.equal(appServerRunCount, 1);

    const accepted = runtimeStore
      .listWebAuditEvents()
      .find((event) => event.eventType === "web_access.task_accepted");

    assert.ok(accepted);
    assert.equal(accepted?.remoteIp, "127.0.0.1");
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => {
        throw new Error("default runtime should not be used");
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
    runtimes: {
      "app-server": {
        runTask: async (request) => {
          appServerRunCount += 1;
          return {
            taskId: request.taskId ?? "task-run-app-server",
            requestId: request.requestId,
            status: "completed",
            summary: "app-server selected",
            structuredOutput: {
              runtimeEngine: "app-server",
            },
            completedAt: "2026-03-28T09:00:00.000Z",
          };
        },
        getRuntimeStore: () => runtimeStore,
        getIdentityLinkService: () => ({}),
        getPrincipalSkillsService: () => ({}),
      },
    },
  }));
});

test("/api/tasks/run 在显式传非法 runtimeEngine 时返回 400，且不会落到 default runtime", async () => {
  let defaultRunCount = 0;

  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查非法 runtime",
        sessionId: "session-task-run-invalid-runtime",
        options: {
          runtimeEngine: "bogus-engine",
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
    assert.match(payload.error?.message ?? "", /Invalid runtimeEngine: bogus-engine/);
    assert.equal(defaultRunCount, 0);
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => {
        defaultRunCount += 1;
        throw new Error("default runtime should not be used");
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
    runtimes: {
      sdk: {
        runTask: async () => {
          throw new Error("sdk runtime should not be used");
        },
        getRuntimeStore: () => runtimeStore,
        getIdentityLinkService: () => ({}),
        getPrincipalSkillsService: () => ({}),
      },
    },
  }));
});

test("/api/tasks/run 在显式传 null runtimeEngine 时返回 400，且不会落到 default runtime", async () => {
  let defaultRunCount = 0;

  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查 null runtime",
        sessionId: "session-task-run-null-runtime",
        options: {
          runtimeEngine: null,
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
    assert.match(payload.error?.message ?? "", /Invalid runtimeEngine: null/);
    assert.equal(defaultRunCount, 0);
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => {
        defaultRunCount += 1;
        throw new Error("default runtime should not be used");
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
    runtimes: {
      sdk: {
        runTask: async () => {
          throw new Error("sdk runtime should not be used");
        },
        getRuntimeStore: () => runtimeStore,
        getIdentityLinkService: () => ({}),
        getPrincipalSkillsService: () => ({}),
      },
    },
  }));
});

test("createThemisHttpServer 会拒绝使用与 base runtime 不共享 store 的 runtimeRegistry", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-handlers-store-check-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const otherStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis-other.db"),
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

  try {
    assert.throws(() => createThemisHttpServer({
      runtime,
      authRuntime,
      runtimeRegistry: {
        defaultRuntime: runtime,
        runtimes: {
          "app-server": {
            runTask: async () => ({
              taskId: "task-mismatch",
              requestId: "req-mismatch",
              status: "completed",
              summary: "mismatch",
              completedAt: "2026-03-28T09:00:00.000Z",
            }),
            getRuntimeStore: () => otherStore,
            getIdentityLinkService: () => ({}),
            getPrincipalSkillsService: () => ({}),
          },
        },
      },
    }), /runtime store/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  }, ({ runtime }) => ({
    defaultRuntime: runtime,
    runtimes: {
      sdk: runtime,
    },
  }));
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
