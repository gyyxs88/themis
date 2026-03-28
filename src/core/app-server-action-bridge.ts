import type { TaskActionDescriptor } from "../types/index.js";

export class AppServerActionBridge {
  private readonly pending = new Map<
    string,
    TaskActionDescriptor & { taskId: string; requestId: string }
  >();

  register(action: TaskActionDescriptor & { taskId: string; requestId: string }) {
    this.pending.set(action.actionId, action);
    return action;
  }

  find(actionId: string) {
    return this.pending.get(actionId) ?? null;
  }

  resolve(actionId: string, _payload: Record<string, unknown>) {
    this.pending.delete(actionId);
  }
}
