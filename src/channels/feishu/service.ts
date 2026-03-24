import * as Lark from "@larksuiteoapi/node-sdk";
import type { EventHandles } from "@larksuiteoapi/node-sdk";
import { InMemoryCommunicationRouter } from "../../communication/router.js";
import { CodexAuthRuntime } from "../../core/codex-auth.js";
import { CodexTaskRuntime } from "../../core/codex-runtime.js";
import {
  buildTaskOptionsFromSessionTaskSettings,
  isSessionTaskSettingsEmpty,
  normalizeSessionTaskSettings,
} from "../../core/session-task-settings.js";
import { createTaskError } from "../../server/http-errors.js";
import {
  APPROVAL_POLICIES,
  SANDBOX_MODES,
  WEB_SEARCH_MODES,
  type ApprovalPolicy,
  type SandboxMode,
  type SessionTaskSettings,
  type TaskRequest,
  type WebSearchMode,
} from "../../types/index.js";
import { FeishuAdapter } from "./adapter.js";
import { FeishuSessionStore, type FeishuConversationKey } from "./session-store.js";
import type { FeishuDeliveryMessage, FeishuTaskPayload } from "./types.js";

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

interface FeishuMessageMutationResponse {
  code?: number | undefined;
  msg?: string | undefined;
  data?: {
    message_id?: string | undefined;
  } | undefined;
}

export interface FeishuChannelServiceOptions {
  runtime: CodexTaskRuntime;
  authRuntime: CodexAuthRuntime;
  taskTimeoutMs: number;
  appId?: string;
  appSecret?: string;
  loggerLevel?: Lark.LoggerLevel;
  useEnvProxy?: boolean;
  sessionStore?: FeishuSessionStore;
  logger?: FeishuChannelLogger;
}

const MAX_FEISHU_TEXT_CHARS = 3500;
const FEISHU_MESSAGE_DEDUPE_TTL_MS = 10 * 60 * 1000;

export class FeishuChannelService {
  private readonly runtime: CodexTaskRuntime;
  private readonly authRuntime: CodexAuthRuntime;
  private readonly taskTimeoutMs: number;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly loggerLevel: Lark.LoggerLevel;
  private readonly useEnvProxy: boolean;
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
    this.authRuntime = options.authRuntime;
    this.taskTimeoutMs = options.taskTimeoutMs;
    this.appId = normalizeText(options.appId ?? process.env.FEISHU_APP_ID) ?? "";
    this.appSecret = normalizeText(options.appSecret ?? process.env.FEISHU_APP_SECRET) ?? "";
    this.loggerLevel = options.loggerLevel ?? parseFeishuLoggerLevel(process.env.FEISHU_LOG_LEVEL);
    this.useEnvProxy = options.useEnvProxy ?? parseBooleanEnv(process.env.FEISHU_USE_ENV_PROXY);
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
        await this.sendQuota(context.chatId);
        return;
      case "current":
        await this.sendCurrentSession(context.chatId, context);
        return;
      case "link":
        await this.linkIdentity(command.args, context);
        return;
      case "settings":
      case "config":
        await this.sendSessionSettings(context.chatId, context);
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
      createText: async (text) => this.createTextMessage(context.chatId, text),
      updateText: async (messageId, text) => this.updateTextMessage(messageId, text),
      sendText: async (text) => this.safeSendText(context.chatId, text),
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
      await ensureAuthAvailable(this.authRuntime, normalizedRequest);

