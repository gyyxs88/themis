import type { ManagedAgentWorkerStore } from "../storage/index.js";
import type {
  ManagedAgentBootstrapProfile,
  StoredAgentExecutionLeaseRecord,
  StoredAgentMailboxEntryRecord,
  StoredAgentMessageRecord,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentNodeRecord,
  StoredManagedAgentRecord,
  StoredOrganizationRecord,
  TaskResult,
} from "../types/index.js";
import { MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN } from "../types/index.js";
import { ManagedAgentCoordinationService } from "./managed-agent-coordination-service.js";
import {
  ManagedAgentNodeService,
  type ManagedAgentNodeServiceOptions,
} from "./managed-agent-node-service.js";
import {
  ManagedAgentSchedulerService,
  type ManagedAgentSchedulerServiceOptions,
} from "./managed-agent-scheduler-service.js";
import {
  buildManagedAgentWorkerExecutionContract,
  type ManagedAgentWorkerExecutionContract,
} from "./managed-agent-worker-execution-contract.js";

const PULLABLE_NODE_STATUSES = new Set(["online", "draining"]);

export interface ManagedAgentWorkerServiceOptions {
  registry: ManagedAgentWorkerStore;
  nodeService?: ManagedAgentNodeService;
  schedulerService?: ManagedAgentSchedulerService;
  coordinationService?: ManagedAgentCoordinationService;
}

export interface PullManagedAgentAssignedRunInput {
  ownerPrincipalId: string;
  nodeId: string;
  now?: string;
}

export interface UpdateManagedAgentWorkerRunStatusInput {
  ownerPrincipalId: string;
  nodeId: string;
  runId: string;
  leaseToken: string;
  status: "starting" | "running" | "heartbeat" | "waiting_human" | "waiting_agent" | "failed" | "cancelled";
  failureCode?: string;
  failureMessage?: string;
  waitingAction?: ManagedAgentWorkerWaitingActionPayload;
  now?: string;
}

export interface CompleteManagedAgentWorkerRunInput {
  ownerPrincipalId: string;
  nodeId: string;
  runId: string;
  leaseToken: string;
  result?: ManagedAgentWorkerCompletionPayload;
  now?: string;
}

export interface ManagedAgentWorkerWaitingActionPayload {
  actionType?: string;
  actionId?: string;
  prompt?: string;
  message?: string;
  choices?: unknown;
  inputSchema?: unknown;
  requestId?: string;
  taskId?: string;
}

export interface ManagedAgentWorkerCompletionPayload {
  summary: string;
  output?: unknown;
  touchedFiles?: TaskResult["touchedFiles"];
  structuredOutput?: Record<string, unknown> | null;
  completedAt?: string;
}

export interface ManagedAgentWorkerAssignedRun {
  organization: StoredOrganizationRecord;
  node: StoredManagedAgentNodeRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  run: StoredAgentRunRecord;
  executionLease: StoredAgentExecutionLeaseRecord;
  executionContract: ManagedAgentWorkerExecutionContract;
}

export interface ManagedAgentWorkerRunMutationResult {
  organization: StoredOrganizationRecord;
  node: StoredManagedAgentNodeRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  run: StoredAgentRunRecord;
  executionLease: StoredAgentExecutionLeaseRecord;
}

export class ManagedAgentWorkerService {
  private readonly registry: ManagedAgentWorkerStore;
  private readonly nodeService: ManagedAgentNodeService;
  private readonly schedulerService: ManagedAgentSchedulerService;
  private readonly coordinationService: ManagedAgentCoordinationService;

  constructor(options: ManagedAgentWorkerServiceOptions) {
    this.registry = options.registry;
    this.nodeService = options.nodeService ?? new ManagedAgentNodeService({
      registry: options.registry as ManagedAgentNodeServiceOptions["registry"],
    });
    this.schedulerService = options.schedulerService ?? new ManagedAgentSchedulerService({
      registry: options.registry as unknown as ManagedAgentSchedulerServiceOptions["registry"],
    });
    this.coordinationService = options.coordinationService ?? new ManagedAgentCoordinationService({
      registry: options.registry as unknown as ConstructorParameters<typeof ManagedAgentCoordinationService>[0]["registry"],
    });
  }

