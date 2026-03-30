import assert from "node:assert/strict";
import test from "node:test";
import { createHistoryController } from "./history.js";
import { createStore } from "./store.js";
import * as utils from "./utils.js";

test("ensureThreadHistoryLoaded 会从历史 detail 恢复 waiting turn 的 pendingAction", async () => {
  const harness = createHistoryHarness();

  try {
    const { app, thread, history } = harness;

    await history.ensureThreadHistoryLoaded(thread.id);

    const restoredTurn = thread.turns[0];
    assert.equal(restoredTurn.state, "waiting");
    assert.deepEqual(restoredTurn.pendingAction, {
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow command?",
      choices: ["approve", "deny"],
    });
    assert.equal(thread.historyHydrated, true);
    assert.equal(thread.historyNeedsRehydrate, false);
    assert.equal(harness.loadThreadSettingsCalls, 1);
  } finally {
    harness.restore();
  }
});

test("ensureThreadHistoryLoaded 不会把已提交过的同一 waiting action 恢复成重复入口", async () => {
  const harness = createHistoryHarness({
    existingTurn: {
      id: "turn-local-1",
      requestId: "req-1",
      taskId: "task-1",
      state: "running",
      pendingAction: null,
      submittedPendingActionId: "approval-1",
    },
  });

  try {
    const { thread, history } = harness;

    await history.ensureThreadHistoryLoaded(thread.id, { force: true });

    const restoredTurn = thread.turns[0];
    assert.equal(restoredTurn.state, "running");
    assert.equal(restoredTurn.pendingAction, null);
    assert.equal(restoredTurn.submittedPendingActionId, "approval-1");
    assert.equal(thread.historyNeedsRehydrate, true);
  } finally {
    harness.restore();
  }
});

test("ensureThreadHistoryLoaded 在服务端已继续 running 但尚未终态时仍保留 historyNeedsRehydrate", async () => {
  const harness = createHistoryHarness({
    existingTurn: {
      id: "turn-local-2",
      requestId: "req-1",
      taskId: "task-1",
      state: "running",
      pendingAction: null,
      submittedPendingActionId: "approval-1",
    },
    latestTurnStatus: "running",
    responseTurnStatus: "running",
    responseEvents: [
      {
        eventId: "event-2",
        requestId: "req-1",
        taskId: "task-1",
        type: "task.started",
        status: "running",
        message: "已继续执行。",
        payloadJson: null,
        createdAt: "2026-03-29T00:00:40.000Z",
      },
    ],
  });

  try {
    const { thread, history } = harness;

    await history.ensureThreadHistoryLoaded(thread.id, { force: true });

    const restoredTurn = thread.turns[0];
    assert.equal(restoredTurn.state, "running");
    assert.equal(restoredTurn.pendingAction, null);
    assert.equal(restoredTurn.submittedPendingActionId, "approval-1");
    assert.equal(thread.historyNeedsRehydrate, true);
  } finally {
    harness.restore();
  }
});

test("ensureThreadHistoryLoaded 在服务端进入新的 waiting action 时会用新 action 替换旧提交标记", async () => {
  const harness = createHistoryHarness({
    existingTurn: {
      id: "turn-local-3",
      requestId: "req-1",
      taskId: "task-1",
      state: "running",
      pendingAction: null,
      submittedPendingActionId: "approval-1",
    },
    latestTurnStatus: "waiting",
    responseTurnStatus: "waiting",
    responseEvents: [
      {
        eventId: "event-3",
        requestId: "req-1",
        taskId: "task-1",
        type: "task.action_required",
        status: "waiting",
        message: "请确认第二个 action。",
        payloadJson: JSON.stringify({
          actionId: "approval-2",
          actionType: "approval",
          prompt: "Allow the second command?",
          choices: ["approve", "deny"],
        }),
        createdAt: "2026-03-29T00:01:10.000Z",
      },
    ],
  });

  try {
    const { thread, history } = harness;

    await history.ensureThreadHistoryLoaded(thread.id, { force: true });

    const restoredTurn = thread.turns[0];
    assert.equal(restoredTurn.state, "waiting");
    assert.deepEqual(restoredTurn.pendingAction, {
      actionId: "approval-2",
      actionType: "approval",
      prompt: "Allow the second command?",
      choices: ["approve", "deny"],
    });
    assert.equal(restoredTurn.submittedPendingActionId, null);
    assert.equal(thread.historyNeedsRehydrate, false);
  } finally {
    harness.restore();
  }
});

