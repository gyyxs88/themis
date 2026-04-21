import type { TaskEvent } from "../types/index.js";
import type {
  AppServerReverseRequest,
  CodexAppServerNotification,
} from "./codex-app-server.js";
import type { ToolTraceEntryPhase } from "./tool-trace-timeline.js";

interface AppServerEventTranslationOptions {
  agentMessageTextByItemId?: Map<string, string>;
}

export interface AppServerToolTraceSignal {
  opId: string;
  toolKind: string;
  label: string;
  phase: ToolTraceEntryPhase;
  summary: string | null;
}

export function translateAppServerNotification(
  taskId: string,
  requestId: string,
  notification: CodexAppServerNotification,
  options: AppServerEventTranslationOptions = {},
): TaskEvent | null {
  if (notification.method === "item/agentMessage/delta") {
    const params = asRecord(notification.params);
    const itemId = normalizeText(params?.itemId);
    const rawItemText = normalizeText(params?.text)
      ?? normalizeText(params?.delta)
      ?? "";
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
        threadEventType: "item.delta",
        itemType: "agent_message",
        itemId,
        itemText,
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (notification.method === "item/completed") {
    const params = asRecord(notification.params);
    const item = asRecord(params?.item);

    if (!item || normalizeText(item.type) !== "agentMessage") {
      return null;
    }

    const itemText = normalizeText(item.text);

    if (!itemText) {
      return null;
    }

    const itemPhase = normalizeText(item.phase) ?? "commentary";

    if (itemPhase === "final_answer") {
      return null;
    }

    return {
      eventId: `${taskId}-agent-${String(normalizeText(item.id) ?? "unknown")}`,
      taskId,
      requestId,
      type: "task.progress",
      status: "running",
      message: itemText,
      payload: {
        threadEventType: "item.completed",
        itemType: "agent_message",
        itemId: normalizeText(item.id),
        itemPhase,
        itemText,
      },
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

export function translateAppServerToolSignal(
  signal: CodexAppServerNotification | AppServerReverseRequest,
): AppServerToolTraceSignal | null {
  const params = asRecord(signal.params);

  switch (signal.method) {
    case "item/commandExecution/requestApproval":
      return {
        opId: pickToolTraceOpId(params?.itemId, params?.approvalId, readSignalId(signal)),
        toolKind: "command_execution",
        label: normalizeText(params?.command) ?? "命令执行",
        phase: "waiting_approval",
        summary: normalizeText(params?.reason),
      };
    case "item/fileChange/requestApproval":
      return {
        opId: pickToolTraceOpId(params?.itemId, params?.approvalId, readSignalId(signal)),
        toolKind: "file_change",
        label: normalizeText(params?.path) ?? normalizeText(params?.reason) ?? "文件变更",
        phase: "waiting_approval",
        summary: normalizeText(params?.reason),
      };
    case "item/permissions/requestApproval":
      return {
        opId: pickToolTraceOpId(params?.itemId, params?.approvalId, readSignalId(signal)),
        toolKind: "permissions",
        label: normalizeText(params?.reason) ?? "权限扩展",
        phase: "waiting_approval",
        summary: normalizeText(params?.reason),
      };
    case "item/tool/requestApproval": {
      const toolName = normalizeText(params?.toolName) ?? normalizeText(params?.name);
      return {
        opId: pickToolTraceOpId(params?.callId, params?.itemId, params?.approvalId, readSignalId(signal)),
        toolKind: toolName && looksLikeMcpTool(toolName) ? "mcp" : "tool",
        label: toolName ?? "工具调用",
        phase: "waiting_approval",
        summary: normalizeText(params?.reason),
      };
    }
    case "item/tool/requestUserInput":
      return {
        opId: pickToolTraceOpId(params?.callId, params?.itemId, readSignalId(signal)),
        toolKind: "user_input",
        label: normalizeText(params?.toolName) ?? normalizeText(params?.name) ?? "工具输入",
        phase: "waiting_input",
        summary: normalizeText(params?.prompt) ?? firstQuestionPrompt(params),
      };
    case "mcpServer/elicitation/request":
      return {
        opId: pickToolTraceOpId(params?.callId, params?.itemId, readSignalId(signal)),
        toolKind: "mcp",
        label: extractToolNameFromElicitation(params) ?? "MCP 工具调用",
        phase: "waiting_approval",
        summary: normalizeText(params?.message),
      };
    case "execCommandApproval":
      return {
        opId: pickToolTraceOpId(params?.callId, params?.approvalId, readSignalId(signal)),
        toolKind: "exec_command",
        label: normalizeCommandArray(params?.command) ?? normalizeText(params?.reason) ?? "命令执行",
        phase: "waiting_approval",
        summary: normalizeText(params?.reason),
      };
    case "applyPatchApproval":
      return {
        opId: pickToolTraceOpId(params?.callId, readSignalId(signal)),
        toolKind: "apply_patch",
        label: normalizeText(params?.reason) ?? "补丁应用",
        phase: "waiting_approval",
        summary: normalizeText(params?.reason),
      };
    case "item/tool/call":
      return {
        opId: pickToolTraceOpId(params?.callId, readSignalId(signal)),
        toolKind: looksLikeMcpTool(normalizeText(params?.tool)) ? "mcp" : "tool",
        label: normalizeText(params?.tool) ?? "工具调用",
        phase: "started",
        summary: null,
      };
    case "item/started":
    case "item/completed":
      return translateItemToolSignal(signal.method, params?.item);
    default:
      return null;
  }
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

function translateItemToolSignal(
  method: "item/started" | "item/completed",
  rawItem: unknown,
): AppServerToolTraceSignal | null {
  const item = asRecord(rawItem);
  const itemType = normalizeText(item?.type);

  if (!item || !itemType) {
    return null;
  }

  switch (itemType) {
    case "commandExecution":
      return buildLifecycleToolSignal({
        method,
        item,
        toolKind: "command_execution",
        label: normalizeText(item.command) ?? "命令执行",
        status: normalizeText(item.status),
      });
    case "fileChange":
      return buildLifecycleToolSignal({
        method,
        item,
        toolKind: "file_change",
        label: firstFileChangePath(item) ?? "文件变更",
        status: normalizeText(item.status),
      });
    case "mcpToolCall":
      return buildLifecycleToolSignal({
        method,
        item,
        toolKind: "mcp",
        label: buildMcpToolLabel(item),
        status: normalizeText(item.status),
      });
    case "dynamicToolCall":
      return buildLifecycleToolSignal({
        method,
        item,
        toolKind: looksLikeMcpTool(normalizeText(item.tool)) ? "mcp" : "tool",
        label: normalizeText(item.tool) ?? "工具调用",
        status: normalizeText(item.status),
      });
    default:
      return null;
  }
}

function buildLifecycleToolSignal(input: {
  method: "item/started" | "item/completed";
  item: Record<string, unknown>;
  toolKind: string;
  label: string;
  status: string | null;
}): AppServerToolTraceSignal | null {
  const opId = normalizeText(input.item.id);
  const phase = resolveLifecyclePhase(input.method, input.status);

  if (!opId || !phase) {
    return null;
  }

  return {
    opId,
    toolKind: input.toolKind,
    label: input.label,
    phase,
    summary: null,
  };
}

function resolveLifecyclePhase(
  method: "item/started" | "item/completed",
  status: string | null,
): ToolTraceEntryPhase | null {
  if (method === "item/started") {
    return "started";
  }

  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "declined":
      return "interrupted";
    case "inProgress":
      return "started";
    default:
      return null;
  }
}

function firstFileChangePath(item: Record<string, unknown>): string | null {
  if (!Array.isArray(item.changes)) {
    return null;
  }

  for (const entry of item.changes) {
    const change = asRecord(entry);
    const path = normalizeText(change?.path);

    if (path) {
      return path;
    }
  }

  return null;
}

function buildMcpToolLabel(item: Record<string, unknown>): string {
  const server = normalizeText(item.server);
  const tool = normalizeText(item.tool);

  return [server, tool].filter((value): value is string => Boolean(value)).join(".") || "MCP 工具调用";
}

function pickToolTraceOpId(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return "tool-trace";
}

function looksLikeMcpTool(value: string | null): boolean {
  return Boolean(value && (value.includes(".") || value.startsWith("mcp_")));
}

function extractToolNameFromElicitation(params: Record<string, unknown> | null): string | null {
  const toolName = normalizeText(params?._meta && asRecord(params._meta)?.tool_name)
    ?? normalizeText(params?.toolName)
    ?? normalizeText(params?.tool);

  if (toolName) {
    return toolName;
  }

  const message = normalizeText(params?.message);

  if (!message) {
    return null;
  }

  const matched = message.match(/tool\s+"([^"]+)"/i);
  return matched?.[1]?.trim() || null;
}

function firstQuestionPrompt(params: Record<string, unknown> | null): string | null {
  if (!Array.isArray(params?.questions)) {
    return null;
  }

  for (const question of params.questions) {
    const entry = asRecord(question);
    const prompt = normalizeText(entry?.question) ?? normalizeText(entry?.header);

    if (prompt) {
      return prompt;
    }
  }

  return null;
}

function normalizeCommandArray(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return parts.length ? parts.join(" ") : null;
}

function readSignalId(signal: CodexAppServerNotification | AppServerReverseRequest): string | number | undefined {
  return "id" in signal ? signal.id : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}
