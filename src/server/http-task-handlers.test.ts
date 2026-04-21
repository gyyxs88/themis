import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer, type ThemisServerRuntimeRegistry } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: AppServerTaskRuntime;
}

async function withHttpServer(
  run: (context: TestServerContext) => Promise<void>,
  createRuntimeRegistry?: (context: TestServerContext) => ThemisServerRuntimeRegistry | undefined,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-task-handlers-"));
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

    (runtime as AppServerTaskRuntime & {
      runTask: AppServerTaskRuntime["runTask"];
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
    runtimes: {},
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

    (runtime as AppServerTaskRuntime & {
      runTask: AppServerTaskRuntime["runTask"];
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

test("/api/tasks/run 在未显式传 runtimeEngine 时会走 default runtime", async () => {
  let defaultRunCount = 0;
  let appServerRunCount = 0;

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
        goal: "请检查 run default runtime",
        sessionId: "session-task-run-default-runtime",
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        status?: string;
        summary?: string;
      };
    };
    assert.equal(payload.result?.status, "completed");
    assert.equal(payload.result?.summary, "default runtime selected");
    assert.equal(defaultRunCount, 1);
    assert.equal(appServerRunCount, 0);
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async (request) => {
        defaultRunCount += 1;
        return {
          taskId: request.taskId ?? "task-run-default-runtime",
          requestId: request.requestId,
          status: "completed",
          summary: "default runtime selected",
          completedAt: "2026-03-30T04:00:00.000Z",
        };
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
    runtimes: {
      "app-server": {
        runTask: async () => {
          appServerRunCount += 1;
          throw new Error("selected runtime should not be used");
        },
        getRuntimeStore: () => runtimeStore,
        getIdentityLinkService: () => ({}),
        getPrincipalSkillsService: () => ({}),
      },
    },
  }));
});

test("/api/tasks/run 显式传 sdk runtimeEngine 时返回 400，且不会执行任何 runtime", async () => {
  let defaultRunCount = 0;
  let sdkRunCount = 0;

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
        goal: "请检查公开任务入口拒绝 sdk",
        sessionId: "session-task-run-sdk-runtime",
        options: {
          runtimeEngine: "sdk",
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
    assert.match(payload.error?.message ?? "", /Invalid runtimeEngine: sdk/);
    assert.equal(defaultRunCount, 0);
    assert.equal(sdkRunCount, 0);
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
    runtimes: {},
  }));
});

test("/api/tasks/run 显式请求未注册的 app-server runtime 时返回 400，且不会静默回退到 default runtime", async () => {
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
        goal: "请检查未注册 app-server fail-fast",
        sessionId: "session-task-run-missing-app-server",
        options: {
          runtimeEngine: "app-server",
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
    assert.match(payload.error?.message ?? "", /Requested runtimeEngine is not enabled: app-server/);
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
    runtimes: {},
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
    runtimes: {},
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
    runtimes: {},
  }));
});

