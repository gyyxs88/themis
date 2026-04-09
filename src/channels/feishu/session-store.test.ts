import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FeishuSessionStore } from "./session-store.js";

test("FeishuSessionStore 会保留历史 session 到 chat 的反查映射", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-session-store-"));
  const filePath = join(root, "infra/local/feishu-sessions.json");
  const store = new FeishuSessionStore({ filePath });

  try {
    store.setActiveSessionId({
      chatId: "chat-1",
      userId: "user-1",
    }, "session-feishu-old-1");
    store.setActiveSessionId({
      chatId: "chat-1",
      userId: "user-1",
    }, "session-feishu-new-1");

    assert.equal(store.getActiveSessionId({
      chatId: "chat-1",
      userId: "user-1",
    }), "session-feishu-new-1");
    assert.deepEqual(store.findConversationBySessionId("session-feishu-old-1"), {
      chatId: "chat-1",
      userId: "user-1",
    });
    assert.deepEqual(store.findConversationBySessionId("session-feishu-new-1"), {
      chatId: "chat-1",
      userId: "user-1",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuSessionStore 会兼容旧版 version 1 文件并补出 session 反查映射", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-session-store-v1-"));
  const filePath = join(root, "infra/local/feishu-sessions.json");
  mkdirSync(join(root, "infra/local"), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    version: 1,
    bindings: [{
      key: "chat-legacy::user-legacy",
      chatId: "chat-legacy",
      userId: "user-legacy",
      activeSessionId: "session-feishu-legacy-1",
      updatedAt: "2026-04-09T08:00:00.000Z",
    }],
  }, null, 2)}\n`, "utf8");

  try {
    const store = new FeishuSessionStore({ filePath });

    assert.equal(store.getActiveSessionId({
      chatId: "chat-legacy",
      userId: "user-legacy",
    }), "session-feishu-legacy-1");
    assert.deepEqual(store.findConversationBySessionId("session-feishu-legacy-1"), {
      chatId: "chat-legacy",
      userId: "user-legacy",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
