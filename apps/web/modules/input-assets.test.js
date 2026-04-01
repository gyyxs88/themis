import assert from "node:assert/strict";
import test from "node:test";

import { createInputAssetsApi } from "./input-assets.js";

test("createInputAssetsApi 会把草稿文本与上传资产组装成 inputEnvelope", async () => {
  const api = createInputAssetsApi({
    createId: () => "input-envelope-1",
  });

  const envelope = await api.buildDraftEnvelope({
    sourceChannel: "web",
    createdAt: "2026-04-01T22:00:00.000Z",
    draftGoal: "帮我看图",
    draftAssets: [
      {
        assetId: "asset-image-1",
        kind: "image",
        mimeType: "image/png",
        localPath: "/workspace/temp/input-assets/shot.png",
        sourceChannel: "web",
        ingestionStatus: "ready",
      },
    ],
  });

  assert.equal(envelope.parts[0].type, "text");
  assert.equal(envelope.parts[1].type, "image");
  assert.equal(envelope.assets[0].assetId, "asset-image-1");
});

test("createInputAssetsApi 会上传文件并返回 asset metadata", async () => {
  const api = createInputAssetsApi({
    fetchImpl: async (_url, init) => {
      assert.equal(_url, "/api/input-assets");
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof FormData);
      return new Response(JSON.stringify({
        asset: {
          assetId: "asset-image-1",
          kind: "image",
          name: "shot.png",
          mimeType: "image/png",
          localPath: "/workspace/temp/input-assets/shot.png",
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const asset = await api.uploadFile(new File(["png"], "shot.png", { type: "image/png" }));

  assert.equal(asset.assetId, "asset-image-1");
  assert.equal(asset.kind, "image");
});
