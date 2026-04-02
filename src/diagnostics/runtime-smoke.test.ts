import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { RuntimeSmokeService } from "./runtime-smoke.js";

test("RuntimeSmokeService.runWebSmoke 在 action_required -> completed 的真实链路下返回成功结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-web-success-"));

  try {
    const fetchCalls: Array<{ input: string; init?: RequestInit | undefined }> = [];
    const service = createService(root, {
      fetchImpl: async (input, init) => {
        const url = normalizeUrl(input);
        fetchCalls.push({ input: url, init });

        if (url.endsWith("/api/web-auth/login")) {
          return new Response(null, {
            status: 200,
            headers: {
              "set-cookie": "themis_web_session=session-smoke-1; Path=/; HttpOnly",
            },
          });
        }

        if (url.endsWith("/api/tasks/stream")) {
          return new Response(
            [
              JSON.stringify({
                kind: "ack",
                requestId: "req-smoke-1",
                taskId: "task-smoke-1",
                title: "task.accepted",
                text: "accepted",
              }),
              JSON.stringify({
                kind: "event",
                requestId: "req-smoke-1",
                taskId: "task-smoke-1",
                title: "task.action_required",
                text: "请补充输入",
                metadata: {
                  actionId: "action-smoke-1",
                },
              }),
              JSON.stringify({
                kind: "result",
                requestId: "req-smoke-1",
                taskId: "task-smoke-1",
                metadata: {
                  structuredOutput: {
                    status: "completed",
                  },
                },
              }),
              JSON.stringify({
                kind: "done",
                requestId: "req-smoke-1",
                taskId: "task-smoke-1",
                result: {
                  status: "completed",
                },
              }),
            ].join("\n"),
            {
              status: 200,
              headers: {
                "content-type": "application/x-ndjson; charset=utf-8",
              },
            },
          );
        }

        if (url.endsWith("/api/tasks/actions")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          });
        }

        if (url.includes("/api/history/sessions/")) {
          return new Response(
            JSON.stringify({
              turns: [
                {
                  status: "completed",
                },
              ],
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
            },
          );
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runWebSmoke();

    assert.equal(result.ok, true);
    assert.equal(result.baseUrl, "http://127.0.0.1:3100");
    assert.equal(result.sessionId!.length > 0, true);
    assert.equal(result.requestId!.length > 0, true);
    assert.equal(result.taskId!.length > 0, true);
    assert.equal(result.actionId, "action-smoke-1");
    assert.equal(result.observedActionRequired, true);
    assert.equal(result.observedCompleted, true);
    assert.equal(result.historyCompleted, true);
    assert.match(result.message, /completed/);
    assert.ok(fetchCalls.some((call) => call.input.endsWith("/api/web-auth/login")));
    assert.ok(fetchCalls.some((call) => call.input.endsWith("/api/tasks/stream")));
    assert.ok(fetchCalls.some((call) => call.input.endsWith("/api/tasks/actions")));
    assert.ok(fetchCalls.some((call) => call.input.includes("/api/history/sessions/")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runWebSmoke 在 action_required/result/done 同一 chunk 到达时仍能判定 completed", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-web-single-chunk-"));

  try {
    const service = createService(root, {
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url.endsWith("/api/web-auth/login")) {
          return new Response(null, {
            status: 200,
            headers: {
              "set-cookie": "themis_web_session=session-smoke-single-chunk; Path=/; HttpOnly",
            },
          });
        }

        if (url.endsWith("/api/tasks/stream")) {
          return createSingleChunkNdjsonResponse([
            {
              kind: "ack",
              requestId: "req-smoke-single-chunk",
              taskId: "task-smoke-single-chunk",
              title: "task.accepted",
              text: "accepted",
            },
            {
              kind: "event",
              requestId: "req-smoke-single-chunk",
              taskId: "task-smoke-single-chunk",
              title: "task.action_required",
              text: "请补充输入",
              metadata: {
                actionId: "action-smoke-single-chunk",
              },
            },
            {
              kind: "result",
              requestId: "req-smoke-single-chunk",
              taskId: "task-smoke-single-chunk",
              metadata: {
                structuredOutput: {
                  status: "completed",
                },
              },
            },
            {
              kind: "done",
              requestId: "req-smoke-single-chunk",
              taskId: "task-smoke-single-chunk",
              result: {
                status: "completed",
              },
            },
          ]);
        }

        if (url.endsWith("/api/tasks/actions")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          });
        }

        if (url.includes("/api/history/sessions/")) {
          return new Response(
            JSON.stringify({
              turns: [
                {
                  status: "completed",
                },
              ],
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
            },
          );
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runWebSmoke();

    assert.equal(result.ok, true);
    assert.equal(result.observedActionRequired, true);
    assert.equal(result.observedCompleted, true);
    assert.equal(result.historyCompleted, true);
    assert.equal(result.actionId, "action-smoke-single-chunk");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runWebSmoke 在未进入 action_required 时返回失败结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-web-fail-"));

  try {
    const service = createService(root, {
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url.endsWith("/api/web-auth/login")) {
          return new Response(null, {
            status: 200,
            headers: {
              "set-cookie": "themis_web_session=session-smoke-2; Path=/; HttpOnly",
            },
          });
        }

        if (url.endsWith("/api/tasks/stream")) {
          return new Response(
            [
              JSON.stringify({
                kind: "ack",
                requestId: "req-smoke-2",
                taskId: "task-smoke-2",
                title: "task.accepted",
                text: "accepted",
              }),
              JSON.stringify({
                kind: "done",
                requestId: "req-smoke-2",
                taskId: "task-smoke-2",
                result: {
                  status: "completed",
                },
              }),
            ].join("\n"),
            {
              status: 200,
              headers: {
                "content-type": "application/x-ndjson; charset=utf-8",
              },
            },
          );
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runWebSmoke();

    assert.equal(result.ok, false);
    assert.equal(result.observedActionRequired, false);
    assert.equal(result.observedCompleted, false);
    assert.equal(result.historyCompleted, false);
    assert.equal(result.actionId, null);
    assert.match(result.message, /action_required/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runFeishuSmoke 在缺少 FEISHU_APP_ID / FEISHU_APP_SECRET 时返回失败结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-feishu-fail-"));

  try {
    const service = createService(root, {
      env: {},
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url === "http://127.0.0.1:3100/") {
          return new Response(null, {
            status: 302,
            headers: {
              location: "/login",
            },
          });
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runFeishuSmoke();

    assert.equal(result.ok, false);
    assert.equal(result.serviceReachable, true);
    assert.equal(result.feishuConfigReady, false);
    assert.equal(result.docPath, "docs/feishu/themis-feishu-real-journey-smoke.md");
    assert.ok(result.nextSteps.some((step) => step.includes("./themis doctor feishu")));
    assert.ok(result.nextSteps.some((step) => step.includes("./themis doctor smoke feishu")));
    assert.ok(result.nextSteps.some((step) => step.includes("A/B 手工路径")));
    assert.match(result.message, /FEISHU_APP_ID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runFeishuSmoke 在根路径返回 302/login 时仍判定服务可达", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-feishu-login-redirect-"));

  try {
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(
      join(root, "infra/local/feishu-sessions.json"),
      JSON.stringify(
        {
          version: 1,
          bindings: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              activeSessionId: "session-1",
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra/local/feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [
            {
              draftId: "draft-1",
              sessionId: "session-1",
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const service = createService(root, {
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url === "http://127.0.0.1:3100/") {
          return new Response(null, {
            status: 302,
            headers: {
              location: "/login",
            },
          });
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runFeishuSmoke();

    assert.equal(result.ok, true);
    assert.equal(result.serviceReachable, true);
    assert.equal(result.feishuConfigReady, true);
    assert.equal(result.statusCode, 302);
    assert.equal(result.sessionBindingCount, 1);
    assert.equal(result.attachmentDraftCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runFeishuSmoke 会复用快照里的配置就绪状态", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-feishu-snapshot-env-"));

  try {
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(
      join(root, "infra/local/feishu-sessions.json"),
      JSON.stringify(
        {
          version: 1,
          bindings: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              activeSessionId: "session-1",
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra/local/feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [
            {
              draftId: "draft-1",
              sessionId: "session-1",
              updatedAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const env = createSnapshotAwareEnv();
    const service = createService(root, {
      env,
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url === "http://127.0.0.1:3100/") {
          void env.FEISHU_APP_ID;
          void env.FEISHU_APP_SECRET;
          return new Response(null, {
            status: 302,
            headers: {
              location: "/login",
            },
          });
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runFeishuSmoke();

    assert.equal(result.ok, true);
    assert.equal(result.feishuConfigReady, true);
    assert.equal(result.statusCode, 302);
    assert.equal(result.sessionBindingCount, 1);
    assert.equal(result.attachmentDraftCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runFeishuSmoke 在健康检查返回 500 时判定为不可达", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-feishu-health-fail-"));

  try {
    const service = createService(root, {
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url === "http://127.0.0.1:3100/") {
          return new Response(null, { status: 500 });
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runFeishuSmoke();

    assert.equal(result.ok, false);
    assert.equal(result.serviceReachable, false);
    assert.equal(result.feishuConfigReady, true);
    assert.match(result.message, /不可达/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runAllSmoke 在 web 失败时不会误报 feishu 已可接力", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-all-fail-"));

  try {
    const service = createService(root, {
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url.endsWith("/api/web-auth/login")) {
          return new Response(null, {
            status: 200,
            headers: {
              "set-cookie": "themis_web_session=session-smoke-3; Path=/; HttpOnly",
            },
          });
        }

        if (url.endsWith("/api/tasks/stream")) {
          return new Response(
            [
              JSON.stringify({
                kind: "ack",
                requestId: "req-smoke-3",
                taskId: "task-smoke-3",
                title: "task.accepted",
                text: "accepted",
              }),
              JSON.stringify({
                kind: "done",
                requestId: "req-smoke-3",
                taskId: "task-smoke-3",
                result: {
                  status: "completed",
                },
              }),
            ].join("\n"),
            {
              status: 200,
              headers: {
                "content-type": "application/x-ndjson; charset=utf-8",
              },
            },
          );
        }

        if (url.endsWith("/api/health")) {
          throw new Error("feishu smoke should not run when web smoke fails");
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runAllSmoke();

    assert.equal(result.web.ok, false);
    assert.equal(result.feishu, null);
    assert.equal(result.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createService(
  root: string,
  overrides: Partial<ConstructorParameters<typeof RuntimeSmokeService>[0]> = {},
): RuntimeSmokeService {
  return new RuntimeSmokeService({
    workingDirectory: root,
    baseUrl: "http://127.0.0.1:3100",
    env: {},
    fetchImpl: globalThis.fetch.bind(globalThis),
    clock: () => 1_710_000_000_000,
    randomHex: (bytes) => "f".repeat(bytes * 2),
    registryFactory: (databaseFile) => new SqliteCodexSessionRegistry({ databaseFile }),
    ...overrides,
  });
}

function normalizeUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function createSingleChunkNdjsonResponse(lines: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const chunk = encoder.encode(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  }), {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
    },
  });
}

function createSnapshotAwareEnv(): NodeJS.ProcessEnv {
  let accessCount = 0;
  const backing = new Map<string, string>([
    ["FEISHU_APP_ID", "cli_xxx"],
    ["FEISHU_APP_SECRET", "secret_xxx"],
  ]);

  return new Proxy({} as NodeJS.ProcessEnv, {
    get(_target, property) {
      if (typeof property !== "string") {
        return undefined;
      }

      if (property === "FEISHU_APP_ID" || property === "FEISHU_APP_SECRET") {
        accessCount += 1;
        return accessCount <= 2 ? undefined : backing.get(property);
      }

      return backing.get(property);
    },
    has(_target, property) {
      return typeof property === "string" && backing.has(property);
    },
  });
}
