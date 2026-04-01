import assert from "node:assert/strict";
import test from "node:test";

import type { TaskInputEnvelope } from "../../types/index.js";
import { WebAdapter } from "./adapter.js";

test("WebAdapter.normalizeRequest 会透传 inputEnvelope", () => {
  const adapter = new WebAdapter();
  const inputEnvelope = createInputEnvelope();

  const request = adapter.normalizeRequest({
    source: "web",
    requestId: "req-web-envelope",
    goal: "看一下这张图",
    inputEnvelope,
  });

  assert.equal(request.inputEnvelope, inputEnvelope);
});

function createInputEnvelope(): TaskInputEnvelope {
  return {
    envelopeId: "env-web-1",
    sourceChannel: "web",
    parts: [
      {
        partId: "part-1",
        type: "text",
        role: "user",
        order: 1,
        text: "请看这张图",
      },
      {
        partId: "part-2",
        type: "image",
        role: "user",
        order: 2,
        assetId: "asset-image-1",
      },
    ],
    assets: [
      {
        assetId: "asset-image-1",
        kind: "image",
        name: "capture.png",
        mimeType: "image/png",
        localPath: "/workspace/temp/input-assets/capture.png",
        sourceChannel: "web",
        ingestionStatus: "ready",
      },
    ],
    createdAt: "2026-04-01T21:00:00.000Z",
  };
}
