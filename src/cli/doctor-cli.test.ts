import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildFeishuSmokeNextSteps } from "../diagnostics/feishu-verification-guide.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/task.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntryPath = resolve(repoRoot, "src/cli/main.ts");
const tsxBinaryPath = resolve(repoRoot, "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string): {
  code: number;
  stdout: string;
  stderr: string;
} {
  return runCliWithEnv(args, cwd);
}

function runCliWithEnv(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(tsxBinaryPath, [cliEntryPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      ...extraEnv,
    },
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runCliAsync(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBinaryPath, [cliEntryPath, ...args], {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`CLI 超时：${args.join(" ")}`));
    }, 30000);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("themis doctor smoke 缺少目标时会提示用法", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-smoke-missing-"));

  try {
    const result = runCli(["doctor", "smoke"], workspace);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Themis CLI 执行失败：用法：themis doctor smoke <web\|feishu\|all>/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor smoke foo 会拒绝未知目标", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-smoke-unknown-"));

  try {
    const result = runCli(["doctor", "smoke", "foo"], workspace);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Themis CLI 执行失败：doctor smoke 子命令仅支持 web \/ feishu \/ all。/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor smoke web 会输出真实 Web smoke 结果", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-smoke-web-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    const webSmokeDouble = createWebSmokeHttpDouble();
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (await webSmokeDouble.handle(req, res)) {
        return;
      }

      if (req.method === "HEAD" && url.pathname === "/api/health") {
        res.writeHead(200);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const result = await runCliAsync(["doctor", "smoke", "web"], workspace, {
      THEMIS_BASE_URL: baseUrl,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Web smoke 成功/);
    assert.match(result.stdout, /sessionId：/);
    assert.match(result.stdout, /requestId：/);
    assert.match(result.stdout, /taskId：/);
    assert.match(result.stdout, /actionId：action-/);
    assert.match(result.stdout, /imageCompileVerified：yes/);
    assert.match(result.stdout, /imageCompileDegradationLevel：native/);
    assert.match(result.stdout, /documentCompileVerified：yes/);
    assert.match(result.stdout, /documentCompileDegradationLevel：controlled_fallback/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor smoke web 在 smoke 失败时返回非 0", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-smoke-web-fail-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "POST" && url.pathname === "/api/web-auth/login") {
        res.writeHead(200, {
          "set-cookie": "themis_web_session=session-smoke-cli-fail; Path=/; HttpOnly",
        });
        res.end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/stream") {
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
        });
        res.write(JSON.stringify({
          kind: "ack",
          requestId: "req-smoke-cli-fail",
          taskId: "task-smoke-cli-fail",
          title: "task.accepted",
          text: "accepted",
        }) + "\n");
        res.write(JSON.stringify({
          kind: "done",
          requestId: "req-smoke-cli-fail",
          taskId: "task-smoke-cli-fail",
          result: {
            status: "completed",
          },
        }) + "\n");
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliAsync(["doctor", "smoke", "web"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Themis smoke - web/);
    assert.match(result.stdout, /ok：no/);
    assert.match(result.stdout, /真实 Web task 没有进入 task\.action_required/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor smoke feishu 会输出前置检查和 nextSteps", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-smoke-feishu-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(
      resolve(workspace, "infra/local/feishu-sessions.json"),
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
      resolve(workspace, "infra/local/feishu-attachment-drafts.json"),
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
    writeFileSync(
      resolve(workspace, "infra/local/feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-6",
              lastEventType: "takeover.submitted",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-1",
                  actionType: "user-input",
                  taskId: "task-1",
                  requestId: "request-1",
                  sourceChannel: "web",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
                {
                  actionId: "action-2",
                  actionType: "approval",
                  taskId: "task-2",
                  requestId: "request-2",
                  sourceChannel: "feishu",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "message.duplicate_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-5",
              summary: "重复消息被忽略",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
            {
              id: "event-2",
              type: "message.stale_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-6",
              summary: "旧消息被忽略",
              createdAt: "2026-04-02T09:00:02.000Z",
            },
            {
              id: "event-3",
              type: "takeover.submitted",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              actionId: "action-1",
              requestId: "request-1",
              summary: "takeover 已提交",
              createdAt: "2026-04-02T09:00:03.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(302, {
          Location: "/login",
        });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliAsync(["doctor", "smoke", "feishu"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Feishu smoke 前置检查通过/);
    assert.match(result.stdout, /docs\/feishu\/themis-feishu-real-journey-smoke\.md/);
    assert.match(result.stdout, /nextSteps/);
    assert.match(result.stdout, /statusCode：302/);
    assert.match(result.stdout, /diagnosisId：approval_blocking_takeover/);
    assert.match(result.stdout, /diagnosisSummary：当前 scope 里还有 approval pending action/);
    assert.match(result.stdout, /sessionBindingCount：1/);
    assert.match(result.stdout, /attachmentDraftCount：1/);
    for (const [index, step] of buildFeishuSmokeNextSteps().entries()) {
      assert.match(result.stdout, new RegExp(`${index + 1}\\. ${escapeRegExp(step)}`));
    }
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor smoke all 会先输出 web，再输出 feishu 前置检查", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-smoke-all-success-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "docs", "feishu"), { recursive: true });
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(
      resolve(workspace, "docs/feishu/themis-feishu-real-journey-smoke.md"),
      "# smoke\n",
      "utf8",
    );
    writeFileSync(
      resolve(workspace, "infra/local/feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [],
          recentEvents: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const webSmokeDouble = createWebSmokeHttpDouble();
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (await webSmokeDouble.handle(req, res)) {
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(302, {
          Location: "/login",
        });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliAsync(["doctor", "smoke", "all"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
    });

    assert.equal(result.code, 0);
    const webIndex = result.stdout.indexOf("Themis smoke - web");
    const feishuIndex = result.stdout.indexOf("Themis smoke - feishu");
    assert.ok(webIndex >= 0);
    assert.ok(feishuIndex > webIndex);
    assert.match(result.stdout, /Web smoke 成功/);
    assert.match(result.stdout, /imageCompileVerified：yes/);
    assert.match(result.stdout, /documentCompileVerified：yes/);
    assert.match(result.stdout, /Feishu smoke 前置检查通过/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor smoke all 在 web 失败时会明确提示跳过 feishu", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-smoke-all-web-fail-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "POST" && url.pathname === "/api/web-auth/login") {
        res.writeHead(200, {
          "set-cookie": "themis_web_session=session-smoke-all-web-fail; Path=/; HttpOnly",
        });
        res.end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/stream") {
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
        });
        res.write(JSON.stringify({
          kind: "ack",
          requestId: "req-smoke-all-web-fail",
          taskId: "task-smoke-all-web-fail",
          title: "task.accepted",
          text: "accepted",
        }) + "\n");
        res.write(JSON.stringify({
          kind: "done",
          requestId: "req-smoke-all-web-fail",
          taskId: "task-smoke-all-web-fail",
          result: {
            status: "completed",
          },
        }) + "\n");
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        throw new Error("feishu smoke should be skipped when web smoke fails");
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliAsync(["doctor", "smoke", "all"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /Themis smoke - web/);
    assert.doesNotMatch(result.stdout, /Themis smoke - feishu/);
    assert.match(result.stdout, /Feishu smoke 已跳过：Web smoke 未通过/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor feishu 会输出配置、服务和本地状态摘要", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-feishu-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "docs", "feishu"), { recursive: true });
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(resolve(workspace, "docs/feishu/themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    writeFileSync(
      resolve(workspace, "infra/local/feishu-sessions.json"),
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
      resolve(workspace, "infra/local/feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [
            {
              key: "chat-1::user-1::session-1",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliAsync(["doctor", "feishu"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
      FEISHU_USE_ENV_PROXY: "true",
      FEISHU_PROGRESS_FLUSH_TIMEOUT_MS: "1500",
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis 诊断 - feishu/);
    assert.match(result.stdout, /appIdConfigured：yes/);
    assert.match(result.stdout, /appSecretConfigured：yes/);
    assert.match(result.stdout, /useEnvProxy：yes/);
    assert.match(result.stdout, /progressFlushTimeoutMs：1500/);
    assert.match(result.stdout, /serviceReachable：yes/);
    assert.match(result.stdout, /statusCode：200/);
    assert.match(result.stdout, /sessionStore：ok/);
    assert.match(result.stdout, /attachmentDraftStore：ok/);
    assert.match(result.stdout, /sessionBindingCount：1/);
    assert.match(result.stdout, /attachmentDraftCount：1/);
    assert.match(result.stdout, /smokeDoc：yes/);
    assert.match(result.stdout, /问题判断/);
    assert.match(result.stdout, /主诊断：当前未发现明显阻塞/);
    assert.match(result.stdout, /诊断摘要：飞书配置、服务可达性和最近窗口摘要看起来正常/);
    assert.match(result.stdout, /建议动作：/);
    assert.match(result.stdout, /1\. \.\/themis doctor feishu/);
    assert.match(result.stdout, /2\. \.\/themis doctor smoke web/);
    assert.match(result.stdout, /3\. \.\/themis doctor smoke feishu/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor 默认页会给出异常热点和建议先看命令", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-overview-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "memory", "project"), { recursive: true });
    mkdirSync(resolve(workspace, "memory", "architecture"), { recursive: true });
    mkdirSync(resolve(workspace, "memory", "tasks"), { recursive: true });
    mkdirSync(resolve(workspace, "docs", "feishu"), { recursive: true });
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(resolve(workspace, "README.md"), "# demo\n", "utf8");
    writeFileSync(resolve(workspace, "memory/project/overview.md"), "# project\n", "utf8");
    writeFileSync(resolve(workspace, "memory/architecture/overview.md"), "# architecture\n", "utf8");
    writeFileSync(resolve(workspace, "memory/tasks/backlog.md"), "# backlog\n", "utf8");
    writeFileSync(resolve(workspace, "memory/tasks/in-progress.md"), "# in-progress\n", "utf8");
    writeFileSync(resolve(workspace, "memory/tasks/done.md"), "# done\n", "utf8");
    writeFileSync(resolve(workspace, "docs/feishu/themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    writeFileSync(
      resolve(workspace, "infra/local/feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-9",
              lastEventType: "pending_input.not_found",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [
                {
                  actionId: "input-9",
                  actionType: "user-input",
                  taskId: "task-9",
                  requestId: "request-9",
                  sourceChannel: "web",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "pending_input.not_found",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              summary: "没有匹配到 pending action",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliAsync(["doctor"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
      THEMIS_MCP_INSPECTOR_FIXTURE: JSON.stringify({
        servers: [
          {
            id: "context7",
            name: "Context 7",
            status: "healthy",
          },
          {
            id: "figma",
            name: "Figma",
            status: "degraded",
          },
        ],
      }),
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis 运行诊断/);
    assert.match(result.stdout, /- feishu：最近未匹配到 pending action/);
    assert.match(result.stdout, /异常热点/);
    assert.match(result.stdout, /1\. \[feishu\] 最近未匹配到 pending action/);
    assert.match(result.stdout, /2\. \[mcp\] MCP server 状态异常/);
    assert.match(result.stdout, /建议先看/);
    assert.match(result.stdout, /1\. \.\/themis doctor feishu/);
    assert.match(result.stdout, /2\. \.\/themis doctor mcp/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor feishu 会输出当前会话快照和最近 5 条事件轨迹", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-feishu-deep-"));
  let server: ReturnType<typeof createServer> | null = null;
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });

  try {
    mkdirSync(resolve(workspace, "docs", "feishu"), { recursive: true });
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(resolve(workspace, "docs/feishu/themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    writeFileSync(
      resolve(workspace, "infra/local/feishu-sessions.json"),
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
      resolve(workspace, "infra/local/feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [
            {
              key: "chat-1::user-1::session-1",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      resolve(workspace, "infra/local/feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-6",
              lastEventType: "takeover.submitted",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-1",
                  actionType: "user-input",
                  taskId: "task-1",
                  requestId: "request-1",
                  sourceChannel: "web",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
                {
                  actionId: "action-2",
                  actionType: "approval",
                  taskId: "task-2",
                  requestId: "request-2",
                  sourceChannel: "feishu",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "message.received",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-1",
              summary: "应被丢弃的第 1 条",
              createdAt: "2026-04-02T09:00:00.000Z",
            },
            {
              id: "event-2",
              type: "message.duplicate_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-2",
              summary: "第 2 条",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
            {
              id: "event-3",
              type: "message.stale_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-3",
              summary: "第 3 条",
              createdAt: "2026-04-02T09:00:02.000Z",
            },
            {
              id: "event-4",
              type: "session.switched",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              summary: "第 4 条",
              createdAt: "2026-04-02T09:00:03.000Z",
            },
            {
              id: "event-5",
              type: "waiting_action.snapshot",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              summary: "第 5 条",
              createdAt: "2026-04-02T09:00:04.000Z",
            },
            {
              id: "event-6",
              type: "takeover.submitted",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              actionId: "action-1",
              requestId: "request-1",
              summary: "第 6 条",
              createdAt: "2026-04-02T09:00:05.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-1",
      createdAt: "2026-04-02T09:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-1", "request-1"), "task-1");
    runtimeStore.appendTaskEvent({
      eventId: "event-runtime-1",
      taskId: "task-1",
      requestId: "request-1",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-1",
        },
      },
      timestamp: "2026-04-02T10:00:00.000Z",
    });

    const result = await runCliAsync(["doctor", "feishu"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
      FEISHU_USE_ENV_PROXY: "true",
      FEISHU_PROGRESS_FLUSH_TIMEOUT_MS: "1500",
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /当前会话摘要/);
    assert.match(result.stdout, /当前会话快照/);
    assert.match(result.stdout, /sessionId：session-1/);
    assert.match(result.stdout, /principalId：principal-1/);
    assert.match(result.stdout, /threadId：thread-1/);
    assert.match(result.stdout, /threadStatus：running/);
    assert.match(result.stdout, /pendingActionCount：2/);
    assert.match(result.stdout, /当前接管判断/);
    assert.match(result.stdout, /takeoverState：blocked_by_approval/);
    assert.match(result.stdout, /takeoverHint：.*action-2.*action-1/);
    assert.match(result.stdout, /排障剧本/);
    assert.match(result.stdout, /1\. 先处理 approval action：\/approve action-2 或 \/deny action-2/);
    assert.match(result.stdout, /2\. approval 处理完后，再对 user-input action 继续：直接回复普通文本，或 \/reply action-1 <内容>/);
    assert.match(result.stdout, /actionId：action-1/);
    assert.match(result.stdout, /actionId：action-2/);
    assert.match(result.stdout, /最近窗口统计/);
    assert.match(result.stdout, /recentWindow\.duplicateIgnoredCount：1/);
    assert.match(result.stdout, /recentWindow\.staleIgnoredCount：1/);
    assert.match(result.stdout, /recentWindow\.approvalSubmittedCount：0/);
    assert.match(result.stdout, /recentWindow\.replySubmittedCount：0/);
    assert.match(result.stdout, /recentWindow\.takeoverSubmittedCount：1/);
    assert.match(result.stdout, /recentWindow\.pendingInputNotFoundCount：0/);
    assert.match(result.stdout, /recentWindow\.pendingInputAmbiguousCount：0/);
    assert.match(result.stdout, /lastActionAttempt\.type：takeover\.submitted/);
    assert.match(result.stdout, /lastActionAttempt\.requestId：request-1/);
    assert.match(result.stdout, /lastIgnoredMessage\.type：message\.stale_ignored/);
    assert.match(result.stdout, /lastIgnoredMessage\.messageId：message-3/);
    assert.match(result.stdout, /最近 5 条事件轨迹/);
    const sectionOrder = [
      "当前会话摘要",
      "当前接管判断",
      "排障剧本",
      "最近窗口统计",
      "最近一次 action 尝试",
      "最近一次被忽略消息",
      "当前会话快照",
      "最近 5 条事件轨迹",
    ].map((label) => result.stdout.indexOf(label));
    assert.ok(sectionOrder.every((index) => index >= 0));
    assert.deepEqual([...sectionOrder].sort((left, right) => left - right), sectionOrder);
    assert.doesNotMatch(result.stdout, /应被丢弃的第 1 条/);
    assert.match(result.stdout, /第 2 条/);
    assert.match(result.stdout, /第 6 条/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor feishu 会把 pending_input.not_found 的排障剧本翻成人话", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-feishu-not-found-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "docs", "feishu"), { recursive: true });
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(resolve(workspace, "docs/feishu/themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    writeFileSync(
      resolve(workspace, "infra/local/feishu-sessions.json"),
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
      resolve(workspace, "infra/local/feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      resolve(workspace, "infra/local/feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-9",
              lastEventType: "pending_input.not_found",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [
                {
                  actionId: "input-9",
                  actionType: "user-input",
                  taskId: "task-9",
                  requestId: "request-9",
                  sourceChannel: "web",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "pending_input.not_found",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              summary: "没有匹配到 pending action",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
            {
              id: "event-2",
              type: "message.stale_ignored",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-8",
              summary: "旧消息被忽略",
              createdAt: "2026-04-02T09:00:02.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliAsync(["doctor", "feishu"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /主诊断：最近未匹配到 pending action/);
    assert.match(result.stdout, /takeoverState：direct_text_ready/);
    assert.match(result.stdout, /recentWindow\.pendingInputNotFoundCount：1/);
    assert.match(result.stdout, /排障剧本/);
    assert.match(result.stdout, /1\. 先执行 \/use session-1 确认自己在目标会话/);
    assert.match(result.stdout, /2\. 当前会话里仍有唯一 user-input，可直接回复普通文本，或执行 \/reply input-9 <内容>/);
    assert.match(result.stdout, /3\. 最近还出现过被忽略消息 message-8/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor feishu 会把 pending_input.ambiguous 的排障剧本翻成人话", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-feishu-ambiguous-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    mkdirSync(resolve(workspace, "docs", "feishu"), { recursive: true });
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(resolve(workspace, "docs/feishu/themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    writeFileSync(
      resolve(workspace, "infra/local/feishu-sessions.json"),
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
      resolve(workspace, "infra/local/feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      resolve(workspace, "infra/local/feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-10",
              lastEventType: "pending_input.ambiguous",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [
                {
                  actionId: "input-1",
                  actionType: "user-input",
                  taskId: "task-1",
                  requestId: "request-1",
                  sourceChannel: "web",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
                {
                  actionId: "input-2",
                  actionType: "user-input",
                  taskId: "task-2",
                  requestId: "request-2",
                  sourceChannel: "feishu",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "pending_input.ambiguous",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              summary: "存在多条待补充输入",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const result = await runCliAsync(["doctor", "feishu"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /主诊断：当前 scope 存在多条 user-input/);
    assert.match(result.stdout, /takeoverState：reply_required/);
    assert.match(result.stdout, /takeoverHint：.*input-1.*input-2/);
    assert.match(result.stdout, /recentWindow\.pendingInputAmbiguousCount：1/);
    assert.match(result.stdout, /排障剧本/);
    assert.match(result.stdout, /1\. 候选 user-input action： \/reply input-1 <内容>/);
    assert.match(result.stdout, /2\. 备用 user-input action： \/reply input-2 <内容>/);
    assert.match(result.stdout, /3\. 不要直接发送普通文本，先显式命中正确的 actionId。/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor feishu 会输出失败 action 摘要", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-feishu-failed-action-"));
  let server: ReturnType<typeof createServer> | null = null;
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });

  try {
    mkdirSync(resolve(workspace, "docs", "feishu"), { recursive: true });
    mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
    writeFileSync(resolve(workspace, "docs/feishu/themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    writeFileSync(
      resolve(workspace, "infra/local/feishu-sessions.json"),
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
      resolve(workspace, "infra/local/feishu-attachment-drafts.json"),
      JSON.stringify(
        {
          version: 1,
          drafts: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      resolve(workspace, "infra/local/feishu-diagnostics.json"),
      JSON.stringify(
        {
          version: 1,
          conversations: [
            {
              key: "chat-1::user-1",
              chatId: "chat-1",
              userId: "user-1",
              principalId: "principal-1",
              activeSessionId: "session-1",
              lastMessageId: "message-7",
              lastEventType: "takeover.submit_failed",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "takeover.submit_failed",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              actionId: "action-1",
              requestId: "request-1",
              summary: "takeover 提交失败",
              createdAt: "2026-04-02T09:00:03.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
        });
        res.end("ok");
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-1",
      createdAt: "2026-04-02T09:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-1", "request-1"), "task-1");
    runtimeStore.appendTaskEvent({
      eventId: "event-runtime-1",
      taskId: "task-1",
      requestId: "request-1",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-1",
        },
      },
      timestamp: "2026-04-02T10:00:00.000Z",
    });

    const result = await runCliAsync(["doctor", "feishu"], workspace, {
      THEMIS_BASE_URL: `http://127.0.0.1:${address.port}`,
      FEISHU_APP_ID: "cli_xxx",
      FEISHU_APP_SECRET: "secret_xxx",
      FEISHU_USE_ENV_PROXY: "true",
      FEISHU_PROGRESS_FLUSH_TIMEOUT_MS: "1500",
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /lastActionAttempt\.type：takeover\.submit_failed/);
    assert.match(result.stdout, /lastActionAttempt\.requestId：request-1/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(workspace, { recursive: true, force: true });
  }
});

function createFeishuTaskRequest(sessionId: string, requestId: string): TaskRequest {
  return createDiagnosticsTaskRequest("feishu", sessionId, requestId, "2026-04-02T09:00:00.000Z");
}

function createDiagnosticsTaskRequest(
  sourceChannel: TaskRequest["sourceChannel"],
  sessionId: string,
  requestId: string,
  createdAt: string,
): TaskRequest {
  return {
    requestId,
    taskId: "task-1",
    sourceChannel,
    user: {
      userId: "user-1",
    },
    goal: "diagnostics",
    channelContext: {
      sessionId,
    },
    createdAt,
  };
}

test("themis doctor context 会输出 README/AGENTS 状态", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-"));

  try {
    mkdirSync(resolve(workspace, "memory", "project"), { recursive: true });
    mkdirSync(resolve(workspace, "memory", "architecture"), { recursive: true });
    writeFileSync(resolve(workspace, "README.md"), "# demo\n", "utf8");
    writeFileSync(resolve(workspace, "memory/project/overview.md"), "# project\n", "utf8");
    writeFileSync(resolve(workspace, "memory/architecture/overview.md"), "# architecture\n", "utf8");

    const result = runCli(["doctor", "context"], workspace);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /README\.md：ok/);
    assert.match(result.stdout, /AGENTS\.md：missing/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor service 会输出最近 turn input 的多模态摘要", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-service-multimodal-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });

  try {
    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-1",
      createdAt: "2026-04-02T09:00:00.000Z",
      updatedAt: "2026-04-02T09:10:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createDiagnosticsTaskRequest("feishu", "session-1", "request-1", "2026-04-02T09:00:00.000Z"), "task-1");
    runtimeStore.saveTurnInput({
      requestId: "request-1",
      createdAt: "2026-04-02T09:00:01.000Z",
      envelope: {
        envelopeId: "envelope-service-1",
        sourceChannel: "feishu",
        sourceSessionId: "session-1",
        createdAt: "2026-04-02T09:00:01.000Z",
        parts: [
          {
            partId: "part-image-1",
            type: "image",
            role: "user",
            order: 1,
            assetId: "asset-image-1",
          },
        ],
        assets: [
          {
            assetId: "asset-image-1",
            kind: "image",
            mimeType: "image/png",
            localPath: "/tmp/service-image.png",
            sourceChannel: "feishu",
            ingestionStatus: "ready",
          },
        ],
      },
      compileSummary: {
        runtimeTarget: "app-server",
        degradationLevel: "native",
        warnings: [],
      },
    });
    runtimeStore.upsertTurnFromRequest(createDiagnosticsTaskRequest("web", "session-1", "request-2", "2026-04-02T09:05:00.000Z"), "task-2");
    runtimeStore.saveTurnInput({
      requestId: "request-2",
      createdAt: "2026-04-02T09:05:01.000Z",
      envelope: {
        envelopeId: "envelope-service-2",
        sourceChannel: "web",
        sourceSessionId: "session-1",
        createdAt: "2026-04-02T09:05:01.000Z",
        parts: [
          {
            partId: "part-document-1",
            type: "document",
            role: "user",
            order: 1,
            assetId: "asset-document-1",
          },
        ],
        assets: [
          {
            assetId: "asset-document-1",
            kind: "document",
            mimeType: "application/pdf",
            localPath: "/tmp/service-document.pdf",
            sourceChannel: "web",
            ingestionStatus: "ready",
          },
        ],
      },
      compileSummary: {
        runtimeTarget: "app-server",
        degradationLevel: "controlled_fallback",
        warnings: [],
      },
    });
    runtimeStore.upsertTurnFromRequest(createDiagnosticsTaskRequest("feishu", "session-1", "request-3", "2026-04-02T09:10:00.000Z"), "task-3");
    runtimeStore.saveTurnInput({
      requestId: "request-3",
      createdAt: "2026-04-02T09:10:01.000Z",
      envelope: {
        envelopeId: "envelope-service-3",
        sourceChannel: "feishu",
        sourceSessionId: "session-1",
        createdAt: "2026-04-02T09:10:01.000Z",
        parts: [
          {
            partId: "part-image-2",
            type: "image",
            role: "user",
            order: 1,
            assetId: "asset-image-2",
          },
        ],
        assets: [
          {
            assetId: "asset-image-2",
            kind: "image",
            mimeType: "image/jpeg",
            localPath: "/tmp/service-blocked-image.jpg",
            sourceChannel: "feishu",
            ingestionStatus: "ready",
          },
        ],
      },
      compileSummary: {
        runtimeTarget: "codex-sdk",
        degradationLevel: "blocked",
        warnings: [
          {
            code: "IMAGE_NATIVE_INPUT_REQUIRED",
            message: "当前 runtime 不支持 native image input。",
            assetId: "asset-image-2",
          },
        ],
      },
    });

    const result = runCli(["doctor", "service"], workspace);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis 诊断 - service/);
    assert.match(result.stdout, /multimodal\.status：ok/);
    assert.match(result.stdout, /multimodal\.recentTurnInputCount：3\/24/);
    assert.match(result.stdout, /multimodal\.assetCounts：image=2, document=1/);
    assert.match(result.stdout, /multimodal\.degradationCounts：native=1, lossless_textualization=0, controlled_fallback=1, blocked=1, unknown=0/);
    assert.match(result.stdout, /multimodal\.sourceChannels：feishu=2, web=1/);
    assert.match(result.stdout, /multimodal\.runtimeTargets：app-server=2, codex-sdk=1/);
    assert.match(result.stdout, /multimodal\.lastTurn\.requestId：request-3/);
    assert.match(result.stdout, /multimodal\.lastTurn\.compile：codex-sdk \/ blocked/);
    assert.match(result.stdout, /multimodal\.lastTurn\.warningCodes：IMAGE_NATIVE_INPUT_REQUIRED/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor mcp 会输出 mcp server 摘要", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-mcp-"));

  try {
    const result = runCli(["doctor", "mcp"], workspace);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis 诊断 - mcp/);
    assert.match(result.stdout, /serverCount：\d+/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("themis doctor mcp 会输出状态分布和排障建议", () => {
  const workspace = mkdtempSync(join(tmpdir(), "themis-doctor-cli-mcp-diagnostics-"));

  try {
    const result = runCliWithEnv(["doctor", "mcp"], workspace, {
      THEMIS_MCP_INSPECTOR_FIXTURE: JSON.stringify({
        servers: [
          {
            id: "context7",
            name: "Context 7",
            status: "healthy",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
            auth: "authenticated",
          },
          {
            id: "figma",
            name: "Figma",
            status: "degraded",
            transport: "sse",
            auth: "login_required",
            message: "OAuth login required",
          },
        ],
      }),
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Themis 诊断 - mcp/);
    assert.match(result.stdout, /serverCount：2/);
    assert.match(result.stdout, /healthyCount：1/);
    assert.match(result.stdout, /abnormalCount：1/);
    assert.match(result.stdout, /Context 7\(context7\)：healthy/);
    assert.match(result.stdout, /分类：healthy/);
    assert.match(result.stdout, /细节：transport=stdio, command=npx, auth=authenticated/);
    assert.match(result.stdout, /Figma\(figma\)：degraded/);
    assert.match(result.stdout, /分类：auth_required/);
    assert.match(result.stdout, /摘要：需要先完成 MCP server 认证后再继续使用。/);
    assert.match(result.stdout, /1\. 补齐对应 MCP server 的认证或重新执行 OAuth 登录。/);
    assert.match(result.stdout, /主诊断：MCP server 状态异常/);
    assert.match(result.stdout, /建议动作：/);
    assert.match(result.stdout, /1\. \.\/themis doctor service/);
    assert.match(result.stdout, /2\. \.\/themis doctor mcp/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createWebSmokeHttpDouble(): {
  handle: (req: any, res: any) => Promise<boolean>;
} {
  const sessionRequestMap = new Map<string, { requestId: string; kind: "image" | "document" }>();

  return {
    handle: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "POST" && url.pathname === "/api/web-auth/login") {
        res.writeHead(200, {
          "set-cookie": "themis_web_session=session-smoke-cli; Path=/; HttpOnly",
        });
        res.end();
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/stream") {
        const payload = await readJsonRequest(req) as {
          requestId?: string;
          taskId?: string;
          sessionId?: string;
          inputEnvelope?: {
            parts?: Array<{ type?: string }>;
          };
        };
        const requestId = payload.requestId ?? "req-smoke-cli";
        const taskId = payload.taskId ?? "task-smoke-cli";
        const sessionId = payload.sessionId ?? "session-smoke-cli";
        const partType = payload.inputEnvelope?.parts?.[0]?.type;
        sessionRequestMap.set(sessionId, {
          requestId,
          kind: partType === "document" ? "document" : "image",
        });
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
        });
        res.write(JSON.stringify({
          kind: "ack",
          requestId,
          taskId,
          title: "task.accepted",
          text: "accepted",
        }) + "\n");
        res.write(JSON.stringify({
          kind: "event",
          requestId,
          taskId,
          title: "task.action_required",
          text: "请补充输入",
          metadata: {
            actionId: `action-${requestId}`,
          },
        }) + "\n");
        res.write(JSON.stringify({
          kind: "result",
          requestId,
          taskId,
          metadata: {
            structuredOutput: {
              status: "completed",
            },
          },
        }) + "\n");
        res.write(JSON.stringify({
          kind: "done",
          requestId,
          taskId,
          result: {
            status: "completed",
          },
        }) + "\n");
        res.end();
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/actions") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ ok: true }));
        return true;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/history/sessions/")) {
        const sessionId = decodeURIComponent(url.pathname.slice("/api/history/sessions/".length));
        const taskRequest = sessionRequestMap.get(sessionId);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({
          turns: [
            {
              requestId: taskRequest?.requestId,
              status: "completed",
              input: {
                compileSummary: {
                  runtimeTarget: "app-server",
                  degradationLevel: taskRequest?.kind === "document" ? "controlled_fallback" : "native",
                  warnings: [],
                },
              },
            },
          ],
        }));
        return true;
      }

      return false;
    },
  };
}

async function readJsonRequest(req: any): Promise<unknown> {
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });

  const payload = Buffer.concat(chunks).toString("utf8");
  return payload ? JSON.parse(payload) : null;
}

function join(...parts: string[]): string {
  return resolve(...parts);
}
