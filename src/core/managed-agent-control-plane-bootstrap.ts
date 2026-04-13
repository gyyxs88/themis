import { resolve } from "node:path";
import {
  CompositeManagedAgentControlPlaneStore,
  createSplitManagedAgentExecutionStateStore,
  type ManagedAgentControlPlaneStore,
  SqliteCodexSessionRegistry,
  SqliteManagedAgentControlPlaneStore,
} from "../storage/index.js";

export const THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE_ENV_KEY =
  "THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE";

export interface CreateManagedAgentControlPlaneStoreFromEnvOptions {
  workingDirectory: string;
  runtimeStore: SqliteCodexSessionRegistry;
  env?: NodeJS.ProcessEnv;
}

export function createManagedAgentControlPlaneStoreFromEnv(
  options: CreateManagedAgentControlPlaneStoreFromEnvOptions,
): ManagedAgentControlPlaneStore {
  const env = options.env ?? process.env;
  const configuredPath = normalizeOptionalText(env[THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE_ENV_KEY]);

  if (!configuredPath) {
    return new SqliteManagedAgentControlPlaneStore(options.runtimeStore);
  }

  const sharedStore = new SqliteCodexSessionRegistry({
    databaseFile: resolve(options.workingDirectory, configuredPath),
  });
  const executionStateStore = createSplitManagedAgentExecutionStateStore({
    sharedStore,
    localExecutionStateStore: options.runtimeStore,
  });

  return new CompositeManagedAgentControlPlaneStore({
    sharedStore,
    executionStateStore,
  });
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
