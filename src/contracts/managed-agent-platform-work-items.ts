import type {
  CancelWorkItemResult,
  DispatchWorkItemInput,
  DispatchWorkItemResult,
  EscalateWaitingAgentWorkItemToHumanInput,
  EscalateWaitingAgentWorkItemToHumanResult,
  ManagedAgentWorkItemDetailView,
  RespondToHumanWaitingWorkItemInput,
  RespondToHumanWaitingWorkItemResult,
} from "../core/managed-agent-coordination-service.js";
import type { StoredAgentWorkItemRecord } from "../types/index.js";
import type { ManagedAgentPlatformOwnerPayload } from "./managed-agent-platform-worker.js";

export interface ManagedAgentPlatformWorkItemListInput {
  agentId?: string;
}

export type ManagedAgentPlatformWorkItemDispatchInput = Omit<DispatchWorkItemInput, "ownerPrincipalId">;

export interface ManagedAgentPlatformWorkItemDetailInput {
  workItemId: string;
}

export type ManagedAgentPlatformWorkItemRespondInput = Omit<RespondToHumanWaitingWorkItemInput, "ownerPrincipalId">;
export type ManagedAgentPlatformWorkItemEscalateInput = Omit<
  EscalateWaitingAgentWorkItemToHumanInput,
  "ownerPrincipalId"
>;

export interface ManagedAgentPlatformWorkItemResponsePayload {
  decision?: "approve" | "deny";
  inputText?: string;
  payload?: unknown;
  artifactRefs?: string[];
}

export interface ManagedAgentPlatformWorkItemEscalationPayload {
  inputText?: string;
}

export interface ManagedAgentPlatformWorkItemListPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkItemListInput {}

export interface ManagedAgentPlatformWorkItemDispatchPayload extends ManagedAgentPlatformOwnerPayload {
  workItem: ManagedAgentPlatformWorkItemDispatchInput;
}

export interface ManagedAgentPlatformWorkItemDetailPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkItemDetailInput {}

export interface ManagedAgentPlatformWorkItemCancelPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformWorkItemDetailInput {}

export interface ManagedAgentPlatformWorkItemRespondPayload extends ManagedAgentPlatformOwnerPayload {
  workItemId: string;
  response: ManagedAgentPlatformWorkItemResponsePayload;
}

export interface ManagedAgentPlatformWorkItemEscalatePayload extends ManagedAgentPlatformOwnerPayload {
  workItemId: string;
  escalation?: ManagedAgentPlatformWorkItemEscalationPayload;
}

export interface ManagedAgentPlatformWorkItemListResult {
  workItems?: StoredAgentWorkItemRecord[];
}

export type ManagedAgentPlatformWorkItemDetailResult = ManagedAgentWorkItemDetailView;
export type ManagedAgentPlatformWorkItemDispatchResult = DispatchWorkItemResult;
export type ManagedAgentPlatformWorkItemCancelResult = CancelWorkItemResult;
export type ManagedAgentPlatformWorkItemRespondResult = RespondToHumanWaitingWorkItemResult;
export type ManagedAgentPlatformWorkItemEscalateResult = EscalateWaitingAgentWorkItemToHumanResult;
