import Database from "better-sqlite3";

export interface ManagedAgentControlPlaneSnapshot {
  principals: SnapshotRow[];
  organizations: SnapshotRow[];
  spawnPolicies: SnapshotRow[];
  spawnSuggestionStates: SnapshotRow[];
  managedAgents: SnapshotRow[];
  workspacePolicies: SnapshotRow[];
  runtimeProfiles: SnapshotRow[];
  projectWorkspaceBindings: SnapshotRow[];
  workItems: SnapshotRow[];
  messages: SnapshotRow[];
  handoffs: SnapshotRow[];
  runs: SnapshotRow[];
  nodes: SnapshotRow[];
  executionLeases: SnapshotRow[];
  mailboxes: SnapshotRow[];
  auditLogs: SnapshotRow[];
}

export type ManagedAgentControlPlaneSnapshotKey = keyof ManagedAgentControlPlaneSnapshot;
export type SnapshotRow = Record<string, string | number | null>;

export interface ManagedAgentControlPlaneSnapshotTableConfig {
  key: ManagedAgentControlPlaneSnapshotKey;
  table: string;
  columns: string[];
  orderBy: string;
}

export const MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES: ManagedAgentControlPlaneSnapshotTableConfig[] = [
  {
    key: "principals",
    table: "themis_principals",
    columns: ["principal_id", "display_name", "kind", "organization_id", "created_at", "updated_at"],
    orderBy: "updated_at DESC, principal_id ASC",
  },
  {
    key: "organizations",
    table: "themis_organizations",
    columns: ["organization_id", "owner_principal_id", "display_name", "slug", "created_at", "updated_at"],
    orderBy: "updated_at DESC, organization_id ASC",
  },
  {
    key: "spawnPolicies",
    table: "themis_agent_spawn_policies",
    columns: ["organization_id", "max_active_agents", "max_active_agents_per_role", "created_at", "updated_at"],
    orderBy: "updated_at DESC, organization_id ASC",
  },
  {
    key: "spawnSuggestionStates",
    table: "themis_agent_spawn_suggestion_states",
    columns: ["suggestion_id", "organization_id", "state", "payload_json", "created_at", "updated_at"],
    orderBy: "updated_at DESC, suggestion_id DESC",
  },
  {
    key: "managedAgents",
    table: "themis_managed_agents",
    columns: [
      "agent_id",
      "principal_id",
      "organization_id",
      "created_by_principal_id",
      "supervisor_principal_id",
      "display_name",
      "slug",
      "department_role",
      "mission",
      "status",
      "autonomy_level",
      "creation_mode",
      "exposure_policy",
      "default_workspace_policy_id",
      "default_runtime_profile_id",
      "bootstrap_profile_json",
      "bootstrapped_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "updated_at DESC, agent_id ASC",
  },
  {
    key: "workspacePolicies",
    table: "themis_agent_workspace_policies",
    columns: [
      "policy_id",
      "organization_id",
      "owner_agent_id",
      "display_name",
      "workspace_path",
      "additional_directories_json",
      "allow_network_access",
      "created_at",
      "updated_at",
    ],
    orderBy: "updated_at DESC, policy_id ASC",
  },
  {
    key: "runtimeProfiles",
    table: "themis_agent_runtime_profiles",
    columns: ["profile_id", "organization_id", "owner_agent_id", "display_name", "snapshot_json", "created_at", "updated_at"],
    orderBy: "updated_at DESC, profile_id ASC",
  },
  {
    key: "workItems",
    table: "themis_agent_work_items",
    columns: [
      "work_item_id",
      "organization_id",
      "target_agent_id",
      "project_id",
      "source_type",
      "source_principal_id",
      "source_agent_id",
      "parent_work_item_id",
      "dispatch_reason",
      "goal",
      "context_packet_json",
      "waiting_action_request_json",
      "latest_human_response_json",
      "priority",
      "status",
      "workspace_policy_snapshot_json",
      "runtime_profile_snapshot_json",
      "created_at",
      "scheduled_at",
      "started_at",
      "completed_at",
      "updated_at",
    ],
    orderBy: "created_at DESC, work_item_id ASC",
  },
  {
    key: "messages",
    table: "themis_agent_messages",
    columns: [
      "message_id",
      "organization_id",
      "from_agent_id",
      "to_agent_id",
      "work_item_id",
      "run_id",
      "parent_message_id",
      "message_type",
      "payload_json",
      "artifact_refs_json",
      "priority",
      "requires_ack",
      "created_at",
    ],
    orderBy: "created_at ASC, message_id ASC",
  },
  {
    key: "handoffs",
    table: "themis_agent_handoffs",
    columns: [
      "handoff_id",
      "organization_id",
      "from_agent_id",
      "to_agent_id",
      "work_item_id",
      "source_message_id",
      "source_run_id",
      "summary",
      "blockers_json",
      "recommended_next_actions_json",
      "attached_artifacts_json",
      "payload_json",
      "created_at",
      "updated_at",
    ],
    orderBy: "created_at DESC, handoff_id DESC",
  },
  {
    key: "runs",
    table: "themis_agent_runs",
    columns: [
      "run_id",
      "organization_id",
      "work_item_id",
      "target_agent_id",
      "scheduler_id",
      "lease_token",
      "lease_expires_at",
      "status",
      "started_at",
      "last_heartbeat_at",
      "completed_at",
      "failure_code",
      "failure_message",
      "created_at",
      "updated_at",
    ],
    orderBy: "created_at DESC, run_id ASC",
  },
  {
    key: "nodes",
    table: "themis_agent_nodes",
    columns: [
      "node_id",
      "organization_id",
      "display_name",
      "status",
      "slot_capacity",
      "slot_available",
      "labels_json",
      "workspace_capabilities_json",
      "credential_capabilities_json",
      "provider_capabilities_json",
      "heartbeat_ttl_seconds",
      "last_heartbeat_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "updated_at DESC, node_id ASC",
  },
  {
    key: "projectWorkspaceBindings",
    table: "themis_project_workspace_bindings",
    columns: [
      "project_id",
      "organization_id",
      "display_name",
      "owning_agent_id",
      "workspace_root_id",
      "workspace_policy_id",
      "canonical_workspace_path",
      "preferred_node_id",
      "preferred_node_pool",
      "last_active_node_id",
      "last_active_workspace_path",
      "continuity_mode",
      "created_at",
      "updated_at",
    ],
    orderBy: "updated_at DESC, project_id ASC",
  },
  {
    key: "executionLeases",
    table: "themis_agent_execution_leases",
    columns: [
      "lease_id",
      "run_id",
      "work_item_id",
      "target_agent_id",
      "node_id",
      "status",
      "lease_token",
      "lease_expires_at",
      "last_heartbeat_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "updated_at DESC, lease_id ASC",
  },
  {
    key: "mailboxes",
    table: "themis_agent_mailboxes",
    columns: [
      "mailbox_entry_id",
      "organization_id",
      "owner_agent_id",
      "message_id",
      "work_item_id",
      "priority",
      "status",
      "requires_ack",
      "available_at",
      "lease_token",
      "leased_at",
      "acked_at",
      "created_at",
      "updated_at",
    ],
    orderBy: "created_at ASC, mailbox_entry_id ASC",
  },
  {
    key: "auditLogs",
    table: "themis_agent_audit_logs",
    columns: [
      "audit_log_id",
      "organization_id",
      "event_type",
      "actor_principal_id",
      "subject_agent_id",
      "suggestion_id",
      "summary",
      "payload_json",
      "created_at",
    ],
    orderBy: "created_at DESC, audit_log_id DESC",
  },
] as const;

const MANAGED_AGENT_CONTROL_PLANE_DELETE_ORDER = [...MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES].reverse();

export function createEmptyManagedAgentControlPlaneSnapshot(): ManagedAgentControlPlaneSnapshot {
  return {
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
  };
}

export function exportSqliteManagedAgentControlPlaneSnapshot(databaseFile: string): ManagedAgentControlPlaneSnapshot {
  const db = new Database(databaseFile, { readonly: true });

  try {
    const snapshot = createEmptyManagedAgentControlPlaneSnapshot();

    for (const table of MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES) {
      const selectColumns = resolveSqliteSnapshotSelectColumns(table);
      const rows = db
        .prepare(`SELECT ${selectColumns.join(", ")} FROM ${table.table} ORDER BY ${table.orderBy}`)
        .all() as Array<Record<string, unknown>>;
      snapshot[table.key] = rows.map(normalizeSnapshotRow);
    }

    return snapshot;
  } finally {
    db.close();
  }
}

export function replaceSqliteManagedAgentControlPlaneSnapshot(
  databaseFile: string,
  snapshot: ManagedAgentControlPlaneSnapshot,
): void {
  const db = new Database(databaseFile);

  try {
    db.pragma("foreign_keys = OFF");
    const transaction = db.transaction(() => {
      for (const table of MANAGED_AGENT_CONTROL_PLANE_DELETE_ORDER) {
        db.prepare(`DELETE FROM ${table.table}`).run();
      }

      for (const table of MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES) {
        const rows = snapshot[table.key];

        if (!rows.length) {
          continue;
        }

        const insertColumns = resolveSqliteSnapshotInsertColumns(table);
        const placeholders = insertColumns.map(() => "?").join(", ");
        const statement = db.prepare(
          `INSERT INTO ${table.table} (${insertColumns.join(", ")}) VALUES (${placeholders})`,
        );

        for (const row of rows) {
          statement.run(...table.columns.map((column) => normalizeSqliteSnapshotValue(row[column] ?? null)));
        }
      }
    });

    transaction();
  } finally {
    db.pragma("foreign_keys = ON");
    db.close();
  }
}

export function hasManagedAgentControlPlaneSnapshotData(snapshot: ManagedAgentControlPlaneSnapshot): boolean {
  return MANAGED_AGENT_CONTROL_PLANE_SNAPSHOT_TABLES.some((table) => snapshot[table.key].length > 0);
}

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

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  return JSON.stringify(value);
}

function normalizeSqliteSnapshotValue(value: string | number | null): string | number | null {
  return value;
}

function resolveSqliteSnapshotSelectColumns(table: ManagedAgentControlPlaneSnapshotTableConfig): string[] {
  if (table.key === "principals") {
    return [
      "principal_id",
      "display_name",
      "principal_kind AS kind",
      "organization_id",
      "created_at",
      "updated_at",
    ];
  }

  return table.columns;
}

function resolveSqliteSnapshotInsertColumns(table: ManagedAgentControlPlaneSnapshotTableConfig): string[] {
  if (table.key === "principals") {
    return [
      "principal_id",
      "display_name",
      "principal_kind",
      "organization_id",
      "created_at",
      "updated_at",
    ];
  }

  return table.columns;
}
