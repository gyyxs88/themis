import type { ManagedAgentWorkerStore } from "../storage/index.js";
import type {
  StoredAgentExecutionLeaseRecord,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentNodeRecord,
  StoredManagedAgentRecord,
  StoredOrganizationRecord,
} from "../types/index.js";
import {
  ManagedAgentNodeService,
  type ManagedAgentNodeServiceOptions,
} from "./managed-agent-node-service.js";
import {
  ManagedAgentSchedulerService,
  type ManagedAgentSchedulerServiceOptions,
} from "./managed-agent-scheduler-service.js";

const PULLABLE_NODE_STATUSES = new Set(["online", "draining"]);

export interface ManagedAgentWorkerServiceOptions {
  registry: ManagedAgentWorkerStore;
  nodeService?: ManagedAgentNodeService;
  schedulerService?: ManagedAgentSchedulerService;
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
  now?: string;
}

export interface CompleteManagedAgentWorkerRunInput {
  ownerPrincipalId: string;
  nodeId: string;
  runId: string;
  leaseToken: string;
  now?: string;
}

export interface ManagedAgentWorkerAssignedRun {
  organization: StoredOrganizationRecord;
  node: StoredManagedAgentNodeRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  run: StoredAgentRunRecord;
  executionLease: StoredAgentExecutionLeaseRecord;
}

export interface ManagedAgentWorkerRunMutationResult extends ManagedAgentWorkerAssignedRun {}

export class ManagedAgentWorkerService {
  private readonly registry: ManagedAgentWorkerStore;
  private readonly nodeService: ManagedAgentNodeService;
  private readonly schedulerService: ManagedAgentSchedulerService;

  constructor(options: ManagedAgentWorkerServiceOptions) {
    this.registry = options.registry;
    this.nodeService = options.nodeService ?? new ManagedAgentNodeService({
      registry: options.registry as ManagedAgentNodeServiceOptions["registry"],
    });
    this.schedulerService = options.schedulerService ?? new ManagedAgentSchedulerService({
      registry: options.registry as unknown as ManagedAgentSchedulerServiceOptions["registry"],
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
    } else if (input.status === "waiting_agent") {
      run = this.schedulerService.markRunWaiting(input.runId, leaseToken, "agent", now);
    } else if (input.status === "failed") {
      run = this.schedulerService.failRun(
        input.runId,
        leaseToken,
        normalizeOptionalText(input.failureCode) ?? "WORKER_NODE_REPORTED_FAILURE",
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
      now,
    );
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

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
