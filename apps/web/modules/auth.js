function createDefaultAccountState() {
  return {
    type: "",
    email: "",
    planType: "",
  };
}

function createDefaultAuthAccountEntryState() {
  return {
    accountId: "",
    label: "",
    accountEmail: "",
    codexHome: "",
    isActive: false,
    createdAt: "",
    updatedAt: "",
  };
}

function createDefaultPendingLoginState() {
  return {
    provider: "",
    mode: "",
    loginId: "",
    authUrl: "",
    verificationUri: "",
    userCode: "",
    startedAt: "",
    expiresAt: "",
  };
}

function createDefaultBrowserLoginState() {
  return {
    supportedOnThisBrowser: true,
    localOrigin: "",
    sshTunnelCommand: "",
  };
}

function createDefaultProviderProfileState() {
  return {
    type: "",
    name: "",
    baseUrl: "",
    model: "",
    source: "",
    lockedModel: false,
  };
}

function createDefaultRateLimitWindowState() {
  return {
    usedPercent: 0,
    windowDurationMins: 0,
    resetsAt: "",
  };
}

function createDefaultRateLimitCreditsState() {
  return {
    hasCredits: false,
    unlimited: false,
    balance: "",
  };
}

export function createDefaultAuthState() {
  return {
    status: "idle",
    errorMessage: "",
    authenticated: false,
    authMethod: "",
    requiresOpenaiAuth: true,
    account: createDefaultAccountState(),
    pendingLogin: null,
    browserLogin: createDefaultBrowserLoginState(),
    lastError: "",
    providerProfile: createDefaultProviderProfileState(),
    rateLimits: null,
    accounts: [],
    activeAccountId: "",
    currentAccountId: "",
  };
}

