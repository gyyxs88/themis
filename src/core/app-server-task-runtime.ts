import { AppServerActionBridge } from "./app-server-action-bridge.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  RuntimeEngine,
  TaskActionDescriptor,
  TaskActionScope,
  TaskEvent,
  TaskPendingActionSubmitRequest,
  TaskRequest,
  TaskResult,
  TaskRuntimeForkedThread,
  TaskRuntimeForkThreadRequest,
  TaskRuntimeReadThreadSnapshotRequest,
  TaskRuntimeRunHooks,
  TaskRuntimeStartReviewRequest,
  TaskRuntimeStartReviewResult,
  TaskRuntimeSteerTurnRequest,
  TaskRuntimeSteerTurnResult,
  TaskRuntimeThreadSnapshot,
} from "../types/index.js";
import type {
  AppServerReverseRequest,
  AppServerThreadStartParams,
  CodexAppServerNotification,
} from "./codex-app-server.js";
import { CodexAppServerSession } from "./codex-app-server.js";
import { translateAppServerNotification } from "./app-server-event-translator.js";
import { ConversationService } from "./conversation-service.js";
import { createTaskEvent, finalizeTaskResult } from "./codex-runtime.js";
import { IdentityLinkService } from "./identity-link-service.js";
import { PrincipalSkillsService } from "./principal-skills-service.js";
import { resolveStoredSessionThreadReference } from "./session-thread-reference.js";
import { validateWorkspacePath } from "./session-workspace.js";

const SESSION_WORKSPACE_UNAVAILABLE_ERROR = "当前会话绑定的工作区不可用，请新建会话后重新设置。";
const APP_SERVER_AUX_TIMEOUT_MS = 15_000;

export interface AppServerTaskRuntimeSession {
  initialize(): Promise<void>;
  startThread(params: AppServerThreadStartParams): Promise<{ threadId: string }>;
  resumeThread(threadId: string, params: AppServerThreadStartParams): Promise<{ threadId: string }>;
  forkThread?(threadId: string): Promise<{ threadId: string }>;
  readThread?(
    threadId: string,
    options?: {
      includeTurns?: boolean;
    },
  ): Promise<TaskRuntimeThreadSnapshot>;
  startReview?(threadId: string, instructions: string): Promise<TaskRuntimeStartReviewResult>;
  steerTurn?(threadId: string, expectedTurnId: string, message: string): Promise<TaskRuntimeSteerTurnResult>;
  startTurn(threadId: string, prompt: string): Promise<{ turnId: string }>;
  close(): Promise<void>;
  onNotification(handler: (notification: CodexAppServerNotification) => void): void | (() => void);
  onServerRequest(handler: (request: AppServerReverseRequest) => void): void | (() => void);
  respondToServerRequest?(id: string | number, result: unknown): Promise<void>;
  rejectServerRequest?(id: string | number, error: Error): Promise<void>;
}

export interface AppServerTaskRuntimeOptions {
  workingDirectory?: string;
  runtimeStore?: SqliteCodexSessionRegistry;
  principalSkillsService?: PrincipalSkillsService;
  sessionFactory?: () => Promise<AppServerTaskRuntimeSession> | AppServerTaskRuntimeSession;
  actionBridge?: AppServerActionBridge;
}

export class AppServerTaskRuntime {
  private readonly workingDirectory: string;
  private readonly runtimeStore: SqliteCodexSessionRegistry;
  private readonly identityLinkService: IdentityLinkService;
  private readonly conversationService: ConversationService;
  private readonly principalSkillsService: PrincipalSkillsService;
  private readonly sessionFactory: () => Promise<AppServerTaskRuntimeSession>;
  private readonly actionBridge: AppServerActionBridge;

  constructor(options: AppServerTaskRuntimeOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.runtimeStore = options.runtimeStore ?? new SqliteCodexSessionRegistry();
    this.identityLinkService = new IdentityLinkService(this.runtimeStore);
    this.conversationService = new ConversationService(this.runtimeStore, this.identityLinkService);
    this.principalSkillsService = options.principalSkillsService ?? new PrincipalSkillsService({
      workingDirectory: this.workingDirectory,
      registry: this.runtimeStore,
    });
    this.sessionFactory = async () => await options.sessionFactory?.() ?? new CodexAppServerSession(this.workingDirectory);
    this.actionBridge = options.actionBridge ?? new AppServerActionBridge();
  }

  async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
    const resolvedRequest = this.conversationService.resolveRequest(request);
    request = resolvedRequest.request;
    const principalId = resolvedRequest.principalId;

    const taskId = request.taskId ?? request.requestId;
    const { signal, cleanup } = createExecutionSignal(hooks.signal, hooks.timeoutMs);
    const eventDelivery = createEventDeliveryQueue(this.runtimeStore, hooks.onEvent);
    let session: AppServerTaskRuntimeSession | null = null;
    let unsubscribeNotification: (() => void) | undefined;
    let unsubscribeServerRequest: (() => void) | undefined;
    let sessionMode: "created" | "resumed" | "ephemeral" = "ephemeral";
    let resolvedThreadId: string | undefined;
    const pendingServerRequests = new Set<Promise<void>>();
    const sessionId = normalizeSessionId(request.channelContext.sessionId);

    const emit = async (event: TaskEvent): Promise<void> => {
      await abortable(() => eventDelivery.deliver(event), signal);
    };

    this.runtimeStore.upsertTurnFromRequest(request, taskId);

    try {
      throwIfAborted(signal);
      session = await abortable(() => this.sessionFactory(), signal);
      const activeSession = session;
      throwIfAborted(signal);
      await abortable(() => activeSession.initialize(), signal);

      unsubscribeNotification = toUnsubscribe(activeSession.onNotification((notification) => {
        const event = translateAppServerNotification(taskId, request.requestId, notification);

        if (!event) {
          return;
        }

        eventDelivery.enqueue(event);
      }));
      unsubscribeServerRequest = toUnsubscribe(activeSession.onServerRequest((serverRequest) => {
        const pendingServerRequest = this.handleServerRequest({
          session: activeSession,
          request,
          principalId,
          taskId,
          requestId: request.requestId,
          serverRequest,
          signal,
          emit,
        }).finally(() => {
          pendingServerRequests.delete(pendingServerRequest);
        });
        pendingServerRequests.add(pendingServerRequest);
      }));

      await emit(createTaskEvent(
        taskId,
        request.requestId,
        "task.received",
        "queued",
        "Themis accepted the web request.",
      ));
      throwIfAborted(signal);

      const executionWorkingDirectory = this.resolveExecutionWorkingDirectory(request);
      const resumableThreadId = sessionId ? resolveAppServerThreadId(this.runtimeStore, sessionId) : null;
      sessionMode = resolveSessionMode(sessionId, resumableThreadId);
      const threadStartParams: AppServerThreadStartParams = {
        cwd: executionWorkingDirectory,
        persistExtendedHistory: true,
      };

      const thread = resumableThreadId
        ? await abortable(() => activeSession.resumeThread(resumableThreadId, threadStartParams), signal)
        : await abortable(() => activeSession.startThread(threadStartParams), signal);
      const threadId = thread.threadId;
      resolvedThreadId = threadId;
      persistThreadSession(this.runtimeStore, sessionId, threadId, request.createdAt);

      await emit(createTaskEvent(taskId, request.requestId, "task.started", "running", "Codex task started.", {
        sessionMode,
        threadId,
        sessionId: sessionId || null,
        conversationId: sessionId || null,
        runtimeEngine: "app-server",
      }));
      throwIfAborted(signal);

      await abortable(() => activeSession.startTurn(threadId, request.goal), signal);
      await abortable(() => waitForPendingServerRequests(pendingServerRequests), signal);
      await abortable(() => eventDelivery.flush(), signal);
      throwIfAborted(signal);

      const baseResult: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "completed",
        summary: request.goal,
        structuredOutput: {
          session: {
            sessionId: sessionId || null,
            threadId,
            engine: "app-server",
          },
        },
        completedAt: new Date().toISOString(),
      };
      const result = await abortable(
        () => finalizeTaskResult(request, baseResult, hooks.finalizeResult),
        signal,
      );

