import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import {
  SqliteCodexSessionRegistry,
  type StoredThirdPartyProviderModelRecord,
  type StoredThirdPartyProviderRecord,
} from "../storage/index.js";

type OpenAICompatibleProviderReadRegistry = Pick<SqliteCodexSessionRegistry,
  | "listThirdPartyProviderModels"
  | "listThirdPartyProviders"
  | "saveThirdPartyProvider"
  | "saveThirdPartyProviderModel"
>;

type OpenAICompatibleProviderWriteRegistry = OpenAICompatibleProviderReadRegistry & Pick<SqliteCodexSessionRegistry,
  | "updateThirdPartyModelCapabilities"
  | "updateThirdPartyProviderDefaultModel"
>;

export const OPENAI_COMPATIBLE_PROVIDER_ID = "themis_openai_compatible";

export interface OpenAICompatibleProviderModelCapabilities {
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

export interface OpenAICompatibleProviderModelProfile {
  displayName: string;
  description: string;
  defaultReasoningLevel: string;
  supportedReasoningLevels: string[];
  contextWindow: number | null;
  truncationMode: "tokens" | "bytes";
  truncationLimit: number;
  capabilities: OpenAICompatibleProviderModelCapabilities;
}

export interface OpenAICompatibleProviderModelConfig {
  model: string;
  profile: OpenAICompatibleProviderModelProfile | null;
  isDefault: boolean;
}

export interface OpenAICompatibleProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  endpointCandidates: string[];
  defaultModel: string | null;
  wireApi: "responses" | "chat";
  supportsWebsockets: boolean;
  modelCatalogPath: string | null;
  models: OpenAICompatibleProviderModelConfig[];
  source: "env" | "db";
}

export interface OpenAICompatibleProviderSummary {
  id: string;
  type: "openai-compatible";
  name: string;
  baseUrl: string;
  model: string | null;
  source: "env" | "db";
  lockedModel: boolean;
}

export interface OpenAICompatibleProviderCreateInput {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  endpointCandidates?: string[];
  wireApi?: "responses" | "chat";
  supportsWebsockets?: boolean;
}

export interface OpenAICompatibleProviderModelCreateInput {
  providerId: string;
  model: string;
  displayName?: string;
  description?: string;
  defaultReasoningLevel?: string;
  supportedReasoningLevels?: string[];
  contextWindow?: number | null;
  truncationMode?: "tokens" | "bytes";
  truncationLimit?: number | null;
  setAsDefault?: boolean;
  capabilities?: Partial<OpenAICompatibleProviderModelCapabilities>;
}

interface ProviderFilePayload {
  providers?: unknown;
}

interface ProviderEntryPayload {
  id?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  endpointCandidates?: unknown;
  defaultModel?: unknown;
  wireApi?: unknown;
  supportsWebsockets?: unknown;
  modelCatalogPath?: unknown;
  models?: unknown;
}

interface ProviderModelEntryPayload {
  model?: unknown;
  displayName?: unknown;
  description?: unknown;
  defaultReasoningLevel?: unknown;
  supportedReasoningLevels?: unknown;
  contextWindow?: unknown;
  truncationMode?: unknown;
  truncationLimit?: unknown;
  capabilities?: unknown;
}

interface ProviderModelCapabilitiesPayload {
  textInput?: unknown;
  imageInput?: unknown;
  nativeTextInput?: unknown;
  nativeImageInput?: unknown;
  nativeDocumentInput?: unknown;
  supportedDocumentMimeTypes?: unknown;
  supportsPdfTextExtraction?: unknown;
  supportsDocumentPageRasterization?: unknown;
  supportsCodexTasks?: unknown;
  supportsReasoningSummaries?: unknown;
  supportsVerbosity?: unknown;
  supportsParallelToolCalls?: unknown;
  supportsSearchTool?: unknown;
  supportsImageDetailOriginal?: unknown;
}

interface WritableProviderFilePayload {
  providers: WritableProviderEntry[];
}

interface WritableProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  endpointCandidates?: string[];
  defaultModel?: string;
  wireApi: "responses" | "chat";
  supportsWebsockets: boolean;
  modelCatalogPath?: string;
  models: WritableProviderModelEntry[];
}

interface WritableProviderModelEntry {
  model: string;
  displayName: string;
  description: string;
  defaultReasoningLevel: string;
  supportedReasoningLevels: string[];
  contextWindow?: number;
  truncationMode?: "tokens" | "bytes";
  truncationLimit?: number;
  capabilities: OpenAICompatibleProviderModelCapabilities;
}

interface NormalizedProviderModelCreateInput {
  providerId: string;
  model: string;
  displayName: string;
  description: string;
  defaultReasoningLevel: string;
  supportedReasoningLevels: string[];
  contextWindow: number | null;
  truncationMode: "tokens" | "bytes";
  truncationLimit: number | null;
  setAsDefault: boolean;
  capabilities: OpenAICompatibleProviderModelCapabilities;
}

