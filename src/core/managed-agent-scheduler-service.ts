import type { ManagedAgentSchedulerStore, StoredPrincipalRecord } from "../storage/index.js";
import {
  reclaimManagedAgentExecutionLease,
  resolveWorkItemStatusAfterInterruptedRun,
  type ManagedAgentReclaimedLeaseContext,
} from "./managed-agent-lease-recovery.js";
import type { ManagedAgentCompletionDetailLevel } from "./managed-agent-completion-insight.js";
import { isManagedAgentNodeHeartbeatExpired } from "./managed-agent-node-service.js";
import type {
  StoredAgentExecutionLeaseRecord,
  AgentRunStatus,
  ManagedAgentWorkItemStatus,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentRecord,
  StoredManagedAgentNodeRecord,
  StoredOrganizationRecord,
  TaskResult,
} from "../types/index.js";

const DEFAULT_SCHEDULER_ID = "scheduler-local";
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RUNNABLE_SCAN_LIMIT = 100;
const ACTIVE_RUN_STATUSES = new Set<AgentRunStatus>(["created", "starting", "running", "waiting_action"]);
const NODE_OFFLINE_AUTO_RECLAIM_FAILURE_CODE = "NODE_OFFLINE_LEASE_RECLAIMED";
const NODE_OFFLINE_AUTO_RECLAIM_FAILURE_MESSAGE = "Execution lease was reclaimed because the assigned node is offline.";

export interface ManagedAgentSchedulerServiceOptions {
  registry: ManagedAgentSchedulerStore;
  defaultSchedulerId?: string;
  leaseTtlMs?: number;
  allowNodelessClaims?: boolean;
  runnableScanLimit?: number;
}

export interface ManagedAgentSchedulerClaim {
  organization: StoredOrganizationRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  run: StoredAgentRunRecord;
  node: StoredManagedAgentNodeRecord | null;
  executionLease: StoredAgentExecutionLeaseRecord | null;
}

export interface ClaimNextRunnableWorkItemInput {
  schedulerId?: string;
  organizationId?: string;
  targetAgentId?: string;
  now?: string;
}

export interface ManagedAgentRunListInput {
  ownerPrincipalId: string;
  agentId?: string;
  workItemId?: string;
}

export interface ManagedAgentSchedulerTickResult {
  reclaimedLeases: ManagedAgentReclaimedLeaseContext[];
  recoveredRuns: StoredAgentRunRecord[];
  claimed: ManagedAgentSchedulerClaim | null;
}

export interface ManagedAgentRunDetailView {
  organization: StoredOrganizationRecord | null;
  targetAgent: StoredManagedAgentRecord | null;
  workItem: StoredAgentWorkItemRecord | null;
  run: StoredAgentRunRecord;
  node: StoredManagedAgentNodeRecord | null;
  executionLease: StoredAgentExecutionLeaseRecord | null;
  completionResult?: {
    summary: string;
    output?: unknown;
    touchedFiles?: TaskResult["touchedFiles"];
    structuredOutput?: Record<string, unknown> | null;
    completedAt?: string;
    detailLevel?: ManagedAgentCompletionDetailLevel;
    interpretationHint?: string;
  } | null;
}

export class ManagedAgentSchedulerService {
  private readonly registry: ManagedAgentSchedulerStore;
  private readonly defaultSchedulerId: string;
  private readonly leaseTtlMs: number;
  private readonly allowNodelessClaims: boolean;
  private readonly runnableScanLimit: number;

  constructor(options: ManagedAgentSchedulerServiceOptions) {
    this.registry = options.registry;
    this.defaultSchedulerId = normalizeOptionalText(options.defaultSchedulerId) ?? DEFAULT_SCHEDULER_ID;
    this.leaseTtlMs = Number.isFinite(options.leaseTtlMs) && (options.leaseTtlMs as number) > 0
      ? Math.floor(options.leaseTtlMs as number)
      : DEFAULT_LEASE_TTL_MS;
    this.allowNodelessClaims = options.allowNodelessClaims ?? true;
    this.runnableScanLimit = Number.isFinite(options.runnableScanLimit) && (options.runnableScanLimit as number) > 0
      ? Math.floor(options.runnableScanLimit as number)
      : DEFAULT_RUNNABLE_SCAN_LIMIT;
  }

