import { resolve } from "node:path";
import type { SqliteCodexSessionRegistry, StoredPrincipalRecord } from "../storage/index.js";
import type {
  ApprovalPolicy,
  AgentAuditLogEventType,
  ManagedAgentBootstrapProfile,
  ManagedAgentIdleRecoveryAction,
  ManagedAgentAutonomyLevel,
  ManagedAgentCreationMode,
  ManagedAgentExposurePolicy,
  ManagedAgentStatus,
  AgentSpawnSuggestionState,
  MemoryMode,
  ReasoningLevel,
  SandboxMode,
  StoredAgentHandoffRecord,
  StoredAgentMailboxEntryRecord,
  StoredAgentMessageRecord,
  StoredAgentWorkItemRecord,
  StoredAgentAuditLogRecord,
  StoredAgentRuntimeProfileRecord,
  StoredAgentSpawnSuggestionStateRecord,
  StoredAgentSpawnPolicyRecord,
  StoredAgentWorkspacePolicyRecord,
  StoredManagedAgentRecord,
  StoredOrganizationRecord,
  TaskAccessMode,
  WebSearchMode,
} from "../types/index.js";
import {
  APPROVAL_POLICIES,
  MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN,
  MEMORY_MODES,
  REASONING_LEVELS,
  SANDBOX_MODES,
  TASK_ACCESS_MODES,
  WEB_SEARCH_MODES,
} from "../types/index.js";
import { THEMIS_GLOBAL_TASK_DEFAULTS } from "./task-defaults.js";
import { readOpenAICompatibleProviderConfigs } from "./openai-compatible-provider.js";
import { validateWorkspacePath } from "./session-workspace.js";

export interface ManagedAgentsServiceOptions {
  registry: SqliteCodexSessionRegistry;
  workingDirectory?: string;
}

export interface CreateManagedAgentInput {
  ownerPrincipalId: string;
  departmentRole: string;
  displayName?: string;
  mission?: string;
  organizationId?: string;
  supervisorAgentId?: string;
  createdByPrincipalId?: string;
  principalId?: string;
  agentId?: string;
  slug?: string;
  autonomyLevel?: ManagedAgentAutonomyLevel;
  creationMode?: ManagedAgentCreationMode;
  exposurePolicy?: ManagedAgentExposurePolicy;
  status?: ManagedAgentStatus;
  now?: string;
}

export interface CreateManagedAgentResult {
  organization: StoredOrganizationRecord;
  principal: StoredPrincipalRecord;
  agent: StoredManagedAgentRecord;
}

export interface ManagedAgentExecutionBoundaryView {
  agent: StoredManagedAgentRecord;
  workspacePolicy: StoredAgentWorkspacePolicyRecord;
  runtimeProfile: StoredAgentRuntimeProfileRecord;
}

export interface ManagedAgentExecutionBoundaryWorkspacePolicyInput {
  displayName?: string;
  workspacePath: string;
  additionalDirectories?: string[];
  allowNetworkAccess?: boolean;
}

export interface ManagedAgentExecutionBoundaryRuntimeProfileInput {
  displayName?: string;
  model?: string;
  reasoning?: ReasoningLevel;
  memoryMode?: MemoryMode;
  sandboxMode?: SandboxMode;
  webSearchMode?: WebSearchMode;
  networkAccessEnabled?: boolean;
  approvalPolicy?: ApprovalPolicy;
  accessMode?: TaskAccessMode;
  authAccountId?: string;
  thirdPartyProviderId?: string;
}

export interface UpdateManagedAgentExecutionBoundaryInput {
  ownerPrincipalId: string;
  agentId: string;
  workspacePolicy?: ManagedAgentExecutionBoundaryWorkspacePolicyInput;
  runtimeProfile?: ManagedAgentExecutionBoundaryRuntimeProfileInput;
  now?: string;
}

export interface PreviewManagedAgentIdentityInput {
  ownerPrincipalId: string;
  departmentRole: string;
  displayName?: string;
  organizationId?: string;
}

export interface PreviewManagedAgentIdentityResult {
  organization: StoredOrganizationRecord;
  departmentRole: string;
  displayName: string;
  slug: string;
  mission: string;
}

export interface ManagedAgentSpawnSuggestion {
  suggestionId: string;
  organizationId: string;
  departmentRole: string;
  displayName: string;
  slug: string;
  mission: string;
  rationale: string;
  supportingAgentId: string;
  supportingAgentDisplayName: string;
  suggestedSupervisorAgentId: string;
  openWorkItemCount: number;
  waitingWorkItemCount: number;
  highPriorityWorkItemCount: number;
  spawnPolicy: StoredAgentSpawnPolicyRecord;
  guardrail: ManagedAgentSpawnGuardrailSnapshot;
  auditFacts: ManagedAgentSpawnAuditFacts;
}

export interface ManagedAgentSuppressedSpawnSuggestion extends ManagedAgentSpawnSuggestion {
  suppressionState: AgentSpawnSuggestionState;
  suppressedAt: string;
  updatedAt: string;
}

export interface UpdateManagedAgentSpawnPolicyInput {
  ownerPrincipalId: string;
  organizationId?: string;
  maxActiveAgents: number;
  maxActiveAgentsPerRole: number;
  now?: string;
}

export interface ApproveManagedAgentSpawnSuggestionInput {
  ownerPrincipalId: string;
  departmentRole: string;
  displayName?: string;
  mission?: string;
  organizationId?: string;
  supervisorAgentId?: string;
  now?: string;
}

export interface ManagedAgentSpawnSuggestionDecisionInput {
  ownerPrincipalId: string;
  suggestionId: string;
  organizationId: string;
  departmentRole: string;
  displayName: string;
  mission?: string;
  rationale?: string;
  supportingAgentId?: string;
  supportingAgentDisplayName?: string;
  suggestedSupervisorAgentId?: string;
  openWorkItemCount?: number;
  waitingWorkItemCount?: number;
  highPriorityWorkItemCount?: number;
  spawnPolicy?: unknown;
  guardrail?: unknown;
  auditFacts?: unknown;
  now?: string;
}

export interface RestoreManagedAgentSpawnSuggestionInput {
  ownerPrincipalId: string;
  suggestionId: string;
  organizationId?: string;
  now?: string;
}

export interface ManagedAgentSpawnGuardrailSnapshot {
  organizationActiveAgentCount: number;
  organizationActiveAgentLimit: number;
  organizationRemainingSlots: number;
  roleActiveAgentCount: number;
  roleActiveAgentLimit: number;
  roleRemainingSlots: number;
  blocked: boolean;
  blockedReason?: string;
}

export interface ManagedAgentSpawnAuditFacts {
  creationReason: string;
  expectedScope: string;
  insufficiencyReason: string;
  namingBasis: string;
}

export interface ManagedAgentSpawnAuditLog {
  auditLogId: string;
  organizationId: string;
  eventType: AgentAuditLogEventType;
  actorPrincipalId: string;
  subjectAgentId?: string;
  suggestionId?: string;
  departmentRole: string;
  displayName: string;
  summary: string;
  supportingAgentId?: string;
  supportingAgentDisplayName?: string;
  guardrail: ManagedAgentSpawnGuardrailSnapshot;
  auditFacts: ManagedAgentSpawnAuditFacts;
  createdAt: string;
}

export interface ManagedAgentIdleRecoverySuggestion {
  suggestionId: string;
  organizationId: string;
  agentId: string;
  displayName: string;
  departmentRole: string;
  currentStatus: ManagedAgentStatus;
  creationMode: ManagedAgentCreationMode;
  recommendedAction: ManagedAgentIdleRecoveryAction;
  idleSinceAt: string;
  idleHours: number;
  lastActivityAt: string;
  lastActivitySummary: string;
  openWorkItemCount: number;
  pendingMailboxCount: number;
  recentClosedWorkItemCount: number;
  recentHandoffCount: number;
  rationale: string;
}

export interface ManagedAgentIdleRecoveryAuditLog {
  auditLogId: string;
  organizationId: string;
  eventType: AgentAuditLogEventType;
  actorPrincipalId: string;
  subjectAgentId?: string;
  suggestionId?: string;
  agentId: string;
  displayName: string;
  departmentRole: string;
  currentStatus: ManagedAgentStatus;
  recommendedAction: ManagedAgentIdleRecoveryAction;
  idleSinceAt: string;
  idleHours: number;
  lastActivityAt: string;
  lastActivitySummary: string;
  openWorkItemCount: number;
  pendingMailboxCount: number;
  recentClosedWorkItemCount: number;
  recentHandoffCount: number;
  rationale: string;
  summary: string;
  createdAt: string;
}

export interface ApproveManagedAgentSpawnSuggestionResult extends CreateManagedAgentResult {
  auditLog: ManagedAgentSpawnAuditLog;
  bootstrapWorkItem: StoredAgentWorkItemRecord;
}

export interface ManagedAgentSpawnSuggestionDecisionResult {
  auditLog: ManagedAgentSpawnAuditLog;
  suppressedSuggestion?: ManagedAgentSuppressedSpawnSuggestion;
}

export interface ApproveManagedAgentIdleRecoverySuggestionInput {
  ownerPrincipalId: string;
  suggestionId: string;
  organizationId?: string;
  agentId: string;
  action: ManagedAgentIdleRecoveryAction;
  now?: string;
}

export interface ApproveManagedAgentIdleRecoverySuggestionResult {
  organization: StoredOrganizationRecord;
  agent: StoredManagedAgentRecord;
  auditLog: ManagedAgentIdleRecoveryAuditLog;
}

const OPEN_WORK_ITEM_STATUSES = new Set([
  "queued",
  "planning",
  "running",
  "waiting_human",
  "waiting_agent",
  "blocked",
  "handoff_pending",
]);
const WAITING_WORK_ITEM_STATUSES = new Set([
  "waiting_human",
  "waiting_agent",
  "blocked",
  "handoff_pending",
]);
const HIGH_PRIORITY_WORK_ITEM_PRIORITIES = new Set(["high", "urgent"]);
const DEFAULT_MAX_ACTIVE_MANAGED_AGENTS_PER_ORGANIZATION = 12;
const DEFAULT_MAX_ACTIVE_MANAGED_AGENTS_PER_ROLE = 3;
const DEFAULT_SPAWN_AUDIT_LOG_LIMIT = 8;
const DEFAULT_IDLE_RECOVERY_AUDIT_LOG_LIMIT = 8;
const CAPACITY_MANAGED_AGENT_STATUSES = new Set<ManagedAgentStatus>(["active", "bootstrapping"]);
const IDLE_RECOVERY_EVENT_TYPES = new Set<AgentAuditLogEventType>([
  "idle_recovery_pause_approved",
  "idle_recovery_archive_approved",
]);
const ACTIVE_IDLE_RECOVERY_THRESHOLD_HOURS = 72;
const PAUSED_IDLE_RECOVERY_THRESHOLD_HOURS = 14 * 24;
const RECENT_IDLE_ACTIVITY_WINDOW_HOURS = 30 * 24;