test("attachConversationById 会在新建、standard 和 fork 分支里保留正确的 threadOrigin，并切换 activeThread", async () => {
  const scenarios = [
    {
      conversationId: "conversation-new",
      expectedOrigin: "attached",
      setup(app) {
        return {
          beforeThreadId: app.store.getActiveThread()?.id ?? null,
        };
      },
    },
    {
      conversationId: "conversation-standard",
      expectedOrigin: "attached",
      setup(app) {
        const beforeThread = app.store.createThread();
        beforeThread.id = "thread-before-standard";
        const targetThread = app.store.createThread();
        targetThread.id = "conversation-standard";
        targetThread.threadOrigin = "standard";
        app.store.state.threads = [beforeThread, targetThread];
        app.store.state.activeThreadId = beforeThread.id;
        app.store.saveState();

        return {
          beforeThreadId: beforeThread.id,
        };
      },
    },
    {
      conversationId: "conversation-fork",
      expectedOrigin: "fork",
      setup(app) {
        const beforeThread = app.store.createThread();
        beforeThread.id = "thread-before-fork";
        const targetThread = app.store.createThread({
          threadOrigin: "fork",
        });
        targetThread.id = "conversation-fork";
        app.store.state.threads = [beforeThread, targetThread];
        app.store.state.activeThreadId = beforeThread.id;
        app.store.saveState();

        return {
          beforeThreadId: beforeThread.id,
        };
      },
    },
  ];

  for (const scenario of scenarios) {
    const harness = createAttachHarness();

    try {
      const { app, history } = harness;
      const { beforeThreadId } = scenario.setup(app);

      const result = await history.attachConversationById(scenario.conversationId);

      assert.equal(result.thread.id, scenario.conversationId);
      assert.equal(result.thread.threadOrigin, scenario.expectedOrigin);
      assert.equal(app.store.state.activeThreadId, scenario.conversationId);
      assert.equal(app.store.getActiveThread()?.id, scenario.conversationId);
      assert.equal(app.store.getActiveThread()?.threadOrigin, scenario.expectedOrigin);
      assert.notEqual(beforeThreadId, app.store.state.activeThreadId);
    } finally {
      harness.restore();
    }
  }
});

test("attachConversationById 在服务端失败时会留在原线程并且不创建半成品目标线程", async () => {
  const harness = createAttachHarness();
  const originalFetch = globalThis.fetch;
  const originalActiveThreadId = harness.app.store.state.activeThreadId;
  const originalThreadCount = harness.app.store.state.threads.length;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: {
        message: "join failed",
      },
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });

    await assert.rejects(
      harness.history.attachConversationById("conversation-failed"),
      /join failed/,
    );

    assert.equal(harness.app.store.state.activeThreadId, originalActiveThreadId);
    assert.equal(harness.app.store.state.threads.length, originalThreadCount);
    assert.equal(harness.app.store.getThreadById("conversation-failed"), null);
    assert.equal(harness.app.runtime.historyHydratingThreadId, null);
  } finally {
    globalThis.fetch = originalFetch;
    harness.restore();
  }
});

