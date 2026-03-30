import assert from "node:assert/strict";
import test from "node:test";
import * as markup from "./ui-markup.js";
import * as utils from "./utils.js";

test("renderThreadRiskBannerMarkup 会为其他会话恢复中渲染跳转按钮", () => {
  assert.equal(typeof markup.renderThreadRiskBannerMarkup, "function");

  const html = markup.renderThreadRiskBannerMarkup(
    {
      kind: "rehydrating-other",
      message: '会话「恢复线程」仍在同步上一轮 action 后续状态',
      actionKind: "open-thread",
      actionLabel: "切过去查看",
      threadId: "thread-restore",
      turnId: "turn-restore",
      tone: "neutral",
    },
    utils,
  );

  assert.ok(html.includes('会话「恢复线程」仍在同步上一轮 action 后续状态'));
  assert.ok(html.includes('data-risk-banner-action="open-thread"'));
  assert.ok(html.includes('data-thread-id="thread-restore"'));
  assert.ok(html.includes("切过去查看"));
});

test("renderTurnMarkup 会在 waiting action 时渲染按钮和 inline error", () => {
  const thread = {
    id: "thread-waiting",
    title: "等待会话",
  };
  const turn = {
    id: "turn-waiting",
    goal: "请批准这次变更",
    inputText: "额外上下文",
    state: "waiting",
    options: {},
    pendingAction: {
      actionId: "action-waiting",
      actionType: "approval",
      prompt: "是否批准这次变更？",
      choices: ["approve", "deny"],
    },
    pendingActionError: "错误文案",
    pendingActionSubmitting: false,
    assistantMessages: [],
    steps: [],
    result: null,
  };
  const store = createStoreStub({
    assistantLabel: "Themis Assistant",
    latestTurnMessage: "等待处理中的摘要",
    resolveTurnActionState() {
      return {
        kind: "waiting",
        heading: "等待审批",
        actionType: "approval",
        prompt: "是否批准这次变更？",
        choices: ["approve", "deny"],
        errorMessage: "错误文案",
        submitting: false,
        inputText: "",
      };
    },
  });

  const html = markup.renderTurnMarkup(turn, 1, { thread, store, utils });

  assert.ok(html.includes("等待审批"));
  assert.ok(html.includes("批准"));
  assert.ok(html.includes("拒绝"));
  assert.ok(html.includes("错误文案"));
  assert.ok(html.includes("assistant-summary"));
});

test("renderTurnMarkup 会在 recovery card 出现时保留 assistant stream 和最终结果区块", () => {
  const thread = {
    id: "thread-recovery",
    title: "恢复会话",
  };
  const turn = {
    id: "turn-recovery",
    goal: "恢复中的任务",
    inputText: "",
    state: "running",
    options: {},
    assistantMessages: [
      { text: "过程消息一" },
    ],
    steps: [],
    result: {
      status: "completed",
      summary: "最终摘要",
      output: "最终输出",
    },
  };
  const store = createStoreStub({
    assistantLabel: "Themis Assistant",
    latestTurnMessage: "最终摘要",
    visibleAssistantMessages: [
      { text: "过程消息一" },
    ],
    resolveTurnActionState() {
      return {
        kind: "rehydrating",
        heading: "状态同步中",
        prompt: "浏览器刚恢复这个会话，正在向服务端同步上一轮任务的真实状态。",
      };
    },
  });

  const html = markup.renderTurnMarkup(turn, 1, { thread, store, utils });

  assert.ok(html.includes('data-turn-action-kind="rehydrating"'));
  assert.ok(html.includes("过程消息一"));
  assert.ok(html.includes("最终结果"));
  assert.ok(html.includes("最终摘要"));
  assert.ok(html.includes("最终输出"));
});

test("renderTurnMarkup 保留 completed turn 的最终结果区块", () => {
  const thread = {
    id: "thread-complete",
    title: "完成会话",
  };
  const turn = {
    id: "turn-complete",
    goal: "输出最终结果",
    inputText: "",
    state: "completed",
    options: {},
    result: {
      status: "completed",
      summary: "最终摘要",
      output: "最终输出",
    },
    assistantMessages: [],
    steps: [],
  };
  const store = createStoreStub({
    assistantLabel: "Themis Assistant",
    latestTurnMessage: "最终摘要",
  });

  const html = markup.renderTurnMarkup(turn, 1, { thread, store, utils });

  assert.ok(html.includes("最终结果"));
  assert.ok(html.includes("最终摘要"));
  assert.ok(html.includes("最终输出"));
});

function createStoreStub({
  assistantLabel,
  latestTurnMessage,
  resolveTurnActionState = null,
  visibleAssistantMessages = [],
}) {
  return {
    resolveAssistantDisplayLabel() {
      return assistantLabel;
    },
    getVisibleAssistantMessages() {
      return visibleAssistantMessages;
    },
    latestTurnMessage() {
      return latestTurnMessage;
    },
    resolveTurnActionState(thread, turn) {
      return typeof resolveTurnActionState === "function"
        ? resolveTurnActionState(thread, turn)
        : null;
    },
  };
}
