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
