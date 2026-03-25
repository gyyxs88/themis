import {
  Codex,
  type ApprovalMode,
  type CodexOptions,
  type ModelReasoningEffort,
  type SandboxMode,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type WebSearchMode,
} from "@openai/codex-sdk";
import {
  readCodexRuntimeCatalog,
  type CodexRuntimeCatalog,
  type CodexRuntimeModel,
  type CodexRuntimeThirdPartyProvider,
} from "./codex-app-server.js";
import {
  buildCodexProcessEnv,
  createCodexAuthStorageConfigOverrides,
  ensureAuthAccountBootstrap,
  ensureAuthAccountCodexHome,
} from "./auth-accounts.js";
import { buildAssistantStyleSessionPayload } from "./assistant-style.js";
import { ConversationService } from "./conversation-service.js";
import { IdentityLinkService } from "./identity-link-service.js";
import { buildBootstrapPrompt, buildTaskPrompt } from "./prompt.js";
import {
  PrincipalPersonaService,
  type PrincipalPersonaOnboardingInterceptResult,
} from "./principal-persona-service.js";
import { buildForkContextFromThread, type CodexForkContext } from "./codex-session-fork.js";
import {
  CodexThreadSessionStore,
  type CodexSessionLease,
  type CodexSessionMode,
} from "./codex-session-store.js";
import { SqliteCodexSessionRegistry, type StoredAuthAccountRecord } from "../storage/index.js";
import type { TaskAccessMode, TaskEvent, TaskRequest, TaskResult } from "../types/index.js";
import {
  readOpenAICompatibleProviderConfigs,
  type OpenAICompatibleProviderConfig,
} from "./openai-compatible-provider.js";

export interface CodexTaskRuntimeOptions {
  codex?: Codex;
  providerCodex?: Codex;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  sessionStore?: CodexThreadSessionStore;
  providerSessionStore?: CodexThreadSessionStore;
  runtimeStore?: SqliteCodexSessionRegistry;
  providerConfigs?: OpenAICompatibleProviderConfig[] | null;
  providerConfig?: OpenAICompatibleProviderConfig | null;
}

interface ResolvedRuntimeTarget {
  accessMode: TaskAccessMode;
  authAccountId: string | null;
  providerId: string | null;
  providerConfig: OpenAICompatibleProviderConfig | null;
  sessionStore: CodexThreadSessionStore;
}

export interface CodexTaskRuntimeHooks {
  onEvent?: (event: TaskEvent) => Promise<void> | void;
  signal?: AbortSignal;
  timeoutMs?: number;
  allowUnsupportedThirdPartyModel?: boolean;
  finalizeResult?: (request: TaskRequest, result: TaskResult) => Promise<TaskResult> | TaskResult;
}

export class CodexTaskRuntime {
  private readonly workingDirectory: string;
  private readonly skipGitRepoCheck: boolean;
  private readonly runtimeStore: SqliteCodexSessionRegistry;
  private readonly identityLinkService: IdentityLinkService;
  private readonly conversationService: ConversationService;
  private readonly principalPersonaService: PrincipalPersonaService;
  private providerConfigs: OpenAICompatibleProviderConfig[];
  private readonly authClients = new Map<string, Codex>();
  private readonly authSessionStores = new Map<string, CodexThreadSessionStore>();
  private readonly providerClients = new Map<string, Codex>();
  private readonly providerSessionStores = new Map<string, CodexThreadSessionStore>();

  constructor(options: CodexTaskRuntimeOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.skipGitRepoCheck = options.skipGitRepoCheck ?? false;
    this.runtimeStore = options.runtimeStore
      ?? options.sessionStore?.getSessionRegistry()
      ?? options.providerSessionStore?.getSessionRegistry()
      ?? new SqliteCodexSessionRegistry();
    this.identityLinkService = new IdentityLinkService(this.runtimeStore);
    this.conversationService = new ConversationService(this.runtimeStore, this.identityLinkService);
    this.principalPersonaService = new PrincipalPersonaService(this.runtimeStore);
    this.providerConfigs = options.providerConfigs
      ?? (options.providerConfig
        ? [options.providerConfig]
        : readOpenAICompatibleProviderConfigs(this.workingDirectory, this.runtimeStore));
    ensureAuthAccountBootstrap(this.workingDirectory, this.runtimeStore);
    this.resetAuthRuntime(options.codex ?? null, options.sessionStore ?? null);
    this.resetProviderRuntime(options.providerCodex ?? null, options.providerSessionStore ?? null);
  }

