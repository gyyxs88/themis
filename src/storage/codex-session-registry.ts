import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  isPrincipalTaskSettingsEmpty,
  normalizePrincipalTaskSettings,
} from "../core/principal-task-settings.js";
import {
  normalizePrincipalMcpAuthState,
  normalizePrincipalMcpMaterializationRecordInput,
  normalizePrincipalMcpMaterializationState,
  normalizePrincipalMcpMaterializationTargetKind,
  normalizePrincipalMcpOauthAttemptRecordInput,
  normalizePrincipalMcpOauthAttemptStatus,
  normalizePrincipalMcpServerRecordInput,
  normalizePrincipalMcpSourceType,
  normalizePrincipalMcpTransportType,
  type StoredPrincipalMcpMaterializationRecord,
  type StoredPrincipalMcpOauthAttemptRecord,
  type StoredPrincipalMcpServerRecord,
} from "../core/principal-mcp.js";
import {
  normalizePrincipalPluginAuthPolicy,
  normalizePrincipalPluginInstallPolicy,
  normalizePrincipalPluginMaterializationRecordInput,
  normalizePrincipalPluginMaterializationState,
  normalizePrincipalPluginRecordInput,
  normalizePrincipalPluginSourceType,
  type StoredPrincipalPluginMaterializationRecord,
  type StoredPrincipalPluginRecord,
} from "../core/principal-plugins.js";
import {
  normalizePrincipalSkillInstallStatus,
  normalizePrincipalSkillMaterializationRecordInput,
  normalizePrincipalSkillMaterializationState,
  normalizePrincipalSkillRecordInput,
  normalizePrincipalSkillSourceType,
  type StoredPrincipalSkillMaterializationRecord,
  type StoredPrincipalSkillRecord,
} from "../core/principal-skills.js";
import {
  isSessionTaskSettingsEmpty,
  normalizeSessionTaskSettings,
} from "../core/session-task-settings.js";
import {
  AGENT_RUN_STATUSES,
  AGENT_EXECUTION_LEASE_STATUSES,
  AGENT_AUDIT_LOG_EVENT_TYPES,
  AGENT_MAILBOX_STATUSES,
  AGENT_MESSAGE_TYPES,
  AGENT_SPAWN_SUGGESTION_STATES,
  APPROVAL_POLICIES,
  ACTOR_RUNTIME_MEMORY_KINDS,
  ACTOR_RUNTIME_MEMORY_STATUSES,
  ACTOR_TASK_SCOPE_STATUSES,
  MEMORY_MODES,
  MANAGED_AGENT_AUTONOMY_LEVELS,
  MANAGED_AGENT_CREATION_MODES,
  MANAGED_AGENT_EXPOSURE_POLICIES,
  MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL,
  MANAGED_AGENT_NODE_STATUSES,
  MANAGED_AGENT_PRIORITIES,
  MANAGED_AGENT_STATUSES,
  MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES,
  MANAGED_AGENT_WORK_ITEM_STATUSES,
  PROJECT_WORKSPACE_CONTINUITY_MODES,
  PRINCIPAL_ACTOR_STATUSES,
  PRINCIPAL_ASSET_KINDS,
  PRINCIPAL_ASSET_STATUSES,
  PRINCIPAL_CADENCE_FREQUENCIES,
  PRINCIPAL_CADENCE_STATUSES,
  PRINCIPAL_COMMITMENT_STATUSES,
  PRINCIPAL_DECISION_STATUSES,
  PRINCIPAL_KINDS,
  PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES,
  PRINCIPAL_OPERATION_EDGE_RELATION_TYPES,
  PRINCIPAL_OPERATION_EDGE_STATUSES,
  PRINCIPAL_RISK_SEVERITIES,
  PRINCIPAL_RISK_STATUSES,
  PRINCIPAL_RISK_TYPES,
  PRINCIPAL_MAIN_MEMORY_CANDIDATE_STATUSES,
  PRINCIPAL_MAIN_MEMORY_KINDS,
  PRINCIPAL_MAIN_MEMORY_SOURCE_TYPES,
  PRINCIPAL_MAIN_MEMORY_STATUSES,
  REASONING_LEVELS,
  SANDBOX_MODES,
  SCHEDULED_TASK_RUN_STATUSES,
  SCHEDULED_TASK_STATUSES,
  TASK_ACCESS_MODES,
  WEB_SEARCH_MODES,
  normalizePrincipalAssetRefs,
  normalizePrincipalAssetTags,
  normalizePrincipalCadenceRelatedIds,
  normalizePrincipalCommitmentEvidenceRefs,
  normalizePrincipalCommitmentMilestones,
  normalizePrincipalCommitmentProgressPercent,
  normalizePrincipalCommitmentRelatedIds,
  normalizePrincipalDecisionRelatedIds,
  normalizePrincipalRiskRelatedIds,
} from "../types/index.js";
import type {
  AgentRunStatus,
  AgentExecutionLeaseStatus,
  AgentAuditLogEventType,
  AgentMailboxStatus,
  AgentMessageType,
  AgentSpawnSuggestionState,
  ApprovalPolicy,
  ManagedAgentCard,
  ManagedAgentBootstrapProfile,
  ActorRuntimeMemoryKind,
  ActorRuntimeMemoryStatus,
  ActorTaskScopeStatus,
  MemoryMode,
  ManagedAgentAutonomyLevel,
  ManagedAgentCreationMode,
  ManagedAgentExposurePolicy,
  ManagedAgentNodeStatus,
  ManagedAgentPriority,
  ProjectWorkspaceContinuityMode,
  ManagedAgentRuntimeProfileSnapshot,
  ManagedAgentStatus,
  ManagedAgentWorkItemSourceType,
  ManagedAgentWorkItemStatus,
  ManagedAgentWorkspacePolicySnapshot,
  PrincipalTaskSettings,
  PrincipalKind,
  PrincipalPersonaOnboardingState,
  PrincipalPersonaProfileData,
  PrincipalActorStatus,
  PrincipalMainMemoryCandidateStatus,
  PrincipalMainMemoryKind,
  PrincipalMainMemorySourceType,
  PrincipalMainMemoryStatus,
  ReasoningLevel,
  SandboxMode,
  ManagedAgentSecretEnvRef,
  ScheduledTaskRunStatus,
  ScheduledTaskStatus,
  SessionTaskSettings,
  StoredAgentMailboxEntryRecord,
  StoredAgentHandoffRecord,
  StoredAgentAuditLogRecord,
  StoredAgentExecutionLeaseRecord,
  StoredManagedAgentNodeRecord,
  StoredAgentSpawnSuggestionStateRecord,
  StoredAgentSpawnPolicyRecord,
  StoredAgentMessageRecord,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredAgentRuntimeProfileRecord,
  StoredAgentWorkspacePolicyRecord,
  StoredManagedAgentRecord,
  StoredProjectWorkspaceBindingRecord,
  StoredOrganizationRecord,
  StoredPrincipalOperationEdgeRecord,
  TaskAccessMode,
  TaskEvent,
  TaskInputAsset,
  TaskInputEnvelope,
  TaskRequest,
  TaskResult,
  WebSearchMode,
  StoredActorRuntimeMemoryRecord,
  StoredActorTaskScopeRecord,
  StoredPrincipalAssetRecord,
  StoredPrincipalCadenceRecord,
  StoredPrincipalCommitmentRecord,
  StoredPrincipalDecisionRecord,
  StoredPrincipalActorRecord,
  StoredPrincipalMainMemoryCandidateRecord,
  StoredPrincipalMainMemoryRecord,
  StoredPrincipalRiskRecord,
  StoredScheduledTaskRecord,
  StoredScheduledTaskRunRecord,
} from "../types/index.js";

const DATABASE_SCHEMA_VERSION = 41;

export interface StoredCodexSessionRecord {
  sessionId: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  activeTaskId?: string;
}

export interface StoredWebAccessTokenRecord {
  tokenId: string;
  label: string;
  tokenHash: string;
  tokenKind?: "web_login" | "platform_service";
  ownerPrincipalId?: string;
  serviceRole?: "gateway" | "worker";
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface StoredWebSessionRecord {
  sessionId: string;
  tokenId: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface StoredWebAuditEventRecord {
  eventId: string;
  eventType: string;
  createdAt: string;
  remoteIp?: string;
  tokenId?: string;
  tokenLabel?: string;
  sessionId?: string;
  summary?: string;
  payloadJson?: string;
}

export interface StoredTaskTurnRecord {
  requestId: string;
  taskId: string;
  sessionId?: string;
  sourceChannel: string;
  userId: string;
  userDisplayName?: string;
  goal: string;
  inputText?: string;
  historyContext?: string;
  optionsJson?: string;
  status: string;
  summary?: string;
  output?: string;
  errorMessage?: string;
  structuredOutputJson?: string;
  sessionMode?: string;
  codexThreadId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StoredTaskEventRecord {
  eventId: string;
  requestId: string;
  taskId: string;
  type: string;
  status: string;
  message?: string;
  payloadJson?: string;
  createdAt: string;
}

export interface StoredTurnInputCompileWarning {
  code: string;
  message: string;
  assetId?: string;
}

export interface StoredTurnInputCompileCapabilitySnapshot {
  nativeTextInput: boolean;
  nativeImageInput: boolean;
  nativeDocumentInput: boolean;
  supportedDocumentMimeTypes: string[];
}

export interface StoredTurnInputCompileAssetFact {
  assetId: string;
  kind: "image" | "document";
  mimeType: string;
  localPathStatus: "ready" | "unavailable";
  modelNativeSupport: boolean | null;
  transportNativeSupport: boolean | null;
  effectiveNativeSupport: boolean;
  modelMimeTypeSupported: boolean | null;
  transportMimeTypeSupported: boolean | null;
  effectiveMimeTypeSupported: boolean | null;
  handling: "native" | "path_fallback" | "blocked";
}

export interface StoredTurnInputCompileCapabilityMatrix {
  modelCapabilities: StoredTurnInputCompileCapabilitySnapshot | null;
  transportCapabilities: StoredTurnInputCompileCapabilitySnapshot | null;
  effectiveCapabilities: StoredTurnInputCompileCapabilitySnapshot;
  assetFacts: StoredTurnInputCompileAssetFact[];
}

export interface StoredTurnInputCompileSummary {
  runtimeTarget: string;
  degradationLevel: "native" | "lossless_textualization" | "controlled_fallback" | "blocked";
  warnings: StoredTurnInputCompileWarning[];
  capabilityMatrix?: StoredTurnInputCompileCapabilityMatrix;
}

export interface SaveTurnInputInput {
  requestId: string;
  envelope: TaskInputEnvelope;
  compileSummary?: StoredTurnInputCompileSummary;
  createdAt: string;
}

export interface StoredTurnInputRecord {
  requestId: string;
  envelope: TaskInputEnvelope;
  assets: TaskInputAsset[];
  compileSummary: StoredTurnInputCompileSummary | null;
  createdAt: string;
}

export interface StoredChannelInputAssetRecord {
  requestId: string;
  assetId: string;
  sessionId?: string;
  sourceChannel: string;
  userId: string;
  kind: "image" | "document";
  name?: string;
  mimeType: string;
  localPath: string;
  sizeBytes?: number;
  sourceMessageId?: string;
  ingestionStatus: string;
  createdAt: string;
}

export interface StoredSessionHistorySummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  archivedAt?: string;
  originKind: "standard" | "fork";
  originSessionId?: string;
  originLabel?: string;
  threadId?: string;
  latestTurn: {
    requestId: string;
    taskId: string;
    goal: string;
    status: string;
    summary?: string;
    sessionMode?: string;
    codexThreadId?: string;
    updatedAt: string;
  };
}

export interface StoredSessionHistoryFilter {
  sourceChannel?: string;
  userId?: string;
  query?: string;
  includeArchived?: boolean;
  originKind?: "standard" | "fork";
}

export interface StoredSessionHistoryMetadataRecord {
  sessionId: string;
  archivedAt?: string;
  originKind?: "standard" | "fork";
  originSessionId?: string;
  originLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSessionTaskSettingsRecord {
  sessionId: string;
  settings: SessionTaskSettings;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAuthAccountRecord {
  accountId: string;
  label: string;
  accountEmail?: string;
  codexHome: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPrincipalRecord {
  principalId: string;
  displayName?: string;
  kind?: PrincipalKind;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPrincipalTaskSettingsRecord {
  principalId: string;
  settings: PrincipalTaskSettings;
  createdAt: string;
  updatedAt: string;
}

interface PrincipalActorRow {
  actor_id: string;
  owner_principal_id: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalMainMemoryRow {
  memory_id: string;
  principal_id: string;
  kind: string;
  title: string;
  summary: string;
  body_markdown: string;
  source_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalMainMemoryCandidateRow {
  candidate_id: string;
  principal_id: string;
  kind: string;
  title: string;
  summary: string;
  rationale: string;
  suggested_content: string;
  source_type: string;
  source_label: string;
  source_task_id: string | null;
  source_conversation_id: string | null;
  status: string;
  approved_memory_id: string | null;
  reviewed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PrincipalAssetRow {
  asset_id: string;
  principal_id: string;
  kind: string;
  name: string;
  status: string;
  owner_principal_id: string | null;
  summary: string | null;
  tags_json: string;
  refs_json: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalDecisionRow {
  decision_id: string;
  principal_id: string;
  title: string;
  status: string;
  summary: string | null;
  decided_by_principal_id: string | null;
  decided_at: string;
  related_asset_ids_json: string;
  related_work_item_ids_json: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalRiskRow {
  risk_id: string;
  principal_id: string;
  type: string;
  title: string;
  severity: string;
  status: string;
  owner_principal_id: string | null;
  summary: string | null;
  detected_at: string;
  related_asset_ids_json: string;
  linked_decision_ids_json: string;
  related_work_item_ids_json: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalCadenceRow {
  cadence_id: string;
  principal_id: string;
  title: string;
  frequency: string;
  status: string;
  next_run_at: string;
  owner_principal_id: string | null;
  playbook_ref: string | null;
  summary: string | null;
  related_asset_ids_json: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalCommitmentRow {
  commitment_id: string;
  principal_id: string;
  title: string;
  status: string;
  owner_principal_id: string | null;
  starts_at: string | null;
  due_at: string;
  progress_percent: number;
  summary: string | null;
  milestones_json: string;
  evidence_refs_json: string;
  related_asset_ids_json: string;
  linked_decision_ids_json: string;
  linked_risk_ids_json: string;
  related_cadence_ids_json: string;
  related_work_item_ids_json: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalOperationEdgeRow {
  edge_id: string;
  principal_id: string;
  from_object_type: string;
  from_object_id: string;
  to_object_type: string;
  to_object_id: string;
  relation_type: string;
  status: string;
  label: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

interface ActorTaskScopeRow {
  scope_id: string;
  principal_id: string;
  actor_id: string;
  task_id: string;
  conversation_id: string | null;
  goal: string;
  workspace_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ActorRuntimeMemoryRow {
  runtime_memory_id: string;
  principal_id: string;
  actor_id: string;
  task_id: string;
  conversation_id: string | null;
  scope_id: string;
  kind: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
}

interface PrincipalSkillRow {
  principal_id: string;
  skill_name: string;
  description: string;
  source_type: string;
  source_ref_json: string;
  managed_path: string;
  install_status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface PrincipalSkillMaterializationRow {
  principal_id: string;
  skill_name: string;
  target_kind: string;
  target_id: string;
  target_path: string;
  state: string;
  last_synced_at: string | null;
  last_error: string | null;
}

interface PrincipalMcpServerRow {
  principal_id: string;
  server_name: string;
  transport_type: string;
  command: string;
  args_json: string;
  env_json: string;
  cwd: string | null;
  enabled: number;
  source_type: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalMcpMaterializationRow {
  principal_id: string;
  server_name: string;
  target_kind: string;
  target_id: string;
  state: string;
  auth_state: string;
  last_synced_at: string | null;
  last_error: string | null;
}

interface PrincipalMcpOauthAttemptRow {
  attempt_id: string;
  principal_id: string;
  server_name: string;
  target_kind: string;
  target_id: string;
  status: string;
  authorization_url: string;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  last_error: string | null;
}

interface PrincipalPluginRow {
  principal_id: string;
  plugin_id: string;
  plugin_name: string;
  marketplace_name: string;
  marketplace_path: string;
  source_type: string;
  source_ref_json: string;
  source_path: string | null;
  interface_json: string;
  install_policy: string;
  auth_policy: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_error: string | null;
}

interface PrincipalPluginMaterializationRow {
  principal_id: string;
  plugin_id: string;
  target_kind: string;
  target_id: string;
  workspace_fingerprint: string;
  state: string;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface StoredPrincipalPersonaProfileRecord {
  principalId: string;
  profile: PrincipalPersonaProfileData;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
}

export interface StoredPrincipalPersonaOnboardingRecord {
  principalId: string;
  state: PrincipalPersonaOnboardingState;
  createdAt: string;
  updatedAt: string;
}

export interface StoredConversationRecord {
  conversationId: string;
  principalId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChannelIdentityRecord {
  channel: string;
  channelUserId: string;
  principalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChannelConversationBindingRecord {
  channel: string;
  principalId: string;
  channelSessionKey: string;
  conversationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredIdentityLinkCodeRecord {
  code: string;
  sourceChannel: string;
  sourceChannelUserId: string;
  sourcePrincipalId: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  consumedByChannel?: string;
  consumedByUserId?: string;
}

export interface StoredThirdPartyProviderRecord {
  providerId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  endpointCandidatesJson: string;
  defaultModel?: string;
  wireApi: "responses" | "chat";
  supportsWebsockets: boolean;
  modelCatalogPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredThirdPartyProviderModelRecord {
  providerId: string;
  model: string;
  displayName: string;
  description: string;
  defaultReasoningLevel: string;
  supportedReasoningLevelsJson: string;
  contextWindow?: number;
  truncationMode: "tokens" | "bytes";
  truncationLimit: number;
  capabilitiesJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResetPrincipalStateResult {
  principalId: string;
  clearedConversationCount: number;
  clearedTurnCount: number;
  clearedSessionSettingsCount: number;
  clearedCodexSessionCount: number;
  clearedChannelBindingCount: number;
  clearedLinkCodeCount: number;
  clearedPrincipalTaskSettings: boolean;
  clearedPersonaProfile: boolean;
  clearedPersonaOnboarding: boolean;
  resetAt: string;
}

export interface CompleteTaskTurnInput {
  request: TaskRequest;
  result: TaskResult;
  sessionMode?: string;
  threadId?: string;
}

export interface FailTaskTurnInput {
  request: TaskRequest;
  taskId: string;
  message: string;
  completedAt?: string;
  sessionMode?: string;
  threadId?: string;
  structuredOutput?: TaskResult["structuredOutput"];
}

export interface SqliteCodexSessionRegistryOptions {
  databaseFile?: string;
  maxSessions?: number;
}

interface SessionRow {
  session_id: string;
  thread_id: string;
  created_at: string;
  updated_at: string;
  active_task_id: string | null;
}

interface WebAccessTokenRow {
  token_id: string;
  label: string;
  token_hash: string;
  token_kind?: string | null;
  owner_principal_id?: string | null;
  service_role?: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface WebSessionRow {
  session_id: string;
  token_id: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface WebAuditEventRow {
  event_id: string;
  event_type: string;
  created_at: string;
  remote_ip: string | null;
  token_id: string | null;
  token_label: string | null;
  session_id: string | null;
  summary: string | null;
  payload_json: string | null;
}

interface SessionTaskSettingsRow {
  session_id: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

interface AuthAccountRow {
  account_id: string;
  label: string;
  account_email: string | null;
  codex_home: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface PrincipalRow {
  principal_id: string;
  display_name: string | null;
  principal_kind?: string | null;
  organization_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface OrganizationRow {
  organization_id: string;
  owner_principal_id: string;
  display_name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

interface AgentSpawnPolicyRow {
  organization_id: string;
  max_active_agents: number;
  max_active_agents_per_role: number;
  created_at: string;
  updated_at: string;
}

interface AgentSpawnSuggestionStateRow {
  suggestion_id: string;
  organization_id: string;
  state: string;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ManagedAgentRow {
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
  agent_card_json: string | null;
  bootstrap_profile_json: string | null;
  bootstrapped_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentWorkspacePolicyRow {
  policy_id: string;
  organization_id: string;
  owner_agent_id: string;
  display_name: string;
  workspace_path: string;
  additional_directories_json: string | null;
  allow_network_access: number;
  created_at: string;
  updated_at: string;
}

interface AgentRuntimeProfileRow {
  profile_id: string;
  organization_id: string;
  owner_agent_id: string;
  display_name: string;
  snapshot_json: string;
  created_at: string;
  updated_at: string;
}

interface AgentWorkItemRow {
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
  context_packet_json: string | null;
  waiting_action_request_json: string | null;
  latest_human_response_json: string | null;
  priority: string;
  status: string;
  workspace_policy_snapshot_json: string | null;
  runtime_profile_snapshot_json: string | null;
  created_at: string;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface ProjectWorkspaceBindingRow {
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
  created_at: string;
  updated_at: string;
}

interface AgentMessageRow {
  message_id: string;
  organization_id: string;
  from_agent_id: string;
  to_agent_id: string;
  work_item_id: string | null;
  run_id: string | null;
  parent_message_id: string | null;
  message_type: string;
  payload_json: string | null;
  artifact_refs_json: string | null;
  priority: string;
  requires_ack: number;
  created_at: string;
}

interface AgentHandoffRow {
  handoff_id: string;
  organization_id: string;
  from_agent_id: string;
  to_agent_id: string;
  work_item_id: string;
  source_message_id: string | null;
  source_run_id: string | null;
  summary: string;
  blockers_json: string | null;
  recommended_next_actions_json: string | null;
  attached_artifacts_json: string | null;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRunRow {
  run_id: string;
  organization_id: string;
  work_item_id: string;
  target_agent_id: string;
  scheduler_id: string;
  lease_token: string;
  lease_expires_at: string;
  status: string;
  started_at: string | null;
  last_heartbeat_at: string | null;
  completed_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ManagedAgentNodeRow {
  node_id: string;
  organization_id: string;
  display_name: string;
  status: string;
  slot_capacity: number;
  slot_available: number;
  labels_json: string | null;
  workspace_capabilities_json: string | null;
  credential_capabilities_json: string | null;
  provider_capabilities_json: string | null;
  heartbeat_ttl_seconds: number;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

interface AgentExecutionLeaseRow {
  lease_id: string;
  run_id: string;
  work_item_id: string;
  target_agent_id: string;
  node_id: string;
  status: string;
  lease_token: string;
  lease_expires_at: string;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ScheduledTaskRow {
  scheduled_task_id: string;
  principal_id: string;
  source_channel: string;
  channel_user_id: string;
  display_name: string | null;
  session_id: string | null;
  channel_session_key: string | null;
  goal: string;
  input_text: string | null;
  options_json: string | null;
  automation_json: string | null;
  recurrence_json: string | null;
  watch_work_item_id: string | null;
  timezone: string;
  scheduled_at: string;
  status: string;
  last_run_id: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

interface ScheduledTaskRunRow {
  run_id: string;
  scheduled_task_id: string;
  principal_id: string;
  scheduler_id: string;
  lease_token: string;
  lease_expires_at: string;
  status: string;
  request_id: string | null;
  task_id: string | null;
  triggered_at: string;
  started_at: string | null;
  last_heartbeat_at: string | null;
  completed_at: string | null;
  result_summary: string | null;
  result_output: string | null;
  structured_output_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentAuditLogRow {
  audit_log_id: string;
  organization_id: string;
  event_type: string;
  actor_principal_id: string;
  subject_agent_id: string | null;
  suggestion_id: string | null;
  summary: string;
  payload_json: string | null;
  created_at: string;
}

interface AgentMailboxEntryRow {
  mailbox_entry_id: string;
  organization_id: string;
  owner_agent_id: string;
  message_id: string;
  work_item_id: string | null;
  priority: string;
  status: string;
  requires_ack: number;
  available_at: string;
  lease_token: string | null;
  leased_at: string | null;
  acked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PrincipalTaskSettingsRow {
  principal_id: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalPersonaProfileRow {
  principal_id: string;
  profile_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string;
}

interface PrincipalPersonaOnboardingRow {
  principal_id: string;
  state_json: string;
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  conversation_id: string;
  principal_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChannelIdentityRow {
  channel: string;
  channel_user_id: string;
  principal_id: string;
  created_at: string;
  updated_at: string;
}

interface ChannelConversationBindingRow {
  channel: string;
  principal_id: string;
  channel_session_key: string;
  conversation_id: string;
  created_at: string;
  updated_at: string;
}

interface IdentityLinkCodeRow {
  code: string;
  source_channel: string;
  source_channel_user_id: string;
  source_principal_id: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by_channel: string | null;
  consumed_by_user_id: string | null;
}

interface TurnRow {
  request_id: string;
  task_id: string;
  session_id: string | null;
  source_channel: string;
  user_id: string;
  user_display_name: string | null;
  goal: string;
  input_text: string | null;
  history_context: string | null;
  options_json: string | null;
  status: string;
  summary: string | null;
  output: string | null;
  error_message: string | null;
  structured_output_json: string | null;
  session_mode: string | null;
  codex_thread_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface EventRow {
  event_id: string;
  request_id: string;
  task_id: string;
  event_type: string;
  status: string;
  message: string | null;
  payload_json: string | null;
  created_at: string;
}

interface TurnInputRow {
  request_id: string;
  envelope_json: string;
  compile_summary_json: string | null;
  created_at: string;
}

interface InputAssetRow {
  request_id: string;
  asset_id: string;
  kind: string;
  name: string | null;
  mime_type: string;
  local_path: string;
  size_bytes: number | null;
  source_channel: string;
  source_message_id: string | null;
  ingestion_status: string;
  text_extraction_json: string | null;
  metadata_json: string | null;
  created_at: string;
}

interface ChannelInputAssetRow extends InputAssetRow {
  session_id: string | null;
  turn_source_channel: string;
  user_id: string;
}

interface SessionSummaryRow {
  session_id: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  archived_at: string | null;
  origin_kind: string | null;
  origin_session_id: string | null;
  origin_label: string | null;
  thread_id: string | null;
  latest_request_id: string;
  latest_task_id: string;
  latest_goal: string;
  latest_status: string;
  latest_summary: string | null;
  latest_session_mode: string | null;
  latest_codex_thread_id: string | null;
  latest_updated_at: string;
}

interface ThirdPartyProviderRow {
  provider_id: string;
  name: string;
  base_url: string;
  api_key: string;
  endpoint_candidates_json: string | null;
  default_model: string | null;
  wire_api: string;
  supports_websockets: number;
  model_catalog_path: string | null;
  created_at: string;
  updated_at: string;
}

interface ThirdPartyProviderModelRow {
  provider_id: string;
  model: string;
  display_name: string;
  description: string;
  default_reasoning_level: string;
  supported_reasoning_levels_json: string;
  context_window: number | null;
  truncation_mode: string;
  truncation_limit: number;
  capabilities_json: string;
  created_at: string;
  updated_at: string;
}

export class SqliteCodexSessionRegistry {
  private readonly databaseFile: string;
  private readonly maxSessions: number;
  private readonly db: Database.Database;

  constructor(options: SqliteCodexSessionRegistryOptions = {}) {
    this.databaseFile = options.databaseFile ?? resolve(process.cwd(), "infra/local/themis.db");
    this.maxSessions = options.maxSessions ?? 200;

    mkdirSync(dirname(this.databaseFile), { recursive: true });
    this.db = this.openDatabase();
  }

  getDatabaseFile(): string {
    return this.databaseFile;
  }

  getSession(sessionId: string): StoredCodexSessionRecord | null {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT session_id, thread_id, created_at, updated_at, active_task_id
          FROM codex_sessions
          WHERE session_id = ?
        `,
      )
      .get(normalized) as SessionRow | undefined;

    return row ? mapSessionRow(row) : null;
  }

  saveSession(record: StoredCodexSessionRecord): void {
    const sessionId = record.sessionId.trim();

    if (!sessionId) {
      throw new Error("Session id is required.");
    }

    this.db
      .prepare(
        `
          INSERT INTO codex_sessions (
            session_id,
            thread_id,
            created_at,
            updated_at,
            active_task_id
          ) VALUES (
            @session_id,
            @thread_id,
            @created_at,
            @updated_at,
            @active_task_id
          )
          ON CONFLICT(session_id) DO UPDATE SET
            thread_id = excluded.thread_id,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            active_task_id = excluded.active_task_id
        `,
      )
      .run({
        session_id: sessionId,
        thread_id: record.threadId.trim(),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        active_task_id: record.activeTaskId ?? null,
      });
  }

  tryCreateSessionBinding(record: StoredCodexSessionRecord): boolean {
    const sessionId = record.sessionId.trim();
    const threadId = record.threadId.trim();

    if (!sessionId) {
      throw new Error("Session id is required.");
    }

    if (!threadId) {
      throw new Error("Thread id is required.");
    }

    const bind = this.db.transaction(() => {
      const existingSession = this.db
        .prepare(
          `
            SELECT 1
            FROM codex_sessions
            WHERE session_id = ?
          `,
        )
        .get(sessionId) as { 1: number } | undefined;

      if (existingSession) {
        return false;
      }

      const existingTurn = this.db
        .prepare(
          `
            SELECT 1
            FROM themis_turns
            WHERE session_id = ?
            LIMIT 1
          `,
        )
        .get(sessionId) as { 1: number } | undefined;

      if (existingTurn) {
        return false;
      }

      this.db
        .prepare(
          `
            INSERT INTO codex_sessions (
              session_id,
              thread_id,
              created_at,
              updated_at,
              active_task_id
            ) VALUES (
              @session_id,
              @thread_id,
              @created_at,
              @updated_at,
              @active_task_id
            )
          `,
        )
        .run({
          session_id: sessionId,
          thread_id: threadId,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
          active_task_id: record.activeTaskId ?? null,
        });

      return true;
    });

    return bind();
  }

  deleteSession(sessionId: string): boolean {
    const normalized = sessionId.trim();

    if (!normalized) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM codex_sessions
          WHERE session_id = ?
        `,
      )
      .run(normalized);

    return result.changes > 0;
  }

  getSessionTaskSettings(sessionId: string): StoredSessionTaskSettingsRecord | null {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT session_id, settings_json, created_at, updated_at
          FROM themis_session_settings
          WHERE session_id = ?
        `,
      )
      .get(normalized) as SessionTaskSettingsRow | undefined;

    return row ? mapSessionTaskSettingsRow(row) : null;
  }

  saveSessionTaskSettings(record: StoredSessionTaskSettingsRecord): void {
    const sessionId = record.sessionId.trim();

    if (!sessionId) {
      throw new Error("Session id is required.");
    }

    const normalizedSettings = normalizeSessionTaskSettings(record.settings);

    if (isSessionTaskSettingsEmpty(normalizedSettings)) {
      this.deleteSessionTaskSettings(sessionId);
      return;
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_session_settings (
            session_id,
            settings_json,
            created_at,
            updated_at
          ) VALUES (
            @session_id,
            @settings_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(session_id) DO UPDATE SET
            settings_json = excluded.settings_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        session_id: sessionId,
        settings_json: JSON.stringify(normalizedSettings),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  deleteSessionTaskSettings(sessionId: string): boolean {
    const normalized = sessionId.trim();

    if (!normalized) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_session_settings
          WHERE session_id = ?
        `,
      )
      .run(normalized);

    return result.changes > 0;
  }

  listWebAccessTokens(): StoredWebAccessTokenRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT token_id, label, token_hash, token_kind, owner_principal_id, service_role, created_at, updated_at, last_used_at, revoked_at
          FROM themis_web_access_tokens
          ORDER BY revoked_at IS NULL DESC, updated_at DESC, label ASC, token_id ASC
        `,
      )
      .all() as WebAccessTokenRow[];

    return rows.map(mapWebAccessTokenRow);
  }

  listActiveWebAccessTokens(): StoredWebAccessTokenRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT token_id, label, token_hash, token_kind, owner_principal_id, service_role, created_at, updated_at, last_used_at, revoked_at
          FROM themis_web_access_tokens
          WHERE revoked_at IS NULL
          ORDER BY updated_at DESC, label ASC, token_id ASC
        `,
      )
      .all() as WebAccessTokenRow[];

    return rows.map(mapWebAccessTokenRow);
  }

  getWebAccessTokenByLabel(label: string): StoredWebAccessTokenRecord | null {
    const normalized = label.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT token_id, label, token_hash, token_kind, owner_principal_id, service_role, created_at, updated_at, last_used_at, revoked_at
          FROM themis_web_access_tokens
          WHERE label = ?
          ORDER BY revoked_at IS NULL DESC, updated_at DESC, token_id ASC
          LIMIT 1
        `,
      )
      .get(normalized) as WebAccessTokenRow | undefined;

    return row ? mapWebAccessTokenRow(row) : null;
  }

  getWebAccessTokenById(tokenId: string): StoredWebAccessTokenRecord | null {
    const normalized = tokenId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT token_id, label, token_hash, token_kind, owner_principal_id, service_role, created_at, updated_at, last_used_at, revoked_at
          FROM themis_web_access_tokens
          WHERE token_id = ?
        `,
      )
      .get(normalized) as WebAccessTokenRow | undefined;

    return row ? mapWebAccessTokenRow(row) : null;
  }

  saveWebAccessToken(record: StoredWebAccessTokenRecord): void {
    const tokenId = record.tokenId.trim();
    const label = record.label.trim();
    const tokenHash = record.tokenHash.trim();

    if (!tokenId || !label || !tokenHash) {
      throw new Error("Web access token record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_web_access_tokens (
            token_id,
            label,
            token_hash,
            token_kind,
            owner_principal_id,
            service_role,
            created_at,
            updated_at,
            last_used_at,
            revoked_at
          ) VALUES (
            @token_id,
            @label,
            @token_hash,
            @token_kind,
            @owner_principal_id,
            @service_role,
            @created_at,
            @updated_at,
            @last_used_at,
            @revoked_at
          )
          ON CONFLICT(token_id) DO UPDATE SET
            label = excluded.label,
            token_hash = excluded.token_hash,
            token_kind = excluded.token_kind,
            owner_principal_id = excluded.owner_principal_id,
            service_role = excluded.service_role,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            last_used_at = excluded.last_used_at,
            revoked_at = excluded.revoked_at
        `,
      )
      .run({
        token_id: tokenId,
        label,
        token_hash: tokenHash,
        token_kind: record.tokenKind ?? "web_login",
        owner_principal_id: record.ownerPrincipalId ?? null,
        service_role: record.serviceRole ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        last_used_at: record.lastUsedAt ?? null,
        revoked_at: record.revokedAt ?? null,
      });
  }

  renameWebAccessToken(tokenId: string, label: string, updatedAt: string): boolean {
    const normalizedTokenId = tokenId.trim();
    const normalizedLabel = label.trim();

    if (!normalizedTokenId || !normalizedLabel) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          UPDATE themis_web_access_tokens
          SET label = ?, updated_at = ?
          WHERE token_id = ?
        `,
      )
      .run(normalizedLabel, updatedAt, normalizedTokenId);

    return result.changes > 0;
  }

  touchWebAccessToken(tokenId: string, lastUsedAt: string, updatedAt: string): boolean {
    const normalizedTokenId = tokenId.trim();

    if (!normalizedTokenId) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          UPDATE themis_web_access_tokens
          SET last_used_at = ?, updated_at = ?
          WHERE token_id = ?
        `,
      )
      .run(lastUsedAt, updatedAt, normalizedTokenId);

    return result.changes > 0;
  }

  revokeWebAccessToken(tokenId: string, revokedAt: string, updatedAt: string): boolean {
    const normalizedTokenId = tokenId.trim();

    if (!normalizedTokenId) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          UPDATE themis_web_access_tokens
          SET revoked_at = ?, updated_at = ?
          WHERE token_id = ?
        `,
      )
      .run(revokedAt, updatedAt, normalizedTokenId);

    return result.changes > 0;
  }

  getWebSession(sessionId: string): StoredWebSessionRecord | null {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT session_id, token_id, created_at, updated_at, last_seen_at, expires_at, revoked_at
          FROM themis_web_sessions
          WHERE session_id = ?
        `,
      )
      .get(normalized) as WebSessionRow | undefined;

    return row ? mapWebSessionRow(row) : null;
  }

  saveWebSession(record: StoredWebSessionRecord): void {
    const sessionId = record.sessionId.trim();
    const tokenId = record.tokenId.trim();

    if (!sessionId || !tokenId) {
      throw new Error("Web session record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_web_sessions (
            session_id,
            token_id,
            created_at,
            updated_at,
            last_seen_at,
            expires_at,
            revoked_at
          ) VALUES (
            @session_id,
            @token_id,
            @created_at,
            @updated_at,
            @last_seen_at,
            @expires_at,
            @revoked_at
          )
          ON CONFLICT(session_id) DO UPDATE SET
            token_id = excluded.token_id,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            last_seen_at = excluded.last_seen_at,
            expires_at = excluded.expires_at,
            revoked_at = excluded.revoked_at
        `,
      )
      .run({
        session_id: sessionId,
        token_id: tokenId,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        last_seen_at: record.lastSeenAt,
        expires_at: record.expiresAt,
        revoked_at: record.revokedAt ?? null,
      });
  }

  touchWebSession(sessionId: string, lastSeenAt: string, updatedAt: string): boolean {
    const normalizedSessionId = sessionId.trim();

    if (!normalizedSessionId) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          UPDATE themis_web_sessions
          SET last_seen_at = ?, updated_at = ?
          WHERE session_id = ?
        `,
      )
      .run(lastSeenAt, updatedAt, normalizedSessionId);

    return result.changes > 0;
  }

  revokeWebSession(sessionId: string, revokedAt: string, updatedAt: string): boolean {
    const normalizedSessionId = sessionId.trim();

    if (!normalizedSessionId) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          UPDATE themis_web_sessions
          SET revoked_at = ?, updated_at = ?
          WHERE session_id = ?
        `,
      )
      .run(revokedAt, updatedAt, normalizedSessionId);

    return result.changes > 0;
  }

  revokeWebSessionsByTokenId(tokenId: string, revokedAt: string, updatedAt: string): number {
    const normalizedTokenId = tokenId.trim();

    if (!normalizedTokenId) {
      return 0;
    }

    const result = this.db
      .prepare(
        `
          UPDATE themis_web_sessions
          SET revoked_at = ?, updated_at = ?
          WHERE token_id = ?
            AND revoked_at IS NULL
        `,
      )
      .run(revokedAt, updatedAt, normalizedTokenId);

    return result.changes;
  }

  listWebAuditEvents(): StoredWebAuditEventRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT event_id, event_type, created_at, remote_ip, token_id, token_label, session_id, summary, payload_json
          FROM themis_web_audit_events
          ORDER BY created_at DESC, event_id DESC
        `,
      )
      .all() as WebAuditEventRow[];

    return rows.map(mapWebAuditEventRow);
  }

  appendWebAuditEvent(record: StoredWebAuditEventRecord): void {
    const eventId = record.eventId.trim();
    const eventType = record.eventType.trim();

    if (!eventId || !eventType) {
      throw new Error("Web audit event record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_web_audit_events (
            event_id,
            event_type,
            created_at,
            remote_ip,
            token_id,
            token_label,
            session_id,
            summary,
            payload_json
          ) VALUES (
            @event_id,
            @event_type,
            @created_at,
            @remote_ip,
            @token_id,
            @token_label,
            @session_id,
            @summary,
            @payload_json
          )
        `,
      )
      .run({
        event_id: eventId,
        event_type: eventType,
        created_at: record.createdAt,
        remote_ip: record.remoteIp ?? null,
        token_id: record.tokenId ?? null,
        token_label: record.tokenLabel ?? null,
        session_id: record.sessionId ?? null,
        summary: record.summary ?? null,
        payload_json: record.payloadJson ?? null,
      });
  }

  listAuthAccounts(): StoredAuthAccountRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT account_id, label, account_email, codex_home, is_active, created_at, updated_at
          FROM themis_auth_accounts
          ORDER BY is_active DESC, updated_at DESC, account_id ASC
        `,
      )
      .all() as AuthAccountRow[];

    return rows.map(mapAuthAccountRow);
  }

  getAuthAccount(accountId: string): StoredAuthAccountRecord | null {
    const normalized = accountId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT account_id, label, account_email, codex_home, is_active, created_at, updated_at
          FROM themis_auth_accounts
          WHERE account_id = ?
        `,
      )
      .get(normalized) as AuthAccountRow | undefined;

    return row ? mapAuthAccountRow(row) : null;
  }

  getActiveAuthAccount(): StoredAuthAccountRecord | null {
    const row = this.db
      .prepare(
        `
          SELECT account_id, label, account_email, codex_home, is_active, created_at, updated_at
          FROM themis_auth_accounts
          WHERE is_active = 1
          ORDER BY updated_at DESC, account_id ASC
          LIMIT 1
        `,
      )
      .get() as AuthAccountRow | undefined;

    return row ? mapAuthAccountRow(row) : null;
  }

  getAuthAccountByEmail(accountEmail: string): StoredAuthAccountRecord | null {
    const normalized = accountEmail.trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT account_id, label, account_email, codex_home, is_active, created_at, updated_at
          FROM themis_auth_accounts
          WHERE LOWER(account_email) = ?
          ORDER BY is_active DESC, updated_at DESC, account_id ASC
          LIMIT 1
        `,
      )
      .get(normalized) as AuthAccountRow | undefined;

    return row ? mapAuthAccountRow(row) : null;
  }

  saveAuthAccount(record: StoredAuthAccountRecord): void {
    const accountId = record.accountId.trim();
    const label = record.label.trim();
    const accountEmail = record.accountEmail?.trim().toLowerCase() || null;
    const codexHome = record.codexHome.trim();

    if (!accountId || !label || !codexHome) {
      throw new Error("Auth account record is incomplete.");
    }

    const save = this.db.transaction(() => {
      if (record.isActive) {
        this.db
          .prepare(
            `
              UPDATE themis_auth_accounts
              SET is_active = 0
            `,
          )
          .run();
      }

      this.db
        .prepare(
          `
            INSERT INTO themis_auth_accounts (
              account_id,
              label,
              account_email,
              codex_home,
              is_active,
              created_at,
              updated_at
            ) VALUES (
              @account_id,
              @label,
              @account_email,
              @codex_home,
              @is_active,
              @created_at,
              @updated_at
            )
            ON CONFLICT(account_id) DO UPDATE SET
              label = excluded.label,
              account_email = excluded.account_email,
              codex_home = excluded.codex_home,
              is_active = excluded.is_active,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
        )
        .run({
          account_id: accountId,
          label,
          account_email: accountEmail,
          codex_home: codexHome,
          is_active: record.isActive ? 1 : 0,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
        });
    });

    save();
  }

  setActiveAuthAccount(accountId: string): boolean {
    const normalized = accountId.trim();

    if (!normalized) {
      return false;
    }

    const update = this.db.transaction(() => {
      const existing = this.getAuthAccount(normalized);

      if (!existing) {
        return false;
      }

      const now = new Date().toISOString();
      this.db
        .prepare(
          `
            UPDATE themis_auth_accounts
            SET is_active = 0
          `,
        )
        .run();
      this.db
        .prepare(
          `
            UPDATE themis_auth_accounts
            SET is_active = 1, updated_at = ?
            WHERE account_id = ?
          `,
        )
        .run(now, normalized);

      return true;
    });

    return update();
  }

  getPrincipal(principalId: string): StoredPrincipalRecord | null {
    const normalized = principalId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT principal_id, display_name, principal_kind, organization_id, created_at, updated_at
          FROM themis_principals
          WHERE principal_id = ?
        `,
      )
      .get(normalized) as PrincipalRow | undefined;

    return row ? mapPrincipalRow(row) : null;
  }

  getChannelIdentity(channel: string, channelUserId: string): StoredChannelIdentityRecord | null {
    const normalizedChannel = channel.trim();
    const normalizedUserId = channelUserId.trim();

    if (!normalizedChannel || !normalizedUserId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT channel, channel_user_id, principal_id, created_at, updated_at
          FROM themis_channel_identities
          WHERE channel = ?
            AND channel_user_id = ?
        `,
      )
      .get(normalizedChannel, normalizedUserId) as ChannelIdentityRow | undefined;

    return row ? mapChannelIdentityRow(row) : null;
  }

  savePrincipal(record: StoredPrincipalRecord): void {
    const principalId = record.principalId.trim();
    const existing = principalId ? this.getPrincipal(principalId) : null;
    const principalKind = normalizeText(record.kind) ?? existing?.kind ?? "human_user";
    const organizationId = normalizeText(record.organizationId) ?? existing?.organizationId ?? null;
    const displayName = normalizeText(record.displayName) ?? existing?.displayName ?? null;

    if (!principalId || !PRINCIPAL_KINDS.includes(principalKind as PrincipalKind)) {
      throw new Error("Principal id is required.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principals (
            principal_id,
            display_name,
            principal_kind,
            organization_id,
            created_at,
            updated_at
          ) VALUES (
            @principal_id,
            @display_name,
            @principal_kind,
            @organization_id,
            @created_at,
            @updated_at
          )
          ON CONFLICT(principal_id) DO UPDATE SET
            display_name = excluded.display_name,
            principal_kind = excluded.principal_kind,
            organization_id = excluded.organization_id,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        principal_id: principalId,
        display_name: displayName,
        principal_kind: principalKind,
        organization_id: organizationId,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  getOrganization(organizationId: string): StoredOrganizationRecord | null {
    const normalizedOrganizationId = organizationId.trim();

    if (!normalizedOrganizationId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            organization_id,
            owner_principal_id,
            display_name,
            slug,
            created_at,
            updated_at
          FROM themis_organizations
          WHERE organization_id = ?
        `,
      )
      .get(normalizedOrganizationId) as OrganizationRow | undefined;

    return row ? mapOrganizationRow(row) : null;
  }

  listOrganizationsByOwnerPrincipal(ownerPrincipalId: string): StoredOrganizationRecord[] {
    const normalizedOwnerPrincipalId = ownerPrincipalId.trim();

    if (!normalizedOwnerPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            organization_id,
            owner_principal_id,
            display_name,
            slug,
            created_at,
            updated_at
          FROM themis_organizations
          WHERE owner_principal_id = ?
          ORDER BY updated_at DESC, organization_id ASC
        `,
      )
      .all(normalizedOwnerPrincipalId) as OrganizationRow[];

    return rows.map(mapOrganizationRow);
  }

  saveOrganization(record: StoredOrganizationRecord): void {
    const organizationId = record.organizationId.trim();
    const ownerPrincipalId = record.ownerPrincipalId.trim();
    const displayName = record.displayName.trim();
    const slug = record.slug.trim();

    if (!organizationId || !ownerPrincipalId || !displayName || !slug) {
      throw new Error("Organization record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT owner_principal_id
          FROM themis_organizations
          WHERE organization_id = ?
        `,
      )
      .get(organizationId) as { owner_principal_id: string } | undefined;

    if (existing && existing.owner_principal_id !== ownerPrincipalId) {
      throw new Error("Organization belongs to another principal.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_organizations (
            organization_id,
            owner_principal_id,
            display_name,
            slug,
            created_at,
            updated_at
          ) VALUES (
            @organization_id,
            @owner_principal_id,
            @display_name,
            @slug,
            @created_at,
            @updated_at
          )
          ON CONFLICT(organization_id) DO UPDATE SET
            display_name = excluded.display_name,
            slug = excluded.slug,
            updated_at = excluded.updated_at
          WHERE themis_organizations.owner_principal_id = excluded.owner_principal_id
        `,
      )
      .run({
        organization_id: organizationId,
        owner_principal_id: ownerPrincipalId,
        display_name: displayName,
        slug,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Organization write did not apply.");
    }
  }

  getAgentSpawnPolicy(organizationId: string): StoredAgentSpawnPolicyRecord | null {
    const normalizedOrganizationId = organizationId.trim();

    if (!normalizedOrganizationId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            organization_id,
            max_active_agents,
            max_active_agents_per_role,
            created_at,
            updated_at
          FROM themis_agent_spawn_policies
          WHERE organization_id = ?
        `,
      )
      .get(normalizedOrganizationId) as AgentSpawnPolicyRow | undefined;

    return row ? mapAgentSpawnPolicyRow(row) : null;
  }

  listAgentSpawnPoliciesByOwnerPrincipal(ownerPrincipalId: string): StoredAgentSpawnPolicyRecord[] {
    const normalizedOwnerPrincipalId = ownerPrincipalId.trim();

    if (!normalizedOwnerPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            policy.organization_id,
            policy.max_active_agents,
            policy.max_active_agents_per_role,
            policy.created_at,
            policy.updated_at
          FROM themis_agent_spawn_policies policy
          INNER JOIN themis_organizations organization
            ON organization.organization_id = policy.organization_id
          WHERE organization.owner_principal_id = ?
          ORDER BY policy.updated_at DESC, policy.organization_id ASC
        `,
      )
      .all(normalizedOwnerPrincipalId) as AgentSpawnPolicyRow[];

    return rows.map(mapAgentSpawnPolicyRow);
  }

  getAgentSpawnSuggestionState(suggestionId: string): StoredAgentSpawnSuggestionStateRecord | null {
    const normalizedSuggestionId = suggestionId.trim();

    if (!normalizedSuggestionId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            suggestion_id,
            organization_id,
            state,
            payload_json,
            created_at,
            updated_at
          FROM themis_agent_spawn_suggestion_states
          WHERE suggestion_id = ?
        `,
      )
      .get(normalizedSuggestionId) as AgentSpawnSuggestionStateRow | undefined;

    return row ? mapAgentSpawnSuggestionStateRow(row) : null;
  }

  listAgentSpawnSuggestionStatesByOrganization(organizationId: string): StoredAgentSpawnSuggestionStateRecord[] {
    const normalizedOrganizationId = organizationId.trim();

    if (!normalizedOrganizationId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            suggestion_id,
            organization_id,
            state,
            payload_json,
            created_at,
            updated_at
          FROM themis_agent_spawn_suggestion_states
          WHERE organization_id = ?
          ORDER BY updated_at DESC, suggestion_id ASC
        `,
      )
      .all(normalizedOrganizationId) as AgentSpawnSuggestionStateRow[];

    return rows.map(mapAgentSpawnSuggestionStateRow);
  }

  saveAgentSpawnPolicy(record: StoredAgentSpawnPolicyRecord): void {
    const organizationId = record.organizationId.trim();
    const maxActiveAgents = Math.floor(record.maxActiveAgents);
    const maxActiveAgentsPerRole = Math.floor(record.maxActiveAgentsPerRole);

    if (
      !organizationId
      || !Number.isInteger(maxActiveAgents)
      || maxActiveAgents <= 0
      || !Number.isInteger(maxActiveAgentsPerRole)
      || maxActiveAgentsPerRole <= 0
    ) {
      throw new Error("Agent spawn policy record is incomplete.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_spawn_policies (
            organization_id,
            max_active_agents,
            max_active_agents_per_role,
            created_at,
            updated_at
          ) VALUES (
            @organization_id,
            @max_active_agents,
            @max_active_agents_per_role,
            @created_at,
            @updated_at
          )
          ON CONFLICT(organization_id) DO UPDATE SET
            max_active_agents = excluded.max_active_agents,
            max_active_agents_per_role = excluded.max_active_agents_per_role,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        organization_id: organizationId,
        max_active_agents: maxActiveAgents,
        max_active_agents_per_role: maxActiveAgentsPerRole,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent spawn policy write did not apply.");
    }
  }

  saveAgentSpawnSuggestionState(record: StoredAgentSpawnSuggestionStateRecord): void {
    const suggestionId = record.suggestionId.trim();
    const organizationId = record.organizationId.trim();
    const state = normalizeText(record.state);

    if (
      !suggestionId
      || !organizationId
      || !state
      || !AGENT_SPAWN_SUGGESTION_STATES.includes(state as AgentSpawnSuggestionState)
    ) {
      throw new Error("Agent spawn suggestion state record is incomplete.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_spawn_suggestion_states (
            suggestion_id,
            organization_id,
            state,
            payload_json,
            created_at,
            updated_at
          ) VALUES (
            @suggestion_id,
            @organization_id,
            @state,
            @payload_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(suggestion_id) DO UPDATE SET
            organization_id = excluded.organization_id,
            state = excluded.state,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        suggestion_id: suggestionId,
        organization_id: organizationId,
        state,
        payload_json: stringifyJson(record.payload),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent spawn suggestion state write did not apply.");
    }
  }

  deleteAgentSpawnSuggestionState(suggestionId: string): boolean {
    const normalizedSuggestionId = suggestionId.trim();

    if (!normalizedSuggestionId) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_agent_spawn_suggestion_states
          WHERE suggestion_id = ?
        `,
      )
      .run(normalizedSuggestionId);

    return result.changes > 0;
  }

  getManagedAgent(agentId: string): StoredManagedAgentRecord | null {
    const normalizedAgentId = agentId.trim();

    if (!normalizedAgentId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            agent_id,
            principal_id,
            organization_id,
            created_by_principal_id,
            supervisor_principal_id,
            display_name,
            slug,
            department_role,
          mission,
          status,
          autonomy_level,
          creation_mode,
          exposure_policy,
          default_workspace_policy_id,
          default_runtime_profile_id,
          agent_card_json,
          bootstrap_profile_json,
          bootstrapped_at,
          created_at,
          updated_at
          FROM themis_managed_agents
          WHERE agent_id = ?
        `,
      )
      .get(normalizedAgentId) as ManagedAgentRow | undefined;

    return row ? mapManagedAgentRow(row) : null;
  }

  getManagedAgentByPrincipal(principalId: string): StoredManagedAgentRecord | null {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            agent_id,
            principal_id,
            organization_id,
            created_by_principal_id,
            supervisor_principal_id,
            display_name,
            slug,
            department_role,
            mission,
          status,
          autonomy_level,
          creation_mode,
          exposure_policy,
          default_workspace_policy_id,
          default_runtime_profile_id,
          agent_card_json,
          bootstrap_profile_json,
          bootstrapped_at,
          created_at,
          updated_at
          FROM themis_managed_agents
          WHERE principal_id = ?
        `,
      )
      .get(normalizedPrincipalId) as ManagedAgentRow | undefined;

    return row ? mapManagedAgentRow(row) : null;
  }

  listManagedAgentsByOrganization(organizationId: string): StoredManagedAgentRecord[] {
    const normalizedOrganizationId = organizationId.trim();

    if (!normalizedOrganizationId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            agent_id,
            principal_id,
            organization_id,
            created_by_principal_id,
            supervisor_principal_id,
            display_name,
            slug,
            department_role,
            mission,
            status,
            autonomy_level,
            creation_mode,
            exposure_policy,
            default_workspace_policy_id,
            default_runtime_profile_id,
            agent_card_json,
            bootstrap_profile_json,
            bootstrapped_at,
            created_at,
            updated_at
          FROM themis_managed_agents
          WHERE organization_id = ?
          ORDER BY updated_at DESC, agent_id ASC
        `,
      )
      .all(normalizedOrganizationId) as ManagedAgentRow[];

    return rows.map(mapManagedAgentRow);
  }

  listManagedAgentsByOwnerPrincipal(ownerPrincipalId: string): StoredManagedAgentRecord[] {
    const normalizedOwnerPrincipalId = ownerPrincipalId.trim();

    if (!normalizedOwnerPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            agent.agent_id,
            agent.principal_id,
            agent.organization_id,
            agent.created_by_principal_id,
            agent.supervisor_principal_id,
            agent.display_name,
            agent.slug,
            agent.department_role,
            agent.mission,
            agent.status,
            agent.autonomy_level,
            agent.creation_mode,
            agent.exposure_policy,
            agent.default_workspace_policy_id,
            agent.default_runtime_profile_id,
            agent.agent_card_json,
            agent.bootstrap_profile_json,
            agent.bootstrapped_at,
            agent.created_at,
            agent.updated_at
          FROM themis_managed_agents agent
          INNER JOIN themis_organizations organization
            ON organization.organization_id = agent.organization_id
          WHERE organization.owner_principal_id = ?
          ORDER BY agent.updated_at DESC, agent.agent_id ASC
        `,
      )
      .all(normalizedOwnerPrincipalId) as ManagedAgentRow[];

    return rows.map(mapManagedAgentRow);
  }

  saveManagedAgent(record: StoredManagedAgentRecord): void {
    const agentId = record.agentId.trim();
    const principalId = record.principalId.trim();
    const organizationId = record.organizationId.trim();
    const createdByPrincipalId = record.createdByPrincipalId.trim();
    const supervisorPrincipalId = normalizeText(record.supervisorPrincipalId);
    const displayName = record.displayName.trim();
    const slug = record.slug.trim();
    const departmentRole = record.departmentRole.trim();
    const mission = record.mission.trim();
    const status = normalizeText(record.status);
    const autonomyLevel = normalizeText(record.autonomyLevel);
    const creationMode = normalizeText(record.creationMode);
    const exposurePolicy = normalizeText(record.exposurePolicy);
    const defaultWorkspacePolicyId = normalizeText(record.defaultWorkspacePolicyId);
    const defaultRuntimeProfileId = normalizeText(record.defaultRuntimeProfileId);
    const agentCard = normalizeManagedAgentCard(record.agentCard);
    const bootstrapProfile = normalizeManagedAgentBootstrapProfile(record.bootstrapProfile);
    const bootstrappedAt = normalizeText(record.bootstrappedAt);

    if (
      !agentId ||
      !principalId ||
      !organizationId ||
      !createdByPrincipalId ||
      !displayName ||
      !slug ||
      !departmentRole ||
      !mission ||
      !status ||
      !MANAGED_AGENT_STATUSES.includes(status as ManagedAgentStatus) ||
      !autonomyLevel ||
      !MANAGED_AGENT_AUTONOMY_LEVELS.includes(autonomyLevel as ManagedAgentAutonomyLevel) ||
      !creationMode ||
      !MANAGED_AGENT_CREATION_MODES.includes(creationMode as ManagedAgentCreationMode) ||
      !exposurePolicy ||
      !MANAGED_AGENT_EXPOSURE_POLICIES.includes(exposurePolicy as ManagedAgentExposurePolicy)
    ) {
      throw new Error("Managed agent record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT organization_id
          FROM themis_managed_agents
          WHERE agent_id = ?
        `,
      )
      .get(agentId) as { organization_id: string } | undefined;

    if (existing && existing.organization_id !== organizationId) {
      throw new Error("Managed agent belongs to another organization.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_managed_agents (
            agent_id,
            principal_id,
            organization_id,
            created_by_principal_id,
            supervisor_principal_id,
            display_name,
            slug,
            department_role,
            mission,
            status,
            autonomy_level,
            creation_mode,
            exposure_policy,
            default_workspace_policy_id,
            default_runtime_profile_id,
            agent_card_json,
            bootstrap_profile_json,
            bootstrapped_at,
            created_at,
            updated_at
          ) VALUES (
            @agent_id,
            @principal_id,
            @organization_id,
            @created_by_principal_id,
            @supervisor_principal_id,
            @display_name,
            @slug,
            @department_role,
            @mission,
            @status,
            @autonomy_level,
            @creation_mode,
            @exposure_policy,
            @default_workspace_policy_id,
            @default_runtime_profile_id,
            @agent_card_json,
            @bootstrap_profile_json,
            @bootstrapped_at,
            @created_at,
            @updated_at
          )
          ON CONFLICT(agent_id) DO UPDATE SET
            supervisor_principal_id = excluded.supervisor_principal_id,
            display_name = excluded.display_name,
            slug = excluded.slug,
            department_role = excluded.department_role,
            mission = excluded.mission,
            status = excluded.status,
            autonomy_level = excluded.autonomy_level,
            creation_mode = excluded.creation_mode,
            exposure_policy = excluded.exposure_policy,
            default_workspace_policy_id = excluded.default_workspace_policy_id,
            default_runtime_profile_id = excluded.default_runtime_profile_id,
            agent_card_json = excluded.agent_card_json,
            bootstrap_profile_json = excluded.bootstrap_profile_json,
            bootstrapped_at = excluded.bootstrapped_at,
            updated_at = excluded.updated_at
          WHERE themis_managed_agents.organization_id = excluded.organization_id
        `,
      )
      .run({
        agent_id: agentId,
        principal_id: principalId,
        organization_id: organizationId,
        created_by_principal_id: createdByPrincipalId,
        supervisor_principal_id: supervisorPrincipalId ?? null,
        display_name: displayName,
        slug,
        department_role: departmentRole,
        mission,
        status,
        autonomy_level: autonomyLevel,
        creation_mode: creationMode,
        exposure_policy: exposurePolicy,
        default_workspace_policy_id: defaultWorkspacePolicyId ?? null,
        default_runtime_profile_id: defaultRuntimeProfileId ?? null,
        agent_card_json: agentCard ? JSON.stringify(agentCard) : null,
        bootstrap_profile_json: bootstrapProfile ? JSON.stringify(bootstrapProfile) : null,
        bootstrapped_at: bootstrappedAt ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Managed agent write did not apply.");
    }
  }

  getAgentWorkspacePolicy(policyId: string): StoredAgentWorkspacePolicyRecord | null {
    const normalizedPolicyId = policyId.trim();

    if (!normalizedPolicyId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            policy_id,
            organization_id,
            owner_agent_id,
            display_name,
            workspace_path,
            additional_directories_json,
            allow_network_access,
            created_at,
            updated_at
          FROM themis_agent_workspace_policies
          WHERE policy_id = ?
        `,
      )
      .get(normalizedPolicyId) as AgentWorkspacePolicyRow | undefined;

    return row ? mapAgentWorkspacePolicyRow(row) : null;
  }

  getAgentWorkspacePolicyByOwnerAgent(ownerAgentId: string): StoredAgentWorkspacePolicyRecord | null {
    const normalizedOwnerAgentId = ownerAgentId.trim();

    if (!normalizedOwnerAgentId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            policy_id,
            organization_id,
            owner_agent_id,
            display_name,
            workspace_path,
            additional_directories_json,
            allow_network_access,
            created_at,
            updated_at
          FROM themis_agent_workspace_policies
          WHERE owner_agent_id = ?
        `,
      )
      .get(normalizedOwnerAgentId) as AgentWorkspacePolicyRow | undefined;

    return row ? mapAgentWorkspacePolicyRow(row) : null;
  }

  saveAgentWorkspacePolicy(record: StoredAgentWorkspacePolicyRecord): void {
    const policyId = record.policyId.trim();
    const organizationId = record.organizationId.trim();
    const ownerAgentId = record.ownerAgentId.trim();
    const displayName = record.displayName.trim();
    const workspacePath = record.workspacePath.trim();
    const additionalDirectories = normalizeStringArray(record.additionalDirectories);

    if (!policyId || !organizationId || !ownerAgentId || !displayName || !workspacePath) {
      throw new Error("Agent workspace policy record is incomplete.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_workspace_policies (
            policy_id,
            organization_id,
            owner_agent_id,
            display_name,
            workspace_path,
            additional_directories_json,
            allow_network_access,
            created_at,
            updated_at
          ) VALUES (
            @policy_id,
            @organization_id,
            @owner_agent_id,
            @display_name,
            @workspace_path,
            @additional_directories_json,
            @allow_network_access,
            @created_at,
            @updated_at
          )
          ON CONFLICT(policy_id) DO UPDATE SET
            organization_id = excluded.organization_id,
            owner_agent_id = excluded.owner_agent_id,
            display_name = excluded.display_name,
            workspace_path = excluded.workspace_path,
            additional_directories_json = excluded.additional_directories_json,
            allow_network_access = excluded.allow_network_access,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        policy_id: policyId,
        organization_id: organizationId,
        owner_agent_id: ownerAgentId,
        display_name: displayName,
        workspace_path: workspacePath,
        additional_directories_json: JSON.stringify(additionalDirectories),
        allow_network_access: record.allowNetworkAccess ? 1 : 0,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent workspace policy write did not apply.");
    }
  }

  getAgentRuntimeProfile(profileId: string): StoredAgentRuntimeProfileRecord | null {
    const normalizedProfileId = profileId.trim();

    if (!normalizedProfileId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            profile_id,
            organization_id,
            owner_agent_id,
            display_name,
            snapshot_json,
            created_at,
            updated_at
          FROM themis_agent_runtime_profiles
          WHERE profile_id = ?
        `,
      )
      .get(normalizedProfileId) as AgentRuntimeProfileRow | undefined;

    return row ? mapAgentRuntimeProfileRow(row) : null;
  }

  getAgentRuntimeProfileByOwnerAgent(ownerAgentId: string): StoredAgentRuntimeProfileRecord | null {
    const normalizedOwnerAgentId = ownerAgentId.trim();

    if (!normalizedOwnerAgentId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            profile_id,
            organization_id,
            owner_agent_id,
            display_name,
            snapshot_json,
            created_at,
            updated_at
          FROM themis_agent_runtime_profiles
          WHERE owner_agent_id = ?
        `,
      )
      .get(normalizedOwnerAgentId) as AgentRuntimeProfileRow | undefined;

    return row ? mapAgentRuntimeProfileRow(row) : null;
  }

  saveAgentRuntimeProfile(record: StoredAgentRuntimeProfileRecord): void {
    const profileId = record.profileId.trim();
    const organizationId = record.organizationId.trim();
    const ownerAgentId = record.ownerAgentId.trim();
    const displayName = record.displayName.trim();
    const snapshot = normalizeManagedAgentRuntimeProfileSnapshot(record) ?? {};

    if (!profileId || !organizationId || !ownerAgentId || !displayName) {
      throw new Error("Agent runtime profile record is incomplete.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_runtime_profiles (
            profile_id,
            organization_id,
            owner_agent_id,
            display_name,
            snapshot_json,
            created_at,
            updated_at
          ) VALUES (
            @profile_id,
            @organization_id,
            @owner_agent_id,
            @display_name,
            @snapshot_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(profile_id) DO UPDATE SET
            organization_id = excluded.organization_id,
            owner_agent_id = excluded.owner_agent_id,
            display_name = excluded.display_name,
            snapshot_json = excluded.snapshot_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        profile_id: profileId,
        organization_id: organizationId,
        owner_agent_id: ownerAgentId,
        display_name: displayName,
        snapshot_json: JSON.stringify(snapshot),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent runtime profile write did not apply.");
    }
  }

  getProjectWorkspaceBinding(projectId: string): StoredProjectWorkspaceBindingRecord | null {
    const normalizedProjectId = projectId.trim();

    if (!normalizedProjectId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            project_id,
            organization_id,
            display_name,
            owning_agent_id,
            workspace_root_id,
            workspace_policy_id,
            canonical_workspace_path,
            preferred_node_id,
            preferred_node_pool,
            last_active_node_id,
            last_active_workspace_path,
            continuity_mode,
            created_at,
            updated_at
          FROM themis_project_workspace_bindings
          WHERE project_id = ?
        `,
      )
      .get(normalizedProjectId) as ProjectWorkspaceBindingRow | undefined;

    return row ? mapProjectWorkspaceBindingRow(row) : null;
  }

  listProjectWorkspaceBindingsByOrganization(organizationId: string): StoredProjectWorkspaceBindingRecord[] {
    const normalizedOrganizationId = organizationId.trim();

    if (!normalizedOrganizationId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            project_id,
            organization_id,
            display_name,
            owning_agent_id,
            workspace_root_id,
            workspace_policy_id,
            canonical_workspace_path,
            preferred_node_id,
            preferred_node_pool,
            last_active_node_id,
            last_active_workspace_path,
            continuity_mode,
            created_at,
            updated_at
          FROM themis_project_workspace_bindings
          WHERE organization_id = ?
          ORDER BY updated_at DESC, project_id ASC
        `,
      )
      .all(normalizedOrganizationId) as ProjectWorkspaceBindingRow[];

    return rows.map(mapProjectWorkspaceBindingRow);
  }

  saveProjectWorkspaceBinding(record: StoredProjectWorkspaceBindingRecord): void {
    const projectId = record.projectId.trim();
    const organizationId = record.organizationId.trim();
    const displayName = record.displayName.trim();
    const owningAgentId = normalizeText(record.owningAgentId);
    const workspaceRootId = normalizeText(record.workspaceRootId);
    const workspacePolicyId = normalizeText(record.workspacePolicyId);
    const canonicalWorkspacePath = normalizeText(record.canonicalWorkspacePath);
    const preferredNodeId = normalizeText(record.preferredNodeId);
    const preferredNodePool = normalizeText(record.preferredNodePool);
    const lastActiveNodeId = normalizeText(record.lastActiveNodeId);
    const lastActiveWorkspacePath = normalizeText(record.lastActiveWorkspacePath);
    const continuityMode = normalizeText(record.continuityMode);

    if (
      !projectId
      || !organizationId
      || !displayName
      || !continuityMode
      || !PROJECT_WORKSPACE_CONTINUITY_MODES.includes(continuityMode as ProjectWorkspaceContinuityMode)
      || (!workspacePolicyId && !canonicalWorkspacePath)
    ) {
      throw new Error("Project workspace binding record is incomplete.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_project_workspace_bindings (
            project_id,
            organization_id,
            display_name,
            owning_agent_id,
            workspace_root_id,
            workspace_policy_id,
            canonical_workspace_path,
            preferred_node_id,
            preferred_node_pool,
            last_active_node_id,
            last_active_workspace_path,
            continuity_mode,
            created_at,
            updated_at
          ) VALUES (
            @project_id,
            @organization_id,
            @display_name,
            @owning_agent_id,
            @workspace_root_id,
            @workspace_policy_id,
            @canonical_workspace_path,
            @preferred_node_id,
            @preferred_node_pool,
            @last_active_node_id,
            @last_active_workspace_path,
            @continuity_mode,
            @created_at,
            @updated_at
          )
          ON CONFLICT(project_id) DO UPDATE SET
            organization_id = excluded.organization_id,
            display_name = excluded.display_name,
            owning_agent_id = excluded.owning_agent_id,
            workspace_root_id = excluded.workspace_root_id,
            workspace_policy_id = excluded.workspace_policy_id,
            canonical_workspace_path = excluded.canonical_workspace_path,
            preferred_node_id = excluded.preferred_node_id,
            preferred_node_pool = excluded.preferred_node_pool,
            last_active_node_id = excluded.last_active_node_id,
            last_active_workspace_path = excluded.last_active_workspace_path,
            continuity_mode = excluded.continuity_mode,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        project_id: projectId,
        organization_id: organizationId,
        display_name: displayName,
        owning_agent_id: owningAgentId ?? null,
        workspace_root_id: workspaceRootId ?? null,
        workspace_policy_id: workspacePolicyId ?? null,
        canonical_workspace_path: canonicalWorkspacePath ?? null,
        preferred_node_id: preferredNodeId ?? null,
        preferred_node_pool: preferredNodePool ?? null,
        last_active_node_id: lastActiveNodeId ?? null,
        last_active_workspace_path: lastActiveWorkspacePath ?? null,
        continuity_mode: continuityMode,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Project workspace binding write did not apply.");
    }
  }

  getAgentWorkItem(workItemId: string): StoredAgentWorkItemRecord | null {
    const normalizedWorkItemId = workItemId.trim();

    if (!normalizedWorkItemId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            work_item_id,
            organization_id,
            target_agent_id,
            project_id,
            source_type,
            source_principal_id,
            source_agent_id,
            parent_work_item_id,
            dispatch_reason,
            goal,
            context_packet_json,
            waiting_action_request_json,
            latest_human_response_json,
            priority,
            status,
            workspace_policy_snapshot_json,
            runtime_profile_snapshot_json,
            created_at,
            scheduled_at,
            started_at,
            completed_at,
            updated_at
          FROM themis_agent_work_items
          WHERE work_item_id = ?
        `,
      )
      .get(normalizedWorkItemId) as AgentWorkItemRow | undefined;

    return row ? mapAgentWorkItemRow(row) : null;
  }

  listAgentWorkItemsByTargetAgent(targetAgentId: string): StoredAgentWorkItemRecord[] {
    const normalizedTargetAgentId = targetAgentId.trim();

    if (!normalizedTargetAgentId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            work_item_id,
            organization_id,
            target_agent_id,
            project_id,
            source_type,
            source_principal_id,
            source_agent_id,
            parent_work_item_id,
            dispatch_reason,
            goal,
            context_packet_json,
            waiting_action_request_json,
            latest_human_response_json,
            priority,
            status,
            workspace_policy_snapshot_json,
            runtime_profile_snapshot_json,
            created_at,
            scheduled_at,
            started_at,
            completed_at,
            updated_at
          FROM themis_agent_work_items
          WHERE target_agent_id = ?
          ORDER BY created_at DESC, work_item_id ASC
        `,
      )
      .all(normalizedTargetAgentId) as AgentWorkItemRow[];

    return rows.map(mapAgentWorkItemRow);
  }

  listAgentWorkItemsByOwnerPrincipal(ownerPrincipalId: string): StoredAgentWorkItemRecord[] {
    const normalizedOwnerPrincipalId = ownerPrincipalId.trim();

    if (!normalizedOwnerPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            work_item.work_item_id,
            work_item.organization_id,
            work_item.target_agent_id,
            work_item.project_id,
            work_item.source_type,
            work_item.source_principal_id,
            work_item.source_agent_id,
            work_item.parent_work_item_id,
            work_item.dispatch_reason,
            work_item.goal,
            work_item.context_packet_json,
            work_item.waiting_action_request_json,
            work_item.latest_human_response_json,
            work_item.priority,
            work_item.status,
            work_item.workspace_policy_snapshot_json,
            work_item.runtime_profile_snapshot_json,
            work_item.created_at,
            work_item.scheduled_at,
            work_item.started_at,
            work_item.completed_at,
            work_item.updated_at
          FROM themis_agent_work_items work_item
          INNER JOIN themis_organizations organization
            ON organization.organization_id = work_item.organization_id
          WHERE organization.owner_principal_id = ?
          ORDER BY work_item.created_at DESC, work_item.work_item_id ASC
        `,
      )
      .all(normalizedOwnerPrincipalId) as AgentWorkItemRow[];

    return rows.map(mapAgentWorkItemRow);
  }

  listAgentWorkItemsByParentWorkItem(parentWorkItemId: string): StoredAgentWorkItemRecord[] {
    const normalizedParentWorkItemId = parentWorkItemId.trim();

    if (!normalizedParentWorkItemId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            work_item_id,
            organization_id,
            target_agent_id,
            project_id,
            source_type,
            source_principal_id,
            source_agent_id,
            parent_work_item_id,
            dispatch_reason,
            goal,
            context_packet_json,
            waiting_action_request_json,
            latest_human_response_json,
            priority,
            status,
            workspace_policy_snapshot_json,
            runtime_profile_snapshot_json,
            created_at,
            scheduled_at,
            started_at,
            completed_at,
            updated_at
          FROM themis_agent_work_items
          WHERE parent_work_item_id = ?
          ORDER BY updated_at DESC, work_item_id ASC
        `,
      )
      .all(normalizedParentWorkItemId) as AgentWorkItemRow[];

    return rows.map(mapAgentWorkItemRow);
  }

  saveAgentWorkItem(record: StoredAgentWorkItemRecord): void {
    const workItemId = record.workItemId.trim();
    const organizationId = record.organizationId.trim();
    const targetAgentId = record.targetAgentId.trim();
    const projectId = normalizeText(record.projectId);
    const sourceType = normalizeText(record.sourceType);
    const sourcePrincipalId = record.sourcePrincipalId.trim();
    const sourceAgentId = normalizeText(record.sourceAgentId);
    const parentWorkItemId = normalizeText(record.parentWorkItemId);
    const dispatchReason = record.dispatchReason.trim();
    const goal = record.goal.trim();
    const priority = normalizeText(record.priority);
    const status = normalizeText(record.status);

    if (
      !workItemId ||
      !organizationId ||
      !targetAgentId ||
      !sourceType ||
      !MANAGED_AGENT_WORK_ITEM_SOURCE_TYPES.includes(sourceType as ManagedAgentWorkItemSourceType) ||
      !sourcePrincipalId ||
      !dispatchReason ||
      !goal ||
      !priority ||
      !MANAGED_AGENT_PRIORITIES.includes(priority as ManagedAgentPriority) ||
      !status ||
      !MANAGED_AGENT_WORK_ITEM_STATUSES.includes(status as ManagedAgentWorkItemStatus)
    ) {
      throw new Error("Agent work item record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT organization_id, target_agent_id
          FROM themis_agent_work_items
          WHERE work_item_id = ?
        `,
      )
      .get(workItemId) as { organization_id: string; target_agent_id: string } | undefined;

    if (existing && (existing.organization_id !== organizationId || existing.target_agent_id !== targetAgentId)) {
      throw new Error("Agent work item belongs to another organization or target agent.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_work_items (
            work_item_id,
            organization_id,
            target_agent_id,
            project_id,
            source_type,
            source_principal_id,
            source_agent_id,
            parent_work_item_id,
            dispatch_reason,
            goal,
            context_packet_json,
            waiting_action_request_json,
            latest_human_response_json,
            priority,
            status,
            workspace_policy_snapshot_json,
            runtime_profile_snapshot_json,
            created_at,
            scheduled_at,
            started_at,
            completed_at,
            updated_at
          ) VALUES (
            @work_item_id,
            @organization_id,
            @target_agent_id,
            @project_id,
            @source_type,
            @source_principal_id,
            @source_agent_id,
            @parent_work_item_id,
            @dispatch_reason,
            @goal,
            @context_packet_json,
            @waiting_action_request_json,
            @latest_human_response_json,
            @priority,
            @status,
            @workspace_policy_snapshot_json,
            @runtime_profile_snapshot_json,
            @created_at,
            @scheduled_at,
            @started_at,
            @completed_at,
            @updated_at
          )
          ON CONFLICT(work_item_id) DO UPDATE SET
            project_id = excluded.project_id,
            source_type = excluded.source_type,
            source_principal_id = excluded.source_principal_id,
            source_agent_id = excluded.source_agent_id,
            parent_work_item_id = excluded.parent_work_item_id,
            dispatch_reason = excluded.dispatch_reason,
            goal = excluded.goal,
            context_packet_json = excluded.context_packet_json,
            waiting_action_request_json = excluded.waiting_action_request_json,
            latest_human_response_json = excluded.latest_human_response_json,
            priority = excluded.priority,
            status = excluded.status,
            workspace_policy_snapshot_json = excluded.workspace_policy_snapshot_json,
            runtime_profile_snapshot_json = excluded.runtime_profile_snapshot_json,
            scheduled_at = excluded.scheduled_at,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            updated_at = excluded.updated_at
          WHERE themis_agent_work_items.organization_id = excluded.organization_id
            AND themis_agent_work_items.target_agent_id = excluded.target_agent_id
        `,
      )
      .run({
        work_item_id: workItemId,
        organization_id: organizationId,
        target_agent_id: targetAgentId,
        project_id: projectId ?? null,
        source_type: sourceType,
        source_principal_id: sourcePrincipalId,
        source_agent_id: sourceAgentId ?? null,
        parent_work_item_id: parentWorkItemId ?? null,
        dispatch_reason: dispatchReason,
        goal,
        context_packet_json: stringifyJson(record.contextPacket),
        waiting_action_request_json: stringifyJson(record.waitingActionRequest),
        latest_human_response_json: stringifyJson(record.latestHumanResponse),
        priority,
        status,
        workspace_policy_snapshot_json: stringifyJson(record.workspacePolicySnapshot),
        runtime_profile_snapshot_json: stringifyJson(record.runtimeProfileSnapshot),
        created_at: record.createdAt,
        scheduled_at: normalizeText(record.scheduledAt) ?? null,
        started_at: normalizeText(record.startedAt) ?? null,
        completed_at: normalizeText(record.completedAt) ?? null,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent work item write did not apply.");
    }
  }

  getAgentRun(runId: string): StoredAgentRunRecord | null {
    const normalizedRunId = runId.trim();

    if (!normalizedRunId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            run_id,
            organization_id,
            work_item_id,
            target_agent_id,
            scheduler_id,
            lease_token,
            lease_expires_at,
            status,
            started_at,
            last_heartbeat_at,
            completed_at,
            failure_code,
            failure_message,
            created_at,
            updated_at
          FROM themis_agent_runs
          WHERE run_id = ?
        `,
      )
      .get(normalizedRunId) as AgentRunRow | undefined;

    return row ? mapAgentRunRow(row) : null;
  }

  listAgentRunsByWorkItem(workItemId: string): StoredAgentRunRecord[] {
    const normalizedWorkItemId = workItemId.trim();

    if (!normalizedWorkItemId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            run_id,
            organization_id,
            work_item_id,
            target_agent_id,
            scheduler_id,
            lease_token,
            lease_expires_at,
            status,
            started_at,
            last_heartbeat_at,
            completed_at,
            failure_code,
            failure_message,
            created_at,
            updated_at
          FROM themis_agent_runs
          WHERE work_item_id = ?
          ORDER BY created_at DESC, run_id ASC
        `,
      )
      .all(normalizedWorkItemId) as AgentRunRow[];

    return rows.map(mapAgentRunRow);
  }

  listAgentRunsByOwnerPrincipal(ownerPrincipalId: string): StoredAgentRunRecord[] {
    const normalizedOwnerPrincipalId = ownerPrincipalId.trim();

    if (!normalizedOwnerPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            run.run_id,
            run.organization_id,
            run.work_item_id,
            run.target_agent_id,
            run.scheduler_id,
            run.lease_token,
            run.lease_expires_at,
            run.status,
            run.started_at,
            run.last_heartbeat_at,
            run.completed_at,
            run.failure_code,
            run.failure_message,
            run.created_at,
            run.updated_at
          FROM themis_agent_runs run
          INNER JOIN themis_organizations organization
            ON organization.organization_id = run.organization_id
          WHERE organization.owner_principal_id = ?
          ORDER BY run.created_at DESC, run.run_id ASC
        `,
      )
      .all(normalizedOwnerPrincipalId) as AgentRunRow[];

    return rows.map(mapAgentRunRow);
  }

  listStaleActiveAgentRuns(leaseExpiresBefore: string): StoredAgentRunRecord[] {
    const normalizedLeaseExpiresBefore = leaseExpiresBefore.trim();

    if (!normalizedLeaseExpiresBefore) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            run_id,
            organization_id,
            work_item_id,
            target_agent_id,
            scheduler_id,
            lease_token,
            lease_expires_at,
            status,
            started_at,
            last_heartbeat_at,
            completed_at,
            failure_code,
            failure_message,
            created_at,
            updated_at
          FROM themis_agent_runs
          WHERE status IN ('created', 'starting', 'running', 'waiting_action')
            AND lease_expires_at <= ?
          ORDER BY lease_expires_at ASC, run_id ASC
        `,
      )
      .all(normalizedLeaseExpiresBefore) as AgentRunRow[];

    return rows.map(mapAgentRunRow);
  }

  saveAgentRun(record: StoredAgentRunRecord): void {
    const runId = record.runId.trim();
    const organizationId = record.organizationId.trim();
    const workItemId = record.workItemId.trim();
    const targetAgentId = record.targetAgentId.trim();
    const schedulerId = record.schedulerId.trim();
    const leaseToken = record.leaseToken.trim();
    const leaseExpiresAt = record.leaseExpiresAt.trim();
    const status = normalizeText(record.status);
    const startedAt = normalizeText(record.startedAt);
    const lastHeartbeatAt = normalizeText(record.lastHeartbeatAt);
    const completedAt = normalizeText(record.completedAt);
    const failureCode = normalizeText(record.failureCode);
    const failureMessage = normalizeText(record.failureMessage);

    if (
      !runId ||
      !organizationId ||
      !workItemId ||
      !targetAgentId ||
      !schedulerId ||
      !leaseToken ||
      !leaseExpiresAt ||
      !status ||
      !AGENT_RUN_STATUSES.includes(status as AgentRunStatus)
    ) {
      throw new Error("Agent run record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT organization_id, work_item_id
          FROM themis_agent_runs
          WHERE run_id = ?
        `,
      )
      .get(runId) as { organization_id: string; work_item_id: string } | undefined;

    if (existing && (existing.organization_id !== organizationId || existing.work_item_id !== workItemId)) {
      throw new Error("Agent run belongs to another organization or work item.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_runs (
            run_id,
            organization_id,
            work_item_id,
            target_agent_id,
            scheduler_id,
            lease_token,
            lease_expires_at,
            status,
            started_at,
            last_heartbeat_at,
            completed_at,
            failure_code,
            failure_message,
            created_at,
            updated_at
          ) VALUES (
            @run_id,
            @organization_id,
            @work_item_id,
            @target_agent_id,
            @scheduler_id,
            @lease_token,
            @lease_expires_at,
            @status,
            @started_at,
            @last_heartbeat_at,
            @completed_at,
            @failure_code,
            @failure_message,
            @created_at,
            @updated_at
          )
          ON CONFLICT(run_id) DO UPDATE SET
            target_agent_id = excluded.target_agent_id,
            scheduler_id = excluded.scheduler_id,
            lease_token = excluded.lease_token,
            lease_expires_at = excluded.lease_expires_at,
            status = excluded.status,
            started_at = excluded.started_at,
            last_heartbeat_at = excluded.last_heartbeat_at,
            completed_at = excluded.completed_at,
            failure_code = excluded.failure_code,
            failure_message = excluded.failure_message,
            updated_at = excluded.updated_at
          WHERE themis_agent_runs.organization_id = excluded.organization_id
            AND themis_agent_runs.work_item_id = excluded.work_item_id
        `,
      )
      .run({
        run_id: runId,
        organization_id: organizationId,
        work_item_id: workItemId,
        target_agent_id: targetAgentId,
        scheduler_id: schedulerId,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        status,
        started_at: startedAt ?? null,
        last_heartbeat_at: lastHeartbeatAt ?? null,
        completed_at: completedAt ?? null,
        failure_code: failureCode ?? null,
        failure_message: failureMessage ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent run write did not apply.");
    }
  }

  getManagedAgentNode(nodeId: string): StoredManagedAgentNodeRecord | null {
    const normalizedNodeId = nodeId.trim();

    if (!normalizedNodeId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            node_id,
            organization_id,
            display_name,
            status,
            slot_capacity,
            slot_available,
            labels_json,
            workspace_capabilities_json,
            credential_capabilities_json,
            provider_capabilities_json,
            heartbeat_ttl_seconds,
            last_heartbeat_at,
            created_at,
            updated_at
          FROM themis_agent_nodes
          WHERE node_id = ?
        `,
      )
      .get(normalizedNodeId) as ManagedAgentNodeRow | undefined;

    return row ? mapManagedAgentNodeRow(row) : null;
  }

  listManagedAgentNodesByOrganization(organizationId: string): StoredManagedAgentNodeRecord[] {
    const normalizedOrganizationId = organizationId.trim();

    if (!normalizedOrganizationId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            node_id,
            organization_id,
            display_name,
            status,
            slot_capacity,
            slot_available,
            labels_json,
            workspace_capabilities_json,
            credential_capabilities_json,
            provider_capabilities_json,
            heartbeat_ttl_seconds,
            last_heartbeat_at,
            created_at,
            updated_at
          FROM themis_agent_nodes
          WHERE organization_id = ?
          ORDER BY updated_at DESC, node_id ASC
        `,
      )
      .all(normalizedOrganizationId) as ManagedAgentNodeRow[];

    return rows.map(mapManagedAgentNodeRow);
  }

  saveManagedAgentNode(record: StoredManagedAgentNodeRecord): void {
    const nodeId = record.nodeId.trim();
    const organizationId = record.organizationId.trim();
    const displayName = record.displayName.trim();
    const status = normalizeText(record.status);
    const slotCapacity = Number.isFinite(record.slotCapacity) ? Math.max(1, Math.floor(record.slotCapacity)) : 0;
    const slotAvailable = Number.isFinite(record.slotAvailable)
      ? Math.max(0, Math.min(slotCapacity, Math.floor(record.slotAvailable)))
      : -1;
    const heartbeatTtlSeconds = Number.isFinite(record.heartbeatTtlSeconds)
      ? Math.max(1, Math.floor(record.heartbeatTtlSeconds))
      : 0;
    const lastHeartbeatAt = record.lastHeartbeatAt.trim();
    const labels = dedupeStrings(record.labels);
    const workspaceCapabilities = dedupeStrings(record.workspaceCapabilities);
    const credentialCapabilities = dedupeStrings(record.credentialCapabilities);
    const providerCapabilities = dedupeStrings(record.providerCapabilities);

    if (
      !nodeId ||
      !organizationId ||
      !displayName ||
      !status ||
      !MANAGED_AGENT_NODE_STATUSES.includes(status as ManagedAgentNodeStatus) ||
      slotCapacity <= 0 ||
      slotAvailable < 0 ||
      heartbeatTtlSeconds <= 0 ||
      !lastHeartbeatAt
    ) {
      throw new Error("Managed agent node record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_agent_nodes (
            node_id,
            organization_id,
            display_name,
            status,
            slot_capacity,
            slot_available,
            labels_json,
            workspace_capabilities_json,
            credential_capabilities_json,
            provider_capabilities_json,
            heartbeat_ttl_seconds,
            last_heartbeat_at,
            created_at,
            updated_at
          ) VALUES (
            @node_id,
            @organization_id,
            @display_name,
            @status,
            @slot_capacity,
            @slot_available,
            @labels_json,
            @workspace_capabilities_json,
            @credential_capabilities_json,
            @provider_capabilities_json,
            @heartbeat_ttl_seconds,
            @last_heartbeat_at,
            @created_at,
            @updated_at
          )
          ON CONFLICT(node_id) DO UPDATE SET
            organization_id = excluded.organization_id,
            display_name = excluded.display_name,
            status = excluded.status,
            slot_capacity = excluded.slot_capacity,
            slot_available = excluded.slot_available,
            labels_json = excluded.labels_json,
            workspace_capabilities_json = excluded.workspace_capabilities_json,
            credential_capabilities_json = excluded.credential_capabilities_json,
            provider_capabilities_json = excluded.provider_capabilities_json,
            heartbeat_ttl_seconds = excluded.heartbeat_ttl_seconds,
            last_heartbeat_at = excluded.last_heartbeat_at,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        node_id: nodeId,
        organization_id: organizationId,
        display_name: displayName,
        status,
        slot_capacity: slotCapacity,
        slot_available: slotAvailable,
        labels_json: JSON.stringify(labels),
        workspace_capabilities_json: JSON.stringify(workspaceCapabilities),
        credential_capabilities_json: JSON.stringify(credentialCapabilities),
        provider_capabilities_json: JSON.stringify(providerCapabilities),
        heartbeat_ttl_seconds: heartbeatTtlSeconds,
        last_heartbeat_at: lastHeartbeatAt,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  getAgentExecutionLease(leaseId: string): StoredAgentExecutionLeaseRecord | null {
    const normalizedLeaseId = leaseId.trim();

    if (!normalizedLeaseId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            lease_id,
            run_id,
            work_item_id,
            target_agent_id,
            node_id,
            status,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            created_at,
            updated_at
          FROM themis_agent_execution_leases
          WHERE lease_id = ?
        `,
      )
      .get(normalizedLeaseId) as AgentExecutionLeaseRow | undefined;

    return row ? mapAgentExecutionLeaseRow(row) : null;
  }

  getActiveAgentExecutionLeaseByRun(runId: string): StoredAgentExecutionLeaseRecord | null {
    const normalizedRunId = runId.trim();

    if (!normalizedRunId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            lease_id,
            run_id,
            work_item_id,
            target_agent_id,
            node_id,
            status,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            created_at,
            updated_at
          FROM themis_agent_execution_leases
          WHERE run_id = ?
            AND status = 'active'
          ORDER BY updated_at DESC, lease_id ASC
          LIMIT 1
        `,
      )
      .get(normalizedRunId) as AgentExecutionLeaseRow | undefined;

    return row ? mapAgentExecutionLeaseRow(row) : null;
  }

  listActiveAgentExecutionLeases(): StoredAgentExecutionLeaseRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            lease_id,
            run_id,
            work_item_id,
            target_agent_id,
            node_id,
            status,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            created_at,
            updated_at
          FROM themis_agent_execution_leases
          WHERE status = 'active'
          ORDER BY updated_at DESC, lease_id ASC
        `,
      )
      .all() as AgentExecutionLeaseRow[];

    return rows.map(mapAgentExecutionLeaseRow);
  }

  listAgentExecutionLeasesByRun(runId: string): StoredAgentExecutionLeaseRecord[] {
    const normalizedRunId = runId.trim();

    if (!normalizedRunId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            lease_id,
            run_id,
            work_item_id,
            target_agent_id,
            node_id,
            status,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            created_at,
            updated_at
          FROM themis_agent_execution_leases
          WHERE run_id = ?
          ORDER BY created_at DESC, lease_id ASC
        `,
      )
      .all(normalizedRunId) as AgentExecutionLeaseRow[];

    return rows.map(mapAgentExecutionLeaseRow);
  }

  listAgentExecutionLeasesByNode(nodeId: string): StoredAgentExecutionLeaseRecord[] {
    const normalizedNodeId = nodeId.trim();

    if (!normalizedNodeId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            lease_id,
            run_id,
            work_item_id,
            target_agent_id,
            node_id,
            status,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            created_at,
            updated_at
          FROM themis_agent_execution_leases
          WHERE node_id = ?
          ORDER BY created_at DESC, lease_id ASC
        `,
      )
      .all(normalizedNodeId) as AgentExecutionLeaseRow[];

    return rows.map(mapAgentExecutionLeaseRow);
  }

  saveAgentExecutionLease(record: StoredAgentExecutionLeaseRecord): void {
    const leaseId = record.leaseId.trim();
    const runId = record.runId.trim();
    const workItemId = record.workItemId.trim();
    const targetAgentId = record.targetAgentId.trim();
    const nodeId = record.nodeId.trim();
    const status = normalizeText(record.status);
    const leaseToken = record.leaseToken.trim();
    const leaseExpiresAt = record.leaseExpiresAt.trim();
    const lastHeartbeatAt = normalizeText(record.lastHeartbeatAt);

    if (
      !leaseId ||
      !runId ||
      !workItemId ||
      !targetAgentId ||
      !nodeId ||
      !status ||
      !AGENT_EXECUTION_LEASE_STATUSES.includes(status as AgentExecutionLeaseStatus) ||
      !leaseToken ||
      !leaseExpiresAt
    ) {
      throw new Error("Agent execution lease record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_agent_execution_leases (
            lease_id,
            run_id,
            work_item_id,
            target_agent_id,
            node_id,
            status,
            lease_token,
            lease_expires_at,
            last_heartbeat_at,
            created_at,
            updated_at
          ) VALUES (
            @lease_id,
            @run_id,
            @work_item_id,
            @target_agent_id,
            @node_id,
            @status,
            @lease_token,
            @lease_expires_at,
            @last_heartbeat_at,
            @created_at,
            @updated_at
          )
          ON CONFLICT(lease_id) DO UPDATE SET
            run_id = excluded.run_id,
            work_item_id = excluded.work_item_id,
            target_agent_id = excluded.target_agent_id,
            node_id = excluded.node_id,
            status = excluded.status,
            lease_token = excluded.lease_token,
            lease_expires_at = excluded.lease_expires_at,
            last_heartbeat_at = excluded.last_heartbeat_at,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        lease_id: leaseId,
        run_id: runId,
        work_item_id: workItemId,
        target_agent_id: targetAgentId,
        node_id: nodeId,
        status,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        last_heartbeat_at: lastHeartbeatAt ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  listAgentAuditLogsByOrganization(organizationId: string, limit = 20): StoredAgentAuditLogRecord[] {
    const normalizedOrganizationId = organizationId.trim();

    if (!normalizedOrganizationId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            audit_log_id,
            organization_id,
            event_type,
            actor_principal_id,
            subject_agent_id,
            suggestion_id,
            summary,
            payload_json,
            created_at
          FROM themis_agent_audit_logs
          WHERE organization_id = ?
          ORDER BY created_at DESC, audit_log_id DESC
          LIMIT ?
        `,
      )
      .all(normalizedOrganizationId, normalizeLimit(limit)) as AgentAuditLogRow[];

    return rows.map(mapAgentAuditLogRow);
  }

  saveAgentAuditLog(record: StoredAgentAuditLogRecord): void {
    const auditLogId = record.auditLogId.trim();
    const organizationId = record.organizationId.trim();
    const eventType = normalizeText(record.eventType);
    const actorPrincipalId = record.actorPrincipalId.trim();
    const subjectAgentId = normalizeText(record.subjectAgentId);
    const suggestionId = normalizeText(record.suggestionId);
    const summary = record.summary.trim();

    if (
      !auditLogId
      || !organizationId
      || !eventType
      || !AGENT_AUDIT_LOG_EVENT_TYPES.includes(eventType as AgentAuditLogEventType)
      || !actorPrincipalId
      || !summary
    ) {
      throw new Error("Agent audit log record is incomplete.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_audit_logs (
            audit_log_id,
            organization_id,
            event_type,
            actor_principal_id,
            subject_agent_id,
            suggestion_id,
            summary,
            payload_json,
            created_at
          ) VALUES (
            @audit_log_id,
            @organization_id,
            @event_type,
            @actor_principal_id,
            @subject_agent_id,
            @suggestion_id,
            @summary,
            @payload_json,
            @created_at
          )
          ON CONFLICT(audit_log_id) DO UPDATE SET
            event_type = excluded.event_type,
            actor_principal_id = excluded.actor_principal_id,
            subject_agent_id = excluded.subject_agent_id,
            suggestion_id = excluded.suggestion_id,
            summary = excluded.summary,
            payload_json = excluded.payload_json,
            created_at = excluded.created_at
          WHERE themis_agent_audit_logs.organization_id = excluded.organization_id
        `,
      )
      .run({
        audit_log_id: auditLogId,
        organization_id: organizationId,
        event_type: eventType,
        actor_principal_id: actorPrincipalId,
        subject_agent_id: subjectAgentId ?? null,
        suggestion_id: suggestionId ?? null,
        summary,
        payload_json: stringifyJson(record.payload),
        created_at: record.createdAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent audit log write did not apply.");
    }
  }

  claimNextAgentMailboxEntry(input: {
    ownerAgentId: string;
    leaseToken: string;
    leasedAt: string;
    now: string;
    staleLeaseBefore?: string;
  }): StoredAgentMailboxEntryRecord | null {
    const ownerAgentId = input.ownerAgentId.trim();
    const leaseToken = input.leaseToken.trim();
    const leasedAt = input.leasedAt.trim();
    const now = input.now.trim();
    const staleLeaseBefore = normalizeText(input.staleLeaseBefore);

    if (!ownerAgentId || !leaseToken || !leasedAt || !now) {
      throw new Error("Agent mailbox claim input is incomplete.");
    }

    const claim = this.db.transaction(() => {
      const candidate = this.db
        .prepare(
          `
            SELECT mailbox_entry_id
            FROM themis_agent_mailboxes mailbox
            WHERE mailbox.owner_agent_id = @owner_agent_id
              AND mailbox.available_at <= @now
              AND (
                mailbox.status = 'pending'
                OR (
                  mailbox.status = 'leased'
                  AND @stale_lease_before IS NOT NULL
                  AND (
                    mailbox.leased_at IS NULL
                    OR mailbox.leased_at <= @stale_lease_before
                  )
                )
              )
            ORDER BY
              CASE mailbox.status
                WHEN 'pending' THEN 0
                ELSE 1
              END ASC,
              CASE mailbox.priority
                WHEN 'urgent' THEN 0
                WHEN 'high' THEN 1
                WHEN 'normal' THEN 2
                ELSE 3
              END ASC,
              mailbox.created_at ASC,
              mailbox.mailbox_entry_id ASC
            LIMIT 1
          `,
        )
        .get({
          owner_agent_id: ownerAgentId,
          now,
          stale_lease_before: staleLeaseBefore ?? null,
        }) as { mailbox_entry_id: string } | undefined;

      if (!candidate?.mailbox_entry_id) {
        return null;
      }

      const updateResult = this.db
        .prepare(
          `
            UPDATE themis_agent_mailboxes
            SET
              status = 'leased',
              lease_token = @lease_token,
              leased_at = @leased_at,
              updated_at = @updated_at
            WHERE mailbox_entry_id = @mailbox_entry_id
              AND (
                status = 'pending'
                OR (
                  status = 'leased'
                  AND @stale_lease_before IS NOT NULL
                  AND (
                    leased_at IS NULL
                    OR leased_at <= @stale_lease_before
                  )
                )
              )
          `,
        )
        .run({
          mailbox_entry_id: candidate.mailbox_entry_id,
          lease_token: leaseToken,
          leased_at: leasedAt,
          updated_at: now,
          stale_lease_before: staleLeaseBefore ?? null,
        });

      if (updateResult.changes === 0) {
        return null;
      }

      return this.getAgentMailboxEntry(candidate.mailbox_entry_id);
    });

    return claim();
  }

  claimNextRunnableAgentWorkItem(input: {
    schedulerId: string;
    leaseToken: string;
    leaseExpiresAt: string;
    now: string;
    organizationId?: string;
    targetAgentId?: string;
  }): { workItem: StoredAgentWorkItemRecord; run: StoredAgentRunRecord } | null {
    const schedulerId = input.schedulerId.trim();
    const leaseToken = input.leaseToken.trim();
    const leaseExpiresAt = input.leaseExpiresAt.trim();
    const now = input.now.trim();
    const organizationId = normalizeText(input.organizationId);
    const targetAgentId = normalizeText(input.targetAgentId);

    if (!schedulerId || !leaseToken || !leaseExpiresAt || !now) {
      throw new Error("Agent work item claim input is incomplete.");
    }

    const claim = this.db.transaction(() => {
      const filters: string[] = [
        "work_item.status = 'queued'",
        "agent.status IN ('active', 'bootstrapping')",
        "(work_item.scheduled_at IS NULL OR work_item.scheduled_at <= @now)",
        `
        NOT EXISTS (
          SELECT 1
          FROM themis_agent_runs active_run
          WHERE active_run.work_item_id = work_item.work_item_id
            AND active_run.status IN ('created', 'starting', 'running', 'waiting_action')
        )
        `,
        `
        NOT EXISTS (
          SELECT 1
          FROM themis_agent_runs active_run
          WHERE active_run.target_agent_id = work_item.target_agent_id
            AND active_run.status IN ('created', 'starting', 'running', 'waiting_action')
        )
        `,
      ];
      const params: Record<string, string> = {
        now,
      };

      if (organizationId) {
        filters.push("work_item.organization_id = @organization_id");
        params.organization_id = organizationId;
      }

      if (targetAgentId) {
        filters.push("work_item.target_agent_id = @target_agent_id");
        params.target_agent_id = targetAgentId;
      }

      const candidate = this.db
        .prepare(
          `
            SELECT work_item_id
            FROM themis_agent_work_items work_item
            INNER JOIN themis_managed_agents agent
              ON agent.agent_id = work_item.target_agent_id
            WHERE ${filters.join("\n              AND ")}
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
          `,
        )
        .get(params) as { work_item_id: string } | undefined;

      if (!candidate?.work_item_id) {
        return null;
      }

      const updateResult = this.db
        .prepare(
          `
            UPDATE themis_agent_work_items
            SET
              status = 'planning',
              started_at = COALESCE(started_at, @started_at),
              updated_at = @updated_at
            WHERE work_item_id = @work_item_id
              AND status = 'queued'
          `,
        )
        .run({
          work_item_id: candidate.work_item_id,
          started_at: now,
          updated_at: now,
        });

      if (updateResult.changes === 0) {
        return null;
      }

      const workItem = this.getAgentWorkItem(candidate.work_item_id);

      if (!workItem) {
        throw new Error("Claimed work item disappeared.");
      }

      const run: StoredAgentRunRecord = {
        runId: createId("run"),
        organizationId: workItem.organizationId,
        workItemId: workItem.workItemId,
        targetAgentId: workItem.targetAgentId,
        schedulerId,
        leaseToken,
        leaseExpiresAt,
        status: "created",
        createdAt: now,
        updatedAt: now,
      };

      this.saveAgentRun(run);
      return {
        workItem,
        run: this.getAgentRun(run.runId) ?? run,
      };
    });

    return claim();
  }

  listRunnableAgentWorkItems(input: {
    now: string;
    organizationId?: string;
    targetAgentId?: string;
    limit?: number;
  }): StoredAgentWorkItemRecord[] {
    const now = input.now.trim();
    const organizationId = normalizeText(input.organizationId);
    const targetAgentId = normalizeText(input.targetAgentId);
    const limit = Number.isFinite(input.limit) && (input.limit as number) > 0
      ? Math.floor(input.limit as number)
      : 100;

    if (!now) {
      throw new Error("Runnable work item listing requires now.");
    }

    const filters: string[] = [
      "work_item.status = 'queued'",
      "agent.status IN ('active', 'bootstrapping')",
      "(work_item.scheduled_at IS NULL OR work_item.scheduled_at <= @now)",
      `
      NOT EXISTS (
        SELECT 1
        FROM themis_agent_runs active_run
        WHERE active_run.work_item_id = work_item.work_item_id
          AND active_run.status IN ('created', 'starting', 'running', 'waiting_action')
      )
      `,
      `
      NOT EXISTS (
        SELECT 1
        FROM themis_agent_runs active_run
        WHERE active_run.target_agent_id = work_item.target_agent_id
          AND active_run.status IN ('created', 'starting', 'running', 'waiting_action')
      )
      `,
    ];
    const params: Record<string, string | number> = {
      now,
      limit,
    };

    if (organizationId) {
      filters.push("work_item.organization_id = @organization_id");
      params.organization_id = organizationId;
    }

    if (targetAgentId) {
      filters.push("work_item.target_agent_id = @target_agent_id");
      params.target_agent_id = targetAgentId;
    }

    const rows = this.db
      .prepare(
        `
          SELECT work_item.work_item_id
          FROM themis_agent_work_items work_item
          INNER JOIN themis_managed_agents agent
            ON agent.agent_id = work_item.target_agent_id
          WHERE ${filters.join("\n            AND ")}
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
          LIMIT @limit
        `,
      )
      .all(params) as Array<{ work_item_id: string }>;

    return rows
      .map((row) => this.getAgentWorkItem(row.work_item_id))
      .filter((value): value is StoredAgentWorkItemRecord => Boolean(value));
  }

  claimRunnableAgentWorkItemById(input: {
    workItemId: string;
    schedulerId: string;
    leaseToken: string;
    leaseExpiresAt: string;
    now: string;
  }): { workItem: StoredAgentWorkItemRecord; run: StoredAgentRunRecord } | null {
    const workItemId = input.workItemId.trim();
    const schedulerId = input.schedulerId.trim();
    const leaseToken = input.leaseToken.trim();
    const leaseExpiresAt = input.leaseExpiresAt.trim();
    const now = input.now.trim();

    if (!workItemId || !schedulerId || !leaseToken || !leaseExpiresAt || !now) {
      throw new Error("Specific agent work item claim input is incomplete.");
    }

    const claim = this.db.transaction(() => {
      const candidate = this.db
        .prepare(
          `
            SELECT work_item.work_item_id
            FROM themis_agent_work_items work_item
            INNER JOIN themis_managed_agents agent
              ON agent.agent_id = work_item.target_agent_id
            WHERE work_item.work_item_id = @work_item_id
              AND work_item.status = 'queued'
              AND agent.status IN ('active', 'bootstrapping')
              AND (work_item.scheduled_at IS NULL OR work_item.scheduled_at <= @now)
              AND NOT EXISTS (
                SELECT 1
                FROM themis_agent_runs active_run
                WHERE active_run.work_item_id = work_item.work_item_id
                  AND active_run.status IN ('created', 'starting', 'running', 'waiting_action')
              )
              AND NOT EXISTS (
                SELECT 1
                FROM themis_agent_runs active_run
                WHERE active_run.target_agent_id = work_item.target_agent_id
                  AND active_run.status IN ('created', 'starting', 'running', 'waiting_action')
              )
            LIMIT 1
          `,
        )
        .get({
          work_item_id: workItemId,
          now,
        }) as { work_item_id: string } | undefined;

      if (!candidate?.work_item_id) {
        return null;
      }

      const updateResult = this.db
        .prepare(
          `
            UPDATE themis_agent_work_items
            SET
              status = 'planning',
              started_at = COALESCE(started_at, @started_at),
              updated_at = @updated_at
            WHERE work_item_id = @work_item_id
              AND status = 'queued'
          `,
        )
        .run({
          work_item_id: workItemId,
          started_at: now,
          updated_at: now,
        });

      if (updateResult.changes === 0) {
        return null;
      }

      const workItem = this.getAgentWorkItem(workItemId);

      if (!workItem) {
        throw new Error("Claimed work item disappeared.");
      }

      const run: StoredAgentRunRecord = {
        runId: createId("run"),
        organizationId: workItem.organizationId,
        workItemId: workItem.workItemId,
        targetAgentId: workItem.targetAgentId,
        schedulerId,
        leaseToken,
        leaseExpiresAt,
        status: "created",
        createdAt: now,
        updatedAt: now,
      };

      this.saveAgentRun(run);
      return {
        workItem,
        run: this.getAgentRun(run.runId) ?? run,
      };
    });

    return claim();
  }

  getScheduledTask(scheduledTaskId: string): StoredScheduledTaskRecord | null {
    const normalizedScheduledTaskId = scheduledTaskId.trim();

    if (!normalizedScheduledTaskId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            scheduled_task_id,
            principal_id,
            source_channel,
            channel_user_id,
            display_name,
            session_id,
            channel_session_key,
            goal,
            input_text,
            options_json,
            automation_json,
            recurrence_json,
            watch_work_item_id,
            timezone,
            scheduled_at,
            status,
            last_run_id,
            created_at,
            updated_at,
            cancelled_at,
            completed_at,
            last_error
          FROM themis_scheduled_tasks
          WHERE scheduled_task_id = ?
        `,
      )
      .get(normalizedScheduledTaskId) as ScheduledTaskRow | undefined;

    return row ? mapScheduledTaskRow(row) : null;
  }

  listScheduledTasksByPrincipal(principalId: string): StoredScheduledTaskRecord[] {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            scheduled_task_id,
            principal_id,
            source_channel,
            channel_user_id,
            display_name,
            session_id,
            channel_session_key,
            goal,
            input_text,
            options_json,
            automation_json,
            recurrence_json,
            watch_work_item_id,
            timezone,
            scheduled_at,
            status,
            last_run_id,
            created_at,
            updated_at,
            cancelled_at,
            completed_at,
            last_error
          FROM themis_scheduled_tasks
          WHERE principal_id = ?
          ORDER BY
            CASE status
              WHEN 'scheduled' THEN 0
              WHEN 'running' THEN 1
              WHEN 'failed' THEN 2
              WHEN 'completed' THEN 3
              ELSE 4
            END ASC,
            scheduled_at ASC,
            updated_at DESC,
            scheduled_task_id ASC
        `,
      )
      .all(normalizedPrincipalId) as ScheduledTaskRow[];

    return rows.map(mapScheduledTaskRow);
  }

  saveScheduledTask(record: StoredScheduledTaskRecord): void {
    const scheduledTaskId = record.scheduledTaskId.trim();
    const principalId = record.principalId.trim();
    const sourceChannel = record.sourceChannel.trim();
    const channelUserId = record.channelUserId.trim();
    const goal = normalizeOptionalMultilineText(record.goal);
    const timezone = normalizeOptionalText(record.timezone);
    const scheduledAt = normalizeOptionalText(record.scheduledAt);
    const status = normalizeOptionalText(record.status);
    const displayName = normalizeOptionalText(record.displayName);
    const sessionId = normalizeOptionalText(record.sessionId);
    const channelSessionKey = normalizeOptionalText(record.channelSessionKey);
    const inputText = normalizeOptionalMultilineText(record.inputText);
    const watchWorkItemId = normalizeOptionalText(record.watch?.workItemId);
    const lastRunId = normalizeOptionalText(record.lastRunId);
    const cancelledAt = normalizeOptionalText(record.cancelledAt);
    const completedAt = normalizeOptionalText(record.completedAt);
    const lastError = normalizeOptionalMultilineText(record.lastError);

    if (
      !scheduledTaskId ||
      !principalId ||
      !sourceChannel ||
      !channelUserId ||
      !goal ||
      !timezone ||
      !scheduledAt ||
      !status ||
      !SCHEDULED_TASK_STATUSES.includes(status as ScheduledTaskStatus)
    ) {
      throw new Error("Scheduled task record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_scheduled_tasks
          WHERE scheduled_task_id = ?
        `,
      )
      .get(scheduledTaskId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Scheduled task belongs to another principal.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_scheduled_tasks (
            scheduled_task_id,
            principal_id,
            source_channel,
            channel_user_id,
            display_name,
            session_id,
            channel_session_key,
            goal,
            input_text,
            options_json,
            automation_json,
            recurrence_json,
            watch_work_item_id,
            timezone,
            scheduled_at,
            status,
            last_run_id,
            created_at,
            updated_at,
            cancelled_at,
            completed_at,
            last_error
          ) VALUES (
            @scheduled_task_id,
            @principal_id,
            @source_channel,
            @channel_user_id,
            @display_name,
            @session_id,
            @channel_session_key,
            @goal,
            @input_text,
            @options_json,
            @automation_json,
            @recurrence_json,
            @watch_work_item_id,
            @timezone,
            @scheduled_at,
            @status,
            @last_run_id,
            @created_at,
            @updated_at,
            @cancelled_at,
            @completed_at,
            @last_error
          )
          ON CONFLICT(scheduled_task_id) DO UPDATE SET
            source_channel = excluded.source_channel,
            channel_user_id = excluded.channel_user_id,
            display_name = excluded.display_name,
            session_id = excluded.session_id,
            channel_session_key = excluded.channel_session_key,
            goal = excluded.goal,
            input_text = excluded.input_text,
            options_json = excluded.options_json,
            automation_json = excluded.automation_json,
            recurrence_json = excluded.recurrence_json,
            watch_work_item_id = excluded.watch_work_item_id,
            timezone = excluded.timezone,
            scheduled_at = excluded.scheduled_at,
            status = excluded.status,
            last_run_id = excluded.last_run_id,
            updated_at = excluded.updated_at,
            cancelled_at = excluded.cancelled_at,
            completed_at = excluded.completed_at,
            last_error = excluded.last_error
          WHERE themis_scheduled_tasks.principal_id = excluded.principal_id
        `,
      )
      .run({
        scheduled_task_id: scheduledTaskId,
        principal_id: principalId,
        source_channel: sourceChannel,
        channel_user_id: channelUserId,
        display_name: displayName ?? null,
        session_id: sessionId ?? null,
        channel_session_key: channelSessionKey ?? null,
        goal,
        input_text: inputText ?? null,
        options_json: stringifyJson(record.options),
        automation_json: stringifyJson(record.automation),
        recurrence_json: stringifyJson(record.recurrence),
        watch_work_item_id: watchWorkItemId ?? null,
        timezone,
        scheduled_at: scheduledAt,
        status,
        last_run_id: lastRunId ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        cancelled_at: cancelledAt ?? null,
        completed_at: completedAt ?? null,
        last_error: lastError ?? null,
      });

    if (writeResult.changes === 0) {
      throw new Error("Scheduled task write did not apply.");
    }
  }

  listWatchedScheduledTasks(status: ScheduledTaskStatus = "scheduled"): StoredScheduledTaskRecord[] {
    const normalizedStatus = normalizeOptionalText(status);

    if (!normalizedStatus || !SCHEDULED_TASK_STATUSES.includes(normalizedStatus as ScheduledTaskStatus)) {
      throw new Error("Scheduled task status is invalid.");
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            scheduled_task_id,
            principal_id,
            source_channel,
            channel_user_id,
            display_name,
            session_id,
            channel_session_key,
            goal,
            input_text,
            options_json,
            automation_json,
            recurrence_json,
            watch_work_item_id,
            timezone,
            scheduled_at,
            status,
            last_run_id,
            created_at,
            updated_at,
            cancelled_at,
            completed_at,
            last_error
          FROM themis_scheduled_tasks
          WHERE status = ?
            AND watch_work_item_id IS NOT NULL
          ORDER BY scheduled_at ASC, created_at ASC, scheduled_task_id ASC
        `,
      )
      .all(normalizedStatus) as ScheduledTaskRow[];

    return rows.map(mapScheduledTaskRow);
  }

  getScheduledTaskRun(runId: string): StoredScheduledTaskRunRecord | null {
    const normalizedRunId = runId.trim();

    if (!normalizedRunId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            run_id,
            scheduled_task_id,
            principal_id,
            scheduler_id,
            lease_token,
            lease_expires_at,
            status,
            request_id,
            task_id,
            triggered_at,
            started_at,
            last_heartbeat_at,
            completed_at,
            result_summary,
            result_output,
            structured_output_json,
            error_json,
            created_at,
            updated_at
          FROM themis_scheduled_task_runs
          WHERE run_id = ?
        `,
      )
      .get(normalizedRunId) as ScheduledTaskRunRow | undefined;

    return row ? mapScheduledTaskRunRow(row) : null;
  }

  listScheduledTaskRunsByTask(scheduledTaskId: string): StoredScheduledTaskRunRecord[] {
    const normalizedScheduledTaskId = scheduledTaskId.trim();

    if (!normalizedScheduledTaskId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            run_id,
            scheduled_task_id,
            principal_id,
            scheduler_id,
            lease_token,
            lease_expires_at,
            status,
            request_id,
            task_id,
            triggered_at,
            started_at,
            last_heartbeat_at,
            completed_at,
            result_summary,
            result_output,
            structured_output_json,
            error_json,
            created_at,
            updated_at
          FROM themis_scheduled_task_runs
          WHERE scheduled_task_id = ?
          ORDER BY created_at DESC, run_id ASC
        `,
      )
      .all(normalizedScheduledTaskId) as ScheduledTaskRunRow[];

    return rows.map(mapScheduledTaskRunRow);
  }

  listStaleActiveScheduledTaskRuns(leaseExpiresBefore: string): StoredScheduledTaskRunRecord[] {
    const normalizedLeaseExpiresBefore = leaseExpiresBefore.trim();

    if (!normalizedLeaseExpiresBefore) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            run_id,
            scheduled_task_id,
            principal_id,
            scheduler_id,
            lease_token,
            lease_expires_at,
            status,
            request_id,
            task_id,
            triggered_at,
            started_at,
            last_heartbeat_at,
            completed_at,
            result_summary,
            result_output,
            structured_output_json,
            error_json,
            created_at,
            updated_at
          FROM themis_scheduled_task_runs
          WHERE status IN ('created', 'running')
            AND lease_expires_at <= ?
          ORDER BY lease_expires_at ASC, run_id ASC
        `,
      )
      .all(normalizedLeaseExpiresBefore) as ScheduledTaskRunRow[];

    return rows.map(mapScheduledTaskRunRow);
  }

  saveScheduledTaskRun(record: StoredScheduledTaskRunRecord): void {
    const runId = record.runId.trim();
    const scheduledTaskId = record.scheduledTaskId.trim();
    const principalId = record.principalId.trim();
    const schedulerId = record.schedulerId.trim();
    const leaseToken = record.leaseToken.trim();
    const leaseExpiresAt = record.leaseExpiresAt.trim();
    const status = normalizeOptionalText(record.status);
    const requestId = normalizeOptionalText(record.requestId);
    const taskId = normalizeOptionalText(record.taskId);
    const triggeredAt = normalizeOptionalText(record.triggeredAt);
    const startedAt = normalizeOptionalText(record.startedAt);
    const lastHeartbeatAt = normalizeOptionalText(record.lastHeartbeatAt);
    const completedAt = normalizeOptionalText(record.completedAt);
    const resultSummary = normalizeOptionalMultilineText(record.resultSummary);
    const resultOutput = normalizeOptionalMultilineText(record.resultOutput);

    if (
      !runId ||
      !scheduledTaskId ||
      !principalId ||
      !schedulerId ||
      !leaseToken ||
      !leaseExpiresAt ||
      !status ||
      !triggeredAt ||
      !SCHEDULED_TASK_RUN_STATUSES.includes(status as ScheduledTaskRunStatus)
    ) {
      throw new Error("Scheduled task run record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT scheduled_task_id, principal_id
          FROM themis_scheduled_task_runs
          WHERE run_id = ?
        `,
      )
      .get(runId) as { scheduled_task_id: string; principal_id: string } | undefined;

    if (existing && (existing.scheduled_task_id !== scheduledTaskId || existing.principal_id !== principalId)) {
      throw new Error("Scheduled task run belongs to another task or principal.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_scheduled_task_runs (
            run_id,
            scheduled_task_id,
            principal_id,
            scheduler_id,
            lease_token,
            lease_expires_at,
            status,
            request_id,
            task_id,
            triggered_at,
            started_at,
            last_heartbeat_at,
            completed_at,
            result_summary,
            result_output,
            structured_output_json,
            error_json,
            created_at,
            updated_at
          ) VALUES (
            @run_id,
            @scheduled_task_id,
            @principal_id,
            @scheduler_id,
            @lease_token,
            @lease_expires_at,
            @status,
            @request_id,
            @task_id,
            @triggered_at,
            @started_at,
            @last_heartbeat_at,
            @completed_at,
            @result_summary,
            @result_output,
            @structured_output_json,
            @error_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(run_id) DO UPDATE SET
            scheduler_id = excluded.scheduler_id,
            lease_token = excluded.lease_token,
            lease_expires_at = excluded.lease_expires_at,
            status = excluded.status,
            request_id = excluded.request_id,
            task_id = excluded.task_id,
            started_at = excluded.started_at,
            last_heartbeat_at = excluded.last_heartbeat_at,
            completed_at = excluded.completed_at,
            result_summary = excluded.result_summary,
            result_output = excluded.result_output,
            structured_output_json = excluded.structured_output_json,
            error_json = excluded.error_json,
            updated_at = excluded.updated_at
          WHERE themis_scheduled_task_runs.scheduled_task_id = excluded.scheduled_task_id
            AND themis_scheduled_task_runs.principal_id = excluded.principal_id
        `,
      )
      .run({
        run_id: runId,
        scheduled_task_id: scheduledTaskId,
        principal_id: principalId,
        scheduler_id: schedulerId,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        status,
        request_id: requestId ?? null,
        task_id: taskId ?? null,
        triggered_at: triggeredAt,
        started_at: startedAt ?? null,
        last_heartbeat_at: lastHeartbeatAt ?? null,
        completed_at: completedAt ?? null,
        result_summary: resultSummary ?? null,
        result_output: resultOutput ?? null,
        structured_output_json: stringifyJson(record.structuredOutput),
        error_json: stringifyJson(record.error),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Scheduled task run write did not apply.");
    }
  }

  claimNextDueScheduledTask(input: {
    schedulerId: string;
    leaseToken: string;
    leaseExpiresAt: string;
    now: string;
    principalId?: string;
  }): { task: StoredScheduledTaskRecord; run: StoredScheduledTaskRunRecord } | null {
    const schedulerId = input.schedulerId.trim();
    const leaseToken = input.leaseToken.trim();
    const leaseExpiresAt = input.leaseExpiresAt.trim();
    const now = input.now.trim();
    const principalId = normalizeOptionalText(input.principalId);

    if (!schedulerId || !leaseToken || !leaseExpiresAt || !now) {
      throw new Error("Scheduled task claim input is incomplete.");
    }

    const claim = this.db.transaction(() => {
      const filters = [
        "task.status = 'scheduled'",
        "task.scheduled_at <= @now",
        `
        NOT EXISTS (
          SELECT 1
          FROM themis_scheduled_task_runs active_run
          WHERE active_run.scheduled_task_id = task.scheduled_task_id
            AND active_run.status IN ('created', 'running')
        )
        `,
      ];
      const params: Record<string, string> = { now };

      if (principalId) {
        filters.push("task.principal_id = @principal_id");
        params.principal_id = principalId;
      }

      const candidate = this.db
        .prepare(
          `
            SELECT task.scheduled_task_id
            FROM themis_scheduled_tasks task
            WHERE ${filters.join("\n              AND ")}
            ORDER BY task.scheduled_at ASC, task.created_at ASC, task.scheduled_task_id ASC
            LIMIT 1
          `,
        )
        .get(params) as { scheduled_task_id: string } | undefined;

      if (!candidate?.scheduled_task_id) {
        return null;
      }

      const runId = createId("scheduled-run");
      const updateResult = this.db
        .prepare(
          `
            UPDATE themis_scheduled_tasks
            SET
              status = 'running',
              last_run_id = @last_run_id,
              updated_at = @updated_at,
              last_error = NULL
            WHERE scheduled_task_id = @scheduled_task_id
              AND status = 'scheduled'
          `,
        )
        .run({
          scheduled_task_id: candidate.scheduled_task_id,
          last_run_id: runId,
          updated_at: now,
        });

      if (updateResult.changes === 0) {
        return null;
      }

      const task = this.getScheduledTask(candidate.scheduled_task_id);

      if (!task) {
        throw new Error("Claimed scheduled task disappeared.");
      }

      const run: StoredScheduledTaskRunRecord = {
        runId,
        scheduledTaskId: task.scheduledTaskId,
        principalId: task.principalId,
        schedulerId,
        leaseToken,
        leaseExpiresAt,
        status: "created",
        triggeredAt: now,
        createdAt: now,
        updatedAt: now,
      };

      this.saveScheduledTaskRun(run);
      return {
        task,
        run: this.getScheduledTaskRun(run.runId) ?? run,
      };
    });

    return claim();
  }

  getAgentMessage(messageId: string): StoredAgentMessageRecord | null {
    const normalizedMessageId = messageId.trim();

    if (!normalizedMessageId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            message_id,
            organization_id,
            from_agent_id,
            to_agent_id,
            work_item_id,
            run_id,
            parent_message_id,
            message_type,
            payload_json,
            artifact_refs_json,
            priority,
            requires_ack,
            created_at
          FROM themis_agent_messages
          WHERE message_id = ?
        `,
      )
      .get(normalizedMessageId) as AgentMessageRow | undefined;

    return row ? mapAgentMessageRow(row) : null;
  }

  listAgentMessagesByWorkItem(workItemId: string): StoredAgentMessageRecord[] {
    const normalizedWorkItemId = workItemId.trim();

    if (!normalizedWorkItemId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            message_id,
            organization_id,
            from_agent_id,
            to_agent_id,
            work_item_id,
            run_id,
            parent_message_id,
            message_type,
            payload_json,
            artifact_refs_json,
            priority,
            requires_ack,
            created_at
          FROM themis_agent_messages
          WHERE work_item_id = ?
          ORDER BY created_at ASC, message_id ASC
        `,
      )
      .all(normalizedWorkItemId) as AgentMessageRow[];

    return rows.map(mapAgentMessageRow);
  }

  listAgentMessagesByAgent(agentId: string): StoredAgentMessageRecord[] {
    const normalizedAgentId = agentId.trim();

    if (!normalizedAgentId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            message_id,
            organization_id,
            from_agent_id,
            to_agent_id,
            work_item_id,
            run_id,
            parent_message_id,
            message_type,
            payload_json,
            artifact_refs_json,
            priority,
            requires_ack,
            created_at
          FROM themis_agent_messages
          WHERE from_agent_id = ?
             OR to_agent_id = ?
          ORDER BY created_at DESC, message_id DESC
        `,
      )
      .all(normalizedAgentId, normalizedAgentId) as AgentMessageRow[];

    return rows.map(mapAgentMessageRow);
  }

  saveAgentMessage(record: StoredAgentMessageRecord): void {
    const messageId = record.messageId.trim();
    const organizationId = record.organizationId.trim();
    const fromAgentId = record.fromAgentId.trim();
    const toAgentId = record.toAgentId.trim();
    const workItemId = normalizeText(record.workItemId);
    const runId = normalizeText(record.runId);
    const parentMessageId = normalizeText(record.parentMessageId);
    const messageType = normalizeText(record.messageType);
    const priority = normalizeText(record.priority);
    const artifactRefs = dedupeStrings(record.artifactRefs);

    if (
      !messageId ||
      !organizationId ||
      !fromAgentId ||
      !toAgentId ||
      !messageType ||
      !AGENT_MESSAGE_TYPES.includes(messageType as AgentMessageType) ||
      !priority ||
      !MANAGED_AGENT_PRIORITIES.includes(priority as ManagedAgentPriority)
    ) {
      throw new Error("Agent message record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT organization_id, to_agent_id
          FROM themis_agent_messages
          WHERE message_id = ?
        `,
      )
      .get(messageId) as { organization_id: string; to_agent_id: string } | undefined;

    if (existing && (existing.organization_id !== organizationId || existing.to_agent_id !== toAgentId)) {
      throw new Error("Agent message belongs to another organization or mailbox.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_messages (
            message_id,
            organization_id,
            from_agent_id,
            to_agent_id,
            work_item_id,
            run_id,
            parent_message_id,
            message_type,
            payload_json,
            artifact_refs_json,
            priority,
            requires_ack,
            created_at
          ) VALUES (
            @message_id,
            @organization_id,
            @from_agent_id,
            @to_agent_id,
            @work_item_id,
            @run_id,
            @parent_message_id,
            @message_type,
            @payload_json,
            @artifact_refs_json,
            @priority,
            @requires_ack,
            @created_at
          )
          ON CONFLICT(message_id) DO UPDATE SET
            work_item_id = excluded.work_item_id,
            run_id = excluded.run_id,
            parent_message_id = excluded.parent_message_id,
            message_type = excluded.message_type,
            payload_json = excluded.payload_json,
            artifact_refs_json = excluded.artifact_refs_json,
            priority = excluded.priority,
            requires_ack = excluded.requires_ack
          WHERE themis_agent_messages.organization_id = excluded.organization_id
            AND themis_agent_messages.to_agent_id = excluded.to_agent_id
        `,
      )
      .run({
        message_id: messageId,
        organization_id: organizationId,
        from_agent_id: fromAgentId,
        to_agent_id: toAgentId,
        work_item_id: workItemId ?? null,
        run_id: runId ?? null,
        parent_message_id: parentMessageId ?? null,
        message_type: messageType,
        payload_json: stringifyJson(record.payload),
        artifact_refs_json: JSON.stringify(artifactRefs),
        priority,
        requires_ack: record.requiresAck ? 1 : 0,
        created_at: record.createdAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent message write did not apply.");
    }
  }

  getAgentHandoff(handoffId: string): StoredAgentHandoffRecord | null {
    const normalizedHandoffId = handoffId.trim();

    if (!normalizedHandoffId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            handoff_id,
            organization_id,
            from_agent_id,
            to_agent_id,
            work_item_id,
            source_message_id,
            source_run_id,
            summary,
            blockers_json,
            recommended_next_actions_json,
            attached_artifacts_json,
            payload_json,
            created_at,
            updated_at
          FROM themis_agent_handoffs
          WHERE handoff_id = ?
        `,
      )
      .get(normalizedHandoffId) as AgentHandoffRow | undefined;

    return row ? mapAgentHandoffRow(row) : null;
  }

  listAgentHandoffsByWorkItem(workItemId: string): StoredAgentHandoffRecord[] {
    const normalizedWorkItemId = workItemId.trim();

    if (!normalizedWorkItemId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            handoff_id,
            organization_id,
            from_agent_id,
            to_agent_id,
            work_item_id,
            source_message_id,
            source_run_id,
            summary,
            blockers_json,
            recommended_next_actions_json,
            attached_artifacts_json,
            payload_json,
            created_at,
            updated_at
          FROM themis_agent_handoffs
          WHERE work_item_id = ?
          ORDER BY created_at DESC, handoff_id DESC
        `,
      )
      .all(normalizedWorkItemId) as AgentHandoffRow[];

    return rows.map(mapAgentHandoffRow);
  }

  listAgentHandoffsByAgent(agentId: string): StoredAgentHandoffRecord[] {
    const normalizedAgentId = agentId.trim();

    if (!normalizedAgentId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            handoff_id,
            organization_id,
            from_agent_id,
            to_agent_id,
            work_item_id,
            source_message_id,
            source_run_id,
            summary,
            blockers_json,
            recommended_next_actions_json,
            attached_artifacts_json,
            payload_json,
            created_at,
            updated_at
          FROM themis_agent_handoffs
          WHERE from_agent_id = ?
             OR to_agent_id = ?
          ORDER BY created_at DESC, handoff_id DESC
        `,
      )
      .all(normalizedAgentId, normalizedAgentId) as AgentHandoffRow[];

    return rows.map(mapAgentHandoffRow);
  }

  listAgentHandoffsByOwnerPrincipal(ownerPrincipalId: string): StoredAgentHandoffRecord[] {
    const normalizedOwnerPrincipalId = ownerPrincipalId.trim();

    if (!normalizedOwnerPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            handoff.handoff_id,
            handoff.organization_id,
            handoff.from_agent_id,
            handoff.to_agent_id,
            handoff.work_item_id,
            handoff.source_message_id,
            handoff.source_run_id,
            handoff.summary,
            handoff.blockers_json,
            handoff.recommended_next_actions_json,
            handoff.attached_artifacts_json,
            handoff.payload_json,
            handoff.created_at,
            handoff.updated_at
          FROM themis_agent_handoffs handoff
          INNER JOIN themis_organizations organization
            ON organization.organization_id = handoff.organization_id
          WHERE organization.owner_principal_id = ?
          ORDER BY handoff.created_at DESC, handoff.handoff_id DESC
        `,
      )
      .all(normalizedOwnerPrincipalId) as AgentHandoffRow[];

    return rows.map(mapAgentHandoffRow);
  }

  saveAgentHandoff(record: StoredAgentHandoffRecord): void {
    const handoffId = record.handoffId.trim();
    const organizationId = record.organizationId.trim();
    const fromAgentId = record.fromAgentId.trim();
    const toAgentId = record.toAgentId.trim();
    const workItemId = record.workItemId.trim();
    const sourceMessageId = normalizeText(record.sourceMessageId);
    const sourceRunId = normalizeText(record.sourceRunId);
    const summary = record.summary.trim();
    const blockers = dedupeStrings(record.blockers);
    const recommendedNextActions = dedupeStrings(record.recommendedNextActions);
    const attachedArtifacts = dedupeStrings(record.attachedArtifacts);

    if (!handoffId || !organizationId || !fromAgentId || !toAgentId || !workItemId || !summary) {
      throw new Error("Agent handoff record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT organization_id, work_item_id
          FROM themis_agent_handoffs
          WHERE handoff_id = ?
        `,
      )
      .get(handoffId) as { organization_id: string; work_item_id: string } | undefined;

    if (existing && (existing.organization_id !== organizationId || existing.work_item_id !== workItemId)) {
      throw new Error("Agent handoff belongs to another organization or work item.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_handoffs (
            handoff_id,
            organization_id,
            from_agent_id,
            to_agent_id,
            work_item_id,
            source_message_id,
            source_run_id,
            summary,
            blockers_json,
            recommended_next_actions_json,
            attached_artifacts_json,
            payload_json,
            created_at,
            updated_at
          ) VALUES (
            @handoff_id,
            @organization_id,
            @from_agent_id,
            @to_agent_id,
            @work_item_id,
            @source_message_id,
            @source_run_id,
            @summary,
            @blockers_json,
            @recommended_next_actions_json,
            @attached_artifacts_json,
            @payload_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(handoff_id) DO UPDATE SET
            source_message_id = excluded.source_message_id,
            source_run_id = excluded.source_run_id,
            summary = excluded.summary,
            blockers_json = excluded.blockers_json,
            recommended_next_actions_json = excluded.recommended_next_actions_json,
            attached_artifacts_json = excluded.attached_artifacts_json,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
          WHERE themis_agent_handoffs.organization_id = excluded.organization_id
            AND themis_agent_handoffs.work_item_id = excluded.work_item_id
        `,
      )
      .run({
        handoff_id: handoffId,
        organization_id: organizationId,
        from_agent_id: fromAgentId,
        to_agent_id: toAgentId,
        work_item_id: workItemId,
        source_message_id: sourceMessageId ?? null,
        source_run_id: sourceRunId ?? null,
        summary,
        blockers_json: JSON.stringify(blockers),
        recommended_next_actions_json: JSON.stringify(recommendedNextActions),
        attached_artifacts_json: JSON.stringify(attachedArtifacts),
        payload_json: stringifyJson(record.payload),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent handoff write did not apply.");
    }
  }

  getAgentMailboxEntry(mailboxEntryId: string): StoredAgentMailboxEntryRecord | null {
    const normalizedMailboxEntryId = mailboxEntryId.trim();

    if (!normalizedMailboxEntryId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            mailbox_entry_id,
            organization_id,
            owner_agent_id,
            message_id,
            work_item_id,
            priority,
            status,
            requires_ack,
            available_at,
            lease_token,
            leased_at,
            acked_at,
            created_at,
            updated_at
          FROM themis_agent_mailboxes
          WHERE mailbox_entry_id = ?
        `,
      )
      .get(normalizedMailboxEntryId) as AgentMailboxEntryRow | undefined;

    return row ? mapAgentMailboxEntryRow(row) : null;
  }

  listAgentMailboxEntriesByAgent(ownerAgentId: string): StoredAgentMailboxEntryRecord[] {
    const normalizedOwnerAgentId = ownerAgentId.trim();

    if (!normalizedOwnerAgentId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            mailbox_entry_id,
            organization_id,
            owner_agent_id,
            message_id,
            work_item_id,
            priority,
            status,
            requires_ack,
            available_at,
            lease_token,
            leased_at,
            acked_at,
            created_at,
            updated_at
          FROM themis_agent_mailboxes
          WHERE owner_agent_id = ?
          ORDER BY created_at ASC, mailbox_entry_id ASC
        `,
      )
      .all(normalizedOwnerAgentId) as AgentMailboxEntryRow[];

    return rows.map(mapAgentMailboxEntryRow);
  }

  saveAgentMailboxEntry(record: StoredAgentMailboxEntryRecord): void {
    const mailboxEntryId = record.mailboxEntryId.trim();
    const organizationId = record.organizationId.trim();
    const ownerAgentId = record.ownerAgentId.trim();
    const messageId = record.messageId.trim();
    const workItemId = normalizeText(record.workItemId);
    const priority = normalizeText(record.priority);
    const status = normalizeText(record.status);
    const availableAt = record.availableAt.trim();
    const leaseToken = normalizeText(record.leaseToken);
    const leasedAt = normalizeText(record.leasedAt);
    const ackedAt = normalizeText(record.ackedAt);

    if (
      !mailboxEntryId ||
      !organizationId ||
      !ownerAgentId ||
      !messageId ||
      !priority ||
      !MANAGED_AGENT_PRIORITIES.includes(priority as ManagedAgentPriority) ||
      !status ||
      !AGENT_MAILBOX_STATUSES.includes(status as AgentMailboxStatus) ||
      !availableAt
    ) {
      throw new Error("Agent mailbox entry record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT organization_id, owner_agent_id
          FROM themis_agent_mailboxes
          WHERE mailbox_entry_id = ?
        `,
      )
      .get(mailboxEntryId) as { organization_id: string; owner_agent_id: string } | undefined;

    if (existing && (existing.organization_id !== organizationId || existing.owner_agent_id !== ownerAgentId)) {
      throw new Error("Agent mailbox entry belongs to another organization or owner agent.");
    }

    const writeResult = this.db
      .prepare(
        `
          INSERT INTO themis_agent_mailboxes (
            mailbox_entry_id,
            organization_id,
            owner_agent_id,
            message_id,
            work_item_id,
            priority,
            status,
            requires_ack,
            available_at,
            lease_token,
            leased_at,
            acked_at,
            created_at,
            updated_at
          ) VALUES (
            @mailbox_entry_id,
            @organization_id,
            @owner_agent_id,
            @message_id,
            @work_item_id,
            @priority,
            @status,
            @requires_ack,
            @available_at,
            @lease_token,
            @leased_at,
            @acked_at,
            @created_at,
            @updated_at
          )
          ON CONFLICT(mailbox_entry_id) DO UPDATE SET
            priority = excluded.priority,
            status = excluded.status,
            requires_ack = excluded.requires_ack,
            available_at = excluded.available_at,
            lease_token = excluded.lease_token,
            leased_at = excluded.leased_at,
            acked_at = excluded.acked_at,
            updated_at = excluded.updated_at
          WHERE themis_agent_mailboxes.organization_id = excluded.organization_id
            AND themis_agent_mailboxes.owner_agent_id = excluded.owner_agent_id
        `,
      )
      .run({
        mailbox_entry_id: mailboxEntryId,
        organization_id: organizationId,
        owner_agent_id: ownerAgentId,
        message_id: messageId,
        work_item_id: workItemId ?? null,
        priority,
        status,
        requires_ack: record.requiresAck ? 1 : 0,
        available_at: availableAt,
        lease_token: leaseToken ?? null,
        leased_at: leasedAt ?? null,
        acked_at: ackedAt ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (writeResult.changes === 0) {
      throw new Error("Agent mailbox entry write did not apply.");
    }
  }

  getPrincipalActor(principalId: string, actorId: string): StoredPrincipalActorRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedActorId = actorId.trim();

    if (!normalizedPrincipalId || !normalizedActorId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            actor_id,
            owner_principal_id,
            display_name,
            role,
            status,
            created_at,
            updated_at
          FROM themis_principal_actors
          WHERE owner_principal_id = ?
            AND actor_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedActorId) as PrincipalActorRow | undefined;

    return row ? mapPrincipalActorRow(row) : null;
  }

  listPrincipalActors(principalId: string): StoredPrincipalActorRecord[] {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            actor_id,
            owner_principal_id,
            display_name,
            role,
            status,
            created_at,
            updated_at
          FROM themis_principal_actors
          WHERE owner_principal_id = ?
          ORDER BY updated_at DESC, actor_id ASC
        `,
      )
      .all(normalizedPrincipalId) as PrincipalActorRow[];

    return rows.map(mapPrincipalActorRow);
  }

  savePrincipalActor(record: StoredPrincipalActorRecord): void {
    const actorId = record.actorId.trim();
    const ownerPrincipalId = record.ownerPrincipalId.trim();
    const displayName = record.displayName.trim();
    const role = record.role.trim();
    const status = normalizeText(record.status);

    if (
      !actorId ||
      !ownerPrincipalId ||
      !displayName ||
      !role ||
      !status ||
      !PRINCIPAL_ACTOR_STATUSES.includes(status as PrincipalActorStatus)
    ) {
      throw new Error("Principal actor record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT owner_principal_id
          FROM themis_principal_actors
          WHERE actor_id = ?
        `,
      )
      .get(actorId) as { owner_principal_id: string } | undefined;

    if (existing && existing.owner_principal_id !== ownerPrincipalId) {
      throw new Error("Principal actor belongs to another principal.");
    }

    const actorWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_actors (
            actor_id,
            owner_principal_id,
            display_name,
            role,
            status,
            created_at,
            updated_at
          ) VALUES (
            @actor_id,
            @owner_principal_id,
            @display_name,
            @role,
            @status,
            @created_at,
            @updated_at
          )
          ON CONFLICT(actor_id) DO UPDATE SET
            display_name = excluded.display_name,
            role = excluded.role,
            status = excluded.status,
            updated_at = excluded.updated_at
          WHERE themis_principal_actors.owner_principal_id = excluded.owner_principal_id
        `,
      )
      .run({
        actor_id: actorId,
        owner_principal_id: ownerPrincipalId,
        display_name: displayName,
        role,
        status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (actorWriteResult.changes === 0) {
      throw new Error("Principal actor write did not apply.");
    }
  }

  getPrincipalAsset(principalId: string, assetId: string): StoredPrincipalAssetRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedAssetId = assetId.trim();

    if (!normalizedPrincipalId || !normalizedAssetId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            asset_id,
            principal_id,
            kind,
            name,
            status,
            owner_principal_id,
            summary,
            tags_json,
            refs_json,
            created_at,
            updated_at
          FROM themis_principal_assets
          WHERE principal_id = ?
            AND asset_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedAssetId) as PrincipalAssetRow | undefined;

    return row ? mapPrincipalAssetRow(row) : null;
  }

  listPrincipalAssets(filters: {
    principalId: string;
    status?: StoredPrincipalAssetRecord["status"];
    kind?: StoredPrincipalAssetRecord["kind"];
    query?: string;
    includeArchived?: boolean;
    limit?: number;
  }): StoredPrincipalAssetRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedStatus = normalizeText(filters.status);
    const normalizedKind = normalizeText(filters.kind);
    const normalizedQuery = normalizeText(filters.query);
    const includeArchived = filters.includeArchived === true;
    const normalizedLimit = normalizeLimit(filters.limit, 50);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        asset_id,
        principal_id,
        kind,
        name,
        status,
        owner_principal_id,
        summary,
        tags_json,
        refs_json,
        created_at,
        updated_at
      FROM themis_principal_assets
      WHERE principal_id = ?
    `;

    if (!includeArchived) {
      sql += ` AND status <> 'archived'`;
    }

    if (
      normalizedStatus
      && PRINCIPAL_ASSET_STATUSES.includes(normalizedStatus as StoredPrincipalAssetRecord["status"])
    ) {
      sql += ` AND status = ?`;
      parameters.push(normalizedStatus);
    }

    if (
      normalizedKind
      && PRINCIPAL_ASSET_KINDS.includes(normalizedKind as StoredPrincipalAssetRecord["kind"])
    ) {
      sql += ` AND kind = ?`;
      parameters.push(normalizedKind);
    }

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          asset_id LIKE ?
          OR name LIKE ?
          OR COALESCE(summary, '') LIKE ?
          OR COALESCE(owner_principal_id, '') LIKE ?
          OR tags_json LIKE ?
          OR refs_json LIKE ?
        )
      `;
      parameters.push(
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
      );
    }

    sql += `
      ORDER BY updated_at DESC, asset_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as PrincipalAssetRow[];

    return rows.map(mapPrincipalAssetRow);
  }

  savePrincipalAsset(record: StoredPrincipalAssetRecord): void {
    const assetId = record.assetId.trim();
    const principalId = record.principalId.trim();
    const kind = normalizeText(record.kind);
    const name = normalizeText(record.name);
    const status = normalizeText(record.status);
    const ownerPrincipalId = normalizeText(record.ownerPrincipalId);
    const summary = normalizeText(record.summary);
    const tags = normalizePrincipalAssetTags(record.tags);
    const refs = normalizePrincipalAssetRefs(record.refs);

    if (
      !assetId
      || !principalId
      || !kind
      || !PRINCIPAL_ASSET_KINDS.includes(kind as StoredPrincipalAssetRecord["kind"])
      || !name
      || !status
      || !PRINCIPAL_ASSET_STATUSES.includes(status as StoredPrincipalAssetRecord["status"])
    ) {
      throw new Error("Principal asset record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_principal_assets
          WHERE asset_id = ?
        `,
      )
      .get(assetId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Principal asset belongs to another principal.");
    }

    const assetWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_assets (
            asset_id,
            principal_id,
            kind,
            name,
            status,
            owner_principal_id,
            summary,
            tags_json,
            refs_json,
            created_at,
            updated_at
          ) VALUES (
            @asset_id,
            @principal_id,
            @kind,
            @name,
            @status,
            @owner_principal_id,
            @summary,
            @tags_json,
            @refs_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(asset_id) DO UPDATE SET
            kind = excluded.kind,
            name = excluded.name,
            status = excluded.status,
            owner_principal_id = excluded.owner_principal_id,
            summary = excluded.summary,
            tags_json = excluded.tags_json,
            refs_json = excluded.refs_json,
            updated_at = excluded.updated_at
          WHERE themis_principal_assets.principal_id = excluded.principal_id
        `,
      )
      .run({
        asset_id: assetId,
        principal_id: principalId,
        kind,
        name,
        status,
        owner_principal_id: ownerPrincipalId ?? null,
        summary: summary ?? null,
        tags_json: JSON.stringify(tags),
        refs_json: JSON.stringify(refs),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (assetWriteResult.changes === 0) {
      throw new Error("Principal asset write did not apply.");
    }
  }

  getPrincipalDecision(principalId: string, decisionId: string): StoredPrincipalDecisionRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedDecisionId = decisionId.trim();

    if (!normalizedPrincipalId || !normalizedDecisionId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            decision_id,
            principal_id,
            title,
            status,
            summary,
            decided_by_principal_id,
            decided_at,
            related_asset_ids_json,
            related_work_item_ids_json,
            created_at,
            updated_at
          FROM themis_principal_decisions
          WHERE principal_id = ?
            AND decision_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedDecisionId) as PrincipalDecisionRow | undefined;

    return row ? mapPrincipalDecisionRow(row) : null;
  }

  listPrincipalDecisions(filters: {
    principalId: string;
    status?: StoredPrincipalDecisionRecord["status"];
    query?: string;
    includeArchived?: boolean;
    limit?: number;
  }): StoredPrincipalDecisionRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedStatus = normalizeText(filters.status);
    const normalizedQuery = normalizeText(filters.query);
    const includeArchived = filters.includeArchived === true;
    const normalizedLimit = normalizeLimit(filters.limit, 50);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        decision_id,
        principal_id,
        title,
        status,
        summary,
        decided_by_principal_id,
        decided_at,
        related_asset_ids_json,
        related_work_item_ids_json,
        created_at,
        updated_at
      FROM themis_principal_decisions
      WHERE principal_id = ?
    `;

    if (!includeArchived) {
      sql += ` AND status <> 'archived'`;
    }

    if (
      normalizedStatus
      && PRINCIPAL_DECISION_STATUSES.includes(normalizedStatus as StoredPrincipalDecisionRecord["status"])
    ) {
      sql += ` AND status = ?`;
      parameters.push(normalizedStatus);
    }

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          decision_id LIKE ?
          OR title LIKE ?
          OR COALESCE(summary, '') LIKE ?
          OR COALESCE(decided_by_principal_id, '') LIKE ?
          OR related_asset_ids_json LIKE ?
          OR related_work_item_ids_json LIKE ?
        )
      `;
      parameters.push(
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
      );
    }

    sql += `
      ORDER BY decided_at DESC, updated_at DESC, decision_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as PrincipalDecisionRow[];

    return rows.map(mapPrincipalDecisionRow);
  }

  savePrincipalDecision(record: StoredPrincipalDecisionRecord): void {
    const decisionId = record.decisionId.trim();
    const principalId = record.principalId.trim();
    const title = normalizeText(record.title);
    const status = normalizeText(record.status);
    const summary = normalizeText(record.summary);
    const decidedByPrincipalId = normalizeText(record.decidedByPrincipalId);
    const decidedAt = normalizeText(record.decidedAt);
    const relatedAssetIds = normalizePrincipalDecisionRelatedIds(record.relatedAssetIds);
    const relatedWorkItemIds = normalizePrincipalDecisionRelatedIds(record.relatedWorkItemIds);

    if (
      !decisionId
      || !principalId
      || !title
      || !status
      || !PRINCIPAL_DECISION_STATUSES.includes(status as StoredPrincipalDecisionRecord["status"])
      || !decidedAt
    ) {
      throw new Error("Principal decision record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_principal_decisions
          WHERE decision_id = ?
        `,
      )
      .get(decisionId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Principal decision belongs to another principal.");
    }

    const decisionWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_decisions (
            decision_id,
            principal_id,
            title,
            status,
            summary,
            decided_by_principal_id,
            decided_at,
            related_asset_ids_json,
            related_work_item_ids_json,
            created_at,
            updated_at
          ) VALUES (
            @decision_id,
            @principal_id,
            @title,
            @status,
            @summary,
            @decided_by_principal_id,
            @decided_at,
            @related_asset_ids_json,
            @related_work_item_ids_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(decision_id) DO UPDATE SET
            title = excluded.title,
            status = excluded.status,
            summary = excluded.summary,
            decided_by_principal_id = excluded.decided_by_principal_id,
            decided_at = excluded.decided_at,
            related_asset_ids_json = excluded.related_asset_ids_json,
            related_work_item_ids_json = excluded.related_work_item_ids_json,
            updated_at = excluded.updated_at
          WHERE themis_principal_decisions.principal_id = excluded.principal_id
        `,
      )
      .run({
        decision_id: decisionId,
        principal_id: principalId,
        title,
        status,
        summary: summary ?? null,
        decided_by_principal_id: decidedByPrincipalId ?? null,
        decided_at: decidedAt,
        related_asset_ids_json: JSON.stringify(relatedAssetIds),
        related_work_item_ids_json: JSON.stringify(relatedWorkItemIds),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (decisionWriteResult.changes === 0) {
      throw new Error("Principal decision write did not apply.");
    }
  }

  getPrincipalRisk(principalId: string, riskId: string): StoredPrincipalRiskRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedRiskId = riskId.trim();

    if (!normalizedPrincipalId || !normalizedRiskId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            risk_id,
            principal_id,
            type,
            title,
            severity,
            status,
            owner_principal_id,
            summary,
            detected_at,
            related_asset_ids_json,
            linked_decision_ids_json,
            related_work_item_ids_json,
            created_at,
            updated_at
          FROM themis_principal_risks
          WHERE principal_id = ?
            AND risk_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedRiskId) as PrincipalRiskRow | undefined;

    return row ? mapPrincipalRiskRow(row) : null;
  }

  listPrincipalRisks(filters: {
    principalId: string;
    status?: StoredPrincipalRiskRecord["status"];
    type?: StoredPrincipalRiskRecord["type"];
    severity?: StoredPrincipalRiskRecord["severity"];
    query?: string;
    includeArchived?: boolean;
    limit?: number;
  }): StoredPrincipalRiskRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedStatus = normalizeText(filters.status);
    const normalizedType = normalizeText(filters.type);
    const normalizedSeverity = normalizeText(filters.severity);
    const normalizedQuery = normalizeText(filters.query);
    const includeArchived = filters.includeArchived === true;
    const normalizedLimit = normalizeLimit(filters.limit, 50);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        risk_id,
        principal_id,
        type,
        title,
        severity,
        status,
        owner_principal_id,
        summary,
        detected_at,
        related_asset_ids_json,
        linked_decision_ids_json,
        related_work_item_ids_json,
        created_at,
        updated_at
      FROM themis_principal_risks
      WHERE principal_id = ?
    `;

    if (!includeArchived) {
      sql += ` AND status <> 'archived'`;
    }

    if (
      normalizedStatus
      && PRINCIPAL_RISK_STATUSES.includes(normalizedStatus as StoredPrincipalRiskRecord["status"])
    ) {
      sql += ` AND status = ?`;
      parameters.push(normalizedStatus);
    }

    if (
      normalizedType
      && PRINCIPAL_RISK_TYPES.includes(normalizedType as StoredPrincipalRiskRecord["type"])
    ) {
      sql += ` AND type = ?`;
      parameters.push(normalizedType);
    }

    if (
      normalizedSeverity
      && PRINCIPAL_RISK_SEVERITIES.includes(normalizedSeverity as StoredPrincipalRiskRecord["severity"])
    ) {
      sql += ` AND severity = ?`;
      parameters.push(normalizedSeverity);
    }

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          risk_id LIKE ?
          OR title LIKE ?
          OR COALESCE(summary, '') LIKE ?
          OR COALESCE(owner_principal_id, '') LIKE ?
          OR related_asset_ids_json LIKE ?
          OR linked_decision_ids_json LIKE ?
          OR related_work_item_ids_json LIKE ?
        )
      `;
      parameters.push(
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
      );
    }

    sql += `
      ORDER BY detected_at DESC, updated_at DESC, risk_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as PrincipalRiskRow[];

    return rows.map(mapPrincipalRiskRow);
  }

  savePrincipalRisk(record: StoredPrincipalRiskRecord): void {
    const riskId = record.riskId.trim();
    const principalId = record.principalId.trim();
    const type = normalizeText(record.type);
    const title = normalizeText(record.title);
    const severity = normalizeText(record.severity);
    const status = normalizeText(record.status);
    const ownerPrincipalId = normalizeText(record.ownerPrincipalId);
    const summary = normalizeText(record.summary);
    const detectedAt = normalizeText(record.detectedAt);
    const relatedAssetIds = normalizePrincipalRiskRelatedIds(record.relatedAssetIds);
    const linkedDecisionIds = normalizePrincipalRiskRelatedIds(record.linkedDecisionIds);
    const relatedWorkItemIds = normalizePrincipalRiskRelatedIds(record.relatedWorkItemIds);

    if (
      !riskId
      || !principalId
      || !type
      || !PRINCIPAL_RISK_TYPES.includes(type as StoredPrincipalRiskRecord["type"])
      || !title
      || !severity
      || !PRINCIPAL_RISK_SEVERITIES.includes(severity as StoredPrincipalRiskRecord["severity"])
      || !status
      || !PRINCIPAL_RISK_STATUSES.includes(status as StoredPrincipalRiskRecord["status"])
      || !detectedAt
    ) {
      throw new Error("Principal risk record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_principal_risks
          WHERE risk_id = ?
        `,
      )
      .get(riskId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Principal risk belongs to another principal.");
    }

    const riskWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_risks (
            risk_id,
            principal_id,
            type,
            title,
            severity,
            status,
            owner_principal_id,
            summary,
            detected_at,
            related_asset_ids_json,
            linked_decision_ids_json,
            related_work_item_ids_json,
            created_at,
            updated_at
          ) VALUES (
            @risk_id,
            @principal_id,
            @type,
            @title,
            @severity,
            @status,
            @owner_principal_id,
            @summary,
            @detected_at,
            @related_asset_ids_json,
            @linked_decision_ids_json,
            @related_work_item_ids_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(risk_id) DO UPDATE SET
            type = excluded.type,
            title = excluded.title,
            severity = excluded.severity,
            status = excluded.status,
            owner_principal_id = excluded.owner_principal_id,
            summary = excluded.summary,
            detected_at = excluded.detected_at,
            related_asset_ids_json = excluded.related_asset_ids_json,
            linked_decision_ids_json = excluded.linked_decision_ids_json,
            related_work_item_ids_json = excluded.related_work_item_ids_json,
            updated_at = excluded.updated_at
          WHERE themis_principal_risks.principal_id = excluded.principal_id
        `,
      )
      .run({
        risk_id: riskId,
        principal_id: principalId,
        type,
        title,
        severity,
        status,
        owner_principal_id: ownerPrincipalId ?? null,
        summary: summary ?? null,
        detected_at: detectedAt,
        related_asset_ids_json: JSON.stringify(relatedAssetIds),
        linked_decision_ids_json: JSON.stringify(linkedDecisionIds),
        related_work_item_ids_json: JSON.stringify(relatedWorkItemIds),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (riskWriteResult.changes === 0) {
      throw new Error("Principal risk write did not apply.");
    }
  }

  getPrincipalCadence(principalId: string, cadenceId: string): StoredPrincipalCadenceRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedCadenceId = cadenceId.trim();

    if (!normalizedPrincipalId || !normalizedCadenceId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            cadence_id,
            principal_id,
            title,
            frequency,
            status,
            next_run_at,
            owner_principal_id,
            playbook_ref,
            summary,
            related_asset_ids_json,
            created_at,
            updated_at
          FROM themis_principal_cadences
          WHERE principal_id = ?
            AND cadence_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedCadenceId) as PrincipalCadenceRow | undefined;

    return row ? mapPrincipalCadenceRow(row) : null;
  }

  listPrincipalCadences(filters: {
    principalId: string;
    status?: StoredPrincipalCadenceRecord["status"];
    frequency?: StoredPrincipalCadenceRecord["frequency"];
    query?: string;
    includeArchived?: boolean;
    limit?: number;
  }): StoredPrincipalCadenceRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedStatus = normalizeText(filters.status);
    const normalizedFrequency = normalizeText(filters.frequency);
    const normalizedQuery = normalizeText(filters.query);
    const includeArchived = filters.includeArchived === true;
    const normalizedLimit = normalizeLimit(filters.limit, 50);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        cadence_id,
        principal_id,
        title,
        frequency,
        status,
        next_run_at,
        owner_principal_id,
        playbook_ref,
        summary,
        related_asset_ids_json,
        created_at,
        updated_at
      FROM themis_principal_cadences
      WHERE principal_id = ?
    `;

    if (!includeArchived) {
      sql += ` AND status <> 'archived'`;
    }

    if (
      normalizedStatus
      && PRINCIPAL_CADENCE_STATUSES.includes(normalizedStatus as StoredPrincipalCadenceRecord["status"])
    ) {
      sql += ` AND status = ?`;
      parameters.push(normalizedStatus);
    }

    if (
      normalizedFrequency
      && PRINCIPAL_CADENCE_FREQUENCIES.includes(normalizedFrequency as StoredPrincipalCadenceRecord["frequency"])
    ) {
      sql += ` AND frequency = ?`;
      parameters.push(normalizedFrequency);
    }

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          cadence_id LIKE ?
          OR title LIKE ?
          OR frequency LIKE ?
          OR COALESCE(owner_principal_id, '') LIKE ?
          OR COALESCE(playbook_ref, '') LIKE ?
          OR COALESCE(summary, '') LIKE ?
          OR related_asset_ids_json LIKE ?
        )
      `;
      parameters.push(
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
      );
    }

    sql += `
      ORDER BY next_run_at ASC, updated_at DESC, cadence_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as PrincipalCadenceRow[];

    return rows.map(mapPrincipalCadenceRow);
  }

  savePrincipalCadence(record: StoredPrincipalCadenceRecord): void {
    const cadenceId = record.cadenceId.trim();
    const principalId = record.principalId.trim();
    const title = normalizeText(record.title);
    const frequency = normalizeText(record.frequency);
    const status = normalizeText(record.status);
    const nextRunAt = normalizeText(record.nextRunAt);
    const ownerPrincipalId = normalizeText(record.ownerPrincipalId);
    const playbookRef = normalizeText(record.playbookRef);
    const summary = normalizeText(record.summary);
    const relatedAssetIds = normalizePrincipalCadenceRelatedIds(record.relatedAssetIds);

    if (
      !cadenceId
      || !principalId
      || !title
      || !frequency
      || !PRINCIPAL_CADENCE_FREQUENCIES.includes(frequency as StoredPrincipalCadenceRecord["frequency"])
      || !status
      || !PRINCIPAL_CADENCE_STATUSES.includes(status as StoredPrincipalCadenceRecord["status"])
      || !nextRunAt
    ) {
      throw new Error("Principal cadence record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_principal_cadences
          WHERE cadence_id = ?
        `,
      )
      .get(cadenceId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Principal cadence belongs to another principal.");
    }

    const cadenceWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_cadences (
            cadence_id,
            principal_id,
            title,
            frequency,
            status,
            next_run_at,
            owner_principal_id,
            playbook_ref,
            summary,
            related_asset_ids_json,
            created_at,
            updated_at
          ) VALUES (
            @cadence_id,
            @principal_id,
            @title,
            @frequency,
            @status,
            @next_run_at,
            @owner_principal_id,
            @playbook_ref,
            @summary,
            @related_asset_ids_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(cadence_id) DO UPDATE SET
            title = excluded.title,
            frequency = excluded.frequency,
            status = excluded.status,
            next_run_at = excluded.next_run_at,
            owner_principal_id = excluded.owner_principal_id,
            playbook_ref = excluded.playbook_ref,
            summary = excluded.summary,
            related_asset_ids_json = excluded.related_asset_ids_json,
            updated_at = excluded.updated_at
          WHERE themis_principal_cadences.principal_id = excluded.principal_id
        `,
      )
      .run({
        cadence_id: cadenceId,
        principal_id: principalId,
        title,
        frequency,
        status,
        next_run_at: nextRunAt,
        owner_principal_id: ownerPrincipalId ?? null,
        playbook_ref: playbookRef ?? null,
        summary: summary ?? null,
        related_asset_ids_json: JSON.stringify(relatedAssetIds),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (cadenceWriteResult.changes === 0) {
      throw new Error("Principal cadence write did not apply.");
    }
  }

  getPrincipalCommitment(principalId: string, commitmentId: string): StoredPrincipalCommitmentRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedCommitmentId = commitmentId.trim();

    if (!normalizedPrincipalId || !normalizedCommitmentId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            commitment_id,
            principal_id,
            title,
            status,
            owner_principal_id,
            starts_at,
            due_at,
            progress_percent,
            summary,
            milestones_json,
            evidence_refs_json,
            related_asset_ids_json,
            linked_decision_ids_json,
            linked_risk_ids_json,
            related_cadence_ids_json,
            related_work_item_ids_json,
            created_at,
            updated_at
          FROM themis_principal_commitments
          WHERE principal_id = ?
            AND commitment_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedCommitmentId) as PrincipalCommitmentRow | undefined;

    return row ? mapPrincipalCommitmentRow(row) : null;
  }

  listPrincipalCommitments(filters: {
    principalId: string;
    status?: StoredPrincipalCommitmentRecord["status"];
    query?: string;
    includeArchived?: boolean;
    limit?: number;
  }): StoredPrincipalCommitmentRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedStatus = normalizeText(filters.status);
    const normalizedQuery = normalizeText(filters.query);
    const includeArchived = filters.includeArchived === true;
    const normalizedLimit = normalizeLimit(filters.limit, 50);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        commitment_id,
        principal_id,
        title,
        status,
        owner_principal_id,
        starts_at,
        due_at,
        progress_percent,
        summary,
        milestones_json,
        evidence_refs_json,
        related_asset_ids_json,
        linked_decision_ids_json,
        linked_risk_ids_json,
        related_cadence_ids_json,
        related_work_item_ids_json,
        created_at,
        updated_at
      FROM themis_principal_commitments
      WHERE principal_id = ?
    `;

    if (!includeArchived) {
      sql += ` AND status <> 'archived'`;
    }

    if (
      normalizedStatus
      && PRINCIPAL_COMMITMENT_STATUSES.includes(normalizedStatus as StoredPrincipalCommitmentRecord["status"])
    ) {
      sql += ` AND status = ?`;
      parameters.push(normalizedStatus);
    }

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          commitment_id LIKE ?
          OR title LIKE ?
          OR status LIKE ?
          OR COALESCE(owner_principal_id, '') LIKE ?
          OR COALESCE(summary, '') LIKE ?
          OR milestones_json LIKE ?
          OR evidence_refs_json LIKE ?
          OR related_asset_ids_json LIKE ?
          OR linked_decision_ids_json LIKE ?
          OR linked_risk_ids_json LIKE ?
          OR related_cadence_ids_json LIKE ?
          OR related_work_item_ids_json LIKE ?
        )
      `;
      parameters.push(
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
      );
    }

    sql += `
      ORDER BY due_at ASC, updated_at DESC, commitment_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as PrincipalCommitmentRow[];

    return rows.map(mapPrincipalCommitmentRow);
  }

  savePrincipalCommitment(record: StoredPrincipalCommitmentRecord): void {
    const commitmentId = record.commitmentId.trim();
    const principalId = record.principalId.trim();
    const title = normalizeText(record.title);
    const status = normalizeText(record.status);
    const ownerPrincipalId = normalizeText(record.ownerPrincipalId);
    const startsAt = normalizeText(record.startsAt);
    const dueAt = normalizeText(record.dueAt);
    const progressPercent = normalizePrincipalCommitmentProgressPercent(record.progressPercent);
    const summary = normalizeText(record.summary);
    const milestones = normalizePrincipalCommitmentMilestones(record.milestones, { strictStatus: true });
    const evidenceRefs = normalizePrincipalCommitmentEvidenceRefs(record.evidenceRefs);
    const relatedAssetIds = normalizePrincipalCommitmentRelatedIds(record.relatedAssetIds);
    const linkedDecisionIds = normalizePrincipalCommitmentRelatedIds(record.linkedDecisionIds);
    const linkedRiskIds = normalizePrincipalCommitmentRelatedIds(record.linkedRiskIds);
    const relatedCadenceIds = normalizePrincipalCommitmentRelatedIds(record.relatedCadenceIds);
    const relatedWorkItemIds = normalizePrincipalCommitmentRelatedIds(record.relatedWorkItemIds);

    if (
      !commitmentId
      || !principalId
      || !title
      || !status
      || !PRINCIPAL_COMMITMENT_STATUSES.includes(status as StoredPrincipalCommitmentRecord["status"])
      || !dueAt
    ) {
      throw new Error("Principal commitment record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_principal_commitments
          WHERE commitment_id = ?
        `,
      )
      .get(commitmentId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Principal commitment belongs to another principal.");
    }

    const commitmentWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_commitments (
            commitment_id,
            principal_id,
            title,
            status,
            owner_principal_id,
            starts_at,
            due_at,
            progress_percent,
            summary,
            milestones_json,
            evidence_refs_json,
            related_asset_ids_json,
            linked_decision_ids_json,
            linked_risk_ids_json,
            related_cadence_ids_json,
            related_work_item_ids_json,
            created_at,
            updated_at
          ) VALUES (
            @commitment_id,
            @principal_id,
            @title,
            @status,
            @owner_principal_id,
            @starts_at,
            @due_at,
            @progress_percent,
            @summary,
            @milestones_json,
            @evidence_refs_json,
            @related_asset_ids_json,
            @linked_decision_ids_json,
            @linked_risk_ids_json,
            @related_cadence_ids_json,
            @related_work_item_ids_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(commitment_id) DO UPDATE SET
            title = excluded.title,
            status = excluded.status,
            owner_principal_id = excluded.owner_principal_id,
            starts_at = excluded.starts_at,
            due_at = excluded.due_at,
            progress_percent = excluded.progress_percent,
            summary = excluded.summary,
            milestones_json = excluded.milestones_json,
            evidence_refs_json = excluded.evidence_refs_json,
            related_asset_ids_json = excluded.related_asset_ids_json,
            linked_decision_ids_json = excluded.linked_decision_ids_json,
            linked_risk_ids_json = excluded.linked_risk_ids_json,
            related_cadence_ids_json = excluded.related_cadence_ids_json,
            related_work_item_ids_json = excluded.related_work_item_ids_json,
            updated_at = excluded.updated_at
          WHERE themis_principal_commitments.principal_id = excluded.principal_id
        `,
      )
      .run({
        commitment_id: commitmentId,
        principal_id: principalId,
        title,
        status,
        owner_principal_id: ownerPrincipalId ?? null,
        starts_at: startsAt ?? null,
        due_at: dueAt,
        progress_percent: progressPercent,
        summary: summary ?? null,
        milestones_json: JSON.stringify(milestones),
        evidence_refs_json: JSON.stringify(evidenceRefs),
        related_asset_ids_json: JSON.stringify(relatedAssetIds),
        linked_decision_ids_json: JSON.stringify(linkedDecisionIds),
        linked_risk_ids_json: JSON.stringify(linkedRiskIds),
        related_cadence_ids_json: JSON.stringify(relatedCadenceIds),
        related_work_item_ids_json: JSON.stringify(relatedWorkItemIds),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (commitmentWriteResult.changes === 0) {
      throw new Error("Principal commitment write did not apply.");
    }
  }

  getPrincipalOperationEdge(principalId: string, edgeId: string): StoredPrincipalOperationEdgeRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedEdgeId = edgeId.trim();

    if (!normalizedPrincipalId || !normalizedEdgeId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            edge_id,
            principal_id,
            from_object_type,
            from_object_id,
            to_object_type,
            to_object_id,
            relation_type,
            status,
            label,
            summary,
            created_at,
            updated_at
          FROM themis_principal_operation_edges
          WHERE principal_id = ?
            AND edge_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedEdgeId) as PrincipalOperationEdgeRow | undefined;

    return row ? mapPrincipalOperationEdgeRow(row) : null;
  }

  listPrincipalOperationEdges(filters: {
    principalId: string;
    fromObjectType?: StoredPrincipalOperationEdgeRecord["fromObjectType"];
    fromObjectId?: string;
    toObjectType?: StoredPrincipalOperationEdgeRecord["toObjectType"];
    toObjectId?: string;
    relationType?: StoredPrincipalOperationEdgeRecord["relationType"];
    status?: StoredPrincipalOperationEdgeRecord["status"];
    query?: string;
    includeArchived?: boolean;
    limit?: number;
  }): StoredPrincipalOperationEdgeRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedFromObjectType = normalizeText(filters.fromObjectType);
    const normalizedFromObjectId = normalizeText(filters.fromObjectId);
    const normalizedToObjectType = normalizeText(filters.toObjectType);
    const normalizedToObjectId = normalizeText(filters.toObjectId);
    const normalizedRelationType = normalizeText(filters.relationType);
    const normalizedStatus = normalizeText(filters.status);
    const normalizedQuery = normalizeText(filters.query);
    const includeArchived = filters.includeArchived === true;
    const normalizedLimit = normalizeLimit(filters.limit, 50);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        edge_id,
        principal_id,
        from_object_type,
        from_object_id,
        to_object_type,
        to_object_id,
        relation_type,
        status,
        label,
        summary,
        created_at,
        updated_at
      FROM themis_principal_operation_edges
      WHERE principal_id = ?
    `;

    if (!includeArchived) {
      sql += ` AND status <> 'archived'`;
    }

    if (
      normalizedFromObjectType
      && PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES.includes(
        normalizedFromObjectType as StoredPrincipalOperationEdgeRecord["fromObjectType"],
      )
    ) {
      sql += ` AND from_object_type = ?`;
      parameters.push(normalizedFromObjectType);
    }

    if (normalizedFromObjectId) {
      sql += ` AND from_object_id = ?`;
      parameters.push(normalizedFromObjectId);
    }

    if (
      normalizedToObjectType
      && PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES.includes(
        normalizedToObjectType as StoredPrincipalOperationEdgeRecord["toObjectType"],
      )
    ) {
      sql += ` AND to_object_type = ?`;
      parameters.push(normalizedToObjectType);
    }

    if (normalizedToObjectId) {
      sql += ` AND to_object_id = ?`;
      parameters.push(normalizedToObjectId);
    }

    if (
      normalizedRelationType
      && PRINCIPAL_OPERATION_EDGE_RELATION_TYPES.includes(
        normalizedRelationType as StoredPrincipalOperationEdgeRecord["relationType"],
      )
    ) {
      sql += ` AND relation_type = ?`;
      parameters.push(normalizedRelationType);
    }

    if (
      normalizedStatus
      && PRINCIPAL_OPERATION_EDGE_STATUSES.includes(normalizedStatus as StoredPrincipalOperationEdgeRecord["status"])
    ) {
      sql += ` AND status = ?`;
      parameters.push(normalizedStatus);
    }

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          edge_id LIKE ?
          OR from_object_id LIKE ?
          OR to_object_id LIKE ?
          OR relation_type LIKE ?
          OR COALESCE(label, '') LIKE ?
          OR COALESCE(summary, '') LIKE ?
        )
      `;
      parameters.push(
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
      );
    }

    sql += `
      ORDER BY updated_at DESC, edge_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as PrincipalOperationEdgeRow[];

    return rows.map(mapPrincipalOperationEdgeRow);
  }

  savePrincipalOperationEdge(record: StoredPrincipalOperationEdgeRecord): void {
    const edgeId = record.edgeId.trim();
    const principalId = record.principalId.trim();
    const fromObjectType = normalizeText(record.fromObjectType);
    const fromObjectId = normalizeText(record.fromObjectId);
    const toObjectType = normalizeText(record.toObjectType);
    const toObjectId = normalizeText(record.toObjectId);
    const relationType = normalizeText(record.relationType);
    const status = normalizeText(record.status);
    const label = normalizeText(record.label);
    const summary = normalizeText(record.summary);

    if (
      !edgeId
      || !principalId
      || !fromObjectType
      || !PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES.includes(
        fromObjectType as StoredPrincipalOperationEdgeRecord["fromObjectType"],
      )
      || !fromObjectId
      || !toObjectType
      || !PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES.includes(
        toObjectType as StoredPrincipalOperationEdgeRecord["toObjectType"],
      )
      || !toObjectId
      || !relationType
      || !PRINCIPAL_OPERATION_EDGE_RELATION_TYPES.includes(
        relationType as StoredPrincipalOperationEdgeRecord["relationType"],
      )
      || !status
      || !PRINCIPAL_OPERATION_EDGE_STATUSES.includes(status as StoredPrincipalOperationEdgeRecord["status"])
    ) {
      throw new Error("Principal operation edge record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_principal_operation_edges
          WHERE edge_id = ?
        `,
      )
      .get(edgeId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Principal operation edge belongs to another principal.");
    }

    const edgeWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_operation_edges (
            edge_id,
            principal_id,
            from_object_type,
            from_object_id,
            to_object_type,
            to_object_id,
            relation_type,
            status,
            label,
            summary,
            created_at,
            updated_at
          ) VALUES (
            @edge_id,
            @principal_id,
            @from_object_type,
            @from_object_id,
            @to_object_type,
            @to_object_id,
            @relation_type,
            @status,
            @label,
            @summary,
            @created_at,
            @updated_at
          )
          ON CONFLICT(edge_id) DO UPDATE SET
            from_object_type = excluded.from_object_type,
            from_object_id = excluded.from_object_id,
            to_object_type = excluded.to_object_type,
            to_object_id = excluded.to_object_id,
            relation_type = excluded.relation_type,
            status = excluded.status,
            label = excluded.label,
            summary = excluded.summary,
            updated_at = excluded.updated_at
          WHERE themis_principal_operation_edges.principal_id = excluded.principal_id
        `,
      )
      .run({
        edge_id: edgeId,
        principal_id: principalId,
        from_object_type: fromObjectType,
        from_object_id: fromObjectId,
        to_object_type: toObjectType,
        to_object_id: toObjectId,
        relation_type: relationType,
        status,
        label: label ?? null,
        summary: summary ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (edgeWriteResult.changes === 0) {
      throw new Error("Principal operation edge write did not apply.");
    }
  }

  savePrincipalMainMemory(record: StoredPrincipalMainMemoryRecord): void {
    const memoryId = record.memoryId.trim();
    const principalId = record.principalId.trim();
    const kind = normalizeText(record.kind);
    const title = normalizeText(record.title);
    const summary = normalizeText(record.summary);
    const bodyMarkdown = normalizeText(record.bodyMarkdown);
    const sourceType = normalizeText(record.sourceType);
    const status = normalizeText(record.status);

    if (
      !memoryId ||
      !principalId ||
      !kind ||
      !PRINCIPAL_MAIN_MEMORY_KINDS.includes(kind as PrincipalMainMemoryKind) ||
      !title ||
      !summary ||
      !bodyMarkdown ||
      !sourceType ||
      !PRINCIPAL_MAIN_MEMORY_SOURCE_TYPES.includes(sourceType as PrincipalMainMemorySourceType) ||
      !status ||
      !PRINCIPAL_MAIN_MEMORY_STATUSES.includes(status as PrincipalMainMemoryStatus)
    ) {
      throw new Error("Principal main memory record is incomplete.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_principal_main_memory
          WHERE memory_id = ?
        `,
      )
      .get(memoryId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Principal main memory belongs to another principal.");
    }

    const mainMemoryWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_main_memory (
            memory_id,
            principal_id,
            kind,
            title,
            summary,
            body_markdown,
            source_type,
            status,
            created_at,
            updated_at
          ) VALUES (
            @memory_id,
            @principal_id,
            @kind,
            @title,
            @summary,
            @body_markdown,
            @source_type,
            @status,
            @created_at,
            @updated_at
          )
          ON CONFLICT(memory_id) DO UPDATE SET
            kind = excluded.kind,
            title = excluded.title,
            summary = excluded.summary,
            body_markdown = excluded.body_markdown,
            source_type = excluded.source_type,
            status = excluded.status,
            updated_at = excluded.updated_at
          WHERE themis_principal_main_memory.principal_id = excluded.principal_id
        `,
      )
      .run({
        memory_id: memoryId,
        principal_id: principalId,
        kind,
        title,
        summary,
        body_markdown: bodyMarkdown,
        source_type: sourceType,
        status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (mainMemoryWriteResult.changes === 0) {
      throw new Error("Principal main memory write did not apply.");
    }
  }

  savePrincipalMainMemoryCandidate(record: StoredPrincipalMainMemoryCandidateRecord): void {
    const candidateId = record.candidateId.trim();
    const principalId = record.principalId.trim();
    const kind = normalizeText(record.kind);
    const title = normalizeText(record.title);
    const summary = normalizeText(record.summary);
    const rationale = normalizeText(record.rationale);
    const suggestedContent = normalizeText(record.suggestedContent);
    const sourceType = normalizeText(record.sourceType);
    const sourceLabel = normalizeText(record.sourceLabel);
    const sourceTaskId = normalizeText(record.sourceTaskId);
    const sourceConversationId = normalizeText(record.sourceConversationId);
    const status = normalizeText(record.status);
    const approvedMemoryId = normalizeText(record.approvedMemoryId);
    const reviewedAt = normalizeText(record.reviewedAt);
    const archivedAt = normalizeText(record.archivedAt);

    if (
      !candidateId ||
      !principalId ||
      !kind ||
      !PRINCIPAL_MAIN_MEMORY_KINDS.includes(kind as PrincipalMainMemoryKind) ||
      !title ||
      !summary ||
      !rationale ||
      !suggestedContent ||
      !sourceType ||
      !PRINCIPAL_MAIN_MEMORY_SOURCE_TYPES.includes(sourceType as PrincipalMainMemorySourceType) ||
      !sourceLabel ||
      !status ||
      !PRINCIPAL_MAIN_MEMORY_CANDIDATE_STATUSES.includes(status as PrincipalMainMemoryCandidateStatus)
    ) {
      throw new Error("Principal main memory candidate record is incomplete.");
    }

    if (approvedMemoryId && status !== "approved") {
      throw new Error("Principal main memory candidate approved memory requires approved status.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_principal_main_memory_candidates
          WHERE candidate_id = ?
        `,
      )
      .get(candidateId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Principal main memory candidate belongs to another principal.");
    }

    const candidateWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_principal_main_memory_candidates (
            candidate_id,
            principal_id,
            kind,
            title,
            summary,
            rationale,
            suggested_content,
            source_type,
            source_label,
            source_task_id,
            source_conversation_id,
            status,
            approved_memory_id,
            reviewed_at,
            archived_at,
            created_at,
            updated_at
          ) VALUES (
            @candidate_id,
            @principal_id,
            @kind,
            @title,
            @summary,
            @rationale,
            @suggested_content,
            @source_type,
            @source_label,
            @source_task_id,
            @source_conversation_id,
            @status,
            @approved_memory_id,
            @reviewed_at,
            @archived_at,
            @created_at,
            @updated_at
          )
          ON CONFLICT(candidate_id) DO UPDATE SET
            kind = excluded.kind,
            title = excluded.title,
            summary = excluded.summary,
            rationale = excluded.rationale,
            suggested_content = excluded.suggested_content,
            source_type = excluded.source_type,
            source_label = excluded.source_label,
            source_task_id = excluded.source_task_id,
            source_conversation_id = excluded.source_conversation_id,
            status = excluded.status,
            approved_memory_id = excluded.approved_memory_id,
            reviewed_at = excluded.reviewed_at,
            archived_at = excluded.archived_at,
            updated_at = excluded.updated_at
          WHERE themis_principal_main_memory_candidates.principal_id = excluded.principal_id
        `,
      )
      .run({
        candidate_id: candidateId,
        principal_id: principalId,
        kind,
        title,
        summary,
        rationale,
        suggested_content: suggestedContent,
        source_type: sourceType,
        source_label: sourceLabel,
        source_task_id: sourceTaskId ?? null,
        source_conversation_id: sourceConversationId ?? null,
        status,
        approved_memory_id: approvedMemoryId ?? null,
        reviewed_at: reviewedAt ?? null,
        archived_at: archivedAt ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (candidateWriteResult.changes === 0) {
      throw new Error("Principal main memory candidate write did not apply.");
    }
  }

  getPrincipalMainMemoryCandidate(
    principalId: string,
    candidateId: string,
  ): StoredPrincipalMainMemoryCandidateRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedCandidateId = candidateId.trim();

    if (!normalizedPrincipalId || !normalizedCandidateId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            candidate_id,
            principal_id,
            kind,
            title,
            summary,
            rationale,
            suggested_content,
            source_type,
            source_label,
            source_task_id,
            source_conversation_id,
            status,
            approved_memory_id,
            reviewed_at,
            archived_at,
            created_at,
            updated_at
          FROM themis_principal_main_memory_candidates
          WHERE principal_id = ?
            AND candidate_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedCandidateId) as PrincipalMainMemoryCandidateRow | undefined;

    return row ? mapPrincipalMainMemoryCandidateRow(row) : null;
  }

  listPrincipalMainMemoryCandidates(filters: {
    principalId: string;
    status?: PrincipalMainMemoryCandidateStatus;
    includeArchived?: boolean;
    query?: string;
    limit?: number;
  }): StoredPrincipalMainMemoryCandidateRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedStatus = normalizeText(filters.status);
    const normalizedQuery = normalizeText(filters.query);
    const includeArchived = filters.includeArchived === true;
    const normalizedLimit = normalizeLimit(filters.limit);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        candidate_id,
        principal_id,
        kind,
        title,
        summary,
        rationale,
        suggested_content,
        source_type,
        source_label,
        source_task_id,
        source_conversation_id,
        status,
        approved_memory_id,
        reviewed_at,
        archived_at,
        created_at,
        updated_at
      FROM themis_principal_main_memory_candidates
      WHERE principal_id = ?
    `;

    if (!includeArchived) {
      sql += ` AND archived_at IS NULL`;
    }

    if (
      normalizedStatus &&
      PRINCIPAL_MAIN_MEMORY_CANDIDATE_STATUSES.includes(normalizedStatus as PrincipalMainMemoryCandidateStatus)
    ) {
      sql += ` AND status = ?`;
      parameters.push(normalizedStatus);
    }

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          candidate_id LIKE ?
          OR title LIKE ?
          OR summary LIKE ?
          OR rationale LIKE ?
          OR suggested_content LIKE ?
          OR source_label LIKE ?
          OR COALESCE(source_task_id, '') LIKE ?
          OR COALESCE(source_conversation_id, '') LIKE ?
        )
      `;
      parameters.push(
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
        likePattern,
      );
    }

    sql += `
      ORDER BY updated_at DESC, candidate_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as PrincipalMainMemoryCandidateRow[];

    return rows.map(mapPrincipalMainMemoryCandidateRow);
  }

  searchPrincipalMainMemory(
    principalId: string,
    query: string,
    limit = 20,
  ): StoredPrincipalMainMemoryRecord[] {
    const normalizedPrincipalId = principalId.trim();
    const normalizedQuery = query.trim();
    const normalizedLimit = normalizeLimit(limit);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        memory_id,
        principal_id,
        kind,
        title,
        summary,
        body_markdown,
        source_type,
        status,
        created_at,
        updated_at
      FROM themis_principal_main_memory
      WHERE principal_id = ?
    `;

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          title LIKE ?
          OR summary LIKE ?
          OR body_markdown LIKE ?
        )
      `;
      parameters.push(likePattern, likePattern, likePattern);
    }

    sql += `
      ORDER BY updated_at DESC, memory_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as PrincipalMainMemoryRow[];

    return rows.map(mapPrincipalMainMemoryRow);
  }

  listPrincipalMainMemory(principalId: string, limit = 100): StoredPrincipalMainMemoryRecord[] {
    const normalizedPrincipalId = principalId.trim();
    const normalizedLimit = normalizeLimit(limit);

    if (!normalizedPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            memory_id,
            principal_id,
            kind,
            title,
            summary,
            body_markdown,
            source_type,
            status,
            created_at,
            updated_at
          FROM themis_principal_main_memory
          WHERE principal_id = ?
          ORDER BY updated_at DESC, memory_id DESC
          LIMIT ?
        `,
      )
      .all(normalizedPrincipalId, normalizedLimit) as PrincipalMainMemoryRow[];

    return rows.map(mapPrincipalMainMemoryRow);
  }

  getActorTaskScope(principalId: string, scopeId: string): StoredActorTaskScopeRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedScopeId = scopeId.trim();

    if (!normalizedPrincipalId || !normalizedScopeId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            scope_id,
            principal_id,
            actor_id,
            task_id,
            conversation_id,
            goal,
            workspace_path,
            status,
            created_at,
            updated_at
          FROM themis_actor_task_scopes
          WHERE principal_id = ?
            AND scope_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedScopeId) as ActorTaskScopeRow | undefined;

    return row ? mapActorTaskScopeRow(row) : null;
  }

  saveActorTaskScope(record: StoredActorTaskScopeRecord): void {
    const scopeId = record.scopeId.trim();
    const principalId = record.principalId.trim();
    const actorId = record.actorId.trim();
    const taskId = record.taskId.trim();
    const conversationId = normalizeText(record.conversationId);
    const goal = normalizeText(record.goal);
    const workspacePath = normalizeText(record.workspacePath);
    const status = normalizeText(record.status);

    if (
      !scopeId ||
      !principalId ||
      !actorId ||
      !taskId ||
      !goal ||
      !status ||
      !ACTOR_TASK_SCOPE_STATUSES.includes(status as ActorTaskScopeStatus)
    ) {
      throw new Error("Actor task scope record is incomplete.");
    }

    if (!this.getPrincipalActor(principalId, actorId)) {
      throw new Error("Actor task scope actor must belong to the same principal.");
    }

    const existing = this.db
      .prepare(
        `
          SELECT principal_id
          FROM themis_actor_task_scopes
          WHERE scope_id = ?
        `,
      )
      .get(scopeId) as { principal_id: string } | undefined;

    if (existing && existing.principal_id !== principalId) {
      throw new Error("Actor task scope belongs to another principal.");
    }

    const scopeWriteResult = this.db
      .prepare(
        `
          INSERT INTO themis_actor_task_scopes (
            scope_id,
            principal_id,
            actor_id,
            task_id,
            conversation_id,
            goal,
            workspace_path,
            status,
            created_at,
            updated_at
          ) VALUES (
            @scope_id,
            @principal_id,
            @actor_id,
            @task_id,
            @conversation_id,
            @goal,
            @workspace_path,
            @status,
            @created_at,
            @updated_at
          )
          ON CONFLICT(scope_id) DO UPDATE SET
            task_id = excluded.task_id,
            conversation_id = excluded.conversation_id,
            goal = excluded.goal,
            workspace_path = excluded.workspace_path,
            status = excluded.status,
            updated_at = excluded.updated_at
          WHERE themis_actor_task_scopes.principal_id = excluded.principal_id
        `,
      )
      .run({
        scope_id: scopeId,
        principal_id: principalId,
        actor_id: actorId,
        task_id: taskId,
        conversation_id: conversationId ?? null,
        goal,
        workspace_path: workspacePath ?? null,
        status,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    if (scopeWriteResult.changes === 0) {
      throw new Error("Actor task scope write did not apply.");
    }
  }

  appendActorRuntimeMemory(record: StoredActorRuntimeMemoryRecord): void {
    const runtimeMemoryId = record.runtimeMemoryId.trim();
    const principalId = record.principalId.trim();
    const actorId = record.actorId.trim();
    const taskId = record.taskId.trim();
    const scopeId = record.scopeId.trim();
    const conversationId = normalizeText(record.conversationId);
    const kind = normalizeText(record.kind);
    const title = normalizeText(record.title);
    const content = normalizeText(record.content);
    const status = normalizeText(record.status);

    if (
      !runtimeMemoryId ||
      !principalId ||
      !actorId ||
      !taskId ||
      !scopeId ||
      !kind ||
      !ACTOR_RUNTIME_MEMORY_KINDS.includes(kind as ActorRuntimeMemoryKind) ||
      !title ||
      !content ||
      !status ||
      !ACTOR_RUNTIME_MEMORY_STATUSES.includes(status as ActorRuntimeMemoryStatus)
    ) {
      throw new Error("Actor runtime memory record is incomplete.");
    }

    if (!this.getPrincipalActor(principalId, actorId)) {
      throw new Error("Actor runtime memory actor must belong to the same principal.");
    }

    const scope = this.getActorTaskScope(principalId, scopeId);

    if (!scope) {
      throw new Error("Actor runtime memory scope must belong to the same principal.");
    }

    if (scope.actorId !== actorId) {
      throw new Error("Actor runtime memory scope must belong to the same actor.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_actor_runtime_memory (
            runtime_memory_id,
            principal_id,
            actor_id,
            task_id,
            conversation_id,
            scope_id,
            kind,
            title,
            content,
            status,
            created_at
          ) VALUES (
            @runtime_memory_id,
            @principal_id,
            @actor_id,
            @task_id,
            @conversation_id,
            @scope_id,
            @kind,
            @title,
            @content,
            @status,
            @created_at
          )
        `,
      )
      .run({
        runtime_memory_id: runtimeMemoryId,
        principal_id: principalId,
        actor_id: actorId,
        task_id: taskId,
        conversation_id: conversationId ?? null,
        scope_id: scopeId,
        kind,
        title,
        content,
        status,
        created_at: record.createdAt,
      });
  }

  searchActorRuntimeMemory(filters: {
    principalId: string;
    actorId?: string;
    scopeId?: string;
    query?: string;
    limit?: number;
  }): StoredActorRuntimeMemoryRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedActorId = normalizeText(filters.actorId);
    const normalizedScopeId = normalizeText(filters.scopeId);
    const normalizedQuery = normalizeText(filters.query);
    const normalizedLimit = normalizeLimit(filters.limit);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        runtime_memory_id,
        principal_id,
        actor_id,
        task_id,
        conversation_id,
        scope_id,
        kind,
        title,
        content,
        status,
        created_at
      FROM themis_actor_runtime_memory
      WHERE principal_id = ?
    `;

    if (normalizedActorId) {
      sql += ` AND actor_id = ?`;
      parameters.push(normalizedActorId);
    }

    if (normalizedScopeId) {
      sql += ` AND scope_id = ?`;
      parameters.push(normalizedScopeId);
    }

    if (normalizedQuery) {
      const likePattern = `%${normalizedQuery}%`;
      sql += `
        AND (
          title LIKE ?
          OR content LIKE ?
        )
      `;
      parameters.push(likePattern, likePattern);
    }

    sql += `
      ORDER BY created_at DESC, runtime_memory_id DESC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as ActorRuntimeMemoryRow[];

    return rows.map(mapActorRuntimeMemoryRow);
  }

  listActorTaskTimeline(filters: {
    principalId: string;
    actorId?: string;
    scopeId?: string;
    limit?: number;
  }): StoredActorRuntimeMemoryRecord[] {
    const normalizedPrincipalId = filters.principalId.trim();
    const normalizedActorId = normalizeText(filters.actorId);
    const normalizedScopeId = normalizeText(filters.scopeId);
    const normalizedLimit = normalizeLimit(filters.limit);

    if (!normalizedPrincipalId) {
      return [];
    }

    const parameters: Array<string | number> = [normalizedPrincipalId];
    let sql = `
      SELECT
        runtime_memory_id,
        principal_id,
        actor_id,
        task_id,
        conversation_id,
        scope_id,
        kind,
        title,
        content,
        status,
        created_at
      FROM themis_actor_runtime_memory
      WHERE principal_id = ?
    `;

    if (normalizedActorId) {
      sql += ` AND actor_id = ?`;
      parameters.push(normalizedActorId);
    }

    if (normalizedScopeId) {
      sql += ` AND scope_id = ?`;
      parameters.push(normalizedScopeId);
    }

    sql += `
      ORDER BY created_at ASC, runtime_memory_id ASC
      LIMIT ?
    `;
    parameters.push(normalizedLimit);

    const rows = this.db.prepare(sql).all(...parameters) as ActorRuntimeMemoryRow[];

    return rows.map(mapActorRuntimeMemoryRow);
  }

  getPrincipalTaskSettings(principalId: string): StoredPrincipalTaskSettingsRecord | null {
    const normalized = principalId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT principal_id, settings_json, created_at, updated_at
          FROM themis_principal_task_settings
          WHERE principal_id = ?
        `,
      )
      .get(normalized) as PrincipalTaskSettingsRow | undefined;

    return row ? mapPrincipalTaskSettingsRow(row) : null;
  }

  savePrincipalTaskSettings(record: StoredPrincipalTaskSettingsRecord): void {
    const principalId = record.principalId.trim();

    if (!principalId) {
      throw new Error("Principal task settings are missing principal id.");
    }

    const normalizedSettings = normalizePrincipalTaskSettings(record.settings);

    if (isPrincipalTaskSettingsEmpty(normalizedSettings)) {
      this.deletePrincipalTaskSettings(principalId);
      return;
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_task_settings (
            principal_id,
            settings_json,
            created_at,
            updated_at
          ) VALUES (
            @principal_id,
            @settings_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(principal_id) DO UPDATE SET
            settings_json = excluded.settings_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        principal_id: principalId,
        settings_json: JSON.stringify(normalizedSettings),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  deletePrincipalTaskSettings(principalId: string): boolean {
    const normalized = principalId.trim();

    if (!normalized) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_task_settings
          WHERE principal_id = ?
        `,
      )
      .run(normalized);

    return result.changes > 0;
  }

  getPrincipalSkill(principalId: string, skillName: string): StoredPrincipalSkillRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedSkillName = skillName.trim();

    if (!normalizedPrincipalId || !normalizedSkillName) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            principal_id,
            skill_name,
            description,
            source_type,
            source_ref_json,
            managed_path,
            install_status,
            last_error,
            created_at,
            updated_at
          FROM themis_principal_skills
          WHERE principal_id = ?
            AND skill_name = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedSkillName) as PrincipalSkillRow | undefined;

    return row ? mapPrincipalSkillRow(row) : null;
  }

  listPrincipalSkills(principalId: string): StoredPrincipalSkillRecord[] {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            principal_id,
            skill_name,
            description,
            source_type,
            source_ref_json,
            managed_path,
            install_status,
            last_error,
            created_at,
            updated_at
          FROM themis_principal_skills
          WHERE principal_id = ?
          ORDER BY skill_name ASC
        `,
      )
      .all(normalizedPrincipalId) as PrincipalSkillRow[];

    return rows.map(mapPrincipalSkillRow);
  }

  savePrincipalSkill(record: StoredPrincipalSkillRecord): void {
    const normalizedRecord = normalizePrincipalSkillRecordInput(record);
    const sourceType = normalizePrincipalSkillSourceType(normalizedRecord.sourceType);
    const installStatus = normalizePrincipalSkillInstallStatus(normalizedRecord.installStatus);

    if (
      !normalizedRecord.principalId ||
      !normalizedRecord.skillName ||
      !normalizedRecord.description ||
      !sourceType ||
      !normalizedRecord.sourceRefJson ||
      !normalizedRecord.managedPath ||
      !installStatus ||
      !normalizedRecord.createdAt ||
      !normalizedRecord.updatedAt
    ) {
      throw new Error("Principal skill record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_skills (
            principal_id,
            skill_name,
            description,
            source_type,
            source_ref_json,
            managed_path,
            install_status,
            last_error,
            created_at,
            updated_at
          ) VALUES (
            @principal_id,
            @skill_name,
            @description,
            @source_type,
            @source_ref_json,
            @managed_path,
            @install_status,
            @last_error,
            @created_at,
            @updated_at
          )
          ON CONFLICT(principal_id, skill_name) DO UPDATE SET
            description = excluded.description,
            source_type = excluded.source_type,
            source_ref_json = excluded.source_ref_json,
            managed_path = excluded.managed_path,
            install_status = excluded.install_status,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        principal_id: normalizedRecord.principalId,
        skill_name: normalizedRecord.skillName,
        description: normalizedRecord.description,
        source_type: sourceType,
        source_ref_json: normalizedRecord.sourceRefJson,
        managed_path: normalizedRecord.managedPath,
        install_status: installStatus,
        last_error: normalizedRecord.lastError ?? null,
        created_at: normalizedRecord.createdAt,
        updated_at: normalizedRecord.updatedAt,
      });
  }

  deletePrincipalSkill(principalId: string, skillName: string): boolean {
    const normalizedPrincipalId = principalId.trim();
    const normalizedSkillName = skillName.trim();

    if (!normalizedPrincipalId || !normalizedSkillName) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_skills
          WHERE principal_id = ?
            AND skill_name = ?
        `,
      )
      .run(normalizedPrincipalId, normalizedSkillName);

    return result.changes > 0;
  }

  savePrincipalSkillMaterialization(record: StoredPrincipalSkillMaterializationRecord): void {
    const normalizedRecord = normalizePrincipalSkillMaterializationRecordInput(record);
    const state = normalizePrincipalSkillMaterializationState(normalizedRecord.state);

    if (
      !normalizedRecord.principalId ||
      !normalizedRecord.skillName ||
      normalizedRecord.targetKind !== "auth-account" ||
      !normalizedRecord.targetId ||
      !normalizedRecord.targetPath ||
      !state
    ) {
      throw new Error("Principal skill materialization record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_skill_materializations (
            principal_id,
            skill_name,
            target_kind,
            target_id,
            target_path,
            state,
            last_synced_at,
            last_error
          ) VALUES (
            @principal_id,
            @skill_name,
            @target_kind,
            @target_id,
            @target_path,
            @state,
            @last_synced_at,
            @last_error
          )
          ON CONFLICT(principal_id, skill_name, target_kind, target_id) DO UPDATE SET
            target_path = excluded.target_path,
            state = excluded.state,
            last_synced_at = excluded.last_synced_at,
            last_error = excluded.last_error
        `,
      )
      .run({
        principal_id: normalizedRecord.principalId,
        skill_name: normalizedRecord.skillName,
        target_kind: "auth-account",
        target_id: normalizedRecord.targetId,
        target_path: normalizedRecord.targetPath,
        state,
        last_synced_at: normalizedRecord.lastSyncedAt ?? null,
        last_error: normalizedRecord.lastError ?? null,
      });
  }

  listPrincipalSkillMaterializations(
    principalId: string,
    skillName?: string,
  ): StoredPrincipalSkillMaterializationRecord[] {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return [];
    }

    if (typeof skillName === "string" && skillName.trim()) {
      const normalizedSkillName = skillName.trim();
      const rows = this.db
        .prepare(
          `
            SELECT
              principal_id,
              skill_name,
              target_kind,
              target_id,
              target_path,
              state,
              last_synced_at,
              last_error
            FROM themis_principal_skill_materializations
            WHERE principal_id = ?
              AND skill_name = ?
            ORDER BY target_kind ASC, target_id ASC
          `,
        )
        .all(normalizedPrincipalId, normalizedSkillName) as PrincipalSkillMaterializationRow[];

      return rows.map(mapPrincipalSkillMaterializationRow);
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            principal_id,
            skill_name,
            target_kind,
            target_id,
            target_path,
            state,
            last_synced_at,
            last_error
          FROM themis_principal_skill_materializations
          WHERE principal_id = ?
          ORDER BY skill_name ASC, target_kind ASC, target_id ASC
        `,
      )
      .all(normalizedPrincipalId) as PrincipalSkillMaterializationRow[];

    return rows.map(mapPrincipalSkillMaterializationRow);
  }

  deletePrincipalSkillMaterializations(principalId: string, skillName?: string): number {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return 0;
    }

    if (typeof skillName === "string" && skillName.trim()) {
      const normalizedSkillName = skillName.trim();
      const result = this.db
        .prepare(
          `
            DELETE FROM themis_principal_skill_materializations
            WHERE principal_id = ?
              AND skill_name = ?
          `,
        )
        .run(normalizedPrincipalId, normalizedSkillName);

      return result.changes;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_skill_materializations
          WHERE principal_id = ?
        `,
      )
      .run(normalizedPrincipalId);

    return result.changes;
  }

  getPrincipalPlugin(principalId: string, pluginId: string): StoredPrincipalPluginRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedPluginId = pluginId.trim();

    if (!normalizedPrincipalId || !normalizedPluginId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            principal_id,
            plugin_id,
            plugin_name,
            marketplace_name,
            marketplace_path,
            source_type,
            source_ref_json,
            source_path,
            interface_json,
            install_policy,
            auth_policy,
            enabled,
            created_at,
            updated_at,
            last_error
          FROM themis_principal_plugins
          WHERE principal_id = ?
            AND plugin_id = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedPluginId) as PrincipalPluginRow | undefined;

    return row ? mapPrincipalPluginRow(row) : null;
  }

  listPrincipalPlugins(principalId: string): StoredPrincipalPluginRecord[] {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            principal_id,
            plugin_id,
            plugin_name,
            marketplace_name,
            marketplace_path,
            source_type,
            source_ref_json,
            source_path,
            interface_json,
            install_policy,
            auth_policy,
            enabled,
            created_at,
            updated_at,
            last_error
          FROM themis_principal_plugins
          WHERE principal_id = ?
          ORDER BY marketplace_name COLLATE NOCASE ASC, plugin_name COLLATE NOCASE ASC, plugin_id ASC
        `,
      )
      .all(normalizedPrincipalId) as PrincipalPluginRow[];

    return rows.map(mapPrincipalPluginRow);
  }

  savePrincipalPlugin(record: StoredPrincipalPluginRecord): void {
    const normalizedRecord = normalizePrincipalPluginRecordInput(record);
    const sourceType = normalizePrincipalPluginSourceType(normalizedRecord.sourceType);
    const installPolicy = normalizePrincipalPluginInstallPolicy(normalizedRecord.installPolicy);
    const authPolicy = normalizePrincipalPluginAuthPolicy(normalizedRecord.authPolicy);

    if (
      !normalizedRecord.principalId ||
      !normalizedRecord.pluginId ||
      !normalizedRecord.pluginName ||
      !normalizedRecord.marketplaceName ||
      !normalizedRecord.marketplacePath ||
      !sourceType ||
      !normalizedRecord.sourceRefJson ||
      !normalizedRecord.interfaceJson ||
      !installPolicy ||
      !authPolicy ||
      typeof normalizedRecord.enabled !== "boolean" ||
      !normalizedRecord.createdAt ||
      !normalizedRecord.updatedAt
    ) {
      throw new Error("Principal plugin record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_plugins (
            principal_id,
            plugin_id,
            plugin_name,
            marketplace_name,
            marketplace_path,
            source_type,
            source_ref_json,
            source_path,
            interface_json,
            install_policy,
            auth_policy,
            enabled,
            created_at,
            updated_at,
            last_error
          ) VALUES (
            @principal_id,
            @plugin_id,
            @plugin_name,
            @marketplace_name,
            @marketplace_path,
            @source_type,
            @source_ref_json,
            @source_path,
            @interface_json,
            @install_policy,
            @auth_policy,
            @enabled,
            @created_at,
            @updated_at,
            @last_error
          )
          ON CONFLICT(principal_id, plugin_id) DO UPDATE SET
            plugin_name = excluded.plugin_name,
            marketplace_name = excluded.marketplace_name,
            marketplace_path = excluded.marketplace_path,
            source_type = excluded.source_type,
            source_ref_json = excluded.source_ref_json,
            source_path = excluded.source_path,
            interface_json = excluded.interface_json,
            install_policy = excluded.install_policy,
            auth_policy = excluded.auth_policy,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at,
            last_error = excluded.last_error
        `,
      )
      .run({
        principal_id: normalizedRecord.principalId,
        plugin_id: normalizedRecord.pluginId,
        plugin_name: normalizedRecord.pluginName,
        marketplace_name: normalizedRecord.marketplaceName,
        marketplace_path: normalizedRecord.marketplacePath,
        source_type: sourceType,
        source_ref_json: normalizedRecord.sourceRefJson,
        source_path: normalizedRecord.sourcePath ?? null,
        interface_json: normalizedRecord.interfaceJson,
        install_policy: installPolicy,
        auth_policy: authPolicy,
        enabled: normalizedRecord.enabled ? 1 : 0,
        created_at: normalizedRecord.createdAt,
        updated_at: normalizedRecord.updatedAt,
        last_error: normalizedRecord.lastError ?? null,
      });
  }

  deletePrincipalPlugin(principalId: string, pluginId: string): boolean {
    const normalizedPrincipalId = principalId.trim();
    const normalizedPluginId = pluginId.trim();

    if (!normalizedPrincipalId || !normalizedPluginId) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_plugins
          WHERE principal_id = ?
            AND plugin_id = ?
        `,
      )
      .run(normalizedPrincipalId, normalizedPluginId);

    return result.changes > 0;
  }

  savePrincipalPluginMaterialization(record: StoredPrincipalPluginMaterializationRecord): void {
    const normalizedRecord = normalizePrincipalPluginMaterializationRecordInput(record);
    const state = normalizePrincipalPluginMaterializationState(normalizedRecord.state);

    if (
      !normalizedRecord.principalId ||
      !normalizedRecord.pluginId ||
      normalizedRecord.targetKind !== "auth-account" ||
      !normalizedRecord.targetId ||
      !normalizedRecord.workspaceFingerprint ||
      !state
    ) {
      throw new Error("Principal plugin materialization record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_plugin_materializations (
            principal_id,
            plugin_id,
            target_kind,
            target_id,
            workspace_fingerprint,
            state,
            last_synced_at,
            last_error
          ) VALUES (
            @principal_id,
            @plugin_id,
            @target_kind,
            @target_id,
            @workspace_fingerprint,
            @state,
            @last_synced_at,
            @last_error
          )
          ON CONFLICT(principal_id, plugin_id, target_kind, target_id, workspace_fingerprint) DO UPDATE SET
            state = excluded.state,
            last_synced_at = excluded.last_synced_at,
            last_error = excluded.last_error
        `,
      )
      .run({
        principal_id: normalizedRecord.principalId,
        plugin_id: normalizedRecord.pluginId,
        target_kind: "auth-account",
        target_id: normalizedRecord.targetId,
        workspace_fingerprint: normalizedRecord.workspaceFingerprint,
        state,
        last_synced_at: normalizedRecord.lastSyncedAt ?? null,
        last_error: normalizedRecord.lastError ?? null,
      });
  }

  listPrincipalPluginMaterializations(
    principalId: string,
    pluginId?: string,
  ): StoredPrincipalPluginMaterializationRecord[] {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return [];
    }

    if (typeof pluginId === "string" && pluginId.trim()) {
      const normalizedPluginId = pluginId.trim();
      const rows = this.db
        .prepare(
          `
            SELECT
              principal_id,
              plugin_id,
              target_kind,
              target_id,
              workspace_fingerprint,
              state,
              last_synced_at,
              last_error
            FROM themis_principal_plugin_materializations
            WHERE principal_id = ?
              AND plugin_id = ?
            ORDER BY target_kind ASC, target_id ASC, workspace_fingerprint ASC
          `,
        )
        .all(normalizedPrincipalId, normalizedPluginId) as PrincipalPluginMaterializationRow[];

      return rows.map(mapPrincipalPluginMaterializationRow);
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            principal_id,
            plugin_id,
            target_kind,
            target_id,
            workspace_fingerprint,
            state,
            last_synced_at,
            last_error
          FROM themis_principal_plugin_materializations
          WHERE principal_id = ?
          ORDER BY plugin_id ASC, target_kind ASC, target_id ASC, workspace_fingerprint ASC
        `,
      )
      .all(normalizedPrincipalId) as PrincipalPluginMaterializationRow[];

    return rows.map(mapPrincipalPluginMaterializationRow);
  }

  deletePrincipalPluginMaterializations(principalId: string, pluginId?: string): number {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return 0;
    }

    if (typeof pluginId === "string" && pluginId.trim()) {
      const normalizedPluginId = pluginId.trim();
      const result = this.db
        .prepare(
          `
            DELETE FROM themis_principal_plugin_materializations
            WHERE principal_id = ?
              AND plugin_id = ?
          `,
        )
        .run(normalizedPrincipalId, normalizedPluginId);

      return result.changes;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_plugin_materializations
          WHERE principal_id = ?
        `,
      )
      .run(normalizedPrincipalId);

    return result.changes;
  }

  getPrincipalMcpServer(principalId: string, serverName: string): StoredPrincipalMcpServerRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedServerName = serverName.trim();

    if (!normalizedPrincipalId || !normalizedServerName) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            principal_id,
            server_name,
            transport_type,
            command,
            args_json,
            env_json,
            cwd,
            enabled,
            source_type,
            created_at,
            updated_at
          FROM themis_principal_mcp_servers
          WHERE principal_id = ?
            AND server_name = ?
        `,
      )
      .get(normalizedPrincipalId, normalizedServerName) as PrincipalMcpServerRow | undefined;

    return row ? mapPrincipalMcpServerRow(row) : null;
  }

  listPrincipalMcpServers(principalId: string): StoredPrincipalMcpServerRecord[] {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            principal_id,
            server_name,
            transport_type,
            command,
            args_json,
            env_json,
            cwd,
            enabled,
            source_type,
            created_at,
            updated_at
          FROM themis_principal_mcp_servers
          WHERE principal_id = ?
          ORDER BY server_name ASC
        `,
      )
      .all(normalizedPrincipalId) as PrincipalMcpServerRow[];

    return rows.map(mapPrincipalMcpServerRow);
  }

  savePrincipalMcpServer(record: StoredPrincipalMcpServerRecord): void {
    const normalizedRecord = normalizePrincipalMcpServerRecordInput(record);
    const transportType = normalizePrincipalMcpTransportType(normalizedRecord.transportType);
    const sourceType = normalizePrincipalMcpSourceType(normalizedRecord.sourceType);

    if (
      !normalizedRecord.principalId ||
      !normalizedRecord.serverName ||
      !transportType ||
      !normalizedRecord.command ||
      !normalizedRecord.argsJson ||
      !normalizedRecord.envJson ||
      typeof normalizedRecord.enabled !== "boolean" ||
      !sourceType ||
      !normalizedRecord.createdAt ||
      !normalizedRecord.updatedAt
    ) {
      throw new Error("Principal MCP server record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_mcp_servers (
            principal_id,
            server_name,
            transport_type,
            command,
            args_json,
            env_json,
            cwd,
            enabled,
            source_type,
            created_at,
            updated_at
          ) VALUES (
            @principal_id,
            @server_name,
            @transport_type,
            @command,
            @args_json,
            @env_json,
            @cwd,
            @enabled,
            @source_type,
            @created_at,
            @updated_at
          )
          ON CONFLICT(principal_id, server_name) DO UPDATE SET
            transport_type = excluded.transport_type,
            command = excluded.command,
            args_json = excluded.args_json,
            env_json = excluded.env_json,
            cwd = excluded.cwd,
            enabled = excluded.enabled,
            source_type = excluded.source_type,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        principal_id: normalizedRecord.principalId,
        server_name: normalizedRecord.serverName,
        transport_type: transportType,
        command: normalizedRecord.command,
        args_json: normalizedRecord.argsJson,
        env_json: normalizedRecord.envJson,
        cwd: normalizedRecord.cwd ?? null,
        enabled: normalizedRecord.enabled ? 1 : 0,
        source_type: sourceType,
        created_at: normalizedRecord.createdAt,
        updated_at: normalizedRecord.updatedAt,
      });
  }

  deletePrincipalMcpServer(principalId: string, serverName: string): boolean {
    const normalizedPrincipalId = principalId.trim();
    const normalizedServerName = serverName.trim();

    if (!normalizedPrincipalId || !normalizedServerName) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_mcp_servers
          WHERE principal_id = ?
            AND server_name = ?
        `,
      )
      .run(normalizedPrincipalId, normalizedServerName);

    return result.changes > 0;
  }

  savePrincipalMcpMaterialization(record: StoredPrincipalMcpMaterializationRecord): void {
    const normalizedRecord = normalizePrincipalMcpMaterializationRecordInput(record);
    const targetKind = normalizePrincipalMcpMaterializationTargetKind(normalizedRecord.targetKind);
    const state = normalizePrincipalMcpMaterializationState(normalizedRecord.state);
    const authState = normalizePrincipalMcpAuthState(normalizedRecord.authState);

    if (
      !normalizedRecord.principalId ||
      !normalizedRecord.serverName ||
      !targetKind ||
      !normalizedRecord.targetId ||
      !state ||
      !authState
    ) {
      throw new Error("Principal MCP materialization record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_mcp_materializations (
            principal_id,
            server_name,
            target_kind,
            target_id,
            state,
            auth_state,
            last_synced_at,
            last_error
          ) VALUES (
            @principal_id,
            @server_name,
            @target_kind,
            @target_id,
            @state,
            @auth_state,
            @last_synced_at,
            @last_error
          )
          ON CONFLICT(principal_id, server_name, target_kind, target_id) DO UPDATE SET
            state = excluded.state,
            auth_state = excluded.auth_state,
            last_synced_at = excluded.last_synced_at,
            last_error = excluded.last_error
        `,
      )
      .run({
        principal_id: normalizedRecord.principalId,
        server_name: normalizedRecord.serverName,
        target_kind: targetKind,
        target_id: normalizedRecord.targetId,
        state,
        auth_state: authState,
        last_synced_at: normalizedRecord.lastSyncedAt ?? null,
        last_error: normalizedRecord.lastError ?? null,
      });
  }

  listPrincipalMcpMaterializations(
    principalId: string,
    serverName?: string,
  ): StoredPrincipalMcpMaterializationRecord[] {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return [];
    }

    if (typeof serverName === "string" && serverName.trim()) {
      const normalizedServerName = serverName.trim();
      const rows = this.db
        .prepare(
          `
            SELECT
              principal_id,
              server_name,
              target_kind,
              target_id,
              state,
              auth_state,
              last_synced_at,
              last_error
            FROM themis_principal_mcp_materializations
            WHERE principal_id = ?
              AND server_name = ?
            ORDER BY target_kind ASC, target_id ASC
          `,
        )
        .all(normalizedPrincipalId, normalizedServerName) as PrincipalMcpMaterializationRow[];

      return rows.map(mapPrincipalMcpMaterializationRow);
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            principal_id,
            server_name,
            target_kind,
            target_id,
            state,
            auth_state,
            last_synced_at,
            last_error
          FROM themis_principal_mcp_materializations
          WHERE principal_id = ?
          ORDER BY server_name ASC, target_kind ASC, target_id ASC
        `,
      )
      .all(normalizedPrincipalId) as PrincipalMcpMaterializationRow[];

    return rows.map(mapPrincipalMcpMaterializationRow);
  }

  deletePrincipalMcpMaterializations(principalId: string, serverName?: string): number {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return 0;
    }

    if (typeof serverName === "string" && serverName.trim()) {
      const normalizedServerName = serverName.trim();
      const result = this.db
        .prepare(
          `
            DELETE FROM themis_principal_mcp_materializations
            WHERE principal_id = ?
              AND server_name = ?
          `,
        )
        .run(normalizedPrincipalId, normalizedServerName);

      return result.changes;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_mcp_materializations
          WHERE principal_id = ?
        `,
      )
      .run(normalizedPrincipalId);

    return result.changes;
  }

  savePrincipalMcpOauthAttempt(record: StoredPrincipalMcpOauthAttemptRecord): void {
    const normalizedRecord = normalizePrincipalMcpOauthAttemptRecordInput(record);
    const targetKind = normalizePrincipalMcpMaterializationTargetKind(normalizedRecord.targetKind);
    const status = normalizePrincipalMcpOauthAttemptStatus(normalizedRecord.status);

    if (
      !normalizedRecord.attemptId ||
      !normalizedRecord.principalId ||
      !normalizedRecord.serverName ||
      !targetKind ||
      !normalizedRecord.targetId ||
      !status ||
      !normalizedRecord.authorizationUrl ||
      !normalizedRecord.startedAt ||
      !normalizedRecord.updatedAt
    ) {
      throw new Error("Principal MCP OAuth attempt record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_mcp_oauth_attempts (
            attempt_id,
            principal_id,
            server_name,
            target_kind,
            target_id,
            status,
            authorization_url,
            started_at,
            updated_at,
            completed_at,
            last_error
          ) VALUES (
            @attempt_id,
            @principal_id,
            @server_name,
            @target_kind,
            @target_id,
            @status,
            @authorization_url,
            @started_at,
            @updated_at,
            @completed_at,
            @last_error
          )
          ON CONFLICT(attempt_id) DO UPDATE SET
            target_kind = excluded.target_kind,
            target_id = excluded.target_id,
            status = excluded.status,
            authorization_url = excluded.authorization_url,
            updated_at = excluded.updated_at,
            completed_at = excluded.completed_at,
            last_error = excluded.last_error
        `,
      )
      .run({
        attempt_id: normalizedRecord.attemptId,
        principal_id: normalizedRecord.principalId,
        server_name: normalizedRecord.serverName,
        target_kind: targetKind,
        target_id: normalizedRecord.targetId,
        status,
        authorization_url: normalizedRecord.authorizationUrl,
        started_at: normalizedRecord.startedAt,
        updated_at: normalizedRecord.updatedAt,
        completed_at: normalizedRecord.completedAt ?? null,
        last_error: normalizedRecord.lastError ?? null,
      });
  }

  getLatestPrincipalMcpOauthAttempt(
    principalId: string,
    serverName: string,
  ): StoredPrincipalMcpOauthAttemptRecord | null {
    const normalizedPrincipalId = principalId.trim();
    const normalizedServerName = serverName.trim();

    if (!normalizedPrincipalId || !normalizedServerName) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            attempt_id,
            principal_id,
            server_name,
            target_kind,
            target_id,
            status,
            authorization_url,
            started_at,
            updated_at,
            completed_at,
            last_error
          FROM themis_principal_mcp_oauth_attempts
          WHERE principal_id = ?
            AND server_name = ?
          ORDER BY updated_at DESC, started_at DESC, attempt_id DESC
          LIMIT 1
        `,
      )
      .get(normalizedPrincipalId, normalizedServerName) as PrincipalMcpOauthAttemptRow | undefined;

    return row ? mapPrincipalMcpOauthAttemptRow(row) : null;
  }

  getPrincipalMcpOauthAttemptByCallbackBridgeId(
    bridgeId: string,
  ): StoredPrincipalMcpOauthAttemptRecord | null {
    const normalizedBridgeId = bridgeId.trim();

    if (!normalizedBridgeId) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            attempt_id,
            principal_id,
            server_name,
            target_kind,
            target_id,
            status,
            authorization_url,
            started_at,
            updated_at,
            completed_at,
            last_error
          FROM themis_principal_mcp_oauth_attempts
          WHERE instr(authorization_url, ?) > 0
          ORDER BY updated_at DESC, started_at DESC, attempt_id DESC
          LIMIT 1
        `,
      )
      .get(normalizedBridgeId) as PrincipalMcpOauthAttemptRow | undefined;

    return row ? mapPrincipalMcpOauthAttemptRow(row) : null;
  }

  deletePrincipalMcpOauthAttempts(principalId: string, serverName?: string): number {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      return 0;
    }

    if (typeof serverName === "string" && serverName.trim()) {
      const normalizedServerName = serverName.trim();
      const result = this.db
        .prepare(
          `
            DELETE FROM themis_principal_mcp_oauth_attempts
            WHERE principal_id = ?
              AND server_name = ?
          `,
        )
        .run(normalizedPrincipalId, normalizedServerName);

      return result.changes;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_mcp_oauth_attempts
          WHERE principal_id = ?
        `,
      )
      .run(normalizedPrincipalId);

    return result.changes;
  }

  getPrincipalPersonaProfile(principalId: string): StoredPrincipalPersonaProfileRecord | null {
    const normalized = principalId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT principal_id, profile_json, created_at, updated_at, completed_at
          FROM themis_principal_persona_profiles
          WHERE principal_id = ?
        `,
      )
      .get(normalized) as PrincipalPersonaProfileRow | undefined;

    return row ? mapPrincipalPersonaProfileRow(row) : null;
  }

  savePrincipalPersonaProfile(record: StoredPrincipalPersonaProfileRecord): void {
    const principalId = record.principalId.trim();

    if (!principalId) {
      throw new Error("Principal persona profile is missing principal id.");
    }

    const normalizedProfile = normalizePrincipalPersonaProfileData(record.profile);

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_persona_profiles (
            principal_id,
            profile_json,
            created_at,
            updated_at,
            completed_at
          ) VALUES (
            @principal_id,
            @profile_json,
            @created_at,
            @updated_at,
            @completed_at
          )
          ON CONFLICT(principal_id) DO UPDATE SET
            profile_json = excluded.profile_json,
            updated_at = excluded.updated_at,
            completed_at = excluded.completed_at
        `,
      )
      .run({
        principal_id: principalId,
        profile_json: JSON.stringify(normalizedProfile),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        completed_at: record.completedAt,
      });
  }

  getPrincipalPersonaOnboarding(principalId: string): StoredPrincipalPersonaOnboardingRecord | null {
    const normalized = principalId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT principal_id, state_json, created_at, updated_at
          FROM themis_principal_persona_onboarding
          WHERE principal_id = ?
        `,
      )
      .get(normalized) as PrincipalPersonaOnboardingRow | undefined;

    return row ? mapPrincipalPersonaOnboardingRow(row) : null;
  }

  savePrincipalPersonaOnboarding(record: StoredPrincipalPersonaOnboardingRecord): void {
    const principalId = record.principalId.trim();

    if (!principalId) {
      throw new Error("Principal persona onboarding record is missing principal id.");
    }

    const normalizedState = normalizePrincipalPersonaOnboardingState(record.state);

    this.db
      .prepare(
        `
          INSERT INTO themis_principal_persona_onboarding (
            principal_id,
            state_json,
            created_at,
            updated_at
          ) VALUES (
            @principal_id,
            @state_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(principal_id) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        principal_id: principalId,
        state_json: JSON.stringify(normalizedState),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  deletePrincipalPersonaOnboarding(principalId: string): boolean {
    const normalized = principalId.trim();

    if (!normalized) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          DELETE FROM themis_principal_persona_onboarding
          WHERE principal_id = ?
        `,
      )
      .run(normalized);

    return result.changes > 0;
  }

  saveChannelIdentity(record: StoredChannelIdentityRecord): void {
    const channel = record.channel.trim();
    const channelUserId = record.channelUserId.trim();
    const principalId = record.principalId.trim();

    if (!channel || !channelUserId || !principalId) {
      throw new Error("Channel identity record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_channel_identities (
            channel,
            channel_user_id,
            principal_id,
            created_at,
            updated_at
          ) VALUES (
            @channel,
            @channel_user_id,
            @principal_id,
            @created_at,
            @updated_at
          )
          ON CONFLICT(channel, channel_user_id) DO UPDATE SET
            principal_id = excluded.principal_id,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        channel,
        channel_user_id: channelUserId,
        principal_id: principalId,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  getConversation(conversationId: string): StoredConversationRecord | null {
    const normalized = conversationId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT conversation_id, principal_id, title, created_at, updated_at
          FROM themis_conversations
          WHERE conversation_id = ?
        `,
      )
      .get(normalized) as ConversationRow | undefined;

    return row ? mapConversationRow(row) : null;
  }

  hasConversation(conversationId: string): boolean {
    return Boolean(this.getConversation(conversationId));
  }

  saveConversation(record: StoredConversationRecord): void {
    const conversationId = record.conversationId.trim();
    const principalId = record.principalId.trim();

    if (!conversationId || !principalId) {
      throw new Error("Conversation record is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_conversations (
            conversation_id,
            principal_id,
            title,
            created_at,
            updated_at
          ) VALUES (
            @conversation_id,
            @principal_id,
            @title,
            @created_at,
            @updated_at
          )
          ON CONFLICT(conversation_id) DO UPDATE SET
            principal_id = excluded.principal_id,
            title = excluded.title,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        conversation_id: conversationId,
        principal_id: principalId,
        title: record.title.trim(),
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  touchConversation(conversationId: string, updatedAt: string, title?: string): void {
    const normalizedConversationId = conversationId.trim();

    if (!normalizedConversationId) {
      return;
    }

    this.db
      .prepare(
        `
          UPDATE themis_conversations
          SET
            title = CASE
              WHEN @title IS NOT NULL AND @title <> '' THEN @title
              ELSE title
            END,
            updated_at = @updated_at
          WHERE conversation_id = @conversation_id
        `,
      )
      .run({
        conversation_id: normalizedConversationId,
        title: title?.trim() || null,
        updated_at: updatedAt,
      });
  }

  getChannelConversationBinding(
    channel: string,
    principalId: string,
    channelSessionKey: string,
  ): StoredChannelConversationBindingRecord | null {
    const normalizedChannel = channel.trim();
    const normalizedPrincipalId = principalId.trim();
    const normalizedSessionKey = channelSessionKey.trim();

    if (!normalizedChannel || !normalizedPrincipalId || !normalizedSessionKey) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT channel, principal_id, channel_session_key, conversation_id, created_at, updated_at
          FROM themis_channel_bindings
          WHERE channel = ?
            AND principal_id = ?
            AND channel_session_key = ?
        `,
      )
      .get(normalizedChannel, normalizedPrincipalId, normalizedSessionKey) as ChannelConversationBindingRow | undefined;

    return row ? mapChannelConversationBindingRow(row) : null;
  }

  saveChannelConversationBinding(record: StoredChannelConversationBindingRecord): void {
    const channel = record.channel.trim();
    const principalId = record.principalId.trim();
    const channelSessionKey = record.channelSessionKey.trim();
    const conversationId = record.conversationId.trim();

    if (!channel || !principalId || !channelSessionKey || !conversationId) {
      throw new Error("Channel conversation binding is incomplete.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_channel_bindings (
            channel,
            principal_id,
            channel_session_key,
            conversation_id,
            created_at,
            updated_at
          ) VALUES (
            @channel,
            @principal_id,
            @channel_session_key,
            @conversation_id,
            @created_at,
            @updated_at
          )
          ON CONFLICT(channel, principal_id, channel_session_key) DO UPDATE SET
            conversation_id = excluded.conversation_id,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        channel,
        principal_id: principalId,
        channel_session_key: channelSessionKey,
        conversation_id: conversationId,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  getIdentityLinkCode(code: string): StoredIdentityLinkCodeRecord | null {
    const normalized = code.trim().toUpperCase();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            code,
            source_channel,
            source_channel_user_id,
            source_principal_id,
            created_at,
            expires_at,
            consumed_at,
            consumed_by_channel,
            consumed_by_user_id
          FROM themis_identity_link_codes
          WHERE code = ?
        `,
      )
      .get(normalized) as IdentityLinkCodeRow | undefined;

    return row ? mapIdentityLinkCodeRow(row) : null;
  }

  saveIdentityLinkCode(record: StoredIdentityLinkCodeRecord): void {
    const code = record.code.trim().toUpperCase();

    if (!code) {
      throw new Error("Link code is required.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_identity_link_codes (
            code,
            source_channel,
            source_channel_user_id,
            source_principal_id,
            created_at,
            expires_at,
            consumed_at,
            consumed_by_channel,
            consumed_by_user_id
          ) VALUES (
            @code,
            @source_channel,
            @source_channel_user_id,
            @source_principal_id,
            @created_at,
            @expires_at,
            @consumed_at,
            @consumed_by_channel,
            @consumed_by_user_id
          )
          ON CONFLICT(code) DO UPDATE SET
            source_channel = excluded.source_channel,
            source_channel_user_id = excluded.source_channel_user_id,
            source_principal_id = excluded.source_principal_id,
            created_at = excluded.created_at,
            expires_at = excluded.expires_at,
            consumed_at = excluded.consumed_at,
            consumed_by_channel = excluded.consumed_by_channel,
            consumed_by_user_id = excluded.consumed_by_user_id
        `,
      )
      .run({
        code,
        source_channel: record.sourceChannel,
        source_channel_user_id: record.sourceChannelUserId,
        source_principal_id: record.sourcePrincipalId,
        created_at: record.createdAt,
        expires_at: record.expiresAt,
        consumed_at: record.consumedAt ?? null,
        consumed_by_channel: record.consumedByChannel ?? null,
        consumed_by_user_id: record.consumedByUserId ?? null,
      });
  }

  consumeIdentityLinkCode(
    code: string,
    consumedByChannel: string,
    consumedByUserId: string,
    consumedAt: string,
  ): boolean {
    const normalizedCode = code.trim().toUpperCase();

    if (!normalizedCode) {
      return false;
    }

    const result = this.db
      .prepare(
        `
          UPDATE themis_identity_link_codes
          SET
            consumed_at = @consumed_at,
            consumed_by_channel = @consumed_by_channel,
            consumed_by_user_id = @consumed_by_user_id
          WHERE code = @code
            AND (consumed_at IS NULL OR consumed_at = '')
        `,
      )
      .run({
        code: normalizedCode,
        consumed_at: consumedAt,
        consumed_by_channel: consumedByChannel.trim(),
        consumed_by_user_id: consumedByUserId.trim(),
      });

    return result.changes > 0;
  }

  deleteExpiredIdentityLinkCodes(now: string): number {
    const result = this.db
      .prepare(
        `
          DELETE FROM themis_identity_link_codes
          WHERE expires_at <= ?
            OR (consumed_at IS NOT NULL AND consumed_at <> '')
        `,
      )
      .run(now);

    return result.changes;
  }

  resetPrincipalState(principalId: string, resetAt: string): ResetPrincipalStateResult {
    const normalizedPrincipalId = principalId.trim();

    if (!normalizedPrincipalId) {
      throw new Error("Principal id is required.");
    }

    const existingPrincipal = this.getPrincipal(normalizedPrincipalId);

    if (!existingPrincipal) {
      throw new Error("Principal does not exist.");
    }

    const conversationIds = this.db
      .prepare(
        `
          SELECT conversation_id
          FROM themis_conversations
          WHERE principal_id = ?
          ORDER BY created_at ASC
        `,
      )
      .all(normalizedPrincipalId) as Array<{ conversation_id: string }>;

    const activeSessionIds = new Set<string>();
    const findActiveSession = this.db.prepare(
      `
        SELECT session_id
        FROM codex_sessions
        WHERE active_task_id IS NOT NULL
          AND active_task_id <> ''
          AND (
            session_id = @session_id
            OR session_id LIKE @namespaced_session_id
          )
      `,
    );

    for (const conversation of conversationIds) {
      const rows = findActiveSession.all({
        session_id: conversation.conversation_id,
        namespaced_session_id: `%::${conversation.conversation_id}`,
      }) as Array<{ session_id: string }>;

      for (const row of rows) {
        activeSessionIds.add(row.session_id);
      }
    }

    if (activeSessionIds.size > 0) {
      throw new Error("当前还有运行中的任务，暂时不能重置。请先等待任务结束，或取消当前任务后再试。");
    }

    const reset = this.db.transaction(() => {
      let clearedSessionSettingsCount = 0;
      let clearedTurnCount = 0;
      let clearedCodexSessionCount = 0;

      const deleteSessionSettings = this.db.prepare(
        `
          DELETE FROM themis_session_settings
          WHERE session_id = ?
        `,
      );
      const deleteTurns = this.db.prepare(
        `
          DELETE FROM themis_turns
          WHERE session_id = ?
        `,
      );
      const deleteTurnInputs = this.db.prepare(
        `
          DELETE FROM themis_turn_inputs
          WHERE request_id IN (
            SELECT request_id
            FROM themis_turns
            WHERE session_id = ?
          )
        `,
      );
      const deleteInputAssets = this.db.prepare(
        `
          DELETE FROM themis_input_assets
          WHERE request_id IN (
            SELECT request_id
            FROM themis_turns
            WHERE session_id = ?
          )
        `,
      );
      const deleteCodexSessions = this.db.prepare(
        `
          DELETE FROM codex_sessions
          WHERE session_id = @session_id
             OR session_id LIKE @namespaced_session_id
        `,
      );

      for (const conversation of conversationIds) {
        clearedSessionSettingsCount += deleteSessionSettings.run(conversation.conversation_id).changes;
        deleteInputAssets.run(conversation.conversation_id);
        deleteTurnInputs.run(conversation.conversation_id);
        clearedTurnCount += deleteTurns.run(conversation.conversation_id).changes;
        clearedCodexSessionCount += deleteCodexSessions.run({
          session_id: conversation.conversation_id,
          namespaced_session_id: `%::${conversation.conversation_id}`,
        }).changes;
      }

      const clearedChannelBindingCount = this.db
        .prepare(
          `
            DELETE FROM themis_channel_bindings
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId)
        .changes;

      const clearedConversationCount = this.db
        .prepare(
          `
            DELETE FROM themis_conversations
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId)
        .changes;

      const clearedPersonaProfile = this.db
        .prepare(
          `
            DELETE FROM themis_principal_persona_profiles
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId)
        .changes > 0;

      const clearedPersonaOnboarding = this.db
        .prepare(
          `
            DELETE FROM themis_principal_persona_onboarding
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId)
        .changes > 0;

      const clearedPrincipalTaskSettings = this.db
        .prepare(
          `
            DELETE FROM themis_principal_task_settings
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId)
        .changes > 0;

      this.db
        .prepare(
          `
            DELETE FROM themis_actor_runtime_memory
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_actor_task_scopes
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_actors
            WHERE owner_principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_main_memory
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_main_memory_candidates
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_skill_materializations
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_skills
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_mcp_materializations
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_mcp_oauth_attempts
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_mcp_servers
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_plugin_materializations
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_plugins
            WHERE principal_id = ?
          `,
        )
        .run(normalizedPrincipalId);

      const clearedLinkCodeCount = this.db
        .prepare(
          `
            DELETE FROM themis_identity_link_codes
            WHERE source_principal_id = ?
          `,
        )
        .run(normalizedPrincipalId)
        .changes;

      this.db
        .prepare(
          `
            UPDATE themis_principals
            SET updated_at = ?
            WHERE principal_id = ?
          `,
        )
        .run(resetAt, normalizedPrincipalId);

      return {
        principalId: normalizedPrincipalId,
        clearedConversationCount,
        clearedTurnCount,
        clearedSessionSettingsCount,
        clearedCodexSessionCount,
        clearedChannelBindingCount,
        clearedLinkCodeCount,
        clearedPrincipalTaskSettings,
        clearedPersonaProfile,
        clearedPersonaOnboarding,
        resetAt,
      } satisfies ResetPrincipalStateResult;
    });

    return reset();
  }

  mergePrincipals(sourcePrincipalId: string, targetPrincipalId: string, updatedAt: string): void {
    const sourceId = sourcePrincipalId.trim();
    const targetId = targetPrincipalId.trim();

    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    const merge = this.db.transaction(() => {
      const sourcePrincipal = this.getPrincipal(sourceId);
      const targetPrincipal = this.getPrincipal(targetId);

      if (!sourcePrincipal || !targetPrincipal) {
        return;
      }

      this.db.pragma("defer_foreign_keys = ON");

      if (!targetPrincipal.displayName && sourcePrincipal.displayName) {
        this.savePrincipal({
          principalId: targetPrincipal.principalId,
          displayName: sourcePrincipal.displayName,
          createdAt: targetPrincipal.createdAt,
          updatedAt,
        });
      } else {
        this.db
          .prepare(
            `
              UPDATE themis_principals
              SET updated_at = ?
              WHERE principal_id = ?
            `,
          )
          .run(updatedAt, targetId);
      }

      this.db
        .prepare(
          `
            UPDATE themis_channel_identities
            SET
              principal_id = @target_principal_id,
              updated_at = @updated_at
            WHERE principal_id = @source_principal_id
          `,
        )
        .run({
          source_principal_id: sourceId,
          target_principal_id: targetId,
          updated_at: updatedAt,
        });

      this.db
        .prepare(
          `
            UPDATE themis_conversations
            SET
              principal_id = @target_principal_id,
              updated_at = @updated_at
            WHERE principal_id = @source_principal_id
          `,
        )
        .run({
          source_principal_id: sourceId,
          target_principal_id: targetId,
          updated_at: updatedAt,
        });

      const sourcePersonaProfile = this.getPrincipalPersonaProfile(sourceId);
      const targetPersonaProfile = this.getPrincipalPersonaProfile(targetId);

      if (sourcePersonaProfile) {
        this.savePrincipalPersonaProfile({
          principalId: targetId,
          profile: mergePrincipalPersonaProfileData(targetPersonaProfile?.profile, sourcePersonaProfile.profile),
          createdAt: targetPersonaProfile?.createdAt ?? sourcePersonaProfile.createdAt,
          updatedAt,
          completedAt: targetPersonaProfile?.completedAt ?? sourcePersonaProfile.completedAt,
        });
      }

      const sourcePersonaOnboarding = this.getPrincipalPersonaOnboarding(sourceId);
      const targetPersonaOnboarding = this.getPrincipalPersonaOnboarding(targetId);

      if (sourcePersonaOnboarding && !targetPersonaOnboarding) {
        this.savePrincipalPersonaOnboarding({
          principalId: targetId,
          state: sourcePersonaOnboarding.state,
          createdAt: sourcePersonaOnboarding.createdAt,
          updatedAt,
        });
      }

      this.deletePrincipalPersonaOnboarding(sourceId);

      this.db
        .prepare(
          `
            DELETE FROM themis_principal_persona_profiles
            WHERE principal_id = ?
          `,
        )
        .run(sourceId);

      this.db
        .prepare(
          `
            UPDATE themis_principal_main_memory
            SET
              principal_id = @target_principal_id,
              updated_at = @updated_at
            WHERE principal_id = @source_principal_id
          `,
        )
        .run({
          source_principal_id: sourceId,
          target_principal_id: targetId,
          updated_at: updatedAt,
        });

      this.db
        .prepare(
          `
            UPDATE themis_principal_main_memory_candidates
            SET
              principal_id = @target_principal_id,
              updated_at = @updated_at
            WHERE principal_id = @source_principal_id
          `,
        )
        .run({
          source_principal_id: sourceId,
          target_principal_id: targetId,
          updated_at: updatedAt,
        });

      this.db
        .prepare(
          `
            UPDATE themis_principal_actors
            SET
              owner_principal_id = @target_principal_id,
              updated_at = @updated_at
            WHERE owner_principal_id = @source_principal_id
          `,
        )
        .run({
          source_principal_id: sourceId,
          target_principal_id: targetId,
          updated_at: updatedAt,
        });

      this.db
        .prepare(
          `
            UPDATE themis_actor_task_scopes
            SET
              principal_id = @target_principal_id,
              updated_at = @updated_at
            WHERE principal_id = @source_principal_id
          `,
        )
        .run({
          source_principal_id: sourceId,
          target_principal_id: targetId,
          updated_at: updatedAt,
        });

      this.db
        .prepare(
          `
            UPDATE themis_actor_runtime_memory
            SET principal_id = @target_principal_id
            WHERE principal_id = @source_principal_id
          `,
        )
        .run({
          source_principal_id: sourceId,
          target_principal_id: targetId,
        });

      const sourceSkills = this.listPrincipalSkills(sourceId);
      const targetSkillNames = new Set(
        this.listPrincipalSkills(targetId).map((skill) => skill.skillName),
      );

      for (const skill of sourceSkills) {
        if (targetSkillNames.has(skill.skillName)) {
          continue;
        }

        this.savePrincipalSkill({
          ...skill,
          principalId: targetId,
          updatedAt,
        });

        const sourceMaterializations = this.listPrincipalSkillMaterializations(sourceId, skill.skillName);

        for (const materialization of sourceMaterializations) {
          this.savePrincipalSkillMaterialization({
            ...materialization,
            principalId: targetId,
          });
        }
      }

      const sourceMcpServers = this.listPrincipalMcpServers(sourceId);
      const targetMcpServerNames = new Set(
        this.listPrincipalMcpServers(targetId).map((server) => server.serverName),
      );

      for (const server of sourceMcpServers) {
        if (targetMcpServerNames.has(server.serverName)) {
          continue;
        }

        this.savePrincipalMcpServer({
          ...server,
          principalId: targetId,
          updatedAt,
        });

        const sourceMaterializations = this.listPrincipalMcpMaterializations(sourceId, server.serverName);

        for (const materialization of sourceMaterializations) {
          this.savePrincipalMcpMaterialization({
            ...materialization,
            principalId: targetId,
          });
        }
      }

      const sourcePlugins = this.listPrincipalPlugins(sourceId);
      const targetPluginIds = new Set(
        this.listPrincipalPlugins(targetId).map((plugin) => plugin.pluginId),
      );

      for (const plugin of sourcePlugins) {
        if (targetPluginIds.has(plugin.pluginId)) {
          continue;
        }

        this.savePrincipalPlugin({
          ...plugin,
          principalId: targetId,
          updatedAt,
        });

        const sourceMaterializations = this.listPrincipalPluginMaterializations(sourceId, plugin.pluginId);

        for (const materialization of sourceMaterializations) {
          this.savePrincipalPluginMaterialization({
            ...materialization,
            principalId: targetId,
          });
        }
      }

      const sourceBindings = this.db
        .prepare(
          `
            SELECT channel, principal_id, channel_session_key, conversation_id, created_at, updated_at
            FROM themis_channel_bindings
            WHERE principal_id = ?
          `,
        )
        .all(sourceId) as ChannelConversationBindingRow[];

      const upsertBinding = this.db.prepare(
        `
          INSERT INTO themis_channel_bindings (
            channel,
            principal_id,
            channel_session_key,
            conversation_id,
            created_at,
            updated_at
          ) VALUES (
            @channel,
            @principal_id,
            @channel_session_key,
            @conversation_id,
            @created_at,
            @updated_at
          )
          ON CONFLICT(channel, principal_id, channel_session_key) DO UPDATE SET
            conversation_id = excluded.conversation_id,
            updated_at = excluded.updated_at
        `,
      );

      for (const binding of sourceBindings) {
        upsertBinding.run({
          channel: binding.channel,
          principal_id: targetId,
          channel_session_key: binding.channel_session_key,
          conversation_id: binding.conversation_id,
          created_at: binding.created_at,
          updated_at: updatedAt,
        });
      }

      this.db
        .prepare(
          `
            DELETE FROM themis_channel_bindings
            WHERE principal_id = ?
          `,
        )
        .run(sourceId);
    });

    merge();
  }

  resolveThreadId(sessionId: string): string | null {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT thread_id
          FROM codex_sessions
          WHERE session_id = ?
        `,
      )
      .get(normalized) as { thread_id: string } | undefined;

    const threadId = row?.thread_id.trim();
    return threadId ? threadId : null;
  }

  pruneInactiveSessions(): void {
    const totalSessions = this.countSessions();
    const overflow = totalSessions - this.maxSessions;

    if (overflow <= 0) {
      return;
    }

    const rows = this.db
      .prepare(
        `
          SELECT session_id
          FROM codex_sessions
          WHERE active_task_id IS NULL OR active_task_id = ''
          ORDER BY updated_at ASC
          LIMIT ?
        `,
      )
      .all(overflow) as Array<{ session_id: string }>;

    if (!rows.length) {
      return;
    }

    const removeSessions = this.db.transaction((sessionIds: string[]) => {
      const statement = this.db.prepare(
        `
          DELETE FROM codex_sessions
          WHERE session_id = ?
        `,
      );

      for (const sessionId of sessionIds) {
        statement.run(sessionId);
      }
    });

    removeSessions(rows.map((row) => row.session_id));
  }

  upsertTurnFromRequest(request: TaskRequest, taskId: string): void {
    const conversationId = request.channelContext.sessionId?.trim() || null;

    this.db
      .prepare(
        `
          INSERT INTO themis_turns (
            request_id,
            task_id,
            session_id,
            source_channel,
            user_id,
            user_display_name,
            goal,
            input_text,
            history_context,
            options_json,
            status,
            created_at,
            updated_at
          ) VALUES (
            @request_id,
            @task_id,
            @session_id,
            @source_channel,
            @user_id,
            @user_display_name,
            @goal,
            @input_text,
            @history_context,
            @options_json,
            @status,
            @created_at,
            @updated_at
          )
          ON CONFLICT(request_id) DO UPDATE SET
            task_id = excluded.task_id,
            session_id = excluded.session_id,
            source_channel = excluded.source_channel,
            user_id = excluded.user_id,
            user_display_name = excluded.user_display_name,
            goal = excluded.goal,
            input_text = excluded.input_text,
            history_context = excluded.history_context,
            options_json = excluded.options_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        request_id: request.requestId,
        task_id: taskId,
        session_id: conversationId,
        source_channel: request.sourceChannel,
        user_id: request.user.userId,
        user_display_name: request.user.displayName?.trim() || null,
        goal: request.goal,
        input_text: request.inputText?.trim() || null,
        history_context: request.historyContext?.trim() || null,
        options_json: stringifyJson(request.options),
        status: "queued",
        created_at: request.createdAt,
        updated_at: request.createdAt,
      });

    if (conversationId) {
      this.touchConversation(conversationId, request.createdAt, summarizeConversationTitle(request.goal));
    }
  }

  appendTaskEvent(event: TaskEvent): void {
    const sessionMetadata = extractSessionMetadata(event.payload);
    const payloadJson = stringifyJson(event.payload);

    const applyEvent = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT OR REPLACE INTO themis_turn_events (
              event_id,
              request_id,
              task_id,
              event_type,
              status,
              message,
              payload_json,
              created_at
            ) VALUES (
              @event_id,
              @request_id,
              @task_id,
              @event_type,
              @status,
              @message,
              @payload_json,
              @created_at
            )
          `,
        )
        .run({
          event_id: event.eventId,
          request_id: event.requestId,
          task_id: event.taskId,
          event_type: event.type,
          status: event.status,
          message: event.message ?? null,
          payload_json: payloadJson,
          created_at: event.timestamp,
        });

      this.db
        .prepare(
          `
            UPDATE themis_turns
            SET
              status = CASE
                WHEN status IN ('completed', 'failed', 'cancelled') AND @status IN ('queued', 'running') THEN status
                ELSE @status
              END,
              updated_at = CASE
                WHEN status IN ('completed', 'failed', 'cancelled') AND @status IN ('queued', 'running') THEN updated_at
                ELSE CASE
                  WHEN updated_at IS NULL OR updated_at < @updated_at THEN @updated_at
                  ELSE updated_at
                END
              END,
              session_mode = CASE
                WHEN @session_mode IS NOT NULL AND @session_mode <> '' THEN @session_mode
                ELSE session_mode
              END,
              codex_thread_id = CASE
                WHEN @codex_thread_id IS NOT NULL AND @codex_thread_id <> '' THEN @codex_thread_id
                ELSE codex_thread_id
              END,
              error_message = CASE
                WHEN status IN ('completed', 'failed', 'cancelled') AND @status IN ('queued', 'running') THEN error_message
                WHEN @status = 'failed' THEN COALESCE(@message, error_message)
                ELSE error_message
              END
            WHERE request_id = @request_id
          `,
        )
        .run({
          request_id: event.requestId,
          status: event.status,
          updated_at: event.timestamp,
          session_mode: sessionMetadata.sessionMode ?? null,
          codex_thread_id: sessionMetadata.threadId ?? null,
          message: event.message ?? null,
        });
    });

    applyEvent();
  }

  completeTaskTurn(input: CompleteTaskTurnInput): void {
    const structuredOutputJson = stringifyJson(input.result.structuredOutput);
    const optionsJson = stringifyJson(input.request.options);
    const touchedFiles = dedupeStrings(input.result.touchedFiles ?? []);
    const conversationId = input.request.channelContext.sessionId?.trim() || null;

    const completeTurn = this.db.transaction(() => {
      this.db
        .prepare(
          `
            UPDATE themis_turns
            SET
              session_id = @session_id,
              task_id = @task_id,
              source_channel = @source_channel,
              user_id = @user_id,
              user_display_name = @user_display_name,
              goal = @goal,
              input_text = @input_text,
              history_context = @history_context,
              options_json = @options_json,
              status = @status,
              summary = @summary,
              output = @output,
              error_message = @error_message,
              structured_output_json = @structured_output_json,
              session_mode = @session_mode,
              codex_thread_id = @codex_thread_id,
              updated_at = @updated_at,
              completed_at = @completed_at
            WHERE request_id = @request_id
          `,
        )
        .run({
          request_id: input.request.requestId,
          session_id: input.request.channelContext.sessionId?.trim() || null,
          task_id: input.result.taskId,
          source_channel: input.request.sourceChannel,
          user_id: input.request.user.userId,
          user_display_name: input.request.user.displayName?.trim() || null,
          goal: input.request.goal,
          input_text: input.request.inputText?.trim() || null,
          history_context: input.request.historyContext?.trim() || null,
          options_json: optionsJson,
          status: input.result.status,
          summary: input.result.summary,
          output: input.result.output ?? null,
          error_message: input.result.status === "failed" ? input.result.summary : null,
          structured_output_json: structuredOutputJson,
          session_mode: input.sessionMode ?? null,
          codex_thread_id: input.threadId ?? null,
          updated_at: input.result.completedAt,
          completed_at: input.result.completedAt,
        });

      this.db
        .prepare(
          `
            DELETE FROM themis_turn_files
            WHERE request_id = ?
          `,
        )
        .run(input.request.requestId);

      if (!touchedFiles.length) {
        return;
      }

      const insertFile = this.db.prepare(
        `
          INSERT OR REPLACE INTO themis_turn_files (
            request_id,
            task_id,
            file_path,
            created_at
          ) VALUES (?, ?, ?, ?)
        `,
      );

      for (const filePath of touchedFiles) {
        insertFile.run(input.request.requestId, input.result.taskId, filePath, input.result.completedAt);
      }

      if (conversationId) {
        this.touchConversation(conversationId, input.result.completedAt, summarizeConversationTitle(input.request.goal));
      }
    });

    completeTurn();
  }

  failTaskTurn(input: FailTaskTurnInput): void {
    const completedAt = input.completedAt ?? new Date().toISOString();
    const structuredOutputJson = stringifyJson(input.structuredOutput);

    this.db
      .prepare(
        `
          UPDATE themis_turns
          SET
            status = 'failed',
            summary = @summary,
            error_message = @error_message,
            session_mode = CASE
              WHEN @session_mode IS NOT NULL AND @session_mode <> '' THEN @session_mode
              ELSE session_mode
            END,
            codex_thread_id = CASE
              WHEN @codex_thread_id IS NOT NULL AND @codex_thread_id <> '' THEN @codex_thread_id
              ELSE codex_thread_id
            END,
            structured_output_json = CASE
              WHEN @structured_output_json IS NOT NULL AND @structured_output_json <> '' THEN @structured_output_json
              ELSE structured_output_json
            END,
            updated_at = @updated_at,
            completed_at = @completed_at
          WHERE request_id = @request_id
        `,
      )
      .run({
        request_id: input.request.requestId,
        summary: input.message,
        error_message: input.message,
        session_mode: input.sessionMode ?? null,
        codex_thread_id: input.threadId ?? null,
        structured_output_json: structuredOutputJson,
        updated_at: completedAt,
        completed_at: completedAt,
      });

    const conversationId = input.request.channelContext.sessionId?.trim();

    if (conversationId) {
      this.touchConversation(conversationId, completedAt, summarizeConversationTitle(input.request.goal));
    }
  }

  getTurn(requestId: string): StoredTaskTurnRecord | null {
    const normalized = requestId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT *
          FROM themis_turns
          WHERE request_id = ?
        `,
      )
      .get(normalized) as TurnRow | undefined;

    return row ? mapTurnRow(row) : null;
  }

  saveTurnInput(input: SaveTurnInputInput): void {
    const requestId = input.requestId.trim();

    if (!requestId) {
      return;
    }

    const insertAsset = this.db.prepare(
      `
        INSERT OR REPLACE INTO themis_input_assets (
          request_id,
          asset_id,
          kind,
          name,
          mime_type,
          local_path,
          size_bytes,
          source_channel,
          source_message_id,
          ingestion_status,
          text_extraction_json,
          metadata_json,
          created_at
        ) VALUES (
          @request_id,
          @asset_id,
          @kind,
          @name,
          @mime_type,
          @local_path,
          @size_bytes,
          @source_channel,
          @source_message_id,
          @ingestion_status,
          @text_extraction_json,
          @metadata_json,
          @created_at
        )
      `,
    );

    const saveInput = this.db.transaction(() => {
      const parentTurnExists = this.db
        .prepare(
          `
            SELECT 1
            FROM themis_turns
            WHERE request_id = ?
          `,
        )
        .get(requestId);

      if (!parentTurnExists) {
        throw new Error(`Cannot save turn input without parent turn: ${requestId}`);
      }

      this.db
        .prepare(
          `
            INSERT OR REPLACE INTO themis_turn_inputs (
              request_id,
              envelope_json,
              compile_summary_json,
              created_at
            ) VALUES (
              @request_id,
              @envelope_json,
              @compile_summary_json,
              @created_at
            )
          `,
        )
        .run({
          request_id: requestId,
          envelope_json: JSON.stringify(input.envelope),
          compile_summary_json: stringifyJson(input.compileSummary),
          created_at: input.createdAt,
        });

      this.db
        .prepare(
          `
            DELETE FROM themis_input_assets
            WHERE request_id = ?
          `,
        )
        .run(requestId);

      for (const asset of input.envelope.assets) {
        insertAsset.run({
          request_id: requestId,
          asset_id: asset.assetId,
          kind: asset.kind,
          name: asset.name ?? null,
          mime_type: asset.mimeType,
          local_path: asset.localPath,
          size_bytes: asset.sizeBytes ?? null,
          source_channel: asset.sourceChannel,
          source_message_id: asset.sourceMessageId ?? null,
          ingestion_status: asset.ingestionStatus,
          text_extraction_json: stringifyJson(asset.textExtraction),
          metadata_json: stringifyJson(asset.metadata),
          created_at: input.createdAt,
        });
      }
    });

    saveInput();
  }

  getTurnInput(requestId: string): StoredTurnInputRecord | null {
    const normalized = requestId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT request_id, envelope_json, compile_summary_json, created_at
          FROM themis_turn_inputs
          WHERE request_id = ?
        `,
      )
      .get(normalized) as TurnInputRow | undefined;

    if (!row) {
      return null;
    }

    const envelope = normalizeTaskInputEnvelope(safeParseJson(row.envelope_json));
    const assetRows = this.db
      .prepare(
        `
          SELECT
            request_id,
            asset_id,
            kind,
            name,
            mime_type,
            local_path,
            size_bytes,
            source_channel,
            source_message_id,
            ingestion_status,
            text_extraction_json,
            metadata_json,
            created_at
          FROM themis_input_assets
          WHERE request_id = ?
          ORDER BY created_at ASC, asset_id ASC
        `,
      )
      .all(normalized) as InputAssetRow[];
    const assets = orderTaskInputAssets(
      assetRows.map(mapInputAssetRow),
      envelope,
    );

    return {
      requestId: row.request_id,
      envelope: {
        ...envelope,
        assets,
      },
      assets,
      compileSummary: row.compile_summary_json === null
        ? null
        : normalizeTurnInputCompileSummary(safeParseJson(row.compile_summary_json)),
      createdAt: row.created_at,
    };
  }

  listRecentInputAssetsByChannelUser(input: {
    sourceChannel: string;
    userId: string;
    limit?: number;
  }): StoredChannelInputAssetRecord[] {
    const sourceChannel = input.sourceChannel.trim();
    const userId = input.userId.trim();

    if (!sourceChannel || !userId) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT
            a.request_id,
            a.asset_id,
            a.kind,
            a.name,
            a.mime_type,
            a.local_path,
            a.size_bytes,
            a.source_channel,
            a.source_message_id,
            a.ingestion_status,
            a.text_extraction_json,
            a.metadata_json,
            a.created_at,
            t.session_id,
            t.source_channel AS turn_source_channel,
            t.user_id
          FROM themis_input_assets a
          INNER JOIN themis_turns t
            ON t.request_id = a.request_id
          WHERE t.source_channel = ?
            AND t.user_id = ?
          ORDER BY a.created_at DESC, a.request_id DESC, a.asset_id DESC
          LIMIT ?
        `,
      )
      .all(sourceChannel, userId, normalizeLimit(input.limit, 20)) as ChannelInputAssetRow[];

    return rows.map(mapChannelInputAssetRow);
  }

  listTurnEvents(requestId: string): StoredTaskEventRecord[] {
    const normalized = requestId.trim();

    if (!normalized) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT event_id, request_id, task_id, event_type, status, message, payload_json, created_at
          FROM themis_turn_events
          WHERE request_id = ?
          ORDER BY created_at ASC, event_id ASC
        `,
      )
      .all(normalized) as EventRow[];

    return rows.map(mapEventRow);
  }

  listTurnFiles(requestId: string): string[] {
    const normalized = requestId.trim();

    if (!normalized) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT file_path
          FROM themis_turn_files
          WHERE request_id = ?
          ORDER BY file_path ASC
        `,
      )
      .all(normalized) as Array<{ file_path: string }>;

    return rows.map((row) => row.file_path);
  }

  listSessionTurns(sessionId: string): StoredTaskTurnRecord[] {
    const normalized = sessionId.trim();

    if (!normalized) {
      return [];
    }

    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM themis_turns
          WHERE session_id = ?
          ORDER BY created_at ASC, request_id ASC
        `,
      )
      .all(normalized) as TurnRow[];

    return rows.map(mapTurnRow);
  }

  listRecentSessions(limit = 24): StoredSessionHistorySummary[] {
    return this.listRecentSessionsByFilter({}, limit);
  }

  listRecentSessionsByFilter(filter: StoredSessionHistoryFilter, limit = 24): StoredSessionHistorySummary[] {
    const resolvedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 24;
    const { sql, params } = this.buildSessionSummaryQuery({
      filter,
      limit: resolvedLimit,
    });
    const rows = this.db.prepare(sql).all(...params) as SessionSummaryRow[];

    return rows.map(mapSessionSummaryRow);
  }

  getSessionHistorySummary(sessionId: string): StoredSessionHistorySummary | null {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    const { sql, params } = this.buildSessionSummaryQuery({
      sessionId: normalized,
      limit: 1,
      includeArchived: true,
    });
    const row = this.db.prepare(sql).get(...params) as SessionSummaryRow | undefined;

    return row ? mapSessionSummaryRow(row) : null;
  }

  saveSessionHistoryMetadata(record: StoredSessionHistoryMetadataRecord): void {
    const sessionId = record.sessionId.trim();

    if (!sessionId || !record.createdAt || !record.updatedAt) {
      throw new Error("Session history metadata record is incomplete.");
    }

    const existing = this.readSessionHistoryMetadataRow(sessionId);
    const originKind = normalizeSessionHistoryOriginKind(record.originKind ?? existing?.origin_kind ?? null);
    const originSessionId = normalizeText(record.originSessionId ?? existing?.origin_session_id ?? undefined);
    const originLabel = normalizeText(record.originLabel ?? existing?.origin_label ?? undefined);
    const archivedAt = normalizeText(existing?.archived_at ?? undefined);

    this.db
      .prepare(
        `
          INSERT INTO themis_session_history_metadata (
            session_id,
            archived_at,
            origin_kind,
            origin_session_id,
            origin_label,
            created_at,
            updated_at
          ) VALUES (
            @session_id,
            @archived_at,
            @origin_kind,
            @origin_session_id,
            @origin_label,
            @created_at,
            @updated_at
          )
          ON CONFLICT(session_id) DO UPDATE SET
            archived_at = excluded.archived_at,
            origin_kind = excluded.origin_kind,
            origin_session_id = excluded.origin_session_id,
            origin_label = excluded.origin_label,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        session_id: sessionId,
        archived_at: archivedAt ?? null,
        origin_kind: originKind,
        origin_session_id: originSessionId ?? null,
        origin_label: originLabel ?? null,
        created_at: existing?.created_at ?? record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  archiveSessionHistory(sessionId: string, archivedAt: string): boolean {
    return this.writeSessionArchiveState(sessionId, archivedAt);
  }

  unarchiveSessionHistory(sessionId: string, updatedAt: string): boolean {
    return this.writeSessionArchiveState(sessionId, null, updatedAt);
  }

  hasSessionTurn(filter: StoredSessionHistoryFilter & { sessionId: string }): boolean {
    const sessionId = filter.sessionId.trim();

    if (!sessionId) {
      return false;
    }

    const clauses: string[] = ["session_id = ?"];
    const params: Array<string | number> = [sessionId];

    if (typeof filter.sourceChannel === "string" && filter.sourceChannel.trim()) {
      clauses.push("source_channel = ?");
      params.push(filter.sourceChannel.trim());
    }

    if (typeof filter.userId === "string" && filter.userId.trim()) {
      clauses.push("user_id = ?");
      params.push(filter.userId.trim());
    }

    const whereClause = clauses.join("\n            AND ");
    const row = this.db
      .prepare(
        `
          SELECT 1 AS matched
          FROM themis_turns
          WHERE ${whereClause}
          LIMIT 1
        `,
      )
      .get(...params) as { matched: number } | undefined;

    return row?.matched === 1;
  }

  listThirdPartyProviders(): StoredThirdPartyProviderRecord[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            provider_id,
            name,
            base_url,
            api_key,
            endpoint_candidates_json,
            default_model,
            wire_api,
            supports_websockets,
            model_catalog_path,
            created_at,
            updated_at
          FROM themis_third_party_providers
          ORDER BY name COLLATE NOCASE ASC, provider_id ASC
        `,
      )
      .all() as ThirdPartyProviderRow[];

    return rows.map(mapThirdPartyProviderRow);
  }

  listThirdPartyProviderModels(providerId?: string): StoredThirdPartyProviderModelRecord[] {
    const normalizedProviderId = providerId?.trim();
    const rows = normalizedProviderId
      ? this.db
        .prepare(
          `
            SELECT
              provider_id,
              model,
              display_name,
              description,
              default_reasoning_level,
              supported_reasoning_levels_json,
              context_window,
              truncation_mode,
              truncation_limit,
              capabilities_json,
              created_at,
              updated_at
            FROM themis_third_party_models
            WHERE provider_id = ?
            ORDER BY model COLLATE NOCASE ASC
          `,
        )
        .all(normalizedProviderId)
      : this.db
        .prepare(
          `
            SELECT
              provider_id,
              model,
              display_name,
              description,
              default_reasoning_level,
              supported_reasoning_levels_json,
              context_window,
              truncation_mode,
              truncation_limit,
              capabilities_json,
              created_at,
              updated_at
            FROM themis_third_party_models
            ORDER BY provider_id ASC, model COLLATE NOCASE ASC
          `,
        )
        .all();

    return (rows as ThirdPartyProviderModelRow[]).map(mapThirdPartyProviderModelRow);
  }

  saveThirdPartyProvider(record: StoredThirdPartyProviderRecord): void {
    this.db
      .prepare(
        `
          INSERT INTO themis_third_party_providers (
            provider_id,
            name,
            base_url,
            api_key,
            endpoint_candidates_json,
            default_model,
            wire_api,
            supports_websockets,
            model_catalog_path,
            created_at,
            updated_at
          ) VALUES (
            @provider_id,
            @name,
            @base_url,
            @api_key,
            @endpoint_candidates_json,
            @default_model,
            @wire_api,
            @supports_websockets,
            @model_catalog_path,
            @created_at,
            @updated_at
          )
          ON CONFLICT(provider_id) DO UPDATE SET
            name = excluded.name,
            base_url = excluded.base_url,
            api_key = excluded.api_key,
            endpoint_candidates_json = excluded.endpoint_candidates_json,
            default_model = excluded.default_model,
            wire_api = excluded.wire_api,
            supports_websockets = excluded.supports_websockets,
            model_catalog_path = excluded.model_catalog_path,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        provider_id: record.providerId,
        name: record.name,
        base_url: record.baseUrl,
        api_key: record.apiKey,
        endpoint_candidates_json: record.endpointCandidatesJson,
        default_model: record.defaultModel ?? null,
        wire_api: record.wireApi,
        supports_websockets: record.supportsWebsockets ? 1 : 0,
        model_catalog_path: record.modelCatalogPath ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  saveThirdPartyProviderModel(record: StoredThirdPartyProviderModelRecord): void {
    this.db
      .prepare(
        `
          INSERT INTO themis_third_party_models (
            provider_id,
            model,
            display_name,
            description,
            default_reasoning_level,
            supported_reasoning_levels_json,
            context_window,
            truncation_mode,
            truncation_limit,
            capabilities_json,
            created_at,
            updated_at
          ) VALUES (
            @provider_id,
            @model,
            @display_name,
            @description,
            @default_reasoning_level,
            @supported_reasoning_levels_json,
            @context_window,
            @truncation_mode,
            @truncation_limit,
            @capabilities_json,
            @created_at,
            @updated_at
          )
          ON CONFLICT(provider_id, model) DO UPDATE SET
            display_name = excluded.display_name,
            description = excluded.description,
            default_reasoning_level = excluded.default_reasoning_level,
            supported_reasoning_levels_json = excluded.supported_reasoning_levels_json,
            context_window = excluded.context_window,
            truncation_mode = excluded.truncation_mode,
            truncation_limit = excluded.truncation_limit,
            capabilities_json = excluded.capabilities_json,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        provider_id: record.providerId,
        model: record.model,
        display_name: record.displayName,
        description: record.description,
        default_reasoning_level: record.defaultReasoningLevel,
        supported_reasoning_levels_json: record.supportedReasoningLevelsJson,
        context_window: record.contextWindow ?? null,
        truncation_mode: record.truncationMode,
        truncation_limit: record.truncationLimit,
        capabilities_json: record.capabilitiesJson,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
  }

  updateThirdPartyProviderDefaultModel(providerId: string, defaultModel: string | null, updatedAt: string): void {
    this.db
      .prepare(
        `
          UPDATE themis_third_party_providers
          SET
            default_model = @default_model,
            updated_at = @updated_at
          WHERE provider_id = @provider_id
        `,
      )
      .run({
        provider_id: providerId,
        default_model: defaultModel?.trim() || null,
        updated_at: updatedAt,
      });
  }

  updateThirdPartyModelCapabilities(
    providerId: string,
    model: string,
    capabilitiesJson: string,
    updatedAt: string,
  ): void {
    this.db
      .prepare(
        `
          UPDATE themis_third_party_models
          SET
            capabilities_json = @capabilities_json,
            updated_at = @updated_at
          WHERE provider_id = @provider_id
            AND model = @model
        `,
      )
      .run({
        provider_id: providerId,
        model,
        capabilities_json: capabilitiesJson,
        updated_at: updatedAt,
      });
  }

  private initializeSchema(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themis_principals (
        principal_id TEXT PRIMARY KEY,
        display_name TEXT,
        principal_kind TEXT NOT NULL DEFAULT 'human_user',
        organization_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS themis_principals_updated_at_idx
      ON themis_principals(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_task_settings (
        principal_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_task_settings_updated_at_idx
      ON themis_principal_task_settings(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_skills (
        principal_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        description TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref_json TEXT NOT NULL,
        managed_path TEXT NOT NULL,
        install_status TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_id, skill_name),
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_skill_materializations (
        principal_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_path TEXT NOT NULL,
        state TEXT NOT NULL,
        last_synced_at TEXT,
        last_error TEXT,
        PRIMARY KEY (principal_id, skill_name, target_kind, target_id),
        FOREIGN KEY (principal_id, skill_name)
          REFERENCES themis_principal_skills(principal_id, skill_name)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_mcp_servers (
        principal_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        transport_type TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        env_json TEXT NOT NULL,
        cwd TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        source_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_id, server_name),
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_mcp_materializations (
        principal_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        state TEXT NOT NULL,
        auth_state TEXT NOT NULL,
        last_synced_at TEXT,
        last_error TEXT,
        PRIMARY KEY (principal_id, server_name, target_kind, target_id),
        FOREIGN KEY (principal_id, server_name)
          REFERENCES themis_principal_mcp_servers(principal_id, server_name)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_mcp_oauth_attempts (
        attempt_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        authorization_url TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        last_error TEXT,
        FOREIGN KEY (principal_id, server_name)
          REFERENCES themis_principal_mcp_servers(principal_id, server_name)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_mcp_oauth_attempts_latest_idx
      ON themis_principal_mcp_oauth_attempts(principal_id, server_name, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_plugins (
        principal_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        plugin_name TEXT NOT NULL,
        marketplace_name TEXT NOT NULL,
        marketplace_path TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref_json TEXT NOT NULL,
        source_path TEXT,
        interface_json TEXT NOT NULL,
        install_policy TEXT NOT NULL,
        auth_policy TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT,
        PRIMARY KEY (principal_id, plugin_id),
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_plugin_materializations (
        principal_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        workspace_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL,
        last_synced_at TEXT,
        last_error TEXT,
        PRIMARY KEY (principal_id, plugin_id, target_kind, target_id, workspace_fingerprint),
        FOREIGN KEY (principal_id, plugin_id)
          REFERENCES themis_principal_plugins(principal_id, plugin_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_persona_profiles (
        principal_id TEXT PRIMARY KEY,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_persona_profiles_updated_at_idx
      ON themis_principal_persona_profiles(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_persona_onboarding (
        principal_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_persona_onboarding_updated_at_idx
      ON themis_principal_persona_onboarding(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_channel_identities (
        channel TEXT NOT NULL,
        channel_user_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel, channel_user_id),
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_channel_identities_principal_idx
      ON themis_channel_identities(principal_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_conversations (
        conversation_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_conversations_principal_idx
      ON themis_conversations(principal_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_channel_bindings (
        channel TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        channel_session_key TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel, principal_id, channel_session_key),
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES themis_conversations(conversation_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_channel_bindings_conversation_idx
      ON themis_channel_bindings(conversation_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_identity_link_codes (
        code TEXT PRIMARY KEY,
        source_channel TEXT NOT NULL,
        source_channel_user_id TEXT NOT NULL,
        source_principal_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        consumed_by_channel TEXT,
        consumed_by_user_id TEXT,
        FOREIGN KEY (source_principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_identity_link_codes_expires_idx
      ON themis_identity_link_codes(expires_at ASC);

      CREATE TABLE IF NOT EXISTS codex_sessions (
        session_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        active_task_id TEXT
      );

      CREATE INDEX IF NOT EXISTS codex_sessions_updated_at_idx
      ON codex_sessions(updated_at DESC);

      CREATE INDEX IF NOT EXISTS codex_sessions_active_task_id_idx
      ON codex_sessions(active_task_id);

      CREATE TABLE IF NOT EXISTS themis_session_settings (
        session_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS themis_session_settings_updated_at_idx
      ON themis_session_settings(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_web_access_tokens (
        token_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_kind TEXT NOT NULL DEFAULT 'web_login',
        owner_principal_id TEXT,
        service_role TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS themis_web_access_tokens_label_idx
      ON themis_web_access_tokens(label, updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS themis_web_access_tokens_active_label_idx
      ON themis_web_access_tokens(label)
      WHERE revoked_at IS NULL;

      CREATE INDEX IF NOT EXISTS themis_web_access_tokens_active_idx
      ON themis_web_access_tokens(revoked_at, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_web_sessions (
        session_id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (token_id) REFERENCES themis_web_access_tokens(token_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_web_sessions_token_idx
      ON themis_web_sessions(token_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS themis_web_sessions_expires_idx
      ON themis_web_sessions(expires_at ASC);

      CREATE INDEX IF NOT EXISTS themis_web_sessions_revoked_idx
      ON themis_web_sessions(revoked_at, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_web_audit_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        remote_ip TEXT,
        token_id TEXT,
        token_label TEXT,
        session_id TEXT,
        summary TEXT,
        payload_json TEXT,
        FOREIGN KEY (token_id) REFERENCES themis_web_access_tokens(token_id) ON DELETE SET NULL,
        FOREIGN KEY (session_id) REFERENCES themis_web_sessions(session_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS themis_web_audit_events_created_idx
      ON themis_web_audit_events(created_at DESC);

      CREATE TABLE IF NOT EXISTS themis_auth_accounts (
        account_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        account_email TEXT,
        codex_home TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS themis_auth_accounts_active_idx
      ON themis_auth_accounts(is_active DESC, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_turns (
        request_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        session_id TEXT,
        source_channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_display_name TEXT,
        goal TEXT NOT NULL,
        input_text TEXT,
        history_context TEXT,
        options_json TEXT,
        status TEXT NOT NULL,
        summary TEXT,
        output TEXT,
        error_message TEXT,
        structured_output_json TEXT,
        session_mode TEXT,
        codex_thread_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS themis_turns_task_id_idx
      ON themis_turns(task_id);

      CREATE INDEX IF NOT EXISTS themis_turns_session_id_idx
      ON themis_turns(session_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS themis_turns_updated_at_idx
      ON themis_turns(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_turn_events (
        event_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES themis_turns(request_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_turn_events_request_id_idx
      ON themis_turn_events(request_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS themis_turn_files (
        request_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (request_id, file_path),
        FOREIGN KEY (request_id) REFERENCES themis_turns(request_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_turn_files_task_id_idx
      ON themis_turn_files(task_id);

      CREATE TABLE IF NOT EXISTS themis_third_party_providers (
        provider_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        endpoint_candidates_json TEXT NOT NULL DEFAULT '[]',
        default_model TEXT,
        wire_api TEXT NOT NULL DEFAULT 'responses',
        supports_websockets INTEGER NOT NULL DEFAULT 0,
        model_catalog_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS themis_third_party_providers_updated_at_idx
      ON themis_third_party_providers(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_third_party_models (
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        default_reasoning_level TEXT NOT NULL,
        supported_reasoning_levels_json TEXT NOT NULL,
        context_window INTEGER,
        truncation_mode TEXT NOT NULL DEFAULT 'tokens',
        truncation_limit INTEGER NOT NULL,
        capabilities_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model),
        FOREIGN KEY (provider_id) REFERENCES themis_third_party_providers(provider_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_third_party_models_provider_idx
      ON themis_third_party_models(provider_id, updated_at DESC);

    `);

    this.createTurnInputTables(database);
    this.createActorMemoryTables(database);
    this.createOperationsCenterTables(database);
    this.createManagedAgentTables(database);
  }

  private openDatabase(): Database.Database {
    const database = this.createDatabaseConnection();
    this.initializeSchema(database);
    this.migrateSchema(database);
    this.repairActorMemorySchema(database);
    this.createActorMemoryIndexes(database);
    database.pragma(`user_version = ${DATABASE_SCHEMA_VERSION}`);
    return database;
  }

  private createActorMemoryTables(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themis_principal_actors (
        actor_id TEXT PRIMARY KEY,
        owner_principal_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        UNIQUE(owner_principal_id, actor_id)
      );

      CREATE TABLE IF NOT EXISTS themis_principal_main_memory (
        memory_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        source_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_main_memory_principal_idx
      ON themis_principal_main_memory(principal_id, updated_at DESC, memory_id DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_main_memory_candidates (
        candidate_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT NOT NULL,
        suggested_content TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_label TEXT NOT NULL,
        source_task_id TEXT,
        source_conversation_id TEXT,
        status TEXT NOT NULL,
        approved_memory_id TEXT,
        reviewed_at TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (approved_memory_id) REFERENCES themis_principal_main_memory(memory_id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS themis_actor_task_scopes (
        scope_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        conversation_id TEXT,
        goal TEXT NOT NULL,
        workspace_path TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (principal_id, actor_id)
          REFERENCES themis_principal_actors(owner_principal_id, actor_id)
          ON DELETE CASCADE,
        UNIQUE(principal_id, scope_id)
      );

      CREATE TABLE IF NOT EXISTS themis_actor_runtime_memory (
        runtime_memory_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        conversation_id TEXT,
        scope_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (principal_id, actor_id)
          REFERENCES themis_principal_actors(owner_principal_id, actor_id)
          ON DELETE CASCADE,
        FOREIGN KEY (principal_id, scope_id)
          REFERENCES themis_actor_task_scopes(principal_id, scope_id)
          ON DELETE CASCADE
      );
    `);
  }

  private createOperationsCenterTables(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themis_principal_assets (
        asset_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_principal_id TEXT,
        summary TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        refs_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_assets_principal_idx
      ON themis_principal_assets(principal_id, updated_at DESC, asset_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_assets_status_idx
      ON themis_principal_assets(principal_id, status, updated_at DESC, asset_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_assets_kind_idx
      ON themis_principal_assets(principal_id, kind, updated_at DESC, asset_id DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_decisions (
        decision_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        decided_by_principal_id TEXT,
        decided_at TEXT NOT NULL,
        related_asset_ids_json TEXT NOT NULL DEFAULT '[]',
        related_work_item_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_decisions_principal_idx
      ON themis_principal_decisions(principal_id, updated_at DESC, decision_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_decisions_status_idx
      ON themis_principal_decisions(principal_id, status, updated_at DESC, decision_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_decisions_decided_at_idx
      ON themis_principal_decisions(principal_id, decided_at DESC, decision_id DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_risks (
        risk_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_principal_id TEXT,
        summary TEXT,
        detected_at TEXT NOT NULL,
        related_asset_ids_json TEXT NOT NULL DEFAULT '[]',
        linked_decision_ids_json TEXT NOT NULL DEFAULT '[]',
        related_work_item_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_risks_principal_idx
      ON themis_principal_risks(principal_id, updated_at DESC, risk_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_risks_status_idx
      ON themis_principal_risks(principal_id, status, updated_at DESC, risk_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_risks_severity_idx
      ON themis_principal_risks(principal_id, severity, updated_at DESC, risk_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_risks_detected_at_idx
      ON themis_principal_risks(principal_id, detected_at DESC, risk_id DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_cadences (
        cadence_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        title TEXT NOT NULL,
        frequency TEXT NOT NULL,
        status TEXT NOT NULL,
        next_run_at TEXT NOT NULL,
        owner_principal_id TEXT,
        playbook_ref TEXT,
        summary TEXT,
        related_asset_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_cadences_principal_idx
      ON themis_principal_cadences(principal_id, next_run_at ASC, cadence_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_cadences_status_idx
      ON themis_principal_cadences(principal_id, status, next_run_at ASC, cadence_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_cadences_frequency_idx
      ON themis_principal_cadences(principal_id, frequency, next_run_at ASC, cadence_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_cadences_next_run_at_idx
      ON themis_principal_cadences(principal_id, next_run_at ASC, cadence_id DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_commitments (
        commitment_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_principal_id TEXT,
        starts_at TEXT,
        due_at TEXT NOT NULL,
        progress_percent INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        milestones_json TEXT NOT NULL DEFAULT '[]',
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        related_asset_ids_json TEXT NOT NULL DEFAULT '[]',
        linked_decision_ids_json TEXT NOT NULL DEFAULT '[]',
        linked_risk_ids_json TEXT NOT NULL DEFAULT '[]',
        related_cadence_ids_json TEXT NOT NULL DEFAULT '[]',
        related_work_item_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_commitments_principal_idx
      ON themis_principal_commitments(principal_id, due_at ASC, commitment_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_commitments_status_idx
      ON themis_principal_commitments(principal_id, status, due_at ASC, commitment_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_commitments_due_at_idx
      ON themis_principal_commitments(principal_id, due_at ASC, commitment_id DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_operation_edges (
        edge_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        from_object_type TEXT NOT NULL,
        from_object_id TEXT NOT NULL,
        to_object_type TEXT NOT NULL,
        to_object_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        status TEXT NOT NULL,
        label TEXT,
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_operation_edges_principal_idx
      ON themis_principal_operation_edges(principal_id, updated_at DESC, edge_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_operation_edges_from_idx
      ON themis_principal_operation_edges(principal_id, from_object_type, from_object_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_operation_edges_to_idx
      ON themis_principal_operation_edges(principal_id, to_object_type, to_object_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_operation_edges_relation_idx
      ON themis_principal_operation_edges(principal_id, relation_type, status, updated_at DESC);
    `);
  }

  private createActorMemoryIndexes(database: Database.Database): void {
    database.exec(`
      CREATE INDEX IF NOT EXISTS themis_principal_actors_owner_idx
      ON themis_principal_actors(owner_principal_id, updated_at DESC, actor_id ASC);

      CREATE INDEX IF NOT EXISTS themis_principal_main_memory_candidates_principal_idx
      ON themis_principal_main_memory_candidates(principal_id, archived_at, updated_at DESC, candidate_id DESC);

      CREATE INDEX IF NOT EXISTS themis_principal_main_memory_candidates_status_idx
      ON themis_principal_main_memory_candidates(principal_id, status, archived_at, updated_at DESC, candidate_id DESC);

      CREATE INDEX IF NOT EXISTS themis_actor_task_scopes_principal_idx
      ON themis_actor_task_scopes(principal_id, actor_id, status, updated_at DESC, scope_id ASC);

      CREATE INDEX IF NOT EXISTS themis_actor_runtime_memory_principal_idx
      ON themis_actor_runtime_memory(principal_id, actor_id, scope_id, created_at DESC, runtime_memory_id DESC);

      CREATE INDEX IF NOT EXISTS themis_actor_runtime_memory_scope_timeline_idx
      ON themis_actor_runtime_memory(principal_id, scope_id, created_at ASC, runtime_memory_id ASC);
    `);
  }

  private createManagedAgentTables(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themis_organizations (
        organization_id TEXT PRIMARY KEY,
        owner_principal_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        slug TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        UNIQUE(owner_principal_id, slug)
      );

      CREATE INDEX IF NOT EXISTS themis_organizations_owner_idx
      ON themis_organizations(owner_principal_id, updated_at DESC, organization_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_spawn_policies (
        organization_id TEXT PRIMARY KEY,
        max_active_agents INTEGER NOT NULL,
        max_active_agents_per_role INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_agent_spawn_policies_updated_idx
      ON themis_agent_spawn_policies(updated_at DESC, organization_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_spawn_suggestion_states (
        suggestion_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        state TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_agent_spawn_suggestion_states_org_idx
      ON themis_agent_spawn_suggestion_states(organization_id, state, updated_at DESC, suggestion_id ASC);

      CREATE TABLE IF NOT EXISTS themis_managed_agents (
        agent_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL UNIQUE,
        organization_id TEXT NOT NULL,
        created_by_principal_id TEXT NOT NULL,
        supervisor_principal_id TEXT,
        display_name TEXT NOT NULL,
        slug TEXT NOT NULL,
        department_role TEXT NOT NULL,
        mission TEXT NOT NULL,
        status TEXT NOT NULL,
        autonomy_level TEXT NOT NULL,
        creation_mode TEXT NOT NULL,
        exposure_policy TEXT NOT NULL,
        default_workspace_policy_id TEXT,
        default_runtime_profile_id TEXT,
        agent_card_json TEXT,
        bootstrap_profile_json TEXT,
        bootstrapped_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (supervisor_principal_id) REFERENCES themis_principals(principal_id) ON DELETE SET NULL,
        UNIQUE(organization_id, slug)
      );

      CREATE INDEX IF NOT EXISTS themis_managed_agents_organization_idx
      ON themis_managed_agents(organization_id, updated_at DESC, agent_id ASC);

      CREATE INDEX IF NOT EXISTS themis_managed_agents_supervisor_idx
      ON themis_managed_agents(supervisor_principal_id, updated_at DESC, agent_id ASC);

      CREATE INDEX IF NOT EXISTS themis_managed_agents_status_idx
      ON themis_managed_agents(organization_id, status, updated_at DESC, agent_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_workspace_policies (
        policy_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        owner_agent_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        additional_directories_json TEXT NOT NULL DEFAULT '[]',
        allow_network_access INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (owner_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_agent_workspace_policies_org_idx
      ON themis_agent_workspace_policies(organization_id, updated_at DESC, policy_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_workspace_policies_owner_idx
      ON themis_agent_workspace_policies(owner_agent_id, updated_at DESC, policy_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_runtime_profiles (
        profile_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        owner_agent_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (owner_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_agent_runtime_profiles_org_idx
      ON themis_agent_runtime_profiles(organization_id, updated_at DESC, profile_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_runtime_profiles_owner_idx
      ON themis_agent_runtime_profiles(owner_agent_id, updated_at DESC, profile_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_work_items (
        work_item_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        project_id TEXT,
        source_type TEXT NOT NULL,
        source_principal_id TEXT NOT NULL,
        source_agent_id TEXT,
        parent_work_item_id TEXT,
        dispatch_reason TEXT NOT NULL,
        goal TEXT NOT NULL,
        context_packet_json TEXT,
        waiting_action_request_json TEXT,
        latest_human_response_json TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        workspace_policy_snapshot_json TEXT,
        runtime_profile_snapshot_json TEXT,
        created_at TEXT NOT NULL,
        scheduled_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (target_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY (source_principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (source_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE SET NULL,
        FOREIGN KEY (parent_work_item_id) REFERENCES themis_agent_work_items(work_item_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS themis_agent_work_items_target_idx
      ON themis_agent_work_items(target_agent_id, status, created_at DESC, work_item_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_work_items_organization_idx
      ON themis_agent_work_items(organization_id, status, created_at DESC, work_item_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_work_items_parent_idx
      ON themis_agent_work_items(parent_work_item_id, created_at ASC, work_item_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_runs (
        run_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        scheduler_id TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        last_heartbeat_at TEXT,
        completed_at TEXT,
        failure_code TEXT,
        failure_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (work_item_id) REFERENCES themis_agent_work_items(work_item_id) ON DELETE CASCADE,
        FOREIGN KEY (target_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_agent_runs_work_item_idx
      ON themis_agent_runs(work_item_id, created_at DESC, run_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_runs_target_agent_idx
      ON themis_agent_runs(target_agent_id, status, updated_at DESC, run_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_runs_scheduler_idx
      ON themis_agent_runs(scheduler_id, status, updated_at DESC, run_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_runs_lease_idx
      ON themis_agent_runs(status, lease_expires_at ASC, run_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_nodes (
        node_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        slot_capacity INTEGER NOT NULL,
        slot_available INTEGER NOT NULL,
        labels_json TEXT NOT NULL DEFAULT '[]',
        workspace_capabilities_json TEXT NOT NULL DEFAULT '[]',
        credential_capabilities_json TEXT NOT NULL DEFAULT '[]',
        provider_capabilities_json TEXT NOT NULL DEFAULT '[]',
        heartbeat_ttl_seconds INTEGER NOT NULL,
        last_heartbeat_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_agent_nodes_organization_idx
      ON themis_agent_nodes(organization_id, status, updated_at DESC, node_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_nodes_heartbeat_idx
      ON themis_agent_nodes(status, last_heartbeat_at DESC, node_id ASC);

      CREATE TABLE IF NOT EXISTS themis_project_workspace_bindings (
        project_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        owning_agent_id TEXT,
        workspace_root_id TEXT,
        workspace_policy_id TEXT,
        canonical_workspace_path TEXT,
        preferred_node_id TEXT,
        preferred_node_pool TEXT,
        last_active_node_id TEXT,
        last_active_workspace_path TEXT,
        continuity_mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (owning_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE SET NULL,
        FOREIGN KEY (workspace_policy_id) REFERENCES themis_agent_workspace_policies(policy_id) ON DELETE SET NULL,
        FOREIGN KEY (preferred_node_id) REFERENCES themis_agent_nodes(node_id) ON DELETE SET NULL,
        FOREIGN KEY (last_active_node_id) REFERENCES themis_agent_nodes(node_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS themis_project_workspace_bindings_org_idx
      ON themis_project_workspace_bindings(organization_id, updated_at DESC, project_id ASC);

      CREATE INDEX IF NOT EXISTS themis_project_workspace_bindings_owner_idx
      ON themis_project_workspace_bindings(owning_agent_id, updated_at DESC, project_id ASC);

      CREATE INDEX IF NOT EXISTS themis_project_workspace_bindings_preferred_node_idx
      ON themis_project_workspace_bindings(preferred_node_id, updated_at DESC, project_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_execution_leases (
        lease_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        status TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        last_heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES themis_agent_runs(run_id) ON DELETE CASCADE,
        FOREIGN KEY (work_item_id) REFERENCES themis_agent_work_items(work_item_id) ON DELETE CASCADE,
        FOREIGN KEY (target_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY (node_id) REFERENCES themis_agent_nodes(node_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_agent_execution_leases_run_idx
      ON themis_agent_execution_leases(run_id, status, updated_at DESC, lease_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_execution_leases_node_idx
      ON themis_agent_execution_leases(node_id, status, updated_at DESC, lease_id ASC);

      CREATE UNIQUE INDEX IF NOT EXISTS themis_agent_execution_leases_active_run_idx
      ON themis_agent_execution_leases(run_id)
      WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS themis_agent_messages (
        message_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        work_item_id TEXT,
        run_id TEXT,
        parent_message_id TEXT,
        message_type TEXT NOT NULL,
        payload_json TEXT,
        artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL,
        requires_ack INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (from_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY (to_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY (work_item_id) REFERENCES themis_agent_work_items(work_item_id) ON DELETE SET NULL,
        FOREIGN KEY (parent_message_id) REFERENCES themis_agent_messages(message_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS themis_agent_messages_to_agent_idx
      ON themis_agent_messages(to_agent_id, created_at DESC, message_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_messages_work_item_idx
      ON themis_agent_messages(work_item_id, created_at ASC, message_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_messages_org_idx
      ON themis_agent_messages(organization_id, created_at DESC, message_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_handoffs (
        handoff_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        source_message_id TEXT,
        source_run_id TEXT,
        summary TEXT NOT NULL,
        blockers_json TEXT NOT NULL DEFAULT '[]',
        recommended_next_actions_json TEXT NOT NULL DEFAULT '[]',
        attached_artifacts_json TEXT NOT NULL DEFAULT '[]',
        payload_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (from_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY (to_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY (work_item_id) REFERENCES themis_agent_work_items(work_item_id) ON DELETE CASCADE,
        FOREIGN KEY (source_message_id) REFERENCES themis_agent_messages(message_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS themis_agent_handoffs_work_item_idx
      ON themis_agent_handoffs(work_item_id, created_at DESC, handoff_id DESC);

      CREATE INDEX IF NOT EXISTS themis_agent_handoffs_to_agent_idx
      ON themis_agent_handoffs(to_agent_id, created_at DESC, handoff_id DESC);

      CREATE INDEX IF NOT EXISTS themis_agent_handoffs_from_agent_idx
      ON themis_agent_handoffs(from_agent_id, created_at DESC, handoff_id DESC);

      CREATE TABLE IF NOT EXISTS themis_agent_mailboxes (
        mailbox_entry_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        owner_agent_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        work_item_id TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        requires_ack INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL,
        lease_token TEXT,
        leased_at TEXT,
        acked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (owner_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES themis_agent_messages(message_id) ON DELETE CASCADE,
        FOREIGN KEY (work_item_id) REFERENCES themis_agent_work_items(work_item_id) ON DELETE SET NULL,
        UNIQUE(owner_agent_id, message_id)
      );

      CREATE INDEX IF NOT EXISTS themis_agent_mailboxes_owner_idx
      ON themis_agent_mailboxes(owner_agent_id, status, created_at ASC, mailbox_entry_id ASC);

      CREATE INDEX IF NOT EXISTS themis_agent_mailboxes_work_item_idx
      ON themis_agent_mailboxes(work_item_id, status, created_at ASC, mailbox_entry_id ASC);

      CREATE TABLE IF NOT EXISTS themis_agent_audit_logs (
        audit_log_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_principal_id TEXT NOT NULL,
        subject_agent_id TEXT,
        suggestion_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES themis_organizations(organization_id) ON DELETE CASCADE,
        FOREIGN KEY (actor_principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE,
        FOREIGN KEY (subject_agent_id) REFERENCES themis_managed_agents(agent_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS themis_agent_audit_logs_organization_idx
      ON themis_agent_audit_logs(organization_id, created_at DESC, audit_log_id DESC);

      CREATE INDEX IF NOT EXISTS themis_agent_audit_logs_event_idx
      ON themis_agent_audit_logs(event_type, created_at DESC, audit_log_id DESC);
    `);
  }

  private repairActorMemorySchema(database: Database.Database): void {
    if (this.isActorMemorySchemaCurrent(database)) {
      return;
    }

    const foreignKeysEnabled = database.pragma("foreign_keys", { simple: true }) === 1;
    database.pragma("foreign_keys = OFF");

    try {
      const rebuild = database.transaction(() => {
        database.exec(`
          ALTER TABLE themis_actor_runtime_memory RENAME TO themis_actor_runtime_memory_legacy;
          ALTER TABLE themis_actor_task_scopes RENAME TO themis_actor_task_scopes_legacy;
          ALTER TABLE themis_principal_actors RENAME TO themis_principal_actors_legacy;
        `);

        this.createActorMemoryTables(database);

        database.exec(`
          INSERT INTO themis_principal_actors (
            actor_id,
            owner_principal_id,
            display_name,
            role,
            status,
            created_at,
            updated_at
          )
          SELECT
            actor_id,
            owner_principal_id,
            display_name,
            role,
            status,
            created_at,
            updated_at
          FROM themis_principal_actors_legacy;

          INSERT INTO themis_actor_task_scopes (
            scope_id,
            principal_id,
            actor_id,
            task_id,
            conversation_id,
            goal,
            workspace_path,
            status,
            created_at,
            updated_at
          )
          SELECT
            scope_id,
            principal_id,
            actor_id,
            task_id,
            conversation_id,
            goal,
            workspace_path,
            status,
            created_at,
            updated_at
          FROM themis_actor_task_scopes_legacy;

          INSERT INTO themis_actor_runtime_memory (
            runtime_memory_id,
            principal_id,
            actor_id,
            task_id,
            conversation_id,
            scope_id,
            kind,
            title,
            content,
            status,
            created_at
          )
          SELECT
            runtime_memory_id,
            principal_id,
            actor_id,
            task_id,
            conversation_id,
            scope_id,
            kind,
            title,
            content,
            status,
            created_at
          FROM themis_actor_runtime_memory_legacy;

          DROP TABLE themis_actor_runtime_memory_legacy;
          DROP TABLE themis_actor_task_scopes_legacy;
          DROP TABLE themis_principal_actors_legacy;
        `);

        const violations = database
          .prepare(`PRAGMA foreign_key_check`)
          .all() as Array<{ table: string; rowid: number; parent: string; fkid: number }>;

        if (violations.length > 0) {
          throw new Error(
            `Actor memory schema migration failed foreign key check: ${JSON.stringify(violations)}`,
          );
        }
      });

      rebuild();
    } finally {
      if (foreignKeysEnabled) {
        database.pragma("foreign_keys = ON");
      }
    }
  }

  private isActorMemorySchemaCurrent(database: Database.Database): boolean {
    const actorSql = this.readTableSql(database, "themis_principal_actors");
    const scopeSql = this.readTableSql(database, "themis_actor_task_scopes");
    const runtimeSql = this.readTableSql(database, "themis_actor_runtime_memory");

    if (!actorSql || !scopeSql || !runtimeSql) {
      return false;
    }

    return (
      /UNIQUE\s*\(\s*owner_principal_id\s*,\s*actor_id\s*\)/i.test(actorSql) &&
      /FOREIGN KEY\s*\(\s*principal_id\s*,\s*actor_id\s*\)\s*REFERENCES\s*themis_principal_actors\s*\(\s*owner_principal_id\s*,\s*actor_id\s*\)/i.test(scopeSql) &&
      /UNIQUE\s*\(\s*principal_id\s*,\s*scope_id\s*\)/i.test(scopeSql) &&
      /FOREIGN KEY\s*\(\s*principal_id\s*,\s*actor_id\s*\)\s*REFERENCES\s*themis_principal_actors\s*\(\s*owner_principal_id\s*,\s*actor_id\s*\)/i.test(runtimeSql) &&
      /FOREIGN KEY\s*\(\s*principal_id\s*,\s*scope_id\s*\)\s*REFERENCES\s*themis_actor_task_scopes\s*\(\s*principal_id\s*,\s*scope_id\s*\)/i.test(runtimeSql)
    );
  }

  private readTableSql(database: Database.Database, tableName: string): string | null {
    const row = database
      .prepare(
        `
          SELECT sql
          FROM sqlite_master
          WHERE type = 'table'
            AND name = ?
        `,
      )
      .get(tableName) as { sql: string | null } | undefined;

    return row?.sql ?? null;
  }

  private createScheduledTaskTables(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themis_scheduled_tasks (
        scheduled_task_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        source_channel TEXT NOT NULL,
        channel_user_id TEXT NOT NULL,
        display_name TEXT,
        session_id TEXT,
        channel_session_key TEXT,
        goal TEXT NOT NULL,
        input_text TEXT,
        options_json TEXT,
        automation_json TEXT,
        recurrence_json TEXT,
        watch_work_item_id TEXT,
        timezone TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL,
        last_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cancelled_at TEXT,
        completed_at TEXT,
        last_error TEXT,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_scheduled_tasks_principal_idx
      ON themis_scheduled_tasks(principal_id, updated_at DESC, scheduled_task_id ASC);

      CREATE INDEX IF NOT EXISTS themis_scheduled_tasks_due_idx
      ON themis_scheduled_tasks(status, scheduled_at ASC, scheduled_task_id ASC);

      CREATE TABLE IF NOT EXISTS themis_scheduled_task_runs (
        run_id TEXT PRIMARY KEY,
        scheduled_task_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        scheduler_id TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        status TEXT NOT NULL,
        request_id TEXT,
        task_id TEXT,
        triggered_at TEXT NOT NULL,
        started_at TEXT,
        last_heartbeat_at TEXT,
        completed_at TEXT,
        result_summary TEXT,
        result_output TEXT,
        structured_output_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (scheduled_task_id) REFERENCES themis_scheduled_tasks(scheduled_task_id) ON DELETE CASCADE,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_scheduled_task_runs_task_idx
      ON themis_scheduled_task_runs(scheduled_task_id, created_at DESC, run_id ASC);

      CREATE INDEX IF NOT EXISTS themis_scheduled_task_runs_principal_idx
      ON themis_scheduled_task_runs(principal_id, created_at DESC, run_id ASC);

      CREATE INDEX IF NOT EXISTS themis_scheduled_task_runs_scheduler_idx
      ON themis_scheduled_task_runs(scheduler_id, status, updated_at DESC, run_id ASC);

      CREATE INDEX IF NOT EXISTS themis_scheduled_task_runs_lease_idx
      ON themis_scheduled_task_runs(status, lease_expires_at ASC, run_id ASC);
    `);
  }

  private migrateSchema(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themis_principal_task_settings (
        principal_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_task_settings_updated_at_idx
      ON themis_principal_task_settings(updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_skills (
        principal_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        description TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref_json TEXT NOT NULL,
        managed_path TEXT NOT NULL,
        install_status TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_id, skill_name),
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_skill_materializations (
        principal_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_path TEXT NOT NULL,
        state TEXT NOT NULL,
        last_synced_at TEXT,
        last_error TEXT,
        PRIMARY KEY (principal_id, skill_name, target_kind, target_id),
        FOREIGN KEY (principal_id, skill_name)
          REFERENCES themis_principal_skills(principal_id, skill_name)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_mcp_servers (
        principal_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        transport_type TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        env_json TEXT NOT NULL,
        cwd TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        source_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (principal_id, server_name),
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_mcp_materializations (
        principal_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        state TEXT NOT NULL,
        auth_state TEXT NOT NULL,
        last_synced_at TEXT,
        last_error TEXT,
        PRIMARY KEY (principal_id, server_name, target_kind, target_id),
        FOREIGN KEY (principal_id, server_name)
          REFERENCES themis_principal_mcp_servers(principal_id, server_name)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_mcp_oauth_attempts (
        attempt_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL,
        authorization_url TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        last_error TEXT,
        FOREIGN KEY (principal_id, server_name)
          REFERENCES themis_principal_mcp_servers(principal_id, server_name)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_principal_mcp_oauth_attempts_latest_idx
      ON themis_principal_mcp_oauth_attempts(principal_id, server_name, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_principal_plugins (
        principal_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        plugin_name TEXT NOT NULL,
        marketplace_name TEXT NOT NULL,
        marketplace_path TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref_json TEXT NOT NULL,
        source_path TEXT,
        interface_json TEXT NOT NULL,
        install_policy TEXT NOT NULL,
        auth_policy TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT,
        PRIMARY KEY (principal_id, plugin_id),
        FOREIGN KEY (principal_id) REFERENCES themis_principals(principal_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_principal_plugin_materializations (
        principal_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        workspace_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL,
        last_synced_at TEXT,
        last_error TEXT,
        PRIMARY KEY (principal_id, plugin_id, target_kind, target_id, workspace_fingerprint),
        FOREIGN KEY (principal_id, plugin_id)
          REFERENCES themis_principal_plugins(principal_id, plugin_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS themis_web_access_tokens (
        token_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_kind TEXT NOT NULL DEFAULT 'web_login',
        owner_principal_id TEXT,
        service_role TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS themis_web_access_tokens_label_idx
      ON themis_web_access_tokens(label, updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS themis_web_access_tokens_active_label_idx
      ON themis_web_access_tokens(label)
      WHERE revoked_at IS NULL;

      CREATE INDEX IF NOT EXISTS themis_web_access_tokens_active_idx
      ON themis_web_access_tokens(revoked_at, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_web_sessions (
        session_id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (token_id) REFERENCES themis_web_access_tokens(token_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS themis_web_sessions_token_idx
      ON themis_web_sessions(token_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS themis_web_sessions_expires_idx
      ON themis_web_sessions(expires_at ASC);

      CREATE INDEX IF NOT EXISTS themis_web_sessions_revoked_idx
      ON themis_web_sessions(revoked_at, updated_at DESC);

      CREATE TABLE IF NOT EXISTS themis_web_audit_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        remote_ip TEXT,
        token_id TEXT,
        token_label TEXT,
        session_id TEXT,
        summary TEXT,
        payload_json TEXT,
        FOREIGN KEY (token_id) REFERENCES themis_web_access_tokens(token_id) ON DELETE SET NULL,
        FOREIGN KEY (session_id) REFERENCES themis_web_sessions(session_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS themis_web_audit_events_created_idx
      ON themis_web_audit_events(created_at DESC);
    `);
    const principalColumns = database
      .prepare(`PRAGMA table_info(themis_principals)`)
      .all() as Array<{ name: string }>;
    const principalColumnNames = new Set(principalColumns.map((column) => column.name));

    if (!principalColumnNames.has("principal_kind")) {
      database.exec(`
        ALTER TABLE themis_principals
        ADD COLUMN principal_kind TEXT NOT NULL DEFAULT 'human_user';
      `);
    }

    if (!principalColumnNames.has("organization_id")) {
      database.exec(`
        ALTER TABLE themis_principals
        ADD COLUMN organization_id TEXT;
      `);
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS themis_principals_kind_idx
      ON themis_principals(principal_kind, updated_at DESC);

      CREATE INDEX IF NOT EXISTS themis_principals_organization_idx
      ON themis_principals(organization_id, updated_at DESC);
    `);

    const webAccessTokenColumns = database
      .prepare(`PRAGMA table_info(themis_web_access_tokens)`)
      .all() as Array<{ name: string }>;
    const webAccessTokenColumnNames = new Set(webAccessTokenColumns.map((column) => column.name));

    if (!webAccessTokenColumnNames.has("token_kind")) {
      database.exec(`
        ALTER TABLE themis_web_access_tokens
        ADD COLUMN token_kind TEXT NOT NULL DEFAULT 'web_login';
      `);
    }

    if (!webAccessTokenColumnNames.has("owner_principal_id")) {
      database.exec(`
        ALTER TABLE themis_web_access_tokens
        ADD COLUMN owner_principal_id TEXT;
      `);
    }

    if (!webAccessTokenColumnNames.has("service_role")) {
      database.exec(`
        ALTER TABLE themis_web_access_tokens
        ADD COLUMN service_role TEXT;
      `);
    }

    this.createSessionHistoryMetadataTables(database);
    this.createTurnInputTables(database);
    this.createOperationsCenterTables(database);
    this.migrateOperationsCenterTables(database);
    this.createManagedAgentTables(database);
    this.createScheduledTaskTables(database);

    const scheduledTaskColumns = database
      .prepare(`PRAGMA table_info(themis_scheduled_tasks)`)
      .all() as Array<{ name: string }>;
    const scheduledTaskColumnNames = new Set(scheduledTaskColumns.map((column) => column.name));

    if (!scheduledTaskColumnNames.has("watch_work_item_id")) {
      database.exec(`
        ALTER TABLE themis_scheduled_tasks
        ADD COLUMN watch_work_item_id TEXT;
      `);
    }

    if (!scheduledTaskColumnNames.has("recurrence_json")) {
      database.exec(`
        ALTER TABLE themis_scheduled_tasks
        ADD COLUMN recurrence_json TEXT;
      `);
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS themis_scheduled_tasks_watch_idx
      ON themis_scheduled_tasks(status, watch_work_item_id, scheduled_at ASC, scheduled_task_id ASC);
    `);

    const agentWorkItemColumns = database
      .prepare(`PRAGMA table_info(themis_agent_work_items)`)
      .all() as Array<{ name: string }>;
    const agentWorkItemColumnNames = new Set(agentWorkItemColumns.map((column) => column.name));

    if (!agentWorkItemColumnNames.has("waiting_action_request_json")) {
      database.exec(`
        ALTER TABLE themis_agent_work_items
        ADD COLUMN waiting_action_request_json TEXT;
      `);
    }

    if (!agentWorkItemColumnNames.has("latest_human_response_json")) {
      database.exec(`
        ALTER TABLE themis_agent_work_items
        ADD COLUMN latest_human_response_json TEXT;
      `);
    }

    if (!agentWorkItemColumnNames.has("project_id")) {
      database.exec(`
        ALTER TABLE themis_agent_work_items
        ADD COLUMN project_id TEXT;
      `);
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS themis_agent_work_items_project_idx
      ON themis_agent_work_items(project_id, updated_at DESC, work_item_id ASC);
    `);

    const managedAgentColumns = database
      .prepare(`PRAGMA table_info(themis_managed_agents)`)
      .all() as Array<{ name: string }>;
    const managedAgentColumnNames = new Set(managedAgentColumns.map((column) => column.name));

    if (!managedAgentColumnNames.has("bootstrap_profile_json")) {
      database.exec(`
        ALTER TABLE themis_managed_agents
        ADD COLUMN bootstrap_profile_json TEXT;
      `);
    }

    if (!managedAgentColumnNames.has("bootstrapped_at")) {
      database.exec(`
        ALTER TABLE themis_managed_agents
        ADD COLUMN bootstrapped_at TEXT;
      `);
    }

    if (!managedAgentColumnNames.has("default_workspace_policy_id")) {
      database.exec(`
        ALTER TABLE themis_managed_agents
        ADD COLUMN default_workspace_policy_id TEXT;
      `);
    }

    if (!managedAgentColumnNames.has("default_runtime_profile_id")) {
      database.exec(`
        ALTER TABLE themis_managed_agents
        ADD COLUMN default_runtime_profile_id TEXT;
      `);
    }

    if (!managedAgentColumnNames.has("agent_card_json")) {
      database.exec(`
        ALTER TABLE themis_managed_agents
        ADD COLUMN agent_card_json TEXT;
      `);
    }

    const authAccountColumns = database
      .prepare(`PRAGMA table_info(themis_auth_accounts)`)
      .all() as Array<{ name: string }>;
    const columnNames = new Set(authAccountColumns.map((column) => column.name));

    if (!columnNames.has("account_email")) {
      database.exec(`
        ALTER TABLE themis_auth_accounts
        ADD COLUMN account_email TEXT;
      `);
    }

    const thirdPartyProviderColumns = database
      .prepare(`PRAGMA table_info(themis_third_party_providers)`)
      .all() as Array<{ name: string }>;
    const thirdPartyProviderColumnNames = new Set(thirdPartyProviderColumns.map((column) => column.name));

    if (!thirdPartyProviderColumnNames.has("endpoint_candidates_json")) {
      database.exec(`
        ALTER TABLE themis_third_party_providers
        ADD COLUMN endpoint_candidates_json TEXT NOT NULL DEFAULT '[]';
      `);
    }

    const webAuditColumns = database
      .prepare(`PRAGMA table_info(themis_web_audit_events)`)
      .all() as Array<{ name: string }>;
    const webAuditColumnNames = new Set(webAuditColumns.map((column) => column.name));

    if (!webAuditColumnNames.has("remote_ip")) {
      database.exec(`
        ALTER TABLE themis_web_audit_events
        ADD COLUMN remote_ip TEXT;
      `);
    }

    if (!webAuditColumnNames.has("summary")) {
      database.exec(`
        ALTER TABLE themis_web_audit_events
        ADD COLUMN summary TEXT;
      `);
    }

  }

  private migrateOperationsCenterTables(database: Database.Database): void {
    const commitmentColumns = database
      .prepare(`PRAGMA table_info(themis_principal_commitments)`)
      .all() as Array<{ name: string }>;
    const commitmentColumnNames = new Set(commitmentColumns.map((column) => column.name));

    if (!commitmentColumnNames.has("progress_percent")) {
      database.exec(`
        ALTER TABLE themis_principal_commitments
        ADD COLUMN progress_percent INTEGER NOT NULL DEFAULT 0;
      `);
    }

    if (!commitmentColumnNames.has("milestones_json")) {
      database.exec(`
        ALTER TABLE themis_principal_commitments
        ADD COLUMN milestones_json TEXT NOT NULL DEFAULT '[]';
      `);
    }

    if (!commitmentColumnNames.has("evidence_refs_json")) {
      database.exec(`
        ALTER TABLE themis_principal_commitments
        ADD COLUMN evidence_refs_json TEXT NOT NULL DEFAULT '[]';
      `);
    }
  }

  private createSessionHistoryMetadataTables(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themis_session_history_metadata (
        session_id TEXT PRIMARY KEY,
        archived_at TEXT,
        origin_kind TEXT NOT NULL DEFAULT 'standard',
        origin_session_id TEXT,
        origin_label TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS themis_session_history_metadata_archived_idx
      ON themis_session_history_metadata(archived_at, updated_at DESC);

      CREATE INDEX IF NOT EXISTS themis_session_history_metadata_origin_idx
      ON themis_session_history_metadata(origin_kind, updated_at DESC);
    `);
  }

  private readSessionHistoryMetadataRow(sessionId: string): {
    session_id: string;
    archived_at: string | null;
    origin_kind: string;
    origin_session_id: string | null;
    origin_label: string | null;
    created_at: string;
    updated_at: string;
  } | null {
    const normalized = sessionId.trim();

    if (!normalized) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT
            session_id,
            archived_at,
            origin_kind,
            origin_session_id,
            origin_label,
            created_at,
            updated_at
          FROM themis_session_history_metadata
          WHERE session_id = ?
        `,
      )
      .get(normalized) as {
        session_id: string;
        archived_at: string | null;
        origin_kind: string;
        origin_session_id: string | null;
        origin_label: string | null;
        created_at: string;
        updated_at: string;
      } | undefined;

    return row ?? null;
  }

  private writeSessionArchiveState(sessionId: string, archivedAt: string | null, updatedAt?: string): boolean {
    const normalized = sessionId.trim();
    const summary = this.getSessionHistorySummary(normalized);

    if (!normalized || !summary) {
      return false;
    }

    const existing = this.readSessionHistoryMetadataRow(normalized);
    const timestamp = archivedAt ?? updatedAt ?? new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO themis_session_history_metadata (
            session_id,
            archived_at,
            origin_kind,
            origin_session_id,
            origin_label,
            created_at,
            updated_at
          ) VALUES (
            @session_id,
            @archived_at,
            @origin_kind,
            @origin_session_id,
            @origin_label,
            @created_at,
            @updated_at
          )
          ON CONFLICT(session_id) DO UPDATE SET
            archived_at = excluded.archived_at,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        session_id: normalized,
        archived_at: archivedAt,
        origin_kind: normalizeSessionHistoryOriginKind(existing?.origin_kind ?? summary.originKind),
        origin_session_id: existing?.origin_session_id ?? summary.originSessionId ?? null,
        origin_label: existing?.origin_label ?? summary.originLabel ?? null,
        created_at: existing?.created_at ?? summary.createdAt,
        updated_at: updatedAt ?? timestamp,
      });

    return true;
  }

  private buildSessionSummaryQuery(options: {
    filter?: StoredSessionHistoryFilter;
    sessionId?: string;
    limit: number;
    includeArchived?: boolean;
  }): {
    sql: string;
    params: Array<string | number>;
  } {
    const groupedClauses = [
      "session_id IS NOT NULL",
      "session_id <> ''",
    ];
    const groupedParams: Array<string | number> = [];
    const filter = options.filter ?? {};

    if (typeof options.sessionId === "string" && options.sessionId.trim()) {
      groupedClauses.push("session_id = ?");
      groupedParams.push(options.sessionId.trim());
    }

    if (typeof filter.sourceChannel === "string" && filter.sourceChannel.trim()) {
      groupedClauses.push("source_channel = ?");
      groupedParams.push(filter.sourceChannel.trim());
    } else if (!options.sessionId) {
      groupedClauses.push("source_channel <> ?");
      groupedParams.push(MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL);
    }

    if (typeof filter.userId === "string" && filter.userId.trim()) {
      groupedClauses.push("user_id = ?");
      groupedParams.push(filter.userId.trim());
    }

    const outerClauses: string[] = [];
    const outerParams: Array<string | number> = [];
    const includeArchived = options.includeArchived ?? filter.includeArchived ?? false;

    if (!includeArchived) {
      outerClauses.push("metadata.archived_at IS NULL");
    }

    if (filter.originKind === "fork" || filter.originKind === "standard") {
      outerClauses.push("COALESCE(NULLIF(metadata.origin_kind, ''), 'standard') = ?");
      outerParams.push(filter.originKind);
    }

    const normalizedQuery = typeof filter.query === "string" ? filter.query.trim().toLowerCase() : "";
    if (normalizedQuery) {
      const likeQuery = `%${normalizedQuery}%`;
      outerClauses.push(`
        (
          LOWER(grouped.session_id) LIKE ?
          OR LOWER(COALESCE(latest.goal, '')) LIKE ?
          OR LOWER(COALESCE(latest.summary, '')) LIKE ?
          OR LOWER(COALESCE(metadata.origin_label, '')) LIKE ?
          OR LOWER(COALESCE(metadata.origin_session_id, '')) LIKE ?
          OR LOWER(COALESCE(NULLIF(cs.thread_id, ''), latest.codex_thread_id, '')) LIKE ?
        )
      `);
      outerParams.push(likeQuery, likeQuery, likeQuery, likeQuery, likeQuery, likeQuery);
    }

    const outerWhereClause = outerClauses.length > 0
      ? `WHERE ${outerClauses.join("\n          AND ")}`
      : "";

    return {
      sql: `
        SELECT
          grouped.session_id,
          grouped.created_at,
          grouped.updated_at,
          grouped.turn_count,
          metadata.archived_at,
          COALESCE(NULLIF(metadata.origin_kind, ''), 'standard') AS origin_kind,
          metadata.origin_session_id,
          metadata.origin_label,
          COALESCE(NULLIF(cs.thread_id, ''), latest.codex_thread_id) AS thread_id,
          latest.request_id AS latest_request_id,
          latest.task_id AS latest_task_id,
          latest.goal AS latest_goal,
          latest.status AS latest_status,
          latest.summary AS latest_summary,
          latest.session_mode AS latest_session_mode,
          latest.codex_thread_id AS latest_codex_thread_id,
          latest.updated_at AS latest_updated_at
        FROM (
          SELECT
            session_id,
            MIN(created_at) AS created_at,
            MAX(updated_at) AS updated_at,
            COUNT(*) AS turn_count
          FROM themis_turns
          WHERE ${groupedClauses.join("\n            AND ")}
          GROUP BY session_id
        ) grouped
        INNER JOIN themis_turns latest
          ON latest.request_id = (
            SELECT request_id
            FROM themis_turns latest_turn
            WHERE latest_turn.session_id = grouped.session_id
            ORDER BY latest_turn.updated_at DESC, latest_turn.created_at DESC, latest_turn.request_id DESC
            LIMIT 1
          )
        LEFT JOIN codex_sessions cs
          ON cs.session_id = grouped.session_id
        LEFT JOIN themis_session_history_metadata metadata
          ON metadata.session_id = grouped.session_id
        ${outerWhereClause}
        ORDER BY grouped.updated_at DESC
        LIMIT ?
      `,
      params: [...groupedParams, ...outerParams, options.limit],
    };
  }

  private createTurnInputTables(database: Database.Database): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themis_turn_inputs (
        request_id TEXT PRIMARY KEY,
        envelope_json TEXT NOT NULL,
        compile_summary_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS themis_turn_inputs_created_at_idx
      ON themis_turn_inputs(created_at DESC);

      CREATE TABLE IF NOT EXISTS themis_input_assets (
        request_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT,
        mime_type TEXT NOT NULL,
        local_path TEXT NOT NULL,
        size_bytes INTEGER,
        source_channel TEXT NOT NULL,
        source_message_id TEXT,
        ingestion_status TEXT NOT NULL,
        text_extraction_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (request_id, asset_id)
      );

      CREATE INDEX IF NOT EXISTS themis_input_assets_request_id_idx
      ON themis_input_assets(request_id, created_at ASC, asset_id ASC);
    `);
  }

  private createDatabaseConnection(): Database.Database {
    const database = new Database(this.databaseFile);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return database;
  }

  private readSchemaVersion(database: Database.Database): number {
    const version = database.pragma("user_version", { simple: true });
    return typeof version === "number" ? version : 0;
  }

  private countSessions(): number {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM codex_sessions
        `,
      )
      .get() as { total: number };

    return row.total;
  }
}

function mapSessionRow(row: SessionRow): StoredCodexSessionRecord {
  return {
    sessionId: row.session_id,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.active_task_id ? { activeTaskId: row.active_task_id } : {}),
  };
}

function mapWebAccessTokenRow(row: WebAccessTokenRow): StoredWebAccessTokenRecord {
  return {
    tokenId: row.token_id,
    label: row.label,
    tokenHash: row.token_hash,
    tokenKind: (row.token_kind as StoredWebAccessTokenRecord["tokenKind"]) ?? "web_login",
    ...(row.owner_principal_id ? { ownerPrincipalId: row.owner_principal_id } : {}),
    ...(row.service_role
      ? { serviceRole: row.service_role as NonNullable<StoredWebAccessTokenRecord["serviceRole"]> }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}

function mapWebSessionRow(row: WebSessionRow): StoredWebSessionRecord {
  return {
    sessionId: row.session_id,
    tokenId: row.token_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}

function mapWebAuditEventRow(row: WebAuditEventRow): StoredWebAuditEventRecord {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    createdAt: row.created_at,
    ...(row.remote_ip ? { remoteIp: row.remote_ip } : {}),
    ...(row.token_id ? { tokenId: row.token_id } : {}),
    ...(row.token_label ? { tokenLabel: row.token_label } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.payload_json ? { payloadJson: row.payload_json } : {}),
  };
}

function mapTurnRow(row: TurnRow): StoredTaskTurnRecord {
  return {
    requestId: row.request_id,
    taskId: row.task_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    sourceChannel: row.source_channel,
    userId: row.user_id,
    ...(row.user_display_name ? { userDisplayName: row.user_display_name } : {}),
    goal: row.goal,
    ...(row.input_text ? { inputText: row.input_text } : {}),
    ...(row.history_context ? { historyContext: row.history_context } : {}),
    ...(row.options_json ? { optionsJson: row.options_json } : {}),
    status: row.status,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.output ? { output: row.output } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.structured_output_json ? { structuredOutputJson: row.structured_output_json } : {}),
    ...(row.session_mode ? { sessionMode: row.session_mode } : {}),
    ...(row.codex_thread_id ? { codexThreadId: row.codex_thread_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function mapSessionTaskSettingsRow(row: SessionTaskSettingsRow): StoredSessionTaskSettingsRecord {
  const settings = normalizeSessionTaskSettings(safeParseJson(row.settings_json));

  return {
    sessionId: row.session_id,
    settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAuthAccountRow(row: AuthAccountRow): StoredAuthAccountRecord {
  return {
    accountId: row.account_id,
    label: row.label,
    ...(row.account_email ? { accountEmail: row.account_email } : {}),
    codexHome: row.codex_home,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalRow(row: PrincipalRow): StoredPrincipalRecord {
  const principalKind = normalizeText(row.principal_kind ?? undefined);
  const organizationId = normalizeText(row.organization_id ?? undefined);
  return {
    principalId: row.principal_id,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(principalKind && PRINCIPAL_KINDS.includes(principalKind as PrincipalKind)
      ? { kind: principalKind as PrincipalKind }
      : { kind: "human_user" }),
    ...(organizationId ? { organizationId } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOrganizationRow(row: OrganizationRow): StoredOrganizationRecord {
  return {
    organizationId: row.organization_id,
    ownerPrincipalId: row.owner_principal_id,
    displayName: row.display_name,
    slug: row.slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentSpawnPolicyRow(row: AgentSpawnPolicyRow): StoredAgentSpawnPolicyRecord {
  return {
    organizationId: row.organization_id,
    maxActiveAgents: row.max_active_agents,
    maxActiveAgentsPerRole: row.max_active_agents_per_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentSpawnSuggestionStateRow(
  row: AgentSpawnSuggestionStateRow,
): StoredAgentSpawnSuggestionStateRecord {
  return {
    suggestionId: row.suggestion_id,
    organizationId: row.organization_id,
    state: row.state as AgentSpawnSuggestionState,
    ...(row.payload_json ? { payload: safeParseJson(row.payload_json) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapManagedAgentRow(row: ManagedAgentRow): StoredManagedAgentRecord {
  const agentCard = row.agent_card_json
    ? normalizeManagedAgentCard(safeParseJson(row.agent_card_json))
    : undefined;
  const bootstrapProfile = row.bootstrap_profile_json
    ? normalizeManagedAgentBootstrapProfile(safeParseJson(row.bootstrap_profile_json))
    : undefined;

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
    status: row.status as ManagedAgentStatus,
    autonomyLevel: row.autonomy_level as ManagedAgentAutonomyLevel,
    creationMode: row.creation_mode as ManagedAgentCreationMode,
    exposurePolicy: row.exposure_policy as ManagedAgentExposurePolicy,
    ...(row.default_workspace_policy_id ? { defaultWorkspacePolicyId: row.default_workspace_policy_id } : {}),
    ...(row.default_runtime_profile_id ? { defaultRuntimeProfileId: row.default_runtime_profile_id } : {}),
    ...(agentCard ? { agentCard } : {}),
    ...(bootstrapProfile ? { bootstrapProfile } : {}),
    ...(row.bootstrapped_at ? { bootstrappedAt: row.bootstrapped_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentWorkspacePolicyRow(row: AgentWorkspacePolicyRow): StoredAgentWorkspacePolicyRecord {
  return {
    policyId: row.policy_id,
    organizationId: row.organization_id,
    ownerAgentId: row.owner_agent_id,
    displayName: row.display_name,
    workspacePath: row.workspace_path,
    additionalDirectories: normalizeStringArray(
      row.additional_directories_json ? safeParseJson(row.additional_directories_json) : [],
    ),
    allowNetworkAccess: row.allow_network_access === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentRuntimeProfileRow(row: AgentRuntimeProfileRow): StoredAgentRuntimeProfileRecord {
  const snapshot = normalizeManagedAgentRuntimeProfileSnapshot(safeParseJson(row.snapshot_json)) ?? {};

  return {
    profileId: row.profile_id,
    organizationId: row.organization_id,
    ownerAgentId: row.owner_agent_id,
    displayName: row.display_name,
    ...snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentWorkItemRow(row: AgentWorkItemRow): StoredAgentWorkItemRecord {
  const workspacePolicySnapshot = row.workspace_policy_snapshot_json
    ? normalizeManagedAgentWorkspacePolicySnapshot(safeParseJson(row.workspace_policy_snapshot_json))
    : undefined;
  const runtimeProfileSnapshot = row.runtime_profile_snapshot_json
    ? normalizeManagedAgentRuntimeProfileSnapshot(safeParseJson(row.runtime_profile_snapshot_json))
    : undefined;

  return {
    workItemId: row.work_item_id,
    organizationId: row.organization_id,
    targetAgentId: row.target_agent_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    sourceType: row.source_type as ManagedAgentWorkItemSourceType,
    sourcePrincipalId: row.source_principal_id,
    ...(row.source_agent_id ? { sourceAgentId: row.source_agent_id } : {}),
    ...(row.parent_work_item_id ? { parentWorkItemId: row.parent_work_item_id } : {}),
    dispatchReason: row.dispatch_reason,
    goal: row.goal,
    ...(row.context_packet_json ? { contextPacket: safeParseJson(row.context_packet_json) } : {}),
    ...(row.waiting_action_request_json
      ? { waitingActionRequest: safeParseJson(row.waiting_action_request_json) }
      : {}),
    ...(row.latest_human_response_json
      ? { latestHumanResponse: safeParseJson(row.latest_human_response_json) }
      : {}),
    priority: row.priority as ManagedAgentPriority,
    status: row.status as ManagedAgentWorkItemStatus,
    ...(workspacePolicySnapshot ? { workspacePolicySnapshot } : {}),
    ...(runtimeProfileSnapshot ? { runtimeProfileSnapshot } : {}),
    createdAt: row.created_at,
    ...(row.scheduled_at ? { scheduledAt: row.scheduled_at } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    updatedAt: row.updated_at,
  };
}

function mapProjectWorkspaceBindingRow(row: ProjectWorkspaceBindingRow): StoredProjectWorkspaceBindingRecord {
  const continuityMode = PROJECT_WORKSPACE_CONTINUITY_MODES.includes(row.continuity_mode as ProjectWorkspaceContinuityMode)
    ? row.continuity_mode as ProjectWorkspaceContinuityMode
    : "sticky";

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
    continuityMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    leaseExpiresAt: row.lease_expires_at,
    status: row.status as AgentRunStatus,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.last_heartbeat_at ? { lastHeartbeatAt: row.last_heartbeat_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapManagedAgentNodeRow(row: ManagedAgentNodeRow): StoredManagedAgentNodeRecord {
  return {
    nodeId: row.node_id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    status: row.status as ManagedAgentNodeStatus,
    slotCapacity: row.slot_capacity,
    slotAvailable: row.slot_available,
    labels: normalizeStringArray(row.labels_json ? safeParseJson(row.labels_json) : []),
    workspaceCapabilities: normalizeStringArray(
      row.workspace_capabilities_json ? safeParseJson(row.workspace_capabilities_json) : [],
    ),
    credentialCapabilities: normalizeStringArray(
      row.credential_capabilities_json ? safeParseJson(row.credential_capabilities_json) : [],
    ),
    providerCapabilities: normalizeStringArray(
      row.provider_capabilities_json ? safeParseJson(row.provider_capabilities_json) : [],
    ),
    heartbeatTtlSeconds: row.heartbeat_ttl_seconds,
    lastHeartbeatAt: row.last_heartbeat_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentExecutionLeaseRow(row: AgentExecutionLeaseRow): StoredAgentExecutionLeaseRecord {
  return {
    leaseId: row.lease_id,
    runId: row.run_id,
    workItemId: row.work_item_id,
    targetAgentId: row.target_agent_id,
    nodeId: row.node_id,
    status: row.status as AgentExecutionLeaseStatus,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    ...(row.last_heartbeat_at ? { lastHeartbeatAt: row.last_heartbeat_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapScheduledTaskRow(row: ScheduledTaskRow): StoredScheduledTaskRecord {
  const options = row.options_json ? safeParseJson(row.options_json) : null;
  const automation = row.automation_json ? safeParseJson(row.automation_json) : null;
  const recurrence = row.recurrence_json ? safeParseJson(row.recurrence_json) : null;

  return {
    scheduledTaskId: row.scheduled_task_id,
    principalId: row.principal_id,
    sourceChannel: row.source_channel,
    channelUserId: row.channel_user_id,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.channel_session_key ? { channelSessionKey: row.channel_session_key } : {}),
    goal: row.goal,
    ...(row.input_text ? { inputText: row.input_text } : {}),
    ...(options && typeof options === "object"
      ? { options: options as NonNullable<StoredScheduledTaskRecord["options"]> }
      : {}),
    ...(automation && typeof automation === "object"
      ? { automation: automation as NonNullable<StoredScheduledTaskRecord["automation"]> }
      : {}),
    ...(recurrence && typeof recurrence === "object"
      ? { recurrence: recurrence as NonNullable<StoredScheduledTaskRecord["recurrence"]> }
      : {}),
    ...(row.watch_work_item_id ? { watch: { workItemId: row.watch_work_item_id } } : {}),
    timezone: row.timezone,
    scheduledAt: row.scheduled_at,
    status: row.status as ScheduledTaskStatus,
    ...(row.last_run_id ? { lastRunId: row.last_run_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function mapScheduledTaskRunRow(row: ScheduledTaskRunRow): StoredScheduledTaskRunRecord {
  return {
    runId: row.run_id,
    scheduledTaskId: row.scheduled_task_id,
    principalId: row.principal_id,
    schedulerId: row.scheduler_id,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    status: row.status as ScheduledTaskRunStatus,
    ...(row.request_id ? { requestId: row.request_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    triggeredAt: row.triggered_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.last_heartbeat_at ? { lastHeartbeatAt: row.last_heartbeat_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.result_summary ? { resultSummary: row.result_summary } : {}),
    ...(row.result_output ? { resultOutput: row.result_output } : {}),
    ...(row.structured_output_json
      ? { structuredOutput: safeParseJson(row.structured_output_json) as Record<string, unknown> }
      : {}),
    ...(row.error_json ? { error: safeParseJson(row.error_json) as Record<string, unknown> } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentAuditLogRow(row: AgentAuditLogRow): StoredAgentAuditLogRecord {
  return {
    auditLogId: row.audit_log_id,
    organizationId: row.organization_id,
    eventType: row.event_type as AgentAuditLogEventType,
    actorPrincipalId: row.actor_principal_id,
    ...(row.subject_agent_id ? { subjectAgentId: row.subject_agent_id } : {}),
    ...(row.suggestion_id ? { suggestionId: row.suggestion_id } : {}),
    summary: row.summary,
    ...(row.payload_json ? { payload: safeParseJson(row.payload_json) } : {}),
    createdAt: row.created_at,
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
    messageType: row.message_type as AgentMessageType,
    ...(row.payload_json ? { payload: safeParseJson(row.payload_json) } : {}),
    artifactRefs: normalizeStringArray(safeParseJson(row.artifact_refs_json ?? "[]")),
    priority: row.priority as ManagedAgentPriority,
    requiresAck: row.requires_ack === 1,
    createdAt: row.created_at,
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
    blockers: normalizeStringArray(safeParseJson(row.blockers_json ?? "[]")),
    recommendedNextActions: normalizeStringArray(safeParseJson(row.recommended_next_actions_json ?? "[]")),
    attachedArtifacts: normalizeStringArray(safeParseJson(row.attached_artifacts_json ?? "[]")),
    ...(row.payload_json ? { payload: safeParseJson(row.payload_json) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentMailboxEntryRow(row: AgentMailboxEntryRow): StoredAgentMailboxEntryRecord {
  return {
    mailboxEntryId: row.mailbox_entry_id,
    organizationId: row.organization_id,
    ownerAgentId: row.owner_agent_id,
    messageId: row.message_id,
    ...(row.work_item_id ? { workItemId: row.work_item_id } : {}),
    priority: row.priority as ManagedAgentPriority,
    status: row.status as AgentMailboxStatus,
    requiresAck: row.requires_ack === 1,
    availableAt: row.available_at,
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.leased_at ? { leasedAt: row.leased_at } : {}),
    ...(row.acked_at ? { ackedAt: row.acked_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalActorRow(row: PrincipalActorRow): StoredPrincipalActorRecord {
  return {
    actorId: row.actor_id,
    ownerPrincipalId: row.owner_principal_id,
    displayName: row.display_name,
    role: row.role,
    status: row.status as PrincipalActorStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalAssetRow(row: PrincipalAssetRow): StoredPrincipalAssetRecord {
  return {
    assetId: row.asset_id,
    principalId: row.principal_id,
    kind: row.kind as StoredPrincipalAssetRecord["kind"],
    name: row.name,
    status: row.status as StoredPrincipalAssetRecord["status"],
    ...(row.owner_principal_id ? { ownerPrincipalId: row.owner_principal_id } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    tags: normalizePrincipalAssetTags(row.tags_json ? safeParseJson(row.tags_json) : []),
    refs: normalizePrincipalAssetRefs(row.refs_json ? safeParseJson(row.refs_json) : []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalDecisionRow(row: PrincipalDecisionRow): StoredPrincipalDecisionRecord {
  return {
    decisionId: row.decision_id,
    principalId: row.principal_id,
    title: row.title,
    status: row.status as StoredPrincipalDecisionRecord["status"],
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.decided_by_principal_id ? { decidedByPrincipalId: row.decided_by_principal_id } : {}),
    decidedAt: row.decided_at,
    relatedAssetIds: normalizePrincipalDecisionRelatedIds(
      row.related_asset_ids_json ? safeParseJson(row.related_asset_ids_json) : [],
    ),
    relatedWorkItemIds: normalizePrincipalDecisionRelatedIds(
      row.related_work_item_ids_json ? safeParseJson(row.related_work_item_ids_json) : [],
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalRiskRow(row: PrincipalRiskRow): StoredPrincipalRiskRecord {
  return {
    riskId: row.risk_id,
    principalId: row.principal_id,
    type: row.type as StoredPrincipalRiskRecord["type"],
    title: row.title,
    severity: row.severity as StoredPrincipalRiskRecord["severity"],
    status: row.status as StoredPrincipalRiskRecord["status"],
    ...(row.owner_principal_id ? { ownerPrincipalId: row.owner_principal_id } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    detectedAt: row.detected_at,
    relatedAssetIds: normalizePrincipalRiskRelatedIds(
      row.related_asset_ids_json ? safeParseJson(row.related_asset_ids_json) : [],
    ),
    linkedDecisionIds: normalizePrincipalRiskRelatedIds(
      row.linked_decision_ids_json ? safeParseJson(row.linked_decision_ids_json) : [],
    ),
    relatedWorkItemIds: normalizePrincipalRiskRelatedIds(
      row.related_work_item_ids_json ? safeParseJson(row.related_work_item_ids_json) : [],
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalCadenceRow(row: PrincipalCadenceRow): StoredPrincipalCadenceRecord {
  return {
    cadenceId: row.cadence_id,
    principalId: row.principal_id,
    title: row.title,
    frequency: row.frequency as StoredPrincipalCadenceRecord["frequency"],
    status: row.status as StoredPrincipalCadenceRecord["status"],
    nextRunAt: row.next_run_at,
    ...(row.owner_principal_id ? { ownerPrincipalId: row.owner_principal_id } : {}),
    ...(row.playbook_ref ? { playbookRef: row.playbook_ref } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    relatedAssetIds: normalizePrincipalCadenceRelatedIds(
      row.related_asset_ids_json ? safeParseJson(row.related_asset_ids_json) : [],
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalCommitmentRow(row: PrincipalCommitmentRow): StoredPrincipalCommitmentRecord {
  return {
    commitmentId: row.commitment_id,
    principalId: row.principal_id,
    title: row.title,
    status: row.status as StoredPrincipalCommitmentRecord["status"],
    ...(row.owner_principal_id ? { ownerPrincipalId: row.owner_principal_id } : {}),
    ...(row.starts_at ? { startsAt: row.starts_at } : {}),
    dueAt: row.due_at,
    progressPercent: normalizePrincipalCommitmentProgressPercent(row.progress_percent),
    ...(row.summary ? { summary: row.summary } : {}),
    milestones: normalizePrincipalCommitmentMilestones(
      row.milestones_json ? safeParseJson(row.milestones_json) : [],
    ),
    evidenceRefs: normalizePrincipalCommitmentEvidenceRefs(
      row.evidence_refs_json ? safeParseJson(row.evidence_refs_json) : [],
    ),
    relatedAssetIds: normalizePrincipalCommitmentRelatedIds(
      row.related_asset_ids_json ? safeParseJson(row.related_asset_ids_json) : [],
    ),
    linkedDecisionIds: normalizePrincipalCommitmentRelatedIds(
      row.linked_decision_ids_json ? safeParseJson(row.linked_decision_ids_json) : [],
    ),
    linkedRiskIds: normalizePrincipalCommitmentRelatedIds(
      row.linked_risk_ids_json ? safeParseJson(row.linked_risk_ids_json) : [],
    ),
    relatedCadenceIds: normalizePrincipalCommitmentRelatedIds(
      row.related_cadence_ids_json ? safeParseJson(row.related_cadence_ids_json) : [],
    ),
    relatedWorkItemIds: normalizePrincipalCommitmentRelatedIds(
      row.related_work_item_ids_json ? safeParseJson(row.related_work_item_ids_json) : [],
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalOperationEdgeRow(row: PrincipalOperationEdgeRow): StoredPrincipalOperationEdgeRecord {
  return {
    edgeId: row.edge_id,
    principalId: row.principal_id,
    fromObjectType: row.from_object_type as StoredPrincipalOperationEdgeRecord["fromObjectType"],
    fromObjectId: row.from_object_id,
    toObjectType: row.to_object_type as StoredPrincipalOperationEdgeRecord["toObjectType"],
    toObjectId: row.to_object_id,
    relationType: row.relation_type as StoredPrincipalOperationEdgeRecord["relationType"],
    status: row.status as StoredPrincipalOperationEdgeRecord["status"],
    ...(row.label ? { label: row.label } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalMainMemoryRow(row: PrincipalMainMemoryRow): StoredPrincipalMainMemoryRecord {
  return {
    memoryId: row.memory_id,
    principalId: row.principal_id,
    kind: row.kind as PrincipalMainMemoryKind,
    title: row.title,
    summary: row.summary,
    bodyMarkdown: row.body_markdown,
    sourceType: row.source_type as PrincipalMainMemorySourceType,
    status: row.status as PrincipalMainMemoryStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalMainMemoryCandidateRow(
  row: PrincipalMainMemoryCandidateRow,
): StoredPrincipalMainMemoryCandidateRecord {
  return {
    candidateId: row.candidate_id,
    principalId: row.principal_id,
    kind: row.kind as PrincipalMainMemoryKind,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    suggestedContent: row.suggested_content,
    sourceType: row.source_type as PrincipalMainMemorySourceType,
    sourceLabel: row.source_label,
    ...(row.source_task_id ? { sourceTaskId: row.source_task_id } : {}),
    ...(row.source_conversation_id ? { sourceConversationId: row.source_conversation_id } : {}),
    status: row.status as PrincipalMainMemoryCandidateStatus,
    ...(row.approved_memory_id ? { approvedMemoryId: row.approved_memory_id } : {}),
    ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActorTaskScopeRow(row: ActorTaskScopeRow): StoredActorTaskScopeRecord {
  return {
    scopeId: row.scope_id,
    principalId: row.principal_id,
    actorId: row.actor_id,
    taskId: row.task_id,
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    goal: row.goal,
    ...(row.workspace_path ? { workspacePath: row.workspace_path } : {}),
    status: row.status as ActorTaskScopeStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActorRuntimeMemoryRow(row: ActorRuntimeMemoryRow): StoredActorRuntimeMemoryRecord {
  return {
    runtimeMemoryId: row.runtime_memory_id,
    principalId: row.principal_id,
    actorId: row.actor_id,
    taskId: row.task_id,
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    scopeId: row.scope_id,
    kind: row.kind as ActorRuntimeMemoryKind,
    title: row.title,
    content: row.content,
    status: row.status as ActorRuntimeMemoryStatus,
    createdAt: row.created_at,
  };
}

function mapPrincipalTaskSettingsRow(row: PrincipalTaskSettingsRow): StoredPrincipalTaskSettingsRecord {
  return {
    principalId: row.principal_id,
    settings: normalizePrincipalTaskSettings(safeParseJson(row.settings_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalSkillRow(row: PrincipalSkillRow): StoredPrincipalSkillRecord {
  return {
    principalId: row.principal_id,
    skillName: row.skill_name,
    description: row.description,
    sourceType: row.source_type as StoredPrincipalSkillRecord["sourceType"],
    sourceRefJson: row.source_ref_json,
    managedPath: row.managed_path,
    installStatus: row.install_status as StoredPrincipalSkillRecord["installStatus"],
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalSkillMaterializationRow(
  row: PrincipalSkillMaterializationRow,
): StoredPrincipalSkillMaterializationRecord {
  return {
    principalId: row.principal_id,
    skillName: row.skill_name,
    targetKind: row.target_kind as StoredPrincipalSkillMaterializationRecord["targetKind"],
    targetId: row.target_id,
    targetPath: row.target_path,
    state: row.state as StoredPrincipalSkillMaterializationRecord["state"],
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function mapPrincipalMcpServerRow(row: PrincipalMcpServerRow): StoredPrincipalMcpServerRecord {
  return {
    principalId: row.principal_id,
    serverName: row.server_name,
    transportType: row.transport_type as StoredPrincipalMcpServerRecord["transportType"],
    command: row.command,
    argsJson: row.args_json,
    envJson: row.env_json,
    ...(row.cwd ? { cwd: row.cwd } : {}),
    enabled: row.enabled === 1,
    sourceType: row.source_type as StoredPrincipalMcpServerRecord["sourceType"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPrincipalMcpMaterializationRow(
  row: PrincipalMcpMaterializationRow,
): StoredPrincipalMcpMaterializationRecord {
  return {
    principalId: row.principal_id,
    serverName: row.server_name,
    targetKind: row.target_kind as StoredPrincipalMcpMaterializationRecord["targetKind"],
    targetId: row.target_id,
    state: row.state as StoredPrincipalMcpMaterializationRecord["state"],
    authState: row.auth_state as StoredPrincipalMcpMaterializationRecord["authState"],
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function mapPrincipalMcpOauthAttemptRow(row: PrincipalMcpOauthAttemptRow): StoredPrincipalMcpOauthAttemptRecord {
  return {
    attemptId: row.attempt_id,
    principalId: row.principal_id,
    serverName: row.server_name,
    targetKind: row.target_kind as StoredPrincipalMcpOauthAttemptRecord["targetKind"],
    targetId: row.target_id,
    status: row.status as StoredPrincipalMcpOauthAttemptRecord["status"],
    authorizationUrl: row.authorization_url,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function mapPrincipalPluginRow(row: PrincipalPluginRow): StoredPrincipalPluginRecord {
  return {
    principalId: row.principal_id,
    pluginId: row.plugin_id,
    pluginName: row.plugin_name,
    marketplaceName: row.marketplace_name,
    marketplacePath: row.marketplace_path,
    sourceType: row.source_type as StoredPrincipalPluginRecord["sourceType"],
    sourceRefJson: row.source_ref_json,
    ...(row.source_path ? { sourcePath: row.source_path } : {}),
    interfaceJson: row.interface_json,
    installPolicy: row.install_policy as StoredPrincipalPluginRecord["installPolicy"],
    authPolicy: row.auth_policy as StoredPrincipalPluginRecord["authPolicy"],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function mapPrincipalPluginMaterializationRow(
  row: PrincipalPluginMaterializationRow,
): StoredPrincipalPluginMaterializationRecord {
  return {
    principalId: row.principal_id,
    pluginId: row.plugin_id,
    targetKind: row.target_kind as StoredPrincipalPluginMaterializationRecord["targetKind"],
    targetId: row.target_id,
    workspaceFingerprint: row.workspace_fingerprint,
    state: row.state as StoredPrincipalPluginMaterializationRecord["state"],
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

function mapPrincipalPersonaProfileRow(row: PrincipalPersonaProfileRow): StoredPrincipalPersonaProfileRecord {
  return {
    principalId: row.principal_id,
    profile: normalizePrincipalPersonaProfileData(safeParseJson(row.profile_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapPrincipalPersonaOnboardingRow(
  row: PrincipalPersonaOnboardingRow,
): StoredPrincipalPersonaOnboardingRecord {
  return {
    principalId: row.principal_id,
    state: normalizePrincipalPersonaOnboardingState(safeParseJson(row.state_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversationRow(row: ConversationRow): StoredConversationRecord {
  return {
    conversationId: row.conversation_id,
    principalId: row.principal_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChannelIdentityRow(row: ChannelIdentityRow): StoredChannelIdentityRecord {
  return {
    channel: row.channel,
    channelUserId: row.channel_user_id,
    principalId: row.principal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChannelConversationBindingRow(
  row: ChannelConversationBindingRow,
): StoredChannelConversationBindingRecord {
  return {
    channel: row.channel,
    principalId: row.principal_id,
    channelSessionKey: row.channel_session_key,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIdentityLinkCodeRow(row: IdentityLinkCodeRow): StoredIdentityLinkCodeRecord {
  return {
    code: row.code,
    sourceChannel: row.source_channel,
    sourceChannelUserId: row.source_channel_user_id,
    sourcePrincipalId: row.source_principal_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.consumed_at ? { consumedAt: row.consumed_at } : {}),
    ...(row.consumed_by_channel ? { consumedByChannel: row.consumed_by_channel } : {}),
    ...(row.consumed_by_user_id ? { consumedByUserId: row.consumed_by_user_id } : {}),
  };
}

function mapEventRow(row: EventRow): StoredTaskEventRecord {
  return {
    eventId: row.event_id,
    requestId: row.request_id,
    taskId: row.task_id,
    type: row.event_type,
    status: row.status,
    ...(row.message ? { message: row.message } : {}),
    ...(row.payload_json ? { payloadJson: row.payload_json } : {}),
    createdAt: row.created_at,
  };
}

function mapSessionSummaryRow(row: SessionSummaryRow): StoredSessionHistorySummary {
  const threadId = normalizeText(row.thread_id ?? undefined);
  const archivedAt = normalizeText(row.archived_at ?? undefined);
  const originSessionId = normalizeText(row.origin_session_id ?? undefined);
  const originLabel = normalizeText(row.origin_label ?? undefined);

  return {
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turnCount: row.turn_count,
    originKind: normalizeSessionHistoryOriginKind(row.origin_kind),
    ...(archivedAt ? { archivedAt } : {}),
    ...(originSessionId ? { originSessionId } : {}),
    ...(originLabel ? { originLabel } : {}),
    ...(threadId ? { threadId } : {}),
    latestTurn: {
      requestId: row.latest_request_id,
      taskId: row.latest_task_id,
      goal: row.latest_goal,
      status: row.latest_status,
      ...(row.latest_summary ? { summary: row.latest_summary } : {}),
      ...(row.latest_session_mode ? { sessionMode: row.latest_session_mode } : {}),
      ...(row.latest_codex_thread_id ? { codexThreadId: row.latest_codex_thread_id } : {}),
      updatedAt: row.latest_updated_at,
    },
  };
}

function normalizeSessionHistoryOriginKind(value: string | undefined | null): "standard" | "fork" {
  return value === "fork" ? "fork" : "standard";
}

function mapInputAssetRow(row: InputAssetRow): TaskInputAsset {
  const asset: TaskInputAsset = {
    assetId: row.asset_id,
    kind: row.kind === "document" ? "document" : "image",
    mimeType: row.mime_type,
    localPath: row.local_path,
    sourceChannel: row.source_channel as TaskInputAsset["sourceChannel"],
    ingestionStatus: row.ingestion_status as TaskInputAsset["ingestionStatus"],
  };

  if (row.name) {
    asset.name = row.name;
  }

  if (typeof row.size_bytes === "number") {
    asset.sizeBytes = row.size_bytes;
  }

  if (row.source_message_id) {
    asset.sourceMessageId = row.source_message_id;
  }

  const textExtraction = normalizeTaskInputTextExtraction(safeParseJson(row.text_extraction_json ?? ""));
  if (textExtraction !== undefined) {
    asset.textExtraction = textExtraction;
  }

  const metadata = normalizeTaskInputMetadata(safeParseJson(row.metadata_json ?? ""));
  if (metadata !== undefined) {
    asset.metadata = metadata;
  }

  return asset;
}

function mapChannelInputAssetRow(row: ChannelInputAssetRow): StoredChannelInputAssetRecord {
  return {
    requestId: row.request_id,
    assetId: row.asset_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    sourceChannel: row.turn_source_channel,
    userId: row.user_id,
    kind: row.kind === "document" ? "document" : "image",
    ...(row.name ? { name: row.name } : {}),
    mimeType: row.mime_type,
    localPath: row.local_path,
    ...(typeof row.size_bytes === "number" ? { sizeBytes: row.size_bytes } : {}),
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    ingestionStatus: row.ingestion_status,
    createdAt: row.created_at,
  };
}

function normalizeTaskInputEnvelope(value: unknown): TaskInputEnvelope {
  const fallback: TaskInputEnvelope = {
    envelopeId: "",
    sourceChannel: "web",
    parts: [],
    assets: [],
    createdAt: new Date(0).toISOString(),
  };

  if (!isRecord(value)) {
    return fallback;
  }

  const envelopeId = normalizeText(typeof value.envelopeId === "string" ? value.envelopeId : undefined) ?? fallback.envelopeId;
  const sourceChannel = normalizeText(typeof value.sourceChannel === "string" ? value.sourceChannel : undefined) ?? fallback.sourceChannel;
  const sourceSessionId = normalizeText(typeof value.sourceSessionId === "string" ? value.sourceSessionId : undefined);
  const sourceMessageId = normalizeText(typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined);
  const createdAt = normalizeText(typeof value.createdAt === "string" ? value.createdAt : undefined) ?? fallback.createdAt;
  const parts = Array.isArray(value.parts)
    ? value.parts
      .map(normalizeTaskInputPart)
      .filter((part): part is TaskInputEnvelope["parts"][number] => part !== null)
    : fallback.parts;
  const assets = Array.isArray(value.assets)
    ? value.assets
      .map(normalizeTaskInputAsset)
      .filter((asset): asset is TaskInputAsset => asset !== null)
    : fallback.assets;

  return {
    envelopeId,
    sourceChannel: sourceChannel as TaskInputEnvelope["sourceChannel"],
    ...(sourceSessionId ? { sourceSessionId } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
    parts,
    assets,
    createdAt,
  };
}

function normalizeTaskInputPart(value: unknown): TaskInputEnvelope["parts"][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const partId = normalizeText(typeof value.partId === "string" ? value.partId : undefined);
  const order = typeof value.order === "number" && Number.isFinite(value.order) ? value.order : null;

  if (!partId || order === null) {
    return null;
  }

  if (value.type === "text") {
    const text = readRawString(value.text);

    if (text === null) {
      return null;
    }

    return {
      partId,
      type: "text",
      role: "user",
      order,
      text,
    };
  }

  if (value.type !== "image" && value.type !== "document") {
    return null;
  }

  const assetId = normalizeText(typeof value.assetId === "string" ? value.assetId : undefined);

  if (!assetId) {
    return null;
  }

  const caption = readRawString(value.caption);

  return {
    partId,
    type: value.type,
    role: "user",
    order,
    assetId,
    ...(caption !== null ? { caption } : {}),
  };
}

function normalizeTaskInputAsset(value: unknown): TaskInputAsset | null {
  if (!isRecord(value)) {
    return null;
  }

  const assetId = normalizeText(typeof value.assetId === "string" ? value.assetId : undefined);
  const kind = value.kind === "document" ? "document" : value.kind === "image" ? "image" : null;
  const mimeType = normalizeText(typeof value.mimeType === "string" ? value.mimeType : undefined);
  const localPath = normalizeText(typeof value.localPath === "string" ? value.localPath : undefined);
  const sourceChannel = normalizeText(typeof value.sourceChannel === "string" ? value.sourceChannel : undefined);
  const ingestionStatus = value.ingestionStatus === "processing" || value.ingestionStatus === "failed"
    ? value.ingestionStatus
    : value.ingestionStatus === "ready"
      ? "ready"
      : null;

  if (!assetId || !kind || !mimeType || !localPath || !sourceChannel || !ingestionStatus) {
    return null;
  }

  const asset: TaskInputAsset = {
    assetId,
    kind,
    mimeType,
    localPath,
    sourceChannel: sourceChannel as TaskInputAsset["sourceChannel"],
    ingestionStatus,
  };

  const name = normalizeText(typeof value.name === "string" ? value.name : undefined);
  if (name) {
    asset.name = name;
  }

  if (typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes)) {
    asset.sizeBytes = value.sizeBytes;
  }

  const sourceMessageId = normalizeText(typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined);
  if (sourceMessageId) {
    asset.sourceMessageId = sourceMessageId;
  }

  const textExtraction = normalizeTaskInputTextExtraction(value.textExtraction);
  if (textExtraction !== undefined) {
    asset.textExtraction = textExtraction;
  }

  const metadata = normalizeTaskInputMetadata(value.metadata);
  if (metadata !== undefined) {
    asset.metadata = metadata;
  }

  return asset;
}

function normalizeTurnInputCompileSummary(value: unknown): StoredTurnInputCompileSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const runtimeTarget = normalizeText(typeof value.runtimeTarget === "string" ? value.runtimeTarget : undefined);

  if (!runtimeTarget) {
    return null;
  }

  const degradationLevel = value.degradationLevel === "lossless_textualization" ||
      value.degradationLevel === "controlled_fallback" ||
      value.degradationLevel === "blocked"
    ? value.degradationLevel
    : value.degradationLevel === "native"
      ? "native"
      : null;

  if (degradationLevel === null) {
    return null;
  }

  const warnings = Array.isArray(value.warnings)
    ? value.warnings
      .map(normalizeTurnInputCompileWarning)
      .filter((warning): warning is StoredTurnInputCompileWarning => warning !== null)
    : null;

  if (warnings === null) {
    return null;
  }

  const capabilityMatrix = normalizeTurnInputCompileCapabilityMatrix(value.capabilityMatrix);

  return {
    runtimeTarget,
    degradationLevel,
    warnings,
    ...(capabilityMatrix ? { capabilityMatrix } : {}),
  };
}

function readRawString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeTurnInputCompileWarning(value: unknown): StoredTurnInputCompileWarning | null {
  if (!isRecord(value)) {
    return null;
  }

  const code = normalizeText(typeof value.code === "string" ? value.code : undefined);
  const message = normalizeText(typeof value.message === "string" ? value.message : undefined);

  if (!code || !message) {
    return null;
  }

  const assetId = normalizeText(typeof value.assetId === "string" ? value.assetId : undefined);

  return {
    code,
    message,
    ...(assetId ? { assetId } : {}),
  };
}

function normalizeTurnInputCompileCapabilityMatrix(
  value: unknown,
): StoredTurnInputCompileCapabilityMatrix | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const effectiveCapabilities = normalizeTurnInputCompileCapabilitySnapshot(value.effectiveCapabilities);
  if (!effectiveCapabilities) {
    return undefined;
  }

  const assetFacts = Array.isArray(value.assetFacts)
    ? value.assetFacts
      .map(normalizeTurnInputCompileAssetFact)
      .filter((fact): fact is StoredTurnInputCompileAssetFact => fact !== null)
    : null;

  if (assetFacts === null) {
    return undefined;
  }

  const modelCapabilities = value.modelCapabilities === null
    ? null
    : normalizeTurnInputCompileCapabilitySnapshot(value.modelCapabilities);
  const transportCapabilities = value.transportCapabilities === null
    ? null
    : normalizeTurnInputCompileCapabilitySnapshot(value.transportCapabilities);

  return {
    modelCapabilities,
    transportCapabilities,
    effectiveCapabilities,
    assetFacts,
  };
}

function normalizeTurnInputCompileCapabilitySnapshot(
  value: unknown,
): StoredTurnInputCompileCapabilitySnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const nativeTextInput = typeof value.nativeTextInput === "boolean" ? value.nativeTextInput : null;
  const nativeImageInput = typeof value.nativeImageInput === "boolean" ? value.nativeImageInput : null;
  const nativeDocumentInput = typeof value.nativeDocumentInput === "boolean" ? value.nativeDocumentInput : null;
  const supportedDocumentMimeTypes = Array.isArray(value.supportedDocumentMimeTypes)
    ? value.supportedDocumentMimeTypes
      .map((entry) => normalizeText(typeof entry === "string" ? entry : undefined))
      .filter((entry): entry is string => Boolean(entry))
    : null;

  if (
    nativeTextInput === null
    || nativeImageInput === null
    || nativeDocumentInput === null
    || supportedDocumentMimeTypes === null
  ) {
    return null;
  }

  return {
    nativeTextInput,
    nativeImageInput,
    nativeDocumentInput,
    supportedDocumentMimeTypes,
  };
}

function normalizeTurnInputCompileAssetFact(
  value: unknown,
): StoredTurnInputCompileAssetFact | null {
  if (!isRecord(value)) {
    return null;
  }

  const assetId = normalizeText(typeof value.assetId === "string" ? value.assetId : undefined);
  const kind = value.kind === "image" || value.kind === "document" ? value.kind : null;
  const mimeType = normalizeText(typeof value.mimeType === "string" ? value.mimeType : undefined);
  const localPathStatus = value.localPathStatus === "ready" || value.localPathStatus === "unavailable"
    ? value.localPathStatus
    : null;
  const effectiveNativeSupport = typeof value.effectiveNativeSupport === "boolean"
    ? value.effectiveNativeSupport
    : null;
  const effectiveMimeTypeSupported = normalizeNullableBoolean(value.effectiveMimeTypeSupported);
  const modelNativeSupport = normalizeNullableBoolean(value.modelNativeSupport);
  const transportNativeSupport = normalizeNullableBoolean(value.transportNativeSupport);
  const modelMimeTypeSupported = normalizeNullableBoolean(value.modelMimeTypeSupported);
  const transportMimeTypeSupported = normalizeNullableBoolean(value.transportMimeTypeSupported);
  const handling = value.handling === "native" || value.handling === "path_fallback" || value.handling === "blocked"
    ? value.handling
    : null;

  if (!assetId || !kind || !mimeType || !localPathStatus || effectiveNativeSupport === null || !handling) {
    return null;
  }

  return {
    assetId,
    kind,
    mimeType,
    localPathStatus,
    modelNativeSupport,
    transportNativeSupport,
    effectiveNativeSupport,
    modelMimeTypeSupported,
    transportMimeTypeSupported,
    effectiveMimeTypeSupported,
    handling,
  };
}

function normalizeNullableBoolean(value: unknown): boolean | null {
  if (value === null) {
    return null;
  }

  return typeof value === "boolean" ? value : null;
}

function normalizeTaskInputTextExtraction(value: unknown): TaskInputAsset["textExtraction"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const status = value.status === "completed" || value.status === "failed" ? value.status : "not_started";
  const textPath = normalizeText(typeof value.textPath === "string" ? value.textPath : undefined);
  const textPreview = normalizeText(typeof value.textPreview === "string" ? value.textPreview : undefined);

  return {
    status,
    ...(textPath ? { textPath } : {}),
    ...(textPreview ? { textPreview } : {}),
  };
}

function normalizeTaskInputMetadata(value: unknown): TaskInputAsset["metadata"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const width = typeof value.width === "number" && Number.isFinite(value.width) ? value.width : undefined;
  const height = typeof value.height === "number" && Number.isFinite(value.height) ? value.height : undefined;
  const pageCount = typeof value.pageCount === "number" && Number.isFinite(value.pageCount) ? value.pageCount : undefined;
  const languageHint = normalizeText(typeof value.languageHint === "string" ? value.languageHint : undefined);

  if (width === undefined && height === undefined && pageCount === undefined && !languageHint) {
    return undefined;
  }

  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(pageCount !== undefined ? { pageCount } : {}),
    ...(languageHint ? { languageHint } : {}),
  };
}

function orderTaskInputAssets(assets: TaskInputAsset[], envelope: TaskInputEnvelope): TaskInputAsset[] {
  if (!assets.length) {
    return envelope.assets;
  }

  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const ordered: TaskInputAsset[] = [];
  const seen = new Set<string>();

  for (const part of envelope.parts) {
    if (part.type === "text") {
      continue;
    }

    const asset = assetById.get(part.assetId);
    if (!asset || seen.has(asset.assetId)) {
      continue;
    }

    ordered.push(asset);
    seen.add(asset.assetId);
  }

  for (const asset of assets) {
    if (seen.has(asset.assetId)) {
      continue;
    }

    ordered.push(asset);
  }

  return ordered;
}

function mapThirdPartyProviderRow(row: ThirdPartyProviderRow): StoredThirdPartyProviderRecord {
  return {
    providerId: row.provider_id,
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    endpointCandidatesJson: row.endpoint_candidates_json ?? "[]",
    ...(row.default_model ? { defaultModel: row.default_model } : {}),
    wireApi: row.wire_api === "chat" ? "chat" : "responses",
    supportsWebsockets: row.supports_websockets === 1,
    ...(row.model_catalog_path ? { modelCatalogPath: row.model_catalog_path } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapThirdPartyProviderModelRow(row: ThirdPartyProviderModelRow): StoredThirdPartyProviderModelRecord {
  return {
    providerId: row.provider_id,
    model: row.model,
    displayName: row.display_name,
    description: row.description,
    defaultReasoningLevel: row.default_reasoning_level,
    supportedReasoningLevelsJson: row.supported_reasoning_levels_json,
    ...(typeof row.context_window === "number" ? { contextWindow: row.context_window } : {}),
    truncationMode: row.truncation_mode === "bytes" ? "bytes" : "tokens",
    truncationLimit: row.truncation_limit,
    capabilitiesJson: row.capabilities_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePrincipalPersonaProfileData(value: unknown): PrincipalPersonaProfileData {
  if (!isRecord(value)) {
    return {};
  }

  const preferredAddress = normalizeOptionalText(value.preferredAddress);
  const assistantName = normalizeOptionalText(value.assistantName);
  const assistantLanguageStyle = normalizeOptionalText(value.assistantLanguageStyle);
  const assistantMbti = normalizeOptionalText(value.assistantMbti);
  const assistantStyleNotes = normalizeOptionalText(value.assistantStyleNotes);
  const workSummary = normalizeOptionalText(value.workSummary);
  const collaborationStyle = normalizeOptionalText(value.collaborationStyle);
  const boundaries = normalizeOptionalText(value.boundaries);
  const assistantSoul = normalizeOptionalMultilineText(value.assistantSoul);

  return {
    ...(preferredAddress ? { preferredAddress } : {}),
    ...(assistantName ? { assistantName } : {}),
    ...(assistantLanguageStyle ? { assistantLanguageStyle } : {}),
    ...(assistantMbti ? { assistantMbti } : {}),
    ...(assistantStyleNotes ? { assistantStyleNotes } : {}),
    ...(assistantSoul ? { assistantSoul } : {}),
    ...(workSummary ? { workSummary } : {}),
    ...(collaborationStyle ? { collaborationStyle } : {}),
    ...(boundaries ? { boundaries } : {}),
  };
}

function normalizePrincipalPersonaOnboardingState(value: unknown): PrincipalPersonaOnboardingState {
  if (!isRecord(value)) {
    return {
      stepIndex: 0,
      draft: {},
      completedStepIds: [],
    };
  }

  const stepIndex = Number.isInteger(value.stepIndex) && Number(value.stepIndex) >= 0
    ? Number(value.stepIndex)
    : 0;
  const completedStepIds = Array.isArray(value.completedStepIds)
    ? value.completedStepIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  return {
    stepIndex,
    draft: normalizePrincipalPersonaProfileData(value.draft),
    completedStepIds,
  };
}

function mergePrincipalPersonaProfileData(
  base: PrincipalPersonaProfileData | undefined,
  patch: PrincipalPersonaProfileData,
): PrincipalPersonaProfileData {
  const normalizedBase = normalizePrincipalPersonaProfileData(base);
  const normalizedPatch = normalizePrincipalPersonaProfileData(patch);

  return {
    ...normalizedBase,
    ...Object.fromEntries(
      Object.entries(normalizedPatch).filter((entry) => typeof entry[1] === "string" && entry[1].trim()),
    ),
  };
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalMultilineText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .slice(0, 4000);

  return normalized ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractSessionMetadata(
  payload: Record<string, unknown> | undefined,
): {
  sessionMode?: string;
  threadId?: string;
} {
  const directPayload = asRecord(payload);
  const sessionPayload = asRecord(directPayload?.session) ?? directPayload;
  const sessionMode = normalizeText(
    typeof sessionPayload?.sessionMode === "string"
      ? sessionPayload.sessionMode
      : typeof sessionPayload?.mode === "string"
        ? sessionPayload.mode
        : undefined,
  );
  const threadId = normalizeText(typeof sessionPayload?.threadId === "string" ? sessionPayload.threadId : undefined);

  return {
    ...(sessionMode ? { sessionMode } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeStrings(value.filter((item): item is string => typeof item === "string"));
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function summarizeConversationTitle(goal: string): string {
  const normalized = goal.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "新对话";
  }

  return normalized.slice(0, 80);
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeManagedAgentBootstrapProfile(value: unknown): ManagedAgentBootstrapProfile | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return value as ManagedAgentBootstrapProfile;
}

function normalizeManagedAgentCard(value: unknown): ManagedAgentCard | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return value as ManagedAgentCard;
}

function normalizeManagedAgentWorkspacePolicySnapshot(
  value: unknown,
): ManagedAgentWorkspacePolicySnapshot | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const workspacePath = normalizeText(asString(record.workspacePath));
  const additionalDirectories = normalizeStringArray(record.additionalDirectories);
  const displayName = normalizeText(asString(record.displayName));

  if (!workspacePath) {
    return undefined;
  }

  return {
    ...(displayName ? { displayName } : {}),
    workspacePath,
    ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
    ...(typeof record.allowNetworkAccess === "boolean" ? { allowNetworkAccess: record.allowNetworkAccess } : {}),
  };
}

function normalizeManagedAgentRuntimeProfileSnapshot(
  value: unknown,
): Partial<StoredAgentRuntimeProfileRecord> | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const profileId = normalizeText(asString(record.profileId));
  const organizationId = normalizeText(asString(record.organizationId));
  const ownerAgentId = normalizeText(asString(record.ownerAgentId));
  const displayName = normalizeText(asString(record.displayName));
  const model = normalizeText(asString(record.model));
  const reasoning = normalizeEnum<ReasoningLevel>(asString(record.reasoning), REASONING_LEVELS);
  const memoryMode = normalizeEnum<MemoryMode>(asString(record.memoryMode), MEMORY_MODES);
  const sandboxMode = normalizeEnum<SandboxMode>(asString(record.sandboxMode), SANDBOX_MODES);
  const webSearchMode = normalizeEnum<WebSearchMode>(asString(record.webSearchMode), WEB_SEARCH_MODES);
  const approvalPolicy = normalizeEnum<ApprovalPolicy>(asString(record.approvalPolicy), APPROVAL_POLICIES);
  const accessMode = normalizeEnum<TaskAccessMode>(asString(record.accessMode), TASK_ACCESS_MODES);
  const authAccountId = normalizeText(asString(record.authAccountId));
  const thirdPartyProviderId = normalizeText(asString(record.thirdPartyProviderId));
  const secretEnvRefs = normalizeManagedAgentSecretEnvRefs(record.secretEnvRefs);

  return {
    ...(profileId ? { profileId } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(ownerAgentId ? { ownerAgentId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(memoryMode ? { memoryMode } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(webSearchMode ? { webSearchMode } : {}),
    ...(typeof record.networkAccessEnabled === "boolean"
      ? { networkAccessEnabled: record.networkAccessEnabled }
      : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(accessMode ? { accessMode } : {}),
    ...(authAccountId ? { authAccountId } : {}),
    ...(thirdPartyProviderId ? { thirdPartyProviderId } : {}),
    ...(secretEnvRefs ? { secretEnvRefs } : {}),
  };
}

function normalizeManagedAgentSecretEnvRefs(value: unknown): ManagedAgentSecretEnvRef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((entry) => {
      const record = asRecord(entry);
      const envName = normalizeText(asString(record?.envName));
      const secretRef = normalizeText(asString(record?.secretRef));

      if (!envName || !secretRef) {
        return null;
      }

      return {
        envName,
        secretRef,
        ...(typeof record?.required === "boolean" ? { required: record.required } : {}),
      };
    })
    .filter((entry): entry is ManagedAgentSecretEnvRef => entry !== null);
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeLimit(value: number | undefined, fallback = 20): number {
  if (!Number.isFinite(value) || typeof value !== "number" || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && allowed.includes(value as T) ? value as T : undefined;
}
