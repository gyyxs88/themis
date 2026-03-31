import type {
  TaskActionDescriptor,
  TaskActionScope,
  TaskPendingActionSubmitRequest,
} from "../types/index.js";

interface PendingActionEntry {
  action: TaskActionDescriptor & { taskId: string; requestId: string };
  submission: Promise<TaskPendingActionSubmitRequest>;
  resolveSubmission: (payload: TaskPendingActionSubmitRequest) => void;
}

export class AppServerActionBridge {
  private readonly pending = new Map<string, PendingActionEntry>();

  register(action: TaskActionDescriptor & { taskId: string; requestId: string }) {
    let resolveSubmission!: (payload: TaskPendingActionSubmitRequest) => void;
    const submission = new Promise<TaskPendingActionSubmitRequest>((resolve) => {
      resolveSubmission = resolve;
    });

    this.pending.set(this.createKey(action.taskId, action.requestId, action.actionId), {
      action,
      submission,
      resolveSubmission,
    });

    return action;
  }

  find(actionId: string, scope?: TaskActionScope) {
    for (const entry of this.pending.values()) {
      if (entry.action.actionId === actionId && matchesScope(entry.action.scope, scope)) {
        return entry.action;
      }
    }

    return null;
  }

  list(scope?: TaskActionScope) {
    return [...this.pending.values()]
      .map((entry) => entry.action)
      .filter((action) => matchesScope(action.scope, scope));
  }

  findBySubmission(taskId: string, requestId: string, actionId: string) {
    return this.pending.get(this.createKey(taskId, requestId, actionId))?.action ?? null;
  }

  waitForSubmission(taskId: string, requestId: string, actionId: string) {
    return this.pending.get(this.createKey(taskId, requestId, actionId))?.submission ?? null;
  }

  discard(taskId: string, requestId: string, actionId: string) {
    return this.pending.delete(this.createKey(taskId, requestId, actionId));
  }

  resolve(payload: TaskPendingActionSubmitRequest) {
    const key = this.createKey(payload.taskId, payload.requestId, payload.actionId);
    const entry = this.pending.get(key);

    if (!entry) {
      return false;
    }

    this.pending.delete(key);
    entry.resolveSubmission(payload);
    return true;
  }

  private createKey(taskId: string, requestId: string, actionId: string): string {
    return `${taskId}\u0000${requestId}\u0000${actionId}`;
  }
}

function matchesScope(actionScope: TaskActionScope | undefined, expectedScope: TaskActionScope | undefined): boolean {
  if (!expectedScope) {
    return true;
  }

  if (expectedScope.sourceChannel && actionScope?.sourceChannel !== expectedScope.sourceChannel) {
    return false;
  }

  if (expectedScope.sessionId && actionScope?.sessionId !== expectedScope.sessionId) {
    return false;
  }

  if (expectedScope.principalId && actionScope?.principalId !== expectedScope.principalId) {
    return false;
  }

  if (expectedScope.userId && actionScope?.userId !== expectedScope.userId) {
    return false;
  }

  return true;
}
