import type { TaskRequest } from "../types/index.js";

export const THEMIS_MANAGED_AGENT_TOOL_NAMES = [
  "list_managed_agents",
  "get_managed_agent_detail",
  "create_managed_agent",
  "update_managed_agent_card",
  "update_managed_agent_execution_boundary",
  "dispatch_work_item",
  "manage_themis_secret",
  "provision_cloudflare_worker_secret",
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
    "Managed-agent workspacePolicy.workspacePath is the employee's durable worker/business workspace boundary, not the current Themis conversation cwd.",
    "Do not set a managed agent workspace to the Themis service/source directory just because this session is running there; use an explicit project or worker-accessible workspace, or leave the workspace unchanged and report the ambiguity.",
    "When workspace semantics or work-item failures matter, distinguish dossier workspacePolicy from the actual worker executionContract.workspacePath and inspect work-item/run detail when available.",
    "When dispatching a read-only work item, or a task whose goal says not to write/modify/delete files, pass runtimeProfileSnapshot.sandboxMode=\"read-only\" and contextPacket.safety=\"read_only_only_no_writes\" instead of relying on prose alone.",
    "When a worker needs a secret such as an API token, never put the token in chat text, goal, contextPacket, or work-item正文. Pass runtimeProfileSnapshot.secretEnvRefs with envName/secretRef/required only; the worker resolves the secret locally and injects it as an environment variable.",
    "Use manage_themis_secret as Themis' private password book: list/get/set/rename/remove secretRefs based on the user's natural-language intent. Do not ask the user to use slash commands for normal secret management.",
    "manage_themis_secret never returns secret values; it only returns secretRef metadata and existence status. When a secret must be used by a worker or external platform, call the relevant broker/provisioner or pass secretEnvRefs, not raw values.",
    "Use stable secretRef names such as cloudflare-readonly-token instead of reusing envName as the secretRef; for Cloudflare API access, use envName=CLOUDFLARE_API_TOKEN and secretRef=cloudflare-readonly-token.",
    "If a Cloudflare worker task reports WORKER_NODE_SECRET_UNAVAILABLE for cloudflare-readonly-token, first call provision_cloudflare_worker_secret with the relevant domains; Themis will use its local Cloudflare management token to create or inject the worker token and write only the worker secret store.",
    "Only if provision_cloudflare_worker_secret reports that the Themis-side management token is unavailable, tell the user that Themis needs cloudflare-management-token in its password book or THEMIS_CLOUDFLARE_MANAGEMENT_TOKEN; do not ask for a worker token unless the user explicitly chooses the /secrets worker fallback.",
    "When dispatching public DNS/HTTP/domain/IP investigation, keep the work item narrowly framed as owner-authorized public observation; if Codex or the worker reports a cybersecurity safety block, report that exact block instead of treating it as a generic worker failure.",
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
