import {
  ManagedAgentsService,
  type ApproveManagedAgentIdleRecoverySuggestionInput,
  type ApproveManagedAgentIdleRecoverySuggestionResult,
  type ApproveManagedAgentSpawnSuggestionInput,
  type ApproveManagedAgentSpawnSuggestionResult,
  type CreateManagedAgentInput,
  type CreateManagedAgentResult,
  type ManagedAgentDetailView,
  type ManagedAgentIdleRecoveryAuditLog,
  type ManagedAgentIdleRecoverySuggestion,
  type ManagedAgentOwnerView,
  type ManagedAgentSpawnSuggestionDecisionInput,
  type ManagedAgentSpawnSuggestionDecisionResult,
  type ManagedAgentSpawnAuditLog,
  type ManagedAgentSpawnSuggestion,
  type ManagedAgentSuppressedSpawnSuggestion,
  type RestoreManagedAgentSpawnSuggestionInput,
  type UpdateManagedAgentSpawnPolicyInput,
  type UpdateManagedAgentExecutionBoundaryInput,
  type ManagedAgentExecutionBoundaryView,
  type UpsertProjectWorkspaceBindingInput,
} from "./managed-agents-service.js";
import {
  type CancelWorkItemInput,
  type CancelWorkItemResult,
  ManagedAgentCoordinationService,
  type DispatchWorkItemInput,
  type DispatchWorkItemResult,
  type EscalateWaitingAgentWorkItemToHumanInput,
  type EscalateWaitingAgentWorkItemToHumanResult,
  type ManagedAgentMailboxItem,
  type ManagedAgentTimelineEntry,
  type ManagedAgentWorkItemDetailView,
  type OrganizationCollaborationDashboardFilters,
  type OrganizationCollaborationDashboardResult,
  type OrganizationGovernanceFilters,
  type OrganizationGovernanceOverview,
  type OrganizationWaitingQueueResult,
  type PullMailboxEntryResult,
  type RespondToHumanWaitingWorkItemInput,
  type RespondToHumanWaitingWorkItemResult,
  type RespondToMailboxEntryInput,
  type RespondToMailboxEntryResult,
} from "./managed-agent-coordination-service.js";
import {
  ManagedAgentSchedulerService,
  type ManagedAgentRunDetailView,
  type ManagedAgentRunListInput,
} from "./managed-agent-scheduler-service.js";
import type { StoredAgentHandoffRecord } from "../types/index.js";
import {
  ManagedAgentNodeService,
  type HeartbeatManagedAgentNodeInput,
  type ManagedAgentNodeDetailView,
  type ManagedAgentNodeGovernanceInput,
  type ManagedAgentNodeLeaseReclaimInput,
  type ManagedAgentNodeLeaseRecoveryResult,
  type ManagedAgentNodeMutationResult,
  type RegisterManagedAgentNodeInput,
} from "./managed-agent-node-service.js";
import {
  ManagedAgentWorkerService,
  type CompleteManagedAgentWorkerRunInput,
  type ManagedAgentWorkerAssignedRun,
  type ManagedAgentWorkerRunMutationResult,
  type PullManagedAgentAssignedRunInput,
  type UpdateManagedAgentWorkerRunStatusInput,
} from "./managed-agent-worker-service.js";

export interface ManagedAgentControlPlaneFacadeOptions {
  managedAgentsService: ManagedAgentsService;
  coordinationService: ManagedAgentCoordinationService;
  schedulerService: ManagedAgentSchedulerService;
  nodeService: ManagedAgentNodeService;
  workerService: ManagedAgentWorkerService;
}

export interface ManagedAgentLifecycleUpdateInput {
  ownerPrincipalId: string;
  agentId: string;
  action: "pause" | "resume" | "archive";
  now?: string;
}

export interface ManagedAgentListView {
  organizations: ReturnType<ManagedAgentsService["listOrganizations"]>;
  agents: ReturnType<ManagedAgentsService["listManagedAgents"]>;
}

export interface ManagedAgentSpawnSuggestionsView {
  spawnPolicies: ReturnType<ManagedAgentsService["listSpawnPolicies"]>;
  suggestions: ManagedAgentSpawnSuggestion[];
  suppressedSuggestions: ManagedAgentSuppressedSpawnSuggestion[];
  recentAuditLogs: ManagedAgentSpawnAuditLog[];
}