      this.runtimeStore.completeTaskTurn({
        request,
        result,
        sessionMode,
        ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
      });
      persistThreadSession(this.runtimeStore, sessionId, resolvedThreadId, result.completedAt);
      return result;
    } catch (error) {
      const message = toErrorMessage(error);

      try {
        if (!signal.aborted) {
          await abortable(() => eventDelivery.flush(), signal);
          await emit(createTaskEvent(taskId, request.requestId, "task.failed", "failed", message));
        }
      } catch {
        // 保留原始执行错误，不让事件回调错误覆盖它。
      }

      this.runtimeStore.failTaskTurn({
        request,
        taskId,
        message,
        sessionMode,
        ...(resolvedThreadId
          ? {
              structuredOutput: {
                session: {
                  sessionId: sessionId || null,
                  threadId: resolvedThreadId,
                  engine: "app-server",
                },
              },
            }
          : {}),
        ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
      });
      throw error;
    } finally {
      try {
        if (!signal.aborted) {
          await abortable(() => eventDelivery.flush(), signal);
        }
      } catch {
        // finally 阶段不覆盖主错误。
      }
      if (pendingServerRequests.size > 0) {
        await Promise.allSettled([...pendingServerRequests]);
      }
      unsubscribeNotification?.();
      unsubscribeServerRequest?.();
      await session?.close();
      cleanup();
    }
  }

  getRuntimeStore(): SqliteCodexSessionRegistry {
    return this.runtimeStore;
  }

  getIdentityLinkService(): IdentityLinkService {
    return this.identityLinkService;
  }

  getPrincipalSkillsService(): PrincipalSkillsService {
    return this.principalSkillsService;
  }

  async forkThread(request: TaskRuntimeForkThreadRequest): Promise<TaskRuntimeForkedThread | null> {
    const threadId = normalizeSessionId(request.threadId);

    if (!threadId) {
      return null;
    }

    const session = await withOperationTimeout(Promise.resolve(this.sessionFactory()), "app-server sessionFactory");

    try {
      await withOperationTimeout(session.initialize(), "app-server initialize");

      if (typeof session.forkThread !== "function") {
        return null;
      }

      const forked = await withOperationTimeout(session.forkThread(threadId), "app-server thread/fork");

      return {
        strategy: "native-thread-fork",
        sourceThreadId: threadId,
        threadId: forked.threadId,
      };
    } finally {
      await session.close();
    }
  }

  async readThreadSnapshot(
    request: TaskRuntimeReadThreadSnapshotRequest,
  ): Promise<TaskRuntimeThreadSnapshot | null> {
    const threadId = normalizeSessionId(request.threadId);

    if (!threadId) {
      return null;
    }

    const session = await withOperationTimeout(Promise.resolve(this.sessionFactory()), "app-server sessionFactory");

    try {
      await withOperationTimeout(session.initialize(), "app-server initialize");

      if (typeof session.readThread !== "function") {
        return null;
      }

      return await withOperationTimeout(
        session.readThread(threadId, {
          includeTurns: request.includeTurns === true,
        }),
        "app-server thread/read",
      );
    } finally {
      await session.close();
    }
  }

  async startReview(request: TaskRuntimeStartReviewRequest): Promise<TaskRuntimeStartReviewResult> {
    const sessionId = normalizeSessionId(request.sessionId);
    const threadId = resolveAppServerThreadId(this.runtimeStore, sessionId);

    if (!threadId) {
      throw new Error("当前会话还没有可用的 app-server thread。");
    }

    const session = await withOperationTimeout(Promise.resolve(this.sessionFactory()), "app-server sessionFactory");

    try {
      await withOperationTimeout(session.initialize(), "app-server initialize");

      if (typeof session.startReview !== "function") {
        throw new Error("当前 app-server runtime 不支持 review/start。");
      }

      return await withOperationTimeout(
        session.startReview(threadId, request.instructions),
        "app-server review/start",
      );
    } finally {
      await session.close();
    }
  }

  async steerTurn(request: TaskRuntimeSteerTurnRequest): Promise<TaskRuntimeSteerTurnResult> {
    const sessionId = normalizeSessionId(request.sessionId);
    const threadId = resolveAppServerThreadId(this.runtimeStore, sessionId);

    if (!threadId) {
      throw new Error("当前会话还没有可用的 app-server thread。");
    }

    const session = await withOperationTimeout(Promise.resolve(this.sessionFactory()), "app-server sessionFactory");

    try {
      await withOperationTimeout(session.initialize(), "app-server initialize");

      if (typeof session.steerTurn !== "function") {
        throw new Error("当前 app-server runtime 不支持 turn/steer。");
      }

      const explicitTurnId = normalizeSessionId(request.turnId);
      const turnId = explicitTurnId || await resolveActiveAppServerTurnId(session, threadId);

      if (!turnId) {
        throw new Error("当前会话还没有可引导的 app-server turn。");
      }

      return await withOperationTimeout(
        session.steerTurn(threadId, turnId, request.message),
        "app-server turn/steer",
      );
    } finally {
      await session.close();
    }
  }

  private resolveExecutionWorkingDirectory(request: TaskRequest): string {
    const sessionId = normalizeSessionId(request.channelContext.sessionId);

    if (!sessionId) {
      return this.workingDirectory;
    }

    const workspacePath = this.runtimeStore.getSessionTaskSettings(sessionId)?.settings.workspacePath?.trim();

    if (!workspacePath) {
      return this.workingDirectory;
    }

    try {
      return validateWorkspacePath(workspacePath);
    } catch {
      throw new Error(SESSION_WORKSPACE_UNAVAILABLE_ERROR);
    }
  }

  private async handleServerRequest(input: {
    session: AppServerTaskRuntimeSession;
    request: TaskRequest;
    principalId: string | undefined;
    taskId: string;
    requestId: string;
    serverRequest: AppServerReverseRequest;
    signal: AbortSignal;
    emit: (event: TaskEvent) => Promise<void>;
  }): Promise<void> {
    const resolvedAction = resolveServerRequestAction(input.serverRequest);

    if (!resolvedAction) {
      if (typeof input.session.respondToServerRequest === "function") {
        await abortable(() => input.session.respondToServerRequest!(input.serverRequest.id, null), input.signal);
      }
      return;
    }

    const actionScope = resolveActionScopeFromRequest(input.request, input.principalId);
    const registeredAction = this.actionBridge.register({
      taskId: input.taskId,
      requestId: input.requestId,
      ...(actionScope ? { scope: actionScope } : {}),
      ...resolvedAction.action,
    });
    const submission = this.actionBridge.waitForSubmission(
      input.taskId,
      input.requestId,
      registeredAction.actionId,
    );
    const discardPendingAction = () => {
      this.actionBridge.discard(input.taskId, input.requestId, registeredAction.actionId);
    };

    if (!submission) {
      throw new Error(`等待中的 action 不存在：${registeredAction.actionId}`);
    }

    input.signal.addEventListener("abort", discardPendingAction, { once: true });

    try {
      await input.emit(createTaskEvent(
        input.taskId,
        input.requestId,
        "task.action_required",
        "waiting",
        registeredAction.prompt,
        {
          actionId: registeredAction.actionId,
          actionType: registeredAction.actionType,
          prompt: registeredAction.prompt,
          ...(registeredAction.choices ? { choices: registeredAction.choices } : {}),
          ...(registeredAction.inputSchema ? { inputSchema: registeredAction.inputSchema } : {}),
        },
      ));

      const response = await abortable(
        async () => resolvedAction.buildResponse(await submission, registeredAction),
        input.signal,
      );

      if (typeof input.session.respondToServerRequest === "function") {
        await abortable(() => input.session.respondToServerRequest!(input.serverRequest.id, response), input.signal);
      }
    } catch (error) {
      if (typeof input.session.rejectServerRequest === "function") {
        const rejectionError = error instanceof Error ? error : new Error(String(error));

        if (input.signal.aborted) {
          await input.session.rejectServerRequest(input.serverRequest.id, rejectionError);
        } else {
          await abortable(
            () => input.session.rejectServerRequest!(input.serverRequest.id, rejectionError),
            input.signal,
          );
        }
        return;
      }

      throw error;
    } finally {
      input.signal.removeEventListener("abort", discardPendingAction);
      discardPendingAction();
    }
  }
}

