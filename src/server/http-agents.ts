import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { ManagedAgentExecutionService } from "../core/managed-agent-execution-service.js";
import {
  ManagedAgentPlatformGatewayClient,
  readManagedAgentPlatformGatewayConfig,
} from "../core/managed-agent-platform-gateway-client.js";
import {
  MANAGED_AGENT_IDLE_RECOVERY_ACTIONS,
  MANAGED_AGENT_PRIORITIES,
  MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES,
  type ApprovalPolicy,
  type ManagedAgentIdleRecoveryAction,
  type MemoryMode,
  type ManagedAgentPriority,
  type ManagedAgentWorkItemSourceType,
  type ReasoningLevel,
  type SandboxMode,
  type TaskAccessMode,
  type WebSearchMode,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface AgentCreatePayload extends IdentityPayload {
  agent: {
    displayName?: string;
    departmentRole: string;
    mission?: string;
    organizationId?: string;
    supervisorAgentId?: string;
  };
}

interface AgentDetailPayload extends IdentityPayload {
  agentId: string;
}

interface AgentExecutionBoundaryUpdatePayload extends IdentityPayload {
  agentId: string;
  boundary: {
    workspacePolicy?: {
      displayName?: string;
      workspacePath: string;
      additionalDirectories?: string[];
      allowNetworkAccess?: boolean;
    };
    runtimeProfile?: {
      displayName?: string;
      model?: string;
      reasoning?: ReasoningLevel;
      memoryMode?: MemoryMode;
      sandboxMode?: SandboxMode;
      webSearchMode?: WebSearchMode;
      networkAccessEnabled?: boolean;
      approvalPolicy?: ApprovalPolicy;
      accessMode?: TaskAccessMode;
      authAccountId?: string;
      thirdPartyProviderId?: string;
    };
  };
}

interface AgentSpawnSuggestionsPayload extends IdentityPayload {}

interface AgentIdleRecoverySuggestionsPayload extends IdentityPayload {}

interface AgentSpawnPolicyUpdatePayload extends IdentityPayload {
  policy: {
    organizationId?: string;
    maxActiveAgents: number;
    maxActiveAgentsPerRole: number;
  };
}

interface AgentSpawnApprovePayload extends IdentityPayload {
  agent: {
    departmentRole: string;
    displayName?: string;
    mission?: string;
    organizationId?: string;
    supervisorAgentId?: string;
  };
}

interface AgentSpawnSuggestionActionPayload extends IdentityPayload {
  suggestion: {
    suggestionId: string;
    organizationId: string;
    departmentRole: string;
    displayName: string;
    mission?: string;
    rationale?: string;
    supportingAgentId?: string;
    supportingAgentDisplayName?: string;
    suggestedSupervisorAgentId?: string;
    openWorkItemCount?: number;
    waitingWorkItemCount?: number;
    highPriorityWorkItemCount?: number;
    spawnPolicy?: unknown;
    guardrail?: unknown;
    auditFacts?: unknown;
  };
}

interface AgentSpawnSuggestionRestorePayload extends IdentityPayload {
  suggestion: {
    suggestionId: string;
    organizationId?: string;
  };
}

interface AgentIdleRecoveryApprovePayload extends IdentityPayload {
  suggestion: {
    suggestionId: string;
    organizationId?: string;
    agentId: string;
    action: ManagedAgentIdleRecoveryAction;
  };
}

interface AgentLifecyclePayload extends IdentityPayload {
  agentId: string;
}

interface AgentDispatchPayload extends IdentityPayload {
  workItem: {
    targetAgentId: string;
    projectId?: string;
    sourceType?: ManagedAgentWorkItemSourceType;
    sourceAgentId?: string;
    sourcePrincipalId?: string;
    parentWorkItemId?: string;
    dispatchReason: string;
    goal: string;
    contextPacket?: unknown;
    priority?: ManagedAgentPriority;
    workspacePolicySnapshot?: unknown;
    runtimeProfileSnapshot?: unknown;
    scheduledAt?: string;
  };
}

interface WorkItemListPayload extends IdentityPayload {
  agentId?: string;
}

interface WorkItemDetailPayload extends IdentityPayload {
  workItemId: string;
}

interface WorkItemCancelPayload extends IdentityPayload {
  workItemId: string;
}

interface GovernanceOverviewPayload extends IdentityPayload {
  organizationId?: string;
  managerAgentId?: string;
  attentionOnly?: boolean;
  attentionLevels?: Array<"normal" | "attention" | "urgent">;
  waitingFor?: "any" | "human" | "agent";
  staleOnly?: boolean;
  failedOnly?: boolean;
}

interface WaitingQueueListPayload extends GovernanceOverviewPayload {
  limit?: number;
}

interface CollaborationDashboardPayload extends IdentityPayload {
  organizationId?: string;
  managerAgentId?: string;
  attentionOnly?: boolean;
  attentionLevels?: Array<"normal" | "attention" | "urgent">;
  waitingFor?: "any" | "human" | "agent";
  staleOnly?: boolean;
  failedOnly?: boolean;
  limit?: number;
}

interface WorkItemRespondPayload extends IdentityPayload {
  workItemId: string;
  response: {
    decision?: "approve" | "deny";
    inputText?: string;
    payload?: unknown;
    artifactRefs?: string[];
  };
}

interface WorkItemEscalatePayload extends IdentityPayload {
  workItemId: string;
  escalation?: {
    inputText?: string;
  };
}

interface AgentRunListPayload extends IdentityPayload {
  agentId?: string;
  workItemId?: string;
}

interface AgentRunDetailPayload extends IdentityPayload {
  runId: string;
}

interface AgentHandoffListPayload extends IdentityPayload {
  agentId: string;
  workItemId?: string;
  limit?: number;
}

interface MailboxListPayload extends IdentityPayload {
  agentId: string;
}

interface MailboxPullPayload extends IdentityPayload {
  agentId: string;
}

interface MailboxAckPayload extends IdentityPayload {
  agentId: string;
  mailboxEntryId: string;
}

interface MailboxRespondPayload extends IdentityPayload {
  agentId: string;
  mailboxEntryId: string;
  response: {
    decision?: "approve" | "deny";
    inputText?: string;
    payload?: unknown;
    artifactRefs?: string[];
    priority?: ManagedAgentPriority;
  };
}

export interface ManagedAgentGatewayCompatibilityStatus {
  panelOwnership: "platform";
  accessMode: "platform_gateway" | "local_legacy" | "invalid_gateway_config";
  statusLevel: "warning" | "error";
  message: string;
  platformBaseUrl?: string;
}

async function readAndNormalizePayload<T>(
  request: IncomingMessage,
  response: ServerResponse,
  normalize: (value: unknown) => T,
): Promise<T | null> {
  try {
    return normalize(await readJsonBody(request));
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, false), {
      error: createTaskError(error, false),
    });
    return null;
  }
}

function writeRuntimeError(response: ServerResponse, error: unknown): void {
  writeJson(response, resolveErrorStatusCode(error, true), {
    error: createTaskError(error, true),
  });
}

