export function createSessionSettingsController(app) {
  async function loadThreadSettings(threadId, options = {}) {
    const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";

    if (!normalizedThreadId) {
      return;
    }

    const thread = app.store.getThreadById(normalizedThreadId);

    if (!thread) {
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(normalizedThreadId)}/settings`);
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取服务端会话配置失败。");
      }

      if (!data?.found || !data?.settings) {
        if (hasExplicitSessionSettings(thread.settings)) {
          await persistThreadSettings(normalizedThreadId, thread.settings, { quiet: true });
        }
        return;
      }

      applySettingsToThread(normalizedThreadId, data.settings);
    } catch (error) {
      if (!options.quiet) {
        console.error("Session settings load failed.", error);
      }
    }
  }

  async function persistThreadSettings(threadId, settings, options = {}) {
    const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";

    if (!normalizedThreadId) {
      return false;
    }

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

      return true;
    } catch (error) {
      if (!options.quiet) {
        console.error("Session settings persist failed.", error);
      }

      if (options.throwOnError) {
        throw error;
      }

      return false;
    }
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