test("/api/tasks/automation/run 会返回稳定的自动化结果包", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请返回自动化可读结果",
        sessionId: "session-task-automation-run",
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      mode?: string;
      automationVersion?: number;
      requestId?: string;
      taskId?: string;
      deliveries?: unknown[];
      result?: {
        status?: string;
        summary?: string;
        outputMode?: string;
        outputText?: string;
        parseStatus?: string;
        parseError?: string | null;
        parsedOutput?: unknown;
        schemaValidation?: {
          status?: string;
          errors?: string[];
          issues?: Array<{
            path?: string;
            keyword?: string;
            message?: string;
          }>;
        };
        contract?: {
          status?: string;
          rejected?: boolean;
          onInvalidJson?: string;
          onSchemaMismatch?: string;
          failures?: Array<{
            kind?: string;
            message?: string;
          }>;
        };
        touchedFiles?: string[];
        memoryUpdates?: Array<{
          kind?: string;
          target?: string;
          action?: string;
        }>;
        nextSteps?: string[];
        session?: {
          sessionId?: string | null;
          conversationId?: string | null;
          threadId?: string | null;
          engine?: string | null;
          mode?: string | null;
          accessMode?: string | null;
          authAccountId?: string | null;
          thirdPartyProviderId?: string | null;
        };
        structuredOutput?: {
          session?: {
            threadId?: string;
          };
          data?: {
            answer?: number;
          };
        };
      };
    };

    assert.equal(payload.mode, "automation");
    assert.equal(payload.automationVersion, 1);
    assert.equal(Array.isArray(payload.deliveries), false);
    assert.equal(payload.result?.status, "completed");
    assert.equal(payload.result?.summary, "automation selected");
    assert.equal(payload.result?.outputMode, "text");
    assert.equal(payload.result?.outputText, "最终结果正文");
    assert.equal(payload.result?.parseStatus, "not_requested");
    assert.equal(payload.result?.parseError, null);
    assert.equal(payload.result?.parsedOutput, null);
    assert.deepEqual(payload.result?.schemaValidation, {
      status: "not_requested",
      errors: [],
      issues: [],
    });
    assert.deepEqual(payload.result?.contract, {
      status: "not_requested",
      rejected: false,
      onInvalidJson: "report",
      onSchemaMismatch: "report",
      failures: [],
    });
    assert.deepEqual(payload.result?.touchedFiles, ["src/server/http-task-handlers.ts"]);
    assert.deepEqual(payload.result?.nextSteps, ["call webhook"]);
    assert.deepEqual(payload.result?.memoryUpdates, [
      {
        kind: "task",
        target: "memory/tasks/in-progress.md",
        action: "updated",
      },
    ]);
    assert.deepEqual(payload.result?.session, {
      sessionId: "session-task-automation-run",
      conversationId: "session-task-automation-run",
      threadId: "thread-automation-1",
      engine: "app-server",
      mode: "resume",
      accessMode: "auth",
      authAccountId: "acc-1",
      thirdPartyProviderId: null,
    });
    assert.equal(payload.result?.structuredOutput?.data?.answer, 42);
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async (request) => ({
        taskId: request.taskId ?? "task-automation-run",
        requestId: request.requestId,
        status: "completed",
        summary: "automation selected",
        output: "最终结果正文",
        touchedFiles: ["src/server/http-task-handlers.ts"],
        memoryUpdates: [
          {
            kind: "task",
            target: "memory/tasks/in-progress.md",
            action: "updated",
          },
        ],
        nextSteps: ["call webhook"],
        structuredOutput: {
          session: {
            sessionId: "session-task-automation-run",
            conversationId: "session-task-automation-run",
            threadId: "thread-automation-1",
            engine: "app-server",
            mode: "resume",
            accessMode: "auth",
            authAccountId: "acc-1",
          },
          data: {
            answer: 42,
          },
        },
        completedAt: "2026-04-05T09:00:00.000Z",
      }),
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
    runtimes: {
      "app-server": {
        runTask: async () => {
          throw new Error("selected runtime should not be used");
        },
        getRuntimeStore: () => runtimeStore,
        getIdentityLinkService: () => ({}),
        getPrincipalSkillsService: () => ({}),
      },
    },
  }));
});

test("/api/tasks/automation/run 在 json 模式下会返回 parsedOutput 并校验 schema", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请返回结构化 JSON",
        sessionId: "session-task-automation-json",
        automation: {
          outputMode: "json",
          jsonSchema: {
            type: "object",
            required: ["answer", "status"],
            additionalProperties: false,
            properties: {
              answer: {
                type: "integer",
              },
              status: {
                enum: ["ok"],
              },
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        outputMode?: string;
        outputText?: string;
        parseStatus?: string;
        parseError?: string | null;
        parsedOutput?: {
          answer?: number;
          status?: string;
        } | null;
        schemaValidation?: {
          status?: string;
          errors?: string[];
          issues?: Array<{
            path?: string;
            keyword?: string;
            message?: string;
          }>;
        };
        contract?: {
          status?: string;
          rejected?: boolean;
          failures?: Array<{
            kind?: string;
            message?: string;
          }>;
        };
      };
    };

    assert.equal(payload.result?.outputMode, "json");
    assert.equal(payload.result?.outputText, "{\"answer\":42,\"status\":\"ok\"}");
    assert.equal(payload.result?.parseStatus, "parsed");
    assert.equal(payload.result?.parseError, null);
    assert.deepEqual(payload.result?.parsedOutput, {
      answer: 42,
      status: "ok",
    });
    assert.deepEqual(payload.result?.schemaValidation, {
      status: "passed",
      errors: [],
      issues: [],
    });
    assert.deepEqual(payload.result?.contract, {
      status: "passed",
      rejected: false,
      onInvalidJson: "report",
      onSchemaMismatch: "report",
      failures: [],
    });
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async (request) => {
        assert.match(request.inputText ?? "", /Automation output contract/);
        assert.match(request.inputText ?? "", /Return exactly one valid JSON value/);
        assert.match(request.inputText ?? "", /"required": \[/);

        return {
          taskId: request.taskId ?? "task-automation-json",
          requestId: request.requestId,
          status: "completed",
          summary: "json automation selected",
          output: "{\"answer\":42,\"status\":\"ok\"}",
          completedAt: "2026-04-05T09:30:00.000Z",
        };
      },
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
  }));
});

