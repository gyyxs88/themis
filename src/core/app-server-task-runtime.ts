import { AppServerActionBridge } from "./app-server-action-bridge.js";
import {
  type ManagedAgentControlPlaneStore,
  SqliteCodexSessionRegistry,
  SqliteManagedAgentControlPlaneStore,
} from "../storage/index.js";
import {
  buildCodexProcessEnv,
  createCodexAuthStorageConfigOverrides,
  ensureManagedAgentExecutionCodexHome,
  ensureAuthAccountCodexHome,
  type CodexCliConfigOverrides,
} from "./auth-accounts.js";
import type {
  PrincipalKind,
  PrincipalTaskSettings,
  RuntimeEngine,
  RuntimeInputCapabilities,
  TaskAccessMode,
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
import {
  translateAppServerNotification,
  translateAppServerToolSignal,
  type AppServerToolTraceSignal,
} from "./app-server-event-translator.js";
import { ConversationService } from "./conversation-service.js";
import { ManagedAgentCoordinationService } from "./managed-agent-coordination-service.js";
import {
  createManagedAgentControlPlaneFacadeAsyncAdapter,
  type ManagedAgentControlPlaneFacadeAsync,
  ManagedAgentControlPlaneFacade,
} from "./managed-agent-control-plane-facade.js";
import { ManagedAgentNodeService } from "./managed-agent-node-service.js";
import { ManagedAgentsService } from "./managed-agents-service.js";
import { ManagedAgentSchedulerService } from "./managed-agent-scheduler-service.js";
import { ManagedAgentWorkerService } from "./managed-agent-worker-service.js";
import { IdentityLinkService } from "./identity-link-service.js";
import {
  readOpenAICompatibleProviderConfigs,
  type OpenAICompatibleProviderConfig,
} from "./openai-compatible-provider.js";
import { PrincipalActorsService } from "./principal-actors-service.js";
import { PrincipalMcpService } from "./principal-mcp-service.js";
import { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import { PrincipalOperationsBossViewService } from "./principal-operations-boss-view-service.js";
import { PrincipalPluginsService } from "./principal-plugins-service.js";
import {
  PrincipalPersonaService,
  type PrincipalPersonaOnboardingInterceptResult,
} from "./principal-persona-service.js";
import { PrincipalAssetsService } from "./principal-assets-service.js";
import { PrincipalCadencesService } from "./principal-cadences-service.js";
import { PrincipalCommitmentsService } from "./principal-commitments-service.js";
import { PrincipalDecisionsService } from "./principal-decisions-service.js";
import { PrincipalRisksService } from "./principal-risks-service.js";
import { PrincipalSkillsService } from "./principal-skills-service.js";
import { PluginService } from "./plugin-service.js";
import { buildFormalSourceEditGuardPromptSectionIfNeeded } from "./formal-source-edit-guard.js";
import { buildBootstrapPrompt, buildTaskPrompt } from "./prompt.js";
import { ScheduledTasksService } from "./scheduled-tasks-service.js";
import {
  applyThemisGlobalDefaultsToRuntimeCatalog,
  applyThemisGlobalDefaultsToTaskOptions,
} from "./task-defaults.js";
import {
  buildThemisScheduledTaskMcpConfigOverrides,
  buildThemisScheduledTaskPromptSection,
  isThemisScheduledTaskAutoApprovedToolName,
} from "./themis-scheduled-task-tools.js";
import {
  buildThemisManagedAgentPromptSection,
  isThemisManagedAgentToolName,
} from "./themis-managed-agent-tools.js";
import {
  buildThemisOperationsPromptSection,
  isThemisOperationsToolName,
} from "./themis-operations-tools.js";
import { compileTaskInputForRuntime } from "./runtime-input-compiler.js";
import { resolveStoredSessionThreadReference } from "./session-thread-reference.js";
import { validateWorkspacePath } from "./session-workspace.js";
import { ContextBuilder } from "../context/context-builder.js";
import { MemoryService } from "../memory/memory-service.js";
import { buildAssistantStyleSessionPayload } from "./assistant-style.js";
import {
  isPrincipalTaskSettingsEmpty,
  normalizePrincipalTaskSettings,
} from "./principal-task-settings.js";
import {
  buildStoredTurnInputCompileSummary,
  createTaskEvent,
  finalizeTaskResult,
} from "./task-runtime-common.js";
import { createUnifiedRuntimeCatalog } from "./runtime-catalog.js";
import { ToolTraceTimeline } from "./tool-trace-timeline.js";

const SESSION_WORKSPACE_UNAVAILABLE_ERROR = "当前会话绑定的工作区不可用，请新建会话后重新设置。";
const APP_SERVER_AUX_TIMEOUT_MS = 15_000;
const APP_SERVER_TOOL_TRACE_MAX_ENTRIES = 10;
const APP_SERVER_TOOL_TRACE_MAX_EDITS = 12;
const APP_SERVER_TOOL_TRACE_DEBOUNCE_MS = 1_000;
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
  compactThread?(threadId: string): Promise<void>;
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
  principalMcpService?: PrincipalMcpService;
  principalPluginsService?: PrincipalPluginsService;
  principalSkillsService?: PrincipalSkillsService;
  pluginService?: PluginService;
  createContextBuilder?: (workingDirectory: string) => ContextBuilder;
  createMemoryService?: (workingDirectory: string) => MemoryService;
  sessionFactory?: (
    options?: AppServerSessionFactoryOptions,
  ) => Promise<AppServerTaskRuntimeSession> | AppServerTaskRuntimeSession;
  actionBridge?: AppServerActionBridge;
  runtimeCatalogReader?: () => Promise<CodexRuntimeCatalog>;
  managedAgentControlPlaneStore?: ManagedAgentControlPlaneStore;
  toolTraceDebounceMs?: number;
}

export interface AppServerInternalTaskContext {
  principalId: string;
  conversationId?: string;
  principalKind?: PrincipalKind;
  principalDisplayName?: string;
  principalOrganizationId?: string;
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

interface AppServerResolvedSessionAccess {
  sessionFactoryOptions: AppServerSessionFactoryOptions;
  accessMode: TaskAccessMode;
  authAccountId: string | null;
  thirdPartyProviderId: string | null;
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
  private readonly principalPersonaService: PrincipalPersonaService;
  private readonly managedAgentControlPlaneStore: ManagedAgentControlPlaneStore;
  private readonly managedAgentCoordinationService: ManagedAgentCoordinationService;
  private readonly managedAgentControlPlaneFacade: ManagedAgentControlPlaneFacade;
  private readonly managedAgentControlPlaneFacadeAsync: ManagedAgentControlPlaneFacadeAsync;
  private readonly managedAgentNodeService: ManagedAgentNodeService;
  private readonly managedAgentsService: ManagedAgentsService;
  private readonly managedAgentSchedulerService: ManagedAgentSchedulerService;
  private readonly managedAgentWorkerService: ManagedAgentWorkerService;
  private readonly principalActorsService: PrincipalActorsService;
  private readonly principalAssetsService: PrincipalAssetsService;
  private readonly principalCadencesService: PrincipalCadencesService;
  private readonly principalCommitmentsService: PrincipalCommitmentsService;
  private readonly principalDecisionsService: PrincipalDecisionsService;
  private readonly principalRisksService: PrincipalRisksService;
  private readonly principalOperationEdgesService: PrincipalOperationEdgesService;
  private readonly principalOperationsBossViewService: PrincipalOperationsBossViewService;
  private readonly principalMcpService: PrincipalMcpService;
  private readonly principalPluginsService: PrincipalPluginsService;
  private readonly principalSkillsService: PrincipalSkillsService;
  private readonly pluginService: PluginService;
  private readonly scheduledTasksService: ScheduledTasksService;
  private readonly createContextBuilder: (workingDirectory: string) => ContextBuilder;
  private readonly createMemoryService: (workingDirectory: string) => MemoryService;
  private readonly sessionFactory: (
    options?: AppServerSessionFactoryOptions,
  ) => Promise<AppServerTaskRuntimeSession>;
  private readonly actionBridge: AppServerActionBridge;
  private readonly runtimeCatalogReader: (() => Promise<CodexRuntimeCatalog>) | null;
  private readonly toolTraceDebounceMs: number;

  constructor(options: AppServerTaskRuntimeOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.runtimeStore = options.runtimeStore ?? new SqliteCodexSessionRegistry();
    this.identityLinkService = new IdentityLinkService(this.runtimeStore);
    this.conversationService = new ConversationService(this.runtimeStore, this.identityLinkService);
    this.principalPersonaService = new PrincipalPersonaService(this.runtimeStore);
    this.managedAgentControlPlaneStore = options.managedAgentControlPlaneStore
      ?? new SqliteManagedAgentControlPlaneStore(this.runtimeStore);
    this.managedAgentCoordinationService = new ManagedAgentCoordinationService({
      registry: this.managedAgentControlPlaneStore.coordinationStore,
    });
    this.managedAgentsService = new ManagedAgentsService({
      registry: this.managedAgentControlPlaneStore.managedAgentsStore,
      workingDirectory: this.workingDirectory,
    });
    this.managedAgentSchedulerService = new ManagedAgentSchedulerService({
      registry: this.managedAgentControlPlaneStore.schedulerStore,
    });
    this.managedAgentNodeService = new ManagedAgentNodeService({
      registry: this.managedAgentControlPlaneStore.nodeStore,
    });
    this.managedAgentWorkerService = new ManagedAgentWorkerService({
      registry: this.managedAgentControlPlaneStore.workerStore,
      nodeService: this.managedAgentNodeService,
      schedulerService: this.managedAgentSchedulerService,
    });
    this.managedAgentControlPlaneFacade = new ManagedAgentControlPlaneFacade({
      managedAgentsService: this.managedAgentsService,
      coordinationService: this.managedAgentCoordinationService,
      schedulerService: this.managedAgentSchedulerService,
      nodeService: this.managedAgentNodeService,
      workerService: this.managedAgentWorkerService,
    });
    this.managedAgentControlPlaneFacadeAsync = createManagedAgentControlPlaneFacadeAsyncAdapter(
      this.managedAgentControlPlaneFacade,
    );
    this.principalActorsService = new PrincipalActorsService({
      registry: this.runtimeStore,
    });
    this.principalAssetsService = new PrincipalAssetsService({
      registry: this.runtimeStore,
    });
    this.principalOperationEdgesService = new PrincipalOperationEdgesService({
      registry: this.runtimeStore,
    });
    this.principalCadencesService = new PrincipalCadencesService({
      registry: this.runtimeStore,
      operationEdgesService: this.principalOperationEdgesService,
    });
    this.principalCommitmentsService = new PrincipalCommitmentsService({
      registry: this.runtimeStore,
      operationEdgesService: this.principalOperationEdgesService,
    });
    this.principalDecisionsService = new PrincipalDecisionsService({
      registry: this.runtimeStore,
      operationEdgesService: this.principalOperationEdgesService,
    });
    this.principalRisksService = new PrincipalRisksService({
      registry: this.runtimeStore,
      operationEdgesService: this.principalOperationEdgesService,
    });
    this.principalOperationsBossViewService = new PrincipalOperationsBossViewService({
      assetsService: this.principalAssetsService,
      cadencesService: this.principalCadencesService,
      commitmentsService: this.principalCommitmentsService,
      decisionsService: this.principalDecisionsService,
      edgesService: this.principalOperationEdgesService,
      risksService: this.principalRisksService,
    });
    this.principalMcpService = options.principalMcpService ?? new PrincipalMcpService({
      registry: this.runtimeStore,
    });
    this.principalPluginsService = options.principalPluginsService ?? new PrincipalPluginsService({
      workingDirectory: this.workingDirectory,
      registry: this.runtimeStore,
      ...(options.pluginService ? { runtimePluginService: options.pluginService } : {}),
    });
    this.principalSkillsService = options.principalSkillsService ?? new PrincipalSkillsService({
      workingDirectory: this.workingDirectory,
      registry: this.runtimeStore,
    });
    this.pluginService = options.pluginService ?? new PluginService({
      workingDirectory: this.workingDirectory,
      registry: this.runtimeStore,
    });
    this.scheduledTasksService = new ScheduledTasksService({
      registry: this.runtimeStore,
    });
    this.createContextBuilder = options.createContextBuilder ?? ((workingDirectory) => new ContextBuilder({
      workingDirectory,
    }));
    this.createMemoryService = options.createMemoryService ?? ((workingDirectory) => new MemoryService({
      workingDirectory,
    }));
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
    this.toolTraceDebounceMs = typeof options.toolTraceDebounceMs === "number"
      ? Math.max(0, options.toolTraceDebounceMs)
      : APP_SERVER_TOOL_TRACE_DEBOUNCE_MS;
  }

  async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
    return await this.executeTask(this.resolveExecutionRequest(request), hooks);
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

    this.primeInternalPrincipalContext(request, context);

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

    return await this.executeTask(this.applyPrincipalTaskSettings({
      request: normalizedRequest,
      principalId,
      ...(conversationId ? { conversationId } : {}),
    }), hooks);
  }

  private resolveExecutionRequest(request: TaskRequest): AppServerResolvedExecutionRequest {
    return this.applyPrincipalTaskSettings(this.conversationService.resolveRequest(request));
  }

  private primeInternalPrincipalContext(
    request: TaskRequest,
    context: AppServerInternalTaskContext,
  ): void {
    const principalId = normalizeTextValue(context.principalId);

    if (!principalId) {
      return;
    }

    const existing = this.runtimeStore.getPrincipal(principalId);
    const principalKind = normalizePrincipalKindValue(context.principalKind) ?? existing?.kind;
    const displayName = normalizeTextValue(context.principalDisplayName)
      ?? existing?.displayName
      ?? normalizeTextValue(request.user.displayName);
    const organizationId = normalizeTextValue(context.principalOrganizationId) ?? existing?.organizationId;

    if (
      existing
      && existing.kind === principalKind
      && (existing.displayName ?? null) === (displayName ?? null)
      && (existing.organizationId ?? null) === (organizationId ?? null)
    ) {
      return;
    }

    const now = request.createdAt || new Date().toISOString();
    this.runtimeStore.savePrincipal({
      principalId,
      ...(displayName ? { displayName } : {}),
      ...(principalKind ? { kind: principalKind } : {}),
      ...(organizationId ? { organizationId } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private applyPrincipalTaskSettings(
    resolvedRequest: AppServerResolvedExecutionRequest,
  ): AppServerResolvedExecutionRequest {
    const principalDefaults = this.readPrincipalTaskSettings(resolvedRequest.principalId) ?? {};

    return {
      ...resolvedRequest,
      request: {
        ...resolvedRequest.request,
        options: applyThemisGlobalDefaultsToTaskOptions({
          ...principalDefaults,
          ...(resolvedRequest.request.options ?? {}),
        }),
      },
    };
  }

  private resolveSessionFactoryOptions(
    request: TaskRequest,
    principalId?: string,
  ): AppServerResolvedSessionAccess {
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
        sessionFactoryOptions: withThemisScheduledTaskMcpSessionOptions(
          withPrincipalMcpSessionOptions({
            env,
            configOverrides: createCodexProviderOverrides(providerConfig),
          }, principalId, this.principalMcpService),
          this.workingDirectory,
          request,
        ),
        accessMode: "third-party",
        authAccountId: null,
        thirdPartyProviderId: providerConfig.id,
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
        return {
          sessionFactoryOptions: withThemisScheduledTaskMcpSessionOptions(
            withPrincipalMcpSessionOptions({}, principalId, this.principalMcpService),
            this.workingDirectory,
            request,
          ),
          accessMode: "auth",
          authAccountId: null,
          thirdPartyProviderId: null,
        };
      }

      return {
        sessionFactoryOptions: withThemisScheduledTaskMcpSessionOptions(
          withPrincipalMcpSessionOptions({
            env: buildCodexProcessEnv(
              ensureManagedAgentExecutionCodexHome(this.workingDirectory, managedAgent.agentId),
            ),
            configOverrides: createCodexAuthStorageConfigOverrides(),
          }, principalId, this.principalMcpService),
          this.workingDirectory,
          request,
        ),
        accessMode: "auth",
        authAccountId: null,
        thirdPartyProviderId: null,
      };
    }

    ensureAuthAccountCodexHome(this.workingDirectory, account.codexHome);
    const codexHome = managedAgent
      ? ensureManagedAgentExecutionCodexHome(this.workingDirectory, managedAgent.agentId, {
        sourceCodexHome: account.codexHome,
      })
      : account.codexHome;

    return {
      sessionFactoryOptions: withThemisScheduledTaskMcpSessionOptions(
        withPrincipalMcpSessionOptions({
          env: buildCodexProcessEnv(codexHome),
          configOverrides: createCodexAuthStorageConfigOverrides(),
        }, principalId, this.principalMcpService),
        this.workingDirectory,
        request,
      ),
      accessMode: "auth",
      authAccountId: account.accountId,
      thirdPartyProviderId: null,
    };
  }

  private async executeTask(
    resolvedRequest: AppServerResolvedExecutionRequest,
    hooks: AppServerInternalTaskRunHooks = {},
  ): Promise<TaskResult> {
    let request = resolvedRequest.request;
    const principalId = resolvedRequest.principalId;
    const onboardingIntercept = principalId && this.principalPersonaService.shouldRunOnboarding(request, principalId)
      ? this.principalPersonaService.maybeHandleOnboardingTurn(principalId, request)
      : null;

    const taskId = request.taskId ?? request.requestId;
    const { signal, cleanup, touch } = createExecutionSignal(hooks.signal, hooks.timeoutMs);
    const eventDelivery = createEventDeliveryQueue(this.runtimeStore, hooks.onEvent, touch);
    let session: AppServerTaskRuntimeSession | null = null;
    let unsubscribeNotification: (() => void) | undefined;
    let unsubscribeServerRequest: (() => void) | undefined;
    let sessionMode: "created" | "resumed" | "ephemeral" = "ephemeral";
    let resolvedThreadId: string | undefined;
    const memoryEnabled = request.options?.memoryMode !== "off";
    let memoryService: MemoryService | null = null;
    let memoryStartRecorded = false;
    const responseArtifacts: AppServerResponseArtifacts = {
      latestAssistantMessage: "",
      finalAnswer: "",
    };
    const agentMessageTextByItemId = new Map<string, string>();
    const executionDiagnostics = createAppServerExecutionDiagnostics();
    let turnCompletion = createAppServerTurnCompletionState();
    let threadCompaction = createAppServerThreadCompactionState();
    const pendingServerRequests = new Set<Promise<void>>();
    const sessionId = normalizeSessionId(request.channelContext.sessionId);
    let skipFinalEventFlush = false;
    const sessionAccess = this.resolveSessionFactoryOptions(request, principalId);
    const toolTraceTimeline = new ToolTraceTimeline({
      maxEntries: APP_SERVER_TOOL_TRACE_MAX_ENTRIES,
      maxEdits: APP_SERVER_TOOL_TRACE_MAX_EDITS,
    });
    let toolTraceFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let toolTraceFlushPromise: Promise<void> | null = null;
    let lastToolTraceBucketId: string | null = null;
    let lastToolTraceText: string | null = null;
    let tokenPressureNoticeEmitted = false;

    const emit = async (event: TaskEvent): Promise<void> => {
      touch();
      await abortable(() => eventDelivery.deliver(event), signal);
    };

    const flushToolTrace = async (): Promise<void> => {
      const text = toolTraceTimeline.renderActiveBucket();
      const bucketId = toolTraceTimeline.getActiveBucketId();

      if (!text || !bucketId) {
        return;
      }

      if (bucketId === lastToolTraceBucketId && text === lastToolTraceText) {
        return;
      }

      lastToolTraceBucketId = bucketId;
      lastToolTraceText = text;

      await emit(createTaskEvent(
        taskId,
        request.requestId,
        "task.progress",
        "running",
        text,
        {
          traceKind: "tool",
          traceBucketId: bucketId,
        },
      ));
    };

    const flushToolTraceNow = async (): Promise<void> => {
      if (toolTraceFlushTimer) {
        clearTimeout(toolTraceFlushTimer);
        toolTraceFlushTimer = null;
      }

      if (toolTraceFlushPromise) {
        await toolTraceFlushPromise;
        return;
      }

      await flushToolTrace();
    };

    const scheduleToolTraceFlush = (): void => {
      if (toolTraceFlushTimer || signal.aborted) {
        return;
      }

      const run = (): void => {
        toolTraceFlushTimer = null;
        const pending = flushToolTrace()
          .catch(() => {
            // 工具轨迹的定时推送不应抛出未处理异常，主链会在后续 flush 里感知事件队列错误。
          })
          .finally(() => {
            if (toolTraceFlushPromise === pending) {
              toolTraceFlushPromise = null;
            }
          });
        toolTraceFlushPromise = pending;
      };

      if (this.toolTraceDebounceMs <= 0) {
        run();
        return;
      }

      toolTraceFlushTimer = setTimeout(run, this.toolTraceDebounceMs);
      toolTraceFlushTimer.unref?.();
    };

    const recordToolTrace = (toolSignal: AppServerToolTraceSignal): void => {
      const now = new Date().toISOString();
      observeAppServerToolTraceSignal(executionDiagnostics, toolSignal, now);
      toolTraceTimeline.apply({
        ...toolSignal,
        startedAt: now,
        updatedAt: now,
      });
      scheduleToolTraceFlush();
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

      await emit(createTaskEvent(
        taskId,
        request.requestId,
        "task.received",
        "queued",
        "Themis accepted the web request.",
      ));
      throwIfAborted(signal);

      const executionWorkingDirectory = this.resolveExecutionWorkingDirectory(request);
      memoryService = memoryEnabled ? this.createMemoryService(executionWorkingDirectory) : null;
      const taskContext = await this.buildTaskContext(executionWorkingDirectory, {
        request,
        principalId,
        conversationId: resolvedRequest.conversationId,
        signal,
      });
      throwIfAborted(signal);
      await emit(createTaskEvent(
        taskId,
        request.requestId,
        "task.context_built",
        "running",
        "Task context built.",
        {
          blockCount: taskContext.blocks.length,
          warningCount: taskContext.warnings.length,
          sourceStats: taskContext.sourceStats,
        },
      ));
      throwIfAborted(signal);

      if (compiledInput?.degradationLevel === "blocked") {
        throw new Error(compiledInput.compileWarnings[0]?.message ?? "当前输入无法发送到 app-server。");
      }

      session = await abortable(() => this.sessionFactory(sessionAccess.sessionFactoryOptions), signal);
      const activeSession = session;
      throwIfAborted(signal);
      await abortable(() => activeSession.initialize(), signal);

      unsubscribeNotification = toUnsubscribe(activeSession.onNotification((notification) => {
        touch();
        observeAppServerExecutionNotification(executionDiagnostics, notification);

        if (!tokenPressureNoticeEmitted && isHighTokenPressure(executionDiagnostics.tokenPressure)) {
          tokenPressureNoticeEmitted = true;
          eventDelivery.enqueue(createTaskEvent(
            taskId,
            request.requestId,
            "task.progress",
            "running",
            "当前 Codex thread 上下文接近上限；如果需要续写，Themis 会等待 Codex 原生压缩完成后继续。",
            {
              reason: "context_window_high_water",
              inputTokens: executionDiagnostics.tokenPressure.inputTokens,
              contextWindow: executionDiagnostics.tokenPressure.contextWindow,
              ratio: executionDiagnostics.tokenPressure.ratio,
            },
          ));
        }

        collectAppServerResponseArtifacts(notification, responseArtifacts);
        observeAppServerTurnCompletion(notification, turnCompletion);
        observeAppServerThreadCompaction(notification, threadCompaction);
        const toolSignal = translateAppServerToolSignal(notification);

        if (toolSignal) {
          recordToolTrace(toolSignal);
        }

        const event = translateAppServerNotification(taskId, request.requestId, notification, {
          agentMessageTextByItemId,
        });

        if (!event) {
          return;
        }

        eventDelivery.enqueue(event);
      }));
      unsubscribeServerRequest = toUnsubscribe(activeSession.onServerRequest((serverRequest) => {
        touch();
        const autoApprovalResponse = resolveAutoApprovalServerRequestResponse(serverRequest);
        const toolSignal = translateAppServerToolSignal(serverRequest);

        if (toolSignal && !(autoApprovalResponse !== undefined && toolSignal.phase === "waiting_approval")) {
          recordToolTrace(toolSignal);
        }

        const pendingServerRequest = this.handleServerRequest({
          session: activeSession,
          request,
          principalId,
          taskId,
          requestId: request.requestId,
          serverRequest,
          signal,
          emit,
          recordToolTrace,
        }).finally(() => {
          pendingServerRequests.delete(pendingServerRequest);
        });
        pendingServerRequests.add(pendingServerRequest);
      }));

      const resumableThreadId = sessionId ? resolveAppServerThreadId(this.runtimeStore, sessionId) : null;
      sessionMode = resolveSessionMode(sessionId, resumableThreadId);
      const threadStartParams = createAppServerThreadStartParams(request, executionWorkingDirectory);

      const thread = resumableThreadId
        ? await abortable(() => activeSession.resumeThread(resumableThreadId, threadStartParams), signal)
        : await abortable(() => activeSession.startThread(threadStartParams), signal);
      const threadId = thread.threadId;
      resolvedThreadId = threadId;
      persistThreadSession(this.runtimeStore, sessionId, threadId, request.createdAt);

      if (memoryService) {
        try {
          const startUpdates = memoryService.recordTaskStart({
            request,
            taskId,
            ...(principalId ? { principalId } : {}),
            ...(resolvedRequest.conversationId ? { conversationId: resolvedRequest.conversationId } : {}),
          });
          memoryStartRecorded = true;
          if (startUpdates.length > 0) {
            await emit(
              createTaskEvent(
                taskId,
                request.requestId,
                "task.memory_updated",
                "running",
                "Memory updated at task start.",
                { updates: startUpdates },
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

      await emit(createTaskEvent(
        taskId,
        request.requestId,
        "task.started",
        "running",
        onboardingIntercept ? "Persona bootstrap turn started." : "Codex task started.",
        {
          ...createAppServerSessionEventPayload(sessionId, threadId, sessionMode, sessionAccess),
          ...(onboardingIntercept ? { personaOnboarding: createPersonaOnboardingPayload(onboardingIntercept) } : {}),
        },
      ));
      throwIfAborted(signal);

      const promptRequest = compiledInput ? withoutTaskAttachments(request) : request;
      const personalizedProfileContext = this.principalPersonaService.buildPromptContext(principalId);
      const formalSourceEditGuardPromptSection = buildFormalSourceEditGuardPromptSectionIfNeeded(
        this.workingDirectory,
      );
      const prompt = onboardingIntercept
        ? buildBootstrapPrompt(promptRequest, onboardingIntercept, {
          personalizedProfileContext,
          taskContext,
          fallbackPromptSections: [
            ...(compiledInput?.fallbackPromptSections ?? []),
            buildThemisScheduledTaskPromptSection(request),
            buildThemisManagedAgentPromptSection(request),
            buildThemisOperationsPromptSection(request),
            ...(formalSourceEditGuardPromptSection ? [formalSourceEditGuardPromptSection] : []),
          ],
        })
        : buildTaskPrompt(promptRequest, {
          personalizedProfileContext,
          taskContext,
          fallbackPromptSections: [
            ...(compiledInput?.fallbackPromptSections ?? []),
            buildThemisScheduledTaskPromptSection(request),
            buildThemisManagedAgentPromptSection(request),
            buildThemisOperationsPromptSection(request),
            ...(formalSourceEditGuardPromptSection ? [formalSourceEditGuardPromptSection] : []),
          ],
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

      const runTurn = async (targetThreadId: string, input: string | AppServerTurnInputPart[]): Promise<void> => {
        turnCompletion = createAppServerTurnCompletionState();
        executionDiagnostics.phase = "waiting_for_model";
        const turn = await abortable(() => activeSession.startTurn(targetThreadId, input), signal);
        turnCompletion.targetTurnId = turn.turnId;
        await hooks.onExecutionReady?.({
          threadId: targetThreadId,
          turnId: turn.turnId,
          interrupt: async () => {
            if (typeof activeSession.interruptTurn !== "function") {
              return;
            }

            await activeSession.interruptTurn(targetThreadId, turn.turnId);
          },
        });
        await abortable(() => waitForPendingServerRequests(pendingServerRequests), signal);
        await abortable(() => turnCompletion.promise, signal);
      };

      try {
        await runTurn(threadId, turnInput);
      } catch (error) {
        if (!resumableThreadId || !isAppServerContextWindowExhaustedError(error)) {
          throw error;
        }

        await emit(createTaskEvent(
          taskId,
          request.requestId,
          "task.progress",
          "running",
          "当前 Codex thread 上下文已满，Themis 正在执行原生压缩，压缩完成后会自动继续。",
          {
            reason: "context_window_exhausted",
            recoveryAction: "compact_thread",
            threadId,
          },
        ));

        const compactThread = activeSession.compactThread?.bind(activeSession);

        if (typeof compactThread !== "function") {
          throw new Error("当前 Codex app-server 不支持 thread/compact/start，无法自动压缩并继续。");
        }

        threadCompaction = createAppServerThreadCompactionState(threadId);
        executionDiagnostics.phase = "context_compacting";
        await abortable(() => compactThread(threadId), signal);
        await abortable(() => threadCompaction.promise, signal);
        executionDiagnostics.phase = "context_recovered";

        await emit(createTaskEvent(
          taskId,
          request.requestId,
          "task.progress",
          "running",
          "Codex 原生压缩已完成，Themis 正在继续执行当前消息。",
          {
            reason: "context_window_recovered",
            recoveryAction: "compact_thread",
            threadId,
          },
        ));

        responseArtifacts.latestAssistantMessage = "";
        responseArtifacts.finalAnswer = "";
        agentMessageTextByItemId.clear();
        await runTurn(threadId, turnInput);
      }
      toolTraceTimeline.interruptOpenOps(new Date().toISOString());
      await abortable(() => flushToolTraceNow(), signal);
      await abortable(() => eventDelivery.flush(), signal);
      throwIfAborted(signal);

      const output = resolveAppServerFinalOutput(responseArtifacts, onboardingIntercept);
      const baseResult: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "completed",
        summary: summarizeAppServerResponse(output),
        ...(output ? { output } : {}),
        structuredOutput: createAppServerStructuredOutput(
          sessionId,
          threadId,
          sessionMode,
          sessionAccess,
          request.options,
          onboardingIntercept,
        ),
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

      await emit(
        createAppServerCompletionEvent(
          taskId,
          request.requestId,
          sessionId,
          threadId,
          sessionMode,
          sessionAccess,
          onboardingIntercept,
        ),
      );

      let completionMemoryUpdates: TaskResult["memoryUpdates"] = [];
      if (memoryService && memoryStartRecorded) {
        try {
          completionMemoryUpdates = memoryService.recordTaskCompletion({
            request,
            result,
            taskId,
            ...(principalId ? { principalId } : {}),
            ...(resolvedRequest.conversationId ? { conversationId: resolvedRequest.conversationId } : {}),
            verified: true,
          });
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
          completionMemoryUpdates = [];
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
      if (principalId) {
        try {
          const candidateUpdates = this.principalActorsService.suggestMainMemoryCandidatesFromTask({
            principalId,
            request,
            result,
            ...(resolvedRequest.conversationId ? { conversationId: resolvedRequest.conversationId } : {}),
          }).updates;

          if (candidateUpdates.length > 0) {
            completionMemoryUpdates = [...completionMemoryUpdates, ...candidateUpdates];
            await emit(
              createTaskEvent(
                taskId,
                request.requestId,
                "task.memory_updated",
                "completed",
                "Memory updated at task completion.",
                { updates: candidateUpdates },
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
        ? describeAbort(signal, error, executionDiagnostics)
        : toErrorMessage(error);

      try {
        if (waitingError) {
          await eventDelivery.flush();
        } else if (!signal.aborted) {
          if (toolTraceTimeline.interruptOpenOps(new Date().toISOString())) {
            await abortable(() => flushToolTraceNow(), signal);
          }
          await abortable(() => eventDelivery.flush(), signal);
          await emit(createTaskEvent(taskId, request.requestId, "task.failed", "failed", message));
        }
      } catch {
        // 保留原始执行错误，不让事件回调错误覆盖它。
      }

      if (cancelledError) {
        skipFinalEventFlush = true;
        if (memoryService && memoryStartRecorded) {
          try {
            const updates = memoryService.recordTaskTerminal({
              request,
              taskId,
              ...(principalId ? { principalId } : {}),
              ...(resolvedRequest.conversationId ? { conversationId: resolvedRequest.conversationId } : {}),
              terminalStatus: "cancelled",
              summary: message,
            });
            if (updates.length > 0) {
              this.runtimeStore.appendTaskEvent(createTaskEvent(
                taskId,
                request.requestId,
                "task.memory_updated",
                "cancelled",
                "Memory updated after task cancelled.",
                { updates },
              ));
            }
          } catch (memoryError) {
            this.runtimeStore.appendTaskEvent(createTaskEvent(
              taskId,
              request.requestId,
              "task.memory_updated",
              "failed",
              toErrorMessage(memoryError),
              {
                updates: [],
                errorCode: "MEMORY_UPDATE_FAILED",
              },
            ));
          }
        }
        const result: TaskResult = {
          taskId,
          requestId: request.requestId,
          status: "cancelled",
          summary: message,
          ...(resolvedThreadId
            ? {
                structuredOutput: {
                  ...createAppServerStructuredOutput(
                    sessionId,
                    resolvedThreadId,
                    sessionMode,
                    sessionAccess,
                    request.options,
                    null,
                  ),
                  runtimeDiagnostics: createAppServerRuntimeDiagnosticsPayload(executionDiagnostics),
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
        if (memoryService && memoryStartRecorded) {
          try {
            const updates = memoryService.recordTaskTerminal({
              request,
              taskId,
              ...(principalId ? { principalId } : {}),
              ...(resolvedRequest.conversationId ? { conversationId: resolvedRequest.conversationId } : {}),
              terminalStatus: "failed",
              summary: message,
            });
            if (updates.length > 0) {
              await emit(
                createTaskEvent(
                  taskId,
                  request.requestId,
                  "task.memory_updated",
                  "failed",
                  "Memory updated after task failed.",
                  { updates },
                ),
              );
            }
          } catch (memoryError) {
            await emit(
              createTaskEvent(
                taskId,
                request.requestId,
                "task.memory_updated",
                "failed",
                toErrorMessage(memoryError),
                {
                  updates: [],
                  errorCode: "MEMORY_UPDATE_FAILED",
                },
              ),
            );
          }
        }
        this.runtimeStore.failTaskTurn({
          request,
          taskId,
          message,
          sessionMode,
          ...(resolvedThreadId
            ? {
                structuredOutput: createAppServerStructuredOutput(
                  sessionId,
                  resolvedThreadId,
                  sessionMode,
                  sessionAccess,
                  request.options,
                  null,
                ),
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
      if (toolTraceFlushTimer) {
        clearTimeout(toolTraceFlushTimer);
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

  getManagedAgentControlPlaneStore(): ManagedAgentControlPlaneStore {
    return this.managedAgentControlPlaneStore;
  }

  getManagedAgentControlPlaneFacade(): ManagedAgentControlPlaneFacade {
    return this.managedAgentControlPlaneFacade;
  }

  getManagedAgentControlPlaneFacadeAsync(): ManagedAgentControlPlaneFacadeAsync {
    return this.managedAgentControlPlaneFacadeAsync;
  }

  getIdentityLinkService(): IdentityLinkService {
    return this.identityLinkService;
  }

  async readRuntimeConfig(): Promise<CodexRuntimeCatalog> {
    if (!this.runtimeCatalogReader) {
      throw new Error("App-server runtime catalog reader is not configured.");
    }

    const runtimeCatalog = await this.runtimeCatalogReader();
    const providerConfigs = readOpenAICompatibleProviderConfigs(this.workingDirectory, this.runtimeStore);

    return applyThemisGlobalDefaultsToRuntimeCatalog(
      createUnifiedRuntimeCatalog(runtimeCatalog, providerConfigs),
    );
  }

  getPrincipalPersonaService(): PrincipalPersonaService {
    return this.principalPersonaService;
  }

  private async buildTaskContext(
    executionWorkingDirectory: string,
    input: {
      request: TaskRequest;
      principalId: string | undefined;
      conversationId: string | undefined;
      signal: AbortSignal;
    },
  ) {
    const builder = this.createContextBuilder(executionWorkingDirectory);

    return builder.build({
      request: input.request,
      ...(input.principalId ? { principalId: input.principalId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      signal: input.signal,
    });
  }

  private readPrincipalTaskSettings(principalId?: string): PrincipalTaskSettings | null {
    const normalizedPrincipalId = normalizeTextValue(principalId);

    if (!normalizedPrincipalId) {
      return null;
    }

    return this.runtimeStore.getPrincipalTaskSettings(normalizedPrincipalId)?.settings ?? null;
  }

  getPrincipalActorsService(): PrincipalActorsService {
    return this.principalActorsService;
  }

  getPrincipalAssetsService(): PrincipalAssetsService {
    return this.principalAssetsService;
  }

  getPrincipalCadencesService(): PrincipalCadencesService {
    return this.principalCadencesService;
  }

  getPrincipalCommitmentsService(): PrincipalCommitmentsService {
    return this.principalCommitmentsService;
  }

  getPrincipalDecisionsService(): PrincipalDecisionsService {
    return this.principalDecisionsService;
  }

  getPrincipalRisksService(): PrincipalRisksService {
    return this.principalRisksService;
  }

  getPrincipalOperationEdgesService(): PrincipalOperationEdgesService {
    return this.principalOperationEdgesService;
  }

  getPrincipalOperationsBossViewService(): PrincipalOperationsBossViewService {
    return this.principalOperationsBossViewService;
  }

  getManagedAgentsService(): ManagedAgentsService {
    return this.managedAgentsService;
  }

  getManagedAgentNodeService(): ManagedAgentNodeService {
    return this.managedAgentNodeService;
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

  getPrincipalMcpService(): PrincipalMcpService {
    return this.principalMcpService;
  }

  getPrincipalPluginsService(): PrincipalPluginsService {
    return this.principalPluginsService;
  }

  getPluginService(): PluginService {
    return this.pluginService;
  }

  getScheduledTasksService(): ScheduledTasksService {
    return this.scheduledTasksService;
  }

  resetPrincipalState(principalId: string, resetAt: string) {
    this.principalSkillsService.removeAllSkills(principalId);
    return this.runtimeStore.resetPrincipalState(principalId, resetAt);
  }

  getPrincipalTaskSettings(principalId?: string): PrincipalTaskSettings | null {
    return this.readPrincipalTaskSettings(principalId);
  }

  savePrincipalTaskSettings(principalId: string, patch: PrincipalTaskSettings): PrincipalTaskSettings {
    const normalizedPrincipalId = normalizeTextValue(principalId);

    if (!normalizedPrincipalId) {
      throw new Error("Principal id is required.");
    }

    const principal = this.runtimeStore.getPrincipal(normalizedPrincipalId);

    if (!principal) {
      throw new Error("Principal does not exist.");
    }

    const now = new Date().toISOString();
    const existing = this.runtimeStore.getPrincipalTaskSettings(normalizedPrincipalId);
    const next = normalizePrincipalTaskSettings(patch);

    if (isPrincipalTaskSettingsEmpty(next)) {
      this.runtimeStore.deletePrincipalTaskSettings(normalizedPrincipalId);
      return {};
    }

    this.runtimeStore.savePrincipalTaskSettings({
      principalId: normalizedPrincipalId,
      settings: next,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    return next;
  }

  reloadProviderConfig(): void {
    // App-server runtime reads provider config from storage on demand.
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
    recordToolTrace?: (signal: AppServerToolTraceSignal) => void;
  }): Promise<void> {
    const autoApprovalResponse = resolveAutoApprovalServerRequestResponse(input.serverRequest);

    if (autoApprovalResponse !== undefined) {
      if (typeof input.session.respondToServerRequest === "function") {
        await abortable(
          () => input.session.respondToServerRequest!(input.serverRequest.id, autoApprovalResponse),
          input.signal,
        );
      }
      return;
    }

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

      const submittedAction = await submission;
      const response = await abortable(
        async () => resolvedAction.buildResponse(submittedAction, registeredAction),
        input.signal,
      );
      const submittedToolTrace = resolveSubmittedToolTraceSignal(input.serverRequest, submittedAction);

      if (submittedToolTrace) {
        input.recordToolTrace?.(submittedToolTrace);
      }

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

interface AppServerThreadCompactionState {
  targetThreadId: string;
  settled: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface AppServerTokenPressureSnapshot {
  inputTokens: number;
  contextWindow: number;
  ratio: number;
  observedAt: string;
}

interface AppServerExecutionDiagnostics {
  phase:
    | "initializing"
    | "waiting_for_model"
    | "tool_running"
    | "waiting_for_model_after_tool"
    | "context_compacting"
    | "context_recovered";
  lastTool: {
    toolKind: string;
    phase: AppServerToolTraceSignal["phase"];
    updatedAt: string;
  } | null;
  tokenPressure: AppServerTokenPressureSnapshot | null;
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

function normalizePrincipalKindValue(value: PrincipalKind | undefined): PrincipalKind | undefined {
  if (value === "human_user" || value === "managed_agent" || value === "system") {
    return value;
  }

  return undefined;
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

function resolveSubmittedToolTraceSignal(
  serverRequest: AppServerReverseRequest,
  submission: TaskPendingActionSubmitRequest,
): AppServerToolTraceSignal | null {
  const waitingTrace = translateAppServerToolSignal(serverRequest);

  if (!waitingTrace) {
    return null;
  }

  if (waitingTrace.phase === "waiting_input") {
    return {
      ...waitingTrace,
      phase: "started",
      summary: null,
    };
  }

  if (waitingTrace.phase !== "waiting_approval") {
    return null;
  }

  return {
    ...waitingTrace,
    phase: submission.decision === "deny" ? "interrupted" : "started",
    summary: null,
  };
}

function resolveServerRequestAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  switch (serverRequest.method) {
    case "mcpServer/elicitation/request":
      return resolveMcpElicitationAction(serverRequest);
    case "item/commandExecution/requestApproval":
      return resolveCommandApprovalAction(serverRequest);
    case "item/fileChange/requestApproval":
      return resolveFileChangeApprovalAction(serverRequest);
    case "item/permissions/requestApproval":
      return resolvePermissionsApprovalAction(serverRequest);
    case "item/tool/requestApproval":
      return resolveToolApprovalAction(serverRequest);
    case "execCommandApproval":
      return resolveExecCommandApprovalAction(serverRequest);
    case "applyPatchApproval":
      return resolveApplyPatchApprovalAction(serverRequest);
    case "item/tool/requestUserInput":
      return resolveUserInputAction(serverRequest);
    default:
      if (isGenericApprovalRequestMethod(serverRequest.method)) {
        return resolveGenericApprovalAction(serverRequest);
      }
      return null;
  }
}

function resolveAutoApprovalServerRequestResponse(serverRequest: AppServerReverseRequest): unknown | undefined {
  const toolName = resolveManagedAgentApprovalToolName(serverRequest);

  if (
    !isThemisManagedAgentToolName(toolName)
    && !isThemisScheduledTaskAutoApprovedToolName(toolName)
    && !isThemisOperationsToolName(toolName)
  ) {
    return undefined;
  }

  if (serverRequest.method === "mcpServer/elicitation/request") {
    return {
      action: "accept",
      content: {},
    };
  }

  return {
    decision: "accept",
  };
}

function resolveManagedAgentApprovalToolName(serverRequest: AppServerReverseRequest): string | null {
  const params = asRecord(serverRequest.params);

  if (serverRequest.method === "item/tool/requestApproval") {
    return normalizeTextValue(params?.toolName) ?? normalizeTextValue(params?.name);
  }

  if (serverRequest.method !== "mcpServer/elicitation/request") {
    return null;
  }

  return extractToolNameFromElicitationRequest(params);
}

function resolveMcpElicitationAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(serverRequest.id);

  if (!actionId) {
    return null;
  }

  const prompt = buildMcpElicitationPrompt(params, actionId);

  return createApprovalServerRequestAction(actionId, prompt, (submission) => ({
    action: submission.decision === "approve" ? "accept" : "decline",
    content: {},
  }));
}

function extractToolNameFromElicitationRequest(
  params: Record<string, unknown> | null | undefined,
): string | null {
  const candidates = [
    normalizeTextValue(params?._meta && asRecord(params._meta)?.tool_name),
    normalizeTextValue(params?.toolName),
    normalizeTextValue(params?.tool),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  const message = normalizeTextValue(params?.message);

  if (!message) {
    return null;
  }

  const matched = message.match(/tool\s+"([^"]+)"/i);
  return matched?.[1]?.trim() || null;
}

function buildMcpElicitationPrompt(
  params: Record<string, unknown> | null | undefined,
  actionId: string,
): string {
  const meta = asRecord(params?._meta);
  const toolTitle = normalizeTextValue(meta?.tool_title);
  const message = normalizeTextValue(params?.message);
  const serverName = normalizeTextValue(params?.serverName);
  const toolName = extractToolNameFromElicitationRequest(params);
  const detail = [
    toolName ? `工具：${toolName}` : null,
    toolTitle ? `标题：${toolTitle}` : null,
    serverName ? `MCP server：${serverName}` : null,
    message,
  ].filter((value): value is string => Boolean(value));

  return [
    detail.length ? `MCP 工具调用需要审批：\n${detail.join("\n")}` : "MCP 工具调用需要审批。",
    `使用 /approve ${actionId} 或 /deny ${actionId}`,
  ].join("\n");
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

function resolveToolApprovalAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(
    params?.approvalId,
    params?.callId,
    params?.itemId,
    serverRequest.id,
  );

  if (!actionId) {
    return null;
  }

  const prompt = buildGenericApprovalPrompt({
    label: "MCP 工具调用需要审批",
    params,
    actionId,
  });

  return createApprovalServerRequestAction(actionId, prompt, (submission) => ({
    decision: mapCommandStyleDecision(submission.decision, serverRequest.method),
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

function resolveGenericApprovalAction(serverRequest: AppServerReverseRequest): ResolvedServerRequestAction | null {
  const params = asRecord(serverRequest.params);
  const actionId = pickActionId(
    params?.approvalId,
    params?.callId,
    params?.itemId,
    serverRequest.id,
  );

  if (!actionId) {
    return null;
  }

  const prompt = buildGenericApprovalPrompt({
    label: "操作需要审批",
    params,
    actionId,
  });

  return createApprovalServerRequestAction(actionId, prompt, (submission) => ({
    decision: mapCommandStyleDecision(submission.decision, serverRequest.method),
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

function isGenericApprovalRequestMethod(method: string): boolean {
  return method.endsWith("/requestApproval");
}

function buildGenericApprovalPrompt(input: {
  label: string;
  params: Record<string, unknown> | null | undefined;
  actionId: string;
}): string {
  const detail = [
    normalizeTextValue(input.params?.reason),
    normalizeTextValue(input.params?.message),
    normalizeTextValue(input.params?.description),
    normalizeTextValue(input.params?.command),
    normalizeTextValue(input.params?.toolName),
    normalizeTextValue(input.params?.name),
  ].find((value): value is string => Boolean(value));

  return [
    detail ? `${input.label}：${detail}` : `${input.label}。`,
    `使用 /approve ${input.actionId} 或 /deny ${input.actionId}`,
  ].join("\n");
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

function resolveAppServerFinalOutput(
  artifacts: AppServerResponseArtifacts,
  onboardingIntercept: PrincipalPersonaOnboardingInterceptResult | null,
): string {
  return artifacts.finalAnswer || artifacts.latestAssistantMessage || onboardingIntercept?.message || "";
}

function summarizeAppServerResponse(finalResponse: string): string {
  const normalized = finalResponse.trim();

  if (!normalized) {
    return "Codex completed the task but did not return a final text response.";
  }

  const [firstLine] = normalized.split("\n");
  return firstLine ? firstLine.slice(0, 200) : normalized.slice(0, 200);
}

function createAppServerStructuredOutput(
  sessionId: string | undefined,
  threadId: string,
  sessionMode: "created" | "resumed" | "ephemeral",
  sessionAccess: AppServerResolvedSessionAccess,
  options: TaskRequest["options"] | undefined,
  onboardingIntercept: PrincipalPersonaOnboardingInterceptResult | null,
): Record<string, unknown> {
  const assistantStyle = buildAssistantStyleSessionPayload(options);

  return {
    session: {
      sessionId: sessionId || null,
      conversationId: sessionId || null,
      threadId,
      engine: "app-server",
      mode: sessionMode,
      accessMode: sessionAccess.accessMode,
      ...(sessionAccess.authAccountId ? { authAccountId: sessionAccess.authAccountId } : {}),
      ...(sessionAccess.thirdPartyProviderId ? { thirdPartyProviderId: sessionAccess.thirdPartyProviderId } : {}),
      ...(assistantStyle ? { assistantStyle } : {}),
    },
    ...(onboardingIntercept ? { personaOnboarding: createPersonaOnboardingPayload(onboardingIntercept) } : {}),
  };
}

function createAppServerSessionEventPayload(
  sessionId: string | undefined,
  threadId: string,
  sessionMode: "created" | "resumed" | "ephemeral",
  sessionAccess: AppServerResolvedSessionAccess,
): Record<string, unknown> {
  return {
    sessionMode,
    accessMode: sessionAccess.accessMode,
    threadId,
    sessionId: sessionId || null,
    conversationId: sessionId || null,
    runtimeEngine: "app-server",
    ...(sessionAccess.thirdPartyProviderId ? { thirdPartyProviderId: sessionAccess.thirdPartyProviderId } : {}),
  };
}

function createAppServerCompletionEvent(
  taskId: string,
  requestId: string,
  sessionId: string | undefined,
  threadId: string,
  sessionMode: "created" | "resumed" | "ephemeral",
  sessionAccess: AppServerResolvedSessionAccess,
  onboardingIntercept: PrincipalPersonaOnboardingInterceptResult | null,
): TaskEvent {
  const payload = {
    ...createAppServerSessionEventPayload(sessionId, threadId, sessionMode, sessionAccess),
    ...(onboardingIntercept ? { personaOnboarding: createPersonaOnboardingPayload(onboardingIntercept) } : {}),
  };

  if (!onboardingIntercept) {
    return createTaskEvent(taskId, requestId, "task.completed", "completed", "Codex task completed.", payload);
  }

  if (onboardingIntercept.status === "completed") {
    return createTaskEvent(taskId, requestId, "task.completed", "completed", "Persona bootstrap completed.", payload);
  }

  return createTaskEvent(
    taskId,
    requestId,
    "task.action_required",
    "waiting",
    "Persona bootstrap is waiting for the next answer.",
    payload,
  );
}

function createPersonaOnboardingPayload(
  onboardingIntercept: PrincipalPersonaOnboardingInterceptResult,
): Record<string, unknown> {
  return {
    status: onboardingIntercept.status,
    phase: onboardingIntercept.phase,
    stepIndex: onboardingIntercept.stepIndex,
    stepNumber: onboardingIntercept.status === "completed"
      ? onboardingIntercept.totalSteps
      : onboardingIntercept.stepIndex + 1,
    totalSteps: onboardingIntercept.totalSteps,
    ...(onboardingIntercept.questionKey ? { questionKey: onboardingIntercept.questionKey } : {}),
    ...(onboardingIntercept.questionPrompt ? { questionPrompt: onboardingIntercept.questionPrompt } : {}),
  };
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

function createAppServerExecutionDiagnostics(): AppServerExecutionDiagnostics {
  return {
    phase: "initializing",
    lastTool: null,
    tokenPressure: null,
  };
}

function observeAppServerToolTraceSignal(
  diagnostics: AppServerExecutionDiagnostics,
  toolSignal: AppServerToolTraceSignal,
  observedAt: string,
): void {
  diagnostics.lastTool = {
    toolKind: toolSignal.toolKind,
    phase: toolSignal.phase,
    updatedAt: observedAt,
  };

  if (toolSignal.phase === "completed" || toolSignal.phase === "failed" || toolSignal.phase === "interrupted") {
    diagnostics.phase = "waiting_for_model_after_tool";
    return;
  }

  diagnostics.phase = "tool_running";
}

function observeAppServerExecutionNotification(
  diagnostics: AppServerExecutionDiagnostics,
  notification: CodexAppServerNotification,
): void {
  const tokenPressure = readAppServerTokenPressure(notification);

  if (tokenPressure) {
    diagnostics.tokenPressure = tokenPressure;
  }

  if (notification.method !== "item/completed") {
    return;
  }

  const params = asRecord(notification.params);
  const item = asRecord(params?.item);
  const itemType = normalizeTextValue(item?.type);

  if (itemType === "contextCompaction") {
    diagnostics.phase = "context_compacting";
    return;
  }

  if (itemType === "agentMessage" && normalizeTextValue(item?.text)) {
    diagnostics.phase = "waiting_for_model";
  }
}

function readAppServerTokenPressure(notification: CodexAppServerNotification): AppServerTokenPressureSnapshot | null {
  const params = asRecord(notification.params);
  const payload = notification.method === "token_count"
    ? params
    : asRecord(params?.payload) ?? params;
  const info = asRecord(payload?.info) ?? payload;
  const usage = asRecord(info?.last_token_usage)
    ?? asRecord(info?.lastTokenUsage)
    ?? asRecord(info?.total_token_usage)
    ?? asRecord(info?.totalTokenUsage)
    ?? info;
  const inputTokens = readFiniteNumber(
    usage?.input_tokens,
    usage?.inputTokens,
    usage?.total_tokens,
    usage?.totalTokens,
  );
  const contextWindow = readFiniteNumber(
    info?.model_context_window,
    info?.modelContextWindow,
    payload?.model_context_window,
    payload?.modelContextWindow,
  );

  if (!inputTokens || !contextWindow || contextWindow <= 0) {
    return null;
  }

  return {
    inputTokens,
    contextWindow,
    ratio: inputTokens / contextWindow,
    observedAt: new Date().toISOString(),
  };
}

function isHighTokenPressure(snapshot: AppServerTokenPressureSnapshot | null): snapshot is AppServerTokenPressureSnapshot {
  return Boolean(snapshot && snapshot.ratio >= 0.9);
}

function readFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numberValue = typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

    if (Number.isFinite(numberValue) && numberValue > 0) {
      return numberValue;
    }
  }

  return null;
}

function createAppServerRuntimeDiagnosticsPayload(
  diagnostics: AppServerExecutionDiagnostics,
): Record<string, unknown> {
  return {
    phase: diagnostics.phase,
    ...(diagnostics.lastTool
      ? {
          lastTool: {
            toolKind: diagnostics.lastTool.toolKind,
            phase: diagnostics.lastTool.phase,
            updatedAt: diagnostics.lastTool.updatedAt,
          },
        }
      : {}),
    ...(diagnostics.tokenPressure
      ? {
          tokenPressure: {
            inputTokens: diagnostics.tokenPressure.inputTokens,
            contextWindow: diagnostics.tokenPressure.contextWindow,
            ratio: diagnostics.tokenPressure.ratio,
            observedAt: diagnostics.tokenPressure.observedAt,
          },
        }
      : {}),
  };
}

function createAppServerThreadCompactionState(targetThreadId = ""): AppServerThreadCompactionState {
  let resolve!: () => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    targetThreadId,
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

function observeAppServerThreadCompaction(
  notification: CodexAppServerNotification,
  state: AppServerThreadCompactionState,
): void {
  if (state.settled || !state.targetThreadId) {
    return;
  }

  const params = asRecord(notification.params);
  const threadId = normalizeTextValue(params?.threadId);

  if (threadId !== state.targetThreadId) {
    return;
  }

  if (notification.method === "thread/compacted") {
    state.settled = true;
    state.resolve();
    return;
  }

  if (notification.method === "item/completed") {
    const item = asRecord(params?.item);

    if (normalizeTextValue(item?.type) !== "contextCompaction") {
      return;
    }

    state.settled = true;
    state.resolve();
    return;
  }

  if (notification.method === "turn/completed") {
    const turn = asRecord(params?.turn);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    const hasContextCompaction = items
      .map((item) => asRecord(item))
      .some((item) => normalizeTextValue(item?.type) === "contextCompaction");

    if (!hasContextCompaction) {
      return;
    }

    const status = normalizeTextValue(turn?.status);

    if (status === "completed") {
      state.settled = true;
      state.resolve();
      return;
    }

    const errorRecord = asRecord(turn?.error);
    state.settled = true;
    state.reject(new Error(normalizeTextValue(errorRecord?.message) ?? "Codex context compaction failed."));
    return;
  }

  if (notification.method === "error") {
    const errorRecord = asRecord(params?.error);
    state.settled = true;
    state.reject(new Error(normalizeTextValue(errorRecord?.message) ?? "Codex context compaction failed."));
  }
}

function createExecutionSignal(
  externalSignal?: AbortSignal,
  timeoutMs?: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
  touch: () => void;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  const armTimeout = (): void => {
    if (!timeoutMs || timeoutMs <= 0 || controller.signal.aborted) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      controller.abort(new Error(`TASK_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);
  };

  armTimeout();
  cleanups.push(() => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  return {
    signal: controller.signal,
    touch: () => {
      armTimeout();
    },
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

function describeAbort(
  signal: AbortSignal,
  error?: unknown,
  diagnostics?: AppServerExecutionDiagnostics,
): string {
  if (isAppServerTurnCancelledError(error)) {
    return error.message || "任务已被取消。";
  }

  const reason = signal.reason;

  if (reason instanceof Error) {
    if (reason.message.startsWith("TASK_TIMEOUT:")) {
      const timeout = reason.message.split(":")[1] ?? "0";
      const seconds = Math.max(1, Math.round(Number.parseInt(timeout, 10) / 1000));
      return describeTaskTimeout(seconds, diagnostics);
    }

    if (reason.message === "WORK_ITEM_CANCELLED") {
      return "顶层治理已取消该任务。";
    }
  }

  return "任务已被取消。";
}

function describeTaskTimeout(seconds: number, diagnostics?: AppServerExecutionDiagnostics): string {
  const tokenPressureSuffix = isHighTokenPressure(diagnostics?.tokenPressure ?? null)
    ? "检测到上下文接近上限，这不是业务命令仍在运行。"
    : "";

  if (diagnostics?.phase === "context_compacting" || diagnostics?.phase === "context_recovered") {
    return joinTimeoutMessage(
      `Codex 原生上下文压缩/压缩后续写阶段超过 ${seconds} 秒未返回，任务被取消。`,
      tokenPressureSuffix,
    );
  }

  if (
    diagnostics?.phase === "waiting_for_model_after_tool"
    && diagnostics.lastTool
    && ["completed", "failed", "interrupted"].includes(diagnostics.lastTool.phase)
  ) {
    return joinTimeoutMessage(
      `工具已完成，但模型续写/上下文压缩阶段超过 ${seconds} 秒未返回，任务被取消。`,
      tokenPressureSuffix,
    );
  }

  if (diagnostics?.phase === "tool_running") {
    return `任务因超时被取消：最近仍处于工具执行阶段，超时时间约为 ${seconds} 秒。`;
  }

  return `任务因超时被取消，超时时间约为 ${seconds} 秒。`;
}

function joinTimeoutMessage(primary: string, suffix: string): string {
  return suffix ? `${primary}${suffix}` : primary;
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
  onActivity?: () => void,
): {
  enqueue: (event: TaskEvent) => void;
  deliver: (event: TaskEvent) => Promise<void>;
  flush: () => Promise<void>;
} {
  let chain = Promise.resolve();
  let failure: unknown = null;

  const schedule = (event: TaskEvent): Promise<void> => {
    const next = chain.then(async () => {
      onActivity?.();
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

function isAppServerContextWindowExhaustedError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("ran out of room in the model's context window")
    || message.includes("context window")
    || message.includes("maximum context length")
    || message.includes("context_length_exceeded");
}

function resolveAppServerThreadId(
  runtimeStore: SqliteCodexSessionRegistry,
  sessionId: string,
): string | null {
  const reference = resolveStoredSessionThreadReference(runtimeStore, sessionId);
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
  const config = createAppServerThreadConfig(request);

  return {
    cwd,
    experimentalRawEvents: true,
    persistExtendedHistory: true,
    ...(model ? { model } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(sandboxMode ? { sandbox: sandboxMode } : {}),
    ...(config ? { config } : {}),
  };
}

function createAppServerThreadConfig(request: TaskRequest): CodexCliConfigOverrides | undefined {
  const reasoning = normalizeTextValue(request.options?.reasoning);
  const webSearchMode = normalizeTextValue(request.options?.webSearchMode);
  const networkAccessEnabled = request.options?.networkAccessEnabled;
  const additionalDirectories = Array.isArray(request.options?.additionalDirectories)
    ? request.options.additionalDirectories
      .map((value) => normalizeTextValue(value))
      .filter((value): value is string => Boolean(value))
    : [];
  const sandboxWorkspaceWrite: {
    network_access?: boolean;
    writable_roots?: string[];
  } = {};
  const hasThreadConfigOverrides = Boolean(reasoning)
    || Boolean(webSearchMode)
    || typeof networkAccessEnabled === "boolean"
    || additionalDirectories.length > 0;
  const config: CodexCliConfigOverrides = hasThreadConfigOverrides
    ? { ...APP_SERVER_TASK_CONFIG_OVERRIDES }
    : {};

  if (reasoning) {
    config.model_reasoning_effort = reasoning;
  }

  if (webSearchMode) {
    config.web_search = webSearchMode;
  }

  if (typeof networkAccessEnabled === "boolean") {
    sandboxWorkspaceWrite.network_access = networkAccessEnabled;
  }

  if (additionalDirectories.length > 0) {
    sandboxWorkspaceWrite.writable_roots = additionalDirectories;
  }

  if (sandboxWorkspaceWrite.network_access !== undefined || sandboxWorkspaceWrite.writable_roots?.length) {
    config.sandbox_workspace_write = sandboxWorkspaceWrite;
  }

  return Object.keys(config).length > 0 ? config : undefined;
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

function withThemisScheduledTaskMcpSessionOptions(
  base: AppServerSessionFactoryOptions,
  workingDirectory: string,
  request: TaskRequest,
): AppServerSessionFactoryOptions {
  const internalMcpOverrides = buildThemisScheduledTaskMcpConfigOverrides(workingDirectory, request);

  if (!Object.keys(internalMcpOverrides).length) {
    return base;
  }

  return {
    ...base,
    configOverrides: {
      ...(base.configOverrides ?? {}),
      ...internalMcpOverrides,
    },
  };
}

function withPrincipalMcpSessionOptions(
  base: AppServerSessionFactoryOptions,
  principalId: string | undefined,
  principalMcpService: PrincipalMcpService,
): AppServerSessionFactoryOptions {
  const normalizedPrincipalId = normalizeTextValue(principalId);

  if (!normalizedPrincipalId) {
    return base;
  }

  const principalMcpOverrides = principalMcpService.buildRuntimeConfigOverrides(normalizedPrincipalId);

  if (!Object.keys(principalMcpOverrides).length) {
    return base;
  }

  return {
    ...base,
    configOverrides: {
      ...(base.configOverrides ?? {}),
      ...principalMcpOverrides,
    },
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