function writeManagedAgentBoundaryError(response: ServerResponse, error: unknown): void {
  if (
    error instanceof Error
    && (
      error.message === "Managed agent does not exist."
      || error.message === "Organization does not exist."
      || error.message === "Supervisor agent does not exist."
      || error.message === "Work item does not exist."
      || error.message === "Agent run does not exist."
      || error.message === "Mailbox entry does not exist."
      || error.message === "Mailbox entry is already acked."
      || error.message === "Agent message does not exist."
      || error.message === "Mailbox response to approval_request requires decision."
      || error.message === "Mailbox response requires inputText or payload."
      || error.message === "Work item is not waiting for human input."
      || error.message === "Work item is not waiting for agent input."
      || error.message === "Completed or failed work item cannot be cancelled."
      || error.message === "Work item has active runs and cannot be cancelled yet."
      || error.message === "Managed agent is not active."
      || error.message === "Archived managed agent cannot be paused."
      || error.message === "Archived managed agent cannot be resumed."
      || error.message === "maxActiveAgents must be a positive integer."
      || error.message === "maxActiveAgentsPerRole must be a positive integer."
      || error.message === "maxActiveAgentsPerRole cannot exceed maxActiveAgents."
      || error.message === "Human response to approval waiting requires decision."
      || error.message === "Human response requires decision, inputText, payload, or artifactRefs."
      || error.message === "Only agent-sourced work items may set sourceAgentId."
      || error.message === "Source principal id must match the source agent principal."
      || error.message === "Dispatch message target agent must match the work item target."
      || error.message === "当前组织已达到活跃 agent 数量上限。"
      || error.message.endsWith("角色已达到活跃 agent 上限。")
      || error.message === "Suggestion id is required."
      || error.message === "Display name is required."
      || error.message === "Suppressed spawn suggestion does not exist."
      || error.message === "Idle recovery suggestion no longer applies."
      || error.message === "工作区不能为空。"
      || error.message === "只支持服务端本机绝对路径。"
      || error.message === "工作区不存在。"
      || error.message === "工作区不是目录。"
      || error.message === "工作区不可访问。"
      || error.message === "运行配置 accessMode 不合法。"
      || error.message === "Auth account does not exist."
      || error.message === "Third-party provider does not exist."
    )
  ) {
    writeJson(response, 400, {
      error: createTaskError(error, false),
    });
    return;
  }

  writeRuntimeError(response, error);
}

