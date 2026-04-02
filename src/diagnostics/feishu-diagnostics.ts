import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FeishuDiagnosticsStateStore,
  type FeishuDiagnosticsConversation,
  type FeishuDiagnosticsEvent,
  type FeishuDiagnosticsEventDetailValue,
  type FeishuDiagnosticsStateSnapshot,
} from "../channels/feishu/diagnostics-state-store.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

export interface FeishuDiagnosticFileStatus {
  path: string;
  status: "ok" | "missing" | "unreadable";
}

export interface FeishuDiagnosticStoreStatus extends FeishuDiagnosticFileStatus {
  count: number;
}

export interface FeishuDiagnosticsRecentWindowStats {
  duplicateIgnoredCount: number;
  staleIgnoredCount: number;
  replySubmittedCount: number;
  takeoverSubmittedCount: number;
  approvalSubmittedCount: number;
  pendingInputNotFoundCount: number;
  pendingInputAmbiguousCount: number;
}

export interface FeishuDiagnosticsLastActionAttemptSummary {
  type: string;
  actionId: string | null;
  requestId: string | null;
  sessionId: string | null;
  principalId: string | null;
  createdAt: string;
  summary: string;
}

export interface FeishuDiagnosticsLastIgnoredMessageSummary {
  type: string;
  messageId: string | null;
  createdAt: string;
  summary: string;
}

export interface FeishuDiagnosticsSummary {
  env: {
    appIdConfigured: boolean;
    appSecretConfigured: boolean;
    useEnvProxy: boolean;
    progressFlushTimeoutMs: number | null;
  };
  service: {
    serviceReachable: boolean;
    statusCode: number | null;
  };
  state: {
    sessionStore: FeishuDiagnosticStoreStatus;
    attachmentDraftStore: FeishuDiagnosticStoreStatus;
    sessionBindingCount: number;
    attachmentDraftCount: number;
  };
  diagnostics: {
    store: FeishuDiagnosticFileStatus;
    currentConversation: FeishuDiagnosticsConversationSummary | null;
    recentEvents: FeishuDiagnosticsEventSummary[];
    recentWindowStats: FeishuDiagnosticsRecentWindowStats;
    lastActionAttempt: FeishuDiagnosticsLastActionAttemptSummary | null;
    lastIgnoredMessage: FeishuDiagnosticsLastIgnoredMessageSummary | null;
  };
  docs: {
    smokeDocExists: boolean;
  };
}

export interface FeishuDiagnosticsPendingActionSummary {
  actionId: string;
  actionType: string;
  taskId: string;
  requestId: string;
  sourceChannel: string;
  sessionId: string;
  principalId: string;
}

export interface FeishuDiagnosticsConversationSummary {
  key: string;
  chatId: string;
  userId: string;
  principalId: string;
  activeSessionId: string;
  threadId: string | null;
  threadStatus: string | null;
  lastMessageId: string | null;
  lastEventType: string | null;
  pendingActionCount: number;
  pendingActions: FeishuDiagnosticsPendingActionSummary[];
  updatedAt: string;
}

export interface FeishuDiagnosticsEventSummary {
  id: string;
  type: string;
  chatId: string;
  userId: string;
  sessionId: string | null;
  principalId: string | null;
  messageId: string | null;
  actionId: string | null;
  requestId: string | null;
  summary: string;
  createdAt: string;
  details?: Record<string, FeishuDiagnosticsEventDetailValue>;
}

export interface ReadFeishuDiagnosticsOptions {
  workingDirectory: string;
  env?: NodeJS.ProcessEnv;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  serviceProbeTimeoutMs?: number;
  runtimeStore?: SqliteCodexSessionRegistry | null;
  sqliteFilePath?: string;
}

const FEISHU_SMOKE_DOC_PATH = "docs/feishu/themis-feishu-real-journey-smoke.md";
const FEISHU_SESSION_STORE_PATH = "infra/local/feishu-sessions.json";
const FEISHU_ATTACHMENT_DRAFT_STORE_PATH = "infra/local/feishu-attachment-drafts.json";
const FEISHU_DIAGNOSTICS_STORE_PATH = "infra/local/feishu-diagnostics.json";
const FEISHU_SQLITE_FILE_PATH = "infra/local/themis.db";

