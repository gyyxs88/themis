import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
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

test("POST /api/input-assets 会把 markdown 上传交给共享文档富化器", async () => {
  let enrichCalls = 0;
  let receivedMimeType = "";

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
    enrichDocumentAsset: async (asset) => {
      enrichCalls += 1;
      receivedMimeType = asset.mimeType;
      return {
        ...asset,
        ingestionStatus: "ready",
        textExtraction: {
          status: "completed",
          textPath: `${asset.localPath}.themis.txt`,
          textPreview: "# Guide",
        },
      };
    },
  });

  const payload = await response.json() as {
    asset: {
      mimeType: string;
      textExtraction?: {
        status: string;
        textPreview?: string;
      };
    };
  };

  assert.equal(response.status, 200);
  assert.equal(enrichCalls, 1);
  assert.equal(receivedMimeType, "text/markdown");
  assert.equal(payload.asset.textExtraction?.status, "completed");
  assert.equal(payload.asset.textExtraction?.textPreview, "# Guide");
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

test("POST /api/input-assets 会在注入的 PDF 富化成功后返回 completed textExtraction", async () => {
  const uploadedText = createMinimalPdfContent("Injected PDF");
  let capturedAsset: {
    assetId: string;
    mimeType: string;
    localPath: string;
  } | undefined;

  const form = new FormData();
  form.set("file", new File([uploadedText], "report.pdf", {
    type: "application/pdf",
  }));

  const request = new Request("http://localhost/api/input-assets", {
    method: "POST",
    body: form,
  });

  const response = await handleInputAssetUpload(request, {
    workingDirectory: process.cwd(),
    enrichDocumentAsset: async (asset) => {
      capturedAsset = {
        assetId: asset.assetId,
        mimeType: asset.mimeType,
        localPath: asset.localPath,
      };

      assert.equal(existsSync(asset.localPath), true);
      assert.equal(readFileSync(asset.localPath, "utf8"), uploadedText);

      return {
        ...asset,
        ingestionStatus: "ready",
        textExtraction: {
          status: "completed",
          textPath: join(dirname(asset.localPath), "report.txt"),
          textPreview: "Injected PDF",
        },
      };
    },
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    asset: {
      kind: string;
      mimeType: string;
      sourceChannel: string;
      ingestionStatus: string;
      textExtraction?: {
        status: string;
        textPath?: string;
        textPreview?: string;
      };
    };
  };

  assert.equal(capturedAsset?.mimeType, "application/pdf");
  assert.equal(payload.asset.kind, "document");
  assert.equal(payload.asset.mimeType, "application/pdf");
  assert.equal(payload.asset.sourceChannel, "web");
  assert.equal(payload.asset.ingestionStatus, "ready");
  assert.equal(payload.asset.textExtraction?.status, "completed");
  assert.equal(payload.asset.textExtraction?.textPreview, "Injected PDF");
  assert.match(payload.asset.textExtraction?.textPath ?? "", /report\.txt$/);
});

test("POST /api/input-assets 会在 PDF 富化失败时仍返回 200 和 failed textExtraction", async () => {
  const form = new FormData();
  form.set("file", new File([createMinimalPdfContent("Broken PDF")], "broken.pdf", {
    type: "application/pdf",
  }));

  const request = new Request("http://localhost/api/input-assets", {
    method: "POST",
    body: form,
  });

  const response = await handleInputAssetUpload(request, {
    workingDirectory: process.cwd(),
    enrichDocumentAsset: async (asset) => ({
      ...asset,
      ingestionStatus: "ready",
      textExtraction: {
        status: "failed",
      },
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    asset: {
      ingestionStatus: string;
      textExtraction?: {
        status: string;
      };
    };
  };

  assert.equal(payload.asset.ingestionStatus, "ready");
  assert.equal(payload.asset.textExtraction?.status, "failed");
});

test("POST /api/input-assets 会把仅靠 .PDF 后缀识别出的文件归一化成 application/pdf", async () => {
  const form = new FormData();
  form.set("file", new File([createMinimalPdfContent("Suffix PDF")], "blank-type.PDF", {
    type: "",
  }));

  const request = new Request("http://localhost/api/input-assets", {
    method: "POST",
    body: form,
  });

  const response = await handleInputAssetUpload(request, {
    workingDirectory: process.cwd(),
    enrichDocumentAsset: async (asset) => ({
      ...asset,
      textExtraction: {
        status: "completed",
        textPath: join(dirname(asset.localPath), "blank-type.txt"),
        textPreview: "Suffix PDF",
      },
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    asset: {
      mimeType: string;
      textExtraction?: {
        status: string;
      };
    };
  };

  assert.equal(payload.asset.mimeType, "application/pdf");
  assert.equal(payload.asset.textExtraction?.status, "completed");
});

test("POST /api/input-assets 会把 .pdf 且 MIME 伪装成 image/png 的文件仍识别为 document 并富化", async () => {
  let enrichCalls = 0;
  let capturedKind = "";
  let capturedMimeType = "";

  const form = new FormData();
  form.set("file", new File([createMinimalPdfContent("Spoofed MIME PDF")], "spoofed.pdf", {
    type: "image/png",
  }));

  const request = new Request("http://localhost/api/input-assets", {
    method: "POST",
    body: form,
  });

  const response = await handleInputAssetUpload(request, {
    workingDirectory: process.cwd(),
    enrichDocumentAsset: async (asset) => {
      enrichCalls += 1;
      capturedKind = asset.kind;
      capturedMimeType = asset.mimeType;
      return {
        ...asset,
        textExtraction: {
          status: "completed",
          textPath: `${asset.localPath}.themis.txt`,
          textPreview: "Spoofed MIME PDF",
        },
      };
    },
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    asset: {
      kind: string;
      mimeType: string;
      textExtraction?: {
        status: string;
      };
    };
  };

  assert.equal(enrichCalls, 1);
  assert.equal(capturedKind, "document");
  assert.equal(capturedMimeType, "application/pdf");
  assert.equal(payload.asset.kind, "document");
  assert.equal(payload.asset.mimeType, "application/pdf");
  assert.equal(payload.asset.textExtraction?.status, "completed");
});

const hasPdfinfo = hasSystemCommand("pdfinfo");
const hasPdftotext = hasSystemCommand("pdftotext");
const maybeIntegrationTest = hasPdfinfo && hasPdftotext ? test : test.skip;

maybeIntegrationTest("默认生产路径会接上共享 PDF helper 并产出 completed textExtraction", async () => {
  const pdfText = "Hello from shared helper";
  const form = new FormData();
  form.set("file", new File([createMinimalPdfContent(pdfText)], "shared.pdf", {
    type: "application/pdf",
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
      ingestionStatus: string;
      textExtraction?: {
        status: string;
        textPath?: string;
        textPreview?: string;
      };
      metadata?: {
        pageCount?: number;
      };
    };
  };

  assert.equal(payload.asset.ingestionStatus, "ready");
  assert.equal(payload.asset.textExtraction?.status, "completed");
  assert.equal(payload.asset.metadata?.pageCount, 1);
  assert.match(payload.asset.textExtraction?.textPreview ?? "", /Hello from shared helper/);
  assert.equal(existsSync(payload.asset.textExtraction?.textPath ?? ""), true);
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

function createMinimalPdfContent(text: string): string {
  const header = "%PDF-1.4\n";
  const stream = `BT /F1 12 Tf 72 120 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pdf = header;
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  const xrefEntries = offsets
    .map((offset, index) => (index === 0 ? "0000000000 65535 f \n" : `${String(offset).padStart(10, "0")} 00000 n \n`))
    .join("");

  return (
    pdf +
    `xref\n0 ${objects.length + 1}\n${xrefEntries}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );
}

function escapePdfText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function hasSystemCommand(command: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v ${command} >/dev/null 2>&1`], {
    stdio: "ignore",
  });

  return result.status === 0;
}
