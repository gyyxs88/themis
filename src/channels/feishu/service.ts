import * as Lark from "@larksuiteoapi/node-sdk";
import type { EventHandles, InteractiveCard, InteractiveCardActionEvent } from "@larksuiteoapi/node-sdk";
import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { InMemoryCommunicationRouter } from "../../communication/router.js";
import { AppServerActionBridge } from "../../core/app-server-action-bridge.js";
import { AppServerTaskRuntime } from "../../core/app-server-task-runtime.js";
import type { CodexRuntimeCatalog } from "../../core/codex-app-server.js";
import { CodexAuthRuntime } from "../../core/codex-auth.js";
import type { RuntimeServiceHost } from "../../core/runtime-service-host.js";
import { readSessionNativeThreadSummary } from "../../core/native-thread-summary.js";
import { validateWorkspacePath } from "../../core/session-workspace.js";
import { resolveStoredSessionThreadReference } from "../../core/session-thread-reference.js";
import {
  isPrincipalTaskSettingsEmpty,
  normalizePrincipalTaskSettings,
} from "../../core/principal-task-settings.js";
import { persistSessionTaskSettings } from "../../core/session-settings-service.js";
import { appendTaskReplyQuotaFooter } from "../../core/task-reply-quota.js";
import { createTaskActivityTimeoutController } from "../../core/task-activity-timeout.js";
import { applyThemisGlobalDefaultsToRuntimeCatalog } from "../../core/task-defaults.js";
import { createTaskError } from "../../server/http-errors.js";
import {
  APPROVAL_POLICIES,
  REASONING_LEVELS,
  type PrincipalTaskSettings,
  type ReasoningLevel,
  type SessionTaskSettings,
  type StoredAgentRunRecord,
  type StoredAgentWorkItemRecord,
  type StoredManagedAgentRecord,
  type StoredScheduledTaskRecord,
  type StoredScheduledTaskRunRecord,
  type TaskActionDescriptor,
  type TaskInputEnvelope,
  SANDBOX_MODES,
  WEB_SEARCH_MODES,
  type ApprovalPolicy,
  type SandboxMode,
  type TaskRequest,
  type TaskRuntimeFacade,
  type TaskRuntimeRegistry,
  resolvePublicTaskRuntime,
  type WebSearchMode,
  resolveTaskRuntime,
} from "../../types/index.js";
import { FeishuAdapter } from "./adapter.js";
import {
  FeishuAttachmentDraftStore,
  type FeishuAttachmentDraftAsset,
  type FeishuAttachmentDraftPart,
  type FeishuAttachmentDraftSnapshot,
  type FeishuAttachmentDraftKey,
} from "./attachment-draft-store.js";
import {
  FeishuDiagnosticsStateStore,
  type FeishuDiagnosticsEventDetailValue,
  type FeishuDiagnosticsPendingAction,
} from "./diagnostics-state-store.js";
import {
  FeishuChatSettingsStore,
  type FeishuChatRoutePolicy,
  type FeishuChatSessionScope,
  type FeishuChatSettings,
} from "./chat-settings-store.js";
import {
  buildFeishuApprovalInteractiveCard,
  renderFeishuApprovalCard,
  type FeishuApprovalCardStatus,
} from "./approval-card-renderer.js";
import {
  FeishuApprovalCardStateStore,
  type FeishuApprovalCardRecord,
} from "./approval-card-state-store.js";
import { renderFeishuAssistantMessage, type FeishuRenderedMessageDraft } from "./message-renderer.js";
import {
  extractFeishuPostContentItems,
  extractFeishuPostText,
  type FeishuPostContentItem,
} from "./message-content.js";
import {
  buildLegacyAttachmentsFromEnvelope,
  createTaskInputEnvelope,
} from "../../core/task-input.js";
import { formatShortCommitHash } from "../../diagnostics/update-check.js";
import {
  ThemisUpdateService,
  type ThemisManagedUpdateOverview,
  type ThemisOpsStatusSnapshot,
  type ThemisRestartRequestMarker,
  type ThemisSystemdServiceStatus,
} from "../../diagnostics/update-service.js";
import { WorkerSecretStore } from "../../core/worker-secret-store.js";
import { ThemisSecretStore } from "../../core/themis-secret-store.js";
import {
  parseThemisSecretIntake,
  redactThemisSecretIntakeText,
} from "../../core/themis-secret-intake.js";
import {
  downloadFeishuMessageResources,
  extractFeishuMessageResources,
  type FeishuMessageResourceAsset,
  type FeishuMessageResourceReference,
} from "./message-resource.js";
import {
  finalizeFeishuOutboundAttachmentResult,
  resolveFeishuOutboundAttachmentPlans,
  type FeishuOutboundAttachmentPlan,
} from "./outbound-attachments.js";
import type { StoredChannelInputAssetRecord } from "../../storage/index.js";
import { FeishuSessionStore, type FeishuConversationKey } from "./session-store.js";
import {
  FeishuTaskMessageBridge,
  type FeishuMessageMutationResponse,
} from "./task-message-bridge.js";
import {
  renderFeishuCurrentSessionSurface,
  renderFeishuTaskStatusSurface,
  renderFeishuWaitingActionSurface,
} from "./mobile-surface.js";
import type { FeishuDeliveryMessage, FeishuTaskPayload } from "./types.js";

type FeishuMessageReceiveEvent = Parameters<NonNullable<EventHandles["im.message.receive_v1"]>>[0];

interface FeishuChannelLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface FeishuIncomingContextBase {
  chatId: string;
  messageId: string;
  messageCreateTimeMs?: number;
  userId: string;
  openId?: string;
  tenantKey?: string;
  threadId?: string;
  chatType?: string;
  mentionCount?: number;
}

type FeishuIncomingContext =
  | (FeishuIncomingContextBase & {
    kind: "text";
    text: string;
    attachments?: FeishuMessageResourceReference[];
    postContentItems?: FeishuPostContentItem[];
  })
  | (FeishuIncomingContextBase & {
    kind: "attachment";
    text: "";
    attachments: FeishuMessageResourceReference[];
  });

interface ParsedFeishuCommand {
  name: string;
  args: string[];
  raw: string;
}

interface FeishuSessionTaskLease {
  signal: AbortSignal;
  release: () => void;
}

interface FeishuSessionTaskLeaseOptions {
  interruptActiveTask?: boolean;
}

type FeishuResolvedAccountCommandTarget =
  | {
    ok: true;
    principalId: string;
    targetAccountId: string;
    targetAccount: { accountId: string; label?: string | null; accountEmail?: string | null } | null;
    targetLabel: string;
    targetKind: "system-default" | "visible-account";
  }
  | {
    ok: false;
    principalId: string;
    reason: "missing_configured_account";
    accountId: string;
  }
  | {
    ok: false;
    principalId: string;
    reason: "invalid_target";
    invalidValue: string;
  };

interface FeishuActiveSessionTask {
  token: symbol;
  abortController: AbortController;
  completed: Promise<void>;
}

export interface FeishuChannelServiceOptions {
  runtime: RuntimeServiceHost;
  runtimeRegistry?: TaskRuntimeRegistry;
  actionBridge?: AppServerActionBridge;
  authRuntime: CodexAuthRuntime;
  taskTimeoutMs: number;
  appId?: string;
  appSecret?: string;
  loggerLevel?: Lark.LoggerLevel;
  useEnvProxy?: boolean;
  verificationToken?: string;
  encryptKey?: string;
  sessionStore?: FeishuSessionStore;
  diagnosticsStateStore?: FeishuDiagnosticsStateStore;
  chatSettingsStore?: FeishuChatSettingsStore;
  approvalCardStore?: FeishuApprovalCardStateStore;
  updateService?: ThemisUpdateService;
  workerSecretStore?: WorkerSecretStore;
  themisSecretStore?: ThemisSecretStore;
  logger?: FeishuChannelLogger;
}

const MAX_FEISHU_TEXT_CHARS = 3500;
const FEISHU_MESSAGE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const FEISHU_SETTINGS_SCOPE_LINE = "作用范围：Themis 中间层长期默认配置，会同时影响 Web 和飞书后续新任务。";
const FEISHU_SETTINGS_EFFECT_LINE = "生效规则：只影响之后新发起的任务，不会打断已经在运行中的任务。";
const FEISHU_ACCOUNT_SETTINGS_SCOPE_LINE = "这里分两类操作：`use` 管默认账号，`login/logout/cancel` 管账号本身的登录状态。";
const FEISHU_ACCOUNT_SETTINGS_EFFECT_LINE = "这些改动都只影响之后新发起的任务，不会打断已经在运行中的任务。";
const FEISHU_ACCOUNT_AUTH_SCOPE_LINE = "这会修改账号本身的登录状态；之后引用这个账号的新任务都会受影响。";
const FEISHU_ACCOUNT_AUTH_EFFECT_LINE = "不会打断已经在运行中的任务。";
const FEISHU_DEFAULT_AUTH_TARGET_LABEL = "Themis 系统默认认证入口（默认 CODEX_HOME）";
const FEISHU_ATTACHMENT_DRAFT_CONFIRMATION = "请直接回复你的问题，我会和附件一起处理。";
const SESSION_WORKSPACE_UNAVAILABLE_ERROR = "当前会话绑定的工作区不可用，请新建会话后重新设置。";
const FEISHU_SHARED_GROUP_SCOPE_USER_ID = "__shared_group__";
const FEISHU_ATTACHMENT_LOOKUP_SCAN_LIMIT = 40;
const FEISHU_ATTACHMENT_LOOKUP_PROMPT_LIMIT = 5;

interface FeishuAttachmentLookupIntent {
  active: boolean;
  requireKeyBias: boolean;
  exactTokens: string[];
}

interface RecoveredFeishuAttachmentCandidate {
  source: "draft" | "history";
  sessionId?: string;
  name?: string;
  localPath: string;
  sourceMessageId?: string;
  createdAt: string;
  exists: boolean;
}

type ManagedAgentFollowupRunRecord = StoredAgentRunRecord & {
  nodeId?: string | null;
};

export class FeishuChannelService {
  private readonly runtime: RuntimeServiceHost;
  private readonly runtimeRegistry: TaskRuntimeRegistry;
  private readonly actionBridge: AppServerActionBridge;
  private readonly authRuntime: CodexAuthRuntime;
  private readonly taskTimeoutMs: number;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly loggerLevel: Lark.LoggerLevel;
  private readonly useEnvProxy: boolean;
  private readonly verificationToken: string;
  private readonly encryptKey: string;
  private readonly sessionStore: FeishuSessionStore;
  private readonly diagnosticsStateStore: FeishuDiagnosticsStateStore;
  private readonly attachmentDraftStore: FeishuAttachmentDraftStore;
  private readonly chatSettingsStore: FeishuChatSettingsStore;
  private readonly approvalCardStore: FeishuApprovalCardStateStore;
  private readonly updateService: ThemisUpdateService;
  private readonly workerSecretStore: WorkerSecretStore;
  private readonly themisSecretStore: ThemisSecretStore;
  private readonly logger: FeishuChannelLogger;
  private readonly cardActionHandler: Lark.CardActionHandler;
  private readonly client: Lark.Client | null;
  private readonly wsClient: Lark.WSClient | null;
  private readonly eventDispatcher: Lark.EventDispatcher | null;
  private readonly recentMessageIds = new Map<string, number>();
  private readonly recentConversationMessageTimes = new Map<string, {
    latestCreateTimeMs: number;
    seenAt: number;
  }>();
  private readonly activeSessionTasks = new Map<string, FeishuActiveSessionTask>();
  private readonly sessionMutationLocks = new Map<string, Promise<void>>();
  private started = false;

  constructor(options: FeishuChannelServiceOptions) {
    this.runtime = options.runtime;
    this.actionBridge = options.actionBridge ?? new AppServerActionBridge();
    const defaultAppServerRuntime = new AppServerTaskRuntime({
      workingDirectory: this.runtime.getWorkingDirectory(),
      runtimeStore: this.runtime.getRuntimeStore(),
      actionBridge: this.actionBridge,
    });
    this.runtimeRegistry = normalizeFeishuRuntimeRegistry(this.runtime, defaultAppServerRuntime, options.runtimeRegistry);
    this.authRuntime = options.authRuntime;
    this.taskTimeoutMs = options.taskTimeoutMs;
    this.appId = normalizeText(options.appId ?? process.env.FEISHU_APP_ID) ?? "";
    this.appSecret = normalizeText(options.appSecret ?? process.env.FEISHU_APP_SECRET) ?? "";
    this.loggerLevel = options.loggerLevel ?? parseFeishuLoggerLevel(process.env.FEISHU_LOG_LEVEL);
    this.useEnvProxy = options.useEnvProxy ?? parseBooleanEnv(process.env.FEISHU_USE_ENV_PROXY);
    this.verificationToken = normalizeText(options.verificationToken ?? process.env.FEISHU_VERIFICATION_TOKEN) ?? "";
    this.encryptKey = normalizeText(options.encryptKey ?? process.env.FEISHU_ENCRYPT_KEY) ?? "";
    this.sessionStore = options.sessionStore ?? new FeishuSessionStore();
    this.diagnosticsStateStore = options.diagnosticsStateStore ?? new FeishuDiagnosticsStateStore({
      filePath: join(this.runtime.getWorkingDirectory(), "infra/local/feishu-diagnostics.json"),
    });
    this.chatSettingsStore = options.chatSettingsStore ?? new FeishuChatSettingsStore({
      filePath: join(this.runtime.getWorkingDirectory(), "infra/local/feishu-chat-settings.json"),
    });
    this.updateService = options.updateService ?? new ThemisUpdateService({
      workingDirectory: this.runtime.getWorkingDirectory(),
    });
    this.workerSecretStore = options.workerSecretStore ?? new WorkerSecretStore({
      cwd: this.runtime.getWorkingDirectory(),
    });
    this.themisSecretStore = options.themisSecretStore ?? new ThemisSecretStore({
      cwd: this.runtime.getWorkingDirectory(),
    });
    this.approvalCardStore = options.approvalCardStore ?? new FeishuApprovalCardStateStore({
      filePath: join(this.runtime.getWorkingDirectory(), "infra/local/feishu-approval-cards.json"),
    });
    this.attachmentDraftStore = new FeishuAttachmentDraftStore({
      filePath: join(this.runtime.getWorkingDirectory(), "infra/local/feishu-attachment-drafts.json"),
    });
    this.logger = options.logger ?? console;
    this.cardActionHandler = new Lark.CardActionHandler({
      ...(this.verificationToken ? { verificationToken: this.verificationToken } : {}),
      ...(this.encryptKey ? { encryptKey: this.encryptKey } : {}),
      loggerLevel: this.loggerLevel,
      logger: createSilentFeishuSdkLogger() as never,
    }, async (data: InteractiveCardActionEvent) => {
      return await this.handleCardActionEvent(data);
    });

    if (this.isConfigured()) {
      const httpInstance = buildFeishuHttpInstance({
        logger: this.logger,
        useEnvProxy: this.useEnvProxy,
      });
      const baseConfig = {
        appId: this.appId,
        appSecret: this.appSecret,
        appType: Lark.AppType.SelfBuild,
        domain: Lark.Domain.Feishu,
        httpInstance,
      };

      this.client = new Lark.Client(baseConfig);
      this.eventDispatcher = new Lark.EventDispatcher({
        loggerLevel: this.loggerLevel,
      }).register({
        "im.message.receive_v1": async (data) => {
          await this.acceptMessageReceiveEvent(data);
        },
      });
      this.wsClient = new Lark.WSClient({
        ...baseConfig,
        loggerLevel: this.loggerLevel,
      });
    } else {
      this.client = null;
      this.eventDispatcher = null;
      this.wsClient = null;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.appId && this.appSecret);
  }

  async start(): Promise<void> {
    if (!this.isConfigured() || !this.wsClient || !this.eventDispatcher) {
      this.logger.info("[themis/feishu] 未检测到 FEISHU_APP_ID / FEISHU_APP_SECRET，跳过飞书长连接服务。");
      return;
    }

    if (this.started) {
      return;
    }

    await this.wsClient.start({
      eventDispatcher: this.eventDispatcher,
    });

    this.started = true;
    this.logger.info("[themis/feishu] 飞书长连接客户端已启动，实际连通性请结合后续 SDK 日志确认。");
  }

  async notifyScheduledTaskResult(input: {
    task: StoredScheduledTaskRecord;
    run: StoredScheduledTaskRunRecord;
    outcome: "completed" | "failed" | "cancelled";
    failureMessage?: string;
  }): Promise<boolean> {
    const conversation = this.resolveScheduledTaskConversation(input.task);

    if (!conversation) {
      this.logger.warn(
        `[themis/feishu] 定时任务回执丢失会话映射：task=${input.task.scheduledTaskId} session=${input.task.sessionId ?? input.task.channelSessionKey ?? "-"}`,
      );
      return false;
    }

    const text = buildScheduledTaskResultText(input);

    if (!text) {
      return false;
    }

    await this.safeSendTaggedText(conversation.chatId, text, "定时任务回执");
    return true;
  }

  async notifyManagedAgentScheduledFollowupResolved(input: {
    task: StoredScheduledTaskRecord;
    workItem: StoredAgentWorkItemRecord;
    targetAgent?: StoredManagedAgentRecord | null;
    outcome: "completed" | "failed" | "cancelled";
    runs?: ManagedAgentFollowupRunRecord[];
    latestCompletion?: {
      summary: string;
      output?: unknown;
      completedAt?: string;
    } | null;
  }): Promise<boolean> {
    const conversation = this.resolveScheduledTaskConversation(input.task);

    if (!conversation) {
      this.logger.warn(
        `[themis/feishu] 派工提前回执丢失会话映射：task=${input.task.scheduledTaskId} session=${input.task.sessionId ?? input.task.channelSessionKey ?? "-"}`,
      );
      return false;
    }

    try {
      await this.runManagedAgentScheduledFollowupResolvedTask(input, conversation);
      return true;
    } catch (error) {
      this.logger.error(
        `[themis/feishu] 派工提前回执激活 Themis 失败，回退为系统通知：task=${input.task.scheduledTaskId} workItem=${input.workItem.workItemId} error=${toErrorMessage(error)}`,
      );
    }

    const text = buildManagedAgentScheduledFollowupResolvedText(input);

    if (!text) {
      return false;
    }

    await this.safeSendTaggedText(conversation.chatId, text, "派工提前回执");
    return true;
  }

  stop(): void {
    if (!this.started || !this.wsClient) {
      return;
    }

    this.wsClient.close({ force: true });
    this.started = false;
  }

  async handleCardActionWebhook(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== "/api/feishu/card-action") {
      return false;
    }