interface ResolvedServerRequestAction {
  action: TaskActionDescriptor;
  buildResponse: (
    submission: TaskPendingActionSubmitRequest,
    action: TaskActionDescriptor,
  ) => Promise<unknown> | unknown;
}

function resolveActionScopeFromRequest(request: TaskRequest, principalId?: string): TaskActionScope | undefined {
  const sessionId = normalizeTextValue(request.channelContext.sessionId ?? request.channelContext.channelSessionKey);
  const normalizedPrincipalId = normalizeTextValue(principalId);
  const userId = normalizeTextValue(request.user.userId);
  const scope: TaskActionScope = {
    ...(request.sourceChannel ? { sourceChannel: request.sourceChannel } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(normalizedPrincipalId ? { principalId: normalizedPrincipalId } : {}),
    ...(userId ? { userId } : {}),
  };

  return Object.keys(scope).length > 0 ? scope : undefined;
}

async function resolveActiveAppServerTurnId(
  session: AppServerTaskRuntimeSession,
  threadId: string,
): Promise<string | null> {
  if (typeof session.readThread !== "function") {
    return null;
  }

  const snapshot = await withOperationTimeout(
    session.readThread(threadId, { includeTurns: true }),
    "app-server thread/read",
  );

  for (let index = snapshot.turns.length - 1; index >= 0; index -= 1) {
    const turn = snapshot.turns[index];
    const status = typeof turn?.status === "string" ? turn.status.trim().toLowerCase() : "";

    if (status && !["completed", "failed", "cancelled"].includes(status)) {
      return normalizeSessionId(turn?.turnId) || null;
    }
  }

  return null;
}

async function waitForPendingServerRequests(pendingServerRequests: Set<Promise<void>>): Promise<void> {
  while (pendingServerRequests.size > 0) {
    await Promise.all([...pendingServerRequests]);
  }
}

function resolveServerRequestAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  switch (serverRequest.method) {
    case "item/commandExecution/requestApproval":
      return resolveCommandApprovalAction(serverRequest);
    case "item/fileChange/requestApproval":
      return resolveFileChangeApprovalAction(serverRequest);
    case "item/permissions/requestApproval":
      return resolvePermissionsApprovalAction(serverRequest);
    case "execCommandApproval":
      return resolveExecCommandApprovalAction(serverRequest);
    case "applyPatchApproval":
      return resolveApplyPatchApprovalAction(serverRequest);
    case "item/tool/requestUserInput":
      return resolveUserInputAction(serverRequest);
    default:
      return null;
  }
}

function resolveCommandApprovalAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(
    params?.approvalId,
    params?.itemId,
    serverRequest.id,
  );

  if (!actionId) {
    return null;
  }

  const command = normalizeTextValue(params?.command);
  const reason = normalizeTextValue(params?.reason);
  const prompt = [
    command ? `命令执行需要审批：${command}` : "命令执行需要审批。",
    reason ?? null,
    `使用 /approve ${actionId} 或 /deny ${actionId}`,
  ].filter((line): line is string => Boolean(line)).join("\n");

  return createApprovalServerRequestAction(actionId, prompt, (submission) => ({
    decision: mapCommandStyleDecision(submission.decision, serverRequest.method),
  }));
}

function resolveFileChangeApprovalAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(params?.itemId, serverRequest.id);

  if (!actionId) {
    return null;
  }

  const reason = normalizeTextValue(params?.reason);
  const prompt = [
    reason ? `文件变更需要审批：${reason}` : "文件变更需要审批。",
    `使用 /approve ${actionId} 或 /deny ${actionId}`,
  ].join("\n");

  return createApprovalServerRequestAction(actionId, prompt, (submission) => ({
    decision: mapCommandStyleDecision(submission.decision, serverRequest.method),
  }));
}

function resolvePermissionsApprovalAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(params?.itemId, serverRequest.id);

  if (!actionId) {
    return null;
  }

  const reason = normalizeTextValue(params?.reason);
  const permissions = asRecord(params?.permissions) ?? {};
  const prompt = [
    reason ? `权限扩展需要审批：${reason}` : "权限扩展需要审批。",
    `使用 /approve ${actionId} 或 /deny ${actionId}`,
  ].join("\n");

  return createApprovalServerRequestAction(actionId, prompt, (submission) => ({
    permissions: submission.decision === "approve" ? permissions : {},
    scope: "turn",
  }));
}

function resolveExecCommandApprovalAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(params?.approvalId, params?.callId, serverRequest.id);

  if (!actionId) {
    return null;
  }

  const command = Array.isArray(params?.command)
    ? params.command.filter((entry): entry is string => typeof entry === "string").join(" ")
    : null;
  const reason = normalizeTextValue(params?.reason);
  const prompt = [
    command ? `命令执行需要审批：${command}` : "命令执行需要审批。",
    reason ?? null,
    `使用 /approve ${actionId} 或 /deny ${actionId}`,
  ].filter((line): line is string => Boolean(line)).join("\n");

  return createApprovalServerRequestAction(actionId, prompt, (submission) => ({
    decision: mapReviewDecision(submission.decision),
  }));
}

function resolveApplyPatchApprovalAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(params?.callId, serverRequest.id);

  if (!actionId) {
    return null;
  }

  const reason = normalizeTextValue(params?.reason);
  const prompt = [
    reason ? `补丁应用需要审批：${reason}` : "补丁应用需要审批。",
    `使用 /approve ${actionId} 或 /deny ${actionId}`,
  ].join("\n");

  return createApprovalServerRequestAction(actionId, prompt, (submission) => ({
    decision: mapReviewDecision(submission.decision),
  }));
}

function resolveUserInputAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(params?.itemId, serverRequest.id);

  if (!actionId) {
    return null;
  }

  const questions = Array.isArray(params?.questions)
    ? params.questions.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  const questionIds = questions
    .map((question) => normalizeTextValue(question.id))
    .filter((value): value is string => Boolean(value));
  const promptLines = questions
    .map((question) => normalizeTextValue(question.question) ?? normalizeTextValue(question.header))
    .filter((value): value is string => Boolean(value));
  const prompt = [
    promptLines.length ? promptLines.join("\n") : "需要补充输入。",
    `使用 /reply ${actionId} <内容>`,
  ].join("\n");

  return {
    action: {
      actionId,
      actionType: "user-input",
      prompt,
      inputSchema: {
        questionIds,
      },
    },
    buildResponse: (submission, action) => {
      const rawQuestionIds = Array.isArray(action.inputSchema?.questionIds)
        ? action.inputSchema.questionIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const responseQuestionIds = rawQuestionIds.length ? rawQuestionIds : ["reply"];
      const inputText = normalizeTextValue(submission.inputText) ?? "";

      return {
        answers: Object.fromEntries(
          responseQuestionIds.map((questionId) => [questionId, { answers: [inputText] }]),
        ),
      };
    },
  };
}

function createApprovalServerRequestAction(
  actionId: string,
  prompt: string,
  buildResponse: (
    submission: TaskPendingActionSubmitRequest,
    action: TaskActionDescriptor,
  ) => Promise<unknown> | unknown,
): ResolvedServerRequestAction {
  return {
    action: {
      actionId,
      actionType: "approval",
      prompt,
      choices: ["approve", "deny"],
    },
    buildResponse,
  };
}

