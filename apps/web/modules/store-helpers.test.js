import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "./store.js";
import { createStoreHelpers } from "./store-helpers.js";
import { createStoreModelHelpers } from "./store-models.js";
import * as utils from "./utils.js";

test("principal task settings 会为缺省线程提供 model/reasoning/sandbox/search/network/approval/account 默认值", () => {
  const helpers = createStoreHelpers({
    app: createAppHarness({
      identity: {
        taskSettings: {
          authAccountId: "principal-account",
          model: "gpt-5.4-mini",
          reasoning: "high",
          sandboxMode: "workspace-write",
          webSearchMode: "disabled",
          networkAccessEnabled: false,
          approvalPolicy: "on-request",
        },
      },
    }),
    getState: () => ({ threads: [] }),
    saveState() {},
  });

  const effective = helpers.resolveEffectiveSettings({
  });

  assert.equal(effective.authAccountId, "principal-account");
  assert.equal(effective.model, "gpt-5.4-mini");
  assert.equal(effective.reasoning, "high");
  assert.equal(effective.sandboxMode, "workspace-write");
  assert.equal(effective.webSearchMode, "disabled");
  assert.equal(effective.networkAccessEnabled, false);
  assert.equal(effective.approvalPolicy, "on-request");
});

test("buildTaskOptions 会把 principal task settings 带到新任务里", () => {
  const helpers = createStoreHelpers({
    app: createAppHarness({
      identity: {
        taskSettings: {
          authAccountId: "principal-account",
          model: "gpt-5.4-mini",
          reasoning: "high",
          sandboxMode: "workspace-write",
          webSearchMode: "disabled",
          networkAccessEnabled: false,
          approvalPolicy: "on-request",
        },
      },
    }),
    getState: () => ({ threads: [] }),
    saveState() {},
  });

  const options = helpers.buildTaskOptions({});

  assert.equal(options.authAccountId, "principal-account");
  assert.equal(options.model, "gpt-5.4-mini");
  assert.equal(options.reasoning, "high");
  assert.equal(options.sandboxMode, "workspace-write");
  assert.equal(options.webSearchMode, "disabled");
  assert.equal(options.networkAccessEnabled, false);
  assert.equal(options.approvalPolicy, "on-request");
});

test("composerMode 会在线程模型中默认回退为 chat", () => {
  const models = createStoreModelHelpers();

  assert.equal(models.createThread().composerMode, "chat");

  const normalizedState = models.normalizeState({
    activeThreadId: "thread-review",
    threads: [
      {
        id: "thread-invalid",
        composerMode: "invalid",
      },
      {
        id: "thread-review",
        composerMode: "review",
      },
    ],
  });

  assert.equal(normalizedState.threads[0].composerMode, "chat");
  assert.equal(normalizedState.threads[1].composerMode, "review");
});

test("threadOrigin 会在模型层默认回退为 standard，并在线程控制派生里输出来源标签和状态摘要", () => {
  const models = createStoreModelHelpers();
  const created = models.createThread();
  const normalized = models.normalizeState({
    activeThreadId: "conversation-1",
    threads: [
      {
        id: "conversation-1",
        title: "已接入线程",
        threadOrigin: "attached",
        historyOriginKind: "fork",
        historyOriginSessionId: "conversation-root-1",
        historyOriginLabel: "fork 自 conversation-root-1",
        historyArchivedAt: "2026-04-02T10:00:00.000Z",
        serverThreadId: "server-thread-1",
        turns: [
          {
            id: "turn-1",
            goal: "running turn",
            inputText: "",
            state: "running",
            assistantMessages: [],
            steps: [],
            result: null,
          },
        ],
      },
    ],
  });

  assert.equal(created.threadOrigin, "standard");
  assert.equal(normalized.threads[0].threadOrigin, "attached");
  assert.equal(normalized.threads[0].historyOriginKind, "fork");
  assert.equal(normalized.threads[0].historyOriginSessionId, "conversation-root-1");
  assert.equal(normalized.threads[0].historyOriginLabel, "fork 自 conversation-root-1");
  assert.equal(normalized.threads[0].historyArchivedAt, "2026-04-02T10:00:00.000Z");

  const app = createAppHarness();
  const helpers = createStoreHelpers({
    app,
    getState: () => normalized,
    saveState() {},
  });

  assert.deepEqual(helpers.resolveThreadControlState(normalized.threads[0]), {
    status: { kind: "running", label: "正在执行" },
    source: { kind: "attached", label: "已接入" },
    conversationId: "conversation-1",
    joinHint: "切走后只是离开当前线程视图，不会改变目标线程真实执行状态。",
    details: [
      { label: "conversationId", value: "conversation-1" },
      { label: "serverThreadId", value: "server-thread-1" },
      { label: "来源", value: "已接入" },
      { label: "分支来源", value: "fork 自 conversation-root-1" },
      { label: "源会话", value: "conversation-root-1" },
      { label: "归档状态", value: "已归档" },
    ],
  });
});

