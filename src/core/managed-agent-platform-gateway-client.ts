import type {
  ManagedAgentIdleRecoverySuggestionsView,
  ManagedAgentListView,
  ManagedAgentSpawnSuggestionsView,
  ManagedAgentLifecycleUpdateInput,
} from "./managed-agent-control-plane-facade.js";
import type {
  ManagedAgentWorkItemDetailView,
  OrganizationCollaborationDashboardResult,
  OrganizationGovernanceFilters,
  OrganizationGovernanceOverview,
  OrganizationWaitingQueueResult,
} from "./managed-agent-coordination-service.js";
import type {
  ApproveManagedAgentIdleRecoverySuggestionInput,
  ApproveManagedAgentIdleRecoverySuggestionResult,
  ApproveManagedAgentSpawnSuggestionInput,
  ApproveManagedAgentSpawnSuggestionResult,
  CreateManagedAgentInput,
  CreateManagedAgentResult,
  ManagedAgentDetailView,
  ManagedAgentExecutionBoundaryView,
  ManagedAgentOwnerView,
  ManagedAgentSpawnSuggestionDecisionInput,
  ManagedAgentSpawnSuggestionDecisionResult,
  RestoreManagedAgentSpawnSuggestionInput,
  UpdateManagedAgentCardInput,
  UpdateManagedAgentExecutionBoundaryInput,
  UpdateManagedAgentSpawnPolicyInput,
} from "./managed-agents-service.js";
import type { ManagedAgentRunDetailView } from "./managed-agent-scheduler-service.js";
import type {
  ManagedAgentPlatformHandoffListInput,
  ManagedAgentPlatformHandoffListResult,
  ManagedAgentPlatformMailboxAckInput,
  ManagedAgentPlatformMailboxAckResult,
  ManagedAgentPlatformMailboxListInput,
  ManagedAgentPlatformMailboxListResult,
  ManagedAgentPlatformMailboxPullInput,
  ManagedAgentPlatformMailboxPullResult,
  ManagedAgentPlatformMailboxRespondInput,
  ManagedAgentPlatformMailboxRespondResult,
  ManagedAgentPlatformRunDetailInput,
  ManagedAgentPlatformRunDetailResult,
  ManagedAgentPlatformRunListInput,
  ManagedAgentPlatformRunListResult,
} from "themis-contracts/managed-agent-platform-collaboration";
import type {
  ManagedAgentPlatformAgentCardUpdatePayload,
  ManagedAgentPlatformAgentCardUpdateResult,
  ManagedAgentPlatformAgentCreateInput,
  ManagedAgentPlatformAgentCreateResult,
  ManagedAgentPlatformAgentExecutionBoundaryUpdateInput,
  ManagedAgentPlatformAgentExecutionBoundaryUpdateResult,
  ManagedAgentPlatformAgentIdleApproveInput,
  ManagedAgentPlatformAgentIdleApproveResult,
  ManagedAgentPlatformAgentIdleRecoverySuggestionsResult,
  ManagedAgentPlatformAgentLifecycleInput,
  ManagedAgentPlatformAgentLifecycleResult,
  ManagedAgentPlatformAgentSpawnApproveInput,
  ManagedAgentPlatformAgentSpawnApproveResult,
  ManagedAgentPlatformAgentSpawnPolicyUpdateInput,
  ManagedAgentPlatformAgentSpawnPolicyUpdateResult,
  ManagedAgentPlatformAgentSpawnSuggestionActionInput,
  ManagedAgentPlatformAgentSpawnSuggestionActionResult,
  ManagedAgentPlatformAgentSpawnSuggestionRestoreInput,
  ManagedAgentPlatformAgentSpawnSuggestionRestoreResult,
  ManagedAgentPlatformAgentSpawnSuggestionsResult,
  ManagedAgentPlatformCollaborationDashboardResult,
  ManagedAgentPlatformGovernanceFiltersInput,
  ManagedAgentPlatformGovernanceOverviewResult,
  ManagedAgentPlatformWaitingQueueResult,
} from "themis-contracts/managed-agent-platform-agents";
import type {
  ManagedAgentPlatformProjectWorkspaceBindingDetailResult,
  ManagedAgentPlatformProjectWorkspaceBindingListInput,
  ManagedAgentPlatformProjectWorkspaceBindingListResult,
  ManagedAgentPlatformProjectWorkspaceBindingRecord,
  ManagedAgentPlatformProjectWorkspaceBindingUpsertInput,
  ManagedAgentPlatformProjectWorkspaceBindingUpsertResult,
} from "themis-contracts/managed-agent-platform-projects";
import { deriveManagedAgentCompletionInsight } from "./managed-agent-completion-insight.js";
import type {
  ManagedAgentPlatformWorkItemCancelResult,
  ManagedAgentPlatformWorkItemDetailResult,
  ManagedAgentPlatformWorkItemDispatchInput,
  ManagedAgentPlatformWorkItemDispatchResult,
  ManagedAgentPlatformWorkItemEscalateInput,
  ManagedAgentPlatformWorkItemEscalateResult,
  ManagedAgentPlatformWorkItemListInput,
  ManagedAgentPlatformWorkItemListResult,
  ManagedAgentPlatformWorkItemRespondInput,
  ManagedAgentPlatformWorkItemRespondResult,
} from "themis-contracts/managed-agent-platform-work-items";
import { buildPlatformServiceAuthorizationHeader } from "themis-contracts/managed-agent-platform-access";
import type {
  ManagedAgentPlatformWorkerNodeDetailResult,
  ManagedAgentPlatformWorkerNodeLeaseRecoveryResult,
  ManagedAgentPlatformWorkerNodeMutationResult,
  ManagedAgentPlatformWorkerNodeRecord,
  ManagedAgentPlatformWorkerAssignedRunResult,
  ManagedAgentPlatformWorkerRunMutationResult,
  ManagedAgentPlatformWorkerNodeRegistrationInput,
  ManagedAgentPlatformWorkerNodeHeartbeatInput,
  ManagedAgentPlatformWorkerNodeListInput,
  ManagedAgentPlatformWorkerNodeLeaseReclaimInput,
  ManagedAgentPlatformWorkerPullInput,
  ManagedAgentPlatformWorkerRunCompleteInput,
  ManagedAgentPlatformWorkerRunStatusInput,
  ManagedAgentPlatformWorkerSecretPushInput,
  ManagedAgentPlatformWorkerSecretPushResult,
} from "themis-contracts/managed-agent-platform-worker";
import type {
  StoredAgentSpawnPolicyRecord,
  StoredAgentWorkItemRecord,
} from "../types/index.js";

