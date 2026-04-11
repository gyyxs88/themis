export function createDefaultPluginsState() {
  return {
    status: "idle",
    errorMessage: "",
    noticeMessage: "",
    busyMessage: "",
    marketplaces: [],
    marketplaceLoadErrors: [],
    remoteSyncError: "",
    featuredPluginIds: [],
    detailsById: {},
    expandedPluginId: "",
    detailLoadingPluginId: "",
    loading: false,
    mutating: false,
  };
}

export function createPluginsController(app) {
  const { dom, utils } = app;
  let controlsBound = false;
  let listLoadRequestId = 0;
  let refreshRequestId = 0;
  let activeRefreshCycle = null;
  let detailRequestId = 0;

  function bindControls() {
    if (controlsBound) {
      return;
    }

    controlsBound = true;

    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already reflected in plugins state for the UI.
      }
    };

    dom?.pluginsRefreshButton?.addEventListener("click", () => {
      void runSafely(() => refresh());
    });

    dom?.pluginsRemoteSyncButton?.addEventListener("click", () => {
      void runSafely(() => refresh({ forceRemoteSync: true }));
    });

    dom?.pluginsPanelActions?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-plugin-action]");

      if (!actionButton) {
        return;
      }

      const action = actionButton.dataset.pluginAction;
      const marketplacePath = normalizeText(actionButton.dataset.marketplacePath);
      const pluginName = normalizeText(actionButton.dataset.pluginName);
      const pluginId = normalizeText(actionButton.dataset.pluginId);

      if (action === "detail" && marketplacePath && pluginName) {
        void runSafely(() => togglePluginDetail({
          marketplacePath,
          pluginName,
          pluginId,
        }));
        return;
      }

      if (action === "install" && marketplacePath && pluginName) {
        void runSafely(() => installPlugin({
          marketplacePath,
          pluginName,
        }));
        return;
      }

      if (action === "uninstall" && pluginId) {
        void runSafely(() => uninstallPlugin({
          pluginId,
          marketplacePath,
          pluginName,
        }));
      }
    });

    dom?.workspaceToolsPanel?.addEventListener("click", (event) => {
      const sectionButton = event.target.closest("[data-settings-section]");

      if (sectionButton?.dataset.settingsSection === "plugins") {
        void runSafely(() => refresh());
      }
    });

    dom?.workspaceToolsToggle?.addEventListener("click", () => {
      queueMicrotask(() => {
        if (app.runtime.workspaceToolsOpen && app.runtime.workspaceToolsSection === "plugins") {
          void runSafely(() => refresh());
        }
      });
    });
  }

  function setState(patch) {
    app.runtime.plugins = {
      ...app.runtime.plugins,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
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

  async function postPlugins(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await utils.safeReadJson(response);

    if (!response.ok) {
      throw new Error(data?.error?.message ?? "plugins 请求失败。");
    }

    return data ?? {};
  }

  function buildPluginsPayload(extra = {}) {
    const discoveryCwd = resolvePluginDiscoveryCwd();
    return {
      ...(discoveryCwd ? { cwd: discoveryCwd } : {}),
      ...extra,
    };
  }

  function resolvePluginDiscoveryCwd() {
    const activeThread = app.store?.getActiveThread?.() ?? null;
    return normalizeText(activeThread?.settings?.workspacePath);
  }

  async function load(options = {}) {
    const requestId = ++listLoadRequestId;
    const quiet = options.quiet === true;
    const refreshCycle = options.refreshCycle ?? null;

    if (!quiet) {
      startReadState();
    }

    try {
      const data = await postPlugins("/api/plugins/list", buildPluginsPayload({
        ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
      }));

      if (!isCurrentListRequest(requestId, refreshCycle)) {
        return app.runtime.plugins;
      }

      const nextState = normalizePluginsList(data?.result);
      setState({
        ...nextState,
        status: "ready",
        loading: false,
        errorMessage: "",
        noticeMessage: "",
        busyMessage: "",
      });
      render();
      return app.runtime.plugins;
    } catch (error) {
      if (!isCurrentRefreshCycle(refreshCycle)) {
        return app.runtime.plugins;
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
      return await load({
        quiet: true,
        refreshCycle,
        ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
      });
    } finally {
      if (isCurrentRefreshCycle(refreshCycle)) {
        setState({
          loading: false,
        });
        render();
      }
    }
  }

  async function refreshAfterMutation(successMessage, options = {}) {
    try {
      await refresh({
        quiet: true,
        ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
      });
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

  async function runMutation(url, payload, busyMessage, successMessage, options = {}) {
    setState({
      mutating: true,
      errorMessage: "",
      noticeMessage: "",
      busyMessage,
    });
    render();

    try {
      const data = await postPlugins(url, payload);
      await refreshAfterMutation(successMessage, options);
      return data?.result ?? {};
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

  async function togglePluginDetail(input, options = {}) {
    const detailId = createPluginDetailId(input.marketplacePath, input.pluginId, input.pluginName);

    if (!detailId) {
      return null;
    }

    const currentState = app.runtime.plugins ?? {};

    if (
      currentState.expandedPluginId === detailId
      && currentState.detailLoadingPluginId !== detailId
      && currentState.detailsById?.[detailId]
      && options.forceRemoteSync !== true
    ) {
      setState({
        expandedPluginId: "",
      });
      render();
      return currentState.detailsById[detailId];
    }

    const requestId = ++detailRequestId;
    setState({
      expandedPluginId: detailId,
      detailLoadingPluginId: detailId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const data = await postPlugins("/api/plugins/read", buildPluginsPayload({
        marketplacePath: input.marketplacePath,
        pluginName: input.pluginName,
        ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
      }));

      if (requestId !== detailRequestId) {
        return app.runtime.plugins.detailsById?.[detailId] ?? null;
      }

      const detail = normalizePluginDetail(data?.result?.plugin);
      setState({
        detailsById: {
          ...(app.runtime.plugins.detailsById ?? {}),
          [detailId]: detail,
        },
        detailLoadingPluginId: "",
      });
      render();
      return detail;
    } catch (error) {
      if (requestId !== detailRequestId) {
        return null;
      }

      setState({
        status: "error",
        detailLoadingPluginId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function installPlugin(input, options = {}) {
    const result = await runMutation(
      "/api/plugins/install",
      buildPluginsPayload({
        marketplacePath: input.marketplacePath,
        pluginName: input.pluginName,
        ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
      }),
      `正在安装 plugin：${input.pluginName}`,
      `已安装 plugin：${input.pluginName}`,
      options,
    );
    const detailId = createPluginDetailId(input.marketplacePath, result?.plugin?.summary?.id, input.pluginName);

    if (detailId) {
      const detail = normalizePluginDetail(result?.plugin);
      setState({
        detailsById: {
          ...(app.runtime.plugins.detailsById ?? {}),
          [detailId]: detail,
        },
      });
      render();
    }

    return result;
  }

  async function uninstallPlugin(input, options = {}) {
    const result = await runMutation(
      "/api/plugins/uninstall",
      buildPluginsPayload({
        pluginId: input.pluginId,
        ...(options.forceRemoteSync === true ? { forceRemoteSync: true } : {}),
      }),
      `正在卸载 plugin：${input.pluginId}`,
      `已卸载 plugin：${input.pluginId}`,
      options,
    );
    const detailsById = { ...(app.runtime.plugins.detailsById ?? {}) };

    if (input.marketplacePath && input.pluginName) {
      const detailId = createPluginDetailId(input.marketplacePath, input.pluginId, input.pluginName);
      if (detailId && detailsById[detailId]) {
        delete detailsById[detailId];
      }
    }

    setState({
      detailsById,
      expandedPluginId: app.runtime.plugins.expandedPluginId,
    });
    render();
    return result;
  }

  return {
    bindControls,
    load,
    refresh,
    togglePluginDetail,
    installPlugin,
    uninstallPlugin,
    normalizePluginsList,
    normalizePluginDetail,
  };
}

export function normalizePluginsList(value) {
  const marketplaces = Array.isArray(value?.marketplaces)
    ? value.marketplaces.map(normalizePluginMarketplace).filter(Boolean)
    : [];
  const marketplaceLoadErrors = Array.isArray(value?.marketplaceLoadErrors)
    ? value.marketplaceLoadErrors.map(normalizeMarketplaceLoadError).filter(Boolean)
    : [];

  return {
    marketplaces,
    marketplaceLoadErrors,
    remoteSyncError: normalizeText(value?.remoteSyncError) || "",
    featuredPluginIds: Array.isArray(value?.featuredPluginIds)
      ? value.featuredPluginIds.filter((item) => typeof item === "string" && item.trim())
      : [],
  };
}

export function normalizePluginDetail(value) {
  const summary = normalizePluginSummary(value?.summary);

  return {
    marketplaceName: normalizeText(value?.marketplaceName) || "unknown",
    marketplacePath: normalizeText(value?.marketplacePath) || "",
    summary,
    description: normalizeText(value?.description) || "",
    skills: Array.isArray(value?.skills)
      ? value.skills.map(normalizePluginSkill).filter(Boolean)
      : [],
    apps: Array.isArray(value?.apps)
      ? value.apps.map(normalizePluginApp).filter(Boolean)
      : [],
    mcpServers: Array.isArray(value?.mcpServers)
      ? value.mcpServers.filter((item) => typeof item === "string" && item.trim())
      : [],
  };
}

function normalizePluginMarketplace(value) {
  const path = normalizeText(value?.path);
  const name = normalizeText(value?.name);

  if (!path || !name) {
    return null;
  }

  return {
    path,
    name,
    interface: value?.interface && typeof value.interface === "object"
      ? {
        displayName: normalizeText(value.interface.displayName) || "",
      }
      : null,
    plugins: Array.isArray(value?.plugins)
      ? value.plugins.map(normalizePluginSummary).filter(Boolean)
      : [],
  };
}

function normalizePluginSummary(value) {
  const id = normalizeText(value?.id);
  const name = normalizeText(value?.name);

  if (!id || !name) {
    return null;
  }

  const pluginInterface = value?.interface && typeof value.interface === "object"
    ? {
      displayName: normalizeText(value.interface.displayName) || "",
      shortDescription: normalizeText(value.interface.shortDescription) || "",
      longDescription: normalizeText(value.interface.longDescription) || "",
      developerName: normalizeText(value.interface.developerName) || "",
      category: normalizeText(value.interface.category) || "",
      capabilities: Array.isArray(value.interface.capabilities)
        ? value.interface.capabilities.filter((item) => typeof item === "string" && item.trim())
        : [],
      websiteUrl: normalizeText(value.interface.websiteUrl) || "",
      privacyPolicyUrl: normalizeText(value.interface.privacyPolicyUrl) || "",
      termsOfServiceUrl: normalizeText(value.interface.termsOfServiceUrl) || "",
      defaultPrompt: Array.isArray(value.interface.defaultPrompt)
        ? value.interface.defaultPrompt.filter((item) => typeof item === "string" && item.trim())
        : [],
      brandColor: normalizeText(value.interface.brandColor) || "",
      composerIcon: normalizeText(value.interface.composerIcon) || "",
      logo: normalizeText(value.interface.logo) || "",
      screenshots: Array.isArray(value.interface.screenshots)
        ? value.interface.screenshots.filter((item) => typeof item === "string" && item.trim())
        : [],
    }
    : null;

  return {
    id,
    name,
    sourceType: normalizeText(value?.sourceType) || "unknown",
    sourcePath: normalizeText(value?.sourcePath) || "",
    installed: value?.installed === true,
    enabled: value?.enabled === true,
    installPolicy: normalizeText(value?.installPolicy) || "UNKNOWN",
    authPolicy: normalizeText(value?.authPolicy) || "UNKNOWN",
    interface: pluginInterface,
  };
}

function normalizeMarketplaceLoadError(value) {
  const marketplacePath = normalizeText(value?.marketplacePath);
  const message = normalizeText(value?.message);

  if (!marketplacePath || !message) {
    return null;
  }

  return {
    marketplacePath,
    message,
  };
}

function normalizePluginSkill(value) {
  const name = normalizeText(value?.name);
  const description = normalizeText(value?.description);

  if (!name || !description) {
    return null;
  }

  return {
    name,
    description,
    shortDescription: normalizeText(value?.shortDescription) || "",
    path: normalizeText(value?.path) || "",
    enabled: value?.enabled === true,
  };
}

function normalizePluginApp(value) {
  const id = normalizeText(value?.id);
  const name = normalizeText(value?.name);

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    description: normalizeText(value?.description) || "",
    installUrl: normalizeText(value?.installUrl) || "",
    needsAuth: value?.needsAuth === true,
  };
}

function createPluginDetailId(marketplacePath, pluginId, pluginName) {
  const normalizedMarketplacePath = normalizeText(marketplacePath);
  const normalizedPluginKey = normalizeText(pluginId) || normalizeText(pluginName);

  if (!normalizedMarketplacePath || !normalizedPluginKey) {
    return "";
  }

  return `${normalizedMarketplacePath}::${normalizedPluginKey}`;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