test("resolveThreadControlState 会按 waiting 和 recovery 提升状态摘要优先级", () => {
  const thread = createThreadRecord({
    id: "conversation-priority",
    title: "优先级线程",
    threadOrigin: "fork",
    historyNeedsRehydrate: false,
  });
  const turn = createTurnRecord({
    id: "turn-priority",
    state: "waiting",
    pendingAction: {
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Need approval",
    },
    submittedPendingActionId: null,
  });
  thread.turns.push(turn);

  const app = createAppHarness();
  const helpers = createStoreHelpers({
    app,
    getState: () => ({ activeThreadId: thread.id, threads: [thread] }),
    saveState() {},
  });

  assert.equal(helpers.resolveThreadControlState(thread).status.label, "等待处理中的 action");
  assert.equal(helpers.resolveThreadControlState(thread).source.label, "fork");

  turn.pendingAction = null;
  turn.submittedPendingActionId = "approval-1";
  assert.equal(helpers.resolveThreadControlState(thread).status.label, "正在同步");

  turn.submittedPendingActionId = null;
  turn.state = "completed";
  assert.equal(helpers.resolveThreadControlState(thread).status.label, "当前空闲");
});

test("resolveComposerActionBarState 在 completed / failed / cancelled 终态时只开启 review", () => {
  const steerDisabledReason = "当前没有执行中的任务可调整";
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => ({ activeThreadId: null, threads: [] }),
    saveState() {},
  });

  for (const [state, summary] of [
    ["completed", "任务已完成"],
    ["failed", "任务已失败"],
    ["cancelled", "任务已取消"],
  ]) {
    const thread = createThreadRecord({
      id: `thread-${state}`,
      composerMode: "review",
      turns: [
        createTurnRecord({
          id: `turn-${state}`,
          state,
          result: {
            status: state,
            summary,
          },
        }),
        ],
      });

    assert.deepEqual(helpers.resolveComposerActionBarState(thread), {
      mode: "review",
      review: {
        enabled: true,
        reason: "",
      },
      steer: {
        enabled: false,
        reason: steerDisabledReason,
      },
    });
  }
});

test("resolveComposerActionBarState 在 running 最新 turn 时只开启 steer", () => {
  const reviewDisabledReason = "当前还没有可审查的已收口结果";
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => ({ activeThreadId: null, threads: [] }),
    saveState() {},
  });

  const thread = createThreadRecord({
    id: "thread-running",
    composerMode: "steer",
    turns: [
      createTurnRecord({
        id: "turn-running",
        state: "running",
      }),
    ],
  });

  assert.deepEqual(helpers.resolveComposerActionBarState(thread), {
    mode: "steer",
    review: {
      enabled: false,
      reason: reviewDisabledReason,
    },
    steer: {
      enabled: true,
      reason: "",
    },
  });
});