test("/api/tasks/automation/run 在 json 模式输出非法 JSON 时会返回 parse 失败", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请返回 JSON",
        sessionId: "session-task-automation-invalid-json",
        automation: {
          outputMode: "json",
          jsonSchema: {
            type: "object",
            required: ["answer"],
            properties: {
              answer: {
                type: "integer",
              },
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        parseStatus?: string;
        parseError?: string | null;
        parsedOutput?: unknown;
        schemaValidation?: {
          status?: string;
          errors?: string[];
          issues?: Array<{
            path?: string;
            keyword?: string;
            message?: string;
          }>;
        };
        contract?: {
          status?: string;
          rejected?: boolean;
          failures?: Array<{
            kind?: string;
            message?: string;
          }>;
        };
      };
    };

    assert.equal(payload.result?.parseStatus, "invalid_json");
    assert.match(payload.result?.parseError ?? "", /JSON|Unexpected|position/i);
    assert.equal(payload.result?.parsedOutput, null);
    assert.deepEqual(payload.result?.schemaValidation, {
      status: "skipped_invalid_json",
      errors: [],
      issues: [],
    });
    assert.equal(payload.result?.contract?.status, "failed");
    assert.equal(payload.result?.contract?.rejected, false);
    assert.equal(payload.result?.contract?.failures?.[0]?.kind, "invalid_json");
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => ({
        taskId: "task-automation-invalid-json",
        requestId: "req-automation-invalid-json",
        status: "completed",
        summary: "invalid json automation selected",
        output: "answer: 42",
        completedAt: "2026-04-05T09:31:00.000Z",
      }),
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
  }));
});

test("/api/tasks/automation/run 在 schema 不通过时会返回 failed 和错误列表", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请返回 JSON",
        sessionId: "session-task-automation-schema-failed",
        automation: {
          outputMode: "json",
          jsonSchema: {
            type: "object",
            required: ["answer"],
            additionalProperties: false,
            properties: {
              answer: {
                type: "integer",
              },
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        parseStatus?: string;
        parsedOutput?: unknown;
        schemaValidation?: {
          status?: string;
          errors?: string[];
          issues?: Array<{
            path?: string;
            keyword?: string;
            message?: string;
          }>;
        };
        contract?: {
          status?: string;
          rejected?: boolean;
          failures?: Array<{
            kind?: string;
            message?: string;
          }>;
        };
      };
    };

    assert.equal(payload.result?.parseStatus, "parsed");
    assert.deepEqual(payload.result?.parsedOutput, {
      answer: "forty-two",
      extra: true,
    });
    assert.equal(payload.result?.schemaValidation?.status, "failed");
    assert.ok((payload.result?.schemaValidation?.errors?.length ?? 0) >= 2);
    assert.ok((payload.result?.schemaValidation?.issues?.length ?? 0) >= 2);
    assert.ok(payload.result?.schemaValidation?.errors?.some((entry) => entry.includes("$.answer")));
    assert.ok(payload.result?.schemaValidation?.errors?.some((entry) => entry.includes("$.extra")));
    assert.ok(payload.result?.schemaValidation?.issues?.some((entry) => entry.keyword === "type" && entry.path === "$.answer"));
    assert.ok(payload.result?.schemaValidation?.issues?.some((entry) => entry.keyword === "additionalProperties" && entry.path === "$.extra"));
    assert.equal(payload.result?.contract?.status, "failed");
    assert.equal(payload.result?.contract?.rejected, false);
    assert.ok(payload.result?.contract?.failures?.some((entry) => entry.kind === "schema_mismatch"));
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => ({
        taskId: "task-automation-schema-failed",
        requestId: "req-automation-schema-failed",
        status: "completed",
        summary: "schema failed automation selected",
        output: "{\"answer\":\"forty-two\",\"extra\":true}",
        completedAt: "2026-04-05T09:32:00.000Z",
      }),
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
  }));
});

