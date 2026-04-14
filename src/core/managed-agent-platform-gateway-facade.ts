import type {
  ManagedAgentControlPlaneFacadeLike,
  ManagedAgentHandoffListView,
  ManagedAgentIdleRecoverySuggestionsView,
  ManagedAgentLifecycleUpdateInput,
  ManagedAgentListView,
  ManagedAgentMailboxListView,
  ManagedAgentSpawnSuggestionsView,
} from "./managed-agent-control-plane-facade.js";
import type {
  CancelWorkItemInput,
  DispatchWorkItemInput,
  EscalateWaitingAgentWorkItemToHumanInput,
  OrganizationCollaborationDashboardResult,
  OrganizationGovernanceFilters,
  OrganizationGovernanceOverview,
  OrganizationWaitingQueueResult,
  RespondToHumanWaitingWorkItemInput,
  RespondToMailboxEntryInput,
} from "./managed-agent-coordination-service.js";
import type {
  ApproveManagedAgentIdleRecoverySuggestionInput,
  ApproveManagedAgentSpawnSuggestionInput,
  CreateManagedAgentInput,
  ManagedAgentExecutionBoundaryView,
  ManagedAgentOwnerView,
  ManagedAgentSpawnSuggestionDecisionInput,
  RestoreManagedAgentSpawnSuggestionInput,
  UpdateManagedAgentExecutionBoundaryInput,
  UpdateManagedAgentSpawnPolicyInput,
  UpsertProjectWorkspaceBindingInput,
} from "./managed-agents-service.js";
import type {
  HeartbeatManagedAgentNodeInput,
  ManagedAgentNodeDetailView,
  ManagedAgentNodeGovernanceInput,
  ManagedAgentNodeLeaseReclaimInput,
  ManagedAgentNodeLeaseRecoveryResult,
  ManagedAgentNodeMutationResult,
  RegisterManagedAgentNodeInput,
} from "./managed-agent-node-service.js";
import type {
  ManagedAgentRunDetailView,
  ManagedAgentRunListInput,
} from "./managed-agent-scheduler-service.js";
import type {
  CompleteManagedAgentWorkerRunInput,
  ManagedAgentWorkerAssignedRun,
  ManagedAgentWorkerRunMutationResult,
  PullManagedAgentAssignedRunInput,
  UpdateManagedAgentWorkerRunStatusInput,
} from "./managed-agent-worker-service.js";
import {
  ManagedAgentPlatformGatewayClient,
  type ManagedAgentPlatformGatewayClientOptions,
} from "./managed-agent-platform-gateway-client.js";

export interface CreateManagedAgentPlatformGatewayFacadeOptions extends ManagedAgentPlatformGatewayClientOptions {}

export function createManagedAgentPlatformGatewayFacade(
  options: CreateManagedAgentPlatformGatewayFacadeOptions,
): ManagedAgentControlPlaneFacadeLike {
  return new ManagedAgentPlatformGatewayFacade(options);
}

class ManagedAgentPlatformGatewayFacade implements ManagedAgentControlPlaneFacadeLike {
  private readonly client: ManagedAgentPlatformGatewayClient;
  private readonly ownerPrincipalId: string;

  constructor(options: CreateManagedAgentPlatformGatewayFacadeOptions) {
    this.client = new ManagedAgentPlatformGatewayClient(options);
    this.ownerPrincipalId = options.ownerPrincipalId;
  }

  async createManagedAgent(input: CreateManagedAgentInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.createManagedAgent(input);
  }