  listRuns(input: ManagedAgentRunListInput): StoredAgentRunRecord[] {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const agentId = normalizeOptionalText(input.agentId);
    const workItemId = normalizeOptionalText(input.workItemId);
    let runs = this.registry.listAgentRunsByOwnerPrincipal(owner.principalId);

    if (agentId) {
      this.requireOwnedAgent(owner.principalId, agentId);
      runs = runs.filter((run) => run.targetAgentId === agentId);
    }

    if (workItemId) {
      this.requireOwnedWorkItem(owner.principalId, workItemId);
      runs = runs.filter((run) => run.workItemId === workItemId);
    }

    return runs;
  }

  getRun(ownerPrincipalId: string, runId: string): StoredAgentRunRecord | null {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const run = this.registry.getAgentRun(normalizeRequiredText(runId, "Run id is required."));

    if (!run) {
      return null;
    }

    return this.isOrganizationOwnedBy(run.organizationId, owner.principalId) ? run : null;
  }

  getRunDetailView(ownerPrincipalId: string, runId: string): ManagedAgentRunDetailView | null {
    const run = this.getRun(ownerPrincipalId, runId);

    if (!run) {
      return null;
    }

    return {
      organization: this.registry.getOrganization(run.organizationId),
      targetAgent: this.registry.getManagedAgent(run.targetAgentId),
      workItem: this.registry.getAgentWorkItem(run.workItemId),
      run,
      executionLease: this.registry.getActiveAgentExecutionLeaseByRun(run.runId),
      node: resolveLeaseNode(this.registry, this.registry.getActiveAgentExecutionLeaseByRun(run.runId)),
    };
  }

  tick(input: ClaimNextRunnableWorkItemInput = {}): ManagedAgentSchedulerTickResult {
    const now = normalizeNow(input.now);
    const reclaimedLeases = this.reclaimOfflineNodeLeases(now);
    const recoveredRuns = this.recoverStaleRuns(now);
    const claimed = this.claimNextRunnableWorkItem({
      ...input,
      now,
    });

    return {
      reclaimedLeases,
      recoveredRuns,
      claimed,
    };
  }

  recoverStaleRuns(now?: string): StoredAgentRunRecord[] {
    const normalizedNow = normalizeNow(now);
    const staleRuns = this.registry.listStaleActiveAgentRuns(normalizedNow);
    const recoveredRuns: StoredAgentRunRecord[] = [];

    for (const run of staleRuns) {
      if (!ACTIVE_RUN_STATUSES.has(run.status)) {
        continue;
      }

      const workItem = this.registry.getAgentWorkItem(run.workItemId);
      const interruptedRun: StoredAgentRunRecord = {
        ...run,
        status: "interrupted",
        leaseExpiresAt: normalizedNow,
        completedAt: normalizedNow,
        failureCode: run.failureCode ?? "LEASE_EXPIRED",
        failureMessage: run.failureMessage ?? "Scheduler lease expired before the run reported completion.",
        updatedAt: normalizedNow,
      };
      this.registry.saveAgentRun(interruptedRun);
      recoveredRuns.push(this.registry.getAgentRun(run.runId) ?? interruptedRun);
      this.releaseExecutionLease(run.runId, "expired", normalizedNow);

      if (!workItem) {
        continue;
      }

      const nextWorkItemStatus = resolveWorkItemStatusAfterInterruptedRun(workItem.status);

      if (nextWorkItemStatus === workItem.status) {
        continue;
      }

      this.registry.saveAgentWorkItem({
        ...workItem,
        status: nextWorkItemStatus,
        updatedAt: normalizedNow,
      });
    }

    return recoveredRuns;
  }

