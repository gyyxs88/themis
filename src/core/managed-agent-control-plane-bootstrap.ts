import { resolve } from "node:path";
import {
  ManagedAgentControlPlaneMirror,
  type ManagedAgentControlPlaneMirrorBootstrapResult,
  type ManagedAgentControlPlaneSnapshotStore,
} from "./managed-agent-control-plane-mirror.js";
import {
  CompositeManagedAgentControlPlaneStore,
  createSplitManagedAgentsStore,
  createSplitManagedAgentExecutionStateStore,
  type ManagedAgentControlPlaneStore,
  MySqlManagedAgentControlPlaneStore,
  type MySqlManagedAgentControlPlaneStoreOptions,
  SqliteCodexSessionRegistry,
  SqliteManagedAgentControlPlaneStore,
} from "../storage/index.js";

export const THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE_ENV_KEY =
  "THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE";
export const THEMIS_PLATFORM_CONTROL_PLANE_DRIVER_ENV_KEY = "THEMIS_PLATFORM_CONTROL_PLANE_DRIVER";
export const THEMIS_PLATFORM_MYSQL_URI_ENV_KEY = "THEMIS_PLATFORM_MYSQL_URI";
export const THEMIS_PLATFORM_MYSQL_HOST_ENV_KEY = "THEMIS_PLATFORM_MYSQL_HOST";
export const THEMIS_PLATFORM_MYSQL_PORT_ENV_KEY = "THEMIS_PLATFORM_MYSQL_PORT";
export const THEMIS_PLATFORM_MYSQL_USER_ENV_KEY = "THEMIS_PLATFORM_MYSQL_USER";
export const THEMIS_PLATFORM_MYSQL_PASSWORD_ENV_KEY = "THEMIS_PLATFORM_MYSQL_PASSWORD";
export const THEMIS_PLATFORM_MYSQL_DATABASE_ENV_KEY = "THEMIS_PLATFORM_MYSQL_DATABASE";
export const THEMIS_PLATFORM_MYSQL_CONNECTION_LIMIT_ENV_KEY = "THEMIS_PLATFORM_MYSQL_CONNECTION_LIMIT";

const DEFAULT_PLATFORM_SHARED_CONTROL_PLANE_DATABASE_FILE = "infra/platform/control-plane.db";

export type ManagedAgentControlPlaneDriver = "sqlite" | "mysql";

export interface CreateManagedAgentControlPlaneStoreFromEnvOptions {
  workingDirectory: string;
  runtimeStore: SqliteCodexSessionRegistry;
  env?: NodeJS.ProcessEnv;
}

export interface CreateManagedAgentControlPlaneRuntimeFromEnvOptions
  extends CreateManagedAgentControlPlaneStoreFromEnvOptions {
  createMySqlStore?: (options: MySqlManagedAgentControlPlaneStoreOptions) => ManagedAgentControlPlaneSnapshotStore;
}

export interface ManagedAgentControlPlaneRuntimeFromEnvResult {
  driver: ManagedAgentControlPlaneDriver;
  controlPlaneStore: ManagedAgentControlPlaneStore;
  mirror: ManagedAgentControlPlaneMirror | null;
  sharedDatabaseFile: string | null;
  bootstrapResult: ManagedAgentControlPlaneMirrorBootstrapResult | null;
}

export function createManagedAgentControlPlaneStoreFromEnv(
  options: CreateManagedAgentControlPlaneStoreFromEnvOptions,
): ManagedAgentControlPlaneStore {
  const env = options.env ?? process.env;
  const configuredPath = resolveConfiguredControlPlaneDatabaseFile(
    options.workingDirectory,
    env,
  );

  if (!configuredPath) {
    return new SqliteManagedAgentControlPlaneStore(options.runtimeStore);
  }

  const sharedStore = new SqliteCodexSessionRegistry({
    databaseFile: configuredPath,
  });
  return createSplitSqliteManagedAgentControlPlaneStore({
    runtimeStore: options.runtimeStore,
    sharedStore,
  });
}