export async function readFeishuDiagnosticsSnapshot(
  options: ReadFeishuDiagnosticsOptions,
): Promise<FeishuDiagnosticsSummary> {
  const env = options.env ?? process.env;
  const workingDirectory = options.workingDirectory;
  const baseUrl = normalizeText(options.baseUrl ?? env.THEMIS_BASE_URL ?? "http://127.0.0.1:3100") ?? "http://127.0.0.1:3100";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const serviceProbeTimeoutMs = normalizePositiveInteger(options.serviceProbeTimeoutMs, 1_000);
  const sessionStorePath = join(workingDirectory, FEISHU_SESSION_STORE_PATH);
  const attachmentDraftStorePath = join(workingDirectory, FEISHU_ATTACHMENT_DRAFT_STORE_PATH);
  const diagnosticsFilePath = join(workingDirectory, FEISHU_DIAGNOSTICS_STORE_PATH);
  const diagnosticsSnapshot = readFeishuDiagnosticsStateSnapshot(diagnosticsFilePath);
  const runtimeStore = resolveFeishuRuntimeStore({
    runtimeStore: options.runtimeStore ?? null,
    sqliteFilePath: options.sqliteFilePath ?? join(workingDirectory, FEISHU_SQLITE_FILE_PATH),
  });

  const [service, sessionStore, attachmentDraftStore] = await Promise.all([
    probeServiceReachability(baseUrl, fetchImpl, serviceProbeTimeoutMs),
    readFeishuFileStatus(sessionStorePath, FEISHU_SESSION_STORE_PATH, "bindings"),
    readFeishuFileStatus(attachmentDraftStorePath, FEISHU_ATTACHMENT_DRAFT_STORE_PATH, "drafts"),
  ]);
  const diagnosticsWindow = summarizeDiagnosticsWindow(diagnosticsSnapshot.recentEvents);

  return {
    env: {
      appIdConfigured: Boolean(normalizeText(env.FEISHU_APP_ID)),
      appSecretConfigured: Boolean(normalizeText(env.FEISHU_APP_SECRET)),
      useEnvProxy: parseBooleanEnv(env.FEISHU_USE_ENV_PROXY),
      progressFlushTimeoutMs: parseIntegerEnv(env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS) ?? null,
    },
    service,
    state: {
      sessionStore,
      attachmentDraftStore,
      sessionBindingCount: sessionStore.count,
      attachmentDraftCount: attachmentDraftStore.count,
    },
    diagnostics: {
      store: {
        path: diagnosticsSnapshot.path,
        status: diagnosticsSnapshot.status,
      },
      currentConversation: summarizeConversation(
        selectCurrentConversation(diagnosticsSnapshot.conversations),
        runtimeStore,
      ),
      recentEvents: diagnosticsSnapshot.recentEvents.slice(-5).map(cloneEventSummary),
      recentWindowStats: diagnosticsWindow.recentWindowStats,
      lastActionAttempt: diagnosticsWindow.lastActionAttempt,
      lastIgnoredMessage: diagnosticsWindow.lastIgnoredMessage,
    },
    docs: {
      smokeDocExists: existsSync(join(workingDirectory, FEISHU_SMOKE_DOC_PATH)),
    },
  };
}