test("/api/tasks/automation/run 会返回结构化 schema issues 并支持更多高频关键词", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请返回 JSON",
        sessionId: "session-task-automation-schema-issues",
        automation: {
          outputMode: "json",
          jsonSchema: {
            type: "object",
            required: ["status", "name", "score", "tags"],
            properties: {
              status: {
                const: "ok",
              },
              name: {
                type: "string",
                minLength: 3,
                pattern: "^[A-Z].+",
              },
              score: {
                type: "integer",
                minimum: 0,
                maximum: 100,
              },
              tags: {
                type: "array",
                minItems: 2,
                maxItems: 2,
                uniqueItems: true,
                items: {
                  type: "string",
                },
              },
            },
          },
        },
      }),
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      result?: {
        schemaValidation?: {
          status?: string;
          errors?: string[];
          issues?: Array<{
            path?: string;
            keyword?: string;
            message?: string;
          }>;
        };
        contract?: {
          status?: string;
          failures?: Array<{
            kind?: string;
          }>;
        };
      };
    };

    assert.equal(payload.result?.schemaValidation?.status, "failed");
    assert.ok((payload.result?.schemaValidation?.errors?.length ?? 0) >= 6);
    assert.ok(payload.result?.schemaValidation?.issues?.some((entry) => entry.keyword === "const" && entry.path === "$.status"));
    assert.ok(payload.result?.schemaValidation?.issues?.some((entry) => entry.keyword === "minLength" && entry.path === "$.name"));
    assert.ok(payload.result?.schemaValidation?.issues?.some((entry) => entry.keyword === "pattern" && entry.path === "$.name"));
    assert.ok(payload.result?.schemaValidation?.issues?.some((entry) => entry.keyword === "maximum" && entry.path === "$.score"));
    assert.ok(payload.result?.schemaValidation?.issues?.some((entry) => entry.keyword === "maxItems" && entry.path === "$.tags"));
    assert.ok(payload.result?.schemaValidation?.issues?.some((entry) => entry.keyword === "uniqueItems" && entry.path === "$.tags[1]"));
    assert.equal(payload.result?.contract?.status, "failed");
    assert.ok(payload.result?.contract?.failures?.some((entry) => entry.kind === "schema_mismatch"));
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => ({
        taskId: "task-automation-schema-issues",
        requestId: "req-automation-schema-issues",
        status: "completed",
        summary: "schema issues automation selected",
        output: "{\"status\":\"bad\",\"name\":\"ab\",\"score\":101,\"tags\":[\"dup\",\"dup\",\"extra\"]}",
        completedAt: "2026-04-05T10:10:00.000Z",
      }),
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
  }));
});

test("/api/tasks/automation/run 在显式要求 invalid json reject 时会返回 422", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请返回 JSON",
        sessionId: "session-task-automation-invalid-json-reject",
        automation: {
          outputMode: "json",
          onInvalidJson: "reject",
        },
      }),
    });

    assert.equal(response.status, 422);

    const payload = await response.json() as {
      result?: {
        parseStatus?: string;
        contract?: {
          status?: string;
          rejected?: boolean;
          onInvalidJson?: string;
          failures?: Array<{
            kind?: string;
            message?: string;
          }>;
        };
      };
    };

    assert.equal(payload.result?.parseStatus, "invalid_json");
    assert.equal(payload.result?.contract?.status, "failed");
    assert.equal(payload.result?.contract?.rejected, true);
    assert.equal(payload.result?.contract?.onInvalidJson, "reject");
    assert.equal(payload.result?.contract?.failures?.[0]?.kind, "invalid_json");
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => ({
        taskId: "task-automation-invalid-json-reject",
        requestId: "req-automation-invalid-json-reject",
        status: "completed",
        summary: "invalid json automation reject selected",
        output: "answer: 42",
        completedAt: "2026-04-05T10:00:00.000Z",
      }),
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
  }));
});