test("resolveComposerActionBarState 在 waiting pendingAction 时禁用两按钮", () => {
  const reviewDisabledReason = "当前还没有可审查的已收口结果";
  const steerDisabledReason = "当前没有执行中的任务可调整";
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => ({ activeThreadId: null, threads: [] }),
    saveState() {},
  });

  const thread = createThreadRecord({
    id: "thread-waiting",
    composerMode: "chat",
    turns: [
      createTurnRecord({
        id: "turn-waiting",
        state: "waiting",
        pendingAction: {
          actionId: "action-1",
          actionType: "approval",
          prompt: "请确认",
        },
      }),
    ],
  });

  assert.deepEqual(helpers.resolveComposerActionBarState(thread), {
    mode: "chat",
    review: {
      enabled: false,
      reason: reviewDisabledReason,
    },
    steer: {
      enabled: false,
      reason: steerDisabledReason,
    },
  });
});

test("resolveComposerActionBarState 在 submittedPendingActionId 导致的 action recovery 时禁用两按钮", () => {
  const reviewDisabledReason = "当前还没有可审查的已收口结果";
  const steerDisabledReason = "当前没有执行中的任务可调整";
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => ({ activeThreadId: null, threads: [] }),
    saveState() {},
  });

  const thread = createThreadRecord({
    id: "thread-recovery-action",
    composerMode: "steer",
    turns: [
      createTurnRecord({
        id: "turn-recovery-action",
        state: "running",
        submittedPendingActionId: "action-2",
      }),
    ],
  });

  assert.deepEqual(helpers.resolveComposerActionBarState(thread), {
    mode: "steer",
    review: {
      enabled: false,
      reason: reviewDisabledReason,
    },
    steer: {
      enabled: false,
      reason: steerDisabledReason,
    },
  });
});

test("resolveComposerActionBarState 在 restored hydration 命中当前线程时禁用两按钮", () => {
  const reviewDisabledReason = "当前还没有可审查的已收口结果";
  const steerDisabledReason = "当前没有执行中的任务可调整";
  const app = createAppHarness();
  app.runtime.restoredActionHydrationThreadId = "thread-rehydrating";
  const helpers = createStoreHelpers({
    app,
    getState: () => ({ activeThreadId: null, threads: [] }),
    saveState() {},
  });

  const thread = createThreadRecord({
    id: "thread-rehydrating",
    composerMode: "review",
    historyNeedsRehydrate: true,
    turns: [
      createTurnRecord({
        id: "turn-rehydrating",
        state: "running",
      }),
    ],
  });

  assert.deepEqual(helpers.resolveComposerActionBarState(thread), {
    mode: "review",
    review: {
      enabled: false,
      reason: reviewDisabledReason,
    },
    steer: {
      enabled: false,
      reason: steerDisabledReason,
    },
  });
});

test("resolveComposerActionBarState 在空线程时禁用两按钮", () => {
  const reviewDisabledReason = "当前还没有可审查的已收口结果";
  const steerDisabledReason = "当前没有执行中的任务可调整";
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => ({ activeThreadId: null, threads: [] }),
    saveState() {},
  });

  const thread = createThreadRecord({
    id: "thread-empty",
    composerMode: "review",
    turns: [],
  });

  assert.deepEqual(helpers.resolveComposerActionBarState(thread), {
    mode: "review",
    review: {
      enabled: false,
      reason: reviewDisabledReason,
    },
    steer: {
      enabled: false,
      reason: steerDisabledReason,
    },
  });
});

