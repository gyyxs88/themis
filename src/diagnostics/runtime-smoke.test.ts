import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { buildFeishuSmokeNextSteps } from "./feishu-verification-guide.js";
import { RuntimeSmokeService } from "./runtime-smoke.js";

test("RuntimeSmokeService.runWebSmoke 在 action_required -> completed 的真实链路下返回成功结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-web-success-"));

  try {
    const fetchCalls: Array<{ input: string; init?: RequestInit | undefined }> = [];
    const webSmokeFetch = createSuccessfulWebSmokeFetch();
    const service = createService(root, {
      fetchImpl: async (input, init) => {
        const url = normalizeUrl(input);
        fetchCalls.push({ input: url, init });
        return await webSmokeFetch(input, init);
      },
    });

    const result = await service.runWebSmoke();

    assert.equal(result.ok, true);
    assert.equal(result.baseUrl, "http://127.0.0.1:3100");
    assert.equal(result.sessionId!.length > 0, true);
    assert.equal(result.requestId!.length > 0, true);
    assert.equal(result.taskId!.length > 0, true);
    assert.match(result.actionId ?? "", /^action-/);
    assert.equal(result.observedActionRequired, true);
    assert.equal(result.observedCompleted, true);
    assert.equal(result.historyCompleted, true);
    assert.equal(result.imageCompileVerified, true);
    assert.equal(result.imageCompileDegradationLevel, "native");
    assert.deepEqual(result.imageCompileWarningCodes, []);
    assert.equal(result.imageCompileMatrixVerified, true);
    assert.equal(result.imageCompileMatrixImageNative, "transport=yes effective=yes");
    assert.deepEqual(result.imageCompileMatrixAssetHandling, ["native"]);
    assert.equal(result.documentCompileVerified, true);
    assert.equal(result.documentCompileDegradationLevel, "controlled_fallback");
    assert.deepEqual(result.documentCompileWarningCodes, ["DOCUMENT_NATIVE_INPUT_FALLBACK"]);
    assert.equal(result.documentCompileMatrixVerified, true);
    assert.equal(result.documentCompileMatrixDocumentNative, "transport=no effective=no");
    assert.deepEqual(result.documentCompileMatrixAssetHandling, ["path_fallback"]);
    assert.equal(result.sharedBoundary.ok, true);
    assert.equal(result.sharedBoundary.imagePathBlockedVerified, true);
    assert.deepEqual(result.sharedBoundary.imagePathWarningCodes, ["IMAGE_PATH_UNAVAILABLE"]);
    assert.equal(result.sharedBoundary.documentPathBlockedVerified, true);
    assert.deepEqual(result.sharedBoundary.documentPathWarningCodes, ["DOCUMENT_PATH_UNAVAILABLE"]);
    assert.equal(result.sharedBoundary.textNativeBlockedVerified, true);
    assert.deepEqual(result.sharedBoundary.textNativeWarningCodes, ["TEXT_NATIVE_INPUT_REQUIRED"]);
    assert.equal(result.sharedBoundary.imageNativeBlockedVerified, true);
    assert.deepEqual(result.sharedBoundary.imageNativeWarningCodes, ["IMAGE_NATIVE_INPUT_REQUIRED"]);
    assert.equal(result.sharedBoundary.documentMimeNativeVerified, true);
    assert.deepEqual(result.sharedBoundary.documentMimeNativeWarningCodes, []);
    assert.equal(result.sharedBoundary.documentMimeFallbackVerified, true);
    assert.deepEqual(result.sharedBoundary.documentMimeWarningCodes, ["DOCUMENT_MIME_TYPE_FALLBACK"]);
    assert.match(result.message, /附件异常 \/ MIME 边界 compile smoke/);
    assert.ok(fetchCalls.some((call) => call.input.endsWith("/api/web-auth/login")));
    assert.equal(fetchCalls.filter((call) => call.input.endsWith("/api/tasks/stream")).length, 2);
    assert.ok(fetchCalls.some((call) => call.input.endsWith("/api/tasks/actions")));
    assert.equal(fetchCalls.filter((call) => call.input.includes("/api/history/sessions/")).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runWebSmoke 在 action_required/result/done 同一 chunk 到达时仍能判定 completed", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-web-single-chunk-"));

  try {
    const webSmokeFetch = createSuccessfulWebSmokeFetch({ singleChunk: true });
    const service = createService(root, {
      fetchImpl: async (input, init) => await webSmokeFetch(input, init),
    });

    const result = await service.runWebSmoke();

    assert.equal(result.ok, true);
    assert.equal(result.observedActionRequired, true);
    assert.equal(result.observedCompleted, true);
    assert.equal(result.historyCompleted, true);
    assert.equal(result.imageCompileVerified, true);
    assert.equal(result.imageCompileDegradationLevel, "native");
    assert.deepEqual(result.imageCompileWarningCodes, []);
    assert.equal(result.imageCompileMatrixVerified, true);
    assert.equal(result.imageCompileMatrixImageNative, "transport=yes effective=yes");
    assert.deepEqual(result.imageCompileMatrixAssetHandling, ["native"]);
    assert.equal(result.documentCompileVerified, true);
    assert.equal(result.documentCompileDegradationLevel, "controlled_fallback");
    assert.deepEqual(result.documentCompileWarningCodes, ["DOCUMENT_NATIVE_INPUT_FALLBACK"]);
    assert.equal(result.documentCompileMatrixVerified, true);
    assert.equal(result.documentCompileMatrixDocumentNative, "transport=no effective=no");
    assert.deepEqual(result.documentCompileMatrixAssetHandling, ["path_fallback"]);
    assert.equal(result.sharedBoundary.ok, true);
    assert.equal(result.sharedBoundary.imagePathBlockedVerified, true);
    assert.deepEqual(result.sharedBoundary.imagePathWarningCodes, ["IMAGE_PATH_UNAVAILABLE"]);
    assert.equal(result.sharedBoundary.documentPathBlockedVerified, true);
    assert.deepEqual(result.sharedBoundary.documentPathWarningCodes, ["DOCUMENT_PATH_UNAVAILABLE"]);
    assert.equal(result.sharedBoundary.textNativeBlockedVerified, true);
    assert.deepEqual(result.sharedBoundary.textNativeWarningCodes, ["TEXT_NATIVE_INPUT_REQUIRED"]);
    assert.equal(result.sharedBoundary.imageNativeBlockedVerified, true);
    assert.deepEqual(result.sharedBoundary.imageNativeWarningCodes, ["IMAGE_NATIVE_INPUT_REQUIRED"]);
    assert.equal(result.sharedBoundary.documentMimeNativeVerified, true);
    assert.deepEqual(result.sharedBoundary.documentMimeNativeWarningCodes, []);
    assert.equal(result.sharedBoundary.documentMimeFallbackVerified, true);
    assert.deepEqual(result.sharedBoundary.documentMimeWarningCodes, ["DOCUMENT_MIME_TYPE_FALLBACK"]);
    assert.match(result.actionId ?? "", /^action-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runWebSmoke 在 compile summary 缺少能力矩阵事实时返回失败结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-web-matrix-fail-"));

  try {
    const webSmokeFetch = createSuccessfulWebSmokeFetch({ omitCapabilityMatrix: true });
    const service = createService(root, {
      fetchImpl: async (input, init) => await webSmokeFetch(input, init),
    });

    const result = await service.runWebSmoke();

    assert.equal(result.ok, false);
    assert.equal(result.imageCompileVerified, true);
    assert.equal(result.imageCompileMatrixVerified, false);
    assert.equal(result.imageCompileMatrixImageNative, null);
    assert.deepEqual(result.imageCompileMatrixAssetHandling, []);
    assert.match(result.message, /能力矩阵/);
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

test("RuntimeSmokeService.runWebSmoke 在 action_required 缺少 actionId 时返回失败结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-web-missing-action-id-"));

  try {
    const service = createService(root, {
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url.endsWith("/api/web-auth/login")) {
          return new Response(null, {
            status: 200,
            headers: {
              "set-cookie": "themis_web_session=session-smoke-missing-action-id; Path=/; HttpOnly",
            },
          });
        }

        if (url.endsWith("/api/tasks/stream")) {
          return new Response(
            [
              JSON.stringify({
                kind: "ack",
                requestId: "req-smoke-missing-action-id",
                taskId: "task-smoke-missing-action-id",
                title: "task.accepted",
                text: "accepted",
              }),
              JSON.stringify({
                kind: "event",
                requestId: "req-smoke-missing-action-id",
                taskId: "task-smoke-missing-action-id",
                title: "task.action_required",
                text: "请补充输入",
                metadata: {
                  actionType: "user-input",
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
    assert.equal(result.observedActionRequired, true);
    assert.equal(result.observedCompleted, false);
    assert.equal(result.historyCompleted, false);
    assert.equal(result.actionId, null);
    assert.match(result.message, /缺少 actionId/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RuntimeSmokeService.runWebSmoke 在 stream completed 但 history/detail 无法确认收口时返回失败结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-web-history-fail-"));

  try {
    const service = createService(root, {
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url.endsWith("/api/web-auth/login")) {
          return new Response(null, {
            status: 200,
            headers: {
              "set-cookie": "themis_web_session=session-smoke-history-fail; Path=/; HttpOnly",
            },
          });
        }

        if (url.endsWith("/api/tasks/stream")) {
          return new Response(
            [
              JSON.stringify({
                kind: "ack",
                requestId: "req-smoke-history-fail",
                taskId: "task-smoke-history-fail",
                title: "task.accepted",
                text: "accepted",
              }),
              JSON.stringify({
                kind: "event",
                requestId: "req-smoke-history-fail",
                taskId: "task-smoke-history-fail",
                title: "task.action_required",
                text: "请补充输入",
                metadata: {
                  actionId: "action-smoke-history-fail",
                },
              }),
              JSON.stringify({
                kind: "result",
                requestId: "req-smoke-history-fail",
                taskId: "task-smoke-history-fail",
                metadata: {
                  structuredOutput: {
                    status: "completed",
                  },
                },
              }),
              JSON.stringify({
                kind: "done",
                requestId: "req-smoke-history-fail",
                taskId: "task-smoke-history-fail",
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
          return new Response("history broken", { status: 500 });
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runWebSmoke();

    assert.equal(result.ok, false);
    assert.equal(result.observedActionRequired, true);
    assert.equal(result.observedCompleted, true);
    assert.equal(result.historyCompleted, false);
    assert.equal(result.actionId, "action-smoke-history-fail");
    assert.match(result.message, /history detail status=500/);
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
    assert.equal(result.diagnosisId, "config_missing");
    assert.match(result.diagnosisSummary, /FEISHU_APP_ID \/ FEISHU_APP_SECRET 未完整配置/);
    assert.equal(result.serviceReachable, true);
    assert.equal(result.feishuConfigReady, false);
    assert.equal(result.docPath, "docs/feishu/themis-feishu-real-journey-smoke.md");
    assert.deepEqual(result.nextSteps, buildFeishuSmokeNextSteps());
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
    assert.equal(result.diagnosisId, "healthy");
    assert.equal(result.diagnosisSummary, "飞书配置、服务可达性和最近窗口摘要看起来正常，继续按固定复跑顺序验证即可。");
    assert.equal(result.serviceReachable, true);
    assert.equal(result.feishuConfigReady, true);
    assert.equal(result.statusCode, 302);
    assert.equal(result.sessionBindingCount, 1);
    assert.equal(result.attachmentDraftCount, 1);
    assert.deepEqual(result.nextSteps, buildFeishuSmokeNextSteps());
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
    assert.equal(result.diagnosisId, "healthy");
    assert.equal(env.getAccessCount(), 2);
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

test("RuntimeSmokeService.runFeishuSmoke 会输出固定复跑顺序和诊断摘要", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-feishu-diagnosis-"));

  try {
    const service = createService(root, {
      env: {
        FEISHU_APP_ID: "cli_xxx",
        FEISHU_APP_SECRET: "secret_xxx",
      },
      fetchImpl: async (input) => {
        const url = normalizeUrl(input);

        if (url === "http://127.0.0.1:3100/") {
          return new Response(null, {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
          });
        }

        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await service.runFeishuSmoke();

    assert.equal(result.ok, true);
    assert.equal(result.diagnosisId, "healthy");
    assert.equal(result.diagnosisSummary, "飞书配置、服务可达性和最近窗口摘要看起来正常，继续按固定复跑顺序验证即可。");
    assert.deepEqual(result.nextSteps, buildFeishuSmokeNextSteps());
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

test("RuntimeSmokeService.runAllSmoke 在 web 通过但 feishu 前置检查失败时会保留 feishu 结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-runtime-smoke-all-feishu-fail-"));

  try {
    const webSmokeFetch = createSuccessfulWebSmokeFetch();
    const service = createService(root, {
      env: {},
      fetchImpl: async (input, init) => {
        const url = normalizeUrl(input);

        if (url.endsWith("/api/web-auth/login")
          || url.endsWith("/api/tasks/stream")
          || url.endsWith("/api/tasks/actions")
          || url.includes("/api/history/sessions/")) {
          return await webSmokeFetch(input, init);
        }

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

    const result = await service.runAllSmoke();

    assert.equal(result.ok, false);
    assert.equal(result.web.ok, true);
    assert.equal(result.web.imageCompileVerified, true);
    assert.equal(result.web.documentCompileVerified, true);
    assert.ok(result.feishu);
    assert.equal(result.feishu?.ok, false);
    assert.equal(result.feishu?.diagnosisId, "config_missing");
    assert.match(result.message, /FEISHU_APP_ID/);
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

function createSuccessfulWebSmokeFetch(options: { singleChunk?: boolean; omitCapabilityMatrix?: boolean } = {}): typeof fetch {
  const sessionRequestMap = new Map<string, { requestId: string; kind: "image" | "document" }>();

  return async (input, init) => {
    const url = normalizeUrl(input);

    if (url.endsWith("/api/web-auth/login")) {
      return new Response(null, {
        status: 200,
        headers: {
          "set-cookie": "themis_web_session=session-smoke-shared; Path=/; HttpOnly",
        },
      });
    }

    if (url.endsWith("/api/tasks/stream")) {
      const payload = readJsonRequestBody(init) as {
        requestId?: string;
        taskId?: string;
        sessionId?: string;
        inputEnvelope?: {
          parts?: Array<{ type?: string }>;
        };
      };
      const requestId = payload.requestId ?? "req-smoke-shared";
      const taskId = payload.taskId ?? "task-smoke-shared";
      const sessionId = payload.sessionId ?? "session-smoke-shared";
      const firstPartType = payload.inputEnvelope?.parts?.[0]?.type;
      const kind = firstPartType === "document" ? "document" : "image";
      sessionRequestMap.set(sessionId, { requestId, kind });
      const lines = [
        {
          kind: "ack",
          requestId,
          taskId,
          title: "task.accepted",
          text: "accepted",
        },
        {
          kind: "event",
          requestId,
          taskId,
          title: "task.action_required",
          text: "请补充输入",
          metadata: {
            actionId: `action-${requestId}`,
          },
        },
        {
          kind: "result",
          requestId,
          taskId,
          metadata: {
            structuredOutput: {
              status: "completed",
            },
          },
        },
        {
          kind: "done",
          requestId,
          taskId,
          result: {
            status: "completed",
          },
        },
      ];

      return options.singleChunk
        ? createSingleChunkNdjsonResponse(lines)
        : new Response(lines.map((line) => JSON.stringify(line)).join("\n"), {
          status: 200,
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
          },
        });
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
      const sessionId = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
      const taskRequest = sessionRequestMap.get(sessionId);

      return new Response(
        JSON.stringify({
          turns: [
            {
              requestId: taskRequest?.requestId,
              status: "completed",
              input: {
                compileSummary: {
                  runtimeTarget: "app-server",
                  degradationLevel: taskRequest?.kind === "document" ? "controlled_fallback" : "native",
                  warnings: taskRequest?.kind === "document"
                    ? [
                      {
                        code: "DOCUMENT_NATIVE_INPUT_FALLBACK",
                        message: "当前 runtime 未声明支持原生文档输入，文档已退化为路径提示。",
                        assetId: "asset-document-1",
                      },
                    ]
                    : [],
                  ...(options.omitCapabilityMatrix
                    ? {}
                    : {
                      capabilityMatrix: taskRequest?.kind === "document"
                        ? {
                          transportCapabilities: {
                            nativeImageInput: true,
                            nativeDocumentInput: false,
                          },
                          effectiveCapabilities: {
                            nativeImageInput: true,
                            nativeDocumentInput: false,
                          },
                          assetFacts: [
                            {
                              kind: "document",
                              handling: "path_fallback",
                            },
                          ],
                        }
                        : {
                          transportCapabilities: {
                            nativeImageInput: true,
                            nativeDocumentInput: false,
                          },
                          effectiveCapabilities: {
                            nativeImageInput: true,
                            nativeDocumentInput: false,
                          },
                          assetFacts: [
                            {
                              kind: "image",
                              handling: "native",
                            },
                          ],
                        },
                    }),
                },
              },
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
  };
}

function readJsonRequestBody(init: RequestInit | undefined): unknown {
  if (!init?.body || typeof init.body !== "string") {
    return null;
  }

  return JSON.parse(init.body);
}

function createSnapshotAwareEnv(): NodeJS.ProcessEnv & { getAccessCount(): number } {
  let accessCount = 0;
  const backing = new Map<string, string>([
    ["FEISHU_APP_ID", "cli_xxx"],
    ["FEISHU_APP_SECRET", "secret_xxx"],
  ]);

  return new Proxy({} as NodeJS.ProcessEnv & { getAccessCount(): number }, {
    get(_target, property) {
      if (typeof property !== "string") {
        return undefined;
      }

      if (property === "getAccessCount") {
        return () => accessCount;
      }

      if (property === "FEISHU_APP_ID" || property === "FEISHU_APP_SECRET") {
        accessCount += 1;
        if (accessCount > 2) {
          throw new Error(`unexpected extra env access: ${property}`);
        }
        return backing.get(property);
      }

      return backing.get(property);
    },
    has(_target, property) {
      return typeof property === "string" && (backing.has(property) || property === "getAccessCount");
    },
  });
}
