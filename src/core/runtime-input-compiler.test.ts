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

test("Markdown 文档不会再被文本化，而是统一生成路径提示块", () => {
  const markdownPath = createTempTextFile("guide.md", "# Guide\n\nhello");
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-markdown-path-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          name: "guide.md",
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

  assert.equal(compiled.degradationLevel, "controlled_fallback");
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.equal(compiled.fallbackPromptSections.length, 1);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /Attached document paths:/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /assetId: asset-doc-1/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /name: guide\.md/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /mimeType: text\/markdown/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /localPath: .*guide\.md/);
  assert.doesNotMatch(compiled.fallbackPromptSections[0] ?? "", /# Guide/);
});

test("同一批文档会合并成同一个路径提示块", () => {
  const markdownPath = createTempTextFile("guide.md", "# Guide");
  const pdfPath = createTempTextFile("report.pdf", "fake-pdf");
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-document-batch-paths-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
        { partId: "part-2", type: "document", role: "user", order: 2, assetId: "asset-doc-2" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          name: "guide.md",
          mimeType: "text/markdown",
          localPath: markdownPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
        {
          assetId: "asset-doc-2",
          kind: "document",
          name: "report.pdf",
          mimeType: "application/pdf",
          localPath: pdfPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-03T09:05:00.000Z",
    },
    target: {
      runtimeId: "app-server",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: true,
        supportedDocumentMimeTypes: ["text/markdown", "application/pdf"],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: false,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "controlled_fallback");
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.equal(compiled.fallbackPromptSections.length, 1);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /assetId: asset-doc-1/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /assetId: asset-doc-2/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /name: guide\.md/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /name: report\.pdf/);
});

test("文档即使 runtime 声明 nativeDocumentInput 也仍然只会生成路径提示块", () => {
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
          name: "guide.md",
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

  assert.equal(compiled.degradationLevel, "controlled_fallback");
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /Attached document paths:/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /name: guide\.md/);
  assert.doesNotMatch(compiled.fallbackPromptSections[0] ?? "", /still text/);
});

test("文档即使带有 textPreview 也不会再把正文编进执行输入", () => {
  const markdownPath = createTempTextFile("guide.md", "# Guide\n\nblocked");
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
          name: "guide.md",
          mimeType: "text/markdown",
          localPath: markdownPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
            textPreview: "# Preview\n\nonly",
          },
        },
      ],
      createdAt: "2026-04-03T09:10:00.000Z",
    },
    target: {
      runtimeId: "third-party",
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
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.equal(compiled.fallbackPromptSections.length, 1);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /assetId: asset-doc-1/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /name: guide\.md/);
  assert.doesNotMatch(compiled.fallbackPromptSections[0] ?? "", /# Preview/);
});

test("文档缺少可信路径时会被 blocked", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-document-missing-path-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-pdf-1" },
      ],
      assets: [
        {
          assetId: "asset-pdf-1",
          kind: "document",
          name: "report.pdf",
          mimeType: "application/pdf",
          localPath: "/workspace/temp/input-assets/missing-report.pdf",
          sourceChannel: "web",
          ingestionStatus: "ready",
          textExtraction: {
            status: "completed",
            textPreview: "checkout summary",
          },
        },
      ],
      createdAt: "2026-04-03T09:15:00.000Z",
    },
    target: {
      runtimeId: "app-server",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: false,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "blocked");
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.deepEqual(compiled.fallbackPromptSections, []);
  assert.equal(compiled.compileWarnings[0]?.code, "DOCUMENT_PATH_UNAVAILABLE");
  assert.match(compiled.compileWarnings[0]?.message ?? "", /可信本地路径/);
});

test("PDF 在没有 nativeDocumentInput 时也只会生成路径提示块", () => {
  const pdfPath = createTempTextFile("report.pdf", "fake-pdf");
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
          name: "report.pdf",
          mimeType: "application/pdf",
          localPath: pdfPath,
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
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.equal(compiled.fallbackPromptSections.length, 1);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /Attached document paths:/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /assetId: asset-pdf-1/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /name: report\.pdf/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /mimeType: application\/pdf/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /localPath: .*report\.pdf/);
  assert.doesNotMatch(compiled.fallbackPromptSections[0] ?? "", /checkout summary/);
});

test("runtime 支持 nativeDocumentInput 且 mimeType 被支持时也不会再直通 document part", () => {
  const docxPath = createTempTextFile("brief.docx", "fake-docx");
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
          name: "brief.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          localPath: docxPath,
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

  assert.equal(compiled.degradationLevel, "controlled_fallback");
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.equal(compiled.fallbackPromptSections.length, 1);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /assetId: asset-doc-1/);
  assert.match(
    compiled.fallbackPromptSections[0] ?? "",
    /mimeType: application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/,
  );
  assert.match(compiled.fallbackPromptSections[0] ?? "", /name: brief\.docx/);
});

test("runtime 不支持该文档 mimeType 时也会统一走路径提示块", () => {
  const xlsPath = createTempTextFile("sheet.xls", "fake-xls");
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-doc-unsupported-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          name: "sheet.xls",
          mimeType: "application/vnd.ms-excel",
          localPath: xlsPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-01T21:33:00.000Z",
    },
    target: {
      runtimeId: "third-party",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
        supportsPdfTextExtraction: false,
        supportsDocumentPageRasterization: false,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "controlled_fallback");
  assert.deepEqual(compiled.nativeInputParts, []);
  assert.equal(compiled.fallbackPromptSections.length, 1);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /assetId: asset-doc-1/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /name: sheet\.xls/);
  assert.match(compiled.fallbackPromptSections[0] ?? "", /mimeType: application\/vnd\.ms-excel/);
});
