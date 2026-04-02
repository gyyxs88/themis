import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import type { TaskInputAsset } from "../types/index.js";

export interface PdfInputAssetTools {
  readPdfInfo(pdfPath: string): Promise<{ pageCount?: number }>;
  extractPdfText(pdfPath: string, textPath: string): Promise<void>;
}

const TEXT_PREVIEW_LIMIT = 2000;

export async function enrichPdfInputAsset(
  asset: TaskInputAsset,
  tools: PdfInputAssetTools = createDefaultPdfInputAssetTools(),
): Promise<TaskInputAsset> {
  const sourceExists = existsSync(asset.localPath);
  const textPath = createPdfTextPath(asset.localPath);
  let pageCount: number | undefined;

  try {
    const info = await tools.readPdfInfo(asset.localPath);

    if (typeof info.pageCount === "number" && Number.isFinite(info.pageCount) && info.pageCount > 0) {
      pageCount = Math.trunc(info.pageCount);
    }
  } catch {
    // pdfinfo 失败不阻塞文本提取
  }

  try {
    await tools.extractPdfText(asset.localPath, textPath);

    const text = await readFile(textPath, "utf8");
    const metadata = mergeMetadata(asset.metadata, pageCount);

    return {
      ...asset,
      ingestionStatus: "ready",
      ...(metadata ? { metadata } : {}),
      textExtraction: {
        status: "completed",
        textPath,
        textPreview: text.slice(0, TEXT_PREVIEW_LIMIT),
      },
    };
  } catch {
    const metadata = mergeMetadata(asset.metadata, pageCount);
    const ingestionStatus = sourceExists ? "ready" : "failed";

    return {
      ...asset,
      ingestionStatus,
      ...(metadata ? { metadata } : {}),
      textExtraction: {
        status: "failed",
      },
    };
  }
}

function createDefaultPdfInputAssetTools(): PdfInputAssetTools {
  return {
    readPdfInfo: async (pdfPath: string) => {
      const { stdout } = await runCommand("pdfinfo", [pdfPath]);
      const match = stdout.match(/^\s*Pages:\s*(\d+)\s*$/m);
      const pageCount = match ? Number(match[1]) : undefined;

      return Number.isFinite(pageCount) && typeof pageCount === "number" && pageCount > 0
        ? { pageCount }
        : {};
    },
    extractPdfText: async (pdfPath: string, textPath: string) => {
      await runCommand("pdftotext", [pdfPath, textPath]);
    },
  };
}

function createPdfTextPath(pdfPath: string): string {
  const directory = dirname(pdfPath);
  const pdfBaseName = basename(pdfPath, extname(pdfPath)) || "asset";

  return join(directory, `${pdfBaseName}.txt`);
}

async function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`Command failed: ${command} ${args.join(" ")}${signal ? ` (signal ${signal})` : ""}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

function mergeMetadata(
  metadata: TaskInputAsset["metadata"] | undefined,
  pageCount: number | undefined,
): TaskInputAsset["metadata"] | undefined {
  const nextMetadata = metadata ? { ...metadata } : {};

  if (typeof pageCount === "number") {
    nextMetadata.pageCount = pageCount;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}
