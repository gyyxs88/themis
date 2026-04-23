export function createDefaultOperationsBossViewState() {
  return {
    status: "idle",
    loading: false,
    errorMessage: "",
    noticeMessage: "",
    bossView: null,
  };
}

export function createOperationsBossViewController(app) {
  const { dom } = app;
  let controlsBound = false;
  let loadRequestId = 0;

  function bindControls() {
    if (controlsBound) {
      return;
    }

    controlsBound = true;
    dom?.operationsBossViewRefreshButton?.addEventListener("click", () => {
      void load();
    });
  }

  function setState(patch) {
    app.runtime.operationsBossView = {
      ...app.runtime.operationsBossView,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const preserveNoticeMessage = options.preserveNoticeMessage === true;

    setState({
      loading: true,
      errorMessage: "",
      ...(preserveNoticeMessage ? {} : { noticeMessage: "" }),
    });
    render();

    try {
      const response = await fetch("/api/operations/boss-view", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildIdentityPayload(app)),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取老板视图失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.operationsBossView;
      }

      setState({
        status: "ready",
        loading: false,
        errorMessage: "",
        noticeMessage: "老板视图已刷新。",
        bossView: normalizeBossView(data?.bossView),
      });
      render();
      return app.runtime.operationsBossView;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.operationsBossView;
      }

      setState({
        status: "error",
        loading: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  return {
    bindControls,
    load,
  };
}

function buildIdentityPayload(app) {
  const browserUserId = normalizeText(app.runtime?.identity?.browserUserId) || "web-browser";
  const displayName = normalizeText(app.runtime?.auth?.account?.email) || "Web Owner";

  return {
    channel: "web",
    channelUserId: browserUserId,
    displayName,
  };
}

function normalizeBossView(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    principalId: normalizeText(value.principalId) || "",
    generatedAt: normalizeText(value.generatedAt) || "",
    headline: normalizeHeadline(value.headline),
    metrics: normalizeArray(value.metrics).map(normalizeMetric),
    focusItems: normalizeArray(value.focusItems).map(normalizeFocusItem),
    relationItems: normalizeArray(value.relationItems).map(normalizeRelationItem),
    recentDecisions: normalizeArray(value.recentDecisions).map(normalizeDecisionItem),
    inventory: value.inventory && typeof value.inventory === "object" ? value.inventory : {},
  };
}

function normalizeHeadline(value) {
  if (!value || typeof value !== "object") {
    return {
      tone: "neutral",
      title: "",
      summary: "",
    };
  }

  return {
    tone: normalizeTone(value.tone),
    title: normalizeText(value.title) || "",
    summary: normalizeText(value.summary) || "",
  };
}

function normalizeMetric(value) {
  const metric = value && typeof value === "object" ? value : {};

  return {
    key: normalizeText(metric.key) || "",
    label: normalizeText(metric.label) || "",
    value: normalizeNumber(metric.value),
    tone: normalizeTone(metric.tone),
    detail: normalizeText(metric.detail) || "",
  };
}

function normalizeFocusItem(value) {
  const item = value && typeof value === "object" ? value : {};

  return {
    objectType: normalizeText(item.objectType) || "",
    objectId: normalizeText(item.objectId) || "",
    title: normalizeText(item.title) || "",
    label: normalizeText(item.label) || "",
    tone: normalizeTone(item.tone),
    summary: normalizeText(item.summary) || "",
    actionLabel: normalizeText(item.actionLabel) || "",
  };
}

function normalizeRelationItem(value) {
  const item = value && typeof value === "object" ? value : {};

  return {
    edgeId: normalizeText(item.edgeId) || "",
    relationType: normalizeText(item.relationType) || "",
    tone: normalizeTone(item.tone),
    label: normalizeText(item.label) || "",
    fromLabel: normalizeText(item.fromLabel) || "",
    toLabel: normalizeText(item.toLabel) || "",
    summary: normalizeText(item.summary) || "",
  };
}

function normalizeDecisionItem(value) {
  const item = value && typeof value === "object" ? value : {};

  return {
    decisionId: normalizeText(item.decisionId) || "",
    title: normalizeText(item.title) || "",
    status: normalizeText(item.status) || "",
    decidedAt: normalizeText(item.decidedAt) || "",
    summary: normalizeText(item.summary) || "",
  };
}

function normalizeTone(value) {
  const normalized = normalizeText(value);

  if (["green", "amber", "red", "neutral"].includes(normalized)) {
    return normalized;
  }

  return "neutral";
}

function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
