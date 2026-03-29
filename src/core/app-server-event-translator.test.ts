import assert from "node:assert/strict";
import test from "node:test";
import { translateAppServerNotification } from "./app-server-event-translator.js";

test("agent 文本增量会翻译成现有 agent_message 事件元数据", () => {
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
