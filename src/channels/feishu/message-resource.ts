import { mkdirSync } from "node:fs";
import type { Readable } from "node:stream";
import { resolve } from "node:path";
import type { FeishuAttachmentDraft } from "./attachment-draft-store.js";

export interface FeishuMessageResourceEvent {
  message?: {
    message_type?: unknown;
    message_id?: unknown;
    create_time?: unknown;
    content?: unknown;
  };
}

export interface FeishuMessageResourceReference {
  id: string;
  type: "image" | "file";
  resourceKey: string;
  name?: string;
  sourceMessageId: string;
  createdAt: string;
}

interface FeishuMessageResourceResponse {
  writeFile: (filePath: string) => Promise<unknown>;
  getReadableStream: () => Readable;
  headers: unknown;
}

export interface FeishuMessageResourceClient {
  im: {
    v1: {
      messageResource: {
        get: (payload?: {
          params: {
            type: string;
          };
          path: {
            message_id: string;
            file_key: string;
          };
        }) => Promise<FeishuMessageResourceResponse>;
      };
    };
  };
}

export interface DownloadFeishuMessageResourcesOptions {
  client: FeishuMessageResourceClient;
  resources: FeishuMessageResourceReference[];
  targetDirectory: string;
}

export function extractFeishuMessageResources(event: FeishuMessageResourceEvent): FeishuMessageResourceReference[] | null {
  const messageType = normalizeText(event.message?.message_type);
  const messageId = normalizeText(event.message?.message_id);
  const createdAt = parseCreatedAt(event.message?.create_time);
  const rawContent = normalizeText(event.message?.content);

  if (!messageType || !messageId || !createdAt || !rawContent) {
    return null;
  }

  if (messageType !== "image" && messageType !== "file") {
    return null;
  }

  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>;
    const resourceKey = normalizeText(messageType === "image" ? parsed.image_key : parsed.file_key);

    if (!resourceKey) {
      return null;
    }

    const name = messageType === "file" ? normalizeText(parsed.file_name) ?? undefined : undefined;

    return [{
      id: `${messageId}::${resourceKey}`,
      type: messageType,
      resourceKey,
      ...(name ? { name } : {}),
      sourceMessageId: messageId,
      createdAt,
    }];
  } catch {
    return null;
  }
}

export async function downloadFeishuMessageResources(
  options: DownloadFeishuMessageResourcesOptions,
): Promise<FeishuAttachmentDraft[]> {
  mkdirSync(options.targetDirectory, { recursive: true });

  const attachments: FeishuAttachmentDraft[] = [];

  for (const resource of options.resources) {
    const response = await options.client.im.v1.messageResource.get({
      params: {
        type: resource.type,
      },
      path: {
        message_id: resource.sourceMessageId,
        file_key: resource.resourceKey,
      },
    });
    const fileName = resolveResourceName(resource, response.headers);
    const filePath = resolve(options.targetDirectory, `${sanitizeSegment(resource.id)}-${sanitizeFileName(fileName)}`);

    await response.writeFile(filePath);
    attachments.push({
      id: resource.id,
      type: resource.type,
      ...(fileName ? { name: fileName } : {}),
      value: filePath,
      sourceMessageId: resource.sourceMessageId,
      createdAt: resource.createdAt,
    });
  }

  return attachments;
}

function resolveResourceName(resource: FeishuMessageResourceReference, headers: unknown): string {
  const explicitName = normalizeText(resource.name);
  if (explicitName) {
    return explicitName;
  }

  const headerName = extractFilenameFromHeaders(headers);
  if (headerName) {
    return headerName;
  }

  return buildFallbackName(resource, headers);
}

function buildFallbackName(resource: FeishuMessageResourceReference, headers: unknown): string {
  const extension = inferExtension(headers, resource.type);
  return `${resource.type}-${sanitizeSegment(resource.sourceMessageId)}-${sanitizeSegment(resource.resourceKey)}${extension}`;
}

function inferExtension(headers: unknown, resourceType: FeishuMessageResourceReference["type"]): string {
  const contentType = readHeader(headers, "content-type")?.toLowerCase();

  switch (contentType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    default:
      return resourceType === "image" ? ".bin" : "";
  }
}

function extractFilenameFromHeaders(headers: unknown): string | null {
  const contentDisposition = readHeader(headers, "content-disposition");
  if (!contentDisposition) {
    return null;
  }

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return normalizeText(decodeURIComponent(encodedMatch[1])) ?? null;
    } catch {
      return normalizeText(encodedMatch[1]) ?? null;
    }
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return normalizeText(plainMatch?.[1]) ?? null;
}

function readHeader(headers: unknown, headerName: string): string | null {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  const record = headers as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== headerName) {
      continue;
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && item.trim());
      if (typeof first === "string") {
        return first.trim();
      }
    }
  }

  return null;
}

function parseCreatedAt(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return new Date(numeric).toISOString();
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "resource";
}

function sanitizeFileName(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return normalized || "resource";
}
