export function createDefaultUpdateManagerState() {
  return {
    status: "idle",
    errorMessage: "",
    noticeMessage: "",
    busyAction: "",
    check: null,
    operation: null,
    rollbackAnchor: {
      available: false,
      previousCommit: "",
      currentCommit: "",
      appliedReleaseTag: "",
      recordedAt: "",
    },
  };
}

export function createUpdateManagerController(app) {
  const { dom } = app;
  let inflight = null;
  let pollTimer = 0;

  function bindControls() {
    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already reflected in update manager state.
      }
    };

    dom.updateManagerRefreshButton?.addEventListener("click", async () => {
      await runSafely(() => load({ force: true }));
    });

    dom.updateManagerApplyButton?.addEventListener("click", async () => {
      await runSafely(applyUpdate);
    });

    dom.updateManagerRollbackButton?.addEventListener("click", async () => {
      await runSafely(rollbackUpdate);
    });

    dom.workspaceToolsPanel?.addEventListener("click", (event) => {
      const sectionButton = event.target.closest("[data-settings-section]");

      if (sectionButton?.dataset.settingsSection === "runtime") {
        void runSafely(() => load({ force: true, quiet: true }));
      }
    });

    dom.workspaceToolsToggle?.addEventListener("click", () => {
      queueMicrotask(() => {
        if (app.runtime.workspaceToolsOpen && app.runtime.workspaceToolsSection === "runtime") {
          void runSafely(() => load({ force: true, quiet: true }));
        }
      });
    });
  }

  async function load(options = {}) {
    const { force = false, quiet = false } = options;

    if (inflight && !force) {
      return inflight;
    }

    if (!quiet) {
      app.runtime.updateManager = {
        ...app.runtime.updateManager,
        status: "loading",
        errorMessage: "",
      };
      app.renderer.renderAll();
    }

    const task = (async () => {
      try {
        const response = await fetch("/api/updates");
        const data = await app.utils.safeReadJson(response);

        if (!response.ok) {
          throw new Error(data?.error?.message ?? "读取更新状态失败。");
        }

        app.runtime.updateManager = {
          ...normalizeUpdateOverview(data),
          status: "ready",
          errorMessage: "",
          noticeMessage: quiet ? app.runtime.updateManager.noticeMessage : "",
          busyAction: "",
        };
      } catch (error) {
        app.runtime.updateManager = {
          ...app.runtime.updateManager,
          status: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
          busyAction: "",
        };
      }

      syncPolling();
      app.renderer.renderAll();
      return app.runtime.updateManager;
    })();

    inflight = task;

    try {
      return await task;
    } finally {
      if (inflight === task) {
        inflight = null;
      }
    }
  }

  async function applyUpdate() {
    if (app.runtime.updateManager.busyAction || app.runtime.updateManager.operation?.status === "running") {
      return app.runtime.updateManager;
    }

    const confirmed = typeof window.confirm === "function"
      ? window.confirm("确认开始后台升级？Themis 会在版本切换完成后请求重启当前服务，Web 和飞书会短暂中断。")
      : true;

    if (!confirmed) {
      return app.runtime.updateManager;
    }

    return mutate("/api/updates/apply", "apply", "后台升级已启动。");
  }

  async function rollbackUpdate() {
    if (app.runtime.updateManager.busyAction || app.runtime.updateManager.operation?.status === "running") {
      return app.runtime.updateManager;
    }

    const confirmed = typeof window.confirm === "function"
      ? window.confirm("确认回滚到最近一次成功升级前的版本？Themis 会在回滚完成后请求重启当前服务。")
      : true;

    if (!confirmed) {
      return app.runtime.updateManager;
    }

    return mutate("/api/updates/rollback", "rollback", "后台回滚已启动。");
  }

  async function mutate(url, action, noticeMessage) {
    app.runtime.updateManager = {
      ...app.runtime.updateManager,
      busyAction: action,
      errorMessage: "",
      noticeMessage: "",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          confirm: true,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "更新请求失败。");
      }

      app.runtime.updateManager = {
        ...app.runtime.updateManager,
        status: "ready",
        errorMessage: "",
        noticeMessage,
        busyAction: "",
        operation: normalizeUpdateOperation(data?.operation),
      };
      syncPolling();
      app.renderer.renderAll();
      return app.runtime.updateManager;
    } catch (error) {
      app.runtime.updateManager = {
        ...app.runtime.updateManager,
        busyAction: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      app.renderer.renderAll();
      throw error;
    }
  }

  function syncPolling() {
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = 0;
    }

    if (app.runtime.updateManager.operation?.status !== "running") {
      return;
    }

    pollTimer = window.setTimeout(() => {
      void load({
        force: true,
        quiet: true,
      });
    }, 3000);
  }

  return {
    bindControls,
    load,
    applyUpdate,
    rollbackUpdate,
  };
}

function normalizeUpdateOverview(payload) {
  return {
    check: normalizeUpdateCheck(payload?.check),
    operation: normalizeUpdateOperation(payload?.operation),
    rollbackAnchor: normalizeRollbackAnchor(payload?.rollbackAnchor),
  };
}

function normalizeUpdateCheck(value) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    packageVersion: normalizeText(value.packageVersion),
    currentCommit: normalizeText(value.currentCommit),
    updateChannel: normalizeText(value.updateChannel),
    latestCommit: normalizeText(value.latestCommit),
    latestReleaseTag: normalizeText(value.latestReleaseTag),
    summary: normalizeText(value.summary),
    errorMessage: normalizeText(value.errorMessage),
  };
}

function normalizeUpdateOperation(value) {
  if (!isRecord(value)) {
    return null;
  }

  const status = normalizeText(value.status);
  const action = normalizeText(value.action);

  if (!status || !action) {
    return null;
  }

  return {
    status,
    action,
    startedAt: normalizeText(value.startedAt),
    updatedAt: normalizeText(value.updatedAt),
    finishedAt: normalizeText(value.finishedAt),
    progressStep: normalizeText(value.progressStep),
    progressMessage: normalizeText(value.progressMessage),
    errorMessage: normalizeText(value.errorMessage),
    result: isRecord(value.result)
      ? {
        summary: normalizeText(value.result.summary),
        restartStatus: normalizeText(value.result.restartStatus),
        serviceUnit: normalizeText(value.result.serviceUnit),
        restartErrorMessage: normalizeText(value.result.restartErrorMessage),
      }
      : null,
  };
}

function normalizeRollbackAnchor(value) {
  if (!isRecord(value)) {
    return {
      available: false,
      previousCommit: "",
      currentCommit: "",
      appliedReleaseTag: "",
      recordedAt: "",
    };
  }

  return {
    available: value.available === true,
    previousCommit: normalizeText(value.previousCommit),
    currentCommit: normalizeText(value.currentCommit),
    appliedReleaseTag: normalizeText(value.appliedReleaseTag),
    recordedAt: normalizeText(value.recordedAt),
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}
