import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { RuntimeInputCapabilities } from "../types/index.js";
import type {
  TaskRuntimeThreadSnapshot,
  TaskRuntimeThreadSnapshotTurn,
} from "../types/runtime-engine.js";
import { buildCodexCliConfigArgs, type CodexCliConfigOverrides } from "./auth-accounts.js";

export interface CodexRuntimeReasoningOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexRuntimeModelCapabilities {
  textInput: boolean;
  imageInput: boolean;
  nativeTextInput: boolean;
  nativeImageInput: boolean;
  nativeDocumentInput: boolean;
  supportedDocumentMimeTypes: string[];
  supportsPdfTextExtraction: boolean;
  supportsDocumentPageRasterization: boolean;
  supportsCodexTasks: boolean;
  supportsReasoningSummaries: boolean;
  supportsVerbosity: boolean;
  supportsParallelToolCalls: boolean;
  supportsSearchTool: boolean;
  supportsImageDetailOriginal: boolean;
}

export interface CodexRuntimeModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: CodexRuntimeReasoningOption[];
  defaultReasoningEffort: string | null;
  contextWindow: number | null;
  capabilities: CodexRuntimeModelCapabilities;
  supportsPersonality: boolean;
  supportsCodexTasks: boolean;
  isDefault: boolean;
}

export interface CodexRuntimeDefaults {
  profile: string | null;
  model: string | null;
  reasoning: string | null;
  approvalPolicy: string | null;
  sandboxMode: string | null;
  webSearchMode: string | null;
  networkAccessEnabled: boolean | null;
}

export interface CodexRuntimePersonaProfile {
  id: string;
  label: string;
  description: string;
  vibe: string | null;
}

export interface CodexRuntimeProviderInfo {
  type: "codex-default" | "openai-compatible";
  name: string;
  baseUrl: string | null;
  model: string | null;
  lockedModel: boolean;
}

export interface CodexRuntimeAccessMode {
  id: "auth" | "third-party";
  label: string;
  description: string;
}

export interface CodexRuntimeThirdPartyProvider {
  id: string;
  type: "openai-compatible";
  name: string;
  baseUrl: string | null;
  endpointCandidates: string[];
  source: "env" | "db" | null;
  wireApi: "responses" | "chat" | null;
  supportsWebsockets: boolean | null;
  lockedModel: boolean;
  defaultModel: string | null;
  models: CodexRuntimeModel[];
}

export interface CodexRuntimeCatalog {
  models: CodexRuntimeModel[];
  defaults: CodexRuntimeDefaults;
  provider: CodexRuntimeProviderInfo | null;
  accessModes: CodexRuntimeAccessMode[];
  thirdPartyProviders: CodexRuntimeThirdPartyProvider[];
  personas: CodexRuntimePersonaProfile[];
}

export interface CodexAuthAccount {
  type: "apiKey" | "chatgpt";
  email: string | null;
  planType: string | null;
}

export interface CodexAuthRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: string | null;
}

export interface CodexAuthRateLimitCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface CodexAuthRateLimits {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primary: CodexAuthRateLimitWindow | null;
  secondary: CodexAuthRateLimitWindow | null;
  credits: CodexAuthRateLimitCredits | null;
}

export interface CodexAuthStatus {
  authenticated: boolean;
  authMethod: string | null;
  requiresOpenaiAuth: boolean;
  account: CodexAuthAccount | null;
  rateLimits: CodexAuthRateLimits | null;
}

interface JsonRpcSuccess<TResult> {
  id: number;
  result: TResult;
}