    if (request.method !== "POST") {
      writeJsonResponse(response, 405, {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "飞书审批卡回调只支持 POST。",
        },
      });
      return true;
    }

    try {
      const payload = await readJsonRequestBody(request);
      const card = await this.cardActionHandler.invoke(payload);
      writeJsonResponse(response, 200, card);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.error(`[themis/feishu] 处理审批卡回调失败：${message}`);
      writeJsonResponse(response, 500, {
        error: {
          code: "FEISHU_CARD_ACTION_FAILED",
          message,
        },
      });
    }

    return true;
  }

  private async handleCardActionEvent(event: unknown): Promise<InteractiveCard> {
    const cardEvent = normalizeFeishuCardActionEvent(event);
    const currentUserId = normalizeText(cardEvent?.user_id) ?? normalizeText(cardEvent?.open_id);
    const cardKey = normalizeText(cardEvent?.action.value.cardKey);
    const decision = normalizeApprovalDecision(cardEvent?.action.value.decision);
    const fallbackActionId = normalizeText(cardEvent?.action.value.actionId) ?? "unknown-action";

    if (!cardEvent || !cardKey || !decision) {
      return buildFeishuApprovalInteractiveCard({
        cardKey: cardKey ?? createId("feishu-approval-card-invalid"),
        actionId: fallbackActionId,
        prompt: "审批卡参数缺失",
        status: "failed",
        message: "审批卡回调参数不完整，请改用文本命令处理。",
      });
    }

    const storedCard = this.approvalCardStore.get(cardKey);

    if (!storedCard) {
      return buildFeishuApprovalInteractiveCard({
        cardKey,
        actionId: fallbackActionId,
        prompt: "审批卡状态已丢失",
        status: "failed",
        message: "未找到对应审批卡状态，请改用文本命令处理。",
      });
    }

    if (storedCard.status !== "pending") {
      return this.renderApprovalCardSnapshot(storedCard, storedCard.status, resolveApprovalCardTerminalMessage(storedCard));
    }

    if (!currentUserId) {
      return this.renderApprovalCardSnapshot(
        storedCard,
        "failed",
        "审批卡缺少触发用户信息，请改用文本命令处理。",
      );
    }

    if (
      storedCard.actionSourceChannel === "feishu"
      && storedCard.actionOwnerUserId
      && storedCard.actionOwnerUserId !== currentUserId
    ) {
      return this.renderApprovalCardSnapshot(
        storedCard,
        "pending",
        "只有原飞书发起人可以处理这张审批卡，请切回对应账号操作。",
      );
    }

    const principalId = this.runtime.getIdentityLinkService().ensureIdentity({
      channel: "feishu",
      channelUserId: currentUserId,
    }).principalId;
    const callbackOpenId = normalizeText(cardEvent.open_id);
    const callbackTenantKey = normalizeText(cardEvent.tenant_key);

    if (storedCard.actionPrincipalId && storedCard.actionPrincipalId !== principalId) {
      return this.renderApprovalCardSnapshot(
        storedCard,
        "pending",
        "当前账号还没有接管这张审批卡对应的 Themis 身份，请先完成身份绑定后重试。",
      );
    }

    const callbackContext: FeishuIncomingContext = {
      kind: "text",
      chatId: storedCard.chatId,
      messageId: storedCard.messageId,
      userId: currentUserId,
      text: "",
      ...(callbackOpenId ? { openId: callbackOpenId } : {}),
      ...(callbackTenantKey ? { tenantKey: callbackTenantKey } : {}),
    };
    const outcome = await this.submitPendingApprovalDecision({
      actionId: storedCard.actionId,
      decision,
      context: callbackContext,
      scope: {
        sessionId: storedCard.sessionId,
        principalId: storedCard.actionPrincipalId ?? principalId,
        ...(normalizeText(storedCard.actionSourceChannel) ? { sourceChannel: storedCard.actionSourceChannel } : {}),
        ...(storedCard.actionSourceChannel === "feishu" && storedCard.actionOwnerUserId
          ? { userId: storedCard.actionOwnerUserId }
          : {}),
      },
    });

    const now = new Date().toISOString();

    if (!outcome.ok) {
      if (outcome.reason === "action_not_found" || outcome.reason === "expired") {
        this.approvalCardStore.save({
          ...storedCard,
          status: "failed",
          callbackToken: cardEvent.token,
          openMessageId: cardEvent.open_message_id,
          actorUserId: currentUserId,
          lastError: outcome.message,
          updatedAt: now,
          resolvedAt: now,
        });
      }

      return this.renderApprovalCardSnapshot(storedCard, "failed", outcome.message);
    }

    const nextStatus: FeishuApprovalCardStatus = decision === "approve" ? "approved" : "denied";
    const updatedCard = this.approvalCardStore.save({
      ...storedCard,
      status: nextStatus,
      callbackToken: cardEvent.token,
      openMessageId: cardEvent.open_message_id,
      actorUserId: currentUserId,
      updatedAt: now,
      resolvedAt: now,
    });

    return this.renderApprovalCardSnapshot(updatedCard, nextStatus, outcome.message);
  }

  private async acceptMessageReceiveEvent(event: FeishuMessageReceiveEvent): Promise<void> {
    const context = normalizeIncomingContext(event);

    if (!context) {
      this.logger.warn("[themis/feishu] 收到无法解析的飞书消息，已忽略。");
      return;
    }

    this.pruneRecentMessageIds();

    if (this.isDuplicateMessage(context.messageId)) {
      this.recordFeishuDiagnosticsEvent({
        type: "message.duplicate_ignored",
        context,
        lastMessageId: context.messageId,
        summary: "重复消息已忽略。",
        details: {
          dedupeWindowMs: FEISHU_MESSAGE_DEDUPE_TTL_MS,
        },
      });
      this.logger.info(`[themis/feishu] 忽略重复消息：message=${context.messageId}`);
      return;
    }

    const staleInfo = this.markConversationMessageAndDetectStale(context);

    if (staleInfo) {
      this.recordFeishuDiagnosticsEvent({
        type: "message.stale_ignored",
        context,
        lastMessageId: context.messageId,
        summary: "乱序旧消息已忽略。",
        details: {
          messageCreateTimeMs: staleInfo.messageCreateTimeMs,
          latestCreateTimeMs: staleInfo.latestCreateTimeMs,
        },
      });
      this.logger.info(
        `[themis/feishu] 忽略乱序旧消息：message=${context.messageId} createTime=${staleInfo.messageCreateTimeMs} latestCreateTime=${staleInfo.latestCreateTimeMs}`,
      );
      return;
    }

    this.logger.info(
      context.kind === "attachment"
        ? `[themis/feishu] 收到消息事件：chat=${context.chatId} user=${context.userId} message=${context.messageId} kind=attachment attachments=${context.attachments.length}`
        : `[themis/feishu] 收到消息事件：chat=${context.chatId} user=${context.userId} message=${context.messageId} kind=text text=${truncateText(redactSensitiveFeishuLogText(context.text), 120)}`,
    );

    void this.handleMessageReceiveEvent(context);
  }

  private async handleMessageReceiveEvent(context: FeishuIncomingContext): Promise<void> {
    try {
      const command = parseFeishuCommand(context.text);

      if (command) {
        await this.handleCommand(command, context);
        return;
      }

      const routingDecision = this.evaluateIncomingRoute(context);

      if (!routingDecision.allowed) {
        this.recordFeishuDiagnosticsEvent({
          type: "message.route_ignored",
          context,
          summary: "当前群聊消息未命中路由策略，已忽略。",
          lastMessageId: context.messageId,
          details: {
            chatType: routingDecision.chatType,
            routePolicy: routingDecision.routePolicy,
            sessionScope: routingDecision.sessionScope,
            reason: routingDecision.reason,
          },
        });
        return;
      }

      if (routingDecision.routeKey) {
        const acceptedAt = typeof context.messageCreateTimeMs === "number"
          ? new Date(context.messageCreateTimeMs).toISOString()
          : new Date().toISOString();
        this.chatSettingsStore.noteRecentRoute({
          chatId: context.chatId,
          routeKey: routingDecision.routeKey,
          acceptedAt,
        });
      }

      if (context.kind === "attachment") {
        await this.handleAttachmentMessage(context);
        return;
      }

      if (await this.tryHandleThemisSecretIntake(context)) {
        return;
      }

      if (await this.replyActivePendingInput(context)) {
        return;
      }

      await this.handleTaskMessage(context);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.error(`[themis/feishu] 处理消息失败：${message}`);
      await this.safeSendTaggedText(context.chatId, message, "执行异常");
    }
  }

  private async handleAttachmentMessage(
    context: Extract<FeishuIncomingContext, { kind: "attachment" }>,
  ): Promise<void> {
    const conversationKey = this.resolveConversationKey(context);
    const sessionId = this.sessionStore.ensureActiveSessionId(conversationKey);
    const assets = await downloadFeishuMessageResources({
      client: this.requireClient(),
      resources: context.attachments,
      targetDirectory: join(
        this.resolveAttachmentWorkingDirectory(sessionId),
        "temp",
        "feishu-attachments",
        sessionId,
        context.messageId,
      ),
    });

    this.attachmentDraftStore.appendEnvelope(createAttachmentDraftKey(conversationKey, sessionId), {
      parts: buildFeishuDraftPartsFromAssets(assets),
      assets,
    });
    await this.safeSendText(
      context.chatId,
      `已收到 ${assets.length} 个附件，${FEISHU_ATTACHMENT_DRAFT_CONFIRMATION}`,
    );
  }

  private evaluateIncomingRoute(context: FeishuIncomingContext): {
    allowed: boolean;
    chatType: string;
    routePolicy: FeishuChatRoutePolicy;
    sessionScope: FeishuChatSessionScope;
    reason: string;
    routeKey: string;
  } {
    const settings = this.readChatSettings(context);
    const routeKey = this.resolveScopedConversationUserId(context, settings);

    if (!isGroupChatType(settings.chatType)) {
      return {
        allowed: true,
        chatType: settings.chatType,
        routePolicy: settings.routePolicy,
        sessionScope: settings.sessionScope,
        reason: "p2p",
        routeKey,
      };
    }

    if (settings.routePolicy === "always") {
      return {
        allowed: true,
        chatType: settings.chatType,
        routePolicy: settings.routePolicy,
        sessionScope: settings.sessionScope,
        reason: "group_always",
        routeKey,
      };
    }

    if ((context.mentionCount ?? 0) > 0) {
      return {
        allowed: true,
        chatType: settings.chatType,
        routePolicy: settings.routePolicy,
        sessionScope: settings.sessionScope,
        reason: "group_mention",
        routeKey,
      };
    }

    const sessionId = this.sessionStore.getActiveSessionId({
      chatId: context.chatId,
      userId: routeKey,
    });
    const principalId = this.ensurePrincipalIdentity(context).principalId;

    if (sessionId && this.actionBridge.list({ sessionId, principalId }).length > 0) {
      return {
        allowed: true,
        chatType: settings.chatType,
        routePolicy: settings.routePolicy,
        sessionScope: settings.sessionScope,
        reason: "group_pending_action",
        routeKey,
      };
    }

    if (sessionId && this.activeSessionTasks.has(sessionId)) {
      return {
        allowed: true,
        chatType: settings.chatType,
        routePolicy: settings.routePolicy,
        sessionScope: settings.sessionScope,
        reason: "group_active_task",
        routeKey,
      };
    }

    const routeSeenAtMs = typeof context.messageCreateTimeMs === "number" ? context.messageCreateTimeMs : Date.now();

    if (this.chatSettingsStore.hasRecentRoute({
      chatId: context.chatId,
      routeKey,
      currentTimeMs: routeSeenAtMs,
    })) {
      return {
        allowed: true,
        chatType: settings.chatType,
        routePolicy: settings.routePolicy,
        sessionScope: settings.sessionScope,
        reason: "group_recent_route",
        routeKey,
      };
    }

    return {
      allowed: false,
      chatType: settings.chatType,
      routePolicy: settings.routePolicy,
      sessionScope: settings.sessionScope,
      reason: "group_requires_explicit_trigger",
      routeKey,
    };
  }

  private readChatSettings(context: Pick<FeishuIncomingContextBase, "chatId" | "chatType">): FeishuChatSettings {
    return this.chatSettingsStore.getChatSettings({
      chatId: context.chatId,
      chatType: context.chatType ?? null,
    });
  }

  private resolveScopedConversationUserId(
    context: Pick<FeishuIncomingContextBase, "userId">,
    settings: Pick<FeishuChatSettings, "chatType" | "sessionScope">,
  ): string {
    return isGroupChatType(settings.chatType) && settings.sessionScope === "shared"
      ? FEISHU_SHARED_GROUP_SCOPE_USER_ID
      : context.userId;
  }

  private resolveConversationKey(context: FeishuIncomingContext): FeishuConversationKey {
    const settings = this.readChatSettings(context);
    return {
      chatId: context.chatId,
      userId: this.resolveScopedConversationUserId(context, settings),
    };
  }

  private async handleGroupCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const settings = this.readChatSettings(context);

    if (!isGroupChatType(settings.chatType)) {
      await this.safeSendText(context.chatId, "当前聊天是单聊，`/group` 只在群聊中生效。");
      return;
    }

    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";
    const restArgs = args.slice(1);

    switch (subcommand) {
      case "":
      case "status":
      case "show":
        await this.sendGroupStatus(context.chatId, context);
        return;
      case "route":
        await this.updateGroupRoutePolicy(restArgs, context);
        return;
      case "session":
        await this.updateGroupSessionScope(restArgs, context);
        return;
      case "admin":
      case "admins":
        await this.handleGroupAdminCommand(restArgs, context);
        return;
      default:
        await this.sendGroupStatus(context.chatId, context, subcommand);
    }
  }

  private async sendGroupStatus(
    chatId: string,
    context: FeishuIncomingContext,
    invalidSegment?: string,
  ): Promise<void> {
    const settings = this.readChatSettings(context);
    const isAdmin = settings.adminUserIds.includes(context.userId);
    const scopedSessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));
    const lines = [
      invalidSegment ? `未识别的群设置项：${invalidSegment}` : "群设置：",
      `聊天类型：${settings.chatType}`,
      `会话策略：${settings.sessionScope}`,
      `消息路由：${settings.routePolicy}`,
      `当前用户权限：${isAdmin ? "管理员" : "普通成员"}`,
      `群管理员：${settings.adminUserIds.length > 0 ? settings.adminUserIds.join("、") : "未设置"}`,
      scopedSessionId ? `当前群会话：${scopedSessionId}` : "当前群会话：未激活",
      "",
      "/group route <smart|always>",
      "/group session <personal|shared>",
      "/group admin list",
      "/group admin add <userId>",
      "/group admin remove <userId>",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async updateGroupRoutePolicy(args: string[], context: FeishuIncomingContext): Promise<void> {
    const nextPolicy = parseGroupRoutePolicyArgument(args);

    if (!nextPolicy) {
      const settings = this.readChatSettings(context);
      await this.safeSendText(
        context.chatId,
        [
          "群设置项：/group route",
          `当前值：${settings.routePolicy}`,
          "可选值：smart | always",
          "说明：smart 要先显式触达，always 表示当前群消息默认直接进入 Themis。",
        ].join("\n"),
      );
      return;
    }

    const access = await this.ensureGroupAdminAccess(context);

    if (!access) {
      return;
    }

    const saved = this.chatSettingsStore.saveChatSettings({
      ...access.settings,
      routePolicy: nextPolicy,
      updatedAt: new Date().toISOString(),
    });
    this.recordFeishuDiagnosticsEvent({
      type: "group.route.updated",
      context,
      summary: `群消息路由已更新为：${nextPolicy}`,
      lastMessageId: context.messageId,
      details: {
        routePolicy: nextPolicy,
      },
    });
    await this.safeSendText(
      context.chatId,
      [
        ...(access.bootstrapped ? ["已将你设为当前群的首个 Themis 管理员。"] : []),
        `群消息路由已更新为：${saved.routePolicy}`,
      ].join("\n"),
    );
  }

  private async updateGroupSessionScope(args: string[], context: FeishuIncomingContext): Promise<void> {
    const nextScope = parseGroupSessionScopeArgument(args);

    if (!nextScope) {
      const settings = this.readChatSettings(context);
      await this.safeSendText(
        context.chatId,
        [
          "群设置项：/group session",
          `当前值：${settings.sessionScope}`,
          "可选值：personal | shared",
          "说明：personal 继续按人隔离会话，shared 表示当前群共用一条会话与附件草稿。",
        ].join("\n"),
      );
      return;
    }

    const access = await this.ensureGroupAdminAccess(context);

    if (!access) {
      return;
    }

    const saved = this.chatSettingsStore.saveChatSettings({
      ...access.settings,
      sessionScope: nextScope,
      updatedAt: new Date().toISOString(),
    });
    this.recordFeishuDiagnosticsEvent({
      type: "group.session.updated",
      context,
      summary: `群会话策略已更新为：${nextScope}`,
      lastMessageId: context.messageId,
      details: {
        sessionScope: nextScope,
      },
    });
    await this.safeSendText(
      context.chatId,
      [
        ...(access.bootstrapped ? ["已将你设为当前群的首个 Themis 管理员。"] : []),
        `群会话策略已更新为：${saved.sessionScope}`,
      ].join("\n"),
    );
  }

  private async handleGroupAdminCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (subcommand) {
      case "":
      case "list":
      case "ls":
        await this.sendGroupAdmins(context.chatId, context);
        return;
      case "add":
        await this.addGroupAdmin(args.slice(1), context);
        return;
      case "remove":
      case "rm":
      case "delete":
        await this.removeGroupAdmin(args.slice(1), context);
        return;
      default:
        await this.safeSendText(
          context.chatId,
          [
            `未识别的群管理员子命令：${subcommand}`,
            "/group admin list",
            "/group admin add <userId>",
            "/group admin remove <userId>",
          ].join("\n"),
        );
    }
  }

  private async sendGroupAdmins(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const settings = this.readChatSettings(context);
    const lines = [
      "群管理员：",
      ...(settings.adminUserIds.length > 0
        ? settings.adminUserIds.map((userId, index) => `${index + 1}. ${userId}`)
        : ["当前还没有设置群管理员。首次成功修改群设置的人会自动成为首个管理员。"]),
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async addGroupAdmin(args: string[], context: FeishuIncomingContext): Promise<void> {
    const userId = normalizeText(args.join(" "));

    if (!userId) {
      await this.safeSendText(context.chatId, "用法：/group admin add <userId>");
      return;
    }

    const access = await this.ensureGroupAdminAccess(context);

    if (!access) {
      return;
    }

    const saved = this.chatSettingsStore.saveChatSettings({
      ...access.settings,
      adminUserIds: dedupeTextValues([...access.settings.adminUserIds, userId]),
      updatedAt: new Date().toISOString(),
    });
    this.recordFeishuDiagnosticsEvent({
      type: "group.admin.updated",
      context,
      summary: `已添加群管理员：${userId}`,
      lastMessageId: context.messageId,
      details: {
        adminUserId: userId,
        adminCount: saved.adminUserIds.length,
      },
    });
    await this.safeSendText(
      context.chatId,
      [
        ...(access.bootstrapped ? ["已将你设为当前群的首个 Themis 管理员。"] : []),
        `已添加群管理员：${userId}`,
      ].join("\n"),
    );
  }

  private async removeGroupAdmin(args: string[], context: FeishuIncomingContext): Promise<void> {
    const userId = normalizeText(args.join(" "));

    if (!userId) {
      await this.safeSendText(context.chatId, "用法：/group admin remove <userId>");
      return;
    }

    const access = await this.ensureGroupAdminAccess(context);

    if (!access) {
      return;
    }

    if (!access.settings.adminUserIds.includes(userId)) {
      await this.safeSendText(context.chatId, `当前群管理员列表里没有：${userId}`);
      return;
    }

    if (access.settings.adminUserIds.length <= 1) {
      await this.safeSendText(context.chatId, "至少保留 1 个群管理员。");
      return;
    }

    const saved = this.chatSettingsStore.saveChatSettings({
      ...access.settings,
      adminUserIds: access.settings.adminUserIds.filter((item) => item !== userId),
      updatedAt: new Date().toISOString(),
    });
    this.recordFeishuDiagnosticsEvent({
      type: "group.admin.updated",
      context,
      summary: `已移除群管理员：${userId}`,
      lastMessageId: context.messageId,
      details: {
        adminUserId: userId,
        adminCount: saved.adminUserIds.length,
      },
    });
    await this.safeSendText(context.chatId, `已移除群管理员：${userId}`);
  }

  private async ensureGroupAdminAccess(context: FeishuIncomingContext): Promise<{
    settings: FeishuChatSettings;
    bootstrapped: boolean;
  } | null> {
    const settings = this.readChatSettings(context);

    if (!isGroupChatType(settings.chatType)) {
      await this.safeSendText(context.chatId, "当前聊天是单聊，群管理员控制只在群聊中生效。");
      return null;
    }

    if (settings.adminUserIds.length === 0) {
      return {
        settings: this.chatSettingsStore.saveChatSettings({
          ...settings,
          adminUserIds: [context.userId],
          updatedAt: new Date().toISOString(),
        }),
        bootstrapped: true,
      };
    }

    if (!settings.adminUserIds.includes(context.userId)) {
      await this.safeSendText(context.chatId, "只有当前群的 Themis 管理员才能修改群设置。");
      return null;
    }

    return {
      settings,
      bootstrapped: false,
    };
  }

  private async ensureSharedGroupSessionMutationAllowed(
    context: FeishuIncomingContext,
    commandLabel: string,
  ): Promise<boolean> {
    const settings = this.readChatSettings(context);

    if (!isGroupChatType(settings.chatType) || settings.sessionScope !== "shared") {
      return true;
    }

    if (settings.adminUserIds.includes(context.userId)) {
      return true;
    }

    await this.safeSendText(context.chatId, `当前群是 shared 会话，只有群管理员才能执行 ${commandLabel}。`);
    return false;
  }

  private isDuplicateMessage(messageId: string): boolean {
    const existing = this.recentMessageIds.get(messageId);

    if (typeof existing === "number" && Date.now() - existing < FEISHU_MESSAGE_DEDUPE_TTL_MS) {
      return true;
    }

    this.recentMessageIds.set(messageId, Date.now());
    return false;
  }

  private pruneRecentMessageIds(): void {
    const now = Date.now();

    for (const [messageId, seenAt] of this.recentMessageIds.entries()) {
      if (now - seenAt >= FEISHU_MESSAGE_DEDUPE_TTL_MS) {
        this.recentMessageIds.delete(messageId);
      }
    }

    for (const [conversationKey, state] of this.recentConversationMessageTimes.entries()) {
      if (now - state.seenAt >= FEISHU_MESSAGE_DEDUPE_TTL_MS) {
        this.recentConversationMessageTimes.delete(conversationKey);
      }
    }
  }

  private markConversationMessageAndDetectStale(context: FeishuIncomingContext): {
    messageCreateTimeMs: number;
    latestCreateTimeMs: number;
  } | null {
    if (typeof context.messageCreateTimeMs !== "number" || !Number.isFinite(context.messageCreateTimeMs)) {
      return null;
    }

    const conversationKey = `${context.chatId}::${context.userId}`;
    const existing = this.recentConversationMessageTimes.get(conversationKey);
    const now = Date.now();
    const latestCreateTimeMs = Math.max(
      existing?.latestCreateTimeMs ?? context.messageCreateTimeMs,
      context.messageCreateTimeMs,
    );

    // Attachments are staged for the next task, so we should still accept them even if
    // a newer text message has already been processed.
    if (context.kind === "attachment") {
      this.recentConversationMessageTimes.set(conversationKey, {
        latestCreateTimeMs,
        seenAt: now,
      });
      return null;
    }

    if (existing && context.messageCreateTimeMs < existing.latestCreateTimeMs) {
      this.recentConversationMessageTimes.set(conversationKey, {
        latestCreateTimeMs: existing.latestCreateTimeMs,
        seenAt: now,
      });
      return {
        messageCreateTimeMs: context.messageCreateTimeMs,
        latestCreateTimeMs: existing.latestCreateTimeMs,
      };
    }

    this.recentConversationMessageTimes.set(conversationKey, {
      latestCreateTimeMs,
      seenAt: now,
    });
    return null;
  }

  private async handleCommand(command: ParsedFeishuCommand, context: FeishuIncomingContext): Promise<void> {
    const startedAt = Date.now();
    let status = "ok";

    try {
      await this.dispatchCommand(command, context);
    } catch (error) {
      status = `error:${toErrorMessage(error)}`;
      throw error;
    } finally {
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const commandLabel = redactSensitiveFeishuLogText(normalizeText(command.raw) ?? `/${command.name}`);
      this.logger.info(
        `[themis/feishu] 斜杠命令完成：command=${commandLabel} elapsedMs=${elapsedMs} status=${status} chat=${context.chatId} message=${context.messageId}`,
      );
    }
  }

  private async dispatchCommand(command: ParsedFeishuCommand, context: FeishuIncomingContext): Promise<void> {
    switch (command.name) {
      case "help":
      case "h":
        await this.sendHelp(context.chatId, context);
        return;
      case "sessions":
      case "session":
      case "list":
      case "ls":
        await this.sendSessionList(context.chatId, context);
        return;
      case "new":
      case "n":
        await this.createNewSession(context.chatId, context);
        return;
      case "use":
      case "switch":
      case "enter":
        await this.switchSession(command.args, context);
        return;
      case "quota":
      case "credits":
      case "usage":
      case "balance":
        await this.sendQuota(context.chatId, context);
        return;
      case "skills":
        await this.handleSkillsCommand(command.args, context);
        return;
      case "mcp":
        await this.handleMcpCommand(command.args, context);
        return;
      case "plugins":
      case "plugin":
        await this.handlePluginsCommand(command.args, context);
        return;
      case "secrets":
      case "secret":
        await this.handleSecretsCommand(command.args, context);
        return;
      case "ops":
      case "operation":
      case "operations":
        await this.handleOpsCommand(command.args, context);
        return;
      case "update":
      case "upgrade":
        await this.handleUpdateCommand(command.args, context);
        return;
      case "current":
        await this.sendCurrentSession(context.chatId, context);
        return;
      case "stop":
        await this.stopCurrentSessionTask(command.args, context);
        return;
      case "review":
        await this.startReview(command.args, context);
        return;
      case "steer":
        await this.steerCurrentSession(command.args, context);
        return;
      case "workspace":
      case "ws":
        await this.handleWorkspaceCommand(command.args, context);
        return;
      case "account":
        await this.handleAccountCommand(command.args, context);
        return;
      case "link":
        await this.linkIdentity(command.args, context);
        return;
      case "settings":
      case "config":
        await this.handleSettingsCommand(command.args, context);
        return;
      case "sandbox":
        await this.updateSandboxMode(command.args, context);
        return;
      case "search":
        await this.updateWebSearchMode(command.args, context);
        return;
      case "network":
        await this.updateNetworkAccess(command.args, context);
        return;
      case "approval":
        await this.updateApprovalPolicy(command.args, context);
        return;
      case "group":
        await this.handleGroupCommand(command.args, context);
        return;
      case "approve":
        await this.resolvePendingApproval(command.args[0], "approve", context);
        return;
      case "deny":
        await this.resolvePendingApproval(command.args[0], "deny", context);
        return;
      case "reply":
        await this.replyPendingAction(command.args, context);
        return;
      case "msgupdate":
      case "updateprobe":
      case "testupdate":
        await this.probeMessageUpdate(context);
        return;
      case "restart":
        await this.sendRestartCommandNotice(context.chatId);
        return;
      case "reset":
      case "wipe":
        await this.resetPrincipalState(command.args, context);
        return;
      default:
        await this.sendUnknownCommand(context.chatId, command.raw);
    }
  }

  private async handleTaskMessage(context: Extract<FeishuIncomingContext, { kind: "text" }>): Promise<void> {
    const conversationKey = this.resolveConversationKey(context);
    const sessionId = this.sessionStore.ensureActiveSessionId(conversationKey);
    const draftKey = createAttachmentDraftKey(conversationKey, sessionId);
    const taskLease = await this.acquireSessionTaskLease(sessionId);
    const inlineAssets = await this.downloadInlineAttachments(context, sessionId);
    const reservedDraft = this.attachmentDraftStore.consume(draftKey);
    const inputEnvelope = buildFeishuInputEnvelope(context, sessionId, reservedDraft, inlineAssets);
    const recoveredAttachmentPromptSection = this.buildRecoveredAttachmentPromptSection(context);
    const inlineDraft = inlineAssets.length > 0
      ? {
        parts: buildFeishuDraftPartsFromAssets(inlineAssets),
        assets: inlineAssets,
      }
      : null;
    const bridge = new FeishuTaskMessageBridge({
      createText: async (text) => this.createTextMessage(context.chatId, text),
      updateText: async (messageId, text) => this.updateTextMessage(messageId, text),
      recallMessage: async (messageId) => this.recallMessage(messageId),
      createDraft: async (draft) => this.createMessage(context.chatId, draft),
      updateDraft: async (messageId, draft) => this.updateMessage(messageId, draft),
      sendText: async (text) => {
        await this.createAssistantMessage(context.chatId, text);
      },
      splitText: splitForFeishuText,
    });
    const router = new InMemoryCommunicationRouter();
    const adapter = new FeishuAdapter({
      deliver: async (message) => {
        try {
          const enriched = await this.decorateDeliveryMessageForMobile(message, sessionId);
          if (await this.tryDeliverApprovalCard(context, sessionId, bridge, enriched)) {
            return;
          }
          await bridge.deliver(enriched);
        } catch (error) {
          this.logger.error(`[themis/feishu] 推送任务消息失败：${toErrorMessage(error)}`);
        }
      },
    });

    router.registerAdapter(adapter);

    let normalizedRequest: TaskRequest | null = null;
    const activityTimeout = createTaskActivityTimeoutController(taskLease.signal, this.taskTimeoutMs);
    let shouldRestoreDraft = Boolean(reservedDraft) || Boolean(inlineDraft);
    const restorableDraft = inputEnvelope
      ? buildFeishuRestorableDraftFromEnvelope(inputEnvelope)
      : buildFeishuRestorableDraftFromSnapshots(reservedDraft, inlineDraft);
    const discardDraftRestore = () => {
      shouldRestoreDraft = false;
    };
    const restoreDraft = () => {
      if (!shouldRestoreDraft) {
        return;
      }

      if (!restorableDraft) {
        discardDraftRestore();
        return;
      }

      try {
        this.attachmentDraftStore.appendEnvelope(draftKey, restorableDraft);
      } catch (error) {
        this.logger.error(`[themis/feishu] 恢复附件草稿失败：${toErrorMessage(error)}`);
      } finally {
        discardDraftRestore();
      }
    };

    try {
      normalizedRequest = router.normalizeRequest(
        this.createTaskPayload(context, sessionId, {
          ...(inputEnvelope ? { inputEnvelope } : {}),
          ...(recoveredAttachmentPromptSection ? { additionalPromptSections: [recoveredAttachmentPromptSection] } : {}),
        }),
      );
      await activityTimeout.wrap(bridge.prepareResponseSlot());
      await ensureAuthAvailable(this.authRuntime, normalizedRequest);
      const selectedRuntime = resolvePublicTaskRuntime(this.runtimeRegistry, normalizedRequest.options?.runtimeEngine);

      const result = await selectedRuntime.runTask(normalizedRequest, {
        signal: activityTimeout.signal,
        finalizeResult: async (request, taskResult) => {
          const explicitAttachmentResult = finalizeFeishuOutboundAttachmentResult(taskResult);
          return await appendTaskReplyQuotaFooter(this.authRuntime, request, explicitAttachmentResult);
        },
        onEvent: async (taskEvent) => {
          activityTimeout.touch();
          if (shouldRestoreDraft && taskEvent.type === "task.started") {
            discardDraftRestore();
          }
          await activityTimeout.wrap(router.publishEvent(taskEvent));
        },
      });

      discardDraftRestore();
      await activityTimeout.wrap(router.publishResult(result));
      await this.publishTaskResultAttachmentsIfNeeded(context.chatId, normalizedRequest, result);
      await this.publishTaskInputCompileFollowupIfNeeded(context.chatId, normalizedRequest.requestId, result.status);
    } catch (error) {
      restoreDraft();
      const taskError = createTaskError(error, Boolean(normalizedRequest));

      if (normalizedRequest) {
        await router.publishError(taskError, normalizedRequest);
        await this.publishTaskInputCompileFollowupIfNeeded(context.chatId, normalizedRequest.requestId, "failed");
      } else {
        await this.safeSendTaggedText(context.chatId, taskError.message, "执行异常");
      }
    } finally {
      activityTimeout.cleanup();
      taskLease.release();
    }
  }

  private async runManagedAgentScheduledFollowupResolvedTask(
    input: {
      task: StoredScheduledTaskRecord;
      workItem: StoredAgentWorkItemRecord;
      targetAgent?: StoredManagedAgentRecord | null;
      outcome: "completed" | "failed" | "cancelled";
      runs?: ManagedAgentFollowupRunRecord[];
      latestCompletion?: {
        summary: string;
        output?: unknown;
        completedAt?: string;
      } | null;
    },
    conversation: FeishuConversationKey,
  ): Promise<void> {
    const sessionId = normalizeText(input.task.sessionId) ?? normalizeText(input.task.channelSessionKey);

    if (!sessionId) {
      throw new Error("watched follow-up 缺少 sessionId，无法激活同会话 Themis。");
    }

    const text = buildManagedAgentScheduledFollowupResolvedTaskPrompt(input);
    const context: Extract<FeishuIncomingContext, { kind: "text" }> = {
      kind: "text",
      chatId: conversation.chatId,
      messageId: `managed-agent-followup:${input.task.scheduledTaskId}:${input.workItem.workItemId}`,
      userId: input.task.channelUserId,
      text,
    };
    const taskLease = await this.acquireSessionTaskLease(sessionId, {
      interruptActiveTask: false,
    });
    const bridge = new FeishuTaskMessageBridge({
      createText: async (messageText) => this.createTextMessage(conversation.chatId, messageText),
      updateText: async (messageId, messageText) => this.updateTextMessage(messageId, messageText),
      recallMessage: async (messageId) => this.recallMessage(messageId),
      createDraft: async (draft) => this.createMessage(conversation.chatId, draft),
      updateDraft: async (messageId, draft) => this.updateMessage(messageId, draft),
      sendText: async (messageText) => {
        await this.createAssistantMessage(conversation.chatId, messageText);
      },
      splitText: splitForFeishuText,
    });
    const router = new InMemoryCommunicationRouter();
    const adapter = new FeishuAdapter({
      deliver: async (message) => {
        try {
          const enriched = await this.decorateDeliveryMessageForMobile(message, sessionId);
          if (await this.tryDeliverApprovalCard(context, sessionId, bridge, enriched)) {
            return;
          }
          await bridge.deliver(enriched);
        } catch (error) {
          this.logger.error(`[themis/feishu] 推送派工提前收口任务消息失败：${toErrorMessage(error)}`);
        }
      },
    });

    router.registerAdapter(adapter);

    let normalizedRequest: TaskRequest | null = null;
    const activityTimeout = createTaskActivityTimeoutController(taskLease.signal, this.taskTimeoutMs);

    try {
      normalizedRequest = router.normalizeRequest(this.createTaskPayload(context, sessionId, {
        additionalPromptSections: [
          "这是 Themis 内部系统事件，不是用户新发来的消息。请把它当作当前会话里刚发生的事实：关联的 watched managed-agent work item 已经提前进入终态，原定回看任务已经取消。请基于这个事实向用户更新状态和下一步计划，不要再说等待同一个 work item 出报告。",
        ],
      }));
      await activityTimeout.wrap(bridge.prepareResponseSlot());
      await ensureAuthAvailable(this.authRuntime, normalizedRequest);
      const selectedRuntime = resolvePublicTaskRuntime(this.runtimeRegistry, normalizedRequest.options?.runtimeEngine);

      const result = await selectedRuntime.runTask(normalizedRequest, {
        signal: activityTimeout.signal,
        finalizeResult: async (request, taskResult) => {
          const explicitAttachmentResult = finalizeFeishuOutboundAttachmentResult(taskResult);
          return await appendTaskReplyQuotaFooter(this.authRuntime, request, explicitAttachmentResult);
        },
        onEvent: async (taskEvent) => {
          activityTimeout.touch();
          await activityTimeout.wrap(router.publishEvent(taskEvent));
        },
      });

      await activityTimeout.wrap(router.publishResult(result));
      await this.publishTaskResultAttachmentsIfNeeded(conversation.chatId, normalizedRequest, result);
      await this.publishTaskInputCompileFollowupIfNeeded(conversation.chatId, normalizedRequest.requestId, result.status);
    } catch (error) {
      const taskError = createTaskError(error, Boolean(normalizedRequest));

      if (normalizedRequest) {
        await router.publishError(taskError, normalizedRequest);
        await this.publishTaskInputCompileFollowupIfNeeded(conversation.chatId, normalizedRequest.requestId, "failed");
      }

      throw error;
    } finally {
      activityTimeout.cleanup();
      taskLease.release();
    }
  }

  private async downloadInlineAttachments(
    context: Extract<FeishuIncomingContext, { kind: "text" }>,
    sessionId: string,
  ): Promise<FeishuMessageResourceAsset[]> {
    if (!context.attachments?.length) {
      return [];
    }

    return downloadFeishuMessageResources({
      client: this.requireClient(),
      resources: context.attachments,
      targetDirectory: join(
        this.resolveAttachmentWorkingDirectory(sessionId),
        "temp",
        "feishu-attachments",
        sessionId,
        context.messageId,
      ),
    });
  }

  private async publishTaskInputCompileFollowupIfNeeded(
    chatId: string,
    requestId: string,
    resultStatus: "completed" | "failed" | "cancelled",
  ): Promise<void> {
    if (resultStatus === "cancelled") {
      return;
    }

    const text = this.buildTaskInputCompileFollowupText(requestId);

    if (!text) {
      return;
    }

    await this.safeSendText(chatId, text);
  }

  private async publishTaskResultAttachmentsIfNeeded(
    chatId: string,
    request: TaskRequest,
    result: {
      status: "completed" | "failed" | "cancelled";
      output?: string;
      summary: string;
      structuredOutput?: Record<string, unknown>;
      touchedFiles?: string[];
    },
  ): Promise<void> {
    if (result.status !== "completed" || !this.client) {
      return;
    }

    const { plans, notices } = resolveFeishuOutboundAttachmentPlans({
      workspaceDirectory: this.resolveTaskWorkspaceDirectory(request.channelContext.sessionId),
      ...(result.structuredOutput ? { structuredOutput: result.structuredOutput } : {}),
    });

    if (plans.length === 0 && notices.length === 0) {
      return;
    }

    const deliveryNotices = [...notices];

    for (const plan of plans) {
      try {
        await this.sendResultAttachment(chatId, plan);
      } catch (error) {
        const message = `结果文件 ${plan.fileName} 回传失败：${toErrorMessage(error)}`;
        this.logger.error(`[themis/feishu] ${message}`);
        deliveryNotices.push(message);
      }
    }

    if (deliveryNotices.length > 0) {
      await this.safeSendTaggedText(chatId, deliveryNotices.join("\n"), "附件回传");
    }
  }

  private buildRecoveredAttachmentPromptSection(
    context: Extract<FeishuIncomingContext, { kind: "text" }>,
  ): string | null {
    const intent = parseFeishuAttachmentLookupIntent(context.text);
    if (!intent.active) {
      return null;
    }

    const draftCandidates = this.attachmentDraftStore
      .listRecentByUser(context.userId, FEISHU_ATTACHMENT_LOOKUP_SCAN_LIMIT)
      .flatMap((snapshot) => snapshot.assets.map((asset) => ({
        source: "draft" as const,
        sessionId: snapshot.key.sessionId,
        ...(asset.name ? { name: asset.name } : {}),
        localPath: asset.localPath,
        ...(asset.sourceMessageId ? { sourceMessageId: asset.sourceMessageId } : {}),
        createdAt: asset.createdAt,
        exists: existsSync(asset.localPath),
      })));
    const storedCandidates = this.runtime.getRuntimeStore()
      .listRecentInputAssetsByChannelUser({
        sourceChannel: "feishu",
        userId: context.userId,
        limit: FEISHU_ATTACHMENT_LOOKUP_SCAN_LIMIT,
      })
      .map((asset) => mapStoredFeishuAttachmentCandidate(asset));
    const candidates = selectRecoveredFeishuAttachmentCandidates(intent, [...draftCandidates, ...storedCandidates]);

    return formatRecoveredFeishuAttachmentPromptSection(candidates);
  }

  private resolveTaskWorkspaceDirectory(sessionId: string | undefined): string {
    if (!sessionId) {
      return this.runtime.getWorkingDirectory();
    }

    try {
      return this.resolveAttachmentWorkingDirectory(sessionId);
    } catch {
      return this.runtime.getWorkingDirectory();
    }
  }

  private async sendResultAttachment(chatId: string, plan: FeishuOutboundAttachmentPlan): Promise<void> {
    const client = this.requireClient();

    if (plan.messageType === "image") {
      const uploaded = await client.im.v1.image.create({
        data: {
          image_type: "message",
          image: createReadStream(plan.absolutePath),
        },
      });
      const imageKey = normalizeText(uploaded?.image_key);

      if (!imageKey) {
        throw new Error("飞书图片上传未返回 image_key。");
      }

      await this.createAttachmentMessage(chatId, "image", {
        image_key: imageKey,
      });
      return;
    }

    const uploaded = await client.im.v1.file.create({
      data: {
        file_type: plan.uploadFileType ?? "stream",
        file_name: plan.fileName,
        file: createReadStream(plan.absolutePath),
      },
    });
    const fileKey = normalizeText(uploaded?.file_key);

    if (!fileKey) {
      throw new Error("飞书文件上传未返回 file_key。");
    }

    await this.createAttachmentMessage(chatId, "file", {
      file_key: fileKey,
    });
  }

  private buildTaskInputCompileFollowupText(requestId: string): string | null {
    const storedInput = this.runtime.getRuntimeStore().getTurnInput(requestId);
    const messages = dedupeTextValues(
      (storedInput?.compileSummary?.warnings ?? []).map((warning) => describeFeishuTaskInputWarning(warning)),
    );

    if (messages.length === 0) {
      return null;
    }

    if (messages.length === 1) {
      return `输入说明：${messages[0]}`;
    }

    return [
      "输入说明：",
      ...messages.map((message) => `- ${message}`),
    ].join("\n");
  }

  private async decorateDeliveryMessageForMobile(
    message: FeishuDeliveryMessage,
    sessionId: string,
  ): Promise<FeishuDeliveryMessage> {
    const sessionState = await this.readFeishuMobileSessionState(sessionId);

    if (message.kind === "event" && message.title === "task.action_required") {
      const metadata = asRecord(message.metadata);
      const actionId = normalizeText(metadata?.actionId);
      const actionType = normalizePendingActionType(metadata?.actionType);
      const prompt = normalizeText(metadata?.prompt) ?? normalizeText(message.text);

      if (!actionId || !actionType || !prompt) {
        return message;
      }

      return {
        ...message,
        text: renderFeishuWaitingActionSurface({
          sessionId,
          actionId,
          actionType,
          prompt,
          ...(sessionState.latestStatus ? { latestStatus: sessionState.latestStatus } : {}),
          ...(sessionState.thread !== undefined ? { thread: sessionState.thread } : {}),
        }),
      };
    }

    if (message.kind === "event" && shouldRenderFeishuStatusSurface(message)) {
      return {
        ...message,
        text: renderFeishuTaskStatusSurface({
          phase: resolveFeishuTaskStatusPhase(message),
          sessionId,
          summary: message.text,
        }),
        metadata: {
          ...(asRecord(message.metadata) ?? {}),
          feishuSurfaceKind: "status",
        },
      };
    }

    return message;
  }

  private async tryDeliverApprovalCard(
    context: Extract<FeishuIncomingContext, { kind: "text" }>,
    sessionId: string,
    bridge: FeishuTaskMessageBridge,
    message: FeishuDeliveryMessage,
  ): Promise<boolean> {
    if (message.kind !== "event" || message.title !== "task.action_required") {
      return false;
    }

    const metadata = asRecord(message.metadata);
    const actionId = normalizeText(metadata?.actionId);
    const actionType = normalizePendingActionType(metadata?.actionType);
    const prompt = normalizeText(message.text) ?? normalizeText(metadata?.prompt);
    const taskId = normalizeText(message.taskId);

    if (!actionId || actionType !== "approval" || !prompt || !taskId) {
      return false;
    }

    const cardKey = createId("feishu-approval-card");
    const draft = renderFeishuApprovalCard({
      cardKey,
      actionId,
      prompt,
      status: "pending",
    });
    const principalId = this.ensurePrincipalIdentity(context).principalId;
    const pendingAction = this.actionBridge.find(actionId);
    const now = new Date().toISOString();

    try {
      const mutation = await bridge.replaceCurrentPlaceholderWithDraft(draft);
      const storedMessageId = normalizeText(mutation.messageId) ?? createId("feishu-card-message");

      this.approvalCardStore.save({
        cardKey,
        chatId: context.chatId,
        messageId: storedMessageId,
        sessionId,
        taskId,
        requestId: message.requestId,
        actionId,
        prompt,
        status: "pending",
        actionSourceChannel: pendingAction?.scope?.sourceChannel ?? "feishu",
        actionOwnerUserId: pendingAction?.scope?.userId ?? context.userId,
        actionPrincipalId: pendingAction?.scope?.principalId ?? principalId,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    } catch (error) {
      this.logger.warn(`[themis/feishu] 审批卡发送失败，回退文本 waiting action：${toErrorMessage(error)}`);
      return false;
    }
  }

  private renderApprovalCardSnapshot(
    record: Pick<FeishuApprovalCardRecord, "cardKey" | "actionId" | "prompt">,
    status: FeishuApprovalCardStatus,
    message?: string | null,
  ): InteractiveCard {
    const normalizedMessage = normalizeText(message ?? undefined);
    return buildFeishuApprovalInteractiveCard({
      cardKey: record.cardKey,
      actionId: record.actionId,
      prompt: record.prompt,
      status,
      ...(normalizedMessage ? { message: normalizedMessage } : {}),
    });
  }

  private async readFeishuMobileSessionState(sessionId: string): Promise<{
    latestStatus: string | null;
    latestSummary: string | null;
    workspacePath: string | null;
    thread: Awaited<ReturnType<typeof readSessionNativeThreadSummary>>;
  }> {
    const runtimeStore = this.runtime.getRuntimeStore();
    const session = runtimeStore.listRecentSessions(200).find((entry) => entry.sessionId === sessionId) ?? null;
    const thread = await readSessionNativeThreadSummary(runtimeStore, sessionId, this.runtimeRegistry);
    const sessionSettings = this.readSessionTaskSettings(sessionId);

    return {
      latestStatus: normalizeText(session?.latestTurn.status),
      latestSummary: normalizeText(session?.latestTurn.summary) ?? normalizeText(session?.latestTurn.goal),
      workspacePath: normalizeText(sessionSettings.workspacePath),
      thread,
    };
  }

  private async acquireSessionTaskLease(
    sessionId: string,
    options: FeishuSessionTaskLeaseOptions = {},
  ): Promise<FeishuSessionTaskLease> {
    if (options.interruptActiveTask === false) {
      return await this.acquireQueuedSessionTaskLease(sessionId);
    }

    return this.withSessionMutation(sessionId, async () => {
      await this.abortActiveSessionTask(
        sessionId,
        "FEISHU_SESSION_REPLACED",
        `[themis/feishu] 新消息将打断当前会话任务：session=${sessionId}`,
      );

      return this.createSessionTaskLease(sessionId);
    });
  }

  private async acquireQueuedSessionTaskLease(sessionId: string): Promise<FeishuSessionTaskLease> {
    while (true) {
      const existingTask = this.activeSessionTasks.get(sessionId);

      if (existingTask) {
        await existingTask.completed;
        continue;
      }

      const lease = await this.withSessionMutation(sessionId, async () => {
        if (this.activeSessionTasks.has(sessionId)) {
          return null;
        }

        return this.createSessionTaskLease(sessionId);
      });

      if (lease) {
        return lease;
      }
    }
  }

  private createSessionTaskLease(sessionId: string): FeishuSessionTaskLease {
    const abortController = new AbortController();
    const token = Symbol(sessionId);
    let markCompleted = (): void => {};
    const completed = new Promise<void>((resolve) => {
      markCompleted = resolve;
    });

    this.activeSessionTasks.set(sessionId, {
      token,
      abortController,
      completed,
    });

    return {
      signal: abortController.signal,
      release: () => {
        markCompleted();

        const currentTask = this.activeSessionTasks.get(sessionId);

        if (currentTask?.token === token) {
          this.activeSessionTasks.delete(sessionId);
        }
      },
    };
  }

  private async abortActiveSessionTask(sessionId: string, reason: string, logMessage: string): Promise<boolean> {
    const existingTask = this.activeSessionTasks.get(sessionId);

    if (!existingTask) {
      return false;
    }

    this.logger.info(logMessage);
    existingTask.abortController.abort(new Error(reason));
    await existingTask.completed;
    return true;
  }

  private async withSessionMutation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previousLock = this.sessionMutationLocks.get(sessionId) ?? Promise.resolve();
    let releaseLock = (): void => {};
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.sessionMutationLocks.set(sessionId, currentLock);

    await previousLock.catch(() => {});

    try {
      return await operation();
    } finally {
      releaseLock();

      if (this.sessionMutationLocks.get(sessionId) === currentLock) {
        this.sessionMutationLocks.delete(sessionId);
      }
    }
  }

  private createTaskPayload(
    context: Extract<FeishuIncomingContext, { kind: "text" }>,
    sessionId: string,
    input?: {
      additionalPromptSections?: string[];
      inputEnvelope?: TaskInputEnvelope;
      attachments?: FeishuTaskPayload["attachments"];
    },
  ): FeishuTaskPayload {
    const principalSettings = this.readPrincipalTaskSettings(context);
    const options = isPrincipalTaskSettingsEmpty(principalSettings) ? undefined : principalSettings;
    const inputEnvelope = input?.inputEnvelope;
    const attachments = input?.attachments ?? (inputEnvelope ? buildLegacyAttachmentsFromEnvelope(inputEnvelope) : undefined);

    return {
      source: "feishu",
      taskId: createId("task"),
      sessionId,
      goal: context.text,
      inputText: context.text,
      sender: {
        userId: context.userId,
        ...(context.openId ? { openId: context.openId } : {}),
        ...(context.tenantKey ? { tenantKey: context.tenantKey } : {}),
      },
      message: {
        messageId: context.messageId,
        chatId: context.chatId,
        ...(context.threadId ? { threadId: context.threadId } : {}),
        text: context.text,
      },
      ...(input?.additionalPromptSections?.length ? { additionalPromptSections: input.additionalPromptSections } : {}),
      ...(inputEnvelope ? { inputEnvelope } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(options ? { options } : {}),
      createdAt: new Date().toISOString(),
    };
  }

  private ensurePrincipalIdentity(context: FeishuIncomingContext): { principalId: string; principalDisplayName?: string } {
    return this.runtime.getIdentityLinkService().ensureIdentity({
      channel: "feishu",
      channelUserId: context.userId,
    });
  }

  private readPrincipalTaskSettings(context: FeishuIncomingContext): PrincipalTaskSettings {
    const principal = this.ensurePrincipalIdentity(context);
    return this.runtime.getPrincipalTaskSettings(principal.principalId) ?? {};
  }

  private writePrincipalTaskSettings(
    context: FeishuIncomingContext,
    patch: unknown,
  ): { principalId: string; settings: PrincipalTaskSettings } {
    const principal = this.ensurePrincipalIdentity(context);
    const current = this.runtime.getPrincipalTaskSettings(principal.principalId) ?? {};
    const next = normalizePrincipalTaskSettings({
      ...current,
      ...(typeof patch === "object" && patch !== null ? patch : {}),
    });

    return {
      principalId: principal.principalId,
      settings: this.runtime.savePrincipalTaskSettings(principal.principalId, next),
    };
  }

  private readSessionTaskSettings(sessionId: string): SessionTaskSettings {
    return this.runtime.getRuntimeStore().getSessionTaskSettings(sessionId)?.settings ?? {};
  }

  private writeSessionTaskSettings(sessionId: string, patch: unknown) {
    return persistSessionTaskSettings(
      this.runtime.getRuntimeStore(),
      sessionId,
      patch,
      new Date().toISOString(),
    );
  }

  private async sendSessionSettings(
    chatId: string,
    context: FeishuIncomingContext,
    invalidSegment?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const runtimeConfig = await this.readRuntimeConfig();
    const effective = resolveEffectivePrincipalSettings(settings, runtimeConfig);
    const accountState = resolvePrincipalAccountState({
      accounts: this.authRuntime.listAccounts(),
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId: normalizeText(settings.authAccountId),
    });
    const lines = [
      invalidSegment ? `未识别的设置项：${invalidSegment}` : "Themis 设置：",
      `当前 principal：${principal.principalId}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      "",
      "/settings model",
      `当前值：${formatSettingSummaryValue(effective.model, Boolean(settings.model))}`,
      "/settings reasoning",
      `当前值：${formatSettingSummaryValue(effective.reasoning, Boolean(settings.reasoning))}`,
      "/settings sandbox",
      `当前值：${formatSettingSummaryValue(effective.sandboxMode, Boolean(settings.sandboxMode))}`,
      "/settings search",
      `当前值：${formatSettingSummaryValue(effective.webSearchMode, Boolean(settings.webSearchMode))}`,
      "/settings network",
      `当前值：${formatSettingSummaryValue(formatBooleanCommandValue(effective.networkAccessEnabled), typeof settings.networkAccessEnabled === "boolean")}`,
      "/settings approval",
      `当前值：${formatSettingSummaryValue(effective.approvalPolicy, Boolean(settings.approvalPolicy))}`,
      "/settings account",
      `当前值：${describePrincipalAccountCurrentValue(accountState)}`,
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async readRuntimeConfig(): Promise<CodexRuntimeCatalog | null> {
    try {
      return applyThemisGlobalDefaultsToRuntimeCatalog(await this.runtime.readRuntimeConfig());
    } catch (error) {
      this.logger.warn(`[themis/feishu] 读取运行时默认配置失败：${toErrorMessage(error)}`);
      return null;
    }
  }

  private async handleSettingsCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";
    const restArgs = args.slice(1);

    switch (subcommand) {
      case "":
        await this.sendSessionSettings(context.chatId, context);
        return;
      case "model":
        await this.updateModelSetting(restArgs, context);
        return;
      case "reasoning":
        await this.updateReasoningSetting(restArgs, context);
        return;
      case "sandbox":
        await this.updateSandboxMode(restArgs, context);
        return;
      case "search":
        await this.updateWebSearchMode(restArgs, context);
        return;
      case "network":
        await this.updateNetworkAccess(restArgs, context);
        return;
      case "approval":
        await this.updateApprovalPolicy(restArgs, context);
        return;
      case "account":
        await this.handleAccountCommand(restArgs, context);
        return;
      default:
        await this.sendSessionSettings(context.chatId, context, subcommand);
    }
  }

  private async handleAccountCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";
    const restArgs = args.slice(1);

    switch (subcommand) {
      case "":
        await this.sendAccountSettings(context.chatId, context);
        return;
      case "list":
      case "ls":
        await this.sendAccountList(context.chatId, context);
        return;
      case "current":
      case "show":
      case "status":
        await this.sendCurrentAccount(context.chatId, context);
        return;
      case "use":
      case "switch":
      case "set":
        await this.useAccount(restArgs, context);
        return;
      case "login":
        await this.handleAccountLoginCommand(restArgs, context);
        return;
      case "logout":
      case "signout":
        await this.logoutAccount(restArgs, context);
        return;
      case "cancel":
        await this.cancelAccountLogin(restArgs, context);
        return;
      default:
        await this.sendAccountSettings(context.chatId, context, subcommand);
    }
  }

  private async sendAccountSettings(chatId: string, context: FeishuIncomingContext, invalidSegment?: string): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const accountState = resolvePrincipalAccountState({
      accounts: this.authRuntime.listAccounts(),
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId: normalizeText(settings.authAccountId),
    });
    const lines = [
      invalidSegment ? `未识别的账号设置项：${invalidSegment}` : "认证与账号：",
      `当前 principal：${principal.principalId}`,
      `当前默认：${describePrincipalAccountCurrentValue(accountState)}`,
      FEISHU_ACCOUNT_SETTINGS_SCOPE_LINE,
      FEISHU_ACCOUNT_SETTINGS_EFFECT_LINE,
      "",
      "默认账号",
      "/settings account current 查看当前默认账号和认证状态",
      "/settings account list 查看可用账号列表",
      "/settings account use <账号名|邮箱|序号|default> 切换默认账号",
      "",
      "登录状态",
      "/settings account login device [目标] 发起设备码登录",
      "/settings account logout [目标] 退出账号登录",
      "/settings account cancel [目标] 取消进行中的登录",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendAccountList(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const accounts = this.authRuntime.listAccounts();
    const activeAccount = this.authRuntime.getActiveAccount();
    const settings = this.readPrincipalTaskSettings(context);
    const accountState = resolvePrincipalAccountState({
      accounts,
      activeAccount,
      principalAccountId: normalizeText(settings.authAccountId),
    });

    if (!accounts.length) {
      await this.safeSendText(
        chatId,
        [`当前 principal：${principal.principalId}`, "当前还没有可用认证账号。"].join("\n"),
      );
      return;
    }

    const lines = [
      `当前 principal：${principal.principalId}`,
      `当前默认：${describePrincipalAccountCurrentValue(accountState)}`,
      "",
      "认证账号：",
      ...accounts.map((account, index) => {
        const markers = [
          account.accountId === activeAccount?.accountId ? "系统默认" : "",
          account.accountId === accountState.principalAccountId ? "principal 默认" : "",
          !accountState.principalAccountId && account.accountId === activeAccount?.accountId ? "当前生效" : "",
        ].filter(Boolean);
        const markerText = markers.length ? `（${markers.join("｜")}）` : "";
        return `${index + 1}. ${formatAuthAccountLabel(account)}${markerText}`;
      }),
      "",
      "切换默认账号：/settings account use <账号名|邮箱|序号|default>",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendCurrentAccount(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const accounts = this.authRuntime.listAccounts();
    const settings = this.readPrincipalTaskSettings(context);
    const accountState = resolvePrincipalAccountState({
      accounts,
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId: normalizeText(settings.authAccountId),
    });

    if (accountState.principalAccountId && !accountState.configuredAccount) {
      await this.safeSendText(
        chatId,
        [
          `当前 principal：${principal.principalId}`,
          `当前 principal 默认认证账号已失效：${accountState.principalAccountId}`,
          "请执行 /settings account list 查看可选账号，并重新设置。",
        ].join("\n"),
      );
      return;
    }

    const resolvedAccountId = accountState.effectiveAccountId;

    if (!resolvedAccountId) {
      await this.safeSendText(chatId, [`当前 principal：${principal.principalId}`, "当前还没有可用认证账号。"].join("\n"));
      return;
    }

    const snapshot = await this.authRuntime.readSnapshot(accountState.principalAccountId ?? undefined);
    const account = findAuthAccountById(accounts, snapshot.accountId || resolvedAccountId) ?? accountState.configuredAccount;
    const lines = [
      "认证状态：",
      `当前 principal：${principal.principalId}`,
      `当前默认：${describePrincipalAccountCurrentValue(accountState)}`,
      resolvedAccountId ? `当前生效账号：${formatAuthAccountLabel(account, resolvedAccountId)}` : null,
      `认证方式：${snapshot.authMethod ?? "unknown"}`,
      snapshot.account?.email ? `账号：${snapshot.account.email}` : null,
      snapshot.account?.planType ? `套餐：${snapshot.account.planType}` : null,
      ...describeAuthSnapshotLines(snapshot),
    ].filter((line): line is string => Boolean(line));

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async useAccount(args: string[], context: FeishuIncomingContext): Promise<void> {
    const target = normalizeText(args.join(" "));

    if (!target) {
      await this.sendAccountUseHelp(context.chatId, context);
      return;
    }

    const accounts = this.authRuntime.listAccounts();
    const normalizedTarget = target.toLowerCase();

    if (["default", "active", "follow", "clear"].includes(normalizedTarget)) {
      const saved = this.writePrincipalTaskSettings(context, {
        authAccountId: "",
      });
      const activeAccount = this.authRuntime.getActiveAccount();
      const lines = [
        `当前 principal：${saved.principalId}`,
        activeAccount
          ? `默认认证账号已改为：跟随 Themis 系统默认账号 ${formatAuthAccountLabel(activeAccount)}`
          : "默认认证账号已改为：跟随 Themis 系统默认账号",
        FEISHU_SETTINGS_EFFECT_LINE,
        "查看：/settings account current",
      ];

      await this.safeSendText(context.chatId, lines.join("\n"));
      return;
    }

    let resolvedAccountId: string | null = null;

    if (/^\d+$/.test(target)) {
      const index = Number.parseInt(target, 10);
      resolvedAccountId = accounts[index - 1]?.accountId ?? null;
    } else {
      resolvedAccountId = findAuthAccountByQuery(accounts, target)?.accountId ?? null;
    }

    if (!resolvedAccountId) {
      await this.sendAccountUseHelp(context.chatId, context, target);
      return;
    }

    const account = findAuthAccountById(accounts, resolvedAccountId);
    const saved = this.writePrincipalTaskSettings(context, {
      authAccountId: resolvedAccountId,
    });
    const lines = [
      `当前 principal：${saved.principalId}`,
      `默认认证账号已更新为：${formatAuthAccountLabel(account, resolvedAccountId)}`,
      FEISHU_SETTINGS_EFFECT_LINE,
      "查看：/settings account current",
    ];

    await this.safeSendText(context.chatId, lines.join("\n"));
  }

  private async sendAccountUseHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const accounts = this.authRuntime.listAccounts();
    const accountState = resolvePrincipalAccountState({
      accounts,
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId: normalizeText(settings.authAccountId),
    });
    const lines = [
      invalidValue ? `没有找到对应认证账号：${invalidValue}` : "设置项：/settings account use",
      `当前 principal：${principal.principalId}`,
      `当前默认：${describePrincipalAccountCurrentValue(accountState)}`,
      "说明：这里只改默认账号，不会直接变更登录状态。",
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      "用法：/settings account use <账号名|邮箱|序号|default>",
      "示例：/settings account use 2",
      "示例：/settings account use default",
    ];

    if (accounts.length) {
      lines.push("", "可用账号：");
      lines.push(
        ...accounts.map((account, index) => {
          const markers = [
            account.accountId === accountState.principalAccountId ? "principal 默认" : "",
            !accountState.principalAccountId && account.accountId === accountState.activeAccount?.accountId ? "当前生效" : "",
          ].filter(Boolean);
          const markerText = markers.length ? `（${markers.join("｜")}）` : "";
          return `${index + 1}. ${formatAuthAccountLabel(account)}${markerText}`;
        }),
      );
    }

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async handleAccountLoginCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";
    const restArgs = args.slice(1);

    switch (subcommand) {
      case "":
        await this.sendAccountLoginHelp(context.chatId, context);
        return;
      case "device":
        await this.startDeviceLogin(restArgs, context);
        return;
      default:
        await this.sendAccountLoginHelp(context.chatId, context, subcommand);
        return;
    }
  }

  private async sendAccountLoginHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidSegment?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const accounts = this.authRuntime.listAccounts();
    const accountState = resolvePrincipalAccountState({
      accounts,
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId: normalizeText(settings.authAccountId),
    });
    const lines = [
      invalidSegment ? `未识别的账号登录方式：${invalidSegment}` : "账号登录：",
      `当前 principal：${principal.principalId}`,
      `当前默认：${describePrincipalAccountCurrentValue(accountState)}`,
      FEISHU_ACCOUNT_AUTH_SCOPE_LINE,
      FEISHU_ACCOUNT_AUTH_EFFECT_LINE,
      "飞书端当前只支持设备码登录；浏览器登录请改用 Web。",
      "默认目标：如果当前 principal 固定了账号，就操作该账号；否则操作 Themis 系统默认认证入口。",
      "用法：/settings account login device [账号名|邮箱|序号|default]",
      "示例：/settings account login device",
      "示例：/settings account login device 2",
      "示例：/settings account login device default",
    ];

    if (accounts.length) {
      lines.push("", "可用账号：");
      lines.push(...accounts.map((account, index) => `${index + 1}. ${formatAuthAccountLabel(account)}`));
    }

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async startDeviceLogin(args: string[], context: FeishuIncomingContext): Promise<void> {
    const resolved = this.resolveAccountAuthCommandTarget(args, context);

    if (!resolved.ok) {
      await this.sendAccountCommandTargetError(context.chatId, context, resolved, "login");
      return;
    }

    const snapshot = await this.authRuntime.startChatgptDeviceLogin(resolved.targetAccountId);
    const lines = [
      "设备码登录：",
      `当前 principal：${resolved.principalId}`,
      `操作目标：${resolved.targetLabel}`,
    ];

    if (snapshot.authenticated) {
      lines.push("当前账号已经处于已认证状态，无需重新发起设备码登录。");
    } else if (snapshot.pendingLogin?.mode === "device") {
      lines.push("设备码登录已发起。");
    } else {
      lines.push("设备码登录已发起，但当前还没读到完整设备码信息。");
    }

    lines.push(...describeAuthSnapshotLines(snapshot));
    await this.safeSendText(context.chatId, dedupeLines(lines).join("\n"));
  }

  private async logoutAccount(args: string[], context: FeishuIncomingContext): Promise<void> {
    const resolved = this.resolveAccountAuthCommandTarget(args, context);

    if (!resolved.ok) {
      await this.sendAccountCommandTargetError(context.chatId, context, resolved, "logout");
      return;
    }

    const lines = [
      `当前 principal：${resolved.principalId}`,
      `目标账号：${resolved.targetLabel}`,
    ];

    let snapshot;

    if (resolved.targetKind === "system-default") {
      const activeAccount = this.authRuntime.getActiveAccount();
      snapshot = await this.authRuntime.logout("default");

      if (activeAccount?.accountId) {
        await this.authRuntime.logout(activeAccount.accountId);
        lines.push(`已同时清理当前系统默认镜像账号：${formatAuthAccountLabel(activeAccount)}`);
      }
    } else {
      snapshot = await this.authRuntime.logout(resolved.targetAccountId);
    }

    lines.unshift("账号已退出：");
    lines.push(`已退出认证账号：${resolved.targetLabel}`);
    lines.push(...describeAuthSnapshotLines(snapshot));
    await this.safeSendText(context.chatId, dedupeLines(lines).join("\n"));
  }

  private async cancelAccountLogin(args: string[], context: FeishuIncomingContext): Promise<void> {
    const resolved = this.resolveAccountAuthCommandTarget(args, context);

    if (!resolved.ok) {
      await this.sendAccountCommandTargetError(context.chatId, context, resolved, "cancel");
      return;
    }

    const snapshot = await this.authRuntime.cancelPendingLogin(resolved.targetAccountId);
    const lines = [
      "已取消登录：",
      `当前 principal：${resolved.principalId}`,
      `操作目标：${resolved.targetLabel}`,
      `已取消认证账号登录：${resolved.targetLabel}`,
      ...describeAuthSnapshotLines(snapshot),
    ];
    await this.safeSendText(context.chatId, dedupeLines(lines).join("\n"));
  }

  private async sendAccountCommandTargetError(
    chatId: string,
    context: FeishuIncomingContext,
    resolved: Extract<FeishuResolvedAccountCommandTarget, { ok: false }>,
    command: "login" | "logout" | "cancel",
  ): Promise<void> {
    if (resolved.reason === "missing_configured_account") {
      await this.safeSendText(
        chatId,
        [
          `当前 principal：${resolved.principalId}`,
          `当前 principal 默认认证账号已失效：${resolved.accountId}`,
          "请执行 /settings account list 查看可选账号，并重新设置，或在命令里显式指定目标账号。",
        ].join("\n"),
      );
      return;
    }

    const help =
      command === "login"
        ? await this.sendAccountLoginHelp(chatId, context, resolved.invalidValue)
        : await this.sendAccountAuthActionHelp(chatId, context, command, resolved.invalidValue);
    return help;
  }

  private async sendAccountAuthActionHelp(
    chatId: string,
    context: FeishuIncomingContext,
    command: "logout" | "cancel",
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const accounts = this.authRuntime.listAccounts();
    const accountState = resolvePrincipalAccountState({
      accounts,
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId: normalizeText(settings.authAccountId),
    });
    const commandLabel = `/settings account ${command}`;
    const lines = [
      invalidValue ? `没有找到对应认证账号：${invalidValue}` : `设置项：${commandLabel}`,
      `当前 principal：${principal.principalId}`,
      `当前默认：${describePrincipalAccountCurrentValue(accountState)}`,
      FEISHU_ACCOUNT_AUTH_SCOPE_LINE,
      FEISHU_ACCOUNT_AUTH_EFFECT_LINE,
      "默认目标：如果当前 principal 固定了账号，就操作该账号；否则操作 Themis 系统默认认证入口。",
      `用法：${commandLabel} [账号名|邮箱|序号|default]`,
      `示例：${commandLabel}`,
      `示例：${commandLabel} 2`,
      `示例：${commandLabel} default`,
    ];

    if (accounts.length) {
      lines.push("", "可用账号：");
      lines.push(...accounts.map((account, index) => `${index + 1}. ${formatAuthAccountLabel(account)}`));
    }

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private resolveAccountAuthCommandTarget(
    args: string[],
    context: FeishuIncomingContext,
  ): FeishuResolvedAccountCommandTarget {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const accounts = this.authRuntime.listAccounts();
    const accountState = resolvePrincipalAccountState({
      accounts,
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId: normalizeText(settings.authAccountId),
    });
    const target = normalizeText(args.join(" "));

    if (!target) {
      if (accountState.principalAccountId && !accountState.configuredAccount) {
        return {
          ok: false,
          reason: "missing_configured_account",
          principalId: principal.principalId,
          accountId: accountState.principalAccountId,
        };
      }

      if (accountState.principalAccountId && accountState.configuredAccount) {
        return {
          ok: true,
          principalId: principal.principalId,
          targetAccountId: accountState.principalAccountId,
          targetAccount: accountState.configuredAccount,
          targetLabel: formatAuthAccountLabel(accountState.configuredAccount, accountState.principalAccountId),
          targetKind: "visible-account",
        };
      }

      return {
        ok: true,
        principalId: principal.principalId,
        targetAccountId: "default",
        targetAccount: null,
        targetLabel: FEISHU_DEFAULT_AUTH_TARGET_LABEL,
        targetKind: "system-default",
      };
    }

    const normalizedTarget = target.toLowerCase();

    if (["default", "active", "system", "follow"].includes(normalizedTarget)) {
      return {
        ok: true,
        principalId: principal.principalId,
        targetAccountId: "default",
        targetAccount: null,
        targetLabel: FEISHU_DEFAULT_AUTH_TARGET_LABEL,
        targetKind: "system-default",
      };
    }

    const account = /^\d+$/.test(target)
      ? accounts[Number.parseInt(target, 10) - 1] ?? null
      : findAuthAccountByQuery(accounts, target);

    if (!account) {
      return {
        ok: false,
        reason: "invalid_target",
        principalId: principal.principalId,
        invalidValue: target,
      };
    }

    return {
      ok: true,
      principalId: principal.principalId,
      targetAccountId: account.accountId,
      targetAccount: account,
      targetLabel: formatAuthAccountLabel(account, account.accountId),
      targetKind: "visible-account",
    };
  }

  private async sendSandboxSetting(chatId: string, context: FeishuIncomingContext, invalidValue?: string): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const runtimeConfig = await this.readRuntimeConfig();
    const effective = resolveEffectivePrincipalSettings(settings, runtimeConfig);
    const lines = [
      invalidValue ? `无效取值：${invalidValue}` : "设置项：/settings sandbox",
      `当前 principal：${principal.principalId}`,
      `当前值：${effective.sandboxMode ?? "未配置"}`,
      `来源：${formatSettingSourceLabel(Boolean(settings.sandboxMode))}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      `可选值：${SANDBOX_MODES.join(" | ")}`,
      "示例：/settings sandbox workspace-write",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async updateSandboxMode(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!args.length) {
      await this.sendSandboxSetting(context.chatId, context);
      return;
    }

    const sandboxMode = parseSandboxModeArgument(args);

    if (sandboxMode === null) {
      await this.sendSandboxSetting(context.chatId, context, args.join(" "));
      return;
    }

    const saved = this.writePrincipalTaskSettings(context, { sandboxMode });
    await this.sendPrincipalSettingUpdatedMessage(
      context.chatId,
      saved.principalId,
      "沙箱模式",
      sandboxMode,
      "/settings sandbox",
    );
  }

  private async sendModelSetting(chatId: string, context: FeishuIncomingContext, invalidValue?: string): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const runtimeConfig = await this.readRuntimeConfig();
    const effective = resolveEffectivePrincipalSettings(settings, runtimeConfig);
    const modelChoices = listAvailablePrincipalModelIds(runtimeConfig, settings.model ?? effective.model);
    const lines = [
      invalidValue ? `无效取值：${invalidValue}` : "设置项：/settings model",
      `当前 principal：${principal.principalId}`,
      `当前值：${effective.model ?? "未配置"}`,
      `来源：${formatSettingSourceLabel(Boolean(settings.model))}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      `可选值：${modelChoices.length ? modelChoices.join(" | ") : "当前运行时未返回模型列表"}`,
      "恢复默认：/settings model default",
      `示例：/settings model ${modelChoices[0] ?? "gpt-5.4"}`,
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async updateModelSetting(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!args.length) {
      await this.sendModelSetting(context.chatId, context);
      return;
    }

    const runtimeConfig = await this.readRuntimeConfig();
    const currentSettings = this.readPrincipalTaskSettings(context);
    const rawValue = normalizeText(args.join(" "));

    if (!rawValue) {
      await this.sendModelSetting(context.chatId, context);
      return;
    }

    if (isDefaultSettingArgument(rawValue)) {
      const saved = this.writePrincipalTaskSettings(context, { model: "" });
      const effective = resolveEffectivePrincipalSettings(saved.settings, runtimeConfig);
      await this.sendPrincipalSettingClearedMessage(
        context.chatId,
        saved.principalId,
        "默认模型",
        effective.model,
        "/settings model",
      );
      return;
    }

    const model = resolveRuntimeModelArgument(rawValue, runtimeConfig, currentSettings.model);

    if (!model) {
      await this.sendModelSetting(context.chatId, context, rawValue);
      return;
    }

    const saved = this.writePrincipalTaskSettings(context, { model });
    await this.sendPrincipalSettingUpdatedMessage(
      context.chatId,
      saved.principalId,
      "默认模型",
      model,
      "/settings model",
    );
  }

  private async sendReasoningSetting(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const runtimeConfig = await this.readRuntimeConfig();
    const effective = resolveEffectivePrincipalSettings(settings, runtimeConfig);
    const reasoningChoices = listAvailablePrincipalReasoningChoices(
      runtimeConfig,
      effective.model,
      settings.reasoning ?? effective.reasoning,
    );
    const lines = [
      invalidValue ? `无效取值：${invalidValue}` : "设置项：/settings reasoning",
      `当前 principal：${principal.principalId}`,
      `当前模型：${effective.model ?? "未配置"}`,
      `当前值：${effective.reasoning ?? "未配置"}`,
      `来源：${formatSettingSourceLabel(Boolean(settings.reasoning))}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      `可选值：${reasoningChoices.join(" | ")}`,
      "恢复默认：/settings reasoning default",
      `示例：/settings reasoning ${reasoningChoices.at(-1) ?? "xhigh"}`,
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async updateReasoningSetting(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!args.length) {
      await this.sendReasoningSetting(context.chatId, context);
      return;
    }

    const runtimeConfig = await this.readRuntimeConfig();
    const settings = this.readPrincipalTaskSettings(context);
    const effective = resolveEffectivePrincipalSettings(settings, runtimeConfig);
    const rawValue = normalizeText(args.join(" "));

    if (!rawValue) {
      await this.sendReasoningSetting(context.chatId, context);
      return;
    }

    if (isDefaultSettingArgument(rawValue)) {
      const saved = this.writePrincipalTaskSettings(context, { reasoning: "" });
      const nextEffective = resolveEffectivePrincipalSettings(saved.settings, runtimeConfig);
      await this.sendPrincipalSettingClearedMessage(
        context.chatId,
        saved.principalId,
        "默认思维强度",
        nextEffective.reasoning,
        "/settings reasoning",
      );
      return;
    }

    const reasoningChoices = listAvailablePrincipalReasoningChoices(
      runtimeConfig,
      effective.model,
      settings.reasoning ?? effective.reasoning,
    );
    const reasoning = resolveRuntimeReasoningArgument(rawValue, reasoningChoices);

    if (!reasoning) {
      await this.sendReasoningSetting(context.chatId, context, rawValue);
      return;
    }

    const saved = this.writePrincipalTaskSettings(context, { reasoning });
    await this.sendPrincipalSettingUpdatedMessage(
      context.chatId,
      saved.principalId,
      "默认思维强度",
      reasoning,
      "/settings reasoning",
    );
  }

  private async sendWebSearchSetting(chatId: string, context: FeishuIncomingContext, invalidValue?: string): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const runtimeConfig = await this.readRuntimeConfig();
    const effective = resolveEffectivePrincipalSettings(settings, runtimeConfig);
    const lines = [
      invalidValue ? `无效取值：${invalidValue}` : "设置项：/settings search",
      `当前 principal：${principal.principalId}`,
      `当前值：${effective.webSearchMode ?? "未配置"}`,
      `来源：${formatSettingSourceLabel(Boolean(settings.webSearchMode))}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      `可选值：${WEB_SEARCH_MODES.join(" | ")}`,
      "示例：/settings search live",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async updateWebSearchMode(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!args.length) {
      await this.sendWebSearchSetting(context.chatId, context);
      return;
    }

    const webSearchMode = parseWebSearchModeArgument(args);

    if (webSearchMode === null) {
      await this.sendWebSearchSetting(context.chatId, context, args.join(" "));
      return;
    }

    const saved = this.writePrincipalTaskSettings(context, { webSearchMode });
    await this.sendPrincipalSettingUpdatedMessage(
      context.chatId,
      saved.principalId,
      "联网搜索",
      webSearchMode,
      "/settings search",
    );
  }

  private async sendNetworkAccessSetting(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const runtimeConfig = await this.readRuntimeConfig();
    const effective = resolveEffectivePrincipalSettings(settings, runtimeConfig);
    const lines = [
      invalidValue ? `无效取值：${invalidValue}` : "设置项：/settings network",
      `当前 principal：${principal.principalId}`,
      `当前值：${formatBooleanCommandValue(effective.networkAccessEnabled)}`,
      `来源：${formatSettingSourceLabel(typeof settings.networkAccessEnabled === "boolean")}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      "可选值：on | off",
      "示例：/settings network on",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async updateNetworkAccess(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!args.length) {
      await this.sendNetworkAccessSetting(context.chatId, context);
      return;
    }

    const networkAccessEnabled = parseNetworkAccessArgument(args);

    if (networkAccessEnabled === null) {
      await this.sendNetworkAccessSetting(context.chatId, context, args.join(" "));
      return;
    }

    const saved = this.writePrincipalTaskSettings(context, {
      networkAccessEnabled,
    });
    await this.sendPrincipalSettingUpdatedMessage(
      context.chatId,
      saved.principalId,
      "网络访问",
      formatBooleanCommandValue(networkAccessEnabled),
      "/settings network",
    );
  }

  private async sendApprovalSetting(chatId: string, context: FeishuIncomingContext, invalidValue?: string): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const runtimeConfig = await this.readRuntimeConfig();
    const effective = resolveEffectivePrincipalSettings(settings, runtimeConfig);
    const lines = [
      invalidValue ? `无效取值：${invalidValue}` : "设置项：/settings approval",
      `当前 principal：${principal.principalId}`,
      `当前值：${effective.approvalPolicy ?? "未配置"}`,
      `来源：${formatSettingSourceLabel(Boolean(settings.approvalPolicy))}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      `可选值：${APPROVAL_POLICIES.join(" | ")}`,
      "示例：/settings approval never",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async updateApprovalPolicy(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!args.length) {
      await this.sendApprovalSetting(context.chatId, context);
      return;
    }

    const approvalPolicy = parseApprovalPolicyArgument(args);

    if (approvalPolicy === null) {
      await this.sendApprovalSetting(context.chatId, context, args.join(" "));
      return;
    }

    const saved = this.writePrincipalTaskSettings(context, { approvalPolicy });
    await this.sendPrincipalSettingUpdatedMessage(
      context.chatId,
      saved.principalId,
      "审批策略",
      approvalPolicy,
      "/settings approval",
    );
  }

  private async sendPrincipalSettingUpdatedMessage(
    chatId: string,
    principalId: string,
    label: string,
    value: string,
    viewCommand: string,
  ): Promise<void> {
    const lines = [
      `当前 principal：${principalId}`,
      `${label}已更新为：${value}`,
      FEISHU_SETTINGS_EFFECT_LINE,
      `查看：${viewCommand}`,
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendPrincipalSettingClearedMessage(
    chatId: string,
    principalId: string,
    label: string,
    value: string | null,
    viewCommand: string,
  ): Promise<void> {
    const lines = [
      `当前 principal：${principalId}`,
      value
        ? `${label}已改为：跟随 Themis 系统默认值 ${value}`
        : `${label}已改为：跟随 Themis 系统默认值`,
      FEISHU_SETTINGS_EFFECT_LINE,
      `查看：${viewCommand}`,
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendHelp(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const currentSessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));
    const helpText = [
      "Themis 飞书命令：",
      "/help 查看帮助",
      "/sessions 查看最近会话",
      "/new 新建并切换到新会话",
      "/use <序号|conversationId> 切换到已有会话",
      "/current 查看当前会话",
      "/stop 停止当前会话正在运行的任务",
      "/review <指令> 对当前会话发起 Review",
      "/steer <指令> 对当前会话发送 Steer",
      "/workspace 查看或设置当前会话工作区",
      "/settings 查看设置树",
      "/group 查看当前群聊设置、路由和管理员控制",
      "/update 查看实例更新状态，或发起后台升级 / 回滚",
      "/ops 查看实例运维命令",
      "/secrets 查看和兜底维护 worker 本地 secret 引用",
      "/skills 查看和维护当前 principal 的 skills",
      "/mcp 查看和维护当前 principal 的 MCP server",
      "/plugins 查看和维护当前 principal 的 plugins",
      "/link <绑定码> 可选：认领一个旧 Web 浏览器身份",
      "/reset confirm 清空当前 principal 的人格档案、历史和默认配置，并重新开始",
      "/msgupdate 测试机器人是否能原地更新自己刚发出的文本消息",
      "/quota 查看当前 Codex / ChatGPT 额度信息",
      "",
      "发送 /settings 查看下一层配置项。",
      "Web 和飞书默认共享同一套会话列表与 principal 默认配置；切到同一个 conversationId 后，会继续复用后端已有上下文。",
      "直接发送普通文本即可继续当前会话。",
      "如果当前会话还有任务在运行，新消息会先打断旧任务，再自动开始新的请求。",
      currentSessionId ? `当前会话：${currentSessionId}` : "当前还没有激活会话，直接发消息时会自动创建。",
    ].join("\n");

    await this.safeSendText(chatId, helpText);
  }

  private async handleSecretsCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const scope = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (scope) {
      case "":
      case "help":
        await this.sendSecretsOverview(context.chatId);
        return;
      case "worker":
      case "workers":
        await this.handleWorkerSecretsCommand(args.slice(1), context);
        return;
      default:
        await this.safeSendText(
          context.chatId,
          [
            `未识别的 secret 范围：${scope}`,
            "",
            "/secrets worker 查看 worker secret store",
            "/secrets worker set <secretRef> <secretValue>",
            "/secrets worker remove <secretRef> confirm",
          ].join("\n"),
        );
        return;
    }
  }

  private async sendSecretsOverview(chatId: string): Promise<void> {
    await this.safeSendText(
      chatId,
      [
        "Themis secret 命令：",
        "/secrets worker 查看 worker 本地 secret store",
        "/secrets worker list 列出已配置 secretRef，不显示值",
        "/secrets worker set <secretRef> <secretValue> 兜底写入或覆盖 worker secret",
        "/secrets worker remove <secretRef> confirm 删除 worker secret",
        "",
        "Cloudflare worker token 默认由 Themis 调用 provision_cloudflare_worker_secret 准备，不需要在这里手工发送 worker token。",
        "secret 值只由命令处理器写入本地 secret store，不会进入 Codex 对话、工单正文、contextPacket 或员工报告。",
        "请只在和 Themis 的单聊里执行写入或删除。",
      ].join("\n"),
    );
  }

  private async handleWorkerSecretsCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (subcommand) {
      case "":
      case "list":
      case "ls":
        await this.sendWorkerSecretList(context.chatId);
        return;
      case "set":
      case "put":
        await this.setWorkerSecret(args.slice(1), context);
        return;
      case "remove":
      case "rm":
      case "delete":
      case "del":
        await this.removeWorkerSecret(args.slice(1), context);
        return;
      default:
        await this.safeSendText(
          context.chatId,
          [
            `未识别的 worker secret 命令：${subcommand}`,
            "",
            "/secrets worker list",
            "/secrets worker set <secretRef> <secretValue>",
            "/secrets worker remove <secretRef> confirm",
          ].join("\n"),
        );
        return;
    }
  }

  private async tryHandleThemisSecretIntake(
    context: Extract<FeishuIncomingContext, { kind: "text" }>,
  ): Promise<boolean> {
    const intake = parseThemisSecretIntake(context.text);

    if (!intake) {
      return false;
    }

    if (!await this.ensureSecretMutationAllowed(context, "自然语言 secret 保存")) {
      return true;
    }

    try {
      const snapshot = this.themisSecretStore.setSecret(intake.secretRef, intake.value);
      await this.safeSendText(
        context.chatId,
        [
          "已收到并保存到 Themis 密码本。",
          `secretRef：${intake.secretRef}`,
          `用途：${intake.label}`,
          `路径：${snapshot.filePath}`,
          "值不会回显，也不会进入 Codex 对话、工单正文、contextPacket 或员工报告。",
          "后续任务只使用 secretRef 引用它。",
        ].join("\n"),
      );
    } catch (error) {
      await this.safeSendText(context.chatId, contextChatError("保存 Themis secret 失败", error));
    }

    return true;
  }

  private async sendWorkerSecretList(chatId: string): Promise<void> {
    try {
      const snapshot = this.workerSecretStore.readSnapshot();
      await this.safeSendText(
        chatId,
        [
          "Worker secret store：",
          `路径：${snapshot.filePath}`,
          snapshot.secretRefs.length > 0
            ? `已配置 secretRef：${snapshot.secretRefs.join("、")}`
            : "已配置 secretRef：无",
          "值不会显示。",
        ].join("\n"),
      );
    } catch (error) {
      await this.safeSendText(chatId, contextChatError("读取 worker secret store 失败", error));
    }
  }

  private async setWorkerSecret(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!await this.ensureSecretMutationAllowed(context, "/secrets worker set")) {
      return;
    }

    const secretRef = normalizeText(args[0]);
    const secretValue = normalizeText(args.slice(1).join(" "));

    if (!secretRef || !secretValue) {
      await this.safeSendText(
        context.chatId,
        [
          "用法：/secrets worker set <secretRef> <secretValue>",
          "这是兜底入口；Cloudflare worker token 默认应由 Themis 使用管理 token 自动准备。",
          "secret 值不会进入 Themis 对话或工单正文；命令日志会脱敏。",
        ].join("\n"),
      );
      return;
    }

    try {
      const snapshot = this.workerSecretStore.setSecret(secretRef, secretValue);
      await this.safeSendText(
        context.chatId,
        [
          "Worker secret 已写入。",
          `secretRef：${secretRef}`,
          `路径：${snapshot.filePath}`,
          "值不会显示。",
          "派工时使用 runtimeProfileSnapshot.secretEnvRefs 只传 envName / secretRef / required。",
        ].join("\n"),
      );
    } catch (error) {
      await this.safeSendText(context.chatId, contextChatError("写入 worker secret 失败", error));
    }
  }

  private async removeWorkerSecret(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!await this.ensureSecretMutationAllowed(context, "/secrets worker remove")) {
      return;
    }

    const secretRef = normalizeText(args[0]);

    if (!secretRef || !isResetConfirmed(args.slice(1))) {
      await this.safeSendText(
        context.chatId,
        [
          "用法：/secrets worker remove <secretRef> confirm",
          "删除后，依赖这个 secretRef 的 worker 工单会在执行前失败。",
        ].join("\n"),
      );
      return;
    }

    try {
      const result = this.workerSecretStore.removeSecret(secretRef);
      await this.safeSendText(
        context.chatId,
        [
          result.removed ? "Worker secret 已删除。" : "Worker secret 不存在，未做修改。",
          `secretRef：${secretRef}`,
          `路径：${result.snapshot.filePath}`,
          result.snapshot.secretRefs.length > 0
            ? `剩余 secretRef：${result.snapshot.secretRefs.join("、")}`
            : "剩余 secretRef：无",
        ].join("\n"),
      );
    } catch (error) {
      await this.safeSendText(context.chatId, contextChatError("删除 worker secret 失败", error));
    }
  }

  private async ensureSecretMutationAllowed(
    context: FeishuIncomingContext,
    commandLabel: string,
  ): Promise<boolean> {
    if (context.chatType && context.chatType !== "p2p") {
      await this.safeSendText(
        context.chatId,
        `${commandLabel} 只允许在和 Themis 的单聊里执行，避免群聊里暴露 secret。`,
      );
      return false;
    }

    return true;
  }

  private async handleOpsCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (subcommand) {
      case "":
      case "help":
        await this.sendOpsOverview(context.chatId);
        return;
      case "status":
        await this.sendOpsStatus(context.chatId);
        return;
      case "restart":
        await this.handleOpsRestartCommand(args.slice(1), context);
        return;
      default:
        await this.safeSendText(
          context.chatId,
          [
            "/ops 查看实例运维命令",
            "/ops status 查看当前实例状态",
            "/ops restart 查看受控重启说明",
            "/ops restart confirm 请求重启当前 Themis 服务",
            "/update 查看升级 / 回滚状态",
          ].join("\n"),
        );
        return;
    }
  }

  private async sendOpsOverview(chatId: string): Promise<void> {
    await this.safeSendText(
      chatId,
      [
        "Themis 实例运维命令：",
        "/ops status 查看当前实例状态",
        "/ops restart 查看受控重启说明",
        "/ops restart confirm 请求重启当前 Themis 服务",
        "/update 查看升级 / 回滚状态",
        "",
        "普通对话任务不会直接重启当前服务；需要服务重启时，请使用上面的确认命令。",
      ].join("\n"),
    );
  }

  private async sendOpsStatus(chatId: string): Promise<void> {
    try {
      const status = this.updateService.readOpsStatus();
      await this.safeSendText(chatId, formatOpsStatusMessage(status));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.safeSendText(chatId, `读取 Themis 实例状态失败：${message}`);
    }
  }

  private async handleOpsRestartCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!isResetConfirmed(args)) {
      let serviceLine = "当前可重启服务：未检测";

      try {
        const prepared = this.updateService.prepareRestart();
        serviceLine = `当前可重启服务：${prepared.serviceUnit}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        serviceLine = `当前重启入口未就绪：${message}`;
      }

      await this.safeSendText(
        context.chatId,
        [
          "Themis 受控重启：",
          serviceLine,
          "这个命令只负责请求重启当前 Themis 服务，不会拉代码、装依赖或改版本。",
          "确认执行：/ops restart confirm",
          "查看状态：/ops status",
          "升级 / 回滚请使用：/update",
        ].join("\n"),
      );
      return;
    }

    if (!await this.ensureUpdateMutationAllowed(context, "/ops restart")) {
      return;
    }

    let prepared: { serviceUnit: string };

    try {
      prepared = this.updateService.prepareRestart();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.safeSendText(context.chatId, `当前不能请求重启：${message}`);
      return;
    }

    await this.safeSendText(
      context.chatId,
      [
        `已受理重启请求：${prepared.serviceUnit}`,
        "Themis 会通过受控运维入口请求重启当前服务，Web/飞书会短暂中断。",
        "重启完成后可发送 /ops status 查看确认状态。",
      ].join("\n"),
    );

    try {
      await this.updateService.requestRestart({
        serviceUnitOverride: prepared.serviceUnit,
        initiatedBy: {
          channel: "feishu",
          channelUserId: context.userId,
          displayName: context.userId,
          chatId: context.chatId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.safeSendText(context.chatId, `请求重启失败：${message}`);
    }
  }

  private async sendRestartCommandNotice(chatId: string): Promise<void> {
    await this.safeSendText(
      chatId,
      [
        "服务重启已经收口到受控运维命令。",
        "查看说明：/ops restart",
        "确认重启当前 Themis 服务：/ops restart confirm",
      ].join("\n"),
    );
  }

  private async handleUpdateCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (subcommand) {
      case "":
      case "check":
      case "status":
        await this.sendUpdateOverview(context.chatId);
        return;
      case "apply":
      case "upgrade":
        if (!await this.ensureUpdateMutationAllowed(context, "/update apply")) {
          return;
        }

        if (!isResetConfirmed(args.slice(1))) {
          await this.safeSendText(
            context.chatId,
            [
              "这是高风险操作，会拉代码、装依赖、编译并请求重启当前服务。",
              "确认执行：/update apply confirm",
              "先看当前状态：/update",
            ].join("\n"),
          );
          return;
        }

        await this.updateService.startApply({
          initiatedBy: {
            channel: "feishu",
            channelUserId: context.userId,
            displayName: context.openId ?? context.userId,
            chatId: context.chatId,
          },
        });
        await this.safeSendText(
          context.chatId,
          [
            "后台升级已启动。",
            "Themis 会在版本切换完成后请求重启当前服务，Web/飞书会短暂中断。",
            "稍后可发送 /update 查看最终状态。",
          ].join("\n"),
        );
        return;
      case "rollback":
        if (!await this.ensureUpdateMutationAllowed(context, "/update rollback")) {
          return;
        }

        if (!isResetConfirmed(args.slice(1))) {
          await this.safeSendText(
            context.chatId,
            [
              "这是高风险操作，会把实例退回最近一次成功升级前的版本，并请求重启当前服务。",
              "确认执行：/update rollback confirm",
              "先看当前状态：/update",
            ].join("\n"),
          );
          return;
        }

        await this.updateService.startRollback({
          initiatedBy: {
            channel: "feishu",
            channelUserId: context.userId,
            displayName: context.openId ?? context.userId,
            chatId: context.chatId,
          },
        });
        await this.safeSendText(
          context.chatId,
          [
            "后台回滚已启动。",
            "Themis 会在回滚完成后请求重启当前服务，Web/飞书会短暂中断。",
            "稍后可发送 /update 查看最终状态。",
          ].join("\n"),
        );
        return;
      default:
        await this.safeSendText(
          context.chatId,
          [
            "/update 查看当前更新状态",
            "/update apply confirm 后台执行受控升级",
            "/update rollback confirm 回退到最近一次成功升级前的版本",
          ].join("\n"),
        );
        return;
    }
  }

  private async sendUpdateOverview(chatId: string): Promise<void> {
    const overview = await this.updateService.readOverview();
    await this.safeSendText(chatId, formatFeishuUpdateOverview(overview));
  }

  private async ensureUpdateMutationAllowed(
    context: FeishuIncomingContext,
    commandLabel: string,
  ): Promise<boolean> {
    if (context.chatType && context.chatType !== "p2p") {
      await this.safeSendText(
        context.chatId,
        `${commandLabel} 只允许在和 Themis 的单聊里执行，避免群聊误触导致实例升级或重启。`,
      );
      return false;
    }

    return true;
  }

  private async handleSkillsCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (subcommand) {
      case "":
      case "list":
        await this.sendSkillsList(context.chatId, context);
        return;
      case "curated":
        await this.sendSkillsCurated(context.chatId, context);
        return;
      case "install":
        await this.handleSkillsInstallCommand(args.slice(1), context);
        return;
      case "remove":
        await this.handleSkillsRemoveCommand(args.slice(1), context);
        return;
      case "sync":
        await this.handleSkillsSyncCommand(args.slice(1), context);
        return;
      default:
        await this.sendSkillsHelp(context.chatId, context, subcommand);
        return;
    }
  }

  private async handleMcpCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (subcommand) {
      case "":
      case "list":
        await this.sendMcpList(context.chatId, context);
        return;
      case "reload":
        await this.handleMcpReloadCommand(args.slice(1), context);
        return;
      case "enable":
        await this.handleMcpEnableCommand(args.slice(1), context);
        return;
      case "disable":
        await this.handleMcpDisableCommand(args.slice(1), context);
        return;
      case "remove":
        await this.handleMcpRemoveCommand(args.slice(1), context);
        return;
      case "oauth":
        await this.handleMcpOauthCommand(args.slice(1), context);
        return;
      default:
        await this.sendMcpHelp(context.chatId, context, subcommand);
        return;
    }
  }

  private async handlePluginsCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const subcommand = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (subcommand) {
      case "":
      case "list":
        await this.sendPluginsList(context.chatId, context);
        return;
      case "read":
      case "show":
        await this.handlePluginsReadCommand(args.slice(1), context);
        return;
      case "install":
        await this.handlePluginsInstallCommand(args.slice(1), context);
        return;
      case "sync":
        await this.handlePluginsSyncCommand(args.slice(1), context);
        return;
      case "uninstall":
      case "remove":
        await this.handlePluginsUninstallCommand(args.slice(1), context);
        return;
      default:
        await this.sendPluginsHelp(context.chatId, context, subcommand);
        return;
    }
  }

  private async handleSkillsInstallCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const mode = normalizeText(args[0])?.toLowerCase() ?? "";

    switch (mode) {
      case "local":
        await this.installSkillsFromLocal(args.slice(1), context);
        return;
      case "url":
        await this.installSkillsFromUrl(args.slice(1), context);
        return;
      case "repo":
        await this.installSkillsFromRepo(args.slice(1), context);
        return;
      case "curated":
        await this.installSkillsFromCurated(args.slice(1), context);
        return;
      case "":
        await this.sendSkillsInstallHelp(context.chatId, context);
        return;
      default:
        await this.sendSkillsInstallHelp(context.chatId, context, {
          invalidMode: mode,
        });
        return;
    }
  }

  private async handleMcpReloadCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (args.length > 0) {
      await this.sendMcpReloadHelp(context.chatId, context, args.join(" "));
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalMcpService().reloadPrincipalMcpServers(principal.principalId, {
      workingDirectory: this.runtime.getWorkingDirectory(),
      activeAuthAccount: this.authRuntime.getActiveAccount(),
    });
    const summary = summarizePrincipalMcpList(result.servers);

    await this.safeSendText(
      context.chatId,
      [
        `当前 principal：${principal.principalId}`,
        "已重新读取当前 runtime 槽位的 MCP 状态。",
        `当前槽位：${result.target.targetId}`,
        `runtime 返回：${result.runtimeServers.length} 个 server`,
        `当前定义：${result.servers.length} 个`,
        `就绪 ${summary.readyCount}｜待认证 ${summary.authRequiredCount}｜失败 ${summary.failedCount}`,
        "查看：/mcp list",
      ].join("\n"),
    );
  }

  private async handleMcpEnableCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const serverName = normalizeText(args[0]);

    if (!serverName || args.length !== 1) {
      await this.sendMcpToggleHelp(context.chatId, context, "enable", args.join(" ") || undefined);
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const server = this.runtime.getPrincipalMcpService().setPrincipalMcpServerEnabled(
      principal.principalId,
      serverName,
      true,
    );

    await this.safeSendText(
      context.chatId,
      [
        `当前 principal：${principal.principalId}`,
        `已启用 MCP server：${server.serverName}`,
        "查看：/mcp list",
      ].join("\n"),
    );
  }

  private async handleMcpDisableCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const serverName = normalizeText(args[0]);

    if (!serverName || args.length !== 1) {
      await this.sendMcpToggleHelp(context.chatId, context, "disable", args.join(" ") || undefined);
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const server = this.runtime.getPrincipalMcpService().setPrincipalMcpServerEnabled(
      principal.principalId,
      serverName,
      false,
    );

    await this.safeSendText(
      context.chatId,
      [
        `当前 principal：${principal.principalId}`,
        `已停用 MCP server：${server.serverName}`,
        "查看：/mcp list",
      ].join("\n"),
    );
  }

  private async handleMcpRemoveCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const serverName = normalizeText(args[0]);

    if (!serverName || args.length !== 1) {
      await this.sendMcpRemoveHelp(context.chatId, context, args.join(" ") || undefined);
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = this.runtime.getPrincipalMcpService().removePrincipalMcpServer(principal.principalId, serverName);

    await this.safeSendText(
      context.chatId,
      [
        `当前 principal：${principal.principalId}`,
        `已删除 MCP server：${result.serverName}`,
        `已清理 runtime 物化状态：${result.removedMaterializations}`,
        "查看：/mcp list",
      ].join("\n"),
    );
  }

  private async handleMcpOauthCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const serverName = normalizeText(args[0]);

    if (!serverName || args.length !== 1) {
      await this.sendMcpOauthHelp(context.chatId, context, args.join(" ") || undefined);
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalMcpService().startPrincipalMcpOauthLogin(
      principal.principalId,
      serverName,
      {
        workingDirectory: this.runtime.getWorkingDirectory(),
        activeAuthAccount: this.authRuntime.getActiveAccount(),
      },
    );

    await this.safeSendText(
      context.chatId,
      [
        `当前 principal：${principal.principalId}`,
        `已发起 MCP OAuth 登录：${result.server.serverName}`,
        `当前槽位：${result.target.targetId}`,
        `授权链接：${result.authorizationUrl}`,
        "完成授权后建议执行：/mcp reload",
      ].join("\n"),
    );
  }

  private async handlePluginsReadCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const marketplaceToken = normalizeText(args[0]);
    const pluginName = normalizeText(args[1]);

    if (!marketplaceToken || !pluginName || args.length !== 2) {
      await this.sendPluginsReadHelp(context.chatId, context, args.join(" ") || undefined);
      return;
    }

    const { marketplaceName, marketplacePath } = await this.resolvePluginMarketplaceReference(marketplaceToken, context);
    const result = await this.runtime.getPrincipalPluginsService().readPrincipalPlugin(principal.principalId, {
      marketplacePath,
      pluginName,
    }, this.buildPluginRuntimeOptions(context));
    const lines = [
      "Plugin 详情：",
      `当前 principal：${principal.principalId}`,
      `当前槽位：${result.target.targetId}`,
      `marketplace：${marketplaceName}`,
      `plugin：${result.plugin.summary.name}`,
      `pluginId：${result.plugin.summary.id}`,
      `来源：${describePrincipalPluginSource(result.plugin)}`,
      `principal 归属：${result.plugin.summary.owned ? "已纳入" : "未纳入"}`,
      `当前状态：${formatPrincipalPluginRuntimeState(result.plugin.summary.runtimeState)}`,
      `安装策略：${formatPluginInstallPolicy(result.plugin.summary.installPolicy)}`,
      `认证策略：${formatPluginAuthPolicy(result.plugin.summary.authPolicy)}`,
      result.plugin.lastError ? `最近问题：${result.plugin.lastError}` : null,
      result.plugin.repairHint ? `建议动作：${result.plugin.repairHint}` : null,
      `说明：${result.plugin.description || result.plugin.summary.interface?.shortDescription || "暂无说明"}`,
      result.plugin.skills.length > 0 ? `附带 skills：${result.plugin.skills.map((item) => item.name).join(", ")}` : "附带 skills：无",
      result.plugin.apps.length > 0 ? `附带 apps：${result.plugin.apps.map((item) => item.name).join(", ")}` : "附带 apps：无",
      result.plugin.mcpServers.length > 0 ? `附带 MCP：${result.plugin.mcpServers.join(", ")}` : "附带 MCP：无",
      "查看：/plugins list",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(context.chatId, lines.join("\n"));
  }

  private async handlePluginsInstallCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const marketplaceToken = normalizeText(args[0]);
    const pluginName = normalizeText(args[1]);

    if (!marketplaceToken || !pluginName || args.length !== 2) {
      await this.sendPluginsInstallHelp(context.chatId, context, args.join(" ") || undefined);
      return;
    }

    const { marketplaceName, marketplacePath } = await this.resolvePluginMarketplaceReference(marketplaceToken, context);
    const result = await this.runtime.getPrincipalPluginsService().installPrincipalPlugin(principal.principalId, {
      marketplacePath,
      pluginName,
    }, this.buildPluginRuntimeOptions(context));
    const lines = [
      "Plugin 已纳入 principal：",
      `当前 principal：${principal.principalId}`,
      `当前槽位：${result.target.targetId}`,
      `marketplace：${marketplaceName}`,
      `plugin：${result.pluginName}`,
      result.plugin ? `当前状态：${formatPrincipalPluginRuntimeState(result.plugin.summary.runtimeState)}` : null,
      `认证策略：${formatPluginAuthPolicy(result.authPolicy)}`,
      result.appsNeedingAuth.length > 0
        ? `待补认证 apps：${result.appsNeedingAuth.map((item) => item.name).join(", ")}`
        : "待补认证 apps：无",
      "查看：/plugins list",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(context.chatId, lines.join("\n"));
  }

  private async handlePluginsSyncCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const syncMode = normalizeText(args[0])?.toLowerCase() ?? "";
    const forceRemoteSync = syncMode === "" ? false : parsePluginsSyncRemoteArgument(syncMode);

    if (args.length > 1 || (args.length === 1 && forceRemoteSync === null)) {
      await this.sendPluginsSyncHelp(context.chatId, context, args.join(" ") || undefined);
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalPluginsService().syncPrincipalPlugins(
      principal.principalId,
      this.buildPluginRuntimeOptions(context, {
        forceRemoteSync: forceRemoteSync === true,
      }),
    );
    const failedPlugins = result.plugins
      .filter((item) => item.action === "failed")
      .map((item) => item.pluginName);
    const missingPlugins = result.plugins
      .filter((item) => item.action === "missing")
      .map((item) => item.pluginName);
    const authRequiredPlugins = result.plugins
      .filter((item) => item.action === "auth_required")
      .map((item) => item.pluginName);

    await this.safeSendText(
      context.chatId,
      [
        "Plugin 同步完成：",
        `当前 principal：${principal.principalId}`,
        `当前槽位：${result.target.targetId}`,
        forceRemoteSync === true ? "模式：先远程同步 marketplace，再落到当前 runtime" : "模式：直接对齐当前 runtime",
        `总数：${result.total}`,
        `新装 ${result.installedCount}｜已在当前环境 ${result.alreadyInstalledCount}｜待认证 ${result.authRequiredCount}｜缺失 ${result.missingCount}｜失败 ${result.failedCount}`,
        authRequiredPlugins.length > 0 ? `待认证 plugin：${authRequiredPlugins.join(", ")}` : null,
        missingPlugins.length > 0 ? `当前工作区不可解析：${missingPlugins.join(", ")}` : null,
        failedPlugins.length > 0 ? `同步失败：${failedPlugins.join(", ")}` : null,
        "查看：/plugins list",
      ].filter((line): line is string => line !== null).join("\n"),
    );
  }

  private async handlePluginsUninstallCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const pluginId = normalizeText(args[0]);

    if (!pluginId || args.length !== 1) {
      await this.sendPluginsUninstallHelp(context.chatId, context, args.join(" ") || undefined);
      return;
    }

    const result = await this.runtime.getPrincipalPluginsService().uninstallPrincipalPlugin(
      principal.principalId,
      pluginId,
      this.buildPluginRuntimeOptions(context),
    );

    await this.safeSendText(
      context.chatId,
      [
        "Plugin 已从 principal 移除：",
        `当前 principal：${principal.principalId}`,
        `当前槽位：${result.target.targetId}`,
        `pluginId：${result.pluginId}`,
        result.runtimeAction === "uninstalled"
          ? "当前 runtime：已执行卸载。"
          : "当前 runtime：当前工作区未解析到该 plugin，只移除了 principal 记录。",
        "查看：/plugins list",
      ].join("\n"),
    );
  }

  private async handleSkillsRemoveCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const skillName = normalizeText(args[0]);

    if (!skillName || args.length !== 1) {
      await this.sendSkillsRemoveHelp(context.chatId, context, args.join(" ") || undefined);
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = this.runtime.getPrincipalSkillsService().removeSkill(principal.principalId, skillName);

    await this.safeSendText(
      context.chatId,
      [
        `当前 principal：${principal.principalId}`,
        `技能已删除：${result.skillName}`,
        `已清理账号同步链接：${result.removedMaterializations}`,
        `已删除受管目录：${result.removedManagedPath ? "是" : "否"}`,
        "查看：/skills list",
      ].join("\n"),
    );
  }

  private async handleSkillsSyncCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    const skillName = normalizeText(args[0]);
    const syncMode = normalizeText(args[1])?.toLowerCase() ?? "";
    const force = syncMode === "" ? false : parseSkillsSyncForceArgument(syncMode);

    if (!skillName || args.length > 2 || (args.length === 2 && force === null)) {
      await this.sendSkillsSyncHelp(context.chatId, context, skillName ?? undefined, args.slice(1).join(" ") || undefined);
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalSkillsService().syncSkill(principal.principalId, skillName, {
      force: force === true,
    });

    await this.safeSendText(
      context.chatId,
      [
        `当前 principal：${principal.principalId}`,
        `已重同步 skill：${result.skill.skillName}`,
        force ? "模式：强制同步" : null,
        `安装状态：${result.skill.installStatus}`,
        formatSkillSyncSummary(result.summary),
        result.skill.lastError ? `最近错误：${result.skill.lastError}` : null,
        "查看：/skills list",
      ].filter((line): line is string => line !== null).join("\n"),
    );
  }

  private async installSkillsFromLocal(args: string[], context: FeishuIncomingContext): Promise<void> {
    const absolutePath = normalizeText(args[0]);
    const invalidValue = args.join(" ");

    if (!absolutePath || args.length !== 1) {
      await this.sendSkillsInstallHelp(context.chatId, context, {
        usageLine: "用法：/skills install local <ABSOLUTE_PATH>",
        ...(invalidValue ? { invalidValue } : {}),
      });
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalSkillsService().installFromLocalPath({
      principalId: principal.principalId,
      absolutePath,
    });

    await this.sendSkillsInstallResult(
      context.chatId,
      principal.principalId,
      result.skill.skillName,
      result.skill.installStatus,
      result.skill.lastError,
      [
      `安装来源：本机路径 ${absolutePath}`,
      formatSkillSyncSummary(result.summary),
      ],
    );
  }

  private async installSkillsFromUrl(args: string[], context: FeishuIncomingContext): Promise<void> {
    const url = normalizeText(args[0]);
    const ref = normalizeText(args[1]);
    const invalidValue = args.join(" ");

    if (!url || args.length > 2) {
      await this.sendSkillsInstallHelp(context.chatId, context, {
        usageLine: "用法：/skills install url <GITHUB_URL> [REF]",
        ...(invalidValue ? { invalidValue } : {}),
      });
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalSkillsService().installFromGithub({
      principalId: principal.principalId,
      url,
      ...(ref ? { ref } : {}),
    });

    await this.sendSkillsInstallResult(
      context.chatId,
      principal.principalId,
      result.skill.skillName,
      result.skill.installStatus,
      result.skill.lastError,
      [
      `安装来源：GitHub URL ${url}`,
      ref ? `GitHub ref：${ref}` : null,
      formatSkillSyncSummary(result.summary),
      ],
    );
  }

  private async installSkillsFromRepo(args: string[], context: FeishuIncomingContext): Promise<void> {
    const repo = normalizeText(args[0]);
    const path = normalizeText(args[1]);
    const ref = normalizeText(args[2]);
    const invalidValue = args.join(" ");

    if (!repo || !path || args.length > 3) {
      await this.sendSkillsInstallHelp(context.chatId, context, {
        usageLine: "用法：/skills install repo <REPO> <PATH> [REF]",
        ...(invalidValue ? { invalidValue } : {}),
      });
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalSkillsService().installFromGithub({
      principalId: principal.principalId,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });

    await this.sendSkillsInstallResult(
      context.chatId,
      principal.principalId,
      result.skill.skillName,
      result.skill.installStatus,
      result.skill.lastError,
      [
      `安装来源：GitHub 仓库 ${repo} ${path}`,
      ref ? `GitHub ref：${ref}` : null,
      formatSkillSyncSummary(result.summary),
      ],
    );
  }

  private async installSkillsFromCurated(args: string[], context: FeishuIncomingContext): Promise<void> {
    const skillName = normalizeText(args[0]);
    const invalidValue = args.join(" ");

    if (!skillName || args.length !== 1) {
      await this.sendSkillsInstallHelp(context.chatId, context, {
        usageLine: "用法：/skills install curated <SKILL_NAME>",
        ...(invalidValue ? { invalidValue } : {}),
      });
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalSkillsService().installFromCurated({
      principalId: principal.principalId,
      skillName,
    });

    await this.sendSkillsInstallResult(
      context.chatId,
      principal.principalId,
      result.skill.skillName,
      result.skill.installStatus,
      result.skill.lastError,
      [
      `安装来源：curated skill ${skillName}`,
      formatSkillSyncSummary(result.summary),
      ],
    );
  }

  private async sendSkillsHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidSegment?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      "Skills 管理：",
      `当前 principal：${principal.principalId}`,
      invalidSegment ? `未识别的 skills 子命令：${invalidSegment}` : null,
      "/skills 查看和维护当前 principal 的 skills",
      "/skills list 查看当前 principal 已安装的 skills",
      "/skills curated 查看可安装的 curated skills",
      "/skills install local <ABSOLUTE_PATH> 从本机绝对路径安装 skill（第一版不支持带空格路径）",
      "/skills install url <GITHUB_URL> [REF] 从 GitHub URL 安装 skill",
      "/skills install repo <REPO> <PATH> [REF] 从 GitHub 仓库路径安装 skill",
      "/skills install curated <SKILL_NAME> 从 curated 列表安装 skill",
      "/skills remove <SKILL_NAME> 删除已安装 skill",
      "/skills sync <SKILL_NAME> [force] 重新同步 skill 到当前 principal 的所有账号槽位",
      "",
      "如果想查看已安装项，请发送 /skills list。",
      "如果想查看可安装项，请发送 /skills curated。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendSkillsInstallHelp(
    chatId: string,
    context: FeishuIncomingContext,
    options: {
      invalidMode?: string;
      usageLine?: string;
      invalidValue?: string;
    } = {},
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      options.invalidMode ? `未识别的 install 模式：${options.invalidMode}` : null,
      options.usageLine ?? "用法：/skills install <local|url|repo|curated>",
      `当前 principal：${principal.principalId}`,
      options.invalidValue ? `参数不完整或格式不正确：${options.invalidValue}` : null,
      "/skills install local <ABSOLUTE_PATH> 从本机绝对路径安装 skill（第一版不支持带空格路径）",
      "/skills install url <GITHUB_URL> [REF] 从 GitHub URL 安装 skill",
      "/skills install repo <REPO> <PATH> [REF] 从 GitHub 仓库路径安装 skill",
      "/skills install curated <SKILL_NAME> 从 curated 列表安装 skill",
      "",
      "如果想查看已安装项，请发送 /skills list。",
      "如果想查看可安装项，请发送 /skills curated。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendSkillsRemoveHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      "用法：/skills remove <SKILL_NAME>",
      `当前 principal：${principal.principalId}`,
      invalidValue ? `参数不完整或格式不正确：${invalidValue}` : null,
      "/skills remove <SKILL_NAME> 删除已安装 skill",
      "",
      "如果想查看已安装项，请发送 /skills list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendSkillsSyncHelp(
    chatId: string,
    context: FeishuIncomingContext,
    skillName?: string,
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      "用法：/skills sync <SKILL_NAME> [force]",
      `当前 principal：${principal.principalId}`,
      !skillName ? "缺少 skill 名称。" : null,
      invalidValue ? `未识别的同步参数：${invalidValue}` : null,
      "/skills sync <SKILL_NAME> [force] 重新同步 skill 到当前 principal 的所有账号槽位",
      "",
      "force 是自然语言参数，例如：/skills sync demo-skill force",
      "如果想查看已安装项，请发送 /skills list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendSkillsInstallResult(
    chatId: string,
    principalId: string,
    skillName: string,
    installStatus: string,
    lastError: string | null | undefined,
    sourceLines: Array<string | null>,
  ): Promise<void> {
    const lines = [
      `当前 principal：${principalId}`,
      `技能已安装：${skillName}`,
      `安装状态：${installStatus}`,
      ...sourceLines.filter((line): line is string => typeof line === "string" && line.trim().length > 0),
      lastError ? `最近错误：${lastError}` : null,
      "查看：/skills list",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendSkillsList(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const skills = this.runtime.getPrincipalSkillsService().listPrincipalSkills(principal.principalId);

    if (!skills.length) {
      await this.safeSendText(
        chatId,
        [
          `当前 principal：${principal.principalId}`,
          "已安装 skills",
          "已安装总数：0",
          "暂无已安装 skill。",
          "查看：/skills curated",
        ].join("\n"),
      );
      return;
    }

    const lines = [
      `当前 principal：${principal.principalId}`,
      "已安装 skills",
      `已安装总数：${skills.length}`,
      "",
      ...skills.flatMap((skill, index) => {
        const linesForSkill = [
          `${index + 1}. ${skill.skillName}`,
          `   状态：${skill.installStatus}`,
          `   来源：${describeSkillSource(skill.sourceType, skill.sourceRefJson)}`,
          `   说明：${skill.description}`,
          `   受管目录：${skill.managedPath}`,
          `   ${formatSkillSyncSummary(skill.summary)}`,
        ];

        if (skill.lastError) {
          linesForSkill.push(`   最近错误：${skill.lastError}`);
        }

        for (const materialization of skill.materializations) {
          if (materialization.state === "synced") {
            continue;
          }

          const detail = materialization.lastError ? `：${materialization.lastError}` : "";
          linesForSkill.push(`   账号槽位 ${materialization.targetId} [${materialization.state}]${detail}`);
        }

        if (index < skills.length - 1) {
          linesForSkill.push("");
        }

        return linesForSkill;
      }),
      "",
      "查看：/skills curated",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendSkillsCurated(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const curatedSkills = await this.runtime.getPrincipalSkillsService().listCuratedSkills(principal.principalId);

    if (!curatedSkills.length) {
      await this.safeSendText(
        chatId,
        [
          `当前 principal：${principal.principalId}`,
          "可安装 curated skills",
          "暂无可安装 curated skill。",
          "查看：/skills list",
        ].join("\n"),
      );
      return;
    }

    const lines = [
      `当前 principal：${principal.principalId}`,
      "可安装 curated skills",
      "",
      ...curatedSkills.map((skill, index) => `${index + 1}. ${skill.name} ${skill.installed ? "[已安装]" : "[未安装]"}`),
      "",
      "查看：/skills list",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendMcpHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidSegment?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      "MCP 管理：",
      `当前 principal：${principal.principalId}`,
      invalidSegment ? `未识别的 MCP 子命令：${invalidSegment}` : null,
      "/mcp 查看和维护当前 principal 的 MCP server",
      "/mcp list 查看当前 principal 已定义的 MCP server",
      "/mcp reload 重新读取当前 runtime 槽位的 MCP 状态",
      "/mcp enable <NAME> 启用 MCP server",
      "/mcp disable <NAME> 停用 MCP server",
      "/mcp remove <NAME> 删除 MCP server",
      "/mcp oauth <NAME> 发起 MCP server OAuth 登录",
      "",
      "如果想先看当前列表，请发送 /mcp list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendMcpList(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const servers = this.runtime.getPrincipalMcpService().listPrincipalMcpServers(principal.principalId);

    if (!servers.length) {
      await this.safeSendText(
        chatId,
        [
          `当前 principal：${principal.principalId}`,
          "MCP servers",
          "已定义总数：0",
          "暂无 MCP server。",
          "查看：/mcp reload",
        ].join("\n"),
      );
      return;
    }

    const lines = [
      `当前 principal：${principal.principalId}`,
      "MCP servers",
      `已定义总数：${servers.length}`,
      "",
      ...servers.flatMap((server, index) => {
        const args = safeParseMcpArgs(server.argsJson);
        const env = safeParseMcpEnv(server.envJson);
        const commandCopy = [server.command, ...args].join(" ").trim();
        const linesForServer = [
          `${index + 1}. ${server.serverName} ${server.enabled ? "[已启用]" : "[已停用]"}`,
          `   command：${commandCopy || server.command}`,
          `   来源：${describeMcpSource(server.sourceType)}`,
          server.cwd ? `   cwd：${server.cwd}` : null,
          Object.keys(env).length > 0 ? `   env keys：${Object.keys(env).join(", ")}` : null,
          `   ${formatMcpSummary(server.summary)}`,
        ].filter((line): line is string => line !== null);

        for (const materialization of server.materializations) {
          const detail = materialization.lastError ? `：${materialization.lastError}` : "";
          linesForServer.push(
            `   槽位 ${materialization.targetId} [${materialization.state}/${materialization.authState}]${detail}`,
          );
        }

        if (index < servers.length - 1) {
          linesForServer.push("");
        }

        return linesForServer;
      }),
      "",
      "查看：/mcp reload",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendMcpReloadHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      "用法：/mcp reload",
      `当前 principal：${principal.principalId}`,
      invalidValue ? `reload 不需要额外参数：${invalidValue}` : null,
      "/mcp reload 重新读取当前 runtime 槽位的 MCP 状态",
      "如果想先看当前定义，请发送 /mcp list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendMcpToggleHelp(
    chatId: string,
    context: FeishuIncomingContext,
    command: "enable" | "disable",
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      `用法：/mcp ${command} <NAME>`,
      `当前 principal：${principal.principalId}`,
      invalidValue ? `缺少或无法识别 MCP server 名称：${invalidValue}` : null,
      `/mcp ${command} <NAME> ${command === "enable" ? "启用" : "停用"} MCP server`,
      "如果想查看当前定义，请发送 /mcp list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendMcpRemoveHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      "用法：/mcp remove <NAME>",
      `当前 principal：${principal.principalId}`,
      invalidValue ? `缺少或无法识别 MCP server 名称：${invalidValue}` : null,
      "/mcp remove <NAME> 删除 MCP server",
      "如果想查看当前定义，请发送 /mcp list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendMcpOauthHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const principal = this.ensurePrincipalIdentity(context);
    const lines = [
      "用法：/mcp oauth <NAME>",
      `当前 principal：${principal.principalId}`,
      invalidValue ? `缺少或无法识别 MCP server 名称：${invalidValue}` : null,
      "/mcp oauth <NAME> 发起 MCP server OAuth 登录",
      "完成授权后建议执行 /mcp reload。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendPluginsHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidSegment?: string,
  ): Promise<void> {
    const { principal, result } = await this.readPrincipalPluginsState(context);
    const lines = [
      "Plugins 管理：",
      `当前 principal：${principal.principalId}`,
      `当前槽位：${result.target.targetId}`,
      invalidSegment ? `未识别的 plugins 子命令：${invalidSegment}` : null,
      "/plugins 查看和维护当前 principal 的 plugins",
      "/plugins list 查看当前 principal 已拥有 plugins，并附带当前环境发现结果",
      "/plugins read <MARKETPLACE> <PLUGIN_NAME> 查看 plugin 详情",
      "/plugins install <MARKETPLACE> <PLUGIN_NAME> 纳入当前 principal，并尝试物化到当前 runtime",
      "/plugins sync [remote] 把当前 principal 已拥有 plugins 重同步到当前 runtime",
      "/plugins uninstall <PLUGIN_ID> 从当前 principal 移除 plugin",
      "",
      "第一版支持用 marketplace 名称或 marketplacePath 指向 marketplace。",
      "repo-local plugin 如果当前工作区不可解析，会显示为“已拥有，但当前工作区不可用”。",
      "如果想先看当前列表，请发送 /plugins list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendPluginsList(chatId: string, _context: FeishuIncomingContext): Promise<void> {
    const context = _context;
    const { principal, result } = await this.readPrincipalPluginsState(context);

    if (!result.principalPlugins.length && !result.marketplaces.length) {
      await this.safeSendText(
        chatId,
        [
          `当前 principal：${principal.principalId}`,
          `当前槽位：${result.target.targetId}`,
          "Plugins",
          "已拥有：0",
          "当前环境 marketplace：0",
          "当前 principal 还没有已拥有 plugins，当前环境也没有发现可接入 marketplace。",
        ].join("\n"),
      );
      return;
    }

    const lines = [
      `当前 principal：${principal.principalId}`,
      `当前槽位：${result.target.targetId}`,
      "Plugins",
      `已拥有：${result.principalPlugins.length}`,
      `当前环境 marketplace：${result.marketplaces.length}`,
      result.remoteSyncError ? `远程同步异常：${result.remoteSyncError}` : null,
      result.marketplaceLoadErrors.length > 0 ? `读取失败的 marketplace：${result.marketplaceLoadErrors.length}` : null,
      "",
      "当前 principal 已拥有：",
      ...(result.principalPlugins.length > 0
        ? result.principalPlugins.flatMap((plugin, index) => {
          const pluginLines = [
            `${index + 1}. ${plugin.summary.interface?.displayName || plugin.pluginName} [${formatPrincipalPluginRuntimeState(plugin.summary.runtimeState)}]`,
            `   pluginId：${plugin.pluginId}`,
            `   marketplace：${plugin.marketplaceName}`,
            `   来源：${describePrincipalPluginSource(plugin)}`,
            `   安装策略：${formatPluginInstallPolicy(plugin.summary.installPolicy)}`,
            `   认证策略：${formatPluginAuthPolicy(plugin.summary.authPolicy)}`,
            plugin.lastError ? `   最近问题：${plugin.lastError}` : null,
            plugin.repairHint ? `   建议动作：${plugin.repairHint}` : null,
          ].filter((line): line is string => line !== null);

          if (index < result.principalPlugins.length - 1) {
            pluginLines.push("");
          }

          return pluginLines;
        })
        : ["当前 principal 还没有已拥有 plugins。"]),
      "",
      "当前环境发现：",
      ...result.marketplaces.flatMap((marketplace, marketplaceIndex) => {
        const marketplaceLines = [
          `${marketplaceIndex + 1}. ${marketplace.interface?.displayName || marketplace.name}`,
          `   name：${marketplace.name}`,
          `   path：${marketplace.path}`,
        ];

        if (!marketplace.plugins.length) {
          marketplaceLines.push("   当前没有可见 plugin。");
          if (marketplaceIndex < result.marketplaces.length - 1) {
            marketplaceLines.push("");
          }
          return marketplaceLines;
        }

        for (const plugin of marketplace.plugins) {
          const capabilityCopy = plugin.interface?.capabilities?.length
            ? plugin.interface.capabilities.join(", ")
            : "暂无能力标签";
          marketplaceLines.push(
            `   - ${plugin.name} ${plugin.owned ? "[已纳入 principal]" : "[未纳入 principal]"} [${formatPrincipalPluginRuntimeState(plugin.runtimeState)}]`,
          );
          marketplaceLines.push(`     pluginId：${plugin.id}`);
          marketplaceLines.push(`     安装策略：${formatPluginInstallPolicy(plugin.installPolicy)}`);
          marketplaceLines.push(`     认证策略：${formatPluginAuthPolicy(plugin.authPolicy)}`);
          marketplaceLines.push(`     能力：${capabilityCopy}`);
        }

        if (marketplaceIndex < result.marketplaces.length - 1) {
          marketplaceLines.push("");
        }

        return marketplaceLines;
      }),
      "",
      "查看详情：/plugins read <MARKETPLACE> <PLUGIN_NAME>",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendPluginsReadHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const { principal, result } = await this.readPrincipalPluginsState(context);
    const lines = [
      "用法：/plugins read <MARKETPLACE> <PLUGIN_NAME>",
      `当前 principal：${principal.principalId}`,
      `当前槽位：${result.target.targetId}`,
      invalidValue ? `参数不完整或格式不正确：${invalidValue}` : null,
      "MARKETPLACE 支持 marketplace 名称或完整 marketplacePath。",
      "如果想先看当前列表，请发送 /plugins list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendPluginsInstallHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const { principal, result } = await this.readPrincipalPluginsState(context);
    const lines = [
      "用法：/plugins install <MARKETPLACE> <PLUGIN_NAME>",
      `当前 principal：${principal.principalId}`,
      `当前槽位：${result.target.targetId}`,
      invalidValue ? `参数不完整或格式不正确：${invalidValue}` : null,
      "MARKETPLACE 支持 marketplace 名称或完整 marketplacePath。",
      "如果想先看当前列表，请发送 /plugins list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendPluginsSyncHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const { principal, result } = await this.readPrincipalPluginsState(context);
    const lines = [
      "用法：/plugins sync [remote]",
      `当前 principal：${principal.principalId}`,
      `当前槽位：${result.target.targetId}`,
      invalidValue ? `参数不完整或格式不正确：${invalidValue}` : null,
      "/plugins sync 把当前 principal 已拥有 plugins 对齐到当前 runtime / 工作区",
      "/plugins sync remote 会先远程刷新 marketplace，再执行同步",
      "如果想先看当前列表，请发送 /plugins list。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendPluginsUninstallHelp(
    chatId: string,
    context: FeishuIncomingContext,
    invalidValue?: string,
  ): Promise<void> {
    const { principal, result } = await this.readPrincipalPluginsState(context);
    const lines = [
      "用法：/plugins uninstall <PLUGIN_ID>",
      `当前 principal：${principal.principalId}`,
      `当前槽位：${result.target.targetId}`,
      invalidValue ? `参数不完整或格式不正确：${invalidValue}` : null,
      "pluginId 可先通过 /plugins list 查看。",
    ].filter((line): line is string => line !== null);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async resolvePluginMarketplaceReference(
    marketplaceToken: string,
    context: FeishuIncomingContext,
  ): Promise<{
    marketplaceName: string;
    marketplacePath: string;
  }> {
    const normalizedToken = normalizeText(marketplaceToken);

    if (!normalizedToken) {
      throw new Error("plugin marketplace 不能为空。");
    }

    const { result } = await this.readPrincipalPluginsState(context);
    const matched = result.marketplaces.filter((marketplace) =>
      marketplace.path === normalizedToken || marketplace.name === normalizedToken
    );

    if (matched.length === 1) {
      return {
        marketplaceName: matched[0]?.name ?? normalizedToken,
        marketplacePath: matched[0]?.path ?? normalizedToken,
      };
    }

    if (matched.length > 1) {
      throw new Error(`找到多个同名 marketplace：${normalizedToken}，请改用完整 marketplacePath。`);
    }

    throw new Error(`未找到 marketplace：${normalizedToken}。请先执行 /plugins list。`);
  }

  private async readPrincipalPluginsState(
    context: FeishuIncomingContext,
    options: {
      forceRemoteSync?: boolean;
    } = {},
  ): Promise<{
    principal: { principalId: string; principalDisplayName?: string };
    result: Awaited<ReturnType<ReturnType<RuntimeServiceHost["getPrincipalPluginsService"]>["listPrincipalPlugins"]>>;
  }> {
    const principal = this.ensurePrincipalIdentity(context);
    const result = await this.runtime.getPrincipalPluginsService().listPrincipalPlugins(
      principal.principalId,
      this.buildPluginRuntimeOptions(context, options),
    );

    return {
      principal,
      result,
    };
  }

  private buildPluginRuntimeOptions(
    context: FeishuIncomingContext,
    options: {
      forceRemoteSync?: boolean;
    } = {},
  ): {
    activeAuthAccount: ReturnType<CodexAuthRuntime["getActiveAccount"]>;
    cwd?: string;
    forceRemoteSync?: boolean;
  } {
    const sessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));
    const workspacePath = sessionId
      ? normalizeText(this.readSessionTaskSettings(sessionId).workspacePath)
      : null;

    return {
      activeAuthAccount: this.authRuntime.getActiveAccount(),
      ...(workspacePath ? { cwd: workspacePath } : {}),
      ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
    };
  }

  private async sendSessionList(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const sessions = this.runtime.getRuntimeStore().listRecentSessions(12);
    const currentSessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));

    if (!sessions.length) {
      await this.safeSendText(chatId, "当前还没有会话历史。直接发送文本，或先执行 /new 开始。");
      return;
    }

    const sessionLines = await Promise.all(sessions.map(async (session, index) => {
      const latest = normalizeText(session.latestTurn.summary) ?? session.latestTurn.goal;
      const currentMark = currentSessionId === session.sessionId ? "（当前）" : "";
      const sessionState = await this.readFeishuMobileSessionState(session.sessionId);
      const threadLine = sessionState.thread
        ? `线程：${sessionState.thread.threadId}｜${sessionState.thread.status ?? "unknown"}｜${sessionState.thread.turnCount} turns`
        : "";

      return [
        `${index + 1}. ${session.sessionId}${currentMark}`,
        `状态：${session.latestTurn.status}｜更新：${formatTimestamp(session.updatedAt)}`,
        `最近任务：${truncateText(latest, 80)}`,
        ...(threadLine ? [threadLine] : []),
      ].join("\n");
    }));

    const lines = [
      currentSessionId ? `当前会话：${currentSessionId}` : "当前会话：未激活",
      "",
      "最近会话：",
      ...sessionLines,
      "",
      "使用 /use <序号|conversationId> 切换会话。",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async createNewSession(chatId: string, context: FeishuIncomingContext): Promise<void> {
    if (!await this.ensureSharedGroupSessionMutationAllowed(context, "/new")) {
      return;
    }

    const conversationKey = this.resolveConversationKey(context);
    const previousSessionId = this.sessionStore.getActiveSessionId(conversationKey);
    const inheritedWorkspacePath = previousSessionId
      ? normalizeText(this.readSessionTaskSettings(previousSessionId).workspacePath)
      : null;
    const sessionId = this.sessionStore.createAndActivateSession(conversationKey);

    if (!inheritedWorkspacePath) {
      await this.safeSendText(chatId, `已创建新会话：${sessionId}\n后续直接发消息会进入这个新会话。`);
      return;
    }

    try {
      const saved = this.writeSessionTaskSettings(sessionId, {
        workspacePath: inheritedWorkspacePath,
      });
      const workspaceText = formatWorkspaceValue(saved.settings?.workspacePath);
      await this.safeSendText(
        chatId,
        [
          `已创建新会话：${sessionId}`,
          `已继承上一会话工作区：${workspaceText}`,
          "后续直接发消息会进入这个新会话。",
        ].join("\n"),
      );
    } catch (error) {
      await this.safeSendText(
        chatId,
        [
          `已创建新会话：${sessionId}`,
          `新会话已创建，但工作区继承失败：${toErrorMessage(error)}`,
          "后续直接发消息会进入这个新会话；如需设置工作区，请执行 /workspace <绝对目录>。",
        ].join("\n"),
      );
    }
  }

  private async handleWorkspaceCommand(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!await this.ensureSharedGroupSessionMutationAllowed(context, "/workspace")) {
      return;
    }

    const sessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));

    if (!sessionId) {
      await this.safeSendText(context.chatId, "当前还没有激活会话。直接发消息时会自动创建，或使用 /new 手动新建。");
      return;
    }

    const workspacePath = normalizeText(args.join(" "));

    if (!workspacePath) {
      await this.safeSendText(
        context.chatId,
        [
          `当前会话：${sessionId}`,
          `当前会话工作区：${formatWorkspaceValue(this.readSessionTaskSettings(sessionId).workspacePath)}`,
          "使用 /workspace <绝对目录> 设置当前会话工作区。",
        ].join("\n"),
      );
      return;
    }

    try {
      const saved = this.writeSessionTaskSettings(sessionId, {
        workspacePath,
      });
      await this.safeSendText(
        context.chatId,
        [
          `当前会话：${sessionId}`,
          `当前会话工作区已更新为：${formatWorkspaceValue(saved.settings?.workspacePath)}`,
          "查看：/current",
        ].join("\n"),
      );
    } catch (error) {
      await this.safeSendText(context.chatId, toErrorMessage(error));
    }
  }

  private async switchSession(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!await this.ensureSharedGroupSessionMutationAllowed(context, "/use")) {
      return;
    }

    const target = normalizeText(args.join(" "));

    if (!target) {
      await this.safeSendText(context.chatId, "用法：/use <序号|conversationId>");
      return;
    }

    const runtimeStore = this.runtime.getRuntimeStore();
    let resolvedSessionId: string | null = null;

    if (/^\d+$/.test(target)) {
      const index = Number.parseInt(target, 10);
      const sessions = runtimeStore.listRecentSessions(20);
      resolvedSessionId = sessions[index - 1]?.sessionId ?? null;
    } else if (runtimeStore.hasConversation(target)) {
      resolvedSessionId = target;
    } else if (runtimeStore.hasSessionTurn({ sessionId: target })) {
      resolvedSessionId = target;
    } else if (runtimeStore.getSession(target)) {
      resolvedSessionId = target;
    }

    if (!resolvedSessionId) {
      await this.safeSendText(context.chatId, "没有找到对应会话。先执行 /sessions 查看可切换的会话。");
      return;
    }

    this.sessionStore.setActiveSessionId(this.resolveConversationKey(context), resolvedSessionId);
    this.recordFeishuDiagnosticsEvent({
      type: "session.switched",
      context,
      sessionId: resolvedSessionId,
      summary: `已切换到会话：${resolvedSessionId}`,
      lastMessageId: context.messageId,
      details: {
        switchedSessionId: resolvedSessionId,
      },
    });
    await this.safeSendText(context.chatId, `已切换到会话：${resolvedSessionId}`);
    await this.sendCurrentSession(context.chatId, context);
  }

  private recordFeishuDiagnosticsEvent(input: {
    type: string;
    context: FeishuIncomingContext;
    sessionId?: string | null;
    principalId?: string | null;
    actionId?: string | null;
    requestId?: string | null;
    summary: string;
    lastMessageId?: string | null;
    details?: Record<string, FeishuDiagnosticsEventDetailValue>;
  }): void {
    const now = new Date().toISOString();
    const chatId = input.context.chatId;
    const userId = input.context.userId;
    const sessionId = input.sessionId ?? this.sessionStore.getActiveSessionId(this.resolveConversationKey(input.context)) ?? null;
    const principalId = input.principalId ?? this.ensurePrincipalIdentity(input.context).principalId;

    if (sessionId) {
      try {
        this.diagnosticsStateStore.upsertConversation({
          key: `${chatId}::${userId}`,
          chatId,
          userId,
          principalId,
          activeSessionId: sessionId,
          ...(input.lastMessageId ? { lastMessageId: input.lastMessageId } : {}),
          lastEventType: input.type,
          updatedAt: now,
          pendingActions: this.snapshotPendingActions({
            chatId,
            userId,
            sessionId,
            principalId,
          }),
        });
      } catch (error) {
        this.logger.warn(`[themis/feishu] 写入飞书诊断会话状态失败：${toErrorMessage(error)}`);
      }
    }

    try {
      this.diagnosticsStateStore.appendEvent({
        id: createId("feishu-diagnostics-event"),
        type: input.type,
        chatId,
        userId,
        ...(sessionId ? { sessionId } : {}),
        principalId,
        ...(input.lastMessageId ? { messageId: input.lastMessageId } : {}),
        ...(input.actionId ? { actionId: input.actionId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        summary: input.summary,
        createdAt: now,
        ...(input.details ? { details: input.details } : {}),
      });
    } catch (error) {
      this.logger.warn(`[themis/feishu] 写入飞书诊断事件失败：${toErrorMessage(error)}`);
    }
  }

  private snapshotPendingActions(scope: {
    chatId: string;
    userId: string;
    sessionId: string;
    principalId: string;
  }): FeishuDiagnosticsPendingAction[] {
    return this.actionBridge.list({
      sessionId: scope.sessionId,
      principalId: scope.principalId,
      userId: scope.userId,
    }).map((action) => ({
      actionId: action.actionId,
      actionType: action.actionType,
      taskId: action.taskId,
      requestId: action.requestId,
      sourceChannel: action.scope?.sourceChannel ?? "feishu",
      sessionId: action.scope?.sessionId ?? scope.sessionId,
      principalId: action.scope?.principalId ?? scope.principalId,
    }));
  }

  private async sendCurrentSession(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const sessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));

    if (!sessionId) {
      await this.safeSendText(chatId, "当前还没有激活会话。直接发消息时会自动创建，或使用 /new 手动新建。");
      return;
    }

    const principal = this.ensurePrincipalIdentity(context);
    const settings = this.readPrincipalTaskSettings(context);
    const accountState = resolvePrincipalAccountState({
      accounts: this.authRuntime.listAccounts(),
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId: normalizeText(settings.authAccountId),
    });
    const sessionState = await this.readFeishuMobileSessionState(sessionId);

    await this.safeSendText(
      chatId,
      renderFeishuCurrentSessionSurface({
        sessionId,
        workspacePath: sessionState.workspacePath,
        principalId: principal.principalId,
        accountLabel: describePrincipalAccountCurrentValue(accountState),
        ...(sessionState.latestStatus ? { latestStatus: sessionState.latestStatus } : {}),
        ...(sessionState.thread !== undefined ? { thread: sessionState.thread } : {}),
      }),
    );
  }

  private async stopCurrentSessionTask(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!await this.ensureSharedGroupSessionMutationAllowed(context, "/stop")) {
      return;
    }

    if (args.length > 0) {
      await this.safeSendText(context.chatId, "用法：/stop");
      return;
    }

    const sessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));

    if (!sessionId) {
      await this.safeSendText(context.chatId, "当前还没有激活会话。直接发消息时会自动创建，或使用 /new 手动新建。");
      return;
    }

    const stopped = await this.withSessionMutation(sessionId, async () => await this.abortActiveSessionTask(
      sessionId,
      "FEISHU_SESSION_STOPPED",
      `[themis/feishu] 当前会话任务被 /stop 中断：session=${sessionId}`,
    ));

    if (!stopped) {
      await this.safeSendText(
        context.chatId,
        [
          "当前会话没有正在运行的任务。",
          `当前会话：${sessionId}`,
        ].join("\n"),
      );
      return;
    }

    await this.safeSendText(
      context.chatId,
      [
        "已停止当前会话正在运行的任务。",
        `当前会话：${sessionId}`,
      ].join("\n"),
    );
  }

  private async startReview(args: string[], context: FeishuIncomingContext): Promise<void> {
    const instructions = normalizeText(args.join(" "));

    if (!instructions) {
      await this.safeSendText(context.chatId, "用法：/review <指令>");
      return;
    }

    const sessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));

    if (!sessionId) {
      await this.safeSendText(context.chatId, "当前还没有激活会话。直接发消息时会自动创建，或使用 /new 手动新建。");
      return;
    }

    const runtime = await this.selectRuntimeForSession(sessionId);

    if (typeof runtime.startReview !== "function") {
      await this.safeSendText(context.chatId, "当前会话的运行时不支持 review。");
      return;
    }

    try {
      const result = await runtime.startReview({
        sessionId,
        instructions,
      });
      await this.safeSendText(
        context.chatId,
        [
          "已发起 Review",
          `当前会话：${sessionId}`,
          `Review 线程：${result.reviewThreadId}`,
          `Turn：${result.turnId}`,
        ].join("\n"),
      );
    } catch (error) {
      await this.safeSendText(context.chatId, mapFeishuInteractiveActionErrorMessage(error));
    }
  }

  private async steerCurrentSession(args: string[], context: FeishuIncomingContext): Promise<void> {
    const message = normalizeText(args.join(" "));

    if (!message) {
      await this.safeSendText(context.chatId, "用法：/steer <指令>");
      return;
    }

    const sessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));

    if (!sessionId) {
      await this.safeSendText(context.chatId, "当前还没有激活会话。直接发消息时会自动创建，或使用 /new 手动新建。");
      return;
    }

    const runtime = await this.selectRuntimeForSession(sessionId);

    if (typeof runtime.steerTurn !== "function") {
      await this.safeSendText(context.chatId, "当前会话的运行时不支持 steer。");
      return;
    }

    try {
      const result = await runtime.steerTurn({
        sessionId,
        message,
      });
      await this.safeSendText(
        context.chatId,
        [
          "已发送 Steer",
          `当前会话：${sessionId}`,
          `Turn：${result.turnId}`,
        ].join("\n"),
      );
    } catch (error) {
      await this.safeSendText(context.chatId, mapFeishuInteractiveActionErrorMessage(error));
    }
  }

  private async selectRuntimeForSession(sessionId: string): Promise<TaskRuntimeFacade> {
    const runtimeStore = this.runtime.getRuntimeStore();
    const reference = resolveStoredSessionThreadReference(runtimeStore, sessionId);
    const appServerRuntime = resolveTaskRuntime(this.runtimeRegistry, "app-server");

    if (reference.engine === "app-server") {
      return appServerRuntime;
    }

    const storedThreadId = normalizeText(reference.threadId ?? runtimeStore.getSession(sessionId)?.threadId);

    if (storedThreadId && appServerRuntime?.readThreadSnapshot) {
      try {
        const snapshot = await appServerRuntime.readThreadSnapshot({
          threadId: storedThreadId,
        });

        if (snapshot) {
          return appServerRuntime;
        }
      } catch {
        // 继续回退到默认 runtime，由后续能力检查给出明确提示。
      }
    }

    return this.runtimeRegistry.defaultRuntime;
  }

  private async resetPrincipalState(args: string[], context: FeishuIncomingContext): Promise<void> {
    if (!isResetConfirmed(args)) {
      await this.safeSendText(
        context.chatId,
        [
          "这个命令会清空当前私人助理 principal 的人格档案、对话历史和记忆，并重新开始。",
          "执行方式：/reset confirm",
        ].join("\n"),
      );
      return;
    }

    const conversationKey = this.resolveConversationKey(context);
    const currentSessionId = this.sessionStore.getActiveSessionId(conversationKey);
    const lockKey = currentSessionId || `feishu-reset:${context.chatId}:${context.userId}`;

    await this.withSessionMutation(lockKey, async () => {
      if (currentSessionId) {
        await this.abortActiveSessionTask(
          currentSessionId,
          "FEISHU_PRINCIPAL_RESET",
          `[themis/feishu] 当前会话因重置命令被中断：session=${currentSessionId}`,
        );
      }

      const identity = this.runtime.getIdentityLinkService().ensureIdentity({
        channel: "feishu",
        channelUserId: context.userId,
      });
      const resetAt = new Date().toISOString();
      const reset = this.runtime.resetPrincipalState(identity.principalId, resetAt);
      const nextSessionId = this.sessionStore.createAndActivateSession(conversationKey);
      const lines = [
        `已重置 principal：${identity.principalId}`,
        `清空会话：${reset.clearedConversationCount} 条`,
        `清空任务记录：${reset.clearedTurnCount} 条`,
        `清空人格档案：${reset.clearedPersonaProfile ? "是" : "否"}`,
        `清空进行中建档：${reset.clearedPersonaOnboarding ? "是" : "否"}`,
        `清空默认任务配置：${reset.clearedPrincipalTaskSettings ? "是" : "否"}`,
        `新会话：${nextSessionId}`,
        "现在直接发消息，就会从头开始重新建档。",
      ];

      await this.safeSendText(context.chatId, lines.join("\n"));
    });
  }

  private async linkIdentity(args: string[], context: FeishuIncomingContext): Promise<void> {
    const code = normalizeText(args.join(" "))?.toUpperCase();

    if (!code) {
      await this.safeSendText(context.chatId, "用法：/link <绑定码>");
      return;
    }

    const result = this.runtime.getIdentityLinkService().claimLinkCode(code, {
      channel: "feishu",
      channelUserId: context.userId,
    });
    const lines = [
      result.alreadyLinked
        ? `这个绑定码对应的浏览器身份本来就已经和当前私人助理共用同一个 principal：${result.principalId}`
        : `绑定成功，当前飞书身份已接管该浏览器身份，principal：${result.principalId}`,
      `来源身份：${result.sourceChannel}/${result.sourceChannelUserId}`,
      "现在这个浏览器后续发出的 Web 请求，会自动归到同一个私人助理 principal。",
    ];

    await this.safeSendText(context.chatId, lines.join("\n"));
  }

  private async sendQuota(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const settings = this.readPrincipalTaskSettings(context);
    const principalAccountId = normalizeText(settings.authAccountId);
    const accountState = resolvePrincipalAccountState({
      accounts: this.authRuntime.listAccounts(),
      activeAccount: this.authRuntime.getActiveAccount(),
      principalAccountId,
    });

    if (principalAccountId && !accountState.configuredAccount) {
      await this.safeSendText(
        chatId,
        [
          "Codex 额度信息：",
          `当前 principal 默认认证账号已失效：${principalAccountId}`,
          "请执行 /settings account list 查看可选账号，并重新设置。",
        ].join("\n"),
      );
      return;
    }

    const snapshot = await this.authRuntime.readSnapshot(principalAccountId ?? undefined);
    const accounts = this.authRuntime.listAccounts();
    const resolvedAccountId = snapshot.accountId || principalAccountId || this.authRuntime.getActiveAccount()?.accountId || "";
    const account = findAuthAccountById(accounts, resolvedAccountId);

    if (!snapshot.authenticated) {
      await this.safeSendText(chatId, "Codex 当前没有可用认证，暂时无法读取额度信息。");
      return;
    }

    const lines = [
      "Codex 额度信息：",
      resolvedAccountId
        ? `认证账号：${formatAuthAccountLabel(account, resolvedAccountId)}${principalAccountId ? "（当前 principal 默认）" : "（跟随 Themis 系统默认）"}`
        : null,
      `认证方式：${snapshot.authMethod ?? "unknown"}`,
      snapshot.account?.email ? `账号：${snapshot.account.email}` : null,
      snapshot.account?.planType ? `套餐：${snapshot.account.planType}` : null,
      formatRateLimitLine("主额度", snapshot.rateLimits?.primary),
      formatRateLimitLine("次额度", snapshot.rateLimits?.secondary),
      formatCreditsLine(snapshot.rateLimits?.credits),
    ].filter((line): line is string => typeof line === "string" && line.trim().length > 0);

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async sendUnknownCommand(chatId: string, rawCommand: string): Promise<void> {
    await this.safeSendText(chatId, `未知命令：/${rawCommand}\n发送 /help 查看可用命令。`);
  }

  private async probeMessageUpdate(context: FeishuIncomingContext): Promise<void> {
    if (!this.client) {
      await this.safeSendText(context.chatId, "飞书客户端当前未启动，暂时无法执行消息更新探针。");
      return;
    }

    const probeId = createId("feishu-msgupdate");
    const startedAt = new Date().toISOString();
    const initialText = [
      "飞书消息更新探针",
      `探针 ID：${probeId}`,
      `开始时间：${formatTimestamp(startedAt)}`,
      "预期：这条消息会在约 2 秒内原地更新，而不是再发一条新消息。",
    ].join("\n");

    try {
      const created = await this.createTextMessage(context.chatId, initialText);
      const messageId = normalizeText(created.data?.message_id);

      if (!messageId) {
        await this.safeSendTaggedText(
          context.chatId,
          "消息更新探针失败：测试消息已经发出，但飞书接口没有返回 message_id，暂时无法继续验证更新能力。",
          "消息更新探针失败",
        );
        return;
      }

      await delay(1800);

      const updatedAt = new Date().toISOString();
      const updatedText = [
        "飞书消息更新探针",
        `探针 ID：${probeId}`,
        `开始时间：${formatTimestamp(startedAt)}`,
        `更新时间：${formatTimestamp(updatedAt)}`,
        "结果：这条消息已经被机器人原地更新。",
        "如果你最终只看到这一条消息，说明飞书文本消息 update 能力可用。",
      ].join("\n");

      await this.updateTextMessage(messageId, updatedText);
    } catch (error) {
      const message = formatFeishuMessageUpdateProbeError(error);
      this.logger.error(`[themis/feishu] 消息更新探针失败：${message}`);
      await this.safeSendTaggedText(context.chatId, message, "消息更新探针失败");
    }
  }

  private async createTextMessage(
    chatId: string,
    text: string,
  ): Promise<FeishuMessageMutationResponse> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      throw new Error("飞书客户端未就绪，或消息内容为空。");
    }

    if (splitForFeishuText(normalizedText).length > 1) {
      throw new Error("消息内容过长，无法作为单条飞书文本消息发送。");
    }

    return this.createMessage(chatId, {
      msgType: "text",
      content: JSON.stringify({ text: normalizedText }),
    });
  }

  private async updateTextMessage(
    messageId: string,
    text: string,
  ): Promise<FeishuMessageMutationResponse> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      throw new Error("飞书客户端未就绪，或消息内容为空。");
    }

    if (splitForFeishuText(normalizedText).length > 1) {
      throw new Error("消息内容过长，无法作为单条飞书文本消息更新。");
    }

    return this.updateMessage(messageId, {
      msgType: "text",
      content: JSON.stringify({ text: normalizedText }),
    });
  }

  private async recallMessage(messageId: string): Promise<FeishuMessageMutationResponse> {
    const client = this.client;

    if (!client) {
      throw new Error("飞书客户端未就绪，无法撤回消息。");
    }

    const startedAt = Date.now();

    try {
      const response = await client.im.v1.message.delete({
        path: {
          message_id: messageId,
        },
      });
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      this.logger.info(
        `[themis/feishu] 飞书消息发送完成：action=recall msgType=- chat=- message=${messageId} elapsedMs=${elapsedMs} bytes=0`,
      );
      return response;
    } catch (error) {
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      this.logger.error(
        `[themis/feishu] 飞书消息发送失败：action=recall msgType=- chat=- message=${messageId} elapsedMs=${elapsedMs} bytes=0 error=${toErrorMessage(error)}`,
      );
      throw error;
    }
  }

  private async createAssistantMessage(
    chatId: string,
    text: string,
  ): Promise<FeishuMessageMutationResponse> {
    return this.createMessage(chatId, renderFeishuAssistantMessage(text));
  }

  private async createAttachmentMessage(
    chatId: string,
    msgType: "image" | "file",
    content: {
      image_key?: string;
      file_key?: string;
    },
  ): Promise<FeishuMessageMutationResponse> {
    return this.createRawMessage(chatId, {
      msgType,
      content: JSON.stringify(content),
    });
  }

  private async updateAssistantMessage(
    messageId: string,
    text: string,
  ): Promise<FeishuMessageMutationResponse> {
    return this.updateMessage(messageId, renderFeishuAssistantMessage(text));
  }

  private async createMessage(
    chatId: string,
    draft: FeishuRenderedMessageDraft,
  ): Promise<FeishuMessageMutationResponse> {
    return this.createRawMessage(chatId, draft);
  }

  private async createRawMessage(
    chatId: string,
    draft: {
      msgType: string;
      content: string;
    },
  ): Promise<FeishuMessageMutationResponse> {
    const client = this.client;

    if (!client) {
      throw new Error("飞书客户端未就绪，或消息内容为空。");
    }

    const startedAt = Date.now();
    const payloadBytes = Buffer.byteLength(draft.content, "utf8");

    try {
      const response = await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: chatId,
          msg_type: draft.msgType,
          content: draft.content,
        },
      });
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const createdMessageId = normalizeText(response.data?.message_id) ?? "-";
      this.logger.info(
        `[themis/feishu] 飞书消息发送完成：action=create msgType=${draft.msgType} chat=${chatId} message=${createdMessageId} elapsedMs=${elapsedMs} bytes=${payloadBytes}`,
      );
      return response;
    } catch (error) {
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      this.logger.error(
        `[themis/feishu] 飞书消息发送失败：action=create msgType=${draft.msgType} chat=${chatId} elapsedMs=${elapsedMs} bytes=${payloadBytes} error=${toErrorMessage(error)}`,
      );
      throw error;
    }
  }

  private async updateMessage(
    messageId: string,
    draft: FeishuRenderedMessageDraft,
  ): Promise<FeishuMessageMutationResponse> {
    const client = this.client;

    if (!client) {
      throw new Error("飞书客户端未就绪，或消息内容为空。");
    }

    const startedAt = Date.now();
    const payloadBytes = Buffer.byteLength(draft.content, "utf8");

    try {
      const response = await client.im.v1.message.update({
        path: {
          message_id: messageId,
        },
        data: {
          msg_type: draft.msgType,
          content: draft.content,
        },
      });
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      this.logger.info(
        `[themis/feishu] 飞书消息发送完成：action=update msgType=${draft.msgType} chat=- message=${messageId} elapsedMs=${elapsedMs} bytes=${payloadBytes}`,
      );
      return response;
    } catch (error) {
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      this.logger.error(
        `[themis/feishu] 飞书消息发送失败：action=update msgType=${draft.msgType} chat=- message=${messageId} elapsedMs=${elapsedMs} bytes=${payloadBytes} error=${toErrorMessage(error)}`,
      );
      throw error;
    }
  }

  private async safeSendText(chatId: string, text: string): Promise<void> {
    const normalizedText = text.trim();

    if (!this.client || !normalizedText) {
      return;
    }

    for (const chunk of splitForFeishuText(normalizedText)) {
      await this.createTextMessage(chatId, chunk);
    }
  }

  private async safeSendTaggedText(chatId: string, text: string, tag: string): Promise<void> {
    for (const chunk of decorateTaggedChunks(text, tag)) {
      await this.safeSendText(chatId, chunk);
    }
  }

  private requireClient(): Lark.Client {
    if (!this.client) {
      throw new Error("飞书客户端未就绪，暂时无法处理附件消息。");
    }

    return this.client;
  }

  private resolveAttachmentWorkingDirectory(sessionId: string): string {
    const workspacePath = this.readSessionTaskSettings(sessionId).workspacePath?.trim();

    if (!workspacePath) {
      return this.runtime.getWorkingDirectory();
    }

    try {
      return validateWorkspacePath(workspacePath);
    } catch {
      throw new Error(SESSION_WORKSPACE_UNAVAILABLE_ERROR);
    }
  }

  private resolveScheduledTaskConversation(task: StoredScheduledTaskRecord): FeishuConversationKey | null {
    const sessionId = normalizeText(task.sessionId) ?? normalizeText(task.channelSessionKey);

    if (!sessionId) {
      return null;
    }

    return this.sessionStore.findConversationBySessionId(sessionId);
  }

  private async resolvePendingApproval(
    rawActionId: string | undefined,
    decision: "approve" | "deny",
    context: FeishuIncomingContext,
  ): Promise<void> {
    const actionId = normalizeText(rawActionId);

    if (!actionId) {
      const usage = decision === "approve" ? "用法：/approve <actionId>" : "用法：/deny <actionId>";
      await this.safeSendText(context.chatId, usage);
      return;
    }

    const actionScope = this.resolvePendingActionScope(context);
    const outcome = await this.submitPendingApprovalDecision({
      actionId,
      decision,
      context,
      scope: actionScope,
    });

    await this.safeSendText(context.chatId, outcome.message);
  }

  private async submitPendingApprovalDecision(input: {
    actionId: string;
    decision: "approve" | "deny";
    context: FeishuIncomingContext;
    scope: {
      sessionId: string;
      principalId: string;
      sourceChannel?: string;
      userId?: string;
    } | null;
  }): Promise<
    | {
        ok: true;
        message: string;
      }
    | {
        ok: false;
        reason: "scope_missing" | "action_not_found" | "wrong_action_type" | "expired";
        message: string;
      }
  > {
    if (!input.scope) {
      return {
        ok: false,
        reason: "scope_missing",
        message: "当前没有激活会话，请先切回对应会话后再提交 action。",
      };
    }

    const action = this.actionBridge.find(input.actionId, input.scope);

    if (!action) {
      return {
        ok: false,
        reason: "action_not_found",
        message: `未找到等待中的 action：${input.actionId}`,
      };
    }

    if (action.actionType !== "approval") {
      return {
        ok: false,
        reason: "wrong_action_type",
        message: `action ${input.actionId} 不是审批请求，请改用 /reply。`,
      };
    }

    if (!this.actionBridge.resolve({
      taskId: action.taskId,
      requestId: action.requestId,
      actionId: input.actionId,
      decision: input.decision,
    })) {
      this.recordFeishuDiagnosticsEvent({
        type: "approval.submit_failed",
        context: input.context,
        sessionId: action.scope?.sessionId ?? null,
        principalId: action.scope?.principalId ?? null,
        actionId: action.actionId,
        requestId: action.requestId,
        summary: `审批提交失败：${input.actionId} 已失效。`,
        lastMessageId: input.context.messageId,
        details: {
          matchedPendingActionCount: 1,
          ...(action.scope?.sessionId ? { sourceSessionId: action.scope.sessionId } : {}),
        },
      });
      return {
        ok: false,
        reason: "expired",
        message: `提交审批失败：${input.actionId} 已失效。`,
      };
    }

    this.recordFeishuDiagnosticsEvent({
      type: "approval.submitted",
      context: input.context,
      sessionId: action.scope?.sessionId ?? null,
      principalId: action.scope?.principalId ?? null,
      actionId: action.actionId,
      requestId: action.requestId,
      summary: input.decision === "approve" ? "审批已通过提交。" : "审批已拒绝提交。",
      lastMessageId: input.context.messageId,
      details: {
        matchedPendingActionCount: 1,
        ...(action.scope?.sessionId ? { sourceSessionId: action.scope.sessionId } : {}),
      },
    });

    return {
      ok: true,
      message: input.decision === "approve" ? "已提交审批。" : "已提交拒绝。",
    };
  }

  private async replyActivePendingInput(context: FeishuIncomingContext): Promise<boolean> {
    const sessionId = this.sessionStore.ensureActiveSessionId(this.resolveConversationKey(context));
    const principal = this.ensurePrincipalIdentity(context);
    const actionScope = {
      sessionId,
      principalId: principal.principalId,
    };

    const scopedActions = this.actionBridge.list(actionScope);
    const approvals = scopedActions.filter((action) => action.actionType === "approval");
    const inputActions = scopedActions.filter((action) => action.actionType === "user-input");

    if (approvals.length > 0 && inputActions.length > 0) {
      this.recordFeishuDiagnosticsEvent({
        type: "pending_input.blocked_by_approval",
        context,
        sessionId,
        principalId: principal.principalId,
        lastMessageId: context.messageId,
        summary: "当前会话存在审批待处理，普通文本不会自动接管。",
        details: {
          blockingReason: "approval_pending",
          approvalPendingActionCount: approvals.length,
          matchedPendingActionCount: inputActions.length,
        },
      });
      return false;
    }

    if (approvals.length > 0) {
      if (inputActions.length === 0) {
        this.recordFeishuDiagnosticsEvent({
          type: "pending_input.not_found",
          context,
          sessionId,
          principalId: principal.principalId,
          lastMessageId: context.messageId,
          summary: "当前会话没有可接管的等待输入。",
          details: {
            blockingReason: "approval_pending_without_takeover",
            approvalPendingActionCount: approvals.length,
            matchedPendingActionCount: 0,
          },
        });
      }
      return false;
    }

    if (inputActions.length === 0) {
      this.recordFeishuDiagnosticsEvent({
        type: "pending_input.not_found",
        context,
        sessionId,
        principalId: principal.principalId,
        lastMessageId: context.messageId,
        summary: "当前会话没有可接管的等待输入。",
        details: {
          blockingReason: "no_pending_input",
          approvalPendingActionCount: 0,
          matchedPendingActionCount: 0,
        },
      });
      return false;
    }

    if (inputActions.length > 1) {
      this.recordFeishuDiagnosticsEvent({
        type: "pending_input.ambiguous",
        context,
        sessionId,
        lastMessageId: context.messageId,
        principalId: principal.principalId,
        summary: "当前会话存在多条可接管的等待输入。",
        details: {
          blockingReason: "multiple_user_input_pending",
          matchedPendingActionCount: inputActions.length,
        },
      });
      await this.safeSendText(
        context.chatId,
        "当前会话存在多条待补充输入，请使用 /reply <actionId> <内容> 指定要回复的 action。",
      );
      return true;
    }

    const inputAction = inputActions[0];

    if (!inputAction) {
      return false;
    }

    return await this.submitPendingUserInput(inputAction, context.text, context, "takeover.submitted", 1);
  }

  private async submitPendingUserInput(
    action: TaskActionDescriptor & { taskId: string; requestId: string },
    rawInputText: string,
    context: FeishuIncomingContext,
    eventType: "reply.submitted" | "takeover.submitted" = "takeover.submitted",
    matchedPendingActionCount = 1,
  ): Promise<boolean> {
    const inputText = normalizeText(rawInputText);

    if (!inputText) {
      return false;
    }

    if (!this.actionBridge.resolve({
      taskId: action.taskId,
      requestId: action.requestId,
      actionId: action.actionId,
      inputText,
    })) {
      this.recordFeishuDiagnosticsEvent({
        type: eventType === "takeover.submitted" ? "takeover.submit_failed" : "reply.submit_failed",
        context,
        sessionId: action.scope?.sessionId ?? null,
        principalId: action.scope?.principalId ?? null,
        actionId: action.actionId,
        requestId: action.requestId,
        summary: eventType === "takeover.submitted"
          ? `普通文本补充输入失败：${action.actionId} 已失效。`
          : `命令式回复失败：${action.actionId} 已失效。`,
        lastMessageId: context.messageId,
        details: {
          matchedPendingActionCount,
          ...(action.scope?.sessionId ? { sourceSessionId: action.scope.sessionId } : {}),
        },
      });
      await this.safeSendText(context.chatId, `提交补充输入失败：${action.actionId} 已失效。`);
      return true;
    }

    this.recordFeishuDiagnosticsEvent({
      type: eventType,
      context,
      sessionId: action.scope?.sessionId ?? null,
      principalId: action.scope?.principalId ?? null,
      actionId: action.actionId,
      requestId: action.requestId,
      summary: eventType === "takeover.submitted"
        ? "普通文本已提交补充输入。"
        : "命令式 reply 已提交补充输入。",
      lastMessageId: context.messageId,
      details: {
        matchedPendingActionCount,
        ...(action.scope?.sessionId ? { sourceSessionId: action.scope.sessionId } : {}),
      },
    });
    await this.safeSendText(context.chatId, "已提交补充输入。");
    return true;
  }

  private async replyPendingAction(args: string[], context: FeishuIncomingContext): Promise<void> {
    const actionId = normalizeText(args[0]);
    const inputText = normalizeText(args.slice(1).join(" "));

    if (!actionId || !inputText) {
      await this.safeSendText(context.chatId, "用法：/reply <actionId> <内容>");
      return;
    }

    const actionScope = this.resolvePendingActionScope(context);

    if (!actionScope) {
      await this.safeSendText(context.chatId, "当前没有激活会话，请先切回对应会话后再提交 action。");
      return;
    }

    const action = this.actionBridge.find(actionId, actionScope);

    if (!action) {
      await this.safeSendText(context.chatId, `未找到等待中的 action：${actionId}`);
      return;
    }

    if (action.actionType !== "user-input") {
      await this.safeSendText(context.chatId, `action ${actionId} 不是补充输入请求，请改用 /approve 或 /deny。`);
      return;
    }

    await this.submitPendingUserInput(action, inputText, context, "reply.submitted");
  }

  private resolvePendingActionScope(context: FeishuIncomingContext): {
    sessionId: string;
    principalId: string;
  } | null {
    const sessionId = this.sessionStore.getActiveSessionId(this.resolveConversationKey(context));

    if (!sessionId) {
      return null;
    }

    const principal = this.ensurePrincipalIdentity(context);

    return {
      sessionId,
      principalId: principal.principalId,
    };
  }
}

