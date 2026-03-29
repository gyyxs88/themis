import assert from "node:assert/strict";
import test from "node:test";
import { createActions } from "./actions.js";
import { createHistoryController } from "./history.js";
import { createStore } from "./store.js";
import * as utils from "./utils.js";

test("initialize 会先修复本地中断 turn，再恢复待同步线程并继续拉历史", async () => {
  const harness = createActionsHarness();

  try {
    const { app, restoreThread, localThread, actions, calls } = harness;

    actions.initialize();

    await waitFor(() => getLatestTurn(app, restoreThread.id)?.state === "completed");
    await waitFor(() => getLatestTurn(app, localThread.id)?.state === "cancelled");
    await waitFor(() => calls.historyList >= 1);
    await waitFor(() => calls.historyDetail >= 1);

    const restoreTurn = getLatestTurn(app, restoreThread.id);
    const localTurn = getLatestTurn(app, localThread.id);

    assert.equal(localTurn.state, "cancelled");
    assert.deepEqual(localTurn.result, {
      status: "cancelled",
      summary: "浏览器刷新或会话关闭后，本次任务已中断。",
    });

    assert.equal(restoreTurn.state, "completed");
    assert.equal(restoreTurn.pendingAction, null);
    assert.equal(restoreTurn.submittedPendingActionId, null);
    assert.deepEqual(restoreTurn.result, {
      status: "completed",
      summary: "恢复后已完成",
    });
    assert.equal(restoreThread.historyNeedsRehydrate, false);
    assert.equal(app.runtime.restoredActionHydrationThreadId, null);

    assert.equal(calls.authBindControls, 1);
    assert.equal(calls.modeSwitchBindControls, 1);
    assert.equal(calls.thirdPartyEditorBindControls, 1);
    assert.equal(calls.thirdPartyEndpointProbeBindControls, 1);
    assert.equal(calls.thirdPartyProbeBindControls, 1);
    assert.equal(calls.authLoad, 1);
    assert.equal(calls.identityLoad, 1);
    assert.equal(calls.runtimeConfigLoad, 1);
    assert.ok(calls.sessionSettingsLoad.some((entry) => entry.threadId === restoreThread.id));
    assert.ok(calls.renderAll.length > 0);
    await waitFor(() => app.runtime.historySyncBusy === false);
  } finally {
    harness.restore();
  }
});

test("initialize 恢复 waiting action 后，提交会自动继续 hydrate 直到服务端收口", async () => {
  const harness = createActionsHarness({
    restoreScenario: "waiting-action",
  });

  try {
    const { app, dom, restoreThread, actions, calls } = harness;

    actions.initialize();

    await waitFor(() => getLatestTurn(app, restoreThread.id)?.pendingAction?.actionId === "input-restore");

    dom.goalInput.value = "这是刷新后的回复";
    dom.goalInput.listeners.input[0]();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    await waitFor(() => calls.actionSubmit.length === 1);
    await waitFor(() => getLatestTurn(app, restoreThread.id)?.state === "completed");

    const restoreTurn = getLatestTurn(app, restoreThread.id);

    assert.deepEqual(calls.actionSubmit[0], {
      taskId: "task-restore",
      requestId: "req-restore",
      actionId: "input-restore",
      inputText: "这是刷新后的回复",
    });
    assert.equal(restoreTurn.state, "completed");
    assert.equal(restoreTurn.pendingAction, null);
    assert.equal(restoreTurn.submittedPendingActionId, null);
    assert.deepEqual(restoreTurn.result, {
      status: "completed",
      summary: "恢复后的 action 已收口",
    });
    assert.equal(restoreThread.historyNeedsRehydrate, false);
    assert.equal(app.runtime.restoredActionHydrationThreadId, null);
    await waitFor(() => app.runtime.historySyncBusy === false);
  } finally {
    harness.restore();
  }
});

test("initialize 恢复 waiting action 后，如果服务端先 running 再进入第二个 action，会恢复出新的 waiting action", async () => {
  const harness = createActionsHarness({
    restoreScenario: "second-waiting-action",
  });

  try {
    const { app, dom, restoreThread, actions, calls } = harness;

    actions.initialize();

    await waitFor(() => getLatestTurn(app, restoreThread.id)?.pendingAction?.actionId === "input-restore");

    dom.goalInput.value = "这是第一次回复";
    dom.goalInput.listeners.input[0]();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    await waitFor(() => calls.actionSubmit.length === 1);
    await waitFor(() => getLatestTurn(app, restoreThread.id)?.pendingAction?.actionId === "input-restore-2");

    const restoreTurn = getLatestTurn(app, restoreThread.id);

    assert.deepEqual(calls.actionSubmit[0], {
      taskId: "task-restore",
      requestId: "req-restore",
      actionId: "input-restore",
      inputText: "这是第一次回复",
    });
    assert.equal(restoreTurn.state, "waiting");
    assert.deepEqual(restoreTurn.pendingAction, {
      actionId: "input-restore-2",
      actionType: "user-input",
      prompt: "还差最后一条补充，请继续回复",
    });
    assert.equal(restoreTurn.submittedPendingActionId, null);
    assert.equal(restoreThread.historyNeedsRehydrate, false);
    assert.equal(app.runtime.restoredActionHydrationThreadId, null);
    await waitFor(() => app.runtime.historySyncBusy === false);
  } finally {
    harness.restore();
  }
});

