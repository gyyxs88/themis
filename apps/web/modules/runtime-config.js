function createDefaultRuntimeDefaults() {
  return {
    profile: "",
    model: "",
    reasoning: "",
    approvalPolicy: "",
    sandboxMode: "",
    webSearchMode: "",
    networkAccessEnabled: null,
  };
}

function createDefaultPersona() {
  return {
    id: "",
    label: "",
    description: "",
    vibe: "",
  };
}

function createDefaultRuntimeProvider() {
  return {
    type: "",
    name: "",
    baseUrl: "",
    model: "",
    lockedModel: false,
  };
}

function createDefaultProviderCapabilities() {
  return {
    available: false,
    namespaceTools: null,
    imageGeneration: null,
    webSearch: null,
    readError: "",
  };
}

function createDefaultRuntimeHooks() {
  return {
    entries: [],
    totalHookCount: 0,
    enabledHookCount: 0,
    warningCount: 0,
    errorCount: 0,
    readError: "",
  };
}

function createDefaultAccessMode(id = "") {
  return {
    id,
    label: "",
    description: "",
  };
}

function createDefaultModelCapabilities(supportsCodexTasks = true) {
  return {
    textInput: true,
    imageInput: false,
    supportsCodexTasks,
    supportsReasoningSummaries: false,
    supportsVerbosity: false,
    supportsParallelToolCalls: false,
    supportsSearchTool: false,
    supportsImageDetailOriginal: false,
  };
}

function createDefaultThirdPartyProvider() {
  return {
    id: "",
    type: "",
    name: "",
    baseUrl: "",
    endpointCandidates: [],
    source: "",
    wireApi: "",
    supportsWebsockets: null,
    lockedModel: false,
    defaultModel: "",
    models: [],
  };
}

export function createDefaultRuntimeConfigState() {
  return {
    status: "idle",
    errorMessage: "",
    models: [],
    defaults: createDefaultRuntimeDefaults(),
    provider: createDefaultRuntimeProvider(),
    providerCapabilities: createDefaultProviderCapabilities(),
    runtimeHooks: createDefaultRuntimeHooks(),
    accessModes: [createDefaultAccessMode("auth")],
    thirdPartyProviders: [],
    personas: [],
  };
}

export function createRuntimeConfigController(app) {
  async function load(force = false) {
    const currentState = app.runtime.runtimeConfig;

    if (!force && (currentState.status === "loading" || currentState.status === "ready")) {
      return;
    }

    app.runtime.runtimeConfig = {
      ...createDefaultRuntimeConfigState(),
      status: "loading",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/runtime/config");
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取 Codex 运行配置失败。");
      }

      app.runtime.runtimeConfig = normalizeRuntimeConfigState(data);
    } catch (error) {
      app.runtime.runtimeConfig = {
        ...createDefaultRuntimeConfigState(),
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    app.renderer.renderAll();
  }

  return {
    load,
  };
}

function normalizeRuntimeConfigState(payload) {
  const models = Array.isArray(payload?.models) ? payload.models.map(normalizeModel).filter(Boolean) : [];
  const defaults = isRecord(payload?.defaults) ? payload.defaults : {};
  const explicitDefaultModel = normalizeOptionalText(defaults.model);
  const fallbackDefaultModel = explicitDefaultModel || models.find((model) => model.isDefault)?.model || models[0]?.model || "";
  const thirdPartyProviders = Array.isArray(payload?.thirdPartyProviders)
    ? payload.thirdPartyProviders.map(normalizeThirdPartyProvider).filter(Boolean)
    : [];
  const personas = Array.isArray(payload?.personas)
    ? payload.personas.map(normalizePersona).filter(Boolean)
    : [];

  return {
    status: "ready",
    errorMessage: "",
    models,
    defaults: {
      profile: normalizeOptionalText(defaults.profile) || personas[0]?.id || "",
      model: fallbackDefaultModel,
      reasoning: normalizeOptionalText(defaults.reasoning),
      approvalPolicy: normalizeOptionalText(defaults.approvalPolicy),
      sandboxMode: normalizeOptionalText(defaults.sandboxMode),
      webSearchMode: normalizeOptionalText(defaults.webSearchMode),
      networkAccessEnabled: normalizeOptionalBoolean(defaults.networkAccessEnabled),
    },
    provider: normalizeProvider(payload?.provider),
    providerCapabilities: normalizeProviderCapabilities(payload?.providerCapabilities),
    runtimeHooks: normalizeRuntimeHooks(payload?.runtimeHooks),
    accessModes: normalizeAccessModes(payload?.accessModes, thirdPartyProviders),
    thirdPartyProviders,
    personas,
  };
}

function normalizeModel(value) {
  if (!isRecord(value)) {
    return null;
  }

  const model = normalizeOptionalText(value.model) || normalizeOptionalText(value.id);

  if (!model) {
    return null;
  }

  const capabilities = normalizeModelCapabilities(value, value.supportsCodexTasks !== false);

  return {
    id: normalizeOptionalText(value.id) || model,
    model,
    displayName: normalizeOptionalText(value.displayName) || model,
    description: normalizeOptionalText(value.description),
    hidden: Boolean(value.hidden),
    supportedReasoningEfforts: Array.isArray(value.supportedReasoningEfforts)
      ? value.supportedReasoningEfforts.map(normalizeReasoningOption).filter(Boolean)
      : [],
    defaultReasoningEffort: normalizeOptionalText(value.defaultReasoningEffort),
    contextWindow: normalizeOptionalNumber(value.contextWindow ?? value.context_window),
    capabilities,
    supportsPersonality: Boolean(value.supportsPersonality),
    supportsCodexTasks: capabilities.supportsCodexTasks,
    isDefault: Boolean(value.isDefault),
  };
}

function normalizeReasoningOption(value) {
  if (!isRecord(value)) {
    return null;
  }

  const reasoningEffort = normalizeOptionalText(value.reasoningEffort);

  if (!reasoningEffort) {
    return null;
  }

  return {
    reasoningEffort,
    description: normalizeOptionalText(value.description) || reasoningEffort,
  };
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeOptionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOptionalText(entry))
    .filter(Boolean);
}

function normalizeOptionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeModelCapabilities(value, fallbackSupportsCodexTasks = true) {
  const source = isRecord(value?.capabilities) ? value.capabilities : {};
  const supportsCodexTasks = normalizeOptionalBoolean(source.supportsCodexTasks)
    ?? normalizeOptionalBoolean(value?.supportsCodexTasks)
    ?? fallbackSupportsCodexTasks;

  return {
    ...createDefaultModelCapabilities(supportsCodexTasks),
    ...(normalizeOptionalBoolean(source.textInput) !== null
      ? { textInput: Boolean(source.textInput) }
      : normalizeOptionalBoolean(value?.textInput) !== null
        ? { textInput: Boolean(value.textInput) }
        : {}),
    ...(normalizeOptionalBoolean(source.imageInput) !== null
      ? { imageInput: Boolean(source.imageInput) }
      : normalizeOptionalBoolean(value?.imageInput) !== null
        ? { imageInput: Boolean(value.imageInput) }
        : {}),
    supportsCodexTasks,
    ...(normalizeOptionalBoolean(source.supportsReasoningSummaries) !== null
      ? { supportsReasoningSummaries: Boolean(source.supportsReasoningSummaries) }
      : normalizeOptionalBoolean(value?.supportsReasoningSummaries) !== null
        ? { supportsReasoningSummaries: Boolean(value.supportsReasoningSummaries) }
      : {}),
    ...(normalizeOptionalBoolean(source.supportsVerbosity) !== null
      ? { supportsVerbosity: Boolean(source.supportsVerbosity) }
      : normalizeOptionalBoolean(value?.supportsVerbosity) !== null
        ? { supportsVerbosity: Boolean(value.supportsVerbosity) }
        : {}),
    ...(normalizeOptionalBoolean(source.supportsParallelToolCalls) !== null
      ? { supportsParallelToolCalls: Boolean(source.supportsParallelToolCalls) }
      : normalizeOptionalBoolean(value?.supportsParallelToolCalls) !== null
        ? { supportsParallelToolCalls: Boolean(value.supportsParallelToolCalls) }
      : {}),
    ...(normalizeOptionalBoolean(source.supportsSearchTool) !== null
      ? { supportsSearchTool: Boolean(source.supportsSearchTool) }
      : normalizeOptionalBoolean(value?.supportsSearchTool) !== null
        ? { supportsSearchTool: Boolean(value.supportsSearchTool) }
        : {}),
    ...(normalizeOptionalBoolean(source.supportsImageDetailOriginal) !== null
      ? { supportsImageDetailOriginal: Boolean(source.supportsImageDetailOriginal) }
      : normalizeOptionalBoolean(value?.supportsImageDetailOriginal) !== null
        ? { supportsImageDetailOriginal: Boolean(value.supportsImageDetailOriginal) }
      : {}),
  };
}

function normalizeProvider(value) {
  if (!isRecord(value)) {
    return createDefaultRuntimeProvider();
  }

  return {
    type: normalizeOptionalText(value.type),
    name: normalizeOptionalText(value.name),
    baseUrl: normalizeOptionalText(value.baseUrl),
    model: normalizeOptionalText(value.model),
    lockedModel: Boolean(value.lockedModel),
  };
}

