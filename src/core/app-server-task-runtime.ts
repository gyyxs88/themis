import { AppServerActionBridge } from "./app-server-action-bridge.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  buildCodexProcessEnv,
  createCodexAuthStorageConfigOverrides,
  ensureManagedAgentExecutionCodexHome,
  ensureAuthAccountCodexHome,
  type CodexCliConfigOverrides,
} from "./auth-accounts.js";
import type {
  RuntimeEngine,
  RuntimeInputCapabilities,
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
  CodexRuntimeCatalog,
  AppServerReverseRequest,
  AppServerTurnInputPart,
  AppServerThreadStartParams,
  CodexAppServerNotification,
} from "./codex-app-server.js";
import {
  CodexAppServerSession,
  readCodexRuntimeCatalog,
  toRuntimeInputCapabilities,
} from "./codex-app-server.js";
import { translateAppServerNotification } from "./app-server-event-translator.js";
import { ConversationService } from "./conversation-service.js";
import { ManagedAgentCoordinationService } from "./managed-agent-coordination-service.js";
import { ManagedAgentsService } from "./managed-agents-service.js";
import { ManagedAgentSchedulerService } from "./managed-agent-scheduler-service.js";
import {
  buildStoredTurnInputCompileSummary,
  createTaskEvent,
  finalizeTaskResult,
} from "./codex-runtime.js";
import { IdentityLinkService } from "./identity-link-service.js";
import {
  readOpenAICompatibleProviderConfigs,
  type OpenAICompatibleProviderConfig,
} from "./openai-compatible-provider.js";
import { PrincipalActorsService } from "./principal-actors-service.js";
import { PrincipalSkillsService } from "./principal-skills-service.js";
import { buildTaskPrompt } from "./prompt.js";
import { compileTaskInputForRuntime } from "./runtime-input-compiler.js";
import { resolveStoredSessionThreadReference } from "./session-thread-reference.js";
import { validateWorkspacePath } from "./session-workspace.js";

const SESSION_WORKSPACE_UNAVAILABLE_ERROR = "当前会话绑定的工作区不可用，请新建会话后重新设置。";
const APP_SERVER_AUX_TIMEOUT_MS = 15_000;
const APP_SERVER_TRANSPORT_INPUT_CAPABILITIES: RuntimeInputCapabilities = {
  nativeTextInput: true,
  nativeImageInput: true,
  nativeDocumentInput: false,
  supportedDocumentMimeTypes: [],
  supportsPdfTextExtraction: true,
  supportsDocumentPageRasterization: false,
};
const APP_SERVER_FALLBACK_INPUT_CAPABILITIES: RuntimeInputCapabilities = {
  ...APP_SERVER_TRANSPORT_INPUT_CAPABILITIES,
};
export const APP_SERVER_TASK_CONFIG_OVERRIDES: CodexCliConfigOverrides = {
  "features.default_mode_request_user_input": true,
};

interface AppServerRuntimeInputCapabilityMatrix {
  modelCapabilities: RuntimeInputCapabilities | null;
  transportCapabilities: RuntimeInputCapabilities;
  effectiveCapabilities: RuntimeInputCapabilities;
}

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
  startTurn(threadId: string, input: string | AppServerTurnInputPart[]): Promise<{ turnId: string }>;
  interruptTurn?(threadId: string, turnId: string): Promise<void>;
  close(): Promise<void>;
  onNotification(handler: (notification: CodexAppServerNotification) => void): void | (() => void);
  onServerRequest(handler: (request: AppServerReverseRequest) => void): void | (() => void);
  respondToServerRequest?(id: string | number, result: unknown): Promise<void>;
  rejectServerRequest?(id: string | number, error: Error): Promise<void>;
}

export interface AppServerSessionFactoryOptions {
  env?: Record<string, string>;
  configOverrides?: CodexCliConfigOverrides;
}

export interface AppServerTaskRuntimeOptions {
  workingDirectory?: string;
  runtimeStore?: SqliteCodexSessionRegistry;
  principalSkillsService?: PrincipalSkillsService;
  sessionFactory?: (
    options?: AppServerSessionFactoryOptions,
  ) => Promise<AppServerTaskRuntimeSession> | AppServerTaskRuntimeSession;
  actionBridge?: AppServerActionBridge;
  runtimeCatalogReader?: () => Promise<CodexRuntimeCatalog>;
}

