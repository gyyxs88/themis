function createDefaultIdentityState(browserUserId = "") {
  return {
    status: "idle",
    browserUserId,
    principalId: "",
    principalDisplayName: "",
    assistantLanguageStyle: "",
    assistantLanguageStyleDraft: "",
    assistantMbti: "",
    assistantMbtiDraft: "",
    assistantStyleNotes: "",
    assistantStyleNotesDraft: "",
    assistantSoul: "",
    assistantSoulDraft: "",
    taskSettings: createDefaultTaskSettings(),
    linkCode: "",
    linkCodeExpiresAt: "",
    errorMessage: "",
    issuing: false,
    savingPersona: false,
    savingTaskSettings: false,
  };
}

function createDefaultTaskSettings() {
  return {
    authAccountId: "",
    model: "",
    reasoning: "",
    sandboxMode: "",
    webSearchMode: "",
    networkAccessEnabled: null,
    approvalPolicy: "",
  };
}

export function createIdentityController(app) {
  const browserUserId = ensureBrowserUserId(app.constants.WEB_IDENTITY_STORAGE_KEY);
  app.runtime.identity = createDefaultIdentityState(browserUserId);

  async function load(options = {}) {
    const { quiet = false } = options;

    if (!quiet) {
      app.runtime.identity = {
        ...app.runtime.identity,
        status: "loading",
        errorMessage: "",
      };
      app.renderer.renderAll();
    }

    try {
      const response = await fetch("/api/identity/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildIdentityPayload()),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取身份状态失败。");
      }

      const identity = data?.identity ?? {};
      const personaProfile = data?.personaProfile ?? {};
      const taskSettings = normalizeTaskSettings(data?.taskSettings);
      app.runtime.identity = {
        ...app.runtime.identity,
        status: "ready",
        principalId: typeof identity.principalId === "string" ? identity.principalId : "",
        principalDisplayName: typeof identity.principalDisplayName === "string" ? identity.principalDisplayName : "",
        assistantLanguageStyle: typeof personaProfile.assistantLanguageStyle === "string"
          ? personaProfile.assistantLanguageStyle
          : "",
        assistantLanguageStyleDraft: typeof personaProfile.assistantLanguageStyle === "string"
          ? personaProfile.assistantLanguageStyle
          : "",
        assistantMbti: typeof personaProfile.assistantMbti === "string" ? personaProfile.assistantMbti : "",
        assistantMbtiDraft: typeof personaProfile.assistantMbti === "string" ? personaProfile.assistantMbti : "",
        assistantStyleNotes: typeof personaProfile.assistantStyleNotes === "string"
          ? personaProfile.assistantStyleNotes
          : "",
        assistantStyleNotesDraft: typeof personaProfile.assistantStyleNotes === "string"
          ? personaProfile.assistantStyleNotes
          : "",
        assistantSoul: typeof personaProfile.assistantSoul === "string" ? personaProfile.assistantSoul : "",
        assistantSoulDraft: typeof personaProfile.assistantSoul === "string" ? personaProfile.assistantSoul : "",
        taskSettings,
        errorMessage: "",
      };
    } catch (error) {
      app.runtime.identity = {
        ...app.runtime.identity,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    app.renderer.renderAll();
    return app.runtime.identity;
  }

  async function issueLinkCode() {
    if (app.runtime.identity.issuing) {
      return app.runtime.identity;
    }

    app.runtime.identity = {
      ...app.runtime.identity,
      issuing: true,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/identity/link-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildIdentityPayload()),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "生成绑定码失败。");
      }

      const linkCode = data?.linkCode ?? {};
      app.runtime.identity = {
        ...app.runtime.identity,
        status: "ready",
        principalId: typeof linkCode.principalId === "string" ? linkCode.principalId : app.runtime.identity.principalId,
        linkCode: typeof linkCode.code === "string" ? linkCode.code : "",
        linkCodeExpiresAt: typeof linkCode.expiresAt === "string" ? linkCode.expiresAt : "",
        errorMessage: "",
        issuing: false,
      };
    } catch (error) {
      app.runtime.identity = {
        ...app.runtime.identity,
        issuing: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    app.renderer.renderAll();
    return app.runtime.identity;
  }

  function updatePersonaDraft(patch) {
    app.runtime.identity = {
      ...app.runtime.identity,
      ...patch,
    };
  }

  async function saveAssistantPersona(payload, options = {}) {
    const normalizedPayload = {
      assistantLanguageStyle: typeof payload?.assistantLanguageStyle === "string" ? payload.assistantLanguageStyle.trim() : "",
      assistantMbti: typeof payload?.assistantMbti === "string" ? payload.assistantMbti.trim() : "",
      assistantStyleNotes: typeof payload?.assistantStyleNotes === "string" ? payload.assistantStyleNotes.trim() : "",
      assistantSoul: typeof payload?.assistantSoul === "string" ? payload.assistantSoul.trim() : "",
    };
    const { quiet = false } = options;

    if (
      app.runtime.identity.status === "ready"
      && !app.runtime.identity.savingPersona
      && normalizedPayload.assistantLanguageStyle === app.runtime.identity.assistantLanguageStyle
      && normalizedPayload.assistantMbti === app.runtime.identity.assistantMbti
      && normalizedPayload.assistantStyleNotes === app.runtime.identity.assistantStyleNotes
      && normalizedPayload.assistantSoul === app.runtime.identity.assistantSoul
    ) {
      return true;
    }

    app.runtime.identity = {
      ...app.runtime.identity,
      savingPersona: true,
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/identity/persona", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildIdentityPayload(),
          ...normalizedPayload,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存长期人格失败。");
      }

      const identity = data?.identity ?? {};
      const personaProfile = data?.personaProfile ?? {};
      app.runtime.identity = {
        ...app.runtime.identity,
        status: "ready",
        principalId: typeof identity.principalId === "string" ? identity.principalId : app.runtime.identity.principalId,
        principalDisplayName: typeof identity.principalDisplayName === "string"
          ? identity.principalDisplayName
          : app.runtime.identity.principalDisplayName,
        assistantLanguageStyle: typeof personaProfile.assistantLanguageStyle === "string"
          ? personaProfile.assistantLanguageStyle
          : "",
        assistantLanguageStyleDraft: typeof personaProfile.assistantLanguageStyle === "string"
          ? personaProfile.assistantLanguageStyle
          : "",
        assistantMbti: typeof personaProfile.assistantMbti === "string" ? personaProfile.assistantMbti : "",
        assistantMbtiDraft: typeof personaProfile.assistantMbti === "string" ? personaProfile.assistantMbti : "",
        assistantStyleNotes: typeof personaProfile.assistantStyleNotes === "string"
          ? personaProfile.assistantStyleNotes
          : "",
        assistantStyleNotesDraft: typeof personaProfile.assistantStyleNotes === "string"
          ? personaProfile.assistantStyleNotes
          : "",
        assistantSoul: typeof personaProfile.assistantSoul === "string" ? personaProfile.assistantSoul : "",
        assistantSoulDraft: typeof personaProfile.assistantSoul === "string" ? personaProfile.assistantSoul : "",
        savingPersona: false,
      };
      app.renderer.renderAll();
      return true;
    } catch (error) {
      app.runtime.identity = {
        ...app.runtime.identity,
        savingPersona: false,
      };
      app.renderer.renderAll();

      if (!quiet) {
        const activeThread = app.store.getActiveThread();

        if (activeThread) {
          app.store.setTransientStatus(
            activeThread.id,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return false;
    }
  }

  async function saveTaskSettings(taskSettings, options = {}) {
    const normalizedTaskSettings = normalizeTaskSettings(taskSettings);
    const { quiet = false } = options;

    if (
      app.runtime.identity.status === "ready"
      && !app.runtime.identity.savingTaskSettings
      && isSameTaskSettings(normalizedTaskSettings, app.runtime.identity.taskSettings)
    ) {
      return true;
    }

    app.runtime.identity = {
      ...app.runtime.identity,
      savingTaskSettings: true,
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/identity/task-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildIdentityPayload(),
          settings: normalizedTaskSettings,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存默认任务配置失败。");
      }

      app.runtime.identity = {
        ...app.runtime.identity,
        status: "ready",
        taskSettings: normalizeTaskSettings(data?.taskSettings),
        savingTaskSettings: false,
      };
      app.renderer.renderAll();
      return true;
    } catch (error) {
      app.runtime.identity = {
        ...app.runtime.identity,
        savingTaskSettings: false,
      };
      app.renderer.renderAll();

      if (!quiet) {
        const activeThread = app.store.getActiveThread();

        if (activeThread) {
          app.store.setTransientStatus(
            activeThread.id,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return false;
    }
  }

  function getRequestIdentity() {
    const displayName = resolveDisplayName();

    return {
      userId: browserUserId,
      ...(displayName ? { displayName } : {}),
    };
  }

  function buildIdentityPayload() {
    const displayName = resolveDisplayName();

    return {
      channel: "web",
      channelUserId: browserUserId,
      ...(displayName ? { displayName } : {}),
    };
  }

  function resolveDisplayName() {
    const authEmail = typeof app.runtime.auth?.account?.email === "string"
      ? app.runtime.auth.account.email.trim()
      : "";

    if (authEmail) {
      return authEmail;
    }

    return `Themis Web ${browserUserId.slice(-6)}`;
  }

  return {
    load,
    issueLinkCode,
    saveAssistantPersona,
    saveTaskSettings,
    updatePersonaDraft,
    getRequestIdentity,
  };
}

function normalizeTaskSettings(value) {
  if (!value || typeof value !== "object") {
    return createDefaultTaskSettings();
  }

  return {
    authAccountId: typeof value.authAccountId === "string" ? value.authAccountId : "",
    model: typeof value.model === "string" ? value.model : "",
    reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
    sandboxMode: typeof value.sandboxMode === "string" ? value.sandboxMode : "",
    webSearchMode: typeof value.webSearchMode === "string" ? value.webSearchMode : "",
    networkAccessEnabled: typeof value.networkAccessEnabled === "boolean" ? value.networkAccessEnabled : null,
    approvalPolicy: typeof value.approvalPolicy === "string" ? value.approvalPolicy : "",
  };
}

function isSameTaskSettings(left, right) {
  return left.authAccountId === right.authAccountId
    && left.model === right.model
    && left.reasoning === right.reasoning
    && left.sandboxMode === right.sandboxMode
    && left.webSearchMode === right.webSearchMode
    && left.networkAccessEnabled === right.networkAccessEnabled
    && left.approvalPolicy === right.approvalPolicy;
}

function ensureBrowserUserId(storageKey) {
  const existing = localStorage.getItem(storageKey);

  if (typeof existing === "string" && existing.trim()) {
    return existing.trim();
  }

  const browserUserId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(storageKey, browserUserId);
  return browserUserId;
}