const PROVIDER_CONFIG_FILE = "infra/local/openai-compatible-provider.json";
const GENERATED_PROVIDER_MODEL_CATALOG_PREFIX = "infra/local/openai-compatible-provider";
const DEFAULT_REASONING_LEVELS = ["low", "medium", "high", "xhigh"];

export function readOpenAICompatibleProviderConfigs(
  cwd: string,
  registry?: OpenAICompatibleProviderReadRegistry,
): OpenAICompatibleProviderConfig[] {
  const envConfig = readProviderConfigFromEnv();

  if (envConfig) {
    return [envConfig];
  }

  const providerRegistry = getProviderRegistry(registry);
  ensureProviderConfigBootstrap(cwd, providerRegistry);
  return readProviderConfigsFromDatabase(cwd, providerRegistry);
}

export function readOpenAICompatibleProviderSummaries(
  cwd: string,
  registry?: OpenAICompatibleProviderReadRegistry,
): OpenAICompatibleProviderSummary[] {
  return readOpenAICompatibleProviderConfigs(cwd, registry).map(toProviderSummary);
}

export function readOpenAICompatibleProviderConfig(
  cwd: string,
  registry?: OpenAICompatibleProviderReadRegistry,
): OpenAICompatibleProviderConfig | null {
  return readOpenAICompatibleProviderConfigs(cwd, registry)[0] ?? null;
}

export function readOpenAICompatibleProviderSummary(
  cwd: string,
  registry?: OpenAICompatibleProviderReadRegistry,
): OpenAICompatibleProviderSummary | null {
  return readOpenAICompatibleProviderSummaries(cwd, registry)[0] ?? null;
}

export function addOpenAICompatibleProvider(
  cwd: string,
  input: OpenAICompatibleProviderCreateInput,
  registry?: OpenAICompatibleProviderWriteRegistry,
): OpenAICompatibleProviderConfig {
  const normalized = normalizeProviderCreateInput(input);
  const providerRegistry = getWritableProviderRegistry(cwd, registry);
  const providers = readProviderConfigsFromDatabase(cwd, providerRegistry);
  const providerId = buildUniqueProviderId(normalized.id || normalized.name, providers.map((provider) => provider.id));

  if (providers.some((provider) => provider.id === providerId)) {
    throw new Error(`第三方供应商 ${providerId} 已存在。`);
  }

  const now = new Date().toISOString();
  providerRegistry.saveThirdPartyProvider({
    providerId,
    name: normalized.name,
    baseUrl: normalized.baseUrl,
    apiKey: normalized.apiKey,
    endpointCandidatesJson: JSON.stringify(normalized.endpointCandidates),
    wireApi: normalized.wireApi,
    supportsWebsockets: normalized.supportsWebsockets,
    createdAt: now,
    updatedAt: now,
  });

  return findProviderConfig(cwd, providerId, providerRegistry);
}

export function addOpenAICompatibleProviderModel(
  cwd: string,
  input: OpenAICompatibleProviderModelCreateInput,
  registry?: OpenAICompatibleProviderWriteRegistry,
): OpenAICompatibleProviderConfig {
  const normalized = normalizeProviderModelCreateInput(input);
  const providerRegistry = getWritableProviderRegistry(cwd, registry);
  const providers = readProviderConfigsFromDatabase(cwd, providerRegistry);
  const provider = providers.find((entry) => entry.id === normalized.providerId);

  if (!provider) {
    throw new Error(`当前第三方供应商 ${normalized.providerId} 不可用。`);
  }

  if (provider.models.some((entry) => entry.model === normalized.model)) {
    throw new Error(`供应商 ${provider.name} 已存在模型 ${normalized.model}。`);
  }

  const now = new Date().toISOString();
  const modelRecord = {
    providerId: normalized.providerId,
    model: normalized.model,
    displayName: normalized.displayName,
    description: normalized.description,
    defaultReasoningLevel: normalized.defaultReasoningLevel,
    supportedReasoningLevelsJson: JSON.stringify(normalized.supportedReasoningLevels),
    ...(normalized.contextWindow ? { contextWindow: normalized.contextWindow } : {}),
    truncationMode: normalized.truncationMode,
    truncationLimit: normalized.truncationLimit ?? deriveDefaultTruncationLimit(normalized.contextWindow, normalized.truncationMode),
    capabilitiesJson: JSON.stringify(normalized.capabilities),
    createdAt: now,
    updatedAt: now,
  } satisfies StoredThirdPartyProviderModelRecord;
  providerRegistry.saveThirdPartyProviderModel(modelRecord);

  if (normalized.setAsDefault || !normalizeOptionalText(provider.defaultModel)) {
    providerRegistry.updateThirdPartyProviderDefaultModel(normalized.providerId, normalized.model, now);
  }

  return findProviderConfig(cwd, normalized.providerId, providerRegistry);
}