  claimNextRunnableWorkItem(input: ClaimNextRunnableWorkItemInput = {}): ManagedAgentSchedulerClaim | null {
    const schedulerId = normalizeOptionalText(input.schedulerId) ?? this.defaultSchedulerId;
    const now = normalizeNow(input.now);
    const claimInput = {
      schedulerId,
      leaseToken: createId("run-lease"),
      leaseExpiresAt: computeLeaseExpiry(now, this.leaseTtlMs),
      now,
      ...(normalizeOptionalText(input.organizationId) ? { organizationId: input.organizationId } : {}),
      ...(normalizeOptionalText(input.targetAgentId) ? { targetAgentId: input.targetAgentId } : {}),
    };
    const claim = this.allowNodelessClaims
      ? this.registry.claimNextRunnableAgentWorkItem(claimInput)
      : this.claimNextRunnableWorkItemRequiringNode(claimInput);

    if (!claim) {
      return null;
    }

    const organization = this.registry.getOrganization(claim.workItem.organizationId);
    const targetAgent = this.registry.getManagedAgent(claim.workItem.targetAgentId);

    if (!organization || !targetAgent) {
      throw new Error("Claimed agent work item lost its organization or target agent.");
    }

    const node = this.selectExecutionNode(claim.workItem, now);
    const executionLease = node
      ? this.createExecutionLease({
        run: claim.run,
        workItem: claim.workItem,
        node,
        now,
      })
      : null;

    return {
      organization,
      targetAgent,
      workItem: claim.workItem,
      run: claim.run,
      node,
      executionLease,
    };
  }

  private claimNextRunnableWorkItemRequiringNode(input: {
    schedulerId: string;
    leaseToken: string;
    leaseExpiresAt: string;
    now: string;
    organizationId?: string;
    targetAgentId?: string;
  }): { workItem: StoredAgentWorkItemRecord; run: StoredAgentRunRecord } | null {
    const candidates = this.registry.listRunnableAgentWorkItems({
      now: input.now,
      ...(normalizeOptionalText(input.organizationId) ? { organizationId: input.organizationId } : {}),
      ...(normalizeOptionalText(input.targetAgentId) ? { targetAgentId: input.targetAgentId } : {}),
      limit: this.runnableScanLimit,
    });

    for (const candidate of candidates) {
      if (!this.selectExecutionNode(candidate, input.now)) {
        continue;
      }

      const claimed = this.registry.claimRunnableAgentWorkItemById({
        workItemId: candidate.workItemId,
        schedulerId: input.schedulerId,
        leaseToken: input.leaseToken,
        leaseExpiresAt: input.leaseExpiresAt,
        now: input.now,
      });

      if (claimed) {
        return claimed;
      }
    }

    return null;
  }

  markRunStarting(runId: string, leaseToken: string, now?: string): StoredAgentRunRecord {
    const normalizedNow = normalizeNow(now);
    const { run, workItem } = this.requireRunnableRun(runId, leaseToken);
    const nextRun = this.saveRunTransition(run, {
      status: "starting",
      leaseExpiresAt: computeLeaseExpiry(normalizedNow, this.leaseTtlMs),
      lastHeartbeatAt: normalizedNow,
      updatedAt: normalizedNow,
    });
    this.touchExecutionLease(nextRun, normalizedNow);

    if (workItem.status === "queued") {
      this.registry.saveAgentWorkItem({
        ...workItem,
        status: "planning",
        updatedAt: normalizedNow,
      });
    }

    return nextRun;
  }

  markRunRunning(runId: string, leaseToken: string, now?: string): StoredAgentRunRecord {
    const normalizedNow = normalizeNow(now);
    const { run, workItem } = this.requireRunnableRun(runId, leaseToken);
    const nextRun = this.saveRunTransition(run, {
      status: "running",
      startedAt: run.startedAt ?? normalizedNow,
      leaseExpiresAt: computeLeaseExpiry(normalizedNow, this.leaseTtlMs),
      lastHeartbeatAt: normalizedNow,
      updatedAt: normalizedNow,
    });
    this.touchExecutionLease(nextRun, normalizedNow);

    if (workItem.status !== "running") {
      this.registry.saveAgentWorkItem({
        ...workItem,
        status: "running",
        startedAt: workItem.startedAt ?? normalizedNow,
        updatedAt: normalizedNow,
      });
    }

    return nextRun;
  }

  heartbeatRun(runId: string, leaseToken: string, now?: string): StoredAgentRunRecord {
    const normalizedNow = normalizeNow(now);
    const { run } = this.requireRunnableRun(runId, leaseToken);
    const nextRun = this.saveRunTransition(run, {
      leaseExpiresAt: computeLeaseExpiry(normalizedNow, this.leaseTtlMs),
      lastHeartbeatAt: normalizedNow,
      updatedAt: normalizedNow,
    });
    this.touchExecutionLease(nextRun, normalizedNow);
    return nextRun;
  }

