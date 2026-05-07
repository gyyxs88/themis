import type { TaskRequest } from "../types/index.js";

export const THEMIS_MANAGED_AGENT_TOOL_NAMES = [
  "list_managed_agents",
  "get_managed_agent_detail",
  "get_work_item_detail",
  "create_managed_agent",
  "update_managed_agent_card",
  "update_managed_agent_execution_boundary",
  "dispatch_work_item",
  "manage_themis_secret",
  "provision_worker_secret",
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
    "Use get_work_item_detail to inspect a dispatched work item, its current status, runs, completion detail, messages, and parent/child collaboration summary. Do this before claiming a digital employee is blocked, still queued, running, completed, or failed.",
    "After changing a managed agent or dispatching work, confirm the exact agent and boundary or work item you used, then use get_work_item_detail when the user asks about that work item's progress.",
    "Managed-agent workspacePolicy.workspacePath is the employee's durable worker/business workspace boundary, not the current Themis conversation cwd.",
    "Do not set a managed agent workspace to the Themis service/source directory just because this session is running there; use an explicit project or worker-accessible workspace, or leave the workspace unchanged and report the ambiguity.",
    "When workspace semantics or work-item failures matter, distinguish dossier workspacePolicy from the actual worker executionContract.workspacePath and inspect work-item/run detail when available.",
    "When dispatching a read-only work item, or a task whose goal says not to write/modify/delete files, pass runtimeProfileSnapshot.sandboxMode=\"read-only\" and contextPacket.safety=\"read_only_only_no_writes\" instead of relying on prose alone.",
    "For recurring inspections that need external facts, prefer dispatch_work_item.readOnlyFactSourcePacks instead of hand-writing loose instructions. Supported packs are cloudflare_readonly, operations_ledger_readonly, and feishu_base_readonly; Themis will attach read-only fact-source context, safety markers, and required secretEnvRefs.",
    "When a worker needs a secret such as an API token, never put the token in chat text, goal, contextPacket, or work-item正文. Pass runtimeProfileSnapshot.secretEnvRefs with envName/secretRef/required only; the worker resolves the secret locally and injects it as an environment variable.",
    "Use manage_themis_secret as Themis' private password book: list/get/set/rename/remove secretRefs based on the user's natural-language intent. Do not ask the user to use slash commands for normal secret management.",
    "manage_themis_secret never returns secret values; it only returns secretRef metadata and existence status. When a secret must be used by a worker or external platform, call the relevant broker/provisioner or pass secretEnvRefs, not raw values.",
    "Use stable secretRef names such as cloudflare-readonly-token or discord-novelbike-bot-token instead of reusing envName as the secretRef; for Cloudflare API access, use envName=CLOUDFLARE_API_TOKEN and secretRef=cloudflare-readonly-token.",
    "For Feishu Base/Open Platform read-only access, use envName=FEISHU_APP_ID secretRef=feishu-app-id and envName=FEISHU_APP_SECRET secretRef=feishu-app-secret. If missing, ask the user to hand those two credentials to Themis in Feishu p2p natural-language secret intake; do not run lark-cli config init inside the chat task.",
    "Use provision_worker_secret as the generic worker credential delivery tool: for any existing Themis password-book secretRef, call it with mode=themis_secret, sourceSecretRef=<themis secretRef>, secretRef=<worker secretRef>, and targetNodeIds when a specific node needs the secret.",
    "If a Cloudflare worker task reports WORKER_NODE_SECRET_UNAVAILABLE for cloudflare-readonly-token, inspect the failed run nodeId and first call provision_worker_secret with mode=cloudflare_readonly, the relevant domains, and targetNodeIds=[that nodeId]; Themis will use its local Cloudflare management token plus cloudflare-account-id when needed to create or inject the worker token and ask the platform to deliver it to that worker node.",
    "Only if provision_worker_secret reports that Themis-side credentials are unavailable, tell the user which Themis password-book secretRef or environment variable is missing; do not ask for a worker token unless the user explicitly chooses the /secrets worker fallback.",
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