function normalizeProviderCapabilities(value) {
  if (!isRecord(value)) {
    return createDefaultProviderCapabilities();
  }

  return {
    available: Boolean(value.available),
    namespaceTools: normalizeOptionalBoolean(value.namespaceTools),
    imageGeneration: normalizeOptionalBoolean(value.imageGeneration),
    webSearch: normalizeOptionalBoolean(value.webSearch),
    readError: normalizeOptionalText(value.readError),
  };
}

function normalizeRuntimeHooks(value) {
  if (!isRecord(value)) {
    return createDefaultRuntimeHooks();
  }

  return {
    entries: Array.isArray(value.entries) ? value.entries.map(normalizeRuntimeHookEntry).filter(Boolean) : [],
    totalHookCount: normalizeCount(value.totalHookCount),
    enabledHookCount: normalizeCount(value.enabledHookCount),
    warningCount: normalizeCount(value.warningCount),
    errorCount: normalizeCount(value.errorCount),
    readError: normalizeOptionalText(value.readError),
  };
}

function normalizeRuntimeHookEntry(value) {
  if (!isRecord(value)) {
    return null;
  }

  const cwd = normalizeOptionalText(value.cwd);

  if (!cwd) {
    return null;
  }

  return {
    cwd,
    hooks: Array.isArray(value.hooks) ? value.hooks.map(normalizeRuntimeHook).filter(Boolean) : [],
    warnings: normalizeTextArray(value.warnings),
    errors: Array.isArray(value.errors) ? value.errors.map(normalizeRuntimeHookError).filter(Boolean) : [],
  };
}

function normalizeRuntimeHook(value) {
  if (!isRecord(value)) {
    return null;
  }

  const key = normalizeOptionalText(value.key);

  if (!key) {
    return null;
  }

  return {
    key,
    eventName: normalizeOptionalText(value.eventName),
    handlerType: normalizeOptionalText(value.handlerType),
    matcher: normalizeOptionalText(value.matcher),
    command: normalizeOptionalText(value.command),
    timeoutSec: normalizeOptionalNumber(value.timeoutSec),
    statusMessage: normalizeOptionalText(value.statusMessage),
    sourcePath: normalizeOptionalText(value.sourcePath),
    source: normalizeOptionalText(value.source),
    pluginId: normalizeOptionalText(value.pluginId),
    displayOrder: normalizeOptionalNumber(value.displayOrder),
    enabled: Boolean(value.enabled),
    isManaged: Boolean(value.isManaged),
  };
}

function normalizeRuntimeHookError(value) {
  if (!isRecord(value)) {
    return null;
  }

  const path = normalizeOptionalText(value.path);
  const message = normalizeOptionalText(value.message);

  if (!path || !message) {
    return null;
  }

  return {
    path,
    message,
  };
}

function normalizeCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeAccessModes(value, thirdPartyProviders) {
  const modes = Array.isArray(value)
    ? value.map(normalizeAccessMode).filter(Boolean)
    : [];

  if (!modes.some((mode) => mode.id === "auth")) {
    modes.unshift({
      id: "auth",
      label: "认证",
      description: "通过 Codex / ChatGPT 认证运行任务。",
    });
  }

  if (thirdPartyProviders.length && !modes.some((mode) => mode.id === "third-party")) {
    modes.push({
      id: "third-party",
      label: "第三方",
      description: "通过 OpenAI 兼容供应商运行任务。",
    });
  }

  return modes;
}

function normalizeAccessMode(value) {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeOptionalText(value.id);

  if (!id) {
    return null;
  }

  return {
    id,
    label: normalizeOptionalText(value.label) || id,
    description: normalizeOptionalText(value.description),
  };
}

function normalizeThirdPartyProvider(value) {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeOptionalText(value.id);

  if (!id) {
    return null;
  }

  const models = Array.isArray(value.models) ? value.models.map(normalizeModel).filter(Boolean) : [];
  const explicitDefaultModel = normalizeOptionalText(value.defaultModel);
  const fallbackDefaultModel = explicitDefaultModel || models.find((model) => model.isDefault)?.model || models[0]?.model || "";

  return {
    id,
    type: normalizeOptionalText(value.type),
    name: normalizeOptionalText(value.name) || id,
    baseUrl: normalizeOptionalText(value.baseUrl),
    endpointCandidates: normalizeTextArray(value.endpointCandidates),
    source: normalizeOptionalText(value.source),
    wireApi: normalizeOptionalText(value.wireApi),
    supportsWebsockets: normalizeOptionalBoolean(value.supportsWebsockets),
    lockedModel: Boolean(value.lockedModel),
    defaultModel: fallbackDefaultModel,
    models,
  };
}

function normalizePersona(value) {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeOptionalText(value.id);

  if (!id) {
    return null;
  }

  return {
    ...createDefaultPersona(),
    id,
    label: normalizeOptionalText(value.label) || id,
    description: normalizeOptionalText(value.description),
    vibe: normalizeOptionalText(value.vibe),
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}