export async function createManagedAgentControlPlaneRuntimeFromEnv(
  options: CreateManagedAgentControlPlaneRuntimeFromEnvOptions,
): Promise<ManagedAgentControlPlaneRuntimeFromEnvResult> {
  const env = options.env ?? process.env;
  const driver = resolveManagedAgentControlPlaneDriver(env);

  if (driver === "sqlite") {
    return {
      driver,
      controlPlaneStore: createManagedAgentControlPlaneStoreFromEnv(options),
      mirror: null,
      sharedDatabaseFile: resolveConfiguredControlPlaneDatabaseFile(options.workingDirectory, env),
      bootstrapResult: null,
    };
  }

  const sharedDatabaseFile = resolveConfiguredControlPlaneDatabaseFile(
    options.workingDirectory,
    env,
    DEFAULT_PLATFORM_SHARED_CONTROL_PLANE_DATABASE_FILE,
  );

  if (!sharedDatabaseFile) {
    throw new Error("Platform MySQL control plane requires a local shared control plane cache path.");
  }

  const sharedStore = new SqliteCodexSessionRegistry({
    databaseFile: sharedDatabaseFile,
  });
  const controlPlaneStore = createSplitSqliteManagedAgentControlPlaneStore({
    runtimeStore: options.runtimeStore,
    sharedStore,
  });
  const mysqlStoreOptions = resolveMySqlManagedAgentControlPlaneStoreOptions(env);
  const mysqlStore = options.createMySqlStore?.(mysqlStoreOptions)
    ?? new MySqlManagedAgentControlPlaneStore(mysqlStoreOptions);
  const mirror = new ManagedAgentControlPlaneMirror({
    localDatabaseFile: sharedDatabaseFile,
    sharedSnapshotStore: mysqlStore,
  });
  const bootstrapResult = await mirror.bootstrapFromSharedStore();

  return {
    driver,
    controlPlaneStore,
    mirror,
    sharedDatabaseFile,
    bootstrapResult,
  };
}

function createSplitSqliteManagedAgentControlPlaneStore(input: {
  runtimeStore: SqliteCodexSessionRegistry;
  sharedStore: SqliteCodexSessionRegistry;
}): ManagedAgentControlPlaneStore {
  const executionStateStore = createSplitManagedAgentExecutionStateStore({
    sharedStore: input.sharedStore,
    localExecutionStateStore: input.runtimeStore,
  });
  const managedAgentsStore = createSplitManagedAgentsStore({
    sharedStore: input.sharedStore,
    localManagedAgentsStore: input.runtimeStore,
  });

  return new CompositeManagedAgentControlPlaneStore({
    sharedStore: input.sharedStore,
    managedAgentsStore,
    executionStateStore,
  });
}

function resolveManagedAgentControlPlaneDriver(env: NodeJS.ProcessEnv): ManagedAgentControlPlaneDriver {
  const configured = normalizeOptionalText(env[THEMIS_PLATFORM_CONTROL_PLANE_DRIVER_ENV_KEY])?.toLowerCase();

  if (!configured || configured === "sqlite") {
    return "sqlite";
  }

  if (configured === "mysql") {
    return "mysql";
  }

  throw new Error(
    `Unsupported ${THEMIS_PLATFORM_CONTROL_PLANE_DRIVER_ENV_KEY}: ${configured}. Expected sqlite or mysql.`,
  );
}

function resolveConfiguredControlPlaneDatabaseFile(
  workingDirectory: string,
  env: NodeJS.ProcessEnv,
  fallbackPath?: string,
): string | null {
  const configuredPath = normalizeOptionalText(env[THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE_ENV_KEY])
    ?? normalizeOptionalText(fallbackPath);

  return configuredPath ? resolve(workingDirectory, configuredPath) : null;
}

function resolveMySqlManagedAgentControlPlaneStoreOptions(
  env: NodeJS.ProcessEnv,
): MySqlManagedAgentControlPlaneStoreOptions {
  const database = normalizeOptionalText(env[THEMIS_PLATFORM_MYSQL_DATABASE_ENV_KEY]);

  if (!database) {
    throw new Error(
      `Missing ${THEMIS_PLATFORM_MYSQL_DATABASE_ENV_KEY}. Platform MySQL control plane requires an explicit database name.`,
    );
  }

  const uri = normalizeOptionalText(env[THEMIS_PLATFORM_MYSQL_URI_ENV_KEY]);
  const host = normalizeOptionalText(env[THEMIS_PLATFORM_MYSQL_HOST_ENV_KEY]);
  const user = normalizeOptionalText(env[THEMIS_PLATFORM_MYSQL_USER_ENV_KEY]);
  const password = normalizeOptionalText(env[THEMIS_PLATFORM_MYSQL_PASSWORD_ENV_KEY]);
  const port = normalizeOptionalInteger(env[THEMIS_PLATFORM_MYSQL_PORT_ENV_KEY]);
  const connectionLimit = normalizeOptionalInteger(env[THEMIS_PLATFORM_MYSQL_CONNECTION_LIMIT_ENV_KEY]);

  return {
    ...(uri ? { uri } : {}),
    ...(host ? { host } : {}),
    ...(typeof port === "number" ? { port } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    database,
    ...(typeof connectionLimit === "number" ? { connectionLimit } : {}),
  };
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalInteger(value: string | undefined): number | null {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected integer value, received: ${normalized}`);
  }

  return parsed;
}
