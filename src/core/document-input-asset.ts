import { TextDecoder } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { open } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import type { TaskInputAsset } from "../types/index.js";
import { enrichPdfInputAsset } from "./pdf-input-asset.js";

export interface DocumentInputAssetTools {
  enrichPdfAsset?: typeof enrichPdfInputAsset;
  readWholeFile?: (filePath: string) => Promise<Uint8Array>;
  writeTextFile?: (filePath: string, text: string, encoding: BufferEncoding) => Promise<void>;
}

const TEXT_PREVIEW_LIMIT = 2000;
const TEXT_HEAD_BYTES_LIMIT = 4096;
const TEXT_MIME_TYPE_WHITELIST = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "application/ld+json",
]);
const TEXT_EXTENSION_WHITELIST = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".log",
  ".json",
  ".jsonl",
  ".xml",
  ".yaml",
  ".yml",
  ".ini",
]);

export async function enrichDocumentInputAsset(
  asset: TaskInputAsset,
  tools: DocumentInputAssetTools = {},
): Promise<TaskInputAsset> {
  if (asset.kind !== "document") {
    return asset;
  }

  if (isPdfAsset(asset)) {
    return await (tools.enrichPdfAsset ?? enrichPdfInputAsset)(asset);
  }

  if (!(await shouldTreatAsTextDocument(asset))) {
    return asset;
  }

  const textPath = createDocumentTextPath(asset.localPath);
  const readWholeFile = tools.readWholeFile ?? readFile;
  const writeTextFile = tools.writeTextFile ?? writeFile;

  try {
    const text = await readUtf8Text(asset.localPath, readWholeFile);
    await writeTextFile(textPath, text, "utf8");

    return {
      ...asset,
      ingestionStatus: "ready",
      textExtraction: {
        status: "completed",
        textPath,
        textPreview: text.slice(0, TEXT_PREVIEW_LIMIT),
      },
    };
  } catch {
    return {
      ...asset,
      ingestionStatus: "ready",
      textExtraction: {
        status: "failed",
      },
    };
  }
}

function isPdfAsset(asset: TaskInputAsset): boolean {
  const mimeType = normalizeMimeType(asset.mimeType);
  return mimeType === "application/pdf" || asset.localPath.toLowerCase().endsWith(".pdf");
}

async function shouldTreatAsTextDocument(asset: TaskInputAsset): Promise<boolean> {
  const mimeType = normalizeMimeType(asset.mimeType);

  if (TEXT_MIME_TYPE_WHITELIST.has(mimeType)) {
    return true;
  }

  const extension = extname(asset.localPath).toLowerCase();
  if (TEXT_EXTENSION_WHITELIST.has(extension)) {
    return true;
  }

  return await looksLikeUtf8Text(asset.localPath);
}

function normalizeMimeType(mimeType: string | undefined): string {
  const baseMimeType = mimeType?.split(";", 1).at(0);
  return baseMimeType?.trim().toLowerCase() ?? "";
}

async function looksLikeUtf8Text(filePath: string): Promise<boolean> {
  try {
    const head = await readHeadBytes(filePath, TEXT_HEAD_BYTES_LIMIT);
    return isLikelyUtf8Text(head);
  } catch {
    return false;
  }
}

async function readHeadBytes(filePath: string, limit: number): Promise<Uint8Array> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function isLikelyUtf8Text(buffer: Uint8Array): boolean {
  if (buffer.length === 0) {
    return true;
  }

  if (buffer.includes(0)) {
    return false;
  }

  let suspiciousBytes = 0;

  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13) {
      continue;
    }

    if (byte < 32 || byte === 127) {
      suspiciousBytes += 1;
      continue;
    }
  }

  if (suspiciousBytes > Math.max(8, Math.floor(buffer.length * 0.1))) {
    return false;
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

async function readUtf8Text(
  filePath: string,
  readWholeFile: (filePath: string) => Promise<Uint8Array> = readFile,
): Promise<string> {
  const buffer = await readWholeFile(filePath);
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

function createDocumentTextPath(filePath: string): string {
  return join(dirname(filePath), `${basename(filePath)}.themis.txt`);
}
