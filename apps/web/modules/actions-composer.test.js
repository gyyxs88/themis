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

test("点击动作条 Review 会进入 review mode 且保留草稿", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "completed",
    activeTurnAction: null,
    activeThreadDraftGoal: "保留的草稿",
    activeThreadDraftContext: "保留的补充",
    activeThreadComposerMode: "chat",
  });

  try {
    const { app, dom, activeThread, renderCalls } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await dom.composerActionBar.listeners.click[0]({
      target: {
        closest(selector) {
          if (selector === "[data-composer-mode-button]") {
            return {
              dataset: {
                composerModeButton: "review",
              },
              disabled: false,
            };
          }

          return null;
        },
      },
    });

    assert.equal(activeThread.composerMode, "review");
    assert.equal(activeThread.draftGoal, "保留的草稿");
    assert.equal(activeThread.draftContext, "保留的补充");
    assert.equal(app.store.transientStatus, null);
    assert.ok(renderCalls.length > 0);
  } finally {
    harness.restore();
  }
});

test("点击已选中的 Review 再点一次会回到 chat", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "completed",
    activeTurnAction: null,
    activeThreadDraftGoal: "保留的草稿",
    activeThreadDraftContext: "保留的补充",
    activeThreadComposerMode: "review",
  });

  try {
    const { app, dom, activeThread } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await dom.composerActionBar.listeners.click[0]({
      target: {
        closest(selector) {
          if (selector === "[data-composer-mode-button]") {
            return {
              dataset: {
                composerModeButton: "review",
              },
              disabled: false,
            };
          }

          return null;
        },
      },
    });

    assert.equal(activeThread.composerMode, "chat");
    assert.equal(activeThread.draftGoal, "保留的草稿");
    assert.equal(activeThread.draftContext, "保留的补充");
  } finally {
    harness.restore();
  }
});

test("disabled mode 点击不会切换，只会写 transientStatus", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "running",
    activeTurnAction: null,
    activeThreadDraftGoal: "保留的草稿",
    activeThreadDraftContext: "保留的补充",
    activeThreadComposerMode: "chat",
  });

  try {
    const { app, dom, activeThread, renderCalls } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await dom.composerActionBar.listeners.click[0]({
      target: {
        closest(selector) {
          if (selector === "[data-composer-mode-button]") {
            return {
              dataset: {
                composerModeButton: "review",
              },
              disabled: true,
            };
          }

          return null;
        },
      },
    });

    assert.equal(activeThread.composerMode, "chat");
    assert.equal(activeThread.draftGoal, "保留的草稿");
    assert.equal(activeThread.draftContext, "保留的补充");
    assert.equal(app.store.transientStatus?.threadId, activeThread.id);
    assert.match(app.store.transientStatus?.text ?? "", /当前还没有可审查的已收口结果/);
    assert.ok(renderCalls.length > 0);
  } finally {
    harness.restore();
  }
});

test("submitActiveComposerMode() 在 review 成功后会走 actions endpoint，并自动退出到 chat", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "completed",
    activeTurnAction: null,
    activeThreadDraftGoal: "请 review 这份变更",
    activeThreadDraftContext: "关注回归风险",
    activeThreadComposerMode: "review",
  });

  try {
    const { app, activeThread, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    const result = await actions.submitActiveComposerMode(activeThread, activeTurn, "review");

    assert.deepEqual(result, { ok: true });
    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.deepEqual(app.runtime.submitActionCalls[0], {
      mode: "review",
      sessionId: "thread-a",
      instructions: "请 review 这份变更\n\n补充要求：\n关注回归风险",
    });
    assert.equal(activeThread.composerMode, "chat");
    assert.equal(activeThread.draftGoal, "");
    assert.equal(activeThread.draftContext, "");
    assert.equal(app.dom.goalInput.value, "");
  } finally {
    harness.restore();
  }
});