export class ManagedAgentsService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly workingDirectory: string;

  constructor(options: ManagedAgentsServiceOptions) {
    this.registry = options.registry;
    this.workingDirectory = resolve(options.workingDirectory ?? process.cwd());
  }

  ensureDefaultOrganization(ownerPrincipalId: string, now = new Date().toISOString()): StoredOrganizationRecord {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const existing = this.registry.listOrganizationsByOwnerPrincipal(owner.principalId)[0];

    if (existing) {
      if (owner.organizationId !== existing.organizationId) {
        this.registry.savePrincipal({
          ...owner,
          organizationId: existing.organizationId,
          updatedAt: now,
        });
      }
      return existing;
    }

    const organization: StoredOrganizationRecord = {
      organizationId: createId("org"),
      ownerPrincipalId: owner.principalId,
      displayName: buildDefaultOrganizationName(owner),
      slug: buildDefaultOrganizationSlug(owner),
      createdAt: now,
      updatedAt: now,
    };

    this.registry.saveOrganization(organization);
    this.registry.savePrincipal({
      ...owner,
      organizationId: organization.organizationId,
      updatedAt: now,
    });
    return organization;
  }

  listOrganizations(ownerPrincipalId: string): StoredOrganizationRecord[] {
    return this.registry.listOrganizationsByOwnerPrincipal(normalizeRequiredText(ownerPrincipalId, "Principal id is required."));
  }

  listSpawnPolicies(ownerPrincipalId: string): StoredAgentSpawnPolicyRecord[] {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const organizations = this.registry.listOrganizationsByOwnerPrincipal(owner.principalId);

    return organizations.map((organization) => this.ensureDefaultSpawnPolicy(organization, new Date().toISOString()));
  }

  getSpawnPolicy(ownerPrincipalId: string, organizationId?: string, now?: string): StoredAgentSpawnPolicyRecord {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const organization = organizationId
      ? this.requireOwnedOrganization(owner.principalId, organizationId)
      : this.ensureDefaultOrganization(owner.principalId, normalizeNow(now));
    return this.ensureDefaultSpawnPolicy(organization, normalizeNow(now));
  }

  updateSpawnPolicy(input: UpdateManagedAgentSpawnPolicyInput): StoredAgentSpawnPolicyRecord {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const organization = input.organizationId
      ? this.requireOwnedOrganization(owner.principalId, input.organizationId)
      : this.ensureDefaultOrganization(owner.principalId, now);
    const maxActiveAgents = normalizePositiveInteger(
      input.maxActiveAgents,
      "maxActiveAgents must be a positive integer.",
    );
    const maxActiveAgentsPerRole = normalizePositiveInteger(
      input.maxActiveAgentsPerRole,
      "maxActiveAgentsPerRole must be a positive integer.",
    );

    if (maxActiveAgentsPerRole > maxActiveAgents) {
      throw new Error("maxActiveAgentsPerRole cannot exceed maxActiveAgents.");
    }

    const existing = this.registry.getAgentSpawnPolicy(organization.organizationId);
    const policy: StoredAgentSpawnPolicyRecord = {
      organizationId: organization.organizationId,
      maxActiveAgents,
      maxActiveAgentsPerRole,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.registry.saveAgentSpawnPolicy(policy);
    return this.registry.getAgentSpawnPolicy(organization.organizationId) ?? policy;
  }

  previewManagedAgentIdentity(input: PreviewManagedAgentIdentityInput): PreviewManagedAgentIdentityResult {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const organization = input.organizationId
      ? this.requireOwnedOrganization(owner.principalId, input.organizationId)
      : this.ensureDefaultOrganization(owner.principalId);
    const departmentRole = normalizeRequiredText(input.departmentRole, "Department role is required.");
    const agentsInOrganization = this.registry.listManagedAgentsByOrganization(organization.organizationId);
    const displayName = normalizeOptionalText(input.displayName)
      ?? generateManagedAgentDisplayName(departmentRole, agentsInOrganization.map((agent) => agent.displayName));
    const slug = generateManagedAgentSlug(displayName, agentsInOrganization.map((agent) => agent.slug));

    return {
      organization,
      departmentRole,
      displayName,
      slug,
      mission: `负责 ${departmentRole} 相关工作。`,
    };
  }

  createManagedAgent(input: CreateManagedAgentInput): CreateManagedAgentResult {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const organization = input.organizationId
      ? this.requireOwnedOrganization(owner.principalId, input.organizationId)
      : this.ensureDefaultOrganization(owner.principalId, now);
    const departmentRole = normalizeRequiredText(input.departmentRole, "Department role is required.");
    const agentsInOrganization = this.registry.listManagedAgentsByOrganization(organization.organizationId);
    const displayName = normalizeOptionalText(input.displayName)
      ?? generateManagedAgentDisplayName(departmentRole, agentsInOrganization.map((agent) => agent.displayName));
    const slug = normalizeOptionalText(input.slug)
      ?? generateManagedAgentSlug(displayName, agentsInOrganization.map((agent) => agent.slug));
    const supervisorAgent = normalizeOptionalText(input.supervisorAgentId)
      ? this.requireManagedAgentInOrganization(input.supervisorAgentId as string, organization.organizationId)
      : null;
    const principalId = normalizeOptionalText(input.principalId) ?? createId("principal-agent");
    const agentId = normalizeOptionalText(input.agentId) ?? createId("agent");
    const principal: StoredPrincipalRecord = {
      principalId,
      displayName,
      kind: "managed_agent",
      organizationId: organization.organizationId,
      createdAt: now,
      updatedAt: now,
    };
    const agent: StoredManagedAgentRecord = {
      agentId,
      principalId,
      organizationId: organization.organizationId,
      createdByPrincipalId: normalizeOptionalText(input.createdByPrincipalId) ?? owner.principalId,
      ...(supervisorAgent ? { supervisorPrincipalId: supervisorAgent.principalId } : {}),
      displayName,
      slug,
      departmentRole,
      mission: normalizeOptionalText(input.mission) ?? `负责 ${departmentRole} 相关工作。`,
      status: input.status ?? "active",
      autonomyLevel: input.autonomyLevel ?? "bounded",
      creationMode: input.creationMode ?? "manual",
      exposurePolicy: input.exposurePolicy ?? "gateway_only",
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipal(principal);
    this.registry.saveManagedAgent(agent);
    const boundary = this.ensureManagedAgentExecutionBoundary(agent, now);

    return {
      organization,
      principal: this.registry.getPrincipal(principalId) ?? principal,
      agent: boundary.agent,
    };
  }

  listSpawnSuggestions(ownerPrincipalId: string): ManagedAgentSpawnSuggestion[] {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const agents = this.registry.listManagedAgentsByOwnerPrincipal(owner.principalId)
      .filter((agent) => agent.status === "active");
    const agentById = new Map(agents.map((agent) => [agent.agentId, agent]));

    const openWorkItems = this.registry.listAgentWorkItemsByOwnerPrincipal(owner.principalId)
      .filter((workItem) => OPEN_WORK_ITEM_STATUSES.has(workItem.status));
    const pressureByAgentId = new Map<string, {
      openWorkItemCount: number;
      waitingWorkItemCount: number;
      highPriorityWorkItemCount: number;
    }>();

    for (const workItem of openWorkItems) {
      const targetAgent = agentById.get(workItem.targetAgentId);

      if (!targetAgent) {
        continue;
      }

      const current = pressureByAgentId.get(targetAgent.agentId) ?? {
        openWorkItemCount: 0,
        waitingWorkItemCount: 0,
        highPriorityWorkItemCount: 0,
      };
      current.openWorkItemCount += 1;

      if (WAITING_WORK_ITEM_STATUSES.has(workItem.status)) {
        current.waitingWorkItemCount += 1;
      }

      if (HIGH_PRIORITY_WORK_ITEM_PRIORITIES.has(workItem.priority)) {
        current.highPriorityWorkItemCount += 1;
      }

      pressureByAgentId.set(targetAgent.agentId, current);
    }

    const suggestions = agents
      .map((agent) => {
        const pressure = pressureByAgentId.get(agent.agentId);

        if (!pressure) {
          return null;
        }

        if (
          pressure.openWorkItemCount < 3
          && pressure.waitingWorkItemCount < 2
          && pressure.highPriorityWorkItemCount < 2
        ) {
          return null;
        }

        const preview = this.previewManagedAgentIdentity({
          ownerPrincipalId: owner.principalId,
          organizationId: agent.organizationId,
          departmentRole: agent.departmentRole,
        });
        const spawnPolicy = this.ensureDefaultSpawnPolicy(
          this.requireOwnedOrganization(owner.principalId, agent.organizationId),
          new Date().toISOString(),
        );
        const guardrail = buildSpawnGuardrailSnapshot(
          this.registry.listManagedAgentsByOrganization(agent.organizationId)
            .filter((candidate) => CAPACITY_MANAGED_AGENT_STATUSES.has(candidate.status)),
          agent.departmentRole,
          spawnPolicy,
        );
        const auditFacts = buildSpawnSuggestionAuditFacts(agent, pressure, preview);

        return {
          suggestionId: buildSpawnSuggestionId(agent.agentId, preview.slug),
          organizationId: agent.organizationId,
          departmentRole: agent.departmentRole,
          displayName: preview.displayName,
          slug: preview.slug,
          mission: preview.mission,
          rationale: buildSpawnSuggestionRationale(agent, pressure),
          supportingAgentId: agent.agentId,
          supportingAgentDisplayName: agent.displayName,
          suggestedSupervisorAgentId: agent.agentId,
          openWorkItemCount: pressure.openWorkItemCount,
          waitingWorkItemCount: pressure.waitingWorkItemCount,
          highPriorityWorkItemCount: pressure.highPriorityWorkItemCount,
          spawnPolicy,
          guardrail,
          auditFacts,
        } satisfies ManagedAgentSpawnSuggestion;
      })
      .filter((suggestion): suggestion is ManagedAgentSpawnSuggestion => Boolean(suggestion))
      .sort((left, right) =>
        right.highPriorityWorkItemCount - left.highPriorityWorkItemCount
        || right.waitingWorkItemCount - left.waitingWorkItemCount
        || right.openWorkItemCount - left.openWorkItemCount
        || left.displayName.localeCompare(right.displayName, "zh-CN")
      );

    const suppressedSuggestionIds = new Set(
      this.registry
        .listOrganizationsByOwnerPrincipal(owner.principalId)
        .flatMap((organization) => this.registry.listAgentSpawnSuggestionStatesByOrganization(organization.organizationId))
        .map((record) => record.suggestionId),
    );

    return suggestions.filter((suggestion) => !suppressedSuggestionIds.has(suggestion.suggestionId));
  }

  listSuppressedSpawnSuggestions(ownerPrincipalId: string): ManagedAgentSuppressedSpawnSuggestion[] {
    const owner = this.requirePrincipal(ownerPrincipalId);

    return this.registry
      .listOrganizationsByOwnerPrincipal(owner.principalId)
      .flatMap((organization) => this.registry.listAgentSpawnSuggestionStatesByOrganization(organization.organizationId))
      .map((record) => this.mapSuppressedSpawnSuggestion(record))
      .filter((record): record is ManagedAgentSuppressedSpawnSuggestion => Boolean(record))
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
        || left.displayName.localeCompare(right.displayName, "zh-CN")
      );
  }

  listSpawnAuditLogs(ownerPrincipalId: string, limit = DEFAULT_SPAWN_AUDIT_LOG_LIMIT): ManagedAgentSpawnAuditLog[] {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const organizations = this.registry.listOrganizationsByOwnerPrincipal(owner.principalId);

    return organizations
      .flatMap((organization) => this.registry.listAgentAuditLogsByOrganization(organization.organizationId, limit))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, limit))
      .map((record) => this.mapSpawnAuditLog(record));
  }

  listIdleRecoverySuggestions(
    ownerPrincipalId: string,
    now = new Date().toISOString(),
  ): ManagedAgentIdleRecoverySuggestion[] {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const normalizedNow = normalizeNow(now);
    const cutoff = subtractHours(normalizedNow, RECENT_IDLE_ACTIVITY_WINDOW_HOURS);

    return this.registry.listManagedAgentsByOwnerPrincipal(owner.principalId)
      .filter((agent) => agent.creationMode === "auto" && (agent.status === "active" || agent.status === "paused"))
      .map((agent) => this.buildIdleRecoverySuggestion(agent, normalizedNow, cutoff))
      .filter((suggestion): suggestion is ManagedAgentIdleRecoverySuggestion => Boolean(suggestion))
      .sort((left, right) =>
        right.idleHours - left.idleHours
        || left.displayName.localeCompare(right.displayName, "zh-CN")
      );
  }

  listIdleRecoveryAuditLogs(
    ownerPrincipalId: string,
    limit = DEFAULT_IDLE_RECOVERY_AUDIT_LOG_LIMIT,
  ): ManagedAgentIdleRecoveryAuditLog[] {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const organizations = this.registry.listOrganizationsByOwnerPrincipal(owner.principalId);

    return organizations
      .flatMap((organization) => this.registry.listAgentAuditLogsByOrganization(organization.organizationId, limit))
      .filter((record) => IDLE_RECOVERY_EVENT_TYPES.has(record.eventType))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, limit))
      .map((record) => this.mapIdleRecoveryAuditLog(record))
      .filter((record): record is ManagedAgentIdleRecoveryAuditLog => Boolean(record));
  }

  approveSpawnSuggestion(input: ApproveManagedAgentSpawnSuggestionInput): ApproveManagedAgentSpawnSuggestionResult {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const organization = input.organizationId
      ? this.requireOwnedOrganization(owner.principalId, input.organizationId)
      : this.ensureDefaultOrganization(owner.principalId, now);
    const departmentRole = normalizeRequiredText(input.departmentRole, "Department role is required.");
    const supportingAgent = normalizeOptionalText(input.supervisorAgentId)
      ? this.requireManagedAgentInOrganization(input.supervisorAgentId as string, organization.organizationId)
      : null;
    const preview = this.previewManagedAgentIdentity({
      ownerPrincipalId: owner.principalId,
      organizationId: organization.organizationId,
      departmentRole,
      ...(normalizeOptionalText(input.displayName) ? { displayName: input.displayName } : {}),
    });
    const spawnPolicy = this.ensureDefaultSpawnPolicy(organization, now);
    const capacityAgentsInOrganization = this.registry.listManagedAgentsByOrganization(organization.organizationId)
      .filter((agent) => CAPACITY_MANAGED_AGENT_STATUSES.has(agent.status));
    const normalizedGuardrail = buildSpawnGuardrailSnapshot(capacityAgentsInOrganization, departmentRole, spawnPolicy);
    const pressure = supportingAgent
      ? this.resolveSpawnPressureForSupportingAgent(owner.principalId, supportingAgent.agentId)
      : {
          openWorkItemCount: 0,
          waitingWorkItemCount: 0,
          highPriorityWorkItemCount: 0,
        };
    const auditFacts = buildSpawnSuggestionAuditFacts(
      supportingAgent,
      pressure,
      preview,
    );
    const suggestionId = buildSpawnSuggestionId(supportingAgent?.agentId, preview.slug);

    if (normalizedGuardrail.blocked) {
      this.recordSpawnAuditLog({
        organizationId: organization.organizationId,
        eventType: "spawn_suggestion_blocked",
        actorPrincipalId: owner.principalId,
        suggestionId,
        summary: buildSpawnAuditSummary("spawn_suggestion_blocked", preview.displayName, departmentRole, normalizedGuardrail),
        payload: {
          departmentRole,
          displayName: preview.displayName,
          mission: normalizeOptionalText(input.mission) ?? preview.mission,
          supportingAgentId: supportingAgent?.agentId,
          supportingAgentDisplayName: supportingAgent?.displayName,
          spawnPolicy,
          guardrail: normalizedGuardrail,
          auditFacts,
          openWorkItemCount: pressure.openWorkItemCount,
          waitingWorkItemCount: pressure.waitingWorkItemCount,
          highPriorityWorkItemCount: pressure.highPriorityWorkItemCount,
        },
        createdAt: now,
      });
      throw new Error(normalizedGuardrail.blockedReason ?? "Managed agent spawn guardrail blocked this suggestion.");
    }

    const created = this.createManagedAgent({
      ownerPrincipalId: owner.principalId,
      departmentRole,
      displayName: preview.displayName,
      mission: normalizeOptionalText(input.mission) ?? preview.mission,
      organizationId: organization.organizationId,
      ...(supportingAgent ? { supervisorAgentId: supportingAgent.agentId } : {}),
      creationMode: "auto",
      status: "bootstrapping",
      createdByPrincipalId: owner.principalId,
      now,
    });
    const bootstrapWorkItem = this.createBootstrapWorkItem({
      ownerPrincipalId: owner.principalId,
      organization,
      agent: created.agent,
      suggestionId,
      supportingAgent,
      auditFacts,
      now,
    });
    const auditLog = this.recordSpawnAuditLog({
      organizationId: organization.organizationId,
      eventType: "spawn_suggestion_approved",
      actorPrincipalId: owner.principalId,
      subjectAgentId: created.agent.agentId,
      suggestionId,
      summary: buildSpawnAuditSummary("spawn_suggestion_approved", created.agent.displayName, departmentRole, normalizedGuardrail),
      payload: {
        departmentRole,
        displayName: created.agent.displayName,
        mission: created.agent.mission,
        supportingAgentId: supportingAgent?.agentId,
        supportingAgentDisplayName: supportingAgent?.displayName,
        spawnPolicy,
        guardrail: normalizedGuardrail,
        auditFacts,
        openWorkItemCount: pressure.openWorkItemCount,
        waitingWorkItemCount: pressure.waitingWorkItemCount,
        highPriorityWorkItemCount: pressure.highPriorityWorkItemCount,
      },
      createdAt: now,
    });
    void this.registry.deleteAgentSpawnSuggestionState(suggestionId);

    return {
      ...created,
      agent: this.registry.getManagedAgent(created.agent.agentId) ?? created.agent,
      auditLog,
      bootstrapWorkItem,
    };
  }

  ignoreSpawnSuggestion(
    input: ManagedAgentSpawnSuggestionDecisionInput,
  ): ManagedAgentSpawnSuggestionDecisionResult {
    return this.suppressSpawnSuggestion(input, "ignored");
  }

  rejectSpawnSuggestion(
    input: ManagedAgentSpawnSuggestionDecisionInput,
  ): ManagedAgentSpawnSuggestionDecisionResult {
    return this.suppressSpawnSuggestion(input, "rejected");
  }

  restoreSpawnSuggestion(input: RestoreManagedAgentSpawnSuggestionInput): ManagedAgentSpawnAuditLog {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const suggestionId = normalizeRequiredText(input.suggestionId, "Suggestion id is required.");
    const existing = this.registry.getAgentSpawnSuggestionState(suggestionId);

    if (!existing) {
      throw new Error("Suppressed spawn suggestion does not exist.");
    }

    const organization = input.organizationId
      ? this.requireOwnedOrganization(owner.principalId, input.organizationId)
      : this.requireOwnedOrganization(owner.principalId, existing.organizationId);

    if (existing.organizationId !== organization.organizationId) {
      throw new Error("Suppressed spawn suggestion does not exist.");
    }

    const suppressedSuggestion = this.mapSuppressedSpawnSuggestion(existing);

    if (!suppressedSuggestion) {
      throw new Error("Suppressed spawn suggestion does not exist.");
    }

    const deleted = this.registry.deleteAgentSpawnSuggestionState(suggestionId);

    if (!deleted) {
      throw new Error("Suppressed spawn suggestion does not exist.");
    }

    return this.recordSpawnAuditLog({
      organizationId: organization.organizationId,
      eventType: "spawn_suggestion_restored",
      actorPrincipalId: owner.principalId,
      suggestionId,
      summary: buildSpawnAuditSummary(
        "spawn_suggestion_restored",
        suppressedSuggestion.displayName,
        suppressedSuggestion.departmentRole,
        suppressedSuggestion.guardrail,
      ),
      payload: buildSpawnSuggestionPayload(suppressedSuggestion),
      createdAt: now,
    });
  }

  approveIdleRecoverySuggestion(
    input: ApproveManagedAgentIdleRecoverySuggestionInput,
  ): ApproveManagedAgentIdleRecoverySuggestionResult {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const agent = this.requireOwnedAgent(owner.principalId, input.agentId);
    const organization = input.organizationId
      ? this.requireOwnedOrganization(owner.principalId, input.organizationId)
      : this.requireOwnedOrganization(owner.principalId, agent.organizationId);
    const action = normalizeIdleRecoveryAction(input.action);
    const suggestionId = normalizeRequiredText(input.suggestionId, "Suggestion id is required.");
    const suggestion = this.listIdleRecoverySuggestions(owner.principalId, now)
      .find((entry) =>
        entry.suggestionId === suggestionId
        && entry.agentId === agent.agentId
        && entry.organizationId === organization.organizationId
        && entry.recommendedAction === action
      );

    if (!suggestion) {
      throw new Error("Idle recovery suggestion no longer applies.");
    }

    const updatedAgent = action === "pause"
      ? this.pauseManagedAgent(owner.principalId, agent.agentId, now)
      : this.archiveManagedAgent(owner.principalId, agent.agentId, now);
    const eventType: AgentAuditLogEventType = action === "pause"
      ? "idle_recovery_pause_approved"
      : "idle_recovery_archive_approved";
    const auditLog = this.recordIdleRecoveryAuditLog({
      organizationId: organization.organizationId,
      actorPrincipalId: owner.principalId,
      subjectAgentId: updatedAgent.agentId,
      suggestionId,
      summary: buildIdleRecoveryAuditSummary(suggestion),
      payload: buildIdleRecoverySuggestionPayload({
        ...suggestion,
        currentStatus: updatedAgent.status,
      }),
      eventType,
      createdAt: now,
    });

    return {
      organization,
      agent: updatedAgent,
      auditLog,
    };
  }

  listManagedAgents(ownerPrincipalId: string): StoredManagedAgentRecord[] {
    return this.registry.listManagedAgentsByOwnerPrincipal(
      normalizeRequiredText(ownerPrincipalId, "Principal id is required."),
    ).map((agent) => this.ensureManagedAgentExecutionBoundary(agent).agent);
  }

  getManagedAgent(ownerPrincipalId: string, agentId: string): StoredManagedAgentRecord | null {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const agent = this.registry.getManagedAgent(normalizeRequiredText(agentId, "Agent id is required."));

    if (!agent) {
      return null;
    }

    const organizations = new Set(
      this.registry.listOrganizationsByOwnerPrincipal(owner.principalId).map((organization) => organization.organizationId),
    );

    if (!organizations.has(agent.organizationId)) {
      return null;
    }

    return this.ensureManagedAgentExecutionBoundary(agent).agent;
  }

  getManagedAgentExecutionBoundary(
    ownerPrincipalId: string,
    agentId: string,
  ): ManagedAgentExecutionBoundaryView | null {
    const agent = this.getManagedAgent(ownerPrincipalId, agentId);

    if (!agent) {
      return null;
    }

    return this.ensureManagedAgentExecutionBoundary(agent);
  }

  updateManagedAgentExecutionBoundary(
    input: UpdateManagedAgentExecutionBoundaryInput,
  ): ManagedAgentExecutionBoundaryView {
    const now = normalizeNow(input.now);
    const agent = this.requireOwnedAgent(input.ownerPrincipalId, input.agentId);
    const current = this.ensureManagedAgentExecutionBoundary(agent, now);
    const workspacePolicy = input.workspacePolicy
      ? this.buildWorkspacePolicyRecord({
        agent: current.agent,
        currentPolicy: current.workspacePolicy,
        input: input.workspacePolicy,
        now,
      })
      : current.workspacePolicy;
    const runtimeProfile = input.runtimeProfile
      ? this.buildRuntimeProfileRecord({
        agent: current.agent,
        currentProfile: current.runtimeProfile,
        input: input.runtimeProfile,
        now,
      })
      : current.runtimeProfile;

    this.registry.saveAgentWorkspacePolicy(workspacePolicy);
    this.registry.saveAgentRuntimeProfile(runtimeProfile);

    const updatedAgent: StoredManagedAgentRecord = {
      ...current.agent,
      defaultWorkspacePolicyId: workspacePolicy.policyId,
      defaultRuntimeProfileId: runtimeProfile.profileId,
      updatedAt: now,
    };
    this.registry.saveManagedAgent(updatedAgent);

    return {
      agent: this.registry.getManagedAgent(updatedAgent.agentId) ?? updatedAgent,
      workspacePolicy,
      runtimeProfile,
    };
  }

  pauseManagedAgent(ownerPrincipalId: string, agentId: string, now?: string): StoredManagedAgentRecord {
    const agent = this.requireOwnedAgent(ownerPrincipalId, agentId);

    if (agent.status === "archived") {
      throw new Error("Archived managed agent cannot be paused.");
    }

    if (agent.status === "paused") {
      return agent;
    }

    return this.saveManagedAgentStatus(agent, "paused", normalizeNow(now));
  }

  resumeManagedAgent(ownerPrincipalId: string, agentId: string, now?: string): StoredManagedAgentRecord {
    const agent = this.requireOwnedAgent(ownerPrincipalId, agentId);

    if (agent.status === "archived") {
      throw new Error("Archived managed agent cannot be resumed.");
    }

    if (agent.status === "active") {
      return agent;
    }

    return this.saveManagedAgentStatus(agent, "active", normalizeNow(now));
  }

  archiveManagedAgent(ownerPrincipalId: string, agentId: string, now?: string): StoredManagedAgentRecord {
    const agent = this.requireOwnedAgent(ownerPrincipalId, agentId);

    if (agent.status === "archived") {
      return agent;
    }

    return this.saveManagedAgentStatus(agent, "archived", normalizeNow(now));
  }

  private createBootstrapWorkItem(input: {
    ownerPrincipalId: string;
    organization: StoredOrganizationRecord;
    agent: StoredManagedAgentRecord;
    suggestionId: string;
    supportingAgent: StoredManagedAgentRecord | null;
    auditFacts: ManagedAgentSpawnAuditFacts;
    now: string;
  }): StoredAgentWorkItemRecord {
    const dispatchReason = `完成 ${input.agent.displayName} 的首次职责建档`;
    const goal = [
      `为 ${input.agent.displayName} 完成首次职责建档，输出后续可复用的协作契约。`,
      "结果至少要覆盖职责边界、默认协作方式、何时向 supervisor 升级、首批可独立承担的工作范围，以及当前仍缺的前置条件。",
      "如果信息不足，不要直接面向人类，优先向自己的 supervisor agent 发起问题或审批请求。",
    ].join(" ");
    const workItemId = createId("work-item");
    const bootstrapProfile = buildManagedAgentBootstrapProfile({
      agent: input.agent,
      suggestionId: input.suggestionId,
      supportingAgent: input.supportingAgent,
      dispatchReason,
      goal,
      auditFacts: input.auditFacts,
      workItemId,
      now: input.now,
    });
    this.registry.saveManagedAgent({
      ...input.agent,
      bootstrapProfile,
      updatedAt: input.now,
    });

    const workItem: StoredAgentWorkItemRecord = {
      workItemId,
      organizationId: input.organization.organizationId,
      targetAgentId: input.agent.agentId,
      sourceType: input.supportingAgent ? "agent" : "human",
      sourcePrincipalId: input.supportingAgent?.principalId ?? input.ownerPrincipalId,
      ...(input.supportingAgent ? { sourceAgentId: input.supportingAgent.agentId } : {}),
      dispatchReason,
      goal,
      contextPacket: {
        systemTaskKind: MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN,
        bootstrapWorkItemId: workItemId,
        sourceSuggestionId: input.suggestionId,
        agent: {
          agentId: input.agent.agentId,
          displayName: input.agent.displayName,
          departmentRole: input.agent.departmentRole,
          mission: input.agent.mission,
          autonomyLevel: input.agent.autonomyLevel,
          exposurePolicy: input.agent.exposurePolicy,
        },
        supervisor: input.supportingAgent
          ? {
            agentId: input.supportingAgent.agentId,
            displayName: input.supportingAgent.displayName,
          }
          : null,
        collaborationContract: bootstrapProfile.collaborationContract,
        checklist: bootstrapProfile.checklist,
        auditFacts: {
          creationReason: input.auditFacts.creationReason,
          expectedScope: input.auditFacts.expectedScope,
          insufficiencyReason: input.auditFacts.insufficiencyReason,
          namingBasis: input.auditFacts.namingBasis,
        },
      },
      priority: "high",
      status: "queued",
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.registry.saveAgentWorkItem(workItem);
    return this.registry.getAgentWorkItem(workItemId) ?? workItem;
  }

  private buildIdleRecoverySuggestion(
    agent: StoredManagedAgentRecord,
    now: string,
    recentCutoff: string,
  ): ManagedAgentIdleRecoverySuggestion | null {
    const recommendedAction = agent.status === "paused"
      ? "archive"
      : agent.status === "active"
        ? "pause"
        : null;

    if (!recommendedAction) {
      return null;
    }

    const workItems = this.registry.listAgentWorkItemsByTargetAgent(agent.agentId);
    const mailboxEntries = this.registry.listAgentMailboxEntriesByAgent(agent.agentId);
    const messages = this.registry.listAgentMessagesByAgent(agent.agentId);
    const handoffs = this.registry.listAgentHandoffsByAgent(agent.agentId);
    const openWorkItemCount = workItems.filter((workItem) => OPEN_WORK_ITEM_STATUSES.has(workItem.status)).length;
    const pendingMailboxCount = mailboxEntries
      .filter((entry) => entry.status === "pending" || entry.status === "leased")
      .length;

    if (openWorkItemCount > 0 || pendingMailboxCount > 0) {
      return null;
    }

    const recentClosedWorkItemCount = workItems.filter((workItem) =>
      ["completed", "failed", "cancelled"].includes(workItem.status)
      && compareIsoTimestamp(resolveWorkItemActivityAt(workItem), recentCutoff) >= 0
    ).length;
    const recentHandoffCount = countRecentHandoffs(handoffs, messages, recentCutoff);
    const lastActivity = resolveAgentLastActivity(agent, workItems, messages, mailboxEntries, handoffs);
    const idleHours = diffHours(now, lastActivity.at);
    const thresholdHours = recommendedAction === "archive"
      ? PAUSED_IDLE_RECOVERY_THRESHOLD_HOURS
      : ACTIVE_IDLE_RECOVERY_THRESHOLD_HOURS;

    if (idleHours < thresholdHours) {
      return null;
    }

    return {
      suggestionId: buildIdleRecoverySuggestionId(agent.agentId, recommendedAction),
      organizationId: agent.organizationId,
      agentId: agent.agentId,
      displayName: agent.displayName,
      departmentRole: agent.departmentRole,
      currentStatus: agent.status,
      creationMode: agent.creationMode,
      recommendedAction,
      idleSinceAt: lastActivity.at,
      idleHours,
      lastActivityAt: lastActivity.at,
      lastActivitySummary: lastActivity.summary,
      openWorkItemCount,
      pendingMailboxCount,
      recentClosedWorkItemCount,
      recentHandoffCount,
      rationale: buildIdleRecoveryRationale({
        displayName: agent.displayName,
        action: recommendedAction,
        idleHours,
      }),
    };
  }

  private requirePrincipal(principalId: string): StoredPrincipalRecord {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "Principal id is required.");
    const principal = this.registry.getPrincipal(normalizedPrincipalId);

    if (!principal) {
      throw new Error("Principal does not exist.");
    }

    return principal;
  }

  private requireOwnedOrganization(ownerPrincipalId: string, organizationId: string): StoredOrganizationRecord {
    const normalizedOrganizationId = normalizeRequiredText(organizationId, "Organization id is required.");
    const organization = this.registry.getOrganization(normalizedOrganizationId);

    if (!organization || organization.ownerPrincipalId !== ownerPrincipalId) {
      throw new Error("Organization does not exist.");
    }

    return organization;
  }

  private requireManagedAgentInOrganization(agentId: string, organizationId: string): StoredManagedAgentRecord {
    const agent = this.registry.getManagedAgent(normalizeRequiredText(agentId, "Supervisor agent id is required."));

    if (!agent || agent.organizationId !== organizationId) {
      throw new Error("Supervisor agent does not exist.");
    }

    return agent;
  }

  private requireOwnedAgent(ownerPrincipalId: string, agentId: string): StoredManagedAgentRecord {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const agent = this.registry.getManagedAgent(normalizeRequiredText(agentId, "Agent id is required."));

    if (!agent || !this.isOrganizationOwnedBy(agent.organizationId, owner.principalId)) {
      throw new Error("Managed agent does not exist.");
    }

    return agent;
  }

  private ensureDefaultSpawnPolicy(
    organization: StoredOrganizationRecord,
    now: string,
  ): StoredAgentSpawnPolicyRecord {
    const existing = this.registry.getAgentSpawnPolicy(organization.organizationId);

    if (existing) {
      return existing;
    }

    const policy: StoredAgentSpawnPolicyRecord = {
      organizationId: organization.organizationId,
      maxActiveAgents: DEFAULT_MAX_ACTIVE_MANAGED_AGENTS_PER_ORGANIZATION,
      maxActiveAgentsPerRole: DEFAULT_MAX_ACTIVE_MANAGED_AGENTS_PER_ROLE,
      createdAt: now,
      updatedAt: now,
    };

    this.registry.saveAgentSpawnPolicy(policy);
    return this.registry.getAgentSpawnPolicy(organization.organizationId) ?? policy;
  }

  private resolveSpawnPressureForSupportingAgent(ownerPrincipalId: string, supportingAgentId: string): {
    openWorkItemCount: number;
    waitingWorkItemCount: number;
    highPriorityWorkItemCount: number;
  } {
    const openWorkItems = this.registry.listAgentWorkItemsByOwnerPrincipal(ownerPrincipalId)
      .filter((workItem) =>
        workItem.targetAgentId === supportingAgentId
        && OPEN_WORK_ITEM_STATUSES.has(workItem.status)
      );

    return openWorkItems.reduce((result, workItem) => {
      result.openWorkItemCount += 1;

      if (WAITING_WORK_ITEM_STATUSES.has(workItem.status)) {
        result.waitingWorkItemCount += 1;
      }

      if (HIGH_PRIORITY_WORK_ITEM_PRIORITIES.has(workItem.priority)) {
        result.highPriorityWorkItemCount += 1;
      }

      return result;
    }, {
      openWorkItemCount: 0,
      waitingWorkItemCount: 0,
      highPriorityWorkItemCount: 0,
    });
  }

  private suppressSpawnSuggestion(
    input: ManagedAgentSpawnSuggestionDecisionInput,
    state: AgentSpawnSuggestionState,
  ): ManagedAgentSpawnSuggestionDecisionResult {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const now = normalizeNow(input.now);
    const suggestion = this.normalizeSpawnSuggestionDecisionInput(owner.principalId, input, now);
    const record: StoredAgentSpawnSuggestionStateRecord = {
      suggestionId: suggestion.suggestionId,
      organizationId: suggestion.organizationId,
      state,
      payload: buildSpawnSuggestionPayload(suggestion),
      createdAt: this.registry.getAgentSpawnSuggestionState(suggestion.suggestionId)?.createdAt ?? now,
      updatedAt: now,
    };

    this.registry.saveAgentSpawnSuggestionState(record);

    const eventType: AgentAuditLogEventType = state === "ignored"
      ? "spawn_suggestion_ignored"
      : "spawn_suggestion_rejected";
    const auditLog = this.recordSpawnAuditLog({
      organizationId: suggestion.organizationId,
      eventType,
      actorPrincipalId: owner.principalId,
      suggestionId: suggestion.suggestionId,
      summary: buildSpawnAuditSummary(eventType, suggestion.displayName, suggestion.departmentRole, suggestion.guardrail),
      payload: buildSpawnSuggestionPayload(suggestion),
      createdAt: now,
    });

    return {
      auditLog,
      suppressedSuggestion: this.mapSuppressedSpawnSuggestion(record) ?? {
        ...suggestion,
        suppressionState: state,
        suppressedAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    };
  }

  private normalizeSpawnSuggestionDecisionInput(
    ownerPrincipalId: string,
    input: ManagedAgentSpawnSuggestionDecisionInput,
    now: string,
  ): ManagedAgentSpawnSuggestion {
    const suggestionId = normalizeRequiredText(input.suggestionId, "Suggestion id is required.");
    const organization = this.requireOwnedOrganization(
      ownerPrincipalId,
      normalizeRequiredText(input.organizationId, "Organization id is required."),
    );
    const departmentRole = normalizeRequiredText(input.departmentRole, "Department role is required.");
    const displayName = normalizeRequiredText(input.displayName, "Display name is required.");
    const supportingAgent = normalizeOptionalText(input.supportingAgentId)
      ? this.requireManagedAgentInOrganization(input.supportingAgentId as string, organization.organizationId)
      : null;
    const supportingAgentDisplayName = normalizeOptionalText(input.supportingAgentDisplayName)
      ?? supportingAgent?.displayName
      ?? "当前团队";
    const suggestedSupervisorAgentId = normalizeOptionalText(input.suggestedSupervisorAgentId)
      ?? supportingAgent?.agentId
      ?? "";
    const spawnPolicy = this.ensureDefaultSpawnPolicy(organization, now);
    const activeAgentsInOrganization = this.registry.listManagedAgentsByOrganization(organization.organizationId)
      .filter((agent) => CAPACITY_MANAGED_AGENT_STATUSES.has(agent.status));
    const pressure = {
      openWorkItemCount: normalizeNonNegativeInteger(input.openWorkItemCount),
      waitingWorkItemCount: normalizeNonNegativeInteger(input.waitingWorkItemCount),
      highPriorityWorkItemCount: normalizeNonNegativeInteger(input.highPriorityWorkItemCount),
    };
    const guardrail = input.guardrail
      ? normalizeSpawnGuardrailSnapshot(input.guardrail)
      : buildSpawnGuardrailSnapshot(activeAgentsInOrganization, departmentRole, spawnPolicy);
    const preview = {
      organization,
      departmentRole,
      displayName,
      slug: normalizeOptionalText(input.suggestionId.split(":").at(-1)) ?? generateManagedAgentSlug(displayName, []),
      mission: normalizeOptionalText(input.mission) ?? `负责 ${departmentRole} 相关工作。`,
    };
    const auditFacts = input.auditFacts
      ? normalizeSpawnAuditFacts(input.auditFacts)
      : buildSpawnSuggestionAuditFacts(supportingAgent, pressure, preview);
    const rationale = normalizeOptionalText(input.rationale) ?? auditFacts.creationReason;

    return {
      suggestionId,
      organizationId: organization.organizationId,
      departmentRole,
      displayName,
      slug: preview.slug,
      mission: preview.mission,
      rationale,
      supportingAgentId: supportingAgent?.agentId ?? "",
      supportingAgentDisplayName,
      suggestedSupervisorAgentId,
      openWorkItemCount: pressure.openWorkItemCount,
      waitingWorkItemCount: pressure.waitingWorkItemCount,
      highPriorityWorkItemCount: pressure.highPriorityWorkItemCount,
      spawnPolicy,
      guardrail,
      auditFacts,
    };
  }

  private mapSuppressedSpawnSuggestion(
    record: StoredAgentSpawnSuggestionStateRecord,
  ): ManagedAgentSuppressedSpawnSuggestion | null {
    const payload = asRecord(record.payload);
    const departmentRole = normalizeOptionalText(asString(payload?.departmentRole));
    const displayName = normalizeOptionalText(asString(payload?.displayName));

    if (!departmentRole || !displayName) {
      return null;
    }

    const mission = normalizeOptionalText(asString(payload?.mission)) ?? `负责 ${departmentRole} 相关工作。`;
    const supportingAgentId = normalizeOptionalText(asString(payload?.supportingAgentId)) ?? "";
    const supportingAgentDisplayName = normalizeOptionalText(asString(payload?.supportingAgentDisplayName))
      ?? "当前团队";
    const suggestedSupervisorAgentId = normalizeOptionalText(asString(payload?.suggestedSupervisorAgentId))
      ?? supportingAgentId;
    const guardrail = normalizeSpawnGuardrailSnapshot(payload?.guardrail);
    const auditFacts = normalizeSpawnAuditFacts(payload?.auditFacts);
    const spawnPolicy = normalizeStoredSpawnPolicyRecord(payload?.spawnPolicy, record.organizationId, record.createdAt, guardrail);

    return {
      suggestionId: record.suggestionId,
      organizationId: record.organizationId,
      departmentRole,
      displayName,
      slug: normalizeOptionalText(asString(payload?.slug)) ?? generateManagedAgentSlug(displayName, []),
      mission,
      rationale: normalizeOptionalText(asString(payload?.rationale)) ?? auditFacts.creationReason,
      supportingAgentId,
      supportingAgentDisplayName,
      suggestedSupervisorAgentId,
      openWorkItemCount: normalizeNonNegativeInteger(payload?.openWorkItemCount),
      waitingWorkItemCount: normalizeNonNegativeInteger(payload?.waitingWorkItemCount),
      highPriorityWorkItemCount: normalizeNonNegativeInteger(payload?.highPriorityWorkItemCount),
      spawnPolicy,
      guardrail,
      auditFacts,
      suppressionState: record.state,
      suppressedAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private recordSpawnAuditLog(input: {
    organizationId: string;
    eventType: AgentAuditLogEventType;
    actorPrincipalId: string;
    subjectAgentId?: string;
    suggestionId?: string;
    summary: string;
    payload: unknown;
    createdAt: string;
  }): ManagedAgentSpawnAuditLog {
    const record: StoredAgentAuditLogRecord = {
      auditLogId: createId("agent-audit"),
      organizationId: input.organizationId,
      eventType: input.eventType,
      actorPrincipalId: input.actorPrincipalId,
      ...(normalizeOptionalText(input.subjectAgentId) ? { subjectAgentId: input.subjectAgentId } : {}),
      ...(normalizeOptionalText(input.suggestionId) ? { suggestionId: input.suggestionId } : {}),
      summary: input.summary,
      payload: input.payload,
      createdAt: input.createdAt,
    };

    this.registry.saveAgentAuditLog(record);
    return this.mapSpawnAuditLog(record);
  }

  private mapSpawnAuditLog(record: StoredAgentAuditLogRecord): ManagedAgentSpawnAuditLog {
    const payload = asRecord(record.payload);
    const guardrail = normalizeSpawnGuardrailSnapshot(payload?.guardrail);
    const auditFacts = normalizeSpawnAuditFacts(payload?.auditFacts);
    const departmentRole = normalizeOptionalText(asString(payload?.departmentRole)) ?? "未知职责";
    const displayName = normalizeOptionalText(asString(payload?.displayName)) ?? "待命名 agent";
    const supportingAgentId = normalizeOptionalText(asString(payload?.supportingAgentId));
    const supportingAgentDisplayName = normalizeOptionalText(asString(payload?.supportingAgentDisplayName));

    return {
      auditLogId: record.auditLogId,
      organizationId: record.organizationId,
      eventType: record.eventType,
      actorPrincipalId: record.actorPrincipalId,
      ...(normalizeOptionalText(record.subjectAgentId) ? { subjectAgentId: record.subjectAgentId } : {}),
      ...(normalizeOptionalText(record.suggestionId) ? { suggestionId: record.suggestionId } : {}),
      departmentRole,
      displayName,
      summary: record.summary,
      ...(supportingAgentId ? { supportingAgentId } : {}),
      ...(supportingAgentDisplayName ? { supportingAgentDisplayName } : {}),
      guardrail,
      auditFacts,
      createdAt: record.createdAt,
    };
  }

  private recordIdleRecoveryAuditLog(input: {
    organizationId: string;
    actorPrincipalId: string;
    subjectAgentId: string;
    suggestionId: string;
    eventType: AgentAuditLogEventType;
    summary: string;
    payload: unknown;
    createdAt: string;
  }): ManagedAgentIdleRecoveryAuditLog {
    const record: StoredAgentAuditLogRecord = {
      auditLogId: createId("agent-audit"),
      organizationId: input.organizationId,
      eventType: input.eventType,
      actorPrincipalId: input.actorPrincipalId,
      subjectAgentId: input.subjectAgentId,
      suggestionId: input.suggestionId,
      summary: input.summary,
      payload: input.payload,
      createdAt: input.createdAt,
    };

    this.registry.saveAgentAuditLog(record);
    const mapped = this.mapIdleRecoveryAuditLog(record);

    if (!mapped) {
      throw new Error("Failed to map idle recovery audit log.");
    }

    return mapped;
  }

  private mapIdleRecoveryAuditLog(record: StoredAgentAuditLogRecord): ManagedAgentIdleRecoveryAuditLog | null {
    const payload = asRecord(record.payload);
    const displayName = normalizeOptionalText(asString(payload?.displayName));
    const departmentRole = normalizeOptionalText(asString(payload?.departmentRole));
    const agentId = normalizeOptionalText(asString(payload?.agentId));
    const currentStatus = normalizeOptionalText(asString(payload?.currentStatus));
    const recommendedAction = normalizeOptionalText(asString(payload?.recommendedAction));
    const idleSinceAt = normalizeOptionalText(asString(payload?.idleSinceAt));
    const lastActivityAt = normalizeOptionalText(asString(payload?.lastActivityAt));
    const lastActivitySummary = normalizeOptionalText(asString(payload?.lastActivitySummary));
    const rationale = normalizeOptionalText(asString(payload?.rationale));

    if (
      !displayName
      || !departmentRole
      || !agentId
      || !currentStatus
      || !recommendedAction
      || !idleSinceAt
      || !lastActivityAt
      || !lastActivitySummary
      || !rationale
      || !["active", "paused", "bootstrapping", "degraded", "archived", "provisioning"].includes(currentStatus)
      || !["pause", "archive"].includes(recommendedAction)
    ) {
      return null;
    }

    return {
      auditLogId: record.auditLogId,
      organizationId: record.organizationId,
      eventType: record.eventType,
      actorPrincipalId: record.actorPrincipalId,
      ...(normalizeOptionalText(record.subjectAgentId) ? { subjectAgentId: record.subjectAgentId } : {}),
      ...(normalizeOptionalText(record.suggestionId) ? { suggestionId: record.suggestionId } : {}),
      agentId,
      displayName,
      departmentRole,
      currentStatus: currentStatus as ManagedAgentStatus,
      recommendedAction: recommendedAction as ManagedAgentIdleRecoveryAction,
      idleSinceAt,
      idleHours: normalizeNonNegativeInteger(payload?.idleHours),
      lastActivityAt,
      lastActivitySummary,
      openWorkItemCount: normalizeNonNegativeInteger(payload?.openWorkItemCount),
      pendingMailboxCount: normalizeNonNegativeInteger(payload?.pendingMailboxCount),
      recentClosedWorkItemCount: normalizeNonNegativeInteger(payload?.recentClosedWorkItemCount),
      recentHandoffCount: normalizeNonNegativeInteger(payload?.recentHandoffCount),
      rationale,
      summary: record.summary,
      createdAt: record.createdAt,
    };
  }

  private saveManagedAgentStatus(
    agent: StoredManagedAgentRecord,
    status: ManagedAgentStatus,
    updatedAt: string,
  ): StoredManagedAgentRecord {
    const updated: StoredManagedAgentRecord = {
      ...agent,
      status,
      updatedAt,
    };

    this.registry.saveManagedAgent(updated);
    return this.registry.getManagedAgent(agent.agentId) ?? updated;
  }

  private isOrganizationOwnedBy(organizationId: string, ownerPrincipalId: string): boolean {
    return this.registry
      .listOrganizationsByOwnerPrincipal(ownerPrincipalId)
      .some((organization) => organization.organizationId === organizationId);
  }

  private ensureManagedAgentExecutionBoundary(
    agent: StoredManagedAgentRecord,
    now = new Date().toISOString(),
  ): ManagedAgentExecutionBoundaryView {
    const workspacePolicy = this.resolveOrCreateAgentWorkspacePolicy(agent, now);
    const runtimeProfile = this.resolveOrCreateAgentRuntimeProfile(agent, now);

    if (
      agent.defaultWorkspacePolicyId !== workspacePolicy.policyId
      || agent.defaultRuntimeProfileId !== runtimeProfile.profileId
    ) {
      const updatedAgent: StoredManagedAgentRecord = {
        ...agent,
        defaultWorkspacePolicyId: workspacePolicy.policyId,
        defaultRuntimeProfileId: runtimeProfile.profileId,
        updatedAt: now,
      };
      this.registry.saveManagedAgent(updatedAgent);

      return {
        agent: this.registry.getManagedAgent(updatedAgent.agentId) ?? updatedAgent,
        workspacePolicy,
        runtimeProfile,
      };
    }

    return {
      agent,
      workspacePolicy,
      runtimeProfile,
    };
  }

  private resolveOrCreateAgentWorkspacePolicy(
    agent: StoredManagedAgentRecord,
    now: string,
  ): StoredAgentWorkspacePolicyRecord {
    const existing = normalizeOptionalText(agent.defaultWorkspacePolicyId)
      ? this.registry.getAgentWorkspacePolicy(agent.defaultWorkspacePolicyId as string)
      : this.registry.getAgentWorkspacePolicyByOwnerAgent(agent.agentId);

    if (existing) {
      return existing;
    }

    const created = this.buildWorkspacePolicyRecord({
      agent,
      currentPolicy: null,
      input: {
        displayName: "默认工作区边界",
        workspacePath: this.workingDirectory,
        additionalDirectories: [],
        allowNetworkAccess: true,
      },
      now,
    });
    this.registry.saveAgentWorkspacePolicy(created);
    return created;
  }

  private resolveOrCreateAgentRuntimeProfile(
    agent: StoredManagedAgentRecord,
    now: string,
  ): StoredAgentRuntimeProfileRecord {
    const existing = (
      normalizeOptionalText(agent.defaultRuntimeProfileId)
        ? this.registry.getAgentRuntimeProfile(agent.defaultRuntimeProfileId as string)
        : null
    ) ?? this.registry.getAgentRuntimeProfileByOwnerAgent(agent.agentId);

    if (existing) {
      return existing;
    }

    const activeAuthAccountId = this.registry.getActiveAuthAccount()?.accountId;
    const created = this.buildRuntimeProfileRecord({
      agent,
      currentProfile: null,
      input: {
        displayName: "默认运行配置",
        sandboxMode: THEMIS_GLOBAL_TASK_DEFAULTS.sandboxMode,
        webSearchMode: THEMIS_GLOBAL_TASK_DEFAULTS.webSearchMode,
        networkAccessEnabled: THEMIS_GLOBAL_TASK_DEFAULTS.networkAccessEnabled,
        approvalPolicy: THEMIS_GLOBAL_TASK_DEFAULTS.approvalPolicy,
        accessMode: "auth",
        ...(activeAuthAccountId
          ? { authAccountId: activeAuthAccountId }
          : {}),
      },
      now,
    });
    this.registry.saveAgentRuntimeProfile(created);
    return created;
  }

  private buildWorkspacePolicyRecord(input: {
    agent: StoredManagedAgentRecord;
    currentPolicy: StoredAgentWorkspacePolicyRecord | null;
    input: ManagedAgentExecutionBoundaryWorkspacePolicyInput;
    now: string;
  }): StoredAgentWorkspacePolicyRecord {
    const workspacePath = validateWorkspacePath(
      normalizeRequiredText(input.input.workspacePath, "工作区不能为空。"),
    );
    const additionalDirectories = normalizePathArray(input.input.additionalDirectories);
    const validatedAdditionalDirectories = additionalDirectories
      .map((directory) => validateWorkspacePath(directory))
      .filter((directory) => directory !== workspacePath);

    return {
      policyId: input.currentPolicy?.policyId ?? createId("agent-workspace-policy"),
      organizationId: input.agent.organizationId,
      ownerAgentId: input.agent.agentId,
      displayName: normalizeOptionalText(input.input.displayName)
        ?? input.currentPolicy?.displayName
        ?? "默认工作区边界",
      workspacePath,
      additionalDirectories: dedupeStrings(validatedAdditionalDirectories),
      allowNetworkAccess: typeof input.input.allowNetworkAccess === "boolean"
        ? input.input.allowNetworkAccess
        : input.currentPolicy?.allowNetworkAccess
          ?? true,
      createdAt: input.currentPolicy?.createdAt ?? input.now,
      updatedAt: input.now,
    };
  }

  private buildRuntimeProfileRecord(input: {
    agent: StoredManagedAgentRecord;
    currentProfile: StoredAgentRuntimeProfileRecord | null;
    input: ManagedAgentExecutionBoundaryRuntimeProfileInput;
    now: string;
  }): StoredAgentRuntimeProfileRecord {
    const profileInput = input.input;
    const accessMode = normalizeTaskAccessMode(
      normalizeOptionalText(profileInput.accessMode)
        ?? input.currentProfile?.accessMode
        ?? "auth",
    );
    const activeAuthAccount = this.registry.getActiveAuthAccount();
    const authAccountId = accessMode === "auth"
      ? normalizeOptionalText(profileInput.authAccountId)
        ?? input.currentProfile?.authAccountId
        ?? activeAuthAccount?.accountId
        ?? undefined
      : undefined;
    const thirdPartyProviderId = accessMode === "third-party"
      ? this.resolveThirdPartyProviderId(
        normalizeOptionalText(profileInput.thirdPartyProviderId)
          ?? input.currentProfile?.thirdPartyProviderId
          ?? null,
      )
      : undefined;

    if (accessMode === "auth" && authAccountId && !this.registry.getAuthAccount(authAccountId)) {
      throw new Error("Auth account does not exist.");
    }

    const model = normalizeOptionalText(profileInput.model) ?? input.currentProfile?.model ?? undefined;
    const reasoning = normalizeReasoningLevel(profileInput.reasoning ?? input.currentProfile?.reasoning);
    const memoryMode = normalizeMemoryMode(profileInput.memoryMode ?? input.currentProfile?.memoryMode);
    const sandboxMode = normalizeSandboxMode(profileInput.sandboxMode ?? input.currentProfile?.sandboxMode);
    const webSearchMode = normalizeWebSearchMode(profileInput.webSearchMode ?? input.currentProfile?.webSearchMode);
    const approvalPolicy = normalizeApprovalPolicy(profileInput.approvalPolicy ?? input.currentProfile?.approvalPolicy);

    return {
      profileId: input.currentProfile?.profileId ?? createId("agent-runtime-profile"),
      organizationId: input.agent.organizationId,
      ownerAgentId: input.agent.agentId,
      displayName: normalizeOptionalText(profileInput.displayName)
        ?? input.currentProfile?.displayName
        ?? "默认运行配置",
      ...(model ? { model } : {}),
      ...(reasoning ? { reasoning: reasoning as ReasoningLevel } : {}),
      ...(memoryMode ? { memoryMode: memoryMode as MemoryMode } : {}),
      ...(sandboxMode ? { sandboxMode: sandboxMode as SandboxMode } : {}),
      ...(webSearchMode ? { webSearchMode: webSearchMode as WebSearchMode } : {}),
      networkAccessEnabled: typeof profileInput.networkAccessEnabled === "boolean"
        ? profileInput.networkAccessEnabled
        : input.currentProfile?.networkAccessEnabled
          ?? THEMIS_GLOBAL_TASK_DEFAULTS.networkAccessEnabled,
      ...(approvalPolicy ? { approvalPolicy: approvalPolicy as ApprovalPolicy } : {}),
      accessMode,
      ...(authAccountId ? { authAccountId } : {}),
      ...(thirdPartyProviderId ? { thirdPartyProviderId } : {}),
      createdAt: input.currentProfile?.createdAt ?? input.now,
      updatedAt: input.now,
    };
  }

  private resolveThirdPartyProviderId(providerId: string | null): string {
    const providers = readOpenAICompatibleProviderConfigs(this.workingDirectory, this.registry);
    const resolvedProviderId = providerId ?? providers[0]?.id ?? null;

    if (!resolvedProviderId) {
      throw new Error("Third-party provider does not exist.");
    }

    if (!providers.some((provider) => provider.id === resolvedProviderId)) {
      throw new Error("Third-party provider does not exist.");
    }

    return resolvedProviderId;
  }
}

function normalizeNow(value?: string): string {
  const trimmed = normalizeOptionalText(value);
  return trimmed ?? new Date().toISOString();
}

function normalizeOptionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePathArray(value?: string[] | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeStrings(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function normalizeRequiredText(value: string | undefined | null, message: string): string {
  const trimmed = normalizeOptionalText(value);

  if (!trimmed) {
    throw new Error(message);
  }

  return trimmed;
}

function normalizePositiveInteger(value: number, message: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(message);
  }

  return value;
}

function normalizeNonNegativeInteger(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

function normalizeIdleRecoveryAction(value: ManagedAgentIdleRecoveryAction | undefined): ManagedAgentIdleRecoveryAction {
  if (value === "pause" || value === "archive") {
    return value;
  }

  throw new Error("Idle recovery suggestion no longer applies.");
}

function buildDefaultOrganizationName(owner: StoredPrincipalRecord): string {
  const label = normalizeOptionalText(owner.displayName) ?? "Themis";
  return `${label} 团队`;
}

function buildDefaultOrganizationSlug(owner: StoredPrincipalRecord): string {
  const displayName = normalizeOptionalText(owner.displayName);

  if (displayName) {
    const slug = slugify(displayName);

    if (slug) {
      return `${slug}-team`;
    }
  }

  return `org-${owner.principalId.slice(-8)}`;
}

function generateManagedAgentDisplayName(role: string, existingNames: string[]): string {
  const base = role;
  const suffixes = ["澄", "砺", "岚", "序", "衡", "曜", "策", "原"];

  for (let index = 0; index < suffixes.length; index += 1) {
    const candidate = `${base}·${suffixes[index]}`;
    if (!existingNames.includes(candidate)) {
      return candidate;
    }
  }

  let counter = existingNames.length + 1;
  while (existingNames.includes(`${base}·${counter}`)) {
    counter += 1;
  }
  return `${base}·${counter}`;
}

function generateManagedAgentSlug(displayName: string, existingSlugs: string[]): string {
  const base = slugify(displayName) || "agent";

  if (!existingSlugs.includes(base)) {
    return base;
  }

  let counter = 2;
  while (existingSlugs.includes(`${base}-${counter}`)) {
    counter += 1;
  }

  return `${base}-${counter}`;
}

function slugify(value: string): string {
  const lower = value.trim().toLowerCase();
  const ascii = lower
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii;
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeTaskAccessMode(value?: string | null): TaskAccessMode {
  if (value && TASK_ACCESS_MODES.includes(value as TaskAccessMode)) {
    return value as TaskAccessMode;
  }

  throw new Error("运行配置 accessMode 不合法。");
}

function normalizeReasoningLevel(value?: string | null): ReasoningLevel | null {
  return value && REASONING_LEVELS.includes(value as ReasoningLevel) ? value as ReasoningLevel : null;
}

function normalizeMemoryMode(value?: string | null): MemoryMode | null {
  return value && MEMORY_MODES.includes(value as MemoryMode) ? value as MemoryMode : null;
}

function normalizeSandboxMode(value?: string | null): SandboxMode | null {
  return value && SANDBOX_MODES.includes(value as SandboxMode) ? value as SandboxMode : null;
}

function normalizeWebSearchMode(value?: string | null): WebSearchMode | null {
  return value && WEB_SEARCH_MODES.includes(value as WebSearchMode) ? value as WebSearchMode : null;
}

function normalizeApprovalPolicy(value?: string | null): ApprovalPolicy | null {
  return value && APPROVAL_POLICIES.includes(value as ApprovalPolicy) ? value as ApprovalPolicy : null;
}

function buildSpawnSuggestionRationale(
  agent: StoredManagedAgentRecord,
  pressure: {
    openWorkItemCount: number;
    waitingWorkItemCount: number;
    highPriorityWorkItemCount: number;
  },
): string {
  const reasons = [`${agent.displayName} 当前有 ${pressure.openWorkItemCount} 个未完成 work item`];

  if (pressure.waitingWorkItemCount > 0) {
    reasons.push(`${pressure.waitingWorkItemCount} 个处于等待治理`);
  }

  if (pressure.highPriorityWorkItemCount > 0) {
    reasons.push(`${pressure.highPriorityWorkItemCount} 个为高优先级`);
  }

  return `${reasons.join("，")}，建议增设一个 ${agent.departmentRole} 长期 agent 分担持续负载。`;
}

function buildSpawnGuardrailSnapshot(
  activeAgentsInOrganization: StoredManagedAgentRecord[],
  departmentRole: string,
  spawnPolicy: StoredAgentSpawnPolicyRecord,
): ManagedAgentSpawnGuardrailSnapshot {
  const organizationActiveAgentLimit = spawnPolicy.maxActiveAgents;
  const roleActiveAgentLimit = spawnPolicy.maxActiveAgentsPerRole;
  const organizationActiveAgentCount = activeAgentsInOrganization.length;
  const roleActiveAgentCount = activeAgentsInOrganization
    .filter((agent) => agent.departmentRole === departmentRole)
    .length;
  const organizationRemainingSlots = Math.max(
    0,
    organizationActiveAgentLimit - organizationActiveAgentCount,
  );
  const roleRemainingSlots = Math.max(0, roleActiveAgentLimit - roleActiveAgentCount);
  const blockedReason = organizationRemainingSlots < 1
    ? "当前组织已达到活跃 agent 数量上限。"
    : roleRemainingSlots < 1
      ? `当前 ${departmentRole} 角色已达到活跃 agent 上限。`
      : undefined;

  return {
    organizationActiveAgentCount,
    organizationActiveAgentLimit,
    organizationRemainingSlots,
    roleActiveAgentCount,
    roleActiveAgentLimit,
    roleRemainingSlots,
    blocked: Boolean(blockedReason),
    ...(blockedReason ? { blockedReason } : {}),
  };
}

function normalizeSpawnGuardrailSnapshot(value: unknown): ManagedAgentSpawnGuardrailSnapshot {
  const record = asRecord(value);
  const organizationActiveAgentCountValue = record?.organizationActiveAgentCount;
  const organizationActiveAgentLimitValue = record?.organizationActiveAgentLimit;
  const roleActiveAgentCountValue = record?.roleActiveAgentCount;
  const roleActiveAgentLimitValue = record?.roleActiveAgentLimit;
  const organizationRemainingSlotsValue = record?.organizationRemainingSlots;
  const roleRemainingSlotsValue = record?.roleRemainingSlots;
  const organizationActiveAgentCount = Number.isFinite(organizationActiveAgentCountValue)
    ? Number(organizationActiveAgentCountValue)
    : 0;
  const organizationActiveAgentLimit = Number.isFinite(organizationActiveAgentLimitValue)
    ? Number(organizationActiveAgentLimitValue)
    : DEFAULT_MAX_ACTIVE_MANAGED_AGENTS_PER_ORGANIZATION;
  const roleActiveAgentCount = Number.isFinite(roleActiveAgentCountValue)
    ? Number(roleActiveAgentCountValue)
    : 0;
  const roleActiveAgentLimit = Number.isFinite(roleActiveAgentLimitValue)
    ? Number(roleActiveAgentLimitValue)
    : DEFAULT_MAX_ACTIVE_MANAGED_AGENTS_PER_ROLE;
  const organizationRemainingSlots = Number.isFinite(organizationRemainingSlotsValue)
    ? Number(organizationRemainingSlotsValue)
    : Math.max(0, organizationActiveAgentLimit - organizationActiveAgentCount);
  const roleRemainingSlots = Number.isFinite(roleRemainingSlotsValue)
    ? Number(roleRemainingSlotsValue)
    : Math.max(0, roleActiveAgentLimit - roleActiveAgentCount);
  const blockedReason = normalizeOptionalText(asString(record?.blockedReason));
  const blocked = typeof record?.blocked === "boolean"
    ? record.blocked
    : Boolean(blockedReason);

  return {
    organizationActiveAgentCount,
    organizationActiveAgentLimit,
    organizationRemainingSlots,
    roleActiveAgentCount,
    roleActiveAgentLimit,
    roleRemainingSlots,
    blocked,
    ...(blockedReason ? { blockedReason } : {}),
  };
}

function buildSpawnSuggestionAuditFacts(
  supportingAgent: StoredManagedAgentRecord | null | undefined,
  pressure: {
    openWorkItemCount: number;
    waitingWorkItemCount: number;
    highPriorityWorkItemCount: number;
  },
  preview: PreviewManagedAgentIdentityResult,
): ManagedAgentSpawnAuditFacts {
  const supporterName = supportingAgent?.displayName ?? "现有团队";
  const departmentRole = preview.departmentRole;

  return {
    creationReason: buildSpawnSuggestionRationale(
      supportingAgent ?? {
        agentId: "",
        principalId: "",
        organizationId: preview.organization.organizationId,
        createdByPrincipalId: preview.organization.ownerPrincipalId,
        displayName: supporterName,
        slug: "",
        departmentRole,
        mission: preview.mission,
        status: "active",
        autonomyLevel: "bounded",
        creationMode: "manual",
        exposurePolicy: "gateway_only",
        createdAt: preview.organization.createdAt,
        updatedAt: preview.organization.updatedAt,
      },
      pressure,
    ),
    expectedScope: `负责分担 ${departmentRole} 持续性工作，优先承接来自 ${supporterName} 的常规分流任务。`,
    insufficiencyReason: `${supporterName} 当前已有 ${pressure.openWorkItemCount} 个未完成 work item，其中 ${pressure.waitingWorkItemCount} 个卡在等待治理，现有编制不足以稳定消化。`,
    namingBasis: `沿用“${departmentRole}·风格名”自动命名规则，并根据当前组织内重名情况生成 ${preview.displayName}（slug: ${preview.slug}）。`,
  };
}

function normalizeSpawnAuditFacts(value: unknown): ManagedAgentSpawnAuditFacts {
  const record = asRecord(value);

  return {
    creationReason: normalizeOptionalText(asString(record?.creationReason)) ?? "当前没有记录自动创建原因。",
    expectedScope: normalizeOptionalText(asString(record?.expectedScope)) ?? "当前没有记录预期负责范围。",
    insufficiencyReason: normalizeOptionalText(asString(record?.insufficiencyReason)) ?? "当前没有记录现有 agent 不足原因。",
    namingBasis: normalizeOptionalText(asString(record?.namingBasis)) ?? "当前没有记录命名依据。",
  };
}

function normalizeStoredSpawnPolicyRecord(
  value: unknown,
  organizationId: string,
  timestamp: string,
  guardrail: ManagedAgentSpawnGuardrailSnapshot,
): StoredAgentSpawnPolicyRecord {
  const record = asRecord(value);
  const maxActiveAgentsValue = record?.maxActiveAgents;
  const maxActiveAgentsPerRoleValue = record?.maxActiveAgentsPerRole;
  const maxActiveAgents = Number.isFinite(maxActiveAgentsValue)
    ? Number(maxActiveAgentsValue)
    : guardrail.organizationActiveAgentLimit;
  const maxActiveAgentsPerRole = Number.isFinite(maxActiveAgentsPerRoleValue)
    ? Number(maxActiveAgentsPerRoleValue)
    : guardrail.roleActiveAgentLimit;

  return {
    organizationId,
    maxActiveAgents: Math.max(1, Math.floor(maxActiveAgents)),
    maxActiveAgentsPerRole: Math.max(1, Math.floor(maxActiveAgentsPerRole)),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildSpawnSuggestionId(supportingAgentId: string | undefined, slug: string): string {
  const normalizedSupportingAgentId = normalizeOptionalText(supportingAgentId);
  return normalizedSupportingAgentId
    ? `spawn-suggestion:${normalizedSupportingAgentId}:${slug}`
    : `spawn-suggestion:org:${slug}`;
}

function buildIdleRecoverySuggestionId(agentId: string, action: ManagedAgentIdleRecoveryAction): string {
  return `idle-recovery:${agentId}:${action}`;
}

function buildIdleRecoverySuggestionPayload(
  suggestion: ManagedAgentIdleRecoverySuggestion,
): Record<string, unknown> {
  return {
    suggestionId: suggestion.suggestionId,
    organizationId: suggestion.organizationId,
    agentId: suggestion.agentId,
    displayName: suggestion.displayName,
    departmentRole: suggestion.departmentRole,
    currentStatus: suggestion.currentStatus,
    creationMode: suggestion.creationMode,
    recommendedAction: suggestion.recommendedAction,
    idleSinceAt: suggestion.idleSinceAt,
    idleHours: suggestion.idleHours,
    lastActivityAt: suggestion.lastActivityAt,
    lastActivitySummary: suggestion.lastActivitySummary,
    openWorkItemCount: suggestion.openWorkItemCount,
    pendingMailboxCount: suggestion.pendingMailboxCount,
    recentClosedWorkItemCount: suggestion.recentClosedWorkItemCount,
    recentHandoffCount: suggestion.recentHandoffCount,
    rationale: suggestion.rationale,
  };
}

function buildSpawnSuggestionPayload(suggestion: ManagedAgentSpawnSuggestion): Record<string, unknown> {
  return {
    suggestionId: suggestion.suggestionId,
    organizationId: suggestion.organizationId,
    departmentRole: suggestion.departmentRole,
    displayName: suggestion.displayName,
    slug: suggestion.slug,
    mission: suggestion.mission,
    rationale: suggestion.rationale,
    supportingAgentId: suggestion.supportingAgentId,
    supportingAgentDisplayName: suggestion.supportingAgentDisplayName,
    suggestedSupervisorAgentId: suggestion.suggestedSupervisorAgentId,
    openWorkItemCount: suggestion.openWorkItemCount,
    waitingWorkItemCount: suggestion.waitingWorkItemCount,
    highPriorityWorkItemCount: suggestion.highPriorityWorkItemCount,
    spawnPolicy: suggestion.spawnPolicy,
    guardrail: suggestion.guardrail,
    auditFacts: suggestion.auditFacts,
  };
}

function buildManagedAgentBootstrapProfile(input: {
  agent: StoredManagedAgentRecord;
  suggestionId: string;
  supportingAgent: StoredManagedAgentRecord | null;
  dispatchReason: string;
  goal: string;
  auditFacts: ManagedAgentSpawnAuditFacts;
  workItemId: string;
  now: string;
}): ManagedAgentBootstrapProfile {
  return {
    mode: MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN,
    state: "pending",
    bootstrapWorkItemId: input.workItemId,
    sourceSuggestionId: input.suggestionId,
    ...(input.supportingAgent ? { supervisorAgentId: input.supportingAgent.agentId } : {}),
    ...(input.supportingAgent ? { supervisorDisplayName: input.supportingAgent.displayName } : {}),
    dispatchReason: input.dispatchReason,
    goal: input.goal,
    creationReason: input.auditFacts.creationReason,
    expectedScope: input.auditFacts.expectedScope,
    insufficiencyReason: input.auditFacts.insufficiencyReason,
    namingBasis: input.auditFacts.namingBasis,
    collaborationContract: {
      communicationMode: "agent_only",
      humanExposurePolicy: input.agent.exposurePolicy,
      escalationRoute: input.supportingAgent
        ? `优先向 ${input.supportingAgent.displayName} 发起 question / approval_request，再由组织级入口统一对人展示。`
        : "当前没有 supervisor agent，必要时只能经由组织级入口升级到人类治理层。",
      ...(input.supportingAgent ? { defaultSupervisorAgentId: input.supportingAgent.agentId } : {}),
    },
    checklist: [
      "澄清自己的职责边界与默认协作方式，不要把自己当成直接对人的入口。",
      "明确哪些任务可以独立处理，哪些情况必须先向 supervisor 升级。",
      "整理第一批可稳定承接的工作类型、输入前提和交付方式。",
      "列出仍缺的组织约束、工作区边界或运行前置条件。",
    ],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function buildSpawnAuditSummary(
  eventType: AgentAuditLogEventType,
  displayName: string,
  departmentRole: string,
  guardrail: ManagedAgentSpawnGuardrailSnapshot,
): string {
  if (eventType === "spawn_suggestion_blocked") {
    return `自动创建 ${displayName} 被护栏拦截：${guardrail.blockedReason ?? `当前 ${departmentRole} 增员不满足护栏条件。`}`;
  }

  if (eventType === "spawn_suggestion_ignored") {
    return `已忽略自动创建建议 ${displayName}，暂时不进入待治理列表。`;
  }

  if (eventType === "spawn_suggestion_rejected") {
    return `已拒绝自动创建建议 ${displayName}，当前不继续增设 ${departmentRole} agent。`;
  }

  if (eventType === "spawn_suggestion_restored") {
    return `已恢复自动创建建议 ${displayName}，重新进入待治理列表。`;
  }

  return `已批准自动创建 ${displayName}，作为新的 ${departmentRole} 长期 agent。`;
}

function buildIdleRecoveryRationale(input: {
  displayName: string;
  action: ManagedAgentIdleRecoveryAction;
  idleHours: number;
}): string {
  if (input.action === "archive") {
    return `${input.displayName} 已暂停且连续空闲 ${input.idleHours} 小时，当前没有未完成任务或待处理 mailbox，可归档收口。`;
  }

  return `${input.displayName} 已连续空闲 ${input.idleHours} 小时，且当前没有未完成任务或待处理 mailbox，可先暂停编制。`;
}

function buildIdleRecoveryAuditSummary(suggestion: ManagedAgentIdleRecoverySuggestion): string {
  return suggestion.recommendedAction === "archive"
    ? `已按建议归档长期空闲 agent ${suggestion.displayName}。`
    : `已按建议暂停空闲 agent ${suggestion.displayName}。`;
}

function resolveAgentLastActivity(
  agent: StoredManagedAgentRecord,
  workItems: StoredAgentWorkItemRecord[],
  messages: StoredAgentMessageRecord[],
  mailboxEntries: StoredAgentMailboxEntryRecord[],
  handoffs: StoredAgentHandoffRecord[],
): { at: string; summary: string } {
  const candidates: Array<{ at: string; summary: string }> = [
    {
      at: agent.bootstrappedAt ?? agent.updatedAt ?? agent.createdAt,
      summary: `${agent.displayName} 最近一次生命周期更新时间。`,
    },
  ];

  for (const workItem of workItems) {
    const activityAt = resolveWorkItemActivityAt(workItem);

    if (!activityAt) {
      continue;
    }

    const summary = workItem.status === "completed"
      ? `最近一次 completed work item：${workItem.dispatchReason || workItem.goal}`
      : `最近一次 work item 更新：${workItem.dispatchReason || workItem.goal}`;
    candidates.push({ at: activityAt, summary });
  }

  for (const handoff of handoffs) {
    candidates.push({
      at: handoff.createdAt,
      summary: `最近一次 handoff：${handoff.summary}`,
    });
  }

  for (const message of messages) {
    candidates.push({
      at: message.createdAt,
      summary: message.messageType === "handoff"
        ? "最近一次 handoff 已完成交接。"
        : `最近一次 agent 消息类型为 ${message.messageType}。`,
    });
  }

  for (const entry of mailboxEntries) {
    const activityAt = entry.ackedAt ?? entry.leasedAt ?? entry.updatedAt ?? entry.createdAt;
    candidates.push({
      at: activityAt,
      summary: `最近一次 mailbox 状态更新为 ${entry.status}。`,
    });
  }

  return candidates
    .filter((candidate) => normalizeOptionalText(candidate.at))
    .sort((left, right) => right.at.localeCompare(left.at))[0]
    ?? {
      at: agent.updatedAt ?? agent.createdAt,
      summary: `${agent.displayName} 最近一次生命周期更新时间。`,
    };
}

function countRecentHandoffs(
  handoffs: StoredAgentHandoffRecord[],
  messages: StoredAgentMessageRecord[],
  recentCutoff: string,
): number {
  const handoffCount = handoffs.filter((handoff) =>
    compareIsoTimestamp(handoff.createdAt, recentCutoff) >= 0
  ).length;

  if (handoffCount > 0) {
    return handoffCount;
  }

  return messages.filter((message) =>
    message.messageType === "handoff"
    && compareIsoTimestamp(message.createdAt, recentCutoff) >= 0
  ).length;
}

function resolveWorkItemActivityAt(workItem: StoredAgentWorkItemRecord): string {
  return workItem.completedAt
    ?? workItem.updatedAt
    ?? workItem.startedAt
    ?? workItem.scheduledAt
    ?? workItem.createdAt;
}

function diffHours(later: string, earlier: string): number {
  const laterMs = Date.parse(later);
  const earlierMs = Date.parse(earlier);

  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs) || laterMs <= earlierMs) {
    return 0;
  }

  return Math.floor((laterMs - earlierMs) / (1000 * 60 * 60));
}

function subtractHours(value: string, hours: number): string {
  const baseMs = Date.parse(value);

  if (!Number.isFinite(baseMs)) {
    return value;
  }

  return new Date(baseMs - hours * 60 * 60 * 1000).toISOString();
}

function compareIsoTimestamp(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);

  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return left.localeCompare(right);
  }

  return leftMs - rightMs;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
