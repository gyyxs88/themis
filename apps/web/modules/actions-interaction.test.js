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