  pullAssignedRun(input: PullManagedAgentAssignedRunInput): ManagedAgentWorkerAssignedRun | null {
    const now = normalizeNow(input.now);
    const node = this.requireOwnedNode(input.ownerPrincipalId, input.nodeId, now);

    if (!PULLABLE_NODE_STATUSES.has(node.status)) {
      return null;
    }

    const executionLease = this.registry.listAgentExecutionLeasesByNode(node.nodeId)
      .filter((lease) => lease.status === "active")
      .sort(compareByUpdatedAtAsc)
      .find((lease) => {
        const run = this.registry.getAgentRun(lease.runId);
        return run?.status === "created";
      });

    if (!executionLease) {
      return null;
    }

    return this.buildAssignedRun(node, executionLease);
  }

  updateRunStatus(input: UpdateManagedAgentWorkerRunStatusInput): ManagedAgentWorkerRunMutationResult {
    const now = normalizeNow(input.now);
    const { node, executionLease } = this.requireActiveLease(input.ownerPrincipalId, input.nodeId, input.runId, now);
    const leaseToken = normalizeRequiredText(input.leaseToken, "leaseToken is required.");
    let run: StoredAgentRunRecord;

    if (input.status === "starting") {
      run = this.schedulerService.markRunStarting(input.runId, leaseToken, now);
    } else if (input.status === "running") {
      run = this.schedulerService.markRunRunning(input.runId, leaseToken, now);
    } else if (input.status === "heartbeat") {
      run = this.schedulerService.heartbeatRun(input.runId, leaseToken, now);
    } else if (input.status === "waiting_human") {
      run = this.schedulerService.markRunWaiting(input.runId, leaseToken, "human", now);
      this.applyWaitingStatusSideEffects(run, "human", input.waitingAction, now);
    } else if (input.status === "waiting_agent") {
      run = this.schedulerService.markRunWaiting(input.runId, leaseToken, "agent", now);
      this.applyWaitingStatusSideEffects(run, "agent", input.waitingAction, now);
    } else if (input.status === "failed") {
      run = this.schedulerService.failRun(
        input.runId,
        leaseToken,
        normalizeOptionalText(input.failureCode) ?? "WORKER_NODE_REPORTED_FAILURE",
        normalizeOptionalText(input.failureMessage) ?? "Worker node reported the run as failed.",
        now,
      );
      this.applyFailureStatusSideEffects(
        run,
        normalizeOptionalText(input.failureMessage) ?? "Worker node reported the run as failed.",
        now,
      );
    } else {
      run = this.schedulerService.cancelRun(
        input.runId,
        leaseToken,
        normalizeOptionalText(input.failureCode) ?? "WORKER_NODE_REPORTED_CANCELLED",
        normalizeOptionalText(input.failureMessage) ?? "Worker node reported the run as cancelled.",
        now,
      );
    }

    return this.buildMutationResult(node, run, executionLease);
  }

  completeRun(input: CompleteManagedAgentWorkerRunInput): ManagedAgentWorkerRunMutationResult {
    const now = normalizeNow(input.now);
    const { node, executionLease } = this.requireActiveLease(input.ownerPrincipalId, input.nodeId, input.runId, now);
    const run = this.schedulerService.completeRun(
      input.runId,
      normalizeRequiredText(input.leaseToken, "leaseToken is required."),
      normalizeOptionalText(input.result?.completedAt) ?? now,
    );
    this.applyCompletionSideEffects(run, input.result, normalizeOptionalText(input.result?.completedAt) ?? now);
    return this.buildMutationResult(node, run, executionLease);
  }

  private requireOwnedNode(ownerPrincipalId: string, nodeId: string, now: string): StoredManagedAgentNodeRecord {
    const node = this.nodeService.getNode(
      normalizeRequiredText(ownerPrincipalId, "ownerPrincipalId is required."),
      normalizeRequiredText(nodeId, "nodeId is required."),
      now,
    );

    if (!node) {
      throw new Error("Managed agent node not found.");
    }

    return node;
  }

  private requireActiveLease(
    ownerPrincipalId: string,
    nodeId: string,
    runId: string,
    now: string,
  ): {
    node: StoredManagedAgentNodeRecord;
    executionLease: StoredAgentExecutionLeaseRecord;
  } {
    const node = this.requireOwnedNode(ownerPrincipalId, nodeId, now);
    const executionLease = this.registry.getActiveAgentExecutionLeaseByRun(
      normalizeRequiredText(runId, "runId is required."),
    );

    if (!executionLease) {
      throw new Error("Active execution lease not found.");
    }

    if (executionLease.nodeId !== node.nodeId) {
      throw new Error("Execution lease does not belong to the node.");
    }

    return {
      node,
      executionLease,
    };
  }

