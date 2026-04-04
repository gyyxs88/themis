import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FeishuDiagnosticsStateStore,
  type FeishuDiagnosticsConversation,
  type FeishuDiagnosticsEvent,
  type FeishuDiagnosticsEventDetailValue,
  type FeishuDiagnosticsStateSnapshot,
} from "../channels/feishu/diagnostics-state-store.js";
import {
  SqliteCodexSessionRegistry,
  type StoredTurnInputCompileCapabilityMatrix,
  type StoredTurnInputRecord,
} from "../storage/index.js";

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

export interface FeishuDiagnosticsDiagnosisSummary {
  id:
    | "healthy"
    | "config_missing"
    | "service_unreachable"
    | "approval_blocking_takeover"
    | "pending_input_ambiguous"
    | "pending_input_not_found"
    | "action_submit_failed"
    | "ignored_message_window";
  severity: "info" | "warning" | "error";
  title: string;
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
    primaryDiagnosis: FeishuDiagnosticsDiagnosisSummary | null;
    secondaryDiagnoses: FeishuDiagnosticsDiagnosisSummary[];
    recommendedNextSteps: string[];
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

export interface FeishuDiagnosticsWarningCodeCount {
  code: string;
  count: number;
}

export interface FeishuDiagnosticsConversationSummary {
  key: string;
  chatId: string;
  userId: string;
  principalId: string;
  activeSessionId: string;
  threadId: string | null;
  threadStatus: string | null;
  multimodalSampleCount?: number;
  multimodalWarningCodeCounts?: FeishuDiagnosticsWarningCodeCount[];
  lastMultimodalInput?: FeishuDiagnosticsConversationMultimodalSummary | null;
  lastBlockedMultimodalInput?: FeishuDiagnosticsConversationMultimodalSummary | null;
  lastMessageId: string | null;
  lastEventType: string | null;
  pendingActionCount: number;
  pendingActions: FeishuDiagnosticsPendingActionSummary[];
  updatedAt: string;
}

export interface FeishuDiagnosticsConversationMultimodalSummary {
  requestId: string;
  assetCount: number;
  assetKinds: string[];
  runtimeTarget: string | null;
  degradationLevel: string | null;
  warningCodes: string[];
  warningMessages: string[];
  capabilityMatrix: StoredTurnInputCompileCapabilityMatrix | null;
  createdAt: string;
}

export interface FeishuTakeoverGuidance {
  state:
    | "no_pending_action"
    | "approval_required"
    | "blocked_by_approval"
    | "reply_required"
    | "direct_text_ready";
  hint: string;
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
const FEISHU_RECENT_MULTIMODAL_TURN_INPUT_LIMIT = 24;

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
  const currentConversation = summarizeConversation(
    selectCurrentConversation(diagnosticsSnapshot.conversations),
    runtimeStore,
  );
  const diagnosis = classifyFeishuDiagnostics({
    appIdConfigured: Boolean(normalizeText(env.FEISHU_APP_ID)),
    appSecretConfigured: Boolean(normalizeText(env.FEISHU_APP_SECRET)),
    serviceReachable: service.serviceReachable,
    recentWindowStats: diagnosticsWindow.recentWindowStats,
    currentConversation,
    lastActionAttempt: diagnosticsWindow.lastActionAttempt,
    lastIgnoredMessage: diagnosticsWindow.lastIgnoredMessage,
  });

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
      currentConversation,
      recentEvents: diagnosticsSnapshot.recentEvents.slice(-5).map(cloneEventSummary),
      recentWindowStats: diagnosticsWindow.recentWindowStats,
      lastActionAttempt: diagnosticsWindow.lastActionAttempt,
      lastIgnoredMessage: diagnosticsWindow.lastIgnoredMessage,
      primaryDiagnosis: diagnosis.primaryDiagnosis,
      secondaryDiagnoses: diagnosis.secondaryDiagnoses,
      recommendedNextSteps: diagnosis.recommendedNextSteps,
    },
    docs: {
      smokeDocExists: existsSync(join(workingDirectory, FEISHU_SMOKE_DOC_PATH)),
    },
  };
}

