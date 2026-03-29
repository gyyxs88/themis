import * as Lark from "@larksuiteoapi/node-sdk";
import type { EventHandles } from "@larksuiteoapi/node-sdk";
import { InMemoryCommunicationRouter } from "../../communication/router.js";
import { AppServerActionBridge } from "../../core/app-server-action-bridge.js";
import { AppServerTaskRuntime } from "../../core/app-server-task-runtime.js";
import type { CodexRuntimeCatalog } from "../../core/codex-app-server.js";
import { CodexAuthRuntime } from "../../core/codex-auth.js";
import { CodexTaskRuntime } from "../../core/codex-runtime.js";
import {
  isPrincipalTaskSettingsEmpty,
  mergePrincipalTaskSettings,
} from "../../core/principal-task-settings.js";
import { persistSessionTaskSettings } from "../../core/session-settings-service.js";
import { appendTaskReplyQuotaFooter } from "../../core/task-reply-quota.js";
import { applyThemisGlobalDefaultsToRuntimeCatalog } from "../../core/task-defaults.js";
import { createTaskError } from "../../server/http-errors.js";
import {
  APPROVAL_POLICIES,
  type PrincipalTaskSettings,
  type SessionTaskSettings,
  SANDBOX_MODES,
  WEB_SEARCH_MODES,
  type ApprovalPolicy,
  type SandboxMode,
  type TaskRequest,
  type TaskRuntimeFacade,
  type TaskRuntimeRegistry,
  type WebSearchMode,
  resolveTaskRuntime,
} from "../../types/index.js";
import { FeishuAdapter } from "./adapter.js";
import { renderFeishuAssistantMessage, type FeishuRenderedMessageDraft } from "./message-renderer.js";
import { FeishuSessionStore, type FeishuConversationKey } from "./session-store.js";
import {
  DEFAULT_FEISHU_PROGRESS_FLUSH_TIMEOUT_MS,
  FeishuTaskMessageBridge,
  type FeishuMessageMutationResponse,
} from "./task-message-bridge.js";
import type { FeishuTaskPayload } from "./types.js";

type FeishuMessageReceiveEvent = Parameters<NonNullable<EventHandles["im.message.receive_v1"]>>[0];

interface FeishuChannelLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface FeishuIncomingContext {
  chatId: string;
  messageId: string;
  userId: string;
  openId?: string;
  tenantKey?: string;
  threadId?: string;
  chatType?: string;
  text: string;
}

interface ParsedFeishuCommand {
  name: string;
  args: string[];
  raw: string;
}

interface FeishuSessionTaskLease {
  signal: AbortSignal;
  release: () => void;
}

interface FeishuActiveSessionTask {
  token: symbol;
  abortController: AbortController;
  completed: Promise<void>;
}

export interface FeishuChannelServiceOptions {
  runtime: CodexTaskRuntime;
  runtimeRegistry?: TaskRuntimeRegistry;
  actionBridge?: AppServerActionBridge;
  authRuntime: CodexAuthRuntime;
  taskTimeoutMs: number;
  appId?: string;
  appSecret?: string;
  loggerLevel?: Lark.LoggerLevel;
  useEnvProxy?: boolean;
  progressFlushTimeoutMs?: number;
  sessionStore?: FeishuSessionStore;
  logger?: FeishuChannelLogger;
}

const MAX_FEISHU_TEXT_CHARS = 3500;
const FEISHU_MESSAGE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const FEISHU_SETTINGS_SCOPE_LINE = "作用范围：Themis 中间层长期默认配置，会同时影响 Web 和飞书后续新任务。";
const FEISHU_SETTINGS_EFFECT_LINE = "生效规则：只影响之后新发起的任务，不会打断已经在运行中的任务。";

