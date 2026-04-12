import type {
  ManagedAgentsStore,
  ManagedAgentCoordinationStore,
  ManagedAgentExecutionStateStore,
  ManagedAgentSchedulerStore,
} from "./managed-agent-control-plane-store.js";
import type { SqliteCodexSessionRegistry } from "./codex-session-registry.js";

export class SqliteManagedAgentControlPlaneStore {
  private readonly registry: SqliteCodexSessionRegistry;

  constructor(registry: SqliteCodexSessionRegistry) {
    this.registry = registry;
  }

  get managedAgentsStore(): ManagedAgentsStore {
    return this.registry;
  }

  get coordinationStore(): ManagedAgentCoordinationStore {
    return this.registry;
  }

  get schedulerStore(): ManagedAgentSchedulerStore {
    return this.registry;
  }

  get executionStateStore(): ManagedAgentExecutionStateStore {
    return this.registry;
  }
}
