import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TaskInputAsset } from "../../types/index.js";
import type { TaskAttachmentType } from "../../types/task.js";

export interface FeishuAttachmentDraft {
  id: string;
  type: TaskAttachmentType;
  name?: string;
  value: string;
  sourceMessageId: string;
  createdAt: string;
}

export type FeishuAttachmentDraftPart =
  | {
      type: "text";
      role: "user";
      order: number;
      text: string;
    }
  | {
      type: "image" | "document";
      role: "user";
      order: number;
      assetId: string;
      caption?: string;
    };

export interface FeishuAttachmentDraftAsset extends TaskInputAsset {
  id: string;
  type: TaskAttachmentType;
  value: string;
  createdAt: string;
}

export interface FeishuAttachmentDraftKey {
  chatId: string;
  userId: string;
  sessionId: string;
}

export interface FeishuAttachmentDraftStoreOptions {
  filePath?: string;
  now?: () => string;
  ttlMs?: number;
}

interface FeishuAttachmentDraftStoreRecord {
  key: string;
  chatId: string;
  userId: string;
  sessionId: string;
  parts: FeishuAttachmentDraftPart[];
  assets: FeishuAttachmentDraftAsset[];
  attachments: FeishuAttachmentDraft[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface FeishuAttachmentDraftStoreData {
  version: 1;
  drafts: FeishuAttachmentDraftStoreRecord[];
}

export interface FeishuAttachmentDraftSnapshot {
  key: FeishuAttachmentDraftKey;
  parts: FeishuAttachmentDraftPart[];
  assets: FeishuAttachmentDraftAsset[];
  attachments: FeishuAttachmentDraft[];
}

const EMPTY_STORE: FeishuAttachmentDraftStoreData = {
  version: 1,
  drafts: [],
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export class FeishuAttachmentDraftStore {
  private readonly filePath: string;
  private readonly now: () => string;
  private readonly ttlMs: number;

  constructor(options: FeishuAttachmentDraftStoreOptions = {}) {
    this.filePath = options.filePath ?? resolve(process.cwd(), "infra/local/feishu-attachment-drafts.json");
    this.now = options.now ?? (() => new Date().toISOString());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  append(key: FeishuAttachmentDraftKey, attachments: FeishuAttachmentDraft[]): void;
  append(key: FeishuAttachmentDraftKey, input: {
    parts: FeishuAttachmentDraftPart[];
    assets: FeishuAttachmentDraftAsset[];
  }): void;
  append(
    key: FeishuAttachmentDraftKey,
    input: FeishuAttachmentDraft[] | {
      parts: FeishuAttachmentDraftPart[];
      assets: FeishuAttachmentDraftAsset[];
    },
  ): void {
    if (Array.isArray(input)) {
      this.appendEnvelope(key, {
        parts: buildDraftPartsFromLegacyAttachments(input),
        assets: buildDraftAssetsFromLegacyAttachments(input),
      });
      return;
    }

    this.appendEnvelope(key, input);
  }

  appendEnvelope(
    key: FeishuAttachmentDraftKey,
    input: {
      parts: FeishuAttachmentDraftPart[];
      assets: FeishuAttachmentDraftAsset[];
    },
  ): void {
    const normalizedKey = createDraftKey(key);
    if (!normalizedKey) {
      throw new Error("Feishu 会话映射缺少必要字段。");
    }

    if (input.parts.length === 0 || input.assets.length === 0) {
      throw new Error("Feishu 附件草稿不能为空。");
    }

    const validParts = input.parts.map(normalizeDraftPart);
    if (validParts.some((item) => item === null)) {
      throw new Error("Feishu 附件草稿包含无效 part。");
    }

    const normalizedParts = validParts.filter((item): item is FeishuAttachmentDraftPart => item !== null);
    if (!normalizedParts.length) {
      throw new Error("Feishu 附件草稿不包含可用 part。");
    }

    const validAssets = input.assets.map(normalizeDraftAsset);
    if (validAssets.some((item) => item === null)) {
      throw new Error("Feishu 附件草稿包含无效 asset。");
    }

    const normalizedAssets = validAssets.filter((item): item is FeishuAttachmentDraftAsset => item !== null);
    if (!normalizedAssets.length) {
      throw new Error("Feishu 附件草稿不包含可用 asset。");
    }

    const store = this.readStore();
    const now = this.now();
    cleanupExpiredDrafts(store, now);
    const record = store.drafts.find((entry) => entry.key === normalizedKey);
    const nowMs = parseTimestamp(now, Date.now());
    const refreshedAt = new Date(nowMs).toISOString();

    if (record) {
      record.parts.push(...normalizedParts);
      record.assets.push(...normalizedAssets);
      record.attachments = buildLegacyAttachmentsFromAssets(record.assets);
      record.updatedAt = refreshedAt;
      record.expiresAt = new Date(nowMs + this.ttlMs).toISOString();
    } else {
      store.drafts.push({
        key: normalizedKey,
        chatId: key.chatId.trim(),
        userId: key.userId.trim(),
        sessionId: key.sessionId.trim(),
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(nowMs + this.ttlMs).toISOString(),
        parts: normalizedParts,
        assets: normalizedAssets,
        attachments: buildLegacyAttachmentsFromAssets(normalizedAssets),
      });
    }

    this.writeStore(store);
  }

  get(key: FeishuAttachmentDraftKey): FeishuAttachmentDraftSnapshot | null {
    const normalizedKey = createDraftKey(key);
    if (!normalizedKey) {
      return null;
    }

    const store = this.readStore();
    const changed = cleanupExpiredDrafts(store, this.now());
    const record = store.drafts.find((entry) => entry.key === normalizedKey);

    if (changed) {
      this.writeStore(store);
    }

    if (!record) {
      return null;
    }

    return snapshotDraftRecord(record);
  }

  consume(key: FeishuAttachmentDraftKey): FeishuAttachmentDraftSnapshot | null {
    const normalizedKey = createDraftKey(key);
    if (!normalizedKey) {
      return null;
    }

    const store = this.readStore();
    const changed = cleanupExpiredDrafts(store, this.now());
    const index = store.drafts.findIndex((entry) => entry.key === normalizedKey);

    if (index === -1) {
      if (changed) {
        this.writeStore(store);
      }
      return null;
    }

    const [record] = store.drafts.splice(index, 1);
    if (!record) {
      return null;
    }

    if (record.parts.length === 0 || record.assets.length === 0) {
      this.writeStore(store);
      return null;
    }

    this.writeStore(store);
    return snapshotDraftRecord(record);
  }

  private readStore(): FeishuAttachmentDraftStoreData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FeishuAttachmentDraftStoreData> | null;

      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.drafts)) {
        return { ...EMPTY_STORE, drafts: [] };
      }

      const drafts = parsed.drafts
        .map((entry) => normalizeDraftRecord(entry, this.now(), this.ttlMs))
        .filter((record): record is FeishuAttachmentDraftStoreRecord => record !== null);

      return {
        version: 1,
        drafts,
      };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { ...EMPTY_STORE, drafts: [] };
      }

      throw error;
    }
  }

  private writeStore(store: FeishuAttachmentDraftStoreData): void {
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

function cleanupExpiredDrafts(store: FeishuAttachmentDraftStoreData, now: string): boolean {
  const nowMs = parseTimestamp(now, Date.now());

  const beforeLength = store.drafts.length;
  store.drafts = store.drafts
    .filter((record) => {
      const expiresAtMs = parseTimestamp(record.expiresAt, Number.NaN);
      if (Number.isNaN(expiresAtMs)) {
        return false;
      }

      return nowMs <= expiresAtMs;
    });

  const afterLength = store.drafts.length;
  return afterLength !== beforeLength;
}

function snapshotDraftRecord(record: FeishuAttachmentDraftStoreRecord): FeishuAttachmentDraftSnapshot {
  return {
    key: {
      chatId: record.chatId,
      userId: record.userId,
      sessionId: record.sessionId,
    },
    parts: [...record.parts],
    assets: [...record.assets],
    attachments: [...record.attachments],
  };
}

function buildDraftPartsFromLegacyAttachments(attachments: FeishuAttachmentDraft[]): FeishuAttachmentDraftPart[] {
  return attachments.map((attachment, order) => ({
    type: attachment.type === "image" ? "image" : "document",
    role: "user",
    order,
    assetId: attachment.id,
    ...(attachment.name ? { caption: attachment.name } : {}),
  }));
}

function buildDraftAssetsFromLegacyAttachments(attachments: FeishuAttachmentDraft[]): FeishuAttachmentDraftAsset[] {
  return attachments.map((attachment) => ({
    assetId: attachment.id,
    kind: attachment.type === "image" ? "image" : "document",
    ...(attachment.name ? { name: attachment.name } : {}),
    mimeType: inferMimeTypeFromLegacyAttachment(attachment),
    localPath: attachment.value,
    sourceChannel: "feishu",
    ...(attachment.sourceMessageId ? { sourceMessageId: attachment.sourceMessageId } : {}),
    ingestionStatus: "ready",
    id: attachment.id,
    type: attachment.type,
    value: attachment.value,
    createdAt: attachment.createdAt,
  }));
}

function buildLegacyAttachmentsFromAssets(assets: FeishuAttachmentDraftAsset[]): FeishuAttachmentDraft[] {
  return assets.map((asset) => ({
    id: asset.assetId,
    type: asset.kind === "image" ? "image" : "file",
    ...(asset.name ? { name: asset.name } : {}),
    value: asset.localPath,
    sourceMessageId: normalizeText(asset.sourceMessageId) ?? "",
    createdAt: normalizeText(asset.createdAt) ?? new Date().toISOString(),
  }));
}

function inferMimeTypeFromLegacyAttachment(attachment: FeishuAttachmentDraft): string {
  if (attachment.type === "image") {
    return inferMimeTypeFromPath(attachment.value, "image/png");
  }

  return inferMimeTypeFromPath(attachment.value, "application/octet-stream");
}

function inferMimeTypeFromPath(filePath: string, fallback: string): string {
  const lower = filePath.toLowerCase();

  if (lower.endsWith(".png")) {
    return "image/png";
  }

  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lower.endsWith(".webp")) {
    return "image/webp";
  }

  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }

  return fallback;
}

