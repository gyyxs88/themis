export function createSessionSettingsController(app) {
  const pendingPersistByThreadId = new Map();

  async function loadThreadSettings(threadId, options = {}) {
    const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";

    if (!normalizedThreadId) {
      return {
        ok: false,
        found: false,
        settings: null,
        code: "INVALID_THREAD_ID",
      };
    }

    const thread = app.store.getThreadById(normalizedThreadId);

    if (!thread) {
      return {
        ok: false,
        found: false,
        settings: null,
        code: "THREAD_NOT_FOUND",
      };
    }

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(normalizedThreadId)}/settings`);
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取服务端会话配置失败。");
      }

      if (!data?.found || !data?.settings) {
        if (options.clearLocalWhenMissing) {
          applySettingsToThread(normalizedThreadId, {});
          return {
            ok: true,
            found: false,
            settings: {},
          };
        }

        if (!options.skipPersistWhenMissing && hasExplicitSessionSettings(thread.settings)) {
          const persistResult = await persistThreadSettings(normalizedThreadId, thread.settings, { quiet: true });
          return {
            ok: persistResult.ok,
            found: persistResult.ok,
            settings: persistResult.settings,
            ...(persistResult.ok ? {} : { code: "BACKFILL_PERSIST_FAILED" }),
          };
        }

        return {
          ok: true,
          found: false,
          settings: {},
        };
      }

      applySettingsToThread(normalizedThreadId, data.settings);
      return {
        ok: true,
        found: true,
        settings: normalizeSessionSettings(data.settings),
      };
    } catch (error) {
      if (!options.quiet) {
        console.error("Session settings load failed.", error);
      }

      return {
        ok: false,
        found: false,
        settings: null,
        code: "LOAD_FAILED",
      };
    }
  }

  async function persistThreadSettings(threadId, settings, options = {}) {
    const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";

    if (!normalizedThreadId) {
      return {
        ok: false,
        settings: null,
        code: "INVALID_THREAD_ID",
      };
    }

    if (options.coalesce && pendingPersistByThreadId.has(normalizedThreadId)) {
      return pendingPersistByThreadId.get(normalizedThreadId);
    }

    const runPersist = async () => {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(normalizedThreadId)}/settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            settings,
          }),
        });
        const data = await app.utils.safeReadJson(response);

        if (!response.ok) {
          throw new Error(data?.error?.message ?? "写入服务端会话配置失败。");
        }

        const hasServerSettings = hasOwnProperty(data, "settings");
        const normalizedSettings = hasServerSettings
          ? normalizeSessionSettings(data.settings)
          : normalizeSessionSettings(settings);

        if (options.applyServerSettings !== false && hasServerSettings) {
          applySettingsToThread(normalizedThreadId, data.settings);
        }

        return {
          ok: true,
          settings: normalizedSettings,
        };
      } catch (error) {
        if (!options.quiet) {
          console.error("Session settings persist failed.", error);
        }

        if (options.throwOnError) {
          throw error;
        }

        return {
          ok: false,
          settings: null,
          code: "PERSIST_FAILED",
        };
      }
    };

    if (options.coalesce) {
      const pending = runPersist().finally(() => {
        pendingPersistByThreadId.delete(normalizedThreadId);
      });
      pendingPersistByThreadId.set(normalizedThreadId, pending);
      return pending;
    }

    return runPersist();
  }

  async function commitThreadSettings(threadId, options = {}) {
    const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";

    if (!normalizedThreadId) {
      return {
        ok: false,
        code: "INVALID_THREAD_ID",
      };
    }

    const thread = app.store.getThreadById(normalizedThreadId);

    if (!thread) {
      return {
        ok: false,
        code: "THREAD_NOT_FOUND",
      };
    }

    if (app.runtime.sessionControlBusy) {
      return {
        ok: false,
        code: "BUSY",
      };
    }

    app.runtime.sessionControlBusy = true;
    app.renderer.renderAll();

    try {
      const persistResult = await persistThreadSettings(normalizedThreadId, thread.settings, {
        quiet: options.quiet,
        coalesce: true,
      });

      if (persistResult.ok) {
        return {
          ok: true,
          code: "OK",
          settings: persistResult.settings,
        };
      }

      const syncResult = await loadThreadSettings(normalizedThreadId, {
        quiet: true,
        skipPersistWhenMissing: true,
        clearLocalWhenMissing: true,
      });

      if (syncResult.ok) {
        return {
          ok: false,
          code: "PERSIST_FAILED_RECONCILED",
          reconciled: true,
          found: syncResult.found,
          settings: syncResult.settings,
        };
      }

      if (options.clearWorkspaceOnUnknownFailure) {
        clearThreadWorkspace(normalizedThreadId);
      }

      return {
        ok: false,
        code: "PERSIST_FAILED_UNCERTAIN",
        reconciled: false,
      };
    } finally {
      app.runtime.sessionControlBusy = false;
      app.renderer.renderAll();
    }
  }

  function clearThreadWorkspace(threadId) {
    const thread = app.store.getThreadById(threadId);

    if (!thread) {
      return;
    }

    thread.settings = {
      ...app.store.createDefaultThreadSettings(),
      ...thread.settings,
      workspacePath: "",
    };
    app.store.touchThread?.(threadId);
    app.store.saveState();
  }

  function applySettingsToThread(threadId, settings) {
    const thread = app.store.getThreadById(threadId);

    if (!thread) {
      return;
    }

    thread.settings = {
      ...app.store.createDefaultThreadSettings(),
      ...normalizeSessionSettings(settings),
    };
    app.store.saveState();

    if (app.store.state.activeThreadId === threadId) {
      app.renderer.renderAll();
    }
  }

  return {
    loadThreadSettings,
    persistThreadSettings,
    commitThreadSettings,
  };
}

function hasExplicitSessionSettings(settings) {
  return Object.keys(normalizeSessionSettings(settings)).length > 0;
}

function normalizeSessionSettings(settings) {
  if (!settings || typeof settings !== "object") {
    return {};
  }

  const workspacePath = typeof settings.workspacePath === "string" ? settings.workspacePath.trim() : "";

  return {
    ...(typeof settings.profile === "string" && settings.profile ? { profile: settings.profile } : {}),
    ...(typeof settings.accessMode === "string" && settings.accessMode ? { accessMode: settings.accessMode } : {}),
    ...(typeof settings.model === "string" && settings.model ? { model: settings.model } : {}),
    ...(typeof settings.reasoning === "string" && settings.reasoning ? { reasoning: settings.reasoning } : {}),
    ...(typeof settings.thirdPartyProviderId === "string" && settings.thirdPartyProviderId
      ? { thirdPartyProviderId: settings.thirdPartyProviderId }
      : {}),
    ...(typeof settings.thirdPartyModel === "string" && settings.thirdPartyModel ? { thirdPartyModel: settings.thirdPartyModel } : {}),
    ...(workspacePath ? { workspacePath } : {}),
  };
}

function hasOwnProperty(value, key) {
  return typeof value === "object"
    && value !== null
    && Object.prototype.hasOwnProperty.call(value, key);
}
