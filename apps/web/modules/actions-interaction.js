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
    submitUserInput,
  };
}
