import type { ManagedAgentSchedulerStore, StoredPrincipalRecord } from "../storage/index.js";
import type {
  StoredAgentExecutionLeaseRecord,
  AgentRunStatus,
  ManagedAgentWorkItemStatus,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentRecord,
  StoredManagedAgentNodeRecord,
  StoredOrganizationRecord,
} from "../types/index.js";

const DEFAULT_SCHEDULER_ID = "scheduler-local";
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_RUN_STATUSES = new Set<AgentRunStatus>(["created", "starting", "running", "waiting_action"]);

export interface ManagedAgentSchedulerServiceOptions {
  registry: ManagedAgentSchedulerStore;
  defaultSchedulerId?: string;
  leaseTtlMs?: number;
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
}

export class ManagedAgentSchedulerService {
  private readonly registry: ManagedAgentSchedulerStore;
  private readonly defaultSchedulerId: string;
  private readonly leaseTtlMs: number;

  constructor(options: ManagedAgentSchedulerServiceOptions) {
    this.registry = options.registry;
    this.defaultSchedulerId = normalizeOptionalText(options.defaultSchedulerId) ?? DEFAULT_SCHEDULER_ID;
    this.leaseTtlMs = Number.isFinite(options.leaseTtlMs) && (options.leaseTtlMs as number) > 0
      ? Math.floor(options.leaseTtlMs as number)
      : DEFAULT_LEASE_TTL_MS;
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
    const recoveredRuns = this.recoverStaleRuns(now);
    const claimed = this.claimNextRunnableWorkItem({
      ...input,
      now,
    });

    return {
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
    const claim = this.registry.claimNextRunnableAgentWorkItem({
      schedulerId,
      leaseToken: createId("run-lease"),
      leaseExpiresAt: computeLeaseExpiry(now, this.leaseTtlMs),
      now,
      ...(normalizeOptionalText(input.organizationId) ? { organizationId: input.organizationId } : {}),
      ...(normalizeOptionalText(input.targetAgentId) ? { targetAgentId: input.targetAgentId } : {}),
    });

    if (!claim) {
      return null;
    }

    const organization = this.registry.getOrganization(claim.workItem.organizationId);
    const targetAgent = this.registry.getManagedAgent(claim.workItem.targetAgentId);

    if (!organization || !targetAgent) {
      throw new Error("Claimed agent work item lost its organization or target agent.");
    }

    const node = this.selectExecutionNode(claim.workItem);
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

  private selectExecutionNode(workItem: StoredAgentWorkItemRecord): StoredManagedAgentNodeRecord | null {
    const nodes = this.registry.listManagedAgentNodesByOrganization(workItem.organizationId);
    const matched = nodes.filter((node) => canNodeRunWorkItem(node, workItem));

    return matched[0] ?? null;
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
    return this.registry.getActiveAgentExecutionLeaseByRun(input.run.runId) ?? executionLease;
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
      slotAvailable: Math.max(0, Math.min(node.slotCapacity, Math.floor(slotAvailable))),
      updatedAt: now,
    });
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

function resolveWorkItemStatusAfterInterruptedRun(status: ManagedAgentWorkItemStatus): ManagedAgentWorkItemStatus {
  if (status === "planning" || status === "running") {
    return "queued";
  }

  return status;
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
