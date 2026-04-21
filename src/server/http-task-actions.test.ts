import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer, type ThemisServerRuntimeRegistry } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  runtimeStore: SqliteCodexSessionRegistry;
}

async function withHttpServer(
  actionBridge: AppServerActionBridge,
  run: (context: TestServerContext) => Promise<void>,
  createRuntimeRegistry?: (context: TestServerContext) => ThemisServerRuntimeRegistry | undefined,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-actions-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
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
    runtimeStore,
  };
  const runtimeRegistry = createRuntimeRegistry?.(context);
  const server = createThemisHttpServer({
    runtime,
    ...(runtimeRegistry ? { runtimeRegistry } : {}),
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
  const resolved: Array<{
    taskId: string;
    requestId: string;
    actionId: string;
    decision?: string;
    inputText?: string;
  }> = [];

  actionBridge.register({
    taskId: "task-1",
    requestId: "req-1",
    actionId: "approval-1",
    actionType: "approval",
    prompt: "Allow command?",
    choices: ["approve", "deny"],
  });

  const originalResolve = actionBridge.resolve.bind(actionBridge);
  actionBridge.resolve = (payload) => {
    resolved.push(payload);
    return originalResolve(payload);
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
      assert.deepEqual(resolved[0], {
        taskId: "task-1",
        requestId: "req-1",
        actionId: "approval-1",
        decision: "approve",
      });
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

test("/api/tasks/actions 在 taskId 或 requestId 不匹配时返回 404 且不会 resolve", async () => {
  const actionBridge = new AppServerActionBridge();
  let resolveCount = 0;

  actionBridge.register({
    taskId: "task-expected",
    requestId: "req-expected",
    actionId: "approval-shared",
    actionType: "approval",
    prompt: "Allow command?",
    choices: ["approve", "deny"],
  });

  const originalResolve = actionBridge.resolve.bind(actionBridge);
  actionBridge.resolve = (payload) => {
    resolveCount += 1;
    return originalResolve(payload);
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
          taskId: "task-other",
          requestId: "req-expected",
          actionId: "approval-shared",
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

  assert.equal(resolveCount, 0);
  assert.equal(actionBridge.find("approval-shared")?.taskId, "task-expected");
});

test("/api/tasks/actions 遇到非法 JSON 时返回 400 INVALID_REQUEST", async () => {
  const actionBridge = new AppServerActionBridge();

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
        body: "{\"taskId\":",
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: {
          code: "INVALID_REQUEST",
          message: "请求体不是合法的 JSON。",
        },
      });
    },
  );
});

test("/api/tasks/actions 的 review 模式会按 session runtime 选择对应 runtime", async () => {
  let reviewCalls = 0;

  await withHttpServer(
    new AppServerActionBridge(),
    async ({ baseUrl, runtimeStore }) => {
      runtimeStore.saveSession({
        sessionId: "session-review-1",
        threadId: "thread-review-1",
        createdAt: "2026-03-29T12:00:00.000Z",
        updatedAt: "2026-03-29T12:00:00.000Z",
      });
      runtimeStore.upsertTurnFromRequest({
        requestId: "req-review-previous",
        taskId: "task-review-previous",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "previous app-server turn",
        channelContext: { sessionId: "session-review-1" },
        createdAt: "2026-03-29T12:00:00.000Z",
      }, "task-review-previous");
      runtimeStore.completeTaskTurn({
        request: {
          requestId: "req-review-previous",
          taskId: "task-review-previous",
          sourceChannel: "web",
          user: { userId: "webui" },
          goal: "previous app-server turn",
          channelContext: { sessionId: "session-review-1" },
          createdAt: "2026-03-29T12:00:00.000Z",
        },
        result: {
          taskId: "task-review-previous",
          requestId: "req-review-previous",
          status: "completed",
          summary: "ok",
          structuredOutput: {
            session: {
              sessionId: "session-review-1",
              threadId: "thread-review-1",
              engine: "app-server",
            },
          },
          completedAt: "2026-03-29T12:01:00.000Z",
        },
        sessionMode: "resumed",
        threadId: "thread-review-1",
      });

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
          mode: "review",
          sessionId: "session-review-1",
          instructions: "please review current diff",
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        reviewThreadId: "thread-review-1-review",
        turnId: "turn-review-1",
      });
      assert.equal(reviewCalls, 1);
    },
    ({ runtimeStore }) => ({
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
          runTask: async () => {
            throw new Error("runTask should not be used");
          },
          startReview: async (input) => {
            reviewCalls += 1;
            assert.deepEqual(input, {
              sessionId: "session-review-1",
              instructions: "please review current diff",
            });
            return {
              reviewThreadId: "thread-review-1-review",
              turnId: "turn-review-1",
            };
          },
          getRuntimeStore: () => runtimeStore,
          getIdentityLinkService: () => ({}),
          getPrincipalSkillsService: () => ({}),
        },
      },
    }),
  );
});

