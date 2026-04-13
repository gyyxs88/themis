import type { IncomingMessage, ServerResponse } from "node:http";
import type { ManagedAgentControlPlaneFacadeLike } from "../core/managed-agent-control-plane-facade.js";
import type { ManagedAgentExecutionService } from "../core/managed-agent-execution-service.js";
import type {
  ManagedAgentPlatformAgentCreatePayload,
  ManagedAgentPlatformAgentDetailPayload,
  ManagedAgentPlatformAgentExecutionBoundaryUpdatePayload,
  ManagedAgentPlatformAgentIdleApprovePayload,
  ManagedAgentPlatformAgentLifecyclePayload,
  ManagedAgentPlatformAgentSpawnApprovePayload,
  ManagedAgentPlatformAgentSpawnPolicyUpdatePayload,
  ManagedAgentPlatformAgentSpawnSuggestionActionPayload,
  ManagedAgentPlatformAgentSpawnSuggestionRestorePayload,
  ManagedAgentPlatformCollaborationDashboardPayload,
  ManagedAgentPlatformGovernanceFiltersPayload,
  ManagedAgentPlatformWaitingQueueListPayload,
} from "../contracts/managed-agent-platform-agents.js";
import type {
  ManagedAgentPlatformHandoffListPayload,
  ManagedAgentPlatformMailboxAckPayload,
  ManagedAgentPlatformMailboxListPayload,
  ManagedAgentPlatformMailboxPullPayload,
  ManagedAgentPlatformMailboxRespondPayload,
  ManagedAgentPlatformMailboxResponsePayload,
  ManagedAgentPlatformRunDetailPayload,
  ManagedAgentPlatformRunListPayload,
} from "../contracts/managed-agent-platform-collaboration.js";
import type {
  ManagedAgentPlatformProjectWorkspaceBindingDetailPayload,
  ManagedAgentPlatformProjectWorkspaceBindingListPayload,
  ManagedAgentPlatformProjectWorkspaceBindingUpsertPayload,
} from "../contracts/managed-agent-platform-projects.js";
import type {
  ManagedAgentPlatformWorkItemCancelPayload,
  ManagedAgentPlatformWorkItemDetailPayload,
  ManagedAgentPlatformWorkItemDispatchPayload,
  ManagedAgentPlatformWorkItemEscalatePayload,
  ManagedAgentPlatformWorkItemListPayload,
  ManagedAgentPlatformWorkItemResponsePayload,
  ManagedAgentPlatformWorkItemRespondPayload,
} from "../contracts/managed-agent-platform-work-items.js";
import type {
  ManagedAgentPlatformNodeDetailPayload,
  ManagedAgentPlatformNodeHeartbeatPayload,
  ManagedAgentPlatformNodeListPayload,
  ManagedAgentPlatformNodeReclaimPayload,
  ManagedAgentPlatformNodeRegisterPayload,
  ManagedAgentPlatformOwnerPayload,
  ManagedAgentPlatformWorkerCompletionResult,
  ManagedAgentPlatformWorkerPullPayload,
  ManagedAgentPlatformWorkerRunStatusPayload,
  ManagedAgentPlatformWorkerWaitingActionPayload,
  ManagedAgentPlatformWorkerRunCompletePayload,
} from "../contracts/managed-agent-platform-worker.js";
import {
  type ApprovalPolicy,
  MANAGED_AGENT_IDLE_RECOVERY_ACTIONS,
  MANAGED_AGENT_NODE_STATUSES,
  MANAGED_AGENT_PRIORITIES,
  MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES,
  PROJECT_WORKSPACE_CONTINUITY_MODES,
  type ManagedAgentIdleRecoveryAction,
  type MemoryMode,
  type ManagedAgentPriority,
  type ReasoningLevel,
  type SandboxMode,
  type TaskAccessMode,
  type WebSearchMode,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";
import { getPlatformServiceAuthContext } from "./http-web-access.js";

type ManagedAgentControlPlaneFacade = ManagedAgentControlPlaneFacadeLike;
export type ManagedAgentWorkItemCancellationService = Pick<ManagedAgentExecutionService, "cancelWorkItem">;

async function readAndNormalizePayload<T extends ManagedAgentPlatformOwnerPayload>(
  request: IncomingMessage,
  response: ServerResponse,
  normalize: (value: unknown) => T,
): Promise<T | null> {
  try {
    const payload = normalize(await readJsonBody(request));
    const authContext = getPlatformServiceAuthContext(request);

    if (authContext && payload.ownerPrincipalId !== authContext.ownerPrincipalId) {
      writeJson(response, 403, {
        error: {
          code: "PLATFORM_SERVICE_OWNER_MISMATCH",
          message: "平台服务令牌与 ownerPrincipalId 不匹配。",
        },
      });
      return null;
    }

    return payload;
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, false), {
      error: createTaskError(error, false),
    });
    return null;
  }
}

function writePlatformError(response: ServerResponse, error: unknown): void {
  writeJson(response, resolveErrorStatusCode(error, true), {
    error: createTaskError(error, true),
  });
}