test("setThreadComposerMode 会归一化并持久化线程级 composerMode，缺失线程时静默返回", () => {
  const storageKey = "themis-store-helper-test";
  const storage = createLocalStorageMock({
    [storageKey]: JSON.stringify({
      activeThreadId: "thread-mode",
      threads: [
        {
          id: "thread-mode",
          title: "模式会话",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          composerMode: "review",
          settings: {},
          turns: [],
        },
      ],
    }),
  });
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = storage;

  try {
    const app = createStoreAppHarness(storageKey);
    const store = createStore(app);

    assert.equal(store.getThreadById("thread-mode").composerMode, "review");

    store.setThreadComposerMode("thread-mode", "steer");

    assert.equal(store.getThreadById("thread-mode").composerMode, "steer");
    assert.notEqual(store.getThreadById("thread-mode").updatedAt, "2026-03-29T00:00:00.000Z");
    assert.equal(JSON.parse(storage.getItem(storageKey)).threads[0].composerMode, "steer");

    store.setThreadComposerMode("thread-mode", "invalid-value");

    assert.equal(store.getThreadById("thread-mode").composerMode, "chat");
    assert.equal(JSON.parse(storage.getItem(storageKey)).threads[0].composerMode, "chat");

    const persistedBefore = storage.getItem(storageKey);
    store.setThreadComposerMode("missing-thread", "review");
    assert.equal(storage.getItem(storageKey), persistedBefore);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test("createStore 会暴露 resolveThreadControlState，供 UI 渲染线程控制面板使用", () => {
  const storageKey = "themis-store-thread-control-export-test";
  const storage = createLocalStorageMock({
    [storageKey]: JSON.stringify({
      activeThreadId: "thread-control",
      threads: [
        {
          id: "thread-control",
          title: "线程控制会话",
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
          composerMode: "chat",
          threadOrigin: "attached",
          serverThreadId: "server-thread-control",
          settings: {},
          turns: [
            {
              id: "turn-control",
              state: "waiting",
              pendingAction: {
                actionId: "action-control",
                actionType: "user-input",
                prompt: "请补充信息",
              },
            },
          ],
        },
      ],
    }),
  });
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = storage;

  try {
    const app = createStoreAppHarness(storageKey);
    const store = createStore(app);

    assert.equal(typeof store.resolveThreadControlState, "function");
    assert.deepEqual(store.resolveThreadControlState(store.getActiveThread()), {
      status: { kind: "waiting", label: "等待处理中的 action" },
      source: { kind: "attached", label: "已接入" },
      conversationId: "thread-control",
      joinHint: "切走后只是离开当前线程视图，不会改变目标线程真实执行状态。",
      details: [
        { label: "conversationId", value: "thread-control" },
        { label: "serverThreadId", value: "server-thread-control" },
        { label: "来源", value: "已接入" },
      ],
    });
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test("resolveTopRiskState 会按 waiting、当前恢复、其他恢复的优先级返回顶部任务条状态", () => {
  const app = createAppHarness();
  app.runtime.restoredActionHydrationThreadId = "thread-current";
  const state = {
    activeThreadId: "thread-current",
    threads: [
      createThreadRecord({
        id: "thread-current",
        title: "当前会话",
        historyNeedsRehydrate: true,
        turns: [
          createTurnRecord({
            id: "turn-current",
            state: "waiting",
            pendingAction: {
              actionId: "action-current",
              actionType: "user-input",
              prompt: "请补充信息",
              choices: ["继续", "取消"],
            },
            pendingActionError: "",
            pendingActionSubmitting: false,
          }),
        ],
      }),
      createThreadRecord({
        id: "thread-other",
        title: "其他会话",
        historyNeedsRehydrate: true,
        turns: [
          createTurnRecord({
            id: "turn-other",
            state: "running",
            submittedPendingActionId: "action-other",
          }),
        ],
      }),
    ],
  };
  const helpers = createStoreHelpers({
    app,
    getState: () => state,
    saveState() {},
  });

  assert.deepEqual(helpers.resolveTopRiskState(state.threads[0]), {
    kind: "waiting",
    threadId: "thread-current",
    turnId: "turn-current",
    message: "当前会话等待处理",
    actionKind: "focus-turn",
    actionLabel: "跳到当前 turn",
    tone: "warning",
  });

  state.threads[0].turns[0].pendingAction = null;

  assert.deepEqual(helpers.resolveTopRiskState(state.threads[0]), {
    kind: "rehydrating-current",
    threadId: "thread-current",
    turnId: "turn-current",
    message: "当前会话正在同步上一轮任务的真实状态",
    actionKind: "focus-turn",
    actionLabel: "查看当前 turn",
    tone: "neutral",
  });

  state.threads[0].turns[0].pendingAction = {
    actionId: "action-current",
    actionType: "user-input",
    prompt: "请补充信息",
    choices: ["继续", "取消"],
  };
  state.threads[0].turns[0].state = "running";
  state.threads[0].turns[0].pendingAction = null;
  state.threads[0].turns[0].submittedPendingActionId = "action-current";

  assert.deepEqual(helpers.resolveTopRiskState(state.threads[0]), {
    kind: "rehydrating-current",
    threadId: "thread-current",
    turnId: "turn-current",
    message: "当前会话正在同步上一轮 action 后续状态",
    actionKind: "focus-turn",
    actionLabel: "查看当前 turn",
    tone: "neutral",
  });

  state.threads[0].turns[0].submittedPendingActionId = null;

  assert.deepEqual(helpers.resolveTopRiskState(state.threads[0]), {
    kind: "rehydrating-current",
    threadId: "thread-current",
    turnId: "turn-current",
    message: "当前会话正在同步上一轮任务的真实状态",
    actionKind: "focus-turn",
    actionLabel: "查看当前 turn",
    tone: "neutral",
  });

  state.threads[0].historyNeedsRehydrate = false;
  state.threads[1].turns[0].submittedPendingActionId = "action-other";
  state.threads[1].turns[0].state = "running";
  state.activeThreadId = "thread-current";
  app.runtime.restoredActionHydrationThreadId = "thread-other";

  assert.deepEqual(helpers.resolveTopRiskState(state.threads[0]), {
    kind: "rehydrating-other",
    threadId: "thread-other",
    turnId: "turn-other",
    message: "会话「其他会话」仍在同步上一轮 action 后续状态",
    actionKind: "open-thread",
    actionLabel: "切过去查看",
    tone: "neutral",
  });

  state.threads[1].turns[0].submittedPendingActionId = null;

  assert.deepEqual(helpers.resolveTopRiskState(state.threads[0]), {
    kind: "rehydrating-other",
    threadId: "thread-other",
    turnId: "turn-other",
    message: "会话「其他会话」仍在同步上一轮任务的真实状态",
    actionKind: "open-thread",
    actionLabel: "切过去查看",
    tone: "neutral",
  });
});

test("resolveTurnActionState 会把 waiting error 和恢复态映射成 turn 卡片状态", () => {
  const thread = createThreadRecord({
    id: "thread-action",
    title: "动作会话",
    historyNeedsRehydrate: true,
  });
  const turn = createTurnRecord({
    id: "turn-action",
    state: "waiting",
    pendingAction: {
      actionId: "action-1",
      actionType: "user-input",
      prompt: "请补充信息",
      choices: ["继续", "取消"],
    },
    pendingActionInputText: "已填写的内容",
    pendingActionError: "提交失败，请重试",
    pendingActionSubmitting: false,
  });
  thread.turns.push(turn);
  const app = createAppHarness();
  app.runtime.restoredActionHydrationThreadId = "thread-action";
  const helpers = createStoreHelpers({
    app,
    getState: () => ({ activeThreadId: thread.id, threads: [thread] }),
    saveState() {},
  });

  assert.deepEqual(helpers.resolveTurnActionState(thread, turn), {
    kind: "waiting",
    heading: "等待处理",
    actionType: "user-input",
    prompt: "请补充信息",
    choices: ["继续", "取消"],
    errorMessage: "提交失败，请重试",
    submitting: false,
    inputText: "已填写的内容",
  });

  turn.pendingAction = null;
  assert.deepEqual(helpers.resolveTurnActionState(thread, turn), {
    kind: "rehydrating",
    heading: "状态同步中",
    prompt: "浏览器刚恢复这个会话，正在向服务端同步上一轮任务的真实状态。",
  });

  turn.state = "running";
  turn.submittedPendingActionId = "action-1";
  turn.pendingActionError = "";

  assert.deepEqual(helpers.resolveTurnActionState(thread, turn), {
    kind: "rehydrating",
    heading: "状态同步中",
    prompt: "上一轮 action 已提交，正在等待服务端继续执行并同步状态。",
  });

  turn.submittedPendingActionId = null;

  assert.deepEqual(helpers.resolveTurnActionState(thread, turn), {
    kind: "rehydrating",
    heading: "状态同步中",
    prompt: "浏览器刚恢复这个会话，正在向服务端同步上一轮任务的真实状态。",
  });
});

test("resolveTurnActionState 只会把当前恢复中的最新 turn 视为 generic recovery", () => {
  const thread = createThreadRecord({
    id: "thread-generic-recovery",
    title: "恢复会话",
    historyNeedsRehydrate: true,
    turns: [
      createTurnRecord({
        id: "turn-old",
        state: "completed",
      }),
      createTurnRecord({
        id: "turn-latest",
        state: "running",
      }),
    ],
  });
  const app = createAppHarness();
  app.runtime.restoredActionHydrationThreadId = "thread-generic-recovery";
  const helpers = createStoreHelpers({
    app,
    getState: () => ({ activeThreadId: thread.id, threads: [thread] }),
    saveState() {},
  });

  assert.equal(helpers.resolveTurnActionState(thread, thread.turns[0]), null);
  assert.deepEqual(helpers.resolveTurnActionState(thread, thread.turns[1]), {
    kind: "rehydrating",
    heading: "状态同步中",
    prompt: "浏览器刚恢复这个会话，正在向服务端同步上一轮任务的真实状态。",
  });
});

test("repairInterruptedTurns 会把刷新后残留的 waiting action turn 标记为已中断", () => {
  const state = {
    threads: [
      {
        id: "thread-1",
        updatedAt: "2026-03-29T00:00:00.000Z",
        turns: [
          {
            id: "turn-1",
            state: "waiting",
            pendingAction: {
              actionId: "action-1",
              actionType: "user-input",
              prompt: "请补充信息",
            },
            steps: [],
            result: null,
          },
        ],
      },
    ],
  };
  let saveCount = 0;
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => state,
    saveState() {
      saveCount += 1;
    },
  });

  helpers.repairInterruptedTurns();

  const turn = state.threads[0].turns[0];
  assert.equal(turn.state, "cancelled");
  assert.equal(turn.pendingAction, null);
  assert.deepEqual(turn.result, {
    status: "cancelled",
    summary: "浏览器刷新或会话关闭后，本次任务已中断。",
  });
  assert.deepEqual(turn.steps, [
    {
      title: "会话已中断",
      text: "浏览器刷新或会话关闭后，本次任务未继续运行。",
      tone: "error",
    },
  ]);
  assert.equal(saveCount, 1);
});

test("repairInterruptedTurns 不会把带后端标识的 waiting action turn 直接打成 cancelled，而是标记为待同步", () => {
  const state = {
    threads: [
      {
        id: "thread-server-waiting",
        updatedAt: "2026-03-29T00:00:00.000Z",
        historyNeedsRehydrate: false,
        turns: [
          {
            id: "turn-server-waiting",
            state: "waiting",
            requestId: "req-server-1",
            taskId: "task-server-1",
            serverThreadId: "server-thread-1",
            pendingAction: {
              actionId: "action-server-1",
              actionType: "approval",
              prompt: "是否继续执行",
            },
            steps: [],
            result: null,
          },
        ],
      },
    ],
  };
  let saveCount = 0;
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => state,
    saveState() {
      saveCount += 1;
    },
  });

  helpers.repairInterruptedTurns();

  const thread = state.threads[0];
  const turn = thread.turns[0];
  assert.equal(thread.historyNeedsRehydrate, true);
  assert.equal(turn.state, "waiting");
  assert.equal(turn.pendingAction, null);
  assert.equal(turn.result, null);
  assert.match(turn.steps.at(-1)?.text ?? "", /同步服务端状态/);
  assert.equal(saveCount, 1);
});

test("repairInterruptedTurns 不会把仍在等待服务端后续收口的 running turn 提前打成 cancelled", () => {
  const state = {
    threads: [
      {
        id: "thread-2",
        updatedAt: "2026-03-29T00:00:00.000Z",
        historyNeedsRehydrate: true,
        turns: [
          {
            id: "turn-2",
            state: "running",
            pendingAction: null,
            submittedPendingActionId: "action-2",
            steps: [],
            result: null,
          },
        ],
      },
    ],
  };
  let saveCount = 0;
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => state,
    saveState() {
      saveCount += 1;
    },
  });

  helpers.repairInterruptedTurns();

  const turn = state.threads[0].turns[0];
  assert.equal(turn.state, "running");
  assert.equal(turn.pendingAction, null);
  assert.equal(turn.submittedPendingActionId, "action-2");
  assert.equal(turn.result, null);
  assert.deepEqual(turn.steps, []);
  assert.equal(saveCount, 1);
});

