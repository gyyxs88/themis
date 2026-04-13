import type { SqliteCodexSessionRegistry } from "./codex-session-registry.js";

export type ManagedAgentsStore = Pick<SqliteCodexSessionRegistry,
  | "deleteAgentSpawnSuggestionState"
  | "getActiveAuthAccount"
  | "getAgentRuntimeProfile"
  | "getAgentRuntimeProfileByOwnerAgent"
  | "getAgentSpawnPolicy"
  | "getAgentSpawnSuggestionState"
  | "getAgentWorkItem"
  | "getAgentWorkspacePolicy"
  | "getAgentWorkspacePolicyByOwnerAgent"
  | "getAuthAccount"
  | "getManagedAgent"
  | "getProjectWorkspaceBinding"
  | "getOrganization"
  | "getPrincipal"
  | "listAgentAuditLogsByOrganization"
  | "listAuthAccounts"
  | "listAgentHandoffsByAgent"
  | "listAgentMailboxEntriesByAgent"
  | "listAgentMessagesByAgent"
  | "listAgentSpawnSuggestionStatesByOrganization"
  | "listAgentWorkItemsByOwnerPrincipal"
  | "listAgentWorkItemsByParentWorkItem"
  | "listAgentWorkItemsByTargetAgent"
  | "listManagedAgentsByOrganization"
  | "listManagedAgentsByOwnerPrincipal"
  | "listOrganizationsByOwnerPrincipal"
  | "listProjectWorkspaceBindingsByOrganization"
  | "listThirdPartyProviderModels"
  | "listThirdPartyProviders"
  | "saveAgentAuditLog"
  | "saveAgentRuntimeProfile"
  | "saveAgentSpawnPolicy"
  | "saveAgentSpawnSuggestionState"
  | "saveAgentWorkItem"
  | "saveAgentWorkspacePolicy"
  | "saveManagedAgent"
  | "saveProjectWorkspaceBinding"
  | "saveOrganization"
  | "savePrincipal"
  | "saveThirdPartyProvider"
  | "saveThirdPartyProviderModel"
>;

export type ManagedAgentCoordinationStore = Pick<SqliteCodexSessionRegistry,
  | "claimNextAgentMailboxEntry"
  | "getActiveAgentExecutionLeaseByRun"
  | "getAgentHandoff"
  | "getAgentMailboxEntry"
  | "getAgentMessage"
  | "getAgentRun"
  | "getAgentRuntimeProfile"
  | "getAgentRuntimeProfileByOwnerAgent"
  | "getAgentWorkItem"
  | "getAgentWorkspacePolicy"
  | "getAgentWorkspacePolicyByOwnerAgent"
  | "getManagedAgent"
  | "getManagedAgentNode"
  | "getProjectWorkspaceBinding"
  | "getOrganization"
  | "getPrincipal"
  | "listAgentHandoffsByAgent"
  | "listAgentHandoffsByWorkItem"
  | "listAgentMailboxEntriesByAgent"
  | "listAgentMessagesByAgent"
  | "listAgentMessagesByWorkItem"
  | "listAgentRunsByWorkItem"
  | "listAgentWorkItemsByOwnerPrincipal"
  | "listAgentWorkItemsByParentWorkItem"
  | "listAgentWorkItemsByTargetAgent"
  | "listManagedAgentsByOrganization"
  | "saveAgentHandoff"
  | "saveAgentExecutionLease"
  | "saveAgentMailboxEntry"
  | "saveAgentMessage"
  | "saveManagedAgentNode"
  | "saveAgentRun"
  | "saveAgentWorkItem"
>;

export type ManagedAgentSchedulerStore = Pick<SqliteCodexSessionRegistry,
  | "claimNextRunnableAgentWorkItem"
  | "getActiveAgentExecutionLeaseByRun"
  | "getManagedAgentNode"
  | "getAgentRun"
  | "getAgentWorkItem"
  | "getManagedAgent"
  | "getProjectWorkspaceBinding"
  | "getOrganization"
  | "getPrincipal"
  | "listActiveAgentExecutionLeases"
  | "listAgentExecutionLeasesByRun"
  | "listAgentRunsByWorkItem"
  | "listManagedAgentNodesByOrganization"
  | "listAgentRunsByOwnerPrincipal"
  | "listStaleActiveAgentRuns"
  | "saveAgentExecutionLease"
  | "saveManagedAgentNode"
  | "saveProjectWorkspaceBinding"
  | "saveAgentRun"
  | "saveAgentWorkItem"
>;

export type ManagedAgentLeaseRecoveryStore = Pick<SqliteCodexSessionRegistry,
  | "getAgentRun"
  | "getAgentWorkItem"
  | "getManagedAgent"
  | "saveAgentExecutionLease"
  | "saveAgentRun"
  | "saveAgentWorkItem"
>;

export type ManagedAgentNodeStore = Pick<SqliteCodexSessionRegistry,
  | "saveAgentExecutionLease"
  | "saveAgentRun"
  | "saveAgentWorkItem"
  | "getAgentRun"
  | "getAgentWorkItem"
  | "getManagedAgent"
  | "getManagedAgentNode"
  | "getOrganization"
  | "getPrincipal"
  | "listAgentExecutionLeasesByNode"
  | "listManagedAgentNodesByOrganization"
  | "listOrganizationsByOwnerPrincipal"
  | "saveManagedAgentNode"
