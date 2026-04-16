import type { SqliteCodexSessionRegistry } from "./codex-session-registry.js";

export type Awaitable<T> = T | Promise<T>;

export type AwaitableMethods<T extends object> = {
  [K in keyof T]: T[K] extends (...args: infer TArgs) => infer TResult
    ? (...args: TArgs) => Awaitable<Awaited<TResult>>
    : T[K];
};

export type AsyncMethods<T extends object> = {
  [K in keyof T]: T[K] extends (...args: infer TArgs) => infer TResult
    ? (...args: TArgs) => Promise<Awaited<TResult>>
    : T[K];
};

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
  | "getManagedAgentByPrincipal"
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

export type ManagedAgentsSharedStore = Pick<ManagedAgentsStore,
  | "deleteAgentSpawnSuggestionState"
  | "getAgentRuntimeProfile"
  | "getAgentRuntimeProfileByOwnerAgent"
  | "getAgentSpawnPolicy"
  | "getAgentSpawnSuggestionState"
  | "getAgentWorkItem"
  | "getAgentWorkspacePolicy"
  | "getAgentWorkspacePolicyByOwnerAgent"
  | "getManagedAgent"
  | "getManagedAgentByPrincipal"
  | "getProjectWorkspaceBinding"
  | "getOrganization"
  | "getPrincipal"
  | "listAgentAuditLogsByOrganization"
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
>;

export type ManagedAgentsLocalStore = Pick<ManagedAgentsStore,
  | "getActiveAuthAccount"
  | "getAuthAccount"
  | "listAuthAccounts"
  | "listThirdPartyProviderModels"
  | "listThirdPartyProviders"
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
  | "claimRunnableAgentWorkItemById"
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
  | "listRunnableAgentWorkItems"
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
  & ManagedAgentsSharedStore
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
  managedAgentsStore?: ManagedAgentsStore;
  executionStateStore: ManagedAgentExecutionStateStore;
}