export function writeOpenAICompatibleProviderCodexTaskSupport(
  cwd: string,
  providerId: string,
  model: string,
  supportsCodexTasks: boolean,
  registry?: OpenAICompatibleProviderWriteRegistry,
): OpenAICompatibleProviderConfig {
  const normalizedProviderId = normalizeRequiredText(providerId);
  const normalizedModel = normalizeRequiredText(model);

  if (!normalizedProviderId || !normalizedModel) {
    throw new Error("写回模型能力时缺少 providerId 或 model。");
  }

  const providerRegistry = getWritableProviderRegistry(cwd, registry);
  const storedProvider = providerRegistry.listThirdPartyProviders()
    .find((entry) => entry.providerId === normalizedProviderId);
  const provider = readProviderConfigsFromDatabase(cwd, providerRegistry)
    .find((entry) => entry.id === normalizedProviderId);

  if (!storedProvider || !provider) {
    throw new Error(`当前第三方供应商 ${normalizedProviderId} 不可用。`);
  }

  const targetModel = provider.models.find((entry) => entry.model === normalizedModel);

  if (!targetModel) {
    throw new Error(`供应商 ${provider.name} 下没有模型 ${normalizedModel}。`);
  }

  const nextCapabilities = {
    ...createDefaultWriteCapabilities(true),
    ...(targetModel.profile?.capabilities ?? {}),
    supportsCodexTasks,
  };

  providerRegistry.updateThirdPartyModelCapabilities(
    normalizedProviderId,
    normalizedModel,
    JSON.stringify(nextCapabilities),
    new Date().toISOString(),
  );
  return findProviderConfig(cwd, normalizedProviderId, providerRegistry);
}

export function writeOpenAICompatibleProviderPreferredEndpoint(
  cwd: string,
  providerId: string,
  preferredBaseUrl: string,
  registry?: OpenAICompatibleProviderWriteRegistry,
): OpenAICompatibleProviderConfig {
  const normalizedProviderId = normalizeRequiredText(providerId);
  const normalizedBaseUrl = normalizeRequiredText(preferredBaseUrl);

  if (!normalizedProviderId || !normalizedBaseUrl) {
    throw new Error("写回主端点时缺少 providerId 或 baseUrl。");
  }

  const providerRegistry = getWritableProviderRegistry(cwd, registry);
  const storedProvider = providerRegistry.listThirdPartyProviders()
    .find((entry) => entry.providerId === normalizedProviderId);
  const provider = readProviderConfigsFromDatabase(cwd, providerRegistry)
    .find((entry) => entry.id === normalizedProviderId);

  if (!storedProvider || !provider) {
    throw new Error(`当前第三方供应商 ${normalizedProviderId} 不可用。`);
  }

  const nextEndpoints = reorderProviderEndpoints(provider.baseUrl, provider.endpointCandidates, normalizedBaseUrl);
  const now = new Date().toISOString();

  providerRegistry.saveThirdPartyProvider({
    providerId: provider.id,
    name: provider.name,
    baseUrl: nextEndpoints.baseUrl,
    apiKey: provider.apiKey,
    endpointCandidatesJson: JSON.stringify(nextEndpoints.endpointCandidates),
    ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
    wireApi: provider.wireApi,
    supportsWebsockets: provider.supportsWebsockets,
    ...(storedProvider.modelCatalogPath ? { modelCatalogPath: storedProvider.modelCatalogPath } : {}),
    createdAt: storedProvider.createdAt,
    updatedAt: now,
  });

  return findProviderConfig(cwd, normalizedProviderId, providerRegistry);
}

export function buildOpenAICompatibleProviderEndpointPool(provider: Pick<OpenAICompatibleProviderConfig, "baseUrl" | "endpointCandidates">): string[] {
  return normalizeEndpointCandidates([provider.baseUrl, ...provider.endpointCandidates]);
}

