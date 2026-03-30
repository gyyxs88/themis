import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer } from "./ui.js";
import * as utils from "./utils.js";

if (typeof globalThis.HTMLOptionElement === "undefined") {
  globalThis.HTMLOptionElement = class HTMLOptionElement {};
}

if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    body: createElementStub("body"),
  };
}

test("renderAll 会在 Review 可用时切换 composer placeholder 和提交文案", () => {
  const harness = createRendererHarness({
    actionBarState: {
      mode: "review",
      review: {
        enabled: true,
        reason: "",
      },
      steer: {
        enabled: false,
        reason: "当前没有执行中的任务可调整",
      },
    },
  });

  harness.renderer.renderAll();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "补充你希望重点审查的内容，例如：优先看回归风险和缺失测试",
  );
  assert.equal(harness.dom.submitButton.textContent, "提交 Review");
  assert.match(harness.dom.composerActionBar.innerHTML, /data-composer-mode-button="review"[\s\S]*?>\s*Review\s*<\/button>/);
  assert.match(harness.dom.composerActionBar.innerHTML, /aria-pressed="true"/);
});

test("renderAll 会在 Steer 可用时切换 composer placeholder 和提交文案", () => {
  const harness = createRendererHarness({
    actionBarState: {
      mode: "steer",
      review: {
        enabled: false,
        reason: "当前还没有可审查的已收口结果",
      },
      steer: {
        enabled: true,
        reason: "",
      },
    },
  });

  harness.renderer.renderAll();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "补充你希望当前执行如何调整，例如：先收紧范围，只处理 Web 回归",
  );
  assert.equal(harness.dom.submitButton.textContent, "发送 Steer");
  assert.match(harness.dom.composerActionBar.innerHTML, /data-composer-mode-button="steer"[\s\S]*?>\s*Steer\s*<\/button>/);
  assert.match(harness.dom.composerActionBar.innerHTML, /aria-pressed="true"/);
});

test("renderAll 会在持久模式不可用时回退到 chat 语义", () => {
  const harness = createRendererHarness({
    actionBarState: {
      mode: "review",
      review: {
        enabled: false,
        reason: "当前还没有可审查的已收口结果",
      },
      steer: {
        enabled: false,
        reason: "当前没有执行中的任务可调整",
      },
    },
  });

  harness.renderer.renderAll();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "直接输入你的目标、约束和注意事项，例如：继续把这个界面做成员工可用版本，并优先优化输入体验",
  );
  assert.equal(harness.dom.submitButton.textContent, "发送给 Themis");
  assert.match(harness.dom.composerActionBar.innerHTML, /data-composer-mode-button="review"/);
  assert.match(harness.dom.composerActionBar.innerHTML, /data-composer-mode-button="steer"/);
  assert.doesNotMatch(harness.dom.composerActionBar.innerHTML, /aria-pressed="true"/);
});