export function describeFeishuTakeoverGuidance(
  currentConversation: FeishuDiagnosticsConversationSummary | null,
): FeishuTakeoverGuidance {
  const pendingActions = currentConversation?.pendingActions ?? [];

  if (pendingActions.length === 0) {
    return {
      state: "no_pending_action",
      hint: "当前会话没有 pending action，可继续按固定复跑顺序验证。",
    };
  }

  const approvalPendingActions = pendingActions.filter((action) => action.actionType === "approval");
  const userInputPendingActions = pendingActions.filter((action) => action.actionType === "user-input");
  const approvalActionIds = approvalPendingActions.map((action) => action.actionId).join(", ");
  const userInputActionIds = userInputPendingActions.map((action) => action.actionId).join(", ");

  if (approvalPendingActions.length > 0 && userInputPendingActions.length > 0) {
    return {
      state: "blocked_by_approval",
      hint: `当前会话同时存在 approval(${approvalActionIds}) 和 user-input(${userInputActionIds})；请先执行 /approve <actionId> 或 /deny <actionId> 处理 approval，再继续 direct-text takeover 或 /reply。`,
    };
  }

  if (approvalPendingActions.length > 0) {
    return {
      state: "approval_required",
      hint: `当前会话还有 approval pending action；请先执行 /approve <actionId> 或 /deny <actionId>。候选 actionId：${approvalActionIds}`,
    };
  }

  if (userInputPendingActions.length > 1) {
    return {
      state: "reply_required",
      hint: `当前会话存在多条 user-input；普通文本不会自动接管，请执行 /reply <actionId> <内容>。候选 actionId：${userInputActionIds}`,
    };
  }

  return {
    state: "direct_text_ready",
    hint: `当前会话存在唯一 user-input(${userInputActionIds})；可以直接回复普通文本，或执行 /reply ${userInputActionIds} <内容>。`,
  };
}

