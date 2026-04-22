import type {
  ApprovalPolicy,
  MemoryMode,
  ReasoningLevel,
  SandboxMode,
  TaskAccessMode,
  TaskOptions,
  WebSearchMode,
} from "./task.js";

export const SCHEDULED_TASK_STATUSES = [
  "scheduled",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ScheduledTaskStatus = (typeof SCHEDULED_TASK_STATUSES)[number];

export const SCHEDULED_TASK_RUN_STATUSES = [
  "created",
  "running",
  "interrupted",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ScheduledTaskRunStatus = (typeof SCHEDULED_TASK_RUN_STATUSES)[number];

export const SCHEDULED_TASK_AUTOMATION_OUTPUT_MODES = ["text", "json"] as const;

export type ScheduledTaskAutomationOutputMode = (typeof SCHEDULED_TASK_AUTOMATION_OUTPUT_MODES)[number];

export const SCHEDULED_TASK_AUTOMATION_FAILURE_MODES = ["report", "reject"] as const;

export type ScheduledTaskAutomationFailureMode = (typeof SCHEDULED_TASK_AUTOMATION_FAILURE_MODES)[number];

export interface ScheduledTaskAutomationOptions {
  outputMode?: ScheduledTaskAutomationOutputMode;
  jsonSchema?: Record<string, unknown>;
  onInvalidJson?: ScheduledTaskAutomationFailureMode;
  onSchemaMismatch?: ScheduledTaskAutomationFailureMode;
}

export interface ScheduledTaskWatchOptions {
  workItemId: string;
}

export interface ScheduledTaskRuntimeOptions extends Omit<
  TaskOptions,
  "reasoning" | "memoryMode" | "sandboxMode" | "webSearchMode" | "approvalPolicy" | "accessMode"
> {
  reasoning?: ReasoningLevel;
  memoryMode?: MemoryMode;
  sandboxMode?: SandboxMode;
  webSearchMode?: WebSearchMode;
  approvalPolicy?: ApprovalPolicy;
  accessMode?: TaskAccessMode;
}

export interface StoredScheduledTaskRecord {
  scheduledTaskId: string;
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
  watch?: ScheduledTaskWatchOptions;
  timezone: string;
  scheduledAt: string;
  status: ScheduledTaskStatus;
  lastRunId?: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  completedAt?: string;
  lastError?: string;
}

export interface StoredScheduledTaskRunRecord {
  runId: string;
  scheduledTaskId: string;
  principalId: string;
  schedulerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  status: ScheduledTaskRunStatus;
  requestId?: string;
  taskId?: string;
  triggeredAt: string;
  startedAt?: string;
  lastHeartbeatAt?: string;
  completedAt?: string;
  resultSummary?: string;
  resultOutput?: string;
  structuredOutput?: Record<string, unknown>;
  error?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