export interface ManagedAgentIdleRecoverySuggestionsView {
  suggestions: ManagedAgentIdleRecoverySuggestion[];
  recentAuditLogs: ManagedAgentIdleRecoveryAuditLog[];
}

export interface ManagedAgentHandoffView extends StoredAgentHandoffRecord {
  fromAgentDisplayName?: string;
  toAgentDisplayName?: string;
  counterpartyDisplayName?: string;
}

export interface ManagedAgentHandoffListView {
  agent: ManagedAgentDetailView["agent"];
  handoffs: ManagedAgentHandoffView[];
  timeline: ManagedAgentTimelineEntry[];
}

export interface ManagedAgentMailboxListView {
  agent: ManagedAgentDetailView["agent"];
  items: ManagedAgentMailboxItem[];
}

export class ManagedAgentControlPlaneFacade {
  private readonly managedAgentsService: ManagedAgentsService;
  private readonly coordinationService: ManagedAgentCoordinationService;
  private readonly schedulerService: ManagedAgentSchedulerService;
  private readonly nodeService: ManagedAgentNodeService;
  private readonly workerService: ManagedAgentWorkerService;

  constructor(options: ManagedAgentControlPlaneFacadeOptions) {
    this.managedAgentsService = options.managedAgentsService;
    this.coordinationService = options.coordinationService;
    this.schedulerService = options.schedulerService;
    this.nodeService = options.nodeService;
    this.workerService = options.workerService;
  }

  createManagedAgent(input: CreateManagedAgentInput): CreateManagedAgentResult {
    return this.managedAgentsService.createManagedAgent(input);
  }

  listManagedAgents(ownerPrincipalId: string): ManagedAgentListView {
    return {
      organizations: this.managedAgentsService.listOrganizations(ownerPrincipalId),
      agents: this.managedAgentsService.listManagedAgents(ownerPrincipalId),
    };
  }

  getSpawnSuggestionsView(ownerPrincipalId: string): ManagedAgentSpawnSuggestionsView {
    return {
      spawnPolicies: this.managedAgentsService.listSpawnPolicies(ownerPrincipalId),
      suggestions: this.managedAgentsService.listSpawnSuggestions(ownerPrincipalId),
      suppressedSuggestions: this.managedAgentsService.listSuppressedSpawnSuggestions(ownerPrincipalId),
      recentAuditLogs: this.managedAgentsService.listSpawnAuditLogs(ownerPrincipalId),
    };
  }

  getIdleRecoverySuggestionsView(ownerPrincipalId: string): ManagedAgentIdleRecoverySuggestionsView {
    return {
      suggestions: this.managedAgentsService.listIdleRecoverySuggestions(ownerPrincipalId),
      recentAuditLogs: this.managedAgentsService.listIdleRecoveryAuditLogs(ownerPrincipalId),
    };
  }

  getManagedAgentDetailView(ownerPrincipalId: string, agentId: string): ManagedAgentDetailView | null {
    return this.managedAgentsService.getManagedAgentDetailView(ownerPrincipalId, agentId);
  }

  updateManagedAgentExecutionBoundary(
    input: UpdateManagedAgentExecutionBoundaryInput,
  ): ManagedAgentExecutionBoundaryView {
    return this.managedAgentsService.updateManagedAgentExecutionBoundary(input);
  }

  listProjectWorkspaceBindings(ownerPrincipalId: string, organizationId?: string) {
    return this.managedAgentsService.listProjectWorkspaceBindings(ownerPrincipalId, organizationId);
  }

  getProjectWorkspaceBinding(ownerPrincipalId: string, projectId: string) {
    return this.managedAgentsService.getProjectWorkspaceBinding(ownerPrincipalId, projectId);
  }

  upsertProjectWorkspaceBinding(input: UpsertProjectWorkspaceBindingInput) {
    return this.managedAgentsService.upsertProjectWorkspaceBinding(input);
  }

  updateSpawnPolicy(input: UpdateManagedAgentSpawnPolicyInput) {
    return this.managedAgentsService.updateSpawnPolicy(input);
  }