      const result = await this.runtime.runTask(normalizedRequest, {
        signal: taskLease.signal,
        timeoutMs: this.taskTimeoutMs,
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
    const sessionSettings = this.readSessionSettings(sessionId);
    const options = buildTaskOptionsFromSessionTaskSettings(sessionSettings);

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

  private readSessionSettings(sessionId: string): SessionTaskSettings {
    const record = this.runtime.getRuntimeStore().getSessionTaskSettings(sessionId);
    return normalizeSessionTaskSettings(record?.settings);
  }

  private saveSessionSettings(sessionId: string, settings: SessionTaskSettings): SessionTaskSettings {
    const store = this.runtime.getRuntimeStore();
    const existing = store.getSessionTaskSettings(sessionId);
    const normalized = normalizeSessionTaskSettings(settings);

    if (isSessionTaskSettingsEmpty(normalized)) {
      store.deleteSessionTaskSettings(sessionId);
      return {};
    }

    const now = new Date().toISOString();
    store.saveSessionTaskSettings({
      sessionId,
      settings: normalized,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    return normalized;
  }

  private updateSessionSettingsField<K extends keyof SessionTaskSettings>(
    sessionId: string,
    field: K,
    value: SessionTaskSettings[K] | undefined,
  ): SessionTaskSettings {
    const base = this.readSessionSettings(sessionId);
    const next: Record<string, unknown> = {
      ...base,
    };

    if (typeof value === "undefined") {
      delete next[field];
    } else {
      next[field] = value;
    }

    return this.saveSessionSettings(sessionId, normalizeSessionTaskSettings(next));
  }

  private ensureMutableSession(context: FeishuIncomingContext): { sessionId: string; created: boolean } {
    const conversationKey = toConversationKey(context);
    const existing = this.sessionStore.getActiveSessionId(conversationKey);

    if (existing) {
      return {
        sessionId: existing,
        created: false,
      };
    }

    return {
      sessionId: this.sessionStore.createAndActivateSession(conversationKey),
      created: true,
    };
  }

  private async sendSessionSettings(chatId: string, context: FeishuIncomingContext): Promise<void> {
    const sessionId = this.sessionStore.getActiveSessionId(toConversationKey(context));

    if (!sessionId) {
      await this.safeSendText(chatId, "当前还没有激活会话。直接发消息时会自动创建，或使用 /new 手动新建。");
      return;
    }

    const settings = this.readSessionSettings(sessionId);
    const lines = [
      `当前会话：${sessionId}`,
      "",
      ...formatSessionSettingsLines(settings),
      "",
      "说明：未设置的项会回退到运行时默认值。",
      "飞书当前可直接修改：/sandbox /search /network /approval",
    ];

    await this.safeSendText(chatId, lines.join("\n"));
  }

  private async updateSandboxMode(args: string[], context: FeishuIncomingContext): Promise<void> {
    const sandboxMode = parseSandboxModeArgument(args);

    if (sandboxMode === null) {
      await this.safeSendText(context.chatId, "用法：/sandbox <default|read-only|workspace-write|danger-full-access>");
      return;
    }

    const target = this.ensureMutableSession(context);
    const settings = this.updateSessionSettingsField(target.sessionId, "sandboxMode", sandboxMode);
    await this.sendSettingUpdatedMessage(context.chatId, target, "沙箱模式", formatOptionalSetting(sandboxMode), settings);
  }

  private async updateWebSearchMode(args: string[], context: FeishuIncomingContext): Promise<void> {
    const webSearchMode = parseWebSearchModeArgument(args);

    if (webSearchMode === null) {
      await this.safeSendText(context.chatId, "用法：/search <default|disabled|cached|live>");
      return;
    }

    const target = this.ensureMutableSession(context);
    const settings = this.updateSessionSettingsField(target.sessionId, "webSearchMode", webSearchMode);
    await this.sendSettingUpdatedMessage(context.chatId, target, "联网搜索", formatOptionalSetting(webSearchMode), settings);
  }

  private async updateNetworkAccess(args: string[], context: FeishuIncomingContext): Promise<void> {
    const networkAccessEnabled = parseNetworkAccessArgument(args);

    if (networkAccessEnabled === null) {
      await this.safeSendText(context.chatId, "用法：/network <default|on|off>");
      return;
    }

    const target = this.ensureMutableSession(context);
    const settings = this.updateSessionSettingsField(target.sessionId, "networkAccessEnabled", networkAccessEnabled);
    await this.sendSettingUpdatedMessage(
      context.chatId,
      target,
      "网络访问",
      formatOptionalBoolean(networkAccessEnabled),
      settings,
    );
  }

  private async updateApprovalPolicy(args: string[], context: FeishuIncomingContext): Promise<void> {
    const approvalPolicy = parseApprovalPolicyArgument(args);

    if (approvalPolicy === null) {
      await this.safeSendText(context.chatId, "用法：/approval <default|never|on-request|on-failure|untrusted>");
      return;
    }

    const target = this.ensureMutableSession(context);
    const settings = this.updateSessionSettingsField(target.sessionId, "approvalPolicy", approvalPolicy);
    await this.sendSettingUpdatedMessage(context.chatId, target, "审批策略", formatOptionalSetting(approvalPolicy), settings);
  }

  private async sendSettingUpdatedMessage(
    chatId: string,
    target: { sessionId: string; created: boolean },
    label: string,
    value: string,
    settings: SessionTaskSettings,
  ): Promise<void> {
    const lines = [
      target.created ? `已自动创建会话：${target.sessionId}` : `当前会话：${target.sessionId}`,
      `${label}已更新为：${value}`,
      isSessionTaskSettingsEmpty(settings)
        ? "当前会话已无单独配置，后续会完全回退到运行时默认值。"
        : "发送 /settings 可查看当前会话的完整配置。",
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
      "/link <绑定码> 可选：认领一个旧 Web 浏览器身份",
      "/reset confirm 清空当前 principal 的人格档案、历史和记忆，并重新开始",
      "/settings 查看当前会话配置",
      "/sandbox <default|read-only|workspace-write|danger-full-access>",
      "/search <default|disabled|cached|live>",
      "/network <default|on|off>",
      "/approval <default|never|on-request|on-failure|untrusted>",
      "/msgupdate 测试机器人是否能原地更新自己刚发出的文本消息",
      "/quota 查看当前 Codex / ChatGPT 额度信息",
      "",
      "Web 和飞书默认共享同一套会话列表；切到同一个 conversationId 后，会继续复用后端已有上下文。",
      "以上配置只作用于当前会话；未设置的项会回退到运行时默认值。",
      "直接发送普通文本即可继续当前会话。",
      "如果当前会话还有任务在运行，新消息会先打断旧任务，再自动开始新的请求。",
      currentSessionId ? `当前会话：${currentSessionId}` : "当前还没有激活会话，直接发消息时会自动创建。",
    ].join("\n");

    await this.safeSendText(chatId, helpText);
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
    const sessionId = this.sessionStore.createAndActivateSession(toConversationKey(context));
    await this.safeSendText(chatId, `已创建新会话：${sessionId}\n后续直接发消息会进入这个新会话。`);
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

    await this.safeSendText(chatId, `当前会话：${sessionId}`);
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
      const reset = this.runtime.getRuntimeStore().resetPrincipalState(identity.principalId, resetAt);
      const nextSessionId = this.sessionStore.createAndActivateSession(conversationKey);
      const lines = [
        `已重置 principal：${identity.principalId}`,
        `清空会话：${reset.clearedConversationCount} 条`,
        `清空任务记录：${reset.clearedTurnCount} 条`,
        `清空人格档案：${reset.clearedPersonaProfile ? "是" : "否"}`,
        `清空进行中建档：${reset.clearedPersonaOnboarding ? "是" : "否"}`,
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

  private async sendQuota(chatId: string): Promise<void> {
    const snapshot = await this.authRuntime.readSnapshot();

    if (!snapshot.authenticated) {
      await this.safeSendText(chatId, "Codex 当前没有可用认证，暂时无法读取额度信息。");
      return;
    }

    const lines = [
      "Codex 额度信息：",
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
    const client = this.client;
    const normalizedText = normalizeText(text);

    if (!client || !normalizedText) {
      throw new Error("飞书客户端未就绪，或消息内容为空。");
    }

    if (splitForFeishuText(normalizedText).length > 1) {
      throw new Error("消息内容过长，无法作为单条飞书文本消息发送。");
    }

    return client.im.v1.message.create({
      params: {
        receive_id_type: "chat_id",
      },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: normalizedText }),
      },
    });
  }

  private async updateTextMessage(
    messageId: string,
    text: string,
  ): Promise<FeishuMessageMutationResponse> {
    const client = this.client;
    const normalizedText = normalizeText(text);

    if (!client || !normalizedText) {
      throw new Error("飞书客户端未就绪，或消息内容为空。");
    }

    if (splitForFeishuText(normalizedText).length > 1) {
      throw new Error("消息内容过长，无法作为单条飞书文本消息更新。");
    }

    return client.im.v1.message.update({
      path: {
        message_id: messageId,
      },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text: normalizedText }),
      },
    });
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
}

class FeishuTaskMessageBridge {
  private readonly deliveredProgress = new Map<string, string>();
  private readonly createText: (text: string) => Promise<FeishuMessageMutationResponse>;
  private readonly updateText: (messageId: string, text: string) => Promise<FeishuMessageMutationResponse>;
  private readonly sendText: (text: string) => Promise<void>;
  private primaryMessageId: string | null = null;
  private primaryMessageText: string | null = null;
  private primaryMessageUpdatable = true;

  constructor(options: {
    createText: (text: string) => Promise<FeishuMessageMutationResponse>;
    updateText: (messageId: string, text: string) => Promise<FeishuMessageMutationResponse>;
    sendText: (text: string) => Promise<void>;
  }) {
    this.createText = options.createText;
    this.updateText = options.updateText;
    this.sendText = options.sendText;
  }

  async deliver(message: FeishuDeliveryMessage): Promise<void> {
    switch (message.kind) {
      case "event":
        await this.deliverProgress(message);
        return;
      case "result":
        await this.deliverResult(message);
        return;
      case "error":
        await this.deliverTerminalText(buildFeishuTerminalStateText("执行异常", message.text));
        return;
      default:
        return;
    }
  }

  private async deliverProgress(message: FeishuDeliveryMessage): Promise<void> {
    const metadata = asRecord(message.metadata);
    const itemType = normalizeText(metadata?.itemType);
    const threadEventType = normalizeText(metadata?.threadEventType);

    if (itemType !== "agent_message" || threadEventType !== "item.completed") {
      return;
    }

    const text = resolveDeliveryText(message, metadata);

    if (!text) {
      return;
    }

    const itemId = normalizeText(metadata?.itemId) ?? message.requestId;
    const previous = this.deliveredProgress.get(itemId);

    if (previous === text) {
      return;
    }

    this.deliveredProgress.set(itemId, text);
    await this.deliverProgressText(text);
  }

  private async deliverResult(message: FeishuDeliveryMessage): Promise<void> {
    const metadata = asRecord(message.metadata);
    const status = normalizeText(metadata?.status) ?? "completed";
    const text = resolveDeliveryText(message, metadata);

    if (status === "completed") {
      if (!text) {
        return;
      }

      await this.deliverTerminalText(text);
      return;
    }

    if (status === "cancelled") {
      await this.deliverTerminalText(buildFeishuTerminalStateText("任务已取消", text));
      return;
    }

    await this.deliverTerminalText(buildFeishuTerminalStateText("任务失败", text));
  }

  private async deliverProgressText(text: string): Promise<void> {
    const chunks = splitForFeishuText(text);

    if (!chunks.length) {
      return;
    }

    const [firstChunk] = chunks;

    if (!firstChunk) {
      return;
    }

    const primaryText = chunks.length === 1
      ? `${firstChunk}\n\n处理中...`
      : `${firstChunk}\n\n处理中，完整内容会在结束后补全。`;

    await this.upsertPrimaryMessage(primaryText);
  }

  private async deliverTerminalText(text: string): Promise<void> {
    const chunks = splitForFeishuText(text);

    if (!chunks.length) {
      return;
    }

    const [firstChunk, ...remainingChunks] = chunks;

    if (!firstChunk) {
      return;
    }

    await this.upsertPrimaryMessage(firstChunk);

    for (const chunk of remainingChunks) {
      await this.sendText(chunk);
    }
  }

  private async upsertPrimaryMessage(text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    if (this.primaryMessageText === normalizedText) {
      return;
    }

    if (!this.primaryMessageUpdatable) {
      await this.sendText(normalizedText);
      this.primaryMessageText = normalizedText;
      return;
    }

    if (this.primaryMessageId) {
      await this.updateText(this.primaryMessageId, normalizedText);
      this.primaryMessageText = normalizedText;
      return;
    }

    const created = await this.createText(normalizedText);
    const messageId = normalizeText(created.data?.message_id);
    this.primaryMessageText = normalizedText;

    if (!messageId) {
      this.primaryMessageUpdatable = false;
      return;
    }

    this.primaryMessageId = messageId;
  }
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

function resolveDeliveryText(
  message: FeishuDeliveryMessage,
  metadata: Record<string, unknown> | null,
): string | null {
  const directText = normalizeText(message.text);

  if (directText) {
    return directText;
  }

  const itemText = normalizeText(metadata?.itemText);

  if (itemText) {
    return itemText;
  }

  const output = normalizeText(metadata?.output);
  return output ?? null;
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

function buildFeishuTerminalStateText(label: string, text: string | null): string {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return label;
  }

  return `${normalizedText}\n\n${label}`;
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
    const auth = await authRuntime.readSnapshot();

    if (auth.providerProfile?.type === "openai-compatible") {
      return;
    }

    throw new Error("当前没有可用的第三方兼容接入配置。");
  }

  const auth = await authRuntime.readSnapshot();

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

function parseSandboxModeArgument(args: string[]): SandboxMode | undefined | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  if (value === "default") {
    return undefined;
  }

  return SANDBOX_MODES.includes(value as SandboxMode) ? (value as SandboxMode) : null;
}

function parseWebSearchModeArgument(args: string[]): WebSearchMode | undefined | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  if (value === "default") {
    return undefined;
  }

  return WEB_SEARCH_MODES.includes(value as WebSearchMode) ? (value as WebSearchMode) : null;
}

function parseApprovalPolicyArgument(args: string[]): ApprovalPolicy | undefined | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  if (value === "default") {
    return undefined;
  }

