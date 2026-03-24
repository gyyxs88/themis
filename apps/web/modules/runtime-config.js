function createDefaultRuntimeDefaults() {
  return {
    model: "",
    reasoning: "",
    approvalPolicy: "",
    sandboxMode: "",
    webSearchMode: "",
    networkAccessEnabled: null,
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

function createDefaultAccessMode(id = "") {
  return {
    id,
    label: "",
    description: "",
  };
}

function createDefaultThirdPartyProvider() {
  return {
    id: "",
    type: "",
    name: "",
    baseUrl: "",
    source: "",
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
    accessModes: [createDefaultAccessMode("auth")],
    thirdPartyProviders: [],
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

  return {
    status: "ready",
    errorMessage: "",
    models,
    defaults: {
      model: fallbackDefaultModel,
      reasoning: normalizeOptionalText(defaults.reasoning),
      approvalPolicy: normalizeOptionalText(defaults.approvalPolicy),
      sandboxMode: normalizeOptionalText(defaults.sandboxMode),
      webSearchMode: normalizeOptionalText(defaults.webSearchMode),
      networkAccessEnabled: normalizeOptionalBoolean(defaults.networkAccessEnabled),
    },
    provider: normalizeProvider(payload?.provider),
    accessModes: normalizeAccessModes(payload?.accessModes, thirdPartyProviders),
    thirdPartyProviders,
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
    supportsPersonality: Boolean(value.supportsPersonality),
    supportsCodexTasks: value.supportsCodexTasks !== false,
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
    source: normalizeOptionalText(value.source),
    lockedModel: Boolean(value.lockedModel),
    defaultModel: fallbackDefaultModel,
    models,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}
