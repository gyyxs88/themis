import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TaskInputAsset } from "../types/index.js";
import { enrichDocumentInputAsset } from "./document-input-asset.js";

function createDocumentAsset(overrides: Partial<TaskInputAsset> = {}): TaskInputAsset {
  return {
    assetId: "asset-doc-1",
    kind: "document",
    mimeType: "text/plain",
    localPath: "/workspace/temp/input-assets/notes.txt",
    sourceChannel: "web",
    ingestionStatus: "processing",
    ...overrides,
  };
}

function createTempFile(fileName: string, content: string | Uint8Array): string {
  const directory = mkdtempSync(join(tmpdir(), "themis-document-input-asset-"));
  const path = join(directory, fileName);
  writeFileSync(path, content);
  return path;
}

test("白名单文本 MIME 会补 completed textExtraction 与 sidecar 文本文件", async () => {
  const localPath = createTempFile("guide.md", "# Guide\n\nhello");
  const result = await enrichDocumentInputAsset(createDocumentAsset({
    mimeType: "text/markdown",
    localPath,
  }));

  assert.equal(result.ingestionStatus, "ready");
  assert.equal(result.textExtraction?.status, "completed");
  assert.match(result.textExtraction?.textPath ?? "", /guide\.md\.themis\.txt$/);
  assert.match(result.textExtraction?.textPreview ?? "", /# Guide/);
  assert.equal(readFileSync(result.textExtraction?.textPath ?? "", "utf8"), "# Guide\n\nhello");
});

test("未知后缀但内容像 UTF-8 文本时也会进入文本富化", async () => {
  const localPath = createTempFile("README.custom", "alpha\nbeta\n");
  const result = await enrichDocumentInputAsset(createDocumentAsset({
    mimeType: "application/octet-stream",
    localPath,
  }));

  assert.equal(result.textExtraction?.status, "completed");
  assert.match(result.textExtraction?.textPreview ?? "", /alpha/);
});

test("文本型文档在读取全文失败时会回退为 ready/failed", async () => {
  const localPath = createTempFile("guide.txt", "alpha\nbeta\n");
  const result = await enrichDocumentInputAsset(createDocumentAsset({
    mimeType: "text/plain",
    localPath,
  }), {
    readWholeFile: async () => {
      throw new Error("read failed");
    },
  });

  assert.equal(result.ingestionStatus, "ready");
  assert.equal(result.textExtraction?.status, "failed");
});

test("文本型文档在写 sidecar 失败时会回退为 ready/failed", async () => {
  const localPath = createTempFile("guide.txt", "alpha\nbeta\n");
  const result = await enrichDocumentInputAsset(createDocumentAsset({
    mimeType: "text/plain",
    localPath,
  }), {
    readWholeFile: async () => Buffer.from("alpha\nbeta\n"),
    writeTextFile: async () => {
      throw new Error("write failed");
    },
  });

  assert.equal(result.ingestionStatus, "ready");
  assert.equal(result.textExtraction?.status, "failed");
});

test("明显二进制内容不会误判成文本文档", async () => {
  const localPath = createTempFile("blob.bin", new Uint8Array([0, 159, 146, 150, 0, 1, 2, 3]));
  const result = await enrichDocumentInputAsset(createDocumentAsset({
    mimeType: "application/octet-stream",
    localPath,
  }));

  assert.equal(result.textExtraction, undefined);
  assert.equal(result.ingestionStatus, "processing");
});

test("PDF 会继续委托给现有 PDF 富化逻辑", async () => {
  const localPath = createTempFile("report.pdf", "fake-pdf");
  let delegated = 0;

  const result = await enrichDocumentInputAsset(createDocumentAsset({
    mimeType: "application/pdf",
    localPath,
  }), {
    enrichPdfAsset: async (asset) => {
      delegated += 1;
      return {
        ...asset,
        ingestionStatus: "ready",
        metadata: { pageCount: 8 },
        textExtraction: {
          status: "completed",
          textPath: "/tmp/report.txt",
          textPreview: "fake pdf text",
        },
      };
    },
  });

  assert.equal(delegated, 1);
  assert.equal(result.metadata?.pageCount, 8);
  assert.equal(result.textExtraction?.status, "completed");
});
