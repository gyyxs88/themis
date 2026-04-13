import type {
  ManagedAgentIdleRecoverySuggestionsView,
  ManagedAgentLifecycleUpdateInput,
  ManagedAgentListView,
  ManagedAgentSpawnSuggestionsView,
} from "../core/managed-agent-control-plane-facade.js";
import type {
  OrganizationCollaborationDashboardResult,
  OrganizationGovernanceFilters,
  OrganizationGovernanceOverview,
  OrganizationWaitingQueueResult,
} from "../core/managed-agent-coordination-service.js";
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
  UpdateManagedAgentExecutionBoundaryInput,
  UpdateManagedAgentSpawnPolicyInput,
} from "../core/managed-agents-service.js";
import type { StoredAgentSpawnPolicyRecord } from "../types/index.js";
import type { ManagedAgentPlatformOwnerPayload } from "./managed-agent-platform-worker.js";

export type ManagedAgentPlatformAgentCreateInput =
  Omit<CreateManagedAgentInput, "ownerPrincipalId" | "createdByPrincipalId" | "principalId" | "agentId" | "slug" | "autonomyLevel" | "creationMode" | "exposurePolicy" | "status" | "now">;

export interface ManagedAgentPlatformAgentCreatePayload extends ManagedAgentPlatformOwnerPayload {
  agent: ManagedAgentPlatformAgentCreateInput;
}

export interface ManagedAgentPlatformAgentDetailInput {
  agentId: string;
}

export interface ManagedAgentPlatformAgentDetailPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformAgentDetailInput {}

export type ManagedAgentPlatformAgentExecutionBoundaryUpdateInput =
  Omit<UpdateManagedAgentExecutionBoundaryInput, "ownerPrincipalId" | "now">;

export interface ManagedAgentPlatformAgentExecutionBoundaryUpdatePayload extends ManagedAgentPlatformOwnerPayload {
  agentId: string;
  boundary: {
    workspacePolicy?: ManagedAgentPlatformAgentExecutionBoundaryUpdateInput["workspacePolicy"];
    runtimeProfile?: ManagedAgentPlatformAgentExecutionBoundaryUpdateInput["runtimeProfile"];
  };
}

export type ManagedAgentPlatformAgentSpawnPolicyUpdateInput =
  Omit<UpdateManagedAgentSpawnPolicyInput, "ownerPrincipalId" | "now">;

export interface ManagedAgentPlatformAgentSpawnPolicyUpdatePayload extends ManagedAgentPlatformOwnerPayload {
  policy: ManagedAgentPlatformAgentSpawnPolicyUpdateInput;
}

export type ManagedAgentPlatformAgentSpawnApproveInput =
  Omit<ApproveManagedAgentSpawnSuggestionInput, "ownerPrincipalId" | "now">;

export interface ManagedAgentPlatformAgentSpawnApprovePayload extends ManagedAgentPlatformOwnerPayload {
  agent: ManagedAgentPlatformAgentSpawnApproveInput;
}

export type ManagedAgentPlatformAgentSpawnSuggestionActionInput =
  Omit<ManagedAgentSpawnSuggestionDecisionInput, "ownerPrincipalId" | "now">;

export interface ManagedAgentPlatformAgentSpawnSuggestionActionPayload extends ManagedAgentPlatformOwnerPayload {
  suggestion: ManagedAgentPlatformAgentSpawnSuggestionActionInput;
}

export type ManagedAgentPlatformAgentSpawnSuggestionRestoreInput =
  Omit<RestoreManagedAgentSpawnSuggestionInput, "ownerPrincipalId" | "now">;

export interface ManagedAgentPlatformAgentSpawnSuggestionRestorePayload extends ManagedAgentPlatformOwnerPayload {
  suggestion: ManagedAgentPlatformAgentSpawnSuggestionRestoreInput;
}

export type ManagedAgentPlatformAgentIdleApproveInput =
  Omit<ApproveManagedAgentIdleRecoverySuggestionInput, "ownerPrincipalId" | "now">;

export interface ManagedAgentPlatformAgentIdleApprovePayload extends ManagedAgentPlatformOwnerPayload {
  suggestion: ManagedAgentPlatformAgentIdleApproveInput;
}

export type ManagedAgentPlatformAgentLifecycleInput =
  Omit<ManagedAgentLifecycleUpdateInput, "ownerPrincipalId" | "now">;

export interface ManagedAgentPlatformAgentLifecyclePayload
  extends ManagedAgentPlatformOwnerPayload, Pick<ManagedAgentPlatformAgentLifecycleInput, "agentId"> {}

export type ManagedAgentPlatformGovernanceFiltersInput = Omit<OrganizationGovernanceFilters, "now">;

export interface ManagedAgentPlatformGovernanceFiltersPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformGovernanceFiltersInput {}

export interface ManagedAgentPlatformWaitingQueueListPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformGovernanceFiltersInput {}

export interface ManagedAgentPlatformCollaborationDashboardPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformGovernanceFiltersInput {}

export type ManagedAgentPlatformAgentListResult = ManagedAgentListView;
export type ManagedAgentPlatformAgentCreateResult = CreateManagedAgentResult;
export type ManagedAgentPlatformAgentExecutionBoundaryUpdateResult = ManagedAgentExecutionBoundaryView;
export interface ManagedAgentPlatformAgentSpawnPolicyUpdateResult {
  policy: StoredAgentSpawnPolicyRecord;
}
export type ManagedAgentPlatformAgentSpawnApproveResult = ApproveManagedAgentSpawnSuggestionResult;
export type ManagedAgentPlatformAgentSpawnSuggestionActionResult = ManagedAgentSpawnSuggestionDecisionResult;
export interface ManagedAgentPlatformAgentSpawnSuggestionRestoreResult {
  auditLog: ManagedAgentSpawnSuggestionDecisionResult["auditLog"];
}
export type ManagedAgentPlatformAgentIdleApproveResult = ApproveManagedAgentIdleRecoverySuggestionResult;
export type ManagedAgentPlatformAgentLifecycleResult = ManagedAgentOwnerView;
export type ManagedAgentPlatformAgentSpawnSuggestionsResult = ManagedAgentSpawnSuggestionsView;
export type ManagedAgentPlatformAgentIdleRecoverySuggestionsResult = ManagedAgentIdleRecoverySuggestionsView;
export type ManagedAgentPlatformWaitingQueueResult = OrganizationWaitingQueueResult;
export type ManagedAgentPlatformGovernanceOverviewResult = OrganizationGovernanceOverview;
export type ManagedAgentPlatformCollaborationDashboardResult = OrganizationCollaborationDashboardResult;

export interface ManagedAgentPlatformAgentDetailResult {
  organization: ManagedAgentDetailView["organization"];
  principal: ManagedAgentDetailView["principal"];
  agent: ManagedAgentDetailView["agent"];
  workspacePolicy: ManagedAgentDetailView["workspacePolicy"];
  runtimeProfile: ManagedAgentDetailView["runtimeProfile"];
  authAccounts: ManagedAgentDetailView["authAccounts"];
  thirdPartyProviders: ManagedAgentDetailView["thirdPartyProviders"];
}
