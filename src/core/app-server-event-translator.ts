import type { TaskEvent } from "../types/index.js";
import type { CodexAppServerNotification } from "./codex-app-server.js";

export function translateAppServerNotification(
  taskId: string,
  requestId: string,
  notification: CodexAppServerNotification,
): TaskEvent | null {
  if (notification.method === "item/agentMessage/delta") {
    const params = (notification.params ?? {}) as Record<string, unknown>;
    const itemText = typeof params.text === "string"
      ? params.text
      : typeof params.delta === "string"
        ? params.delta
        : "";
    const message = itemText || "Codex produced an assistant message.";

    return {
      eventId: `${taskId}-agent-${String(params.itemId ?? "unknown")}`,
      taskId,
      requestId,
      type: "task.progress",
      status: "running",
      message,
      payload: {
        itemType: "agent_message",
        itemId: params.itemId ?? null,
        itemText,
      },
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}
