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