export type {
  ManagedAgentPlatformAgentCardUpdateInput,
  ManagedAgentPlatformAgentCardUpdatePayload,
  ManagedAgentPlatformAgentCardUpdateResult,
  ManagedAgentPlatformAgentCreateInput,
  ManagedAgentPlatformAgentCreatePayload,
  ManagedAgentPlatformAgentCreateResult,
  ManagedAgentPlatformAgentDetailInput,
  ManagedAgentPlatformAgentDetailPayload,
  ManagedAgentPlatformAgentDetailResult,
  ManagedAgentPlatformAgentExecutionBoundaryUpdateInput,
  ManagedAgentPlatformAgentExecutionBoundaryUpdatePayload,
  ManagedAgentPlatformAgentExecutionBoundaryUpdateResult,
  ManagedAgentPlatformAgentIdleApproveInput,
  ManagedAgentPlatformAgentIdleApprovePayload,
  ManagedAgentPlatformAgentIdleApproveResult,
  ManagedAgentPlatformAgentIdleRecoverySuggestionsResult,
  ManagedAgentPlatformAgentLifecycleInput,
  ManagedAgentPlatformAgentLifecyclePayload,
  ManagedAgentPlatformAgentLifecycleResult,
  ManagedAgentPlatformAgentListResult,
  ManagedAgentPlatformAgentSpawnApproveInput,
  ManagedAgentPlatformAgentSpawnApprovePayload,
  ManagedAgentPlatformAgentSpawnApproveResult,
  ManagedAgentPlatformAgentSpawnPolicyUpdateInput,
  ManagedAgentPlatformAgentSpawnPolicyUpdatePayload,
  ManagedAgentPlatformAgentSpawnPolicyUpdateResult,
  ManagedAgentPlatformAgentSpawnSuggestionActionInput,
  ManagedAgentPlatformAgentSpawnSuggestionActionPayload,
  ManagedAgentPlatformAgentSpawnSuggestionActionResult,
  ManagedAgentPlatformAgentSpawnSuggestionRestoreInput,
  ManagedAgentPlatformAgentSpawnSuggestionRestorePayload,
  ManagedAgentPlatformAgentSpawnSuggestionRestoreResult,
  ManagedAgentPlatformAgentSpawnSuggestionsResult,
  ManagedAgentPlatformCollaborationDashboardPayload,
  ManagedAgentPlatformCollaborationDashboardResult,
  ManagedAgentPlatformGovernanceFiltersInput,
  ManagedAgentPlatformGovernanceFiltersPayload,
  ManagedAgentPlatformGovernanceOverviewResult,
  ManagedAgentPlatformWaitingQueueListPayload,
  ManagedAgentPlatformWaitingQueueResult,
} from "themis-contracts/managed-agent-platform-agents";
export type {
  ManagedAgentPlatformHandoffListInput,
  ManagedAgentPlatformHandoffListPayload,
  ManagedAgentPlatformHandoffListResult,
  ManagedAgentPlatformMailboxAckInput,
  ManagedAgentPlatformMailboxAckPayload,
  ManagedAgentPlatformMailboxAckResult,
  ManagedAgentPlatformMailboxListInput,
  ManagedAgentPlatformMailboxListPayload,
  ManagedAgentPlatformMailboxListResult,
  ManagedAgentPlatformMailboxPullInput,
  ManagedAgentPlatformMailboxPullPayload,
  ManagedAgentPlatformMailboxPullResult,
  ManagedAgentPlatformMailboxRespondInput,
  ManagedAgentPlatformMailboxRespondPayload,
  ManagedAgentPlatformMailboxRespondResult,
  ManagedAgentPlatformMailboxResponsePayload,
  ManagedAgentPlatformRunDetailInput,
  ManagedAgentPlatformRunDetailPayload,
  ManagedAgentPlatformRunDetailResult,
  ManagedAgentPlatformRunListInput,
  ManagedAgentPlatformRunListPayload,
  ManagedAgentPlatformRunListResult,
} from "themis-contracts/managed-agent-platform-collaboration";
export type {
  ManagedAgentPlatformProjectWorkspaceBindingDetailInput,
  ManagedAgentPlatformProjectWorkspaceBindingDetailResult,
  ManagedAgentPlatformProjectWorkspaceBindingListInput,
  ManagedAgentPlatformProjectWorkspaceBindingListResult,
  ManagedAgentPlatformProjectWorkspaceBindingRecord,
  ManagedAgentPlatformProjectWorkspaceBindingUpsertInput,
  ManagedAgentPlatformProjectWorkspaceBindingUpsertResult,
} from "themis-contracts/managed-agent-platform-projects";
export type {
  ManagedAgentPlatformWorkItemCancelPayload,
  ManagedAgentPlatformWorkItemCancelResult,
  ManagedAgentPlatformWorkItemDetailInput,
  ManagedAgentPlatformWorkItemDetailPayload,
  ManagedAgentPlatformWorkItemDetailResult,
  ManagedAgentPlatformWorkItemDispatchInput,
  ManagedAgentPlatformWorkItemDispatchPayload,
  ManagedAgentPlatformWorkItemDispatchResult,
  ManagedAgentPlatformWorkItemEscalateInput,
  ManagedAgentPlatformWorkItemEscalatePayload,
  ManagedAgentPlatformWorkItemEscalateResult,
  ManagedAgentPlatformWorkItemListInput,
  ManagedAgentPlatformWorkItemListPayload,
  ManagedAgentPlatformWorkItemListResult,
  ManagedAgentPlatformWorkItemRespondInput,
  ManagedAgentPlatformWorkItemRespondPayload,
  ManagedAgentPlatformWorkItemRespondResult,
} from "themis-contracts/managed-agent-platform-work-items";

