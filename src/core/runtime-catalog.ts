import type {
  CodexRuntimeCatalog,
  CodexRuntimeModel,
  CodexRuntimeThirdPartyProvider,
} from "./codex-app-server.js";
import type { OpenAICompatibleProviderConfig } from "./openai-compatible-provider.js";

export function createUnifiedRuntimeCatalog(
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
      nativeTextInput: modelProfile?.capabilities.nativeTextInput ?? (modelProfile?.capabilities.textInput ?? true),
      nativeImageInput: modelProfile?.capabilities.nativeImageInput ?? (modelProfile?.capabilities.imageInput ?? false),
      nativeDocumentInput: modelProfile?.capabilities.nativeDocumentInput ?? false,
      supportedDocumentMimeTypes: [...(modelProfile?.capabilities.supportedDocumentMimeTypes ?? [])],
      supportsPdfTextExtraction: modelProfile?.capabilities.supportsPdfTextExtraction ?? false,
      supportsDocumentPageRasterization: modelProfile?.capabilities.supportsDocumentPageRasterization ?? false,
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
