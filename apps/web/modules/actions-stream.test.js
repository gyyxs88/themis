import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import { createStreamActions } from "./actions-stream.js";
import { createStore } from "./store.js";
import * as utils from "./utils.js";

test("consumeNdjsonStream handles ack -> event -> result -> done with real store state", async () => {
  const { app, actions, thread, turn, storage, storageKey, restore } = createAppHarness();

  try {
    const ackStream = createChunkedNdjsonBody([
      {
        kind: "ack",
        requestId: "req-123",
        taskId: "task-456",
      },
    ]);

    assert.ok(ackStream.chunkCount > 1);
    await actions.consumeNdjsonStream(ackStream.body);

    assert.equal(turn.requestId, "req-123");
    assert.equal(turn.taskId, "task-456");
    assert.equal(turn.state, "running");
    assert.ok(turn.steps.length >= 2);

    const eventMessage = {
      kind: "event",
      title: "task.started",
      text: "Codex 开始执行",
      metadata: {
        session: {
          threadId: "server-thread-1",
          sessionId: "server-session-1",
          mode: "cli",
        },
        phase: "boot",
      },
    };
    const resultMessage = {
      kind: "result",
      text: "阶段性结果",
      metadata: {
        structuredOutput: {
          artifact: "report.md",
        },
        format: "markdown",
      },
    };
    const eventResultStream = createChunkedNdjsonBody([eventMessage, resultMessage]);

    assert.ok(eventResultStream.chunkCount > 1);
    await actions.consumeNdjsonStream(eventResultStream.body);

    assert.equal(turn.serverThreadId, "server-thread-1");
    assert.equal(turn.serverSessionId, "server-session-1");
    assert.equal(turn.sessionMode, "cli");
    assert.equal(thread.serverThreadId, "server-thread-1");
    const eventStep = findStepByMetadata(turn.steps, eventMessage.metadata);
    assert.ok(eventStep);
    assert.equal(eventStep.tone, "neutral");
    assert.deepEqual(eventStep.metadata, eventMessage.metadata);
    const resultStep = findStepByMetadata(turn.steps, resultMessage.metadata);
    assert.ok(resultStep);
    assert.equal(resultStep.tone, "success");
    assert.deepEqual(resultStep.metadata, resultMessage.metadata);
    assert.equal(turn.state, "running");
    assert.ok(turn.steps.length >= 4);

    const doneMessage = {
      kind: "done",
      result: {
        status: "completed",
        summary: "任务已完成",
        output: "最终答案",
        touchedFiles: ["apps/web/modules/actions-stream.js"],
        structuredOutput: {
          artifact: "report.md",
        },
      },
    };
    const doneStream = createChunkedNdjsonBody([doneMessage]);

    assert.ok(doneStream.chunkCount > 1);
    await actions.consumeNdjsonStream(doneStream.body);
    const completedStep = turn.steps.at(-1);
    assert.ok(completedStep);
    assert.equal(completedStep.tone, "success");
    assert.equal(turn.state, "completed");
    assert.ok(
      app.renderer.renderCalls.some(
        (snapshot) =>
          snapshot.turnState === "completed" &&
          snapshot.resultStatus === "completed" &&
          snapshot.activeRunCleared === true,
      ),
    );
    assert.ok(turn.steps.length >= 5);
    assert.deepEqual(turn.result, {
      status: "completed",
      summary: "任务已完成",
      output: "最终答案",
      touchedFiles: ["apps/web/modules/actions-stream.js"],
      structuredOutput: {
        artifact: "report.md",
      },
    });
    assert.equal(thread.storedTurnCount, 1);
    assert.equal(thread.storedStatus, "completed");
    assert.equal(thread.storedSummary, "任务已完成");
    assert.equal(thread.serverHistoryAvailable, true);
    assert.equal(thread.historyHydrated, true);
    assert.equal(app.runtime.activeRunRef, null);
    assert.equal(app.runtime.activeRequestController, null);

    const persisted = JSON.parse(storage.getItem(storageKey));
    const persistedThread = persisted.threads.find((entry) => entry.id === thread.id);
    const persistedTurn = persistedThread.turns.find((entry) => entry.id === turn.id);

    assert.equal(persistedThread.storedStatus, "completed");
    assert.equal(persistedThread.storedSummary, "任务已完成");
    assert.equal(persistedTurn.requestId, "req-123");
    assert.equal(persistedTurn.taskId, "task-456");
    assert.equal(persistedTurn.state, "completed");
    assert.deepEqual(persistedTurn.result, turn.result);
  } finally {
    restore();
  }
});

