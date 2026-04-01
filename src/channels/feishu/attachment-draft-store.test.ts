import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
