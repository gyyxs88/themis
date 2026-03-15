export const COMMUNICATION_PROTOCOL_VERSION = "0.1.0";

export {
  APPROVAL_POLICIES,
  KNOWN_CHANNEL_IDS,
  MEMORY_MODES,
  MEMORY_UPDATE_ACTIONS,
  MEMORY_UPDATE_KINDS,
  REASONING_LEVELS,
  SANDBOX_MODES,
  TASK_ATTACHMENT_TYPES,
  TASK_ERROR_CODES,
  TASK_EVENT_TYPES,
  TASK_RESULT_STATUSES,
  TASK_STATUSES,
  USER_ROLES,
} from "../types/index.js";

export type {
  ApprovalPolicy,
  ChannelContext,
  ChannelId,
  ChannelUser,
  KnownChannelId,
  MemoryMode,
  MemoryUpdate,
  MemoryUpdateAction,
  MemoryUpdateKind,
  ReasoningLevel,
  SandboxMode,
  TaskAttachment,
  TaskAttachmentType,
  TaskError,
  TaskErrorCode,
  TaskEvent,
  TaskEventType,
  TaskOptions,
  TaskRequest,
  TaskResult,
  TaskResultStatus,
  TaskStatus,
  UserRole,
} from "../types/index.js";

export type { ChannelAdapter, CommunicationRouter } from "./adapter.js";
