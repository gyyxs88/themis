import type { SqliteCodexSessionRegistry, StoredPrincipalRecord } from "../storage/index.js";
import type {
  ScheduledTaskAutomationOptions,
  ScheduledTaskRecurrenceOptions,
  ScheduledTaskRuntimeOptions,
  ScheduledTaskStatus,
  ScheduledTaskWatchOptions,
  StoredScheduledTaskRecord,
} from "../types/index.js";
import { SCHEDULED_TASK_RECURRENCE_FREQUENCIES } from "../types/index.js";

export interface ScheduledTasksServiceOptions {
  registry: SqliteCodexSessionRegistry;
}

export interface CreateScheduledTaskInput {
  principalId: string;
  sourceChannel: string;
  channelUserId: string;
  displayName?: string;
  sessionId?: string;
  channelSessionKey?: string;
  goal: string;
  inputText?: string;
  options?: ScheduledTaskRuntimeOptions;
  automation?: ScheduledTaskAutomationOptions;
  recurrence?: ScheduledTaskRecurrenceOptions;
  watch?: ScheduledTaskWatchOptions;
  timezone: string;
  scheduledAt: string;
  scheduledTaskId?: string;
  now?: string;
}

export interface CancelScheduledTaskInput {
  ownerPrincipalId: string;
  scheduledTaskId: string;
  now?: string;
}

export class ScheduledTasksService {
  private readonly registry: SqliteCodexSessionRegistry;

  constructor(options: ScheduledTasksServiceOptions) {
    this.registry = options.registry;
  }

  createTask(input: CreateScheduledTaskInput): StoredScheduledTaskRecord {
    const owner = this.requirePrincipal(input.principalId);
    const now = normalizeNow(input.now);
    const scheduledAt = normalizeScheduledAt(input.scheduledAt, now);
    const timezone = normalizeRequiredText(input.timezone, "时区不能为空。");
    const goal = normalizeRequiredText(input.goal, "任务目标不能为空。");
    const sourceChannel = normalizeRequiredText(input.sourceChannel, "来源渠道不能为空。");
    const channelUserId = normalizeRequiredText(input.channelUserId, "来源用户不能为空。");
    const scheduledTaskId = normalizeOptionalText(input.scheduledTaskId) ?? createId("scheduled-task");
    const options = normalizeRecord(input.options);
    const automation = normalizeRecord(input.automation);
    const recurrence = normalizeScheduledTaskRecurrence(input.recurrence);
    const watch = normalizeScheduledTaskWatch(input.watch);
    const displayName = normalizeOptionalText(input.displayName);
    const sessionId = normalizeOptionalText(input.sessionId);
    const channelSessionKey = normalizeOptionalText(input.channelSessionKey);
    const inputText = normalizeOptionalMultilineText(input.inputText);
    const record: StoredScheduledTaskRecord = {
      scheduledTaskId,
      principalId: owner.principalId,
      sourceChannel,
      channelUserId,
      ...(displayName ? { displayName } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(channelSessionKey ? { channelSessionKey } : {}),
      goal,
      ...(inputText ? { inputText } : {}),
      ...(options ? { options: options as ScheduledTaskRuntimeOptions } : {}),
      ...(automation ? { automation: automation as ScheduledTaskAutomationOptions } : {}),
      ...(recurrence ? { recurrence } : {}),
      ...(watch ? { watch } : {}),
      timezone,
      scheduledAt,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    };

    this.registry.saveScheduledTask(record);
    return this.registry.getScheduledTask(record.scheduledTaskId) ?? record;
  }

  listTasks(ownerPrincipalId: string): StoredScheduledTaskRecord[] {
    const owner = this.requirePrincipal(ownerPrincipalId);
    return this.registry.listScheduledTasksByPrincipal(owner.principalId);
  }

  listWatchedTasks(status: ScheduledTaskStatus = "scheduled"): StoredScheduledTaskRecord[] {
    return this.registry.listWatchedScheduledTasks(status);
  }

  getTask(ownerPrincipalId: string, scheduledTaskId: string): StoredScheduledTaskRecord | null {
    const owner = this.requirePrincipal(ownerPrincipalId);
    const task = this.registry.getScheduledTask(normalizeRequiredText(scheduledTaskId, "定时任务 id 不能为空。"));

    if (!task || task.principalId !== owner.principalId) {
      return null;
    }

    return task;
  }

  cancelTask(input: CancelScheduledTaskInput): StoredScheduledTaskRecord {
    const owner = this.requirePrincipal(input.ownerPrincipalId);
    const scheduledTaskId = normalizeRequiredText(input.scheduledTaskId, "定时任务 id 不能为空。");
    const existing = this.registry.getScheduledTask(scheduledTaskId);

    if (!existing || existing.principalId !== owner.principalId) {
      throw new Error("定时任务不存在。");
    }

    if (existing.status === "cancelled") {
      return existing;
    }

    if (existing.status !== "scheduled") {
      throw new Error("当前只支持取消未开始执行的定时任务。");
    }

    const now = normalizeNow(input.now);
    const next: StoredScheduledTaskRecord = {
      ...existing,
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
    };

    this.registry.saveScheduledTask(next);
    return this.registry.getScheduledTask(scheduledTaskId) ?? next;
  }

  private requirePrincipal(principalId: string): StoredPrincipalRecord {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "Principal id is required.");
    const principal = this.registry.getPrincipal(normalizedPrincipalId);

    if (!principal) {
      throw new Error("Principal does not exist.");
    }

    return principal;
  }
}

function normalizeNow(value: string | undefined): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}

function normalizeScheduledAt(value: string, now: string): string {
  const scheduledAt = normalizeRequiredText(value, "执行时间不能为空。");
  const scheduledAtDate = new Date(scheduledAt);
  const nowDate = new Date(now);

  if (Number.isNaN(scheduledAtDate.getTime())) {
    throw new Error("执行时间格式不合法。");
  }

  if (scheduledAtDate.getTime() <= nowDate.getTime()) {
    throw new Error("执行时间必须晚于当前时间。");
  }

  return scheduledAtDate.toISOString();
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

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function normalizeScheduledTaskRecurrence(
  value: ScheduledTaskRecurrenceOptions | undefined,
): ScheduledTaskRecurrenceOptions | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const frequency = normalizeOptionalText(value.frequency);

  if (!frequency || !SCHEDULED_TASK_RECURRENCE_FREQUENCIES.includes(frequency as ScheduledTaskRecurrenceOptions["frequency"])) {
    throw new Error("重复规则 frequency 不合法。");
  }

  const interval = value.interval === undefined ? undefined : Number(value.interval);

  if (interval !== undefined && (!Number.isInteger(interval) || interval < 1 || interval > 52)) {
    throw new Error("重复规则 interval 必须是 1 到 52 的整数。");
  }

  return {
    frequency: frequency as ScheduledTaskRecurrenceOptions["frequency"],
    ...(interval !== undefined && interval !== 1 ? { interval } : {}),
  };
}

function normalizeScheduledTaskWatch(value: ScheduledTaskWatchOptions | undefined): ScheduledTaskWatchOptions | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const workItemId = normalizeOptionalText(value.workItemId);
  return workItemId ? { workItemId } : undefined;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