export function createAsyncMethodAdapter<T extends object>(target: T): AsyncMethods<T> {
  return new Proxy(target, {
    get(originalTarget, property, receiver) {
      const value = Reflect.get(originalTarget, property, receiver);

      if (typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        try {
          return Promise.resolve(Reflect.apply(value, originalTarget, args));
        } catch (error) {
          return Promise.reject(error);
        }
      };
    },
  }) as AsyncMethods<T>;
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

export interface SplitManagedAgentsStoreOptions {
  sharedStore: ManagedAgentsSharedStore;
  localManagedAgentsStore: ManagedAgentsLocalStore;
}

export function createSplitManagedAgentsStore(
  options: SplitManagedAgentsStoreOptions,
): ManagedAgentsStore {
  const { sharedStore, localManagedAgentsStore } = options;

  return {
    deleteAgentSpawnSuggestionState: sharedStore.deleteAgentSpawnSuggestionState.bind(sharedStore),
    getActiveAuthAccount: localManagedAgentsStore.getActiveAuthAccount.bind(localManagedAgentsStore),
    getAgentRuntimeProfile: sharedStore.getAgentRuntimeProfile.bind(sharedStore),
    getAgentRuntimeProfileByOwnerAgent: sharedStore.getAgentRuntimeProfileByOwnerAgent.bind(sharedStore),
    getAgentSpawnPolicy: sharedStore.getAgentSpawnPolicy.bind(sharedStore),
    getAgentSpawnSuggestionState: sharedStore.getAgentSpawnSuggestionState.bind(sharedStore),
    getAgentWorkItem: sharedStore.getAgentWorkItem.bind(sharedStore),
    getAgentWorkspacePolicy: sharedStore.getAgentWorkspacePolicy.bind(sharedStore),
    getAgentWorkspacePolicyByOwnerAgent: sharedStore.getAgentWorkspacePolicyByOwnerAgent.bind(sharedStore),
    getAuthAccount: localManagedAgentsStore.getAuthAccount.bind(localManagedAgentsStore),
    getManagedAgent: sharedStore.getManagedAgent.bind(sharedStore),
    getManagedAgentByPrincipal: sharedStore.getManagedAgentByPrincipal.bind(sharedStore),
    getProjectWorkspaceBinding: sharedStore.getProjectWorkspaceBinding.bind(sharedStore),
    getOrganization: sharedStore.getOrganization.bind(sharedStore),
    getPrincipal: sharedStore.getPrincipal.bind(sharedStore),
    listAgentAuditLogsByOrganization: sharedStore.listAgentAuditLogsByOrganization.bind(sharedStore),
    listAuthAccounts: localManagedAgentsStore.listAuthAccounts.bind(localManagedAgentsStore),
    listAgentHandoffsByAgent: sharedStore.listAgentHandoffsByAgent.bind(sharedStore),
    listAgentMailboxEntriesByAgent: sharedStore.listAgentMailboxEntriesByAgent.bind(sharedStore),
    listAgentMessagesByAgent: sharedStore.listAgentMessagesByAgent.bind(sharedStore),
    listAgentSpawnSuggestionStatesByOrganization:
      sharedStore.listAgentSpawnSuggestionStatesByOrganization.bind(sharedStore),
    listAgentWorkItemsByOwnerPrincipal: sharedStore.listAgentWorkItemsByOwnerPrincipal.bind(sharedStore),
    listAgentWorkItemsByParentWorkItem: sharedStore.listAgentWorkItemsByParentWorkItem.bind(sharedStore),
    listAgentWorkItemsByTargetAgent: sharedStore.listAgentWorkItemsByTargetAgent.bind(sharedStore),
    listManagedAgentsByOrganization: sharedStore.listManagedAgentsByOrganization.bind(sharedStore),
    listManagedAgentsByOwnerPrincipal: sharedStore.listManagedAgentsByOwnerPrincipal.bind(sharedStore),
    listOrganizationsByOwnerPrincipal: sharedStore.listOrganizationsByOwnerPrincipal.bind(sharedStore),
    listProjectWorkspaceBindingsByOrganization: sharedStore.listProjectWorkspaceBindingsByOrganization.bind(sharedStore),
    listThirdPartyProviderModels: localManagedAgentsStore.listThirdPartyProviderModels.bind(localManagedAgentsStore),
    listThirdPartyProviders: localManagedAgentsStore.listThirdPartyProviders.bind(localManagedAgentsStore),
    saveAgentAuditLog: sharedStore.saveAgentAuditLog.bind(sharedStore),
    saveAgentRuntimeProfile: sharedStore.saveAgentRuntimeProfile.bind(sharedStore),
    saveAgentSpawnPolicy: sharedStore.saveAgentSpawnPolicy.bind(sharedStore),
    saveAgentSpawnSuggestionState: sharedStore.saveAgentSpawnSuggestionState.bind(sharedStore),
    saveAgentWorkItem: sharedStore.saveAgentWorkItem.bind(sharedStore),
    saveAgentWorkspacePolicy: sharedStore.saveAgentWorkspacePolicy.bind(sharedStore),
    saveManagedAgent: sharedStore.saveManagedAgent.bind(sharedStore),
    saveProjectWorkspaceBinding: sharedStore.saveProjectWorkspaceBinding.bind(sharedStore),
    saveOrganization: sharedStore.saveOrganization.bind(sharedStore),
    savePrincipal: sharedStore.savePrincipal.bind(sharedStore),
    saveThirdPartyProvider: localManagedAgentsStore.saveThirdPartyProvider.bind(localManagedAgentsStore),
    saveThirdPartyProviderModel: localManagedAgentsStore.saveThirdPartyProviderModel.bind(localManagedAgentsStore),
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
    this.managedAgentsStore = options.managedAgentsStore ?? options.sharedStore as unknown as ManagedAgentsStore;
    this.coordinationStore = options.sharedStore;
    this.schedulerStore = options.sharedStore;
    this.nodeStore = options.sharedStore;
    this.executionLeaseStore = options.sharedStore;
    this.executionStateStore = options.executionStateStore;
    this.workerStore = options.sharedStore;
  }
}
