import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRequest } from "../types/index.js";
import type { CodexCliConfigOverrides } from "./auth-accounts.js";

export const THEMIS_SCHEDULED_TASK_MCP_SERVER_NAME = "themis_scheduled_tasks";
const REPO_THEMIS_LAUNCHER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../themis");
const THEMIS_SCHEDULED_TASK_AUTO_APPROVED_TOOL_NAME_SET = new Set<string>([
  "create_scheduled_task",
]);

export function buildThemisScheduledTaskMcpConfigOverrides(
  workingDirectory: string,
  request: TaskRequest,
): CodexCliConfigOverrides {
  const launcherPath = existsSync(REPO_THEMIS_LAUNCHER_PATH)
    ? REPO_THEMIS_LAUNCHER_PATH
    : resolve(workingDirectory, "themis");

  if (!existsSync(launcherPath)) {
    return {};
  }

  const args = [
    "mcp-server",
    "--channel",
    request.sourceChannel,
    "--user",
    request.user.userId,
  ];
  const displayName = normalizeText(request.user.displayName);
  const sessionId = normalizeText(request.channelContext.sessionId);
  const channelSessionKey = normalizeText(request.channelContext.channelSessionKey);

  if (displayName) {
    args.push("--name", displayName);
  }

  if (sessionId) {
    args.push("--session", sessionId);
  }

  if (channelSessionKey) {
    args.push("--channel-session-key", channelSessionKey);
  }

  return {
    [`mcp_servers.${THEMIS_SCHEDULED_TASK_MCP_SERVER_NAME}`]: {
      command: launcherPath,
      args,
    },
  };
}

export function buildThemisScheduledTaskPromptSection(request: TaskRequest): string {
  const sessionId = normalizeText(request.channelContext.sessionId) ?? "<none>";
  const channelSessionKey = normalizeText(request.channelContext.channelSessionKey) ?? "<none>";
  const displayName = normalizeText(request.user.displayName) ?? "<none>";

  return [
    "Themis scheduled task tools are available in this session.",
    "When the user asks you to create a reminder, scheduled follow-up, future check, or timed recurring-looking task that is actually a one-time run, use the scheduled task tools instead of saying you cannot do it.",
    "Only create one-time scheduled tasks. If the user asks for recurring cron-like automation, explain that one-time scheduling is supported right now and ask whether they want a single scheduled run instead.",
    "If the requested time or timezone is ambiguous, ask one concise follow-up question before creating the task.",
    "Use list_scheduled_tasks when the user asks what is already scheduled.",
    "Use cancel_scheduled_task when the user asks to cancel a previously scheduled task and you know which task it refers to.",
    "After creating a task, confirm the exact scheduledAt timestamp and timezone you used.",
    `Current scheduling context: sourceChannel=${request.sourceChannel}, channelUserId=${request.user.userId}, displayName=${displayName}, sessionId=${sessionId}, channelSessionKey=${channelSessionKey}.`,
    "The MCP server already defaults to this context, so you usually do not need to pass sessionId or channelSessionKey unless you intentionally want a different target session.",
  ].join("\n");
}

export function isThemisScheduledTaskAutoApprovedToolName(value: string | null | undefined): boolean {
  const normalized = normalizeText(value ?? undefined);
  return normalized ? THEMIS_SCHEDULED_TASK_AUTO_APPROVED_TOOL_NAME_SET.has(normalized) : false;
}

function normalizeText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}
