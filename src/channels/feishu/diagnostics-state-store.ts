import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface FeishuDiagnosticsPendingAction {
  actionId: string;
  actionType: string;
  taskId: string;
  requestId: string;
  sourceChannel: string;
  sessionId: string;
  principalId: string;
}

export interface FeishuDiagnosticsConversation {
  key: string;
  chatId: string;
  userId: string;
  principalId: string;
  activeSessionId: string;
  lastMessageId?: string;
  lastEventType?: string;
  updatedAt: string;
  pendingActions: FeishuDiagnosticsPendingAction[];
}

export interface FeishuDiagnosticsEvent {
  id: string;
  type: string;
  chatId: string;
  userId: string;
  sessionId?: string;
  principalId?: string;
  messageId?: string;
  actionId?: string;
  requestId?: string;
  summary: string;
  createdAt: string;
}

export interface FeishuDiagnosticsStateSnapshot {
  path: string;
  status: "ok" | "missing" | "unreadable";
  conversations: FeishuDiagnosticsConversation[];
  recentEvents: FeishuDiagnosticsEvent[];
}

export interface FeishuDiagnosticsStateStoreOptions {
  filePath?: string;
  maxEvents?: number;
}

interface FeishuDiagnosticsStateStoreData {
  version: 1;
  conversations: FeishuDiagnosticsConversation[];
  recentEvents: FeishuDiagnosticsEvent[];
}

const DEFAULT_FILE_PATH = resolve(process.cwd(), "infra/local/feishu-diagnostics.json");
const DEFAULT_MAX_EVENTS = 50;
const EMPTY_STORE: FeishuDiagnosticsStateStoreData = {
  version: 1,
  conversations: [],
  recentEvents: [],
};

export class FeishuDiagnosticsStateStore {
  private readonly filePath: string;
  private readonly maxEvents: number;

  constructor(options: FeishuDiagnosticsStateStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    this.maxEvents = normalizeMaxEvents(options.maxEvents);
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  upsertConversation(conversation: FeishuDiagnosticsConversation): void {
    const normalizedConversation = normalizeConversation(conversation);
    const store = this.readStore();
    const index = store.conversations.findIndex((entry) => entry.key === normalizedConversation.key);

    if (index === -1) {
      store.conversations.push(normalizedConversation);
    } else {
      store.conversations[index] = normalizedConversation;
    }

    this.writeStore(store);
  }

  appendEvent(event: FeishuDiagnosticsEvent): void {
    const normalizedEvent = normalizeEvent(event);
    const store = this.readStore();

    store.recentEvents.push(normalizedEvent);

    if (store.recentEvents.length > this.maxEvents) {
      store.recentEvents.splice(0, store.recentEvents.length - this.maxEvents);
    }

    this.writeStore(store);
  }

  readSnapshot(): FeishuDiagnosticsStateSnapshot {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FeishuDiagnosticsStateStoreData> | null;
      const store = normalizeStore(parsed);

      if (!store) {
        return {
          path: "infra/local/feishu-diagnostics.json",
          status: "unreadable",
          conversations: [],
          recentEvents: [],
        };
      }

      return {
        path: "infra/local/feishu-diagnostics.json",
        status: "ok",
        conversations: store.conversations.map(cloneConversation),
        recentEvents: store.recentEvents.map(cloneEvent),
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return {
          path: "infra/local/feishu-diagnostics.json",
          status: "missing",
          conversations: [],
          recentEvents: [],
        };
      }

      return {
        path: "infra/local/feishu-diagnostics.json",
        status: "unreadable",
        conversations: [],
        recentEvents: [],
      };
    }
  }

  private readStore(): FeishuDiagnosticsStateStoreData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<FeishuDiagnosticsStateStoreData> | null;
      const store = normalizeStore(parsed);

      if (!store) {
        return { ...EMPTY_STORE, conversations: [], recentEvents: [] };
      }

      return store;
    } catch (error) {
      if (isNotFoundError(error)) {
        return { ...EMPTY_STORE, conversations: [], recentEvents: [] };
      }

      return { ...EMPTY_STORE, conversations: [], recentEvents: [] };
    }
  }

  private writeStore(store: FeishuDiagnosticsStateStoreData): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
}