  markRunWaiting(runId: string, leaseToken: string, waitingFor: "human" | "agent", now?: string): StoredAgentRunRecord {
    const normalizedNow = normalizeNow(now);
    const { run, workItem } = this.requireRunnableRun(runId, leaseToken);
    const nextRun = this.saveRunTransition(run, {
      status: "waiting_action",
      leaseExpiresAt: computeLeaseExpiry(normalizedNow, this.leaseTtlMs),
      lastHeartbeatAt: normalizedNow,
      updatedAt: normalizedNow,
    });
    this.touchExecutionLease(nextRun, normalizedNow);

    const nextWorkItemStatus: ManagedAgentWorkItemStatus = waitingFor === "human"
      ? "waiting_human"
      : "waiting_agent";

    this.registry.saveAgentWorkItem({
      ...workItem,
      status: nextWorkItemStatus,
      updatedAt: normalizedNow,
    });

    return nextRun;
  }

  completeRun(runId: string, leaseToken: string, now?: string): StoredAgentRunRecord {
    const normalizedNow = normalizeNow(now);
    const { run, workItem } = this.requireRunnableRun(runId, leaseToken);
    const nextRun = this.saveRunTransition(run, {
      status: "completed",
      leaseExpiresAt: normalizedNow,
      completedAt: normalizedNow,
      lastHeartbeatAt: normalizedNow,
      updatedAt: normalizedNow,
    });
    this.releaseExecutionLease(run.runId, "released", normalizedNow);

    this.registry.saveAgentWorkItem({
      ...workItem,
      status: "completed",
      waitingActionRequest: undefined,
      latestHumanResponse: undefined,
      completedAt: normalizedNow,
      updatedAt: normalizedNow,
    });

    return nextRun;
  }

  failRun(runId: string, leaseToken: string, failureCode: string, failureMessage: string, now?: string): StoredAgentRunRecord {
    const normalizedNow = normalizeNow(now);
    const { run, workItem } = this.requireRunnableRun(runId, leaseToken);
    const nextRun = this.saveRunTransition(run, {
      status: "failed",
      leaseExpiresAt: normalizedNow,
      completedAt: normalizedNow,
      lastHeartbeatAt: normalizedNow,
      failureCode: normalizeRequiredText(failureCode, "Failure code is required."),
      failureMessage: normalizeRequiredText(failureMessage, "Failure message is required."),
      updatedAt: normalizedNow,
    });
    this.releaseExecutionLease(run.runId, "revoked", normalizedNow);

    this.registry.saveAgentWorkItem({
      ...workItem,
      status: "failed",
      waitingActionRequest: undefined,
      latestHumanResponse: undefined,
      completedAt: normalizedNow,
      updatedAt: normalizedNow,
    });

    return nextRun;
  }

  cancelRun(runId: string, leaseToken: string, failureCode: string, failureMessage: string, now?: string): StoredAgentRunRecord {
    const normalizedNow = normalizeNow(now);
    const { run } = this.requireRunnableRun(runId, leaseToken);
    const nextRun = this.saveRunTransition(run, {
      status: "cancelled",
      leaseExpiresAt: normalizedNow,
      completedAt: normalizedNow,
      lastHeartbeatAt: normalizedNow,
      failureCode: normalizeRequiredText(failureCode, "Failure code is required."),
      failureMessage: normalizeRequiredText(failureMessage, "Failure message is required."),
      updatedAt: normalizedNow,
    });
    this.releaseExecutionLease(run.runId, "revoked", normalizedNow);
    return nextRun;
  }