export async function handleAgentCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentCreatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const createInput = {
      ownerPrincipalId: identity.principalId,
      departmentRole: payload.agent.departmentRole,
      ...(payload.agent.displayName ? { displayName: payload.agent.displayName } : {}),
      ...(payload.agent.mission ? { mission: payload.agent.mission } : {}),
      ...(payload.agent.organizationId ? { organizationId: payload.agent.organizationId } : {}),
      ...(payload.agent.supervisorAgentId ? { supervisorAgentId: payload.agent.supervisorAgentId } : {}),
    };
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.createManagedAgent({
        departmentRole: createInput.departmentRole,
        ...(createInput.displayName ? { displayName: createInput.displayName } : {}),
        ...(createInput.mission ? { mission: createInput.mission } : {}),
        ...(createInput.organizationId ? { organizationId: createInput.organizationId } : {}),
        ...(createInput.supervisorAgentId ? { supervisorAgentId: createInput.supervisorAgentId } : {}),
      })
      : runtime.getManagedAgentControlPlaneFacade().createManagedAgent(createInput);

    writeJson(response, 200, {
      ok: true,
      identity,
      organization: result.organization,
      principal: result.principal,
      agent: result.agent,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeIdentityPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const compatibility = readManagedAgentGatewayCompatibilityStatus(process.env);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.listManagedAgents()
      : runtime.getManagedAgentControlPlaneFacade().listManagedAgents(identity.principalId);

    writeJson(response, 200, {
      identity,
      compatibility,
      organizations: result.organizations,
      agents: result.agents,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentDetail(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentDetailPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const detail = gatewayClient
      ? await gatewayClient.getManagedAgentDetail(payload.agentId)
      : runtime.getManagedAgentControlPlaneFacade().getManagedAgentDetailView(
        identity.principalId,
        payload.agentId,
      );

    if (!detail) {
      throw new Error("Managed agent does not exist.");
    }

    writeJson(response, 200, {
      identity,
      organization: detail.organization,
      principal: detail.principal,
      agent: detail.agent,
      workspacePolicy: detail.workspacePolicy,
      runtimeProfile: detail.runtimeProfile,
      authAccounts: detail.authAccounts,
      thirdPartyProviders: detail.thirdPartyProviders,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

function createManagedAgentPlatformGatewayClientFromEnv(): ManagedAgentPlatformGatewayClient | null {
  const config = readManagedAgentPlatformGatewayConfig(process.env);

  if (!config) {
    return null;
  }

  return new ManagedAgentPlatformGatewayClient(config);
}

export function readManagedAgentGatewayCompatibilityStatus(
  env: NodeJS.ProcessEnv = process.env,
): ManagedAgentGatewayCompatibilityStatus {
  try {
    const config = readManagedAgentPlatformGatewayConfig(env);

    if (config) {
      return {
        panelOwnership: "platform",
        accessMode: "platform_gateway",
        statusLevel: "warning",
        message: "当前 Platform Agents 面板只是主 Themis 里的平台兼容入口；实际读写已走平台控制面，后续会迁到独立 Platform 前端。",
        platformBaseUrl: config.baseUrl,
      };
    }
  } catch (error) {
    return {
      panelOwnership: "platform",
      accessMode: "invalid_gateway_config",
      statusLevel: "error",
      message: error instanceof Error
        ? error.message
        : "平台 Gateway 配置异常，当前 Platform Agents 兼容入口不可用。",
    };
  }

  return {
    panelOwnership: "platform",
    accessMode: "local_legacy",
    statusLevel: "warning",
    message: "当前 Platform Agents 面板仍运行在本地 legacy 模式，只用于拆仓迁移过渡；不要继续在主 Themis 页面里扩平台治理功能。",
  };
}

export async function handleAgentExecutionBoundaryUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentExecutionBoundaryUpdatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.updateManagedAgentExecutionBoundary({
        agentId: payload.agentId,
        ...(payload.boundary.workspacePolicy ? { workspacePolicy: payload.boundary.workspacePolicy } : {}),
        ...(payload.boundary.runtimeProfile ? { runtimeProfile: payload.boundary.runtimeProfile } : {}),
      })
      : runtime.getManagedAgentsService().updateManagedAgentExecutionBoundary({
      ownerPrincipalId: identity.principalId,
      agentId: payload.agentId,
      ...(payload.boundary.workspacePolicy ? { workspacePolicy: payload.boundary.workspacePolicy } : {}),
      ...(payload.boundary.runtimeProfile ? { runtimeProfile: payload.boundary.runtimeProfile } : {}),
      });

    writeJson(response, 200, {
      ok: true,
      identity,
      agent: result.agent,
      workspacePolicy: result.workspacePolicy,
      runtimeProfile: result.runtimeProfile,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

async function handleAgentLifecycleUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  action: "pause" | "resume" | "archive",
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentLifecyclePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const ownerView = gatewayClient
      ? await gatewayClient.updateManagedAgentLifecycle({
        agentId: payload.agentId,
        action,
      })
      : runtime.getManagedAgentControlPlaneFacade().updateManagedAgentLifecycle({
        ownerPrincipalId: identity.principalId,
        agentId: payload.agentId,
        action,
      });

    if (!ownerView) {
      throw new Error("Managed agent does not exist.");
    }

    writeJson(response, 200, {
      ok: true,
      identity,
      organization: ownerView?.organization ?? null,
      principal: ownerView?.principal ?? null,
      agent: ownerView.agent,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentSpawnSuggestions(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentSpawnSuggestionsPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.getSpawnSuggestionsView()
      : runtime.getManagedAgentControlPlaneFacade().getSpawnSuggestionsView(identity.principalId);

    writeJson(response, 200, {
      identity,
      spawnPolicies: result.spawnPolicies,
      suggestions: result.suggestions,
      suppressedSuggestions: result.suppressedSuggestions,
      recentAuditLogs: result.recentAuditLogs,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentIdleRecoverySuggestions(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentIdleRecoverySuggestionsPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.getIdleRecoverySuggestionsView()
      : runtime.getManagedAgentControlPlaneFacade().getIdleRecoverySuggestionsView(identity.principalId);

    writeJson(response, 200, {
      identity,
      suggestions: result.suggestions,
      recentAuditLogs: result.recentAuditLogs,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentSpawnPolicyUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentSpawnPolicyUpdatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const policy = gatewayClient
      ? await gatewayClient.updateSpawnPolicy({
        ...(payload.policy.organizationId ? { organizationId: payload.policy.organizationId } : {}),
        maxActiveAgents: payload.policy.maxActiveAgents,
        maxActiveAgentsPerRole: payload.policy.maxActiveAgentsPerRole,
      })
      : runtime.getManagedAgentsService().updateSpawnPolicy({
        ownerPrincipalId: identity.principalId,
        ...(payload.policy.organizationId ? { organizationId: payload.policy.organizationId } : {}),
        maxActiveAgents: payload.policy.maxActiveAgents,
        maxActiveAgentsPerRole: payload.policy.maxActiveAgentsPerRole,
      });

    writeJson(response, 200, {
      ok: true,
      identity,
      policy,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentSpawnApprove(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentSpawnApprovePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.approveSpawnSuggestion({
        departmentRole: payload.agent.departmentRole,
        ...(payload.agent.displayName ? { displayName: payload.agent.displayName } : {}),
        ...(payload.agent.mission ? { mission: payload.agent.mission } : {}),
        ...(payload.agent.organizationId ? { organizationId: payload.agent.organizationId } : {}),
        ...(payload.agent.supervisorAgentId ? { supervisorAgentId: payload.agent.supervisorAgentId } : {}),
      })
      : runtime.getManagedAgentsService().approveSpawnSuggestion({
        ownerPrincipalId: identity.principalId,
        departmentRole: payload.agent.departmentRole,
        ...(payload.agent.displayName ? { displayName: payload.agent.displayName } : {}),
        ...(payload.agent.mission ? { mission: payload.agent.mission } : {}),
        ...(payload.agent.organizationId ? { organizationId: payload.agent.organizationId } : {}),
        ...(payload.agent.supervisorAgentId ? { supervisorAgentId: payload.agent.supervisorAgentId } : {}),
      });

    writeJson(response, 200, {
      ok: true,
      identity,
      organization: result.organization,
      principal: result.principal,
      agent: result.agent,
      bootstrapWorkItem: result.bootstrapWorkItem,
      auditLog: result.auditLog,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

async function handleAgentSpawnSuggestionDecision(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  action: "ignore" | "reject",
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentSpawnSuggestionActionPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? action === "ignore"
        ? await gatewayClient.ignoreSpawnSuggestion(payload.suggestion)
        : await gatewayClient.rejectSpawnSuggestion(payload.suggestion)
      : action === "ignore"
        ? runtime.getManagedAgentsService().ignoreSpawnSuggestion({
          ownerPrincipalId: identity.principalId,
          ...payload.suggestion,
        })
        : runtime.getManagedAgentsService().rejectSpawnSuggestion({
          ownerPrincipalId: identity.principalId,
          ...payload.suggestion,
        });

    writeJson(response, 200, {
      ok: true,
      identity,
      ...(result.suppressedSuggestion ? { suppressedSuggestion: result.suppressedSuggestion } : {}),
      auditLog: result.auditLog,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentSpawnIgnore(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  await handleAgentSpawnSuggestionDecision(request, response, runtime, "ignore");
}

export async function handleAgentSpawnReject(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  await handleAgentSpawnSuggestionDecision(request, response, runtime, "reject");
}

export async function handleAgentSpawnRestore(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentSpawnSuggestionRestorePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const restored = gatewayClient
      ? await gatewayClient.restoreSpawnSuggestion({
        suggestionId: payload.suggestion.suggestionId,
        ...(payload.suggestion.organizationId ? { organizationId: payload.suggestion.organizationId } : {}),
      })
      : {
        auditLog: runtime.getManagedAgentsService().restoreSpawnSuggestion({
          ownerPrincipalId: identity.principalId,
          suggestionId: payload.suggestion.suggestionId,
          ...(payload.suggestion.organizationId ? { organizationId: payload.suggestion.organizationId } : {}),
        }),
      };

    writeJson(response, 200, {
      ok: true,
      identity,
      auditLog: restored.auditLog,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentIdleRecoveryApprove(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentIdleRecoveryApprovePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.approveIdleRecoverySuggestion({
        suggestionId: payload.suggestion.suggestionId,
        ...(payload.suggestion.organizationId ? { organizationId: payload.suggestion.organizationId } : {}),
        agentId: payload.suggestion.agentId,
        action: payload.suggestion.action,
      })
      : runtime.getManagedAgentsService().approveIdleRecoverySuggestion({
        ownerPrincipalId: identity.principalId,
        suggestionId: payload.suggestion.suggestionId,
        ...(payload.suggestion.organizationId ? { organizationId: payload.suggestion.organizationId } : {}),
        agentId: payload.suggestion.agentId,
        action: payload.suggestion.action,
      });
    const principal = runtime.getRuntimeStore().getPrincipal(result.agent.principalId);

    writeJson(response, 200, {
      ok: true,
      identity,
      organization: result.organization,
      ...(principal ? { principal } : {}),
      agent: result.agent,
      auditLog: result.auditLog,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentPause(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  await handleAgentLifecycleUpdate(request, response, runtime, "pause");
}

export async function handleAgentResume(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  await handleAgentLifecycleUpdate(request, response, runtime, "resume");
}

export async function handleAgentArchive(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  await handleAgentLifecycleUpdate(request, response, runtime, "archive");
}

export async function handleAgentDispatch(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentDispatchPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.dispatchWorkItem({
        targetAgentId: payload.workItem.targetAgentId,
        ...(payload.workItem.projectId ? { projectId: payload.workItem.projectId } : {}),
        ...(payload.workItem.sourceType ? { sourceType: payload.workItem.sourceType } : {}),
        ...(payload.workItem.sourceAgentId ? { sourceAgentId: payload.workItem.sourceAgentId } : {}),
        ...(payload.workItem.sourcePrincipalId ? { sourcePrincipalId: payload.workItem.sourcePrincipalId } : {}),
        ...(payload.workItem.parentWorkItemId ? { parentWorkItemId: payload.workItem.parentWorkItemId } : {}),
        dispatchReason: payload.workItem.dispatchReason,
        goal: payload.workItem.goal,
        ...(hasOwn(payload.workItem, "contextPacket") ? { contextPacket: payload.workItem.contextPacket } : {}),
        ...(payload.workItem.priority ? { priority: payload.workItem.priority } : {}),
        ...(hasOwn(payload.workItem, "workspacePolicySnapshot")
          ? { workspacePolicySnapshot: payload.workItem.workspacePolicySnapshot }
          : {}),
        ...(hasOwn(payload.workItem, "runtimeProfileSnapshot")
          ? { runtimeProfileSnapshot: payload.workItem.runtimeProfileSnapshot }
          : {}),
        ...(payload.workItem.scheduledAt ? { scheduledAt: payload.workItem.scheduledAt } : {}),
      })
      : runtime.getManagedAgentControlPlaneFacade().dispatchWorkItem({
        ownerPrincipalId: identity.principalId,
        targetAgentId: payload.workItem.targetAgentId,
        ...(payload.workItem.projectId ? { projectId: payload.workItem.projectId } : {}),
        ...(payload.workItem.sourceType ? { sourceType: payload.workItem.sourceType } : {}),
        ...(payload.workItem.sourceAgentId ? { sourceAgentId: payload.workItem.sourceAgentId } : {}),
        ...(payload.workItem.sourcePrincipalId ? { sourcePrincipalId: payload.workItem.sourcePrincipalId } : {}),
        ...(payload.workItem.parentWorkItemId ? { parentWorkItemId: payload.workItem.parentWorkItemId } : {}),
        dispatchReason: payload.workItem.dispatchReason,
        goal: payload.workItem.goal,
        ...(hasOwn(payload.workItem, "contextPacket") ? { contextPacket: payload.workItem.contextPacket } : {}),
        ...(payload.workItem.priority ? { priority: payload.workItem.priority } : {}),
        ...(hasOwn(payload.workItem, "workspacePolicySnapshot")
          ? { workspacePolicySnapshot: payload.workItem.workspacePolicySnapshot }
          : {}),
        ...(hasOwn(payload.workItem, "runtimeProfileSnapshot")
          ? { runtimeProfileSnapshot: payload.workItem.runtimeProfileSnapshot }
          : {}),
        ...(payload.workItem.scheduledAt ? { scheduledAt: payload.workItem.scheduledAt } : {}),
      });

    writeJson(response, 200, {
      ok: true,
      identity,
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      ...(result.dispatchMessage ? { dispatchMessage: result.dispatchMessage } : {}),
      ...(result.mailboxEntry ? { mailboxEntry: result.mailboxEntry } : {}),
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentWorkItemList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeWorkItemListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const workItems = gatewayClient
      ? await gatewayClient.listWorkItems(payload.agentId)
      : runtime.getManagedAgentControlPlaneFacade().listWorkItems(identity.principalId, payload.agentId);

    writeJson(response, 200, {
      identity,
      workItems,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentWaitingQueueList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeWaitingQueueListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.listOrganizationWaitingQueue({
        ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
        ...(payload.managerAgentId ? { managerAgentId: payload.managerAgentId } : {}),
        ...(payload.attentionOnly !== undefined ? { attentionOnly: payload.attentionOnly } : {}),
        ...(payload.attentionLevels ? { attentionLevels: payload.attentionLevels } : {}),
        ...(payload.waitingFor ? { waitingFor: payload.waitingFor } : {}),
        ...(payload.staleOnly !== undefined ? { staleOnly: payload.staleOnly } : {}),
        ...(payload.failedOnly !== undefined ? { failedOnly: payload.failedOnly } : {}),
        ...(payload.limit ? { limit: payload.limit } : {}),
      })
      : runtime.getManagedAgentControlPlaneFacade().listOrganizationWaitingQueue(identity.principalId, {
        ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
        ...(payload.managerAgentId ? { managerAgentId: payload.managerAgentId } : {}),
        ...(payload.attentionOnly !== undefined ? { attentionOnly: payload.attentionOnly } : {}),
        ...(payload.attentionLevels ? { attentionLevels: payload.attentionLevels } : {}),
        ...(payload.waitingFor ? { waitingFor: payload.waitingFor } : {}),
        ...(payload.staleOnly !== undefined ? { staleOnly: payload.staleOnly } : {}),
        ...(payload.failedOnly !== undefined ? { failedOnly: payload.failedOnly } : {}),
        ...(payload.limit ? { limit: payload.limit } : {}),
      });

    writeJson(response, 200, {
      identity,
      summary: result.summary,
      items: result.items,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentGovernanceOverview(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeGovernanceOverviewPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const overview = gatewayClient
      ? await gatewayClient.getOrganizationGovernanceOverview({
        ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
        ...(payload.managerAgentId ? { managerAgentId: payload.managerAgentId } : {}),
        ...(payload.attentionOnly !== undefined ? { attentionOnly: payload.attentionOnly } : {}),
        ...(payload.attentionLevels ? { attentionLevels: payload.attentionLevels } : {}),
        ...(payload.waitingFor ? { waitingFor: payload.waitingFor } : {}),
        ...(payload.staleOnly !== undefined ? { staleOnly: payload.staleOnly } : {}),
        ...(payload.failedOnly !== undefined ? { failedOnly: payload.failedOnly } : {}),
      })
      : runtime.getManagedAgentControlPlaneFacade().getOrganizationGovernanceOverview(identity.principalId, {
        ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
        ...(payload.managerAgentId ? { managerAgentId: payload.managerAgentId } : {}),
        ...(payload.attentionOnly !== undefined ? { attentionOnly: payload.attentionOnly } : {}),
        ...(payload.attentionLevels ? { attentionLevels: payload.attentionLevels } : {}),
        ...(payload.waitingFor ? { waitingFor: payload.waitingFor } : {}),
        ...(payload.staleOnly !== undefined ? { staleOnly: payload.staleOnly } : {}),
        ...(payload.failedOnly !== undefined ? { failedOnly: payload.failedOnly } : {}),
      });

    writeJson(response, 200, {
      identity,
      overview,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentCollaborationDashboard(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeCollaborationDashboardPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.listOrganizationCollaborationDashboard({
        ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
        ...(payload.managerAgentId ? { managerAgentId: payload.managerAgentId } : {}),
        ...(payload.attentionOnly !== undefined ? { attentionOnly: payload.attentionOnly } : {}),
        ...(payload.attentionLevels ? { attentionLevels: payload.attentionLevels } : {}),
        ...(payload.waitingFor ? { waitingFor: payload.waitingFor } : {}),
        ...(payload.staleOnly !== undefined ? { staleOnly: payload.staleOnly } : {}),
        ...(payload.failedOnly !== undefined ? { failedOnly: payload.failedOnly } : {}),
        ...(payload.limit ? { limit: payload.limit } : {}),
      })
      : runtime.getManagedAgentControlPlaneFacade().listOrganizationCollaborationDashboard(identity.principalId, {
        ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
        ...(payload.managerAgentId ? { managerAgentId: payload.managerAgentId } : {}),
        ...(payload.attentionOnly !== undefined ? { attentionOnly: payload.attentionOnly } : {}),
        ...(payload.attentionLevels ? { attentionLevels: payload.attentionLevels } : {}),
        ...(payload.waitingFor ? { waitingFor: payload.waitingFor } : {}),
        ...(payload.staleOnly !== undefined ? { staleOnly: payload.staleOnly } : {}),
        ...(payload.failedOnly !== undefined ? { failedOnly: payload.failedOnly } : {}),
        ...(payload.limit ? { limit: payload.limit } : {}),
      });

    writeJson(response, 200, {
      identity,
      summary: result.summary,
      items: result.items,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentWorkItemDetail(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeWorkItemDetailPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const detail = gatewayClient
      ? await gatewayClient.getWorkItemDetail(payload.workItemId)
      : runtime.getManagedAgentControlPlaneFacade().getWorkItemDetailView(identity.principalId, payload.workItemId);

    if (!detail) {
      throw new Error("Work item does not exist.");
    }

    writeJson(response, 200, {
      identity,
      organization: detail.organization,
      workItem: detail.workItem,
      targetAgent: detail.targetAgent,
      sourcePrincipal: detail.sourcePrincipal,
      ...(detail.sourceAgent ? { sourceAgent: detail.sourceAgent } : {}),
      parentWorkItem: "collaboration" in detail ? detail.collaboration.parentWorkItem : detail.parentWorkItem,
      parentTargetAgent: "collaboration" in detail
        ? detail.collaboration.parentTargetAgent
        : detail.parentTargetAgent,
      childSummary: "collaboration" in detail ? detail.collaboration.childSummary : detail.childSummary,
      childWorkItems: "collaboration" in detail ? detail.collaboration.childWorkItems : detail.childWorkItems,
      messages: detail.messages,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentWorkItemCancel(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  executionService: ManagedAgentExecutionService,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeWorkItemCancelPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.cancelWorkItem(payload.workItemId)
      : await executionService.cancelWorkItem({
        ownerPrincipalId: identity.principalId,
        workItemId: payload.workItemId,
      });

    writeJson(response, 200, {
      ok: true,
      identity,
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      ackedMailboxEntries: result.ackedMailboxEntries,
      ...(result.notificationMessage ? { notificationMessage: result.notificationMessage } : {}),
      ...(result.notificationMailboxEntry ? { notificationMailboxEntry: result.notificationMailboxEntry } : {}),
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentWorkItemRespond(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeWorkItemRespondPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.respondToHumanWaitingWorkItem({
        workItemId: payload.workItemId,
        ...(payload.response.decision ? { decision: payload.response.decision } : {}),
        ...(payload.response.inputText ? { inputText: payload.response.inputText } : {}),
        ...(hasOwn(payload.response, "payload") ? { payload: payload.response.payload } : {}),
        ...(payload.response.artifactRefs ? { artifactRefs: payload.response.artifactRefs } : {}),
      })
      : runtime.getManagedAgentCoordinationService().respondToHumanWaitingWorkItem({
        ownerPrincipalId: identity.principalId,
        workItemId: payload.workItemId,
        ...(payload.response.decision ? { decision: payload.response.decision } : {}),
        ...(payload.response.inputText ? { inputText: payload.response.inputText } : {}),
        ...(hasOwn(payload.response, "payload") ? { payload: payload.response.payload } : {}),
        ...(payload.response.artifactRefs ? { artifactRefs: payload.response.artifactRefs } : {}),
      });

    writeJson(response, 200, {
      ok: true,
      identity,
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      resumedRuns: result.resumedRuns,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentWorkItemEscalate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeWorkItemEscalatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.escalateWaitingAgentWorkItemToHuman({
        workItemId: payload.workItemId,
        ...(payload.escalation?.inputText ? { inputText: payload.escalation.inputText } : {}),
      })
      : runtime.getManagedAgentCoordinationService().escalateWaitingAgentWorkItemToHuman({
        ownerPrincipalId: identity.principalId,
        workItemId: payload.workItemId,
        ...(payload.escalation?.inputText ? { inputText: payload.escalation.inputText } : {}),
      });

    writeJson(response, 200, {
      ok: true,
      identity,
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      latestWaitingMessage: result.latestWaitingMessage,
      ackedMailboxEntries: result.ackedMailboxEntries,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentRunList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentRunListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const runs = gatewayClient
      ? await gatewayClient.listRuns({
        ...(payload.agentId ? { agentId: payload.agentId } : {}),
        ...(payload.workItemId ? { workItemId: payload.workItemId } : {}),
      })
      : runtime.getManagedAgentControlPlaneFacade().listRuns({
        ownerPrincipalId: identity.principalId,
        ...(payload.agentId ? { agentId: payload.agentId } : {}),
        ...(payload.workItemId ? { workItemId: payload.workItemId } : {}),
      });

    writeJson(response, 200, {
      identity,
      runs,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentRunDetail(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentRunDetailPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const detail = gatewayClient
      ? await gatewayClient.getRunDetail(payload.runId)
      : runtime.getManagedAgentControlPlaneFacade().getRunDetailView(identity.principalId, payload.runId);

    if (!detail) {
      throw new Error("Agent run does not exist.");
    }

    writeJson(response, 200, {
      identity,
      organization: detail.organization,
      run: detail.run,
      workItem: detail.workItem,
      targetAgent: detail.targetAgent,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentHandoffList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeAgentHandoffListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.getAgentHandoffListView({
        agentId: payload.agentId,
        ...(payload.workItemId ? { workItemId: payload.workItemId } : {}),
        ...(payload.limit ? { limit: payload.limit } : {}),
      })
      : runtime.getManagedAgentControlPlaneFacade().getAgentHandoffListView(identity.principalId, {
        agentId: payload.agentId,
        ...(payload.workItemId ? { workItemId: payload.workItemId } : {}),
        ...(payload.limit ? { limit: payload.limit } : {}),
      });

    writeJson(response, 200, {
      identity,
      agent: result.agent,
      handoffs: result.handoffs,
      timeline: result.timeline,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentMailboxList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMailboxListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.getAgentMailboxListView(payload.agentId)
      : runtime.getManagedAgentControlPlaneFacade().getAgentMailboxListView(identity.principalId, payload.agentId);

    writeJson(response, 200, {
      identity,
      agent: result.agent,
      items: result.items,
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentMailboxPull(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMailboxPullPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.pullMailboxEntry(payload.agentId)
      : runtime.getManagedAgentCoordinationService().pullMailboxEntry(identity.principalId, payload.agentId);

    writeJson(response, 200, {
      ok: true,
      identity,
      agent: result.agent,
      ...(result.item ? { item: result.item } : { item: null }),
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentMailboxAck(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMailboxAckPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const ackResult = gatewayClient
      ? await gatewayClient.ackMailboxEntry(payload.agentId, payload.mailboxEntryId)
      : (() => {
        const mailboxEntry = runtime.getManagedAgentCoordinationService().ackMailboxEntry(
          identity.principalId,
          payload.agentId,
          payload.mailboxEntryId,
        );
        const agent = runtime.getRuntimeStore().getManagedAgent(payload.agentId);
        const message = runtime.getRuntimeStore().getAgentMessage(mailboxEntry.messageId);

        return {
          mailboxEntry,
          agent,
          ...(message ? { message } : {}),
        };
      })();

    writeJson(response, 200, {
      ok: true,
      identity,
      agent: ackResult.agent,
      mailboxEntry: ackResult.mailboxEntry,
      ...(ackResult.message ? { message: ackResult.message } : {}),
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

export async function handleAgentMailboxRespond(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeMailboxRespondPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const gatewayClient = createManagedAgentPlatformGatewayClientFromEnv();
    const result = gatewayClient
      ? await gatewayClient.respondToMailboxEntry({
        agentId: payload.agentId,
        mailboxEntryId: payload.mailboxEntryId,
        ...(payload.response.decision ? { decision: payload.response.decision } : {}),
        ...(payload.response.inputText ? { inputText: payload.response.inputText } : {}),
        ...(hasOwn(payload.response, "payload") ? { payload: payload.response.payload } : {}),
        ...(payload.response.artifactRefs ? { artifactRefs: payload.response.artifactRefs } : {}),
        ...(payload.response.priority ? { priority: payload.response.priority } : {}),
      })
      : runtime.getManagedAgentCoordinationService().respondToMailboxEntry({
        ownerPrincipalId: identity.principalId,
        agentId: payload.agentId,
        mailboxEntryId: payload.mailboxEntryId,
        ...(payload.response.decision ? { decision: payload.response.decision } : {}),
        ...(payload.response.inputText ? { inputText: payload.response.inputText } : {}),
        ...(hasOwn(payload.response, "payload") ? { payload: payload.response.payload } : {}),
        ...(payload.response.artifactRefs ? { artifactRefs: payload.response.artifactRefs } : {}),
        ...(payload.response.priority ? { priority: payload.response.priority } : {}),
      });

    writeJson(response, 200, {
      ok: true,
      identity,
      agent: result.agent,
      organization: result.organization,
      sourceMailboxEntry: result.sourceMailboxEntry,
      sourceMessage: result.sourceMessage,
      responseMessage: result.responseMessage,
      responseMailboxEntry: result.responseMailboxEntry,
      resumedRuns: result.resumedRuns,
      ...(result.resumedWorkItem ? { resumedWorkItem: result.resumedWorkItem } : {}),
    });
  } catch (error) {
    writeManagedAgentBoundaryError(response, error);
  }
}

function normalizeIdentityPayload(value: unknown): IdentityPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const channel = readRequiredString(value.channel, "channel");
  const channelUserId = readRequiredString(value.channelUserId, "channelUserId");
  const displayName = readOptionalString(value.displayName);

  return {
    channel,
    channelUserId,
    ...(displayName ? { displayName } : {}),
  };
}

function normalizeAgentCreatePayload(value: unknown): AgentCreatePayload {
  if (!isRecord(value) || !isRecord(value.agent)) {
    throw new Error("Request body.agent must be an object.");
  }

  const displayName = readOptionalString(value.agent.displayName);
  const mission = readOptionalString(value.agent.mission);
  const organizationId = readOptionalString(value.agent.organizationId);
  const supervisorAgentId = readOptionalString(value.agent.supervisorAgentId);

  return {
    ...normalizeIdentityPayload(value),
    agent: {
      ...(displayName ? { displayName } : {}),
      departmentRole: readRequiredString(value.agent.departmentRole, "agent.departmentRole"),
      ...(mission ? { mission } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(supervisorAgentId ? { supervisorAgentId } : {}),
    },
  };
}

function normalizeAgentDetailPayload(value: unknown): AgentDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
  };
}

function normalizeAgentExecutionBoundaryUpdatePayload(value: unknown): AgentExecutionBoundaryUpdatePayload {
  if (!isRecord(value) || !isRecord(value.boundary)) {
    throw new Error("Request body.boundary must be an object.");
  }

  const workspacePolicy = isRecord(value.boundary.workspacePolicy)
    ? {
        ...(readOptionalString(value.boundary.workspacePolicy.displayName)
          ? { displayName: readOptionalString(value.boundary.workspacePolicy.displayName) as string }
          : {}),
        workspacePath: readRequiredString(value.boundary.workspacePolicy.workspacePath, "boundary.workspacePolicy.workspacePath"),
        ...(Array.isArray(value.boundary.workspacePolicy.additionalDirectories)
          ? {
              additionalDirectories: value.boundary.workspacePolicy.additionalDirectories
                .filter((entry): entry is string => typeof entry === "string")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0),
            }
          : {}),
        ...(typeof value.boundary.workspacePolicy.allowNetworkAccess === "boolean"
          ? { allowNetworkAccess: value.boundary.workspacePolicy.allowNetworkAccess }
          : {}),
      }
    : undefined;
  const runtimeProfile = isRecord(value.boundary.runtimeProfile)
    ? {
        ...(readOptionalString(value.boundary.runtimeProfile.displayName)
          ? { displayName: readOptionalString(value.boundary.runtimeProfile.displayName) as string }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.model)
          ? { model: readOptionalString(value.boundary.runtimeProfile.model) as string }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.reasoning)
          ? { reasoning: readOptionalString(value.boundary.runtimeProfile.reasoning) as ReasoningLevel }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.memoryMode)
          ? { memoryMode: readOptionalString(value.boundary.runtimeProfile.memoryMode) as MemoryMode }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.sandboxMode)
          ? { sandboxMode: readOptionalString(value.boundary.runtimeProfile.sandboxMode) as SandboxMode }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.webSearchMode)
          ? { webSearchMode: readOptionalString(value.boundary.runtimeProfile.webSearchMode) as WebSearchMode }
          : {}),
        ...(typeof value.boundary.runtimeProfile.networkAccessEnabled === "boolean"
          ? { networkAccessEnabled: value.boundary.runtimeProfile.networkAccessEnabled }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.approvalPolicy)
          ? { approvalPolicy: readOptionalString(value.boundary.runtimeProfile.approvalPolicy) as ApprovalPolicy }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.accessMode)
          ? { accessMode: readOptionalString(value.boundary.runtimeProfile.accessMode) as TaskAccessMode }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.authAccountId)
          ? { authAccountId: readOptionalString(value.boundary.runtimeProfile.authAccountId) as string }
          : {}),
        ...(readOptionalString(value.boundary.runtimeProfile.thirdPartyProviderId)
          ? { thirdPartyProviderId: readOptionalString(value.boundary.runtimeProfile.thirdPartyProviderId) as string }
          : {}),
      }
    : undefined;

  if (!workspacePolicy && !runtimeProfile) {
    throw new Error("Request body.boundary must contain workspacePolicy or runtimeProfile.");
  }

  return {
    ...normalizeIdentityPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
    boundary: {
      ...(workspacePolicy ? { workspacePolicy } : {}),
      ...(runtimeProfile ? { runtimeProfile } : {}),
    },
  };
}

function normalizeAgentSpawnSuggestionsPayload(value: unknown): AgentSpawnSuggestionsPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return normalizeIdentityPayload(value);
}

function normalizeAgentIdleRecoverySuggestionsPayload(value: unknown): AgentIdleRecoverySuggestionsPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return normalizeIdentityPayload(value);
}

function normalizeAgentSpawnPolicyUpdatePayload(value: unknown): AgentSpawnPolicyUpdatePayload {
  if (!isRecord(value) || !isRecord(value.policy)) {
    throw new Error("Request body.policy must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    policy: {
      ...(readOptionalString(value.policy.organizationId) ? { organizationId: readOptionalString(value.policy.organizationId) as string } : {}),
      maxActiveAgents: readRequiredPositiveInteger(value.policy.maxActiveAgents, "policy.maxActiveAgents"),
      maxActiveAgentsPerRole: readRequiredPositiveInteger(
        value.policy.maxActiveAgentsPerRole,
        "policy.maxActiveAgentsPerRole",
      ),
    },
  };
}

function normalizeAgentSpawnApprovePayload(value: unknown): AgentSpawnApprovePayload {
  if (!isRecord(value) || !isRecord(value.agent)) {
    throw new Error("Request body.agent must be an object.");
  }

  const displayName = readOptionalString(value.agent.displayName);
  const mission = readOptionalString(value.agent.mission);
  const organizationId = readOptionalString(value.agent.organizationId);
  const supervisorAgentId = readOptionalString(value.agent.supervisorAgentId);

  return {
    ...normalizeIdentityPayload(value),
    agent: {
      departmentRole: readRequiredString(value.agent.departmentRole, "agent.departmentRole"),
      ...(displayName ? { displayName } : {}),
      ...(mission ? { mission } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(supervisorAgentId ? { supervisorAgentId } : {}),
    },
  };
}

function normalizeAgentSpawnSuggestionActionPayload(value: unknown): AgentSpawnSuggestionActionPayload {
  if (!isRecord(value) || !isRecord(value.suggestion)) {
    throw new Error("Request body.suggestion must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    suggestion: {
      suggestionId: readRequiredString(value.suggestion.suggestionId, "suggestion.suggestionId"),
      organizationId: readRequiredString(value.suggestion.organizationId, "suggestion.organizationId"),
      departmentRole: readRequiredString(value.suggestion.departmentRole, "suggestion.departmentRole"),
      displayName: readRequiredString(value.suggestion.displayName, "suggestion.displayName"),
      ...(readOptionalString(value.suggestion.mission) ? { mission: readOptionalString(value.suggestion.mission) as string } : {}),
      ...(readOptionalString(value.suggestion.rationale) ? { rationale: readOptionalString(value.suggestion.rationale) as string } : {}),
      ...(readOptionalString(value.suggestion.supportingAgentId)
        ? { supportingAgentId: readOptionalString(value.suggestion.supportingAgentId) as string }
        : {}),
      ...(readOptionalString(value.suggestion.supportingAgentDisplayName)
        ? { supportingAgentDisplayName: readOptionalString(value.suggestion.supportingAgentDisplayName) as string }
        : {}),
      ...(readOptionalString(value.suggestion.suggestedSupervisorAgentId)
        ? { suggestedSupervisorAgentId: readOptionalString(value.suggestion.suggestedSupervisorAgentId) as string }
        : {}),
      ...(typeof value.suggestion.openWorkItemCount === "number"
        ? { openWorkItemCount: value.suggestion.openWorkItemCount }
        : {}),
      ...(typeof value.suggestion.waitingWorkItemCount === "number"
        ? { waitingWorkItemCount: value.suggestion.waitingWorkItemCount }
        : {}),
      ...(typeof value.suggestion.highPriorityWorkItemCount === "number"
        ? { highPriorityWorkItemCount: value.suggestion.highPriorityWorkItemCount }
        : {}),
      ...(hasOwn(value.suggestion, "spawnPolicy") ? { spawnPolicy: value.suggestion.spawnPolicy } : {}),
      ...(hasOwn(value.suggestion, "guardrail") ? { guardrail: value.suggestion.guardrail } : {}),
      ...(hasOwn(value.suggestion, "auditFacts") ? { auditFacts: value.suggestion.auditFacts } : {}),
    },
  };
}

function normalizeAgentSpawnSuggestionRestorePayload(value: unknown): AgentSpawnSuggestionRestorePayload {
  if (!isRecord(value) || !isRecord(value.suggestion)) {
    throw new Error("Request body.suggestion must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    suggestion: {
      suggestionId: readRequiredString(value.suggestion.suggestionId, "suggestion.suggestionId"),
      ...(readOptionalString(value.suggestion.organizationId)
        ? { organizationId: readOptionalString(value.suggestion.organizationId) as string }
        : {}),
    },
  };
}

function normalizeAgentIdleRecoveryApprovePayload(value: unknown): AgentIdleRecoveryApprovePayload {
  if (!isRecord(value) || !isRecord(value.suggestion)) {
    throw new Error("Request body.suggestion must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    suggestion: {
      suggestionId: readRequiredString(value.suggestion.suggestionId, "suggestion.suggestionId"),
      ...(readOptionalString(value.suggestion.organizationId)
        ? { organizationId: readOptionalString(value.suggestion.organizationId) as string }
        : {}),
      agentId: readRequiredString(value.suggestion.agentId, "suggestion.agentId"),
      action: readRequiredEnum(
        value.suggestion.action,
        MANAGED_AGENT_IDLE_RECOVERY_ACTIONS,
        "suggestion.action",
      ),
    },
  };
}

function normalizeAgentLifecyclePayload(value: unknown): AgentLifecyclePayload {
  return normalizeAgentDetailPayload(value);
}

function normalizeAgentDispatchPayload(value: unknown): AgentDispatchPayload {
  if (!isRecord(value) || !isRecord(value.workItem)) {
    throw new Error("Request body.workItem must be an object.");
  }

  const sourceAgentId = readOptionalString(value.workItem.sourceAgentId);
  const sourcePrincipalId = readOptionalString(value.workItem.sourcePrincipalId);
  const parentWorkItemId = readOptionalString(value.workItem.parentWorkItemId);
  const projectId = readOptionalString(value.workItem.projectId);
  const scheduledAt = readOptionalString(value.workItem.scheduledAt);
  const sourceType = readOptionalEnum(
    value.workItem.sourceType,
    MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES,
    "workItem.sourceType",
  );
  const priority = readOptionalEnum(
    value.workItem.priority,
    MANAGED_AGENT_PRIORITIES,
    "workItem.priority",
  );

  return {
    ...normalizeIdentityPayload(value),
    workItem: {
      targetAgentId: readRequiredString(value.workItem.targetAgentId, "workItem.targetAgentId"),
      ...(projectId ? { projectId } : {}),
      ...(sourceType ? { sourceType } : {}),
      ...(sourceAgentId ? { sourceAgentId } : {}),
      ...(sourcePrincipalId ? { sourcePrincipalId } : {}),
      ...(parentWorkItemId ? { parentWorkItemId } : {}),
      dispatchReason: readRequiredString(value.workItem.dispatchReason, "workItem.dispatchReason"),
      goal: readRequiredString(value.workItem.goal, "workItem.goal"),
      ...(hasOwn(value.workItem, "contextPacket") ? { contextPacket: value.workItem.contextPacket } : {}),
      ...(priority ? { priority } : {}),
      ...(hasOwn(value.workItem, "workspacePolicySnapshot")
        ? { workspacePolicySnapshot: value.workItem.workspacePolicySnapshot }
        : {}),
      ...(hasOwn(value.workItem, "runtimeProfileSnapshot")
        ? { runtimeProfileSnapshot: value.workItem.runtimeProfileSnapshot }
        : {}),
      ...(scheduledAt ? { scheduledAt } : {}),
    },
  };
}

function normalizeWorkItemListPayload(value: unknown): WorkItemListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const agentId = readOptionalString(value.agentId);

  return {
    ...normalizeIdentityPayload(value),
    ...(agentId ? { agentId } : {}),
  };
}

function normalizeWaitingQueueListPayload(value: unknown): WaitingQueueListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const organizationId = readOptionalString(value.organizationId);
  const managerAgentId = readOptionalString(value.managerAgentId);
  const attentionOnly = readOptionalBoolean(value.attentionOnly);
  const attentionLevels = readOptionalEnumArray(
    value.attentionLevels,
    ["normal", "attention", "urgent"] as const,
    "attentionLevels",
  );
  const waitingFor = readOptionalEnum(value.waitingFor, ["any", "human", "agent"] as const, "waitingFor");
  const staleOnly = readOptionalBoolean(value.staleOnly);
  const failedOnly = readOptionalBoolean(value.failedOnly);
  const limit = readOptionalPositiveInteger(value.limit);

  return {
    ...normalizeIdentityPayload(value),
    ...(organizationId ? { organizationId } : {}),
    ...(managerAgentId ? { managerAgentId } : {}),
    ...(attentionOnly !== undefined ? { attentionOnly } : {}),
    ...(attentionLevels ? { attentionLevels } : {}),
    ...(waitingFor ? { waitingFor } : {}),
    ...(staleOnly !== undefined ? { staleOnly } : {}),
    ...(failedOnly !== undefined ? { failedOnly } : {}),
    ...(limit ? { limit } : {}),
  };
}

function normalizeGovernanceOverviewPayload(value: unknown): GovernanceOverviewPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const organizationId = readOptionalString(value.organizationId);
  const managerAgentId = readOptionalString(value.managerAgentId);
  const attentionOnly = readOptionalBoolean(value.attentionOnly);
  const attentionLevels = readOptionalEnumArray(
    value.attentionLevels,
    ["normal", "attention", "urgent"] as const,
    "attentionLevels",
  );
  const waitingFor = readOptionalEnum(value.waitingFor, ["any", "human", "agent"] as const, "waitingFor");
  const staleOnly = readOptionalBoolean(value.staleOnly);
  const failedOnly = readOptionalBoolean(value.failedOnly);

  return {
    ...normalizeIdentityPayload(value),
    ...(organizationId ? { organizationId } : {}),
    ...(managerAgentId ? { managerAgentId } : {}),
    ...(attentionOnly !== undefined ? { attentionOnly } : {}),
    ...(attentionLevels ? { attentionLevels } : {}),
    ...(waitingFor ? { waitingFor } : {}),
    ...(staleOnly !== undefined ? { staleOnly } : {}),
    ...(failedOnly !== undefined ? { failedOnly } : {}),
  };
}

function normalizeCollaborationDashboardPayload(value: unknown): CollaborationDashboardPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const organizationId = readOptionalString(value.organizationId);
  const managerAgentId = readOptionalString(value.managerAgentId);
  const attentionOnly = readOptionalBoolean(value.attentionOnly);
  const attentionLevels = readOptionalEnumArray(
    value.attentionLevels,
    ["normal", "attention", "urgent"] as const,
    "attentionLevels",
  );
  const waitingFor = readOptionalEnum(value.waitingFor, ["any", "human", "agent"] as const, "waitingFor");
  const staleOnly = readOptionalBoolean(value.staleOnly);
  const failedOnly = readOptionalBoolean(value.failedOnly);
  const limit = readOptionalPositiveInteger(value.limit);

  return {
    ...normalizeIdentityPayload(value),
    ...(organizationId ? { organizationId } : {}),
    ...(managerAgentId ? { managerAgentId } : {}),
    ...(attentionOnly !== undefined ? { attentionOnly } : {}),
    ...(attentionLevels ? { attentionLevels } : {}),
    ...(waitingFor ? { waitingFor } : {}),
    ...(staleOnly !== undefined ? { staleOnly } : {}),
    ...(failedOnly !== undefined ? { failedOnly } : {}),
    ...(limit ? { limit } : {}),
  };
}

function normalizeWorkItemDetailPayload(value: unknown): WorkItemDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    workItemId: readRequiredString(value.workItemId, "workItemId"),
  };
}

function normalizeWorkItemCancelPayload(value: unknown): WorkItemCancelPayload {
  return normalizeWorkItemDetailPayload(value);
}

function normalizeWorkItemRespondPayload(value: unknown): WorkItemRespondPayload {
  if (!isRecord(value) || !isRecord(value.response)) {
    throw new Error("Request body.response must be an object.");
  }

  const decision = readOptionalEnum(
    value.response.decision,
    ["approve", "deny"] as const,
    "response.decision",
  );
  const inputText = readOptionalString(value.response.inputText);
  const artifactRefs = Array.isArray(value.response.artifactRefs)
    ? value.response.artifactRefs
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : undefined;

  return {
    ...normalizeIdentityPayload(value),
    workItemId: readRequiredString(value.workItemId, "workItemId"),
    response: {
      ...(decision ? { decision } : {}),
      ...(inputText ? { inputText } : {}),
      ...(hasOwn(value.response, "payload") ? { payload: value.response.payload } : {}),
      ...(artifactRefs?.length ? { artifactRefs } : {}),
    },
  };
}

function normalizeMailboxListPayload(value: unknown): MailboxListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
  };
}

function normalizeMailboxPullPayload(value: unknown): MailboxPullPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
  };
}

function normalizeWorkItemEscalatePayload(value: unknown): WorkItemEscalatePayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const escalation = isRecord(value.escalation)
    ? {
        ...(readOptionalString(value.escalation.inputText)
          ? { inputText: readOptionalString(value.escalation.inputText) as string }
          : {}),
      }
    : undefined;

  return {
    ...normalizeIdentityPayload(value),
    workItemId: readRequiredString(value.workItemId, "workItemId"),
    ...(escalation ? { escalation } : {}),
  };
}

function normalizeAgentRunListPayload(value: unknown): AgentRunListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const agentId = readOptionalString(value.agentId);
  const workItemId = readOptionalString(value.workItemId);

  return {
    ...normalizeIdentityPayload(value),
    ...(agentId ? { agentId } : {}),
    ...(workItemId ? { workItemId } : {}),
  };
}

function normalizeAgentRunDetailPayload(value: unknown): AgentRunDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    runId: readRequiredString(value.runId, "runId"),
  };
}

function normalizeAgentHandoffListPayload(value: unknown): AgentHandoffListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const workItemId = readOptionalString(value.workItemId);
  const limit = readOptionalPositiveInteger(value.limit);

  return {
    ...normalizeIdentityPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
    ...(workItemId ? { workItemId } : {}),
    ...(limit ? { limit } : {}),
  };
}

function normalizeMailboxAckPayload(value: unknown): MailboxAckPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizeIdentityPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
    mailboxEntryId: readRequiredString(value.mailboxEntryId, "mailboxEntryId"),
  };
}

function normalizeMailboxRespondPayload(value: unknown): MailboxRespondPayload {
  if (!isRecord(value) || !isRecord(value.response)) {
    throw new Error("Request body.response must be an object.");
  }

  const decision = readOptionalEnum(
    value.response.decision,
    ["approve", "deny"] as const,
    "response.decision",
  );
  const inputText = readOptionalString(value.response.inputText);
  const priority = readOptionalEnum(
    value.response.priority,
    MANAGED_AGENT_PRIORITIES,
    "response.priority",
  );
  const artifactRefs = Array.isArray(value.response.artifactRefs)
    ? value.response.artifactRefs
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : undefined;

  return {
    ...normalizeIdentityPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
    mailboxEntryId: readRequiredString(value.mailboxEntryId, "mailboxEntryId"),
    response: {
      ...(decision ? { decision } : {}),
      ...(inputText ? { inputText } : {}),
      ...(hasOwn(value.response, "payload") ? { payload: value.response.payload } : {}),
      ...(artifactRefs?.length ? { artifactRefs } : {}),
      ...(priority ? { priority } : {}),
    },
  };
}

function readRequiredString(value: unknown, fieldName: string): string {
  const normalized = readOptionalString(value);

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function readOptionalEnum<T extends readonly string[]>(
  value: unknown,
  candidates: T,
  fieldName: string,
): T[number] | undefined {
  const normalized = readOptionalString(value);

  if (!normalized) {
    return undefined;
  }

  if (!candidates.includes(normalized)) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return normalized as T[number];
}

function readOptionalEnumArray<T extends readonly string[]>(
  value: unknown,
  candidates: T,
  fieldName: string,
): T[number][] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} is invalid.`);
  }

  const normalized = value
    .map((entry) => readOptionalEnum(entry, candidates, fieldName))
    .filter((entry): entry is T[number] => Boolean(entry));

  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function readRequiredEnum<T extends readonly string[]>(
  value: unknown,
  candidates: T,
  fieldName: string,
): T[number] {
  const normalized = readOptionalEnum(value, candidates, fieldName);

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function readRequiredPositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return value;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