  approveSpawnSuggestion(input: ApproveManagedAgentSpawnSuggestionInput): ApproveManagedAgentSpawnSuggestionResult {
    return this.managedAgentsService.approveSpawnSuggestion(input);
  }

  ignoreSpawnSuggestion(input: ManagedAgentSpawnSuggestionDecisionInput): ManagedAgentSpawnSuggestionDecisionResult {
    return this.managedAgentsService.ignoreSpawnSuggestion(input);
  }

  rejectSpawnSuggestion(input: ManagedAgentSpawnSuggestionDecisionInput): ManagedAgentSpawnSuggestionDecisionResult {
    return this.managedAgentsService.rejectSpawnSuggestion(input);
  }

  restoreSpawnSuggestion(input: RestoreManagedAgentSpawnSuggestionInput) {
    return this.managedAgentsService.restoreSpawnSuggestion(input);
  }

  approveIdleRecoverySuggestion(
    input: ApproveManagedAgentIdleRecoverySuggestionInput,
  ): ApproveManagedAgentIdleRecoverySuggestionResult {
    return this.managedAgentsService.approveIdleRecoverySuggestion(input);
  }

  updateManagedAgentLifecycle(input: ManagedAgentLifecycleUpdateInput): ManagedAgentOwnerView | null {
    const agent = input.action === "pause"
      ? this.managedAgentsService.pauseManagedAgent(input.ownerPrincipalId, input.agentId, input.now)
      : input.action === "resume"
        ? this.managedAgentsService.resumeManagedAgent(input.ownerPrincipalId, input.agentId, input.now)
        : this.managedAgentsService.archiveManagedAgent(input.ownerPrincipalId, input.agentId, input.now);

    return this.managedAgentsService.getManagedAgentOwnerView(input.ownerPrincipalId, agent.agentId);
  }

  dispatchWorkItem(input: DispatchWorkItemInput): DispatchWorkItemResult {
    return this.coordinationService.dispatchWorkItem(input);
  }

  listWorkItems(ownerPrincipalId: string, targetAgentId?: string) {
    return this.coordinationService.listWorkItems(ownerPrincipalId, targetAgentId);
  }

  listOrganizationWaitingQueue(
    ownerPrincipalId: string,
    filters: OrganizationGovernanceFilters = {},
  ): OrganizationWaitingQueueResult {
    return this.coordinationService.listOrganizationWaitingQueue(ownerPrincipalId, filters);
  }

  listOrganizationCollaborationDashboard(
    ownerPrincipalId: string,
    filters: OrganizationCollaborationDashboardFilters = {},
  ): OrganizationCollaborationDashboardResult {
    return this.coordinationService.listOrganizationCollaborationDashboard(ownerPrincipalId, filters);
  }

  getOrganizationGovernanceOverview(
    ownerPrincipalId: string,
    filters: OrganizationGovernanceFilters = {},
  ): OrganizationGovernanceOverview {
    return this.coordinationService.getOrganizationGovernanceOverview(ownerPrincipalId, filters);
  }

  getWorkItemDetailView(ownerPrincipalId: string, workItemId: string): ManagedAgentWorkItemDetailView | null {
    return this.coordinationService.getWorkItemDetailView(ownerPrincipalId, workItemId);
  }

  cancelWorkItem(input: CancelWorkItemInput): CancelWorkItemResult {
    return this.coordinationService.cancelWorkItem(input);
  }

  respondToHumanWaitingWorkItem(
    input: RespondToHumanWaitingWorkItemInput,
  ): RespondToHumanWaitingWorkItemResult {
    return this.coordinationService.respondToHumanWaitingWorkItem(input);
  }

  escalateWaitingAgentWorkItemToHuman(
    input: EscalateWaitingAgentWorkItemToHumanInput,
  ): EscalateWaitingAgentWorkItemToHumanResult {
    return this.coordinationService.escalateWaitingAgentWorkItemToHuman(input);
  }

  pullMailboxEntry(ownerPrincipalId: string, agentId: string, now?: string): PullMailboxEntryResult {
    return this.coordinationService.pullMailboxEntry(ownerPrincipalId, agentId, now);
  }

