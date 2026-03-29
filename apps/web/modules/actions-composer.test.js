import assert from "node:assert/strict";
import test from "node:test";
import { createComposerActions } from "./actions-composer.js";

test("waiting action 只允许当前会话提交，切换线程后会阻止串单", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-b",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow?",
    },
    activeThreadDraftGoal: "线程 B 的草稿",
    activeThreadDraftContext: "线程 B 的补充",
  });

  try {
    const { app, dom, activeThread, waitingThread, renderCalls } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 0);
    assert.equal(harness.activeTurn.pendingAction?.actionId, "approval-1");
    assert.equal(harness.activeTurn.state, "waiting");
    assert.equal(app.store.transientStatus?.threadId, activeThread.id);
    assert.match(app.store.transientStatus?.text ?? "", /当前会话|切回/);
    assert.ok(renderCalls.length > 0);
  } finally {
    harness.restore();
  }
});

test("waiting 的 user-input action 会从 composer 草稿提交 inputText", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "input-1",
      actionType: "user-input",
      prompt: "Reply please",
    },
    activeThreadDraftGoal: "这是用户输入",
    activeThreadDraftContext: "",
  });

  try {
    const { app, dom, waitingThread, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.deepEqual(app.runtime.submitActionCalls[0], {
      taskId: "task-a",
      requestId: "request-a",
      actionId: "input-1",
      inputText: "这是用户输入",
    });
    assert.equal(activeTurn.pendingAction, null);
    assert.equal(activeTurn.state, "running");
  } finally {
    harness.restore();
  }
});

test("waiting 时点击取消不会直接把 turn 标成 cancelled", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow?",
    },
  });

  try {
    const { app, dom, activeTurn, renderCalls } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await dom.cancelButton.listeners.click[0]();

    assert.equal(app.runtime.abortCount, 0);
    assert.equal(activeTurn.state, "waiting");
    assert.equal(activeTurn.pendingAction?.actionId, "approval-1");
    assert.equal(activeTurn.steps.at(-1)?.title, "等待中的 action 不能直接取消");
    assert.ok(renderCalls.length > 0);
  } finally {
    harness.restore();
  }
});

test("composer 输入 /review 会走 /api/tasks/actions 的 review 模式，而不是普通 stream", async () => {
  const harness = createComposerHarness({
    activeThreadDraftGoal: "/review please review current diff",
  });

  try {
    const { app, dom } = harness;
    const actions = createComposerActions(app, {
      consumeNdjsonStream: async () => {
        throw new Error("stream should not run for /review");
      },
      finalizeTurnCancelled() {},
      finalizeTurnError() {},
    });
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.deepEqual(app.runtime.submitActionCalls[0], {
      mode: "review",
      sessionId: "thread-a",
      instructions: "please review current diff",
    });
    assert.equal(app.runtime.streamRequestCount, 0);
  } finally {
    harness.restore();
  }
});

test("composer 输入 /steer 会走 /api/tasks/actions 的 steer 模式，而不是打断成新任务", async () => {
  const harness = createComposerHarness({
    activeThreadDraftGoal: "/steer focus on tests only",
    activeTurnState: "running",
    activeTurnAction: null,
  });

  try {
    const { app, dom } = harness;
    const actions = createComposerActions(app, {
      consumeNdjsonStream: async () => {
        throw new Error("stream should not run for /steer");
      },
      finalizeTurnCancelled() {},
      finalizeTurnError() {},
    });
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.deepEqual(app.runtime.submitActionCalls[0], {
      mode: "steer",
      sessionId: "thread-a",
      message: "focus on tests only",
    });
    assert.equal(app.runtime.abortCount, 0);
    assert.equal(app.runtime.streamRequestCount, 0);
  } finally {
    harness.restore();
  }
});

test("composer 输入 /steer 时不会强依赖本地当前 turn 仍处于 running", async () => {
  const harness = createComposerHarness({
    activeThreadDraftGoal: "/steer keep going",
    activeTurnState: "completed",
    activeTurnAction: null,
  });

  try {
    const { app, dom } = harness;
    const actions = createComposerActions(app, {
      consumeNdjsonStream: async () => {
        throw new Error("stream should not run for /steer");
      },
      finalizeTurnCancelled() {},
      finalizeTurnError() {},
    });
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.deepEqual(app.runtime.submitActionCalls[0], {
      mode: "steer",
      sessionId: "thread-a",
      message: "keep going",
    });
  } finally {
    harness.restore();
  }
});

