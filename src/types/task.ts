import type { ChannelContext, ChannelId, ChannelUser } from "./channel.js";
import type { MemoryUpdate } from "./memory.js";

export const TASK_ATTACHMENT_TYPES = ["text", "link", "file", "image"] as const;

export type TaskAttachmentType = (typeof TASK_ATTACHMENT_TYPES)[number];

export const REASONING_LEVELS = ["low", "medium", "high", "xhigh"] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const MEMORY_MODES = ["auto", "off", "confirm"] as const;

export type MemoryMode = (typeof MEMORY_MODES)[number];

export const SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type SandboxMode = (typeof SANDBOX_MODES)[number];

export const APPROVAL_POLICIES = [
  "never",
  "untrusted",
  "on-request",
] as const;

export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const TASK_EVENT_TYPES = [
  "task.received",
  "task.accepted",
  "task.context_built",
  "task.started",
  "task.progress",
  "task.memory_updated",
  "task.action_required",
  "task.completed",
  "task.failed",
  "task.cancelled",
] as const;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_RESULT_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskResultStatus = (typeof TASK_RESULT_STATUSES)[number];

export const TASK_ERROR_CODES = [
  "INVALID_REQUEST",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "SESSION_BUSY",
  "CHANNEL_PAYLOAD_INVALID",
  "CORE_RUNTIME_ERROR",
  "MEMORY_UPDATE_FAILED",
] as const;

export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

export interface TaskAttachment {
  id: string;
  type: TaskAttachmentType;
  name?: string;
  value: string;
}

export interface TaskOptions {
  profile?: string;
  model?: string;
  reasoning?: ReasoningLevel;
  memoryMode?: MemoryMode;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
}

export interface TaskRequest {
  requestId: string;
  taskId?: string;
  sourceChannel: ChannelId;
  user: ChannelUser;
  goal: string;
  inputText?: string;
  historyContext?: string;
  attachments?: TaskAttachment[];
  options?: TaskOptions;
  channelContext: ChannelContext;
  createdAt: string;
}

export interface TaskEvent {
  eventId: string;
  taskId: string;
  requestId: string;
  type: TaskEventType;
  status: TaskStatus;
  message?: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

export interface TaskResult {
  taskId: string;
  requestId: string;
  status: TaskResultStatus;
  summary: string;
  output?: string;
  structuredOutput?: Record<string, unknown>;
  touchedFiles?: string[];
  memoryUpdates?: MemoryUpdate[];
  nextSteps?: string[];
  completedAt: string;
}

export interface TaskError {
  code: TaskErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}
