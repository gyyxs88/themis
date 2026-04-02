import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FeishuDiagnosticsStateStore } from "../channels/feishu/diagnostics-state-store.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest } from "../types/task.js";
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

test("readFeishuDiagnosticsSnapshot 读取缺失 diagnostics 文件时不会创建 infra/local", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-read-only-"));

  try {
    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.store.status, "missing");
    assert.equal(existsSync(join(root, "infra", "local")), false);
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

test("readFeishuDiagnosticsSnapshot 会派生 recentWindowStats、lastActionAttempt 和 lastIgnoredMessage", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-summary-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra", "local", "feishu-diagnostics.json"),
  });

  try {
    store.upsertConversation({
      key: "chat-1::user-1",
      chatId: "chat-1",
      userId: "user-1",
      principalId: "principal-1",
      activeSessionId: "session-1",
      lastMessageId: "message-1",
      lastEventType: "takeover.submitted",
      updatedAt: "2026-04-02T08:00:00.000Z",
      pendingActions: [],
    });
    store.appendEvent({
      id: "event-1",
      type: "message.stale_ignored",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      messageId: "message-1",
      summary: "旧消息被忽略",
      createdAt: "2026-04-02T08:00:01.000Z",
      details: {
        messageId: "message-1",
        reason: "stale",
        retryCount: 1,
        approved: false,
        note: null,
      },
    });
    store.appendEvent({
      id: "event-2",
      type: "takeover.submitted",
      chatId: "chat-1",
      userId: "user-1",
      sessionId: "session-1",
      principalId: "principal-1",
      actionId: "action-1",
      requestId: "request-1",
      summary: "takeover 已提交",
      createdAt: "2026-04-02T08:00:02.000Z",
      details: {
        actionId: "action-1",
        requestId: "request-1",
        sessionId: "session-1",
        principalId: "principal-1",
      },
    });

    const summary = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(summary.diagnostics.recentWindowStats.staleIgnoredCount, 1);
    assert.equal(summary.diagnostics.recentWindowStats.takeoverSubmittedCount, 1);
    assert.equal(summary.diagnostics.lastActionAttempt?.type, "takeover.submitted");
    assert.equal(summary.diagnostics.lastActionAttempt?.requestId, "request-1");
    assert.equal(summary.diagnostics.lastIgnoredMessage?.type, "message.stale_ignored");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 会返回 diagnostics store 状态、currentConversation summary 和最近 5 条事件", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-store-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra", "local", "themis.db"),
  });

  try {
    mkdirSync(join(root, "docs", "feishu"), { recursive: true });
    writeFileSync(join(root, "docs", "feishu", "themis-feishu-real-journey-smoke.md"), "# smoke\n", "utf8");
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
              updatedAt: "2026-04-02T08:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    runtimeStore.saveSession({
      sessionId: "session-2",
      threadId: "thread-2",
      createdAt: "2026-04-02T08:59:00.000Z",
      updatedAt: "2026-04-02T09:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-2", "request-2"), "task-2");
    runtimeStore.appendTaskEvent({
      eventId: "event-runtime-1",
      taskId: "task-2",
      requestId: "request-2",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-2",
        },
      },
      timestamp: "2026-04-02T09:00:01.000Z",
    });
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
              createdAt: "2026-04-02T08:00:00.000Z",
              updatedAt: "2026-04-02T08:00:00.000Z",
              expiresAt: "2026-04-02T09:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "infra", "local", "feishu-diagnostics.json"),
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
              lastMessageId: "message-1",
              lastEventType: "message.created",
              updatedAt: "2026-04-02T08:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-1",
                  actionType: "approval",
                  taskId: "task-1",
                  requestId: "request-1",
                  sourceChannel: "feishu",
                  sessionId: "session-1",
                  principalId: "principal-1",
                },
              ],
            },
            {
              key: "chat-2::user-2",
              chatId: "chat-2",
              userId: "user-2",
              principalId: "principal-2",
              activeSessionId: "session-2",
              lastMessageId: "message-2",
              lastEventType: "message.received",
              updatedAt: "2026-04-02T09:00:00.000Z",
              pendingActions: [
                {
                  actionId: "action-2",
                  actionType: "user-input",
                  taskId: "task-2",
                  requestId: "request-2",
                  sourceChannel: "feishu",
                  sessionId: "session-2",
                  principalId: "principal-2",
                },
              ],
            },
          ],
          recentEvents: [
            {
              id: "event-1",
              type: "message.created",
              chatId: "chat-1",
              userId: "user-1",
              sessionId: "session-1",
              principalId: "principal-1",
              messageId: "message-1",
              actionId: "action-1",
              requestId: "request-1",
              summary: "收到第一条消息",
              createdAt: "2026-04-02T08:00:01.000Z",
            },
            {
              id: "event-2",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "任务仍在推进",
              createdAt: "2026-04-02T09:00:01.000Z",
            },
            {
              id: "event-3",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "第三条",
              createdAt: "2026-04-02T09:00:02.000Z",
            },
            {
              id: "event-4",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "第四条",
              createdAt: "2026-04-02T09:00:03.000Z",
            },
            {
              id: "event-5",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "第五条",
              createdAt: "2026-04-02T09:00:04.000Z",
            },
            {
              id: "event-6",
              type: "task.progress",
              chatId: "chat-2",
              userId: "user-2",
              sessionId: "session-2",
              principalId: "principal-2",
              summary: "第六条",
              createdAt: "2026-04-02T09:00:05.000Z",
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
      runtimeStore,
      baseUrl: "https://example.com",
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.deepEqual(result.diagnostics.store, {
      path: "infra/local/feishu-diagnostics.json",
      status: "ok",
    });
    assert.deepEqual(result.diagnostics.currentConversation, {
      key: "chat-2::user-2",
      chatId: "chat-2",
      userId: "user-2",
      principalId: "principal-2",
      activeSessionId: "session-2",
      threadId: "thread-2",
      threadStatus: "running",
      lastMessageId: "message-2",
      lastEventType: "message.received",
      pendingActionCount: 1,
      pendingActions: [
        {
          actionId: "action-2",
          actionType: "user-input",
          taskId: "task-2",
          requestId: "request-2",
          sourceChannel: "feishu",
          sessionId: "session-2",
          principalId: "principal-2",
        },
      ],
      updatedAt: "2026-04-02T09:00:00.000Z",
    });
    assert.equal(result.diagnostics.currentConversation?.pendingActionCount, 1);
    assert.deepEqual(result.diagnostics.currentConversation?.pendingActions, [
      {
        actionId: "action-2",
        actionType: "user-input",
        taskId: "task-2",
        requestId: "request-2",
        sourceChannel: "feishu",
        sessionId: "session-2",
        principalId: "principal-2",
      },
    ]);
    assert.deepEqual(result.diagnostics.recentEvents[0], {
      id: "event-2",
      type: "task.progress",
      chatId: "chat-2",
      userId: "user-2",
      sessionId: "session-2",
      principalId: "principal-2",
      messageId: null,
      actionId: null,
      requestId: null,
      summary: "任务仍在推进",
      createdAt: "2026-04-02T09:00:01.000Z",
    });
    assert.deepEqual(result.diagnostics.recentEvents.map((event) => event.id), [
      "event-2",
      "event-3",
      "event-4",
      "event-5",
      "event-6",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readFeishuDiagnosticsSnapshot 在没有 runtimeStore 时会在 sqlite 文件存在时读取 thread summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-sqlite-fallback-"));
  const sqliteFilePath = join(root, "infra", "local", "themis.db");
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: sqliteFilePath,
  });

  try {
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(
      join(root, "infra", "local", "feishu-diagnostics.json"),
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
              lastMessageId: "message-1",
              lastEventType: "message.created",
              updatedAt: "2026-04-02T10:00:00.000Z",
              pendingActions: [],
            },
          ],
          recentEvents: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    runtimeStore.saveSession({
      sessionId: "session-1",
      threadId: "thread-fallback-1",
      createdAt: "2026-04-02T10:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
    });
    runtimeStore.upsertTurnFromRequest(createFeishuTaskRequest("session-1", "request-fallback-1"), "task-fallback-1");
    runtimeStore.appendTaskEvent({
      eventId: "event-fallback-1",
      taskId: "task-fallback-1",
      requestId: "request-fallback-1",
      type: "task.started",
      status: "running",
      message: "Task started",
      payload: {
        session: {
          threadId: "thread-fallback-1",
        },
      },
      timestamp: "2026-04-02T10:00:01.000Z",
    });

    const result = await readFeishuDiagnosticsSnapshot({
      workingDirectory: root,
      sqliteFilePath,
      fetchImpl: async () =>
        new Response(null, {
          status: 200,
        }),
    });

    assert.equal(result.diagnostics.currentConversation?.threadId, "thread-fallback-1");
    assert.equal(result.diagnostics.currentConversation?.threadStatus, "running");
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

function createFeishuTaskRequest(sessionId: string, requestId: string): TaskRequest {
  return {
    requestId,
    taskId: requestId.replace("request", "task"),
    sourceChannel: "feishu",
    user: {
      userId: "user-1",
    },
    goal: "diagnostics",
    channelContext: {
      sessionId,
    },
    createdAt: "2026-04-02T09:00:00.000Z",
  };
}
