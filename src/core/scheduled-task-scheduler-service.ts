import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  ScheduledTaskRunStatus,
  ScheduledTaskStatus,
  StoredScheduledTaskRecord,
  StoredScheduledTaskRunRecord,
} from "../types/index.js";

const DEFAULT_SCHEDULER_ID = "scheduler-local";
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_RUN_STATUSES = new Set<ScheduledTaskRunStatus>(["created", "running"]);

export interface ScheduledTaskSchedulerServiceOptions {
  registry: SqliteCodexSessionRegistry;
  defaultSchedulerId?: string;
  leaseTtlMs?: number;
}

export interface ScheduledTaskSchedulerClaim {
  task: StoredScheduledTaskRecord;
  run: StoredScheduledTaskRunRecord;
}

export interface ClaimNextDueScheduledTaskInput {
  schedulerId?: string;
  principalId?: string;
  now?: string;
}

export interface ScheduledTaskSchedulerTickResult {
  recoveredRuns: StoredScheduledTaskRunRecord[];
  claimed: ScheduledTaskSchedulerClaim | null;
}

export class ScheduledTaskSchedulerService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly defaultSchedulerId: string;
  private readonly leaseTtlMs: number;

  constructor(options: ScheduledTaskSchedulerServiceOptions) {
    this.registry = options.registry;
    this.defaultSchedulerId = normalizeOptionalText(options.defaultSchedulerId) ?? DEFAULT_SCHEDULER_ID;
    this.leaseTtlMs = Number.isFinite(options.leaseTtlMs) && (options.leaseTtlMs as number) > 0
      ? Math.floor(options.leaseTtlMs as number)
      : DEFAULT_LEASE_TTL_MS;
  }

  tick(input: ClaimNextDueScheduledTaskInput = {}): ScheduledTaskSchedulerTickResult {
    const now = normalizeNow(input.now);
    const recoveredRuns = this.recoverStaleRuns(now);
    const claimed = this.claimNextDueTask({
      ...input,
      now,
    });

    return {
      recoveredRuns,
      claimed,
    };
  }

  recoverStaleRuns(now?: string): StoredScheduledTaskRunRecord[] {
    const normalizedNow = normalizeNow(now);
    const staleRuns = this.registry.listStaleActiveScheduledTaskRuns(normalizedNow);
    const recoveredRuns: StoredScheduledTaskRunRecord[] = [];

    for (const run of staleRuns) {
      if (!ACTIVE_RUN_STATUSES.has(run.status)) {
        continue;
      }

      const task = this.registry.getScheduledTask(run.scheduledTaskId);
      const interruptedRun: StoredScheduledTaskRunRecord = {
        ...run,
        status: "interrupted",
        leaseExpiresAt: normalizedNow,
        completedAt: normalizedNow,
        error: {
          code: "LEASE_EXPIRED",
          message: "Scheduler lease expired before the scheduled task reported completion.",
        },
        updatedAt: normalizedNow,
      };
      this.registry.saveScheduledTaskRun(interruptedRun);
      recoveredRuns.push(this.registry.getScheduledTaskRun(run.runId) ?? interruptedRun);

      if (!task || task.status !== "running") {
        continue;
      }

      this.registry.saveScheduledTask({
        ...task,
        status: "scheduled",
        updatedAt: normalizedNow,
        lastError: "上一次执行因 lease 过期被中断，已重新放回待执行队列。",
      });
    }

    return recoveredRuns;
  }

  claimNextDueTask(input: ClaimNextDueScheduledTaskInput = {}): ScheduledTaskSchedulerClaim | null {
    const schedulerId = normalizeOptionalText(input.schedulerId) ?? this.defaultSchedulerId;
    const now = normalizeNow(input.now);
    const claim = this.registry.claimNextDueScheduledTask({
      schedulerId,
      leaseToken: createId("scheduled-run-lease"),
      leaseExpiresAt: computeLeaseExpiry(now, this.leaseTtlMs),
      now,
      ...(normalizeOptionalText(input.principalId) ? { principalId: input.principalId } : {}),
    });

    if (!claim) {
      return null;
    }

    return claim;
  }

  markRunRunning(
    runId: string,
    leaseToken: string,
    input: {
      requestId?: string;
      taskId?: string;
      now?: string;
    } = {},
  ): StoredScheduledTaskRunRecord {
    const normalizedNow = normalizeNow(input.now);
    const { run } = this.requireRunnableRun(runId, leaseToken);
    const requestId = normalizeOptionalText(input.requestId);
    const taskId = normalizeOptionalText(input.taskId);
    const nextRun: StoredScheduledTaskRunRecord = {
      ...run,
      status: "running",
      ...(requestId ? { requestId } : {}),
      ...(taskId ? { taskId } : {}),
      startedAt: run.startedAt ?? normalizedNow,
      lastHeartbeatAt: normalizedNow,
      leaseExpiresAt: computeLeaseExpiry(normalizedNow, this.leaseTtlMs),
      updatedAt: normalizedNow,
    };
    this.registry.saveScheduledTaskRun(nextRun);
    return this.registry.getScheduledTaskRun(runId) ?? nextRun;
  }

  heartbeatRun(runId: string, leaseToken: string, now?: string): StoredScheduledTaskRunRecord {
    const normalizedNow = normalizeNow(now);
    const { run } = this.requireRunnableRun(runId, leaseToken);
    const nextRun: StoredScheduledTaskRunRecord = {
      ...run,
      lastHeartbeatAt: normalizedNow,
      leaseExpiresAt: computeLeaseExpiry(normalizedNow, this.leaseTtlMs),
      updatedAt: normalizedNow,
    };
    this.registry.saveScheduledTaskRun(nextRun);
    return this.registry.getScheduledTaskRun(runId) ?? nextRun;
  }

  completeRun(runId: string, leaseToken: string, input: {
    requestId?: string;
    taskId?: string;
    summary: string;
    output?: string;
    structuredOutput?: Record<string, unknown>;
    completedAt?: string;
  }): StoredScheduledTaskRunRecord {
    const completedAt = normalizeNow(input.completedAt);
    const { run, task } = this.requireRunnableRun(runId, leaseToken);
    const requestId = normalizeOptionalText(input.requestId);
    const taskId = normalizeOptionalText(input.taskId);
    const resultSummary = normalizeOptionalText(input.summary);
    const resultOutput = normalizeOptionalMultilineText(input.output);
    const nextRun: StoredScheduledTaskRunRecord = {
      ...run,
      status: "completed",
      ...(requestId ? { requestId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(resultSummary ? { resultSummary } : {}),
      ...(resultOutput ? { resultOutput } : {}),
      ...(input.structuredOutput ? { structuredOutput: input.structuredOutput } : {}),
      completedAt,
      lastHeartbeatAt: completedAt,
      leaseExpiresAt: completedAt,
      updatedAt: completedAt,
    };
    this.registry.saveScheduledTaskRun(nextRun);
    const nextTaskSchedule = buildNextTaskSchedule(task, null);
    this.registry.saveScheduledTask({
      ...task,
      status: nextTaskSchedule.status,
      scheduledAt: nextTaskSchedule.scheduledAt,
      completedAt,
      updatedAt: completedAt,
      lastRunId: nextRun.runId,
      ...(nextTaskSchedule.lastError ? { lastError: nextTaskSchedule.lastError } : {}),
    });
    return this.registry.getScheduledTaskRun(runId) ?? nextRun;
  }

  failRun(runId: string, leaseToken: string, input: {
    requestId?: string;
    taskId?: string;
    failureMessage: string;
    output?: string;
    structuredOutput?: Record<string, unknown>;
    completedAt?: string;
  }): StoredScheduledTaskRunRecord {
    const completedAt = normalizeNow(input.completedAt);
    const { run, task } = this.requireRunnableRun(runId, leaseToken);
    const requestId = normalizeOptionalText(input.requestId);
    const taskId = normalizeOptionalText(input.taskId);
    const resultSummary = normalizeOptionalText(input.failureMessage);
    const resultOutput = normalizeOptionalMultilineText(input.output);
    const nextRun: StoredScheduledTaskRunRecord = {
      ...run,
      status: "failed",
      ...(requestId ? { requestId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(resultSummary ? { resultSummary } : {}),
      ...(resultOutput ? { resultOutput } : {}),
      ...(input.structuredOutput ? { structuredOutput: input.structuredOutput } : {}),
      error: {
        message: input.failureMessage,
      },
      completedAt,
      lastHeartbeatAt: completedAt,
      leaseExpiresAt: completedAt,
      updatedAt: completedAt,
    };
    this.registry.saveScheduledTaskRun(nextRun);
    const nextTaskSchedule = buildNextTaskSchedule(task, input.failureMessage);
    this.registry.saveScheduledTask({
      ...task,
      status: nextTaskSchedule.status,
      scheduledAt: nextTaskSchedule.scheduledAt,
      completedAt,
      updatedAt: completedAt,
      lastRunId: nextRun.runId,
      ...(nextTaskSchedule.lastError ? { lastError: nextTaskSchedule.lastError } : {}),
    });
    return this.registry.getScheduledTaskRun(runId) ?? nextRun;
  }

  cancelRun(runId: string, leaseToken: string, reason: string, completedAt?: string): StoredScheduledTaskRunRecord {
    const normalizedCompletedAt = normalizeNow(completedAt);
    const { run, task } = this.requireRunnableRun(runId, leaseToken);
    const nextRun: StoredScheduledTaskRunRecord = {
      ...run,
      status: "cancelled",
      error: {
        message: reason,
      },
      completedAt: normalizedCompletedAt,
      lastHeartbeatAt: normalizedCompletedAt,
      leaseExpiresAt: normalizedCompletedAt,
      updatedAt: normalizedCompletedAt,
    };
    this.registry.saveScheduledTaskRun(nextRun);
    this.registry.saveScheduledTask({
      ...task,
      status: "cancelled",
      cancelledAt: normalizedCompletedAt,
      updatedAt: normalizedCompletedAt,
      lastRunId: nextRun.runId,
      lastError: reason,
    });
    return this.registry.getScheduledTaskRun(runId) ?? nextRun;
  }

  private requireRunnableRun(
    runId: string,
    leaseToken: string,
  ): {
    run: StoredScheduledTaskRunRecord;
    task: StoredScheduledTaskRecord;
  } {
    const normalizedRunId = normalizeRequiredText(runId, "Run id is required.");
    const normalizedLeaseToken = normalizeRequiredText(leaseToken, "Lease token is required.");
    const run = this.registry.getScheduledTaskRun(normalizedRunId);

    if (!run) {
      throw new Error("Scheduled task run does not exist.");
    }

    if (run.leaseToken !== normalizedLeaseToken) {
      throw new Error("Scheduled task run lease token mismatch.");
    }

    if (!ACTIVE_RUN_STATUSES.has(run.status)) {
      throw new Error("Scheduled task run is no longer active.");
    }

    const task = this.registry.getScheduledTask(run.scheduledTaskId);

    if (!task) {
      throw new Error("Scheduled task does not exist.");
    }

    return {
      run,
      task,
    };
  }
}

function computeLeaseExpiry(now: string, leaseTtlMs: number): string {
  return new Date(new Date(now).getTime() + leaseTtlMs).toISOString();
}

function buildNextTaskSchedule(task: StoredScheduledTaskRecord, failureMessage: string | null): {
  status: ScheduledTaskStatus;
  scheduledAt: string;
  lastError?: string;
} {
  if (!task.recurrence) {
    return {
      status: failureMessage ? "failed" : "completed",
      scheduledAt: task.scheduledAt,
      ...(failureMessage ? { lastError: failureMessage } : {}),
    };
  }

  return {
    status: "scheduled",
    scheduledAt: calculateNextRecurringScheduledAt(task.scheduledAt, task.recurrence),
    ...(failureMessage ? { lastError: failureMessage } : {}),
  };
}

function calculateNextRecurringScheduledAt(
  scheduledAt: string,
  recurrence: NonNullable<StoredScheduledTaskRecord["recurrence"]>,
): string {
  const base = new Date(scheduledAt);

  if (Number.isNaN(base.getTime())) {
    return scheduledAt;
  }

  const interval = recurrence.interval ?? 1;
  const next = new Date(base.getTime());

  switch (recurrence.frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + interval);
      break;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7 * interval);
      break;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + interval);
      break;
  }

  return next.toISOString();
}

function normalizeNow(value: string | undefined): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}

function normalizeRequiredText(value: string | undefined, message: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalMultilineText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return normalized ? normalized : undefined;
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