function normalizeStore(value: Partial<FeishuDiagnosticsStateStoreData> | null): FeishuDiagnosticsStateStoreData | null {
  if (!value || value.version !== 1 || !Array.isArray(value.conversations) || !Array.isArray(value.recentEvents)) {
    return null;
  }

  const conversations = value.conversations.map(normalizeConversation);
  const recentEvents = value.recentEvents.map(normalizeEvent);

  return {
    version: 1,
    conversations,
    recentEvents,
  };
}

function normalizeConversation(value: FeishuDiagnosticsConversation): FeishuDiagnosticsConversation {
  const key = normalizeRequiredText(value.key);
  const chatId = normalizeRequiredText(value.chatId);
  const userId = normalizeRequiredText(value.userId);
  const principalId = normalizeRequiredText(value.principalId);
  const activeSessionId = normalizeRequiredText(value.activeSessionId);
  const updatedAt = normalizeRequiredText(value.updatedAt);
  const pendingActions = Array.isArray(value.pendingActions) ? value.pendingActions.map(normalizePendingAction) : [];

  if (!key || !chatId || !userId || !principalId || !activeSessionId || !updatedAt) {
    throw new Error("Feishu 诊断会话快照缺少必要字段。");
  }

  return {
    key,
    chatId,
    userId,
    principalId,
    activeSessionId,
    lastMessageId: normalizeOptionalText(value.lastMessageId) ?? undefined,
    lastEventType: normalizeOptionalText(value.lastEventType) ?? undefined,
    updatedAt,
    pendingActions,
  };
}

function normalizePendingAction(value: FeishuDiagnosticsPendingAction): FeishuDiagnosticsPendingAction {
  const actionId = normalizeRequiredText(value.actionId);
  const actionType = normalizeRequiredText(value.actionType);
  const taskId = normalizeRequiredText(value.taskId);
  const requestId = normalizeRequiredText(value.requestId);
  const sourceChannel = normalizeRequiredText(value.sourceChannel);
  const sessionId = normalizeRequiredText(value.sessionId);
  const principalId = normalizeRequiredText(value.principalId);

  if (!actionId || !actionType || !taskId || !requestId || !sourceChannel || !sessionId || !principalId) {
    throw new Error("Feishu 诊断 pending action 缺少必要字段。");
  }

  return {
    actionId,
    actionType,
    taskId,
    requestId,
    sourceChannel,
    sessionId,
    principalId,
  };
}

function normalizeEvent(value: FeishuDiagnosticsEvent): FeishuDiagnosticsEvent {
  const id = normalizeRequiredText(value.id);
  const type = normalizeRequiredText(value.type);
  const chatId = normalizeRequiredText(value.chatId);
  const userId = normalizeRequiredText(value.userId);
  const summary = normalizeRequiredText(value.summary);
  const createdAt = normalizeRequiredText(value.createdAt);

  if (!id || !type || !chatId || !userId || !summary || !createdAt) {
    throw new Error("Feishu 诊断事件缺少必要字段。");
  }

  return {
    id,
    type,
    chatId,
    userId,
    sessionId: normalizeOptionalText(value.sessionId) ?? undefined,
    principalId: normalizeOptionalText(value.principalId) ?? undefined,
    messageId: normalizeOptionalText(value.messageId) ?? undefined,
    actionId: normalizeOptionalText(value.actionId) ?? undefined,
    requestId: normalizeOptionalText(value.requestId) ?? undefined,
    summary,
    createdAt,
  };
}

function cloneConversation(conversation: FeishuDiagnosticsConversation): FeishuDiagnosticsConversation {
  return {
    key: conversation.key,
    chatId: conversation.chatId,
    userId: conversation.userId,
    principalId: conversation.principalId,
    activeSessionId: conversation.activeSessionId,
    lastMessageId: conversation.lastMessageId,
    lastEventType: conversation.lastEventType,
    updatedAt: conversation.updatedAt,
    pendingActions: conversation.pendingActions.map((item) => ({ ...item })),
  };
}

function cloneEvent(event: FeishuDiagnosticsEvent): FeishuDiagnosticsEvent {
  return {
    id: event.id,
    type: event.type,
    chatId: event.chatId,
    userId: event.userId,
    sessionId: event.sessionId,
    principalId: event.principalId,
    messageId: event.messageId,
    actionId: event.actionId,
    requestId: event.requestId,
    summary: event.summary,
    createdAt: event.createdAt,
  };
}

function normalizeRequiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMaxEvents(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) {
    return DEFAULT_MAX_EVENTS;
  }

  return Math.max(1, Math.floor(value));
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT";
}
