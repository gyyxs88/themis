import assert from "node:assert/strict";
import test from "node:test";
import { createRenderer } from "./ui.js";

test("renderComposer 会在 review 可用时使用 review 文案", () => {
  const harness = createHarness({
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

  assert.equal(typeof harness.renderer.renderComposer, "function");
  harness.renderer.renderComposer();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "补充你希望重点审查的内容，例如：优先看回归风险和缺失测试",
  );
  assert.equal(harness.dom.submitButton.textContent, "提交 Review");
});

test("renderComposer 会在 steer 可用时使用 steer 文案", () => {
  const harness = createHarness({
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

  harness.renderer.renderComposer();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "补充你希望当前执行如何调整，例如：先收紧范围，只处理 Web 回归",
  );
  assert.equal(harness.dom.submitButton.textContent, "发送 Steer");
});

test("renderComposer 会在持久模式不可用时回退到 chat 语义", () => {
  const harness = createHarness({
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

  harness.renderer.renderComposer();

  assert.equal(
    harness.dom.goalInput.placeholder,
    "直接输入你的目标、约束和注意事项，例如：继续把这个界面做成员工可用版本，并优先优化输入体验",
  );
  assert.equal(harness.dom.submitButton.textContent, "发送给 Themis");
  assert.ok(harness.dom.composerActionBar.innerHTML.includes('data-composer-mode-button="review"'));
  assert.ok(harness.dom.composerActionBar.innerHTML.includes('data-composer-mode-button="steer"'));
  assert.ok(!harness.dom.composerActionBar.innerHTML.includes('aria-pressed="true"'));
  assert.ok(!harness.dom.composerActionBar.innerHTML.includes('active"'));
});

test("renderThreadControlPanel 会渲染主视图 conversationId、折叠详情，并且不回填接入输入框", () => {
  const harness = createHarness({
    actionBarState: {
      mode: "chat",
      review: {
        enabled: false,
        reason: "",
      },
      steer: {
        enabled: false,
        reason: "",
      },
    },
    threadControlState: {
      status: { kind: "waiting", label: "等待处理中的 action" },
      source: { kind: "attached", label: "已接入" },
      conversationId: "conversation-123",
      joinHint: "把飞书 /current 或其他渠道拿到的 conversationId 粘贴到这里，就能切到同一条统一会话。",
      details: [
        { label: "conversationId", value: "conversation-123" },
        { label: "serverThreadId", value: "server-thread-456" },
        { label: "来源", value: "已接入" },
      ],
    },
    runtime: {
      threadControlJoinOpen: true,
    },
  });

  assert.equal(typeof harness.renderer.renderThreadControlPanel, "function");
  harness.dom.conversationLinkInput.value = "user-pasted-id";
  harness.renderer.renderThreadControlPanel();

  assert.equal(harness.dom.threadControlStatus.textContent, "等待处理中的 action");
  assert.equal(harness.dom.threadControlConversationId.textContent, "conversation-123");
  assert.ok(harness.dom.threadControlSource.innerHTML.includes("已接入"));
  assert.ok(harness.dom.threadControlDetails.innerHTML.includes("<details"));
  assert.ok(harness.dom.threadControlDetails.innerHTML.includes("<summary>查看详情</summary>"));
  assert.ok(harness.dom.threadControlDetails.innerHTML.includes("conversation-123"));
  assert.equal(harness.dom.threadControlPanel.hidden, false);
  assert.equal(harness.dom.threadControlJoinPanel.hidden, false);
  assert.equal(harness.dom.threadControlJoinToggle.getAttribute("aria-expanded"), "true");
  assert.equal(harness.dom.conversationLinkInput.value, "user-pasted-id");
});

function createHarness({ actionBarState, threadControlState = null, runtime = {} }) {
  const thread = {
    id: "thread-composer",
    title: "Composer 线程",
    composerMode: actionBarState.mode,
    serverThreadId: threadControlState?.details?.find((item) => item.label === "serverThreadId")?.value || "",
    settings: {},
    turns: [],
  };

  const dom = {
    goalInput: createInputStub(),
    submitButton: createTextStub(),
    composerActionBar: createTextStub(),
    composerAuthNote: createTextStub(),
    threadControlPanel: createPanelStub(),
    threadControlStatus: createTextStub(),
    threadControlConversationId: createTextStub(),
    threadControlSource: createTextStub(),
    threadControlDetails: createTextStub(),
    threadControlJoinHint: createTextStub(),
    threadControlJoinToggle: createButtonStub(),
    threadControlJoinPanel: createPanelStub(true),
    conversationLinkInput: createDisabledInputStub(),
    conversationLinkButton: createButtonStub(),
    conversationLinkNote: createTextStub(),
    forkThreadButton: createButtonStub(),
    resetPrincipalButton: createButtonStub(),
    newThreadButton: createButtonStub(),
    workspaceToolsToggle: createButtonStub(),
    workspaceToolsClose: createButtonStub(),
    threadSearchInput: createDisabledInputStub(),
    assistantLanguageStyleInput: createDisabledInputStub(),
    assistantMbtiInput: createDisabledInputStub(),
    assistantStyleNotesInput: createDisabledInputStub(),
    assistantSoulInput: createDisabledInputStub(),
    reasoningSelect: createDisabledInputStub(),
    approvalSelect: createDisabledInputStub(),
    sandboxSelect: createDisabledInputStub(),
    webSearchSelect: createDisabledInputStub(),
    networkAccessSelect: createDisabledInputStub(),
    modelSelect: createDisabledInputStub(),
    identityLinkCodeButton: createButtonStub(),
    skillsLocalPathInput: createDisabledInputStub(),
    skillsGithubUrlInput: createDisabledInputStub(),
    skillsGithubUrlRefInput: createDisabledInputStub(),
    skillsGithubRepoInput: createDisabledInputStub(),
    skillsGithubPathInput: createDisabledInputStub(),
    skillsGithubRepoRefInput: createDisabledInputStub(),
    skillsInstallLocalButton: createButtonStub(),
    skillsInstallGithubUrlButton: createButtonStub(),
    skillsInstallGithubRepoButton: createButtonStub(),
    skillsRefreshButton: createButtonStub(),
    skillsPanelActions: {
      querySelectorAll() {
        return [];
      },
    },
    accessModeSelect: createDisabledInputStub(),
    modeSwitchAuthAccountSelect: createDisabledInputStub(),
    accessModeApplyButton: createButtonStub(),
    sessionWorkspaceInput: createDisabledInputStub(),
    sessionWorkspaceApplyButton: createButtonStub(),
    thirdPartyProviderSelect: createDisabledInputStub(),
    thirdPartyEndpointProbeButton: createButtonStub(),
    thirdPartyModelSelect: createDisabledInputStub(),
    thirdPartyProbeButton: createButtonStub(),
    thirdPartyProbeApplyButton: createButtonStub(),
    thirdPartyAddProviderButton: createButtonStub(),
    thirdPartyAddModelButton: createButtonStub(),
    thirdPartyEditorClose: createButtonStub(),
    thirdPartyEditorBackdrop: createButtonStub(),
    thirdPartyProviderIdInput: createDisabledInputStub(),
    thirdPartyProviderNameInput: createDisabledInputStub(),
    thirdPartyProviderBaseUrlInput: createDisabledInputStub(),
    thirdPartyProviderApiKeyInput: createDisabledInputStub(),
    thirdPartyProviderEndpointCandidatesInput: createDisabledInputStub(),
    thirdPartyProviderWireApiSelect: createDisabledInputStub(),
    thirdPartyProviderWebsocketInput: createDisabledInputStub(),
    thirdPartyProviderSubmitButton: createButtonStub(),
    thirdPartyProviderCancelButton: createButtonStub(),
    thirdPartyModelProviderSelect: createDisabledInputStub(),
    thirdPartyModelIdInput: createDisabledInputStub(),
    thirdPartyModelDisplayNameInput: createDisabledInputStub(),
    thirdPartyModelDefaultReasoningSelect: createDisabledInputStub(),
    thirdPartyModelContextWindowInput: createDisabledInputStub(),
    thirdPartyModelDescriptionInput: createDisabledInputStub(),
    thirdPartyModelSupportsCodexInput: createDisabledInputStub(),
    thirdPartyModelImageInput: createDisabledInputStub(),
    thirdPartyModelSearchInput: createDisabledInputStub(),
    thirdPartyModelParallelToolsInput: createDisabledInputStub(),
    thirdPartyModelVerbosityInput: createDisabledInputStub(),
    thirdPartyModelReasoningSummaryInput: createDisabledInputStub(),
    thirdPartyModelImageDetailInput: createDisabledInputStub(),
    thirdPartyModelDefaultInput: createDisabledInputStub(),
    thirdPartyModelSubmitButton: createButtonStub(),
    thirdPartyModelCancelButton: createButtonStub(),
    authAccountSelect: createDisabledInputStub(),
    authAccountActivateButton: createButtonStub(),
    authAccountCreateInput: createDisabledInputStub(),
    authAccountCreateButton: createButtonStub(),
    authChatgptLoginButton: createButtonStub(),
    authChatgptDeviceLoginButton: createButtonStub(),
    authLogoutButton: createButtonStub(),
    authLoginCancelButton: createButtonStub(),
    authApiKeyInput: createDisabledInputStub(),
    authApiKeyButton: createButtonStub(),
  };

  const store = {
    getActiveThread() {
      return thread;
    },
    resolveComposerActionBarState() {
      return actionBarState;
    },
    createDefaultThreadSettings() {
      return {};
    },
    resolveThreadControlState() {
      return threadControlState;
    },
    resolveEffectiveSettings() {
      return {};
    },
    resolveTransientStatus() {
      return "";
    },
    isBusy() {
      return false;
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
  };

  const renderer = createRenderer({
    dom,
    store,
    utils: {
      autoResizeTextarea() {},
      escapeHtml: (value) => String(value),
    },
    runtime: {
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
      sessionControlBusy: false,
      authBusy: false,
      workspaceToolsOpen: false,
      workspaceToolsSection: "runtime",
      historyHydratingThreadId: null,
      thirdPartyEditor: createThirdPartyEditorState(),
      thirdPartyEndpointProbe: createProbeState(),
      thirdPartyProbe: createProbeState(),
      runtimeConfig: {
        status: "ready",
        defaults: {},
        accessModes: [],
        provider: null,
      },
      identity: {
        browserUserId: "",
        principalId: "",
        principalDisplayName: "",
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
      threadControlJoinOpen: false,
      ...runtime,
    },
    history: {
      getDisplayTurnCount() {
        return 0;
      },
      threadNeedsHistoryHydration() {
        return false;
      },
      refreshHistoryFromServer() {},
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
  });

  return {
    dom,
    renderer,
  };
}

function createTextStub() {
  return {
    disabled: false,
    textContent: "",
    innerHTML: "",
    classList: {
      add() {},
      remove() {},
      toggle(_className, force) {
        return Boolean(force);
      },
    },
  };
}

function createInputStub() {
  return {
    disabled: false,
    value: "",
    placeholder: "",
    scrollHeight: 0,
    style: {},
  };
}

function createDisabledInputStub() {
  return {
    ...createInputStub(),
    checked: false,
  };
}

function createButtonStub() {
  return {
    disabled: false,
    hidden: false,
    textContent: "",
    attributes: {},
    classList: {
      add() {},
      remove() {},
      toggle(_className, force) {
        return Boolean(force);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
  };
}

function createPanelStub(hidden = false) {
  return {
    hidden,
    innerHTML: "",
    attributes: {},
    classList: {
      add() {},
      remove() {},
      toggle(_className, force) {
        if (typeof force === "boolean") {
          this.hidden = !force;
        }
        return Boolean(force);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
  };
}

function createThirdPartyEditorState() {
  return {
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
  };
}

function createProbeState() {
  return {
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
  };
}