export interface ManagedAgentPlatformGatewayConfig {
  baseUrl: string;
  ownerPrincipalId: string;
  webAccessToken: string;
}

export interface ManagedAgentPlatformGatewayClientOptions extends ManagedAgentPlatformGatewayConfig {
  fetchImpl?: typeof fetch;
}

export interface ManagedAgentPlatformGatewayListResult {
  organizations: ManagedAgentListView["organizations"];
  agents: ManagedAgentListView["agents"];
}

export interface ManagedAgentPlatformGatewayDetailResult {
  organization: ManagedAgentDetailView["organization"];
  principal: ManagedAgentDetailView["principal"];
  agent: ManagedAgentDetailView["agent"];
  workspacePolicy: ManagedAgentDetailView["workspacePolicy"];
  runtimeProfile: ManagedAgentDetailView["runtimeProfile"];
  authAccounts: ManagedAgentDetailView["authAccounts"];
  thirdPartyProviders: ManagedAgentDetailView["thirdPartyProviders"];
}

export class PlatformGatewayHttpError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(statusCode: number, errorCode: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PlatformGatewayHttpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export class ManagedAgentPlatformGatewayClient {
  private readonly baseUrl: string;
  private readonly ownerPrincipalId: string;
  private readonly webAccessToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ManagedAgentPlatformGatewayClientOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.ownerPrincipalId = options.ownerPrincipalId;
    this.webAccessToken = options.webAccessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listProjectWorkspaceBindings(
    input: ManagedAgentPlatformProjectWorkspaceBindingListInput = {},
  ): Promise<ManagedAgentPlatformProjectWorkspaceBindingRecord[]> {
    const payload = await this.requestJson<ManagedAgentPlatformProjectWorkspaceBindingListResult>(
      "/api/platform/projects/workspace-binding/list",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      },
    );

    return Array.isArray(payload.bindings) ? payload.bindings : [];
  }

  async getProjectWorkspaceBinding(projectId: string): Promise<ManagedAgentPlatformProjectWorkspaceBindingRecord | null> {
    const payload = await this.requestJson<ManagedAgentPlatformProjectWorkspaceBindingDetailResult>(
      "/api/platform/projects/workspace-binding/detail",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        projectId,
      },
    );

    return payload.binding ?? null;
  }

  async upsertProjectWorkspaceBinding(
    input: ManagedAgentPlatformProjectWorkspaceBindingUpsertInput,
  ): Promise<ManagedAgentPlatformProjectWorkspaceBindingRecord> {
    const payload = await this.requestJson<ManagedAgentPlatformProjectWorkspaceBindingUpsertResult>(
      "/api/platform/projects/workspace-binding/upsert",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        binding: {
          projectId: input.projectId,
          displayName: input.displayName,
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          ...(input.owningAgentId ? { owningAgentId: input.owningAgentId } : {}),
          ...(input.workspaceRootId ? { workspaceRootId: input.workspaceRootId } : {}),
          ...(input.workspacePolicyId ? { workspacePolicyId: input.workspacePolicyId } : {}),
          ...(input.canonicalWorkspacePath ? { canonicalWorkspacePath: input.canonicalWorkspacePath } : {}),
          ...(input.preferredNodeId ? { preferredNodeId: input.preferredNodeId } : {}),
          ...(input.preferredNodePool ? { preferredNodePool: input.preferredNodePool } : {}),
          ...(input.lastActiveNodeId ? { lastActiveNodeId: input.lastActiveNodeId } : {}),
          ...(input.lastActiveWorkspacePath ? { lastActiveWorkspacePath: input.lastActiveWorkspacePath } : {}),
          ...(input.continuityMode ? { continuityMode: input.continuityMode } : {}),
        },
      },
    );

    return payload.binding;
  }

  async listManagedAgents(): Promise<ManagedAgentPlatformGatewayListResult> {
    const payload = await this.requestJson<{
      organizations?: ManagedAgentPlatformGatewayListResult["organizations"];
      agents?: ManagedAgentPlatformGatewayListResult["agents"];
    }>("/api/platform/agents/list", {
      ownerPrincipalId: this.ownerPrincipalId,
    });

    return {
      organizations: Array.isArray(payload.organizations) ? payload.organizations : [],
      agents: Array.isArray(payload.agents) ? payload.agents : [],
    };
  }

  async getManagedAgentDetail(agentId: string): Promise<ManagedAgentPlatformGatewayDetailResult | null> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformGatewayDetailResult>>(
      "/api/platform/agents/detail",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        agentId,
      },
    );

    if (!payload.agent) {
      return null;
    }

    return {
      organization: payload.organization ?? null,
      principal: payload.principal ?? null,
      agent: payload.agent,
      workspacePolicy: normalizeGatewayWorkspacePolicy(payload.workspacePolicy),
      runtimeProfile: payload.runtimeProfile ?? null,
      authAccounts: Array.isArray(payload.authAccounts) ? payload.authAccounts : [],
      thirdPartyProviders: Array.isArray(payload.thirdPartyProviders) ? payload.thirdPartyProviders : [],
    } as unknown as ManagedAgentPlatformGatewayDetailResult;
  }

  async createManagedAgent(input: ManagedAgentPlatformAgentCreateInput): Promise<ManagedAgentPlatformAgentCreateResult> {
    return await this.requestJson<ManagedAgentPlatformAgentCreateResult>("/api/platform/agents/create", {
      ownerPrincipalId: this.ownerPrincipalId,
      agent: {
        departmentRole: input.departmentRole,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.mission ? { mission: input.mission } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.supervisorAgentId ? { supervisorAgentId: input.supervisorAgentId } : {}),
      },
    });
  }

  async updateManagedAgentCard(
    input: UpdateManagedAgentCardInput,
  ): Promise<ManagedAgentPlatformGatewayDetailResult> {
    const payload = await this.requestJson<ManagedAgentPlatformAgentCardUpdateResult>(
      "/api/platform/agents/card/update",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        agentId: input.agentId,
        card: input.card,
      } satisfies ManagedAgentPlatformAgentCardUpdatePayload,
    );

    return {
      organization: payload.organization ?? null,
      principal: payload.principal ?? null,
      agent: payload.agent,
      workspacePolicy: normalizeGatewayWorkspacePolicy(payload.workspacePolicy),
      runtimeProfile: payload.runtimeProfile ?? null,
      authAccounts: Array.isArray(payload.authAccounts) ? payload.authAccounts : [],
      thirdPartyProviders: Array.isArray(payload.thirdPartyProviders) ? payload.thirdPartyProviders : [],
    } as unknown as ManagedAgentPlatformGatewayDetailResult;
  }

  async updateManagedAgentExecutionBoundary(
    input: ManagedAgentPlatformAgentExecutionBoundaryUpdateInput,
  ): Promise<ManagedAgentPlatformAgentExecutionBoundaryUpdateResult> {
    const payload = await this.requestJson<ManagedAgentPlatformAgentExecutionBoundaryUpdateResult>(
      "/api/platform/agents/execution-boundary/update",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        agentId: input.agentId,
        boundary: {
          ...(input.workspacePolicy ? { workspacePolicy: toGatewayWorkspacePolicyPayload(input.workspacePolicy) } : {}),
          ...(input.runtimeProfile ? { runtimeProfile: input.runtimeProfile } : {}),
        },
      },
    );

    return normalizeGatewayExecutionBoundaryResult(payload);
  }

  async updateSpawnPolicy(
    input: ManagedAgentPlatformAgentSpawnPolicyUpdateInput,
  ): Promise<StoredAgentSpawnPolicyRecord> {
    const payload = await this.requestJson<ManagedAgentPlatformAgentSpawnPolicyUpdateResult>(
      "/api/platform/agents/spawn-policy/update",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        policy: {
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          maxActiveAgents: input.maxActiveAgents,
          maxActiveAgentsPerRole: input.maxActiveAgentsPerRole,
        },
      },
    );

    return payload.policy as unknown as StoredAgentSpawnPolicyRecord;
  }

  async approveSpawnSuggestion(
    input: ManagedAgentPlatformAgentSpawnApproveInput,
  ): Promise<ManagedAgentPlatformAgentSpawnApproveResult> {
    return await this.requestJson<ManagedAgentPlatformAgentSpawnApproveResult>("/api/platform/agents/spawn-approve", {
      ownerPrincipalId: this.ownerPrincipalId,
      agent: {
        departmentRole: input.departmentRole,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.mission ? { mission: input.mission } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.supervisorAgentId ? { supervisorAgentId: input.supervisorAgentId } : {}),
      },
    });
  }

  async ignoreSpawnSuggestion(
    input: ManagedAgentPlatformAgentSpawnSuggestionActionInput,
  ): Promise<ManagedAgentPlatformAgentSpawnSuggestionActionResult> {
    return await this.requestJson<ManagedAgentPlatformAgentSpawnSuggestionActionResult>("/api/platform/agents/spawn-ignore", {
      ownerPrincipalId: this.ownerPrincipalId,
      suggestion: input,
    });
  }

  async rejectSpawnSuggestion(
    input: ManagedAgentPlatformAgentSpawnSuggestionActionInput,
  ): Promise<ManagedAgentPlatformAgentSpawnSuggestionActionResult> {
    return await this.requestJson<ManagedAgentPlatformAgentSpawnSuggestionActionResult>("/api/platform/agents/spawn-reject", {
      ownerPrincipalId: this.ownerPrincipalId,
      suggestion: input,
    });
  }

  async restoreSpawnSuggestion(
    input: ManagedAgentPlatformAgentSpawnSuggestionRestoreInput,
  ): Promise<ManagedAgentPlatformAgentSpawnSuggestionRestoreResult> {
    return await this.requestJson<ManagedAgentPlatformAgentSpawnSuggestionRestoreResult>(
      "/api/platform/agents/spawn-restore",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        suggestion: input,
      },
    );
  }

  async approveIdleRecoverySuggestion(
    input: ManagedAgentPlatformAgentIdleApproveInput,
  ): Promise<ManagedAgentPlatformAgentIdleApproveResult> {
    return await this.requestJson<ManagedAgentPlatformAgentIdleApproveResult>("/api/platform/agents/idle-approve", {
      ownerPrincipalId: this.ownerPrincipalId,
      suggestion: input,
    });
  }

  async updateManagedAgentLifecycle(
    input: ManagedAgentPlatformAgentLifecycleInput,
  ): Promise<ManagedAgentPlatformAgentLifecycleResult> {
    const pathname = input.action === "pause"
      ? "/api/platform/agents/pause"
      : input.action === "resume"
        ? "/api/platform/agents/resume"
        : "/api/platform/agents/archive";

    return await this.requestJson<ManagedAgentPlatformAgentLifecycleResult>(pathname, {
      ownerPrincipalId: this.ownerPrincipalId,
      agentId: input.agentId,
    });
  }

  async getSpawnSuggestionsView(): Promise<ManagedAgentPlatformAgentSpawnSuggestionsResult> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformAgentSpawnSuggestionsResult>>(
      "/api/platform/agents/spawn-suggestions",
      {
        ownerPrincipalId: this.ownerPrincipalId,
      },
    );

    return {
      spawnPolicies: Array.isArray(payload.spawnPolicies) ? payload.spawnPolicies : [],
      suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
      suppressedSuggestions: Array.isArray(payload.suppressedSuggestions) ? payload.suppressedSuggestions : [],
      recentAuditLogs: Array.isArray(payload.recentAuditLogs) ? payload.recentAuditLogs : [],
    };
  }

  async getIdleRecoverySuggestionsView(): Promise<ManagedAgentPlatformAgentIdleRecoverySuggestionsResult> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformAgentIdleRecoverySuggestionsResult>>(
      "/api/platform/agents/idle-suggestions",
      {
        ownerPrincipalId: this.ownerPrincipalId,
      },
    );

    return {
      suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
      recentAuditLogs: Array.isArray(payload.recentAuditLogs) ? payload.recentAuditLogs : [],
    };
  }

  async listWorkItems(input: ManagedAgentPlatformWorkItemListInput = {}): Promise<StoredAgentWorkItemRecord[]> {
    const payload = await this.requestJson<ManagedAgentPlatformWorkItemListResult>("/api/platform/work-items/list", {
      ownerPrincipalId: this.ownerPrincipalId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });

    return (Array.isArray(payload.workItems) ? payload.workItems : []) as unknown as StoredAgentWorkItemRecord[];
  }

  async dispatchWorkItem(input: ManagedAgentPlatformWorkItemDispatchInput): Promise<ManagedAgentPlatformWorkItemDispatchResult> {
    return await this.requestJson<ManagedAgentPlatformWorkItemDispatchResult>("/api/platform/work-items/dispatch", {
      ownerPrincipalId: this.ownerPrincipalId,
      workItem: {
        targetAgentId: input.targetAgentId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.sourceType ? { sourceType: input.sourceType } : {}),
        ...(input.sourceAgentId ? { sourceAgentId: input.sourceAgentId } : {}),
        ...(input.sourcePrincipalId ? { sourcePrincipalId: input.sourcePrincipalId } : {}),
        ...(input.parentWorkItemId ? { parentWorkItemId: input.parentWorkItemId } : {}),
        dispatchReason: input.dispatchReason,
        goal: input.goal,
        ...(Object.prototype.hasOwnProperty.call(input, "contextPacket") ? { contextPacket: input.contextPacket } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "workspacePolicySnapshot")
          ? { workspacePolicySnapshot: input.workspacePolicySnapshot }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "runtimeProfileSnapshot")
          ? { runtimeProfileSnapshot: input.runtimeProfileSnapshot }
          : {}),
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
      },
    });
  }

  async cancelWorkItem(workItemId: string): Promise<ManagedAgentPlatformWorkItemCancelResult> {
    return await this.requestJson<ManagedAgentPlatformWorkItemCancelResult>("/api/platform/work-items/cancel", {
      ownerPrincipalId: this.ownerPrincipalId,
      workItemId,
    });
  }

  async respondToHumanWaitingWorkItem(
    input: ManagedAgentPlatformWorkItemRespondInput,
  ): Promise<ManagedAgentPlatformWorkItemRespondResult> {
    return await this.requestJson<ManagedAgentPlatformWorkItemRespondResult>("/api/platform/work-items/respond", {
      ownerPrincipalId: this.ownerPrincipalId,
      workItemId: input.workItemId,
      response: {
        ...(input.decision ? { decision: input.decision } : {}),
        ...(input.inputText ? { inputText: input.inputText } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "payload") ? { payload: input.payload } : {}),
        ...(input.artifactRefs ? { artifactRefs: input.artifactRefs } : {}),
      },
    });
  }

  async escalateWaitingAgentWorkItemToHuman(
    input: ManagedAgentPlatformWorkItemEscalateInput,
  ): Promise<ManagedAgentPlatformWorkItemEscalateResult> {
    return await this.requestJson<ManagedAgentPlatformWorkItemEscalateResult>("/api/platform/work-items/escalate", {
      ownerPrincipalId: this.ownerPrincipalId,
      workItemId: input.workItemId,
      ...(input.inputText ? { escalation: { inputText: input.inputText } } : {}),
    });
  }

  async listOrganizationWaitingQueue(
    filters: ManagedAgentPlatformGovernanceFiltersInput = {},
  ): Promise<ManagedAgentPlatformWaitingQueueResult> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformWaitingQueueResult>>(
      "/api/platform/agents/waiting/list",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        ...toGatewayGovernanceFilters(filters),
      },
    );

    return {
      summary: isRecord(payload.summary)
        ? {
            totalCount: toFiniteNumber(payload.summary.totalCount),
            waitingHumanCount: toFiniteNumber(payload.summary.waitingHumanCount),
            waitingAgentCount: toFiniteNumber(payload.summary.waitingAgentCount),
            escalationCount: toFiniteNumber(payload.summary.escalationCount),
          }
        : {
            totalCount: 0,
            waitingHumanCount: 0,
            waitingAgentCount: 0,
            escalationCount: 0,
          },
      items: Array.isArray(payload.items) ? payload.items : [],
    };
  }

  async getOrganizationGovernanceOverview(
    filters: ManagedAgentPlatformGovernanceFiltersInput = {},
  ): Promise<ManagedAgentPlatformGovernanceOverviewResult> {
    const payload = await this.requestJson<{ overview?: Partial<ManagedAgentPlatformGovernanceOverviewResult> }>(
      "/api/platform/agents/governance-overview",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        ...toGatewayGovernanceFilters(filters),
      },
    );
    const overview = isRecord(payload.overview) ? payload.overview : {};

    return {
      urgentParentCount: toFiniteNumber(overview.urgentParentCount),
      attentionParentCount: toFiniteNumber(overview.attentionParentCount),
      waitingHumanCount: toFiniteNumber(overview.waitingHumanCount),
      waitingAgentCount: toFiniteNumber(overview.waitingAgentCount),
      staleParentCount: toFiniteNumber(overview.staleParentCount),
      failedChildCount: toFiniteNumber(overview.failedChildCount),
      managersNeedingAttentionCount: toFiniteNumber(overview.managersNeedingAttentionCount),
      managerHotspots: Array.isArray(overview.managerHotspots) ? overview.managerHotspots : [],
    };
  }

  async listOrganizationCollaborationDashboard(
    filters: ManagedAgentPlatformGovernanceFiltersInput = {},
  ): Promise<ManagedAgentPlatformCollaborationDashboardResult> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformCollaborationDashboardResult>>(
      "/api/platform/agents/collaboration-dashboard",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        ...toGatewayGovernanceFilters(filters),
      },
    );

    return {
      summary: isRecord(payload.summary)
        ? {
            totalCount: toFiniteNumber(payload.summary.totalCount),
            urgentCount: toFiniteNumber(payload.summary.urgentCount),
            attentionCount: toFiniteNumber(payload.summary.attentionCount),
            normalCount: toFiniteNumber(payload.summary.normalCount),
          }
        : {
            totalCount: 0,
            urgentCount: 0,
            attentionCount: 0,
            normalCount: 0,
          },
      items: Array.isArray(payload.items) ? payload.items : [],
      parents: Array.isArray(payload.parents) ? payload.parents : [],
    };
  }

  async getWorkItemDetail(workItemId: string): Promise<ManagedAgentPlatformWorkItemDetailResult | null> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformWorkItemDetailResult> & {
      latestCompletion?: ManagedAgentPlatformWorkItemDetailResult["latestCompletion"];
    }>(
      "/api/platform/work-items/detail",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        workItemId,
      },
    );

    if (!payload.workItem) {
      return null;
    }

    const latestCompletion = normalizePlatformWorkerCompletionResult(payload.latestCompletion);
    return {
      organization: payload.organization ?? null,
      workItem: payload.workItem,
      targetAgent: payload.targetAgent ?? null,
      sourcePrincipal: payload.sourcePrincipal ?? null,
      sourceAgent: payload.sourceAgent ?? null,
      collaboration: {
        parentWorkItem: payload.collaboration?.parentWorkItem ?? null,
        parentTargetAgent: payload.collaboration?.parentTargetAgent ?? null,
        childSummary: payload.collaboration?.childSummary ?? {
          totalCount: 0,
          openCount: 0,
          waitingCount: 0,
          completedCount: 0,
          failedCount: 0,
          cancelledCount: 0,
        },
        childWorkItems: Array.isArray(payload.collaboration?.childWorkItems) ? payload.collaboration.childWorkItems : [],
      },
      runs: Array.isArray(payload.runs) ? payload.runs : [],
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      ...(latestCompletion !== undefined ? { latestCompletion } : {}),
    } as unknown as ManagedAgentPlatformWorkItemDetailResult;
  }

  async listRuns(input: ManagedAgentPlatformRunListInput = {}): Promise<NonNullable<ManagedAgentPlatformRunListResult["runs"]>> {
    const payload = await this.requestJson<ManagedAgentPlatformRunListResult>("/api/platform/runs/list", {
      ownerPrincipalId: this.ownerPrincipalId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.workItemId ? { workItemId: input.workItemId } : {}),
    });

    return Array.isArray(payload.runs) ? payload.runs : [];
  }

  async getRunDetail(runId: string): Promise<ManagedAgentRunDetailView | null> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformRunDetailResult> & {
      node?: ManagedAgentRunDetailView["node"];
      executionLease?: ManagedAgentRunDetailView["executionLease"];
      completionResult?: ManagedAgentRunDetailView["completionResult"];
    }>(
      "/api/platform/runs/detail",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        runId,
      },
    );

    if (!payload.run) {
      return null;
    }

    const completionResult = normalizePlatformWorkerCompletionResult(payload.completionResult);
    return {
      organization: payload.organization ?? null,
      run: payload.run,
      workItem: payload.workItem ?? null,
      targetAgent: payload.targetAgent ?? null,
      node: payload.node ?? null,
      executionLease: payload.executionLease ?? null,
      ...(completionResult !== undefined ? { completionResult } : {}),
    } as unknown as ManagedAgentRunDetailView;
  }

  async getAgentHandoffListView(
    input: ManagedAgentPlatformHandoffListInput,
  ): Promise<ManagedAgentPlatformHandoffListResult> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformHandoffListResult>>(
      "/api/platform/agents/handoffs/list",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        agentId: input.agentId,
        ...(input.workItemId ? { workItemId: input.workItemId } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      },
    );

    if (!payload.agent) {
      throw new Error("Managed agent does not exist.");
    }

    return {
      agent: payload.agent,
      handoffs: Array.isArray(payload.handoffs) ? payload.handoffs : [],
      timeline: Array.isArray(payload.timeline) ? payload.timeline : [],
    };
  }

  async getAgentMailboxListView(agentId: string): Promise<ManagedAgentPlatformMailboxListResult> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformMailboxListResult>>(
      "/api/platform/agents/mailbox/list",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        agentId,
      },
    );

    if (!payload.agent) {
      throw new Error("Managed agent does not exist.");
    }

    return {
      agent: payload.agent,
      items: Array.isArray(payload.items) ? payload.items : [],
    };
  }

  async pullMailboxEntry(agentId: string): Promise<ManagedAgentPlatformMailboxPullResult> {
    return await this.requestJson<ManagedAgentPlatformMailboxPullResult>("/api/platform/agents/mailbox/pull", {
      ownerPrincipalId: this.ownerPrincipalId,
      agentId,
    });
  }

  async ackMailboxEntry(agentId: string, mailboxEntryId: string): Promise<ManagedAgentPlatformMailboxAckResult> {
    return await this.requestJson<ManagedAgentPlatformMailboxAckResult>("/api/platform/agents/mailbox/ack", {
      ownerPrincipalId: this.ownerPrincipalId,
      agentId,
      mailboxEntryId,
    });
  }

  async respondToMailboxEntry(
    input: ManagedAgentPlatformMailboxRespondInput,
  ): Promise<ManagedAgentPlatformMailboxRespondResult> {
    return await this.requestJson<ManagedAgentPlatformMailboxRespondResult>("/api/platform/agents/mailbox/respond", {
      ownerPrincipalId: this.ownerPrincipalId,
      agentId: input.agentId,
      mailboxEntryId: input.mailboxEntryId,
      response: {
        ...(input.decision ? { decision: input.decision } : {}),
        ...(input.inputText ? { inputText: input.inputText } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "payload") ? { payload: input.payload } : {}),
        ...(input.artifactRefs ? { artifactRefs: input.artifactRefs } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
      },
    });
  }

  async registerNode(input: ManagedAgentPlatformWorkerNodeRegistrationInput): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestJson<ManagedAgentPlatformWorkerNodeMutationResult>("/api/platform/nodes/register", {
      ownerPrincipalId: this.ownerPrincipalId,
      node: {
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        displayName: input.displayName,
        slotCapacity: input.slotCapacity,
        ...(input.slotAvailable !== undefined ? { slotAvailable: input.slotAvailable } : {}),
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.workspaceCapabilities ? { workspaceCapabilities: input.workspaceCapabilities } : {}),
        ...(input.credentialCapabilities ? { credentialCapabilities: input.credentialCapabilities } : {}),
        ...(input.providerCapabilities ? { providerCapabilities: input.providerCapabilities } : {}),
        ...(input.secretCapabilities ? { secretCapabilities: input.secretCapabilities } : {}),
        ...(input.heartbeatTtlSeconds !== undefined ? { heartbeatTtlSeconds: input.heartbeatTtlSeconds } : {}),
      },
    });
  }

  async heartbeatNode(input: ManagedAgentPlatformWorkerNodeHeartbeatInput): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestJson<ManagedAgentPlatformWorkerNodeMutationResult>("/api/platform/nodes/heartbeat", {
      ownerPrincipalId: this.ownerPrincipalId,
      node: {
        nodeId: input.nodeId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.slotAvailable !== undefined ? { slotAvailable: input.slotAvailable } : {}),
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.workspaceCapabilities ? { workspaceCapabilities: input.workspaceCapabilities } : {}),
        ...(input.credentialCapabilities ? { credentialCapabilities: input.credentialCapabilities } : {}),
        ...(input.providerCapabilities ? { providerCapabilities: input.providerCapabilities } : {}),
        ...(input.secretCapabilities ? { secretCapabilities: input.secretCapabilities } : {}),
        ...(input.heartbeatTtlSeconds !== undefined ? { heartbeatTtlSeconds: input.heartbeatTtlSeconds } : {}),
      },
    });
  }

  async listNodes(input: ManagedAgentPlatformWorkerNodeListInput = {}): Promise<ManagedAgentPlatformWorkerNodeRecord[]> {
    const payload = await this.requestJson<{ nodes?: ManagedAgentPlatformWorkerNodeRecord[] }>("/api/platform/nodes/list", {
      ownerPrincipalId: this.ownerPrincipalId,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    });

    return Array.isArray(payload.nodes) ? payload.nodes : [];
  }

  async getNodeDetail(nodeId: string): Promise<ManagedAgentPlatformWorkerNodeDetailResult | null> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformWorkerNodeDetailResult>>(
      "/api/platform/nodes/detail",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        nodeId,
      },
    );

    if (!payload.node || !payload.organization) {
      return null;
    }

    return {
      organization: payload.organization,
      node: payload.node,
      leaseSummary: payload.leaseSummary ?? {
        totalCount: 0,
        activeCount: 0,
        expiredCount: 0,
        releasedCount: 0,
        revokedCount: 0,
      },
      activeExecutionLeases: Array.isArray(payload.activeExecutionLeases) ? payload.activeExecutionLeases : [],
      recentExecutionLeases: Array.isArray(payload.recentExecutionLeases) ? payload.recentExecutionLeases : [],
    };
  }

  async markNodeDraining(nodeId: string): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestNodeGovernanceMutation("/api/platform/nodes/drain", nodeId);
  }

  async markNodeOffline(nodeId: string): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestNodeGovernanceMutation("/api/platform/nodes/offline", nodeId);
  }

  async reclaimNodeLeases(
    input: ManagedAgentPlatformWorkerNodeLeaseReclaimInput,
  ): Promise<ManagedAgentPlatformWorkerNodeLeaseRecoveryResult> {
    return await this.requestJson<ManagedAgentPlatformWorkerNodeLeaseRecoveryResult>("/api/platform/nodes/reclaim", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId: input.nodeId,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
    });
  }

  async pushWorkerSecret(input: ManagedAgentPlatformWorkerSecretPushInput): Promise<ManagedAgentPlatformWorkerSecretPushResult> {
    return await this.requestJson<ManagedAgentPlatformWorkerSecretPushResult>("/api/platform/worker/secrets/push", {
      ownerPrincipalId: this.ownerPrincipalId,
      delivery: {
        nodeId: input.nodeId,
        secretRef: input.secretRef,
        value: input.value,
      },
    });
  }

  async pullAssignedRun(input: ManagedAgentPlatformWorkerPullInput): Promise<ManagedAgentPlatformWorkerAssignedRunResult | null> {
    const payload = await this.requestJson<Partial<ManagedAgentPlatformWorkerAssignedRunResult>>(
      "/api/platform/worker/runs/pull",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        nodeId: input.nodeId,
      },
    );

    if (
      !payload.organization
      || !payload.run
      || !payload.executionLease
      || !payload.executionContract
      || !payload.node
      || !payload.targetAgent
      || !payload.workItem
    ) {
      return null;
    }

    return {
      organization: payload.organization,
      node: payload.node,
      targetAgent: payload.targetAgent,
      workItem: payload.workItem,
      run: payload.run,
      executionLease: payload.executionLease,
      executionContract: payload.executionContract,
    };
  }

  async updateWorkerRunStatus(
    input: ManagedAgentPlatformWorkerRunStatusInput,
  ): Promise<ManagedAgentPlatformWorkerRunMutationResult> {
    return await this.requestJson<ManagedAgentPlatformWorkerRunMutationResult>("/api/platform/worker/runs/update", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId: input.nodeId,
      runId: input.runId,
      leaseToken: input.leaseToken,
      status: input.status,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
      ...(input.waitingAction ? { waitingAction: input.waitingAction } : {}),
    });
  }

  async completeWorkerRun(
    input: ManagedAgentPlatformWorkerRunCompleteInput,
  ): Promise<ManagedAgentPlatformWorkerRunMutationResult> {
    return await this.requestJson<ManagedAgentPlatformWorkerRunMutationResult>("/api/platform/worker/runs/complete", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId: input.nodeId,
      runId: input.runId,
      leaseToken: input.leaseToken,
      ...(Object.prototype.hasOwnProperty.call(input, "result") ? { result: input.result } : {}),
    });
  }

  private async requestJson<T>(pathname: string, payload: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildPlatformServiceAuthorizationHeader(this.webAccessToken),
      },
      body: JSON.stringify(payload),
    });
    const parsed = await readJsonResponse(response);

    if (!response.ok) {
      const gatewayError = buildPlatformGatewayHttpError(parsed, response.status);
      if (gatewayError) {
        throw gatewayError;
      }
      throw new Error(resolveHttpErrorMessage(parsed, response.status, `平台请求失败：${pathname}`));
    }

    return parsed as T;
  }

  private async requestNodeGovernanceMutation(
    pathname: string,
    nodeId: string,
  ): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestJson<ManagedAgentPlatformWorkerNodeMutationResult>(pathname, {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId,
    });
  }
}