  private selectExecutionNode(workItem: StoredAgentWorkItemRecord, now: string): StoredManagedAgentNodeRecord | null {
    this.markStaleNodesOffline(workItem.organizationId, now);
    const nodes = this.registry.listManagedAgentNodesByOrganization(workItem.organizationId);
    const matched = nodes.filter((node) => canNodeRunWorkItem(node, workItem));

    const preferredNodeId = resolveWaitingResumePreferredNodeId(this.registry, workItem.workItemId);
    if (preferredNodeId) {
      const preferredNode = matched.find((node) => node.nodeId === preferredNodeId);

      if (preferredNode) {
        return preferredNode;
      }
    }

    const projectBinding = resolveProjectWorkspaceBinding(this.registry, workItem);
    const stickyProjectNodeIds = projectBinding
      ? resolveProjectBindingStickyNodeIds(projectBinding)
      : [];

    if (stickyProjectNodeIds.length > 0) {
      for (const nodeId of stickyProjectNodeIds) {
        const preferredNode = matched.find((node) => node.nodeId === nodeId);

        if (preferredNode) {
          return preferredNode;
        }
      }

      if (projectBinding?.continuityMode === "sticky") {
        return null;
      }
    }

    return matched[0] ?? null;
  }

  private reclaimOfflineNodeLeases(now: string): ManagedAgentReclaimedLeaseContext[] {
    const reclaimedLeases: ManagedAgentReclaimedLeaseContext[] = [];
    const activeLeases = this.registry.listActiveAgentExecutionLeases()
      .sort(compareLeasesByUpdatedAtDesc);

    for (const lease of activeLeases) {
      const node = this.resolveNodeForActiveLeaseRecovery(lease.nodeId, now);

      if (node && node.status !== "offline") {
        continue;
      }

      reclaimedLeases.push(reclaimManagedAgentExecutionLease(this.registry, lease, now, {
        failureCode: NODE_OFFLINE_AUTO_RECLAIM_FAILURE_CODE,
        failureMessage: NODE_OFFLINE_AUTO_RECLAIM_FAILURE_MESSAGE,
      }));
    }

    return reclaimedLeases;
  }

  private createExecutionLease(input: {
    run: StoredAgentRunRecord;
    workItem: StoredAgentWorkItemRecord;
    node: StoredManagedAgentNodeRecord;
    now: string;
  }): StoredAgentExecutionLeaseRecord {
    const executionLease: StoredAgentExecutionLeaseRecord = {
      leaseId: createId("execution-lease"),
      runId: input.run.runId,
      workItemId: input.workItem.workItemId,
      targetAgentId: input.run.targetAgentId,
      nodeId: input.node.nodeId,
      status: "active",
      leaseToken: input.run.leaseToken,
      leaseExpiresAt: input.run.leaseExpiresAt,
      lastHeartbeatAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };

    this.registry.saveAgentExecutionLease(executionLease);
    this.saveNodeSlotAvailability(input.node, input.node.slotAvailable - 1, input.now);
    this.updateProjectWorkspaceBindingLastActiveNode(input.workItem, input.node.nodeId, input.now);
    return this.registry.getActiveAgentExecutionLeaseByRun(input.run.runId) ?? executionLease;
  }

  private updateProjectWorkspaceBindingLastActiveNode(
    workItem: StoredAgentWorkItemRecord,
    nodeId: string,
    now: string,
  ): void {
    const binding = resolveProjectWorkspaceBinding(this.registry, workItem);

    if (!binding) {
      return;
    }

    this.registry.saveProjectWorkspaceBinding({
      ...binding,
      lastActiveNodeId: nodeId,
      ...(workItem.workspacePolicySnapshot?.workspacePath
        ? { lastActiveWorkspacePath: workItem.workspacePolicySnapshot.workspacePath }
        : {}),
      updatedAt: now,
    });
  }

  private touchExecutionLease(run: StoredAgentRunRecord, now: string): void {
    const activeLease = this.registry.getActiveAgentExecutionLeaseByRun(run.runId);

    if (!activeLease) {
      return;
    }

    this.registry.saveAgentExecutionLease({
      ...activeLease,
      leaseToken: run.leaseToken,
      leaseExpiresAt: run.leaseExpiresAt,
      lastHeartbeatAt: now,
      updatedAt: now,
    });
  }