function readProviderConfigFromEnv(): OpenAICompatibleProviderConfig | null {
  const baseUrl = normalizeRequiredText(process.env.THEMIS_OPENAI_COMPAT_BASE_URL);
  const apiKey = normalizeRequiredText(process.env.THEMIS_OPENAI_COMPAT_API_KEY);
  const model = normalizeRequiredText(process.env.THEMIS_OPENAI_COMPAT_MODEL);
  const name = normalizeOptionalText(process.env.THEMIS_OPENAI_COMPAT_NAME) || "OpenAI-Compatible Provider";
  const endpointCandidates = normalizeEndpointCandidates(process.env.THEMIS_OPENAI_COMPAT_ENDPOINT_CANDIDATES)
    .filter((entry) => entry !== baseUrl);
  const wireApi = normalizeWireApi(process.env.THEMIS_OPENAI_COMPAT_WIRE_API) ?? "responses";
  const supportsWebsockets = normalizeOptionalBoolean(process.env.THEMIS_OPENAI_COMPAT_SUPPORTS_WEBSOCKETS) ?? false;
  const configuredModelCatalogPath = normalizeOptionalText(process.env.THEMIS_OPENAI_COMPAT_MODEL_CATALOG_JSON);
  const hasAnyField = Boolean(
    baseUrl
      || apiKey
      || model
      || process.env.THEMIS_OPENAI_COMPAT_NAME
      || process.env.THEMIS_OPENAI_COMPAT_ENDPOINT_CANDIDATES
      || process.env.THEMIS_OPENAI_COMPAT_WIRE_API
      || process.env.THEMIS_OPENAI_COMPAT_SUPPORTS_WEBSOCKETS
      || configuredModelCatalogPath,
  );

  if (!hasAnyField) {
    return null;
  }

  if (!baseUrl || !apiKey || !model) {
    throw new Error("THEMIS_OPENAI_COMPAT_BASE_URL / THEMIS_OPENAI_COMPAT_API_KEY / THEMIS_OPENAI_COMPAT_MODEL 必须同时配置。");
  }

  const modelCatalogPath = configuredModelCatalogPath ? configuredModelCatalogPath : null;

  return {
    id: OPENAI_COMPATIBLE_PROVIDER_ID,
    name,
    baseUrl,
    apiKey,
    endpointCandidates,
    defaultModel: model,
    wireApi,
    supportsWebsockets,
    modelCatalogPath,
    models: [
      {
        model,
        profile: null,
        isDefault: true,
      },
    ],
    source: "env",
  };
}

function normalizeModelProfile(
  value: ProviderModelEntryPayload,
  model: string,
  providerName: string,
  defaultSupportsCodexTasks: boolean,
): OpenAICompatibleProviderModelProfile {
  const supportedReasoningLevels = normalizeReasoningLevels(value.supportedReasoningLevels);
  const defaultReasoningLevel = normalizeReasoningLevel(value.defaultReasoningLevel)
    || supportedReasoningLevels[0]
    || "medium";
  const contextWindow = normalizeOptionalInteger(value.contextWindow);
  const truncationMode = normalizeTruncationMode(value.truncationMode) ?? "tokens";
  const truncationLimit = normalizeOptionalInteger(value.truncationLimit)
    ?? deriveDefaultTruncationLimit(contextWindow, truncationMode);

  return {
    displayName: normalizeOptionalText(value.displayName) || model,
    description: normalizeOptionalText(value.description) || `${providerName} 提供的兼容模型。`,
    defaultReasoningLevel,
    supportedReasoningLevels,
    contextWindow,
    truncationMode,
    truncationLimit,
    capabilities: normalizeModelCapabilities(value.capabilities, defaultSupportsCodexTasks),
  };
}

function normalizeModelCapabilities(
  value: unknown,
  defaultSupportsCodexTasks: boolean,
): OpenAICompatibleProviderModelCapabilities {
  const payload = value && typeof value === "object" ? (value as ProviderModelCapabilitiesPayload) : {};
  const textInput = normalizeOptionalBoolean(payload.textInput) ?? true;
  const imageInput = normalizeOptionalBoolean(payload.imageInput) ?? false;

  return {
    textInput,
    imageInput,
    nativeTextInput: normalizeOptionalBoolean(payload.nativeTextInput) ?? textInput,
    nativeImageInput: normalizeOptionalBoolean(payload.nativeImageInput) ?? imageInput,
    nativeDocumentInput: normalizeOptionalBoolean(payload.nativeDocumentInput) ?? false,
    supportedDocumentMimeTypes: normalizeOptionalStringArray(payload.supportedDocumentMimeTypes),
    supportsPdfTextExtraction: normalizeOptionalBoolean(payload.supportsPdfTextExtraction) ?? false,
    supportsDocumentPageRasterization: normalizeOptionalBoolean(payload.supportsDocumentPageRasterization) ?? false,
    supportsCodexTasks: normalizeOptionalBoolean(payload.supportsCodexTasks) ?? defaultSupportsCodexTasks,
    supportsReasoningSummaries: normalizeOptionalBoolean(payload.supportsReasoningSummaries) ?? false,
    supportsVerbosity: normalizeOptionalBoolean(payload.supportsVerbosity) ?? false,
    supportsParallelToolCalls: normalizeOptionalBoolean(payload.supportsParallelToolCalls) ?? false,
    supportsSearchTool: normalizeOptionalBoolean(payload.supportsSearchTool) ?? false,
    supportsImageDetailOriginal: normalizeOptionalBoolean(payload.supportsImageDetailOriginal) ?? false,
  };
}

function ensureDefaultModelEntry(
  models: OpenAICompatibleProviderModelConfig[],
  defaultModel: string,
): OpenAICompatibleProviderModelConfig[] {
  if (!models.length) {
    return [];
  }

  const resolvedDefaultModel = defaultModel || models[0]?.model || "";

  return models.map((entry) => ({
    ...entry,
    isDefault: entry.model === resolvedDefaultModel,
  }));
}