  async runTask(request: TaskRequest, hooks: CodexTaskRuntimeHooks = {}): Promise<TaskResult> {
    const resolvedRequest = this.conversationService.resolveRequest(request);
    request = resolvedRequest.request;
    const principalId = resolvedRequest.principalId;
    const onboardingIntercept = principalId && this.principalPersonaService.shouldRunOnboarding(request, principalId)
      ? this.principalPersonaService.maybeHandleOnboardingTurn(principalId, request)
      : null;

    const taskId = request.taskId ?? createId("task");
    const emit = async (event: TaskEvent): Promise<void> => {
      this.runtimeStore.appendTaskEvent(event);
      await hooks.onEvent?.(event);
    };
    const { signal, cleanup } = createExecutionSignal(hooks.signal, hooks.timeoutMs);
    let sessionLease: CodexSessionLease | null = null;
    let failureMessage: string | null = null;

    try {
      this.runtimeStore.upsertTurnFromRequest(request, taskId);
      await emit(createTaskEvent(taskId, request.requestId, "task.received", "queued", "Themis accepted the web request."));

      const target = this.resolveRuntimeTarget(request, hooks.allowUnsupportedThirdPartyModel === true);
      const threadOptions = buildThreadOptions(
        request,
        this.workingDirectory,
        this.skipGitRepoCheck,
        target.accessMode,
        target.providerConfig,
      );
      sessionLease = await target.sessionStore.acquire(request, threadOptions);
      const thread = sessionLease.thread;
      const personalizedProfileContext = this.principalPersonaService.buildPromptContext(principalId);
      const prompt = onboardingIntercept
        ? buildBootstrapPrompt(request, onboardingIntercept, {
          personalizedProfileContext,
        })
        : buildTaskPrompt(request, {
          personalizedProfileContext,
        });
      const touchedFiles = new Set<string>();
      let finalResponse = "";

      throwIfAborted(signal);

      await emit(
        createTaskEvent(
          taskId,
          request.requestId,
          "task.progress",
          "running",
          describeSessionMode(sessionLease, target),
          createSessionPayload(sessionLease, target),
        ),
      );

      await emit(
        createTaskEvent(
          taskId,
          request.requestId,
          "task.started",
          "running",
          onboardingIntercept ? "Persona bootstrap turn started." : "Codex task started.",
        ),
      );

      const { events } = await thread.runStreamed(prompt, { signal });

      for await (const sdkEvent of events) {
        throwIfAborted(signal);
        const translated = translateThreadEvent(taskId, request.requestId, sdkEvent);

        if (translated) {
          await emit(translated);
        }

        collectThreadArtifacts(sdkEvent, touchedFiles, (response) => {
          finalResponse = response;
        });

        if (sdkEvent.type === "turn.failed") {
          failureMessage = sdkEvent.error.message;
        }

        if (sdkEvent.type === "error") {
          failureMessage = sdkEvent.message;
        }
      }

      if (failureMessage) {
        await emit(createTaskEvent(taskId, request.requestId, "task.failed", "failed", failureMessage));
        throw new Error(failureMessage);
      }

      const output = resolveFinalOutput(finalResponse, onboardingIntercept);
      const summary = summarizeResponse(output);
      const touched = [...touchedFiles];
      const resolvedThreadId = thread.id ?? sessionLease.threadId ?? undefined;
      const result: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "completed",
        summary,
        ...(output ? { output } : {}),
        ...(touched.length ? { touchedFiles: touched } : {}),
        structuredOutput: createStructuredOutput(
          sessionLease,
          target,
          request.options,
          resolvedThreadId,
          onboardingIntercept,
        ),
        completedAt: new Date().toISOString(),
      };

      const finalizedResult = await finalizeTaskResult(request, result, hooks.finalizeResult);

      this.runtimeStore.completeTaskTurn({
        request,
        result: finalizedResult,
        ...resolveSessionPersistence(sessionLease, resolvedThreadId),
      });

      await emit(
        createCompletionEvent(
          taskId,
          request.requestId,
          sessionLease,
          target,
          resolvedThreadId,
          touched,
          onboardingIntercept,
        ),
      );

      return finalizedResult;
    } catch (error) {
      if (isAbortLikeError(error) || signal.aborted) {
        const message = describeAbort(signal);
        const result: TaskResult = {
          taskId,
          requestId: request.requestId,
          status: "cancelled",
          summary: message,
          completedAt: new Date().toISOString(),
        };

        this.runtimeStore.completeTaskTurn({
          request,
          result,
          ...resolveSessionPersistence(sessionLease),
        });
        await emit(createTaskEvent(taskId, request.requestId, "task.cancelled", "cancelled", message));

        return result;
      }

      this.runtimeStore.failTaskTurn({
        request,
        taskId,
        message: toErrorMessage(resolveTaskFailure(error, failureMessage)),
        ...resolveSessionPersistence(sessionLease),
      });

      throw resolveTaskFailure(error, failureMessage);
    } finally {
      await sessionLease?.release(sessionLease.thread.id ?? sessionLease.threadId ?? null);
      cleanup();
    }
  }

  async createForkContext(sessionId: string, threadId?: string): Promise<CodexForkContext | null> {
    const resolvedThreadId = threadId?.trim() || (await this.resolveThreadIdForFork(sessionId));

    if (!resolvedThreadId) {
      return null;
    }

    return buildForkContextFromThread(resolvedThreadId);
  }

  async readRuntimeConfig(): Promise<CodexRuntimeCatalog> {
    const authAccount = this.resolveAuthAccount();
    const runtimeCatalog = await readCodexRuntimeCatalog(this.workingDirectory, {
      env: buildCodexProcessEnv(authAccount.codexHome),
      configOverrides: createCodexAuthStorageConfigOverrides(),
    });
    return createUnifiedRuntimeCatalog(runtimeCatalog, this.providerConfigs);
  }

  getRuntimeStore(): SqliteCodexSessionRegistry {
    return this.runtimeStore;
  }

  getIdentityLinkService(): IdentityLinkService {
    return this.identityLinkService;
  }

  getPrincipalPersonaService(): PrincipalPersonaService {
    return this.principalPersonaService;
  }

  reloadProviderConfig(): void {
    this.providerConfigs = readOpenAICompatibleProviderConfigs(this.workingDirectory, this.runtimeStore);
    this.resetProviderRuntime();
  }

  private resolveRuntimeTarget(request: TaskRequest, allowUnsupportedThirdPartyModel = false): ResolvedRuntimeTarget {
    const requestedMode = request.options?.accessMode === "third-party" ? "third-party" : "auth";

    if (requestedMode !== "third-party") {
      const account = this.resolveAuthAccount(request.options?.authAccountId);
      const sessionStore = this.ensureAuthAccountRuntime(account);
      return {
        accessMode: "auth",
        authAccountId: account.accountId,
        providerId: null,
        providerConfig: null,
        sessionStore,
      };
    }

    if (!this.providerConfigs.length) {
      throw new Error("当前没有可用的第三方兼容接入配置。");
    }

    const requestedProviderId = normalizeOptionalText(request.options?.thirdPartyProviderId);
    const providerConfig = requestedProviderId
      ? this.providerConfigs.find((entry) => entry.id === requestedProviderId) ?? null
      : this.providerConfigs[0] ?? null;

    if (!providerConfig) {
      throw new Error(`当前第三方供应商 ${requestedProviderId} 不可用。`);
    }

    const providerSessionStore = this.providerSessionStores.get(providerConfig.id);

    if (!providerSessionStore) {
      throw new Error(`第三方供应商 ${providerConfig.id} 的运行时还没有准备好。`);
    }

    if (!allowUnsupportedThirdPartyModel) {
      this.assertThirdPartyModelSupported(request, providerConfig);
    }

    return {
      accessMode: "third-party",
      authAccountId: null,
      providerId: providerConfig.id,
      providerConfig,
      sessionStore: providerSessionStore,
    };
  }

  private async resolveThreadIdForFork(sessionId: string): Promise<string | null> {
    for (const authSessionStore of this.authSessionStores.values()) {
      const authThreadId = await authSessionStore.resolveThreadId(sessionId);

      if (authThreadId) {
        return authThreadId;
      }
    }

    for (const providerSessionStore of this.providerSessionStores.values()) {
      const providerThreadId = await providerSessionStore.resolveThreadId(sessionId);

      if (providerThreadId) {
        return providerThreadId;
      }
    }

    return null;
  }

  private assertThirdPartyModelSupported(
    request: TaskRequest,
    providerConfig: OpenAICompatibleProviderConfig,
  ): void {
    const requestedModel = normalizeOptionalText(request.options?.model) || providerConfig.defaultModel || "";

    if (!requestedModel) {
      throw new Error("当前第三方供应商没有可用模型，请先在设置里添加模型。");
    }

    const configuredModel = providerConfig.models.find((entry) => entry.model === requestedModel);
    const capabilities = configuredModel?.profile?.capabilities;
    const supportsCodexTasks = capabilities?.supportsCodexTasks;

    if (supportsCodexTasks === false) {
      throw new Error("当前第三方模型未声明支持 Codex agent 任务，已阻止发送。请在设置中更换模型，或把该模型的 Codex 任务能力明确标记为可用后再试。");
    }

    const webSearchMode = request.options?.webSearchMode;

    if (webSearchMode && webSearchMode !== "disabled" && capabilities?.supportsSearchTool !== true) {
      throw new Error("当前第三方模型未声明支持 search tool，已阻止发送。请先把联网搜索改成 disabled，或更换为明确支持该能力的模型。");
    }

    const hasImageAttachment = request.attachments?.some((attachment) => attachment.type === "image") ?? false;

    if (hasImageAttachment && capabilities?.imageInput !== true) {
      throw new Error("当前第三方模型未声明支持图片输入，已阻止发送。请先移除图片附件，或更换为明确支持该能力的模型。");
    }
  }

  private resetProviderRuntime(
    providerCodexOverride: Codex | null = null,
    providerSessionStoreOverride: CodexThreadSessionStore | null = null,
  ): void {
    this.providerClients.clear();
    this.providerSessionStores.clear();

    for (const [index, providerConfig] of this.providerConfigs.entries()) {
      const providerCodex = index === 0 && providerCodexOverride
        ? providerCodexOverride
        : createCodexClient(providerConfig);
      const providerSessionStore = index === 0 && providerSessionStoreOverride
        ? providerSessionStoreOverride
        : new CodexThreadSessionStore({
          codex: providerCodex,
          sessionRegistry: this.runtimeStore,
          sessionIdNamespace: `third-party:${providerConfig.id}`,
        });

      this.providerClients.set(providerConfig.id, providerCodex);
      this.providerSessionStores.set(providerConfig.id, providerSessionStore);
    }
  }

  private resetAuthRuntime(
    authCodexOverride: Codex | null = null,
    authSessionStoreOverride: CodexThreadSessionStore | null = null,
  ): void {
    this.authClients.clear();
    this.authSessionStores.clear();

    for (const [index, account] of this.listAuthAccounts().entries()) {
      const authCodex = index === 0 && authCodexOverride
        ? authCodexOverride
        : createAuthCodexClient(this.workingDirectory, account);
      const authSessionStore = index === 0 && authSessionStoreOverride
        ? authSessionStoreOverride
        : new CodexThreadSessionStore({
          codex: authCodex,
          sessionRegistry: this.runtimeStore,
          sessionIdNamespace: `auth:${account.accountId}`,
        });

      this.authClients.set(account.accountId, authCodex);
      this.authSessionStores.set(account.accountId, authSessionStore);
    }
  }

  private ensureAuthAccountRuntime(account: StoredAuthAccountRecord): CodexThreadSessionStore {
    const existing = this.authSessionStores.get(account.accountId);

    if (existing) {
      return existing;
    }

    const authCodex = createAuthCodexClient(this.workingDirectory, account);
    const authSessionStore = new CodexThreadSessionStore({
      codex: authCodex,
      sessionRegistry: this.runtimeStore,
      sessionIdNamespace: `auth:${account.accountId}`,
    });

    this.authClients.set(account.accountId, authCodex);
    this.authSessionStores.set(account.accountId, authSessionStore);
    return authSessionStore;
  }

  private listAuthAccounts(): StoredAuthAccountRecord[] {
    ensureAuthAccountBootstrap(this.workingDirectory, this.runtimeStore);
    return this.runtimeStore.listAuthAccounts();
  }

  private resolveAuthAccount(accountId?: string): StoredAuthAccountRecord {
    ensureAuthAccountBootstrap(this.workingDirectory, this.runtimeStore);

    if (typeof accountId === "string" && accountId.trim()) {
      const explicit = this.runtimeStore.getAuthAccount(accountId.trim());

      if (!explicit) {
        throw new Error(`认证账号 ${accountId.trim()} 不存在。`);
      }

      return explicit;
    }

    const active = this.runtimeStore.getActiveAuthAccount();

    if (active) {
      return active;
    }

    return ensureAuthAccountBootstrap(this.workingDirectory, this.runtimeStore);
  }
}