function mapCommandStyleDecision(
  rawDecision: string | undefined,
  method: string,
): string {
  const normalizedDecision = normalizeTextValue(rawDecision);

  if (normalizedDecision === "approve") {
    return "accept";
  }

  if (normalizedDecision === "deny") {
    return "decline";
  }

  throw new Error(`${method} 缺少可识别的审批决定。`);
}

function mapReviewDecision(rawDecision: string | undefined): string {
  const normalizedDecision = normalizeTextValue(rawDecision);

  if (normalizedDecision === "approve") {
    return "approved";
  }

  if (normalizedDecision === "deny") {
    return "denied";
  }

  throw new Error("缺少可识别的审批决定。");
}

function pickActionId(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeTextValue(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function createExecutionSignal(
  externalSignal?: AbortSignal,
  timeoutMs?: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      const abortFromExternal = (): void => {
        controller.abort(externalSignal.reason);
      };

      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
      cleanups.push(() => externalSignal.removeEventListener("abort", abortFromExternal));
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    const timer = setTimeout(() => {
      controller.abort(new Error(`TASK_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);

    cleanups.push(() => clearTimeout(timer));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  throw signal.reason instanceof Error ? signal.reason : new Error("任务已被取消。");
}

async function abortable<T>(
  run: () => Promise<T> | T,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const pending = Promise.resolve().then(run);

  if (signal.aborted) {
    throwIfAborted(signal);
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error("任务已被取消。"));
    };

    signal.addEventListener("abort", abort, { once: true });

    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function withOperationTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${APP_SERVER_AUX_TIMEOUT_MS}ms.`));
    }, APP_SERVER_AUX_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createEventDeliveryQueue(
  runtimeStore: SqliteCodexSessionRegistry,
  onEvent: TaskRuntimeRunHooks["onEvent"],
): {
  enqueue: (event: TaskEvent) => void;
  deliver: (event: TaskEvent) => Promise<void>;
  flush: () => Promise<void>;
} {
  let chain = Promise.resolve();
  let failure: unknown = null;

  const schedule = (event: TaskEvent): Promise<void> => {
    const next = chain.then(async () => {
      runtimeStore.appendTaskEvent(event);
      await onEvent?.(event);
    });

    chain = next.catch((error: unknown) => {
      if (failure === null) {
        failure = error;
      }
    });

    return next;
  };

  return {
    enqueue: (event) => {
      void schedule(event);
    },
    deliver: async (event) => {
      await schedule(event);
    },
    flush: async () => {
      await chain;

      if (failure !== null) {
        const error = failure;
        failure = null;
        throw error;
      }
    },
  };
}

function persistThreadSession(
  runtimeStore: SqliteCodexSessionRegistry,
  sessionId: string,
  threadId: string | undefined,
  timestamp: string,
): void {
  if (!sessionId || !threadId) {
    return;
  }

  const existing = runtimeStore.getSession(sessionId);

  runtimeStore.saveSession({
    sessionId,
    threadId,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

function resolveAppServerThreadId(
  runtimeStore: SqliteCodexSessionRegistry,
  sessionId: string,
): string | null {
  const reference = resolveStoredSessionThreadReference(runtimeStore, sessionId);
  const hasSettledTurn = runtimeStore.listSessionTurns(sessionId).some((turn) => turn.status === "completed" || turn.status === "failed");

  if (reference.engine === "sdk") {
    return null;
  }

  if (reference.engine === null && hasSettledTurn) {
    return null;
  }

  return normalizeSessionId(reference.threadId ?? undefined) || null;
}

function resolveSessionMode(
  sessionId: string,
  storedThreadId: string | null,
): "created" | "resumed" | "ephemeral" {
  if (!sessionId) {
    return "ephemeral";
  }

  return storedThreadId ? "resumed" : "created";
}

function normalizeSessionId(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function toUnsubscribe(value: void | (() => void)): (() => void) | undefined {
  return typeof value === "function" ? value : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "App-server task failed.";
}

export const APP_SERVER_RUNTIME_ENGINE: RuntimeEngine = "app-server";