  return APPROVAL_POLICIES.includes(value as ApprovalPolicy) ? (value as ApprovalPolicy) : null;
}

function parseNetworkAccessArgument(args: string[]): boolean | undefined | null {
  const value = normalizeText(args.join(" "))?.toLowerCase();

  if (!value) {
    return null;
  }

  if (value === "default") {
    return undefined;
  }

  if (["on", "true", "1", "yes", "enabled"].includes(value)) {
    return true;
  }

  if (["off", "false", "0", "no", "disabled"].includes(value)) {
    return false;
  }

  return null;
}

function formatSessionSettingsLines(settings: SessionTaskSettings): string[] {
  const normalized = normalizeSessionTaskSettings(settings);

  if (isSessionTaskSettingsEmpty(normalized)) {
    return ["当前没有单独配置，后续会使用运行时默认值。"];
  }

  return [
    "当前配置：",
    `接入方式：${formatOptionalSetting(normalized.accessMode)}`,
    `模型：${formatOptionalSetting(normalized.model)}`,
    `第三方供应商：${formatOptionalSetting(normalized.thirdPartyProviderId)}`,
    `第三方模型：${formatOptionalSetting(normalized.thirdPartyModel)}`,
    `推理强度：${formatOptionalSetting(normalized.reasoning)}`,
    `审批策略：${formatOptionalSetting(normalized.approvalPolicy)}`,
    `沙箱模式：${formatOptionalSetting(normalized.sandboxMode)}`,
    `联网搜索：${formatOptionalSetting(normalized.webSearchMode)}`,
    `网络访问：${formatOptionalBoolean(normalized.networkAccessEnabled)}`,
  ];
}

function formatOptionalSetting(value: string | null | undefined): string {
  return value ? value : "默认";
}

function formatOptionalBoolean(value: boolean | null | undefined): string {
  if (typeof value !== "boolean") {
    return "默认";
  }

  return value ? "开启" : "关闭";
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