  private buildAssignedRun(
    node: StoredManagedAgentNodeRecord,
    executionLease: StoredAgentExecutionLeaseRecord,
  ): ManagedAgentWorkerAssignedRun {
    const run = this.registry.getAgentRun(executionLease.runId);
    const workItem = this.registry.getAgentWorkItem(executionLease.workItemId);
    const targetAgent = this.registry.getManagedAgent(executionLease.targetAgentId);

    if (!run || !workItem || !targetAgent) {
      throw new Error("Assigned execution lease lost its run, work item or target agent.");
    }

    const organization = this.registry.getOrganization(run.organizationId);
    if (!organization) {
      throw new Error("Assigned execution lease lost its organization.");
    }

    return {
      organization,
      node,
      targetAgent,
      workItem,
      run,
      executionLease,
      executionContract: buildManagedAgentWorkerExecutionContract(this.registry, {
        run,
        workItem,
        targetAgent,
      }),
    };
  }

  private buildMutationResult(
    node: StoredManagedAgentNodeRecord,
    run: StoredAgentRunRecord,
    fallbackLease: StoredAgentExecutionLeaseRecord,
  ): ManagedAgentWorkerRunMutationResult {
    const workItem = this.registry.getAgentWorkItem(run.workItemId);
    const targetAgent = this.registry.getManagedAgent(run.targetAgentId);
    const organization = this.registry.getOrganization(run.organizationId);
    const executionLease = this.resolveLatestExecutionLease(run.runId) ?? fallbackLease;

    if (!workItem || !targetAgent || !organization) {
      throw new Error("Run mutation lost its work item, target agent or organization.");
    }

    return {
      organization,
      node: this.registry.getManagedAgentNode(node.nodeId) ?? node,
      targetAgent,
      workItem,
      run,
      executionLease,
    };
  }

  private resolveLatestExecutionLease(runId: string): StoredAgentExecutionLeaseRecord | null {
    const activeLease = this.registry.getActiveAgentExecutionLeaseByRun(runId);

    if (activeLease) {
      return activeLease;
    }

    return this.registry.listAgentExecutionLeasesByRun(runId).sort(compareByUpdatedAtDesc)[0] ?? null;
  }

  private applyWaitingStatusSideEffects(
    run: StoredAgentRunRecord,
    waitingFor: "human" | "agent",
    waitingAction: ManagedAgentWorkerWaitingActionPayload | undefined,
    now: string,
  ): void {
    const context = this.requireExecutionContext(run.runId);
    const prompt = normalizeOptionalText(waitingAction?.prompt)
      ?? normalizeOptionalText(waitingAction?.message)
      ?? "Managed agent task is waiting for follow-up action.";

    this.registry.saveAgentWorkItem({
      ...context.workItem,
      status: waitingFor === "human" ? "waiting_human" : "waiting_agent",
      waitingActionRequest: {
        waitingFor,
        actionType: normalizeOptionalText(waitingAction?.actionType),
        actionId: normalizeOptionalText(waitingAction?.actionId),
        prompt,
        choices: waitingAction?.choices ?? null,
        inputSchema: waitingAction?.inputSchema ?? null,
        requestId: normalizeOptionalText(waitingAction?.requestId),
        taskId: normalizeOptionalText(waitingAction?.taskId) ?? run.runId,
        updatedAt: now,
      },
      latestHumanResponse: undefined,
      updatedAt: now,
    });

    this.updateManagedAgentBootstrapState(context.workItem, context.targetAgent.agentId, {
      bootstrapState: waitingFor === "human" ? "waiting_human" : "waiting_agent",
      updatedAt: now,
    });

    const sourceAgentId = normalizeOptionalText(context.workItem.sourceAgentId);

    if (!sourceAgentId) {
      return;
    }

    this.coordinationService.sendAgentMessage({
      ownerPrincipalId: context.organization.ownerPrincipalId,
      fromAgentId: context.targetAgent.agentId,
      toAgentId: sourceAgentId,
      workItemId: context.workItem.workItemId,
      runId: run.runId,
      messageType: normalizeOptionalText(waitingAction?.actionType) === "approval" ? "approval_request" : "question",
      payload: {
        status: "waiting_action",
        waitingFor,
        actionType: normalizeOptionalText(waitingAction?.actionType),
        actionId: normalizeOptionalText(waitingAction?.actionId),
        prompt,
        choices: waitingAction?.choices,
        inputSchema: waitingAction?.inputSchema,
        requestId: normalizeOptionalText(waitingAction?.requestId),
        taskId: normalizeOptionalText(waitingAction?.taskId) ?? run.runId,
      },
      priority: context.workItem.priority,
      requiresAck: true,
      now,
    });
  }

