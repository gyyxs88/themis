export const PRINCIPAL_KINDS = ["human_user", "managed_agent", "system"] as const;

export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export const MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL = "agent-internal";

export const MANAGED_AGENT_STATUSES = [
  "provisioning",
  "bootstrapping",
  "active",
  "paused",
  "degraded",
  "archived",
] as const;

export type ManagedAgentStatus = (typeof MANAGED_AGENT_STATUSES)[number];

export const MANAGED_AGENT_CREATION_MODES = ["manual", "auto"] as const;

export type ManagedAgentCreationMode = (typeof MANAGED_AGENT_CREATION_MODES)[number];

export const MANAGED_AGENT_AUTONOMY_LEVELS = ["supervised", "bounded", "autonomous"] as const;

export type ManagedAgentAutonomyLevel = (typeof MANAGED_AGENT_AUTONOMY_LEVELS)[number];

export const MANAGED_AGENT_EXPOSURE_POLICIES = [
  "gateway_only",
  "admin_takeover_only",
  "direct_human_exception",
] as const;

export type ManagedAgentExposurePolicy = (typeof MANAGED_AGENT_EXPOSURE_POLICIES)[number];

export const MANAGED_AGENT_BOOTSTRAP_STATES = [
  "pending",
  "waiting_human",
  "waiting_agent",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ManagedAgentBootstrapState = (typeof MANAGED_AGENT_BOOTSTRAP_STATES)[number];

export const MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN = "auto_spawn_onboarding";

export const MANAGED_AGENT_IDLE_RECOVERY_ACTIONS = ["pause", "archive"] as const;

export type ManagedAgentIdleRecoveryAction = (typeof MANAGED_AGENT_IDLE_RECOVERY_ACTIONS)[number];

export interface ManagedAgentBootstrapProfile {
  mode: typeof MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN;
  state: ManagedAgentBootstrapState;
  bootstrapWorkItemId: string;
  sourceSuggestionId?: string;
  supervisorAgentId?: string;
  supervisorDisplayName?: string;
  dispatchReason: string;
  goal: string;
  creationReason: string;
  expectedScope: string;
  insufficiencyReason: string;
  namingBasis: string;
  collaborationContract: {
    communicationMode: "agent_only";
    humanExposurePolicy: ManagedAgentExposurePolicy;
    escalationRoute: string;
    defaultSupervisorAgentId?: string;
  };
  checklist: string[];
  summary?: string;
  output?: unknown;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export const MANAGED_AGENT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type ManagedAgentPriority = (typeof MANAGED_AGENT_PRIORITIES)[number];

export const MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES = ["human", "agent", "system"] as const;

export type ManagedAgentWorkItemSourceType = (typeof MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES)[number];

export const MANAGED_AGENT_WORK_ITEM_STATUSES = [
  "queued",
  "planning",
  "running",
  "waiting_human",
  "waiting_agent",
  "blocked",
  "handoff_pending",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ManagedAgentWorkItemStatus = (typeof MANAGED_AGENT_WORK_ITEM_STATUSES)[number];

export const AGENT_MESSAGE_TYPES = [
  "dispatch",
  "status_update",
  "question",
  "answer",
  "handoff",
  "escalation",
  "approval_request",
  "approval_result",
  "artifact_offer",
  "cancel",
] as const;

export type AgentMessageType = (typeof AGENT_MESSAGE_TYPES)[number];

export const AGENT_MAILBOX_STATUSES = ["pending", "leased", "acked"] as const;

export type AgentMailboxStatus = (typeof AGENT_MAILBOX_STATUSES)[number];

export const AGENT_RUN_STATUSES = [
  "created",
  "starting",
  "running",
  "waiting_action",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_SPAWN_SUGGESTION_STATES = [
  "ignored",
  "rejected",
] as const;

export type AgentSpawnSuggestionState = (typeof AGENT_SPAWN_SUGGESTION_STATES)[number];

export const AGENT_AUDIT_LOG_EVENT_TYPES = [
  "spawn_suggestion_approved",
  "spawn_suggestion_blocked",
  "spawn_suggestion_ignored",
  "spawn_suggestion_rejected",
  "spawn_suggestion_restored",
  "idle_recovery_pause_approved",
  "idle_recovery_archive_approved",
] as const;

export type AgentAuditLogEventType = (typeof AGENT_AUDIT_LOG_EVENT_TYPES)[number];

export interface StoredOrganizationRecord {
  organizationId: string;
  ownerPrincipalId: string;
  displayName: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAgentSpawnPolicyRecord {
  organizationId: string;
  maxActiveAgents: number;
  maxActiveAgentsPerRole: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAgentSpawnSuggestionStateRecord {
  suggestionId: string;
  organizationId: string;
  state: AgentSpawnSuggestionState;
  payload?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface StoredManagedAgentRecord {
  agentId: string;
  principalId: string;
  organizationId: string;
  createdByPrincipalId: string;
  supervisorPrincipalId?: string;
  displayName: string;
  slug: string;
  departmentRole: string;
  mission: string;
  status: ManagedAgentStatus;
  autonomyLevel: ManagedAgentAutonomyLevel;
  creationMode: ManagedAgentCreationMode;
  exposurePolicy: ManagedAgentExposurePolicy;
  bootstrapProfile?: ManagedAgentBootstrapProfile;
  bootstrappedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAgentWorkItemRecord {
  workItemId: string;
  organizationId: string;
  targetAgentId: string;
  sourceType: ManagedAgentWorkItemSourceType;
  sourcePrincipalId: string;
  sourceAgentId?: string;
  parentWorkItemId?: string;
  dispatchReason: string;
  goal: string;
  contextPacket?: unknown;
  waitingActionRequest?: unknown;
  latestHumanResponse?: unknown;
  priority: ManagedAgentPriority;
  status: ManagedAgentWorkItemStatus;
  workspacePolicySnapshot?: unknown;
  runtimeProfileSnapshot?: unknown;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface StoredAgentMessageRecord {
  messageId: string;
  organizationId: string;
  fromAgentId: string;
  toAgentId: string;
  workItemId?: string;
  runId?: string;
  parentMessageId?: string;
  messageType: AgentMessageType;
  payload?: unknown;
  artifactRefs: string[];
  priority: ManagedAgentPriority;
  requiresAck: boolean;
  createdAt: string;
}

export interface StoredAgentHandoffRecord {
  handoffId: string;
  organizationId: string;
  fromAgentId: string;
  toAgentId: string;
  workItemId: string;
  sourceMessageId?: string;
  sourceRunId?: string;
  summary: string;
  blockers: string[];
  recommendedNextActions: string[];
  attachedArtifacts: string[];
  payload?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAgentRunRecord {
  runId: string;
  organizationId: string;
  workItemId: string;
  targetAgentId: string;
  schedulerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  status: AgentRunStatus;
  startedAt?: string;
  lastHeartbeatAt?: string;
  completedAt?: string;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAgentMailboxEntryRecord {
  mailboxEntryId: string;
  organizationId: string;
  ownerAgentId: string;
  messageId: string;
  workItemId?: string;
  priority: ManagedAgentPriority;
  status: AgentMailboxStatus;
  requiresAck: boolean;
  availableAt: string;
  leaseToken?: string;
  leasedAt?: string;
  ackedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAgentAuditLogRecord {
  auditLogId: string;
  organizationId: string;
  eventType: AgentAuditLogEventType;
  actorPrincipalId: string;
  subjectAgentId?: string;
  suggestionId?: string;
  summary: string;
  payload?: unknown;
  createdAt: string;
}