test("steer 失败后保留 mode 和输入", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "running",
    activeTurnAction: null,
    activeThreadDraftGoal: "先把范围收紧",
    activeThreadDraftContext: "只处理 Web 回归",
    activeThreadComposerMode: "steer",
    submitActionError: new Error("网关超时"),
  });

  try {
    const { app, activeThread, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();
    app.dom.goalInput.value = "先把范围收紧";

    const result = await actions.submitActiveComposerMode(activeThread, activeTurn, "steer");

    assert.deepEqual(result, { ok: false });
    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.equal(activeThread.composerMode, "steer");
    assert.equal(activeThread.draftGoal, "先把范围收紧");
    assert.equal(activeThread.draftContext, "只处理 Web 回归");
    assert.equal(app.dom.goalInput.value, "先把范围收紧");
    assert.equal(app.store.transientStatus?.threadId, activeThread.id);
    assert.match(app.store.transientStatus?.text ?? "", /网关超时/);
  } finally {
    harness.restore();
  }
});

test("approval waiting action 不再从 composer 草稿里隐式提交", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow?",
      choices: ["approve", "deny"],
    },
    activeThreadDraftGoal: "approve",
    activeThreadDraftContext: "",
  });

  try {
    const { app, dom, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 0);
    assert.equal(activeTurn.state, "waiting");
    assert.equal(activeTurn.pendingAction?.actionId, "approval-1");
    assert.equal(activeTurn.pendingActionError, "");
  } finally {
    harness.restore();
  }
});

