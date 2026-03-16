function createDefaultRuntimeDefaults() {
  return {
    model: "",
    reasoning: "",
    approvalPolicy: "",
  };
}

export function createDefaultRuntimeConfigState() {
  return {
    status: "idle",
    errorMessage: "",
    models: [],
    defaults: createDefaultRuntimeDefaults(),
  };
}

export function createRuntimeConfigController(app) {
  async function load() {
    const currentState = app.runtime.runtimeConfig;

    if (currentState.status === "loading" || currentState.status === "ready") {
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

  return {
    status: "ready",
    errorMessage: "",
    models,
    defaults: {
      model: fallbackDefaultModel,
      reasoning: normalizeOptionalText(defaults.reasoning),
      approvalPolicy: normalizeOptionalText(defaults.approvalPolicy),
    },
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

function isRecord(value) {
  return typeof value === "object" && value !== null;
}
