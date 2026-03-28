import assert from "node:assert/strict";
import test from "node:test";
import { AppServerActionBridge } from "./app-server-action-bridge.js";

test("AppServerActionBridge 会登记等待中的 approval action 并在提交后清理", async () => {
  const bridge = new AppServerActionBridge();

  const action = bridge.register({
    taskId: "task-1",
    requestId: "req-1",
    actionId: "approval-1",
    actionType: "approval",
    prompt: "Allow command?",
    choices: ["approve", "deny"],
  });

  assert.equal(action.actionType, "approval");
  assert.equal(bridge.find("approval-1")?.taskId, "task-1");

  bridge.resolve("approval-1", { decision: "approve" });
  assert.equal(bridge.find("approval-1"), null);
});
