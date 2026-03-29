import test from "node:test";
import assert from "node:assert/strict";
import { createActionInteraction } from "./actions-interaction.js";

test("approval action 会在提交后调用 /api/tasks/actions 并清掉等待态", async () => {
  const calls = [];
  const interaction = createActionInteraction({
    submitAction: async (payload) => {
      calls.push(payload);
      return { ok: true };
    },
  });

  const turn = {
    state: "waiting",
    pendingAction: {
      actionId: "approval-1",
      actionType: "approval",
      prompt: "Allow command?",
      choices: ["approve", "deny"],
    },
  };

  await interaction.submitApproval(turn, "approve");
  assert.equal(calls.length, 1);
  assert.equal(turn.pendingAction, null);
  assert.equal(turn.state, "running");
});

test("user-input action 会在提交后调用 /api/tasks/actions 并带上 inputText", async () => {
  const calls = [];
  const interaction = createActionInteraction({
    submitAction: async (payload) => {
      calls.push(payload);
      return { ok: true };
    },
  });

  const turn = {
    state: "waiting",
    pendingAction: {
      actionId: "input-1",
      actionType: "user-input",
      prompt: "Please reply",
    },
  };

  await interaction.submitUserInput(turn, "这里是回复");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    taskId: undefined,
    requestId: undefined,
    actionId: "input-1",
    inputText: "这里是回复",
  });
  assert.equal(turn.pendingAction, null);
  assert.equal(turn.state, "running");
});

test("review action 会带上 mode、sessionId 与 instructions", async () => {
  const calls = [];
  const interaction = createActionInteraction({
    submitAction: async (payload) => {
      calls.push(payload);
      return { ok: true };
    },
  });

  await interaction.submitReview({
    id: "thread-review-1",
  }, "please review current diff");

  assert.deepEqual(calls[0], {
    mode: "review",
    sessionId: "thread-review-1",
    instructions: "please review current diff",
  });
});

test("steer action 会带上 mode、sessionId 与 message", async () => {
  const calls = [];
  const interaction = createActionInteraction({
    submitAction: async (payload) => {
      calls.push(payload);
      return { ok: true };
    },
  });

  await interaction.submitSteer({
    id: "thread-steer-1",
  }, "focus on tests only");

  assert.deepEqual(calls[0], {
    mode: "steer",
    sessionId: "thread-steer-1",
    message: "focus on tests only",
  });
});