interface JsonRpcFailure {
  id: number;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

type JsonRpcResponse<TResult> = JsonRpcSuccess<TResult> | JsonRpcFailure;

export interface CodexAppServerNotification {
  method: string;
  params?: unknown;
}

export interface AppServerThreadStartParams {
  cwd: string;
  model?: string;
  approvalPolicy?: string;
  sandbox?: string;
  webSearchMode?: string;
  experimentalRawEvents?: boolean;
  persistExtendedHistory?: boolean;
}

export interface AppServerReverseRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface AppServerTextInputPart {
  type: "text";
  text: string;
  text_elements: [];
}

export interface AppServerLocalImageInputPart {
  type: "localImage";
  path: string;
}

export type AppServerTurnInputPart = AppServerTextInputPart | AppServerLocalImageInputPart;

interface AppServerModelListResponse {
  data?: unknown;
}

interface AppServerConfigReadResponse {
  config?: Record<string, unknown>;
}

interface AppServerGetAuthStatusResponse {
  authMethod?: unknown;
  requiresOpenaiAuth?: unknown;
}

interface AppServerAccountReadResponse {
  account?: unknown;
  requiresOpenaiAuth?: unknown;
}

interface AppServerAccountRateLimitsResponse {
  rateLimits?: unknown;
  rateLimitsByLimitId?: unknown;
}

interface AppServerThreadResponse {
  threadId?: unknown;
  thread?: unknown;
}

interface AppServerThreadForkResponse {
  thread?: unknown;
}

interface AppServerThreadReadResponse {
  thread?: unknown;
}

interface AppServerTurnResponse {
  turnId?: unknown;
  turn?: unknown;
}

interface AppServerReviewStartResponse {
  turn?: unknown;
  reviewThreadId?: unknown;
}

interface AppServerTurnSteerResponse {
  turnId?: unknown;
}

interface PendingRequest<TResult> {
  resolve: (value: TResult) => void;
  reject: (error: Error) => void;
}

interface CodexAppServerSessionOptions {
  env?: Record<string, string>;
  configOverrides?: CodexCliConfigOverrides;
}

const DEFAULT_REASONING_OPTIONS: CodexRuntimeReasoningOption[] = [
  { reasoningEffort: "low", description: "low" },
  { reasoningEffort: "medium", description: "medium" },
  { reasoningEffort: "high", description: "high" },
  { reasoningEffort: "xhigh", description: "xhigh" },
];

export async function readCodexRuntimeCatalog(cwd: string, options: CodexAppServerSessionOptions = {}): Promise<CodexRuntimeCatalog> {
  const session = new CodexAppServerSession(cwd, options);

  try {
    await session.initialize();

    const [modelList, configRead] = await Promise.all([
      session.request<AppServerModelListResponse>("model/list", {
        limit: 100,
        includeHidden: true,
      }),
      session.request<AppServerConfigReadResponse>("config/read", {
        includeLayers: false,
        cwd,
      }),
    ]);

    const defaults = normalizeRuntimeDefaults(configRead);
    const models = normalizeRuntimeModels(modelList, defaults);

    return {
      models,
      defaults: {
        profile: defaults.profile,
        model: defaults.model ?? models.find((model) => model.isDefault)?.model ?? models[0]?.model ?? null,
        reasoning: defaults.reasoning,
        approvalPolicy: defaults.approvalPolicy,
        sandboxMode: defaults.sandboxMode,
        webSearchMode: defaults.webSearchMode,
        networkAccessEnabled: defaults.networkAccessEnabled,
      },
      provider: {
        type: "codex-default",
        name: "Codex CLI",
        baseUrl: null,
        model: defaults.model ?? models.find((model) => model.isDefault)?.model ?? models[0]?.model ?? null,
        lockedModel: false,
      },
      accessModes: [
        {
          id: "auth",
          label: "认证",
          description: "通过 Codex / ChatGPT 认证运行任务。",
        },
      ],
      thirdPartyProviders: [],
      personas: [],
    };
  } finally {
    await session.close();
  }
}

export async function readCodexAuthStatus(cwd: string, options: CodexAppServerSessionOptions = {}): Promise<CodexAuthStatus> {
  const session = new CodexAppServerSession(cwd, options);

  try {
    await session.initialize();
    return await readCodexAuthStatusFromSession(session);
  } finally {
    await session.close();
  }
}

export async function readCodexAuthStatusFromSession(session: CodexAppServerSession): Promise<CodexAuthStatus> {
  const [authStatus, accountRead, rateLimits] = await Promise.all([
    session.request<AppServerGetAuthStatusResponse>("getAuthStatus", {
      includeToken: false,
      refreshToken: false,
    }),
    session.request<AppServerAccountReadResponse>("account/read", {
      refreshToken: false,
    }),
    readCodexAuthRateLimits(session),
  ]);

  const authMethod = normalizeOptionalText(authStatus.authMethod);
  const account = normalizeAuthAccount(accountRead.account);
  const requiresOpenaiAuth = normalizeBoolean(authStatus.requiresOpenaiAuth)
    ?? normalizeBoolean(accountRead.requiresOpenaiAuth)
    ?? true;

  return {
    authenticated: Boolean(authMethod || account),
    authMethod,
    requiresOpenaiAuth,
    account,
    rateLimits,
  };
}

export class CodexAppServerSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  private readonly stderrChunks: string[] = [];
  private readonly notificationHandlers = new Set<(notification: CodexAppServerNotification) => void>();
  private readonly serverRequestHandlers = new Set<(request: AppServerReverseRequest) => void>();
  private nextId = 1;
  private closed = false;

