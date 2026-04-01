import assert from "node:assert/strict";
import test from "node:test";

import { handleInputAssetUpload, handleInputAssetUploadHttp } from "./http-input-assets.js";

test("POST /api/input-assets 会把上传文件登记成 TaskInputAsset", async () => {
  const originalArrayBuffer = File.prototype.arrayBuffer;
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value: async function arrayBuffer() {
      throw new Error("file.arrayBuffer() 不应该被调用");
    },
  });

  try {
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
  } finally {
    Object.defineProperty(File.prototype, "arrayBuffer", {
      configurable: true,
      value: originalArrayBuffer,
    });
  }
});

test("POST /api/input-assets 会拒绝超过大小限制的文件", async () => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(26 * 1024 * 1024)], "too-big.bin", {
    type: "application/octet-stream",
  }));

  const request = new Request("http://localhost/api/input-assets", {
    method: "POST",
    body: form,
  });

  const response = await handleInputAssetUpload(request, {
    workingDirectory: process.cwd(),
  });

  assert.equal(response.status, 413);
  const payload = await response.json() as {
    error?: string;
  };
  assert.match(payload.error ?? "", /大小限制|超过|25MB/);
});

test("POST /api/input-assets 会明确拒绝 PDF 上传", async () => {
  const form = new FormData();
  form.set("file", new File(["%PDF-1.4"], "report.pdf", {
    type: "application/pdf",
  }));

  const request = new Request("http://localhost/api/input-assets", {
    method: "POST",
    body: form,
  });

  const response = await handleInputAssetUpload(request, {
    workingDirectory: process.cwd(),
  });

  assert.equal(response.status, 415);
  const payload = await response.json() as {
    error?: string;
  };
  assert.match(payload.error ?? "", /PDF|暂不支持|不支持/);
});

test("POST /api/input-assets 在 content-length 超限时会在 HTTP 层直接返回 413", async () => {
  let bodyAccessed = false;
  const request = {
    method: "POST",
    url: "/api/input-assets",
    headers: {
      "content-length": String((25 * 1024 * 1024) + 1),
    },
    get body() {
      bodyAccessed = true;
      throw new Error("multipart body should not be touched");
    },
  } as never;

  const response = createResponseStub();

  await handleInputAssetUploadHttp(request, response as never, {
    workingDirectory: process.cwd(),
  });

  assert.equal(response.statusCode, 413);
  assert.equal(bodyAccessed, false);
  assert.match(response.body ?? "", /25MB|超过|大小限制/);
});

function createResponseStub() {
  const headers: Record<string, string> = {};

  return {
    statusCode: 0,
    headers,
    body: "",
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(value?: string) {
      this.body = typeof value === "string" ? value : "";
      return this;
    },
  };
}