function toProviderSummary(config: OpenAICompatibleProviderConfig): OpenAICompatibleProviderSummary {
  return {
    id: config.id,
    type: "openai-compatible",
    name: config.name,
    baseUrl: config.baseUrl,
    model: config.defaultModel,
    source: config.source,
    lockedModel: config.source === "env",
  };
}

function findProviderConfig(
  cwd: string,
  providerId: string,
  registry?: OpenAICompatibleProviderReadRegistry,
): OpenAICompatibleProviderConfig {
  const normalizedProviderId = normalizeRequiredText(providerId);
  const provider = readOpenAICompatibleProviderConfigs(cwd, registry)
    .find((entry) => entry.id === normalizedProviderId);

  if (!provider) {
    throw new Error(`当前第三方供应商 ${normalizedProviderId} 不可用。`);
  }

  return provider;
}

function getProviderRegistry(registry?: OpenAICompatibleProviderReadRegistry): OpenAICompatibleProviderReadRegistry {
  return registry ?? new SqliteCodexSessionRegistry();
}

function getWritableProviderRegistry(
  cwd: string,
  registry?: OpenAICompatibleProviderWriteRegistry,
): OpenAICompatibleProviderWriteRegistry {
  if (readProviderConfigFromEnv()) {
    throw new Error("当前第三方兼容 provider 来自环境变量，不能在设置里直接修改。");
  }

  const providerRegistry = registry ?? new SqliteCodexSessionRegistry();
  ensureProviderConfigBootstrap(cwd, providerRegistry);
  return providerRegistry;
}