function normalizeFeishuRuntimeRegistry(
  runtime: Pick<RuntimeServiceHost, "getRuntimeStore">,
  defaultAppServerRuntime: TaskRuntimeFacade,
  runtimeRegistry?: TaskRuntimeRegistry,
): TaskRuntimeRegistry {
  if (!runtimeRegistry) {
    return {
      defaultRuntime: defaultAppServerRuntime,
      runtimes: {
        "app-server": defaultAppServerRuntime,
      },
    };
  }

  const normalizedRegistry: TaskRuntimeRegistry = {
    defaultRuntime: runtimeRegistry.defaultRuntime,
    ...(runtimeRegistry.runtimes ? { runtimes: { ...runtimeRegistry.runtimes } } : {}),
  };
  const baseStore = runtime.getRuntimeStore();

  for (const [engine, registeredRuntime] of Object.entries(normalizedRegistry.runtimes ?? {})) {
    if (!registeredRuntime) {
      continue;
    }

    if (registeredRuntime.getRuntimeStore() !== baseStore) {
      throw new Error(`Feishu task runtime store mismatch for engine "${engine}": all runtimes must share the base runtime store.`);
    }
  }

  if (normalizedRegistry.defaultRuntime.getRuntimeStore() !== baseStore) {
    throw new Error("Feishu default runtime store mismatch: all runtimes must share the base runtime store.");
  }

  return normalizedRegistry;
}

