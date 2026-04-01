import type { TaskEvent } from "../types/index.js";
import type { CodexAppServerNotification } from "./codex-app-server.js";

interface AppServerEventTranslationOptions {
  agentMessageTextByItemId?: Map<string, string>;
}

export function translateAppServerNotification(
  taskId: string,
  requestId: string,
  notification: CodexAppServerNotification,
  options: AppServerEventTranslationOptions = {},
): TaskEvent | null {
  if (notification.method === "item/agentMessage/delta") {
    const params = (notification.params ?? {}) as Record<string, unknown>;
    const itemId = typeof params.itemId === "string" && params.itemId.trim()
      ? params.itemId.trim()
      : null;
    const rawItemText = typeof params.text === "string"
      ? params.text
      : typeof params.delta === "string"
        ? params.delta
        : "";
    const itemText = accumulateAgentMessageText(
      itemId,
      rawItemText,
      options.agentMessageTextByItemId,
    );
    const message = itemText || "Codex produced an assistant message.";

    return {
      eventId: `${taskId}-agent-${String(itemId ?? "unknown")}`,
      taskId,
      requestId,
      type: "task.progress",
      status: "running",
      message,
      payload: {
        threadEventType: "item.completed",
        itemType: "agent_message",
        itemId,
        itemText,
      },
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

function accumulateAgentMessageText(
  itemId: string | null,
  nextChunk: string,
  cache?: Map<string, string>,
): string {
  if (!cache || !itemId) {
    return nextChunk;
  }

  const previous = cache.get(itemId) ?? "";

  if (!nextChunk) {
    return previous;
  }

  const accumulated = previous && nextChunk.startsWith(previous)
    ? nextChunk
    : previous === nextChunk
      ? previous
      : `${previous}${nextChunk}`;

  cache.set(itemId, accumulated);
  return accumulated;
}