  private applyCompletionSideEffects(
    run: StoredAgentRunRecord,
    result: ManagedAgentWorkerCompletionPayload | undefined,
    now: string,
  ): void {
    const context = this.requireExecutionContext(run.runId);
    const summary = normalizeOptionalText(result?.summary) ?? context.workItem.goal;
    const completedAt = normalizeOptionalText(result?.completedAt) ?? now;

    this.updateManagedAgentBootstrapState(context.workItem, context.targetAgent.agentId, {
      agentStatus: "active",
      bootstrapState: "completed",
      summary,
      output: result?.output ?? result?.structuredOutput ?? null,
      completedAt,
      updatedAt: completedAt,
    });

    const sourceAgentId = normalizeOptionalText(context.workItem.sourceAgentId);

    if (!sourceAgentId) {
      return;
    }

    const notification = this.coordinationService.sendAgentMessage({
      ownerPrincipalId: context.organization.ownerPrincipalId,
      fromAgentId: context.targetAgent.agentId,
      toAgentId: sourceAgentId,
      workItemId: context.workItem.workItemId,
      runId: run.runId,
      messageType: "answer",
      payload: {
        status: "completed",
        summary,
        output: result?.output ?? null,
        touchedFiles: Array.isArray(result?.touchedFiles) ? result?.touchedFiles : [],
        structuredOutput: result?.structuredOutput ?? null,
        completedAt,
      },
      priority: context.workItem.priority,
      now: completedAt,
    });

    this.coordinationService.createAgentHandoff({
      ownerPrincipalId: context.organization.ownerPrincipalId,
      fromAgentId: context.targetAgent.agentId,
      toAgentId: sourceAgentId,
      workItemId: context.workItem.workItemId,
      sourceMessageId: notification.message.messageId,
      sourceRunId: run.runId,
      summary,
      attachedArtifacts: Array.isArray(result?.touchedFiles) ? result?.touchedFiles : [],
      payload: {
        status: "completed",
        summary,
        output: result?.output ?? null,
        structuredOutput: result?.structuredOutput ?? null,
        touchedFiles: result?.touchedFiles ?? [],
        completedAt,
      },
      now: completedAt,
    });
  }

  private applyFailureStatusSideEffects(run: StoredAgentRunRecord, failureMessage: string, now: string): void {
    const context = this.requireExecutionContext(run.runId);

    this.updateManagedAgentBootstrapState(context.workItem, context.targetAgent.agentId, {
      agentStatus: "degraded",
      bootstrapState: "failed",
      failureMessage,
      completedAt: now,
      updatedAt: now,
    });

    const sourceAgentId = normalizeOptionalText(context.workItem.sourceAgentId);

    if (!sourceAgentId) {
      return;
    }

    this.coordinationService.sendAgentMessage({
      ownerPrincipalId: context.organization.ownerPrincipalId,
      fromAgentId: context.targetAgent.agentId,
      toAgentId: sourceAgentId,
      workItemId: context.workItem.workItemId,
      runId: run.runId,
      messageType: "status_update",
      payload: {
        status: "failed",
        failureCode: run.failureCode ?? "WORKER_NODE_REPORTED_FAILURE",
        failureMessage,
        completedAt: run.completedAt ?? now,
      },
      priority: context.workItem.priority,
      now: run.completedAt ?? now,
    });
  }

  private requireExecutionContext(runId: string): {
    organization: StoredOrganizationRecord;
    targetAgent: StoredManagedAgentRecord;
    workItem: StoredAgentWorkItemRecord;
  } {
    const run = this.registry.getAgentRun(runId);
    const workItem = run ? this.registry.getAgentWorkItem(run.workItemId) : null;
    const targetAgent = run ? this.registry.getManagedAgent(run.targetAgentId) : null;
    const organization = run ? this.registry.getOrganization(run.organizationId) : null;

    if (!run || !workItem || !targetAgent || !organization) {
      throw new Error("Worker run mutation lost its organization, target agent or work item.");
    }

    return {
      organization,
      targetAgent,
      workItem,
    };
  }