export function createAuthController(app) {
  let inflight = null;
  let pollTimer = 0;
  let deviceCodeCopyTimer = 0;

  function bindControls() {
    const { dom } = app;
    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already reflected in auth state for the UI.
      }
    };

    dom.authChatgptLoginButton.addEventListener("click", async () => {
      await runSafely(startChatgptLogin);
    });

    dom.authChatgptDeviceLoginButton.addEventListener("click", async () => {
      await runSafely(startChatgptDeviceLogin);
    });

    dom.authDeviceLoginCopyButton.addEventListener("click", async () => {
      await runSafely(copyDeviceCode);
    });

    dom.authLogoutButton.addEventListener("click", async () => {
      await runSafely(logout);
    });

    dom.authLoginCancelButton.addEventListener("click", async () => {
      await runSafely(cancelPendingLogin);
    });

    dom.authApiKeyButton.addEventListener("click", async () => {
      await runSafely(() => loginWithApiKey(dom.authApiKeyInput.value));
    });

    dom.authApiKeyInput.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      await runSafely(() => loginWithApiKey(dom.authApiKeyInput.value));
    });

    dom.authAccountSelect?.addEventListener("change", async () => {
      await runSafely(() => load({
        force: true,
        accountId: dom.authAccountSelect.value,
      }));
    });

    dom.authAccountActivateButton?.addEventListener("click", async () => {
      await runSafely(switchActiveAccount);
    });

    dom.authAccountCreateButton?.addEventListener("click", async () => {
      await runSafely(() => createAccount(dom.authAccountCreateInput.value));
    });

    dom.authAccountCreateInput?.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      await runSafely(() => createAccount(dom.authAccountCreateInput.value));
    });
  }

  async function load(options = {}) {
    const { force = false, quiet = false, accountId = "" } = options;
    const normalizedAccountId = typeof accountId === "string" ? accountId.trim() : "";

    if (inflight && !force) {
      return inflight;
    }

    if (
      !force
      && app.runtime.auth.status === "ready"
      && !app.runtime.auth.pendingLogin
      && (!normalizedAccountId || normalizedAccountId === app.runtime.auth.currentAccountId)
    ) {
      return app.runtime.auth;
    }

    const task = (async () => {
      if (!quiet) {
        app.runtime.auth = {
          ...app.runtime.auth,
          status: "loading",
          errorMessage: "",
        };
        app.renderer.renderAll();
      }

      try {
        const query = normalizedAccountId ? `?accountId=${encodeURIComponent(normalizedAccountId)}` : "";
        const response = await fetch(`/api/auth/status${query}`);
        const data = await app.utils.safeReadJson(response);

        if (!response.ok) {
          throw new Error(data?.error?.message ?? "读取认证状态失败。");
        }

        app.runtime.auth = normalizeAuthState(data?.auth);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (app.runtime.auth.status === "ready" && quiet) {
          app.runtime.auth = {
            ...app.runtime.auth,
            errorMessage: message,
          };
        } else {
          app.runtime.auth = {
            ...createDefaultAuthState(),
            status: "error",
            errorMessage: message,
          };
        }
      }

      syncPolling();
      void app.identity?.load({ quiet: true });
      app.renderer.renderAll();
      return app.runtime.auth;
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

  async function ensureAuthenticated(options = {}) {
    const accountId = options?.accountId ? String(options.accountId).trim() : "";
    const auth = app.runtime.auth.status === "ready" && (!accountId || accountId === app.runtime.auth.currentAccountId)
      ? app.runtime.auth
      : await load({ force: true, quiet: true, accountId });

    if (!requiresAuthentication(auth)) {
      return {
        ok: true,
        auth,
      };
    }

    return {
      ok: false,
      auth,
      message: buildMissingAuthMessage(auth),
    };
  }

  async function startChatgptLogin() {
    const warning = buildRemoteBrowserLoginPrompt(app.runtime.auth);

    if (warning && !window.confirm(warning)) {
      return app.runtime.auth;
    }

    if (app.runtime.authBusy) {
      return app.runtime.auth;
    }

    app.runtime.authBusy = true;
    app.runtime.auth = {
      ...app.runtime.auth,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      const auth = await postAuth("/api/auth/login", {
        method: "chatgpt",
        mode: "browser",
        accountId: currentViewedAccountId(),
      });

      if (auth.pendingLogin?.authUrl) {
        window.open(auth.pendingLogin.authUrl, "_blank", "noopener,noreferrer");
      }

      return auth;
    } finally {
      app.runtime.authBusy = false;
      app.renderer.renderAll();
    }
  }

  async function startChatgptDeviceLogin() {
    if (app.runtime.authBusy) {
      return app.runtime.auth;
    }

    app.runtime.authBusy = true;
    app.runtime.auth = {
      ...app.runtime.auth,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      return await postAuth("/api/auth/login", {
        method: "chatgpt",
        mode: "device",
        accountId: currentViewedAccountId(),
      });
    } finally {
      app.runtime.authBusy = false;
      app.renderer.renderAll();
    }
  }

  async function copyDeviceCode() {
    const code = app.runtime.auth.pendingLogin?.mode === "device"
      ? app.runtime.auth.pendingLogin.userCode
      : "";

    if (!code) {
      return;
    }

    try {
      await copyText(code);
      setDeviceCodeCopyButtonState("已复制");
    } catch {
      setDeviceCodeCopyButtonState("复制失败");
    }
  }

  async function loginWithApiKey(apiKey) {
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";

    if (!normalizedApiKey) {
      app.runtime.auth = {
        ...app.runtime.auth,
        errorMessage: "API Key 不能为空。",
      };
      app.renderer.renderAll();
      return app.runtime.auth;
    }

    if (app.runtime.authBusy) {
      return app.runtime.auth;
    }

    app.runtime.authBusy = true;
    app.runtime.auth = {
      ...app.runtime.auth,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      const auth = await postAuth("/api/auth/login", {
        method: "apiKey",
        apiKey: normalizedApiKey,
        accountId: currentViewedAccountId(),
      });
      app.dom.authApiKeyInput.value = "";
      return auth;
    } finally {
      app.runtime.authBusy = false;
      app.renderer.renderAll();
    }
  }

  async function logout() {
    if (app.runtime.authBusy) {
      return app.runtime.auth;
    }

    app.runtime.authBusy = true;
    app.runtime.auth = {
      ...app.runtime.auth,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      return await postAuth("/api/auth/logout", {
        accountId: currentViewedAccountId(),
      });
    } finally {
      app.runtime.authBusy = false;
      app.renderer.renderAll();
    }
  }

  async function cancelPendingLogin() {
    if (app.runtime.authBusy) {
      return app.runtime.auth;
    }

    app.runtime.authBusy = true;
    app.runtime.auth = {
      ...app.runtime.auth,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      return await postAuth("/api/auth/login/cancel", {
        accountId: currentViewedAccountId(),
      });
    } finally {
      app.runtime.authBusy = false;
      app.renderer.renderAll();
    }
  }

  async function postAuth(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await app.utils.safeReadJson(response);

    if (!response.ok) {
      const message = data?.error?.message ?? "认证请求失败。";
      app.runtime.auth = {
        ...app.runtime.auth,
        errorMessage: message,
      };
      syncPolling();
      app.renderer.renderAll();
      throw new Error(message);
    }

    app.runtime.auth = normalizeAuthState(data?.auth);
    resetDeviceCodeCopyButtonState();
    syncPolling();
    app.renderer.renderAll();
    return app.runtime.auth;
  }

  async function switchActiveAccount() {
    const accountId = currentViewedAccountId();

    if (!accountId || app.runtime.authBusy) {
      return app.runtime.auth;
    }

    app.runtime.authBusy = true;
    app.runtime.auth = {
      ...app.runtime.auth,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      return await postAuth("/api/auth/account/select", { accountId });
    } finally {
      app.runtime.authBusy = false;
      app.renderer.renderAll();
    }
  }

  async function createAccount(label) {
    const normalizedLabel = typeof label === "string" ? label.trim() : "";

    if (!normalizedLabel) {
      app.runtime.auth = {
        ...app.runtime.auth,
        errorMessage: "账号名称不能为空。",
      };
      app.renderer.renderAll();
      return app.runtime.auth;
    }

    if (app.runtime.authBusy) {
      return app.runtime.auth;
    }

    app.runtime.authBusy = true;
    app.runtime.auth = {
      ...app.runtime.auth,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/auth/accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: normalizedLabel,
          activate: true,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "创建认证账号失败。");
      }

      app.runtime.auth = normalizeAuthState(data?.auth);
      app.dom.authAccountCreateInput.value = "";
      resetDeviceCodeCopyButtonState();
      syncPolling();
      app.renderer.renderAll();
      return app.runtime.auth;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.runtime.auth = {
        ...app.runtime.auth,
        errorMessage: message,
      };
      app.renderer.renderAll();
      throw error;
    } finally {
      app.runtime.authBusy = false;
      app.renderer.renderAll();
    }
  }

  function currentViewedAccountId() {
    return app.runtime.auth.currentAccountId
      || app.runtime.auth.activeAccountId
      || app.runtime.auth.accounts[0]?.accountId
      || "";
  }

  function syncPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = 0;
    }

    if (!app.runtime.auth.pendingLogin || app.runtime.auth.authenticated) {
      return;
    }

    pollTimer = window.setTimeout(() => {
      void load({ force: true, quiet: true });
    }, 2000);
  }

  return {
    bindControls,
    ensureAuthenticated,
    load,
    logout,
    cancelPendingLogin,
    loginWithApiKey,
    startChatgptLogin,
    startChatgptDeviceLogin,
    switchActiveAccount,
    createAccount,
  };

  function setDeviceCodeCopyButtonState(label) {
    resetDeviceCodeCopyButtonState();
    app.dom.authDeviceLoginCopyButton.textContent = label;
    deviceCodeCopyTimer = window.setTimeout(() => {
      app.dom.authDeviceLoginCopyButton.textContent = "复制设备码";
      deviceCodeCopyTimer = 0;
    }, 1500);
  }

  function resetDeviceCodeCopyButtonState() {
    if (deviceCodeCopyTimer) {
      clearTimeout(deviceCodeCopyTimer);
      deviceCodeCopyTimer = 0;
    }

    app.dom.authDeviceLoginCopyButton.textContent = "复制设备码";
  }
}