function createComposerHarness(options = {}) {
  const renderCalls = [];
  const waitingThread = createThreadRecord({
    id: "thread-a",
    title: "线程 A",
    draftGoal: options.activeThreadDraftGoal ?? "",
    draftContext: options.activeThreadDraftContext ?? "",
  });
  const activeThread = options.activeThreadId === "thread-b"
    ? createThreadRecord({
      id: "thread-b",
      title: "线程 B",
      draftGoal: options.activeThreadDraftGoal ?? "",
      draftContext: options.activeThreadDraftContext ?? "",
    })
    : waitingThread;
  const activeTurn = createTurnRecord({
    id: "turn-a",
    state: options.activeTurnState ?? "waiting",
    pendingAction: options.activeTurnAction ?? null,
  });

  waitingThread.turns.push(activeTurn);

  const app = {
    runtime: {
      activeRunRef: {
        threadId: "thread-a",
        turnId: "turn-a",
      },
      activeRequestController: {
        abort() {
          app.runtime.abortCount += 1;
        },
      },
      activeThreadId: activeThread.id,
      sessionControlBusy: false,
      pendingInterruptSubmit: null,
      abortCount: 0,
      streamRequestCount: 0,
      submitActionCalls: [],
    },
    utils: {
      autoResizeTextarea() {},
      nowIso: () => "2026-03-29T00:00:00.000Z",
      safeReadJson: async () => null,
    },
    store: null,
    renderer: {
      renderAll() {
        renderCalls.push({
          threadId: app.store.getActiveThread()?.id ?? null,
          turnState: activeTurn.state,
          transientStatus: app.store.transientStatus,
        });
      },
    },
    identity: {
      saveAssistantPersona: async () => true,
      getRequestIdentity: () => ({
        userId: "user-1",
      }),
    },
    auth: {
      ensureAuthenticated: async () => ({ ok: true }),
    },
  };

  const threads = [waitingThread];
  if (activeThread !== waitingThread) {
    threads.push(activeThread);
  }

  app.store = {
    state: {
      activeThreadId: activeThread.id,
      threads,
    },
    transientStatus: null,
    getActiveThread() {
      return threads.find((thread) => thread.id === this.state.activeThreadId) ?? null;
    },
    getActiveTurn() {
      return this.getTurn(app.runtime.activeRunRef.threadId, app.runtime.activeRunRef.turnId);
    },
    getTurn(threadId, turnId) {
      return threads.find((thread) => thread.id === threadId)?.turns.find((turn) => turn.id === turnId) ?? null;
    },
    getRunningThreadId() {
      return app.runtime.activeRunRef?.threadId ?? null;
    },
    isBusy() {
      return Boolean(app.runtime.activeRequestController && app.runtime.activeRunRef);
    },
    setTransientStatus(threadId, text) {
      this.transientStatus = {
        threadId,
        text,
      };
    },
    appendStep(turn, title, text, tone = "neutral", metadata) {
      turn.steps.push({
        title,
        text,
        tone,
        ...(metadata ? { metadata } : {}),
      });
    },
    clearTransientStatus() {
      this.transientStatus = null;
    },
    saveState() {},
    touchThread() {},
    syncThreadStoredState() {},
    trimThreads() {},
    clearActiveRun() {},
    createTurn() {
      throw new Error("createTurn should not be called in this test");
    },
    resolveAccessMode() {
      return "auth";
    },
    resolveEffectiveSettings() {
      return {};
    },
    buildTaskOptions() {
      return undefined;
    },
    shouldBootstrapThread() {
      return false;
    },
    isDefaultThreadTitle() {
      return false;
    },
    transientStatus: null,
  };

  const dom = {
    goalInput: createInputHost("goal-input"),
    form: createEventHost("form"),
    cancelButton: createEventHost("cancel-button"),
    assistantLanguageStyleInput: createValueHost(""),
    assistantMbtiInput: createValueHost(""),
    assistantStyleNotesInput: createValueHost(""),
    assistantSoulInput: createValueHost(""),
    webSearchSelect: createValueHost("disabled"),
  };
  app.dom = dom;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const url = typeof _url === "string" ? _url : _url?.url ?? String(_url);
    if (url === "/api/tasks/actions") {
      app.runtime.submitActionCalls.push(JSON.parse(init.body));
    }
    if (url === "/api/tasks/stream") {
      app.runtime.streamRequestCount += 1;
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    app,
    dom,
    activeThread,
    waitingThread,
    activeTurn,
    renderCalls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function createThreadRecord({ id, title, draftGoal = "", draftContext = "" }) {
  return {
    id,
    title,
    draftGoal,
    draftContext,
    settings: {},
    turns: [],
    updatedAt: "2026-03-29T00:00:00.000Z",
  };
}

function createTurnRecord({ id, state, pendingAction }) {
  return {
    id,
    taskId: "task-a",
    requestId: "request-a",
    state,
    pendingAction,
    goal: "测试任务",
    inputText: "",
    steps: [
      {
        title: "准备执行",
        text: "正在连接 Themis 后端并等待任务回执。",
        tone: "neutral",
      },
    ],
    result: null,
  };
}

function createEventHost(name) {
  const listeners = {};
  return {
    name,
    listeners,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] ?? [];
      listeners[type].push(handler);
    },
  };
}

function createInputHost(value) {
  return {
    value,
    disabled: false,
    addEventListener() {},
    focus() {},
  };
}

function createValueHost(value) {
  return {
    value,
    disabled: false,
  };
}
