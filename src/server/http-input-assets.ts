import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { Readable } from "node:stream";

import type { TaskInputAsset } from "../types/index.js";
import { writeJson } from "./http-responses.js";

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
  const targetDirectory = join(options.workingDirectory, "temp", "input-assets", assetId);
  await mkdir(targetDirectory, { recursive: true });
  const safeName = basename(file.name || "upload.bin");
  const localPath = join(targetDirectory, safeName);
  await writeFile(localPath, Buffer.from(await file.arrayBuffer()));

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

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