test("waiting 的 user-input action 会通过显式 turn 卡片提交 inputText", async () => {
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
    const { app, dom, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    const waitingActionForm = createWaitingActionForm({
      threadId: "thread-a",
      turnId: "turn-a",
      inputText: "这是用户输入",
    });

    await dom.conversation.listeners.submit[0]({
      target: waitingActionForm,
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

test("waiting action 提交失败时会保留 pendingAction 并写回 turn.pendingActionError", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "input-1",
      actionType: "user-input",
      prompt: "Reply please",
    },
    submitActionError: new Error("网关超时"),
  });

  try {
    const { app, dom, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    const waitingActionForm = createWaitingActionForm({
      threadId: "thread-a",
      turnId: "turn-a",
      inputText: "这是补充回复",
    });

    await dom.conversation.listeners.submit[0]({
      target: waitingActionForm,
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.equal(activeTurn.pendingAction?.actionId, "input-1");
    assert.equal(activeTurn.pendingActionError, "网关超时");
    assert.equal(activeTurn.pendingActionSubmitting, false);
    assert.equal(activeTurn.pendingActionInputText, "这是补充回复");
  } finally {
    harness.restore();
  }
});

test("waiting 的 user-input action 提交失败后会保留卡片输入内容", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "input-1",
      actionType: "user-input",
      prompt: "Reply please",
    },
    submitActionError: new Error("网关超时"),
  });

  try {
    const { app, activeThread, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await actions.submitWaitingAction(activeThread, activeTurn, {
      inputText: "保留的输入",
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.equal(activeTurn.pendingActionError, "网关超时");
    assert.equal(activeTurn.pendingActionSubmitting, false);
    assert.equal(activeTurn.pendingActionInputText, "保留的输入");
  } finally {
    harness.restore();
  }
});

test("approval waiting action 的 reject 会规范成 deny", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow?",
      choices: ["approve", "reject"],
    },
  });

  try {
    const { app, activeThread, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    await actions.submitWaitingAction(activeThread, activeTurn, {
      decision: "reject",
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.deepEqual(app.runtime.submitActionCalls[0], {
      taskId: "task-a",
      requestId: "request-a",
      actionId: "approval-1",
      decision: "deny",
    });
  } finally {
    harness.restore();
  }
});

test("waiting action 提交中会先写入 pendingActionSubmitting，重复提交不会再次发送", async () => {
  const submitActionDeferred = createDeferred();
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "input-1",
      actionType: "user-input",
      prompt: "Reply please",
    },
    submitActionDeferred,
  });

  try {
    const { app, dom, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    const waitingActionForm = createWaitingActionForm({
      threadId: "thread-a",
      turnId: "turn-a",
      inputText: "这是补充回复",
    });

    const firstSubmitPromise = dom.conversation.listeners.submit[0]({
      target: waitingActionForm,
      preventDefault() {},
    });

    await waitFor(() => activeTurn.pendingActionSubmitting === true);
    assert.equal(activeTurn.pendingActionError, "");
    assert.equal(app.runtime.submitActionCalls.length, 1);

    await dom.conversation.listeners.submit[0]({
      target: waitingActionForm,
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);

    submitActionDeferred.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await firstSubmitPromise;
    await waitFor(() => activeTurn.pendingActionSubmitting === false);
    assert.equal(activeTurn.pendingAction, null);
    assert.equal(activeTurn.pendingActionError, "");
  } finally {
    harness.restore();
  }
});

test("explicit decision 提交 approval 时不会清空无关 composer 草稿", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow?",
      choices: ["approve", "deny"],
    },
    activeThreadDraftGoal: "保留的草稿",
    activeThreadDraftContext: "保留的补充",
  });

  try {
    const { app, activeThread, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();
    app.dom.goalInput.value = "保留的草稿";

    await actions.submitWaitingAction(activeThread, activeTurn, {
      decision: "approve",
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.deepEqual(app.runtime.submitActionCalls[0], {
      taskId: "task-a",
      requestId: "request-a",
      actionId: "approval-1",
      decision: "approve",
    });
    assert.equal(activeTurn.state, "running");
    assert.equal(activeThread.draftGoal, "保留的草稿");
    assert.equal(activeThread.draftContext, "保留的补充");
    assert.equal(app.dom.goalInput.value, "保留的草稿");
  } finally {
    harness.restore();
  }
});

test("刷新后恢复的 waiting action 在没有 activeRunRef 时也能通过 turn 卡片继续提交", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeRunRef: null,
    activeRequestController: null,
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "input-restored",
      actionType: "user-input",
      prompt: "Reply please",
    },
  });

  try {
    const { app, dom, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    const waitingActionForm = createWaitingActionForm({
      threadId: "thread-a",
      turnId: "turn-a",
      inputText: "这是恢复后的输入",
    });

    await dom.conversation.listeners.submit[0]({
      target: waitingActionForm,
      preventDefault() {},
    });

    assert.equal(app.runtime.submitActionCalls.length, 1);
    assert.deepEqual(app.runtime.submitActionCalls[0], {
      taskId: "task-a",
      requestId: "request-a",
      actionId: "input-restored",
      inputText: "这是恢复后的输入",
    });
    assert.equal(app.runtime.streamRequestCount, 0);
    assert.equal(activeTurn.pendingAction, null);
    assert.equal(activeTurn.state, "running");
    await waitFor(() => app.history.ensureThreadHistoryLoadedCalls.length === 1);
    assert.deepEqual(app.history.ensureThreadHistoryLoadedCalls[0], {
      threadId: "thread-a",
      options: {
        force: true,
      },
    });
  } finally {
    harness.restore();
  }
});

test("刷新后恢复的 waiting action 通过 turn 卡片提交后会自动继续补 hydrate 直到当前线程收口", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeRunRef: null,
    activeRequestController: null,
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "input-restored",
      actionType: "user-input",
      prompt: "Reply please",
    },
    restoredActionRehydrateDelayMs: 0,
    onEnsureThreadHistoryLoaded({ thread, turn, callCount }) {
      if (callCount === 1) {
        thread.historyNeedsRehydrate = true;
        turn.state = "running";
        turn.pendingAction = null;
        turn.submittedPendingActionId = "input-restored";
        return;
      }

      thread.historyNeedsRehydrate = false;
      turn.state = "completed";
      turn.pendingAction = null;
      turn.submittedPendingActionId = null;
      turn.result = {
        status: "completed",
        summary: "服务端状态已收口",
      };
    },
  });

  try {
    const { app, dom, activeTurn, waitingThread } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    const waitingActionForm = createWaitingActionForm({
      threadId: "thread-a",
      turnId: "turn-a",
      inputText: "这是恢复后的输入",
    });

    await dom.conversation.listeners.submit[0]({
      target: waitingActionForm,
      preventDefault() {},
    });

    await waitFor(() => app.history.ensureThreadHistoryLoadedCalls.length === 2);
    assert.equal(waitingThread.historyNeedsRehydrate, false);
    assert.equal(activeTurn.state, "completed");
    assert.equal(activeTurn.pendingAction, null);
    assert.equal(activeTurn.submittedPendingActionId, null);
    assert.deepEqual(activeTurn.result, {
      status: "completed",
      summary: "服务端状态已收口",
    });
  } finally {
    harness.restore();
  }
});

