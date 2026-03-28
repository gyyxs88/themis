export function createActionInteraction(options) {
  const submitAction = options.submitAction;

  async function submitApproval(turn, decision) {
    if (!turn?.pendingAction) {
      return { ok: false };
    }

    await submitAction({
      taskId: turn.taskId,
      requestId: turn.requestId,
      actionId: turn.pendingAction.actionId,
      decision,
    });

    turn.pendingAction = null;
    turn.state = "running";
    return { ok: true };
  }

  return {
    submitApproval,
  };
}
