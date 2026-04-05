import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type FeishuChatRoutePolicy = "smart" | "always";
export type FeishuChatSessionScope = "personal" | "shared";

export interface FeishuChatSettings {
  chatId: string;
  chatType: string;
  routePolicy: FeishuChatRoutePolicy;
  sessionScope: FeishuChatSessionScope;
  adminUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FeishuRouteLease {
  key: string;
  chatId: string;
  routeKey: string;
  lastAcceptedAt: string;
  updatedAt: string;
}

interface FeishuChatSettingsStoreData {
  version: 1;
  chats: FeishuChatSettings[];
  recentRoutes: FeishuRouteLease[];
}

export interface FeishuChatSettingsStoreOptions {
  filePath?: string;
  routeLeaseTtlMs?: number;
  maxRecentRoutes?: number;
}

const DEFAULT_FILE_PATH = resolve(process.cwd(), "infra/local/feishu-chat-settings.json");
const DEFAULT_ROUTE_LEASE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_RECENT_ROUTES = 200;

const EMPTY_STORE: FeishuChatSettingsStoreData = {
  version: 1,
  chats: [],
  recentRoutes: [],
};

export class FeishuChatSettingsStore {
  private readonly filePath: string;
  private readonly routeLeaseTtlMs: number;
  private readonly maxRecentRoutes: number;

  constructor(options: FeishuChatSettingsStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    this.routeLeaseTtlMs = normalizePositiveInteger(options.routeLeaseTtlMs, DEFAULT_ROUTE_LEASE_TTL_MS);
    this.maxRecentRoutes = normalizePositiveInteger(options.maxRecentRoutes, DEFAULT_MAX_RECENT_ROUTES);
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  getChatSettings(input: {
    chatId: string;
    chatType?: string | null;
  }): FeishuChatSettings {
    const chatId = normalizeRequiredText(input.chatId);

    if (!chatId) {
      throw new Error("飞书群设置缺少 chatId。");
    }

    const store = this.readStore();
    const existing = store.chats.find((entry) => entry.chatId === chatId);

    if (existing) {
      return cloneChatSettings(existing);
    }

    return createDefaultChatSettings(chatId, input.chatType);
  }

  saveChatSettings(settings: FeishuChatSettings): FeishuChatSettings {
    const normalized = normalizeChatSettings(settings);
    const store = this.readStore();
    const index = store.chats.findIndex((entry) => entry.chatId === normalized.chatId);

    if (index >= 0) {
      store.chats[index] = normalized;
    } else {
      store.chats.push(normalized);
    }

    store.chats.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.writeStore(store);
    return cloneChatSettings(normalized);
  }

  hasRecentRoute(input: {
    chatId: string;
    routeKey: string;
    currentTimeMs?: number;
  }): boolean {
    const store = this.readStore();
    const currentTimeMs = typeof input.currentTimeMs === "number" && Number.isFinite(input.currentTimeMs)
      ? input.currentTimeMs
      : Date.now();
    const normalized = this.pruneExpiredRoutes(store, currentTimeMs);
    const key = createRouteLeaseKey(input.chatId, input.routeKey);

    if (normalized.changed) {
      this.writeStore(normalized.store);
    }

    return normalized.store.recentRoutes.some((entry) => entry.key === key);
  }

  noteRecentRoute(input: {
    chatId: string;
    routeKey: string;
    acceptedAt?: string;
  }): void {
    const chatId = normalizeRequiredText(input.chatId);
    const routeKey = normalizeRequiredText(input.routeKey);

    if (!chatId || !routeKey) {
      return;
    }

    const acceptedAt = normalizeOptionalText(input.acceptedAt) ?? new Date().toISOString();
    const store = this.readStore();
    const normalized = this.pruneExpiredRoutes(store, Date.now());
    const key = createRouteLeaseKey(chatId, routeKey);
    const index = normalized.store.recentRoutes.findIndex((entry) => entry.key === key);
    const record: FeishuRouteLease = {
      key,
      chatId,
      routeKey,
      lastAcceptedAt: acceptedAt,
      updatedAt: acceptedAt,
    };

    if (index >= 0) {
      normalized.store.recentRoutes[index] = record;
    } else {
      normalized.store.recentRoutes.push(record);
    }

    normalized.store.recentRoutes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    if (normalized.store.recentRoutes.length > this.maxRecentRoutes) {
      normalized.store.recentRoutes.splice(this.maxRecentRoutes);
    }

    this.writeStore(normalized.store);
  }

  private pruneExpiredRoutes(
    store: FeishuChatSettingsStoreData,
    currentTimeMs: number,
  ): {
    changed: boolean;
    store: FeishuChatSettingsStoreData;
  } {
    const nextRoutes = store.recentRoutes.filter((entry) => {
      const acceptedAtMs = Date.parse(entry.lastAcceptedAt);
      return Number.isFinite(acceptedAtMs) && currentTimeMs - acceptedAtMs < this.routeLeaseTtlMs;
    });

    if (nextRoutes.length === store.recentRoutes.length) {
      return {
        changed: false,
        store,
      };
    }

    return {
      changed: true,
      store: {
        ...store,
        recentRoutes: nextRoutes,
      },
    };
  }

  private readStore(): FeishuChatSettingsStoreData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FeishuChatSettingsStoreData> | null;

      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.chats) || !Array.isArray(parsed.recentRoutes)) {
        return cloneEmptyStore();
      }