test("initialize 恢复 waiting action 后再次刷新，能沿用同一份持久化恢复状态继续收口", async () => {
  const storage = createLocalStorageMock();
  const sharedRestoreState = {};

  const firstHarness = createActionsHarness({
    restoreScenario: "refresh-after-submit",
    storage,
    sharedRestoreState,
  });

  try {
    const { app, dom, restoreThread, actions, calls } = firstHarness;

    actions.initialize();

    await waitFor(() => getLatestTurn(app, restoreThread.id)?.pendingAction?.actionId === "input-restore");

    dom.goalInput.value = "这是刷新后的回复";
    dom.goalInput.listeners.input[0]();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    await waitFor(() => calls.actionSubmit.length === 1);
    await waitFor(() => getLatestTurn(app, restoreThread.id)?.state === "running");
    await waitFor(() => getLatestTurn(app, restoreThread.id)?.submittedPendingActionId === "input-restore");
    await waitFor(() => app.runtime.restoredActionHydrationRetryTimer !== null);

    const restoreTurn = getLatestTurn(app, restoreThread.id);

    assert.equal(restoreTurn.pendingAction, null);
    assert.equal(restoreTurn.submittedPendingActionId, "input-restore");
    assert.equal(restoreTurn.state, "running");
    assert.equal(restoreThread.historyNeedsRehydrate, true);
    assert.equal(app.runtime.restoredActionHydrationThreadId, restoreThread.id);
    assert.notEqual(app.runtime.restoredActionHydrationRetryTimer, null);
  } finally {
    firstHarness.restore();
  }

  const secondHarness = createActionsHarness({
    restoreScenario: "refresh-after-submit",
    storage,
    sharedRestoreState,
    reusePersistedState: true,
  });

  try {
    const { app, restoreThread, actions } = secondHarness;

    actions.initialize();

    await waitFor(
      () =>
        getLatestTurn(app, restoreThread.id)?.state === "running" &&
        app.runtime.restoredActionHydrationRetryTimer !== null,
      1000,
    );

    assert.equal(getLatestTurn(app, restoreThread.id)?.state, "running");
    assert.equal(restoreThread.historyNeedsRehydrate, true);
    assert.equal(app.runtime.restoredActionHydrationThreadId, restoreThread.id);
    assert.notEqual(app.runtime.restoredActionHydrationRetryTimer, null);

    await waitFor(() => getLatestTurn(app, restoreThread.id)?.state === "completed", 2000);

    const restoreTurn = getLatestTurn(app, restoreThread.id);

    assert.equal(restoreTurn.pendingAction, null);
    assert.equal(restoreTurn.submittedPendingActionId, null);
    assert.equal(restoreTurn.result.summary, "恢复后的 action 已收口");
    assert.equal(restoreThread.historyNeedsRehydrate, false);
    assert.equal(app.runtime.restoredActionHydrationThreadId, null);
  } finally {
    secondHarness.restore();
  }
});

test("initialize 恢复 waiting action 后，经过第二个 action 与再次刷新仍能沿同一条恢复链收口", async () => {
  const storage = createLocalStorageMock();
  const sharedRestoreState = {};

  const firstHarness = createActionsHarness({
    restoreScenario: "double-action-second-refresh",
    storage,
    sharedRestoreState,
  });

  try {
    const { app, dom, restoreThread, actions, calls } = firstHarness;

    actions.initialize();

    await waitFor(() => getLatestTurn(app, restoreThread.id)?.pendingAction?.actionId === "input-restore");

    dom.goalInput.value = "第一次恢复回复";
    dom.goalInput.listeners.input[0]();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    await waitFor(() => calls.actionSubmit.length === 1);
    await waitFor(() => getLatestTurn(app, restoreThread.id)?.state === "running");
    await waitFor(() => getLatestTurn(app, restoreThread.id)?.submittedPendingActionId === "input-restore");
    await waitFor(() => app.runtime.restoredActionHydrationRetryTimer !== null);

    const restoreTurn = getLatestTurn(app, restoreThread.id);

    assert.equal(restoreTurn.state, "running");
    assert.equal(restoreTurn.submittedPendingActionId, "input-restore");
    assert.equal(restoreThread.historyNeedsRehydrate, true);
    assert.equal(sharedRestoreState.restoreDoubleActionPhase, "first-action-running");
    assert.equal(Number.isFinite(sharedRestoreState.restoreSecondStageDetailCount), true);
    assert.equal(sharedRestoreState.restoreSecondStageDetailCount > 0, true);
  } finally {
    firstHarness.restore();
  }

  const firstPhaseDetailCount = sharedRestoreState.restoreSecondStageDetailCount;

  const secondHarness = createActionsHarness({
    restoreScenario: "double-action-second-refresh",
    storage,
    sharedRestoreState,
    reusePersistedState: true,
  });

  try {
    const { app, dom, restoreThread, actions, calls } = secondHarness;

    actions.initialize();

    await waitFor(() => {
      const restoreTurn = getLatestTurn(app, restoreThread.id);
      return restoreTurn?.pendingAction?.actionId === "input-restore-2"
        && restoreTurn.state === "waiting"
        && restoreTurn.submittedPendingActionId === null
        && restoreThread.historyNeedsRehydrate === false
        && app.runtime.restoredActionHydrationThreadId === null;
    }, 1500);

    const waitingRestoreTurn = getLatestTurn(app, restoreThread.id);

    assert.equal(waitingRestoreTurn.state, "waiting");
    assert.equal(waitingRestoreTurn.submittedPendingActionId, null);
    assert.equal(restoreThread.historyNeedsRehydrate, false);
    assert.equal(app.runtime.restoredActionHydrationThreadId, null);
    assert.equal(sharedRestoreState.restoreDoubleActionPhase, "second-action-ready");
    assert.equal(sharedRestoreState.restoreSecondStageDetailCount > firstPhaseDetailCount, true);

    dom.goalInput.value = "第二次恢复回复";
    dom.goalInput.listeners.input[0]();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    await waitFor(() => calls.actionSubmit.length === 1);
    await waitFor(() => getLatestTurn(app, restoreThread.id)?.state === "completed", 2000);

    const restoreTurn = getLatestTurn(app, restoreThread.id);

    assert.deepEqual(calls.actionSubmit[0], {
      taskId: "task-restore",
      requestId: "req-restore",
      actionId: "input-restore-2",
      inputText: "第二次恢复回复",
    });
    assert.equal(restoreTurn.state, "completed");
    assert.equal(restoreTurn.pendingAction, null);
    assert.equal(restoreTurn.submittedPendingActionId, null);
    assert.equal(restoreThread.historyNeedsRehydrate, false);
    assert.equal(app.runtime.restoredActionHydrationThreadId, null);
    assert.equal(restoreTurn.result.summary, "恢复链第二轮 action 已收口");
    assert.equal(sharedRestoreState.restoreDoubleActionPhase, "completed");
  } finally {
    secondHarness.restore();
  }
});

