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

  bridge.resolve({
    taskId: "task-1",
    requestId: "req-1",
    actionId: "approval-1",
    decision: "approve",
  });
  assert.equal(bridge.find("approval-1"), null);
});

test("AppServerActionBridge 会在 resolve 后把提交 payload 回填给 waitForSubmission", async () => {
  const bridge = new AppServerActionBridge();

  bridge.register({
    taskId: "task-2",
    requestId: "req-2",
    actionId: "approval-2",
    actionType: "approval",
    prompt: "Allow command?",
    choices: ["approve", "deny"],
  });

  const submissionPromise = bridge.waitForSubmission("task-2", "req-2", "approval-2");
  assert.ok(submissionPromise);

  bridge.resolve({
    taskId: "task-2",
    requestId: "req-2",
    actionId: "approval-2",
    decision: "approve",
  });

  assert.deepEqual(await submissionPromise, {
    taskId: "task-2",
    requestId: "req-2",
    actionId: "approval-2",
    decision: "approve",
  });
});
