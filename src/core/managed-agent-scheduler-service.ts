import type { SqliteCodexSessionRegistry, StoredPrincipalRecord } from "../storage/index.js";
import type {
  AgentRunStatus,
  ManagedAgentWorkItemStatus,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentRecord,
  StoredOrganizationRecord,
} from "../types/index.js";

const DEFAULT_SCHEDULER_ID = "scheduler-local";
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_RUN_STATUSES = new Set<AgentRunStatus>(["created", "starting", "running", "waiting_action"]);

export interface ManagedAgentSchedulerServiceOptions {
  registry: SqliteCodexSessionRegistry;
  defaultSchedulerId?: string;
  leaseTtlMs?: number;
}

export interface ManagedAgentSchedulerClaim {
  organization: StoredOrganizationRecord;
  targetAgent: StoredManagedAgentRecord;
  workItem: StoredAgentWorkItemRecord;
  run: StoredAgentRunRecord;
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

export class ManagedAgentSchedulerService {
  private readonly registry: SqliteCodexSessionRegistry;
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

    return {
      organization,
      targetAgent,
      workItem: claim.workItem,
      run: claim.run,
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

    return this.saveRunTransition(run, {
      leaseExpiresAt: computeLeaseExpiry(normalizedNow, this.leaseTtlMs),
      lastHeartbeatAt: normalizedNow,
      updatedAt: normalizedNow,
    });
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

    return this.saveRunTransition(run, {
      status: "cancelled",
      leaseExpiresAt: normalizedNow,
      completedAt: normalizedNow,
      lastHeartbeatAt: normalizedNow,
      failureCode: normalizeRequiredText(failureCode, "Failure code is required."),
      failureMessage: normalizeRequiredText(failureMessage, "Failure message is required."),
      updatedAt: normalizedNow,
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
