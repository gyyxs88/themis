import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import { compileTaskInputForRuntime } from "./runtime-input-compiler.js";

function createTempTextFile(name: string, content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "themis-runtime-input-compiler-"));
  const path = join(directory, name);
  writeFileSync(path, content, "utf8");
  return path;
}

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
  const markdownPath = createTempTextFile("guide.md", "# Guide\n\nhello");
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
          localPath: markdownPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
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

test("Markdown 文档即使 runtime 声明 nativeDocumentInput 也仍然优先走 lossless_textualization", () => {
  const markdownPath = createTempTextFile("guide.md", "# Guide\n\nstill text");
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-markdown-native-doc-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          mimeType: "text/markdown",
          localPath: markdownPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-01T21:27:00.000Z",
    },
    target: {
      runtimeId: "app-server",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: true,
        supportedDocumentMimeTypes: ["text/markdown", "application/pdf"],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: true,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "lossless_textualization");
  assert.equal(compiled.nativeInputParts[0]?.type, "text");
  assert.match(compiled.nativeInputParts[0]?.text ?? "", /still text/);
});

test("可文本化文档在 runtime 不支持 nativeTextInput 时会被 blocked", () => {
  const markdownPath = createTempTextFile("guide.md", "# Guide\n\nblocked");
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-markdown-no-native-text-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          mimeType: "text/markdown",
          localPath: markdownPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-01T21:28:00.000Z",
    },
    target: {
      runtimeId: "third-party",
      capabilities: {
        nativeTextInput: false,
        nativeImageInput: true,
        nativeDocumentInput: true,
        supportedDocumentMimeTypes: ["text/markdown"],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: false,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "blocked");
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.equal(compiled.compileWarnings[0]?.code, "TEXT_NATIVE_INPUT_REQUIRED");
  assert.match(compiled.compileWarnings[0]?.message ?? "", /当前 runtime 未声明支持文本原生输入/);
});

test("Markdown 只有 textPreview、没有真实文本源时会降成 controlled fallback", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-markdown-preview-only-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          mimeType: "text/markdown",
          localPath: "/workspace/temp/input-assets/missing-guide.md",
          sourceChannel: "web",
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
            textPreview: "# Preview\n\nonly",
          },
        },
      ],
      createdAt: "2026-04-01T21:29:00.000Z",
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
  assert.equal(compiled.nativeInputParts[0]?.type, "text");
  assert.match(compiled.nativeInputParts[0]?.text ?? "", /Preview/);
  assert.equal(compiled.compileWarnings[0]?.code, "TEXTUAL_DOCUMENT_PREVIEW_FALLBACK");
});

test("可文本化文档既没有真实文本源也没有 textPreview 时会被 blocked", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-markdown-missing-text-source-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          mimeType: "text/markdown",
          localPath: "/workspace/temp/input-assets/missing-guide-without-preview.md",
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-01T21:29:30.000Z",
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

  assert.equal(compiled.degradationLevel, "blocked");
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.equal(compiled.compileWarnings[0]?.code, "TEXTUAL_DOCUMENT_SOURCE_UNAVAILABLE");
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

test("PDF controlled fallback 在 runtime 不支持 nativeTextInput 时会被 blocked", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-pdf-no-native-text-1",
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
      createdAt: "2026-04-01T21:31:00.000Z",
    },
    target: {
      runtimeId: "third-party",
      capabilities: {
        nativeTextInput: false,
        nativeImageInput: true,
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: true,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "blocked");
  assert.equal(compiled.compileWarnings[0]?.code, "TEXT_NATIVE_INPUT_REQUIRED");
  assert.match(compiled.compileWarnings[0]?.message ?? "", /PDF.*文本原生输入/);
});

test("runtime 支持 nativeDocumentInput 且 mimeType 被支持时会直通 document part", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-doc-native-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          localPath: "/workspace/temp/input-assets/brief.docx",
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-01T21:32:00.000Z",
    },
    target: {
      runtimeId: "app-server",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: true,
        supportedDocumentMimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: true,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "native");
  assert.equal(compiled.nativeInputParts[0]?.type, "document");
  assert.equal(compiled.nativeInputParts[0]?.assetId, "asset-doc-1");
});