function describeFeishuTaskInputWarning(
  warning: {
    code?: string | null;
    message?: string | null;
  },
): string | null {
  const code = normalizeText(warning.code);

  switch (code) {
    case "TEXT_NATIVE_INPUT_REQUIRED":
      return "当前执行链这一跳不支持文本原生输入，所以这条消息这次没法继续处理。请切回支持文本的执行链后再试。";
    case "IMAGE_NATIVE_INPUT_REQUIRED":
      return "当前执行链这一跳不支持原生图片附件，所以这张图片这次没法继续发给 runtime。请切到支持图片的执行链，或先用文字描述你想让我处理的内容。";
    case "DOCUMENT_NATIVE_INPUT_FALLBACK":
      return "当前执行链这一跳还不支持原生文档附件，所以这份文档只按文件路径提示处理，没有直接作为原生文档输入发送给 runtime。";
    case "DOCUMENT_MIME_TYPE_FALLBACK":
      return "当前文档类型暂时不在原生文档支持范围内，所以先按文件路径提示处理。";
    case "IMAGE_PATH_UNAVAILABLE":
      return "当前图片的本地临时文件已经失效，没法继续发送给 runtime，请重新发送这张图片后再试。";
    case "DOCUMENT_PATH_UNAVAILABLE":
      return "当前文档的本地临时文件已经失效，没法继续处理，请重新发送这个文档后再试。";
    case "DOCUMENT_INPUT_UNSUPPORTED": {
      const detail = normalizeDocumentInputUnsupportedDetail(warning.message);
      return detail
        ? `当前执行链这一跳还不支持这种文档输入（${detail}），所以这份附件这次没法继续处理。请换成受支持的文档类型，或直接把关键信息发成文本。`
        : "当前执行链这一跳还不支持这种文档输入，所以这份附件这次没法继续处理。请换成受支持的文档类型，或直接把关键信息发成文本。";
    }
    default:
      return null;
  }
}