function createHistoryHarness(options = {}) {
  const storageKey = "themis-history-test";
  const storage = createLocalStorageMock();
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = storage;

  let loadThreadSettingsCalls = 0;
  const app = {
    constants: {
      MAX_THREAD_COUNT: 20,
      STORAGE_KEY: storageKey,
    },
    utils: {
      ...utils,
      safeReadJson: async (response) => response.json(),
    },
    runtime: {
      historySyncBusy: false,
      historyHydratingThreadId: null,
    },
    renderer: {
      renderAll() {},
    },
    sessionSettings: {
      async loadThreadSettings() {
        loadThreadSettingsCalls += 1;
      },
    },
  };

  app.store = createStore(app);
  const thread = app.store.getActiveThread();
  thread.id = "session-history-1";
  thread.serverHistoryAvailable = true;
  thread.storedTurnCount = 1;
  thread.historyHydrated = false;
  if (options.existingTurn) {
    thread.turns = [createExistingTurn(options.existingTurn)];
  }
  app.store.state.activeThreadId = thread.id;
  app.store.saveState();

  globalThis.fetch = async (url) => {
    assert.equal(url, `/api/history/sessions/${encodeURIComponent(thread.id)}`);

    return new Response(JSON.stringify({
      session: {
        sessionId: thread.id,
        threadId: "server-thread-1",
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:01:00.000Z",
        turnCount: 1,
        latestTurn: {
          requestId: "req-1",
          taskId: "task-1",
          goal: "请确认是否继续",
          status: options.latestTurnStatus ?? "waiting",
          summary: "请确认是否继续",
          codexThreadId: "server-thread-1",
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
      },
      turns: [
        {
          requestId: "req-1",
          taskId: "task-1",
          sessionId: "server-session-1",
          goal: "请确认是否继续",
          status: options.responseTurnStatus ?? "waiting",
          sessionMode: "cli",
          codexThreadId: "server-thread-1",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:01:00.000Z",
          events: options.responseEvents ?? [
            {
              eventId: "event-1",
              requestId: "req-1",
              taskId: "task-1",
              type: "task.action_required",
              status: "waiting",
              message: "请确认是否继续。",
              payloadJson: JSON.stringify({
                actionId: "approval-1",
                actionType: "approval",
                prompt: "Allow command?",
                choices: ["approve", "deny"],
              }),
              createdAt: "2026-03-29T00:00:30.000Z",
            },
          ],
          touchedFiles: [],
        },
      ],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  return {
    app,
    thread,
    history: createHistoryController(app),
    get loadThreadSettingsCalls() {
      return loadThreadSettingsCalls;
    },
    restore() {
      globalThis.fetch = originalFetch;
      if (originalLocalStorage === undefined) {
        Reflect.deleteProperty(globalThis, "localStorage");
      } else {
        globalThis.localStorage = originalLocalStorage;
      }
    },
  };
}

function createAttachHarness() {
  const storageKey = "themis-history-attach-test";
  const storage = createLocalStorageMock();
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = storage;

  const app = {
    constants: {
      MAX_THREAD_COUNT: 20,
      STORAGE_KEY: storageKey,
    },
    utils: {
      ...utils,
      safeReadJson: async (response) => response.json(),
    },
    runtime: {
      historySyncBusy: false,
      historyHydratingThreadId: null,
    },
    renderer: {
      renderAll() {},
    },
    sessionSettings: {
      async loadThreadSettings() {},
    },
  };

  app.store = createStore(app);
  app.store.saveState();

  globalThis.fetch = async (url) => {
    const conversationId = decodeURIComponent(String(url).split("/").at(-1) ?? "");

    assert.equal(url, `/api/history/sessions/${encodeURIComponent(conversationId)}`);

    return new Response(JSON.stringify({
      session: {
        sessionId: conversationId,
        threadId: `server-thread-${conversationId}`,
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:01:00.000Z",
        turnCount: 0,
        latestTurn: {
          goal: `目标 ${conversationId}`,
          status: "completed",
          summary: `目标 ${conversationId}`,
          codexThreadId: `server-thread-${conversationId}`,
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
      },
      turns: [],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  return {
    app,
    history: createHistoryController(app),
    restore() {
      globalThis.fetch = originalFetch;
      if (originalLocalStorage === undefined) {
        Reflect.deleteProperty(globalThis, "localStorage");
      } else {
        globalThis.localStorage = originalLocalStorage;
      }
    },
  };
}

function createExistingTurn(overrides = {}) {
  return {
    id: "turn-local",
    createdAt: "2026-03-29T00:00:00.000Z",
    goal: "请确认是否继续",
    inputText: "",
    requestId: "req-1",
    taskId: "task-1",
    pendingAction: null,
    submittedPendingActionId: null,
    serverThreadId: "server-thread-1",
    serverSessionId: "server-session-1",
    sessionMode: "cli",
    state: "running",
    assistantMessages: [],
    steps: [],
    result: null,
    ...overrides,
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