test("/api/tasks/actions 的 steer 模式在 runtime 不支持时返回清晰错误", async () => {
  await withHttpServer(
    new AppServerActionBridge(),
    async ({ baseUrl, runtimeStore }) => {
      runtimeStore.saveSession({
        sessionId: "session-steer-unsupported-1",
        threadId: "thread-steer-unsupported-1",
        createdAt: "2026-03-29T12:00:00.000Z",
        updatedAt: "2026-03-29T12:00:00.000Z",
      });
      runtimeStore.upsertTurnFromRequest({
        requestId: "req-steer-previous",
        taskId: "task-steer-previous",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "previous sdk turn",
        channelContext: { sessionId: "session-steer-unsupported-1" },
        createdAt: "2026-03-29T12:00:00.000Z",
      }, "task-steer-previous");
      runtimeStore.completeTaskTurn({
        request: {
          requestId: "req-steer-previous",
          taskId: "task-steer-previous",
          sourceChannel: "web",
          user: { userId: "webui" },
          goal: "previous sdk turn",
          channelContext: { sessionId: "session-steer-unsupported-1" },
          createdAt: "2026-03-29T12:00:00.000Z",
        },
        result: {
          taskId: "task-steer-previous",
          requestId: "req-steer-previous",
          status: "completed",
          summary: "ok",
          structuredOutput: {
            session: {
              sessionId: "session-steer-unsupported-1",
              threadId: "thread-steer-unsupported-1",
              engine: "sdk",
            },
          },
          completedAt: "2026-03-29T12:01:00.000Z",
        },
        sessionMode: "resumed",
        threadId: "thread-steer-unsupported-1",
      });

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
          mode: "steer",
          sessionId: "session-steer-unsupported-1",
          message: "focus on tests only",
        }),
      });

      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: {
          code: "UNSUPPORTED_ACTION",
          message: "当前会话的运行时不支持 steer。",
        },
      });
    },
    ({ runtimeStore }) => ({
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
          runTask: async () => {
            throw new Error("runTask should not be used");
          },
          getRuntimeStore: () => runtimeStore,
          getIdentityLinkService: () => ({}),
          getPrincipalSkillsService: () => ({}),
        },
      },
    }),
  );
});

test("/api/tasks/actions 的 steer 模式在会话状态不允许时返回 409，而不是 500", async () => {
  await withHttpServer(
    new AppServerActionBridge(),
    async ({ baseUrl, runtimeStore }) => {
      runtimeStore.saveSession({
        sessionId: "session-steer-conflict-1",
        threadId: "thread-steer-conflict-1",
        createdAt: "2026-03-29T12:00:00.000Z",
        updatedAt: "2026-03-29T12:00:00.000Z",
      });
      runtimeStore.upsertTurnFromRequest({
        requestId: "req-steer-conflict-previous",
        taskId: "task-steer-conflict-previous",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "previous app-server turn",
        channelContext: { sessionId: "session-steer-conflict-1" },
        createdAt: "2026-03-29T12:00:00.000Z",
      }, "task-steer-conflict-previous");
      runtimeStore.completeTaskTurn({
        request: {
          requestId: "req-steer-conflict-previous",
          taskId: "task-steer-conflict-previous",
          sourceChannel: "web",
          user: { userId: "webui" },
          goal: "previous app-server turn",
          channelContext: { sessionId: "session-steer-conflict-1" },
          createdAt: "2026-03-29T12:00:00.000Z",
        },
        result: {
          taskId: "task-steer-conflict-previous",
          requestId: "req-steer-conflict-previous",
          status: "completed",
          summary: "ok",
          structuredOutput: {
            session: {
              sessionId: "session-steer-conflict-1",
              threadId: "thread-steer-conflict-1",
              engine: "app-server",
            },
          },
          completedAt: "2026-03-29T12:01:00.000Z",
        },
        sessionMode: "resumed",
        threadId: "thread-steer-conflict-1",
      });

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
          mode: "steer",
          sessionId: "session-steer-conflict-1",
          message: "focus on tests only",
        }),
      });

      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: {
          code: "INVALID_ACTION_STATE",
          message: "当前会话还没有可引导的 app-server turn。",
        },
      });
    },
    ({ runtimeStore }) => ({
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
          runTask: async () => {
            throw new Error("runTask should not be used");
          },
          steerTurn: async () => {
            throw new Error("当前会话还没有可引导的 app-server turn。");
          },
          getRuntimeStore: () => runtimeStore,
          getIdentityLinkService: () => ({}),
          getPrincipalSkillsService: () => ({}),
        },
      },
    }),
  );
});

