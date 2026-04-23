const OBJECT_TYPES = new Set(["asset", "commitment", "decision", "risk", "cadence", "work_item"]);
const DEPTHS = new Set(["1", "2", "3", "4"]);

export function createDefaultOperationsGraphState() {
  return {
    status: "idle",
    loading: false,
    errorMessage: "",
    noticeMessage: "",
    rootObjectType: "commitment",
    rootObjectId: "",
    targetObjectType: "asset",
    targetObjectId: "",
    maxDepth: "2",
    graph: null,
  };
}

export function createOperationsGraphController(app) {
  const { dom } = app;
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
        // Errors are already reflected in operationsGraph state for the UI.
      }
    };

    dom?.operationsGraphRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.operationsGraphRootTypeSelect?.addEventListener("change", () => {
      updateDraft({ rootObjectType: normalizeObjectType(dom.operationsGraphRootTypeSelect.value) });
    });

    dom?.operationsGraphRootIdInput?.addEventListener("input", () => {
      updateDraft({ rootObjectId: dom.operationsGraphRootIdInput.value });
    });

    dom?.operationsGraphTargetTypeSelect?.addEventListener("change", () => {
      updateDraft({ targetObjectType: normalizeObjectType(dom.operationsGraphTargetTypeSelect.value) });
    });

    dom?.operationsGraphTargetIdInput?.addEventListener("input", () => {
      updateDraft({ targetObjectId: dom.operationsGraphTargetIdInput.value });
    });

    dom?.operationsGraphDepthSelect?.addEventListener("change", () => {
      updateDraft({ maxDepth: normalizeDepth(dom.operationsGraphDepthSelect.value) });
    });
  }

  function setState(patch) {
    app.runtime.operationsGraph = {
      ...app.runtime.operationsGraph,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateDraft(patch) {
    setState({
      ...patch,
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  async function load() {
    const requestId = ++loadRequestId;
    const current = app.runtime.operationsGraph ?? createDefaultOperationsGraphState();
    const rootObjectId = normalizeText(current.rootObjectId);

    if (!rootObjectId) {
      setState({
        status: "idle",
        loading: false,
        errorMessage: "请先填写根对象 id。",
        noticeMessage: "",
      });
      render();
      return app.runtime.operationsGraph;
    }

    setState({
      loading: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const targetObjectId = normalizeText(current.targetObjectId);
      const response = await fetch("/api/operations/graph/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildIdentityPayload(app),
          rootObjectType: normalizeObjectType(current.rootObjectType),
          rootObjectId,
          maxDepth: Number(normalizeDepth(current.maxDepth)),
          ...(targetObjectId
            ? {
              targetObjectType: normalizeObjectType(current.targetObjectType),
              targetObjectId,
            }
            : {}),
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取对象图失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.operationsGraph;
      }

      setState({
        status: "ready",
        loading: false,
        errorMessage: "",
        noticeMessage: "对象图已刷新。",
        graph: normalizeGraph(data?.graph),
      });
      render();
      return app.runtime.operationsGraph;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.operationsGraph;
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

function normalizeGraph(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    principalId: normalizeText(value.principalId),
    generatedAt: normalizeText(value.generatedAt),
    maxDepth: typeof value.maxDepth === "number" ? value.maxDepth : 2,
    root: normalizeGraphEndpoint(value.root),
    target: value.target && typeof value.target === "object"
      ? {
        ...normalizeGraphEndpoint(value.target),
        reachable: value.target.reachable === true,
      }
      : null,
    nodes: Array.isArray(value.nodes) ? value.nodes.map(normalizeGraphNode).filter(Boolean) : [],
    edges: Array.isArray(value.edges) ? value.edges.map(normalizeGraphEdge).filter(Boolean) : [],
    shortestPath: Array.isArray(value.shortestPath)
      ? value.shortestPath.map(normalizeGraphEdge).filter(Boolean)
      : [],
  };
}

function normalizeGraphEndpoint(value) {
  const safeValue = value && typeof value === "object" ? value : {};

  return {
    objectType: normalizeObjectType(safeValue.objectType),
    objectId: normalizeText(safeValue.objectId),
  };
}

function normalizeGraphNode(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const objectId = normalizeText(value.objectId);

  if (!objectId) {
    return null;
  }

  return {
    objectType: normalizeObjectType(value.objectType),
    objectId,
    depth: typeof value.depth === "number" ? value.depth : 0,
    viaEdgeId: normalizeText(value.viaEdgeId),
    viaObjectType: normalizeObjectType(value.viaObjectType),
    viaObjectId: normalizeText(value.viaObjectId),
  };
}

function normalizeGraphEdge(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const edgeId = normalizeText(value.edgeId);

  if (!edgeId) {
    return null;
  }

  return {
    edgeId,
    fromObjectType: normalizeObjectType(value.fromObjectType),
    fromObjectId: normalizeText(value.fromObjectId),
    toObjectType: normalizeObjectType(value.toObjectType),
    toObjectId: normalizeText(value.toObjectId),
    relationType: normalizeText(value.relationType) || "relates_to",
    status: normalizeText(value.status) || "active",
    label: normalizeText(value.label),
    summary: normalizeText(value.summary),
  };
}

function normalizeObjectType(value) {
  const normalized = normalizeText(value);
  return OBJECT_TYPES.has(normalized) ? normalized : "asset";
}

function normalizeDepth(value) {
  const normalized = normalizeText(value);
  return DEPTHS.has(normalized) ? normalized : "2";
}

function buildIdentityPayload(app) {
  const browserUserId = normalizeText(app.runtime?.identity?.browserUserId) || "browser";
  const accountEmail = normalizeText(app.runtime?.auth?.account?.email);

  return {
    channel: "web",
    channelUserId: browserUserId,
    ...(accountEmail ? { displayName: accountEmail } : {}),
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
