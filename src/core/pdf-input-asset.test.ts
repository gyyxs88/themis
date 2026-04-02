import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { TaskInputAsset } from "../types/index.js";
import { enrichPdfInputAsset } from "./pdf-input-asset.js";

function createPdfAsset(overrides: Partial<TaskInputAsset> = {}): TaskInputAsset {
  return {
    assetId: "asset-pdf-1",
    kind: "document",
    mimeType: "application/pdf",
    localPath: "/workspace/input-assets/report.pdf",
    sourceChannel: "web",
    ingestionStatus: "processing",
    ...overrides,
  };
}

function createTempPdfPath(fileName = "report.pdf"): string {
  const directory = mkdtempSync(join(tmpdir(), "themis-pdf-input-asset-"));
  const path = join(directory, fileName);
  writeFileSync(path, createMinimalPdfContent("Hello PDF"), "utf8");
  return path;
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

const hasPdfinfo = hasSystemCommand("pdfinfo");
const hasPdftotext = hasSystemCommand("pdftotext");
const maybeIntegrationTest = hasPdfinfo && hasPdftotext ? test : test.skip;

test("enrichPdfInputAsset 会补齐成功 PDF 资产的 textExtraction 与 pageCount", async () => {
  const localPath = createTempPdfPath();
  const asset = createPdfAsset({
    localPath,
    metadata: { languageHint: "zh" },
  });
  const longText = `${"PDF line 1\n".repeat(320)}tail`;
  let capturedTextPath = "";

  const result = await enrichPdfInputAsset(asset, {
    readPdfInfo: async () => ({ pageCount: 12 }),
    extractPdfText: async (_pdfPath, textPath) => {
      capturedTextPath = textPath;
      writeFileSync(textPath, longText, "utf8");
    },
  });

  assert.equal(result.ingestionStatus, "ready");
  assert.equal(result.textExtraction?.status, "completed");
  assert.equal(result.textExtraction?.textPath, capturedTextPath);
  assert.equal(result.textExtraction?.textPath, join(dirname(localPath), "report.txt"));
  assert.equal(result.metadata?.pageCount, 12);
  assert.equal(result.metadata?.languageHint, "zh");
  assert.ok((result.textExtraction?.textPreview?.length ?? 0) < longText.length);
  assert.match(result.textExtraction?.textPreview ?? "", /^PDF line 1/);
  assert.equal(asset.ingestionStatus, "processing");
  assert.equal(asset.textExtraction, undefined);
});

test("pdfinfo 失败但文本提取成功时仍然返回 ready 且不写 pageCount", async () => {
  const localPath = createTempPdfPath("fallback.pdf");
  const asset = createPdfAsset({
    localPath,
    metadata: { languageHint: "en" },
  });
  const text = "hello pdf";

  const result = await enrichPdfInputAsset(asset, {
    readPdfInfo: async () => {
      throw new Error("pdfinfo failed");
    },
    extractPdfText: async (_pdfPath, textPath) => {
      writeFileSync(textPath, text, "utf8");
    },
  });

  assert.equal(result.ingestionStatus, "ready");
  assert.equal(result.textExtraction?.status, "completed");
  assert.equal(result.textExtraction?.textPreview, text);
  assert.equal(result.textExtraction?.textPath, join(dirname(localPath), "fallback.txt"));
  assert.equal(result.metadata?.pageCount, undefined);
  assert.equal(result.metadata?.languageHint, "en");
});

test("文本提取失败时会保留 ready 并隐藏 textPath", async () => {
  const localPath = createTempPdfPath("failure.pdf");
  const asset = createPdfAsset({ localPath });

  const result = await enrichPdfInputAsset(asset, {
    readPdfInfo: async () => ({ pageCount: 7 }),
    extractPdfText: async () => {
      throw new Error("pdftotext failed");
    },
  });

  assert.equal(result.ingestionStatus, "ready");
  assert.equal(result.textExtraction?.status, "failed");
  assert.equal(result.textExtraction?.textPath, undefined);
  assert.equal(result.metadata?.pageCount, 7);
  assert.equal(result.localPath, asset.localPath);
});

maybeIntegrationTest("默认 spawn 路径会调用 pdfinfo 和 pdftotext，并产出同目录文本文件", async () => {
  const localPath = createTempPdfPath("spawned.pdf");
  assert.equal(existsSync(localPath), true);

  const result = await enrichPdfInputAsset(createPdfAsset({ localPath, ingestionStatus: "processing" }));

  assert.equal(result.ingestionStatus, "ready");
  assert.equal(result.textExtraction?.status, "completed");
  assert.equal(result.textExtraction?.textPath, join(dirname(localPath), "spawned.txt"));
  assert.equal(existsSync(result.textExtraction?.textPath ?? ""), true);
  assert.equal(result.metadata?.pageCount, 1);
  assert.match(result.textExtraction?.textPreview ?? "", /Hello PDF/);
});
