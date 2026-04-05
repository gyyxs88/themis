import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

test("文本输入在 runtime 不支持 nativeTextInput 时会被 blocked", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-text-blocked",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "text", role: "user", order: 1, text: "请直接总结这段文字" },
      ],
      assets: [],
      createdAt: "2026-04-05T10:00:00.000Z",
    },
    target: {
      runtimeId: "third-party",
      capabilities: {
        nativeTextInput: false,
        nativeImageInput: true,
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
        supportsPdfTextExtraction: false,
        supportsDocumentPageRasterization: false,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "blocked");
  assert.equal(compiled.compileWarnings[0]?.code, "TEXT_NATIVE_INPUT_REQUIRED");
  assert.match(compiled.compileWarnings[0]?.message ?? "", /文本原生输入/);
});

test("图片在 nativeImageInput 可用但本地路径不可信时会被 blocked", () => {
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-image-missing-path",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "image", role: "user", order: 1, assetId: "asset-image-1" },
      ],
      assets: [
        {
          assetId: "asset-image-1",
          kind: "image",
          mimeType: "image/png",
          localPath: "/workspace/temp/input-assets/missing-shot.png",
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-03T18:00:00.000Z",
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
  assert.equal(compiled.compileWarnings[0]?.code, "IMAGE_PATH_UNAVAILABLE");
  assert.match(compiled.compileWarnings[0]?.message ?? "", /可信本地路径/);
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
  assert.deepEqual(compiled.compileWarnings.map((warning) => warning.code), ["DOCUMENT_NATIVE_INPUT_FALLBACK"]);
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
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
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
  assert.deepEqual(
    compiled.compileWarnings.map((warning) => warning.code),
    ["DOCUMENT_NATIVE_INPUT_FALLBACK", "DOCUMENT_NATIVE_INPUT_FALLBACK"],
  );
});

test("文档在 runtime 声明 nativeDocumentInput 且 mimeType 被支持时会直通 native document part", () => {
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

  assert.equal(compiled.degradationLevel, "native");
  assert.deepEqual(compiled.fallbackPromptSections, []);
  assert.deepEqual(compiled.nativeInputParts, [{
    type: "document",
    assetPath: markdownPath,
    mimeType: "text/markdown",
    sourcePartId: "part-1",
    assetId: "asset-doc-1",
  }]);
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
  assert.deepEqual(compiled.compileWarnings.map((warning) => warning.code), ["DOCUMENT_NATIVE_INPUT_FALLBACK"]);
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

test("文档路径指向目录时会被 blocked", () => {
  const parentDirectory = mkdtempSync(join(tmpdir(), "themis-runtime-input-compiler-dir-"));
  const directoryPath = join(parentDirectory, "folder-as-document");
  mkdirSync(directoryPath);
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-document-directory-path-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          name: "folder-as-document",
          mimeType: "text/markdown",
          localPath: directoryPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-03T10:20:00.000Z",
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
  assert.equal(compiled.compileWarnings[0]?.code, "DOCUMENT_PATH_UNAVAILABLE");
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
  assert.deepEqual(compiled.compileWarnings.map((warning) => warning.code), ["DOCUMENT_NATIVE_INPUT_FALLBACK"]);
});

test("runtime 支持 nativeDocumentInput 但 mimeType 不在支持列表时仍会走路径提示块", () => {
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
        supportedDocumentMimeTypes: ["application/pdf"],
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
  assert.deepEqual(compiled.compileWarnings.map((warning) => warning.code), ["DOCUMENT_MIME_TYPE_FALLBACK"]);
});

test("runtime 支持 nativeDocumentInput 且 mimeType 带参数仍会按 wildcard 命中 native document", () => {
  const markdownPath = createTempTextFile("guide-param.md", "# Guide\n\nparam");
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-doc-native-parameterized-1",
      sourceChannel: "web",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          name: "guide-param.md",
          mimeType: "text/markdown; charset=utf-8",
          localPath: markdownPath,
          sourceChannel: "web",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-05T10:05:00.000Z",
    },
    target: {
      runtimeId: "app-server",
      capabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: true,
        supportedDocumentMimeTypes: ["text/*"],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: true,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "native");
  assert.deepEqual(compiled.compileWarnings, []);
  assert.deepEqual(compiled.nativeInputParts, [{
    type: "document",
    assetPath: markdownPath,
    mimeType: "text/markdown; charset=utf-8",
    sourcePartId: "part-1",
    assetId: "asset-doc-1",
  }]);
  assert.deepEqual(compiled.capabilityMatrix.assetFacts, [{
    assetId: "asset-doc-1",
    kind: "document",
    mimeType: "text/markdown; charset=utf-8",
    localPathStatus: "ready",
    modelNativeSupport: null,
    transportNativeSupport: null,
    effectiveNativeSupport: true,
    modelMimeTypeSupported: null,
    transportMimeTypeSupported: null,
    effectiveMimeTypeSupported: true,
    handling: "native",
  }]);
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
  assert.deepEqual(compiled.compileWarnings.map((warning) => warning.code), ["DOCUMENT_NATIVE_INPUT_FALLBACK"]);
});

test("能力矩阵会如实记录模型支持文档但 transport 不支持的路径 fallback", () => {
  const markdownPath = createTempTextFile("transport-gap.md", "# Gap\n\nhello");
  const compiled = compileTaskInputForRuntime({
    envelope: {
      envelopeId: "env-document-matrix-transport-gap",
      sourceChannel: "feishu",
      parts: [
        { partId: "part-1", type: "document", role: "user", order: 1, assetId: "asset-doc-1" },
      ],
      assets: [
        {
          assetId: "asset-doc-1",
          kind: "document",
          name: "transport-gap.md",
          mimeType: "text/markdown",
          localPath: markdownPath,
          sourceChannel: "feishu",
          ingestionStatus: "ready",
        },
      ],
      createdAt: "2026-04-03T21:05:00.000Z",
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
      modelCapabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: true,
        supportedDocumentMimeTypes: ["text/markdown"],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: false,
      },
      transportCapabilities: {
        nativeTextInput: true,
        nativeImageInput: true,
        nativeDocumentInput: false,
        supportedDocumentMimeTypes: [],
        supportsPdfTextExtraction: true,
        supportsDocumentPageRasterization: false,
      },
    },
  });

  assert.equal(compiled.degradationLevel, "controlled_fallback");
  assert.equal(compiled.capabilityMatrix.modelCapabilities?.nativeDocumentInput, true);
  assert.equal(compiled.capabilityMatrix.transportCapabilities?.nativeDocumentInput, false);
  assert.equal(compiled.capabilityMatrix.effectiveCapabilities.nativeDocumentInput, false);
  assert.deepEqual(compiled.capabilityMatrix.assetFacts, [
    {
      assetId: "asset-doc-1",
      kind: "document",
      mimeType: "text/markdown",
      localPathStatus: "ready",
      modelNativeSupport: true,
      transportNativeSupport: false,
      effectiveNativeSupport: false,
      modelMimeTypeSupported: true,
      transportMimeTypeSupported: null,
      effectiveMimeTypeSupported: null,
      handling: "path_fallback",
    },
  ]);
});