  ackMailboxEntry(ownerPrincipalId: string, agentId: string, mailboxEntryId: string, now?: string) {
    return this.coordinationService.ackMailboxEntry(ownerPrincipalId, agentId, mailboxEntryId, now);
  }

  respondToMailboxEntry(input: RespondToMailboxEntryInput): RespondToMailboxEntryResult {
    return this.coordinationService.respondToMailboxEntry(input);
  }

  getAgentHandoffListView(
    ownerPrincipalId: string,
    input: {
      agentId: string;
      workItemId?: string;
      limit?: number;
    },
  ): ManagedAgentHandoffListView {
    const detail = this.getManagedAgentDetailView(ownerPrincipalId, input.agentId);

    if (!detail?.agent) {
      throw new Error("Managed agent does not exist.");
    }

    const agents = new Map(
      this.listManagedAgents(ownerPrincipalId).agents.map((agent) => [agent.agentId, agent] as const),
    );
    const handoffs = this.coordinationService.listHandoffs(ownerPrincipalId, input).map((handoff) => {
      const fromAgent = agents.get(handoff.fromAgentId);
      const toAgent = agents.get(handoff.toAgentId);
      const counterpartyAgent = handoff.fromAgentId === input.agentId ? toAgent : fromAgent;

      return {
        ...handoff,
        ...(fromAgent ? { fromAgentDisplayName: fromAgent.displayName } : {}),
        ...(toAgent ? { toAgentDisplayName: toAgent.displayName } : {}),
        ...(counterpartyAgent ? { counterpartyDisplayName: counterpartyAgent.displayName } : {}),
      };
    });

    return {
      agent: detail.agent,
      handoffs,
      timeline: this.coordinationService.listTimeline(ownerPrincipalId, input),
    };
  }

  getAgentMailboxListView(ownerPrincipalId: string, agentId: string): ManagedAgentMailboxListView {
    const detail = this.getManagedAgentDetailView(ownerPrincipalId, agentId);

    if (!detail?.agent) {
      throw new Error("Managed agent does not exist.");
    }

    return {
      agent: detail.agent,
      items: this.coordinationService.listMailbox(ownerPrincipalId, agentId),
    };
  }

  listRuns(input: ManagedAgentRunListInput) {
    return this.schedulerService.listRuns(input);
  }

  getRunDetailView(ownerPrincipalId: string, runId: string): ManagedAgentRunDetailView | null {
    return this.schedulerService.getRunDetailView(ownerPrincipalId, runId);
  }

  registerNode(input: RegisterManagedAgentNodeInput): ManagedAgentNodeMutationResult {
    return this.nodeService.registerNode(input);
  }

  heartbeatNode(input: HeartbeatManagedAgentNodeInput): ManagedAgentNodeMutationResult {
    return this.nodeService.heartbeatNode(input);
  }

  listNodes(ownerPrincipalId: string, organizationId?: string) {
    return this.nodeService.listNodes(ownerPrincipalId, organizationId);
  }

  getNodeDetailView(ownerPrincipalId: string, nodeId: string): ManagedAgentNodeDetailView | null {
    return this.nodeService.getNodeDetailView(ownerPrincipalId, nodeId);
  }

  markNodeDraining(input: ManagedAgentNodeGovernanceInput): ManagedAgentNodeMutationResult {
    return this.nodeService.markNodeDraining(input);
  }

  markNodeOffline(input: ManagedAgentNodeGovernanceInput): ManagedAgentNodeMutationResult {
    return this.nodeService.markNodeOffline(input);
  }

  reclaimNodeLeases(input: ManagedAgentNodeLeaseReclaimInput): ManagedAgentNodeLeaseRecoveryResult {
    return this.nodeService.reclaimNodeLeases(input);
  }

  pullAssignedRun(input: PullManagedAgentAssignedRunInput): ManagedAgentWorkerAssignedRun | null {
    return this.workerService.pullAssignedRun(input);
  }

  updateWorkerRunStatus(input: UpdateManagedAgentWorkerRunStatusInput): ManagedAgentWorkerRunMutationResult {
    return this.workerService.updateRunStatus(input);
  }

  completeWorkerRun(input: CompleteManagedAgentWorkerRunInput): ManagedAgentWorkerRunMutationResult {
    return this.workerService.completeRun(input);
  }
}
