function createDefaultCompatibilityStatus() {
  return null;
}

export function createDefaultAgentsState() {
  return {
    status: "idle",
    loading: false,
    errorMessage: "",
    noticeMessage: "",
    compatibilityStatus: createDefaultCompatibilityStatus(),
  };
}

export function createAgentsController(app) {
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
        // Errors are already reflected in agents state for the UI.
      }
    };

    dom?.agentsRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.workspaceToolsPanel?.addEventListener("click", (event) => {
      const sectionButton = event.target.closest("[data-settings-section]");

      if (sectionButton?.dataset.settingsSection === "agents") {
        void runSafely(load);
      }
    });

    dom?.workspaceToolsToggle?.addEventListener("click", () => {
      queueMicrotask(() => {
        if (app.runtime.workspaceToolsOpen && app.runtime.workspaceToolsSection === "agents") {
          void runSafely(load);
        }
      });
    });
  }

  function setState(patch) {
    app.runtime.agents = {
      ...createDefaultAgentsState(),
      ...app.runtime.agents,
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
      const data = await postAgents("/api/agents/list", buildIdentityPayload(app));

      if (requestId !== loadRequestId) {
        return app.runtime.agents;
      }

      setState({
        status: "ready",
        loading: false,
        errorMessage: "",
        compatibilityStatus: normalizeAgentsCompatibilityStatus(data.compatibility),
      });
      render();
      return app.runtime.agents;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.agents;
      }

      setState({
        status: "error",
        loading: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        compatibilityStatus: createDefaultCompatibilityStatus(),
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
  const browserUserId = normalizeText(app.runtime.identity?.browserUserId) || "browser-local";
  const authEmail = normalizeText(app.runtime.auth?.account?.email);
  const displayName = authEmail || `Themis Web ${browserUserId.slice(-6)}`;

  return {
    channel: "web",
    channelUserId: browserUserId,
    ...(displayName ? { displayName } : {}),
  };
}

async function postAgents(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await safeReadJson(response);

  if (!response.ok) {
    throw new Error(data?.error?.message ?? "读取 Platform Agents 入口状态失败。");
  }

  return data ?? {};
}

function normalizeAgentsCompatibilityStatus(value) {
  if (!isRecord(value)) {
    return null;
  }

  const accessMode = typeof value.accessMode === "string" ? value.accessMode : "gateway_required";
  const statusLevel = value.statusLevel === "error" ? "error" : "warning";
  const message = typeof value.message === "string" ? value.message : "";
  const platformBaseUrl = typeof value.platformBaseUrl === "string" ? value.platformBaseUrl : "";
  const ownerPrincipalId = typeof value.ownerPrincipalId === "string" ? value.ownerPrincipalId : "";

  if (value.panelOwnership !== "platform") {
    return null;
  }

  return {
    panelOwnership: "platform",
    accessMode: ["platform_gateway", "gateway_required", "invalid_gateway_config"].includes(accessMode)
      ? accessMode
      : "gateway_required",
    statusLevel,
    message: message.trim(),
    platformBaseUrl: platformBaseUrl.trim(),
    ownerPrincipalId: ownerPrincipalId.trim(),
  };
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}
