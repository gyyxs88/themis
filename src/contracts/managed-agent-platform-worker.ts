import type {
  ManagedAgentNodeDetailView,
  ManagedAgentNodeExecutionLeaseContext,
  ManagedAgentNodeLeaseRecoveryAction,
  ManagedAgentNodeLeaseRecoveryResult,
  ManagedAgentNodeLeaseRecoverySummary,
  ManagedAgentNodeLeaseSummary,
  ManagedAgentNodeMutationResult,
  ManagedAgentNodeReclaimedLeaseContext,
} from "../core/managed-agent-node-service.js";
import type {
  ManagedAgentWorkerAssignedRun,
  ManagedAgentWorkerCompletionPayload,
  ManagedAgentWorkerRunMutationResult,
  ManagedAgentWorkerWaitingActionPayload,
  UpdateManagedAgentWorkerRunStatusInput,
} from "../core/managed-agent-worker-service.js";
import type {
  ManagedAgentNodeStatus,
  StoredManagedAgentNodeRecord,
  StoredOrganizationRecord,
} from "../types/index.js";

export interface ManagedAgentPlatformOwnerPayload {
  ownerPrincipalId: string;
}

export interface ManagedAgentPlatformWorkerNodeRegistrationInput {
  nodeId?: string;
  organizationId?: string;
  displayName: string;
  slotCapacity: number;
  slotAvailable?: number;
  labels?: string[];
  workspaceCapabilities?: string[];
  credentialCapabilities?: string[];
  providerCapabilities?: string[];
  heartbeatTtlSeconds?: number;
}

export interface ManagedAgentPlatformWorkerNodeHeartbeatInput {
  nodeId: string;
  status?: ManagedAgentNodeStatus;
  slotAvailable?: number;
  labels?: string[];
  workspaceCapabilities?: string[];
  credentialCapabilities?: string[];
  providerCapabilities?: string[];
  heartbeatTtlSeconds?: number;
}

export interface ManagedAgentPlatformWorkerNodeListInput {
  organizationId?: string;
}

export interface ManagedAgentPlatformWorkerNodeDetailInput {
  nodeId: string;
}

export interface ManagedAgentPlatformWorkerNodeLeaseReclaimInput extends ManagedAgentPlatformWorkerNodeDetailInput {
  failureCode?: string;
  failureMessage?: string;
}

export interface ManagedAgentPlatformWorkerPullInput {
  nodeId: string;
}

export type ManagedAgentPlatformWorkerRunStatus = UpdateManagedAgentWorkerRunStatusInput["status"];
export type ManagedAgentPlatformWorkerWaitingActionPayload = ManagedAgentWorkerWaitingActionPayload;
export type ManagedAgentPlatformWorkerCompletionResult = ManagedAgentWorkerCompletionPayload;

export interface ManagedAgentPlatformWorkerRunStatusInput extends ManagedAgentPlatformWorkerPullInput {
  runId: string;
  leaseToken: string;
  status: ManagedAgentPlatformWorkerRunStatus;
  failureCode?: string;
  failureMessage?: string;
  waitingAction?: ManagedAgentPlatformWorkerWaitingActionPayload;
}

export interface ManagedAgentPlatformWorkerRunCompleteInput extends ManagedAgentPlatformWorkerPullInput {
  runId: string;
  leaseToken: string;
  result?: ManagedAgentPlatformWorkerCompletionResult;
}

export interface ManagedAgentPlatformNodeRegisterPayload extends ManagedAgentPlatformOwnerPayload {
  node: ManagedAgentPlatformWorkerNodeRegistrationInput;
}

export interface ManagedAgentPlatformNodeHeartbeatPayload extends ManagedAgentPlatformOwnerPayload {
  node: ManagedAgentPlatformWorkerNodeHeartbeatInput;
}

export interface ManagedAgentPlatformNodeListPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkerNodeListInput {}

export interface ManagedAgentPlatformNodeDetailPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkerNodeDetailInput {}

export interface ManagedAgentPlatformNodeReclaimPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkerNodeLeaseReclaimInput {}

export interface ManagedAgentPlatformWorkerPullPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkerPullInput {}

export interface ManagedAgentPlatformWorkerRunStatusPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkerRunStatusInput {}

export interface ManagedAgentPlatformWorkerRunCompletePayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkerRunCompleteInput {}

export type ManagedAgentPlatformWorkerOrganizationRecord = StoredOrganizationRecord;
export type ManagedAgentPlatformWorkerNodeRecord = StoredManagedAgentNodeRecord;
export type ManagedAgentPlatformWorkerNodeLeaseSummary = ManagedAgentNodeLeaseSummary;
export type ManagedAgentPlatformWorkerNodeExecutionLeaseContext = ManagedAgentNodeExecutionLeaseContext;
export type ManagedAgentPlatformWorkerNodeLeaseRecoveryAction = ManagedAgentNodeLeaseRecoveryAction;
export type ManagedAgentPlatformWorkerReclaimedLeaseContext = ManagedAgentNodeReclaimedLeaseContext;
export type ManagedAgentPlatformWorkerNodeLeaseRecoverySummary = ManagedAgentNodeLeaseRecoverySummary;
export type ManagedAgentPlatformWorkerNodeMutationResult = ManagedAgentNodeMutationResult;
export type ManagedAgentPlatformWorkerNodeDetailResult = ManagedAgentNodeDetailView;
export type ManagedAgentPlatformWorkerNodeLeaseRecoveryResult = ManagedAgentNodeLeaseRecoveryResult;
export type ManagedAgentPlatformWorkerAssignedRunResult = ManagedAgentWorkerAssignedRun;
export type ManagedAgentPlatformWorkerRunMutationResult = ManagedAgentWorkerRunMutationResult;

export interface ManagedAgentPlatformWorkerProbeResult {
  nodeCount: number;
}
