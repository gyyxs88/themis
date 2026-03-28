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