test("自动补 hydrate 尚未收口时不会放行新的提交", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeRunRef: null,
    activeRequestController: null,
    activeTurnState: "completed",
    activeTurnAction: null,
    allowCreateTurn: true,
    activeThreadDraftGoal: "新的提问",
    activeThreadDraftContext: "",
    restoredActionHydrationThreadId: "thread-a",
  });

  try {
    const { app, dom } = harness;
    const actions = createComposerActions(app, {
      consumeNdjsonStream: async () => {
        throw new Error("stream should not run while restored hydration is still pending");
      },
      finalizeTurnCancelled() {},
      finalizeTurnError() {},
    });
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.streamRequestCount, 0);
    assert.equal(app.runtime.submitActionCalls.length, 0);
    assert.match(app.store.transientStatus?.text ?? "", /同步上一轮任务的真实状态|请稍候/);
  } finally {
    harness.restore();
  }
});

test("普通 running turn 的自动补 hydrate 提示不会误写成 action 文案", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeRunRef: null,
    activeRequestController: null,
    activeTurnState: "running",
    activeTurnAction: null,
    activeTurnSubmittedPendingActionId: null,
    restoredActionHydrationThreadId: "thread-a",
    activeThreadDraftGoal: "新的提问",
    activeThreadDraftContext: "",
  });

  try {
    const { app, dom } = harness;
    const actions = createComposerActions(app, {
      consumeNdjsonStream: async () => {
        throw new Error("stream should not run while generic hydration is pending");
      },
      finalizeTurnCancelled() {},
      finalizeTurnError() {},
    });
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.streamRequestCount, 0);
    assert.equal(app.runtime.submitActionCalls.length, 0);
    assert.match(app.store.transientStatus?.text ?? "", /同步上一轮任务的真实状态|同步服务端状态/);
    assert.doesNotMatch(app.store.transientStatus?.text ?? "", /action 已提交/);
  } finally {
    harness.restore();
  }
});

test("自动补 hydrate 单轮达到上限后仍未收口时会继续保持锁定", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeRunRef: null,
    activeRequestController: null,
    activeTurnState: "waiting",
    activeTurnAction: {
      actionId: "input-restored",
      actionType: "user-input",
      prompt: "Reply please",
    },
    restoredActionRehydrateDelayMs: 0,
    restoredActionRehydrateMaxAttempts: 1,
    restoredActionRehydrateRecoveryDelayMs: 1000,
    onEnsureThreadHistoryLoaded({ thread, turn }) {
      thread.historyNeedsRehydrate = true;
      turn.state = "running";
      turn.pendingAction = null;
      turn.submittedPendingActionId = "input-restored";
    },
  });

  try {
    const { app, dom } = harness;
    const actions = createComposerActions(app, {});
    actions.bindComposerControls();

    const waitingActionForm = createWaitingActionForm({
      threadId: "thread-a",
      turnId: "turn-a",
      inputText: "这是恢复后的输入",
    });

    await dom.conversation.listeners.submit[0]({
      target: waitingActionForm,
      preventDefault() {},
    });

    await waitFor(() => app.history.ensureThreadHistoryLoadedCalls.length === 1);
    assert.equal(app.runtime.restoredActionHydrationThreadId, "thread-a");
    assert.match(app.store.transientStatus?.text ?? "", /当前会话会继续锁定|刷新页面/);
  } finally {
    harness.restore();
  }
});

