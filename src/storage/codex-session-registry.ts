import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  isPrincipalTaskSettingsEmpty,
  normalizePrincipalTaskSettings,
} from "../core/principal-task-settings.js";
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
  ACTOR_RUNTIME_MEMORY_KINDS,
  ACTOR_RUNTIME_MEMORY_STATUSES,
  ACTOR_TASK_SCOPE_STATUSES,
  PRINCIPAL_ACTOR_STATUSES,
  PRINCIPAL_MAIN_MEMORY_CANDIDATE_STATUSES,
  PRINCIPAL_MAIN_MEMORY_KINDS,
  PRINCIPAL_MAIN_MEMORY_SOURCE_TYPES,
  PRINCIPAL_MAIN_MEMORY_STATUSES,
} from "../types/index.js";
import type {
  ActorRuntimeMemoryKind,
  ActorRuntimeMemoryStatus,
  ActorTaskScopeStatus,
  PrincipalTaskSettings,
  PrincipalPersonaOnboardingState,
  PrincipalPersonaProfileData,
  PrincipalActorStatus,
  PrincipalMainMemoryCandidateStatus,
  PrincipalMainMemoryKind,
  PrincipalMainMemorySourceType,
  PrincipalMainMemoryStatus,
  SessionTaskSettings,
  TaskEvent,
  TaskInputAsset,
  TaskInputEnvelope,
  TaskRequest,
  TaskResult,
  StoredActorRuntimeMemoryRecord,
  StoredActorTaskScopeRecord,
  StoredPrincipalActorRecord,
  StoredPrincipalMainMemoryCandidateRecord,
  StoredPrincipalMainMemoryRecord,
} from "../types/index.js";

const DATABASE_SCHEMA_VERSION = 16;

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

export interface StoredTurnInputCompileSummary {
  runtimeTarget: string;
  degradationLevel: "native" | "lossless_textualization" | "controlled_fallback" | "blocked";
  warnings: StoredTurnInputCompileWarning[];
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
          SELECT token_id, label, token_hash, created_at, updated_at, last_used_at, revoked_at
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
          SELECT token_id, label, token_hash, created_at, updated_at, last_used_at, revoked_at
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
          SELECT token_id, label, token_hash, created_at, updated_at, last_used_at, revoked_at
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
          SELECT token_id, label, token_hash, created_at, updated_at, last_used_at, revoked_at
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
            created_at,
            updated_at,
            last_used_at,
            revoked_at
          ) VALUES (
            @token_id,
            @label,
            @token_hash,
            @created_at,
            @updated_at,
            @last_used_at,
            @revoked_at
          )
          ON CONFLICT(token_id) DO UPDATE SET
            label = excluded.label,
            token_hash = excluded.token_hash,
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
          SELECT principal_id, display_name, created_at, updated_at
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

    if (!principalId) {
      throw new Error("Principal id is required.");
    }

    this.db
      .prepare(
        `
          INSERT INTO themis_principals (
            principal_id,
            display_name,
            created_at,
            updated_at
          ) VALUES (
            @principal_id,
            @display_name,
            @created_at,
            @updated_at
          )
          ON CONFLICT(principal_id) DO UPDATE SET
            display_name = excluded.display_name,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        principal_id: principalId,
        display_name: record.displayName?.trim() || null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
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
              status = @status,
              updated_at = @updated_at,
              session_mode = CASE
                WHEN @session_mode IS NOT NULL AND @session_mode <> '' THEN @session_mode
                ELSE session_mode
              END,
              codex_thread_id = CASE
                WHEN @codex_thread_id IS NOT NULL AND @codex_thread_id <> '' THEN @codex_thread_id
                ELSE codex_thread_id
              END,
              error_message = CASE
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

      CREATE TABLE IF NOT EXISTS themis_web_access_tokens (
        token_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL,
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
    this.createSessionHistoryMetadataTables(database);
    this.createTurnInputTables(database);

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
  return {
    principalId: row.principal_id,
    ...(row.display_name ? { displayName: row.display_name } : {}),
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

  return {
    runtimeTarget,
    degradationLevel,
    warnings,
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
