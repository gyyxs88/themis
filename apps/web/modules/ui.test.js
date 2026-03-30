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

function createHarness({ actionBarState }) {
  const thread = {
    id: "thread-composer",
    title: "Composer 线程",
    composerMode: actionBarState.mode,
    settings: {},
    turns: [],
  };

  const dom = {
    goalInput: createInputStub(),
    submitButton: createTextStub(),
    composerActionBar: createTextStub(),
    composerAuthNote: createTextStub(),
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
    resolveEffectiveSettings() {
      return {};
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
    value: "",
    placeholder: "",
    scrollHeight: 0,
    style: {},
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
