import {
  ManagedAgentsService,
  type CreateManagedAgentInput,
  type CreateManagedAgentResult,
  type ManagedAgentDetailView,
  type ManagedAgentOwnerView,
  type UpdateManagedAgentExecutionBoundaryInput,
  type ManagedAgentExecutionBoundaryView,
} from "./managed-agents-service.js";
import {
  ManagedAgentCoordinationService,
  type DispatchWorkItemInput,
  type DispatchWorkItemResult,
  type ManagedAgentWorkItemDetailView,
} from "./managed-agent-coordination-service.js";
import {
  ManagedAgentSchedulerService,
  type ManagedAgentRunDetailView,
  type ManagedAgentRunListInput,
} from "./managed-agent-scheduler-service.js";
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

  getManagedAgentDetailView(ownerPrincipalId: string, agentId: string): ManagedAgentDetailView | null {
    return this.managedAgentsService.getManagedAgentDetailView(ownerPrincipalId, agentId);
  }

  updateManagedAgentExecutionBoundary(
    input: UpdateManagedAgentExecutionBoundaryInput,
  ): ManagedAgentExecutionBoundaryView {
    return this.managedAgentsService.updateManagedAgentExecutionBoundary(input);
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

  getWorkItemDetailView(ownerPrincipalId: string, workItemId: string): ManagedAgentWorkItemDetailView | null {
    return this.coordinationService.getWorkItemDetailView(ownerPrincipalId, workItemId);
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
