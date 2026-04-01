import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { TaskInputAsset } from "../types/index.js";
import { writeJson } from "./http-responses.js";

const MAX_INPUT_ASSET_BYTES = 25 * 1024 * 1024;

export async function handleInputAssetUpload(
  request: Request,
  options: {
    workingDirectory: string;
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

  if (isPdfUpload(file.type, safeName)) {
    return Response.json({
      error: "当前 Web 端暂不支持 PDF 上传，请先转成图片或文本后再试。",
    }, {
      status: 415,
    });
  }

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
    kind: resolveAssetKind(file.type),
    name: safeName,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    localPath,
    sourceChannel: "web",
    ingestionStatus: "ready",
  };

  return Response.json({ asset });
}

export async function handleInputAssetUploadHttp(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    workingDirectory: string;
  },
): Promise<void> {
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

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