test("initialize 恢复线程仍在自动 hydrate 时，会阻止其他线程的新提交并提示跨线程等待", async () => {
  const harness = createActionsHarness({
    restoreScenario: "pending-hydration",
  });

  try {
    const { app, dom, restoreThread, localThread, actions, calls } = harness;

    actions.initialize();

    await waitFor(() => app.runtime.restoredActionHydrationThreadId === restoreThread.id);
    assert.equal(
      app.runtime.restoredActionHydrationThreadId,
      restoreThread.id,
      JSON.stringify({
        restoreThreadId: restoreThread.id,
        activeThreadId: app.store.state.activeThreadId,
        historyNeedsRehydrate: restoreThread.historyNeedsRehydrate,
      }),
    );

    app.store.state.activeThreadId = localThread.id;
    app.store.saveState();
    dom.goalInput.value = "线程 B 的新消息";
    dom.goalInput.listeners.input[0]();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    const transientText = app.store.resolveTransientStatus(localThread.id) ?? "";

    assert.equal(calls.actionSubmit.length, 0);
    assert.match(
      transientText,
      /恢复中的线程|另一个会话/,
      JSON.stringify({
        transientText,
        restoredActionHydrationThreadId: app.runtime.restoredActionHydrationThreadId,
        activeThreadId: app.store.state.activeThreadId,
        localDraftGoal: localThread.draftGoal,
      }),
    );
    assert.match(
      transientText,
      /暂不支持并行继续执行|请稍候再发新消息/,
      JSON.stringify({
        transientText,
        restoredActionHydrationThreadId: app.runtime.restoredActionHydrationThreadId,
        activeThreadId: app.store.state.activeThreadId,
      }),
    );
    assert.equal(app.runtime.restoredActionHydrationThreadId, restoreThread.id);
    assert.equal(localThread.draftGoal, "线程 B 的新消息");
    await waitFor(() => app.runtime.historySyncBusy === false);
  } finally {
    harness.restore();
  }
});

