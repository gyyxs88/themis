function createDefaultIdentityState(browserUserId = "") {
  return {
    status: "idle",
    browserUserId,
    principalId: "",
    principalDisplayName: "",
    linkCode: "",
    linkCodeExpiresAt: "",
    errorMessage: "",
    issuing: false,
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
      app.runtime.identity = {
        ...app.runtime.identity,
        status: "ready",
        principalId: typeof identity.principalId === "string" ? identity.principalId : "",
        principalDisplayName: typeof identity.principalDisplayName === "string" ? identity.principalDisplayName : "",
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
    getRequestIdentity,
  };
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