export class FeishuChannelService {
  private readonly runtime: CodexTaskRuntime;
  private readonly runtimeRegistry: TaskRuntimeRegistry;
  private readonly actionBridge: AppServerActionBridge;
  private readonly authRuntime: CodexAuthRuntime;
  private readonly taskTimeoutMs: number;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly loggerLevel: Lark.LoggerLevel;
  private readonly useEnvProxy: boolean;
  private readonly progressFlushTimeoutMs: number;
  private readonly sessionStore: FeishuSessionStore;
  private readonly logger: FeishuChannelLogger;
  private readonly client: Lark.Client | null;
  private readonly wsClient: Lark.WSClient | null;
  private readonly eventDispatcher: Lark.EventDispatcher | null;
  private readonly recentMessageIds = new Map<string, number>();
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
    this.progressFlushTimeoutMs = normalizePositiveInteger(
      options.progressFlushTimeoutMs ?? parseIntegerEnv(process.env.FEISHU_PROGRESS_FLUSH_TIMEOUT_MS),
      DEFAULT_FEISHU_PROGRESS_FLUSH_TIMEOUT_MS,
    );
    this.sessionStore = options.sessionStore ?? new FeishuSessionStore();
    this.logger = options.logger ?? console;

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

  stop(): void {
    if (!this.started || !this.wsClient) {
      return;
    }

    this.wsClient.close({ force: true });
    this.started = false;
  }

  private async acceptMessageReceiveEvent(event: FeishuMessageReceiveEvent): Promise<void> {
    const context = normalizeIncomingContext(event);

    if (!context) {
      this.logger.warn("[themis/feishu] 收到无法解析的飞书消息，已忽略。");
      return;
    }

    this.pruneRecentMessageIds();

    if (this.isDuplicateMessage(context.messageId)) {
      this.logger.info(`[themis/feishu] 忽略重复消息：message=${context.messageId}`);
      return;
    }

    this.logger.info(
      `[themis/feishu] 收到消息事件：chat=${context.chatId} user=${context.userId} message=${context.messageId} text=${truncateText(context.text, 120)}`,
    );

    void this.handleMessageReceiveEvent(context);
  }

