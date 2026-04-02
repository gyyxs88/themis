import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { enrichDocumentInputAsset } from "../core/document-input-asset.js";
import type { TaskInputAsset } from "../types/index.js";
import { writeJson } from "./http-responses.js";

const MAX_INPUT_ASSET_BYTES = 25 * 1024 * 1024;

export async function handleInputAssetUpload(
  request: Request,
  options: {
    workingDirectory: string;
    enrichDocumentAsset?: (asset: TaskInputAsset) => Promise<TaskInputAsset>;
  },
): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return Response.json({
      error: "上传缺少 file 字段。",
    }, {
      status: 400,
    });
  }

  const assetId = createId("asset");
  const safeName = basename(file.name || "upload.bin");
  const isPdf = isPdfUpload(file.type, safeName);
  const assetMimeType = isPdf ? "application/pdf" : (file.type || "application/octet-stream");

  if (!Number.isFinite(file.size) || file.size > MAX_INPUT_ASSET_BYTES) {
    return Response.json({
      error: "上传文件超过 25MB 限制，请压缩后再试。",
    }, {
      status: 413,
    });
  }

  const targetDirectory = join(options.workingDirectory, "temp", "input-assets", assetId);
  await mkdir(targetDirectory, { recursive: true });
  const localPath = join(targetDirectory, safeName);
  await pipeline(
    Readable.fromWeb(file.stream() as any),
    createWriteStream(localPath),
  );

  const asset: TaskInputAsset = {
    assetId,
    kind: resolveAssetKind(assetMimeType),
    name: safeName,
    mimeType: assetMimeType,
    sizeBytes: file.size,
    localPath,
    sourceChannel: "web",
    ingestionStatus: "ready",
  };

  const enrichedAsset = asset.kind === "document"
    ? await (options.enrichDocumentAsset ?? enrichDocumentInputAsset)(asset)
    : asset;

  return Response.json({ asset: enrichedAsset });
}

export async function handleInputAssetUploadHttp(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    workingDirectory: string;
    enrichDocumentAsset?: (asset: TaskInputAsset) => Promise<TaskInputAsset>;
  },
): Promise<void> {
  if (isContentLengthTooLarge(request.headers)) {
    writeJson(response, 413, {
      error: "上传文件超过 25MB 限制，请压缩后再试。",
    });
    return;
  }

  const webRequest = new Request(`http://localhost${request.url ?? "/api/input-assets"}`, {
    method: request.method ?? "POST",
    headers: request.headers as HeadersInit,
    body: Readable.toWeb(request) as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const webResponse = await handleInputAssetUpload(webRequest, options);
  const payload = await webResponse.json();
  writeJson(response, webResponse.status, payload);
}

function resolveAssetKind(mimeType: string): TaskInputAsset["kind"] {
  return mimeType.startsWith("image/") ? "image" : "document";
}

function isPdfUpload(mimeType: string, fileName: string): boolean {
  const normalizedMimeType = mimeType.toLowerCase();
  const normalizedFileName = fileName.toLowerCase();

  return normalizedMimeType === "application/pdf" || normalizedFileName.endsWith(".pdf");
}

function isContentLengthTooLarge(headers: IncomingMessage["headers"]): boolean {
  const contentLength = resolveContentLength(headers["content-length"]);

  return contentLength !== null && contentLength > MAX_INPUT_ASSET_BYTES;
}

function resolveContentLength(value: string | string[] | number | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const token = Array.isArray(value) ? value[0] : value;

  if (typeof token !== "string") {
    return null;
  }

  const parsed = Number(token);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