export function readManagedAgentPlatformGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): ManagedAgentPlatformGatewayConfig | null {
  const baseUrl = normalizeOptionalText(env.THEMIS_PLATFORM_BASE_URL);
  const ownerPrincipalId = normalizeOptionalText(env.THEMIS_PLATFORM_OWNER_PRINCIPAL_ID);
  const webAccessToken = normalizeOptionalText(env.THEMIS_PLATFORM_WEB_ACCESS_TOKEN);

  if (!baseUrl && !ownerPrincipalId && !webAccessToken) {
    return null;
  }

  if (!baseUrl || !ownerPrincipalId || !webAccessToken) {
    throw new Error(
      "THEMIS_PLATFORM_BASE_URL / THEMIS_PLATFORM_OWNER_PRINCIPAL_ID / THEMIS_PLATFORM_WEB_ACCESS_TOKEN 必须同时配置，才能启用主 Themis Gateway 模式。",
    );
  }

  return {
    baseUrl: trimTrailingSlash(baseUrl),
    ownerPrincipalId,
    webAccessToken,
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      raw: text,
    };
  }
}

function resolveHttpErrorMessage(payload: unknown, status: number, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }

  return `${fallback}（HTTP ${status}）`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOptionalRecordText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? normalizeOptionalText(value) : null;
}

