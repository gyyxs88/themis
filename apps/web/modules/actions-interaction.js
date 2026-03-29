export function createActionInteraction(options) {
  const submitAction = options.submitAction;

  async function submitApproval(turn, decision) {
    return submitPendingAction(turn, {
      decision,
    });
  }

  async function submitUserInput(turn, inputText) {
    return submitPendingAction(turn, {
      inputText,
    });
  }

  async function submitReview(thread, instructions) {
    await submitAction({
      mode: "review",
      sessionId: thread.id,
      instructions,
    });

    return { ok: true };
  }

  async function submitSteer(thread, message, turnId) {
    await submitAction({
      mode: "steer",
      sessionId: thread.id,
      message,
      ...(typeof turnId === "string" && turnId ? { turnId } : {}),
    });

    return { ok: true };
  }

  async function submitPendingAction(turn, payload) {
    if (!turn?.pendingAction) {
      return { ok: false };
    }

    await submitAction({
      taskId: turn.taskId,
      requestId: turn.requestId,
      actionId: turn.pendingAction.actionId,
      ...payload,
    });

    turn.pendingAction = null;
    turn.state = "running";
    return { ok: true };
  }

  return {
    submitApproval,
    submitReview,
    submitSteer,
    submitUserInput,
  };
}