export function buildFeishuTroubleshootingPlaybook(input: {
  primaryDiagnosisId: FeishuDiagnosticsDiagnosisSummary["id"] | null;
  currentConversation: FeishuDiagnosticsConversationSummary | null;
  lastIgnoredMessage: FeishuDiagnosticsLastIgnoredMessageSummary | null;
}): string[] {
  const pendingActions = input.currentConversation?.pendingActions ?? [];
  const approvalPendingActions = pendingActions.filter((action) => action.actionType === "approval");
  const userInputPendingActions = pendingActions.filter((action) => action.actionType === "user-input");
  const firstApprovalActionId = approvalPendingActions[0]?.actionId ?? "<actionId>";
  const firstUserInputActionId = userInputPendingActions[0]?.actionId ?? "<actionId>";
  const currentSessionId = input.currentConversation?.activeSessionId ?? "<sessionId>";
  const takeoverGuidance = describeFeishuTakeoverGuidance(input.currentConversation);

  switch (input.primaryDiagnosisId) {
    case "approval_blocking_takeover":
      return [
        `先处理 approval action：/approve ${firstApprovalActionId} 或 /deny ${firstApprovalActionId}`,
        `approval 处理完后，再对 user-input action 继续：直接回复普通文本，或 /reply ${firstUserInputActionId} <内容>`,
        "处理后重新运行 ./themis doctor feishu，确认当前接管判断已变化。",
      ];
    case "pending_input_ambiguous":
      return userInputPendingActions.length > 0
        ? userInputPendingActions.map((action, index) =>
          `${index + 1 === 1 ? "候选 user-input action：" : "备用 user-input action："} /reply ${action.actionId} <内容>`)
          .concat("不要直接发送普通文本，先显式命中正确的 actionId。")
        : [
          "先查看 doctor feishu 输出里的 pendingActions 列表。",
          "然后执行 /reply <actionId> <内容>，不要直接发送普通文本。",
        ];
    case "pending_input_not_found":
      return [
        `先执行 /use ${currentSessionId} 确认自己在目标会话，再看这条 waiting action 还在不在。`,
        ...buildTakeoverContinuationSteps(takeoverGuidance, {
          firstApprovalActionId,
          firstUserInputActionId,
        }),
        input.lastIgnoredMessage
          ? `最近还出现过被忽略消息 ${input.lastIgnoredMessage.messageId ?? "<messageId>"}，如果你刚才重发过旧消息，不要再重发，先按当前会话状态继续。`
          : "如果当前会话里已经没有 pending action，说明这条 waiting action 可能已经被处理过，先确认历史收口状态。",
      ];
    case "ignored_message_window": {
      const ignoredMessageId = input.lastIgnoredMessage?.messageId ?? "<messageId>";
      const ignoredHint = input.lastIgnoredMessage?.type === "message.stale_ignored"
        ? `最近被忽略的是旧消息 ${ignoredMessageId}，不要重发这条旧消息；请在当前会话重新发送一条新的消息。`
        : `最近被忽略的是重复消息 ${ignoredMessageId}，不要重复转发同一条消息；请确认当前会话状态后再继续。`;
      return [
        ignoredHint,
        ...buildTakeoverContinuationSteps(takeoverGuidance, {
          firstApprovalActionId,
          firstUserInputActionId,
        }),
        "再运行 ./themis doctor smoke feishu，确认是否只是 message window 干扰。",
      ];
    }
    case "action_submit_failed":
      return [
        "先看最近一次 action 尝试里的 actionId / requestId / summary。",
        "确认当前会话和 pending action 仍然存在后，再重试提交。",
        "必要时运行 ./themis doctor smoke feishu 复核飞书前置检查。",
      ];
    case "service_unreachable":
      return [
        "先恢复 Themis 服务，例如运行 npm run dev:web。",
        "服务恢复后重新运行 ./themis doctor feishu。",
      ];
    case "config_missing":
      return [
        "先运行 ./themis config list 检查当前飞书配置。",
        "补齐 FEISHU_APP_ID / FEISHU_APP_SECRET 后再重跑诊断。",
      ];
    case "healthy":
      return [
        "按固定顺序继续复跑：./themis doctor feishu -> ./themis doctor smoke web -> ./themis doctor smoke feishu。",
        "最后再做飞书手工 A/B 验收。",
      ];
    default:
      return [
        "先看主诊断、当前接管判断和 pendingActions。",
        "再按固定复跑顺序继续定位：./themis doctor feishu -> ./themis doctor smoke web -> ./themis doctor smoke feishu。",
      ];
  }
}

