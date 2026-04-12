import type { ManagedAgentLeaseRecoveryStore } from "../storage/index.js";
import type {
  StoredAgentExecutionLeaseRecord,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentRecord,
} from "../types/index.js";

const ACTIVE_RUN_STATUSES = new Set(["created", "starting", "running", "waiting_action"]);

export const NODE_LEASE_RECLAIM_DEFAULT_FAILURE_CODE = "NODE_LEASE_RECLAIMED";
export const NODE_LEASE_RECLAIM_DEFAULT_FAILURE_MESSAGE = "Execution lease was reclaimed after the node was taken offline.";

export type ManagedAgentLeaseRecoveryAction = "requeued" | "waiting_preserved" | "lease_revoked";

export interface ManagedAgentReclaimedLeaseContext {
  lease: StoredAgentExecutionLeaseRecord;
  run: StoredAgentRunRecord | null;
  workItem: StoredAgentWorkItemRecord | null;
  targetAgent: StoredManagedAgentRecord | null;
  recoveryAction: ManagedAgentLeaseRecoveryAction;
}

export interface ManagedAgentLeaseRecoverySummary {
  activeLeaseCount: number;
  reclaimedRunCount: number;
  requeuedWorkItemCount: number;
  preservedWaitingCount: number;
  revokedLeaseOnlyCount: number;
}

export function reclaimManagedAgentExecutionLease(
  registry: ManagedAgentLeaseRecoveryStore,
  lease: StoredAgentExecutionLeaseRecord,
  now: string,
  options: {
    failureCode?: string;
    failureMessage?: string;
  } = {},
): ManagedAgentReclaimedLeaseContext {
  const failureCode = normalizeOptionalText(options.failureCode) ?? NODE_LEASE_RECLAIM_DEFAULT_FAILURE_CODE;
  const failureMessage = normalizeOptionalText(options.failureMessage) ?? NODE_LEASE_RECLAIM_DEFAULT_FAILURE_MESSAGE;
  const run = registry.getAgentRun(lease.runId);
  const workItem = run ? registry.getAgentWorkItem(run.workItemId) : registry.getAgentWorkItem(lease.workItemId);
  const targetAgent = registry.getManagedAgent(run?.targetAgentId ?? lease.targetAgentId);
  let nextRun: StoredAgentRunRecord | null = run;
  let nextWorkItem: StoredAgentWorkItemRecord | null = workItem;
  let recoveryAction: ManagedAgentLeaseRecoveryAction = "lease_revoked";

  if (run && ACTIVE_RUN_STATUSES.has(run.status)) {
    const interruptedRun: StoredAgentRunRecord = {
      ...run,
      status: "interrupted",
      leaseExpiresAt: now,
      completedAt: now,
      lastHeartbeatAt: now,
      failureCode: run.failureCode ?? failureCode,
      failureMessage: run.failureMessage ?? failureMessage,
      updatedAt: now,
    };
    registry.saveAgentRun(interruptedRun);
    nextRun = registry.getAgentRun(interruptedRun.runId) ?? interruptedRun;

    if (workItem) {
      const nextStatus = resolveWorkItemStatusAfterInterruptedRun(workItem.status);

      if (nextStatus !== workItem.status) {
        const requeuedWorkItem: StoredAgentWorkItemRecord = {
          ...workItem,
          status: nextStatus,
          updatedAt: now,
        };
        registry.saveAgentWorkItem(requeuedWorkItem);
        nextWorkItem = registry.getAgentWorkItem(requeuedWorkItem.workItemId) ?? requeuedWorkItem;
        recoveryAction = "requeued";
      } else if (workItem.status === "waiting_human" || workItem.status === "waiting_agent") {
        recoveryAction = "waiting_preserved";
      }
    }
  }

  const revokedLease: StoredAgentExecutionLeaseRecord = {
    ...lease,
    status: "revoked",
    leaseExpiresAt: now,
    lastHeartbeatAt: now,
    updatedAt: now,
  };
  registry.saveAgentExecutionLease(revokedLease);

  return {
    lease: revokedLease,
    run: nextRun,
    workItem: nextWorkItem,
    targetAgent,
    recoveryAction,
  };
}

export function summarizeManagedAgentLeaseRecovery(
  reclaimedLeases: ManagedAgentReclaimedLeaseContext[],
): ManagedAgentLeaseRecoverySummary {
  const summary: ManagedAgentLeaseRecoverySummary = {
    activeLeaseCount: reclaimedLeases.length,
    reclaimedRunCount: 0,
    requeuedWorkItemCount: 0,
    preservedWaitingCount: 0,
    revokedLeaseOnlyCount: 0,
  };

  for (const reclaimed of reclaimedLeases) {
    if (reclaimed.run) {
      summary.reclaimedRunCount += 1;
    }

    if (reclaimed.recoveryAction === "requeued") {
      summary.requeuedWorkItemCount += 1;
      continue;
    }

    if (reclaimed.recoveryAction === "waiting_preserved") {
      summary.preservedWaitingCount += 1;
      continue;
    }

    summary.revokedLeaseOnlyCount += 1;
  }

  return summary;
}

export function resolveWorkItemStatusAfterInterruptedRun(
  status: StoredAgentWorkItemRecord["status"],
): StoredAgentWorkItemRecord["status"] {
  if (status === "planning" || status === "running") {
    return "queued";
  }

  return status;
}

function normalizeOptionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
