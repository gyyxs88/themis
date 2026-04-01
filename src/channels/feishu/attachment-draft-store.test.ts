import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { FeishuAttachmentDraftStore } from "./attachment-draft-store.js";

test("FeishuAttachmentDraftStore 会按会话追加并消费附件草稿", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-attachment-draft-"));
  const store = new FeishuAttachmentDraftStore({
    filePath: join(root, "infra/local/feishu-attachment-drafts.json"),
    now: () => "2026-04-01T08:00:00.000Z",
    ttlMs: 30 * 60 * 1000,
  });
  const key = {
    chatId: "chat-1",
    userId: "user-1",
    sessionId: "session-1",
  };

  try {
    store.append(key, [{
      id: "img-1",
      type: "image",
      name: "shot.png",
      value: "/workspace/temp/feishu-attachments/session-1/message-1/shot.png",
      sourceMessageId: "message-1",
      createdAt: "2026-04-01T08:00:00.000Z",
    }]);
    store.append(key, [{
      id: "file-1",
      type: "file",
      name: "report.pdf",
      value: "/workspace/temp/feishu-attachments/session-1/message-2/report.pdf",
      sourceMessageId: "message-2",
      createdAt: "2026-04-01T08:01:00.000Z",
    }]);

    assert.deepEqual(
      store.get(key)?.attachments.map((item) => [item.id, item.type]),
      [
        ["img-1", "image"],
        ["file-1", "file"],
      ],
    );

    assert.deepEqual(store.consume(key)?.attachments.map((item) => item.id), ["img-1", "file-1"]);
    assert.equal(store.get(key), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuAttachmentDraftStore 按 chatId + userId + sessionId 隔离不同会话的草稿", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-attachment-draft-isolation-"));
  const store = new FeishuAttachmentDraftStore({
    filePath: join(root, "infra/local/feishu-attachment-drafts.json"),
    now: () => "2026-04-01T08:00:00.000Z",
    ttlMs: 30 * 60 * 1000,
  });
  const keyA = {
    chatId: "chat-1",
    userId: "user-1",
    sessionId: "session-1",
  };
  const keyB = {
    chatId: "chat-1",
    userId: "user-1",
    sessionId: "session-2",
  };
  const keyC = {
    chatId: "chat-2",
    userId: "user-1",
    sessionId: "session-1",
  };
  const keyD = {
    chatId: "chat-1",
    userId: "user-2",
    sessionId: "session-1",
  };

  try {
    store.append(keyA, [{
      id: "img-1",
      type: "image",
      name: "a.png",
      value: "/workspace/temp/feishu-attachments/session-1/message-1/a.png",
      sourceMessageId: "message-1",
      createdAt: "2026-04-01T08:00:00.000Z",
    }]);
    store.append(keyB, [{
      id: "file-1",
      type: "file",
      name: "b.pdf",
      value: "/workspace/temp/feishu-attachments/session-2/message-1/b.pdf",
      sourceMessageId: "message-2",
      createdAt: "2026-04-01T08:00:30.000Z",
    }]);
    store.append(keyC, [{
      id: "img-2",
      type: "image",
      name: "c.png",
      value: "/workspace/temp/feishu-attachments/session-1/message-2/c.png",
      sourceMessageId: "message-3",
      createdAt: "2026-04-01T08:01:00.000Z",
    }]);
    store.append(keyD, [{
      id: "file-2",
      type: "file",
      name: "d.pdf",
      value: "/workspace/temp/feishu-attachments/session-1/message-3/d.pdf",
      sourceMessageId: "message-4",
      createdAt: "2026-04-01T08:00:45.000Z",
    }]);

    assert.deepEqual(store.get(keyA)?.attachments.map((item) => item.id), ["img-1"]);
    assert.deepEqual(store.get(keyB)?.attachments.map((item) => item.id), ["file-1"]);
    assert.deepEqual(store.get(keyC)?.attachments.map((item) => item.id), ["img-2"]);
    assert.deepEqual(store.get(keyD)?.attachments.map((item) => item.id), ["file-2"]);

    assert.deepEqual(store.consume(keyB)?.attachments.map((item) => item.id), ["file-1"]);
    assert.equal(store.get(keyB), null);
    assert.deepEqual(store.get(keyA)?.attachments.map((item) => item.id), ["img-1"]);
    assert.deepEqual(store.get(keyC)?.attachments.map((item) => item.id), ["img-2"]);
    assert.deepEqual(store.get(keyD)?.attachments.map((item) => item.id), ["file-2"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuAttachmentDraftStore 会在读取时清理过期草稿", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-attachment-draft-expired-"));
  let now = "2026-04-01T08:00:00.000Z";
  const store = new FeishuAttachmentDraftStore({
    filePath: join(root, "infra/local/feishu-attachment-drafts.json"),
    now: () => now,
    ttlMs: 60_000,
  });
  const key = {
    chatId: "chat-1",
    userId: "user-1",
    sessionId: "session-1",
  };

  try {
    store.append(key, [{
      id: "img-1",
      type: "image",
      value: "/workspace/temp/feishu-attachments/session-1/message-1/image.png",
      sourceMessageId: "message-1",
      createdAt: now,
    }]);

    now = "2026-04-01T08:02:01.000Z";

    assert.equal(store.get(key), null);
    assert.equal(store.consume(key), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuAttachmentDraftStore 会在消费时独立清理过期草稿", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-attachment-draft-consume-expired-"));
  let now = "2026-04-01T08:00:00.000Z";
  const key = {
    chatId: "chat-1",
    userId: "user-1",
    sessionId: "session-1",
  };
  const store = new FeishuAttachmentDraftStore({
    filePath: join(root, "infra/local/feishu-attachment-drafts.json"),
    now: () => now,
    ttlMs: 60_000,
  });

  try {
    store.append(key, [{
      id: "img-1",
      type: "image",
      value: "/workspace/temp/feishu-attachments/session-1/message-1/image.png",
      sourceMessageId: "message-1",
      createdAt: now,
    }]);

    now = "2026-04-01T08:02:01.000Z";

    assert.equal(store.consume(key), null);

    const newStore = new FeishuAttachmentDraftStore({
      filePath: join(root, "infra/local/feishu-attachment-drafts.json"),
      now: () => now,
      ttlMs: 60_000,
    });
    assert.equal(newStore.get(key), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuAttachmentDraftStore 会基于 chatId + userId + sessionId 重建持久化 key", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-attachment-draft-normalized-key-"));
  const filePath = join(root, "infra/local/feishu-attachment-drafts.json");
  const now = new Date().toISOString();
  const key = {
    chatId: "chat-1",
    userId: "user-1",
    sessionId: "session-1",
  };

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify({
      version: 1,
      drafts: [{
        key: "tampered-key",
        chatId: key.chatId,
        userId: key.userId,
        sessionId: key.sessionId,
        attachments: [{
          id: "img-1",
          type: "image",
          value: "/workspace/temp/feishu-attachments/session-1/message-1/image.png",
          sourceMessageId: "message-1",
          createdAt: now,
        }],
      }],
    }, null, 2)}\n`, "utf8");

    const store = new FeishuAttachmentDraftStore({ filePath });
    assert.deepEqual(store.get(key)?.attachments.map((item) => item.id), ["img-1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FeishuAttachmentDraftStore 默认使用本地路径与 30 分钟 TTL", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-feishu-attachment-draft-defaults-"));
  const originalCwd = process.cwd();
  const key = {
    chatId: "chat-1",
    userId: "user-1",
    sessionId: "session-1",
  };

  try {
    process.chdir(root);
    const store = new FeishuAttachmentDraftStore();
    const oldAttachmentCreatedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const draftPath = join(root, "infra/local/feishu-attachment-drafts.json");

    store.append(key, [{
      id: "img-1",
      type: "image",
      value: "/workspace/temp/feishu-attachments/session-1/message-1/image.png",
      sourceMessageId: "message-1",
      createdAt: oldAttachmentCreatedAt,
    }]);

    assert.equal(existsSync(draftPath), true);
    assert.equal(store.consume(key), null);
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