export interface AppServerInternalTaskContext {
  principalId: string;
  conversationId?: string;
}

export interface AppServerTaskExecutionController {
  threadId: string;
  turnId: string;
  interrupt: () => Promise<void>;
}

interface AppServerResolvedExecutionRequest {
  request: TaskRequest;
  principalId?: string;
  conversationId?: string;
}

interface AppServerInternalTaskRunHooks extends TaskRuntimeRunHooks {
  onExecutionReady?: (
    controller: AppServerTaskExecutionController,
  ) => Promise<void> | void;
}

export class AppServerTaskWaitingForActionError extends Error {
  readonly waitingFor: "human" | "agent";

  constructor(waitingFor: "human" | "agent", message = "App-server task is waiting for follow-up action.") {
    super(message);
    this.name = "AppServerTaskWaitingForActionError";
    this.waitingFor = waitingFor;
  }
}

export function isAppServerTaskWaitingForActionError(error: unknown): error is AppServerTaskWaitingForActionError {
  return error instanceof AppServerTaskWaitingForActionError;
}

class AppServerTurnCancelledError extends Error {
  constructor(message = "App-server turn cancelled.") {
    super(message);
    this.name = "AppServerTurnCancelledError";
  }
}

function isAppServerTurnCancelledError(error: unknown): error is AppServerTurnCancelledError {
  return error instanceof AppServerTurnCancelledError;
}

export class AppServerTaskRuntime {
  private readonly workingDirectory: string;
  private readonly runtimeStore: SqliteCodexSessionRegistry;
  private readonly identityLinkService: IdentityLinkService;
  private readonly conversationService: ConversationService;
  private readonly managedAgentCoordinationService: ManagedAgentCoordinationService;
  private readonly managedAgentsService: ManagedAgentsService;
  private readonly managedAgentSchedulerService: ManagedAgentSchedulerService;
  private readonly principalActorsService: PrincipalActorsService;
  private readonly principalSkillsService: PrincipalSkillsService;
  private readonly sessionFactory: (
    options?: AppServerSessionFactoryOptions,
  ) => Promise<AppServerTaskRuntimeSession>;
  private readonly actionBridge: AppServerActionBridge;
  private readonly runtimeCatalogReader: (() => Promise<CodexRuntimeCatalog>) | null;

  constructor(options: AppServerTaskRuntimeOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.runtimeStore = options.runtimeStore ?? new SqliteCodexSessionRegistry();
    this.identityLinkService = new IdentityLinkService(this.runtimeStore);
    this.conversationService = new ConversationService(this.runtimeStore, this.identityLinkService);
    this.managedAgentCoordinationService = new ManagedAgentCoordinationService({
      registry: this.runtimeStore,
    });
    this.managedAgentsService = new ManagedAgentsService({
      registry: this.runtimeStore,
      workingDirectory: this.workingDirectory,
    });
    this.managedAgentSchedulerService = new ManagedAgentSchedulerService({
      registry: this.runtimeStore,
    });
    this.principalActorsService = new PrincipalActorsService({
      registry: this.runtimeStore,
    });
    this.principalSkillsService = options.principalSkillsService ?? new PrincipalSkillsService({
      workingDirectory: this.workingDirectory,
      registry: this.runtimeStore,
    });
    this.sessionFactory = async (factoryOptions = {}) =>
      await options.sessionFactory?.(factoryOptions)
      ?? new CodexAppServerSession(this.workingDirectory, {
        ...(factoryOptions.env ? { env: factoryOptions.env } : {}),
        configOverrides: {
          ...APP_SERVER_TASK_CONFIG_OVERRIDES,
          ...(factoryOptions.configOverrides ?? {}),
        },
      });
    this.actionBridge = options.actionBridge ?? new AppServerActionBridge();
    this.runtimeCatalogReader = options.runtimeCatalogReader
      ?? (options.sessionFactory
        ? null
        : async () => await readCodexRuntimeCatalog(this.workingDirectory, {
          configOverrides: APP_SERVER_TASK_CONFIG_OVERRIDES,
        }));
  }

