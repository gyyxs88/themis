import type { SqliteCodexSessionRegistry } from "./codex-session-registry.js";
import { CompositeManagedAgentControlPlaneStore as BaseManagedAgentControlPlaneStore } from "./managed-agent-control-plane-store.js";

export class SqliteManagedAgentControlPlaneStore extends BaseManagedAgentControlPlaneStore {
  constructor(registry: SqliteCodexSessionRegistry) {
    super({
      sharedStore: registry,
      executionStateStore: registry,
    });
  }
}
