import type { UpsertProjectWorkspaceBindingInput } from "../core/managed-agents-service.js";
import type { StoredProjectWorkspaceBindingRecord } from "../types/index.js";
import type { ManagedAgentPlatformOwnerPayload } from "./managed-agent-platform-worker.js";

export interface ManagedAgentPlatformProjectWorkspaceBindingListInput {
  organizationId?: string;
}

export interface ManagedAgentPlatformProjectWorkspaceBindingDetailInput {
  projectId: string;
}

export type ManagedAgentPlatformProjectWorkspaceBindingUpsertInput =
  Omit<UpsertProjectWorkspaceBindingInput, "ownerPrincipalId" | "now">;

export interface ManagedAgentPlatformProjectWorkspaceBindingListPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformProjectWorkspaceBindingListInput {}

export interface ManagedAgentPlatformProjectWorkspaceBindingDetailPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformProjectWorkspaceBindingDetailInput {}

export interface ManagedAgentPlatformProjectWorkspaceBindingUpsertPayload extends ManagedAgentPlatformOwnerPayload {
  binding: ManagedAgentPlatformProjectWorkspaceBindingUpsertInput;
}

export type ManagedAgentPlatformProjectWorkspaceBindingRecord = StoredProjectWorkspaceBindingRecord;

export interface ManagedAgentPlatformProjectWorkspaceBindingListResult {
  bindings?: ManagedAgentPlatformProjectWorkspaceBindingRecord[];
}

export interface ManagedAgentPlatformProjectWorkspaceBindingDetailResult {
  binding?: ManagedAgentPlatformProjectWorkspaceBindingRecord | null;
}

export interface ManagedAgentPlatformProjectWorkspaceBindingUpsertResult {
  binding: ManagedAgentPlatformProjectWorkspaceBindingRecord;
}
