import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
    }, 15000);

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
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "POST" && url.pathname === "/api/web-auth/login") {
        res.writeHead(200, {
          "set-cookie": "themis_web_session=session-smoke-cli; Path=/; HttpOnly",
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
          requestId: "req-smoke-cli",
          taskId: "task-smoke-cli",
          title: "task.accepted",
          text: "accepted",
        }) + "\n");
        res.write(JSON.stringify({
          kind: "event",
          requestId: "req-smoke-cli",
          taskId: "task-smoke-cli",
          title: "task.action_required",
          text: "请补充输入",
          metadata: {
            actionId: "action-smoke-cli",
          },
        }) + "\n");
        res.write(JSON.stringify({
          kind: "result",
          requestId: "req-smoke-cli",
          taskId: "task-smoke-cli",
          metadata: {
            structuredOutput: {
              status: "completed",
            },
          },
        }) + "\n");
        res.write(JSON.stringify({
          kind: "done",
          requestId: "req-smoke-cli",
          taskId: "task-smoke-cli",
          result: {
            status: "completed",
          },
        }) + "\n");
        res.end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/actions") {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/history/sessions/")) {
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({
          turns: [
            {
              status: "completed",
            },
          ],
        }));
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
    assert.match(result.stdout, /actionId：action-smoke-cli/);
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
    assert.match(result.stdout, /sessionBindingCount：1/);
    assert.match(result.stdout, /attachmentDraftCount：1/);
    assert.match(result.stdout, /建议先运行：\.\/themis doctor feishu/);
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

function join(...parts: string[]): string {
  return resolve(...parts);
}