  async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
    return await this.executeTask(this.conversationService.resolveRequest(request), hooks);
  }

  async runTaskAsPrincipal(
    request: TaskRequest,
    context: AppServerInternalTaskContext,
    hooks: AppServerInternalTaskRunHooks = {},
  ): Promise<TaskResult> {
    const principalId = normalizeTextValue(context.principalId);

    if (!principalId) {
      throw new Error("Internal app-server execution requires principalId.");
    }

    const conversationId = normalizeTextValue(
      context.conversationId
        ?? request.channelContext.sessionId
        ?? request.channelContext.channelSessionKey,
    );
    const normalizedRequest = conversationId
      ? {
        ...request,
        channelContext: {
          ...request.channelContext,
          sessionId: request.channelContext.sessionId ?? conversationId,
          channelSessionKey: request.channelContext.channelSessionKey ?? conversationId,
        },
      }
      : request;

    return await this.executeTask({
      request: normalizedRequest,
      principalId,
      ...(conversationId ? { conversationId } : {}),
    }, hooks);
  }

  private resolveSessionFactoryOptions(
    request: TaskRequest,
    principalId?: string,
  ): AppServerSessionFactoryOptions {
    const accessMode = normalizeTextValue(request.options?.accessMode) === "third-party" ? "third-party" : "auth";
    const managedAgent = normalizeTextValue(principalId)
      ? this.runtimeStore.getManagedAgentByPrincipal(principalId as string)
      : null;

    if (accessMode === "third-party") {
      const providerConfigs = readOpenAICompatibleProviderConfigs(this.workingDirectory, this.runtimeStore);
      const requestedProviderId = normalizeTextValue(request.options?.thirdPartyProviderId);
      const providerConfig = requestedProviderId
        ? providerConfigs.find((entry) => entry.id === requestedProviderId) ?? null
        : providerConfigs[0] ?? null;

      if (!providerConfig) {
        throw new Error("Third-party provider does not exist.");
      }

      const env = createCodexProviderEnv(providerConfig);

      if (managedAgent) {
        env.CODEX_HOME = ensureManagedAgentExecutionCodexHome(this.workingDirectory, managedAgent.agentId);
      }

      return {
        env,
        configOverrides: createCodexProviderOverrides(providerConfig),
      };
    }

    const requestedAuthAccountId = normalizeTextValue(request.options?.authAccountId);
    const account = requestedAuthAccountId
      ? this.runtimeStore.getAuthAccount(requestedAuthAccountId)
      : this.runtimeStore.getActiveAuthAccount();

    if (requestedAuthAccountId && !account) {
      throw new Error("Auth account does not exist.");
    }

    if (!account) {
      if (!managedAgent) {
        return {};
      }

      return {
        env: buildCodexProcessEnv(
          ensureManagedAgentExecutionCodexHome(this.workingDirectory, managedAgent.agentId),
        ),
        configOverrides: createCodexAuthStorageConfigOverrides(),
      };
    }

    ensureAuthAccountCodexHome(this.workingDirectory, account.codexHome);
    const codexHome = managedAgent
      ? ensureManagedAgentExecutionCodexHome(this.workingDirectory, managedAgent.agentId, {
        sourceCodexHome: account.codexHome,
      })
      : account.codexHome;

    return {
      env: buildCodexProcessEnv(codexHome),
      configOverrides: createCodexAuthStorageConfigOverrides(),
    };
  }

  private async executeTask(
    resolvedRequest: AppServerResolvedExecutionRequest,
    hooks: AppServerInternalTaskRunHooks = {},
  ): Promise<TaskResult> {
    let request = resolvedRequest.request;
    const principalId = resolvedRequest.principalId;

    const taskId = request.taskId ?? request.requestId;
    const { signal, cleanup } = createExecutionSignal(hooks.signal, hooks.timeoutMs);
    const eventDelivery = createEventDeliveryQueue(this.runtimeStore, hooks.onEvent);
    let session: AppServerTaskRuntimeSession | null = null;
    let unsubscribeNotification: (() => void) | undefined;
    let unsubscribeServerRequest: (() => void) | undefined;
    let sessionMode: "created" | "resumed" | "ephemeral" = "ephemeral";
    let resolvedThreadId: string | undefined;
    const responseArtifacts: AppServerResponseArtifacts = {
      latestAssistantMessage: "",
      finalAnswer: "",
    };
    const agentMessageTextByItemId = new Map<string, string>();
    const turnCompletion = createAppServerTurnCompletionState();
    const pendingServerRequests = new Set<Promise<void>>();
    const sessionId = normalizeSessionId(request.channelContext.sessionId);
    let skipFinalEventFlush = false;

    const emit = async (event: TaskEvent): Promise<void> => {
      await abortable(() => eventDelivery.deliver(event), signal);
    };

    this.runtimeStore.upsertTurnFromRequest(request, taskId);

    try {
      throwIfAborted(signal);
      const inputCapabilityMatrix = request.inputEnvelope
        ? await this.resolveInputCapabilities(request)
        : {
          modelCapabilities: null,
          transportCapabilities: APP_SERVER_TRANSPORT_INPUT_CAPABILITIES,
          effectiveCapabilities: APP_SERVER_FALLBACK_INPUT_CAPABILITIES,
        } satisfies AppServerRuntimeInputCapabilityMatrix;
      const compiledInput = request.inputEnvelope
        ? compileTaskInputForRuntime({
          envelope: request.inputEnvelope,
          target: {
            runtimeId: "app-server",
            capabilities: inputCapabilityMatrix.effectiveCapabilities,
            ...(inputCapabilityMatrix.modelCapabilities ? { modelCapabilities: inputCapabilityMatrix.modelCapabilities } : {}),
            transportCapabilities: inputCapabilityMatrix.transportCapabilities,
          },
        })
        : null;
      if (request.inputEnvelope && compiledInput) {
        this.runtimeStore.saveTurnInput({
          requestId: request.requestId,
          envelope: request.inputEnvelope,
          compileSummary: buildStoredTurnInputCompileSummary({
            runtimeTarget: "app-server",
            compiledInput,
          }),
          createdAt: request.createdAt,
        });
      }

      if (compiledInput?.degradationLevel === "blocked") {
        throw new Error(compiledInput.compileWarnings[0]?.message ?? "当前输入无法发送到 app-server。");
      }

      session = await abortable(() => this.sessionFactory(this.resolveSessionFactoryOptions(request, principalId)), signal);
      const activeSession = session;
      throwIfAborted(signal);
      await abortable(() => activeSession.initialize(), signal);

      unsubscribeNotification = toUnsubscribe(activeSession.onNotification((notification) => {
        collectAppServerResponseArtifacts(notification, responseArtifacts);
        observeAppServerTurnCompletion(notification, turnCompletion);
        const event = translateAppServerNotification(taskId, request.requestId, notification, {
          agentMessageTextByItemId,
        });

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
      const threadStartParams = createAppServerThreadStartParams(request, executionWorkingDirectory);

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

      const promptRequest = compiledInput ? withoutTaskAttachments(request) : request;
      const prompt = buildTaskPrompt(promptRequest, {
        fallbackPromptSections: compiledInput?.fallbackPromptSections ?? [],
      });
      const turnInput = compiledInput?.nativeInputParts.length
        ? [
          {
            type: "text",
            text: prompt,
            text_elements: [],
          } satisfies AppServerTurnInputPart,
          ...compiledInput.nativeInputParts.map(mapAppServerTurnInputPart),
        ]
        : prompt;
      const turn = await abortable(() => activeSession.startTurn(threadId, turnInput), signal);
      turnCompletion.targetTurnId = turn.turnId;
      await hooks.onExecutionReady?.({
        threadId,
        turnId: turn.turnId,
        interrupt: async () => {
          if (typeof activeSession.interruptTurn !== "function") {
            return;
          }

          await activeSession.interruptTurn(threadId, turn.turnId);
        },
      });
      await abortable(() => waitForPendingServerRequests(pendingServerRequests), signal);
      await abortable(() => turnCompletion.promise, signal);
      await abortable(() => eventDelivery.flush(), signal);
      throwIfAborted(signal);

      const output = resolveAppServerFinalOutput(responseArtifacts);
      const baseResult: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "completed",
        summary: summarizeAppServerResponse(output),
        ...(output ? { output } : {}),
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

      let completionMemoryUpdates: TaskResult["memoryUpdates"] = [];
      if (principalId) {
        try {
          completionMemoryUpdates = this.principalActorsService.suggestMainMemoryCandidatesFromTask({
            principalId,
            request,
            result,
            ...(resolvedRequest.conversationId ? { conversationId: resolvedRequest.conversationId } : {}),
          }).updates;

          if (completionMemoryUpdates.length > 0) {
            await emit(
              createTaskEvent(
                taskId,
                request.requestId,
                "task.memory_updated",
                "completed",
                "Memory updated at task completion.",
                { updates: completionMemoryUpdates },
              ),
            );
          }
        } catch (error) {
          await emit(
            createTaskEvent(
              taskId,
              request.requestId,
              "task.memory_updated",
              "failed",
              toErrorMessage(error),
              {
                updates: [],
                errorCode: "MEMORY_UPDATE_FAILED",
              },
            ),
          );
        }
      }

      return completionMemoryUpdates.length
        ? {
          ...result,
          memoryUpdates: completionMemoryUpdates,
        }
        : result;
    } catch (error) {
      const waitingError = isAppServerTaskWaitingForActionError(error);
      const cancelledError = !waitingError && (isAbortLikeError(error) || isAppServerTurnCancelledError(error) || signal.aborted);
      const message = cancelledError
        ? describeAbort(signal, error)
        : toErrorMessage(error);

      try {
        if (waitingError) {
          await eventDelivery.flush();
        } else if (!signal.aborted) {
          await abortable(() => eventDelivery.flush(), signal);
          await emit(createTaskEvent(taskId, request.requestId, "task.failed", "failed", message));
        }
      } catch {
        // 保留原始执行错误，不让事件回调错误覆盖它。
      }

      if (cancelledError) {
        skipFinalEventFlush = true;
        const result: TaskResult = {
          taskId,
          requestId: request.requestId,
          status: "cancelled",
          summary: message,
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
          completedAt: new Date().toISOString(),
        };

        this.runtimeStore.completeTaskTurn({
          request,
          result,
          sessionMode,
          ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
        });
        persistThreadSession(this.runtimeStore, sessionId, resolvedThreadId, result.completedAt);
        this.runtimeStore.appendTaskEvent(createTaskEvent(taskId, request.requestId, "task.cancelled", "cancelled", message));

        return result;
      }

      if (!waitingError) {
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
      }
      throw error;
    } finally {
      try {
        if (!skipFinalEventFlush && !signal.aborted) {
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

  private async resolveInputCapabilities(request: TaskRequest): Promise<AppServerRuntimeInputCapabilityMatrix> {
    if (!this.runtimeCatalogReader) {
      return {
        modelCapabilities: null,
        transportCapabilities: APP_SERVER_TRANSPORT_INPUT_CAPABILITIES,
        effectiveCapabilities: APP_SERVER_FALLBACK_INPUT_CAPABILITIES,
      };
    }

    try {
      const runtimeCatalog = await this.runtimeCatalogReader();
      return resolveAppServerInputCapabilities(runtimeCatalog, request, APP_SERVER_FALLBACK_INPUT_CAPABILITIES);
    } catch {
      return {
        modelCapabilities: null,
        transportCapabilities: APP_SERVER_TRANSPORT_INPUT_CAPABILITIES,
        effectiveCapabilities: APP_SERVER_FALLBACK_INPUT_CAPABILITIES,
      };
    }
  }

  getRuntimeStore(): SqliteCodexSessionRegistry {
    return this.runtimeStore;
  }

  getWorkingDirectory(): string {
    return this.workingDirectory;
  }

  getIdentityLinkService(): IdentityLinkService {
    return this.identityLinkService;
  }

  getPrincipalActorsService(): PrincipalActorsService {
    return this.principalActorsService;
  }

  getManagedAgentsService(): ManagedAgentsService {
    return this.managedAgentsService;
  }

  getManagedAgentCoordinationService(): ManagedAgentCoordinationService {
    return this.managedAgentCoordinationService;
  }

  getManagedAgentSchedulerService(): ManagedAgentSchedulerService {
    return this.managedAgentSchedulerService;
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
          return;
        }

        await abortable(
          () => input.session.rejectServerRequest!(input.serverRequest.id, rejectionError),
          input.signal,
        );
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

interface AppServerResponseArtifacts {
  latestAssistantMessage: string;
  finalAnswer: string;
}

interface AppServerTurnCompletionState {
  targetTurnId: string;
  settled: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
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

function collectAppServerResponseArtifacts(
  notification: CodexAppServerNotification,
  artifacts: AppServerResponseArtifacts,
): void {
  if (notification.method !== "item/completed") {
    return;
  }

  const params = asRecord(notification.params);
  const item = asRecord(params?.item);

  if (!item || normalizeTextValue(item.type) !== "agentMessage") {
    return;
  }

  const text = normalizeTextValue(item.text);

  if (!text) {
    return;
  }

  artifacts.latestAssistantMessage = text;

  if (normalizeTextValue(item.phase) === "final_answer") {
    artifacts.finalAnswer = text;
  }
}

function resolveAppServerFinalOutput(artifacts: AppServerResponseArtifacts): string {
  return artifacts.finalAnswer || artifacts.latestAssistantMessage;
}

function summarizeAppServerResponse(finalResponse: string): string {
  const normalized = finalResponse.trim();

  if (!normalized) {
    return "Codex completed the task but did not return a final text response.";
  }

  const [firstLine] = normalized.split("\n");
  return firstLine ? firstLine.slice(0, 200) : normalized.slice(0, 200);
}

function createAppServerTurnCompletionState(): AppServerTurnCompletionState {
  let resolve!: () => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    targetTurnId: "",
    settled: false,
    promise,
    resolve,
    reject,
  };
}

function observeAppServerTurnCompletion(
  notification: CodexAppServerNotification,
  state: AppServerTurnCompletionState,
): void {
  if (state.settled || !state.targetTurnId) {
    return;
  }

  if (notification.method === "turn/completed") {
    const params = asRecord(notification.params);
    const turn = asRecord(params?.turn);

    if (normalizeTextValue(turn?.id) !== state.targetTurnId) {
      return;
    }

    const status = normalizeTextValue(turn?.status);

    if (status === "completed") {
      state.settled = true;
      state.resolve();
      return;
    }

    if (status === "cancelled") {
      const errorRecord = asRecord(turn?.error);
      state.settled = true;
      state.reject(
        new AppServerTurnCancelledError(
          normalizeTextValue(errorRecord?.message) ?? "App-server turn cancelled.",
        ),
      );
      return;
    }

    const errorRecord = asRecord(turn?.error);
    state.settled = true;
    state.reject(new Error(normalizeTextValue(errorRecord?.message) ?? "App-server turn failed."));
    return;
  }

  if (notification.method === "error") {
    const params = asRecord(notification.params);

    if (normalizeTextValue(params?.turnId) !== state.targetTurnId) {
      return;
    }

    const willRetry = params?.willRetry === true;

    if (willRetry) {
      return;
    }

    const errorRecord = asRecord(params?.error);
    state.settled = true;
    state.reject(new Error(normalizeTextValue(errorRecord?.message) ?? "App-server turn failed."));
  }
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

  throw signal.reason instanceof Error ? signal.reason : new Error(describeAbort(signal));
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
      reject(signal.reason instanceof Error ? signal.reason : new Error(describeAbort(signal)));
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

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message.startsWith("TASK_TIMEOUT:");
}

function describeAbort(signal: AbortSignal, error?: unknown): string {
  if (isAppServerTurnCancelledError(error)) {
    return error.message || "任务已被取消。";
  }

  const reason = signal.reason;

  if (reason instanceof Error) {
    if (reason.message.startsWith("TASK_TIMEOUT:")) {
      const timeout = reason.message.split(":")[1] ?? "0";
      const seconds = Math.max(1, Math.round(Number.parseInt(timeout, 10) / 1000));
      return `任务因超时被取消，超时时间约为 ${seconds} 秒。`;
    }

    if (reason.message === "WORK_ITEM_CANCELLED") {
      return "顶层治理已取消该任务。";
    }
  }

  return "任务已被取消。";
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

function withoutTaskAttachments(request: TaskRequest): TaskRequest {
  const { attachments: _attachments, ...rest } = request;
  return rest;
}

function createAppServerThreadStartParams(
  request: TaskRequest,
  cwd: string,
): AppServerThreadStartParams {
  const model = normalizeTextValue(request.options?.model);
  const approvalPolicy = normalizeTextValue(request.options?.approvalPolicy);
  const sandboxMode = normalizeTextValue(request.options?.sandboxMode);
  const webSearchMode = normalizeTextValue(request.options?.webSearchMode);

  return {
    cwd,
    persistExtendedHistory: true,
    ...(model ? { model } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(sandboxMode ? { sandbox: sandboxMode } : {}),
    ...(webSearchMode ? { webSearchMode } : {}),
  };
}

function createCodexProviderEnv(providerConfig: OpenAICompatibleProviderConfig): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  env.THEMIS_OPENAI_COMPAT_API_KEY = providerConfig.apiKey;

  return env;
}

function createCodexProviderOverrides(providerConfig: OpenAICompatibleProviderConfig): CodexCliConfigOverrides {
  return {
    model_provider: providerConfig.id,
    model_providers: {
      [providerConfig.id]: {
        name: providerConfig.name,
        base_url: providerConfig.baseUrl,
        wire_api: providerConfig.wireApi,
        env_key: "THEMIS_OPENAI_COMPAT_API_KEY",
        supports_websockets: providerConfig.supportsWebsockets,
      },
    },
    ...(providerConfig.modelCatalogPath ? { model_catalog_json: providerConfig.modelCatalogPath } : {}),
  };
}

function resolveAppServerInputCapabilities(
  runtimeCatalog: CodexRuntimeCatalog,
  request: TaskRequest,
  fallback: RuntimeInputCapabilities,
): AppServerRuntimeInputCapabilityMatrix {
  const selectedModel = selectRuntimeModel(runtimeCatalog, request.options?.model);

  if (!selectedModel) {
    return {
      modelCapabilities: null,
      transportCapabilities: APP_SERVER_TRANSPORT_INPUT_CAPABILITIES,
      effectiveCapabilities: fallback,
    };
  }

  const modelCapabilities = toRuntimeInputCapabilities(selectedModel.capabilities, fallback);
  return {
    modelCapabilities,
    transportCapabilities: APP_SERVER_TRANSPORT_INPUT_CAPABILITIES,
    effectiveCapabilities: intersectAppServerInputCapabilities(
      modelCapabilities,
      APP_SERVER_TRANSPORT_INPUT_CAPABILITIES,
    ),
  };
}

function intersectAppServerInputCapabilities(
  modelCapabilities: RuntimeInputCapabilities,
  transportCapabilities: RuntimeInputCapabilities,
): RuntimeInputCapabilities {
  const nativeTextInput = modelCapabilities.nativeTextInput && transportCapabilities.nativeTextInput;
  const nativeImageInput = modelCapabilities.nativeImageInput && transportCapabilities.nativeImageInput;
  const nativeDocumentInput = modelCapabilities.nativeDocumentInput && transportCapabilities.nativeDocumentInput;

  return {
    nativeTextInput,
    nativeImageInput,
    nativeDocumentInput,
    supportedDocumentMimeTypes: nativeDocumentInput
      ? intersectSupportedDocumentMimeTypes(
        modelCapabilities.supportedDocumentMimeTypes,
        transportCapabilities.supportedDocumentMimeTypes,
      )
      : [],
    supportsPdfTextExtraction: modelCapabilities.supportsPdfTextExtraction,
    supportsDocumentPageRasterization: modelCapabilities.supportsDocumentPageRasterization,
  };
}

function intersectSupportedDocumentMimeTypes(modelMimeTypes: string[], transportMimeTypes: string[]): string[] {
  if (modelMimeTypes.length === 0) {
    return [...transportMimeTypes];
  }

  if (transportMimeTypes.length === 0) {
    return [...modelMimeTypes];
  }

  const allowedMimeTypes = new Set(transportMimeTypes);
  return modelMimeTypes.filter((mimeType) => allowedMimeTypes.has(mimeType));
}

function selectRuntimeModel(
  runtimeCatalog: CodexRuntimeCatalog,
  requestedModel: string | undefined,
): CodexRuntimeCatalog["models"][number] | null {
  const normalizedRequestedModel = normalizeTextValue(requestedModel);

  if (normalizedRequestedModel) {
    return runtimeCatalog.models.find((model) => model.model === normalizedRequestedModel) ?? null;
  }

  const normalizedDefaultModel = normalizeTextValue(runtimeCatalog.defaults.model);

  if (normalizedDefaultModel) {
    return runtimeCatalog.models.find((model) => model.model === normalizedDefaultModel) ?? null;
  }

  return runtimeCatalog.models[0] ?? null;
}

function mapAppServerTurnInputPart(part: {
  type: "text" | "image" | "document";
  text?: string;
  assetPath?: string;
  mimeType?: string;
}): AppServerTurnInputPart {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text ?? "",
      text_elements: [],
    };
  }

  if (part.type === "image") {
    return {
      type: "localImage",
      path: part.assetPath ?? "",
    };
  }

  throw new Error("App-server does not support native document input.");
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
