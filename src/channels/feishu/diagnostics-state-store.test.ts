import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FeishuDiagnosticsStateStore } from "./diagnostics-state-store.js";

test("FeishuDiagnosticsStateStore 会在 upsertConversation 和 appendEvent 后正常读回快照", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-state-"));
  const filePath = join(root, "infra/local/feishu-diagnostics.json");
  const store = new FeishuDiagnosticsStateStore({
    filePath,
    maxEvents: 50,
  });

  try {
    store.upsertConversation({
      key: "chat-1::user-1",
      chatId: "chat-1",
      userId: "user-1",
      principalId: "principal-1",
      activeSessionId: "session-1",
      lastMessageId: "message-1",
      lastEventType: "message.created",
      updatedAt: "2026-04-01T08:00:00.000Z",
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
    });
    store.appendEvent({
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
      createdAt: "2026-04-01T08:00:01.000Z",
    });

    const snapshot = store.readSnapshot();

    assert.equal(snapshot.path, "infra/local/feishu-diagnostics.json");
    assert.equal(snapshot.status, "ok");
    assert.deepEqual(snapshot.conversations, [
      {
        key: "chat-1::user-1",
        chatId: "chat-1",
        userId: "user-1",
        principalId: "principal-1",
        activeSessionId: "session-1",
        lastMessageId: "message-1",
        lastEventType: "message.created",
        updatedAt: "2026-04-01T08:00:00.000Z",
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
    ]);
    assert.deepEqual(snapshot.recentEvents, [
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
        createdAt: "2026-04-01T08:00:01.000Z",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuDiagnosticsStateStore 会把 recentEvents 截断为 ring buffer", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-ring-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra/local/feishu-diagnostics.json"),
    maxEvents: 2,
  });

  try {
    store.appendEvent({
      id: "event-1",
      type: "message.created",
      chatId: "chat-1",
      userId: "user-1",
      summary: "第一条",
      createdAt: "2026-04-01T08:00:01.000Z",
    });
    store.appendEvent({
      id: "event-2",
      type: "message.created",
      chatId: "chat-1",
      userId: "user-1",
      summary: "第二条",
      createdAt: "2026-04-01T08:00:02.000Z",
    });
    store.appendEvent({
      id: "event-3",
      type: "message.created",
      chatId: "chat-1",
      userId: "user-1",
      summary: "第三条",
      createdAt: "2026-04-01T08:00:03.000Z",
    });

    const snapshot = store.readSnapshot();

    assert.equal(snapshot.status, "ok");
    assert.deepEqual(snapshot.recentEvents.map((event) => event.id), ["event-2", "event-3"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuDiagnosticsStateStore 会把缺失文件读成空状态", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-missing-"));
  const store = new FeishuDiagnosticsStateStore({
    filePath: join(root, "infra/local/feishu-diagnostics.json"),
  });

  try {
    const snapshot = store.readSnapshot();

    assert.equal(snapshot.path, "infra/local/feishu-diagnostics.json");
    assert.equal(snapshot.status, "missing");
    assert.deepEqual(snapshot.conversations, []);
    assert.deepEqual(snapshot.recentEvents, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuDiagnosticsStateStore 会把损坏文件读成 unreadable 且不覆盖原文件", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-diagnostics-unreadable-"));
  const filePath = join(root, "infra/local/feishu-diagnostics.json");
  const store = new FeishuDiagnosticsStateStore({
    filePath,
  });

  try {
    mkdirSync(join(root, "infra", "local"), { recursive: true });
    writeFileSync(filePath, "{not-json", "utf8");

    const snapshot = store.readSnapshot();

    assert.equal(snapshot.status, "unreadable");
    assert.deepEqual(snapshot.conversations, []);
    assert.deepEqual(snapshot.recentEvents, []);
    assert.equal(readFileSync(filePath, "utf8"), "{not-json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
