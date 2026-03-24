export function createDefaultThirdPartyProbeState() {
  return {
    status: "idle",
    providerId: "",
    model: "",
    checkedAt: "",
    supported: false,
    commandExecuted: false,
    observedCommand: "",
    summary: "",
    detail: "",
    errorMessage: "",
    outputPreview: "",
    persistStatus: "idle",
    persistMessage: "",
  };
}

export function createThirdPartyProbeController(app) {
  const { dom, store } = app;

  function bindControls() {
    dom.thirdPartyProbeButton.addEventListener("click", () => {
      void run();
    });

    dom.thirdPartyProbeApplyButton.addEventListener("click", () => {
      void applyProbeResult();
    });
  }

  function clear() {
    app.runtime.thirdPartyProbe = createDefaultThirdPartyProbeState();
  }

  function clearIfSelectionChanged(providerId, model) {
    const probe = app.runtime.thirdPartyProbe;

    if (probe.providerId === providerId && probe.model === model) {
      return;
    }

    clear();
  }

  async function run() {
    const settings = store.getActiveThread()?.settings ?? store.createDefaultThreadSettings();
    const selection = store.resolveThirdPartySelection(settings);
    const providerId = selection.provider?.id || "";
    const model = selection.model?.model || selection.modelId || "";

    if (!providerId || !model) {
      return;
    }

    app.runtime.thirdPartyProbe = {
      ...createDefaultThirdPartyProbeState(),
      status: "loading",
      providerId,
      model,
      summary: "正在测试兼容性。",
      detail: "这会触发一次只读命令执行，用来确认模型能不能跑真实的 Codex 任务。",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/runtime/third-party/probe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          model,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "兼容性测试失败。");
      }

      app.runtime.thirdPartyProbe = normalizeProbeState(data, providerId, model);
    } catch (error) {
      app.runtime.thirdPartyProbe = {
        ...createDefaultThirdPartyProbeState(),
        status: "error",
        providerId,
        model,
        checkedAt: new Date().toISOString(),
        summary: "兼容性测试失败。",
        detail: error instanceof Error ? error.message : String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    app.renderer.renderAll();
  }

  async function applyProbeResult() {
    const settings = store.getActiveThread()?.settings ?? store.createDefaultThreadSettings();
    const selection = store.resolveThirdPartySelection(settings);
    const providerId = selection.provider?.id || "";
    const model = selection.model?.model || selection.modelId || "";
    const probe = app.runtime.thirdPartyProbe;

    if (!providerId || !model || !matchesCurrentSelection(probe, providerId, model)) {
      return;
    }

    if (!["supported", "unsupported"].includes(probe.status)) {
      return;
    }

    app.runtime.thirdPartyProbe = {
      ...probe,
      persistStatus: "saving",
      persistMessage: "正在把本次测试结果写回本地模型能力配置。",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/runtime/third-party/codex-task-support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          model,
          supportsCodexTasks: probe.status === "supported",
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "写回模型能力失败。");
      }

      await app.runtimeConfig.load(true);

      app.runtime.thirdPartyProbe = {
        ...app.runtime.thirdPartyProbe,
        persistStatus: "saved",
        persistMessage: typeof data?.message === "string" ? data.message : "已写回本地模型能力配置。",
      };
    } catch (error) {
      app.runtime.thirdPartyProbe = {
        ...app.runtime.thirdPartyProbe,
        persistStatus: "error",
        persistMessage: error instanceof Error ? error.message : String(error),
      };
    }

    app.renderer.renderAll();
  }

  return {
    bindControls,
    clear,
    clearIfSelectionChanged,
    applyProbeResult,
    run,
  };
}

function matchesCurrentSelection(probe, providerId, model) {
  return probe.providerId === providerId && probe.model === model;
}

function normalizeProbeState(payload, fallbackProviderId, fallbackModel) {
  const status = normalizeStatus(payload?.status);

  return {
    ...createDefaultThirdPartyProbeState(),
    status,
    providerId: normalizeOptionalText(payload?.providerId) || fallbackProviderId,
    model: normalizeOptionalText(payload?.model) || fallbackModel,
    checkedAt: normalizeOptionalText(payload?.checkedAt) || new Date().toISOString(),
    supported: Boolean(payload?.supported),
    commandExecuted: Boolean(payload?.commandExecuted),
    observedCommand: normalizeOptionalText(payload?.observedCommand),
    summary: normalizeOptionalText(payload?.summary) || "兼容性测试已完成。",
    detail: normalizeOptionalText(payload?.detail),
    errorMessage: normalizeOptionalText(payload?.errorMessage),
    outputPreview: normalizeOptionalText(payload?.outputPreview),
  };
}

function normalizeStatus(value) {
  return ["idle", "loading", "supported", "unsupported", "inconclusive", "error"].includes(value)
    ? value
    : "idle";
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
