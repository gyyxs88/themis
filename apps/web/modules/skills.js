function createDefaultSkillSummary() {
  return {
    totalAccounts: 0,
    syncedCount: 0,
  };
}

function createDefaultMaterialization() {
  return {
    targetKind: "auth-account",
    targetId: "",
    targetPath: "",
    state: "missing",
    lastSyncedAt: "",
    lastError: "",
  };
}

export function createDefaultSkillsState() {
  return {
    status: "idle",
    errorMessage: "",
    noticeMessage: "",
    skills: [],
    curated: [],
    loading: false,
    installing: false,
    syncing: false,
  };
}

export function createSkillsController(app) {
  const { dom } = app;
  let controlsBound = false;
  let skillsLoadRequestId = 0;
  let curatedLoadRequestId = 0;
  let refreshRequestId = 0;
  let activeRefreshCycle = null;

  function bindControls() {
    if (controlsBound) {
      return;
    }

    controlsBound = true;
    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already reflected in skills state for the UI.
      }
    };

    dom?.skillsInstallLocalButton?.addEventListener("click", () => {
      void runSafely(() => installFromLocalPath(dom.skillsLocalPathInput?.value || ""));
    });

    bindSubmitOnEnter(dom?.skillsLocalPathInput, () => installFromLocalPath(dom.skillsLocalPathInput?.value || ""));
    bindSubmitOnEnter(dom?.skillsGithubUrlInput, () => installFromGitHubUrl(
      dom.skillsGithubUrlInput?.value || "",
      dom.skillsGithubUrlRefInput?.value || "",
    ));
    bindSubmitOnEnter(dom?.skillsGithubUrlRefInput, () => installFromGitHubUrl(
      dom.skillsGithubUrlInput?.value || "",
      dom.skillsGithubUrlRefInput?.value || "",
    ));
    bindSubmitOnEnter(dom?.skillsGithubRepoInput, () => installFromGitHubRepoPath(
      dom.skillsGithubRepoInput?.value || "",
      dom.skillsGithubPathInput?.value || "",
      dom.skillsGithubRepoRefInput?.value || "",
    ));
    bindSubmitOnEnter(dom?.skillsGithubPathInput, () => installFromGitHubRepoPath(
      dom.skillsGithubRepoInput?.value || "",
      dom.skillsGithubPathInput?.value || "",
      dom.skillsGithubRepoRefInput?.value || "",
    ));
    bindSubmitOnEnter(dom?.skillsGithubRepoRefInput, () => installFromGitHubRepoPath(
      dom.skillsGithubRepoInput?.value || "",
      dom.skillsGithubPathInput?.value || "",
      dom.skillsGithubRepoRefInput?.value || "",
    ));

    dom?.skillsInstallGithubUrlButton?.addEventListener("click", () => {
      void runSafely(() => installFromGitHubUrl(
        dom.skillsGithubUrlInput?.value || "",
        dom.skillsGithubUrlRefInput?.value || "",
      ));
    });

    dom?.skillsInstallGithubRepoButton?.addEventListener("click", () => {
      void runSafely(() => installFromGitHubRepoPath(
        dom.skillsGithubRepoInput?.value || "",
        dom.skillsGithubPathInput?.value || "",
        dom.skillsGithubRepoRefInput?.value || "",
      ));
    });

    dom?.skillsRefreshButton?.addEventListener("click", () => {
      void runSafely(refresh);
    });

    dom?.skillsPanelActions?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-skill-action]");

      if (!actionButton) {
        return;
      }

      const action = actionButton.dataset.skillAction;
      const skillName = typeof actionButton.dataset.skillName === "string"
        ? actionButton.dataset.skillName.trim()
        : "";

      if (action === "remove") {
        void runSafely(() => removeSkill(skillName));
        return;
      }

      if (action === "sync") {
        void runSafely(() => syncSkill(skillName, actionButton.dataset.skillForce === "true"));
        return;
      }

      if (action === "install-curated") {
        void runSafely(() => installCuratedSkill(skillName, actionButton.dataset.skillReplace === "true"));
      }
    });

    dom?.workspaceToolsPanel?.addEventListener("click", (event) => {
      const sectionButton = event.target.closest("[data-settings-section]");

      if (sectionButton?.dataset.settingsSection === "skills") {
        void runSafely(refresh);
      }
    });

    dom?.workspaceToolsToggle?.addEventListener("click", () => {
      queueMicrotask(() => {
        if (app.runtime.workspaceToolsOpen && app.runtime.workspaceToolsSection === "skills") {
          void runSafely(refresh);
        }
      });
    });
  }

  function setState(patch) {
    app.runtime.skills = {
      ...app.runtime.skills,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function buildSkillsIdentityPayload() {
    const browserUserId = normalizeText(app.runtime.identity?.browserUserId) || "browser-local";
    const authEmail = normalizeText(app.runtime.auth?.account?.email);
    const displayName = authEmail || `Themis Web ${browserUserId.slice(-6)}`;

    return {
      channel: "web",
      channelUserId: browserUserId,
      ...(displayName ? { displayName } : {}),
    };
  }

  function bindSubmitOnEnter(input, action) {
    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      void action().catch(() => {
        // Errors are already reflected in skills state for the UI.
      });
    });
  }

  function startReadState() {
    setState({
      loading: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  function isCurrentRefreshCycle(refreshCycle = null) {
    return !refreshCycle || refreshCycle === activeRefreshCycle;
  }

  function isCurrentReadRequest(requestType, requestId, refreshCycle = null) {
    const latestRequestId = requestType === "skills" ? skillsLoadRequestId : curatedLoadRequestId;

    if (requestId !== latestRequestId) {
      return false;
    }

    if (!isCurrentRefreshCycle(refreshCycle)) {
      return false;
    }

    return true;
  }

  function applyReadError(error, requestId, requestType, options = {}) {
    const keepBusy = options.keepBusy === true;
    const refreshCycle = options.refreshCycle ?? null;

    if (!isCurrentReadRequest(requestType, requestId, refreshCycle)) {
      return;
    }

    setState({
      status: "error",
      loading: keepBusy ? app.runtime.skills.loading : false,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    render();
  }

  async function refreshAfterMutation() {
    try {
      await refresh({ quiet: true });
    } catch {
      setState({
        status: "ready",
        loading: false,
        errorMessage: "",
        noticeMessage: "操作已成功，但刷新最新列表失败，请手动刷新。",
      });
      render();
    }
  }

  async function runInstallMutation(source, replace = false) {
    return await runMutation("installing", "/api/skills/install", {
      ...buildSkillsIdentityPayload(),
      replace,
      source,
    });
  }

  async function runMutation(busyKey, url, payload) {
    setState({
      [busyKey]: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const data = await postSkills(url, payload);
      const result = normalizeMutationResult(data?.result);
      await refreshAfterMutation();
      return result;
    } catch (error) {
      setState({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    } finally {
      setState({
        [busyKey]: false,
      });
      render();
    }
  }

  async function postSkills(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await app.utils.safeReadJson(response);

    if (!response.ok) {
      throw new Error(data?.error?.message ?? "skills 请求失败。");
    }

    return data ?? {};
  }

  async function load(options = {}) {
    const requestId = ++skillsLoadRequestId;
    const quiet = options.quiet === true;
    const keepBusy = options.keepBusy === true;
    const refreshCycle = options.refreshCycle ?? null;

    if (!quiet) {
      startReadState();
    }

    try {
      const data = await postSkills("/api/skills/list", buildSkillsIdentityPayload());

      if (!isCurrentReadRequest("skills", requestId, refreshCycle)) {
        return app.runtime.skills;
      }

      const nextState = normalizeSkillsList(data);
      app.runtime.skills = {
        ...app.runtime.skills,
        ...nextState,
        status: "ready",
        loading: keepBusy ? app.runtime.skills.loading : false,
        errorMessage: "",
        noticeMessage: "",
      };
      render();
      return app.runtime.skills;
    } catch (error) {
      if (!isCurrentRefreshCycle(refreshCycle)) {
        return app.runtime.skills;
      }

      applyReadError(error, requestId, "skills", {
        keepBusy,
        refreshCycle,
      });
      throw error;
    }
  }

  async function loadCuratedCatalog(options = {}) {
    const requestId = ++curatedLoadRequestId;
    const quiet = options.quiet === true;
    const keepBusy = options.keepBusy === true;
    const refreshCycle = options.refreshCycle ?? null;

    if (!quiet) {
      startReadState();
    }

    try {
      const data = await postSkills("/api/skills/catalog/curated", buildSkillsIdentityPayload());

      if (!isCurrentReadRequest("curated", requestId, refreshCycle)) {
        return {
          curated: app.runtime.skills.curated,
        };
      }

      const curated = normalizeCuratedList(data?.curated);
      setState({
        status: "ready",
        curated,
        loading: keepBusy ? app.runtime.skills.loading : false,
        errorMessage: "",
        noticeMessage: "",
      });
      render();
      return {
        curated,
      };
    } catch (error) {
      if (!isCurrentRefreshCycle(refreshCycle)) {
        return {
          curated: app.runtime.skills.curated,
        };
      }

      applyReadError(error, requestId, "curated", {
        keepBusy,
        refreshCycle,
      });
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
      await load({ quiet: true, keepBusy: true, refreshCycle });
      return await loadCuratedCatalog({ quiet: true, keepBusy: true, refreshCycle });
    } catch (error) {
      if (!isCurrentRefreshCycle(refreshCycle)) {
        return {
          curated: app.runtime.skills.curated,
        };
      }

      throw error;
    } finally {
      if (isCurrentRefreshCycle(refreshCycle)) {
        setState({
          loading: false,
        });
        render();
      }
    }
  }

  async function installFromLocalPath(path, replace = false) {
    const absolutePath = normalizeText(path);

    if (!absolutePath) {
      setState({
        errorMessage: "请先填写 Themis 服务所在机器上的本机目录。",
        noticeMessage: "",
      });
      render();
      return null;
    }

    return await runInstallMutation({
      type: "local-path",
      absolutePath,
    }, replace);
  }

  async function installFromGitHubUrl(url, ref = "", replace = false) {
    const normalizedUrl = normalizeText(url);
    const normalizedRef = normalizeText(ref);

    if (!normalizedUrl) {
      setState({
        errorMessage: "请先填写 GitHub URL。",
        noticeMessage: "",
      });
      render();
      return null;
    }

    return await runInstallMutation({
      type: "github-url",
      url: normalizedUrl,
      ...(normalizedRef ? { ref: normalizedRef } : {}),
    }, replace);
  }

  async function installFromGitHubRepoPath(repo, path, ref = "", replace = false) {
    const normalizedRepo = normalizeText(repo);
    const normalizedPath = normalizeText(path);
    const normalizedRef = normalizeText(ref);

    if (!normalizedRepo) {
      setState({
        errorMessage: "请先填写 GitHub repo，例如 openai/codex。",
        noticeMessage: "",
      });
      render();
      return null;
    }

    if (!normalizedPath) {
      setState({
        errorMessage: "请先填写 repo 内 path。",
        noticeMessage: "",
      });
      render();
      return null;
    }

    return await runInstallMutation({
      type: "github-repo-path",
      repo: normalizedRepo,
      path: normalizedPath,
      ...(normalizedRef ? { ref: normalizedRef } : {}),
    }, replace);
  }

  async function installCuratedSkill(skillName, replace = false) {
    const normalizedSkillName = normalizeText(skillName);

    if (!normalizedSkillName) {
      return null;
    }

    return await runInstallMutation({
      type: "curated",
      skillName: normalizedSkillName,
    }, replace);
  }

  async function removeSkill(skillName) {
    const normalizedSkillName = normalizeText(skillName);

    if (!normalizedSkillName) {
      return null;
    }

    return await runMutation("syncing", "/api/skills/remove", {
      ...buildSkillsIdentityPayload(),
      skillName: normalizedSkillName,
    });
  }

  async function syncSkill(skillName, force = false) {
    const normalizedSkillName = normalizeText(skillName);

    if (!normalizedSkillName) {
      return null;
    }

    return await runMutation("syncing", "/api/skills/sync", {
      ...buildSkillsIdentityPayload(),
      skillName: normalizedSkillName,
      force,
    });
  }

  return {
    bindControls,
    load,
    loadCuratedCatalog,
    refresh,
    installFromLocalPath,
    installFromGitHubUrl,
    installFromGitHubRepoPath,
    installCuratedSkill,
    removeSkill,
    syncSkill,
    normalizeSkillsList,
  };
}

function normalizeSkillsList(payload) {
  const skills = Array.isArray(payload?.skills)
    ? payload.skills.map(normalizeSkillRecord).filter(Boolean)
    : [];

  return {
    skills,
  };
}

function normalizeMutationResult(value) {
  if (!value || typeof value !== "object") {
    return {
      skill: null,
      materializations: [],
      summary: createDefaultSkillSummary(),
    };
  }

  return {
    skill: normalizeSkillRecord(value.skill),
    materializations: Array.isArray(value.materializations)
      ? value.materializations.map(normalizeMaterialization).filter(Boolean)
      : [],
    summary: normalizeSkillSummary(value.summary),
  };
}

function normalizeSkillRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const skillName = normalizeText(value.skillName);

  if (!skillName) {
    return null;
  }

  return {
    skillName,
    description: normalizeText(value.description) || "",
    sourceType: normalizeText(value.sourceType) || "local-path",
    installStatus: normalizeText(value.installStatus) || "ready",
    lastError: normalizeText(value.lastError) || "",
    summary: normalizeSkillSummary(value.summary),
    materializations: Array.isArray(value.materializations)
      ? value.materializations.map(normalizeMaterialization).filter(Boolean)
      : [],
  };
}

function normalizeSkillSummary(value) {
  return {
    ...createDefaultSkillSummary(),
    totalAccounts: typeof value?.totalAccounts === "number" ? value.totalAccounts : 0,
    syncedCount: typeof value?.syncedCount === "number" ? value.syncedCount : 0,
  };
}

function normalizeMaterialization(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    ...createDefaultMaterialization(),
    targetKind: normalizeText(value.targetKind) || "auth-account",
    targetId: normalizeText(value.targetId) || "",
    targetPath: normalizeText(value.targetPath) || "",
    state: normalizeText(value.state) || "missing",
    lastSyncedAt: normalizeText(value.lastSyncedAt) || "",
    lastError: normalizeText(value.lastError) || "",
  };
}

function normalizeCuratedList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const name = normalizeText(item.name);

      if (!name) {
        return null;
      }

      return {
        name,
        installed: item.installed === true,
      };
    })
    .filter(Boolean);
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
