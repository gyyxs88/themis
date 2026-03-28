import type { TaskActionDescriptor, TaskActionSubmitRequest } from "../types/index.js";

interface PendingActionEntry {
  action: TaskActionDescriptor & { taskId: string; requestId: string };
  submission: Promise<TaskActionSubmitRequest>;
  resolveSubmission: (payload: TaskActionSubmitRequest) => void;
}

export class AppServerActionBridge {
  private readonly pending = new Map<string, PendingActionEntry>();

  register(action: TaskActionDescriptor & { taskId: string; requestId: string }) {
    let resolveSubmission!: (payload: TaskActionSubmitRequest) => void;
    const submission = new Promise<TaskActionSubmitRequest>((resolve) => {
      resolveSubmission = resolve;
    });

    this.pending.set(this.createKey(action.taskId, action.requestId, action.actionId), {
      action,
      submission,
      resolveSubmission,
    });

    return action;
  }

  find(actionId: string) {
    for (const entry of this.pending.values()) {
      if (entry.action.actionId === actionId) {
        return entry.action;
      }
    }

    return null;
  }

  findBySubmission(taskId: string, requestId: string, actionId: string) {
    return this.pending.get(this.createKey(taskId, requestId, actionId))?.action ?? null;
  }

  waitForSubmission(taskId: string, requestId: string, actionId: string) {
    return this.pending.get(this.createKey(taskId, requestId, actionId))?.submission ?? null;
  }

  resolve(payload: TaskActionSubmitRequest) {
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