function normalizeDocumentInputUnsupportedDetail(message: string | null | undefined): string | null {
  const normalized = normalizeText(message);

  if (!normalized) {
    return null;
  }

  const marker = "当前 runtime 不支持文档输入：";

  if (normalized.startsWith(marker)) {
    return normalizeText(normalized.slice(marker.length));
  }

  return normalized;
}

function dedupeTextValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function normalizeIncomingContext(event: FeishuMessageReceiveEvent): FeishuIncomingContext | null {
  const chatId = normalizeText(event.message?.chat_id);
  const messageId = normalizeText(event.message?.message_id);
  const messageCreateTimeMs = parseFeishuMessageCreateTime(event.message?.create_time);
  const userId = normalizeText(event.sender?.sender_id?.user_id)
    ?? normalizeText(event.sender?.sender_id?.open_id);
  const messageType = normalizeText(event.message?.message_type);
  const rawContent = normalizeText(event.message?.content);
  const text = extractFeishuText(event);
  const attachments = extractFeishuMessageResources(event);
  const openId = normalizeText(event.sender?.sender_id?.open_id);
  const tenantKey = normalizeText(event.sender?.tenant_key);
  const threadId = normalizeText(event.message?.thread_id);
  const chatType = normalizeText(event.message?.chat_type);
  const mentionCount = Array.isArray(event.message?.mentions) ? event.message.mentions.length : 0;

  if (!chatId || !messageId || !userId) {
    return null;
  }

  const shared: FeishuIncomingContextBase = {
    chatId,
    messageId,
    ...(typeof messageCreateTimeMs === "number" ? { messageCreateTimeMs } : {}),
    userId,
    ...(openId ? { openId } : {}),
    ...(tenantKey ? { tenantKey } : {}),
    ...(threadId ? { threadId } : {}),
    ...(chatType ? { chatType } : {}),
    ...(mentionCount > 0 ? { mentionCount } : {}),
  };

  if (text) {
    return {
      ...shared,
      kind: "text",
      text,
      ...(attachments?.length ? { attachments } : {}),
      ...(messageType === "post" && rawContent
        ? { postContentItems: extractFeishuPostContentItems(rawContent) }
        : {}),
    };
  }

  if (attachments?.length) {
    return {
      ...shared,
      kind: "attachment",
      text: "",
      attachments,
    };
  }

  return null;
}

