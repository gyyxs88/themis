import {
  createPool,
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type { StoredPrincipalRecord } from "./codex-session-registry.js";
import {
  MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES,
  type ManagedAgentControlPlaneSnapshot,
  type SnapshotRow,
} from "./managed-agent-control-plane-snapshot.js";
import type {
  StoredAgentAuditLogRecord,
  StoredAgentExecutionLeaseRecord,
  StoredAgentHandoffRecord,
  StoredAgentMailboxEntryRecord,
  StoredAgentMessageRecord,
  StoredAgentSpawnPolicyRecord,
  StoredAgentSpawnSuggestionStateRecord,
  ManagedAgentCard,
  ManagedAgentBootstrapProfile,
  ManagedAgentRuntimeProfileSnapshot,
  ManagedAgentWorkspacePolicySnapshot,
  ProjectWorkspaceContinuityMode,
  StoredAgentRunRecord,
  StoredAgentRuntimeProfileRecord,
  StoredAgentWorkItemRecord,
  StoredAgentWorkspacePolicyRecord,
  StoredManagedAgentNodeRecord,
  StoredManagedAgentRecord,
  StoredOrganizationRecord,
  StoredProjectWorkspaceBindingRecord,
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
  agent_card_json: unknown | null;
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

interface AgentSpawnPolicyRow extends RowDataPacket {
  organization_id: string;
  max_active_agents: number;
  max_active_agents_per_role: number;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface AgentSpawnSuggestionStateRow extends RowDataPacket {
  suggestion_id: string;
  organization_id: string;
  state: string;
  payload_json: unknown | null;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface AgentWorkItemRow extends RowDataPacket {
  work_item_id: string;
  organization_id: string;
  target_agent_id: string;
  project_id: string | null;
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

interface ProjectWorkspaceBindingRow extends RowDataPacket {
  project_id: string;
  organization_id: string;
  display_name: string;
  owning_agent_id: string | null;
  workspace_root_id: string | null;
  workspace_policy_id: string | null;
  canonical_workspace_path: string | null;
  preferred_node_id: string | null;
  preferred_node_pool: string | null;
  last_active_node_id: string | null;
  last_active_workspace_path: string | null;
  continuity_mode: string;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface AgentMessageRow extends RowDataPacket {
  message_id: string;
  organization_id: string;
  from_agent_id: string;
  to_agent_id: string;
  work_item_id: string | null;
  run_id: string | null;
  parent_message_id: string | null;
  message_type: string;
  payload_json: unknown | null;
  artifact_refs_json: unknown | null;
  priority: string;
  requires_ack: number;
  created_at: MySqlDateTimeValue;
}

interface AgentHandoffRow extends RowDataPacket {
  handoff_id: string;
  organization_id: string;
  from_agent_id: string;
  to_agent_id: string;
  work_item_id: string;
  source_message_id: string | null;
  source_run_id: string | null;
  summary: string;
  blockers_json: unknown | null;
  recommended_next_actions_json: unknown | null;
  attached_artifacts_json: unknown | null;
  payload_json: unknown | null;
  created_at: MySqlDateTimeValue;
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

interface AgentMailboxEntryRow extends RowDataPacket {
  mailbox_entry_id: string;
  organization_id: string;
  owner_agent_id: string;
  message_id: string;
  work_item_id: string | null;
  priority: string;
  status: string;
  requires_ack: number;
  available_at: MySqlDateTimeValue;
  lease_token: string | null;
  leased_at: MySqlDateTimeValue | null;
  acked_at: MySqlDateTimeValue | null;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface ManagedAgentNodeRow extends RowDataPacket {
  node_id: string;
  organization_id: string;
  display_name: string;
  status: string;
  slot_capacity: number;
  slot_available: number;
  labels_json: unknown | null;
  workspace_capabilities_json: unknown | null;
  credential_capabilities_json: unknown | null;
  provider_capabilities_json: unknown | null;
  heartbeat_ttl_seconds: number;
  last_heartbeat_at: MySqlDateTimeValue;
  created_at: MySqlDateTimeValue;
  updated_at: MySqlDateTimeValue;
}

interface AgentAuditLogRow extends RowDataPacket {
  audit_log_id: string;
  organization_id: string;
  event_type: string;
  actor_principal_id: string;
  subject_agent_id: string | null;
  suggestion_id: string | null;
  summary: string;
  payload_json: unknown | null;
  created_at: MySqlDateTimeValue;
}

interface AgentExecutionLeaseRow extends RowDataPacket {
  lease_id: string;
  run_id: string;
  work_item_id: string;
  target_agent_id: string;
  node_id: string;
  status: string;
  lease_token: string;
  lease_expires_at: MySqlDateTimeValue;
  last_heartbeat_at: MySqlDateTimeValue | null;
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
  `CREATE TABLE IF NOT EXISTS themis_agent_spawn_policies (
    organization_id VARCHAR(191) PRIMARY KEY,
    max_active_agents INT NOT NULL,
    max_active_agents_per_role INT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_spawn_suggestion_states (
    suggestion_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    state VARCHAR(64) NOT NULL,
    payload_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_themis_agent_spawn_suggestion_states_org (organization_id, updated_at, suggestion_id)
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
    agent_card_json JSON NULL,
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
  `CREATE TABLE IF NOT EXISTS themis_project_workspace_bindings (
    project_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    owning_agent_id VARCHAR(191) NULL,
    workspace_root_id VARCHAR(191) NULL,
    workspace_policy_id VARCHAR(191) NULL,
    canonical_workspace_path TEXT NULL,
    preferred_node_id VARCHAR(191) NULL,
    preferred_node_pool VARCHAR(191) NULL,
    last_active_node_id VARCHAR(191) NULL,
    last_active_workspace_path TEXT NULL,
    continuity_mode VARCHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_themis_project_workspace_bindings_org (organization_id, updated_at, project_id),
    KEY idx_themis_project_workspace_bindings_owner (owning_agent_id, updated_at, project_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_work_items (
    work_item_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    target_agent_id VARCHAR(191) NOT NULL,
    project_id VARCHAR(191) NULL,
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
    KEY idx_themis_agent_work_items_parent (parent_work_item_id),
    KEY idx_themis_agent_work_items_project (project_id, updated_at, work_item_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_messages (
    message_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    from_agent_id VARCHAR(191) NOT NULL,
    to_agent_id VARCHAR(191) NOT NULL,
    work_item_id VARCHAR(191) NULL,
    run_id VARCHAR(191) NULL,
    parent_message_id VARCHAR(191) NULL,
    message_type VARCHAR(64) NOT NULL,
    payload_json JSON NULL,
    artifact_refs_json JSON NULL,
    priority VARCHAR(64) NOT NULL,
    requires_ack TINYINT(1) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    KEY idx_themis_agent_messages_work_item (work_item_id, created_at, message_id),
    KEY idx_themis_agent_messages_to_agent (to_agent_id, created_at, message_id),
    KEY idx_themis_agent_messages_from_agent (from_agent_id, created_at, message_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_handoffs (
    handoff_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    from_agent_id VARCHAR(191) NOT NULL,
    to_agent_id VARCHAR(191) NOT NULL,
    work_item_id VARCHAR(191) NOT NULL,
    source_message_id VARCHAR(191) NULL,
    source_run_id VARCHAR(191) NULL,
    summary TEXT NOT NULL,
    blockers_json JSON NULL,
    recommended_next_actions_json JSON NULL,
    attached_artifacts_json JSON NULL,
    payload_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_themis_agent_handoffs_work_item (work_item_id, created_at, handoff_id),
    KEY idx_themis_agent_handoffs_to_agent (to_agent_id, created_at, handoff_id),
    KEY idx_themis_agent_handoffs_from_agent (from_agent_id, created_at, handoff_id)
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
  `CREATE TABLE IF NOT EXISTS themis_agent_nodes (
    node_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    status VARCHAR(64) NOT NULL,
    slot_capacity INT NOT NULL,
    slot_available INT NOT NULL,
    labels_json JSON NULL,
    workspace_capabilities_json JSON NULL,
    credential_capabilities_json JSON NULL,
    provider_capabilities_json JSON NULL,
    heartbeat_ttl_seconds INT NOT NULL,
    last_heartbeat_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_themis_agent_nodes_org_status (organization_id, status, updated_at, node_id),
    KEY idx_themis_agent_nodes_heartbeat (status, last_heartbeat_at, node_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_execution_leases (
    lease_id VARCHAR(191) PRIMARY KEY,
    run_id VARCHAR(191) NOT NULL,
    work_item_id VARCHAR(191) NOT NULL,
    target_agent_id VARCHAR(191) NOT NULL,
    node_id VARCHAR(191) NOT NULL,
    status VARCHAR(64) NOT NULL,
    lease_token VARCHAR(191) NOT NULL,
    lease_expires_at DATETIME(3) NOT NULL,
    last_heartbeat_at DATETIME(3) NULL,
    active_run_id VARCHAR(191) GENERATED ALWAYS AS (
      CASE
        WHEN status = 'active' THEN run_id
        ELSE NULL
      END
    ) STORED,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_themis_agent_execution_leases_active_run (active_run_id),
    KEY idx_themis_agent_execution_leases_run_status (run_id, status, updated_at, lease_id),
    KEY idx_themis_agent_execution_leases_node_status (node_id, status, updated_at, lease_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_mailboxes (
    mailbox_entry_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    owner_agent_id VARCHAR(191) NOT NULL,
    message_id VARCHAR(191) NOT NULL,
    work_item_id VARCHAR(191) NULL,
    priority VARCHAR(64) NOT NULL,
    status VARCHAR(64) NOT NULL,
    requires_ack TINYINT(1) NOT NULL,
    available_at DATETIME(3) NOT NULL,
    lease_token VARCHAR(191) NULL,
    leased_at DATETIME(3) NULL,
    acked_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY idx_themis_agent_mailboxes_owner (owner_agent_id, status, available_at, created_at, mailbox_entry_id),
    KEY idx_themis_agent_mailboxes_message (message_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS themis_agent_audit_logs (
    audit_log_id VARCHAR(191) PRIMARY KEY,
    organization_id VARCHAR(191) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    actor_principal_id VARCHAR(191) NOT NULL,
    subject_agent_id VARCHAR(191) NULL,
    suggestion_id VARCHAR(191) NULL,
    summary TEXT NOT NULL,
    payload_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    KEY idx_themis_agent_audit_logs_org (organization_id, created_at, audit_log_id),
    KEY idx_themis_agent_audit_logs_suggestion (suggestion_id, created_at, audit_log_id)
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

    const [projectIdColumns] = await this.pool.query<Array<RowDataPacket & { Field: string }>>(
      "SHOW COLUMNS FROM themis_agent_work_items LIKE 'project_id'",
    );

    if (projectIdColumns.length === 0) {
      await this.pool.query(
        "ALTER TABLE themis_agent_work_items ADD COLUMN project_id VARCHAR(191) NULL AFTER target_agent_id",
      );
    }

    const [agentCardColumns] = await this.pool.query<Array<RowDataPacket & { Field: string }>>(
      "SHOW COLUMNS FROM themis_managed_agents LIKE 'agent_card_json'",
    );

    if (agentCardColumns.length === 0) {
      await this.pool.query(
        "ALTER TABLE themis_managed_agents ADD COLUMN agent_card_json JSON NULL AFTER default_runtime_profile_id",
      );
    }
  }

  async exportSharedSnapshot(): Promise<ManagedAgentControlPlaneSnapshot> {
    const snapshot = {
      principals: [],
      organizations: [],
      spawnPolicies: [],
      spawnSuggestionStates: [],
      managedAgents: [],
      workspacePolicies: [],
      runtimeProfiles: [],
      projectWorkspaceBindings: [],
      workItems: [],
      messages: [],
      handoffs: [],
      runs: [],
      nodes: [],
      executionLeases: [],
      mailboxes: [],
      auditLogs: [],
    } as ManagedAgentControlPlaneSnapshot;

    for (const table of MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES) {
      const [rows] = await this.pool.query<Array<RowDataPacket & Record<string, unknown>>>(
        `SELECT ${table.columns.join(", ")} FROM ${table.table} ORDER BY ${table.orderBy}`,
      );
      snapshot[table.key] = rows.map((row) => normalizeSnapshotRow(row));
    }

    return snapshot;
  }

  async replaceSharedSnapshot(snapshot: ManagedAgentControlPlaneSnapshot): Promise<void> {
    await this.withTransaction(async (connection) => {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");

      for (const table of [...MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES].reverse()) {
        await connection.query(`DELETE FROM ${table.table}`);
      }

      for (const table of MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES) {
        const rows = snapshot[table.key];

        if (!rows.length) {
          continue;
        }

        const placeholders = table.columns.map((column) =>
          isSnapshotJsonColumn(column) ? "CAST(? AS JSON)" : "?").join(", ");
        const statement = `INSERT INTO ${table.table} (${table.columns.join(", ")}) VALUES (${placeholders})`;

        for (const row of rows) {
          await connection.execute<ResultSetHeader>(
            statement,
            table.columns.map((column) => normalizeMySqlSnapshotValue(column, row[column] ?? null)),
          );
        }
      }

      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    });
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

  async listOrganizationsByOwnerPrincipal(ownerPrincipalId: string): Promise<StoredOrganizationRecord[]> {
    const [rows] = await this.pool.query<OrganizationRow[]>(
      `SELECT organization_id, owner_principal_id, display_name, slug, created_at, updated_at
       FROM themis_organizations
       WHERE owner_principal_id = ?
       ORDER BY updated_at DESC, organization_id ASC`,
      [ownerPrincipalId],
    );

    return rows.map(mapOrganizationRow);
  }

  async getAgentSpawnPolicy(organizationId: string): Promise<StoredAgentSpawnPolicyRecord | null> {
    const [rows] = await this.pool.query<AgentSpawnPolicyRow[]>(
      `SELECT
         organization_id, max_active_agents, max_active_agents_per_role, created_at, updated_at
       FROM themis_agent_spawn_policies
       WHERE organization_id = ?
       LIMIT 1`,
      [organizationId],
    );
    const row = rows[0];
    return row ? mapAgentSpawnPolicyRow(row) : null;
  }

  async getAgentSpawnSuggestionState(suggestionId: string): Promise<StoredAgentSpawnSuggestionStateRecord | null> {
    const [rows] = await this.pool.query<AgentSpawnSuggestionStateRow[]>(
      `SELECT
         suggestion_id, organization_id, state, payload_json, created_at, updated_at
       FROM themis_agent_spawn_suggestion_states
       WHERE suggestion_id = ?
       LIMIT 1`,
      [suggestionId],
    );
    const row = rows[0];
    return row ? mapAgentSpawnSuggestionStateRow(row) : null;
  }

  async listAgentSpawnSuggestionStatesByOrganization(
    organizationId: string,
  ): Promise<StoredAgentSpawnSuggestionStateRecord[]> {
    const [rows] = await this.pool.query<AgentSpawnSuggestionStateRow[]>(
      `SELECT
         suggestion_id, organization_id, state, payload_json, created_at, updated_at
       FROM themis_agent_spawn_suggestion_states
       WHERE organization_id = ?
       ORDER BY updated_at DESC, suggestion_id DESC`,
      [organizationId],
    );
    return rows.map(mapAgentSpawnSuggestionStateRow);
  }

  async saveAgentSpawnPolicy(record: StoredAgentSpawnPolicyRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_spawn_policies (
        organization_id, max_active_agents, max_active_agents_per_role, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        max_active_agents = VALUES(max_active_agents),
        max_active_agents_per_role = VALUES(max_active_agents_per_role),
        updated_at = VALUES(updated_at)`,
      [
        record.organizationId,
        record.maxActiveAgents,
        record.maxActiveAgentsPerRole,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async saveAgentSpawnSuggestionState(record: StoredAgentSpawnSuggestionStateRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_spawn_suggestion_states (
        suggestion_id, organization_id, state, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        state = VALUES(state),
        payload_json = VALUES(payload_json),
        updated_at = VALUES(updated_at)`,
      [
        record.suggestionId,
        record.organizationId,
        record.state,
        stringifyJson(record.payload),
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async deleteAgentSpawnSuggestionState(suggestionId: string): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM themis_agent_spawn_suggestion_states
       WHERE suggestion_id = ?`,
      [suggestionId],
    );
    return result.affectedRows > 0;
  }

  async saveManagedAgent(record: StoredManagedAgentRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_managed_agents (
        agent_id, principal_id, organization_id, created_by_principal_id, supervisor_principal_id,
        display_name, slug, department_role, mission, status, autonomy_level, creation_mode,
        exposure_policy, default_workspace_policy_id, default_runtime_profile_id, agent_card_json,
        bootstrap_profile_json, bootstrapped_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)
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
        agent_card_json = VALUES(agent_card_json),
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
        stringifyJson(record.agentCard),
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
         exposure_policy, default_workspace_policy_id, default_runtime_profile_id, agent_card_json, bootstrap_profile_json,
         bootstrapped_at, created_at, updated_at
       FROM themis_managed_agents
       WHERE agent_id = ? LIMIT 1`,
      [agentId],
    );
    const row = rows[0];
    return row ? mapManagedAgentRow(row) : null;
  }

  async getManagedAgentByPrincipal(principalId: string): Promise<StoredManagedAgentRecord | null> {
    const [rows] = await this.pool.query<ManagedAgentRow[]>(
      `SELECT
         agent_id, principal_id, organization_id, created_by_principal_id, supervisor_principal_id,
         display_name, slug, department_role, mission, status, autonomy_level, creation_mode,
         exposure_policy, default_workspace_policy_id, default_runtime_profile_id, agent_card_json, bootstrap_profile_json,
         bootstrapped_at, created_at, updated_at
       FROM themis_managed_agents
       WHERE principal_id = ? LIMIT 1`,
      [principalId],
    );
    const row = rows[0];
    return row ? mapManagedAgentRow(row) : null;
  }

  async listManagedAgentsByOrganization(organizationId: string): Promise<StoredManagedAgentRecord[]> {
    const [rows] = await this.pool.query<ManagedAgentRow[]>(
      `SELECT
         agent_id, principal_id, organization_id, created_by_principal_id, supervisor_principal_id,
         display_name, slug, department_role, mission, status, autonomy_level, creation_mode,
         exposure_policy, default_workspace_policy_id, default_runtime_profile_id, agent_card_json, bootstrap_profile_json,
         bootstrapped_at, created_at, updated_at
       FROM themis_managed_agents
       WHERE organization_id = ?
       ORDER BY updated_at DESC, agent_id ASC`,
      [organizationId],
    );
    return rows.map(mapManagedAgentRow);
  }

  async listManagedAgentsByOwnerPrincipal(ownerPrincipalId: string): Promise<StoredManagedAgentRecord[]> {
    const [rows] = await this.pool.query<ManagedAgentRow[]>(
      `SELECT
         agent.agent_id, agent.principal_id, agent.organization_id, agent.created_by_principal_id,
         agent.supervisor_principal_id, agent.display_name, agent.slug, agent.department_role, agent.mission,
         agent.status, agent.autonomy_level, agent.creation_mode, agent.exposure_policy,
         agent.default_workspace_policy_id, agent.default_runtime_profile_id, agent.agent_card_json, agent.bootstrap_profile_json,
         agent.bootstrapped_at, agent.created_at, agent.updated_at
       FROM themis_managed_agents agent
       INNER JOIN themis_organizations organization
         ON organization.organization_id = agent.organization_id
       WHERE organization.owner_principal_id = ?
       ORDER BY agent.updated_at DESC, agent.agent_id ASC`,
      [ownerPrincipalId],
    );
    return rows.map(mapManagedAgentRow);
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

  async getAgentWorkspacePolicyByOwnerAgent(ownerAgentId: string): Promise<StoredAgentWorkspacePolicyRecord | null> {
    const [rows] = await this.pool.query<AgentWorkspacePolicyRow[]>(
      `SELECT
         policy_id, organization_id, owner_agent_id, display_name, workspace_path,
         additional_directories_json, allow_network_access, created_at, updated_at
       FROM themis_agent_workspace_policies
       WHERE owner_agent_id = ?
       LIMIT 1`,
      [ownerAgentId],
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

  async getAgentRuntimeProfileByOwnerAgent(ownerAgentId: string): Promise<StoredAgentRuntimeProfileRecord | null> {
    const [rows] = await this.pool.query<AgentRuntimeProfileRow[]>(
      `SELECT profile_id, organization_id, owner_agent_id, display_name, snapshot_json, created_at, updated_at
       FROM themis_agent_runtime_profiles
       WHERE owner_agent_id = ?
       LIMIT 1`,
      [ownerAgentId],
    );
    const row = rows[0];
    return row ? mapAgentRuntimeProfileRow(row) : null;
  }

  async getProjectWorkspaceBinding(projectId: string): Promise<StoredProjectWorkspaceBindingRecord | null> {
    const [rows] = await this.pool.query<ProjectWorkspaceBindingRow[]>(
      `SELECT
         project_id, organization_id, display_name, owning_agent_id, workspace_root_id, workspace_policy_id,
         canonical_workspace_path, preferred_node_id, preferred_node_pool, last_active_node_id,
         last_active_workspace_path, continuity_mode, created_at, updated_at
       FROM themis_project_workspace_bindings
       WHERE project_id = ?
       LIMIT 1`,
      [projectId],
    );
    const row = rows[0];
    return row ? mapProjectWorkspaceBindingRow(row) : null;
  }

  async listProjectWorkspaceBindingsByOrganization(
    organizationId: string,
  ): Promise<StoredProjectWorkspaceBindingRecord[]> {
    const [rows] = await this.pool.query<ProjectWorkspaceBindingRow[]>(
      `SELECT
         project_id, organization_id, display_name, owning_agent_id, workspace_root_id, workspace_policy_id,
         canonical_workspace_path, preferred_node_id, preferred_node_pool, last_active_node_id,
         last_active_workspace_path, continuity_mode, created_at, updated_at
       FROM themis_project_workspace_bindings
       WHERE organization_id = ?
       ORDER BY updated_at DESC, project_id ASC`,
      [organizationId],
    );
    return rows.map(mapProjectWorkspaceBindingRow);
  }

  async saveProjectWorkspaceBinding(record: StoredProjectWorkspaceBindingRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_project_workspace_bindings (
        project_id, organization_id, display_name, owning_agent_id, workspace_root_id, workspace_policy_id,
        canonical_workspace_path, preferred_node_id, preferred_node_pool, last_active_node_id,
        last_active_workspace_path, continuity_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        display_name = VALUES(display_name),
        owning_agent_id = VALUES(owning_agent_id),
        workspace_root_id = VALUES(workspace_root_id),
        workspace_policy_id = VALUES(workspace_policy_id),
        canonical_workspace_path = VALUES(canonical_workspace_path),
        preferred_node_id = VALUES(preferred_node_id),
        preferred_node_pool = VALUES(preferred_node_pool),
        last_active_node_id = VALUES(last_active_node_id),
        last_active_workspace_path = VALUES(last_active_workspace_path),
        continuity_mode = VALUES(continuity_mode),
        updated_at = VALUES(updated_at)`,
      [
        record.projectId,
        record.organizationId,
        record.displayName,
        record.owningAgentId ?? null,
        record.workspaceRootId ?? null,
        record.workspacePolicyId ?? null,
        record.canonicalWorkspacePath ?? null,
        record.preferredNodeId ?? null,
        record.preferredNodePool ?? null,
        record.lastActiveNodeId ?? null,
        record.lastActiveWorkspacePath ?? null,
        record.continuityMode,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async saveAgentWorkItem(record: StoredAgentWorkItemRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_work_items (
        work_item_id, organization_id, target_agent_id, project_id, source_type, source_principal_id,
        source_agent_id, parent_work_item_id, dispatch_reason, goal, context_packet_json,
        waiting_action_request_json, latest_human_response_json, priority, status,
        workspace_policy_snapshot_json, runtime_profile_snapshot_json, created_at, scheduled_at,
        started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        target_agent_id = VALUES(target_agent_id),
        project_id = VALUES(project_id),
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
        record.projectId ?? null,
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
         work_item_id, organization_id, target_agent_id, project_id, source_type, source_principal_id,
         source_agent_id, parent_work_item_id, dispatch_reason, goal, context_packet_json,
         waiting_action_request_json, latest_human_response_json, priority, status,
         workspace_policy_snapshot_json, runtime_profile_snapshot_json, created_at, scheduled_at,
         started_at, completed_at, updated_at
       FROM themis_agent_work_items
       WHERE work_item_id = ? LIMIT 1`,
      [workItemId],
    );
    const row = rows[0];
    return row ? mapAgentWorkItemRow(row) : null;
  }

  async listAgentWorkItemsByTargetAgent(targetAgentId: string): Promise<StoredAgentWorkItemRecord[]> {
    const [rows] = await this.pool.query<AgentWorkItemRow[]>(
      `SELECT
         work_item_id, organization_id, target_agent_id, project_id, source_type, source_principal_id,
         source_agent_id, parent_work_item_id, dispatch_reason, goal, context_packet_json,
         waiting_action_request_json, latest_human_response_json, priority, status,
         workspace_policy_snapshot_json, runtime_profile_snapshot_json, created_at, scheduled_at,
         started_at, completed_at, updated_at
       FROM themis_agent_work_items
       WHERE target_agent_id = ?
       ORDER BY created_at DESC, work_item_id ASC`,
      [targetAgentId],
    );
    return rows.map(mapAgentWorkItemRow);
  }

  async listAgentWorkItemsByOwnerPrincipal(ownerPrincipalId: string): Promise<StoredAgentWorkItemRecord[]> {
    const [rows] = await this.pool.query<AgentWorkItemRow[]>(
      `SELECT
         work_item.work_item_id, work_item.organization_id, work_item.target_agent_id, work_item.project_id,
         work_item.source_type, work_item.source_principal_id, work_item.source_agent_id,
         work_item.parent_work_item_id, work_item.dispatch_reason, work_item.goal, work_item.context_packet_json,
         work_item.waiting_action_request_json, work_item.latest_human_response_json, work_item.priority,
         work_item.status, work_item.workspace_policy_snapshot_json, work_item.runtime_profile_snapshot_json,
         work_item.created_at, work_item.scheduled_at, work_item.started_at, work_item.completed_at,
         work_item.updated_at
       FROM themis_agent_work_items work_item
       INNER JOIN themis_organizations organization
         ON organization.organization_id = work_item.organization_id
       WHERE organization.owner_principal_id = ?
       ORDER BY work_item.created_at DESC, work_item.work_item_id ASC`,
      [ownerPrincipalId],
    );
    return rows.map(mapAgentWorkItemRow);
  }

  async listAgentWorkItemsByParentWorkItem(parentWorkItemId: string): Promise<StoredAgentWorkItemRecord[]> {
    const [rows] = await this.pool.query<AgentWorkItemRow[]>(
      `SELECT
         work_item_id, organization_id, target_agent_id, project_id, source_type, source_principal_id,
         source_agent_id, parent_work_item_id, dispatch_reason, goal, context_packet_json,
         waiting_action_request_json, latest_human_response_json, priority, status,
         workspace_policy_snapshot_json, runtime_profile_snapshot_json, created_at, scheduled_at,
         started_at, completed_at, updated_at
       FROM themis_agent_work_items
       WHERE parent_work_item_id = ?
       ORDER BY created_at DESC, work_item_id ASC`,
      [parentWorkItemId],
    );
    return rows.map(mapAgentWorkItemRow);
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

  async listAgentRunsByWorkItem(workItemId: string): Promise<StoredAgentRunRecord[]> {
    const [rows] = await this.pool.query<AgentRunRow[]>(
      `SELECT
         run_id, organization_id, work_item_id, target_agent_id, scheduler_id, lease_token,
         lease_expires_at, status, started_at, last_heartbeat_at, completed_at, failure_code,
         failure_message, created_at, updated_at
       FROM themis_agent_runs
       WHERE work_item_id = ?
       ORDER BY created_at DESC, run_id ASC`,
      [workItemId],
    );
    return rows.map(mapAgentRunRow);
  }

  async listAgentRunsByOwnerPrincipal(ownerPrincipalId: string): Promise<StoredAgentRunRecord[]> {
    const [rows] = await this.pool.query<AgentRunRow[]>(
      `SELECT
         run.run_id, run.organization_id, run.work_item_id, run.target_agent_id, run.scheduler_id, run.lease_token,
         run.lease_expires_at, run.status, run.started_at, run.last_heartbeat_at, run.completed_at,
         run.failure_code, run.failure_message, run.created_at, run.updated_at
       FROM themis_agent_runs run
       INNER JOIN themis_organizations organization
         ON organization.organization_id = run.organization_id
       WHERE organization.owner_principal_id = ?
       ORDER BY run.created_at DESC, run.run_id ASC`,
      [ownerPrincipalId],
    );
    return rows.map(mapAgentRunRow);
  }

  async listStaleActiveAgentRuns(leaseExpiresBefore: string): Promise<StoredAgentRunRecord[]> {
    const [rows] = await this.pool.query<AgentRunRow[]>(
      `SELECT
         run_id, organization_id, work_item_id, target_agent_id, scheduler_id, lease_token,
         lease_expires_at, status, started_at, last_heartbeat_at, completed_at, failure_code,
         failure_message, created_at, updated_at
       FROM themis_agent_runs
       WHERE status IN ('created', 'starting', 'running', 'waiting_action')
         AND lease_expires_at <= ?
       ORDER BY lease_expires_at ASC, run_id ASC`,
      [toMySqlDateTime(leaseExpiresBefore)],
    );
    return rows.map(mapAgentRunRow);
  }

  async saveManagedAgentNode(record: StoredManagedAgentNodeRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_nodes (
        node_id, organization_id, display_name, status, slot_capacity, slot_available,
        labels_json, workspace_capabilities_json, credential_capabilities_json, provider_capabilities_json,
        heartbeat_ttl_seconds, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        display_name = VALUES(display_name),
        status = VALUES(status),
        slot_capacity = VALUES(slot_capacity),
        slot_available = VALUES(slot_available),
        labels_json = VALUES(labels_json),
        workspace_capabilities_json = VALUES(workspace_capabilities_json),
        credential_capabilities_json = VALUES(credential_capabilities_json),
        provider_capabilities_json = VALUES(provider_capabilities_json),
        heartbeat_ttl_seconds = VALUES(heartbeat_ttl_seconds),
        last_heartbeat_at = VALUES(last_heartbeat_at),
        updated_at = VALUES(updated_at)`,
      [
        record.nodeId,
        record.organizationId,
        record.displayName,
        record.status,
        record.slotCapacity,
        record.slotAvailable,
        stringifyJson(record.labels),
        stringifyJson(record.workspaceCapabilities),
        stringifyJson(record.credentialCapabilities),
        stringifyJson(record.providerCapabilities),
        record.heartbeatTtlSeconds,
        toMySqlDateTime(record.lastHeartbeatAt),
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getManagedAgentNode(nodeId: string): Promise<StoredManagedAgentNodeRecord | null> {
    const [rows] = await this.pool.query<ManagedAgentNodeRow[]>(
      `SELECT
         node_id, organization_id, display_name, status, slot_capacity, slot_available,
         labels_json, workspace_capabilities_json, credential_capabilities_json, provider_capabilities_json,
         heartbeat_ttl_seconds, last_heartbeat_at, created_at, updated_at
       FROM themis_agent_nodes
       WHERE node_id = ? LIMIT 1`,
      [nodeId],
    );
    const row = rows[0];
    return row ? mapManagedAgentNodeRow(row) : null;
  }

  async listManagedAgentNodesByOrganization(organizationId: string): Promise<StoredManagedAgentNodeRecord[]> {
    const [rows] = await this.pool.query<ManagedAgentNodeRow[]>(
      `SELECT
         node_id, organization_id, display_name, status, slot_capacity, slot_available,
         labels_json, workspace_capabilities_json, credential_capabilities_json, provider_capabilities_json,
         heartbeat_ttl_seconds, last_heartbeat_at, created_at, updated_at
       FROM themis_agent_nodes
       WHERE organization_id = ?
       ORDER BY updated_at DESC, node_id ASC`,
      [organizationId],
    );
    return rows.map(mapManagedAgentNodeRow);
  }

  async saveAgentExecutionLease(record: StoredAgentExecutionLeaseRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_execution_leases (
        lease_id, run_id, work_item_id, target_agent_id, node_id, status, lease_token,
        lease_expires_at, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        run_id = VALUES(run_id),
        work_item_id = VALUES(work_item_id),
        target_agent_id = VALUES(target_agent_id),
        node_id = VALUES(node_id),
        status = VALUES(status),
        lease_token = VALUES(lease_token),
        lease_expires_at = VALUES(lease_expires_at),
        last_heartbeat_at = VALUES(last_heartbeat_at),
        updated_at = VALUES(updated_at)`,
      [
        record.leaseId,
        record.runId,
        record.workItemId,
        record.targetAgentId,
        record.nodeId,
        record.status,
        record.leaseToken,
        toMySqlDateTime(record.leaseExpiresAt),
        record.lastHeartbeatAt ? toMySqlDateTime(record.lastHeartbeatAt) : null,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getAgentExecutionLease(leaseId: string): Promise<StoredAgentExecutionLeaseRecord | null> {
    const [rows] = await this.pool.query<AgentExecutionLeaseRow[]>(
      `SELECT
         lease_id, run_id, work_item_id, target_agent_id, node_id, status, lease_token,
         lease_expires_at, last_heartbeat_at, created_at, updated_at
       FROM themis_agent_execution_leases
       WHERE lease_id = ? LIMIT 1`,
      [leaseId],
    );
    const row = rows[0];
    return row ? mapAgentExecutionLeaseRow(row) : null;
  }

  async getActiveAgentExecutionLeaseByRun(runId: string): Promise<StoredAgentExecutionLeaseRecord | null> {
    const [rows] = await this.pool.query<AgentExecutionLeaseRow[]>(
      `SELECT
         lease_id, run_id, work_item_id, target_agent_id, node_id, status, lease_token,
         lease_expires_at, last_heartbeat_at, created_at, updated_at
       FROM themis_agent_execution_leases
       WHERE run_id = ?
         AND status = 'active'
       ORDER BY updated_at DESC, lease_id ASC
       LIMIT 1`,
      [runId],
    );
    const row = rows[0];
    return row ? mapAgentExecutionLeaseRow(row) : null;
  }

  async listActiveAgentExecutionLeases(): Promise<StoredAgentExecutionLeaseRecord[]> {
    const [rows] = await this.pool.query<AgentExecutionLeaseRow[]>(
      `SELECT
         lease_id, run_id, work_item_id, target_agent_id, node_id, status, lease_token,
         lease_expires_at, last_heartbeat_at, created_at, updated_at
       FROM themis_agent_execution_leases
       WHERE status = 'active'
       ORDER BY updated_at DESC, lease_id ASC`,
    );
    return rows.map(mapAgentExecutionLeaseRow);
  }

  async listAgentExecutionLeasesByRun(runId: string): Promise<StoredAgentExecutionLeaseRecord[]> {
    const [rows] = await this.pool.query<AgentExecutionLeaseRow[]>(
      `SELECT
         lease_id, run_id, work_item_id, target_agent_id, node_id, status, lease_token,
         lease_expires_at, last_heartbeat_at, created_at, updated_at
       FROM themis_agent_execution_leases
       WHERE run_id = ?
       ORDER BY created_at DESC, lease_id ASC`,
      [runId],
    );
    return rows.map(mapAgentExecutionLeaseRow);
  }

  async listAgentExecutionLeasesByNode(nodeId: string): Promise<StoredAgentExecutionLeaseRecord[]> {
    const [rows] = await this.pool.query<AgentExecutionLeaseRow[]>(
      `SELECT
         lease_id, run_id, work_item_id, target_agent_id, node_id, status, lease_token,
         lease_expires_at, last_heartbeat_at, created_at, updated_at
       FROM themis_agent_execution_leases
       WHERE node_id = ?
       ORDER BY created_at DESC, lease_id ASC`,
      [nodeId],
    );
    return rows.map(mapAgentExecutionLeaseRow);
  }

  async getAgentMessage(messageId: string): Promise<StoredAgentMessageRecord | null> {
    const [rows] = await this.pool.query<AgentMessageRow[]>(
      `SELECT
         message_id, organization_id, from_agent_id, to_agent_id, work_item_id, run_id, parent_message_id,
         message_type, payload_json, artifact_refs_json, priority, requires_ack, created_at
       FROM themis_agent_messages
       WHERE message_id = ?
       LIMIT 1`,
      [messageId],
    );
    const row = rows[0];
    return row ? mapAgentMessageRow(row) : null;
  }

  async listAgentMessagesByWorkItem(workItemId: string): Promise<StoredAgentMessageRecord[]> {
    const [rows] = await this.pool.query<AgentMessageRow[]>(
      `SELECT
         message_id, organization_id, from_agent_id, to_agent_id, work_item_id, run_id, parent_message_id,
         message_type, payload_json, artifact_refs_json, priority, requires_ack, created_at
       FROM themis_agent_messages
       WHERE work_item_id = ?
       ORDER BY created_at ASC, message_id ASC`,
      [workItemId],
    );
    return rows.map(mapAgentMessageRow);
  }

  async listAgentMessagesByAgent(agentId: string): Promise<StoredAgentMessageRecord[]> {
    const [rows] = await this.pool.query<AgentMessageRow[]>(
      `SELECT
         message_id, organization_id, from_agent_id, to_agent_id, work_item_id, run_id, parent_message_id,
         message_type, payload_json, artifact_refs_json, priority, requires_ack, created_at
       FROM themis_agent_messages
       WHERE from_agent_id = ?
          OR to_agent_id = ?
       ORDER BY created_at DESC, message_id DESC`,
      [agentId, agentId],
    );
    return rows.map(mapAgentMessageRow);
  }

  async saveAgentMessage(record: StoredAgentMessageRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_messages (
        message_id, organization_id, from_agent_id, to_agent_id, work_item_id, run_id, parent_message_id,
        message_type, payload_json, artifact_refs_json, priority, requires_ack, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        work_item_id = VALUES(work_item_id),
        run_id = VALUES(run_id),
        parent_message_id = VALUES(parent_message_id),
        message_type = VALUES(message_type),
        payload_json = VALUES(payload_json),
        artifact_refs_json = VALUES(artifact_refs_json),
        priority = VALUES(priority),
        requires_ack = VALUES(requires_ack)`,
      [
        record.messageId,
        record.organizationId,
        record.fromAgentId,
        record.toAgentId,
        record.workItemId ?? null,
        record.runId ?? null,
        record.parentMessageId ?? null,
        record.messageType,
        stringifyJson(record.payload),
        stringifyJson(record.artifactRefs),
        record.priority,
        record.requiresAck ? 1 : 0,
        toMySqlDateTime(record.createdAt),
      ],
    );
  }

  async getAgentHandoff(handoffId: string): Promise<StoredAgentHandoffRecord | null> {
    const [rows] = await this.pool.query<AgentHandoffRow[]>(
      `SELECT
         handoff_id, organization_id, from_agent_id, to_agent_id, work_item_id, source_message_id,
         source_run_id, summary, blockers_json, recommended_next_actions_json, attached_artifacts_json,
         payload_json, created_at, updated_at
       FROM themis_agent_handoffs
       WHERE handoff_id = ?
       LIMIT 1`,
      [handoffId],
    );
    const row = rows[0];
    return row ? mapAgentHandoffRow(row) : null;
  }

  async listAgentHandoffsByWorkItem(workItemId: string): Promise<StoredAgentHandoffRecord[]> {
    const [rows] = await this.pool.query<AgentHandoffRow[]>(
      `SELECT
         handoff_id, organization_id, from_agent_id, to_agent_id, work_item_id, source_message_id,
         source_run_id, summary, blockers_json, recommended_next_actions_json, attached_artifacts_json,
         payload_json, created_at, updated_at
       FROM themis_agent_handoffs
       WHERE work_item_id = ?
       ORDER BY created_at DESC, handoff_id DESC`,
      [workItemId],
    );
    return rows.map(mapAgentHandoffRow);
  }

  async listAgentHandoffsByAgent(agentId: string): Promise<StoredAgentHandoffRecord[]> {
    const [rows] = await this.pool.query<AgentHandoffRow[]>(
      `SELECT
         handoff_id, organization_id, from_agent_id, to_agent_id, work_item_id, source_message_id,
         source_run_id, summary, blockers_json, recommended_next_actions_json, attached_artifacts_json,
         payload_json, created_at, updated_at
       FROM themis_agent_handoffs
       WHERE from_agent_id = ?
          OR to_agent_id = ?
       ORDER BY created_at DESC, handoff_id DESC`,
      [agentId, agentId],
    );
    return rows.map(mapAgentHandoffRow);
  }

  async saveAgentHandoff(record: StoredAgentHandoffRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_handoffs (
        handoff_id, organization_id, from_agent_id, to_agent_id, work_item_id, source_message_id, source_run_id,
        summary, blockers_json, recommended_next_actions_json, attached_artifacts_json, payload_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?)
      ON DUPLICATE KEY UPDATE
        source_message_id = VALUES(source_message_id),
        source_run_id = VALUES(source_run_id),
        summary = VALUES(summary),
        blockers_json = VALUES(blockers_json),
        recommended_next_actions_json = VALUES(recommended_next_actions_json),
        attached_artifacts_json = VALUES(attached_artifacts_json),
        payload_json = VALUES(payload_json),
        updated_at = VALUES(updated_at)`,
      [
        record.handoffId,
        record.organizationId,
        record.fromAgentId,
        record.toAgentId,
        record.workItemId,
        record.sourceMessageId ?? null,
        record.sourceRunId ?? null,
        record.summary,
        stringifyJson(record.blockers),
        stringifyJson(record.recommendedNextActions),
        stringifyJson(record.attachedArtifacts),
        stringifyJson(record.payload),
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async getAgentMailboxEntry(mailboxEntryId: string): Promise<StoredAgentMailboxEntryRecord | null> {
    const [rows] = await this.pool.query<AgentMailboxEntryRow[]>(
      `SELECT
         mailbox_entry_id, organization_id, owner_agent_id, message_id, work_item_id, priority, status,
         requires_ack, available_at, lease_token, leased_at, acked_at, created_at, updated_at
       FROM themis_agent_mailboxes
       WHERE mailbox_entry_id = ?
       LIMIT 1`,
      [mailboxEntryId],
    );
    const row = rows[0];
    return row ? mapAgentMailboxEntryRow(row) : null;
  }

  async listAgentMailboxEntriesByAgent(ownerAgentId: string): Promise<StoredAgentMailboxEntryRecord[]> {
    const [rows] = await this.pool.query<AgentMailboxEntryRow[]>(
      `SELECT
         mailbox_entry_id, organization_id, owner_agent_id, message_id, work_item_id, priority, status,
         requires_ack, available_at, lease_token, leased_at, acked_at, created_at, updated_at
       FROM themis_agent_mailboxes
       WHERE owner_agent_id = ?
       ORDER BY created_at ASC, mailbox_entry_id ASC`,
      [ownerAgentId],
    );
    return rows.map(mapAgentMailboxEntryRow);
  }

  async saveAgentMailboxEntry(record: StoredAgentMailboxEntryRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_mailboxes (
        mailbox_entry_id, organization_id, owner_agent_id, message_id, work_item_id, priority, status,
        requires_ack, available_at, lease_token, leased_at, acked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        priority = VALUES(priority),
        status = VALUES(status),
        requires_ack = VALUES(requires_ack),
        available_at = VALUES(available_at),
        lease_token = VALUES(lease_token),
        leased_at = VALUES(leased_at),
        acked_at = VALUES(acked_at),
        updated_at = VALUES(updated_at)`,
      [
        record.mailboxEntryId,
        record.organizationId,
        record.ownerAgentId,
        record.messageId,
        record.workItemId ?? null,
        record.priority,
        record.status,
        record.requiresAck ? 1 : 0,
        toMySqlDateTime(record.availableAt),
        record.leaseToken ?? null,
        record.leasedAt ? toMySqlDateTime(record.leasedAt) : null,
        record.ackedAt ? toMySqlDateTime(record.ackedAt) : null,
        toMySqlDateTime(record.createdAt),
        toMySqlDateTime(record.updatedAt),
      ],
    );
  }

  async listAgentAuditLogsByOrganization(
    organizationId: string,
    limit = 20,
  ): Promise<StoredAgentAuditLogRecord[]> {
    const [rows] = await this.pool.query<AgentAuditLogRow[]>(
      `SELECT
         audit_log_id, organization_id, event_type, actor_principal_id, subject_agent_id, suggestion_id,
         summary, payload_json, created_at
       FROM themis_agent_audit_logs
       WHERE organization_id = ?
       ORDER BY created_at DESC, audit_log_id DESC
       LIMIT ?`,
      [organizationId, limit],
    );
    return rows.map(mapAgentAuditLogRow);
  }

  async saveAgentAuditLog(record: StoredAgentAuditLogRecord): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO themis_agent_audit_logs (
        audit_log_id, organization_id, event_type, actor_principal_id, subject_agent_id, suggestion_id,
        summary, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)
      ON DUPLICATE KEY UPDATE
        event_type = VALUES(event_type),
        actor_principal_id = VALUES(actor_principal_id),
        subject_agent_id = VALUES(subject_agent_id),
        suggestion_id = VALUES(suggestion_id),
        summary = VALUES(summary),
        payload_json = VALUES(payload_json),
        created_at = VALUES(created_at)`,
      [
        record.auditLogId,
        record.organizationId,
        record.eventType,
        record.actorPrincipalId,
        record.subjectAgentId ?? null,
        record.suggestionId ?? null,
        record.summary,
        stringifyJson(record.payload),
        toMySqlDateTime(record.createdAt),
      ],
    );
  }

  async claimNextAgentMailboxEntry(input: {
    ownerAgentId: string;
    leaseToken: string;
    leasedAt: string;
    now: string;
    staleLeaseBefore?: string;
  }): Promise<StoredAgentMailboxEntryRecord | null> {
    return this.withTransaction(async (connection) => {
      const [candidates] = await connection.query<Array<RowDataPacket & { mailbox_entry_id: string }>>(
        `SELECT mailbox_entry_id
         FROM themis_agent_mailboxes
         WHERE owner_agent_id = ?
           AND available_at <= ?
           AND (
             status = 'pending'
             OR (
               status = 'leased'
               AND ? IS NOT NULL
               AND (leased_at IS NULL OR leased_at <= ?)
             )
           )
         ORDER BY
           CASE status WHEN 'pending' THEN 0 ELSE 1 END ASC,
           CASE priority
             WHEN 'urgent' THEN 0
             WHEN 'high' THEN 1
             WHEN 'normal' THEN 2
             ELSE 3
           END ASC,
           created_at ASC,
           mailbox_entry_id ASC
         LIMIT 1
         FOR UPDATE`,
        [
          input.ownerAgentId,
          toMySqlDateTime(input.now),
          input.staleLeaseBefore ? toMySqlDateTime(input.staleLeaseBefore) : null,
          input.staleLeaseBefore ? toMySqlDateTime(input.staleLeaseBefore) : null,
        ],
      );
      const candidate = candidates[0];

      if (!candidate?.mailbox_entry_id) {
        return null;
      }

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE themis_agent_mailboxes
         SET status = 'leased',
             lease_token = ?,
             leased_at = ?,
             updated_at = ?
         WHERE mailbox_entry_id = ?
           AND (
             status = 'pending'
             OR (
               status = 'leased'
               AND ? IS NOT NULL
               AND (leased_at IS NULL OR leased_at <= ?)
             )
           )`,
        [
          input.leaseToken,
          toMySqlDateTime(input.leasedAt),
          toMySqlDateTime(input.now),
          candidate.mailbox_entry_id,
          input.staleLeaseBefore ? toMySqlDateTime(input.staleLeaseBefore) : null,
          input.staleLeaseBefore ? toMySqlDateTime(input.staleLeaseBefore) : null,
        ],
      );

      if (updateResult.affectedRows === 0) {
        return null;
      }

      const [rows] = await connection.query<AgentMailboxEntryRow[]>(
        `SELECT
           mailbox_entry_id, organization_id, owner_agent_id, message_id, work_item_id, priority, status,
           requires_ack, available_at, lease_token, leased_at, acked_at, created_at, updated_at
         FROM themis_agent_mailboxes
         WHERE mailbox_entry_id = ?
         LIMIT 1`,
        [candidate.mailbox_entry_id],
      );
      const row = rows[0];
      return row ? mapAgentMailboxEntryRow(row) : null;
    });
  }

  async claimNextRunnableAgentWorkItem(input: {
    schedulerId: string;
    leaseToken: string;
    leaseExpiresAt: string;
    now: string;
    organizationId?: string;
    targetAgentId?: string;
  }): Promise<{ workItem: StoredAgentWorkItemRecord; run: StoredAgentRunRecord } | null> {
    return this.withTransaction(async (connection) => {
      const filters = [
        "work_item.status = 'queued'",
        "agent.status IN ('active', 'bootstrapping')",
        "(work_item.scheduled_at IS NULL OR work_item.scheduled_at <= ?)",
        `NOT EXISTS (
          SELECT 1
          FROM themis_agent_runs active_run
          WHERE active_run.work_item_id = work_item.work_item_id
            AND active_run.status IN ('created', 'starting', 'running', 'waiting_action')
        )`,
        `NOT EXISTS (
          SELECT 1
          FROM themis_agent_runs active_run
          WHERE active_run.target_agent_id = work_item.target_agent_id
            AND active_run.status IN ('created', 'starting', 'running', 'waiting_action')
        )`,
      ];
      const params: Array<string | null> = [toMySqlDateTime(input.now)];

      if (input.organizationId) {
        filters.push("work_item.organization_id = ?");
        params.push(input.organizationId);
      }

      if (input.targetAgentId) {
        filters.push("work_item.target_agent_id = ?");
        params.push(input.targetAgentId);
      }

      const [candidates] = await connection.query<Array<RowDataPacket & { work_item_id: string }>>(
        `SELECT work_item.work_item_id
         FROM themis_agent_work_items work_item
         INNER JOIN themis_managed_agents agent
           ON agent.agent_id = work_item.target_agent_id
         WHERE ${filters.join(" AND ")}
         ORDER BY
           CASE work_item.priority
             WHEN 'urgent' THEN 0
             WHEN 'high' THEN 1
             WHEN 'normal' THEN 2
             ELSE 3
           END ASC,
           COALESCE(work_item.scheduled_at, work_item.created_at) ASC,
           work_item.created_at ASC,
           work_item.work_item_id ASC
         LIMIT 1
         FOR UPDATE`,
        params,
      );
      const candidate = candidates[0];

      if (!candidate?.work_item_id) {
        return null;
      }

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE themis_agent_work_items
         SET status = 'planning',
             started_at = COALESCE(started_at, ?),
             updated_at = ?
         WHERE work_item_id = ?
           AND status = 'queued'`,
        [
          toMySqlDateTime(input.now),
          toMySqlDateTime(input.now),
          candidate.work_item_id,
        ],
      );

      if (updateResult.affectedRows === 0) {
        return null;
      }

      const [workItemRows] = await connection.query<AgentWorkItemRow[]>(
        `SELECT
           work_item_id, organization_id, target_agent_id, project_id, source_type, source_principal_id,
           source_agent_id, parent_work_item_id, dispatch_reason, goal, context_packet_json,
           waiting_action_request_json, latest_human_response_json, priority, status,
           workspace_policy_snapshot_json, runtime_profile_snapshot_json, created_at, scheduled_at,
           started_at, completed_at, updated_at
         FROM themis_agent_work_items
         WHERE work_item_id = ?
         LIMIT 1`,
        [candidate.work_item_id],
      );
      const workItemRow = workItemRows[0];

      if (!workItemRow) {
        throw new Error("Claimed work item disappeared.");
      }

      const workItem = mapAgentWorkItemRow(workItemRow);
      const run: StoredAgentRunRecord = {
        runId: createId("run"),
        organizationId: workItem.organizationId,
        workItemId: workItem.workItemId,
        targetAgentId: workItem.targetAgentId,
        schedulerId: input.schedulerId,
        leaseToken: input.leaseToken,
        leaseExpiresAt: input.leaseExpiresAt,
        status: "created",
        createdAt: input.now,
        updatedAt: input.now,
      };

      await connection.execute<ResultSetHeader>(
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
          run.runId,
          run.organizationId,
          run.workItemId,
          run.targetAgentId,
          run.schedulerId,
          run.leaseToken,
          toMySqlDateTime(run.leaseExpiresAt),
          run.status,
          null,
          null,
          null,
          null,
          null,
          toMySqlDateTime(run.createdAt),
          toMySqlDateTime(run.updatedAt),
        ],
      );

      return { workItem, run };
    });
  }

  private async withTransaction<T>(callback: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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
  const agentCard = safeParseJson<ManagedAgentCard>(row.agent_card_json);
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
    ...(agentCard ? { agentCard } : {}),
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

function mapAgentSpawnPolicyRow(row: AgentSpawnPolicyRow): StoredAgentSpawnPolicyRecord {
  return {
    organizationId: row.organization_id,
    maxActiveAgents: row.max_active_agents,
    maxActiveAgentsPerRole: row.max_active_agents_per_role,
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapAgentSpawnSuggestionStateRow(
  row: AgentSpawnSuggestionStateRow,
): StoredAgentSpawnSuggestionStateRecord {
  return {
    suggestionId: row.suggestion_id,
    organizationId: row.organization_id,
    state: row.state as StoredAgentSpawnSuggestionStateRecord["state"],
    ...(safeParseJson(row.payload_json) !== undefined ? { payload: safeParseJson(row.payload_json) } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapProjectWorkspaceBindingRow(row: ProjectWorkspaceBindingRow): StoredProjectWorkspaceBindingRecord {
  return {
    projectId: row.project_id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    ...(row.owning_agent_id ? { owningAgentId: row.owning_agent_id } : {}),
    ...(row.workspace_root_id ? { workspaceRootId: row.workspace_root_id } : {}),
    ...(row.workspace_policy_id ? { workspacePolicyId: row.workspace_policy_id } : {}),
    ...(row.canonical_workspace_path ? { canonicalWorkspacePath: row.canonical_workspace_path } : {}),
    ...(row.preferred_node_id ? { preferredNodeId: row.preferred_node_id } : {}),
    ...(row.preferred_node_pool ? { preferredNodePool: row.preferred_node_pool } : {}),
    ...(row.last_active_node_id ? { lastActiveNodeId: row.last_active_node_id } : {}),
    ...(row.last_active_workspace_path ? { lastActiveWorkspacePath: row.last_active_workspace_path } : {}),
    continuityMode: row.continuity_mode as ProjectWorkspaceContinuityMode,
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
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
    ...(row.project_id ? { projectId: row.project_id } : {}),
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

function mapAgentMessageRow(row: AgentMessageRow): StoredAgentMessageRecord {
  return {
    messageId: row.message_id,
    organizationId: row.organization_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id,
    ...(row.work_item_id ? { workItemId: row.work_item_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.parent_message_id ? { parentMessageId: row.parent_message_id } : {}),
    messageType: row.message_type as StoredAgentMessageRecord["messageType"],
    ...(safeParseJson(row.payload_json) !== undefined ? { payload: safeParseJson(row.payload_json) } : {}),
    artifactRefs: normalizeStringArray(safeParseJson(row.artifact_refs_json)),
    priority: row.priority as StoredAgentMessageRecord["priority"],
    requiresAck: row.requires_ack === 1,
    createdAt: fromMySqlDateTime(row.created_at),
  };
}

function mapAgentHandoffRow(row: AgentHandoffRow): StoredAgentHandoffRecord {
  return {
    handoffId: row.handoff_id,
    organizationId: row.organization_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id,
    workItemId: row.work_item_id,
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    summary: row.summary,
    blockers: normalizeStringArray(safeParseJson(row.blockers_json)),
    recommendedNextActions: normalizeStringArray(safeParseJson(row.recommended_next_actions_json)),
    attachedArtifacts: normalizeStringArray(safeParseJson(row.attached_artifacts_json)),
    ...(safeParseJson(row.payload_json) !== undefined ? { payload: safeParseJson(row.payload_json) } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
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

function mapAgentMailboxEntryRow(row: AgentMailboxEntryRow): StoredAgentMailboxEntryRecord {
  return {
    mailboxEntryId: row.mailbox_entry_id,
    organizationId: row.organization_id,
    ownerAgentId: row.owner_agent_id,
    messageId: row.message_id,
    ...(row.work_item_id ? { workItemId: row.work_item_id } : {}),
    priority: row.priority as StoredAgentMailboxEntryRecord["priority"],
    status: row.status as StoredAgentMailboxEntryRecord["status"],
    requiresAck: row.requires_ack === 1,
    availableAt: fromMySqlDateTime(row.available_at),
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.leased_at ? { leasedAt: fromMySqlDateTime(row.leased_at) } : {}),
    ...(row.acked_at ? { ackedAt: fromMySqlDateTime(row.acked_at) } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapManagedAgentNodeRow(row: ManagedAgentNodeRow): StoredManagedAgentNodeRecord {
  return {
    nodeId: row.node_id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    status: row.status as StoredManagedAgentNodeRecord["status"],
    slotCapacity: row.slot_capacity,
    slotAvailable: row.slot_available,
    labels: normalizeStringArray(safeParseJson(row.labels_json)),
    workspaceCapabilities: normalizeStringArray(safeParseJson(row.workspace_capabilities_json)),
    credentialCapabilities: normalizeStringArray(safeParseJson(row.credential_capabilities_json)),
    providerCapabilities: normalizeStringArray(safeParseJson(row.provider_capabilities_json)),
    heartbeatTtlSeconds: row.heartbeat_ttl_seconds,
    lastHeartbeatAt: fromMySqlDateTime(row.last_heartbeat_at),
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

function mapAgentAuditLogRow(row: AgentAuditLogRow): StoredAgentAuditLogRecord {
  return {
    auditLogId: row.audit_log_id,
    organizationId: row.organization_id,
    eventType: row.event_type as StoredAgentAuditLogRecord["eventType"],
    actorPrincipalId: row.actor_principal_id,
    ...(row.subject_agent_id ? { subjectAgentId: row.subject_agent_id } : {}),
    ...(row.suggestion_id ? { suggestionId: row.suggestion_id } : {}),
    summary: row.summary,
    ...(safeParseJson(row.payload_json) !== undefined ? { payload: safeParseJson(row.payload_json) } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
  };
}

function mapAgentExecutionLeaseRow(row: AgentExecutionLeaseRow): StoredAgentExecutionLeaseRecord {
  return {
    leaseId: row.lease_id,
    runId: row.run_id,
    workItemId: row.work_item_id,
    targetAgentId: row.target_agent_id,
    nodeId: row.node_id,
    status: row.status as StoredAgentExecutionLeaseRecord["status"],
    leaseToken: row.lease_token,
    leaseExpiresAt: fromMySqlDateTime(row.lease_expires_at),
    ...(row.last_heartbeat_at ? { lastHeartbeatAt: fromMySqlDateTime(row.last_heartbeat_at) } : {}),
    createdAt: fromMySqlDateTime(row.created_at),
    updatedAt: fromMySqlDateTime(row.updated_at),
  };
}

const SNAPSHOT_JSON_COLUMNS = new Set([
  "payload_json",
  "bootstrap_profile_json",
  "additional_directories_json",
  "snapshot_json",
  "context_packet_json",
  "waiting_action_request_json",
  "latest_human_response_json",
  "workspace_policy_snapshot_json",
  "runtime_profile_snapshot_json",
  "artifact_refs_json",
  "blockers_json",
  "recommended_next_actions_json",
  "attached_artifacts_json",
  "labels_json",
  "workspace_capabilities_json",
  "credential_capabilities_json",
  "provider_capabilities_json",
]);

function normalizeSnapshotRow(row: Record<string, unknown>): SnapshotRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeSnapshotValue(value)]),
  ) as SnapshotRow;
}

function normalizeSnapshotValue(value: unknown): string | number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return JSON.stringify(value);
}

function isSnapshotJsonColumn(column: string): boolean {
  return SNAPSHOT_JSON_COLUMNS.has(column);
}

function normalizeMySqlSnapshotValue(column: string, value: string | number | null): string | number | null {
  if (isSnapshotDateTimeColumn(column) && typeof value === "string") {
    return isMySqlDateTimeText(value) ? value : toMySqlDateTime(value);
  }

  if (!isSnapshotJsonColumn(column)) {
    return value;
  }

  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function isSnapshotDateTimeColumn(column: string): boolean {
  return column.endsWith("_at");
}

function isMySqlDateTimeText(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value);
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
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

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