  private releaseExecutionLease(
    runId: string,
    status: StoredAgentExecutionLeaseRecord["status"],
    now: string,
  ): void {
    const activeLease = this.registry.getActiveAgentExecutionLeaseByRun(runId);

    if (!activeLease) {
      return;
    }

    this.registry.saveAgentExecutionLease({
      ...activeLease,
      status,
      leaseExpiresAt: now,
      lastHeartbeatAt: now,
      updatedAt: now,
    });

    const node = this.registry.getManagedAgentNode(activeLease.nodeId);
    if (node) {
      this.saveNodeSlotAvailability(node, node.slotAvailable + 1, now);
    }
  }

  private saveNodeSlotAvailability(node: StoredManagedAgentNodeRecord, slotAvailable: number, now: string): void {
    this.registry.saveManagedAgentNode({
      ...node,
      slotAvailable: node.status === "offline"
        ? 0
        : Math.max(0, Math.min(node.slotCapacity, Math.floor(slotAvailable))),
      updatedAt: now,
    });
  }

  private markStaleNodesOffline(organizationId: string, now: string): void {
    const nodes = this.registry.listManagedAgentNodesByOrganization(organizationId);

    for (const node of nodes) {
      this.resolveNodeForActiveLeaseRecovery(node.nodeId, now);
    }
  }

  private resolveNodeForActiveLeaseRecovery(nodeId: string, now: string): StoredManagedAgentNodeRecord | null {
    const node = this.registry.getManagedAgentNode(nodeId);

    if (!node) {
      return null;
    }

    if (!isManagedAgentNodeHeartbeatExpired(node, now)) {
      return node;
    }

    if (node.status === "offline" && node.slotAvailable === 0) {
      return node;
    }

    const offlineNode: StoredManagedAgentNodeRecord = {
      ...node,
      status: "offline",
      slotAvailable: 0,
      updatedAt: now,
    };
    this.registry.saveManagedAgentNode(offlineNode);
    return this.registry.getManagedAgentNode(node.nodeId) ?? offlineNode;
  }

  private saveRunTransition(run: StoredAgentRunRecord, patch: Partial<StoredAgentRunRecord>): StoredAgentRunRecord {
    const nextRun: StoredAgentRunRecord = {
      ...run,
      ...patch,
    };
    this.registry.saveAgentRun(nextRun);
    return this.registry.getAgentRun(run.runId) ?? nextRun;
  }