test("repairInterruptedTurns 不会把带后端标识的 running turn 直接打成 cancelled，而是标记为待同步", () => {
  const state = {
    threads: [
      {
        id: "thread-server-running",
        updatedAt: "2026-03-29T00:00:00.000Z",
        historyNeedsRehydrate: false,
        turns: [
          {
            id: "turn-server-running",
            state: "running",
            requestId: "req-server-2",
            taskId: "task-server-2",
            serverThreadId: "server-thread-2",
            pendingAction: null,
            submittedPendingActionId: null,
            steps: [],
            result: null,
          },
        ],
      },
    ],
  };
  let saveCount = 0;
  const helpers = createStoreHelpers({
    app: createAppHarness(),
    getState: () => state,
    saveState() {
      saveCount += 1;
    },
  });

  helpers.repairInterruptedTurns();

  const thread = state.threads[0];
  const turn = thread.turns[0];
  assert.equal(thread.historyNeedsRehydrate, true);
  assert.equal(turn.state, "running");
  assert.equal(turn.pendingAction, null);
  assert.equal(turn.result, null);
  assert.match(turn.steps.at(-1)?.text ?? "", /同步服务端状态/);
  assert.equal(saveCount, 1);
});

function createThreadRecord(overrides = {}) {
  return {
    id: "thread-default",
    title: "新会话",
    composerMode: "chat",
    historyNeedsRehydrate: false,
    turns: [],
    ...overrides,
  };
}

function createTurnRecord(overrides = {}) {
  return {
    id: "turn-default",
    state: "queued",
    pendingAction: null,
    pendingActionInputText: "",
    pendingActionError: "",
    pendingActionSubmitting: false,
    submittedPendingActionId: null,
    ...overrides,
  };
}

function createAppHarness(overrides = {}) {
  return {
    runtime: {
      identity: {
        assistantLanguageStyle: "",
        assistantMbti: "",
        assistantStyleNotes: "",
        assistantSoul: "",
        taskSettings: {
          authAccountId: "",
          model: "",
          reasoning: "",
          sandboxMode: "",
          webSearchMode: "",
          networkAccessEnabled: null,
          approvalPolicy: "",
        },
        ...(overrides.identity ?? {}),
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
  };
}

function createStoreAppHarness(storageKey) {
  const harness = createAppHarness();

  harness.constants = {
    MAX_THREAD_COUNT: 20,
    STORAGE_KEY: storageKey,
  };
  harness.utils = utils;
  harness.renderer = {
    renderAll() {},
  };

  return harness;
}

function createLocalStorageMock(initialEntries = {}) {
  const storage = new Map(Object.entries(initialEntries));

  return {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };
}
