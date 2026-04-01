import assert from "node:assert/strict";
import test from "node:test";

import { compileTaskInputForRuntime } from "./runtime-input-compiler.js";

test("图片输入在 runtime 不支持 nativeImageInput 时会被 blocked", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-image-blocked",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "text", role: "user", order: 1, text: "看看这张图" },
        { partId: "part-2", type: "image", role: "user", order: 2, assetId: "asset-image-1" },
      ],
      assets: [
        {
          assetId: "asset-image-1",
          kind: "image",
          mimeType: "image/png",
          localPath: "/workspace/temp/input-assets/shot.png",
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-01T21:20:00.000Z",
    },
    target: {
      runtimeId: "third-party",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: false,
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
        supportsPdfTextExtraction: false,
        supportsDocumentPageRasterization: false,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "blocked");
  assert.match(compiled.compileWarnings[0]?.message ?? "", /当前 runtime 未声明支持图片原生输入/);
});

test("Markdown 文档会被无损文本化成 native text parts", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-markdown-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          mimeType: "text/markdown",
          localPath: "/workspace/temp/input-assets/guide.md",
          sourceChannel: "web",
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
            textPreview: "# Guide\n\nhello",
          },
        },
      ],
      createdAt: "2026-04-01T21:25:00.000Z",
    },
    target: {
      runtimeId: "app-server",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: true,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "lossless_textualization");
  assert.equal(compiled.nativeInputParts[0]?.type, "text");
  assert.match(compiled.nativeInputParts[0]?.text ?? "", /Guide/);
  assert.match(compiled.nativeInputParts[0]?.text ?? "", /hello/);
});

test("PDF 在没有 nativeDocumentInput 时会走 controlled fallback", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-pdf-1",
      sourceChannel: "feishu",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-pdf-1" },
      ],
      assets: [
        {
          assetId: "asset-pdf-1",
          kind: "document",
          mimeType: "application/pdf",
          localPath: "/workspace/temp/input-assets/report.pdf",
          sourceChannel: "feishu",
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
            textPreview: "checkout summary",
          },
        },
      ],
      createdAt: "2026-04-01T21:30:00.000Z",
    },
    target: {
      runtimeId: "app-server",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: true,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "controlled_fallback");
  assert.match(compiled.fallbackPromptSections.join("\n"), /checkout summary/);
  assert.equal(compiled.compileWarnings[0]?.code, "PDF_CONTROLLED_FALLBACK");
});
