const FILTER_STATUSES = new Set(["active", "archived", "all"]);
const OBJECT_TYPES = new Set(["asset", "commitment", "decision", "risk", "cadence", "work_item"]);
const RELATION_TYPES = new Set([
  "relates_to",
  "depends_on",
  "mitigates",
  "tracks",
  "blocks",
  "supersedes",
  "evidence_for",
]);
const EDGE_STATUSES = new Set(["active", "archived"]);

export function createDefaultOperationsEdgesState() {
  return {
    status: "idle",
    loading: false,
    submitting: false,
    errorMessage: "",
    noticeMessage: "",
    filterStatus: "active",
    edges: [],
    selectedEdgeId: "",
    draft: createDefaultDraft(),
  };
}

export function createOperationsEdgesController(app) {
  const { dom, utils } = app;
  let controlsBound = false;
  let loadRequestId = 0;

  function bindControls() {
    if (controlsBound) {
      return;
    }

    controlsBound = true;
    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already reflected in operationsEdges state for the UI.
      }
    };

    dom?.operationsEdgesRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.operationsEdgesNewButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsEdgesFilterSelect?.addEventListener("change", () => {
      setState({
        filterStatus: normalizeFilterStatus(dom.operationsEdgesFilterSelect?.value),
        noticeMessage: "",
      });
      render();
      void runSafely(load);
    });

    dom?.operationsEdgesFromTypeSelect?.addEventListener("change", () => {
      updateDraft({
        fromObjectType: normalizeObjectType(dom.operationsEdgesFromTypeSelect?.value),
      });
    });

    dom?.operationsEdgesFromIdInput?.addEventListener("input", () => {
      updateDraft({
        fromObjectId: dom.operationsEdgesFromIdInput.value,
      });
    });

    dom?.operationsEdgesToTypeSelect?.addEventListener("change", () => {
      updateDraft({
        toObjectType: normalizeObjectType(dom.operationsEdgesToTypeSelect?.value),
      });
    });

    dom?.operationsEdgesToIdInput?.addEventListener("input", () => {
      updateDraft({
        toObjectId: dom.operationsEdgesToIdInput.value,
      });
    });

    dom?.operationsEdgesRelationSelect?.addEventListener("change", () => {
      updateDraft({
        relationType: normalizeRelationType(dom.operationsEdgesRelationSelect?.value),
      });
    });

    dom?.operationsEdgesStatusSelect?.addEventListener("change", () => {
      updateDraft({
        status: normalizeStatus(dom.operationsEdgesStatusSelect?.value),
      });
    });

    dom?.operationsEdgesLabelInput?.addEventListener("input", () => {
      updateDraft({
        label: dom.operationsEdgesLabelInput.value,
      });
    });

    dom?.operationsEdgesSummaryInput?.addEventListener("input", () => {
      updateDraft({
        summary: dom.operationsEdgesSummaryInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsEdgesSummaryInput);
    });

    dom?.operationsEdgesSaveButton?.addEventListener("click", () => {
      void runSafely(save);
    });

    dom?.operationsEdgesResetButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsEdgesList?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-operations-edge-id]");
      const edgeId = normalizeText(button?.dataset?.operationsEdgeId);

      if (!edgeId) {
        return;
      }

      selectEdge(edgeId);
    });
  }

  function setState(patch) {
    app.runtime.operationsEdges = {
      ...app.runtime.operationsEdges,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateDraft(patch) {
    const current = app.runtime.operationsEdges ?? createDefaultOperationsEdgesState();
    setState({
      draft: {
        ...current.draft,
        ...patch,
      },
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  function resetDraft() {
    const current = app.runtime.operationsEdges ?? createDefaultOperationsEdgesState();
    setState({
      selectedEdgeId: "",
      draft: createDefaultDraft(),
      errorMessage: "",
      noticeMessage: current.noticeMessage,
    });
    render();
  }

  function selectEdge(edgeId) {
    const current = app.runtime.operationsEdges ?? createDefaultOperationsEdgesState();
    const edge = current.edges.find((item) => normalizeText(item?.edgeId) === edgeId);

    if (!edge) {
      return;
    }

    setState({
      selectedEdgeId: edge.edgeId,
      draft: buildDraftFromEdge(edge),
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const current = app.runtime.operationsEdges ?? createDefaultOperationsEdgesState();
    const preserveNoticeMessage = options.preserveNoticeMessage === true;

    setState({
      loading: true,
      errorMessage: "",
      ...(preserveNoticeMessage ? {} : { noticeMessage: "" }),
    });
    render();

    try {
      const payload = {
        ...buildIdentityPayload(app),
        ...(current.filterStatus !== "all" ? { status: current.filterStatus } : {}),
      };
      const response = await fetch("/api/operations/edges/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取关系边失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.operationsEdges;
      }

      const edges = normalizeEdgeList(data?.edges);
      const selectedEdgeId = normalizeText(current.selectedEdgeId) ?? "";
      const selectedEdge = selectedEdgeId
        ? edges.find((item) => item.edgeId === selectedEdgeId) ?? null
        : null;
      const syncDraftFromSelected = options.syncDraftFromSelected === true;

      setState({
        status: "ready",
        edges,
        loading: false,
        errorMessage: "",
        ...(syncDraftFromSelected
          ? {
            selectedEdgeId: selectedEdge?.edgeId ?? "",
            draft: selectedEdge ? buildDraftFromEdge(selectedEdge) : createDefaultDraft(),
          }
          : {}),
      });
      render();
      return app.runtime.operationsEdges;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.operationsEdges;
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

  async function save() {
    const current = app.runtime.operationsEdges ?? createDefaultOperationsEdgesState();
    const selectedEdgeId = normalizeText(current.selectedEdgeId);
    const payloadEdge = buildEdgePayloadFromDraft(current.draft);
    const creating = !selectedEdgeId;

    setState({
      submitting: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch(creating ? "/api/operations/edges/create" : "/api/operations/edges/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildIdentityPayload(app),
          edge: {
            ...(selectedEdgeId ? { edgeId: selectedEdgeId } : {}),
            ...payloadEdge,
          },
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存关系边失败。");
      }

      const savedEdge = normalizeEdgeRecord(data?.edge);
      const nextFilterStatus = savedEdge
        ? resolvePostSaveFilterStatus(current.filterStatus, savedEdge.status)
        : current.filterStatus;

      setState({
        submitting: false,
        errorMessage: "",
        noticeMessage: creating ? "已新建关系边。" : "已更新关系边。",
        filterStatus: nextFilterStatus,
        selectedEdgeId: savedEdge?.edgeId ?? "",
        ...(savedEdge ? { draft: buildDraftFromEdge(savedEdge) } : {}),
      });
      render();

      await load({
        preserveNoticeMessage: true,
        syncDraftFromSelected: true,
      });
      return app.runtime.operationsEdges;
    } catch (error) {
      setState({
        submitting: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  return {
    bindControls,
    load,
    save,
    resetDraft,
    selectEdge,
  };
}

function createDefaultDraft() {
  return {
    fromObjectType: "decision",
    fromObjectId: "",
    toObjectType: "risk",
    toObjectId: "",
    relationType: "relates_to",
    status: "active",
    label: "",
    summary: "",
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

function buildEdgePayloadFromDraft(draft) {
  return {
    fromObjectType: normalizeObjectType(draft?.fromObjectType),
    fromObjectId: normalizeRequiredText(draft?.fromObjectId, "关系边起点 id 不能为空。"),
    toObjectType: normalizeObjectType(draft?.toObjectType),
    toObjectId: normalizeRequiredText(draft?.toObjectId, "关系边终点 id 不能为空。"),
    relationType: normalizeRelationType(draft?.relationType),
    status: normalizeStatus(draft?.status),
    ...(normalizeText(draft?.label) ? { label: normalizeText(draft?.label) } : {}),
    summary: typeof draft?.summary === "string" ? draft.summary.trim() : "",
  };
}

function buildDraftFromEdge(edge) {
  return {
    fromObjectType: normalizeObjectType(edge.fromObjectType),
    fromObjectId: edge.fromObjectId ?? "",
    toObjectType: normalizeObjectType(edge.toObjectType),
    toObjectId: edge.toObjectId ?? "",
    relationType: normalizeRelationType(edge.relationType),
    status: normalizeStatus(edge.status),
    label: edge.label ?? "",
    summary: edge.summary ?? "",
  };
}

function normalizeEdgeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeEdgeRecord)
    .filter(Boolean);
}

function normalizeEdgeRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const edgeId = normalizeText(value.edgeId);
  const principalId = normalizeText(value.principalId);
  const fromObjectType = normalizeObjectType(value.fromObjectType);
  const fromObjectId = normalizeText(value.fromObjectId);
  const toObjectType = normalizeObjectType(value.toObjectType);
  const toObjectId = normalizeText(value.toObjectId);
  const relationType = normalizeRelationType(value.relationType);
  const status = normalizeStatus(value.status);
  const label = normalizeText(value.label);
  const summary = normalizeText(value.summary);

  if (!edgeId || !principalId || !fromObjectId || !toObjectId) {
    return null;
  }

  return {
    edgeId,
    principalId,
    fromObjectType,
    fromObjectId,
    toObjectType,
    toObjectId,
    relationType,
    status,
    ...(label ? { label } : {}),
    ...(summary ? { summary } : {}),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizeFilterStatus(value) {
  return FILTER_STATUSES.has(value) ? value : "active";
}

function normalizeObjectType(value) {
  return OBJECT_TYPES.has(value) ? value : "asset";
}

function normalizeRelationType(value) {
  return RELATION_TYPES.has(value) ? value : "relates_to";
}

function normalizeStatus(value) {
  return EDGE_STATUSES.has(value) ? value : "active";
}

function normalizeRequiredText(value, message) {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function resolvePostSaveFilterStatus(currentFilterStatus, edgeStatus) {
  if (currentFilterStatus === "all" || currentFilterStatus === edgeStatus) {
    return currentFilterStatus;
  }

  return edgeStatus;
}
