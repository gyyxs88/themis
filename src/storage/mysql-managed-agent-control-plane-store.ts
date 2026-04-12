import {
  createPool,
  type Pool,
  type PoolOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type { StoredPrincipalRecord } from "./codex-session-registry.js";
import type {
  ManagedAgentBootstrapProfile,
  ManagedAgentRuntimeProfileSnapshot,
  ManagedAgentWorkspacePolicySnapshot,
  StoredAgentRunRecord,
  StoredAgentRuntimeProfileRecord,
  StoredAgentWorkItemRecord,
  StoredAgentWorkspacePolicyRecord,
  StoredManagedAgentRecord,
  StoredOrganizationRecord,
} from "../types/index.js";

export interface MySqlManagedAgentControlPlaneStoreOptions {
  pool?: Pool;
  uri?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database: string;
  connectionLimit?: number;
}

type MySqlDateTimeValue = string | Date;

interface PrincipalRow extends RowDataPacket {
  principal_id: string;
  display_name: string | null;
  kind: string | null;
  organization_id: string | null;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface OrganizationRow extends RowDataPacket {
  organization_id: string;
  owner_principal_id: string;
  display_name: string;
  slug: string;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface ManagedAgentRow extends RowDataPacket {
  agent_id: string;
  principal_id: string;
  organization_id: string;
  created_by_principal_id: string;
  supervisor_principal_id: string | null;
  display_name: string;
  slug: string;
  department_role: string;
  mission: string;
  status: string;
  autonomy_level: string;
  creation_mode: string;
  exposure_policy: string;
  default_workspace_policy_id: string | null;
  default_runtime_profile_id: string | null;
  bootstrap_profile_json: unknown | null;
  bootstrapped_at: MySqlDateTimeValue | null;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface AgentWorkspacePolicyRow extends RowDataPacket {
  policy_id: string;
  organization_id: string;
  owner_agent_id: string;
  display_name: string;
  workspace_path: string;
  additional_directories_json: unknown | null;
  allow_network_access: number;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface AgentRuntimeProfileRow extends RowDataPacket {
  profile_id: string;
  organization_id: string;
  owner_agent_id: string;
  display_name: string;
  snapshot_json: unknown | null;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface AgentWorkItemRow extends RowDataPacket {
  work_item_id: string;
  organization_id: string;
  target_agent_id: string;
  source_type: string;
  source_principal_id: string;
  source_agent_id: string | null;
  parent_work_item_id: string | null;
  dispatch_reason: string;
  goal: string;
  context_packet_json: unknown | null;
  waiting_action_request_json: unknown | null;
  latest_human_response_json: unknown | null;
  priority: string;
  status: string;
  workspace_policy_snapshot_json: unknown | null;
  runtime_profile_snapshot_json: unknown | null;
  created_at: MySqlDateTimeValue;
  scheduled_at: MySqlDateTimeValue | null;
  started_at: MySqlDateTimeValue | null;
  completed_at: MySqlDateTimeValue | null;
  updated_at: MySqlDateTimeValue;
}

interface AgentRunRow extends RowDataPacket {
  run_id: string;
  organization_id: string;
  work_item_id: string;
  target_agent_id: string;
  scheduler_id: string;
  lease_token: string;
  lease_expires_at: MySqlDateTimeValue;
  status: string;
  started_at: MySqlDateTimeValue | null;
  last_heartbeat_at: MySqlDateTimeValue | null;
  completed_at: MySqlDateTimeValue | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

const MYSQL_CONTROL_PLANE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS themis_principals (
    principal_id VARCHAR(191) PRIMARY KEY,
    display_name VARCHAR(255) NULL,
    kind VARCHAR(64) NULL,
    organization_id VARCHAR(191) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_themis_principals_org (organization_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_organizations (
    organization_id VARCHAR(191) PRIMARY KEY,
    owner_principal_id VARCHAR(191) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    slug VARCHAR(191) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_themis_organizations_owner_slug (owner_principal_id, slug),
    KEY idx_themis_organizations_owner (owner_principal_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_managed_agents (
    agent_id VARCHAR(191) PRIMARY KEY,
    principal_id VARCHAR(191) NOT NULL,
    organization_id VARCHAR(191) NOT NULL,
    created_by_principal_id VARCHAR(191) NOT NULL,
    supervisor_principal_id VARCHAR(191) NULL,
    display_name VARCHAR(255) NOT NULL,
    slug VARCHAR(191) NOT NULL,
    department_role VARCHAR(191) NOT NULL,
    mission TEXT NOT NULL,
    status VARCHAR(64) NOT NULL,
    autonomy_level VARCHAR(64) NOT NULL,
    creation_mode VARCHAR(64) NOT NULL,
    exposure_policy VARCHAR(64) NOT NULL,
    default_workspace_policy_id VARCHAR(191) NULL,
    default_runtime_profile_id VARCHAR(191) NULL,
    bootstrap_profile_json JSON NULL,
    bootstrapped_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_themis_managed_agents_principal (principal_id),
    UNIQUE KEY uq_themis_managed_agents_org_slug (organization_id, slug),
    KEY idx_themis_managed_agents_org_status (organization_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_workspace_policies (
    policy_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    owner_agent_id VARCHAR(191) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    workspace_path TEXT NOT NULL,
    additional_directories_json JSON NULL,
    allow_network_access TINYINT(1) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_themis_agent_workspace_policies_owner (owner_agent_id),
    KEY idx_themis_agent_workspace_policies_org (organization_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_runtime_profiles (
    profile_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    owner_agent_id VARCHAR(191) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    snapshot_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_themis_agent_runtime_profiles_owner (owner_agent_id),
    KEY idx_themis_agent_runtime_profiles_org (organization_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_work_items (
    work_item_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    target_agent_id VARCHAR(191) NOT NULL,
    source_type VARCHAR(64) NOT NULL,
    source_principal_id VARCHAR(191) NOT NULL,
    source_agent_id VARCHAR(191) NULL,
    parent_work_item_id VARCHAR(191) NULL,
    dispatch_reason TEXT NOT NULL,
    goal LONGTEXT NOT NULL,
    context_packet_json JSON NULL,
    waiting_action_request_json JSON NULL,
    latest_human_response_json JSON NULL,
    priority VARCHAR(64) NOT NULL,
    status VARCHAR(64) NOT NULL,
    workspace_policy_snapshot_json JSON NULL,
    runtime_profile_snapshot_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    scheduled_at DATETIME(3) NULL,
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_themis_agent_work_items_org_target_status (organization_id, target_agent_id, status),
    KEY idx_themis_agent_work_items_parent (parent_work_item_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_runs (
    run_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    work_item_id VARCHAR(191) NOT NULL,
    target_agent_id VARCHAR(191) NOT NULL,
    scheduler_id VARCHAR(191) NOT NULL,
    lease_token VARCHAR(191) NOT NULL,
    lease_expires_at DATETIME(3) NOT NULL,
    status VARCHAR(64) NOT NULL,
    started_at DATETIME(3) NULL,
    last_heartbeat_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    failure_code VARCHAR(191) NULL,
    failure_message TEXT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_themis_agent_runs_work_item (work_item_id),
    KEY idx_themis_agent_runs_target_status (target_agent_id, status),
    KEY idx_themis_agent_runs_lease (lease_expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
] as const;

export class MySqlManagedAgentControlPlaneStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(options: MySqlManagedAgentControlPlaneStoreOptions) {
    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
      return;
    }

    this.pool = createPool(this.buildPoolOptions(options));
    this.ownsPool = true;
  }

  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async ensureSchema(): Promise<void> {
    for (const statement of MYSQL_CONTROL_PLANE_SCHEMA_STATEMENTS) {
      await this.pool.query(statement);
    }
  }

  async savePrincipal(record: StoredPrincipalRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_principals (
        principal_id, display_name, kind, organization_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        kind = VALUES(kind),
        organization_id = VALUES(organization_id),
        updated_at = VALUES(updated_at)`,
      [
        record.principalId,
        record.displayName ?? null,
        record.kind ?? null,
        record.organizationId ?? null,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getPrincipal(principalId: string): Promise<StoredPrincipalRecord | null> {
    const [rows] = await this.pool.query<PrincipalRow[]>(
      `SELECT principal_id, display_name, kind, organization_id, created_at, updated_at
       FROM themis_principals WHERE principal_id = ? LIMIT 1`,
      [principalId],
    );
    const row = rows[0];
    return row ? mapPrincipalRow(row) : null;
  }

  async saveOrganization(record: StoredOrganizationRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_organizations (
        organization_id, owner_principal_id, display_name, slug, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        owner_principal_id = VALUES(owner_principal_id),
        display_name = VALUES(display_name),
        slug = VALUES(slug),
        updated_at = VALUES(updated_at)`,
      [
        record.organizationId,
        record.ownerPrincipalId,
        record.displayName,
        record.slug,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getOrganization(organizationId: string): Promise<StoredOrganizationRecord | null> {
    const [rows] = await this.pool.query<OrganizationRow[]>(
      `SELECT organization_id, owner_principal_id, display_name, slug, created_at, updated_at
       FROM themis_organizations WHERE organization_id = ? LIMIT 1`,
      [organizationId],
    );
    const row = rows[0];
    return row ? mapOrganizationRow(row) : null;
  }

  async saveManagedAgent(record: StoredManagedAgentRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_managed_agents (
        agent_id, principal_id, organization_id, created_by_principal_id, supervisor_principal_id,
        display_name, slug, department_role, mission, status, autonomy_level, creation_mode,
        exposure_policy, default_workspace_policy_id, default_runtime_profile_id, bootstrap_profile_json,
        bootstrapped_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        principal_id = VALUES(principal_id),
        organization_id = VALUES(organization_id),
        created_by_principal_id = VALUES(created_by_principal_id),
        supervisor_principal_id = VALUES(supervisor_principal_id),
        display_name = VALUES(display_name),
        slug = VALUES(slug),
        department_role = VALUES(department_role),
        mission = VALUES(mission),
        status = VALUES(status),
        autonomy_level = VALUES(autonomy_level),
        creation_mode = VALUES(creation_mode),
        exposure_policy = VALUES(exposure_policy),
        default_workspace_policy_id = VALUES(default_workspace_policy_id),
        default_runtime_profile_id = VALUES(default_runtime_profile_id),
        bootstrap_profile_json = VALUES(bootstrap_profile_json),
        bootstrapped_at = VALUES(bootstrapped_at),
        updated_at = VALUES(updated_at)`,
      [
        record.agentId,
        record.principalId,
        record.organizationId,
        record.createdByPrincipalId,
        record.supervisorPrincipalId ?? null,
        record.displayName,
        record.slug,
        record.departmentRole,
        record.mission,
        record.status,
        record.autonomyLevel,
        record.creationMode,
        record.exposurePolicy,
        record.defaultWorkspacePolicyId ?? null,
        record.defaultRuntimeProfileId ?? null,
        stringifyJson(record.bootstrapProfile),
        record.bootstrappedAt ? toMySqlDateTime(record.bootstrappedAt) : null,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getManagedAgent(agentId: string): Promise<StoredManagedAgentRecord | null> {
    const [rows] = await this.pool.query<ManagedAgentRow[]>(
      `SELECT
         agent_id, principal_id, organization_id, created_by_principal_id, supervisor_principal_id,
         display_name, slug, department_role, mission, status, autonomy_level, creation_mode,
         exposure_policy, default_workspace_policy_id, default_runtime_profile_id, bootstrap_profile_json,
         bootstrapped_at, created_at, updated_at
       FROM themis_managed_agents
       WHERE agent_id = ? LIMIT 1`,
      [agentId],
    );
    const row = rows[0];
    return row ? mapManagedAgentRow(row) : null;
  }

  async saveAgentWorkspacePolicy(record: StoredAgentWorkspacePolicyRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_workspace_policies (
        policy_id, organization_id, owner_agent_id, display_name, workspace_path,
        additional_directories_json, allow_network_access, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        owner_agent_id = VALUES(owner_agent_id),
        display_name = VALUES(display_name),
        workspace_path = VALUES(workspace_path),
        additional_directories_json = VALUES(additional_directories_json),
        allow_network_access = VALUES(allow_network_access),
        updated_at = VALUES(updated_at)`,
      [
        record.policyId,
        record.organizationId,
        record.ownerAgentId,
        record.displayName,
        record.workspacePath,
        stringifyJson(record.additionalDirectories),
        record.allowNetworkAccess ? 1 : 0,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getAgentWorkspacePolicy(policyId: string): Promise<StoredAgentWorkspacePolicyRecord | null> {
    const [rows] = await this.pool.query<AgentWorkspacePolicyRow[]>(
      `SELECT
         policy_id, organization_id, owner_agent_id, display_name, workspace_path,
         additional_directories_json, allow_network_access, created_at, updated_at
       FROM themis_agent_workspace_policies
       WHERE policy_id = ? LIMIT 1`,
      [policyId],
    );
    const row = rows[0];
    return row ? mapAgentWorkspacePolicyRow(row) : null;
  }

  async saveAgentRuntimeProfile(record: StoredAgentRuntimeProfileRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_runtime_profiles (
        profile_id, organization_id, owner_agent_id, display_name, snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        owner_agent_id = VALUES(owner_agent_id),
        display_name = VALUES(display_name),
        snapshot_json = VALUES(snapshot_json),
        updated_at = VALUES(updated_at)`,
      [
        record.profileId,
        record.organizationId,
        record.ownerAgentId,
        record.displayName,
        stringifyJson(record),
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getAgentRuntimeProfile(profileId: string): Promise<StoredAgentRuntimeProfileRecord | null> {
    const [rows] = await this.pool.query<AgentRuntimeProfileRow[]>(
      `SELECT profile_id, organization_id, owner_agent_id, display_name, snapshot_json, created_at, updated_at
       FROM themis_agent_runtime_profiles
       WHERE profile_id = ? LIMIT 1`,
      [profileId],
    );
    const row = rows[0];
    return row ? mapAgentRuntimeProfileRow(row) : null;
  }

  async saveAgentWorkItem(record: StoredAgentWorkItemRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_work_items (
        work_item_id, organization_id, target_agent_id, source_type, source_principal_id,
        source_agent_id, parent_work_item_id, dispatch_reason, goal, context_packet_json,
        waiting_action_request_json, latest_human_response_json, priority, status,
        workspace_policy_snapshot_json, runtime_profile_snapshot_json, created_at, scheduled_at,
        started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        target_agent_id = VALUES(target_agent_id),
        source_type = VALUES(source_type),
        source_principal_id = VALUES(source_principal_id),
        source_agent_id = VALUES(source_agent_id),
        parent_work_item_id = VALUES(parent_work_item_id),
        dispatch_reason = VALUES(dispatch_reason),
        goal = VALUES(goal),
        context_packet_json = VALUES(context_packet_json),
        waiting_action_request_json = VALUES(waiting_action_request_json),
        latest_human_response_json = VALUES(latest_human_response_json),
        priority = VALUES(priority),
        status = VALUES(status),
        workspace_policy_snapshot_json = VALUES(workspace_policy_snapshot_json),
        runtime_profile_snapshot_json = VALUES(runtime_profile_snapshot_json),
        scheduled_at = VALUES(scheduled_at),
        started_at = VALUES(started_at),
        completed_at = VALUES(completed_at),
        updated_at = VALUES(updated_at)`,
      [
        record.workItemId,
        record.organizationId,
        record.targetAgentId,
        record.sourceType,
        record.sourcePrincipalId,
        record.sourceAgentId ?? null,
        record.parentWorkItemId ?? null,
        record.dispatchReason,
        record.goal,
        stringifyJson(record.contextPacket),
        stringifyJson(record.waitingActionRequest),
        stringifyJson(record.latestHumanResponse),
        record.priority,
        record.status,
        stringifyJson(record.workspacePolicySnapshot),
        stringifyJson(record.runtimeProfileSnapshot),
        toMySqlDateTime(record.createdAt),
        record.scheduledAt ? toMySqlDateTime(record.scheduledAt) : null,
        record.startedAt ? toMySqlDateTime(record.startedAt) : null,
        record.completedAt ? toMySqlDateTime(record.completedAt) : null,
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getAgentWorkItem(workItemId: string): Promise<StoredAgentWorkItemRecord | null> {
    const [rows] = await this.pool.query<AgentWorkItemRow[]>(
      `SELECT
         work_item_id, organization_id, target_agent_id, source_type, source_principal_id, source_agent_id,
         parent_work_item_id, dispatch_reason, goal, context_packet_json, waiting_action_request_json,
         latest_human_response_json, priority, status, workspace_policy_snapshot_json,
         runtime_profile_snapshot_json, created_at, scheduled_at, started_at, completed_at, updated_at
       FROM themis_agent_work_items
       WHERE work_item_id = ? LIMIT 1`,
      [workItemId],
    );
    const row = rows[0];
    return row ? mapAgentWorkItemRow(row) : null;
  }

  async saveAgentRun(record: StoredAgentRunRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_runs (
        run_id, organization_id, work_item_id, target_agent_id, scheduler_id, lease_token,
        lease_expires_at, status, started_at, last_heartbeat_at, completed_at, failure_code,
        failure_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        work_item_id = VALUES(work_item_id),
        target_agent_id = VALUES(target_agent_id),
        scheduler_id = VALUES(scheduler_id),
        lease_token = VALUES(lease_token),
        lease_expires_at = VALUES(lease_expires_at),
        status = VALUES(status),
        started_at = VALUES(started_at),
        last_heartbeat_at = VALUES(last_heartbeat_at),
        completed_at = VALUES(completed_at),
        failure_code = VALUES(failure_code),
        failure_message = VALUES(failure_message),
        updated_at = VALUES(updated_at)`,
      [
        record.runId,
        record.organizationId,
        record.workItemId,
        record.targetAgentId,
        record.schedulerId,
        record.leaseToken,
        toMySqlDateTime(record.leaseExpiresAt),
        record.status,
        record.startedAt ? toMySqlDateTime(record.startedAt) : null,
        record.lastHeartbeatAt ? toMySqlDateTime(record.lastHeartbeatAt) : null,
        record.completedAt ? toMySqlDateTime(record.completedAt) : null,
        record.failureCode ?? null,
        record.failureMessage ?? null,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getAgentRun(runId: string): Promise<StoredAgentRunRecord | null> {
    const [rows] = await this.pool.query<AgentRunRow[]>(
      `SELECT
         run_id, organization_id, work_item_id, target_agent_id, scheduler_id, lease_token,
         lease_expires_at, status, started_at, last_heartbeat_at, completed_at, failure_code,
         failure_message, created_at, updated_at
       FROM themis_agent_runs
       WHERE run_id = ? LIMIT 1`,
      [runId],
    );
    const row = rows[0];
    return row ? mapAgentRunRow(row) : null;
  }

  private buildPoolOptions(options: MySqlManagedAgentControlPlaneStoreOptions): PoolOptions {
    if (options.uri) {
      return {
        uri: options.uri,
        timezone: "Z",
        dateStrings: true,
        waitForConnections: true,
        connectionLimit: options.connectionLimit ?? 5,
      };
    }

    return {
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 3306,
      user: options.user ?? "root",
      password: options.password ?? "",
      database: options.database,
      timezone: "Z",
      dateStrings: true,
      waitForConnections: true,
      connectionLimit: options.connectionLimit ?? 5,
    };
  }
}

function mapPrincipalRow(row: PrincipalRow): StoredPrincipalRecord {
  const kind = row.kind as NonNullable<StoredPrincipalRecord["kind"]> | null;
  return {
    principalId: row.principal_id,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(kind ? { kind } : {}),
    ...(row.organization_id ? { organizationId: row.organization_id } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapOrganizationRow(row: OrganizationRow): StoredOrganizationRecord {
  return {
    organizationId: row.organization_id,
    ownerPrincipalId: row.owner_principal_id,
    displayName: row.display_name,
    slug: row.slug,
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapManagedAgentRow(row: ManagedAgentRow): StoredManagedAgentRecord {
  const bootstrapProfile = safeParseJson<ManagedAgentBootstrapProfile>(row.bootstrap_profile_json);
  return {
    agentId: row.agent_id,
    principalId: row.principal_id,
    organizationId: row.organization_id,
    createdByPrincipalId: row.created_by_principal_id,
    ...(row.supervisor_principal_id ? { supervisorPrincipalId: row.supervisor_principal_id } : {}),
    displayName: row.display_name,
    slug: row.slug,
    departmentRole: row.department_role,
    mission: row.mission,
    status: row.status as StoredManagedAgentRecord["status"],
    autonomyLevel: row.autonomy_level as StoredManagedAgentRecord["autonomyLevel"],
    creationMode: row.creation_mode as StoredManagedAgentRecord["creationMode"],
    exposurePolicy: row.exposure_policy as StoredManagedAgentRecord["exposurePolicy"],
    ...(row.default_workspace_policy_id ? { defaultWorkspacePolicyId: row.default_workspace_policy_id } : {}),
    ...(row.default_runtime_profile_id ? { defaultRuntimeProfileId: row.default_runtime_profile_id } : {}),
    ...(bootstrapProfile ? { bootstrapProfile } : {}),
    ...(row.bootstrapped_at ? { bootstrappedAt: fromMySqlDateTime(row.bootstrapped_at) } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapAgentWorkspacePolicyRow(row: AgentWorkspacePolicyRow): StoredAgentWorkspacePolicyRecord {
  const additionalDirectories = safeParseJson<string[]>(row.additional_directories_json);
  return {
    policyId: row.policy_id,
    organizationId: row.organization_id,
    ownerAgentId: row.owner_agent_id,
    displayName: row.display_name,
    workspacePath: row.workspace_path,
    additionalDirectories: Array.isArray(additionalDirectories) ? additionalDirectories : [],
    allowNetworkAccess: row.allow_network_access === 1,
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapAgentRuntimeProfileRow(row: AgentRuntimeProfileRow): StoredAgentRuntimeProfileRecord {
  const snapshot = safeParseJson(row.snapshot_json) ?? {};
  return {
    ...snapshot,
    profileId: row.profile_id,
    organizationId: row.organization_id,
    ownerAgentId: row.owner_agent_id,
    displayName: row.display_name,
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  } as StoredAgentRuntimeProfileRecord;
}

function mapAgentWorkItemRow(row: AgentWorkItemRow): StoredAgentWorkItemRecord {
  const contextPacket = safeParseJson(row.context_packet_json);
  const waitingActionRequest = safeParseJson(row.waiting_action_request_json);
  const latestHumanResponse = safeParseJson(row.latest_human_response_json);
  const workspacePolicySnapshot = safeParseJson<ManagedAgentWorkspacePolicySnapshot>(
    row.workspace_policy_snapshot_json,
  );
  const runtimeProfileSnapshot = safeParseJson<ManagedAgentRuntimeProfileSnapshot>(
    row.runtime_profile_snapshot_json,
  );
  return {
    workItemId: row.work_item_id,
    organizationId: row.organization_id,
    targetAgentId: row.target_agent_id,
    sourceType: row.source_type as StoredAgentWorkItemRecord["sourceType"],
    sourcePrincipalId: row.source_principal_id,
    ...(row.source_agent_id ? { sourceAgentId: row.source_agent_id } : {}),
    ...(row.parent_work_item_id ? { parentWorkItemId: row.parent_work_item_id } : {}),
    dispatchReason: row.dispatch_reason,
    goal: row.goal,
    ...(contextPacket !== undefined ? { contextPacket } : {}),
    ...(waitingActionRequest !== undefined ? { waitingActionRequest } : {}),
    ...(latestHumanResponse !== undefined ? { latestHumanResponse } : {}),
    priority: row.priority as StoredAgentWorkItemRecord["priority"],
    status: row.status as StoredAgentWorkItemRecord["status"],
    ...(workspacePolicySnapshot !== undefined ? { workspacePolicySnapshot } : {}),
    ...(runtimeProfileSnapshot !== undefined ? { runtimeProfileSnapshot } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
    ...(row.scheduled_at ? { scheduledAt: fromMySqlDateTime(row.scheduled_at) } : {}),
    ...(row.started_at ? { startedAt: fromMySqlDateTime(row.started_at) } : {}),
    ...(row.completed_at ? { completedAt: fromMySqlDateTime(row.completed_at) } : {}),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapAgentRunRow(row: AgentRunRow): StoredAgentRunRecord {
  return {
    runId: row.run_id,
    organizationId: row.organization_id,
    workItemId: row.work_item_id,
    targetAgentId: row.target_agent_id,
    schedulerId: row.scheduler_id,
    leaseToken: row.lease_token,
    leaseExpiresAt: fromMySqlDateTime(row.lease_expires_at),
    status: row.status as StoredAgentRunRecord["status"],
    ...(row.started_at ? { startedAt: fromMySqlDateTime(row.started_at) } : {}),
    ...(row.last_heartbeat_at ? { lastHeartbeatAt: fromMySqlDateTime(row.last_heartbeat_at) } : {}),
    ...(row.completed_at ? { completedAt: fromMySqlDateTime(row.completed_at) } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function safeParseJson<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return value as T;
  }

  if (value.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function toMySqlDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid datetime value: ${value}`);
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  const millisecond = String(date.getUTCMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${millisecond}`;
}

function fromMySqlDateTime(value: MySqlDateTimeValue): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
    return value.replace(" ", "T").endsWith("Z") ? value.replace(" ", "T") : `${value.replace(" ", "T")}Z`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid MySQL datetime value: ${value}`);
  }

  return date.toISOString();
}
