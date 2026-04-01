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

test("AppServerActionBridge 查找同名 actionId 时可以按 scope 限定当前会话", () => {
  const bridge = new AppServerActionBridge();

  bridge.register({
    taskId: "task-other",
    requestId: "req-other",
    actionId: "approval-shared",
    actionType: "approval",
    prompt: "Allow other command?",
    scope: {
      sourceChannel: "feishu",
      sessionId: "session-other",
      principalId: "principal-1",
      userId: "user-1",
    },
  });
  bridge.register({
    taskId: "task-current",
    requestId: "req-current",
    actionId: "approval-shared",
    actionType: "approval",
    prompt: "Allow current command?",
    scope: {
      sourceChannel: "feishu",
      sessionId: "session-current",
      principalId: "principal-1",
      userId: "user-1",
    },
  });

  assert.equal(bridge.find("approval-shared", {
    sourceChannel: "feishu",
    sessionId: "session-current",
    principalId: "principal-1",
    userId: "user-1",
  })?.taskId, "task-current");
  assert.equal(bridge.find("approval-shared", {
    sourceChannel: "feishu",
    sessionId: "session-missing",
    principalId: "principal-1",
    userId: "user-1",
  }), null);
});

test("AppServerActionBridge 会用 principalId 隔离同 session 同 userId 的 waiting action", () => {
  const bridge = new AppServerActionBridge();

  bridge.register({
    taskId: "task-other-principal",
    requestId: "req-other-principal",
    actionId: "approval-shared-principal",
    actionType: "approval",
    prompt: "Allow other principal command?",
    scope: {
      sessionId: "session-current",
      principalId: "principal-other",
      userId: "user-1",
    },
  });
  bridge.register({
    taskId: "task-current-principal",
    requestId: "req-current-principal",
    actionId: "approval-shared-principal",
    actionType: "approval",
    prompt: "Allow current principal command?",
    scope: {
      sessionId: "session-current",
      principalId: "principal-current",
      userId: "user-1",
    },
  });

  assert.equal(bridge.find("approval-shared-principal", {
    sessionId: "session-current",
    principalId: "principal-current",
    userId: "user-1",
  })?.taskId, "task-current-principal");
  assert.equal(bridge.find("approval-shared-principal", {
    sessionId: "session-current",
    principalId: "principal-missing",
    userId: "user-1",
  }), null);
});

test("AppServerActionBridge 支持丢弃未完成的 pending action", () => {
  const bridge = new AppServerActionBridge();

  bridge.register({
    taskId: "task-drop",
    requestId: "req-drop",
    actionId: "approval-drop",
    actionType: "approval",
    prompt: "Allow command?",
  });

  bridge.discard("task-drop", "req-drop", "approval-drop");
  assert.equal(bridge.find("approval-drop"), null);
});