async function probeServiceReachability(
  baseUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FeishuDiagnosticsSummary["service"]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<Response>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("feishu service probe timed out"));
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    const response = await Promise.race([
      fetchImpl(new URL("/", baseUrl), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);

    return {
      serviceReachable: response.status < 500,
      statusCode: response.status,
    };
  } catch {
    return {
      serviceReachable: false,
      statusCode: null,
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseIntegerEnv(value: string | undefined): number | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function selectCurrentConversation(
  conversations: FeishuDiagnosticsConversation[],
): FeishuDiagnosticsConversation | null {
  if (conversations.length === 0) {
    return null;
  }

  return conversations.reduce((current, candidate) => (
    compareConversation(candidate, current) > 0 ? candidate : current
  ));
}

function summarizeConversation(
  conversation: FeishuDiagnosticsConversation | null,
  runtimeStore: SqliteCodexSessionRegistry | null,
): FeishuDiagnosticsConversationSummary | null {
  if (!conversation) {
    return null;
  }

  const threadContext = resolveConversationThreadContext(conversation, runtimeStore);

  return {
    key: conversation.key,
    chatId: conversation.chatId,
    userId: conversation.userId,
    principalId: conversation.principalId,
    activeSessionId: conversation.activeSessionId,
    threadId: threadContext.threadId,
    threadStatus: threadContext.threadStatus,
    lastMessageId: conversation.lastMessageId ?? null,
    lastEventType: conversation.lastEventType ?? null,
    pendingActionCount: conversation.pendingActions.length,
    pendingActions: conversation.pendingActions.map(clonePendingAction),
    updatedAt: conversation.updatedAt,
  };
}

function resolveConversationThreadContext(
  conversation: FeishuDiagnosticsConversation,
  runtimeStore: SqliteCodexSessionRegistry | null,
): {
  threadId: string | null;
  threadStatus: string | null;
} {
  if (!runtimeStore) {
    return {
      threadId: null,
      threadStatus: null,
    };
  }

  const sessionId = normalizeText(conversation.activeSessionId);
  if (!sessionId) {
    return {
      threadId: null,
      threadStatus: null,
    };
  }

  const session = runtimeStore.getSession(sessionId);
  const turns = runtimeStore.listSessionTurns(sessionId);
  const latestTurn = turns.at(-1) ?? null;

  return {
    threadId: normalizeText(session?.threadId) ?? normalizeText(latestTurn?.codexThreadId) ?? null,
    threadStatus: normalizeText(latestTurn?.status) ?? null,
  };
}

function readFeishuDiagnosticsStateSnapshot(filePath: string): FeishuDiagnosticsStateSnapshot {
  if (!existsSync(filePath)) {
    return {
      path: FEISHU_DIAGNOSTICS_STORE_PATH,
      status: "missing",
      conversations: [],
      recentEvents: [],
    };
  }

  return new FeishuDiagnosticsStateStore({
    filePath,
  }).readSnapshot();
}

function resolveFeishuRuntimeStore(options: {
  runtimeStore: SqliteCodexSessionRegistry | null;
  sqliteFilePath: string;
}): SqliteCodexSessionRegistry | null {
  if (options.runtimeStore) {
    return options.runtimeStore;
  }

  if (!existsSync(options.sqliteFilePath)) {
    return null;
  }

  return new SqliteCodexSessionRegistry({
    databaseFile: options.sqliteFilePath,
  });
}

function compareConversation(left: FeishuDiagnosticsConversation, right: FeishuDiagnosticsConversation): number {
  const leftUpdatedAt = parseTimestamp(left.updatedAt);
  const rightUpdatedAt = parseTimestamp(right.updatedAt);

  if (leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt - rightUpdatedAt;
  }

  return left.key.localeCompare(right.key);
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function clonePendingAction(action: {
  actionId: string;
  actionType: string;
  taskId: string;
  requestId: string;
  sourceChannel: string;
  sessionId: string;
  principalId: string;
}): FeishuDiagnosticsPendingActionSummary {
  return {
    actionId: action.actionId,
    actionType: action.actionType,
    taskId: action.taskId,
    requestId: action.requestId,
    sourceChannel: action.sourceChannel,
    sessionId: action.sessionId,
    principalId: action.principalId,
  };
}

function cloneEventSummary(event: FeishuDiagnosticsEvent): FeishuDiagnosticsEventSummary {
  return {
    id: event.id,
    type: event.type,
    chatId: event.chatId,
    userId: event.userId,
    sessionId: event.sessionId ?? null,
    principalId: event.principalId ?? null,
    messageId: event.messageId ?? null,
    actionId: event.actionId ?? null,
    requestId: event.requestId ?? null,
    summary: event.summary,
    createdAt: event.createdAt,
    ...(event.details ? { details: cloneEventDetails(event.details) } : {}),
  };
}

function summarizeDiagnosticsWindow(events: FeishuDiagnosticsEvent[]): {
  recentWindowStats: FeishuDiagnosticsRecentWindowStats;
  lastActionAttempt: FeishuDiagnosticsLastActionAttemptSummary | null;
  lastIgnoredMessage: FeishuDiagnosticsLastIgnoredMessageSummary | null;
} {
  const recentWindowStats: FeishuDiagnosticsRecentWindowStats = {
    duplicateIgnoredCount: 0,
    staleIgnoredCount: 0,
    replySubmittedCount: 0,
    takeoverSubmittedCount: 0,
    approvalSubmittedCount: 0,
    pendingInputNotFoundCount: 0,
    pendingInputAmbiguousCount: 0,
  };

  let lastActionAttempt: FeishuDiagnosticsLastActionAttemptSummary | null = null;
  let lastIgnoredMessage: FeishuDiagnosticsLastIgnoredMessageSummary | null = null;

  for (const event of events) {
    switch (event.type) {
      case "message.duplicate_ignored":
        recentWindowStats.duplicateIgnoredCount += 1;
        lastIgnoredMessage = summarizeIgnoredMessage(event);
        break;
      case "message.stale_ignored":
        recentWindowStats.staleIgnoredCount += 1;
        lastIgnoredMessage = summarizeIgnoredMessage(event);
        break;
      case "reply.submitted":
        recentWindowStats.replySubmittedCount += 1;
        lastActionAttempt = summarizeActionAttempt(event);
        break;
      case "takeover.submitted":
        recentWindowStats.takeoverSubmittedCount += 1;
        lastActionAttempt = summarizeActionAttempt(event);
        break;
      case "approval.submitted":
        recentWindowStats.approvalSubmittedCount += 1;
        lastActionAttempt = summarizeActionAttempt(event);
        break;
      case "pending_input.not_found":
        recentWindowStats.pendingInputNotFoundCount += 1;
        break;
      case "pending_input.ambiguous":
        recentWindowStats.pendingInputAmbiguousCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    recentWindowStats,
    lastActionAttempt,
    lastIgnoredMessage,
  };
}

function summarizeActionAttempt(
  event: FeishuDiagnosticsEvent,
): FeishuDiagnosticsLastActionAttemptSummary {
  return {
    type: event.type,
    actionId: event.actionId ?? null,
    requestId: event.requestId ?? null,
    sessionId: event.sessionId ?? null,
    principalId: event.principalId ?? null,
    createdAt: event.createdAt,
    summary: event.summary,
  };
}

function summarizeIgnoredMessage(
  event: FeishuDiagnosticsEvent,
): FeishuDiagnosticsLastIgnoredMessageSummary {
  return {
    type: event.type,
    messageId: event.messageId ?? null,
    createdAt: event.createdAt,
    summary: event.summary,
  };
}

function cloneEventDetails(
  details: Record<string, FeishuDiagnosticsEventDetailValue>,
): Record<string, FeishuDiagnosticsEventDetailValue> {
  return { ...details };
}

async function readFeishuFileStatus(
  filePath: string,
  relativePath: string,
  arrayKey: "bindings" | "drafts",
): Promise<FeishuDiagnosticStoreStatus> {
  if (!existsSync(filePath)) {
    return {
      path: relativePath,
      status: "missing",
      count: 0,
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const entries = parsed && Array.isArray(parsed[arrayKey]) ? parsed[arrayKey] : [];

    return {
      path: relativePath,
      status: "ok",
      count: entries.length,
    };
  } catch {
    return {
      path: relativePath,
      status: "unreadable",
      count: 0,
    };
  }
}