export async function handlePlatformAgentCreate(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentCreatePayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.createManagedAgent({
      ownerPrincipalId: payload.ownerPrincipalId,
      departmentRole: payload.agent.departmentRole,
      ...(payload.agent.displayName ? { displayName: payload.agent.displayName } : {}),
      ...(payload.agent.mission ? { mission: payload.agent.mission } : {}),
      ...(payload.agent.organizationId ? { organizationId: payload.agent.organizationId } : {}),
      ...(payload.agent.supervisorAgentId ? { supervisorAgentId: payload.agent.supervisorAgentId } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      principal: result.principal,
      agent: result.agent,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformOwnerPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.listManagedAgents(payload.ownerPrincipalId);
    writeJson(response, 200, {
      ok: true,
      organizations: result.organizations,
      agents: result.agents,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const detail = await facade.getManagedAgentDetailView(payload.ownerPrincipalId, payload.agentId);
    if (!detail) {
      throw new Error("Managed agent does not exist.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: detail.organization,
      principal: detail.principal,
      agent: detail.agent,
      workspacePolicy: detail.workspacePolicy,
      runtimeProfile: detail.runtimeProfile,
      authAccounts: detail.authAccounts,
      thirdPartyProviders: detail.thirdPartyProviders,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentExecutionBoundaryUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentExecutionBoundaryUpdatePayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.updateManagedAgentExecutionBoundary({
      ownerPrincipalId: payload.ownerPrincipalId,
      agentId: payload.agentId,
      ...(payload.boundary.workspacePolicy ? { workspacePolicy: payload.boundary.workspacePolicy } : {}),
      ...(payload.boundary.runtimeProfile ? { runtimeProfile: payload.boundary.runtimeProfile } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      agent: result.agent,
      workspacePolicy: result.workspacePolicy,
      runtimeProfile: result.runtimeProfile,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformProjectWorkspaceBindingList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformProjectWorkspaceBindingListPayload);
  if (!payload) {
    return;
  }

  try {
    const bindings = await facade.listProjectWorkspaceBindings(payload.ownerPrincipalId, payload.organizationId);
    writeJson(response, 200, {
      ok: true,
      bindings,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformProjectWorkspaceBindingDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformProjectWorkspaceBindingDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const binding = await facade.getProjectWorkspaceBinding(payload.ownerPrincipalId, payload.projectId);
    if (!binding) {
      throw new Error("Project workspace binding does not exist.");
    }

    writeJson(response, 200, {
      ok: true,
      binding,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformProjectWorkspaceBindingUpsert(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformProjectWorkspaceBindingUpsertPayload);
  if (!payload) {
    return;
  }

  try {
    const binding = await facade.upsertProjectWorkspaceBinding({
      ownerPrincipalId: payload.ownerPrincipalId,
      projectId: payload.binding.projectId,
      displayName: payload.binding.displayName,
      ...(payload.binding.organizationId ? { organizationId: payload.binding.organizationId } : {}),
      ...(payload.binding.owningAgentId ? { owningAgentId: payload.binding.owningAgentId } : {}),
      ...(payload.binding.workspaceRootId ? { workspaceRootId: payload.binding.workspaceRootId } : {}),
      ...(payload.binding.workspacePolicyId ? { workspacePolicyId: payload.binding.workspacePolicyId } : {}),
      ...(payload.binding.canonicalWorkspacePath
        ? { canonicalWorkspacePath: payload.binding.canonicalWorkspacePath }
        : {}),
      ...(payload.binding.preferredNodeId ? { preferredNodeId: payload.binding.preferredNodeId } : {}),
      ...(payload.binding.preferredNodePool ? { preferredNodePool: payload.binding.preferredNodePool } : {}),
      ...(payload.binding.lastActiveNodeId ? { lastActiveNodeId: payload.binding.lastActiveNodeId } : {}),
      ...(payload.binding.lastActiveWorkspacePath
        ? { lastActiveWorkspacePath: payload.binding.lastActiveWorkspacePath }
        : {}),
      ...(payload.binding.continuityMode ? { continuityMode: payload.binding.continuityMode } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      binding,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentSpawnSuggestions(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformOwnerPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.getSpawnSuggestionsView(payload.ownerPrincipalId);
    writeJson(response, 200, {
      ok: true,
      spawnPolicies: result.spawnPolicies,
      suggestions: result.suggestions,
      suppressedSuggestions: result.suppressedSuggestions,
      recentAuditLogs: result.recentAuditLogs,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentIdleSuggestions(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformOwnerPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.getIdleRecoverySuggestionsView(payload.ownerPrincipalId);
    writeJson(response, 200, {
      ok: true,
      suggestions: result.suggestions,
      recentAuditLogs: result.recentAuditLogs,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentSpawnPolicyUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentSpawnPolicyUpdatePayload);
  if (!payload) {
    return;
  }

  try {
    const policy = await facade.updateSpawnPolicy({
      ownerPrincipalId: payload.ownerPrincipalId,
      ...(payload.policy.organizationId ? { organizationId: payload.policy.organizationId } : {}),
      maxActiveAgents: payload.policy.maxActiveAgents,
      maxActiveAgentsPerRole: payload.policy.maxActiveAgentsPerRole,
    });
    writeJson(response, 200, {
      ok: true,
      policy,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentSpawnApprove(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentSpawnApprovePayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.approveSpawnSuggestion({
      ownerPrincipalId: payload.ownerPrincipalId,
      departmentRole: payload.agent.departmentRole,
      ...(payload.agent.displayName ? { displayName: payload.agent.displayName } : {}),
      ...(payload.agent.mission ? { mission: payload.agent.mission } : {}),
      ...(payload.agent.organizationId ? { organizationId: payload.agent.organizationId } : {}),
      ...(payload.agent.supervisorAgentId ? { supervisorAgentId: payload.agent.supervisorAgentId } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      principal: result.principal,
      agent: result.agent,
      bootstrapWorkItem: result.bootstrapWorkItem,
      auditLog: result.auditLog,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

async function handlePlatformAgentSpawnSuggestionDecision(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
  action: "ignore" | "reject",
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentSpawnSuggestionActionPayload);
  if (!payload) {
    return;
  }

  try {
    const result = action === "ignore"
      ? await facade.ignoreSpawnSuggestion({
        ownerPrincipalId: payload.ownerPrincipalId,
        ...payload.suggestion,
      })
      : await facade.rejectSpawnSuggestion({
        ownerPrincipalId: payload.ownerPrincipalId,
        ...payload.suggestion,
      });

    writeJson(response, 200, {
      ok: true,
      ...(result.suppressedSuggestion ? { suppressedSuggestion: result.suppressedSuggestion } : {}),
      auditLog: result.auditLog,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentSpawnIgnore(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformAgentSpawnSuggestionDecision(request, response, facade, "ignore");
}

export async function handlePlatformAgentSpawnReject(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformAgentSpawnSuggestionDecision(request, response, facade, "reject");
}

export async function handlePlatformAgentSpawnRestore(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentSpawnSuggestionRestorePayload);
  if (!payload) {
    return;
  }

  try {
    const auditLog = await facade.restoreSpawnSuggestion({
      ownerPrincipalId: payload.ownerPrincipalId,
      suggestionId: payload.suggestion.suggestionId,
      ...(payload.suggestion.organizationId ? { organizationId: payload.suggestion.organizationId } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      auditLog,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentIdleApprove(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentIdleApprovePayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.approveIdleRecoverySuggestion({
      ownerPrincipalId: payload.ownerPrincipalId,
      suggestionId: payload.suggestion.suggestionId,
      ...(payload.suggestion.organizationId ? { organizationId: payload.suggestion.organizationId } : {}),
      agentId: payload.suggestion.agentId,
      action: payload.suggestion.action,
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      agent: result.agent,
      auditLog: result.auditLog,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

async function handlePlatformAgentLifecycleAction(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
  action: "pause" | "resume" | "archive",
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformAgentLifecyclePayload);
  if (!payload) {
    return;
  }

  try {
    const ownerView = await facade.updateManagedAgentLifecycle({
      ownerPrincipalId: payload.ownerPrincipalId,
      agentId: payload.agentId,
      action,
    });

    if (!ownerView) {
      throw new Error("Managed agent does not exist.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: ownerView.organization,
      principal: ownerView.principal,
      agent: ownerView.agent,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformAgentPause(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformAgentLifecycleAction(request, response, facade, "pause");
}

export async function handlePlatformAgentResume(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformAgentLifecycleAction(request, response, facade, "resume");
}

export async function handlePlatformAgentArchive(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformAgentLifecycleAction(request, response, facade, "archive");
}

export async function handlePlatformWaitingQueueList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWaitingQueueListPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.listOrganizationWaitingQueue(
      payload.ownerPrincipalId,
      buildPlatformGovernanceFilters(payload),
    );
    writeJson(response, 200, {
      ok: true,
      summary: result.summary,
      items: result.items,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformGovernanceOverview(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformGovernanceFiltersPayload);
  if (!payload) {
    return;
  }

  try {
    const overview = await facade.getOrganizationGovernanceOverview(
      payload.ownerPrincipalId,
      buildPlatformGovernanceFilters(payload),
    );
    writeJson(response, 200, {
      ok: true,
      overview,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformCollaborationDashboard(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformCollaborationDashboardPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.listOrganizationCollaborationDashboard(
      payload.ownerPrincipalId,
      buildPlatformGovernanceFilters(payload),
    );
    writeJson(response, 200, {
      ok: true,
      summary: result.summary,
      items: result.items,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkItemList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkItemListPayload);
  if (!payload) {
    return;
  }

  try {
    const workItems = await facade.listWorkItems(payload.ownerPrincipalId, payload.agentId);
    writeJson(response, 200, {
      ok: true,
      workItems,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkItemDispatch(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkItemDispatchPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.dispatchWorkItem({
      ownerPrincipalId: payload.ownerPrincipalId,
      targetAgentId: payload.workItem.targetAgentId,
      ...(payload.workItem.projectId ? { projectId: payload.workItem.projectId } : {}),
      ...(payload.workItem.sourceType ? { sourceType: payload.workItem.sourceType } : {}),
      ...(payload.workItem.sourceAgentId ? { sourceAgentId: payload.workItem.sourceAgentId } : {}),
      sourcePrincipalId: payload.workItem.sourcePrincipalId ?? payload.ownerPrincipalId,
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
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      ...(result.dispatchMessage ? { dispatchMessage: result.dispatchMessage } : {}),
      ...(result.mailboxEntry ? { mailboxEntry: result.mailboxEntry } : {}),
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkItemCancel(
  request: IncomingMessage,
  response: ServerResponse,
  executionService: ManagedAgentWorkItemCancellationService,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkItemCancelPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await executionService.cancelWorkItem({
      ownerPrincipalId: payload.ownerPrincipalId,
      workItemId: payload.workItemId,
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      ackedMailboxEntries: result.ackedMailboxEntries,
      ...(result.notificationMessage ? { notificationMessage: result.notificationMessage } : {}),
      ...(result.notificationMailboxEntry ? { notificationMailboxEntry: result.notificationMailboxEntry } : {}),
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkItemRespond(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkItemRespondPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.respondToHumanWaitingWorkItem({
      ownerPrincipalId: payload.ownerPrincipalId,
      workItemId: payload.workItemId,
      ...(payload.response.decision ? { decision: payload.response.decision } : {}),
      ...(payload.response.inputText ? { inputText: payload.response.inputText } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.response, "payload")
        ? { payload: payload.response.payload }
        : {}),
      ...(payload.response.artifactRefs ? { artifactRefs: payload.response.artifactRefs } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      resumedRuns: result.resumedRuns,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkItemEscalate(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkItemEscalatePayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.escalateWaitingAgentWorkItemToHuman({
      ownerPrincipalId: payload.ownerPrincipalId,
      workItemId: payload.workItemId,
      ...(payload.escalation?.inputText ? { inputText: payload.escalation.inputText } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      latestWaitingMessage: result.latestWaitingMessage,
      ackedMailboxEntries: result.ackedMailboxEntries,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkItemDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkItemDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const detail = await facade.getWorkItemDetailView(payload.ownerPrincipalId, payload.workItemId);
    if (!detail) {
      throw new Error("Work item does not exist.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: detail.organization,
      workItem: detail.workItem,
      targetAgent: detail.targetAgent,
      sourceAgent: detail.sourceAgent,
      sourcePrincipal: detail.sourcePrincipal,
      messages: detail.messages,
      collaboration: detail.collaboration,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformHandoffList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformHandoffListPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.getAgentHandoffListView(payload.ownerPrincipalId, {
      agentId: payload.agentId,
      ...(payload.workItemId ? { workItemId: payload.workItemId } : {}),
      ...(payload.limit ? { limit: payload.limit } : {}),
    });
    writeJson(response, 200, {
      ok: true,
      agent: result.agent,
      handoffs: result.handoffs,
      timeline: result.timeline,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformMailboxList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformMailboxListPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.getAgentMailboxListView(payload.ownerPrincipalId, payload.agentId);
    writeJson(response, 200, {
      ok: true,
      agent: result.agent,
      items: result.items,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformMailboxPull(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformMailboxPullPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.pullMailboxEntry(payload.ownerPrincipalId, payload.agentId);
    writeJson(response, 200, {
      ok: true,
      agent: result.agent,
      ...(result.item ? { item: result.item } : { item: null }),
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformMailboxAck(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformMailboxAckPayload);
  if (!payload) {
    return;
  }

  try {
    const mailboxEntry = await facade.ackMailboxEntry(
      payload.ownerPrincipalId,
      payload.agentId,
      payload.mailboxEntryId,
    );
    const result = await facade.getAgentMailboxListView(payload.ownerPrincipalId, payload.agentId);
    const message = result.items.find((item) => item.entry.mailboxEntryId === payload.mailboxEntryId)?.message;

    writeJson(response, 200, {
      ok: true,
      agent: result.agent,
      mailboxEntry,
      ...(message ? { message } : {}),
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformMailboxRespond(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformMailboxRespondPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.respondToMailboxEntry({
      ownerPrincipalId: payload.ownerPrincipalId,
      agentId: payload.agentId,
      mailboxEntryId: payload.mailboxEntryId,
      ...(payload.response.decision ? { decision: payload.response.decision } : {}),
      ...(payload.response.inputText ? { inputText: payload.response.inputText } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload.response, "payload")
        ? { payload: payload.response.payload }
        : {}),
      ...(payload.response.artifactRefs ? { artifactRefs: payload.response.artifactRefs } : {}),
      ...(payload.response.priority ? { priority: payload.response.priority } : {}),
    });

    writeJson(response, 200, {
      ok: true,
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
    writePlatformError(response, error);
  }
}

export async function handlePlatformRunList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformRunListPayload);
  if (!payload) {
    return;
  }

  try {
    const runs = await facade.listRuns({
      ownerPrincipalId: payload.ownerPrincipalId,
      ...(payload.agentId ? { agentId: payload.agentId } : {}),
      ...(payload.workItemId ? { workItemId: payload.workItemId } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      runs,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformRunDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformRunDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const detail = await facade.getRunDetailView(payload.ownerPrincipalId, payload.runId);
    if (!detail) {
      throw new Error("Agent run does not exist.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: detail.organization,
      targetAgent: detail.targetAgent,
      workItem: detail.workItem,
      run: detail.run,
      executionLease: detail.executionLease,
      node: detail.node,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeRegister(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeRegisterPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.registerNode({
      ownerPrincipalId: payload.ownerPrincipalId,
      ...(payload.node.organizationId ? { organizationId: payload.node.organizationId } : {}),
      ...(payload.node.nodeId ? { nodeId: payload.node.nodeId } : {}),
      displayName: payload.node.displayName,
      slotCapacity: payload.node.slotCapacity,
      ...(payload.node.slotAvailable !== undefined ? { slotAvailable: payload.node.slotAvailable } : {}),
      ...(payload.node.labels ? { labels: payload.node.labels } : {}),
      ...(payload.node.workspaceCapabilities ? { workspaceCapabilities: payload.node.workspaceCapabilities } : {}),
      ...(payload.node.credentialCapabilities ? { credentialCapabilities: payload.node.credentialCapabilities } : {}),
      ...(payload.node.providerCapabilities ? { providerCapabilities: payload.node.providerCapabilities } : {}),
      ...(payload.node.heartbeatTtlSeconds !== undefined
        ? { heartbeatTtlSeconds: payload.node.heartbeatTtlSeconds }
        : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeHeartbeat(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeHeartbeatPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.heartbeatNode({
      ownerPrincipalId: payload.ownerPrincipalId,
      nodeId: payload.node.nodeId,
      ...(payload.node.status ? { status: payload.node.status } : {}),
      ...(payload.node.slotAvailable !== undefined ? { slotAvailable: payload.node.slotAvailable } : {}),
      ...(payload.node.labels ? { labels: payload.node.labels } : {}),
      ...(payload.node.workspaceCapabilities ? { workspaceCapabilities: payload.node.workspaceCapabilities } : {}),
      ...(payload.node.credentialCapabilities ? { credentialCapabilities: payload.node.credentialCapabilities } : {}),
      ...(payload.node.providerCapabilities ? { providerCapabilities: payload.node.providerCapabilities } : {}),
      ...(payload.node.heartbeatTtlSeconds !== undefined
        ? { heartbeatTtlSeconds: payload.node.heartbeatTtlSeconds }
        : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeList(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeListPayload);
  if (!payload) {
    return;
  }

  try {
    const nodes = await facade.listNodes(payload.ownerPrincipalId, payload.organizationId);
    writeJson(response, 200, {
      ok: true,
      nodes,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeDetail(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const detail = await facade.getNodeDetailView(payload.ownerPrincipalId, payload.nodeId);
    if (!detail) {
      throw new Error("Managed agent node not found.");
    }

    writeJson(response, 200, {
      ok: true,
      organization: detail.organization,
      node: detail.node,
      leaseSummary: detail.leaseSummary,
      activeExecutionLeases: detail.activeExecutionLeases,
      recentExecutionLeases: detail.recentExecutionLeases,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformNodeDrain(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformNodeGovernanceAction(request, response, facade, "draining");
}

export async function handlePlatformNodeOffline(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  await handlePlatformNodeGovernanceAction(request, response, facade, "offline");
}

export async function handlePlatformNodeReclaim(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeReclaimPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.reclaimNodeLeases({
      ownerPrincipalId: payload.ownerPrincipalId,
      nodeId: payload.nodeId,
      ...(payload.failureCode ? { failureCode: payload.failureCode } : {}),
      ...(payload.failureMessage ? { failureMessage: payload.failureMessage } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
      summary: result.summary,
      reclaimedLeases: result.reclaimedLeases,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkerRunPull(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkerPullPayload);
  if (!payload) {
    return;
  }

  try {
    const assigned = await facade.pullAssignedRun(payload);
    writeJson(response, 200, {
      ok: true,
      ...(assigned ? {
        organization: assigned.organization,
        node: assigned.node,
        targetAgent: assigned.targetAgent,
        workItem: assigned.workItem,
        run: assigned.run,
        executionLease: assigned.executionLease,
        executionContract: assigned.executionContract,
      } : {
        organization: null,
        node: null,
        targetAgent: null,
        workItem: null,
        run: null,
        executionLease: null,
        executionContract: null,
      }),
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkerRunUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkerRunStatusPayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.updateWorkerRunStatus(payload);
    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      run: result.run,
      executionLease: result.executionLease,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

export async function handlePlatformWorkerRunComplete(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformWorkerRunCompletePayload);
  if (!payload) {
    return;
  }

  try {
    const result = await facade.completeWorkerRun(payload);
    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
      targetAgent: result.targetAgent,
      workItem: result.workItem,
      run: result.run,
      executionLease: result.executionLease,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}

function normalizePlatformAgentCreatePayload(value: unknown): ManagedAgentPlatformAgentCreatePayload {
  if (!isRecord(value) || !isRecord(value.agent)) {
    throw new Error("Request body.agent must be an object.");
  }

  const displayName = readOptionalString(value.agent.displayName);
  const mission = readOptionalString(value.agent.mission);
  const organizationId = readOptionalString(value.agent.organizationId);
  const supervisorAgentId = readOptionalString(value.agent.supervisorAgentId);

  return {
    ownerPrincipalId: readRequiredString(value.ownerPrincipalId, "ownerPrincipalId"),
    agent: {
      departmentRole: readRequiredString(value.agent.departmentRole, "agent.departmentRole"),
      ...(displayName ? { displayName } : {}),
      ...(mission ? { mission } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(supervisorAgentId ? { supervisorAgentId } : {}),
    },
  };
}

function normalizePlatformOwnerPayload(value: unknown): ManagedAgentPlatformOwnerPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ownerPrincipalId: readRequiredString(value.ownerPrincipalId, "ownerPrincipalId"),
  };
}

function normalizePlatformAgentDetailPayload(value: unknown): ManagedAgentPlatformAgentDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
  };
}

function normalizePlatformAgentExecutionBoundaryUpdatePayload(
  value: unknown,
): ManagedAgentPlatformAgentExecutionBoundaryUpdatePayload {
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
          ? { additionalDirectories: readStringArray(value.boundary.workspacePolicy.additionalDirectories) }
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
    ...normalizePlatformOwnerPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
    boundary: {
      ...(workspacePolicy ? { workspacePolicy } : {}),
      ...(runtimeProfile ? { runtimeProfile } : {}),
    },
  };
}

function normalizePlatformAgentSpawnPolicyUpdatePayload(value: unknown): ManagedAgentPlatformAgentSpawnPolicyUpdatePayload {
  if (!isRecord(value) || !isRecord(value.policy)) {
    throw new Error("Request body.policy must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    policy: {
      ...(readOptionalString(value.policy.organizationId)
        ? { organizationId: readOptionalString(value.policy.organizationId) as string }
        : {}),
      maxActiveAgents: readRequiredPositiveInteger(value.policy.maxActiveAgents, "policy.maxActiveAgents"),
      maxActiveAgentsPerRole: readRequiredPositiveInteger(
        value.policy.maxActiveAgentsPerRole,
        "policy.maxActiveAgentsPerRole",
      ),
    },
  };
}

function normalizePlatformAgentSpawnApprovePayload(value: unknown): ManagedAgentPlatformAgentSpawnApprovePayload {
  if (!isRecord(value) || !isRecord(value.agent)) {
    throw new Error("Request body.agent must be an object.");
  }

  const displayName = readOptionalString(value.agent.displayName);
  const mission = readOptionalString(value.agent.mission);
  const organizationId = readOptionalString(value.agent.organizationId);
  const supervisorAgentId = readOptionalString(value.agent.supervisorAgentId);

  return {
    ...normalizePlatformOwnerPayload(value),
    agent: {
      departmentRole: readRequiredString(value.agent.departmentRole, "agent.departmentRole"),
      ...(displayName ? { displayName } : {}),
      ...(mission ? { mission } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(supervisorAgentId ? { supervisorAgentId } : {}),
    },
  };
}

function normalizePlatformProjectWorkspaceBindingListPayload(
  value: unknown,
): ManagedAgentPlatformProjectWorkspaceBindingListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const organizationId = readOptionalString(value.organizationId);

  return {
    ...normalizePlatformOwnerPayload(value),
    ...(organizationId ? { organizationId } : {}),
  };
}

function normalizePlatformProjectWorkspaceBindingDetailPayload(
  value: unknown,
): ManagedAgentPlatformProjectWorkspaceBindingDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    projectId: readRequiredString(value.projectId, "projectId"),
  };
}

function normalizePlatformProjectWorkspaceBindingUpsertPayload(
  value: unknown,
): ManagedAgentPlatformProjectWorkspaceBindingUpsertPayload {
  if (!isRecord(value) || !isRecord(value.binding)) {
    throw new Error("Request body.binding must be an object.");
  }

  const organizationId = readOptionalString(value.binding.organizationId);
  const owningAgentId = readOptionalString(value.binding.owningAgentId);
  const workspaceRootId = readOptionalString(value.binding.workspaceRootId);
  const workspacePolicyId = readOptionalString(value.binding.workspacePolicyId);
  const canonicalWorkspacePath = readOptionalString(value.binding.canonicalWorkspacePath);
  const preferredNodeId = readOptionalString(value.binding.preferredNodeId);
  const preferredNodePool = readOptionalString(value.binding.preferredNodePool);
  const lastActiveNodeId = readOptionalString(value.binding.lastActiveNodeId);
  const lastActiveWorkspacePath = readOptionalString(value.binding.lastActiveWorkspacePath);
  const continuityMode = readOptionalEnum(
    value.binding.continuityMode,
    PROJECT_WORKSPACE_CONTINUITY_MODES,
    "binding.continuityMode",
  );

  return {
    ...normalizePlatformOwnerPayload(value),
    binding: {
      projectId: readRequiredString(value.binding.projectId, "binding.projectId"),
      displayName: readRequiredString(value.binding.displayName, "binding.displayName"),
      ...(organizationId ? { organizationId } : {}),
      ...(owningAgentId ? { owningAgentId } : {}),
      ...(workspaceRootId ? { workspaceRootId } : {}),
      ...(workspacePolicyId ? { workspacePolicyId } : {}),
      ...(canonicalWorkspacePath ? { canonicalWorkspacePath } : {}),
      ...(preferredNodeId ? { preferredNodeId } : {}),
      ...(preferredNodePool ? { preferredNodePool } : {}),
      ...(lastActiveNodeId ? { lastActiveNodeId } : {}),
      ...(lastActiveWorkspacePath ? { lastActiveWorkspacePath } : {}),
      ...(continuityMode ? { continuityMode } : {}),
    },
  };
}

function normalizePlatformAgentSpawnSuggestionActionPayload(
  value: unknown,
): ManagedAgentPlatformAgentSpawnSuggestionActionPayload {
  if (!isRecord(value) || !isRecord(value.suggestion)) {
    throw new Error("Request body.suggestion must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    suggestion: {
      suggestionId: readRequiredString(value.suggestion.suggestionId, "suggestion.suggestionId"),
      organizationId: readRequiredString(value.suggestion.organizationId, "suggestion.organizationId"),
      departmentRole: readRequiredString(value.suggestion.departmentRole, "suggestion.departmentRole"),
      displayName: readRequiredString(value.suggestion.displayName, "suggestion.displayName"),
      ...(readOptionalString(value.suggestion.mission)
        ? { mission: readOptionalString(value.suggestion.mission) as string }
        : {}),
      ...(readOptionalString(value.suggestion.rationale)
        ? { rationale: readOptionalString(value.suggestion.rationale) as string }
        : {}),
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

function normalizePlatformAgentSpawnSuggestionRestorePayload(
  value: unknown,
): ManagedAgentPlatformAgentSpawnSuggestionRestorePayload {
  if (!isRecord(value) || !isRecord(value.suggestion)) {
    throw new Error("Request body.suggestion must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    suggestion: {
      suggestionId: readRequiredString(value.suggestion.suggestionId, "suggestion.suggestionId"),
      ...(readOptionalString(value.suggestion.organizationId)
        ? { organizationId: readOptionalString(value.suggestion.organizationId) as string }
        : {}),
    },
  };
}

function normalizePlatformAgentIdleApprovePayload(value: unknown): ManagedAgentPlatformAgentIdleApprovePayload {
  if (!isRecord(value) || !isRecord(value.suggestion)) {
    throw new Error("Request body.suggestion must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    suggestion: {
      suggestionId: readRequiredString(value.suggestion.suggestionId, "suggestion.suggestionId"),
      ...(readOptionalString(value.suggestion.organizationId)
        ? { organizationId: readOptionalString(value.suggestion.organizationId) as string }
        : {}),
      agentId: readRequiredString(value.suggestion.agentId, "suggestion.agentId"),
      action: readRequiredEnum(value.suggestion.action, MANAGED_AGENT_IDLE_RECOVERY_ACTIONS, "suggestion.action"),
    },
  };
}

function normalizePlatformAgentLifecyclePayload(value: unknown): ManagedAgentPlatformAgentLifecyclePayload {
  return normalizePlatformAgentDetailPayload(value);
}

function normalizePlatformGovernanceFiltersPayload(value: unknown): ManagedAgentPlatformGovernanceFiltersPayload {
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
    ...normalizePlatformOwnerPayload(value),
    ...(organizationId ? { organizationId } : {}),
    ...(managerAgentId ? { managerAgentId } : {}),
    ...(attentionOnly !== undefined ? { attentionOnly } : {}),
    ...(attentionLevels ? { attentionLevels } : {}),
    ...(waitingFor ? { waitingFor } : {}),
    ...(staleOnly !== undefined ? { staleOnly } : {}),
    ...(failedOnly !== undefined ? { failedOnly } : {}),
  };
}

function normalizePlatformWaitingQueueListPayload(value: unknown): ManagedAgentPlatformWaitingQueueListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const limit = readOptionalPositiveInteger(value.limit, "limit");

  return {
    ...normalizePlatformGovernanceFiltersPayload(value),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function normalizePlatformCollaborationDashboardPayload(value: unknown): ManagedAgentPlatformCollaborationDashboardPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const limit = readOptionalPositiveInteger(value.limit, "limit");

  return {
    ...normalizePlatformGovernanceFiltersPayload(value),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function normalizePlatformWorkItemListPayload(value: unknown): ManagedAgentPlatformWorkItemListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const agentId = readOptionalString(value.agentId);

  return {
    ...normalizePlatformOwnerPayload(value),
    ...(agentId ? { agentId } : {}),
  };
}

function normalizePlatformWorkItemDispatchPayload(value: unknown): ManagedAgentPlatformWorkItemDispatchPayload {
  if (!isRecord(value) || !isRecord(value.workItem)) {
    throw new Error("Request body.workItem must be an object.");
  }

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
  const sourceAgentId = readOptionalString(value.workItem.sourceAgentId);
  const sourcePrincipalId = readOptionalString(value.workItem.sourcePrincipalId);
  const parentWorkItemId = readOptionalString(value.workItem.parentWorkItemId);
  const projectId = readOptionalString(value.workItem.projectId);
  const scheduledAt = readOptionalString(value.workItem.scheduledAt);

  return {
    ...normalizePlatformOwnerPayload(value),
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

function normalizePlatformWorkItemDetailPayload(value: unknown): ManagedAgentPlatformWorkItemDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    workItemId: readRequiredString(value.workItemId, "workItemId"),
  };
}

function normalizePlatformWorkItemCancelPayload(value: unknown): ManagedAgentPlatformWorkItemCancelPayload {
  return normalizePlatformWorkItemDetailPayload(value);
}

function normalizePlatformWorkItemRespondPayload(value: unknown): ManagedAgentPlatformWorkItemRespondPayload {
  if (!isRecord(value) || !isRecord(value.response)) {
    throw new Error("Request body.response must be an object.");
  }

  const decision = readOptionalEnum(value.response.decision, ["approve", "deny"] as const, "response.decision");
  const inputText = readOptionalString(value.response.inputText);
  const artifactRefs = Array.isArray(value.response.artifactRefs)
    ? readStringArray(value.response.artifactRefs)
    : undefined;
  const response: ManagedAgentPlatformWorkItemResponsePayload = {
    ...(decision ? { decision } : {}),
    ...(inputText ? { inputText } : {}),
    ...(hasOwn(value.response, "payload") ? { payload: value.response.payload } : {}),
    ...(artifactRefs?.length ? { artifactRefs } : {}),
  };

  return {
    ...normalizePlatformOwnerPayload(value),
    workItemId: readRequiredString(value.workItemId, "workItemId"),
    response,
  };
}

function normalizePlatformWorkItemEscalatePayload(value: unknown): ManagedAgentPlatformWorkItemEscalatePayload {
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
    ...normalizePlatformOwnerPayload(value),
    workItemId: readRequiredString(value.workItemId, "workItemId"),
    ...(escalation ? { escalation } : {}),
  };
}

function normalizePlatformRunListPayload(value: unknown): ManagedAgentPlatformRunListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const agentId = readOptionalString(value.agentId);
  const workItemId = readOptionalString(value.workItemId);

  return {
    ...normalizePlatformOwnerPayload(value),
    ...(agentId ? { agentId } : {}),
    ...(workItemId ? { workItemId } : {}),
  };
}

function normalizePlatformRunDetailPayload(value: unknown): ManagedAgentPlatformRunDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    runId: readRequiredString(value.runId, "runId"),
  };
}

function normalizePlatformHandoffListPayload(value: unknown): ManagedAgentPlatformHandoffListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const workItemId = readOptionalString(value.workItemId);
  const limit = readOptionalPositiveInteger(value.limit, "limit");

  return {
    ...normalizePlatformOwnerPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
    ...(workItemId ? { workItemId } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function normalizePlatformMailboxListPayload(value: unknown): ManagedAgentPlatformMailboxListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
  };
}

function normalizePlatformMailboxPullPayload(value: unknown): ManagedAgentPlatformMailboxPullPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
  };
}

function normalizePlatformMailboxAckPayload(value: unknown): ManagedAgentPlatformMailboxAckPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
    mailboxEntryId: readRequiredString(value.mailboxEntryId, "mailboxEntryId"),
  };
}

function normalizePlatformMailboxRespondPayload(value: unknown): ManagedAgentPlatformMailboxRespondPayload {
  if (!isRecord(value) || !isRecord(value.response)) {
    throw new Error("Request body.response must be an object.");
  }

  const decision = readOptionalEnum(value.response.decision, ["approve", "deny"] as const, "response.decision");
  const inputText = readOptionalString(value.response.inputText);
  const priority = readOptionalEnum(value.response.priority, MANAGED_AGENT_PRIORITIES, "response.priority");
  const artifactRefs = Array.isArray(value.response.artifactRefs)
    ? readStringArray(value.response.artifactRefs)
    : undefined;

  const response: ManagedAgentPlatformMailboxResponsePayload = {
    ...(decision ? { decision } : {}),
    ...(inputText ? { inputText } : {}),
    ...(hasOwn(value.response, "payload") ? { payload: value.response.payload } : {}),
    ...(artifactRefs?.length ? { artifactRefs } : {}),
    ...(priority ? { priority } : {}),
  };

  return {
    ...normalizePlatformOwnerPayload(value),
    agentId: readRequiredString(value.agentId, "agentId"),
    mailboxEntryId: readRequiredString(value.mailboxEntryId, "mailboxEntryId"),
    response,
  };
}

function normalizePlatformNodeRegisterPayload(value: unknown): ManagedAgentPlatformNodeRegisterPayload {
  if (!isRecord(value) || !isRecord(value.node)) {
    throw new Error("Request body.node must be an object.");
  }

  const organizationId = readOptionalString(value.node.organizationId);
  const nodeId = readOptionalString(value.node.nodeId);
  const slotAvailable = readOptionalNumber(value.node.slotAvailable);
  const heartbeatTtlSeconds = readOptionalPositiveInteger(value.node.heartbeatTtlSeconds, "node.heartbeatTtlSeconds");

  return {
    ...normalizePlatformOwnerPayload(value),
    node: {
      ...(organizationId ? { organizationId } : {}),
      ...(nodeId ? { nodeId } : {}),
      displayName: readRequiredString(value.node.displayName, "node.displayName"),
      slotCapacity: readRequiredPositiveInteger(value.node.slotCapacity, "node.slotCapacity"),
      ...(slotAvailable !== undefined ? { slotAvailable } : {}),
      ...(Array.isArray(value.node.labels) ? { labels: readStringArray(value.node.labels) } : {}),
      ...(Array.isArray(value.node.workspaceCapabilities)
        ? { workspaceCapabilities: readStringArray(value.node.workspaceCapabilities) }
        : {}),
      ...(Array.isArray(value.node.credentialCapabilities)
        ? { credentialCapabilities: readStringArray(value.node.credentialCapabilities) }
        : {}),
      ...(Array.isArray(value.node.providerCapabilities)
        ? { providerCapabilities: readStringArray(value.node.providerCapabilities) }
        : {}),
      ...(heartbeatTtlSeconds !== undefined ? { heartbeatTtlSeconds } : {}),
    },
  };
}

function normalizePlatformNodeHeartbeatPayload(value: unknown): ManagedAgentPlatformNodeHeartbeatPayload {
  if (!isRecord(value) || !isRecord(value.node)) {
    throw new Error("Request body.node must be an object.");
  }

  const status = readOptionalEnum(value.node.status, MANAGED_AGENT_NODE_STATUSES, "node.status");
  const slotAvailable = readOptionalNumber(value.node.slotAvailable);
  const heartbeatTtlSeconds = readOptionalPositiveInteger(value.node.heartbeatTtlSeconds, "node.heartbeatTtlSeconds");

  return {
    ...normalizePlatformOwnerPayload(value),
    node: {
      nodeId: readRequiredString(value.node.nodeId, "node.nodeId"),
      ...(status ? { status } : {}),
      ...(slotAvailable !== undefined ? { slotAvailable } : {}),
      ...(Array.isArray(value.node.labels) ? { labels: readStringArray(value.node.labels) } : {}),
      ...(Array.isArray(value.node.workspaceCapabilities)
        ? { workspaceCapabilities: readStringArray(value.node.workspaceCapabilities) }
        : {}),
      ...(Array.isArray(value.node.credentialCapabilities)
        ? { credentialCapabilities: readStringArray(value.node.credentialCapabilities) }
        : {}),
      ...(Array.isArray(value.node.providerCapabilities)
        ? { providerCapabilities: readStringArray(value.node.providerCapabilities) }
        : {}),
      ...(heartbeatTtlSeconds !== undefined ? { heartbeatTtlSeconds } : {}),
    },
  };
}

function normalizePlatformNodeListPayload(value: unknown): ManagedAgentPlatformNodeListPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const organizationId = readOptionalString(value.organizationId);

  return {
    ...normalizePlatformOwnerPayload(value),
    ...(organizationId ? { organizationId } : {}),
  };
}

function normalizePlatformNodeDetailPayload(value: unknown): ManagedAgentPlatformNodeDetailPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    nodeId: readRequiredString(value.nodeId, "nodeId"),
  };
}

function normalizePlatformNodeReclaimPayload(value: unknown): ManagedAgentPlatformNodeReclaimPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const failureCode = readOptionalString(value.failureCode);
  const failureMessage = readOptionalString(value.failureMessage);

  return {
    ...normalizePlatformOwnerPayload(value),
    nodeId: readRequiredString(value.nodeId, "nodeId"),
    ...(failureCode ? { failureCode } : {}),
    ...(failureMessage ? { failureMessage } : {}),
  };
}

function normalizePlatformWorkerPullPayload(value: unknown): ManagedAgentPlatformWorkerPullPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  return {
    ...normalizePlatformOwnerPayload(value),
    nodeId: readRequiredString(value.nodeId, "nodeId"),
  };
}

function normalizePlatformWorkerRunStatusPayload(value: unknown): ManagedAgentPlatformWorkerRunStatusPayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const status = readOptionalEnum(
    value.status,
    ["starting", "running", "heartbeat", "waiting_human", "waiting_agent", "failed", "cancelled"] as const,
    "status",
  );

  if (!status) {
    throw new Error("status is required.");
  }

  const failureCode = readOptionalString(value.failureCode);
  const failureMessage = readOptionalString(value.failureMessage);
  const waitingAction = normalizePlatformWorkerWaitingAction(value.waitingAction);

  return {
    ...normalizePlatformWorkerPullPayload(value),
    runId: readRequiredString(value.runId, "runId"),
    leaseToken: readRequiredString(value.leaseToken, "leaseToken"),
    status,
    ...(failureCode ? { failureCode } : {}),
    ...(failureMessage ? { failureMessage } : {}),
    ...(waitingAction && Object.keys(waitingAction).length > 0 ? { waitingAction } : {}),
  };
}

function normalizePlatformWorkerRunCompletePayload(value: unknown): ManagedAgentPlatformWorkerRunCompletePayload {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  const result = normalizePlatformWorkerCompletionResult(value.result);

  return {
    ...normalizePlatformWorkerPullPayload(value),
    runId: readRequiredString(value.runId, "runId"),
    leaseToken: readRequiredString(value.leaseToken, "leaseToken"),
    ...(result ? { result } : {}),
  };
}

function normalizePlatformWorkerWaitingAction(
  value: unknown,
): ManagedAgentPlatformWorkerWaitingActionPayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const actionType = readOptionalString(value.actionType);
  const actionId = readOptionalString(value.actionId);
  const prompt = readOptionalString(value.prompt);
  const message = readOptionalString(value.message);
  const requestId = readOptionalString(value.requestId);
  const taskId = readOptionalString(value.taskId);

  const waitingAction = {
    ...(actionType ? { actionType } : {}),
    ...(actionId ? { actionId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(message ? { message } : {}),
    ...(hasOwn(value, "choices") ? { choices: value.choices } : {}),
    ...(hasOwn(value, "inputSchema") ? { inputSchema: value.inputSchema } : {}),
    ...(requestId ? { requestId } : {}),
    ...(taskId ? { taskId } : {}),
  };

  return Object.keys(waitingAction).length > 0 ? waitingAction : undefined;
}

function normalizePlatformWorkerCompletionResult(
  value: unknown,
): ManagedAgentPlatformWorkerCompletionResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const completedAt = readOptionalString(value.completedAt);
  return {
    summary: readRequiredString(value.summary, "result.summary"),
    ...(hasOwn(value, "output") ? { output: value.output } : {}),
    ...(Array.isArray(value.touchedFiles) ? { touchedFiles: readStringArray(value.touchedFiles) } : {}),
    ...(isRecord(value.structuredOutput) || value.structuredOutput === null
      ? { structuredOutput: value.structuredOutput as Record<string, unknown> | null }
      : {}),
    ...(completedAt ? { completedAt } : {}),
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

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.floor(value);
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

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return value;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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
    throw new Error(`${fieldName} must be an array.`);
  }

  const normalized = [...new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean))];

  if (normalized.some((entry) => !candidates.includes(entry))) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return normalized as T[number][];
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
  const normalized = readOptionalPositiveInteger(value, fieldName);

  if (normalized === undefined) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function readStringArray(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildPlatformGovernanceFilters(
  payload: ManagedAgentPlatformGovernanceFiltersPayload & { limit?: number },
): {
  organizationId?: string;
  managerAgentId?: string;
  attentionOnly?: boolean;
  attentionLevels?: Array<"normal" | "attention" | "urgent">;
  waitingFor?: "any" | "human" | "agent";
  staleOnly?: boolean;
  failedOnly?: boolean;
  limit?: number;
} {
  return {
    ...(payload.organizationId ? { organizationId: payload.organizationId } : {}),
    ...(payload.managerAgentId ? { managerAgentId: payload.managerAgentId } : {}),
    ...(payload.attentionOnly !== undefined ? { attentionOnly: payload.attentionOnly } : {}),
    ...(payload.attentionLevels ? { attentionLevels: payload.attentionLevels } : {}),
    ...(payload.waitingFor ? { waitingFor: payload.waitingFor } : {}),
    ...(payload.staleOnly !== undefined ? { staleOnly: payload.staleOnly } : {}),
    ...(payload.failedOnly !== undefined ? { failedOnly: payload.failedOnly } : {}),
    ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
  };
}

async function handlePlatformNodeGovernanceAction(
  request: IncomingMessage,
  response: ServerResponse,
  facade: ManagedAgentControlPlaneFacade,
  action: "draining" | "offline",
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePlatformNodeDetailPayload);
  if (!payload) {
    return;
  }

  try {
    const result = action === "draining"
      ? await facade.markNodeDraining({
        ownerPrincipalId: payload.ownerPrincipalId,
        nodeId: payload.nodeId,
      })
      : await facade.markNodeOffline({
        ownerPrincipalId: payload.ownerPrincipalId,
        nodeId: payload.nodeId,
      });

    writeJson(response, 200, {
      ok: true,
      organization: result.organization,
      node: result.node,
    });
  } catch (error) {
    writePlatformError(response, error);
  }
}
