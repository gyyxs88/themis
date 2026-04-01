import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLegacyAttachmentsFromEnvelope,
  createTaskInputEnvelope,
  listEnvelopeAssetsByOrder,
} from "./task-input.js";

test("createTaskInputEnvelope 会按 order 排序 parts，并保持 text/image/document 顺序", () => {
  const envelope = createTaskInputEnvelope({
    sourceChannel: "web",
    createdAt: "2026-04-01T21:00:00.000Z",
    parts: [
      {
        type: "document",
        role: "user",
        order: 3,
        assetId: "asset-doc-1",
      },
      {
        type: "text",
        role: "user",
        order: 1,
        text: "先看文字",
      },
      {
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
        name: "shot.png",
        mimeType: "image/png",
        localPath: "/workspace/temp/input-assets/shot.png",
        sourceChannel: "web",
        ingestionStatus: "ready",
      },
      {
        assetId: "asset-doc-1",
        kind: "document",
        name: "notes.pdf",
        mimeType: "application/pdf",
        localPath: "/workspace/temp/input-assets/notes.pdf",
        sourceChannel: "web",
        ingestionStatus: "ready",
      },
    ],
  });

  assert.deepEqual(envelope.parts.map((part) => part.type), ["text", "image", "document"]);
  assert.deepEqual(envelope.parts.map((part) => part.order), [1, 2, 3]);
});

test("buildLegacyAttachmentsFromEnvelope 只从非文本资产派生，并保留路径、名称和类型", () => {
  const envelope = createTaskInputEnvelope({
    sourceChannel: "feishu",
    createdAt: "2026-04-01T21:00:00.000Z",
    parts: [
      {
        type: "text",
        role: "user",
        order: 1,
        text: "请看附件",
      },
      {
        type: "image",
        role: "user",
        order: 2,
        assetId: "asset-image-1",
      },
      {
        type: "document",
        role: "user",
        order: 3,
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
        ingestionStatus: "ready",
      },
      {
        assetId: "asset-image-1",
        kind: "image",
        name: "capture.png",
        mimeType: "image/png",
        localPath: "/workspace/temp/input-assets/capture.png",
        sourceChannel: "feishu",
        ingestionStatus: "ready",
      },
    ],
  });

  assert.deepEqual(
    listEnvelopeAssetsByOrder(envelope).map((asset) => asset.assetId),
    ["asset-image-1", "asset-doc-1"],
  );
  assert.deepEqual(buildLegacyAttachmentsFromEnvelope(envelope), [
    {
      id: "asset-image-1",
      type: "image",
      name: "capture.png",
      value: "/workspace/temp/input-assets/capture.png",
    },
    {
      id: "asset-doc-1",
      type: "file",
      name: "brief.pdf",
      value: "/workspace/temp/input-assets/brief.pdf",
    },
  ]);
});

test("listEnvelopeAssetsByOrder 与 buildLegacyAttachmentsFromEnvelope 在缺失 asset 时会显式报错", () => {
  const envelope = createTaskInputEnvelope({
    sourceChannel: "web",
    createdAt: "2026-04-01T21:00:00.000Z",
    parts: [
      {
        type: "text",
        role: "user",
        order: 1,
        text: "请看这张图",
      },
      {
        type: "image",
        role: "user",
        order: 2,
        assetId: "asset-image-missing",
      },
    ],
    assets: [],
  });

  assert.throws(
    () => listEnvelopeAssetsByOrder(envelope),
    /asset-image-missing/,
  );
  assert.throws(
    () => buildLegacyAttachmentsFromEnvelope(envelope),
    /asset-image-missing/,
  );
});