function createRendererHarness({ actionBarState }) {
  const thread = {
    id: "thread-composer",
    title: "Composer 线程",
    composerMode: actionBarState.mode,
    settings: {},
    turns: [],
  };

  const dom = createDomHarness({
    composerActionBar: createElementStub("composer-action-bar"),
    goalInput: createElementStub("goal-input", { scrollHeight: 120 }),
    submitButton: createElementStub("submit-button"),
    composerAuthNote: createElementStub("composer-auth-note"),
    activeThreadLabel: createElementStub("active-thread-label"),
    threadSearchInput: createElementStub("thread-search-input"),
    threadList: createElementStub("thread-list"),
    threadEmpty: createElementStub("thread-empty"),
    threadRiskBanner: createElementStub("thread-risk-banner"),
    workspaceTitle: createElementStub("workspace-title"),
    workspaceCopy: createElementStub("workspace-copy"),
    workspaceToolsPanel: createElementStub("workspace-tools-panel"),
    workspaceToolsToggle: createElementStub("workspace-tools-toggle"),
    workspaceToolsClose: createElementStub("workspace-tools-close"),
    workspaceToolsBackdrop: createElementStub("workspace-tools-backdrop"),
    forkThreadButton: createElementStub("fork-thread-button"),
    resetPrincipalButton: createElementStub("reset-principal-button"),
    newThreadButton: createElementStub("new-thread-button"),
    conversation: createElementStub("conversation"),
    workspaceSidebarToggle: createElementStub("workspace-sidebar-toggle"),
    sidebarCollapseButton: createElementStub("sidebar-collapse-button"),
    sidebarBackdrop: createElementStub("sidebar-backdrop"),
    sidebarResizeHandle: createElementStub("sidebar-resize-handle"),
    assistantLanguageStyleInput: createElementStub("assistant-language-style-input"),
    assistantMbtiInput: createElementStub("assistant-mbti-input"),
    assistantStyleNotesInput: createElementStub("assistant-style-notes-input"),
    assistantSoulInput: createElementStub("assistant-soul-input"),
    assistantStyleNote: createElementStub("assistant-style-note"),
    modelSelect: createElementStub("model-select", { options: [] }),
    reasoningSelect: createElementStub("reasoning-select", { options: [] }),
    approvalSelect: createElementStub("approval-select", { options: [] }),
    sandboxSelect: createElementStub("sandbox-select", { options: [] }),
    webSearchSelect: createElementStub("web-search-select", { options: [] }),
    networkAccessSelect: createElementStub("network-access-select", { options: [] }),
    accessModeSelect: createElementStub("access-mode-select", { options: [] }),
    modeSwitchAuthAccountRow: createElementStub("mode-switch-auth-account-row"),
    modeSwitchAuthAccountSelect: createElementStub("mode-switch-auth-account-select", { options: [] }),
    accessModeApplyButton: createElementStub("access-mode-apply-button"),
    accessModeNote: createElementStub("access-mode-note"),
    accessModePendingNote: createElementStub("access-mode-pending-note"),
    modeSwitchThirdPartyModelRow: createElementStub("mode-switch-third-party-model-row"),
    modeSwitchThirdPartyModelSelect: createElementStub("mode-switch-third-party-model-select", { options: [] }),
    sessionWorkspaceNote: createElementStub("session-workspace-note"),
    sessionWorkspaceInput: createElementStub("session-workspace-input"),
    sessionWorkspaceApplyButton: createElementStub("session-workspace-apply-button"),
    settingsNote: createElementStub("settings-note"),
    runtimeConfigNote: createElementStub("runtime-config-note"),
    conversationLinkCurrent: createElementStub("conversation-link-current"),
    conversationLinkInput: createElementStub("conversation-link-input"),
    conversationLinkButton: createElementStub("conversation-link-button"),
    conversationLinkNote: createElementStub("conversation-link-note"),
    identityBrowserNote: createElementStub("identity-browser-note"),
    identityPrincipalNote: createElementStub("identity-principal-note"),
    identityLinkCodeButton: createElementStub("identity-link-code-button"),
    identityLinkNote: createElementStub("identity-link-note"),
    identityLinkCode: createElementStub("identity-link-code"),
    settingsRuntimeSection: createElementStub("settings-runtime-section"),
    settingsAuthSection: createElementStub("settings-auth-section"),
    settingsSkillsSection: createElementStub("settings-skills-section"),
    settingsThirdPartySection: createElementStub("settings-third-party-section"),
    settingsModeSwitchSection: createElementStub("settings-mode-switch-section"),
    skillsPanelActions: null,
    skillsStatusNote: createElementStub("skills-status-note"),
    skillsListEmpty: createElementStub("skills-list-empty"),
    skillsList: createElementStub("skills-list"),
    skillsCuratedEmpty: createElementStub("skills-curated-empty"),
    skillsCuratedList: createElementStub("skills-curated-list"),
    thirdPartyEditorModal: createElementStub("third-party-editor-modal"),
    thirdPartyEditorBackdrop: createElementStub("third-party-editor-backdrop"),
    thirdPartyEditorClose: createElementStub("third-party-editor-close"),
    thirdPartyEditorTitle: createElementStub("third-party-editor-title"),
    thirdPartyEditorCopy: createElementStub("third-party-editor-copy"),
    thirdPartyEditorError: createElementStub("third-party-editor-error"),
    thirdPartyProviderForm: createElementStub("third-party-provider-form"),
    thirdPartyProviderIdInput: createElementStub("third-party-provider-id-input"),
    thirdPartyProviderNameInput: createElementStub("third-party-provider-name-input"),
    thirdPartyProviderBaseUrlInput: createElementStub("third-party-provider-base-url-input"),
    thirdPartyProviderApiKeyInput: createElementStub("third-party-provider-api-key-input"),
    thirdPartyProviderEndpointCandidatesInput: createElementStub("third-party-provider-endpoint-candidates-input"),
    thirdPartyProviderWireApiSelect: createElementStub("third-party-provider-wire-api-select", { options: [] }),
    thirdPartyProviderWebsocketInput: createElementStub("third-party-provider-websocket-input"),
    thirdPartyProviderSubmitButton: createElementStub("third-party-provider-submit-button"),
    thirdPartyProviderCancelButton: createElementStub("third-party-provider-cancel-button"),
    thirdPartyModelForm: createElementStub("third-party-model-form"),
    thirdPartyModelProviderSelect: createElementStub("third-party-model-provider-select", { options: [] }),
    thirdPartyModelIdInput: createElementStub("third-party-model-id-input"),
    thirdPartyModelDisplayNameInput: createElementStub("third-party-model-display-name-input"),
    thirdPartyModelDefaultReasoningSelect: createElementStub("third-party-model-default-reasoning-select", { options: [] }),
    thirdPartyModelContextWindowInput: createElementStub("third-party-model-context-window-input"),
    thirdPartyModelDescriptionInput: createElementStub("third-party-model-description-input"),
    thirdPartyModelSupportsCodexInput: createElementStub("third-party-model-supports-codex-input"),
    thirdPartyModelImageInput: createElementStub("third-party-model-image-input"),
    thirdPartyModelSearchInput: createElementStub("third-party-model-search-input"),
    thirdPartyModelParallelToolsInput: createElementStub("third-party-model-parallel-tools-input"),
    thirdPartyModelVerbosityInput: createElementStub("third-party-model-verbosity-input"),
    thirdPartyModelReasoningSummaryInput: createElementStub("third-party-model-reasoning-summary-input"),
    thirdPartyModelImageDetailInput: createElementStub("third-party-model-image-detail-input"),
    thirdPartyModelDefaultInput: createElementStub("third-party-model-default-input"),
    thirdPartyModelSubmitButton: createElementStub("third-party-model-submit-button"),
    thirdPartyModelCancelButton: createElementStub("third-party-model-cancel-button"),
    authStatusNote: createElementStub("auth-status-note"),
    authAccountSelect: createElementStub("auth-account-select", { options: [] }),
    authAccountActivateButton: createElementStub("auth-account-activate-button"),
    authAccountCreateInput: createElementStub("auth-account-create-input"),
    authAccountCreateButton: createElementStub("auth-account-create-button"),
    authAccountNote: createElementStub("auth-account-note"),
    authRateLimitsPanel: createElementStub("auth-rate-limits-panel"),
    authRateLimitsPlan: createElementStub("auth-rate-limits-plan"),
    authRateLimitsGrid: createElementStub("auth-rate-limits-grid"),
    authRateLimitsEmpty: createElementStub("auth-rate-limits-empty"),
    authRateLimitsCredits: createElementStub("auth-rate-limits-credits"),
    authRateLimitPrimaryCard: createElementStub("auth-rate-limit-primary-card"),
    authRateLimitPrimaryLabel: createElementStub("auth-rate-limit-primary-label"),
    authRateLimitPrimaryRemaining: createElementStub("auth-rate-limit-primary-remaining"),
    authRateLimitPrimaryProgress: createElementStub("auth-rate-limit-primary-progress"),
    authRateLimitPrimaryFill: createElementStub("auth-rate-limit-primary-fill"),
    authRateLimitPrimaryReset: createElementStub("auth-rate-limit-primary-reset"),
    authRateLimitSecondaryCard: createElementStub("auth-rate-limit-secondary-card"),
    authRateLimitSecondaryLabel: createElementStub("auth-rate-limit-secondary-label"),
    authRateLimitSecondaryRemaining: createElementStub("auth-rate-limit-secondary-remaining"),
    authRateLimitSecondaryProgress: createElementStub("auth-rate-limit-secondary-progress"),
    authRateLimitSecondaryFill: createElementStub("auth-rate-limit-secondary-fill"),
    authRateLimitSecondaryReset: createElementStub("auth-rate-limit-secondary-reset"),
    authRemoteLoginPanel: createElementStub("auth-remote-login-panel"),
    authRemoteLoginCopy: createElementStub("auth-remote-login-copy"),
    authRemoteLoginCommand: createElementStub("auth-remote-login-command"),
    authBrowserLoginPanel: createElementStub("auth-browser-login-panel"),
    authBrowserLoginLink: createElementStub("auth-browser-login-link"),
    authBrowserLoginNote: createElementStub("auth-browser-login-note"),
    authDeviceLoginPanel: createElementStub("auth-device-login-panel"),
    authDeviceLoginLink: createElementStub("auth-device-login-link"),
    authDeviceLoginCode: createElementStub("auth-device-login-code"),
    authDeviceLoginCopyButton: createElementStub("auth-device-login-copy-button"),
    authDeviceLoginNote: createElementStub("auth-device-login-note"),
    authChatgptLoginButton: createElementStub("auth-chatgpt-login-button"),
    authChatgptDeviceLoginButton: createElementStub("auth-chatgpt-device-login-button"),
    authLogoutButton: createElementStub("auth-logout-button"),
    authLoginCancelButton: createElementStub("auth-login-cancel-button"),
    authApiKeyInput: createElementStub("auth-api-key-input"),
    authApiKeyButton: createElementStub("auth-api-key-button"),
  });

  const store = {
    state: {
      activeThreadId: thread.id,
    },
    ensureActiveThread() {},
    getVisibleThreads() {
      return [];
    },
    threadStatus() {
      return "idle";
    },
    getActiveThread() {
      return thread;
    },
    isBusy() {
      return false;
    },
    resolveComposerActionBarState() {
      return actionBarState;
    },
    createDefaultThreadSettings() {
      return {};
    },
    resolveEffectiveSettings() {
      return {
        accessMode: "auth",
        sandboxMode: "workspace-write",
        webSearchMode: "disabled",
        networkAccessEnabled: true,
      };
    },
    resolveTransientStatus() {
      return "";
    },
    getRunningThreadId() {
      return "";
    },
    getThreadById() {
      return null;
    },
    resolveAccessMode() {
      return "auth";
    },
    resolveThirdPartySelection() {
      return {
        provider: null,
        model: null,
        modelId: "",
      };
    },
    getVisibleModels() {
      return [];
    },
    getReasoningOptions() {
      return [];
    },
    resolveInheritedSettings() {
      return {
        reasoning: "",
      };
    },
    describeAssistantStyle() {
      return "当前人格描述";
    },
    getThirdPartyProviders() {
      return [];
    },
    getThirdPartyModels() {
      return [];
    },
    getThirdPartyModelCapabilities() {
      return {
        supportsCodexTasks: true,
        imageInput: true,
        supportsSearchTool: true,
        supportsParallelToolCalls: true,
        supportsVerbosity: true,
        supportsReasoningSummaries: true,
        supportsImageDetailOriginal: true,
      };
    },
    resolveThirdPartyWebSearchWarning() {
      return "";
    },
    resolveTopRiskState() {
      return null;
    },
    getVisibleAssistantMessages() {
      return [];
    },
    latestTurnMessage() {
      return "";
    },
  };

  const app = {
    dom,
    store,
    utils: {
      ...utils,
      autoResizeTextarea() {},
      scrollConversationToBottom() {},
    },
    history: {
      getDisplayTurnCount(currentThread) {
        return Array.isArray(currentThread?.turns) ? currentThread.turns.length : 0;
      },
      threadNeedsHistoryHydration() {
        return false;
      },
      refreshHistoryFromServer() {},
    },
    runtime: {
      threadSearchQuery: "",
      sessionControlBusy: false,
      workspaceToolsOpen: false,
      workspaceToolsSection: "runtime",
      historyHydratingThreadId: null,
      thirdPartyEditor: {
        mode: "provider",
        open: false,
        errorMessage: "",
        submitting: false,
        providerForm: {
          id: "",
          name: "",
          baseUrl: "",
          apiKey: "",
          endpointCandidates: "",
          wireApi: "",
          supportsWebsockets: false,
        },
        modelForm: {
          providerId: "",
          model: "",
          displayName: "",
          defaultReasoningLevel: "medium",
          contextWindow: "",
          description: "",
          supportsCodexTasks: false,
          imageInput: false,
          supportsSearchTool: false,
          supportsParallelToolCalls: false,
          supportsVerbosity: false,
          supportsReasoningSummaries: false,
          supportsImageDetailOriginal: false,
          setAsDefault: false,
        },
      },
      thirdPartyEndpointProbe: {
        status: "idle",
        providerId: "",
        checkedAt: "",
        selectedBaseUrl: "",
        fastestHealthyLatencyMs: 0,
        results: [],
        summary: "",
        detail: "",
        persistedMessage: "",
      },
      thirdPartyProbe: {
        status: "idle",
        providerId: "",
        model: "",
        checkedAt: "",
        summary: "",
        detail: "",
        observedCommand: "",
        outputPreview: "",
        results: [],
        persistStatus: "idle",
        persistMessage: "",
      },
      runtimeConfig: {
        status: "ready",
        defaults: {},
        accessModes: [],
        provider: null,
      },
      auth: {
        status: "ready",
        errorMessage: "",
        authenticated: false,
        authMethod: "",
        requiresOpenaiAuth: false,
        account: {
          email: "",
          planType: "",
        },
        pendingLogin: null,
        browserLogin: {
          supportedOnThisBrowser: true,
          localOrigin: "",
          sshTunnelCommand: "",
        },
        lastError: "",
        providerProfile: {
          type: "",
          name: "",
          baseUrl: "",
          model: "",
          source: "",
          lockedModel: false,
        },
        rateLimits: null,
        accounts: [],
        activeAccountId: "",
        currentAccountId: "",
      },
      authBusy: false,
      identity: {
        browserUserId: "",
        principalId: "",
        principalDisplayName: "",
        savingPersona: false,
        savingTaskSettings: false,
        issuing: false,
      },
      skills: {
        loading: false,
        installing: false,
        syncing: false,
        skills: [],
        curated: [],
        noticeMessage: "",
        errorMessage: "",
      },
      pendingInterruptSubmit: null,
      activeRequestController: null,
      activeRunRef: null,
      restoredActionHydrationThreadId: null,
    },
    modeSwitch: {
      getDraft() {
        return {
          accessMode: "auth",
          dirty: false,
          thirdPartyModel: "",
        };
      },
    },
  };

  const renderer = createRenderer(app);

  return {
    app,
    dom,
    renderer,
  };
}