test("/api/tasks/actions 的 review 模式会为预绑定但无 completed turn 的 app-server session 选择 app-server runtime", async () => {
  let reviewCalls = 0;
  let readCalls = 0;

  await withHttpServer(
    new AppServerActionBridge(),
    async ({ baseUrl, runtimeStore }) => {
      runtimeStore.saveSession({
        sessionId: "session-review-prebound-1",
        threadId: "thread-review-prebound-1",
        createdAt: "2026-03-29T12:00:00.000Z",
        updatedAt: "2026-03-29T12:00:00.000Z",
      });

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
          mode: "review",
          sessionId: "session-review-prebound-1",
          instructions: "review prebound thread",
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        reviewThreadId: "thread-review-prebound-1-review",
        turnId: "turn-review-prebound-2",
      });
      assert.equal(readCalls, 0);
      assert.equal(reviewCalls, 1);
    },
    ({ runtimeStore }) => ({
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
          runTask: async () => {
            throw new Error("runTask should not be used");
          },
          readThreadSnapshot: async (input) => {
            readCalls += 1;
            assert.deepEqual(input, {
              threadId: "thread-review-prebound-1",
            });
            return {
              threadId: "thread-review-prebound-1",
              turnCount: 0,
              turns: [],
            };
          },
          startReview: async (input) => {
            reviewCalls += 1;
            assert.deepEqual(input, {
              sessionId: "session-review-prebound-1",
              instructions: "review prebound thread",
            });
            return {
              reviewThreadId: "thread-review-prebound-1-review",
              turnId: "turn-review-prebound-2",
            };
          },
          getRuntimeStore: () => runtimeStore,
          getIdentityLinkService: () => ({}),
          getPrincipalSkillsService: () => ({}),
        },
      },
    }),
  );
});

test("/api/tasks/actions 的 review 模式在旧 sdk turn 后切到预绑定 app-server thread 时仍选择 app-server runtime", async () => {
  let reviewCalls = 0;

  await withHttpServer(
    new AppServerActionBridge(),
    async ({ baseUrl, runtimeStore }) => {
      runtimeStore.upsertTurnFromRequest({
        requestId: "req-review-mixed-sdk-1",
        taskId: "task-review-mixed-sdk-1",
        sourceChannel: "web",
        user: { userId: "webui" },
        goal: "previous sdk turn",
        channelContext: { sessionId: "session-review-mixed-1" },
        createdAt: "2026-03-29T13:00:00.000Z",
      }, "task-review-mixed-sdk-1");
      runtimeStore.completeTaskTurn({
        request: {
          requestId: "req-review-mixed-sdk-1",
          taskId: "task-review-mixed-sdk-1",
          sourceChannel: "web",
          user: { userId: "webui" },
          goal: "previous sdk turn",
          channelContext: { sessionId: "session-review-mixed-1" },
          createdAt: "2026-03-29T13:00:00.000Z",
        },
        result: {
          taskId: "task-review-mixed-sdk-1",
          requestId: "req-review-mixed-sdk-1",
          status: "completed",
          summary: "sdk completed",
          structuredOutput: {
            session: {
              sessionId: "session-review-mixed-1",
              threadId: "thread-sdk-review-legacy-1",
              engine: "sdk",
            },
          },
          completedAt: "2026-03-29T13:00:30.000Z",
        },
        sessionMode: "resumed",
        threadId: "thread-sdk-review-legacy-1",
      });
      runtimeStore.saveSession({
        sessionId: "session-review-mixed-1",
        threadId: "thread-app-review-migrated-1",
        createdAt: "2026-03-29T13:00:00.000Z",
        updatedAt: "2026-03-29T13:01:00.000Z",
      });

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
          mode: "review",
          sessionId: "session-review-mixed-1",
          instructions: "review migrated thread",
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        reviewThreadId: "thread-app-review-migrated-1-review",
        turnId: "turn-review-mixed-1",
      });
      assert.equal(reviewCalls, 1);
    },
    ({ runtimeStore }) => ({
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
          runTask: async () => {
            throw new Error("runTask should not be used");
          },
          startReview: async (input) => {
            reviewCalls += 1;
            assert.deepEqual(input, {
              sessionId: "session-review-mixed-1",
              instructions: "review migrated thread",
            });
            return {
              reviewThreadId: "thread-app-review-migrated-1-review",
              turnId: "turn-review-mixed-1",
            };
          },
          getRuntimeStore: () => runtimeStore,
          getIdentityLinkService: () => ({}),
          getPrincipalSkillsService: () => ({}),
        },
      },
    }),
  );
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