  private requireRunnableRun(runId: string, leaseToken: string): {
    run: StoredAgentRunRecord;
    workItem: StoredAgentWorkItemRecord;
  } {
    const normalizedRunId = normalizeRequiredText(runId, "Run id is required.");
    const normalizedLeaseToken = normalizeRequiredText(leaseToken, "Run lease token is required.");
    const run = this.registry.getAgentRun(normalizedRunId);

    if (!run) {
      throw new Error("Agent run does not exist.");
    }

    if (run.leaseToken !== normalizedLeaseToken) {
      throw new Error("Run lease token is invalid.");
    }

    if (!ACTIVE_RUN_STATUSES.has(run.status)) {
      throw new Error("Agent run is not active.");
    }

    const workItem = this.registry.getAgentWorkItem(run.workItemId);

    if (!workItem) {
      throw new Error("Work item does not exist.");
    }

    return {
      run,
      workItem,
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

  private requireOwnedAgent(ownerPrincipalId: string, agentId: string): StoredManagedAgentRecord {
    const agent = this.registry.getManagedAgent(normalizeRequiredText(agentId, "Agent id is required."));

    if (!agent || !this.isOrganizationOwnedBy(agent.organizationId, ownerPrincipalId)) {
      throw new Error("Managed agent does not exist.");
    }

    return agent;
  }

  private requireOwnedWorkItem(ownerPrincipalId: string, workItemId: string): StoredAgentWorkItemRecord {
    const workItem = this.registry.getAgentWorkItem(normalizeRequiredText(workItemId, "Work item id is required."));

    if (!workItem || !this.isOrganizationOwnedBy(workItem.organizationId, ownerPrincipalId)) {
      throw new Error("Work item does not exist.");
    }

    return workItem;
  }

  private isOrganizationOwnedBy(organizationId: string, ownerPrincipalId: string): boolean {
    const organization = this.registry.getOrganization(organizationId);
    return organization?.ownerPrincipalId === ownerPrincipalId;
  }
}

function normalizeNow(value?: string): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}

function normalizeOptionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequiredText(value: string | undefined | null, message: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function computeLeaseExpiry(now: string, leaseTtlMs: number): string {
  const base = Date.parse(now);
  const timestamp = Number.isNaN(base) ? Date.now() : base;
  return new Date(timestamp + leaseTtlMs).toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveLeaseNode(
  registry: ManagedAgentSchedulerStore,
  executionLease: StoredAgentExecutionLeaseRecord | null,
): StoredManagedAgentNodeRecord | null {
  if (!executionLease) {
    return null;
  }

  return registry.getManagedAgentNode(executionLease.nodeId);
}

function resolveWaitingResumePreferredNodeId(
  registry: ManagedAgentSchedulerStore,
  workItemId: string,
): string | null {
  const resumedRun = registry.listAgentRunsByWorkItem(workItemId)
    .sort(compareRunsByUpdatedAtDesc)
    .find((run) => run.status === "interrupted" && run.failureCode === "WAITING_RESUME_TRIGGERED");

  if (!resumedRun) {
    return null;
  }

  const executionLease = registry.listAgentExecutionLeasesByRun(resumedRun.runId)
    .sort(compareLeasesByUpdatedAtDesc)[0];

  return executionLease?.nodeId ?? null;
}

function resolveProjectWorkspaceBinding(
  registry: ManagedAgentSchedulerStore,
  workItem: StoredAgentWorkItemRecord,
) {
  const projectId = normalizeOptionalText(workItem.projectId);

  if (!projectId) {
    return null;
  }

  const binding = registry.getProjectWorkspaceBinding(projectId);
  return binding?.organizationId === workItem.organizationId ? binding : null;
}

function resolveProjectBindingStickyNodeIds(binding: {
  continuityMode: string;
  preferredNodeId?: string;
  lastActiveNodeId?: string;
}): string[] {
  if (binding.continuityMode !== "sticky" && binding.continuityMode !== "replicated") {
    return [];
  }

  return dedupeStrings([
    binding.lastActiveNodeId,
    binding.preferredNodeId,
  ]);
}

function canNodeRunWorkItem(
  node: StoredManagedAgentNodeRecord,
  workItem: StoredAgentWorkItemRecord,
): boolean {
  if (node.status !== "online" || node.slotAvailable <= 0) {
    return false;
  }

  const workspaceSnapshot = workItem.workspacePolicySnapshot;
  const runtimeSnapshot = workItem.runtimeProfileSnapshot;
  const requiredWorkspacePaths = dedupeStrings([
    workspaceSnapshot?.workspacePath,
    ...(workspaceSnapshot?.additionalDirectories ?? []),
  ]);

  if (!matchesCapabilities(node.workspaceCapabilities, requiredWorkspacePaths)) {
    return false;
  }

  if (!matchesCapabilities(node.credentialCapabilities, runtimeSnapshot?.authAccountId ? [runtimeSnapshot.authAccountId] : [])) {
    return false;
  }

  if (!matchesCapabilities(node.providerCapabilities, runtimeSnapshot?.thirdPartyProviderId ? [runtimeSnapshot.thirdPartyProviderId] : [])) {
    return false;
  }

  return true;
}

function matchesCapabilities(capabilities: string[], required: string[]): boolean {
  if (required.length === 0) {
    return true;
  }

  if (capabilities.length === 0) {
    return false;
  }

  const set = new Set(capabilities.map((value) => value.trim()).filter(Boolean));
  return required.every((value) => set.has(value));
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => normalizeOptionalText(value) ?? "").filter(Boolean))];
}

function compareRunsByUpdatedAtDesc(left: StoredAgentRunRecord, right: StoredAgentRunRecord): number {
  return compareTimestampsDesc(left.updatedAt, right.updatedAt) || compareTimestampsDesc(left.createdAt, right.createdAt);
}

function compareLeasesByUpdatedAtDesc(left: StoredAgentExecutionLeaseRecord, right: StoredAgentExecutionLeaseRecord): number {
  return compareTimestampsDesc(left.updatedAt, right.updatedAt) || compareTimestampsDesc(left.createdAt, right.createdAt);
}

function compareTimestampsDesc(left: string, right: string): number {
  return toTimestamp(right) - toTimestamp(left);
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