test("/api/tasks/automation/run 在显式要求 schema mismatch reject 时会返回 422", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请返回 JSON",
        sessionId: "session-task-automation-schema-reject",
        automation: {
          outputMode: "json",
          onSchemaMismatch: "reject",
          jsonSchema: {
            type: "object",
            required: ["answer"],
            additionalProperties: false,
            properties: {
              answer: {
                type: "integer",
              },
            },
          },
        },
      }),
    });

    assert.equal(response.status, 422);

    const payload = await response.json() as {
      result?: {
        parseStatus?: string;
        contract?: {
          status?: string;
          rejected?: boolean;
          onSchemaMismatch?: string;
          failures?: Array<{
            kind?: string;
            message?: string;
          }>;
        };
      };
    };

    assert.equal(payload.result?.parseStatus, "parsed");
    assert.equal(payload.result?.contract?.status, "failed");
    assert.equal(payload.result?.contract?.rejected, true);
    assert.equal(payload.result?.contract?.onSchemaMismatch, "reject");
    assert.ok(payload.result?.contract?.failures?.some((entry) => entry.kind === "schema_mismatch"));
  }, ({ runtimeStore }) => ({
    defaultRuntime: {
      runTask: async () => ({
        taskId: "task-automation-schema-reject",
        requestId: "req-automation-schema-reject",
        status: "completed",
        summary: "schema reject automation selected",
        output: "{\"answer\":\"forty-two\"}",
        completedAt: "2026-04-05T10:01:00.000Z",
      }),
      getRuntimeStore: () => runtimeStore,
      getIdentityLinkService: () => ({}),
      getPrincipalSkillsService: () => ({}),
    },
  }));
});

test("/api/tasks/automation/run 在未提供 schema 时拒绝 onSchemaMismatch 配置", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查 reject 配置",
        sessionId: "session-task-automation-invalid-schema-mode",
        automation: {
          outputMode: "json",
          onSchemaMismatch: "reject",
        },
      }),
    });

    assert.equal(response.status, 400);

    const payload = await response.json() as {
      mode?: string;
      automationVersion?: number;
      error?: {
        code?: string;
        message?: string;
      };
    };

    assert.equal(payload.mode, "automation");
    assert.equal(payload.automationVersion, 1);
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.match(payload.error?.message ?? "", /automation\.onSchemaMismatch requires automation\.jsonSchema/i);
  });
});

test("/api/tasks/automation/run 在 text 模式下拒绝 onInvalidJson 配置", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查 reject 配置",
        sessionId: "session-task-automation-invalid-json-mode",
        automation: {
          outputMode: "text",
          onInvalidJson: "reject",
        },
      }),
    });

    assert.equal(response.status, 400);

    const payload = await response.json() as {
      mode?: string;
      automationVersion?: number;
      error?: {
        code?: string;
        message?: string;
      };
    };

    assert.equal(payload.mode, "automation");
    assert.equal(payload.automationVersion, 1);
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.match(payload.error?.message ?? "", /automation\.onInvalidJson requires automation\.outputMode = "json"/i);
  });
});

test("/api/tasks/automation/run 显式传 sdk runtimeEngine 时返回 400，且不会执行任何 runtime", async () => {
  let defaultRunCount = 0;
  let sdkRunCount = 0;

  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    const response = await fetch(`${baseUrl}/api/tasks/automation/run`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查自动化入口拒绝 sdk",
        sessionId: "session-task-automation-sdk-runtime",
        options: {
          runtimeEngine: "sdk",
        },
      }),
    });

    assert.equal(response.status, 400);

    const payload = await response.json() as {
      mode?: string;
      automationVersion?: number;
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.mode, "automation");
    assert.equal(payload.automationVersion, 1);
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.match(payload.error?.message ?? "", /Invalid runtimeEngine: sdk/);
    assert.equal(defaultRunCount, 0);
    assert.equal(sdkRunCount, 0);
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
    runtimes: {},
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

    (runtime as AppServerTaskRuntime & {
      runTask: AppServerTaskRuntime["runTask"];
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
    runtimes: {},
  }));
});

