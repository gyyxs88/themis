import assert from "node:assert/strict";
import test from "node:test";
import {
  translateAppServerNotification,
  translateAppServerToolSignal,
} from "./app-server-event-translator.js";

test("agent 文本增量会翻译成累计快照，而不是伪装成 completed", () => {
  const translated = translateAppServerNotification("task-1", "req-1", {
    method: "item/agentMessage/delta",
    params: {
      itemId: "item-1",
      delta: "hello",
      text: "hello",
    },
  });

  assert.equal(translated?.type, "task.progress");
  assert.equal(translated?.status, "running");
  assert.equal(translated?.payload?.itemType, "agent_message");
  assert.equal(translated?.payload?.itemId, "item-1");
  assert.equal(translated?.payload?.threadEventType, "item.delta");
});

test("同一 itemId 的多次 delta 在提供缓存时会累计成完整文本", () => {
  const cache = new Map<string, string>();
  const first = translateAppServerNotification("task-1", "req-1", {
    method: "item/agentMessage/delta",
    params: {
      itemId: "item-accumulate-1",
      delta: "你",
    },
  }, {
    agentMessageTextByItemId: cache,
  });
  const second = translateAppServerNotification("task-1", "req-1", {
    method: "item/agentMessage/delta",
    params: {
      itemId: "item-accumulate-1",
      delta: "好",
    },
  }, {
    agentMessageTextByItemId: cache,
  });

  assert.equal(first?.message, "你");
  assert.equal(first?.payload?.itemText, "你");
  assert.equal(second?.message, "你好");
  assert.equal(second?.payload?.itemText, "你好");
  assert.equal(second?.payload?.threadEventType, "item.delta");
});

test("commentary agentMessage completed 会翻译成完整正文 progress", () => {
  const translated = translateAppServerNotification("task-1", "req-1", {
    method: "item/completed",
    params: {
      item: {
        type: "agentMessage",
        id: "msg-commentary-1",
        text: "先检查上下文。",
        phase: "commentary",
      },
    },
  });

  assert.equal(translated?.type, "task.progress");
  assert.equal(translated?.status, "running");
  assert.equal(translated?.message, "先检查上下文。");
  assert.equal(translated?.payload?.itemType, "agent_message");
  assert.equal(translated?.payload?.itemId, "msg-commentary-1");
  assert.equal(translated?.payload?.threadEventType, "item.completed");
  assert.equal(translated?.payload?.itemPhase, "commentary");
  assert.equal(translated?.payload?.itemText, "先检查上下文。");
});

test("command execution 审批请求会翻译成等待审批的 tool trace 输入", () => {
  const translated = translateAppServerToolSignal({
    id: "server-command-approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      itemId: "item-command-1",
      approvalId: "approval-command-1",
      command: "npm run build",
      reason: "Need approval before running command.",
    },
  });

  assert.deepEqual(translated, {
    opId: "item-command-1",
    toolKind: "command_execution",
    label: "npm run build",
    phase: "waiting_approval",
    summary: "Need approval before running command.",
  });
});

test("item/started 里的 commandExecution 会翻译成 started 的 tool trace 输入", () => {
  const translated = translateAppServerToolSignal({
    method: "item/started",
    params: {
      threadId: "thread-tool-1",
      turnId: "turn-tool-1",
      item: {
        type: "commandExecution",
        id: "item-command-2",
        command: "npm run build",
        cwd: "/workspace/demo",
        processId: null,
        source: "agent",
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null,
      },
    },
  });

  assert.deepEqual(translated, {
    opId: "item-command-2",
    toolKind: "command_execution",
    label: "npm run build",
    phase: "started",
    summary: null,
  });
});

test("final_answer agentMessage completed 不会再额外翻译成 progress", () => {
  const translated = translateAppServerNotification("task-1", "req-1", {
    method: "item/completed",
    params: {
      item: {
        type: "agentMessage",
        id: "msg-final-1",
        text: "这里是最终回答。",
        phase: "final_answer",
      },
    },
  });

  assert.equal(translated, null);
});

test("未知通知会返回 null", () => {
  const translated = translateAppServerNotification("task-1", "req-1", {
    method: "thread/started",
    params: {
      threadId: "thread-1",
    },
  });

  assert.equal(translated, null);
});

test("缺少 text 时会回退到 delta", () => {
  const translated = translateAppServerNotification("task-1", "req-1", {
    method: "item/agentMessage/delta",
    params: {
      itemId: "item-2",
      delta: "delta-only",
    },
  });

  assert.equal(translated?.message, "delta-only");
  assert.equal(translated?.payload?.itemText, "delta-only");
});

test("缺少 text 和 delta 时会使用默认消息", () => {
  const translated = translateAppServerNotification("task-1", "req-1", {
    method: "item/agentMessage/delta",
    params: {
      itemId: "item-3",
    },
  });

  assert.equal(translated?.message, "Codex produced an assistant message.");
  assert.equal(translated?.payload?.itemText, "");
});