test("bindLifecycleEvents 会在刷新后继续恢复未收口的自动 hydrate", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-a",
    activeRunRef: null,
    activeRequestController: null,
    activeTurnState: "running",
    activeTurnAction: null,
    activeTurnSubmittedPendingActionId: "input-restored",
    activeThreadHistoryNeedsRehydrate: true,
    restoredActionRehydrateDelayMs: 0,
    restoredActionRehydrateMaxAttempts: 1,
    onEnsureThreadHistoryLoaded({ thread, turn }) {
      thread.historyNeedsRehydrate = false;
      turn.state = "completed";
      turn.pendingAction = null;
      turn.submittedPendingActionId = null;
      turn.result = {
        status: "completed",
        summary: "刷新后已继续收口",
      };
    },
  });

  try {
    const { app, activeTurn } = harness;
    const actions = createComposerActions(app, {});
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    globalThis.document = {
      addEventListener() {},
    };
    globalThis.window = {
      addEventListener() {},
    };

    try {
      actions.bindLifecycleEvents();
    } finally {
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
    }

    await waitFor(() => app.history.ensureThreadHistoryLoadedCalls.length === 1);
    assert.deepEqual(app.history.ensureThreadHistoryLoadedCalls[0], {
      threadId: "thread-a",
      options: {
        force: true,
      },
    });
    assert.equal(activeTurn.state, "completed");
    assert.equal(activeTurn.submittedPendingActionId, null);
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

test("stream 非 Abort 错误时也会恢复挂起的 replacement submit", async () => {
  const harness = createComposerHarness({
    activeTurnState: "completed",
    activeTurnAction: null,
    activeRunRef: null,
    activeRequestController: null,
    allowCreateTurn: true,
    activeThreadDraftGoal: "新的提交内容",
    activeThreadDraftContext: "",
    pendingInterruptSubmit: {
      targetThreadId: "thread-a",
      goal: "替换后的消息",
      draftGoal: "替换后的消息",
      draftContext: "",
    },
  });

  try {
    const { app, dom } = harness;
    let consumeCount = 0;
    const actions = createComposerActions(app, {
      consumeNdjsonStream: async () => {
        consumeCount += 1;
        if (consumeCount === 1) {
          throw new Error("STREAM_BROKEN");
        }
      },
      finalizeTurnCancelled() {},
      finalizeTurnError() {},
    });
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    await waitFor(() => app.runtime.streamRequestCount === 2);
    assert.equal(app.runtime.pendingInterruptSubmit, null);
  } finally {
    harness.restore();
  }
});

test("线程 A 正在执行时，线程 B 的新消息会在打断后自动续发到 B", async () => {
  const harness = createComposerHarness({
    activeThreadId: "thread-b",
    activeTurnState: "running",
    activeTurnAction: null,
    activeThreadDraftGoal: "线程 B 的新消息",
    activeThreadDraftContext: "",
    allowCreateTurn: true,
  });

  try {
    const { app, dom, activeThread, waitingThread } = harness;
    const actions = createComposerActions(app, {
      consumeNdjsonStream: async () => {},
      finalizeTurnCancelled() {},
      finalizeTurnError() {},
    });
    actions.bindComposerControls();

    await dom.form.listeners.submit[0]({
      preventDefault() {},
    });

    assert.equal(app.runtime.abortCount, 1);
    assert.deepEqual(app.runtime.pendingInterruptSubmit, {
      targetThreadId: "thread-b",
      goal: "线程 B 的新消息",
      draftGoal: "线程 B 的新消息",
      draftContext: "",
    });
    assert.equal(app.runtime.streamRequestCount, 0);
    assert.equal(waitingThread.turns.length, 1);

    app.runtime.activeRunRef = null;
    app.runtime.activeRequestController = null;
    app.runtime.resumeInterruptedSubmit();

    await waitFor(() => app.runtime.streamRequestCount === 1);
    assert.equal(app.runtime.pendingInterruptSubmit, null);
    assert.equal(app.runtime.streamRequestCount, 1);
    assert.equal(activeThread.turns.length, 1);
    assert.equal(activeThread.turns[0].goal, "线程 B 的新消息");
    assert.equal(app.runtime.activeRunRef?.threadId, "thread-b");
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
    composerMode: options.activeThreadComposerMode ?? "chat",
    historyNeedsRehydrate: options.activeThreadHistoryNeedsRehydrate ?? false,
  });
  const activeThread = options.activeThreadId === "thread-b"
    ? createThreadRecord({
      id: "thread-b",
      title: "线程 B",
      draftGoal: options.activeThreadDraftGoal ?? "",
      draftContext: options.activeThreadDraftContext ?? "",
      composerMode: options.activeThreadComposerMode ?? "chat",
    })
    : waitingThread;
  const activeTurn = createTurnRecord({
    id: "turn-a",
    state: options.activeTurnState ?? "waiting",
    pendingAction: options.activeTurnAction ?? null,
    submittedPendingActionId: options.activeTurnSubmittedPendingActionId ?? null,
  });

  waitingThread.turns.push(activeTurn);

  const app = {
    runtime: {
      activeRunRef: Object.prototype.hasOwnProperty.call(options, "activeRunRef")
        ? options.activeRunRef
        : {
          threadId: "thread-a",
          turnId: "turn-a",
        },
      activeRequestController: Object.prototype.hasOwnProperty.call(options, "activeRequestController")
        ? options.activeRequestController
        : {
          abort() {
            app.runtime.abortCount += 1;
          },
        },
      activeThreadId: activeThread.id,
      sessionControlBusy: false,
      pendingInterruptSubmit: options.pendingInterruptSubmit ?? null,
      restoredActionHydrationThreadId: options.restoredActionHydrationThreadId ?? null,
      resumeInterruptedSubmitCalls: 0,
      restoredActionRehydrateDelayMs: options.restoredActionRehydrateDelayMs,
      restoredActionRehydrateMaxAttempts: options.restoredActionRehydrateMaxAttempts,
      restoredActionRehydrateRecoveryDelayMs: options.restoredActionRehydrateRecoveryDelayMs,
      resumeInterruptedSubmit() {
        this.resumeInterruptedSubmitCalls += 1;
      },
      abortCount: 0,
      streamRequestCount: 0,
      submitActionCalls: [],
    },
    utils: {
      autoResizeTextarea() {},
      nowIso: () => "2026-03-29T00:00:00.000Z",
      safeReadJson: async (response) => {
        try {
          return await response.clone().json();
        } catch {
          return null;
        }
      },
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
    getThreadById(threadId) {
      return threads.find((thread) => thread.id === threadId) ?? null;
    },
    getActiveTurn() {
      if (!app.runtime.activeRunRef) {
        return null;
      }

      return this.getTurn(app.runtime.activeRunRef.threadId, app.runtime.activeRunRef.turnId);
    },
    getTurn(threadId, turnId) {
      return threads.find((thread) => thread.id === threadId)?.turns.find((turn) => turn.id === turnId) ?? null;
    },
    getRunningThreadId() {
      return app.runtime.activeRunRef?.threadId ?? null;
    },
    isBusy() {
      return Boolean(
        (app.runtime.activeRequestController && app.runtime.activeRunRef)
        || app.runtime.restoredActionHydrationThreadId,
      );
    },
    isRestoredActionHydrating(threadId) {
      if (typeof threadId === "string" && threadId) {
        return app.runtime.restoredActionHydrationThreadId === threadId;
      }

      return Boolean(app.runtime.restoredActionHydrationThreadId);
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
    createTurn({ goal, inputText, options: turnOptions }) {
      if (!options.allowCreateTurn) {
        throw new Error("createTurn should not be called in this test");
      }

      return createTurnRecord({
        id: "turn-new",
        state: "queued",
        pendingAction: null,
        goal,
        inputText,
        options: turnOptions,
      });
    },
    resolveAccessMode() {
      return "auth";
    },
    resolveEffectiveSettings() {
      return {};
    },
    resolveComposerActionBarState(thread) {
      const latestTurn = Array.isArray(thread?.turns) ? thread.turns.at(-1) : null;

      if (!latestTurn || latestTurn.state === "waiting") {
        return {
          mode: thread?.composerMode ?? "chat",
          review: {
            enabled: false,
            reason: "当前还没有可审查的已收口结果",
          },
          steer: {
            enabled: false,
            reason: "当前没有执行中的任务可调整",
          },
        };
      }

      if (latestTurn.state === "running") {
        return {
          mode: thread?.composerMode ?? "chat",
          review: {
            enabled: false,
            reason: "当前还没有可审查的已收口结果",
          },
          steer: {
            enabled: true,
            reason: "",
          },
        };
      }

      if (latestTurn.state === "completed" || latestTurn.state === "failed" || latestTurn.state === "cancelled") {
        return {
          mode: thread?.composerMode ?? "chat",
          review: {
            enabled: true,
            reason: "",
          },
          steer: {
            enabled: false,
            reason: "当前没有执行中的任务可调整",
          },
        };
      }

      return {
        mode: thread?.composerMode ?? "chat",
        review: {
          enabled: false,
          reason: "当前还没有可审查的已收口结果",
        },
        steer: {
          enabled: false,
          reason: "当前没有执行中的任务可调整",
        },
      };
    },
    setThreadComposerMode(threadId, mode) {
      const thread = threads.find((entry) => entry.id === threadId);

      if (!thread) {
        return;
      }

      thread.composerMode = mode;
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
    conversation: createEventHost("conversation"),
    composerActionBar: createEventHost("composer-action-bar"),
    assistantLanguageStyleInput: createValueHost(""),
    assistantMbtiInput: createValueHost(""),
    assistantStyleNotesInput: createValueHost(""),
    assistantSoulInput: createValueHost(""),
    webSearchSelect: createValueHost("disabled"),
  };
  app.dom = dom;
  app.history = {
    ensureThreadHistoryLoadedCalls: [],
    async ensureThreadHistoryLoaded(threadId, historyOptions = {}) {
      const thread = app.store.getThreadById(threadId);
      const turn = thread?.turns.at(-1) ?? null;
      this.ensureThreadHistoryLoadedCalls.push({
        threadId,
        options: historyOptions,
      });
      if (typeof options.onEnsureThreadHistoryLoaded === "function") {
        await options.onEnsureThreadHistoryLoaded({
          thread,
          turn,
          callCount: this.ensureThreadHistoryLoadedCalls.length,
        });
      }
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const url = typeof _url === "string" ? _url : _url?.url ?? String(_url);
    if (url === "/api/tasks/actions") {
      app.runtime.submitActionCalls.push(JSON.parse(init.body));
      if (options.submitActionError) {
        const error = options.submitActionError instanceof Error
          ? options.submitActionError
          : new Error(String(options.submitActionError));
        return new Response(
          JSON.stringify({
            error: {
              message: error.message,
            },
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }
      if (options.submitActionDeferred) {
        return options.submitActionDeferred.promise;
      }
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

function createThreadRecord({
  id,
  title,
  draftGoal = "",
  draftContext = "",
  composerMode = "chat",
  historyNeedsRehydrate = false,
}) {
  return {
    id,
    title,
    draftGoal,
    draftContext,
    composerMode,
    settings: {},
    historyNeedsRehydrate,
    turns: [],
    updatedAt: "2026-03-29T00:00:00.000Z",
  };
}

function createTurnRecord({
  id,
  state,
  pendingAction,
  submittedPendingActionId = null,
  pendingActionError = "",
  pendingActionSubmitting = false,
  goal = "测试任务",
  inputText = "",
  options = undefined,
}) {
  return {
    id,
    taskId: "task-a",
    requestId: "request-a",
    state,
    pendingAction,
    submittedPendingActionId,
    pendingActionError,
    pendingActionSubmitting,
    goal,
    inputText,
    options,
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

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
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

function createWaitingActionForm({ threadId, turnId, inputText }) {
  return {
    dataset: {
      threadId,
      turnId,
    },
    closest(selector) {
      return selector.startsWith("form") ? this : null;
    },
    querySelector(selector) {
      if (selector === "textarea") {
        return {
          value: inputText,
        };
      }

      return null;
    },
  };
}
