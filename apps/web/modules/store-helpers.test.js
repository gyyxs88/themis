import assert from "node:assert/strict";
import test from "node:test";
import { createStoreHelpers } from "./store-helpers.js";

test("principal task settings 会覆盖旧的会话级 sandbox/search/network/approval/account", () => {
  const helpers = createStoreHelpers({
    app: createAppHarness({
      identity: {
        taskSettings: {
          authAccountId: "principal-account",
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
    authAccountId: "legacy-session-account",
    sandboxMode: "workspace-write",
    webSearchMode: "live",
    networkAccessEnabled: true,
    approvalPolicy: "never",
  });

  assert.equal(effective.authAccountId, "principal-account");
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
  assert.equal(options.sandboxMode, "workspace-write");
  assert.equal(options.webSearchMode, "disabled");
  assert.equal(options.networkAccessEnabled, false);
  assert.equal(options.approvalPolicy, "on-request");
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
    inputText: "",
  });

  turn.state = "running";
  turn.pendingAction = null;
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