  private async handleMessageReceiveEvent(context: FeishuIncomingContext): Promise<void> {
    const command = parseFeishuCommand(context.text);

    try {
      if (command) {
        await this.handleCommand(command, context);
        return;
      }

      await this.handleTaskMessage(context);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.error(`[themis/feishu] 处理消息失败：${message}`);
      await this.safeSendTaggedText(context.chatId, message, "执行异常");
    }
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
      const commandLabel = normalizeText(command.raw) ?? `/${command.name}`;
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
      case "current":
        await this.sendCurrentSession(context.chatId, context);
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
      case "reset":
      case "restart":
      case "wipe":
        await this.resetPrincipalState(command.args, context);
        return;
      default:
        await this.sendUnknownCommand(context.chatId, command.raw);
    }
  }

  private async handleTaskMessage(context: FeishuIncomingContext): Promise<void> {
    const conversationKey = toConversationKey(context);
    const sessionId = this.sessionStore.ensureActiveSessionId(conversationKey);
    const taskLease = await this.acquireSessionTaskLease(sessionId);
    const bridge = new FeishuTaskMessageBridge({
      createText: async (text) => this.createAssistantMessage(context.chatId, text),
      updateText: async (messageId, text) => this.updateAssistantMessage(messageId, text),
      sendText: async (text) => {
        await this.createAssistantMessage(context.chatId, text);
      },
      splitText: splitForFeishuText,
      progressFlushTimeoutMs: this.progressFlushTimeoutMs,
    });
    const router = new InMemoryCommunicationRouter();
    const adapter = new FeishuAdapter({
      deliver: async (message) => {
        try {
          await bridge.deliver(message);
        } catch (error) {
          this.logger.error(`[themis/feishu] 推送任务消息失败：${toErrorMessage(error)}`);
        }
      },
    });

    router.registerAdapter(adapter);

    let normalizedRequest: TaskRequest | null = null;

    try {
      normalizedRequest = router.normalizeRequest(this.createTaskPayload(context, sessionId));
      await bridge.prepareResponseSlot();
      await ensureAuthAvailable(this.authRuntime, normalizedRequest);
      const selectedRuntime = resolveTaskRuntime(this.runtimeRegistry, normalizedRequest.options?.runtimeEngine);

      const result = await selectedRuntime.runTask(normalizedRequest, {
        signal: taskLease.signal,
        timeoutMs: this.taskTimeoutMs,
        finalizeResult: (request, taskResult) => appendTaskReplyQuotaFooter(this.authRuntime, request, taskResult),
        onEvent: async (taskEvent) => {
          await router.publishEvent(taskEvent);
        },
      });

      await router.publishResult(result);
    } catch (error) {
      const taskError = createTaskError(error, Boolean(normalizedRequest));

      if (normalizedRequest) {
        await router.publishError(taskError, normalizedRequest);
      } else {
        await this.safeSendTaggedText(context.chatId, taskError.message, "执行异常");
      }
    } finally {
      taskLease.release();
    }
  }

  private async acquireSessionTaskLease(sessionId: string): Promise<FeishuSessionTaskLease> {
    return this.withSessionMutation(sessionId, async () => {
      await this.abortActiveSessionTask(
        sessionId,
        "FEISHU_SESSION_REPLACED",
        `[themis/feishu] 新消息将打断当前会话任务：session=${sessionId}`,
      );

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
    });
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

  private createTaskPayload(context: FeishuIncomingContext, sessionId: string): FeishuTaskPayload {
    const principalSettings = this.readPrincipalTaskSettings(context);
    const options = isPrincipalTaskSettingsEmpty(principalSettings) ? undefined : principalSettings;

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
    patch: Partial<PrincipalTaskSettings>,
  ): { principalId: string; settings: PrincipalTaskSettings } {
    const principal = this.ensurePrincipalIdentity(context);
    const current = this.runtime.getPrincipalTaskSettings(principal.principalId) ?? {};
    const next = mergePrincipalTaskSettings(current, patch);

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
      invalidSegment ? `未识别的账号设置项：${invalidSegment}` : "账号设置：",
      `当前 principal：${principal.principalId}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      "",
      "/settings account current",
      `当前值：${describePrincipalAccountCurrentValue(accountState)}`,
      "/settings account list",
      "查看可用认证账号列表。",
      "/settings account use",
      "查看切换方法并设置当前 principal 默认认证账号。",
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
      accountState.principalAccountId
        ? `当前 principal 默认：固定使用 ${formatAuthAccountLabel(accountState.configuredAccount, accountState.principalAccountId)}`
        : accountState.effectiveAccountId
          ? `当前 principal 默认：跟随 Themis 系统默认账号 ${formatAuthAccountLabel(accountState.activeAccount, accountState.effectiveAccountId)}`
          : "当前 principal 默认：跟随 Themis 系统默认账号",
      "",
      "认证账号：",
      ...accounts.map((account, index) => {
        const markers = [
          account.accountId === activeAccount?.accountId ? "系统默认" : "",
          account.accountId === accountState.principalAccountId ? "principal 默认" : "",
          !accountState.principalAccountId && account.accountId === activeAccount?.accountId ? "当前生效" : "",
        ].filter(Boolean);
        const markerText = markers.length ? `（${markers.join("｜")}）` : "";
        return `${index + 1}. ${formatAuthAccountLabel(account)}${markerText}\n   CODEX_HOME：${account.codexHome}`;
      }),
      "",
      "使用 /settings account use <账号名|邮箱|序号|default> 切换当前 principal 默认认证账号。",
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
      `当前 principal：${principal.principalId}`,
      accountState.principalAccountId
        ? `当前 principal 默认：固定使用 ${formatAuthAccountLabel(account, resolvedAccountId)}`
        : `当前 principal 默认：跟随 Themis 系统默认账号 ${formatAuthAccountLabel(account, resolvedAccountId)}`,
      `认证方式：${snapshot.authMethod ?? "unknown"}`,
      snapshot.account?.email ? `账号：${snapshot.account.email}` : null,
      snapshot.account?.planType ? `套餐：${snapshot.account.planType}` : null,
      snapshot.authenticated ? "状态：已认证" : "状态：未认证",
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
      `当前值：${describePrincipalAccountCurrentValue(accountState)}`,
      `来源：${accountState.principalAccountId ? "当前 principal 默认配置" : "Themis 系统默认账号"}`,
      FEISHU_SETTINGS_SCOPE_LINE,
      FEISHU_SETTINGS_EFFECT_LINE,
      "可选输入：<账号名|邮箱|序号|default>",
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

  private async sendHelp(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const currentSessionId = this.sessionStore.getActiveSessionId(toConversationKey(context));
    const helpText = [
      "Themis 飞书命令：",
      "/help 查看帮助",
      "/sessions 查看最近会话",
      "/new 新建并切换到新会话",
      "/use <序号|conversationId> 切换到已有会话",
      "/current 查看当前会话",
      "/workspace 查看或设置当前会话工作区",
      "/settings 查看设置树",
      "/skills 查看和维护当前 principal 的 skills",
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

  private async sendSessionList(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const sessions = this.runtime.getRuntimeStore().listRecentSessions(12);
    const currentSessionId = this.sessionStore.getActiveSessionId(toConversationKey(context));

    if (!sessions.length) {
      await this.safeSendText(chatId, "当前还没有会话历史。直接发送文本，或先执行 /new 开始。");
      return;
    }

    const lines = [
      currentSessionId ? `当前会话：${currentSessionId}` : "当前会话：未激活",
      "",
      "最近会话：",
      ...sessions.map((session, index) => {
        const latest = normalizeText(session.latestTurn.summary) ?? session.latestTurn.goal;
        const currentMark = currentSessionId === session.sessionId ? "（当前）" : "";
        return `${index + 1}. ${session.sessionId}${currentMark}\n状态：${session.latestTurn.status}｜更新：${formatTimestamp(session.updatedAt)}\n最近任务：${truncateText(latest, 80)}`;
      }),
      "",
      "使用 /use <序号|conversationId> 切换会话。",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async createNewSession(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const conversationKey = toConversationKey(context);
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
    const sessionId = this.sessionStore.getActiveSessionId(toConversationKey(context));

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
    }

    if (!resolvedSessionId) {
      await this.safeSendText(context.chatId, "没有找到对应会话。先执行 /sessions 查看可切换的会话。");
      return;
    }

    this.sessionStore.setActiveSessionId(toConversationKey(context), resolvedSessionId);
    await this.safeSendText(context.chatId, `已切换到会话：${resolvedSessionId}`);
  }

  private async sendCurrentSession(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const sessionId = this.sessionStore.getActiveSessionId(toConversationKey(context));

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

    await this.safeSendText(
      chatId,
      [
        `当前会话：${sessionId}`,
        `当前会话工作区：${formatWorkspaceValue(this.readSessionTaskSettings(sessionId).workspacePath)}`,
        `当前 principal：${principal.principalId}`,
        `认证账号：${describePrincipalAccountCurrentValue(accountState)}`,
      ].join("\n"),
    );
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

    const conversationKey = toConversationKey(context);
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

  private async createAssistantMessage(
    chatId: string,
    text: string,
  ): Promise<FeishuMessageMutationResponse> {
    return this.createMessage(chatId, renderFeishuAssistantMessage(text));
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

    if (!actionScope) {
      await this.safeSendText(context.chatId, "当前没有激活会话，请先切回对应会话后再提交 action。");
      return;
    }

    const action = this.actionBridge.find(actionId, actionScope);

    if (!action) {
      await this.safeSendText(context.chatId, `未找到等待中的 action：${actionId}`);
      return;
    }

    if (action.actionType !== "approval") {
      await this.safeSendText(context.chatId, `action ${actionId} 不是审批请求，请改用 /reply。`);
      return;
    }

    if (!this.actionBridge.resolve({
      taskId: action.taskId,
      requestId: action.requestId,
      actionId,
      decision,
    })) {
      await this.safeSendText(context.chatId, `提交审批失败：${actionId} 已失效。`);
      return;
    }

    const message = decision === "approve" ? "已提交审批。" : "已提交拒绝。";
    await this.safeSendTaggedText(context.chatId, message, "处理中");
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

    if (!this.actionBridge.resolve({
      taskId: action.taskId,
      requestId: action.requestId,
      actionId,
      inputText,
    })) {
      await this.safeSendText(context.chatId, `提交补充输入失败：${actionId} 已失效。`);
      return;
    }

    await this.safeSendTaggedText(context.chatId, "已提交补充输入。", "处理中");
  }

  private resolvePendingActionScope(context: FeishuIncomingContext): {
    sourceChannel: "feishu";
    sessionId: string;
    userId: string;
  } | null {
    const sessionId = this.sessionStore.getActiveSessionId(toConversationKey(context));

    if (!sessionId) {
      return null;
    }

    return {
      sourceChannel: "feishu",
      sessionId,
      userId: context.userId,
    };
  }
}

function normalizeFeishuRuntimeRegistry(
  runtime: CodexTaskRuntime,
  defaultAppServerRuntime: TaskRuntimeFacade,
  runtimeRegistry?: TaskRuntimeRegistry,
): TaskRuntimeRegistry {
  if (!runtimeRegistry) {
    return {
      defaultRuntime: defaultAppServerRuntime,
      runtimes: {
        sdk: runtime,
        "app-server": defaultAppServerRuntime,
      },
    };
  }

  const normalizedRegistry: TaskRuntimeRegistry = {
    defaultRuntime: runtimeRegistry.defaultRuntime,
    runtimes: {
      sdk: runtime,
      ...(runtimeRegistry.runtimes ?? {}),
    },
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

function normalizeIncomingContext(event: FeishuMessageReceiveEvent): FeishuIncomingContext | null {
  const chatId = normalizeText(event.message?.chat_id);
  const messageId = normalizeText(event.message?.message_id);
  const userId = normalizeText(event.sender?.sender_id?.user_id)
    ?? normalizeText(event.sender?.sender_id?.open_id);
  const text = extractFeishuText(event);
  const openId = normalizeText(event.sender?.sender_id?.open_id);
  const tenantKey = normalizeText(event.sender?.tenant_key);
  const threadId = normalizeText(event.message?.thread_id);
  const chatType = normalizeText(event.message?.chat_type);

  if (!chatId || !messageId || !userId || !text) {
    return null;
  }

  return {
    chatId,
    messageId,
    userId,
    ...(openId ? { openId } : {}),
    ...(tenantKey ? { tenantKey } : {}),
    ...(threadId ? { threadId } : {}),
    ...(chatType ? { chatType } : {}),
    text,
  };
}

function extractFeishuText(event: FeishuMessageReceiveEvent): string | null {
  if (normalizeText(event.message?.message_type) !== "text") {
    return null;
  }

  const rawContent = normalizeText(event.message?.content);

  if (!rawContent) {
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

function toConversationKey(context: FeishuIncomingContext): FeishuConversationKey {
  return {
    chatId: context.chatId,
    userId: context.userId,
  };
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

function parseSandboxModeArgument(args: string[]): SandboxMode | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  return SANDBOX_MODES.includes(value as SandboxMode) ? (value as SandboxMode) : null;
}

function parseWebSearchModeArgument(args: string[]): WebSearchMode | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  return WEB_SEARCH_MODES.includes(value as WebSearchMode) ? (value as WebSearchMode) : null;
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
  approvalPolicy: string | null;
  sandboxMode: string | null;
  webSearchMode: string | null;
  networkAccessEnabled: boolean | null;
} {
  const runtimeDefaults = runtimeConfig?.defaults ?? null;

  return {
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

function formatSkillSyncSummary(summary: {
  totalAccounts: number;
  syncedCount: number;
  conflictCount: number;
  failedCount: number;
}): string {
  return `已同步 ${summary.syncedCount}/${summary.totalAccounts}，冲突 ${summary.conflictCount}，失败 ${summary.failedCount}`;
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