  async listManagedAgents(ownerPrincipalId: string): Promise<ManagedAgentListView> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.listManagedAgents();
  }

  async getSpawnSuggestionsView(ownerPrincipalId: string): Promise<ManagedAgentSpawnSuggestionsView> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getSpawnSuggestionsView();
  }

  async getIdleRecoverySuggestionsView(ownerPrincipalId: string): Promise<ManagedAgentIdleRecoverySuggestionsView> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getIdleRecoverySuggestionsView();
  }

  async getManagedAgentDetailView(ownerPrincipalId: string, agentId: string) {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getManagedAgentDetail(agentId);
  }

  async updateManagedAgentExecutionBoundary(
    input: UpdateManagedAgentExecutionBoundaryInput,
  ): Promise<ManagedAgentExecutionBoundaryView> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.updateManagedAgentExecutionBoundary(input);
  }

  async listProjectWorkspaceBindings(ownerPrincipalId: string, organizationId?: string) {
    this.assertOwned(ownerPrincipalId);
    return await this.client.listProjectWorkspaceBindings({
      ...(organizationId ? { organizationId } : {}),
    });
  }

  async getProjectWorkspaceBinding(ownerPrincipalId: string, projectId: string) {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getProjectWorkspaceBinding(projectId);
  }

  async upsertProjectWorkspaceBinding(input: UpsertProjectWorkspaceBindingInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.upsertProjectWorkspaceBinding(input);
  }

  async updateSpawnPolicy(input: UpdateManagedAgentSpawnPolicyInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.updateSpawnPolicy(input);
  }

  async approveSpawnSuggestion(input: ApproveManagedAgentSpawnSuggestionInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.approveSpawnSuggestion(input);
  }

  async ignoreSpawnSuggestion(input: ManagedAgentSpawnSuggestionDecisionInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.ignoreSpawnSuggestion(input);
  }

  async rejectSpawnSuggestion(input: ManagedAgentSpawnSuggestionDecisionInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.rejectSpawnSuggestion(input);
  }

  async restoreSpawnSuggestion(input: RestoreManagedAgentSpawnSuggestionInput) {
    this.assertOwned(input.ownerPrincipalId);
    const result = await this.client.restoreSpawnSuggestion(input);
    return result.auditLog;
  }

  async approveIdleRecoverySuggestion(input: ApproveManagedAgentIdleRecoverySuggestionInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.approveIdleRecoverySuggestion(input);
  }

  async updateManagedAgentLifecycle(input: ManagedAgentLifecycleUpdateInput): Promise<ManagedAgentOwnerView | null> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.updateManagedAgentLifecycle(input);
  }

  async dispatchWorkItem(input: DispatchWorkItemInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.dispatchWorkItem(input);
  }

  async listWorkItems(ownerPrincipalId: string, targetAgentId?: string) {
    this.assertOwned(ownerPrincipalId);
    return await this.client.listWorkItems({
      ...(targetAgentId ? { agentId: targetAgentId } : {}),
    });
  }

  async listOrganizationWaitingQueue(
    ownerPrincipalId: string,
    filters: OrganizationGovernanceFilters = {},
  ): Promise<OrganizationWaitingQueueResult> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.listOrganizationWaitingQueue(filters);
  }

  async listOrganizationCollaborationDashboard(
    ownerPrincipalId: string,
    filters: OrganizationGovernanceFilters = {},
  ): Promise<OrganizationCollaborationDashboardResult> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.listOrganizationCollaborationDashboard(filters);
  }

  async getOrganizationGovernanceOverview(
    ownerPrincipalId: string,
    filters: OrganizationGovernanceFilters = {},
  ): Promise<OrganizationGovernanceOverview> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getOrganizationGovernanceOverview(filters);
  }

  async getWorkItemDetailView(ownerPrincipalId: string, workItemId: string) {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getWorkItemDetail(workItemId);
  }

  async cancelWorkItem(input: CancelWorkItemInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.cancelWorkItem(input.workItemId);
  }

  async respondToHumanWaitingWorkItem(input: RespondToHumanWaitingWorkItemInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.respondToHumanWaitingWorkItem(input);
  }

  async escalateWaitingAgentWorkItemToHuman(input: EscalateWaitingAgentWorkItemToHumanInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.escalateWaitingAgentWorkItemToHuman(input);
  }

  async pullMailboxEntry(ownerPrincipalId: string, agentId: string, now?: string) {
    this.assertOwned(ownerPrincipalId);
    void now;
    return await this.client.pullMailboxEntry(agentId);
  }

  async ackMailboxEntry(ownerPrincipalId: string, agentId: string, mailboxEntryId: string, now?: string) {
    this.assertOwned(ownerPrincipalId);
    void now;
    const result = await this.client.ackMailboxEntry(agentId, mailboxEntryId);
    return result.mailboxEntry;
  }

  async respondToMailboxEntry(input: RespondToMailboxEntryInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.respondToMailboxEntry(input);
  }

  async getAgentHandoffListView(
    ownerPrincipalId: string,
    input: {
      agentId: string;
      workItemId?: string;
      limit?: number;
    },
  ): Promise<ManagedAgentHandoffListView> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getAgentHandoffListView(input);
  }

  async getAgentMailboxListView(ownerPrincipalId: string, agentId: string): Promise<ManagedAgentMailboxListView> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getAgentMailboxListView(agentId);
  }

  async listRuns(input: ManagedAgentRunListInput) {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.listRuns(input);
  }

  async getRunDetailView(ownerPrincipalId: string, runId: string): Promise<ManagedAgentRunDetailView | null> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getRunDetail(runId);
  }

  async registerNode(input: RegisterManagedAgentNodeInput): Promise<ManagedAgentNodeMutationResult> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.registerNode(input);
  }

  async heartbeatNode(input: HeartbeatManagedAgentNodeInput): Promise<ManagedAgentNodeMutationResult> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.heartbeatNode(input);
  }

  async listNodes(ownerPrincipalId: string, organizationId?: string) {
    this.assertOwned(ownerPrincipalId);
    return await this.client.listNodes({
      ...(organizationId ? { organizationId } : {}),
    });
  }

  async getNodeDetailView(ownerPrincipalId: string, nodeId: string): Promise<ManagedAgentNodeDetailView | null> {
    this.assertOwned(ownerPrincipalId);
    return await this.client.getNodeDetail(nodeId);
  }

  async markNodeDraining(input: ManagedAgentNodeGovernanceInput): Promise<ManagedAgentNodeMutationResult> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.markNodeDraining(input.nodeId);
  }

  async markNodeOffline(input: ManagedAgentNodeGovernanceInput): Promise<ManagedAgentNodeMutationResult> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.markNodeOffline(input.nodeId);
  }

  async reclaimNodeLeases(input: ManagedAgentNodeLeaseReclaimInput): Promise<ManagedAgentNodeLeaseRecoveryResult> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.reclaimNodeLeases(input);
  }

  async pullAssignedRun(input: PullManagedAgentAssignedRunInput): Promise<ManagedAgentWorkerAssignedRun | null> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.pullAssignedRun(input);
  }

  async updateWorkerRunStatus(input: UpdateManagedAgentWorkerRunStatusInput): Promise<ManagedAgentWorkerRunMutationResult> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.updateWorkerRunStatus(input);
  }

  async completeWorkerRun(input: CompleteManagedAgentWorkerRunInput): Promise<ManagedAgentWorkerRunMutationResult> {
    this.assertOwned(input.ownerPrincipalId);
    return await this.client.completeWorkerRun(input);
  }

  private assertOwned(ownerPrincipalId: string): void {
    if (ownerPrincipalId !== this.ownerPrincipalId) {
      throw new Error("Configured platform gateway ownerPrincipalId does not match request ownerPrincipalId.");
    }
  }
}
