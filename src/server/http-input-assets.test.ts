import assert from "node:assert/strict";
import test from "node:test";

import { handleInputAssetUpload } from "./http-input-assets.js";

test("POST /api/input-assets 会把上传文件登记成 TaskInputAsset", async () => {
  const form = new FormData();
  form.set("file", new File(["# Guide\n\nhello"], "guide.md", {
    type: "text/markdown",
  }));

  const request = new Request("http://localhost/api/input-assets", {
    method: "POST",
    body: form,
  });

  const response = await handleInputAssetUpload(request, {
    workingDirectory: process.cwd(),
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    asset: {
      kind: string;
      mimeType: string;
      localPath: string;
      sourceChannel: string;
    };
  };
  assert.equal(payload.asset.kind, "document");
  assert.equal(payload.asset.mimeType, "text/markdown");
  assert.equal(payload.asset.sourceChannel, "web");
  assert.match(payload.asset.localPath, /temp[\\/]+input-assets[\\/]+/);
});
