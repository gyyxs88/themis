import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TaskAttachmentType } from "../../types/task.js";

export interface FeishuAttachmentDraft {
  id: string;
  type: TaskAttachmentType;
  name?: string;
  value: string;
  sourceMessageId: string;
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

  append(key: FeishuAttachmentDraftKey, attachments: FeishuAttachmentDraft[]): void {
    const normalizedKey = createDraftKey(key);
    if (!normalizedKey) {
      throw new Error("Feishu 会话映射缺少必要字段。");
    }

    if (attachments.length === 0) {
      throw new Error("Feishu 附件草稿不能为空。");
    }

    const normalizedAttachments = attachments.map(normalizeAttachment);
    if (normalizedAttachments.some((item) => item === null)) {
      throw new Error("Feishu 附件草稿包含无效附件。");
    }
    const validAttachments = normalizedAttachments.filter((item): item is FeishuAttachmentDraft => item !== null);
    if (!validAttachments.length) {
      throw new Error("Feishu 附件草稿不包含可用字段。");
    }

    const store = this.readStore();
    const now = this.now();
    cleanupExpiredDrafts(store, now);
    const record = store.drafts.find((entry) => entry.key === normalizedKey);

    const nowMs = parseTimestamp(now, Date.now());
    const refreshedAt = new Date(nowMs).toISOString();

    if (record) {
      record.attachments.push(...validAttachments);
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
        attachments: validAttachments,
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

    return {
      key: {
        chatId: record.chatId,
        userId: record.userId,
        sessionId: record.sessionId,
      },
      attachments: [...record.attachments],
    };
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

    if (record.attachments.length === 0) {
      this.writeStore(store);
      return null;
    }

    this.writeStore(store);
    return {
      key: {
        chatId: record.chatId,
        userId: record.userId,
        sessionId: record.sessionId,
      },
      attachments: [...record.attachments],
    };
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
  const rawAttachments = Array.isArray(value.attachments) ? value.attachments : [];
  const attachments = rawAttachments
    .map(normalizeAttachment)
    .filter((item): item is FeishuAttachmentDraft => item !== null);
  const createdAt = normalizeText(value.createdAt);
  const updatedAt = normalizeText(value.updatedAt);
  const expiresAt = normalizeText(value.expiresAt);
  const key = createDraftKey({ chatId: chatId ?? "", userId: userId ?? "", sessionId: sessionId ?? "" });
  const attachmentLatestCreatedAt = attachments.reduce<number | null>((max, item) => {
    const next = Date.parse(item.createdAt);
    if (Number.isNaN(next)) {
      return max;
    }
    return max === null || next > max ? next : max;
  }, null);
  const fallbackUpdatedAtMs = parseTimestamp(updatedAt, parseTimestamp(createdAt, attachmentLatestCreatedAt ?? parseTimestamp(now, Date.now())));
  const fallbackCreatedAtMs = parseTimestamp(createdAt, fallbackUpdatedAtMs);
  const fallbackExpiresAtMs = parseTimestamp(expiresAt, fallbackUpdatedAtMs + ttlMs);

  if (!key || !chatId || !userId || !sessionId || attachments.length === 0) {
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
    attachments,
  };
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
