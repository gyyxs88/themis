import type { TaskRequest } from "../types/index.js";

export const THEMIS_MANAGED_AGENT_TOOL_NAMES = [
  "list_managed_agents",
  "get_managed_agent_detail",
  "create_managed_agent",
  "update_managed_agent_card",
  "update_managed_agent_execution_boundary",
  "dispatch_work_item",
  "update_managed_agent_lifecycle",
] as const;

const THEMIS_MANAGED_AGENT_TOOL_NAME_SET = new Set<string>(THEMIS_MANAGED_AGENT_TOOL_NAMES);

export function buildThemisManagedAgentPromptSection(request: TaskRequest): string {
  const sessionId = normalizeText(request.channelContext.sessionId) ?? "<none>";
  const channelSessionKey = normalizeText(request.channelContext.channelSessionKey) ?? "<none>";
  const displayName = normalizeText(request.user.displayName) ?? "<none>";

  return [
    "Themis managed agent tools are available in this session.",
    "Use these tools when the user asks you to create digital employees, inspect managed agents, update employee dossiers, update execution boundaries, dispatch work, or pause, resume, and archive managed agents.",
    "These tools operate on Themis managed_agent entities, not the lighter actor memory model.",
    "If the user intent is clear, you should execute create_managed_agent, update_managed_agent_card, update_managed_agent_execution_boundary, dispatch_work_item, and update_managed_agent_lifecycle directly without asking for an extra confirmation.",
    "Ask one concise follow-up question only when a required field is actually missing or ambiguous, such as which managed agent to target or what concrete goal should be dispatched.",
    "Use list_managed_agents to inspect the current managed workforce.",
    "Use get_managed_agent_detail before changing an existing managed agent when you need to inspect its current dossier, workspace, or runtime boundary.",
    "After changing a managed agent or dispatching work, confirm the exact agent and boundary or work item you used.",
    "When inspecting managed-agent completion data, treat detailLevel=metadata_only as a legacy or limited-format result boundary unless newer evidence proves a current regression.",
    "If you inspect raw platform JSON instead of gateway-normalized detailLevel, apply the same rule when a completion only shows execution metadata such as reportFile/workspacePath/runtimeContext and lacks deliverable plus artifactContents.",
    `Current managed-agent context: sourceChannel=${request.sourceChannel}, channelUserId=${request.user.userId}, displayName=${displayName}, sessionId=${sessionId}, channelSessionKey=${channelSessionKey}.`,
  ].join("\n");
}

export function isThemisManagedAgentToolName(value: string | null | undefined): boolean {
  const normalized = normalizeText(value ?? undefined);
  return normalized ? THEMIS_MANAGED_AGENT_TOOL_NAME_SET.has(normalized) : false;
}

function normalizeText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}