function normalizeAttachment(value: unknown): FeishuAttachmentDraft | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeText(value.id);
  const type = normalizeAttachmentType(value.type);
  const valueText = normalizeText(value.value);
  const sourceMessageId = normalizeText(value.sourceMessageId);
  const createdAt = normalizeText(value.createdAt);
  const name = normalizeText(value.name);

  if (!id || !type || !valueText || !sourceMessageId || !createdAt) {
    return null;
  }

  return {
    id,
    type,
    value: valueText,
    sourceMessageId,
    createdAt,
    ...(name ? { name } : {}),
  };
}

function normalizeDraftPart(value: unknown): FeishuAttachmentDraftPart | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = normalizeDraftPartType(value.type);
  const role = normalizeText(value.role);
  const order = normalizeOrder(value.order);
  const assetId = normalizeText(value.assetId);
  const text = normalizeText(value.text);
  const caption = normalizeText(value.caption);

  if (!type || role !== "user" || !Number.isFinite(order)) {
    return null;
  }

  if (type === "text") {
    if (!text) {
      return null;
    }

    return {
      type,
      role: "user",
      order,
      text,
    };
  }

  if (!assetId) {
    return null;
  }

  return {
    type,
    role: "user",
    order,
    assetId,
    ...(caption ? { caption } : {}),
  };
}

