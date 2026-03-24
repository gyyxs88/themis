import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface FeishuConversationBinding {
  key: string;
  chatId: string;
  userId: string;
  activeSessionId: string;
  updatedAt: string;
}

interface FeishuSessionStoreData {
  version: 1;
  bindings: FeishuConversationBinding[];
}

export interface FeishuConversationKey {
  chatId: string;
  userId: string;
}

export interface FeishuSessionStoreOptions {
  filePath?: string;
}

const EMPTY_STORE: FeishuSessionStoreData = {
  version: 1,
  bindings: [],
};

export class FeishuSessionStore {
  private readonly filePath: string;

  constructor(options: FeishuSessionStoreOptions = {}) {
    this.filePath = options.filePath ?? resolve(process.cwd(), "infra/local/feishu-sessions.json");
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  getActiveSessionId(key: FeishuConversationKey): string | null {
    const normalizedKey = createBindingKey(key);

    if (!normalizedKey) {
      return null;
    }

    const store = this.readStore();
    const binding = store.bindings.find((entry) => entry.key === normalizedKey);
    const sessionId = binding?.activeSessionId.trim();

    return sessionId ? sessionId : null;
  }

  ensureActiveSessionId(key: FeishuConversationKey): string {
    const existing = this.getActiveSessionId(key);

    if (existing) {
      return existing;
    }

    const sessionId = createSessionId();
    this.setActiveSessionId(key, sessionId);
    return sessionId;
  }

  createAndActivateSession(key: FeishuConversationKey): string {
    const sessionId = createSessionId();
    this.setActiveSessionId(key, sessionId);
    return sessionId;
  }

  setActiveSessionId(key: FeishuConversationKey, sessionId: string): void {
    const normalizedKey = createBindingKey(key);
    const normalizedSessionId = sessionId.trim();

    if (!normalizedKey || !normalizedSessionId) {
      throw new Error("Feishu 会话映射缺少必要字段。");
    }

    const store = this.readStore();
    const now = new Date().toISOString();
    const existing = store.bindings.find((entry) => entry.key === normalizedKey);

    if (existing) {
      existing.activeSessionId = normalizedSessionId;
      existing.updatedAt = now;
    } else {
      store.bindings.push({
        key: normalizedKey,
        chatId: key.chatId.trim(),
        userId: key.userId.trim(),
        activeSessionId: normalizedSessionId,
        updatedAt: now,
      });
    }

    store.bindings.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.writeStore(store);
  }

  private readStore(): FeishuSessionStoreData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FeishuSessionStoreData> | null;

      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.bindings)) {
        return { ...EMPTY_STORE, bindings: [] };
      }

      return {
        version: 1,
        bindings: parsed.bindings
          .map(normalizeBinding)
          .filter((entry): entry is FeishuConversationBinding => entry !== null),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (/ENOENT/i.test(message)) {
        return { ...EMPTY_STORE, bindings: [] };
      }

      return { ...EMPTY_STORE, bindings: [] };
    }
  }

  private writeStore(store: FeishuSessionStoreData): void {
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

function normalizeBinding(value: unknown): FeishuConversationBinding | null {
  if (!isRecord(value)) {
    return null;
  }

  const chatId = normalizeText(value.chatId);
  const userId = normalizeText(value.userId);
  const activeSessionId = normalizeText(value.activeSessionId);
  const updatedAt = normalizeText(value.updatedAt) ?? new Date().toISOString();

  if (!chatId || !userId || !activeSessionId) {
    return null;
  }

  return {
    key: createBindingKey({ chatId, userId }),
    chatId,
    userId,
    activeSessionId,
    updatedAt,
  };
}

function createBindingKey(key: FeishuConversationKey): string {
  const chatId = key.chatId.trim();
  const userId = key.userId.trim();

  if (!chatId || !userId) {
    return "";
  }

  return `${chatId}::${userId}`;
}

function createSessionId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `feishu-${Date.now()}-${randomPart}`;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