export function requiresAuthentication(authState) {
  return Boolean(authState?.requiresOpenaiAuth && !authState?.authenticated);
}

export function buildMissingAuthMessage(authState) {
  if (authState?.pendingLogin?.mode === "device") {
    return "设备码登录还没完成。请打开授权链接，输入一次性 code，完成授权后再发送任务。";
  }

  if (authState?.pendingLogin?.authUrl) {
    return "ChatGPT 登录还没完成。请在运行 Themis 的这台机器上打开登录页并完成浏览器授权。";
  }

  if (requiresLocalBrowserForChatgptLogin(authState)) {
    const localOrigin = authState?.browserLogin?.localOrigin || "http://localhost:3100";
    return `当前浏览器不是运行 Themis 的这台机器。请改在服务器本机浏览器打开 ${localOrigin}，或先手动建立 localhost:1455 的 SSH 隧道后再点 ChatGPT 登录。更省事的做法是直接用设备码登录。`;
  }

  if (authState?.errorMessage) {
    return `当前无法确认 Codex 认证状态：${authState.errorMessage}`;
  }

  return "当前还没有可用的 Codex 认证。请先完成 ChatGPT 浏览器登录、设备码登录，或保存 API Key。";
}

function normalizeAuthState(payload) {
  const state = createDefaultAuthState();
  const account = isRecord(payload?.account) ? payload.account : {};
  const pendingLogin = isRecord(payload?.pendingLogin) ? payload.pendingLogin : null;
  const browserLogin = isRecord(payload?.browserLogin) ? payload.browserLogin : null;
  const providerProfile = isRecord(payload?.providerProfile) ? payload.providerProfile : null;
  const rateLimits = isRecord(payload?.rateLimits) ? payload.rateLimits : null;
  const accounts = Array.isArray(payload?.accounts)
    ? payload.accounts.map(normalizeAuthAccountEntry).filter(Boolean)
    : [];

  return {
    ...state,
    status: "ready",
    authenticated: Boolean(payload?.authenticated),
    authMethod: normalizeOptionalText(payload?.authMethod),
    requiresOpenaiAuth: typeof payload?.requiresOpenaiAuth === "boolean" ? payload.requiresOpenaiAuth : true,
    account: {
      type: normalizeOptionalText(account.type),
      email: normalizeOptionalText(account.email),
      planType: normalizeOptionalText(account.planType),
    },
    pendingLogin: pendingLogin
      ? {
        provider: normalizeOptionalText(pendingLogin.provider),
        mode: normalizeOptionalText(pendingLogin.mode),
        loginId: normalizeOptionalText(pendingLogin.loginId),
        authUrl: normalizeOptionalText(pendingLogin.authUrl),
        verificationUri: normalizeOptionalText(pendingLogin.verificationUri),
        userCode: normalizeOptionalText(pendingLogin.userCode),
        startedAt: normalizeOptionalText(pendingLogin.startedAt),
        expiresAt: normalizeOptionalText(pendingLogin.expiresAt),
      }
      : null,
    browserLogin: browserLogin
      ? {
        supportedOnThisBrowser: browserLogin.supportedOnThisBrowser !== false,
        localOrigin: normalizeOptionalText(browserLogin.localOrigin),
        sshTunnelCommand: normalizeOptionalText(browserLogin.sshTunnelCommand),
      }
      : createDefaultBrowserLoginState(),
    lastError: normalizeOptionalText(payload?.lastError),
    providerProfile: providerProfile
      ? {
        type: normalizeOptionalText(providerProfile.type),
        name: normalizeOptionalText(providerProfile.name),
        baseUrl: normalizeOptionalText(providerProfile.baseUrl),
        model: normalizeOptionalText(providerProfile.model),
        source: normalizeOptionalText(providerProfile.source),
        lockedModel: Boolean(providerProfile.lockedModel),
      }
      : createDefaultProviderProfileState(),
    rateLimits: rateLimits
      ? {
        limitId: normalizeOptionalText(rateLimits.limitId),
        limitName: normalizeOptionalText(rateLimits.limitName),
        planType: normalizeOptionalText(rateLimits.planType),
        primary: normalizeRateLimitWindow(rateLimits.primary),
        secondary: normalizeRateLimitWindow(rateLimits.secondary),
        credits: normalizeRateLimitCredits(rateLimits.credits),
      }
      : null,
    accounts,
    activeAccountId: normalizeOptionalText(payload?.activeAccountId),
    currentAccountId: normalizeOptionalText(payload?.currentAccountId),
  };
}

