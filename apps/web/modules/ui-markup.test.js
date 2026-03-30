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

test("renderTurnMarkup 会把 user-input waiting 卡片渲染成真正的 submit 表单", () => {
  const thread = {
    id: "thread-user-input",
    title: "输入会话",
  };
  const turn = {
    id: "turn-user-input",
    goal: "请补充说明",
    inputText: "",
    state: "waiting",
    options: {},
    pendingAction: {
      actionId: "action-user-input",
      actionType: "user-input",
      prompt: "请输入回复",
    },
    pendingActionError: "",
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
        heading: "等待输入",
        actionType: "user-input",
        prompt: "请输入回复",
        choices: [],
        errorMessage: "",
        submitting: false,
        inputText: "已填写的内容",
      };
    },
  });

  const html = markup.renderTurnMarkup(turn, 1, { thread, store, utils });

  assert.ok(html.includes('<form class="turn-action-input-form"'));
  assert.ok(html.includes('type="submit"'));
  assert.ok(html.includes("已填写的内容"));
});

test("renderTurnMarkup 会把 reject 规范成 deny 再渲染", () => {
  const thread = {
    id: "thread-approval",
    title: "审批会话",
  };
  const turn = {
    id: "turn-approval",
    goal: "请审批",
    inputText: "",
    state: "waiting",
    options: {},
    pendingAction: {
      actionId: "action-approval",
      actionType: "approval",
      prompt: "是否批准这次变更？",
      choices: ["approve", "reject"],
    },
    pendingActionError: "",
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
        choices: ["approve", "reject"],
        errorMessage: "",
        submitting: false,
        inputText: "",
      };
    },
  });

  const html = markup.renderTurnMarkup(turn, 1, { thread, store, utils });

  assert.ok(html.includes('data-waiting-action-decision="deny"'));
  assert.ok(html.includes("拒绝"));
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

test("renderComposerActionBarMarkup 会渲染 Review / Steer 动作条与退出入口", () => {
  assert.equal(typeof markup.renderComposerActionBarMarkup, "function");

  const html = markup.renderComposerActionBarMarkup(
    {
      mode: "review",
      review: {
        enabled: true,
        reason: "",
      },
      steer: {
        enabled: false,
        reason: "当前没有执行中的任务可调整",
      },
    },
    utils,
  );

  assert.match(html, /data-composer-mode-button="review"[\s\S]*?>\s*Review\s*<\/button>/);
  assert.match(html, /data-composer-mode-button="steer"[\s\S]*?>\s*Steer\s*<\/button>/);
  assert.ok(!html.includes("提交 Review"));
  assert.ok(!html.includes("发送 Steer"));
  assert.ok(html.includes('data-composer-mode-button="review"'));
  assert.ok(html.includes('data-composer-mode-button="steer"'));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes("当前没有执行中的任务可调整"));
  assert.ok(html.includes("退出动作模式"));
});

test("renderComposerActionBarMarkup 在 chat 模式下会渲染中性说明", () => {
  const html = markup.renderComposerActionBarMarkup(
    {
      mode: "chat",
      review: {
        enabled: true,
        reason: "",
      },
      steer: {
        enabled: true,
        reason: "",
      },
    },
    utils,
  );

  assert.ok(html.includes("选择一种显式动作模式，或继续普通发送。"));
  assert.ok(!html.includes("退出动作模式"));
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