test("consumeNdjsonStream handles ack -> fatal and clears active run state", async () => {
  const { app, actions, thread, turn, storage, storageKey, restore } = createAppHarness();

  try {
    const ackStream = createChunkedNdjsonBody([
      {
        kind: "ack",
        requestId: "req-fatal",
        taskId: "task-fatal",
      },
    ]);

    assert.ok(ackStream.chunkCount > 1);
    await actions.consumeNdjsonStream(ackStream.body);

    assert.equal(turn.requestId, "req-fatal");
    assert.equal(turn.taskId, "task-fatal");
    assert.equal(turn.state, "running");

    const fatalStream = createChunkedNdjsonBody([
      {
        kind: "fatal",
        text: "后端执行失败",
      },
    ]);

    assert.ok(fatalStream.chunkCount > 1);
    await actions.consumeNdjsonStream(fatalStream.body);

    assert.equal(turn.state, "failed");
    assert.deepEqual(turn.result, {
      status: "failed",
      summary: "后端执行失败",
    });
    const fatalStep = turn.steps.find((step) => step.tone === "error");
    assert.ok(fatalStep);
    assert.ok(
      app.renderer.renderCalls.some(
        (snapshot) =>
          snapshot.turnState === "failed" &&
          snapshot.resultStatus === "failed" &&
          snapshot.activeRunCleared === true,
      ),
    );
    assert.ok(turn.steps.length >= 3);
    assert.equal(thread.storedTurnCount, 1);
    assert.equal(thread.storedStatus, "failed");
    assert.equal(thread.storedSummary, "后端执行失败");
    assert.equal(thread.serverHistoryAvailable, true);
    assert.equal(thread.historyHydrated, true);
    assert.equal(app.runtime.activeRunRef, null);
    assert.equal(app.runtime.activeRequestController, null);

    const persisted = JSON.parse(storage.getItem(storageKey));
    const persistedThread = persisted.threads.find((entry) => entry.id === thread.id);
    const persistedTurn = persistedThread.turns.find((entry) => entry.id === turn.id);

    assert.equal(persistedThread.storedStatus, "failed");
    assert.equal(persistedThread.storedSummary, "后端执行失败");
    assert.equal(persistedTurn.requestId, "req-fatal");
    assert.equal(persistedTurn.taskId, "task-fatal");
    assert.equal(persistedTurn.state, "failed");
    assert.deepEqual(persistedTurn.result, {
      status: "failed",
      summary: "后端执行失败",
    });
  } finally {
    restore();
  }
});

function createAppHarness() {
  const storageKey = "themis-actions-stream-test";
  const storage = createLocalStorageMock();
  const originalLocalStorage = globalThis.localStorage;
  let thread = null;
  let turn = null;
  globalThis.localStorage = storage;

  const app = {
    constants: {
      MAX_THREAD_COUNT: 20,
      STORAGE_KEY: storageKey,
    },
    utils,
    runtime: {
      activeRunRef: null,
      activeRequestController: { abort() {} },
      pendingInterruptSubmit: null,
      resumeInterruptedSubmit() {},
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
        activeAccountId: "runtime-default-account",
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
    },
    renderer: {
      renderCalls: [],
      renderAll(shouldScroll) {
        this.renderCalls.push({
          shouldScroll,
          turnState: turn?.state ?? null,
          resultStatus: turn?.result?.status ?? null,
          storedStatus: thread?.storedStatus ?? null,
          activeRunCleared: app.runtime.activeRunRef === null,
          requestId: turn?.requestId ?? null,
          taskId: turn?.taskId ?? null,
          stepCount: turn?.steps?.length ?? 0,
        });
      },
    },
    sessionSettings: null,
  };

  app.store = createStore(app);
  thread = app.store.getActiveThread();
  turn = app.store.createTurn({
    goal: "验证 stream 回归",
    inputText: "请执行任务",
  });

  thread.turns.push(turn);
  app.runtime.activeRunRef = {
    threadId: thread.id,
    turnId: turn.id,
  };
  app.store.saveState();

  return {
    app,
    actions: createStreamActions(app),
    thread,
    turn,
    storage,
    storageKey,
    restore() {
      if (originalLocalStorage === undefined) {
        Reflect.deleteProperty(globalThis, "localStorage");
      } else {
        globalThis.localStorage = originalLocalStorage;
      }
    },
  };
}

function findStepByMetadata(steps, metadata) {
  return steps.find((step) => step.metadata && isDeepStrictEqual(step.metadata, metadata));
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

function createChunkedNdjsonBody(messages, chunkSize = 11) {
  const payload = `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
  const encoder = new TextEncoder();
  const chunks = [];

  for (let index = 0; index < payload.length; index += chunkSize) {
    chunks.push(payload.slice(index, index + chunkSize));
  }

  return {
    chunkCount: chunks.length,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
  };
}
