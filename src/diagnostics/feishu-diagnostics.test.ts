import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readFeishuDiagnosticsSnapshot } from "./feishu-diagnostics.js";

test("readFeishuDiagnosticsSnapshot 会在服务黑洞地址上超时返回不可达", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-timeout-"));
  let server: ReturnType<typeof createServer> | null = null;

  try {
    server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
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

    const result = await Promise.race([
      readFeishuDiagnosticsSnapshot({
        workingDirectory: root,
        baseUrl: `http://127.0.0.1:${address.port}`,
        serviceProbeTimeoutMs: 50,
      }),
      waitForReject(250, "reader should not hang on blackhole service"),
    ]);

    assert.deepEqual(result.service, {
      serviceReachable: false,
      statusCode: null,
    });
  } finally {
    if (server) {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      server.unref();
      server.close();
    }

    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会把缺失的状态文件标记为 missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-missing-"));

  try {
    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.state.sessionStore.status, "missing");
    assert.equal(result.state.attachmentDraftStore.status, "missing");
    assert.equal(result.state.sessionBindingCount, 0);
    assert.equal(result.state.attachmentDraftCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会把非法 JSON 状态文件标记为 unreadable", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-unreadable-"));

  try {
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(join(root, "infra", "local", "feishu-sessions.json"), "{not-json", "utf8");
    writeFileSync(join(root, "infra", "local", "feishu-attachment-drafts.json"), "{not-json", "utf8");

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.state.sessionStore.status, "unreadable");
    assert.equal(result.state.attachmentDraftStore.status, "unreadable");
    assert.equal(result.state.sessionBindingCount, 0);
    assert.equal(result.state.attachmentDraftCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会正常统计 sessions 和 drafts 数量", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-count-"));

  try {
    mkdirSync(join(root, "docs", "feishu"), { recursive: true });
    writeFileSync(join(root, "docs", "feishu", "themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(
      join(root, "infra", "local", "feishu-sessions.json"),
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
            {
              key: "chat-2::user-2",
              chatId: "chat-2",
              userId: "user-2",
              activeSessionId: "session-2",
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
      join(root, "infra", "local", "feishu-attachment-drafts.json"),
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
            {
              key: "chat-2::user-2::session-2",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              parts: [],
              assets: [],
              attachments: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              updatedAt: "2026-04-02T00:00:00.000Z",
              expiresAt: "2026-04-02T01:00:00.000Z",
            },
            {
              key: "chat-3::user-3::session-3",
              chatId: "chat-3",
              userId: "user-3",
              sessionId: "session-3",
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

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.state.sessionStore.status, "ok");
    assert.equal(result.state.attachmentDraftStore.status, "ok");
    assert.equal(result.state.sessionBindingCount, 2);
    assert.equal(result.state.attachmentDraftCount, 3);
    assert.equal(result.docs.smokeDocExists, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForReject(timeoutMs: number, message: string): Promise<never> {
  await new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
  });
  throw new Error(message);
}