function ensureProviderConfigBootstrap(cwd: string, registry: OpenAICompatibleProviderReadRegistry): void {
  if (registry.listThirdPartyProviders().length > 0) {
    return;
  }

  const bootstrap = loadWritableProviderFile(cwd);

  if (!bootstrap.providers.length) {
    return;
  }

  const now = new Date().toISOString();

  for (const provider of bootstrap.providers) {
    registry.saveThirdPartyProvider({
      providerId: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      endpointCandidatesJson: JSON.stringify(normalizeEndpointCandidates(provider.endpointCandidates ?? [])),
      ...(normalizeOptionalText(provider.defaultModel) ? { defaultModel: normalizeOptionalText(provider.defaultModel) } : {}),
      wireApi: provider.wireApi,
      supportsWebsockets: provider.supportsWebsockets,
      ...(normalizeOptionalText(provider.modelCatalogPath)
        ? { modelCatalogPath: normalizeOptionalText(provider.modelCatalogPath) }
        : {}),
      createdAt: now,
      updatedAt: now,
    });

    for (const model of provider.models) {
      registry.saveThirdPartyProviderModel({
        providerId: provider.id,
        model: model.model,
        displayName: model.displayName,
        description: model.description,
        defaultReasoningLevel: model.defaultReasoningLevel,
        supportedReasoningLevelsJson: JSON.stringify(model.supportedReasoningLevels),
        ...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
        truncationMode: model.truncationMode ?? "tokens",
        truncationLimit: model.truncationLimit ?? deriveDefaultTruncationLimit(model.contextWindow ?? null, model.truncationMode ?? "tokens"),
        capabilitiesJson: JSON.stringify(model.capabilities),
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

function readProviderConfigsFromDatabase(
  cwd: string,
  registry: OpenAICompatibleProviderReadRegistry,
): OpenAICompatibleProviderConfig[] {
  const providers = registry.listThirdPartyProviders();
  const models = registry.listThirdPartyProviderModels();
  const modelsByProviderId = new Map<string, StoredThirdPartyProviderModelRecord[]>();

  for (const model of models) {
    const current = modelsByProviderId.get(model.providerId) ?? [];
    current.push(model);
    modelsByProviderId.set(model.providerId, current);
  }

  return providers.map((provider) => normalizeStoredProviderConfig(
    provider,
    modelsByProviderId.get(provider.providerId) ?? [],
    cwd,
  ));
}

function normalizeStoredProviderConfig(
  provider: StoredThirdPartyProviderRecord,
  providerModels: StoredThirdPartyProviderModelRecord[],
  cwd: string,
): OpenAICompatibleProviderConfig {
  const models = ensureDefaultModelEntry(
    providerModels.map((model) => normalizeStoredProviderModel(model, provider.name)),
    provider.defaultModel ?? "",
  );
  const generatedModelCatalogPath = models.length
    ? materializeGeneratedModelCatalog(cwd, provider.providerId, provider.name, models)
    : null;
  const modelCatalogPath = resolveProviderModelCatalogPath(
    cwd,
    provider.modelCatalogPath ?? null,
    generatedModelCatalogPath,
  );

  return {
    id: provider.providerId,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    endpointCandidates: normalizeEndpointCandidates(parseJsonValue(provider.endpointCandidatesJson)),
    defaultModel: provider.defaultModel ?? models.find((entry) => entry.isDefault)?.model ?? models[0]?.model ?? null,
    wireApi: provider.wireApi,
    supportsWebsockets: provider.supportsWebsockets,
    modelCatalogPath,
    models,
    source: "db",
  };
}

function normalizeStoredProviderModel(
  value: StoredThirdPartyProviderModelRecord,
  providerName: string,
): OpenAICompatibleProviderModelConfig {
  return {
    model: value.model,
    profile: normalizeModelProfile(
      {
        displayName: value.displayName,
        description: value.description,
        defaultReasoningLevel: value.defaultReasoningLevel,
        supportedReasoningLevels: parseJsonValue(value.supportedReasoningLevelsJson),
        contextWindow: value.contextWindow ?? null,
        truncationMode: value.truncationMode,
        truncationLimit: value.truncationLimit,
        capabilities: parseJsonValue(value.capabilitiesJson),
      },
      value.model,
      providerName,
      true,
    ),
    isDefault: false,
  };
}

function loadWritableProviderFile(cwd: string): WritableProviderFilePayload {
  const filePath = join(cwd, PROVIDER_CONFIG_FILE);

  if (!existsSync(filePath)) {
    return {
      providers: [],
    };
  }

  const raw = readFileSync(filePath, "utf8");
  const payload = JSON.parse(raw) as ProviderFilePayload;
  const providers = Array.isArray(payload.providers) ? payload.providers : [];

  return {
    providers: providers.map((provider, index) => normalizeWritableProviderEntry(provider, index)),
  };
}

function normalizeWritableProviderEntry(value: unknown, index: number): WritableProviderEntry {
  if (!isRecord(value)) {
    throw new Error(`${PROVIDER_CONFIG_FILE} 的 providers[${index}] 不是对象。`);
  }

  const payload = value as ProviderEntryPayload;
  const id = normalizeProviderId(payload.id) || `provider-${index + 1}`;
  const name = normalizeOptionalText(payload.name) || `OpenAI-Compatible Provider ${index + 1}`;
  const models = Array.isArray(payload.models)
    ? payload.models
      .map((entry) => normalizeWritableProviderModelEntry(entry, name))
      .filter((entry): entry is WritableProviderModelEntry => entry !== null)
    : [];

  return {
    id,
    name,
    baseUrl: normalizeRequiredText(payload.baseUrl),
    apiKey: normalizeRequiredText(payload.apiKey),
    ...(normalizeEndpointCandidates(payload.endpointCandidates).length
      ? { endpointCandidates: normalizeEndpointCandidates(payload.endpointCandidates) }
      : {}),
    ...(normalizeOptionalText(payload.defaultModel) ? { defaultModel: normalizeOptionalText(payload.defaultModel) } : {}),
    wireApi: normalizeWireApi(payload.wireApi) ?? "responses",
    supportsWebsockets: normalizeOptionalBoolean(payload.supportsWebsockets) ?? false,
    ...(normalizeOptionalText(payload.modelCatalogPath) ? { modelCatalogPath: normalizeOptionalText(payload.modelCatalogPath) } : {}),
    models,
  };
}

function normalizeWritableProviderModelEntry(
  value: unknown,
  providerName: string,
): WritableProviderModelEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const payload = value as ProviderModelEntryPayload;
  const model = normalizeRequiredText(payload.model);

  if (!model) {
    return null;
  }

  const profile = normalizeModelProfile(payload, model, providerName, true);

  return {
    model,
    displayName: profile.displayName,
    description: profile.description,
    defaultReasoningLevel: profile.defaultReasoningLevel,
    supportedReasoningLevels: profile.supportedReasoningLevels,
    ...(profile.contextWindow ? { contextWindow: profile.contextWindow } : {}),
    ...(profile.truncationMode ? { truncationMode: profile.truncationMode } : {}),
    ...(profile.truncationLimit ? { truncationLimit: profile.truncationLimit } : {}),
    capabilities: profile.capabilities,
  };
}

function normalizeProviderCreateInput(input: OpenAICompatibleProviderCreateInput): Required<OpenAICompatibleProviderCreateInput> {
  const name = normalizeRequiredText(input.name);
  const baseUrl = normalizeRequiredText(input.baseUrl);
  const apiKey = normalizeRequiredText(input.apiKey);
  const endpointCandidates = normalizeEndpointCandidates(input.endpointCandidates).filter((entry) => entry !== baseUrl);

  if (!name || !baseUrl || !apiKey) {
    throw new Error("添加供应商时必须填写名称、Base URL 和 API Key。");
  }

  return {
    id: normalizeOptionalText(input.id),
    name,
    baseUrl,
    apiKey,
    endpointCandidates,
    wireApi: input.wireApi === "chat" ? "chat" : "responses",
    supportsWebsockets: input.supportsWebsockets === true,
  };
}

function normalizeProviderModelCreateInput(
  input: OpenAICompatibleProviderModelCreateInput,
): NormalizedProviderModelCreateInput {
  const providerId = normalizeRequiredText(input.providerId);
  const model = normalizeRequiredText(input.model);
  const supportedReasoningLevels = normalizeReasoningLevels(input.supportedReasoningLevels);
  const defaultReasoningLevel = normalizeReasoningLevel(input.defaultReasoningLevel)
    || supportedReasoningLevels[0]
    || "medium";

  if (!providerId || !model) {
    throw new Error("添加模型时必须填写供应商和模型名称。");
  }

  const defaultCapabilities = createDefaultWriteCapabilities(true);
  const rawCapabilities = input.capabilities ?? {};

  return {
    providerId,
    model,
    displayName: normalizeOptionalText(input.displayName) || model,
    description: normalizeOptionalText(input.description),
    defaultReasoningLevel,
    supportedReasoningLevels,
    contextWindow: normalizeCreateInteger(input.contextWindow),
    truncationMode: input.truncationMode === "bytes" ? "bytes" : "tokens",
    truncationLimit: normalizeCreateInteger(input.truncationLimit),
    setAsDefault: input.setAsDefault === true,
    capabilities: normalizeModelCapabilities({
      textInput: rawCapabilities.textInput ?? defaultCapabilities.textInput,
      imageInput: rawCapabilities.imageInput ?? defaultCapabilities.imageInput,
      nativeTextInput: rawCapabilities.nativeTextInput,
      nativeImageInput: rawCapabilities.nativeImageInput,
      nativeDocumentInput: rawCapabilities.nativeDocumentInput,
      supportedDocumentMimeTypes: rawCapabilities.supportedDocumentMimeTypes,
      supportsPdfTextExtraction: rawCapabilities.supportsPdfTextExtraction,
      supportsDocumentPageRasterization: rawCapabilities.supportsDocumentPageRasterization,
      supportsCodexTasks: rawCapabilities.supportsCodexTasks ?? defaultCapabilities.supportsCodexTasks,
      supportsReasoningSummaries: rawCapabilities.supportsReasoningSummaries ?? defaultCapabilities.supportsReasoningSummaries,
      supportsVerbosity: rawCapabilities.supportsVerbosity ?? defaultCapabilities.supportsVerbosity,
      supportsParallelToolCalls: rawCapabilities.supportsParallelToolCalls ?? defaultCapabilities.supportsParallelToolCalls,
      supportsSearchTool: rawCapabilities.supportsSearchTool ?? defaultCapabilities.supportsSearchTool,
      supportsImageDetailOriginal: rawCapabilities.supportsImageDetailOriginal ?? defaultCapabilities.supportsImageDetailOriginal,
    }, true),
  };
}

function createDefaultWriteCapabilities(defaultSupportsCodexTasks: boolean): OpenAICompatibleProviderModelCapabilities {
  return {
    textInput: true,
    imageInput: false,
    nativeTextInput: true,
    nativeImageInput: false,
    nativeDocumentInput: false,
    supportedDocumentMimeTypes: [],
    supportsPdfTextExtraction: false,
    supportsDocumentPageRasterization: false,
    supportsCodexTasks: defaultSupportsCodexTasks,
    supportsReasoningSummaries: false,
    supportsVerbosity: false,
    supportsParallelToolCalls: false,
    supportsSearchTool: false,
    supportsImageDetailOriginal: false,
  };
}

function buildUniqueProviderId(seed: string, existingIds: string[]): string {
  const normalizedSeed = normalizeProviderId(seed) || "provider";
  const used = new Set(existingIds.map((entry) => normalizeProviderId(entry)));
  let candidate = normalizedSeed;
  let suffix = 2;

  while (used.has(candidate)) {
    candidate = `${normalizedSeed}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function normalizeProviderId(value: unknown): string {
  const normalized = normalizeOptionalText(value).toLowerCase();

  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeEndpointCandidates(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]+/g)
      : [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of rawValues) {
    const endpoint = normalizeRequiredText(entry);

    if (!endpoint || seen.has(endpoint)) {
      continue;
    }

    seen.add(endpoint);
    normalized.push(endpoint);
  }

  return normalized;
}

function reorderProviderEndpoints(
  currentBaseUrl: string,
  endpointCandidates: string[],
  preferredBaseUrl: string,
): {
  baseUrl: string;
  endpointCandidates: string[];
} {
  const pool = normalizeEndpointCandidates([currentBaseUrl, ...endpointCandidates, preferredBaseUrl]);
  const baseUrl = normalizeRequiredText(preferredBaseUrl) || normalizeRequiredText(currentBaseUrl);

  return {
    baseUrl,
    endpointCandidates: pool.filter((entry) => entry !== baseUrl),
  };
}

function normalizeReasoningLevels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_REASONING_LEVELS];
  }

  const normalized = value
    .map((entry) => normalizeReasoningLevel(entry))
    .filter((entry): entry is string => Boolean(entry));

  return normalized.length ? [...new Set(normalized)] : [...DEFAULT_REASONING_LEVELS];
}

function normalizeReasoningLevel(value: unknown): string {
  const normalized = normalizeOptionalText(value).toLowerCase();

  if (!normalized) {
    return "";
  }

  return ["none", "minimal", "low", "medium", "high", "xhigh"].includes(normalized) ? normalized : "";
}

function normalizeTruncationMode(value: unknown): "tokens" | "bytes" | null {
  const normalized = normalizeOptionalText(value).toLowerCase();

  if (normalized === "tokens" || normalized === "bytes") {
    return normalized;
  }

  return null;
}

function normalizeWireApi(value: unknown): "responses" | "chat" | null {
  const normalized = normalizeOptionalText(value).toLowerCase();

  if (normalized === "responses" || normalized === "chat") {
    return normalized;
  }

  return null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCreateInteger(value: unknown): number | null {
  const normalized = normalizeOptionalInteger(value);
  return normalized && normalized > 0 ? normalized : null;
}

function deriveDefaultTruncationLimit(contextWindow: number | null, truncationMode: "tokens" | "bytes"): number {
  if (truncationMode === "tokens" && contextWindow && contextWindow > 0) {
    return Math.max(1, Math.floor(contextWindow * 0.9));
  }

  return 900000;
}

function materializeGeneratedModelCatalog(
  cwd: string,
  providerId: string,
  providerName: string,
  models: OpenAICompatibleProviderModelConfig[],
): string {
  const safeProviderId = normalizeProviderId(providerId) || "provider";
  const filePath = join(
    cwd,
    `${GENERATED_PROVIDER_MODEL_CATALOG_PREFIX}.${safeProviderId}.generated.model-catalog.json`,
  );
  const catalog = {
    models: models.map((entry) => buildGeneratedCatalogModel(entry, providerName)),
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return filePath;
}

function buildGeneratedCatalogModel(
  entry: OpenAICompatibleProviderModelConfig,
  providerName: string,
): Record<string, unknown> {
  const profile = resolveModelProfile(entry, providerName);
  const inputModalities = [
    ...(profile.capabilities.nativeTextInput ? ["text"] : []),
    ...(profile.capabilities.nativeImageInput ? ["image"] : []),
    ...(profile.capabilities.nativeDocumentInput ? ["document"] : []),
  ];

  return {
    slug: entry.model,
    display_name: profile.displayName,
    description: profile.description,
    default_reasoning_level: profile.defaultReasoningLevel,
    supported_reasoning_levels: profile.supportedReasoningLevels.map((effort) => ({
      effort,
      description: effort,
    })),
    shell_type: "default",
    visibility: "list",
    supported_in_api: true,
    priority: entry.isDefault ? 0 : 10,
    availability_nux: null,
    upgrade: null,
    base_instructions: "",
    model_messages: null,
    supports_reasoning_summaries: profile.capabilities.supportsReasoningSummaries,
    default_reasoning_summary: "auto",
    support_verbosity: profile.capabilities.supportsVerbosity,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: {
      mode: profile.truncationMode,
      limit: profile.truncationLimit,
    },
    supports_parallel_tool_calls: profile.capabilities.supportsParallelToolCalls,
    supports_image_detail_original: profile.capabilities.supportsImageDetailOriginal,
    ...(profile.contextWindow ? { context_window: profile.contextWindow } : {}),
    experimental_supported_tools: [],
    input_modalities: inputModalities.length ? inputModalities : ["text"],
    native_text_input: profile.capabilities.nativeTextInput,
    native_image_input: profile.capabilities.nativeImageInput,
    native_document_input: profile.capabilities.nativeDocumentInput,
    supported_document_mime_types: profile.capabilities.supportedDocumentMimeTypes,
    supports_pdf_text_extraction: profile.capabilities.supportsPdfTextExtraction,
    supports_document_page_rasterization: profile.capabilities.supportsDocumentPageRasterization,
    supports_search_tool: profile.capabilities.supportsSearchTool,
  };
}

function resolveModelProfile(
  entry: OpenAICompatibleProviderModelConfig,
  providerName: string,
): OpenAICompatibleProviderModelProfile {
  if (entry.profile) {
    return entry.profile;
  }

  return {
    displayName: entry.model,
    description: `${providerName} 提供的兼容模型。`,
    defaultReasoningLevel: "medium",
    supportedReasoningLevels: [...DEFAULT_REASONING_LEVELS],
    contextWindow: null,
    truncationMode: "tokens",
    truncationLimit: deriveDefaultTruncationLimit(null, "tokens"),
    capabilities: createDefaultWriteCapabilities(true),
  };
}

function resolveProviderModelCatalogPath(cwd: string, ...candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeOptionalText(candidate);

    if (!normalized) {
      continue;
    }

    const resolved = isAbsolute(normalized) ? normalized : join(cwd, normalized);

    if (existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOptionalText(entry))
    .filter(Boolean);
}

function normalizeRequiredText(value: unknown): string {
  return normalizeOptionalText(value);
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