function normalizeAuthAccountEntry(value) {
  if (!isRecord(value)) {
    return null;
  }

  const accountId = normalizeOptionalText(value.accountId);

  if (!accountId) {
    return null;
  }

  return {
    ...createDefaultAuthAccountEntryState(),
    accountId,
    label: normalizeOptionalText(value.label) || accountId,
    accountEmail: normalizeOptionalText(value.accountEmail),
    codexHome: normalizeOptionalText(value.codexHome),
    isActive: Boolean(value.isActive),
    createdAt: normalizeOptionalText(value.createdAt),
    updatedAt: normalizeOptionalText(value.updatedAt),
  };
}

export function requiresLocalBrowserForChatgptLogin(authState) {
  return Boolean(
    authState?.requiresOpenaiAuth
    && !authState?.authenticated
    && !authState?.pendingLogin
    && authState?.browserLogin?.supportedOnThisBrowser === false,
  );
}

export function buildRemoteBrowserLoginPrompt(authState) {
  if (!requiresLocalBrowserForChatgptLogin(authState)) {
    return "";
  }

  const localOrigin = authState?.browserLogin?.localOrigin || "http://localhost:3100";
  const tunnelCommand = authState?.browserLogin?.sshTunnelCommand || "ssh -L 1455:127.0.0.1:1455 <ssh-user>@<server>";

  return [
    "当前浏览器不是运行 Themis 的这台机器。",
    "直接点 ChatGPT 登录后，OpenAI 会回跳到你当前电脑的 localhost:1455，默认接不到服务器上的 Codex 回调。",
    "",
    "如果你只是想远端完成登录，更简单的做法是直接改用“设备码登录”。",
    `推荐做法：改在服务器本机浏览器打开 ${localOrigin}`,
    `如果你已经手动建立了 SSH 隧道，也可以继续：${tunnelCommand}`,
    "",
    "如果你已经确认回调链路可达，点“确定”继续发起登录；否则点“取消”。",
  ].join("\n");
}

function normalizeOptionalText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRateLimitWindow(value) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    ...createDefaultRateLimitWindowState(),
    usedPercent: normalizeFiniteNumber(value.usedPercent),
    windowDurationMins: normalizeFiniteNumber(value.windowDurationMins),
    resetsAt: normalizeOptionalText(value.resetsAt),
  };
}

function normalizeRateLimitCredits(value) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    ...createDefaultRateLimitCreditsState(),
    hasCredits: Boolean(value.hasCredits),
    unlimited: Boolean(value.unlimited),
    balance: normalizeOptionalText(value.balance),
  };
}

function normalizeFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback below keeps LAN HTTP pages usable.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    const copied = document.execCommand("copy");

    if (!copied) {
      throw new Error("copy failed");
    }
  } finally {
    textArea.remove();
  }
}
