import assert from "node:assert/strict";
import test from "node:test";

import type { TaskInputEnvelope } from "../../types/index.js";
import { FeishuAdapter } from "./adapter.js";

test("FeishuAdapter.normalizeRequest 会透传 inputEnvelope", () => {
  const adapter = new FeishuAdapter();
  const inputEnvelope = createInputEnvelope();

  const request = adapter.normalizeRequest({
    source: "feishu",
    requestId: "req-feishu-envelope",
    goal: "请分析这个附件",
    sender: {
      userId: "ou_feishu_user",
      name: "Tester",
    },
    message: {
      messageId: "om_message_1",
      chatId: "oc_chat_1",
      text: "请分析这个附件",
    },
    inputEnvelope,
  });

  assert.equal(request.inputEnvelope, inputEnvelope);
});

function createInputEnvelope(): TaskInputEnvelope {
  return {
    envelopeId: "env-feishu-1",
    sourceChannel: "feishu",
    sourceMessageId: "om_message_1",
    parts: [
      {
        partId: "part-1",
        type: "text",
        role: "user",
        order: 1,
        text: "请分析这个附件",
      },
      {
        partId: "part-2",
        type: "document",
        role: "user",
        order: 2,
        assetId: "asset-doc-1",
      },
    ],
    assets: [
      {
        assetId: "asset-doc-1",
        kind: "document",
        name: "brief.pdf",
        mimeType: "application/pdf",
        localPath: "/workspace/temp/input-assets/brief.pdf",
        sourceChannel: "feishu",
        sourceMessageId: "om_message_1",
        ingestionStatus: "ready",
      },
    ],
    createdAt: "2026-04-01T21:00:00.000Z",
  };
}