function normalizeDraftAsset(value: unknown): FeishuAttachmentDraftAsset | null {
  if (!isRecord(value)) {
    return null;
  }

  const assetId = normalizeText(value.assetId) ?? normalizeText(value.id);
  const kind = normalizeDraftAssetKind(value.kind ?? value.type);
  const name = normalizeText(value.name);
  const mimeType = normalizeText(value.mimeType);
  const localPath = normalizeText(value.localPath) ?? normalizeText(value.value);
  const sourceChannel = normalizeText(value.sourceChannel);
  const sourceMessageId = normalizeText(value.sourceMessageId);
  const ingestionStatus = normalizeIngestionStatus(value.ingestionStatus);
  const createdAt = normalizeText(value.createdAt);
  const textExtraction = isRecord(value.textExtraction) ? normalizeTextExtraction(value.textExtraction) : null;
  const metadata = isRecord(value.metadata) ? normalizeMetadata(value.metadata) : null;

  if (!assetId || !kind || !mimeType || !localPath || sourceChannel !== "feishu" || !ingestionStatus || !createdAt) {
    return null;
  }

  return {
    assetId,
    kind,
    ...(name ? { name } : {}),
    mimeType,
    localPath,
    sourceChannel: "feishu",
    ...(sourceMessageId ? { sourceMessageId } : {}),
    ingestionStatus,
    ...(textExtraction ? { textExtraction } : {}),
    ...(metadata ? { metadata } : {}),
    id: normalizeText(value.id) ?? assetId,
    type: normalizeDraftAttachmentType(value.type) ?? (kind === "image" ? "image" : "file"),
    value: localPath,
    createdAt,
  };
}