>;

export type ManagedAgentExecutionLeaseStore = Pick<SqliteCodexSessionRegistry,
  | "getAgentExecutionLease"
  | "getActiveAgentExecutionLeaseByRun"
  | "listAgentExecutionLeasesByNode"
  | "listAgentExecutionLeasesByRun"
  | "saveAgentExecutionLease"
>;

export type ManagedAgentExecutionStateStore = Pick<SqliteCodexSessionRegistry,
  | "getAgentWorkItem"
  | "getManagedAgent"
  | "getPrincipal"
  | "getSessionTaskSettings"
  | "listAgentMessagesByWorkItem"
  | "saveAgentWorkItem"
  | "saveManagedAgent"
  | "saveSessionTaskSettings"
>;

export type ManagedAgentExecutionStateLocalStore = Pick<SqliteCodexSessionRegistry,
  | "getSessionTaskSettings"
  | "saveSessionTaskSettings"
>;

export type ManagedAgentWorkerStore = Pick<SqliteCodexSessionRegistry,
  | "getActiveAgentExecutionLeaseByRun"
  | "getAgentRun"
  | "getAgentWorkItem"
  | "getManagedAgent"
  | "getManagedAgentNode"
  | "getOrganization"
  | "getPrincipal"
  | "listAgentMessagesByWorkItem"
  | "listAgentExecutionLeasesByNode"
  | "listAgentExecutionLeasesByRun"
  | "listManagedAgentNodesByOrganization"
  | "listOrganizationsByOwnerPrincipal"
  | "saveManagedAgentNode"
  | "saveAgentExecutionLease"
  | "saveAgentRun"
  | "saveAgentWorkItem"
  | "saveManagedAgent"
>;

export type ManagedAgentControlPlaneSharedStore =
  & ManagedAgentsStore
  & ManagedAgentCoordinationStore
  & ManagedAgentSchedulerStore
  & ManagedAgentNodeStore
  & ManagedAgentExecutionLeaseStore
  & ManagedAgentWorkerStore;

export interface ManagedAgentControlPlaneStore {
  readonly managedAgentsStore: ManagedAgentsStore;
  readonly coordinationStore: ManagedAgentCoordinationStore;
  readonly schedulerStore: ManagedAgentSchedulerStore;
  readonly nodeStore: ManagedAgentNodeStore;
  readonly executionLeaseStore: ManagedAgentExecutionLeaseStore;
  readonly executionStateStore: ManagedAgentExecutionStateStore;
  readonly workerStore: ManagedAgentWorkerStore;
}

export interface CompositeManagedAgentControlPlaneStoreOptions {
  sharedStore: ManagedAgentControlPlaneSharedStore;
  executionStateStore: ManagedAgentExecutionStateStore;
}

export interface SplitManagedAgentExecutionStateStoreOptions {
  sharedStore: Pick<ManagedAgentControlPlaneSharedStore,
    | "getAgentWorkItem"
    | "getManagedAgent"
    | "getPrincipal"
    | "listAgentMessagesByWorkItem"
    | "saveAgentWorkItem"
    | "saveManagedAgent"
  >;
  localExecutionStateStore: ManagedAgentExecutionStateLocalStore;
}

export function createSplitManagedAgentExecutionStateStore(
  options: SplitManagedAgentExecutionStateStoreOptions,
): ManagedAgentExecutionStateStore {
  const { sharedStore, localExecutionStateStore } = options;

  return {
    getAgentWorkItem: sharedStore.getAgentWorkItem.bind(sharedStore),
    getManagedAgent: sharedStore.getManagedAgent.bind(sharedStore),
    getPrincipal: sharedStore.getPrincipal.bind(sharedStore),
    getSessionTaskSettings: localExecutionStateStore.getSessionTaskSettings.bind(localExecutionStateStore),
    listAgentMessagesByWorkItem: sharedStore.listAgentMessagesByWorkItem.bind(sharedStore),
    saveAgentWorkItem: sharedStore.saveAgentWorkItem.bind(sharedStore),
    saveManagedAgent: sharedStore.saveManagedAgent.bind(sharedStore),
    saveSessionTaskSettings: localExecutionStateStore.saveSessionTaskSettings.bind(localExecutionStateStore),
  };
}

export class CompositeManagedAgentControlPlaneStore implements ManagedAgentControlPlaneStore {
  readonly managedAgentsStore: ManagedAgentsStore;
  readonly coordinationStore: ManagedAgentCoordinationStore;
  readonly schedulerStore: ManagedAgentSchedulerStore;
  readonly nodeStore: ManagedAgentNodeStore;
  readonly executionLeaseStore: ManagedAgentExecutionLeaseStore;
  readonly executionStateStore: ManagedAgentExecutionStateStore;
  readonly workerStore: ManagedAgentWorkerStore;

  constructor(options: CompositeManagedAgentControlPlaneStoreOptions) {
    this.managedAgentsStore = options.sharedStore;
    this.coordinationStore = options.sharedStore;
    this.schedulerStore = options.sharedStore;
    this.nodeStore = options.sharedStore;
    this.executionLeaseStore = options.sharedStore;
    this.executionStateStore = options.executionStateStore;
    this.workerStore = options.sharedStore;
  }
}