function parseFeishuMessageCreateTime(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function extractFeishuText(event: FeishuMessageReceiveEvent): string | null {
  const messageType = normalizeText(event.message?.message_type);
  const rawContent = normalizeText(event.message?.content);

  if (!messageType || !rawContent) {
    return null;
  }

  if (messageType === "post") {
    return extractFeishuPostText(rawContent);
  }

  if (messageType !== "text") {
    return null;
  }

  try {
    const parsed = JSON.parse(rawContent) as { text?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text : "";

    if (!text.trim()) {
      return null;
    }

    const mentions = Array.isArray(event.message?.mentions) ? event.message.mentions : [];
    const stripped = mentions.reduce((currentText, mention) => {
      const mentionKey = normalizeText(mention?.key);
      return mentionKey ? currentText.split(mentionKey).join(" ") : currentText;
    }, text);

    const normalized = stripped.replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").trim();
    return normalized || null;
  } catch {
    return null;
  }
}

function formatFeishuUpdateOverview(overview: ThemisManagedUpdateOverview): string {
  const targetLabel = overview.check.updateChannel === "release"
    ? overview.check.latestReleaseTag
      ? `最新 release：${overview.check.latestReleaseTag} (${formatShortCommitHash(overview.check.latestCommit)})`
      : "最新 release：未检测到"
    : overview.check.latestCommit
      ? `远端提交：${formatShortCommitHash(overview.check.latestCommit)}`
      : "远端提交：未检测到";
  const rollbackLabel = overview.rollbackAnchor.available
    ? `可回退到：${formatShortCommitHash(overview.rollbackAnchor.previousCommit)}（记录于 ${overview.rollbackAnchor.recordedAt ?? "未知时间"}）`
    : "可回退到：当前没有最近一次成功升级记录";
  const operationLabel = !overview.operation
    ? "后台任务：当前没有运行中的升级任务"
    : overview.operation.status === "running"
      ? `后台任务：${overview.operation.action === "apply" ? "升级" : "回滚"}进行中，当前步骤 ${overview.operation.progressStep ?? "unknown"}`
      : overview.operation.status === "failed"
        ? `后台任务：最近一次${overview.operation.action === "apply" ? "升级" : "回滚"}失败`
        : `后台任务：最近一次${overview.operation.action === "apply" ? "升级" : "回滚"}已完成`;

  return [
    "Themis 更新状态：",
    `当前版本：${overview.check.packageVersion ?? "未检测到"}`,
    `当前提交：${formatShortCommitHash(overview.check.currentCommit)}`,
    `更新渠道：${overview.check.updateChannel}`,
    targetLabel,
    `检查结果：${overview.check.summary}`,
    rollbackLabel,
    operationLabel,
    overview.operation?.progressMessage ? `任务说明：${overview.operation.progressMessage}` : null,
    overview.operation?.result?.summary ? `任务结果：${overview.operation.result.summary}` : null,
    overview.operation?.errorMessage ? `失败原因：${overview.operation.errorMessage}` : null,
    "",
    "执行升级：/update apply confirm",
    "执行回滚：/update rollback confirm",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatOpsStatusMessage(status: ThemisOpsStatusSnapshot): string {
  const serviceStatus = status.serviceStatus;

  return [
    "Themis 实例状态：",
    `当前提交：${formatShortCommitHash(status.currentCommit)}（${formatCommitSource(status.currentCommitSource)}）`,
    status.currentBranch ? `当前分支：${status.currentBranch}` : null,
    `当前进程启动：${formatTimestamp(status.processStartedAt)}`,
    `服务单元：${status.serviceUnit ?? "未检测到"}`,
    serviceStatus ? `服务状态：${formatSystemdServiceState(serviceStatus)}` : null,
    serviceStatus?.mainPid ? `MainPID：${serviceStatus.mainPid}` : null,
    serviceStatus?.execMainStartTimestamp ? `systemd 启动时间：${serviceStatus.execMainStartTimestamp}` : null,
    status.restartPlanErrorMessage ? `重启入口：未就绪，${status.restartPlanErrorMessage}` : status.restartPlanMessage ? `重启入口：${status.restartPlanMessage}` : null,
    formatRestartRequestMarker(status.restartRequest),
    "",
    "请求重启：/ops restart confirm",
    "升级 / 回滚：/update",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatSystemdServiceState(status: ThemisSystemdServiceStatus): string {
  if (status.errorMessage) {
    return `读取失败，${status.errorMessage}`;
  }

  const activeState = status.activeState
    ? status.subState ? `${status.activeState} (${status.subState})` : status.activeState
    : "未知";
  return status.loadState ? `${activeState}，LoadState=${status.loadState}` : activeState;
}

function formatRestartRequestMarker(marker: ThemisRestartRequestMarker | null): string {
  if (!marker) {
    return "最近重启请求：无";
  }

  const reason = formatRestartRequestReason(marker.reason);

  if (marker.status === "confirmed") {
    const confirmedAt = marker.confirmedAt ? formatTimestamp(marker.confirmedAt) : "未知时间";
    const processStartedAt = marker.confirmedProcessStartedAt
      ? `，新进程启动 ${formatTimestamp(marker.confirmedProcessStartedAt)}`
      : "";
    return `最近重启请求：已确认（${reason}，${confirmedAt}${processStartedAt}）`;
  }

  if (marker.status === "failed") {
    const failedAt = marker.failedAt ? formatTimestamp(marker.failedAt) : "未知时间";
    return `最近重启请求：请求失败（${reason}，${failedAt}${marker.errorMessage ? `，${marker.errorMessage}` : ""}）`;
  }

  return `最近重启请求：等待确认（${reason}，请求于 ${formatTimestamp(marker.requestedAt)}）`;
}

function formatRestartRequestReason(reason: ThemisRestartRequestMarker["reason"]): string {
  switch (reason) {
    case "managed_update_apply":
      return "升级后重启";
    case "managed_update_rollback":
      return "回滚后重启";
    case "ops_restart":
    default:
      return "手动重启";
  }
}

function formatCommitSource(source: ThemisOpsStatusSnapshot["currentCommitSource"]): string {
  switch (source) {
    case "env":
      return "THEMIS_BUILD_COMMIT";
    case "git":
      return "git";
    case "unknown":
    default:
      return "未检测到";
  }
}

function parseFeishuCommand(text: string): ParsedFeishuCommand | null {
  const normalized = text.trim();

  if (!normalized.startsWith("/")) {
    return null;
  }

  const raw = normalized.slice(1).trim();

  if (!raw) {
    return {
      name: "help",
      args: [],
      raw: "help",
    };
  }

  const segments = raw.split(/\s+/).filter(Boolean);
  const [name, ...args] = segments;

  if (!name) {
    return null;
  }

  return {
    name: name.toLowerCase(),
    args,
    raw,
  };
}

function isResetConfirmed(args: string[]): boolean {
  return args.some((arg) => {
    const normalized = arg.trim().toLowerCase();
    return normalized === "confirm" || normalized === "确认";
  });
}

function createAttachmentDraftKey(
  context: Pick<FeishuIncomingContextBase, "chatId" | "userId">,
  sessionId: string,
): FeishuAttachmentDraftKey {
  return {
    chatId: context.chatId,
    userId: context.userId,
    sessionId,
  };
}

function buildFeishuDraftPartsFromAssets(assets: FeishuMessageResourceAsset[]): FeishuAttachmentDraftPart[] {
  return assets.map((asset, order) => ({
    type: asset.kind === "image" ? "image" : "document",
    role: "user",
    order,
    assetId: asset.assetId,
    ...(asset.name ? { caption: asset.name } : {}),
  }));
}

function buildFeishuInputEnvelope(
  context: Extract<FeishuIncomingContext, { kind: "text" }>,
  sessionId: string,
  draft: FeishuAttachmentDraftSnapshot | null,
  inlineAssets: FeishuMessageResourceAsset[],
): TaskInputEnvelope | undefined {
  const parts: FeishuAttachmentDraftPart[] = [];
  const assets = [...(draft?.assets ?? []), ...inlineAssets];
  const inlineAssetById = new Map(inlineAssets.map((asset) => [asset.assetId, asset]));
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const orderedDraftParts = orderFeishuDraftPartsByAssetCreatedAt(draft?.parts ?? [], assetById);
  let order = 0;

  if (context.postContentItems?.length) {
    for (const item of context.postContentItems) {
      if (item.type === "text") {
        parts.push({
          type: "text",
          role: "user",
          order,
          text: item.text,
        });
        order += 1;
        continue;
      }

      const assetId = `${context.messageId}::${item.imageKey}`;
      const asset = inlineAssetById.get(assetId);

      if (!asset) {
        continue;
      }

      parts.push({
        type: "image",
        role: "user",
        order,
        assetId,
        ...(asset.name ? { caption: asset.name } : {}),
      });
      order += 1;
    }
  } else if (context.text.trim()) {
    parts.push({
      type: "text",
      role: "user",
      order,
      text: context.text,
    });
    order += 1;
  }

  for (const part of orderedDraftParts) {
    if (part.type === "text") {
      if (part.text?.trim()) {
        parts.push({
          type: "text",
          role: "user",
          order,
          text: part.text,
        });
        order += 1;
      }
      continue;
    }

    parts.push({
      type: part.type,
      role: "user",
      order,
      assetId: part.assetId,
      ...(part.caption ? { caption: part.caption } : {}),
    });
    order += 1;
  }

  if (!context.postContentItems?.length) {
    for (const asset of inlineAssets) {
      parts.push({
        type: asset.kind === "image" ? "image" : "document",
        role: "user",
        order,
        assetId: asset.assetId,
        ...(asset.name ? { caption: asset.name } : {}),
      });
      order += 1;
    }
  }

  if (assets.length === 0 || parts.length === 0) {
    return undefined;
  }

  return createTaskInputEnvelope({
    sourceChannel: "feishu",
    sourceSessionId: sessionId,
    sourceMessageId: context.messageId,
    createdAt: new Date().toISOString(),
    parts,
    assets: orderFeishuAssetsByPartSequence(parts, assets),
  });
}

function buildFeishuRestorableDraftFromSnapshots(
  reservedDraft: FeishuAttachmentDraftSnapshot | null,
  inlineDraft: {
    parts: FeishuAttachmentDraftPart[];
    assets: FeishuMessageResourceAsset[];
  } | null,
): {
  parts: FeishuAttachmentDraftPart[];
  assets: FeishuAttachmentDraftAsset[];
} | null {
  const parts = [
    ...(reservedDraft?.parts ?? []),
    ...(inlineDraft?.parts ?? []),
  ];
  const assets = [
    ...(reservedDraft?.assets ?? []),
    ...(inlineDraft?.assets ?? []),
  ];

  if (parts.length === 0 || assets.length === 0) {
    return null;
  }

  return {
    parts,
    assets,
  };
}

function buildFeishuRestorableDraftFromEnvelope(
  envelope: TaskInputEnvelope,
): {
  parts: FeishuAttachmentDraftPart[];
  assets: FeishuAttachmentDraftAsset[];
} | null {
  const nonTextParts = envelope.parts.filter((part): part is Extract<typeof envelope.parts[number], { type: "image" | "document" }> => (
    part.type === "image" || part.type === "document"
  ));

  if (nonTextParts.length === 0) {
    return null;
  }

  const assetById = new Map(envelope.assets.map((asset) => [asset.assetId, asset]));
  const baseMs = Number.isFinite(Date.parse(envelope.createdAt)) ? Date.parse(envelope.createdAt) : Date.now();
  const parts: FeishuAttachmentDraftPart[] = [];
  const assets: FeishuAttachmentDraftAsset[] = [];
  const seenAssetIds = new Set<string>();

  for (const [index, part] of nonTextParts.entries()) {
    const asset = assetById.get(part.assetId);

    if (!asset) {
      continue;
    }

    parts.push({
      type: part.type,
      role: "user",
      order: index,
      assetId: part.assetId,
      ...("caption" in part && part.caption ? { caption: part.caption } : {}),
    });

    if (seenAssetIds.has(part.assetId)) {
      continue;
    }

    seenAssetIds.add(part.assetId);
    assets.push({
      ...asset,
      id: asset.assetId,
      type: asset.kind === "image" ? "image" : "file",
      value: asset.localPath,
      // Restore drafts in the exact asset order of the failed submission instead of re-sorting by old message times.
      createdAt: new Date(baseMs + index).toISOString(),
    });
  }

  if (parts.length === 0 || assets.length === 0) {
    return null;
  }

  return {
    parts,
    assets,
  };
}

function orderFeishuDraftPartsByAssetCreatedAt(
  parts: FeishuAttachmentDraftPart[],
  assetById: Map<string, {
    assetId: string;
    createdAt?: string;
  }>,
): FeishuAttachmentDraftPart[] {
  return [...parts]
    .map((part, index) => ({
      part,
      index,
      createdAtMs: part.type === "text"
        ? null
        : parseFeishuAssetCreatedAt(assetById.get(part.assetId)?.createdAt),
    }))
    .sort((left, right) => {
      if (left.createdAtMs !== null && right.createdAtMs !== null && left.createdAtMs !== right.createdAtMs) {
        return left.createdAtMs - right.createdAtMs;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.part);
}

function orderFeishuAssetsByPartSequence<T extends {
  assetId: string;
}>(
  parts: FeishuAttachmentDraftPart[],
  assets: T[],
): T[] {
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const part of parts) {
    if (part.type === "text" || seen.has(part.assetId)) {
      continue;
    }

    const asset = assetById.get(part.assetId);

    if (!asset) {
      continue;
    }

    ordered.push(asset);
    seen.add(part.assetId);
  }

  for (const asset of assets) {
    if (seen.has(asset.assetId)) {
      continue;
    }

    ordered.push(asset);
  }

  return ordered;
}

function parseFeishuAssetCreatedAt(value: string | undefined): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decorateTaggedChunks(text: string, tag: string): string[] {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return [];
  }

  const tagLabel = `[${tag}]`;
  const chunks = splitForFeishuText(normalizedText, tagLabel.length + 12);

  if (chunks.length === 1) {
    return [`${chunks[0]}\n\n${tagLabel}`];
  }

  return chunks.map((chunk, index) => `${chunk}\n\n[${tag} ${index + 1}/${chunks.length}]`);
}

function buildScheduledTaskResultText(input: {
  task: StoredScheduledTaskRecord;
  run: StoredScheduledTaskRunRecord;
  outcome: "completed" | "failed" | "cancelled";
  failureMessage?: string;
}): string {
  const summary = normalizeText(
    input.run.resultSummary
      ?? input.failureMessage
      ?? input.task.lastError
      ?? undefined,
  );
  const output = normalizeScheduledTaskResultOutput(input.run.resultOutput);
  const lines = [
    `状态：${describeScheduledTaskOutcome(input.outcome)}`,
    `任务：${input.task.goal}`,
    `计划时间：${input.task.scheduledAt} (${input.task.timezone})`,
    `任务 ID：${input.task.scheduledTaskId}`,
  ];

  if (summary) {
    lines.push(`结果摘要：${summary}`);
  }

  if (output && output !== summary) {
    lines.push("结果内容：");
    lines.push(output);
  }

  return lines.join("\n");
}

function buildManagedAgentScheduledFollowupResolvedText(input: {
  task: StoredScheduledTaskRecord;
  workItem: StoredAgentWorkItemRecord;
  targetAgent?: StoredManagedAgentRecord | null;
  outcome: "completed" | "failed" | "cancelled";
  runs?: ManagedAgentFollowupRunRecord[];
  latestCompletion?: {
    summary: string;
    output?: unknown;
    completedAt?: string;
  } | null;
}): string {
  const summary = normalizeText(input.latestCompletion?.summary);
  const targetAgentLabel = normalizeText(input.targetAgent?.displayName) ?? input.workItem.targetAgentId;
  const lines = [
    `状态：关联 work item ${describeManagedAgentScheduledFollowupOutcome(input.outcome)}`,
    `已取消回看：${input.task.goal}`,
    `原计划时间：${input.task.scheduledAt} (${input.task.timezone})`,
    `员工：${targetAgentLabel}`,
    `工作项：${input.workItem.goal}`,
    `工作项 ID：${input.workItem.workItemId}`,
  ];

  appendManagedAgentFollowupRunLines(lines, input.runs);

  if (summary) {
    lines.push(`结果摘要：${summary}`);
  }

  return lines.join("\n");
}

function buildManagedAgentScheduledFollowupResolvedTaskPrompt(input: {
  task: StoredScheduledTaskRecord;
  workItem: StoredAgentWorkItemRecord;
  targetAgent?: StoredManagedAgentRecord | null;
  outcome: "completed" | "failed" | "cancelled";
  runs?: ManagedAgentFollowupRunRecord[];
  latestCompletion?: {
    summary: string;
    output?: unknown;
    completedAt?: string;
  } | null;
}): string {
  const summary = normalizeText(input.latestCompletion?.summary);
  const completedAt = normalizeText(input.latestCompletion?.completedAt);
  const targetAgentLabel = normalizeText(input.targetAgent?.displayName) ?? input.workItem.targetAgentId;
  const lines = [
    "系统事件：watched managed-agent work item 已提前收口。",
    "",
    `关联 work item 状态：${describeManagedAgentScheduledFollowupOutcome(input.outcome)}`,
    `已取消原回看：${input.task.goal}`,
    `原计划回看时间：${input.task.scheduledAt} (${input.task.timezone})`,
    `员工：${targetAgentLabel}`,
    `工作项：${input.workItem.goal}`,
    `工作项 ID：${input.workItem.workItemId}`,
  ];

  appendManagedAgentFollowupRunLines(lines, input.runs);

  if (summary) {
    lines.push(`结果摘要：${summary}`);
  }

  if (completedAt) {
    lines.push(`收口时间：${completedAt}`);
  }

  lines.push(
    "",
    "请在当前会话里处理这个系统事件：告诉用户这条回看为什么提前收口、当前 work item 已经是什么终态；如果上面已经有最近 run 的失败码/失败原因，必须直接说明这些事实，不要再说“先查失败原因”；再基于这些事实更新下一步推进计划。不要再说等待同一个 work item 出报告。",
  );

  return lines.join("\n");
}

function appendManagedAgentFollowupRunLines(lines: string[], runs: ManagedAgentFollowupRunRecord[] | undefined): void {
  const latestRun = selectLatestManagedAgentFollowupRun(runs);

  if (!latestRun) {
    return;
  }

  lines.push(`最近 run：${latestRun.runId}`);
  lines.push(`run 状态：${latestRun.status}`);

  const nodeId = normalizeText(latestRun.nodeId);
  if (nodeId) {
    lines.push(`worker 节点：${nodeId}`);
  }

  const failureCode = normalizeText(latestRun.failureCode);
  if (failureCode) {
    lines.push(`失败码：${failureCode}`);
  }

  const failureMessage = normalizeText(latestRun.failureMessage);
  if (failureMessage) {
    lines.push(`失败原因：${failureMessage}`);
  }
}

function selectLatestManagedAgentFollowupRun(
  runs: ManagedAgentFollowupRunRecord[] | undefined,
): ManagedAgentFollowupRunRecord | null {
  if (!runs?.length) {
    return null;
  }

  return [...runs].sort(compareManagedAgentFollowupRunsDesc)[0] ?? null;
}

function compareManagedAgentFollowupRunsDesc(
  left: ManagedAgentFollowupRunRecord,
  right: ManagedAgentFollowupRunRecord,
): number {
  const rightTime = parseManagedAgentFollowupRunTime(right);
  const leftTime = parseManagedAgentFollowupRunTime(left);

  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return right.runId.localeCompare(left.runId);
}

function parseManagedAgentFollowupRunTime(run: ManagedAgentFollowupRunRecord): number {
  const timeValue = normalizeText(run.updatedAt)
    ?? normalizeText(run.completedAt)
    ?? normalizeText(run.startedAt)
    ?? normalizeText(run.createdAt);
  const timestamp = timeValue ? Date.parse(timeValue) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function describeScheduledTaskOutcome(outcome: "completed" | "failed" | "cancelled"): string {
  switch (outcome) {
    case "completed":
      return "已完成";
    case "failed":
      return "执行失败";
    case "cancelled":
      return "已取消";
    default:
      return outcome;
  }
}

function describeManagedAgentScheduledFollowupOutcome(outcome: "completed" | "failed" | "cancelled"): string {
  switch (outcome) {
    case "completed":
      return "已完成";
    case "failed":
      return "已失败";
    case "cancelled":
      return "已取消";
    default:
      return outcome;
  }
}

function normalizeScheduledTaskResultOutput(value: string | undefined): string | null {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  if (normalized.length <= 1200) {
    return normalized;
  }

  return `${normalized.slice(0, 1200).trimEnd()}\n…（结果过长，已截断）`;
}

function splitForFeishuText(text: string, reservedChars = 0): string[] {
  const normalized = text.trim();

  if (!normalized) {
    return [];
  }

  const maxLength = Math.max(256, MAX_FEISHU_TEXT_CHARS - reservedChars);
  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength);

    if (splitIndex < Math.floor(maxLength * 0.6)) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }

    if (splitIndex < Math.floor(maxLength * 0.6)) {
      splitIndex = maxLength;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    chunks.push(chunk);
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

function formatRateLimitLine(
  label: string,
  window: {
    usedPercent: number;
    windowDurationMins: number;
    resetsAt: string | null;
  } | null | undefined,
): string | null {
  if (!window) {
    return null;
  }

  const remaining = Math.max(0, 100 - window.usedPercent);
  const resetCopy = window.resetsAt ? formatTimestamp(window.resetsAt) : "未知";

  return `${label}：剩余 ${remaining}%｜窗口 ${window.windowDurationMins} 分钟｜重置 ${resetCopy}`;
}

function formatCreditsLine(
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null | undefined,
): string | null {
  if (!credits) {
    return null;
  }

  if (credits.unlimited) {
    return "附加 credits：不限额";
  }

  if (credits.balance) {
    return `附加 credits：${credits.balance}`;
  }

  if (credits.hasCredits) {
    return "当前账号存在附加 credits";
  }

  return null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function redactSensitiveFeishuLogText(text: string): string {
  const normalized = text.trim();
  const commandText = normalized.startsWith("/") ? normalized.slice(1).trim() : normalized;
  const segments = commandText.split(/\s+/).filter(Boolean);
  const [name, scope, subcommand, secretRef] = segments;

  if (
    (name?.toLowerCase() === "secret" || name?.toLowerCase() === "secrets")
    && scope?.toLowerCase() === "worker"
    && (subcommand?.toLowerCase() === "set" || subcommand?.toLowerCase() === "put")
  ) {
    const prefix = normalized.startsWith("/") ? "/" : "";
    return `${prefix}${name} ${scope} ${subcommand}${secretRef ? ` ${secretRef}` : ""} [REDACTED_SECRET]`;
  }

  return redactThemisSecretIntakeText(text);
}

async function ensureAuthAvailable(authRuntime: CodexAuthRuntime, request: TaskRequest): Promise<void> {
  if (request.options?.accessMode === "third-party") {
    if (authRuntime.readThirdPartyProviderProfile()?.type === "openai-compatible") {
      return;
    }

    throw new Error("当前没有可用的第三方兼容接入配置。");
  }

  const auth = await authRuntime.readSnapshot(request.options?.authAccountId);

  if (!auth.requiresOpenaiAuth || auth.authenticated) {
    return;
  }

  throw new Error("Not logged in");
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function parseFeishuAttachmentLookupIntent(text: string): FeishuAttachmentLookupIntent {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return {
      active: false,
      requireKeyBias: false,
      exactTokens: [],
    };
  }

  const exactTokens = extractFeishuAttachmentLookupTokens(normalized);
  const hasHistoricalRef = [
    "之前",
    "以前",
    "上次",
    "刚才",
    "发过",
    "发给你",
    "给你发",
    "还在",
    "不见",
    "没了",
    "找不到",
    "在哪",
    "哪里",
    "那个",
    "那份",
  ].some((token) => normalized.includes(token));
  const hasAttachmentRef = [
    "附件",
    "文件",
    "图片",
    "文档",
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "csv",
    "zip",
    "key",
    "ssh",
    "密钥",
    "私钥",
  ].some((token) => normalized.includes(token));
  const requireKeyBias = [
    "私钥",
    "密钥",
    "ssh",
    "key",
    "pem",
    "ppk",
    "id_ed25519",
    "id_rsa",
    "authorized_keys",
    "known_hosts",
  ].some((token) => normalized.includes(token));

  return {
    active: (hasAttachmentRef && hasHistoricalRef)
      || (requireKeyBias && (hasHistoricalRef || exactTokens.some(isStrongAttachmentLookupToken)))
      || exactTokens.some(isStrongAttachmentLookupToken),
    requireKeyBias,
    exactTokens,
  };
}

function extractFeishuAttachmentLookupTokens(text: string): string[] {
  const matches = text.match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? [];
  const tokens = matches
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3)
    .filter((token) => !["themis", "feishu", "message", "session", "chat"].includes(token));

  return [...new Set(tokens)];
}

function isStrongAttachmentLookupToken(token: string): boolean {
  return token.includes(".") || token.includes("_") || /\d/.test(token) || token.startsWith("id_");
}

function mapStoredFeishuAttachmentCandidate(asset: StoredChannelInputAssetRecord): RecoveredFeishuAttachmentCandidate {
  return {
    source: "history",
    ...(asset.sessionId ? { sessionId: asset.sessionId } : {}),
    ...(asset.name ? { name: asset.name } : {}),
    localPath: asset.localPath,
    ...(asset.sourceMessageId ? { sourceMessageId: asset.sourceMessageId } : {}),
    createdAt: asset.createdAt,
    exists: existsSync(asset.localPath),
  };
}

function selectRecoveredFeishuAttachmentCandidates(
  intent: FeishuAttachmentLookupIntent,
  candidates: RecoveredFeishuAttachmentCandidate[],
): RecoveredFeishuAttachmentCandidate[] {
  const deduped = new Map<string, RecoveredFeishuAttachmentCandidate>();

  for (const candidate of candidates) {
    const key = candidate.localPath;
    const previous = deduped.get(key);

    if (!previous) {
      deduped.set(key, candidate);
      continue;
    }

    const previousScore = scoreRecoveredFeishuAttachmentCandidate(previous, intent);
    const nextScore = scoreRecoveredFeishuAttachmentCandidate(candidate, intent);
    if (nextScore > previousScore || (
      nextScore === previousScore
      && Date.parse(candidate.createdAt) > Date.parse(previous.createdAt)
    )) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()]
    .map((candidate) => ({
      candidate,
      score: scoreRecoveredFeishuAttachmentCandidate(candidate, intent),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return Date.parse(right.candidate.createdAt) - Date.parse(left.candidate.createdAt);
    })
    .slice(0, FEISHU_ATTACHMENT_LOOKUP_PROMPT_LIMIT)
    .map(({ candidate }) => candidate);
}

function scoreRecoveredFeishuAttachmentCandidate(
  candidate: RecoveredFeishuAttachmentCandidate,
  intent: FeishuAttachmentLookupIntent,
): number {
  const haystack = [
    candidate.name ?? "",
    candidate.localPath,
    candidate.sourceMessageId ?? "",
  ].join("\n").toLowerCase();

  let score = intent.requireKeyBias || intent.exactTokens.length > 0 ? 0 : 1;

  if (intent.requireKeyBias) {
    if (!looksLikeSshKeyCandidate(candidate)) {
      return 0;
    }

    score += 120;
  }

  for (const token of intent.exactTokens) {
    if (haystack.includes(token)) {
      score += 80 + Math.min(token.length, 20);
    }
  }

  if (candidate.exists) {
    score += 10;
  }

  if (candidate.source === "draft") {
    score += 2;
  }

  return score;
}

function looksLikeSshKeyCandidate(candidate: RecoveredFeishuAttachmentCandidate): boolean {
  const haystack = `${candidate.name ?? ""}\n${candidate.localPath}`.toLowerCase();
  return [
    "id_ed25519",
    "id_rsa",
    "id_ecdsa",
    "id_dsa",
    "authorized_keys",
    "known_hosts",
    ".pem",
    ".ppk",
    ".key",
    "private",
  ].some((token) => haystack.includes(token));
}

function formatRecoveredFeishuAttachmentPromptSection(
  candidates: RecoveredFeishuAttachmentCandidate[],
): string {
  const lines = [
    "Recovered prior Feishu attachment facts:",
    "- Query scope: same Feishu user across all local Feishu history plus still-active attachment drafts.",
    "- These facts come from deterministic local lookup. Do not guess or contradict them.",
  ];

  if (candidates.length === 0) {
    lines.push("- No matching prior Feishu attachments were found in local stores.");
    lines.push("- If you answer about missing files, say they were not found in local stores rather than claiming they never existed.");
    return lines.join("\n");
  }

  lines.push("- If a row below says exists=yes, treat that file as still present on disk even if it is not in ~/.ssh or memories/.");

  for (const [index, candidate] of candidates.entries()) {
    lines.push(
      `${index + 1}. source=${candidate.source}; exists=${candidate.exists ? "yes" : "no"}; createdAt=${candidate.createdAt};`
      + `${candidate.sessionId ? ` sessionId=${candidate.sessionId};` : ""}`
      + ` name=${formatRecoveredFeishuAttachmentName(candidate)}; path=${candidate.localPath}`
      + `${candidate.sourceMessageId ? `; sourceMessageId=${candidate.sourceMessageId}` : ""}`,
    );
  }

  return lines.join("\n");
}

function formatRecoveredFeishuAttachmentName(candidate: RecoveredFeishuAttachmentCandidate): string {
  if (candidate.name) {
    return candidate.name;
  }

  const parts = candidate.localPath.split(/[\\/]+/u);
  return parts.at(-1) ?? candidate.localPath;
}

function parseSandboxModeArgument(args: string[]): SandboxMode | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  return SANDBOX_MODES.includes(value as SandboxMode) ? (value as SandboxMode) : null;
}

function isDefaultSettingArgument(value: string): boolean {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized === "default" || normalized === "follow" || normalized === "clear";
}

function parseWebSearchModeArgument(args: string[]): WebSearchMode | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  return WEB_SEARCH_MODES.includes(value as WebSearchMode) ? (value as WebSearchMode) : null;
}

function resolveRuntimeModelArgument(
  value: string,
  runtimeConfig: CodexRuntimeCatalog | null,
  currentModel?: string | null,
): string | null {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  const models = listAvailablePrincipalModelIds(runtimeConfig, currentModel);

  if (models.length === 0) {
    return normalizedValue;
  }

  return matchCaseInsensitiveChoice(normalizedValue, models);
}

function parseGroupRoutePolicyArgument(args: string[]): FeishuChatRoutePolicy | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  return value === "smart" || value === "always" ? value : null;
}

function parseGroupSessionScopeArgument(args: string[]): FeishuChatSessionScope | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  if (value === "personal" || value === "user") {
    return "personal";
  }

  return value === "shared" ? "shared" : null;
}

function isGroupChatType(chatType: string | null | undefined): boolean {
  return normalizeText(chatType)?.toLowerCase() === "group";
}

function parsePluginsSyncRemoteArgument(value: string): boolean | null {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized === "remote" || normalized === "force" ? true : null;
}

function parseSkillsSyncForceArgument(value: string): boolean | null {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized === "force" ? true : null;
}

function parseApprovalPolicyArgument(args: string[]): ApprovalPolicy | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  return APPROVAL_POLICIES.includes(value as ApprovalPolicy) ? (value as ApprovalPolicy) : null;
}

function resolveRuntimeReasoningArgument(
  value: string,
  choices: readonly string[],
): ReasoningLevel | null {
  const normalizedValue = normalizeText(value);

  if (!normalizedValue) {
    return null;
  }

  const matched = matchCaseInsensitiveChoice(normalizedValue, choices);
  return matched && REASONING_LEVELS.includes(matched as ReasoningLevel) ? (matched as ReasoningLevel) : null;
}

function parseNetworkAccessArgument(args: string[]): boolean | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  if (["on", "true", "1", "yes", "enabled"].includes(value)) {
    return true;
  }

  if (["off", "false", "0", "no", "disabled"].includes(value)) {
    return false;
  }

  return null;
}

function resolveEffectivePrincipalSettings(
  settings: PrincipalTaskSettings,
  runtimeConfig: CodexRuntimeCatalog | null,
): {
  model: string | null;
  reasoning: string | null;
  approvalPolicy: string | null;
  sandboxMode: string | null;
  webSearchMode: string | null;
  networkAccessEnabled: boolean | null;
} {
  const runtimeDefaults = runtimeConfig?.defaults ?? null;

  return {
    model: settings.model ?? runtimeDefaults?.model ?? null,
    reasoning: settings.reasoning ?? runtimeDefaults?.reasoning ?? null,
    approvalPolicy: settings.approvalPolicy ?? runtimeDefaults?.approvalPolicy ?? null,
    sandboxMode: settings.sandboxMode ?? runtimeDefaults?.sandboxMode ?? null,
    webSearchMode: settings.webSearchMode ?? runtimeDefaults?.webSearchMode ?? null,
    networkAccessEnabled: typeof settings.networkAccessEnabled === "boolean"
      ? settings.networkAccessEnabled
      : runtimeDefaults?.networkAccessEnabled ?? null,
  };
}

function formatSettingSourceLabel(hasOverride: boolean): string {
  return hasOverride ? "当前 principal 默认配置" : "Themis 系统默认值";
}

function formatSettingSummaryValue(value: string | null | undefined, hasOverride: boolean): string {
  return `${value ?? "未配置"}（${formatSettingSourceLabel(hasOverride)}）`;
}

function formatBooleanCommandValue(value: boolean | null | undefined): string {
  if (typeof value !== "boolean") {
    return "未配置";
  }

  return value ? "on" : "off";
}

function formatWorkspaceValue(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  return normalized ?? "未设置（回退到 Themis 启动目录）";
}

function listAvailablePrincipalModelIds(
  runtimeConfig: CodexRuntimeCatalog | null,
  currentModel?: string | null,
): string[] {
  const configuredModel = normalizeText(runtimeConfig?.defaults.model);
  const normalizedCurrentModel = normalizeText(currentModel);
  const models = (runtimeConfig?.models ?? [])
    .filter((model) => !model.hidden || model.model === configuredModel || model.model === normalizedCurrentModel)
    .map((model) => model.model);

  return dedupeTextValues([
    normalizedCurrentModel,
    configuredModel,
    ...models,
  ]);
}

function listAvailablePrincipalReasoningChoices(
  runtimeConfig: CodexRuntimeCatalog | null,
  model: string | null | undefined,
  currentReasoning?: string | null,
): string[] {
  const normalizedModel = normalizeText(model);
  const activeModel = normalizedModel
    ? runtimeConfig?.models.find((entry) => entry.model === normalizedModel) ?? null
    : null;
  const modelChoices = Array.isArray(activeModel?.supportedReasoningEfforts) && activeModel.supportedReasoningEfforts.length
    ? activeModel.supportedReasoningEfforts.map((entry) => normalizeText(entry.reasoningEffort))
    : [...REASONING_LEVELS];

  return dedupeTextValues([
    normalizeText(currentReasoning),
    ...modelChoices,
  ]);
}

function matchCaseInsensitiveChoice(value: string, choices: readonly string[]): string | null {
  const normalizedValue = normalizeText(value)?.toLowerCase();

  if (!normalizedValue) {
    return null;
  }

  return choices.find((choice) => choice.toLowerCase() === normalizedValue) ?? null;
}

function formatSkillSyncSummary(summary: {
  totalAccounts: number;
  syncedCount: number;
  conflictCount: number;
  failedCount: number;
}): string {
  return `已同步 ${summary.syncedCount}/${summary.totalAccounts}，冲突 ${summary.conflictCount}，失败 ${summary.failedCount}`;
}

function formatMcpSummary(summary: {
  totalTargets: number;
  readyCount: number;
  authRequiredCount: number;
  failedCount: number;
}): string {
  return `runtime 槽位 ${summary.totalTargets} 个，已就绪 ${summary.readyCount}，待认证 ${summary.authRequiredCount}，失败 ${summary.failedCount}`;
}

function summarizePrincipalMcpList(servers: Array<{
  summary: {
    readyCount: number;
    authRequiredCount: number;
    failedCount: number;
  };
}>): {
  readyCount: number;
  authRequiredCount: number;
  failedCount: number;
} {
  return servers.reduce((accumulator, server) => ({
    readyCount: accumulator.readyCount + (server.summary?.readyCount ?? 0),
    authRequiredCount: accumulator.authRequiredCount + (server.summary?.authRequiredCount ?? 0),
    failedCount: accumulator.failedCount + (server.summary?.failedCount ?? 0),
  }), {
    readyCount: 0,
    authRequiredCount: 0,
    failedCount: 0,
  });
}

function describeMcpSource(sourceType: string): string {
  switch (normalizeText(sourceType)?.toLowerCase()) {
    case "manual":
      return "手工";
    case "themis-managed":
      return "Themis 注入";
    default:
      return sourceType || "未知来源";
  }
}

function formatPluginInstallPolicy(value: string): string {
  switch (normalizeText(value)?.toUpperCase()) {
    case "AVAILABLE":
      return "可安装";
    case "INSTALLED_BY_DEFAULT":
      return "默认安装";
    case "NOT_AVAILABLE":
      return "不可安装";
    default:
      return value || "未知";
  }
}

function formatPluginAuthPolicy(value: string): string {
  switch (normalizeText(value)?.toUpperCase()) {
    case "ON_INSTALL":
      return "安装时认证";
    case "ON_USE":
      return "使用时认证";
    default:
      return value || "未知";
  }
}

function formatPrincipalPluginRuntimeState(value: string): string {
  switch (normalizeText(value)?.toLowerCase()) {
    case "installed":
      return "当前已可用";
    case "available":
      return "当前可发现";
    case "missing":
      return "当前工作区不可用";
    case "auth_required":
      return "当前需认证";
    case "failed":
      return "当前状态异常";
    default:
      return value || "未知";
  }
}

function formatPrincipalPluginSourceType(value: string): string {
  switch (normalizeText(value)?.toLowerCase()) {
    case "marketplace":
      return "marketplace";
    case "repo-local":
      return "repo 本地";
    case "home-local":
      return "宿主机本地";
    default:
      return value || "未知";
  }
}

function formatPrincipalPluginSourceScope(value: string): string {
  switch (normalizeText(value)?.toLowerCase()) {
    case "marketplace":
      return "可跨工作区复用";
    case "workspace-current":
      return "当前工作区";
    case "workspace-other":
      return "其他工作区";
    case "host-local":
      return "宿主机本地";
    default:
      return "未知来源边界";
  }
}

function describePrincipalPluginSource(plugin: {
  sourceType?: string;
  sourceScope?: string;
  sourcePath?: string | null;
  sourceRef?: {
    sourcePath?: string;
    workspaceFingerprint?: string;
    marketplaceName?: string;
    marketplacePath?: string;
  } | null;
}): string {
  const sourceType = formatPrincipalPluginSourceType(plugin.sourceType ?? "");
  const sourceScope = formatPrincipalPluginSourceScope(plugin.sourceScope ?? "");
  const sourcePath = normalizeText(plugin.sourcePath ?? undefined)
    ?? normalizeText(plugin.sourceRef?.sourcePath ?? undefined);
  const workspaceFingerprint = normalizeText(plugin.sourceRef?.workspaceFingerprint ?? undefined);
  const marketplaceName = normalizeText(plugin.sourceRef?.marketplaceName ?? undefined);
  const marketplacePath = normalizeText(plugin.sourceRef?.marketplacePath ?? undefined);
  const parts = [sourceType];

  if (sourceScope && sourceScope !== "未知来源边界") {
    parts.push(sourceScope);
  }

  if (sourcePath) {
    parts.push(sourcePath);
  } else if (marketplacePath) {
    parts.push(`${marketplaceName || "marketplace"} @ ${marketplacePath}`);
  } else if (marketplaceName) {
    parts.push(marketplaceName);
  }

  if (workspaceFingerprint && normalizeText(plugin.sourceType)?.toLowerCase() === "repo-local") {
    parts.push(`工作区 ${workspaceFingerprint}`);
  }

  return parts.join("｜");
}

function safeParseMcpArgs(argsJson: string): string[] {
  try {
    const parsed = JSON.parse(argsJson);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function safeParseMcpEnv(envJson: string): Record<string, string> {
  try {
    const parsed = JSON.parse(envJson);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = key.trim();

      if (!normalizedKey || typeof value !== "string") {
        continue;
      }

      normalized[normalizedKey] = value;
    }

    return normalized;
  } catch {
    return {};
  }
}

function describeSkillSource(sourceType: string, sourceRefJson: string): string {
  const sourceRef = parseSkillSourceRef(sourceRefJson);

  switch (sourceType) {
    case "local-path":
      return sourceRef?.absolutePath && typeof sourceRef.absolutePath === "string"
        ? `本地路径：${sourceRef.absolutePath}`
        : `本地路径：${sourceRefJson}`;
    case "github-url":
      return describeGithubUrlSkillSource(sourceRef);
    case "github-repo-path":
      return describeGithubRepoPathSkillSource(sourceRef);
    case "curated":
      return describeCuratedSkillSource(sourceRef);
    default:
      return `${sourceType}：${sourceRefJson}`;
  }
}

function describeGithubUrlSkillSource(sourceRef: Record<string, unknown> | null): string {
  if (!sourceRef?.url || typeof sourceRef.url !== "string") {
    return "GitHub URL：未知";
  }

  const ref = typeof sourceRef.ref === "string" && sourceRef.ref.trim() ? `，ref：${sourceRef.ref}` : "";
  return `GitHub URL：${sourceRef.url}${ref}`;
}

function describeGithubRepoPathSkillSource(sourceRef: Record<string, unknown> | null): string {
  if (!sourceRef?.repo || !sourceRef.path || typeof sourceRef.repo !== "string" || typeof sourceRef.path !== "string") {
    return "GitHub 仓库路径：未知";
  }

  const ref = typeof sourceRef.ref === "string" && sourceRef.ref.trim() ? `，ref：${sourceRef.ref}` : "";
  return `GitHub 仓库：${sourceRef.repo} / ${sourceRef.path}${ref}`;
}

function describeCuratedSkillSource(sourceRef: Record<string, unknown> | null): string {
  if (!sourceRef?.repo || !sourceRef.path || typeof sourceRef.repo !== "string" || typeof sourceRef.path !== "string") {
    return "curated：未知";
  }

  return `curated：${sourceRef.repo} / ${sourceRef.path}`;
}

function parseSkillSourceRef(sourceRefJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(sourceRefJson);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolvePrincipalAccountState<T extends { accountId: string; label?: string | null; accountEmail?: string | null }>(options: {
  accounts: T[];
  activeAccount: T | null;
  principalAccountId: string | null;
}): {
  principalAccountId: string | null;
  configuredAccount: T | null;
  activeAccount: T | null;
  effectiveAccountId: string | null;
} {
  const configuredAccount = findAuthAccountById(options.accounts, options.principalAccountId);
  const effectiveAccountId = options.principalAccountId
    || options.activeAccount?.accountId
    || options.accounts[0]?.accountId
    || null;

  return {
    principalAccountId: options.principalAccountId,
    configuredAccount,
    activeAccount: options.activeAccount,
    effectiveAccountId,
  };
}

function describePrincipalAccountCurrentValue<T extends { accountId: string; label?: string | null; accountEmail?: string | null }>(
  state: {
    principalAccountId: string | null;
    configuredAccount: T | null;
    activeAccount: T | null;
    effectiveAccountId: string | null;
  },
): string {
  if (state.principalAccountId) {
    if (state.configuredAccount) {
      return `固定使用 ${formatAuthAccountLabel(state.configuredAccount, state.principalAccountId)}`;
    }

    return `固定使用 ${state.principalAccountId}（当前账号列表中不存在）`;
  }

  if (state.effectiveAccountId) {
    return `跟随 Themis 系统默认账号 ${formatAuthAccountLabel(state.activeAccount, state.effectiveAccountId)}`;
  }

  return "跟随 Themis 系统默认账号";
}

function findAuthAccountById<T extends { accountId: string }>(accounts: T[], accountId: string | null | undefined): T | null {
  const normalizedAccountId = normalizeText(accountId ?? undefined);

  if (!normalizedAccountId) {
    return null;
  }

  return accounts.find((account) => account.accountId === normalizedAccountId) ?? null;
}

function findAuthAccountByQuery<T extends { accountId: string; label?: string | null; accountEmail?: string | null }>(
  accounts: T[],
  query: string | null | undefined,
): T | null {
  const normalizedQuery = normalizeText(query)?.toLowerCase();

  if (!normalizedQuery) {
    return null;
  }

  return accounts.find((account) => {
    const candidates = [
      normalizeText(account.accountId)?.toLowerCase() ?? "",
      normalizeText(account.label)?.toLowerCase() ?? "",
      normalizeText(account.accountEmail)?.toLowerCase() ?? "",
    ].filter(Boolean);

    return candidates.includes(normalizedQuery);
  }) ?? null;
}

function formatAuthAccountLabel(
  account: { accountId: string; label?: string | null; accountEmail?: string | null } | null | undefined,
  fallbackAccountId?: string | null,
): string {
  const normalizedAccountId = normalizeText(account?.accountId ?? fallbackAccountId ?? undefined) ?? "";
  const normalizedEmail = normalizeText(account?.accountEmail ?? undefined) ?? "";
  const normalizedLabel = normalizeText(account?.label ?? undefined) ?? "";
  return normalizedEmail || normalizedLabel || normalizedAccountId || "当前账号";
}

function describeAuthSnapshotLines(snapshot: {
  authenticated: boolean;
  pendingLogin?: {
    mode?: string | null;
    authUrl?: string | null;
    verificationUri?: string | null;
    userCode?: string | null;
    startedAt?: string | null;
    expiresAt?: string | null;
  } | null;
  lastError?: string | null;
}): string[] {
  const pendingLogin = snapshot.pendingLogin;
  const lines = [];

  if (pendingLogin?.mode === "device") {
    lines.push("状态：等待完成设备码授权");
    lines.push("下一步：打开授权页，输入设备码，完成一次授权。");
    if (normalizeText(pendingLogin.verificationUri)) {
      lines.push(`授权页：${pendingLogin.verificationUri}`);
    }
    if (normalizeText(pendingLogin.userCode)) {
      lines.push(`设备码：${pendingLogin.userCode}`);
    }
    if (normalizeText(pendingLogin.startedAt)) {
      lines.push(`开始时间：${formatTimestamp(pendingLogin.startedAt as string)}`);
    }
    if (normalizeText(pendingLogin.expiresAt)) {
      lines.push(`过期时间：${formatTimestamp(pendingLogin.expiresAt as string)}`);
    }
  } else if (pendingLogin?.mode === "browser") {
    lines.push("状态：等待完成浏览器登录");
    lines.push("下一步：请改到 Web 端继续完成浏览器登录。");
    if (normalizeText(pendingLogin.authUrl)) {
      lines.push(`登录链接：${pendingLogin.authUrl}`);
    }
    if (normalizeText(pendingLogin.startedAt)) {
      lines.push(`开始时间：${formatTimestamp(pendingLogin.startedAt as string)}`);
    }
  } else {
    lines.push(snapshot.authenticated ? "状态：已认证" : "状态：未认证");
    lines.push(
      snapshot.authenticated
        ? "下一步：可以直接开始聊天。"
        : "下一步：发送 /settings account login device 发起设备码登录。",
    );
  }

  if (normalizeText(snapshot.lastError ?? undefined)) {
    lines.push(`最近一次失败：${snapshot.lastError}`);
  }

  return lines;
}

function dedupeLines(lines: Array<string | null | undefined>): string[] {
  const normalized = lines
    .map((line) => normalizeText(line ?? undefined))
    .filter((line): line is string => Boolean(line));

  return normalized.filter((line, index) => normalized.indexOf(line) === index);
}

function parseFeishuLoggerLevel(value: string | undefined): Lark.LoggerLevel {
  switch (normalizeText(value)?.toLowerCase()) {
    case "fatal":
      return Lark.LoggerLevel.fatal;
    case "error":
      return Lark.LoggerLevel.error;
    case "warn":
      return Lark.LoggerLevel.warn;
    case "debug":
      return Lark.LoggerLevel.debug;
    case "trace":
      return Lark.LoggerLevel.trace;
    case "info":
    default:
      return Lark.LoggerLevel.info;
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

function normalizeApprovalDecision(value: unknown): "approve" | "deny" | null {
  return value === "approve" || value === "deny" ? value : null;
}

function normalizeFeishuCardActionEvent(value: unknown): InteractiveCardActionEvent | null {
  const topLevel = asRecord(value);
  const event = asRecord(topLevel?.event);
  const action = asRecord(event?.action);
  const actionValue = asRecord(action?.value);
  const openId = normalizeText(event?.open_id);
  const tenantKey = normalizeText(event?.tenant_key);
  const openMessageId = normalizeText(event?.open_message_id);
  const token = normalizeText(event?.token);
  const tag = normalizeText(action?.tag);

  if (!topLevel || !event || !action || !actionValue || !openId || !tenantKey || !openMessageId || !token || !tag) {
    return null;
  }

  return {
    open_id: openId,
    ...(normalizeText(event?.user_id) ? { user_id: normalizeText(event?.user_id) ?? "" } : {}),
    tenant_key: tenantKey,
    open_message_id: openMessageId,
    token,
    action: {
      value: actionValue,
      tag,
      ...(normalizeText(action?.option) ? { option: normalizeText(action?.option) ?? "" } : {}),
      ...(normalizeText(action?.timezone) ? { timezone: normalizeText(action?.timezone) ?? "" } : {}),
    },
  };
}

function resolveApprovalCardTerminalMessage(record: FeishuApprovalCardRecord): string {
  if (record.lastError) {
    return record.lastError;
  }

  switch (record.status) {
    case "approved":
      return "审批已经提交为批准。";
    case "denied":
      return "审批已经提交为拒绝。";
    case "failed":
      return "审批卡已经失效，请改用文本命令处理。";
    case "pending":
    default:
      return "审批仍在等待处理中。";
  }
}

function mapFeishuInteractiveActionErrorMessage(error: unknown): string {
  const message = toErrorMessage(error);

  if (
    message === "当前会话还没有可用的 app-server thread。"
    || message === "当前会话还没有可引导的 app-server turn。"
    || message === "当前 app-server runtime 不支持 review/start。"
    || message === "当前 app-server runtime 不支持 turn/steer。"
  ) {
    return message;
  }

  return message;
}

function normalizePendingActionType(value: unknown): "approval" | "user-input" | null {
  return value === "approval" || value === "user-input" ? value : null;
}

function shouldRenderFeishuStatusSurface(
  message: FeishuDeliveryMessage,
): boolean {
  if (message.kind !== "event" || message.title !== "task.progress") {
    return false;
  }

  const metadata = asRecord(message.metadata);
  const traceKind = normalizeText(metadata?.traceKind);
  const itemType = normalizeText(metadata?.itemType);

  if (traceKind === "tool") {
    return false;
  }

  if (itemType === "agent_message") {
    return false;
  }

  return Boolean(normalizeText(message.text));
}

function resolveFeishuTaskStatusPhase(
  message: FeishuDeliveryMessage,
): "running" | "action-submitted-running" | "restoring" | "completed" | "failed" {
  const metadata = asRecord(message.metadata);
  const status = normalizeText(metadata?.status);
  const text = normalizeText(message.text) ?? "";

  if (status === "running" && /(审批已提交|补充输入已提交|继续执行中|继续处理中|同步中)/.test(text)) {
    return "action-submitted-running";
  }

  if (status === "running" && /(恢复|rehydrate|同步)/i.test(text)) {
    return "restoring";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "completed") {
    return "completed";
  }

  return "running";
}

function buildFeishuHttpInstance(options: {
  logger: FeishuChannelLogger;
  useEnvProxy: boolean;
}): typeof Lark.defaultHttpInstance {
  const httpInstance = Lark.defaultHttpInstance;

  if (!options.useEnvProxy) {
    httpInstance.defaults.proxy = false;
    options.logger.info("[themis/feishu] 已对飞书 SDK HTTP 请求禁用环境代理；如需走代理，请设置 FEISHU_USE_ENV_PROXY=1。");
  }

  return httpInstance;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readJsonRequestBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function writeJsonResponse(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

function createSilentFeishuSdkLogger(): {
  trace: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
} {
  const noop = () => {};
  return {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

function extractFeishuApiErrorDetail(error: unknown): { code: number | string | null; message: string | null } | null {
  const topLevel = asRecord(error);
  const response = asRecord(topLevel?.response);
  const data = asRecord(response?.data);
  const codeValue = data?.code;
  const code = typeof codeValue === "number" || typeof codeValue === "string" ? codeValue : null;
  const message = normalizeText(data?.msg) ?? normalizeText(topLevel?.message);

  if (code === null && !message) {
    return null;
  }

  return { code, message };
}

function formatFeishuMessageUpdateProbeError(error: unknown): string {
  const detail = extractFeishuApiErrorDetail(error);

  if (!detail) {
    return `消息更新探针失败：${toErrorMessage(error)}`;
  }

  if (detail.code === 230027) {
    return "消息更新探针失败：飞书返回缺少必要权限。请在开放平台为应用补齐并发布 `im:message`、`im:message:send_as_bot` 或 `im:message:update` 中至少一项。";
  }

  if (detail.code === 230006) {
    return "消息更新探针失败：应用未启用机器人能力，或新配置还没有发布生效。";
  }

  if (detail.code === 230071) {
    return "消息更新探针失败：飞书判定当前操作者不是这条消息的发送者，因此不允许原地更新。";
  }

  if (detail.code === 230075) {
    return "消息更新探针失败：这条消息已超出企业允许的可编辑时间窗口。";
  }

  const detailParts = [
    detail.code !== null ? `code=${detail.code}` : null,
    detail.message ?? null,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  return `消息更新探针失败：${detailParts.join("｜") || toErrorMessage(error)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextChatError(prefix: string, error: unknown): string {
  return `${prefix}：${toErrorMessage(error)}`;
}