function createDomHarness(overrides = {}) {
  const state = {
    emptyThreadMarkup: '<div class="empty-thread">empty</div>',
    workspaceToolsNavButtons: [],
    skillsPanelActions: null,
    conversation: createElementStub("conversation"),
  };

  Object.assign(state, overrides);

  return new Proxy(state, {
    get(target, prop) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop);
      }

      const stub = createElementStub(String(prop));
      Reflect.set(target, prop, stub);
      return stub;
    },
    set(target, prop, value) {
      Reflect.set(target, prop, value);
      return true;
    },
  });
}

function createElementStub(name, options = {}) {
  const attributes = {};
  const classSet = new Set();

  return {
    name,
    value: "",
    textContent: "",
    innerHTML: "",
    placeholder: "",
    href: "",
    disabled: false,
    hidden: false,
    tabIndex: 0,
    scrollHeight: options.scrollHeight ?? 0,
    style: {},
    dataset: {},
    options: options.options ?? [],
    attributes,
    classList: {
      add(...classes) {
        classes.forEach((className) => classSet.add(className));
      },
      remove(...classes) {
        classes.forEach((className) => classSet.delete(className));
      },
      toggle(className, force) {
        const shouldHaveClass = typeof force === "boolean" ? force : !classSet.has(className);

        if (shouldHaveClass) {
          classSet.add(className);
        } else {
          classSet.delete(className);
        }

        return shouldHaveClass;
      },
      contains(className) {
        return classSet.has(className);
      },
    },
    addEventListener() {},
    focus() {},
    scrollTo() {},
    scrollIntoView() {},
    requestSubmit() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    getAttribute(name) {
      return attributes[name];
    },
    querySelectorAll() {
      return [];
    },
  };
}