function createActionsHarness(options = {}) {
  const storageKey = "themis-actions-init-test";
  const storage = options.storage ?? createLocalStorageMock();
  const sharedRestoreState = options.sharedRestoreState ?? {};
  const reusePersistedState = options.reusePersistedState === true;
  if (!reusePersistedState) {
    storage.clear?.();
  }
  if (typeof sharedRestoreState.restoreActionSubmitted !== "boolean") {
    sharedRestoreState.restoreActionSubmitted = false;
  }
  if (typeof sharedRestoreState.restoreSecondActionSubmitted !== "boolean") {
    sharedRestoreState.restoreSecondActionSubmitted = false;
  }
  if (typeof sharedRestoreState.restoreDoubleActionPhase !== "string" || !sharedRestoreState.restoreDoubleActionPhase) {
    sharedRestoreState.restoreDoubleActionPhase = "initial";
  }
  if (!Number.isFinite(sharedRestoreState.restorePostSubmitDetailCount)) {
    sharedRestoreState.restorePostSubmitDetailCount = 0;
  }
  if (!Number.isFinite(sharedRestoreState.restoreSecondStageDetailCount)) {
    sharedRestoreState.restoreSecondStageDetailCount = 0;
  }
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.localStorage = storage;
  const restoreScenario = options.restoreScenario ?? "completed";

  const calls = {
    authBindControls: 0,
    authLoad: 0,
    modeSwitchBindControls: 0,
    thirdPartyEditorBindControls: 0,
    thirdPartyEndpointProbeBindControls: 0,
    thirdPartyProbeBindControls: 0,
    identityLoad: 0,
    runtimeConfigLoad: 0,
    historyList: 0,
    historyDetail: 0,
    actionSubmit: [],
    sessionSettingsLoad: [],
    renderAll: [],
  };

  const app = {
    constants: {
      MAX_THREAD_COUNT: 20,
      STORAGE_KEY: storageKey,
    },
    utils: {
      ...utils,
      safeReadJson: async (response) => response.json(),
      autoResizeTextarea() {},
      escapeHtml(value) {
        return String(value ?? "");
      },
      scrollConversationToBottom() {},
      formatRelativeTime() {
        return "";
      },
    },
    runtime: {
      activeRunRef: null,
      activeRequestController: null,
      restoredActionHydrationThreadId: null,
      restoredActionHydrationRetryTimer: null,
      restoredActionRehydrateDelayMs: 0,
      restoredActionRehydrateMaxAttempts:
        restoreScenario === "second-waiting-action" || restoreScenario === "double-action-second-refresh" ? 2 : 1,
      restoredActionRehydrateRecoveryDelayMs:
        restoreScenario === "pending-hydration"
          ? 1000
          : restoreScenario === "refresh-after-submit" || restoreScenario === "double-action-second-refresh"
          ? 100
          : 0,
      historySyncBusy: false,
      historyHydratingThreadId: null,
      sessionControlBusy: false,
      workspaceToolsOpen: false,
      workspaceToolsSection: "runtime",
      authBusy: false,
      threadSearchQuery: "",
      pendingInterruptSubmit: null,
      identity: {
        assistantLanguageStyle: "",
        assistantMbti: "",
        assistantStyleNotes: "",
        assistantSoul: "",
        taskSettings: {
          authAccountId: "",
          sandboxMode: "",
          webSearchMode: "",
          networkAccessEnabled: null,
          approvalPolicy: "",
        },
      },
      auth: {
        status: "ready",
        activeAccountId: "account-1",
        accounts: [],
      },
      runtimeConfig: {
        status: "ready",
        errorMessage: "",
        models: [
          {
            id: "gpt-5.4",
            model: "gpt-5.4",
            displayName: "gpt-5.4",
            description: "gpt-5.4",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "low" },
              { reasoningEffort: "medium", description: "medium" },
              { reasoningEffort: "high", description: "high" },
            ],
            defaultReasoningEffort: "medium",
            contextWindow: 200000,
            capabilities: {
              textInput: true,
              imageInput: false,
              supportsCodexTasks: true,
              supportsReasoningSummaries: false,
              supportsVerbosity: false,
              supportsParallelToolCalls: false,
              supportsSearchTool: true,
              supportsImageDetailOriginal: false,
            },
            supportsPersonality: true,
            supportsCodexTasks: true,
            isDefault: true,
          },
        ],
        defaults: {
          profile: "",
          model: "gpt-5.4",
          reasoning: "medium",
          approvalPolicy: "never",
          sandboxMode: "workspace-write",
          webSearchMode: "live",
          networkAccessEnabled: true,
        },
        provider: null,
        accessModes: [{ id: "auth", label: "auth", description: "auth" }],
        thirdPartyProviders: [],
        personas: [],
      },
      thirdPartyEditor: {
        submitting: false,
        open: false,
      },
    },
  };

  app.dom = createDomHarness();
  app.renderer = {
    renderAll(scrollToBottom = false) {
      calls.renderAll.push({
        scrollToBottom,
        activeThreadId: app.store?.state?.activeThreadId ?? null,
        restoredActionHydrationThreadId: app.runtime.restoredActionHydrationThreadId,
      });
    },
    renderThreadList() {},
    setToolsPanelOpen(open) {
      app.runtime.workspaceToolsOpen = Boolean(open);
    },
    setToolsPanelSection(section) {
      app.runtime.workspaceToolsSection = section;
    },
  };
  app.auth = {
    bindControls() {
      calls.authBindControls += 1;
    },
    async load() {
      calls.authLoad += 1;
    },
    async ensureAuthenticated() {
      return { ok: true };
    },
  };
  app.modeSwitch = {
    bindControls() {
      calls.modeSwitchBindControls += 1;
    },
  };
  app.thirdPartyEditor = {
    bindControls() {
      calls.thirdPartyEditorBindControls += 1;
    },
    close() {},
  };
  app.thirdPartyEndpointProbe = {
    bindControls() {
      calls.thirdPartyEndpointProbeBindControls += 1;
    },
    clearIfProviderChanged() {},
  };
  app.thirdPartyProbe = {
    bindControls() {
      calls.thirdPartyProbeBindControls += 1;
    },
    clearIfSelectionChanged() {},
  };
  app.identity = {
    async load() {
      calls.identityLoad += 1;
    },
    async saveTaskSettings() {},
    updatePersonaDraft() {},
    async saveAssistantPersona() {
      return true;
    },
    async issueLinkCode() {},
    getRequestIdentity() {
      return { userId: "user-1" };
    },
  };
  app.runtimeConfig = {
    async load() {
      calls.runtimeConfigLoad += 1;
    },
  };
  app.sessionSettings = {
    async loadThreadSettings(threadId, options = {}) {
      calls.sessionSettingsLoad.push({ threadId, options });
    },
    async persistThreadSettings() {},
    async commitThreadSettings() {
      return { ok: true };
    },
  };

    app.store = createStore(app);

  let restoreThread = null;
  let localThread = null;

  if (reusePersistedState) {
    if (typeof sharedRestoreState.restoreThreadId !== "string" || !sharedRestoreState.restoreThreadId) {
      throw new Error("reusePersistedState requires sharedRestoreState.restoreThreadId");
    }

    if (typeof sharedRestoreState.localThreadId !== "string" || !sharedRestoreState.localThreadId) {
      throw new Error("reusePersistedState requires sharedRestoreState.localThreadId");
    }

    restoreThread = app.store.getThreadById(sharedRestoreState.restoreThreadId);
    if (!restoreThread) {
      throw new Error(`reusePersistedState could not find restore thread: ${sharedRestoreState.restoreThreadId}`);
    }

    localThread = app.store.getThreadById(sharedRestoreState.localThreadId);
    if (!localThread) {
      throw new Error(`reusePersistedState could not find local thread: ${sharedRestoreState.localThreadId}`);
    }

    if (
      restoreScenario === "double-action-second-refresh" &&
      sharedRestoreState.restoreDoubleActionPhase === "first-action-running"
    ) {
      sharedRestoreState.restoreDoubleActionPhase = "ready-for-second-refresh";
    }
  } else {
    restoreThread = app.store.getActiveThread();
    restoreThread.id = "thread-restore";
    restoreThread.title = "恢复中的线程";
    restoreThread.serverThreadId = "server-thread-restore";
    restoreThread.serverHistoryAvailable = true;
    restoreThread.storedTurnCount = 1;
    restoreThread.historyHydrated = true;
    restoreThread.historyNeedsRehydrate = true;
    const restoreTurn = app.store.createTurn({
      goal: "恢复任务",
      inputText: "",
    });
    restoreTurn.id = "turn-restore";
    restoreTurn.requestId = "req-restore";
    restoreTurn.taskId = "task-restore";
    restoreTurn.serverThreadId = "server-thread-restore";
    restoreTurn.serverSessionId = "server-session-restore";
    restoreTurn.sessionMode = "cli";
    restoreTurn.state = "running";
    restoreTurn.pendingAction = null;
    restoreTurn.submittedPendingActionId = restoreScenario === "completed" || restoreScenario === "pending-hydration"
      ? "input-restore"
      : null;
    restoreTurn.steps = [];
    restoreThread.turns = [restoreTurn];

    localThread = app.store.createThread();
    localThread.id = "thread-local";
    localThread.title = "本地中断线程";
    localThread.serverHistoryAvailable = false;
    localThread.storedTurnCount = 1;
    localThread.historyHydrated = true;
    localThread.historyNeedsRehydrate = false;
    const localTurn = app.store.createTurn({
      goal: "本地任务",
      inputText: "",
    });
    localTurn.id = "turn-local";
    localTurn.state = "running";
    localTurn.steps = [];
    localThread.turns = [localTurn];

    app.store.state = {
      activeThreadId: restoreThread.id,
      threads: [restoreThread, localThread],
    };
    app.store.saveState();
    sharedRestoreState.restoreThreadId = restoreThread.id;
    sharedRestoreState.localThreadId = localThread.id;
  }

  app.history = createHistoryController(app);

  globalThis.fetch = async (url, init = {}) => {
    const ref = typeof url === "string" ? url : url?.url ?? String(url);

    if (ref.startsWith("/api/history/sessions?limit=")) {
      calls.historyList += 1;
      const refreshAfterSubmitRunning =
        restoreScenario === "refresh-after-submit" &&
        sharedRestoreState.restoreActionSubmitted &&
        sharedRestoreState.restorePostSubmitDetailCount < 2;
      const doubleActionSecondRefreshRunning =
        restoreScenario === "double-action-second-refresh" &&
        sharedRestoreState.restoreActionSubmitted &&
        !sharedRestoreState.restoreSecondActionSubmitted &&
        sharedRestoreState.restoreDoubleActionPhase !== "second-action-ready";
      const waitingRestoreAction =
        (restoreScenario === "waiting-action" ||
          restoreScenario === "second-waiting-action" ||
          restoreScenario === "double-action-second-refresh" ||
          restoreScenario === "refresh-after-submit") &&
        !sharedRestoreState.restoreActionSubmitted;

      return jsonResponse({
        sessions: [
          {
            sessionId: restoreThread.id,
            threadId: "server-thread-restore",
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:01:00.000Z",
            turnCount: 1,
            latestTurn: waitingRestoreAction
              ? {
                requestId: "req-restore",
                taskId: "task-restore",
                goal: "恢复任务",
                status: "waiting",
                summary: "请补充最后的回复",
                codexThreadId: "server-thread-restore",
                updatedAt: "2026-03-29T00:01:00.000Z",
              }
              : {
                requestId: "req-restore",
                taskId: "task-restore",
                goal: "恢复任务",
                status:
                  refreshAfterSubmitRunning || doubleActionSecondRefreshRunning || restoreScenario === "pending-hydration"
                    ? "running"
                    : "completed",
                summary: refreshAfterSubmitRunning || doubleActionSecondRefreshRunning || restoreScenario === "pending-hydration"
                  ? refreshAfterSubmitRunning || doubleActionSecondRefreshRunning
                    ? "服务端仍在同步上一轮 action"
                    : "服务端仍在同步上一轮 action"
                  : restoreScenario === "double-action-second-refresh"
                  ? "恢复链第二轮 action 已收口"
                  : restoreScenario === "waiting-action" || restoreScenario === "second-waiting-action" || restoreScenario === "refresh-after-submit"
                  ? "恢复后的 action 已收口"
                  : "恢复后已完成",
                codexThreadId: "server-thread-restore",
                updatedAt: "2026-03-29T00:01:00.000Z",
              },
          },
        ],
      });
    }

    if (ref === "/api/tasks/actions") {
      calls.actionSubmit.push(JSON.parse(init.body));
      if (restoreScenario === "double-action-second-refresh" && sharedRestoreState.restoreActionSubmitted) {
        sharedRestoreState.restoreSecondActionSubmitted = true;
        sharedRestoreState.restoreDoubleActionPhase = "second-action-submitted";
      } else if (restoreScenario === "double-action-second-refresh") {
        sharedRestoreState.restoreActionSubmitted = true;
        sharedRestoreState.restoreDoubleActionPhase = "first-action-running";
      } else {
        sharedRestoreState.restoreActionSubmitted = true;
      }
      return jsonResponse({
        ok: true,
      });
    }

    if (ref === `/api/history/sessions/${encodeURIComponent(restoreThread.id)}`) {
      calls.historyDetail += 1;
      if (
        (restoreScenario === "waiting-action" ||
          restoreScenario === "second-waiting-action" ||
          restoreScenario === "double-action-second-refresh" ||
          restoreScenario === "refresh-after-submit") &&
        !sharedRestoreState.restoreActionSubmitted
      ) {
        return jsonResponse({
          session: {
            sessionId: restoreThread.id,
            threadId: "server-thread-restore",
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:01:00.000Z",
            turnCount: 1,
            latestTurn: {
              requestId: "req-restore",
              taskId: "task-restore",
              goal: "恢复任务",
              status: "waiting",
              summary: "请补充最后的回复",
              codexThreadId: "server-thread-restore",
              updatedAt: "2026-03-29T00:01:00.000Z",
            },
          },
          turns: [
            {
              requestId: "req-restore",
              taskId: "task-restore",
              sessionId: "server-session-restore",
              goal: "恢复任务",
              status: "waiting",
              summary: "请补充最后的回复",
              sessionMode: "cli",
              codexThreadId: "server-thread-restore",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:01:00.000Z",
              events: [
                {
                  eventId: "event-restore-waiting-1",
                  requestId: "req-restore",
                  taskId: "task-restore",
                  type: "task.action_required",
                  status: "waiting",
                  message: "请补充最后的回复",
                  payloadJson: JSON.stringify({
                    actionId: "input-restore",
                    actionType: "user-input",
                    prompt: "请补充最后的回复",
                  }),
                  createdAt: "2026-03-29T00:01:00.000Z",
                },
              ],
              touchedFiles: [],
            },
          ],
        });
      }

      if (restoreScenario === "double-action-second-refresh") {
        if (!sharedRestoreState.restoreSecondActionSubmitted) {
          sharedRestoreState.restoreSecondStageDetailCount += 1;

          if (sharedRestoreState.restoreDoubleActionPhase === "ready-for-second-refresh") {
            sharedRestoreState.restoreDoubleActionPhase = "second-action-ready";
            return jsonResponse({
              session: {
                sessionId: restoreThread.id,
                threadId: "server-thread-restore",
                createdAt: "2026-03-29T00:00:00.000Z",
                updatedAt: "2026-03-29T00:01:20.000Z",
                turnCount: 1,
                latestTurn: {
                  requestId: "req-restore",
                  taskId: "task-restore",
                  goal: "恢复任务",
                  status: "waiting",
                  summary: "还差最后一条补充，请继续回复",
                  codexThreadId: "server-thread-restore",
                  updatedAt: "2026-03-29T00:01:20.000Z",
                },
              },
              turns: [
                {
                  requestId: "req-restore",
                  taskId: "task-restore",
                  sessionId: "server-session-restore",
                  goal: "恢复任务",
                  status: "waiting",
                  summary: "还差最后一条补充，请继续回复",
                  sessionMode: "cli",
                  codexThreadId: "server-thread-restore",
                  createdAt: "2026-03-29T00:00:00.000Z",
                  updatedAt: "2026-03-29T00:01:20.000Z",
                  events: [
                    {
                      eventId: "event-restore-waiting-double-refresh-2",
                      requestId: "req-restore",
                      taskId: "task-restore",
                      type: "task.action_required",
                      status: "waiting",
                      message: "还差最后一条补充，请继续回复",
                      payloadJson: JSON.stringify({
                        actionId: "input-restore-2",
                        actionType: "user-input",
                        prompt: "还差最后一条补充，请继续回复",
                      }),
                      createdAt: "2026-03-29T00:01:20.000Z",
                    },
                  ],
                  touchedFiles: [],
                },
              ],
        });
      }

        return jsonResponse({
          session: {
              sessionId: restoreThread.id,
              threadId: "server-thread-restore",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:01:10.000Z",
              turnCount: 1,
              latestTurn: {
                requestId: "req-restore",
                taskId: "task-restore",
                goal: "恢复任务",
                status: "running",
                summary: "服务端仍在处理第一次回复",
                codexThreadId: "server-thread-restore",
                updatedAt: "2026-03-29T00:01:10.000Z",
              },
            },
            turns: [
              {
                requestId: "req-restore",
                taskId: "task-restore",
                sessionId: "server-session-restore",
                goal: "恢复任务",
                status: "running",
                summary: "服务端仍在处理第一次回复",
                sessionMode: "cli",
                codexThreadId: "server-thread-restore",
                createdAt: "2026-03-29T00:00:00.000Z",
                updatedAt: "2026-03-29T00:01:10.000Z",
                events: [
                  {
                    eventId: "event-restore-running-double-refresh-1",
                    requestId: "req-restore",
                    taskId: "task-restore",
                    type: "task.started",
                    status: "running",
                    message: "服务端仍在处理第一次回复",
                    payloadJson: null,
                    createdAt: "2026-03-29T00:01:10.000Z",
                  },
                ],
                touchedFiles: [],
              },
            ],
          });
        }

        sharedRestoreState.restoreDoubleActionPhase = "completed";
        return jsonResponse({
          session: {
            sessionId: restoreThread.id,
            threadId: "server-thread-restore",
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:01:30.000Z",
            turnCount: 1,
            latestTurn: {
              requestId: "req-restore",
              taskId: "task-restore",
              goal: "恢复任务",
              status: "completed",
              summary: "恢复链第二轮 action 已收口",
              codexThreadId: "server-thread-restore",
              updatedAt: "2026-03-29T00:01:30.000Z",
            },
          },
          turns: [
            {
              requestId: "req-restore",
              taskId: "task-restore",
              sessionId: "server-session-restore",
              goal: "恢复任务",
              status: "completed",
              summary: "恢复链第二轮 action 已收口",
              sessionMode: "cli",
              codexThreadId: "server-thread-restore",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:01:30.000Z",
              events: [
                {
                  eventId: "event-restore-completed-double-refresh-1",
                  requestId: "req-restore",
                  taskId: "task-restore",
                  type: "task.completed",
                  status: "completed",
                  message: "恢复链第二轮 action 已收口",
                  payloadJson: null,
                  createdAt: "2026-03-29T00:01:30.000Z",
                },
              ],
              touchedFiles: [],
            },
          ],
        });
      }

      if (restoreScenario === "second-waiting-action") {
        sharedRestoreState.restorePostSubmitDetailCount += 1;

        if (sharedRestoreState.restorePostSubmitDetailCount === 1) {
          return jsonResponse({
            session: {
              sessionId: restoreThread.id,
              threadId: "server-thread-restore",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:01:10.000Z",
              turnCount: 1,
              latestTurn: {
                requestId: "req-restore",
                taskId: "task-restore",
                goal: "恢复任务",
                status: "running",
                summary: "服务端仍在处理第一次回复",
                codexThreadId: "server-thread-restore",
                updatedAt: "2026-03-29T00:01:10.000Z",
              },
            },
            turns: [
              {
                requestId: "req-restore",
                taskId: "task-restore",
                sessionId: "server-session-restore",
                goal: "恢复任务",
                status: "running",
                summary: "服务端仍在处理第一次回复",
                sessionMode: "cli",
                codexThreadId: "server-thread-restore",
                createdAt: "2026-03-29T00:00:00.000Z",
                updatedAt: "2026-03-29T00:01:10.000Z",
                events: [
                  {
                    eventId: "event-restore-running-1",
                    requestId: "req-restore",
                    taskId: "task-restore",
                    type: "task.started",
                    status: "running",
                    message: "服务端仍在处理第一次回复",
                    payloadJson: null,
                    createdAt: "2026-03-29T00:01:10.000Z",
                  },
                ],
                touchedFiles: [],
              },
            ],
          });
        }

        return jsonResponse({
          session: {
            sessionId: restoreThread.id,
            threadId: "server-thread-restore",
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:01:20.000Z",
            turnCount: 1,
            latestTurn: {
              requestId: "req-restore",
              taskId: "task-restore",
              goal: "恢复任务",
              status: "waiting",
              summary: "还差最后一条补充，请继续回复",
              codexThreadId: "server-thread-restore",
              updatedAt: "2026-03-29T00:01:20.000Z",
            },
          },
          turns: [
            {
              requestId: "req-restore",
              taskId: "task-restore",
              sessionId: "server-session-restore",
              goal: "恢复任务",
              status: "waiting",
              summary: "还差最后一条补充，请继续回复",
              sessionMode: "cli",
              codexThreadId: "server-thread-restore",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:01:20.000Z",
              events: [
                {
                  eventId: "event-restore-waiting-2",
                  requestId: "req-restore",
                  taskId: "task-restore",
                  type: "task.action_required",
                  status: "waiting",
                  message: "还差最后一条补充，请继续回复",
                  payloadJson: JSON.stringify({
                    actionId: "input-restore-2",
                    actionType: "user-input",
                    prompt: "还差最后一条补充，请继续回复",
                  }),
                  createdAt: "2026-03-29T00:01:20.000Z",
                },
              ],
              touchedFiles: [],
            },
          ],
        });
      }

      if (restoreScenario === "refresh-after-submit") {
        sharedRestoreState.restorePostSubmitDetailCount += 1;

        if (sharedRestoreState.restorePostSubmitDetailCount <= 3) {
          return jsonResponse({
            session: {
              sessionId: restoreThread.id,
              threadId: "server-thread-restore",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:01:10.000Z",
              turnCount: 1,
              latestTurn: {
                requestId: "req-restore",
                taskId: "task-restore",
                goal: "恢复任务",
                status: "running",
                summary: "服务端仍在同步上一轮 action",
                codexThreadId: "server-thread-restore",
                updatedAt: "2026-03-29T00:01:10.000Z",
              },
            },
            turns: [
              {
                requestId: "req-restore",
                taskId: "task-restore",
                sessionId: "server-session-restore",
                goal: "恢复任务",
                status: "running",
                summary: "服务端仍在同步上一轮 action",
                sessionMode: "cli",
                codexThreadId: "server-thread-restore",
                createdAt: "2026-03-29T00:00:00.000Z",
                updatedAt: "2026-03-29T00:01:10.000Z",
                events: [
                  {
                    eventId: "event-restore-running-refresh-1",
                    requestId: "req-restore",
                    taskId: "task-restore",
                    type: "task.started",
                    status: "running",
                    message: "服务端仍在同步上一轮 action",
                    payloadJson: null,
                    createdAt: "2026-03-29T00:01:10.000Z",
                  },
                ],
                touchedFiles: [],
              },
            ],
          });
        }

        return jsonResponse({
          session: {
            sessionId: restoreThread.id,
            threadId: "server-thread-restore",
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:01:30.000Z",
            turnCount: 1,
            latestTurn: {
              requestId: "req-restore",
              taskId: "task-restore",
              goal: "恢复任务",
              status: "completed",
              summary: "恢复后的 action 已收口",
              codexThreadId: "server-thread-restore",
              updatedAt: "2026-03-29T00:01:30.000Z",
            },
          },
          turns: [
            {
              requestId: "req-restore",
              taskId: "task-restore",
              sessionId: "server-session-restore",
              goal: "恢复任务",
              status: "completed",
              summary: "恢复后的 action 已收口",
              sessionMode: "cli",
              codexThreadId: "server-thread-restore",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:01:30.000Z",
              events: [
                {
                  eventId: "event-restore-completed-refresh-1",
                  requestId: "req-restore",
                  taskId: "task-restore",
                  type: "task.completed",
                  status: "completed",
                  message: "恢复后的 action 已收口",
                  payloadJson: null,
                  createdAt: "2026-03-29T00:01:30.000Z",
                },
              ],
              touchedFiles: [],
            },
          ],
        });
      }

      if (restoreScenario === "pending-hydration") {
        return jsonResponse({
          session: {
            sessionId: restoreThread.id,
            threadId: "server-thread-restore",
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:01:10.000Z",
            turnCount: 1,
            latestTurn: {
              requestId: "req-restore",
              taskId: "task-restore",
              goal: "恢复任务",
              status: "running",
              summary: "服务端仍在同步上一轮 action",
              codexThreadId: "server-thread-restore",
              updatedAt: "2026-03-29T00:01:10.000Z",
            },
          },
          turns: [
            {
              requestId: "req-restore",
              taskId: "task-restore",
              sessionId: "server-session-restore",
              goal: "恢复任务",
              status: "running",
              summary: "服务端仍在同步上一轮 action",
              sessionMode: "cli",
              codexThreadId: "server-thread-restore",
              createdAt: "2026-03-29T00:00:00.000Z",
              updatedAt: "2026-03-29T00:01:10.000Z",
              events: [
                {
                  eventId: "event-restore-running-pending-1",
                  requestId: "req-restore",
                  taskId: "task-restore",
                  type: "task.started",
                  status: "running",
                  message: "服务端仍在同步上一轮 action",
                  payloadJson: null,
                  createdAt: "2026-03-29T00:01:10.000Z",
                },
              ],
              touchedFiles: [],
            },
          ],
        });
      }

      return jsonResponse({
        session: {
          sessionId: restoreThread.id,
          threadId: "server-thread-restore",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:01:00.000Z",
          turnCount: 1,
          latestTurn: {
            requestId: "req-restore",
            taskId: "task-restore",
            goal: "恢复任务",
            status: "completed",
            summary: restoreScenario === "waiting-action" || restoreScenario === "second-waiting-action" || restoreScenario === "refresh-after-submit"
              ? "恢复后的 action 已收口"
              : "恢复后已完成",
            codexThreadId: "server-thread-restore",
            updatedAt: "2026-03-29T00:01:00.000Z",
          },
        },
        turns: [
          {
            requestId: "req-restore",
            taskId: "task-restore",
            sessionId: "server-session-restore",
            goal: "恢复任务",
            status: "completed",
            summary: restoreScenario === "waiting-action" || restoreScenario === "second-waiting-action" || restoreScenario === "refresh-after-submit"
              ? "恢复后的 action 已收口"
              : "恢复后已完成",
            sessionMode: "cli",
            codexThreadId: "server-thread-restore",
            createdAt: "2026-03-29T00:00:00.000Z",
            updatedAt: "2026-03-29T00:01:00.000Z",
            events: [
              {
                eventId: "event-restore-1",
                requestId: "req-restore",
                taskId: "task-restore",
                type: "task.completed",
                status: "completed",
                message: restoreScenario === "waiting-action" || restoreScenario === "second-waiting-action" || restoreScenario === "refresh-after-submit"
                  ? "恢复后的 action 已收口"
                  : "恢复后已完成",
                payloadJson: null,
                createdAt: "2026-03-29T00:01:00.000Z",
              },
            ],
            touchedFiles: [],
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch: ${ref}`);
  };

  globalThis.document = createGlobalEventTarget();
  globalThis.window = createGlobalEventTarget();

  return {
    app,
    dom: app.dom,
    restoreThread,
    localThread,
    calls,
    actions: createActions(app),
    restore() {
      if (app.runtime?.restoredActionHydrationRetryTimer) {
        clearTimeout(app.runtime.restoredActionHydrationRetryTimer);
        app.runtime.restoredActionHydrationRetryTimer = null;
      }
      globalThis.fetch = originalFetch;
      if (originalLocalStorage === undefined) {
        Reflect.deleteProperty(globalThis, "localStorage");
      } else {
        globalThis.localStorage = originalLocalStorage;
      }
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, "document");
      } else {
        globalThis.document = originalDocument;
      }
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        globalThis.window = originalWindow;
      }
    },
  };
}

function getLatestTurn(app, threadId) {
  return app.store.getThreadById(threadId)?.turns?.at(-1) ?? null;
}

function createDomHarness() {
  return {
    goalInput: createInputHost(""),
    form: createFormHost(),
    cancelButton: createEventHost("cancel-button"),
    assistantLanguageStyleInput: createValueHost(""),
    assistantMbtiInput: createValueHost(""),
    assistantStyleNotesInput: createValueHost(""),
    assistantSoulInput: createValueHost(""),
    webSearchSelect: createValueHost("live"),
    approvalSelect: createValueHost("never"),
    modelSelect: createValueHost("gpt-5.4"),
    networkAccessSelect: createValueHost("true"),
    newThreadButton: createEventHost("new-thread-button"),
    reasoningSelect: createValueHost("medium"),
    sandboxSelect: createValueHost("workspace-write"),
    thirdPartyModelSelect: createValueHost(""),
    thirdPartyProviderSelect: createValueHost(""),
    threadList: createEventHost("thread-list"),
    threadSearchInput: createInputHost(""),
    conversationLinkButton: createEventHost("conversation-link-button"),
    conversationLinkInput: createInputHost(""),
    forkThreadButton: createEventHost("fork-thread-button"),
    identityLinkCodeButton: createEventHost("identity-link-code-button"),
    resetPrincipalButton: createEventHost("reset-principal-button"),
    sessionWorkspaceApplyButton: createEventHost("session-workspace-apply-button"),
    sessionWorkspaceInput: createInputHost(""),
    workspaceToolsBackdrop: createEventHost("workspace-tools-backdrop"),
    workspaceToolsClose: createEventHost("workspace-tools-close"),
    workspaceToolsPanel: createEventHost("workspace-tools-panel"),
    workspaceToolsToggle: createEventHost("workspace-tools-toggle"),
  };
}

function createEventHost(name) {
  const listeners = {};
  return {
    name,
    listeners,
    value: "",
    checked: false,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(handler);
    },
  };
}

function createInputHost(value) {
  return {
    ...createEventHost("input"),
    value,
    disabled: false,
    focus() {},
  };
}

function createValueHost(value) {
  return {
    ...createEventHost("value"),
    value,
    checked: false,
    disabled: false,
  };
}

function createFormHost() {
  return {
    ...createEventHost("form"),
    requestSubmit() {},
  };
}

function createGlobalEventTarget() {
  return {
    addEventListener() {},
    removeEventListener() {},
  };
}

function createLocalStorageMock() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("waitFor timeout");
}
