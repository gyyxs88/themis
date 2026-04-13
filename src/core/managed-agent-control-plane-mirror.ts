import {
  exportSqliteManagedAgentControlPlaneSnapshot,
  hasManagedAgentControlPlaneSnapshotData,
  replaceSqliteManagedAgentControlPlaneSnapshot,
  type Awaitable,
  type ManagedAgentControlPlaneSnapshot,
} from "../storage/index.js";

export interface ManagedAgentControlPlaneSnapshotStore {
  ensureSchema(): Promise<void>;
  exportSharedSnapshot(): Promise<ManagedAgentControlPlaneSnapshot>;
  replaceSharedSnapshot(snapshot: ManagedAgentControlPlaneSnapshot): Promise<void>;
}

export interface ManagedAgentControlPlaneMirrorOptions {
  localDatabaseFile: string;
  sharedSnapshotStore: ManagedAgentControlPlaneSnapshotStore;
}

export interface ManagedAgentControlPlaneMirrorBootstrapResult {
  source: "shared_store" | "local_cache" | "empty";
  localHasData: boolean;
  sharedHasData: boolean;
}

export interface ManagedAgentControlPlaneMirrorSnapshotResult {
  hasData: boolean;
}

export interface ManagedAgentControlPlaneMirrorFlushResult extends ManagedAgentControlPlaneMirrorSnapshotResult {
  flushed: boolean;
}

export class ManagedAgentControlPlaneMirror {
  private readonly localDatabaseFile: string;
  private readonly sharedSnapshotStore: ManagedAgentControlPlaneSnapshotStore;
  private dirty = false;

  constructor(options: ManagedAgentControlPlaneMirrorOptions) {
    this.localDatabaseFile = options.localDatabaseFile;
    this.sharedSnapshotStore = options.sharedSnapshotStore;
  }

  getLocalDatabaseFile(): string {
    return this.localDatabaseFile;
  }

  markLocalDirty(): void {
    this.dirty = true;
  }

  async bootstrapFromSharedStore(): Promise<ManagedAgentControlPlaneMirrorBootstrapResult> {
    await this.sharedSnapshotStore.ensureSchema();
    const sharedSnapshot = await this.sharedSnapshotStore.exportSharedSnapshot();
    const sharedHasData = hasManagedAgentControlPlaneSnapshotData(sharedSnapshot);
    const localSnapshot = exportSqliteManagedAgentControlPlaneSnapshot(this.localDatabaseFile);
    const localHasData = hasManagedAgentControlPlaneSnapshotData(localSnapshot);

    if (sharedHasData) {
      replaceSqliteManagedAgentControlPlaneSnapshot(this.localDatabaseFile, sharedSnapshot);
      this.dirty = false;
      return {
        source: "shared_store",
        localHasData,
        sharedHasData,
      };
    }

    if (localHasData) {
      await this.sharedSnapshotStore.replaceSharedSnapshot(localSnapshot);
      this.dirty = false;
      return {
        source: "local_cache",
        localHasData,
        sharedHasData,
      };
    }

    this.dirty = false;
    return {
      source: "empty",
      localHasData,
      sharedHasData,
    };
  }

  async flushLocalSnapshotToSharedStore(input: {
    force?: boolean;
  } = {}): Promise<ManagedAgentControlPlaneMirrorFlushResult> {
    if (!this.dirty && !input.force) {
      const snapshot = exportSqliteManagedAgentControlPlaneSnapshot(this.localDatabaseFile);
      return {
        flushed: false,
        hasData: hasManagedAgentControlPlaneSnapshotData(snapshot),
      };
    }

    const snapshot = exportSqliteManagedAgentControlPlaneSnapshot(this.localDatabaseFile);
    await this.sharedSnapshotStore.replaceSharedSnapshot(snapshot);
    this.dirty = false;

    return {
      flushed: true,
      hasData: hasManagedAgentControlPlaneSnapshotData(snapshot),
    };
  }

  async restoreLocalSnapshotFromSharedStore(): Promise<ManagedAgentControlPlaneMirrorSnapshotResult> {
    const snapshot = await this.sharedSnapshotStore.exportSharedSnapshot();
    replaceSqliteManagedAgentControlPlaneSnapshot(this.localDatabaseFile, snapshot);
    this.dirty = false;

    return {
      hasData: hasManagedAgentControlPlaneSnapshotData(snapshot),
    };
  }

  async runMirroredMutation<T>(mutation: () => Awaitable<T>): Promise<T> {
    const result = await mutation();
    this.markLocalDirty();

    try {
      await this.flushLocalSnapshotToSharedStore({ force: true });
      return result;
    } catch (error) {
      try {
        await this.restoreLocalSnapshotFromSharedStore();
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Managed agent control plane mirror failed to flush local changes and failed to restore local cache.",
        );
      }

      throw error;
    }
  }
}