  constructor(cwd: string, options: CodexAppServerSessionOptions = {}) {
    this.child = spawn(resolveCodexBinary(), [...buildCodexCliConfigArgs(options.configOverrides), "app-server"], {
      cwd,
      ...(options.env ? { env: options.env } : {}),
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");

    const output = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    output.on("line", (line) => {
      this.handleOutputLine(line);
    });

    this.child.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
    });

    this.child.on("error", (error) => {
      this.rejectAll(error);
    });

    this.child.on("close", (code, signal) => {
      this.closed = true;

      if (!this.pending.size) {
        return;
      }

      const stderrText = this.stderrChunks.join("").trim();
      const message = stderrText || `codex app-server exited unexpectedly (code: ${code ?? "unknown"}, signal: ${signal ?? "none"}).`;
      this.rejectAll(new Error(message));
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "themis-webui",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
  }

  async request<TResult>(method: string, params: unknown): Promise<TResult> {
    if (this.closed) {
      throw new Error("codex app-server is not available.");
    }

    const id = this.nextId;
    this.nextId += 1;

    return await new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as PendingRequest<unknown>["resolve"],
        reject,
      });

      void this.writeJsonRpcMessage({
        method,
        id,
        params,
      }).catch((error) => {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  onNotification(handler: (notification: CodexAppServerNotification) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  onServerRequest(handler: (request: AppServerReverseRequest) => void): () => void {
    this.serverRequestHandlers.add(handler);
    return () => {
      this.serverRequestHandlers.delete(handler);
    };
  }

  async startThread(params: AppServerThreadStartParams): Promise<{ threadId: string }> {
    const response = await this.request<AppServerThreadResponse>("thread/start", {
      experimentalRawEvents: params.experimentalRawEvents ?? false,
      persistExtendedHistory: params.persistExtendedHistory ?? true,
      ...params,
    });

    return {
      threadId: requireText(
        normalizeOptionalText(response.threadId) ?? extractThreadId(response.thread),
        "codex app-server thread/start did not return a threadId.",
      ),
    };
  }

  async resumeThread(threadId: string, params: AppServerThreadStartParams): Promise<{ threadId: string }> {
    const response = await this.request<AppServerThreadResponse>("thread/resume", {
      persistExtendedHistory: params.persistExtendedHistory ?? true,
      ...params,
      threadId,
    });

    return {
      threadId: requireText(
        normalizeOptionalText(response.threadId) ?? extractThreadId(response.thread),
        "codex app-server thread/resume did not return a threadId.",
      ),
    };
  }

  async forkThread(threadId: string): Promise<{ threadId: string }> {
    const response = await this.request<AppServerThreadForkResponse>("thread/fork", {
      threadId,
      persistExtendedHistory: true,
    });

    return {
      threadId: requireText(
        extractThreadId(response.thread),
        "codex app-server thread/fork did not return a thread.id.",
      ),
    };
  }

  async readThread(
    threadId: string,
    options: {
      includeTurns?: boolean;
    } = {},
  ): Promise<TaskRuntimeThreadSnapshot> {
    const response = await this.request<AppServerThreadReadResponse>("thread/read", {
      threadId,
      includeTurns: options.includeTurns === true,
    });

    return normalizeThreadSnapshot(response.thread);
  }

  async startTurn(
    threadId: string,
    input: string | AppServerTurnInputPart[],
  ): Promise<{ turnId: string }> {
    const normalizedInput = typeof input === "string"
      ? [normalizeAppServerTextInputPart(input)]
      : input.map((part) => (part.type === "text"
        ? normalizeAppServerTextInputPart(part.text)
        : normalizeAppServerLocalImageInputPart(part)));

    const response = await this.request<AppServerTurnResponse>("turn/start", {
      threadId,
      input: normalizedInput,
    });

    return {
      turnId: requireText(
        normalizeOptionalText(response.turnId) ?? extractTurnId(response.turn),
        "codex app-server turn/start did not return a turnId.",
      ),
    };
  }

  async startReview(threadId: string, instructions: string): Promise<{ reviewThreadId: string; turnId: string }> {
    const response = await this.request<AppServerReviewStartResponse>("review/start", {
      threadId,
      target: {
        type: "custom",
        instructions,
      },
    });

    return {
      reviewThreadId: requireText(
        response.reviewThreadId,
        "codex app-server review/start did not return a reviewThreadId.",
      ),
      turnId: requireText(
        extractTurnId(response.turn),
        "codex app-server review/start did not return a turn.id.",
      ),
    };
  }

  async steerTurn(threadId: string, expectedTurnId: string, message: string): Promise<{ turnId: string }> {
    const response = await this.request<AppServerTurnSteerResponse>("turn/steer", {
      threadId,
      expectedTurnId,
      input: [
        {
          type: "text",
          text: message,
          text_elements: [],
        },
      ],
    });

    return {
      turnId: requireText(response.turnId, "codex app-server turn/steer did not return a turnId."),
    };
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", {
      threadId,
      turnId,
    });
  }

  async respondToServerRequest(id: string | number, result: unknown): Promise<void> {
    await this.writeJsonRpcMessage({
      id,
      result: result ?? null,
    });
  }

  async rejectServerRequest(id: string | number, error: Error): Promise<void> {
    await this.writeJsonRpcMessage({
      id,
      error: {
        code: -32000,
        message: normalizeOptionalText(error.message) ?? String(error),
      },
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    const waitForClose = new Promise<void>((resolve) => {
      this.child.once("close", () => {
        resolve();
      });
    });

    this.child.kill("SIGTERM");

    await Promise.race([
      waitForClose,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      }),
    ]);

    if (!this.closed) {
      this.child.kill("SIGKILL");
      await waitForClose;
    }
  }

  private handleOutputLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    const method = normalizeOptionalText(parsed.method);
    const hasResult = Object.prototype.hasOwnProperty.call(parsed, "result");
    const hasError = Object.prototype.hasOwnProperty.call(parsed, "error");
    const id = parsed.id;

    if (method && !hasResult && !hasError && (typeof id === "string" || typeof id === "number")) {
      this.emitServerRequest({
        id,
        method,
        ...(Object.prototype.hasOwnProperty.call(parsed, "params") ? { params: parsed.params } : {}),
      });
      return;
    }

    if (typeof id !== "number") {
      if (method) {
        this.emitNotification({
          method,
          ...(Object.prototype.hasOwnProperty.call(parsed, "params") ? { params: parsed.params } : {}),
        });
      }

      return;
    }

    const requestId = id;
    const pending = this.pending.get(requestId);

    if (!pending) {
      return;
    }

    this.pending.delete(requestId);

    if ("error" in parsed) {
      const message = isRecord(parsed.error) && normalizeOptionalText(parsed.error.message)
        || `codex app-server request failed: ${requestId}`;
      pending.reject(new Error(message));
      return;
    }

    pending.resolve(parsed.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private emitNotification(notification: CodexAppServerNotification): void {
    for (const handler of this.notificationHandlers) {
      handler(notification);
    }
  }

  private emitServerRequest(request: AppServerReverseRequest): void {
    for (const handler of this.serverRequestHandlers) {
      handler(request);
    }
  }

  private async writeJsonRpcMessage(message: Record<string, unknown>): Promise<void> {
    if (this.closed) {
      throw new Error("codex app-server is not available.");
    }

    const payload = JSON.stringify(message);

    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${payload}\n`, "utf8", (error) => {
        if (!error) {
          resolve();
          return;
        }

        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

function normalizeAppServerTextInputPart(text: string): AppServerTextInputPart {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}

function normalizeAppServerLocalImageInputPart(part: AppServerLocalImageInputPart): AppServerLocalImageInputPart {
  return {
    type: "localImage",
    path: part.path,
  };
}

function normalizeRuntimeDefaults(response: AppServerConfigReadResponse): CodexRuntimeDefaults {
  const config = isRecord(response.config) ? response.config : {};

  return {
    profile: null,
    model: normalizeOptionalText(config.model),
    reasoning: normalizeOptionalText(config.model_reasoning_effort),
    approvalPolicy: normalizeOptionalText(config.approval_policy),
    sandboxMode: normalizeOptionalText(config.sandbox_mode),
    webSearchMode: normalizeOptionalText(config.web_search),
    networkAccessEnabled: normalizeBoolean(
      isRecord(config.sandbox_workspace_write) ? config.sandbox_workspace_write.network_access : null,
    ),
  };
}

function normalizeRuntimeModels(
  response: AppServerModelListResponse,
  defaults: CodexRuntimeDefaults,
): CodexRuntimeModel[] {
  const data = Array.isArray(response.data) ? response.data : [];
  const models = data
    .map(normalizeRuntimeModel)
    .filter((model): model is CodexRuntimeModel => model !== null);
  const configuredModel = defaults.model;

  if (configuredModel && !models.some((model) => model.model === configuredModel)) {
    models.unshift(createSyntheticConfiguredModel(configuredModel, defaults.reasoning));
  }

  return models;
}

function normalizeRuntimeModel(value: unknown): CodexRuntimeModel | null {
  if (!isRecord(value)) {
    return null;
  }

  const model = normalizeOptionalText(value.model) ?? normalizeOptionalText(value.id);

  if (!model) {
    return null;
  }

  const supportsCodexTasks = normalizeCapabilityBoolean(
    value.supportsCodexTasks,
    value.supports_codex_tasks,
  ) ?? true;
  const capabilities = normalizeRuntimeModelCapabilities(value, supportsCodexTasks);

  return {
    id: normalizeOptionalText(value.id) ?? model,
    model,
    displayName: normalizeOptionalText(value.displayName) ?? model,
    description: normalizeOptionalText(value.description) ?? "",
    hidden: Boolean(value.hidden),
    supportedReasoningEfforts: normalizeReasoningOptions(value.supportedReasoningEfforts),
    defaultReasoningEffort: normalizeOptionalText(value.defaultReasoningEffort),
    contextWindow: normalizePositiveNumber(value.contextWindow ?? value.context_window),
    capabilities,
    supportsPersonality: Boolean(value.supportsPersonality),
    supportsCodexTasks: capabilities.supportsCodexTasks,
    isDefault: Boolean(value.isDefault),
  };
}

function normalizeReasoningOptions(value: unknown): CodexRuntimeReasoningOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const reasoningEffort = normalizeOptionalText(entry.reasoningEffort);

      if (!reasoningEffort) {
        return null;
      }

      return {
        reasoningEffort,
        description: normalizeOptionalText(entry.description) ?? reasoningEffort,
      };
    })
    .filter((entry): entry is CodexRuntimeReasoningOption => entry !== null);
}

function createSyntheticConfiguredModel(model: string, reasoning: string | null): CodexRuntimeModel {
  const capabilities = createDefaultRuntimeModelCapabilities(true);

  return {
    id: model,
    model,
    displayName: model,
    description: "当前 Codex 配置使用的模型，没有出现在默认 picker 列表中。",
    hidden: false,
    supportedReasoningEfforts: [...DEFAULT_REASONING_OPTIONS],
    defaultReasoningEffort: reasoning,
    contextWindow: null,
    capabilities,
    supportsPersonality: false,
    supportsCodexTasks: capabilities.supportsCodexTasks,
    isDefault: false,
  };
}

function createDefaultRuntimeModelCapabilities(supportsCodexTasks: boolean): CodexRuntimeModelCapabilities {
  return {
    textInput: true,
    imageInput: false,
    nativeTextInput: true,
    nativeImageInput: false,
    nativeDocumentInput: false,
    supportedDocumentMimeTypes: [],
    supportsPdfTextExtraction: false,
    supportsDocumentPageRasterization: false,
    supportsCodexTasks,
    supportsReasoningSummaries: false,
    supportsVerbosity: false,
    supportsParallelToolCalls: false,
    supportsSearchTool: false,
    supportsImageDetailOriginal: false,
  };
}

function normalizeRuntimeModelCapabilities(
  value: Record<string, unknown>,
  supportsCodexTasks: boolean,
): CodexRuntimeModelCapabilities {
  const defaults = createDefaultRuntimeModelCapabilities(supportsCodexTasks);
  const inputModalities = normalizeInputModalities(value.inputModalities ?? value.input_modalities);
  const textInput = inputModalities.length
    ? inputModalities.includes("text")
    : normalizeCapabilityBoolean(value.textInput, value.text_input) ?? defaults.textInput;
  const imageInput = inputModalities.includes("image")
    || (normalizeCapabilityBoolean(value.imageInput, value.image_input) ?? defaults.imageInput);
  const nativeTextInput = normalizeCapabilityBoolean(
    value.nativeTextInput,
    value.native_text_input,
  ) ?? textInput;
  const nativeImageInput = normalizeCapabilityBoolean(
    value.nativeImageInput,
    value.native_image_input,
  ) ?? imageInput;
  const nativeDocumentInput = inputModalities.includes("document")
    || inputModalities.includes("file")
    || (normalizeCapabilityBoolean(
      value.nativeDocumentInput,
      value.native_document_input,
    ) ?? defaults.nativeDocumentInput);

  return {
    textInput,
    imageInput,
    nativeTextInput,
    nativeImageInput,
    nativeDocumentInput,
    supportedDocumentMimeTypes: normalizeStringArray(
      value.supportedDocumentMimeTypes ?? value.supported_document_mime_types,
    ),
    supportsPdfTextExtraction: normalizeCapabilityBoolean(
      value.supportsPdfTextExtraction,
      value.supports_pdf_text_extraction,
    ) ?? defaults.supportsPdfTextExtraction,
    supportsDocumentPageRasterization: normalizeCapabilityBoolean(
      value.supportsDocumentPageRasterization,
      value.supports_document_page_rasterization,
    ) ?? defaults.supportsDocumentPageRasterization,
    supportsCodexTasks,
    supportsReasoningSummaries: normalizeCapabilityBoolean(
      value.supportsReasoningSummaries,
      value.supports_reasoning_summaries,
    ) ?? defaults.supportsReasoningSummaries,
    supportsVerbosity: normalizeCapabilityBoolean(
      value.supportsVerbosity,
      value.support_verbosity,
      value.supports_verbosity,
    ) ?? defaults.supportsVerbosity,
    supportsParallelToolCalls: normalizeCapabilityBoolean(
      value.supportsParallelToolCalls,
      value.supports_parallel_tool_calls,
    ) ?? defaults.supportsParallelToolCalls,
    supportsSearchTool: normalizeCapabilityBoolean(
      value.supportsSearchTool,
      value.supports_search_tool,
    ) ?? defaults.supportsSearchTool,
    supportsImageDetailOriginal: normalizeCapabilityBoolean(
      value.supportsImageDetailOriginal,
      value.supports_image_detail_original,
    ) ?? defaults.supportsImageDetailOriginal,
  };
}

export function toRuntimeInputCapabilities(
  capabilities: CodexRuntimeModelCapabilities,
  fallback?: RuntimeInputCapabilities,
): RuntimeInputCapabilities {
  return {
    nativeTextInput: capabilities.nativeTextInput,
    nativeImageInput: capabilities.nativeImageInput,
    nativeDocumentInput: capabilities.nativeDocumentInput,
    supportedDocumentMimeTypes: capabilities.supportedDocumentMimeTypes.length
      ? [...capabilities.supportedDocumentMimeTypes]
      : [...(fallback?.supportedDocumentMimeTypes ?? [])],
    supportsPdfTextExtraction: capabilities.supportsPdfTextExtraction
      ?? fallback?.supportsPdfTextExtraction
      ?? false,
    supportsDocumentPageRasterization: capabilities.supportsDocumentPageRasterization
      ?? fallback?.supportsDocumentPageRasterization
      ?? false,
  };
}

function normalizeInputModalities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOptionalText(entry)?.toLowerCase() ?? null)
    .filter((entry): entry is string => entry !== null);
}

function normalizeCapabilityBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    const normalized = normalizeBoolean(value);

    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOptionalText(entry)?.trim())
    .filter((entry): entry is string => Boolean(entry));
}

function resolveCodexBinary(): string {
  const localBinary = fileURLToPath(
    new URL(`../../node_modules/.bin/${process.platform === "win32" ? "codex.cmd" : "codex"}`, import.meta.url),
  );

  if (existsSync(localBinary)) {
    return localBinary;
  }

  return process.platform === "win32" ? "codex.cmd" : "codex";
}

export function resolveCodexCliBinary(): string {
  return resolveCodexBinary();
}

function normalizeAuthAccount(value: unknown): CodexAuthAccount | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = normalizeOptionalText(value.type);

  if (type === "apiKey") {
    return {
      type,
      email: null,
      planType: null,
    };
  }

  if (type === "chatgpt") {
    return {
      type,
      email: normalizeOptionalText(value.email),
      planType: normalizeOptionalText(value.planType),
    };
  }

  return null;
}

async function readCodexAuthRateLimits(session: CodexAppServerSession): Promise<CodexAuthRateLimits | null> {
  try {
    const response = await session.request<AppServerAccountRateLimitsResponse>("account/rateLimits/read", {});
    return normalizeAuthRateLimitsResponse(response);
  } catch {
    return null;
  }
}

function normalizeAuthRateLimitsResponse(response: AppServerAccountRateLimitsResponse): CodexAuthRateLimits | null {
  const directRateLimits = normalizeAuthRateLimits(response.rateLimits);

  if (directRateLimits) {
    return directRateLimits;
  }

  if (!isRecord(response.rateLimitsByLimitId)) {
    return null;
  }

  for (const value of Object.values(response.rateLimitsByLimitId)) {
    const rateLimits = normalizeAuthRateLimits(value);

    if (rateLimits) {
      return rateLimits;
    }
  }

  return null;
}

function normalizeAuthRateLimits(value: unknown): CodexAuthRateLimits | null {
  if (!isRecord(value)) {
    return null;
  }

  const primary = normalizeAuthRateLimitWindow(value.primary);
  const secondary = normalizeAuthRateLimitWindow(value.secondary);
  const credits = normalizeAuthRateLimitCredits(value.credits);

  if (!primary && !secondary && !credits) {
    return null;
  }

  return {
    limitId: normalizeOptionalText(value.limitId),
    limitName: normalizeOptionalText(value.limitName),
    planType: normalizeOptionalText(value.planType),
    primary,
    secondary,
    credits,
  };
}

function normalizeAuthRateLimitWindow(value: unknown): CodexAuthRateLimitWindow | null {
  if (!isRecord(value)) {
    return null;
  }

  const usedPercent = normalizePercent(value.usedPercent);
  const windowDurationMins = normalizePositiveNumber(value.windowDurationMins);
  const resetsAt = normalizeUnixTimestamp(value.resetsAt);

  if (usedPercent === null || windowDurationMins === null) {
    return null;
  }

  return {
    usedPercent,
    windowDurationMins,
    resetsAt,
  };
}

function normalizeAuthRateLimitCredits(value: unknown): CodexAuthRateLimitCredits | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasCredits = normalizeBoolean(value.hasCredits);
  const unlimited = normalizeBoolean(value.unlimited);
  const balance = normalizeOptionalText(value.balance) ?? normalizeNumberText(value.balance);

  if (hasCredits === null && unlimited === null && !balance) {
    return null;
  }

  return {
    hasCredits: hasCredits ?? false,
    unlimited: unlimited ?? false,
    balance,
  };
}

function extractThreadId(thread: unknown): string | null {
  if (!isRecord(thread)) {
    return null;
  }

  return normalizeOptionalText(thread.id);
}

function extractTurnId(turn: unknown): string | null {
  if (!isRecord(turn)) {
    return null;
  }

  return normalizeOptionalText(turn.id) ?? normalizeOptionalText(turn.turnId);
}

function normalizeThreadSnapshot(thread: unknown): TaskRuntimeThreadSnapshot {
  if (!isRecord(thread)) {
    throw new Error("codex app-server thread/read did not return a thread.");
  }

  const threadId = requireText(thread.id, "codex app-server thread/read did not return a thread.id.");
  const preview = normalizeOptionalText(thread.preview);
  const status = normalizeOptionalText(thread.status);
  const cwd = normalizeOptionalText(thread.cwd);
  const createdAt = normalizeOptionalTimestamp(thread.createdAt);
  const updatedAt = normalizeOptionalTimestamp(thread.updatedAt);
  const turns = Array.isArray(thread.turns)
    ? thread.turns.map(normalizeThreadTurn).filter((value): value is TaskRuntimeThreadSnapshotTurn => value !== null)
    : [];

  return {
    threadId,
    ...(preview ? { preview } : {}),
    ...(status ? { status } : {}),
    ...(cwd ? { cwd } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    turnCount: turns.length,
    turns,
  };
}

function normalizeThreadTurn(threadTurn: unknown): TaskRuntimeThreadSnapshotTurn | null {
  if (!isRecord(threadTurn)) {
    return null;
  }

  const turnId = normalizeOptionalText(threadTurn.id) ?? normalizeOptionalText(threadTurn.turnId);

  if (!turnId) {
    return null;
  }

  const status = normalizeOptionalText(threadTurn.status);
  const summary = normalizeOptionalText(threadTurn.preview) ?? normalizeOptionalText(threadTurn.summary);
  const createdAt = normalizeOptionalTimestamp(threadTurn.createdAt);
  const updatedAt = normalizeOptionalTimestamp(threadTurn.updatedAt);

  return {
    turnId,
    ...(status ? { status } : {}),
    ...(summary ? { summary } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function requireText(value: unknown, errorMessage: string): string {
  const text = normalizeOptionalText(value);

  if (!text) {
    throw new Error(errorMessage);
  }

  return text;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizePercent(value: unknown): number | null {
  const parsed = normalizePositiveNumber(value);

  if (parsed === null) {
    return null;
  }

  return Math.max(0, Math.min(100, parsed));
}

function normalizePositiveNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

function normalizeNumberText(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return String(value);
}

function normalizeUnixTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function normalizeOptionalTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }

  return normalizeOptionalText(value);
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