function resolveFinalOutput(
  finalResponse: string,
  onboardingIntercept: PrincipalPersonaOnboardingInterceptResult | null,
): string {
  const normalized = finalResponse.trim();

  if (normalized) {
    return normalized;
  }

  return onboardingIntercept?.message ?? "";
}

function createStructuredOutput(
  sessionLease: CodexSessionLease,
  target: ResolvedRuntimeTarget,
  options: TaskRequest["options"] | undefined,
  resolvedThreadId: string | undefined,
  onboardingIntercept: PrincipalPersonaOnboardingInterceptResult | null,
): Record<string, unknown> {
  const assistantStyle = buildAssistantStyleSessionPayload(options);

  return {
    session: {
      ...(sessionLease.sessionId ? { sessionId: sessionLease.sessionId } : {}),
      ...(sessionLease.sessionId ? { conversationId: sessionLease.sessionId } : {}),
      ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
      mode: sessionLease.sessionMode,
      accessMode: target.accessMode,
      ...(target.authAccountId ? { authAccountId: target.authAccountId } : {}),
      ...(target.providerId ? { thirdPartyProviderId: target.providerId } : {}),
      ...(assistantStyle ? { assistantStyle } : {}),
    },
    ...(onboardingIntercept ? { personaOnboarding: createPersonaOnboardingPayload(onboardingIntercept) } : {}),
  };
}

