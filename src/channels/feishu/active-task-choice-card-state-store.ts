import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { FeishuPostContentItem } from "./message-content.js";
import type { FeishuMessageResourceReference } from "./message-resource.js";

export type FeishuActiveTaskChoiceCardRecordStatus = "pending" | "interrupted" | "queued" | "cancelled" | "failed";

export interface FeishuActiveTaskChoiceCardRecord {
  cardKey: string;
  chatId: string;
  messageId: string;
  sessionId: string;
  originalMessageId: string;
  userId: string;
  text: string;
  attachments?: FeishuMessageResourceReference[];
  postContentItems?: FeishuPostContentItem[];
  status: FeishuActiveTaskChoiceCardRecordStatus;
  callbackToken?: string;
  openMessageId?: string;
  actorUserId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

interface FeishuActiveTaskChoiceCardStoreData {
  version: 1;
  cards: FeishuActiveTaskChoiceCardRecord[];
}

export interface FeishuActiveTaskChoiceCardStateStoreOptions {
  filePath?: string;
}

const DEFAULT_FILE_PATH = resolve(process.cwd(), "infra/local/feishu-active-task-choice-cards.json");
const EMPTY_STORE: FeishuActiveTaskChoiceCardStoreData = {
  version: 1,
  cards: [],
};

export class FeishuActiveTaskChoiceCardStateStore {
  private readonly filePath: string;

  constructor(options: FeishuActiveTaskChoiceCardStateStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  get(cardKey: string): FeishuActiveTaskChoiceCardRecord | null {
    const normalizedCardKey = normalizeRequiredText(cardKey);

    if (!normalizedCardKey) {
      return null;
    }

    const store = this.readStore();
    const record = store.cards.find((entry) => entry.cardKey === normalizedCardKey);
    return record ? cloneRecord(record) : null;
  }

  save(record: FeishuActiveTaskChoiceCardRecord): FeishuActiveTaskChoiceCardRecord {
    const normalized = normalizeRecord(record);
    const store = this.readStore();
    const index = store.cards.findIndex((entry) => entry.cardKey === normalized.cardKey);

    if (index >= 0) {
      store.cards[index] = normalized;
    } else {
      store.cards.push(normalized);
    }

    store.cards.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.writeStore(store);
    return cloneRecord(normalized);
  }

  readSnapshot(): FeishuActiveTaskChoiceCardRecord[] {
    return this.readStore().cards.map(cloneRecord);
  }

  private readStore(): FeishuActiveTaskChoiceCardStoreData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FeishuActiveTaskChoiceCardStoreData> | null;

      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.cards)) {
        return cloneEmptyStore();
      }

      return {
        version: 1,
        cards: parsed.cards.map(normalizeRecord),
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return cloneEmptyStore();
      }

      return cloneEmptyStore();
    }
  }

  private writeStore(store: FeishuActiveTaskChoiceCardStoreData): void {
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

function normalizeRecord(record: FeishuActiveTaskChoiceCardRecord): FeishuActiveTaskChoiceCardRecord {
  const callbackToken = normalizeOptionalText(record.callbackToken);
  const openMessageId = normalizeOptionalText(record.openMessageId);
  const actorUserId = normalizeOptionalText(record.actorUserId);
  const lastError = normalizeOptionalText(record.lastError);
  const resolvedAt = normalizeOptionalText(record.resolvedAt);
  const attachments = normalizeAttachments(record.attachments);
  const postContentItems = normalizePostContentItems(record.postContentItems);

  return {
    cardKey: normalizeRequiredText(record.cardKey, "运行中选择卡缺少 cardKey。"),
    chatId: normalizeRequiredText(record.chatId, "运行中选择卡缺少 chatId。"),
    messageId: normalizeRequiredText(record.messageId, "运行中选择卡缺少 messageId。"),
    sessionId: normalizeRequiredText(record.sessionId, "运行中选择卡缺少 sessionId。"),
    originalMessageId: normalizeRequiredText(record.originalMessageId, "运行中选择卡缺少 originalMessageId。"),
    userId: normalizeRequiredText(record.userId, "运行中选择卡缺少 userId。"),
    text: normalizeRequiredText(record.text, "运行中选择卡缺少 text。"),
    ...(attachments.length ? { attachments } : {}),
    ...(postContentItems.length ? { postContentItems } : {}),
    status: normalizeStatus(record.status),
    ...(callbackToken ? { callbackToken } : {}),
    ...(openMessageId ? { openMessageId } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...(lastError ? { lastError } : {}),
    createdAt: normalizeTimestamp(record.createdAt),
    updatedAt: normalizeTimestamp(record.updatedAt),
    ...(resolvedAt ? { resolvedAt: normalizeTimestamp(resolvedAt) } : {}),
  };
}

function normalizeStatus(status: FeishuActiveTaskChoiceCardRecordStatus): FeishuActiveTaskChoiceCardRecordStatus {
  return status === "interrupted" || status === "queued" || status === "cancelled" || status === "failed"
    ? status
    : "pending";
}

function normalizeAttachments(value: FeishuMessageResourceReference[] | null | undefined): FeishuMessageResourceReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): FeishuMessageResourceReference[] => {
    const id = normalizeOptionalText(item.id);
    const type = item.type === "image" || item.type === "file" ? item.type : null;
    const resourceKey = normalizeOptionalText(item.resourceKey);
    const sourceMessageId = normalizeOptionalText(item.sourceMessageId);
    const createdAt = normalizeOptionalText(item.createdAt);
    const name = normalizeOptionalText(item.name);

    if (!id || !type || !resourceKey || !sourceMessageId || !createdAt) {
      return [];
    }

    return [{
      id,
      type,
      resourceKey,
      sourceMessageId,
      createdAt,
      ...(name ? { name } : {}),
    }];
  });
}

function normalizePostContentItems(value: FeishuPostContentItem[] | null | undefined): FeishuPostContentItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): FeishuPostContentItem[] => {
    if (item.type === "text") {
      const text = normalizeOptionalText(item.text);
      return text ? [{ type: "text" as const, text }] : [];
    }

    if (item.type === "image") {
      const imageKey = normalizeOptionalText(item.imageKey);
      return imageKey ? [{ type: "image" as const, imageKey }] : [];
    }

    return [];
  });
}

function normalizeRequiredText(value: string, message = "运行中选择卡状态缺少必要字段。"): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    throw new Error("运行中选择卡状态包含非法时间字段。");
  }

  return new Date(parsed).toISOString();
}

function cloneRecord(record: FeishuActiveTaskChoiceCardRecord): FeishuActiveTaskChoiceCardRecord {
  return {
    ...record,
    ...(record.attachments ? { attachments: record.attachments.map((item) => ({ ...item })) } : {}),
    ...(record.postContentItems ? { postContentItems: record.postContentItems.map((item) => ({ ...item })) } : {}),
  };
}

function cloneEmptyStore(): FeishuActiveTaskChoiceCardStoreData {
  return {
    version: 1,
    cards: [],
  };
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "ENOENT";
}