function normalizeDraftRecord(
  value: unknown,
  now: string,
  ttlMs: number,
): FeishuAttachmentDraftStoreRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const chatId = normalizeText(value.chatId);
  const userId = normalizeText(value.userId);
  const sessionId = normalizeText(value.sessionId);
  const createdAt = normalizeText(value.createdAt);
  const updatedAt = normalizeText(value.updatedAt);
  const expiresAt = normalizeText(value.expiresAt);
  const key = createDraftKey({ chatId: chatId ?? "", userId: userId ?? "", sessionId: sessionId ?? "" });
  const parts = normalizeDraftParts(value.parts);
  const assets = normalizeDraftAssets(value.assets);
  const attachments = normalizeLegacyAttachments(value.attachments);
  const normalizedParts = parts.length ? parts : (attachments.length ? buildDraftPartsFromLegacyAttachments(attachments) : []);
  const normalizedAssets = assets.length ? assets : (attachments.length ? buildDraftAssetsFromLegacyAttachments(attachments) : []);
  const fallbackCreatedAtMs = parseTimestamp(createdAt, parseTimestamp(now, Date.now()));
  const fallbackUpdatedAtMs = parseTimestamp(updatedAt, fallbackCreatedAtMs);
  const fallbackExpiresAtMs = parseTimestamp(expiresAt, fallbackUpdatedAtMs + ttlMs);

  if (!key || !chatId || !userId || !sessionId || normalizedParts.length === 0 || normalizedAssets.length === 0) {
    return null;
  }
  if (Number.isNaN(fallbackUpdatedAtMs) || Number.isNaN(fallbackCreatedAtMs) || Number.isNaN(fallbackExpiresAtMs)) {
    return null;
  }

  return {
    key,
    chatId,
    userId,
    sessionId,
    createdAt: new Date(fallbackCreatedAtMs).toISOString(),
    updatedAt: new Date(fallbackUpdatedAtMs).toISOString(),
    expiresAt: new Date(fallbackExpiresAtMs).toISOString(),
    parts: normalizedParts,
    assets: normalizedAssets,
    attachments: attachments.length ? attachments : buildLegacyAttachmentsFromAssets(normalizedAssets),
  };
}

function normalizeDraftParts(value: unknown): FeishuAttachmentDraftPart[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeDraftPart).filter((item): item is FeishuAttachmentDraftPart => item !== null);
}

function normalizeDraftAssets(value: unknown): FeishuAttachmentDraftAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeDraftAsset).filter((item): item is FeishuAttachmentDraftAsset => item !== null);
}

function normalizeLegacyAttachments(value: unknown): FeishuAttachmentDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeAttachment).filter((item): item is FeishuAttachmentDraft => item !== null);
}

function normalizeDraftPartType(value: unknown): FeishuAttachmentDraftPart["type"] | null {
  const text = normalizeText(value);
  if (text === "text" || text === "image" || text === "document") {
    return text;
  }

  return null;
}

function normalizeDraftAssetKind(value: unknown): FeishuAttachmentDraftAsset["kind"] | null {
  const text = normalizeText(value);
  if (text === "image" || text === "document") {
    return text;
  }

  if (text === "file") {
    return "document";
  }

  return null;
}

function normalizeDraftAttachmentType(value: unknown): FeishuAttachmentDraft["type"] | null {
  const text = normalizeText(value);
  if (text === "image" || text === "file") {
    return text;
  }

  if (text === "document") {
    return "file";
  }

  return null;
}

function normalizeIngestionStatus(value: unknown): FeishuAttachmentDraftAsset["ingestionStatus"] | null {
  const text = normalizeText(value);
  if (text === "ready" || text === "processing" || text === "failed") {
    return text;
  }

  return null;
}

function normalizeTextExtraction(value: unknown): FeishuAttachmentDraftAsset["textExtraction"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = normalizeText(value.status);
  if (status !== "not_started" && status !== "completed" && status !== "failed") {
    return null;
  }

  const textPath = normalizeText(value.textPath);
  const textPreview = normalizeText(value.textPreview);

  return {
    status,
    ...(textPath ? { textPath } : {}),
    ...(textPreview ? { textPreview } : {}),
  };
}

function normalizeMetadata(value: unknown): FeishuAttachmentDraftAsset["metadata"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const languageHint = normalizeText(value.languageHint);

  return {
    ...(Number.isFinite(Number(value.width)) ? { width: Number(value.width) } : {}),
    ...(Number.isFinite(Number(value.height)) ? { height: Number(value.height) } : {}),
    ...(Number.isFinite(Number(value.pageCount)) ? { pageCount: Number(value.pageCount) } : {}),
    ...(languageHint ? { languageHint } : {}),
  };
}

function normalizeOrder(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function createDraftKey(key: FeishuAttachmentDraftKey): string {
  const chatId = key.chatId.trim();
  const userId = key.userId.trim();
  const sessionId = key.sessionId.trim();

  if (!chatId || !userId || !sessionId) {
    return "";
  }

  return `${chatId}::${userId}::${sessionId}`;
}

function normalizeAttachmentType(value: unknown): TaskAttachmentType | null {
  if (typeof value !== "string") {
    return null;
  }

  const item = value.trim();
  switch (item) {
    case "text":
      return "text";
    case "link":
      return "link";
    case "file":
      return "file";
    case "image":
      return "image";
    default:
      return null;
  }
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTimestamp(value: string | null | undefined, fallback: number): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