      return {
        version: 1,
        chats: parsed.chats.map(normalizeChatSettings),
        recentRoutes: parsed.recentRoutes.map(normalizeRouteLease),
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return cloneEmptyStore();
      }

      return cloneEmptyStore();
    }
  }

  private writeStore(store: FeishuChatSettingsStoreData): void {
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

function createDefaultChatSettings(chatId: string, chatType?: string | null): FeishuChatSettings {
  const normalizedChatType = normalizeOptionalText(chatType) ?? "p2p";
  const now = new Date().toISOString();

  return {
    chatId,
    chatType: normalizedChatType,
    routePolicy: normalizedChatType === "group" ? "smart" : "always",
    sessionScope: "personal",
    adminUserIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeChatSettings(value: FeishuChatSettings): FeishuChatSettings {
  const chatId = normalizeRequiredText(value.chatId);
  const chatType = normalizeOptionalText(value.chatType) ?? "p2p";
  const routePolicy = normalizeRoutePolicy(value.routePolicy, chatType);
  const sessionScope = normalizeSessionScope(value.sessionScope);
  const createdAt = normalizeOptionalText(value.createdAt) ?? new Date().toISOString();
  const updatedAt = normalizeOptionalText(value.updatedAt) ?? createdAt;
  const adminUserIds = dedupeUserIds(value.adminUserIds);

  if (!chatId) {
    throw new Error("飞书群设置缺少 chatId。");
  }

  return {
    chatId,
    chatType,
    routePolicy,
    sessionScope,
    adminUserIds,
    createdAt,
    updatedAt,
  };
}

function normalizeRouteLease(value: FeishuRouteLease): FeishuRouteLease {
  const chatId = normalizeRequiredText(value.chatId);
  const routeKey = normalizeRequiredText(value.routeKey);
  const lastAcceptedAt = normalizeOptionalText(value.lastAcceptedAt) ?? new Date().toISOString();
  const updatedAt = normalizeOptionalText(value.updatedAt) ?? lastAcceptedAt;

  if (!chatId || !routeKey) {
    throw new Error("飞书群路由租约缺少必要字段。");
  }

  return {
    key: createRouteLeaseKey(chatId, routeKey),
    chatId,
    routeKey,
    lastAcceptedAt,
    updatedAt,
  };
}

function createRouteLeaseKey(chatId: string, routeKey: string): string {
  return `${chatId.trim()}::${routeKey.trim()}`;
}

function dedupeUserIds(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const normalized = normalizeOptionalText(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function normalizeRoutePolicy(value: unknown, chatType: string): FeishuChatRoutePolicy {
  const normalized = normalizeOptionalText(value)?.toLowerCase();

  if (normalized === "always") {
    return "always";
  }

  if (normalized === "smart") {
    return "smart";
  }

  return chatType === "group" ? "smart" : "always";
}

function normalizeSessionScope(value: unknown): FeishuChatSessionScope {
  const normalized = normalizeOptionalText(value)?.toLowerCase();

  if (normalized === "shared") {
    return "shared";
  }

  return "personal";
}

function cloneChatSettings(value: FeishuChatSettings): FeishuChatSettings {
  return {
    ...value,
    adminUserIds: [...value.adminUserIds],
  };
}

function cloneEmptyStore(): FeishuChatSettingsStoreData {
  return {
    version: 1,
    chats: [],
    recentRoutes: [],
  };
}

function normalizeRequiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /ENOENT/i.test(error.message);
}
