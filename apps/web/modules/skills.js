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

    dom?.skillsLocalPathInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      void runSafely(() => installFromLocalPath(dom.skillsLocalPathInput?.value || ""));
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
        void runSafely(() => refresh({ quiet: true }));
      }
    });

    dom?.workspaceToolsToggle?.addEventListener("click", () => {
      queueMicrotask(() => {
        if (app.runtime.workspaceToolsOpen && app.runtime.workspaceToolsSection === "skills") {
          void runSafely(() => refresh({ quiet: true }));
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

    return {
      channel: "web",
      channelUserId: browserUserId,
      ...(authEmail ? { displayName: authEmail } : {}),
    };
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
    const quiet = options.quiet === true;

    if (!quiet) {
      setState({
        loading: true,
        errorMessage: "",
      });
      render();
    }

    try {
      const data = await postSkills("/api/skills/list", buildSkillsIdentityPayload());
      const nextState = normalizeSkillsList(data);
      app.runtime.skills = {
        ...app.runtime.skills,
        ...nextState,
        status: "ready",
        loading: false,
        errorMessage: "",
      };
      render();
      return app.runtime.skills;
    } catch (error) {
      setState({
        status: "error",
        loading: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function loadCuratedCatalog(options = {}) {
    const quiet = options.quiet === true;

    if (!quiet) {
      setState({
        loading: true,
        errorMessage: "",
      });
      render();
    }

    try {
      const data = await postSkills("/api/skills/catalog/curated", buildSkillsIdentityPayload());
      const curated = normalizeCuratedList(data?.curated);
      setState({
        status: "ready",
        curated,
        loading: false,
        errorMessage: "",
      });
      render();
      return {
        curated,
      };
    } catch (error) {
      setState({
        status: "error",
        loading: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function refresh(options = {}) {
    await load({ quiet: options.quiet === true });
    return await loadCuratedCatalog({ quiet: options.quiet === true });
  }

  async function installFromLocalPath(path, replace = false) {
    const absolutePath = normalizeText(path);

    if (!absolutePath) {
      setState({
        errorMessage: "请先填写 Themis 服务所在机器上的本机目录。",
      });
      render();
      return null;
    }

    setState({
      installing: true,
      errorMessage: "",
    });
    render();

    try {
      const data = await postSkills("/api/skills/install", {
        ...buildSkillsIdentityPayload(),
        replace,
        source: {
          type: "local-path",
          absolutePath,
        },
      });
      await refresh({ quiet: true });
      return normalizeMutationResult(data?.result);
    } catch (error) {
      setState({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    } finally {
      setState({
        installing: false,
      });
      render();
    }
  }

  async function installCuratedSkill(skillName, replace = false) {
    const normalizedSkillName = normalizeText(skillName);

    if (!normalizedSkillName) {
      return null;
    }

    setState({
      installing: true,
      errorMessage: "",
    });
    render();

    try {
      const data = await postSkills("/api/skills/install", {
        ...buildSkillsIdentityPayload(),
        replace,
        source: {
          type: "curated",
          skillName: normalizedSkillName,
        },
      });
      await refresh({ quiet: true });
      return normalizeMutationResult(data?.result);
    } catch (error) {
      setState({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    } finally {
      setState({
        installing: false,
      });
      render();
    }
  }

  async function removeSkill(skillName) {
    const normalizedSkillName = normalizeText(skillName);

    if (!normalizedSkillName) {
      return null;
    }

    setState({
      syncing: true,
      errorMessage: "",
    });
    render();

    try {
      const data = await postSkills("/api/skills/remove", {
        ...buildSkillsIdentityPayload(),
        skillName: normalizedSkillName,
      });
      await refresh({ quiet: true });
      return normalizeMutationResult(data?.result);
    } catch (error) {
      setState({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    } finally {
      setState({
        syncing: false,
      });
      render();
    }
  }

  async function syncSkill(skillName, force = false) {
    const normalizedSkillName = normalizeText(skillName);

    if (!normalizedSkillName) {
      return null;
    }

    setState({
      syncing: true,
      errorMessage: "",
    });
    render();

    try {
      const data = await postSkills("/api/skills/sync", {
        ...buildSkillsIdentityPayload(),
        skillName: normalizedSkillName,
        force,
      });
      await refresh({ quiet: true });
      return normalizeMutationResult(data?.result);
    } catch (error) {
      setState({
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    } finally {
      setState({
        syncing: false,
      });
      render();
    }
  }

  return {
    bindControls,
    load,
    loadCuratedCatalog,
    refresh,
    installFromLocalPath,
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
