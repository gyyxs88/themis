export function createDefaultMcpState() {
  return {
    status: "idle",
    errorMessage: "",
    noticeMessage: "",
    busyMessage: "",
    servers: [],
    loading: false,
    mutating: false,
  };
}

export function createMcpController(app) {
  const { dom, utils } = app;
  let controlsBound = false;
  let listLoadRequestId = 0;
  let refreshRequestId = 0;
  let activeRefreshCycle = null;
  let editingServerName = "";

  function bindControls() {
    if (controlsBound) {
      return;
    }

    controlsBound = true;
    bindTextarea(dom?.mcpArgsInput);
    bindTextarea(dom?.mcpEnvInput);

    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already written into MCP state for the UI.
      }
    };

    dom?.mcpSaveButton?.addEventListener("click", () => {
      void runSafely(saveFromForm);
    });

    dom?.mcpResetButton?.addEventListener("click", () => {
      resetForm();
      render();
    });

    dom?.mcpRefreshButton?.addEventListener("click", () => {
      void runSafely(refresh);
    });

    dom?.mcpReloadButton?.addEventListener("click", () => {
      void runSafely(reloadRuntime);
    });

    bindSubmitOnEnter(dom?.mcpServerNameInput, saveFromForm);
    bindSubmitOnEnter(dom?.mcpCommandInput, saveFromForm);
    bindSubmitOnEnter(dom?.mcpCwdInput, saveFromForm);

    dom?.mcpPanelActions?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-mcp-action]");

      if (!actionButton) {
        return;
      }

      const action = actionButton.dataset.mcpAction;
      const serverName = typeof actionButton.dataset.mcpServerName === "string"
        ? actionButton.dataset.mcpServerName.trim()
        : "";

      if (!serverName) {
        return;
      }

      if (action === "edit") {
        const server = findServer(serverName);

        if (server) {
          setEditingServer(server);
          render();
        }
        return;
      }

      if (action === "disable") {
        void runSafely(() => setEnabled(serverName, false));
        return;
      }

      if (action === "enable") {
        void runSafely(() => setEnabled(serverName, true));
        return;
      }

      if (action === "remove") {
        void runSafely(() => removeServer(serverName));
        return;
      }

      if (action === "oauth") {
        void runSafely(() => startOauthLogin(serverName));
      }
    });

    dom?.workspaceToolsPanel?.addEventListener("click", (event) => {
      const sectionButton = event.target.closest("[data-settings-section]");

      if (sectionButton?.dataset.settingsSection === "mcp") {
        void runSafely(refresh);
      }
    });

    dom?.workspaceToolsToggle?.addEventListener("click", () => {
      queueMicrotask(() => {
        if (app.runtime.workspaceToolsOpen && app.runtime.workspaceToolsSection === "mcp") {
          void runSafely(refresh);
        }
      });
    });

    resetForm();
  }

  function bindTextarea(textarea) {
    textarea?.addEventListener("input", () => {
      utils.autoResizeTextarea(textarea);
    });

    if (textarea) {
      utils.autoResizeTextarea(textarea);
    }
  }

  function bindSubmitOnEnter(input, action) {
    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      void action().catch(() => {
        // Errors are already written into MCP state for the UI.
      });
    });
  }

  function setState(patch) {
    app.runtime.mcp = {
      ...app.runtime.mcp,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function buildMcpIdentityPayload() {
    const browserUserId = normalizeText(app.runtime.identity?.browserUserId) || "browser-local";
    const authEmail = normalizeText(app.runtime.auth?.account?.email);
    const displayName = authEmail || `Themis Web ${browserUserId.slice(-6)}`;

    return {
      channel: "web",
      channelUserId: browserUserId,
      ...(displayName ? { displayName } : {}),
    };
  }

  function startReadState() {
    setState({
      loading: true,
      errorMessage: "",
      noticeMessage: "",
      busyMessage: "",
    });
    render();
  }

  function isCurrentRefreshCycle(refreshCycle = null) {
    return !refreshCycle || refreshCycle === activeRefreshCycle;
  }

  function isCurrentListRequest(requestId, refreshCycle = null) {
    return requestId === listLoadRequestId && isCurrentRefreshCycle(refreshCycle);
  }

  function applyReadError(error, requestId, refreshCycle = null) {
    if (!isCurrentListRequest(requestId, refreshCycle)) {
      return;
    }

    setState({
      status: "error",
      loading: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      busyMessage: "",
    });
    render();
  }

  async function postMcp(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await utils.safeReadJson(response);

    if (!response.ok) {
      throw new Error(data?.error?.message ?? "MCP 请求失败。");
    }

    return data ?? {};
  }

  async function load(options = {}) {
    const requestId = ++listLoadRequestId;
    const quiet = options.quiet === true;
    const refreshCycle = options.refreshCycle ?? null;

    if (!quiet) {
      startReadState();
    }

    try {
      const data = await postMcp("/api/mcp/list", buildMcpIdentityPayload());

      if (!isCurrentListRequest(requestId, refreshCycle)) {
        return app.runtime.mcp;
      }

      setState({
        status: "ready",
        loading: false,
        errorMessage: "",
        noticeMessage: "",
        busyMessage: "",
        servers: normalizeMcpList(data?.servers),
      });
      render();
      return app.runtime.mcp;
    } catch (error) {
      if (!isCurrentRefreshCycle(refreshCycle)) {
        return app.runtime.mcp;
      }

      applyReadError(error, requestId, refreshCycle);
      throw error;
    }
  }

  async function refresh(options = {}) {
    const quiet = options.quiet === true;
    const requestId = ++refreshRequestId;
    const refreshCycle = { requestId };
    activeRefreshCycle = refreshCycle;

    if (!quiet) {
      startReadState();
    }

    try {
      return await load({ quiet: true, refreshCycle });
    } finally {
      if (isCurrentRefreshCycle(refreshCycle)) {
        setState({
          loading: false,
        });
        render();
      }
    }
  }

  async function refreshAfterMutation(successMessage) {
    try {
      await refresh({ quiet: true });
      setState({
        status: "ready",
        errorMessage: "",
        noticeMessage: successMessage,
        busyMessage: "",
      });
      render();
    } catch {
      setState({
        status: "ready",
        errorMessage: "",
        noticeMessage: `${successMessage}，但刷新最新列表失败，请手动刷新。`,
        busyMessage: "",
      });
      render();
    }
  }

  async function runMutation(url, payload, busyMessage, successMessage) {
    setState({
      mutating: true,
      errorMessage: "",
      noticeMessage: "",
      busyMessage,
    });
    render();

    try {
      const data = await postMcp(url, payload);
      await refreshAfterMutation(successMessage);
      return data;
    } catch (error) {
      setState({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        busyMessage: "",
      });
      render();
      throw error;
    } finally {
      setState({
        mutating: false,
      });
      render();
    }
  }

  async function saveFromForm() {
    const serverName = normalizeText(dom?.mcpServerNameInput?.value);
    const command = normalizeText(dom?.mcpCommandInput?.value);
    const cwd = normalizeText(dom?.mcpCwdInput?.value);

    if (!serverName) {
      setState({
        errorMessage: "请先填写 MCP server 名称。",
        noticeMessage: "",
      });
      render();
      return null;
    }

    if (!command) {
      setState({
        errorMessage: "请先填写 MCP command。",
        noticeMessage: "",
      });
      render();
      return null;
    }

    const args = parseArgsInput(dom?.mcpArgsInput?.value || "");
    const env = parseEnvInput(dom?.mcpEnvInput?.value || "");
    const enabled = Boolean(dom?.mcpEnabledInput?.checked);

    const result = await runMutation(
      "/api/mcp/upsert",
      {
        ...buildMcpIdentityPayload(),
        serverName,
        command,
        ...(args.length > 0 ? { args } : {}),
        ...(cwd ? { cwd } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        enabled,
      },
      editingServerName ? `正在更新 ${editingServerName}。` : `正在保存 ${serverName}。`,
      editingServerName ? `已更新 ${editingServerName}。` : `已保存 ${serverName}。`,
    );

    resetForm();
    return result;
  }

  async function setEnabled(serverName, enabled) {
    const normalizedServerName = normalizeText(serverName);

    if (!normalizedServerName) {
      return null;
    }

    return await runMutation(
      enabled ? "/api/mcp/enable" : "/api/mcp/disable",
      {
        ...buildMcpIdentityPayload(),
        serverName: normalizedServerName,
      },
      enabled ? `正在启用 ${normalizedServerName}。` : `正在停用 ${normalizedServerName}。`,
      enabled ? `已启用 ${normalizedServerName}。` : `已停用 ${normalizedServerName}。`,
    );
  }

  async function removeServer(serverName) {
    const normalizedServerName = normalizeText(serverName);

    if (!normalizedServerName) {
      return null;
    }

    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const confirmed = window.confirm(`确认删除 MCP server ${normalizedServerName} 吗？`);

      if (!confirmed) {
        return null;
      }
    }

    if (editingServerName === normalizedServerName) {
      resetForm();
    }

    return await runMutation(
      "/api/mcp/remove",
      {
        ...buildMcpIdentityPayload(),
        serverName: normalizedServerName,
      },
      `正在删除 ${normalizedServerName}。`,
      `已删除 ${normalizedServerName}。`,
    );
  }

  async function reloadRuntime() {
    setState({
      mutating: true,
      errorMessage: "",
      noticeMessage: "",
      busyMessage: "正在把当前 principal 的 MCP 定义同步到当前 runtime 槽位。",
    });
    render();

    try {
      const data = await postMcp("/api/mcp/reload", buildMcpIdentityPayload());
      const result = data?.result ?? {};
      const targetId = normalizeText(result?.target?.targetId) || "default";
      const servers = normalizeMcpList(result?.servers);

      setState({
        status: "ready",
        errorMessage: "",
        noticeMessage: `已同步到当前 runtime 槽位：${targetId}。`,
        busyMessage: "",
        servers,
      });
      render();
      return data;
    } catch (error) {
      setState({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        busyMessage: "",
      });
      render();
      throw error;
    } finally {
      setState({
        mutating: false,
      });
      render();
    }
  }

  async function startOauthLogin(serverName) {
    const normalizedServerName = normalizeText(serverName);

    if (!normalizedServerName) {
      return null;
    }

    setState({
      mutating: true,
      errorMessage: "",
      noticeMessage: "",
      busyMessage: `正在为 ${normalizedServerName} 申请 OAuth 授权链接。`,
    });
    render();

    try {
      const data = await postMcp("/api/mcp/oauth/login", {
        ...buildMcpIdentityPayload(),
        serverName: normalizedServerName,
      });
      const authorizationUrl = normalizeText(data?.result?.authorizationUrl);

      if (!authorizationUrl) {
        throw new Error(`MCP server ${normalizedServerName} 没有返回可用的授权链接。`);
      }

      let refreshed = true;

      try {
        await refresh({ quiet: true });
      } catch {
        refreshed = false;
      }

      let popupOpened = false;

      if (typeof window !== "undefined" && typeof window.open === "function") {
        popupOpened = Boolean(window.open(authorizationUrl, "_blank", "noopener,noreferrer"));
      }

      setState({
        status: "ready",
        errorMessage: "",
        noticeMessage: buildOauthNoticeMessage({
          serverName: normalizedServerName,
          authorizationUrl,
          popupOpened,
          refreshed,
        }),
        busyMessage: "",
      });
      render();
      return data;
    } catch (error) {
      setState({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        busyMessage: "",
      });
      render();
      throw error;
    } finally {
      setState({
        mutating: false,
      });
      render();
    }
  }

  function findServer(serverName) {
    return app.runtime.mcp.servers.find((item) => item?.serverName === serverName) ?? null;
  }

  function setEditingServer(server) {
    editingServerName = server.serverName;
    if (dom?.mcpServerNameInput) {
      dom.mcpServerNameInput.value = server.serverName || "";
      dom.mcpServerNameInput.dataset.locked = "true";
    }
    if (dom?.mcpCommandInput) {
      dom.mcpCommandInput.value = server.command || "";
    }
    if (dom?.mcpArgsInput) {
      dom.mcpArgsInput.value = JSON.stringify(Array.isArray(server.args) ? server.args : [], null, 2);
      utils.autoResizeTextarea(dom.mcpArgsInput);
    }
    if (dom?.mcpCwdInput) {
      dom.mcpCwdInput.value = server.cwd || "";
    }
    if (dom?.mcpEnvInput) {
      dom.mcpEnvInput.value = JSON.stringify(server.env && typeof server.env === "object" ? server.env : {}, null, 2);
      utils.autoResizeTextarea(dom.mcpEnvInput);
    }
    if (dom?.mcpEnabledInput) {
      dom.mcpEnabledInput.checked = server.enabled !== false;
    }
    if (dom?.mcpSaveButton) {
      dom.mcpSaveButton.textContent = "更新 MCP";
    }
    if (dom?.mcpEditorModeNote) {
      dom.mcpEditorModeNote.textContent = `当前正在编辑 ${server.serverName}。第一版不支持直接改名；若要改 server 名称，请删除后重建。`;
    }
  }

  function resetForm() {
    editingServerName = "";
    if (dom?.mcpServerNameInput) {
      dom.mcpServerNameInput.value = "";
      dom.mcpServerNameInput.dataset.locked = "false";
    }
    if (dom?.mcpCommandInput) {
      dom.mcpCommandInput.value = "";
    }
    if (dom?.mcpArgsInput) {
      dom.mcpArgsInput.value = "";
      utils.autoResizeTextarea(dom.mcpArgsInput);
    }
    if (dom?.mcpCwdInput) {
      dom.mcpCwdInput.value = "";
    }
    if (dom?.mcpEnvInput) {
      dom.mcpEnvInput.value = "";
      utils.autoResizeTextarea(dom.mcpEnvInput);
    }
    if (dom?.mcpEnabledInput) {
      dom.mcpEnabledInput.checked = true;
    }
    if (dom?.mcpSaveButton) {
      dom.mcpSaveButton.textContent = "保存 MCP";
    }
    if (dom?.mcpEditorModeNote) {
      dom.mcpEditorModeNote.textContent = "当前是新建模式。编辑已有 MCP 时，server 名称会锁定，若要改名请删除后重建。";
    }
  }

  return {
    bindControls,
    load,
    refresh,
    resetForm,
  };
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeMcpList(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").map((item) => normalizeServer(item))
    : [];
}

function normalizeServer(value) {
  const args = Array.isArray(value.args) ? value.args.filter((item) => typeof item === "string") : [];
  const env = value.env && typeof value.env === "object" && !Array.isArray(value.env)
    ? Object.fromEntries(
      Object.entries(value.env).filter(([key, entry]) => key.trim().length > 0 && typeof entry === "string"),
    )
    : {};
  const materializations = Array.isArray(value.materializations)
    ? value.materializations.filter((item) => item && typeof item === "object")
    : [];
  const summary = value.summary && typeof value.summary === "object" ? value.summary : {};

  return {
    serverName: normalizeText(value.serverName),
    command: normalizeText(value.command),
    args,
    cwd: normalizeText(value.cwd),
    env,
    enabled: value.enabled !== false,
    sourceType: normalizeText(value.sourceType),
    materializations,
    summary,
  };
}

function buildOauthNoticeMessage(input) {
  const refreshNote = input.refreshed ? "" : " 列表刷新失败了，可以稍后手动点一次刷新。";

  if (input.popupOpened) {
    return `已为 ${input.serverName} 打开 OAuth 授权页。${refreshNote}`.trim();
  }

  return `已为 ${input.serverName} 生成 OAuth 授权链接，但浏览器没有自动打开新窗口，请手动访问：${input.authorizationUrl}${refreshNote}`;
}

function parseArgsInput(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return [];
  }

  const parsed = JSON.parse(normalized);

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Args JSON 必须是字符串数组，例如 [\"-y\", \"pkg\"]。");
  }

  return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseEnvInput(value) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return {};
  }

  const parsed = JSON.parse(normalized);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Env JSON 必须是对象，例如 {\"TOKEN\":\"value\"}。");
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([key, entry]) => key.trim().length > 0 && typeof entry === "string")
      .map(([key, entry]) => [key.trim(), entry]),
  );
}