function buildTakeoverContinuationSteps(
  guidance: FeishuTakeoverGuidance,
  input: {
    firstApprovalActionId: string;
    firstUserInputActionId: string;
  },
): string[] {
  switch (guidance.state) {
    case "blocked_by_approval":
      return [
        `如果当前会话仍被 approval 阻塞，先处理：/approve ${input.firstApprovalActionId} 或 /deny ${input.firstApprovalActionId}`,
        `approval 处理完后，再继续 user-input：直接回复普通文本，或 /reply ${input.firstUserInputActionId} <内容>`,
      ];
    case "approval_required":
      return [
        `当前会话还有 approval pending action，先执行 /approve ${input.firstApprovalActionId} 或 /deny ${input.firstApprovalActionId}`,
      ];
    case "reply_required":
      return [
        `当前会话里有多条 user-input，先显式执行 /reply ${input.firstUserInputActionId} <内容>，不要直接发送普通文本。`,
      ];
    case "direct_text_ready":
      return [
        `当前会话里仍有唯一 user-input，可直接回复普通文本，或执行 /reply ${input.firstUserInputActionId} <内容>。`,
      ];
    case "no_pending_action":
    default:
      return [
        "先看当前会话摘要和 pendingActions，确认是不是切错会话或这条 waiting action 已经被处理过。",
      ];
  }
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

function dedupeTextValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value ?? undefined);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(normalized);
  }

  return results;
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
  const multimodalContext = resolveConversationMultimodalContext(conversation, runtimeStore);

  return {
    key: conversation.key,
    chatId: conversation.chatId,
    userId: conversation.userId,
    principalId: conversation.principalId,
    activeSessionId: conversation.activeSessionId,
    threadId: threadContext.threadId,
    threadStatus: threadContext.threadStatus,
    multimodalSampleCount: multimodalContext.sampleCount,
    multimodalWarningCodeCounts: multimodalContext.warningCodeCounts,
    lastMultimodalInput: multimodalContext.lastMultimodalInput,
    lastBlockedMultimodalInput: multimodalContext.lastBlockedMultimodalInput,
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

function resolveConversationMultimodalContext(
  conversation: FeishuDiagnosticsConversation,
  runtimeStore: SqliteCodexSessionRegistry | null,
): {
  sampleCount: number;
  warningCodeCounts: FeishuDiagnosticsWarningCodeCount[];
  lastMultimodalInput: FeishuDiagnosticsConversationMultimodalSummary | null;
  lastBlockedMultimodalInput: FeishuDiagnosticsConversationMultimodalSummary | null;
} {
  if (!runtimeStore) {
    return {
      sampleCount: 0,
      warningCodeCounts: [],
      lastMultimodalInput: null,
      lastBlockedMultimodalInput: null,
    };
  }

  const sessionId = normalizeText(conversation.activeSessionId);

  if (!sessionId) {
    return {
      sampleCount: 0,
      warningCodeCounts: [],
      lastMultimodalInput: null,
      lastBlockedMultimodalInput: null,
    };
  }

  const recentInputs = listRecentConversationMultimodalInputs(runtimeStore, sessionId);
  const warningCodeCounts = new Map<string, number>();

  for (const storedInput of recentInputs) {
    for (const warning of storedInput.compileSummary?.warnings ?? []) {
      const warningCode = normalizeText(warning.code);

      if (!warningCode) {
        continue;
      }

      warningCodeCounts.set(warningCode, (warningCodeCounts.get(warningCode) ?? 0) + 1);
    }
  }

  return {
    sampleCount: recentInputs.length,
    warningCodeCounts: mapWarningCodeEntries(warningCodeCounts).map(([code, count]) => ({ code, count })),
    lastMultimodalInput: recentInputs[0] ? summarizeConversationMultimodalInput(recentInputs[0]) : null,
    lastBlockedMultimodalInput: summarizeConversationMultimodalInput(
      recentInputs.find((storedInput) => storedInput.compileSummary?.degradationLevel === "blocked") ?? null,
    ),
  };
}

function listRecentConversationMultimodalInputs(
  runtimeStore: SqliteCodexSessionRegistry,
  sessionId: string,
): StoredTurnInputRecord[] {
  const turns = runtimeStore.listSessionTurns(sessionId);
  const results: StoredTurnInputRecord[] = [];

  for (let index = turns.length - 1; index >= 0 && results.length < FEISHU_RECENT_MULTIMODAL_TURN_INPUT_LIMIT; index -= 1) {
    const turn = turns[index];
    const storedInput = runtimeStore.getTurnInput(turn?.requestId ?? "");

    if (!storedInput || storedInput.assets.length === 0) {
      continue;
    }

    results.push(storedInput);
  }

  return results;
}

function summarizeConversationMultimodalInput(
  storedInput: StoredTurnInputRecord | null,
): FeishuDiagnosticsConversationMultimodalSummary | null {
  if (!storedInput) {
    return null;
  }

  return {
    requestId: storedInput.requestId,
    assetCount: storedInput.assets.length,
    assetKinds: dedupeTextValues(storedInput.assets.map((asset) => asset.kind)),
    runtimeTarget: normalizeText(storedInput.compileSummary?.runtimeTarget) ?? null,
    degradationLevel: normalizeText(storedInput.compileSummary?.degradationLevel) ?? null,
    warningCodes: dedupeTextValues(storedInput.compileSummary?.warnings.map((warning) => warning.code) ?? []),
    warningMessages: dedupeTextValues(storedInput.compileSummary?.warnings.map((warning) => warning.message) ?? []),
    capabilityMatrix: storedInput.compileSummary?.capabilityMatrix ?? null,
    createdAt: storedInput.createdAt,
  };
}

function mapWarningCodeEntries(counter: Map<string, number>): Array<[string, number]> {
  return [...counter.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
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
      case "reply.submit_failed":
        lastActionAttempt = summarizeActionAttempt(event);
        break;
      case "reply.submitted":
        recentWindowStats.replySubmittedCount += 1;
        lastActionAttempt = summarizeActionAttempt(event);
        break;
      case "takeover.submit_failed":
        lastActionAttempt = summarizeActionAttempt(event);
        break;
      case "takeover.submitted":
        recentWindowStats.takeoverSubmittedCount += 1;
        lastActionAttempt = summarizeActionAttempt(event);
        break;
      case "approval.submit_failed":
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

function classifyFeishuDiagnostics(summary: {
  appIdConfigured: boolean;
  appSecretConfigured: boolean;
  serviceReachable: boolean;
  recentWindowStats: FeishuDiagnosticsRecentWindowStats;
  currentConversation: FeishuDiagnosticsConversationSummary | null;
  lastActionAttempt: FeishuDiagnosticsLastActionAttemptSummary | null;
  lastIgnoredMessage: FeishuDiagnosticsLastIgnoredMessageSummary | null;
}): {
  primaryDiagnosis: FeishuDiagnosticsDiagnosisSummary | null;
  secondaryDiagnoses: FeishuDiagnosticsDiagnosisSummary[];
  recommendedNextSteps: string[];
} {
  if (!summary.appIdConfigured || !summary.appSecretConfigured) {
    return {
      primaryDiagnosis: {
        id: "config_missing",
        severity: "error",
        title: "飞书配置缺失",
        summary: "FEISHU_APP_ID / FEISHU_APP_SECRET 未完整配置，当前不适合继续做飞书复验。",
      },
      secondaryDiagnoses: [],
      recommendedNextSteps: [
        "./themis config list",
        "./themis config set FEISHU_APP_ID <value>",
        "./themis config set FEISHU_APP_SECRET <value>",
      ],
    };
  }

  if (!summary.serviceReachable) {
    return {
      primaryDiagnosis: {
        id: "service_unreachable",
        severity: "error",
        title: "Themis 服务不可达",
        summary: "当前 `doctor feishu` 无法探测到 Themis 服务，先恢复服务再做飞书复验。",
      },
      secondaryDiagnoses: [],
      recommendedNextSteps: [
        "npm run dev:web",
        "./themis doctor feishu",
      ],
    };
  }

  if (summary.lastActionAttempt?.type.endsWith("submit_failed")) {
    return {
      primaryDiagnosis: {
        id: "action_submit_failed",
        severity: "error",
        title: "最近一次 waiting action 提交失败",
        summary: summary.lastActionAttempt.summary,
      },
      secondaryDiagnoses: [],
      recommendedNextSteps: [
        "./themis doctor feishu",
        "./themis doctor smoke feishu",
      ],
    };
  }

  const currentPendingActions = summary.currentConversation?.pendingActions ?? [];
  const approvalPendingActions = currentPendingActions.filter((action) => action.actionType === "approval");
  const userInputPendingActions = currentPendingActions.filter((action) => action.actionType === "user-input");

  if (approvalPendingActions.length > 0 && userInputPendingActions.length > 0) {
    return {
      primaryDiagnosis: {
        id: "approval_blocking_takeover",
        severity: "warning",
        title: "approval 仍在阻挡 direct-text takeover",
        summary: "当前 scope 里还有 approval pending action，普通文本不会直接接管 user-input。",
      },
      secondaryDiagnoses: [],
      recommendedNextSteps: [
        "先在飞书里执行 /approve <actionId> 或 /deny <actionId>",
        "然后重新运行 ./themis doctor feishu",
      ],
    };
  }

  if (userInputPendingActions.length > 1) {
    return {
      primaryDiagnosis: {
        id: "pending_input_ambiguous",
        severity: "warning",
        title: "当前 scope 存在多条 user-input",
        summary: "普通文本不会自动接管，请改用显式 /reply <actionId> <内容>。",
      },
      secondaryDiagnoses: [],
      recommendedNextSteps: [
        "先看 doctor feishu 输出里的 pendingActions 列表",
        "然后在飞书里执行 /reply <actionId> <内容>",
      ],
    };
  }

  if (summary.recentWindowStats.pendingInputNotFoundCount > 0) {
    return {
      primaryDiagnosis: {
        id: "pending_input_not_found",
        severity: "warning",
        title: "最近未匹配到 pending action",
        summary: "最近的消息没有匹配到当前会话里的 pending action，请检查当前 scope 是否已经恢复。",
      },
      secondaryDiagnoses: buildSecondaryDiagnoses({
        lastIgnoredMessage: summary.lastIgnoredMessage,
        includePendingInputNotFound: false,
      }),
      recommendedNextSteps: [
        "先运行 ./themis doctor feishu 查看 currentConversation.pendingActions",
        "如果只是旧消息干扰，再运行 ./themis doctor smoke feishu",
      ],
    };
  }

  if (summary.lastIgnoredMessage) {
    return {
      primaryDiagnosis: {
        id: "ignored_message_window",
        severity: "warning",
        title: "最近有飞书消息被忽略",
        summary: summary.lastIgnoredMessage.summary,
      },
      secondaryDiagnoses: buildSecondaryDiagnoses({
        lastIgnoredMessage: null,
        includePendingInputNotFound: summary.recentWindowStats.pendingInputNotFoundCount > 0,
      }),
      recommendedNextSteps: [
        "./themis doctor feishu",
        "./themis doctor smoke feishu",
      ],
    };
  }

  return {
    primaryDiagnosis: {
      id: "healthy",
      severity: "info",
      title: "当前未发现明显阻塞",
      summary: "飞书配置、服务可达性和最近窗口摘要看起来正常，继续按固定复跑顺序验证即可。",
    },
    secondaryDiagnoses: buildSecondaryDiagnoses({
      lastIgnoredMessage: null,
      includePendingInputNotFound: summary.recentWindowStats.pendingInputNotFoundCount > 0,
    }),
    recommendedNextSteps: [
      "./themis doctor feishu",
      "./themis doctor smoke web",
      "./themis doctor smoke feishu",
    ],
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

function buildSecondaryDiagnoses(options: {
  lastIgnoredMessage: FeishuDiagnosticsLastIgnoredMessageSummary | null;
  includePendingInputNotFound: boolean;
}): FeishuDiagnosticsDiagnosisSummary[] {
  const secondaryDiagnoses: FeishuDiagnosticsDiagnosisSummary[] = [];

  if (options.includePendingInputNotFound) {
    secondaryDiagnoses.push({
      id: "pending_input_not_found",
      severity: "warning",
      title: "最近未匹配到 pending action",
      summary: "最近有消息没能匹配到当前会话里的 pending action。",
    });
  }

  if (options.lastIgnoredMessage) {
    secondaryDiagnoses.push({
      id: "ignored_message_window",
      severity: "warning",
      title: "最近有飞书消息被忽略",
      summary: options.lastIgnoredMessage.summary,
    });
  }

  return secondaryDiagnoses;
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
