export function createDefaultThirdPartyEndpointProbeState() {
  return {
    status: "idle",
    providerId: "",
    checkedAt: "",
    currentBaseUrl: "",
    selectedBaseUrl: "",
    persisted: false,
    persistedMessage: "",
    summary: "",
    detail: "",
    fastestHealthyLatencyMs: null,
    results: [],
  };
}

export function createThirdPartyEndpointProbeController(app) {
  const { dom, store } = app;

  function bindControls() {
    dom.thirdPartyEndpointProbeButton.addEventListener("click", () => {
      void run();
    });
  }

  function clear() {
    app.runtime.thirdPartyEndpointProbe = createDefaultThirdPartyEndpointProbeState();
  }

  function clearIfProviderChanged(providerId) {
    if (app.runtime.thirdPartyEndpointProbe.providerId === providerId) {
      return;
    }

    clear();
  }

  async function run() {
    const settings = store.getActiveThread()?.settings ?? store.createDefaultThreadSettings();
    const selection = store.resolveThirdPartySelection(settings);
    const providerId = selection.provider?.id || "";

    if (!providerId) {
      return;
    }

    app.runtime.thirdPartyEndpointProbe = {
      ...createDefaultThirdPartyEndpointProbeState(),
      status: "loading",
      providerId,
      currentBaseUrl: selection.provider?.baseUrl || "",
      summary: "正在检测端点。",
      detail: "Themis 会对当前主端点和候选端点逐个做健康检查，并优先挑健康且最快的地址。",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/runtime/third-party/providers/endpoint-probe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "端点检测失败。");
      }

      if (data?.persisted) {
        await app.runtimeConfig.load(true);
      }

      app.runtime.thirdPartyEndpointProbe = normalizeProbeState(data, providerId, selection.provider?.baseUrl || "");
    } catch (error) {
      app.runtime.thirdPartyEndpointProbe = {
        ...createDefaultThirdPartyEndpointProbeState(),
        status: "error",
        providerId,
        checkedAt: new Date().toISOString(),
        currentBaseUrl: selection.provider?.baseUrl || "",
        summary: "端点检测失败。",
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    app.renderer.renderAll();
  }

  return {
    bindControls,
    clear,
    clearIfProviderChanged,
    run,
  };
}

function normalizeProbeState(payload, fallbackProviderId, fallbackBaseUrl) {
  const results = Array.isArray(payload?.results)
    ? payload.results.map(normalizeProbeResult).filter(Boolean)
    : [];

  return {
    ...createDefaultThirdPartyEndpointProbeState(),
    status: normalizeStatus(payload?.status),
    providerId: normalizeOptionalText(payload?.providerId) || fallbackProviderId,
    checkedAt: normalizeOptionalText(payload?.checkedAt) || new Date().toISOString(),
    currentBaseUrl: normalizeOptionalText(payload?.currentBaseUrl) || fallbackBaseUrl,
    selectedBaseUrl: normalizeOptionalText(payload?.selectedBaseUrl),
    persisted: Boolean(payload?.persisted),
    persistedMessage: normalizeOptionalText(payload?.persistedMessage),
    summary: normalizeOptionalText(payload?.summary) || "端点检测已完成。",
    detail: normalizeOptionalText(payload?.detail),
    fastestHealthyLatencyMs: typeof payload?.fastestHealthyLatencyMs === "number" ? payload.fastestHealthyLatencyMs : null,
    results,
  };
}

function normalizeProbeResult(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const endpoint = normalizeOptionalText(value.endpoint);

  if (!endpoint) {
    return null;
  }

  return {
    endpoint,
    ok: Boolean(value.ok),
    latencyMs: typeof value.latencyMs === "number" ? value.latencyMs : null,
    statusCode: typeof value.statusCode === "number" ? value.statusCode : null,
    message: normalizeOptionalText(value.message),
  };
}

function normalizeStatus(value) {
  return ["idle", "loading", "healthy", "error"].includes(value) ? value : "idle";
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
