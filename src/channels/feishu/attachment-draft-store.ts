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
    if (!normalizedKey || attachments.length === 0) {
      return;
    }

    const store = this.readStore();
    const record = store.drafts.find((entry) => entry.key === normalizedKey);
    const normalizedAttachments = attachments
      .map(normalizeAttachment)
      .filter((item): item is FeishuAttachmentDraft => item !== null);

    if (!normalizedAttachments.length) {
      return;
    }

    if (record) {
      record.attachments.push(...normalizedAttachments);
    } else {
      store.drafts.push({
        key: normalizedKey,
        chatId: key.chatId.trim(),
        userId: key.userId.trim(),
        sessionId: key.sessionId.trim(),
        attachments: normalizedAttachments,
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
    const changed = cleanupExpiredDrafts(store, this.now(), this.ttlMs);
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
    const changed = cleanupExpiredDrafts(store, this.now(), this.ttlMs);
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
        .map(normalizeDraftRecord)
        .filter((record): record is FeishuAttachmentDraftStoreRecord => record !== null);

      return {
        version: 1,
        drafts,
      };
    } catch (error) {
      if (error instanceof Error && /ENOENT/i.test(error.message)) {
        return { ...EMPTY_STORE, drafts: [] };
      }

      return { ...EMPTY_STORE, drafts: [] };
    }
  }

  private writeStore(store: FeishuAttachmentDraftStoreData): void {
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

function cleanupExpiredDrafts(
  store: FeishuAttachmentDraftStoreData,
  now: string,
  ttlMs: number,
): boolean {
  const nowMs = Number.isNaN(Date.parse(now)) ? Date.now() : Date.parse(now);

  const beforeLength = store.drafts.length;
  const beforeAttachmentCount = countAttachments(store.drafts);
  store.drafts = store.drafts
    .map((record) => {
      const nextAttachments = record.attachments.filter((attachment) => {
        const createdAtMs = Date.parse(attachment.createdAt);
        if (Number.isNaN(createdAtMs)) {
          return false;
        }
        return nowMs - createdAtMs <= ttlMs;
      });

      return {
        ...record,
        attachments: nextAttachments,
      };
    })
    .filter((record) => {
      return record.attachments.length > 0;
    });

  const afterLength = store.drafts.length;
  const afterAttachmentCount = countAttachments(store.drafts);

  return afterLength !== beforeLength || afterAttachmentCount !== beforeAttachmentCount;
}

function countAttachments(records: FeishuAttachmentDraftStoreRecord[]): number {
  return records.reduce((count, record) => count + record.attachments.length, 0);
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

function normalizeDraftRecord(value: unknown): FeishuAttachmentDraftStoreRecord | null {
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
  const key = createDraftKey({ chatId: chatId ?? "", userId: userId ?? "", sessionId: sessionId ?? "" });

  if (!key || !chatId || !userId || !sessionId || attachments.length === 0) {
    return null;
  }

  return {
    key,
    chatId,
    userId,
    sessionId,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
