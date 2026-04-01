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
  assert.equal(translated?.payload?.threadEventType, "item.completed");
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