  private updateManagedAgentBootstrapState(
    workItem: StoredAgentWorkItemRecord,
    targetAgentId: string,
    patch: {
      agentStatus?: StoredManagedAgentRecord["status"];
      bootstrapState: "pending" | "waiting_human" | "waiting_agent" | "completed" | "failed" | "cancelled";
      summary?: string;
      output?: unknown;
      failureMessage?: string;
      completedAt?: string;
      updatedAt: string;
    },
  ): void {
    const bootstrapPacket = resolveBootstrapContextPacket(workItem.contextPacket);

    if (!bootstrapPacket) {
      return;
    }

    const agent = this.registry.getManagedAgent(targetAgentId);

    if (!agent) {
      return;
    }

    const previousProfile = asRecord(agent.bootstrapProfile);
    const sourceSuggestionId = normalizeOptionalText(asString(previousProfile?.sourceSuggestionId))
      ?? normalizeOptionalText(asString(bootstrapPacket.sourceSuggestionId));
    const supervisor = asRecord(bootstrapPacket.supervisor);
    const supervisorAgentId = normalizeOptionalText(asString(previousProfile?.supervisorAgentId))
      ?? normalizeOptionalText(asString(supervisor?.agentId));
    const supervisorDisplayName = normalizeOptionalText(asString(previousProfile?.supervisorDisplayName))
      ?? normalizeOptionalText(asString(supervisor?.displayName));
    const auditFacts = asRecord(bootstrapPacket.auditFacts);
    const nextProfile: ManagedAgentBootstrapProfile = {
      mode: MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN,
      state: patch.bootstrapState,
      bootstrapWorkItemId: normalizeOptionalText(asString(previousProfile?.bootstrapWorkItemId))
        ?? normalizeOptionalText(asString(bootstrapPacket.bootstrapWorkItemId))
        ?? workItem.workItemId,
      ...(sourceSuggestionId ? { sourceSuggestionId } : {}),
      ...(supervisorAgentId ? { supervisorAgentId } : {}),
      ...(supervisorDisplayName ? { supervisorDisplayName } : {}),
      dispatchReason: normalizeOptionalText(asString(previousProfile?.dispatchReason)) ?? workItem.dispatchReason,
      goal: normalizeOptionalText(asString(previousProfile?.goal)) ?? workItem.goal,
      creationReason: normalizeOptionalText(asString(previousProfile?.creationReason))
        ?? normalizeOptionalText(asString(auditFacts?.creationReason))
        ?? workItem.dispatchReason,
      expectedScope: normalizeOptionalText(asString(previousProfile?.expectedScope))
        ?? normalizeOptionalText(asString(auditFacts?.expectedScope))
        ?? "",
      insufficiencyReason: normalizeOptionalText(asString(previousProfile?.insufficiencyReason))
        ?? normalizeOptionalText(asString(auditFacts?.insufficiencyReason))
        ?? "",
      namingBasis: normalizeOptionalText(asString(previousProfile?.namingBasis))
        ?? normalizeOptionalText(asString(auditFacts?.namingBasis))
        ?? "",
      collaborationContract: (
        asRecord(previousProfile?.collaborationContract)
        ?? asRecord(bootstrapPacket.collaborationContract)
        ?? {
          communicationMode: "agent_only",
          humanExposurePolicy: agent.exposurePolicy,
          escalationRoute: "必要时经由组织级入口升级。",
        }
      ) as ManagedAgentBootstrapProfile["collaborationContract"],
      checklist: Array.isArray(previousProfile?.checklist)
        ? previousProfile.checklist.filter((value): value is string => typeof value === "string")
        : Array.isArray(bootstrapPacket.checklist)
          ? bootstrapPacket.checklist.filter((value): value is string => typeof value === "string")
          : [],
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.output !== undefined ? { output: patch.output } : {}),
      ...(patch.failureMessage !== undefined ? { failureMessage: patch.failureMessage } : {}),
      createdAt: normalizeOptionalText(asString(previousProfile?.createdAt)) ?? patch.updatedAt,
      updatedAt: patch.updatedAt,
      ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
    };

    this.registry.saveManagedAgent({
      ...agent,
      ...(patch.agentStatus ? { status: patch.agentStatus } : {}),
      bootstrapProfile: nextProfile,
      ...(patch.agentStatus === "active" && patch.completedAt ? { bootstrappedAt: patch.completedAt } : {}),
      updatedAt: patch.updatedAt,
    });
  }
}

function compareByUpdatedAtAsc<T extends { updatedAt: string; createdAt: string }>(left: T, right: T): number {
  const updatedDelta = toTimestamp(left.updatedAt) - toTimestamp(right.updatedAt);

  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return toTimestamp(left.createdAt) - toTimestamp(right.createdAt);
}

function compareByUpdatedAtDesc<T extends { updatedAt: string; createdAt: string }>(left: T, right: T): number {
  return compareByUpdatedAtAsc(right, left);
}

function normalizeNow(value?: string): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}

function normalizeOptionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredText(value: string | null | undefined, message: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function resolveBootstrapContextPacket(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return normalizeOptionalText(asString(record.systemTaskKind)) === MANAGED_AGENT_BOOTSTRAP_MODE_AUTO_SPAWN
    ? record
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