function readOptionalRecordStringArray(record: Record<string, unknown>, key: string): string[] | null {
  const value = record[key];

  if (!Array.isArray(value)) {
    return null;
  }

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function toGatewayWorkspacePolicyPayload(
  workspacePolicy: NonNullable<ManagedAgentPlatformAgentExecutionBoundaryUpdateInput["workspacePolicy"]>,
): Record<string, unknown> {
  const payload = { ...workspacePolicy } as Record<string, unknown>;
  const canonicalWorkspacePath = readOptionalRecordText(payload, "canonicalWorkspacePath")
    ?? readOptionalRecordText(payload, "workspacePath");
  const additionalWorkspacePaths = readOptionalRecordStringArray(payload, "additionalWorkspacePaths")
    ?? readOptionalRecordStringArray(payload, "additionalDirectories");

  if (canonicalWorkspacePath) {
    payload.canonicalWorkspacePath = canonicalWorkspacePath;
  }

  if (additionalWorkspacePaths) {
    payload.additionalWorkspacePaths = additionalWorkspacePaths;
  }

  return payload;
}

function normalizeGatewayWorkspacePolicy<T>(workspacePolicy: T): T {
  if (!isRecord(workspacePolicy)) {
    return workspacePolicy;
  }

  const normalized: Record<string, unknown> = { ...workspacePolicy };
  const workspacePath = readOptionalRecordText(normalized, "workspacePath")
    ?? readOptionalRecordText(normalized, "canonicalWorkspacePath");
  const additionalDirectories = readOptionalRecordStringArray(normalized, "additionalDirectories")
    ?? readOptionalRecordStringArray(normalized, "additionalWorkspacePaths");

  if (workspacePath) {
    normalized.workspacePath = workspacePath;
    normalized.canonicalWorkspacePath = readOptionalRecordText(normalized, "canonicalWorkspacePath") ?? workspacePath;
  }

  if (additionalDirectories) {
    normalized.additionalDirectories = additionalDirectories;
    normalized.additionalWorkspacePaths = readOptionalRecordStringArray(normalized, "additionalWorkspacePaths")
      ?? additionalDirectories;
  }

  return normalized as T;
}

function normalizeGatewayExecutionBoundaryResult<T extends {
  workspacePolicy?: unknown;
}>(payload: T): T {
  return {
    ...payload,
    workspacePolicy: normalizeGatewayWorkspacePolicy(payload.workspacePolicy),
  };
}

function toGatewayGovernanceFilters(filters: OrganizationGovernanceFilters): Record<string, unknown> {
  return {
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(filters.managerAgentId ? { managerAgentId: filters.managerAgentId } : {}),
    ...(filters.attentionOnly !== undefined ? { attentionOnly: filters.attentionOnly } : {}),
    ...(filters.attentionLevels ? { attentionLevels: filters.attentionLevels } : {}),
    ...(filters.waitingFor ? { waitingFor: filters.waitingFor } : {}),
    ...(filters.staleOnly !== undefined ? { staleOnly: filters.staleOnly } : {}),
    ...(filters.failedOnly !== undefined ? { failedOnly: filters.failedOnly } : {}),
    ...(filters.limit !== undefined ? { limit: filters.limit } : {}),
  };
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizePlatformWorkerCompletionResult(
  value: unknown,
): ManagedAgentRunDetailView["completionResult"] | undefined {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const summary = normalizeOptionalText(typeof value.summary === "string" ? value.summary : null);

  if (!summary) {
    return undefined;
  }

  const completedAt = normalizeOptionalText(typeof value.completedAt === "string" ? value.completedAt : null);
  const structuredOutput = isRecord(value.structuredOutput) || value.structuredOutput === null
    ? value.structuredOutput as Record<string, unknown> | null
    : undefined;
  const insight = deriveManagedAgentCompletionInsight(structuredOutput);
  return {
    summary,
    ...(Object.prototype.hasOwnProperty.call(value, "output") ? { output: value.output } : {}),
    ...(Array.isArray(value.touchedFiles)
      ? { touchedFiles: value.touchedFiles.filter((entry): entry is string => typeof entry === "string") }
      : {}),
    ...(structuredOutput !== undefined ? { structuredOutput } : {}),
    ...(completedAt ? { completedAt } : {}),
    detailLevel: insight.detailLevel,
    interpretationHint: insight.interpretationHint,
  };
}

function buildPlatformGatewayHttpError(payload: unknown, statusCode: number): PlatformGatewayHttpError | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  const errorCode = typeof payload.error.code === "string" ? payload.error.code.trim() : "";
  const message = typeof payload.error.message === "string" ? payload.error.message.trim() : "";

  if (!errorCode || !message) {
    return null;
  }

  const details = isRecord(payload.error.details) ? payload.error.details : undefined;
  return new PlatformGatewayHttpError(statusCode, errorCode, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