test("/api/tasks/stream 会把 inputEnvelope 送进真实提交链", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore, runtime }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    let receivedEnvelope: unknown = null;

    (runtime as AppServerTaskRuntime & {
      runTask: AppServerTaskRuntime["runTask"];
    }).runTask = async (request) => {
      receivedEnvelope = request.inputEnvelope ?? null;
      return {
        taskId: request.taskId ?? "task-stream-envelope",
        requestId: request.requestId,
        status: "completed",
        summary: "envelope accepted",
        completedAt: "2026-03-28T09:10:00.000Z",
      };
    };

    const response = await fetch(`${baseUrl}/api/tasks/stream`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        goal: "请检查 inputEnvelope",
        sessionId: "session-task-stream-envelope",
        inputEnvelope: {
          envelopeId: "env-stream-1",
          sourceChannel: "web",
          sourceSessionId: "thread-a",
          createdAt: "2026-04-01T22:00:00.000Z",
          parts: [
            {
              partId: "part-1",
              type: "text",
              role: "user",
              order: 1,
              text: "请检查 inputEnvelope",
            },
          ],
          assets: [],
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(receivedEnvelope, {
      envelopeId: "env-stream-1",
      sourceChannel: "web",
      sourceSessionId: "thread-a",
      createdAt: "2026-04-01T22:00:00.000Z",
      parts: [
        {
          partId: "part-1",
          type: "text",
          role: "user",
          order: 1,
          text: "请检查 inputEnvelope",
        },
      ],
      assets: [],
    });
  }, ({ runtime }) => ({
    defaultRuntime: runtime,
    runtimes: {},
  }));
});

test("/api/history/sessions/:id 会返回 turn input 的降级摘要", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });

    runtimeStore.upsertTurnFromRequest({
      requestId: "req-history-turn-input",
      sourceChannel: "web",
      channelContext: {
        sessionId: "session-history-turn-input",
      },
      user: {
        userId: "user-history-turn-input",
      },
      goal: "请基于图片总结内容",
      createdAt: "2026-04-01T21:30:00.000Z",
    }, "task-history-turn-input");
    runtimeStore.saveTurnInput({
      requestId: "req-history-turn-input",
      envelope: {
        envelopeId: "env-history-turn-input",
        sourceChannel: "web",
        parts: [
          {
            partId: "part-1",
            type: "text",
            role: "user",
            order: 1,
            text: "请基于图片总结内容",
          },
          {
            partId: "part-2",
            type: "image",
            role: "user",
            order: 2,
            assetId: "asset-image-1",
          },
        ],
        assets: [
          {
            assetId: "asset-image-1",
            kind: "image",
            mimeType: "image/png",
            localPath: "/workspace/temp/input-assets/history.png",
            sourceChannel: "web",
            ingestionStatus: "ready",
          },
        ],
        createdAt: "2026-04-01T21:30:00.000Z",
      },
      compileSummary: {
        runtimeTarget: "sdk",
        degradationLevel: "controlled_fallback",
        warnings: [
          {
            code: "IMAGE_UPLOADED_AS_ATTACHMENT",
            message: "当前 runtime 不支持原生图片输入，已降级为附件描述。",
            assetId: "asset-image-1",
          },
        ],
      },
      createdAt: "2026-04-01T21:30:00.000Z",
    });

    const response = await fetch(`${baseUrl}/api/history/sessions/session-history-turn-input`, {
      method: "GET",
      headers: authHeaders,
    });

    assert.equal(response.status, 200);

    const payload = await response.json() as {
      turns?: Array<{
        requestId?: string;
        input?: {
          compileSummary?: {
            runtimeTarget?: string;
            degradationLevel?: string;
            warnings?: Array<{
              code?: string;
              assetId?: string;
            }>;
          };
        };
      }>;
    };

    assert.equal(payload.turns?.[0]?.requestId, "req-history-turn-input");
    assert.equal(payload.turns?.[0]?.input?.compileSummary?.runtimeTarget, "sdk");
    assert.equal(payload.turns?.[0]?.input?.compileSummary?.degradationLevel, "controlled_fallback");
    assert.equal(payload.turns?.[0]?.input?.compileSummary?.warnings?.[0]?.code, "IMAGE_UPLOADED_AS_ATTACHMENT");
    assert.equal(payload.turns?.[0]?.input?.compileSummary?.warnings?.[0]?.assetId, "asset-image-1");
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