function createCompletionEvent(
  taskId: string,
  requestId: string,
  sessionLease: CodexSessionLease,
  target: ResolvedRuntimeTarget,
  resolvedThreadId: string | undefined,
  touchedFiles: string[],
  onboardingIntercept: PrincipalPersonaOnboardingInterceptResult | null,
): TaskEvent {
  const payload = {
    ...(touchedFiles.length ? { touchedFiles } : {}),
    ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
    ...createSessionPayload(sessionLease, target, resolvedThreadId),
    ...(onboardingIntercept ? { personaOnboarding: createPersonaOnboardingPayload(onboardingIntercept) } : {}),
  };

  if (!onboardingIntercept) {
    return createTaskEvent(taskId, requestId, "task.completed", "completed", "Codex task completed.", payload);
  }

  if (onboardingIntercept.status === "completed") {
    return createTaskEvent(taskId, requestId, "task.completed", "completed", "Persona bootstrap completed.", payload);
  }

  return createTaskEvent(taskId, requestId, "task.action_required", "waiting", "Persona bootstrap is waiting for the next answer.", payload);
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

function resolveSessionPersistence(
  sessionLease: CodexSessionLease | null,
  resolvedThreadId?: string,
): {
  sessionMode?: string;
  threadId?: string;
} {
  if (!sessionLease) {
    return {};
  }

  const threadId = normalizeOptionalText(resolvedThreadId ?? sessionLease.thread.id ?? sessionLease.threadId);

  return {
    ...(sessionLease.sessionMode ? { sessionMode: sessionLease.sessionMode } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

async function finalizeTaskResult(
  request: TaskRequest,
  result: TaskResult,
  finalizeResult: CodexTaskRuntimeHooks["finalizeResult"],
): Promise<TaskResult> {
  if (!finalizeResult) {
    return result;
  }

  try {
    return await finalizeResult(request, result);
  } catch {
    return result;
  }
}

function resolveTaskFailure(error: unknown, failureMessage: string | null): unknown {
  if (!failureMessage) {
    return error;
  }

  const normalizedFailure = failureMessage.trim();

  if (!normalizedFailure) {
    return error;
  }

  const currentMessage = toErrorMessage(error).trim();

  if (currentMessage === normalizedFailure) {
    return error;
  }

  return new Error(normalizedFailure);
}

function buildThreadOptions(
  request: TaskRequest,
  workingDirectory: string,
  skipGitRepoCheck: boolean,
  accessMode: TaskAccessMode,
  providerConfig: OpenAICompatibleProviderConfig | null,
): ThreadOptions {
  return {
    workingDirectory,
    skipGitRepoCheck,
    ...(request.options?.model
      ? { model: request.options.model }
      : accessMode === "third-party" && providerConfig?.defaultModel
        ? { model: providerConfig.defaultModel }
        : {}),
    ...(request.options?.reasoning
      ? { modelReasoningEffort: request.options.reasoning as ModelReasoningEffort }
      : {}),
    ...(request.options?.sandboxMode ? { sandboxMode: request.options.sandboxMode as SandboxMode } : {}),
    ...(request.options?.webSearchMode ? { webSearchMode: request.options.webSearchMode as WebSearchMode } : {}),
    ...(typeof request.options?.networkAccessEnabled === "boolean"
      ? { networkAccessEnabled: request.options.networkAccessEnabled }
      : {}),
    ...(request.options?.approvalPolicy
      ? { approvalPolicy: request.options.approvalPolicy as ApprovalMode }
      : { approvalPolicy: defaultApprovalPolicy() }),
    ...(request.options?.additionalDirectories?.length
      ? { additionalDirectories: request.options.additionalDirectories }
      : {}),
  };
}

function defaultApprovalPolicy(): ApprovalMode {
  return "untrusted";
}

function createCodexClient(providerConfig: OpenAICompatibleProviderConfig | null): Codex {
  if (!providerConfig) {
    return new Codex();
  }

  const env = createCodexProviderEnv(providerConfig);
  const config = createCodexProviderOverrides(providerConfig);

  return new Codex({
    env,
    config,
  });
}

function createUnifiedRuntimeCatalog(
  runtimeCatalog: CodexRuntimeCatalog,
  providerConfigs: OpenAICompatibleProviderConfig[],
): CodexRuntimeCatalog {
  const hasThirdPartyAccessMode = runtimeCatalog.accessModes.some((mode) => mode.id === "third-party");
  const accessModes = !providerConfigs.length || hasThirdPartyAccessMode
    ? runtimeCatalog.accessModes
    : [
      ...runtimeCatalog.accessModes,
      {
        id: "third-party",
        label: "第三方",
        description: "通过 OpenAI 兼容供应商运行任务。",
      } satisfies CodexRuntimeCatalog["accessModes"][number],
    ];

  return {
    ...runtimeCatalog,
    accessModes,
    thirdPartyProviders: [
      ...providerConfigs.map((providerConfig) => createThirdPartyProviderCatalog(providerConfig)),
      ...runtimeCatalog.thirdPartyProviders.filter(
        (provider) => !providerConfigs.some((entry) => entry.id === provider.id),
      ),
    ],
  };
}

function createAuthCodexClient(workingDirectory: string, account: StoredAuthAccountRecord): Codex {
  ensureAuthAccountCodexHome(workingDirectory, account.codexHome);

  return new Codex({
    env: buildCodexProcessEnv(account.codexHome),
    config: createCodexAuthStorageConfigOverrides(),
  });
}

function createThirdPartyProviderCatalog(
  providerConfig: OpenAICompatibleProviderConfig,
): CodexRuntimeThirdPartyProvider {
  const models = createProviderRuntimeModels(providerConfig);

  return {
    id: providerConfig.id,
    type: "openai-compatible",
    name: providerConfig.name,
    baseUrl: providerConfig.baseUrl,
    endpointCandidates: [...providerConfig.endpointCandidates],
    source: providerConfig.source,
    wireApi: providerConfig.wireApi,
    supportsWebsockets: providerConfig.supportsWebsockets,
    lockedModel: providerConfig.source === "env",
    defaultModel: providerConfig.defaultModel,
    models,
  };
}

function createProviderRuntimeModels(providerConfig: OpenAICompatibleProviderConfig): CodexRuntimeModel[] {
  return providerConfig.models.map((entry) => createProviderRuntimeModel(entry, providerConfig));
}

function createProviderRuntimeModel(
  providerModel: OpenAICompatibleProviderConfig["models"][number],
  providerConfig: OpenAICompatibleProviderConfig,
): CodexRuntimeModel {
  const modelProfile = providerModel.profile;
  const defaultReasoning = modelProfile?.defaultReasoningLevel || "medium";
  const supportedReasoningLevels = modelProfile?.supportedReasoningLevels?.length
    ? modelProfile.supportedReasoningLevels
    : ["low", "medium", "high", "xhigh"];

  return {
    id: providerModel.model,
    model: providerModel.model,
    displayName: modelProfile?.displayName || providerModel.model,
    description: modelProfile?.description || `${providerConfig.name} 提供的兼容模型。`,
    hidden: false,
    supportedReasoningEfforts: supportedReasoningLevels.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort: defaultReasoning,
    contextWindow: modelProfile?.contextWindow ?? null,
    capabilities: {
      textInput: modelProfile?.capabilities.textInput ?? true,
      imageInput: modelProfile?.capabilities.imageInput ?? false,
      supportsCodexTasks: modelProfile?.capabilities.supportsCodexTasks ?? true,
      supportsReasoningSummaries: modelProfile?.capabilities.supportsReasoningSummaries ?? false,
      supportsVerbosity: modelProfile?.capabilities.supportsVerbosity ?? false,
      supportsParallelToolCalls: modelProfile?.capabilities.supportsParallelToolCalls ?? false,
      supportsSearchTool: modelProfile?.capabilities.supportsSearchTool ?? false,
      supportsImageDetailOriginal: modelProfile?.capabilities.supportsImageDetailOriginal ?? false,
    },
    supportsPersonality: false,
    supportsCodexTasks: modelProfile?.capabilities.supportsCodexTasks ?? true,
    isDefault: providerModel.model === providerConfig.defaultModel,
  };
}

function createTaskEvent(
  taskId: string,
  requestId: string,
  type: TaskEvent["type"],
  status: TaskEvent["status"],
  message: string,
  payload?: Record<string, unknown>,
): TaskEvent {
  return {
    eventId: createId("event"),
    taskId,
    requestId,
    type,
    status,
    message,
    ...(payload ? { payload } : {}),
    timestamp: new Date().toISOString(),
  };
}

function createCodexProviderEnv(providerConfig: OpenAICompatibleProviderConfig): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

  env.THEMIS_OPENAI_COMPAT_API_KEY = providerConfig.apiKey;

  return env;
}

function createCodexProviderOverrides(providerConfig: OpenAICompatibleProviderConfig): NonNullable<CodexOptions["config"]> {
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

function translateThreadEvent(taskId: string, requestId: string, event: ThreadEvent): TaskEvent | null {
  switch (event.type) {
    case "thread.started":
      return createTaskEvent(taskId, requestId, "task.accepted", "running", "Codex thread is ready.", {
        threadId: event.thread_id,
      });
    case "turn.started":
      return createTaskEvent(taskId, requestId, "task.context_built", "running", "Prompt sent to Codex.");
    case "item.started":
    case "item.updated":
    case "item.completed":
      return createTaskEvent(
        taskId,
        requestId,
        "task.progress",
        "running",
        describeThreadItem(event.item),
        createThreadItemPayload(event.type, event.item),
      );
    case "turn.completed":
      return createTaskEvent(taskId, requestId, "task.progress", "running", "Codex finished generating a response.", {
        usage: event.usage,
      });
    case "turn.failed":
      return createTaskEvent(taskId, requestId, "task.failed", "failed", event.error.message);
    case "error":
      return createTaskEvent(taskId, requestId, "task.failed", "failed", event.message);
    default:
      return null;
  }
}

function createThreadItemPayload(threadEventType: "item.started" | "item.updated" | "item.completed", item: ThreadItem): Record<string, unknown> {
  return {
    threadEventType,
    itemType: item.type,
    itemId: item.id,
    ...(item.type === "agent_message" && item.text.trim() ? { itemText: item.text } : {}),
  };
}

function collectThreadArtifacts(
  event: ThreadEvent,
  touchedFiles: Set<string>,
  setFinalResponse: (value: string) => void,
): void {
  if (!("item" in event)) {
    return;
  }

  const item = event.item;

  if (item.type === "agent_message") {
    setFinalResponse(item.text);
    return;
  }

  if (item.type === "file_change") {
    for (const change of item.changes) {
      touchedFiles.add(change.path);
    }
  }
}

function describeThreadItem(item: ThreadItem): string {
  switch (item.type) {
    case "agent_message":
      return item.text.trim() || "Codex produced an assistant message.";
    case "reasoning":
      return "Codex updated its reasoning summary.";
    case "command_execution":
      return `Codex ran: ${item.command}`;
    case "file_change":
      return `Codex applied file changes to ${item.changes.length} file(s).`;
    case "mcp_tool_call":
      return `Codex called MCP tool ${item.server}/${item.tool}.`;
    case "web_search":
      return `Codex searched the web for "${item.query}".`;
    case "todo_list":
      return "Codex updated its internal todo list.";
    case "error":
      return item.message;
    default:
      return "Codex reported progress.";
  }
}

function describeSessionMode(sessionLease: CodexSessionLease, target: ResolvedRuntimeTarget): string {
  const runtimeLabel = target.accessMode === "third-party"
    ? "Themis started a third-party compatible conversation for this session."
    : "Themis started a Codex-authenticated conversation for this session.";

  switch (sessionLease.sessionMode) {
    case "created":
      return target.accessMode === "third-party"
        ? "Themis created a new third-party compatible conversation for this session."
        : "Themis created a new Codex conversation for this session.";
    case "resumed":
      return target.accessMode === "third-party"
        ? "Themis resumed the existing third-party compatible conversation for this session."
        : "Themis resumed the existing Codex conversation for this session.";
    default:
      return runtimeLabel;
  }
}

function createSessionPayload(
  sessionLease: CodexSessionLease,
  target: ResolvedRuntimeTarget,
  resolvedThreadId?: string,
): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {
    sessionMode: sessionLease.sessionMode,
    accessMode: target.accessMode,
  };

  if (sessionLease.sessionId) {
    payload.sessionId = sessionLease.sessionId;
    payload.conversationId = sessionLease.sessionId;
  }

  if (resolvedThreadId ?? sessionLease.threadId) {
    payload.threadId = resolvedThreadId ?? sessionLease.threadId;
  }

  if (target.providerId) {
    payload.thirdPartyProviderId = target.providerId;
  }

  return Object.keys(payload).length ? payload : undefined;
}

function summarizeResponse(finalResponse: string): string {
  const normalized = finalResponse.trim();

  if (!normalized) {
    return "Codex completed the task but did not return a final text response.";
  }

  const [firstLine] = normalized.split("\n");
  return firstLine ? firstLine.slice(0, 200) : normalized.slice(0, 200);
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
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

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message.startsWith("TASK_TIMEOUT:");
}

function describeAbort(signal: AbortSignal): string {
  const reason = signal.reason;

  if (reason instanceof Error) {
    if (reason.message.startsWith("TASK_TIMEOUT:")) {
      const timeout = reason.message.split(":")[1] ?? "0";
      const seconds = Math.max(1, Math.round(Number.parseInt(timeout, 10) / 1000));
      return `任务因超时被取消，超时时间约为 ${seconds} 秒。`;
    }

    if (reason.message === "CLIENT_DISCONNECTED") {
      return "客户端已断开连接，任务已停止。";
    }

    if (reason.message === "WEB_SUBMIT_REPLACED") {
      return "已为新消息打断当前任务。";
    }

    if (reason.message === "FEISHU_SESSION_REPLACED") {
      return "收到新消息，已打断上一条任务。";
    }
  }

  return "任务已被取消。";
}

function normalizeOptionalText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return normalized ? normalized : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
