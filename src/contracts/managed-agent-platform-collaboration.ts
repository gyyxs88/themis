import type { ManagedAgentHandoffListView, ManagedAgentMailboxListView } from "../core/managed-agent-control-plane-facade.js";
import type {
  PullMailboxEntryResult,
  RespondToMailboxEntryInput,
  RespondToMailboxEntryResult,
} from "../core/managed-agent-coordination-service.js";
import type { ManagedAgentRunDetailView, ManagedAgentRunListInput } from "../core/managed-agent-scheduler-service.js";
import type {
  ManagedAgentPriority,
  StoredAgentMailboxEntryRecord,
  StoredAgentMessageRecord,
  StoredAgentRunRecord,
} from "../types/index.js";
import type { ManagedAgentPlatformOwnerPayload } from "./managed-agent-platform-worker.js";

export interface ManagedAgentPlatformRunDetailInput {
  runId: string;
}

export type ManagedAgentPlatformRunListInput = Omit<ManagedAgentRunListInput, "ownerPrincipalId">;

export interface ManagedAgentPlatformRunListPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformRunListInput {}

export interface ManagedAgentPlatformRunDetailPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformRunDetailInput {}

export interface ManagedAgentPlatformRunListResult {
  runs?: StoredAgentRunRecord[];
}

export interface ManagedAgentPlatformRunDetailResult {
  organization: ManagedAgentRunDetailView["organization"];
  run: ManagedAgentRunDetailView["run"];
  workItem: ManagedAgentRunDetailView["workItem"];
  targetAgent: ManagedAgentRunDetailView["targetAgent"];
  completionResult?: ManagedAgentRunDetailView["completionResult"];
}

export interface ManagedAgentPlatformHandoffListInput {
  agentId: string;
  workItemId?: string;
  limit?: number;
}

export interface ManagedAgentPlatformHandoffListPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformHandoffListInput {}

export type ManagedAgentPlatformHandoffListResult = ManagedAgentHandoffListView;

export interface ManagedAgentPlatformMailboxListInput {
  agentId: string;
}

export interface ManagedAgentPlatformMailboxPullInput {
  agentId: string;
}

export interface ManagedAgentPlatformMailboxAckInput {
  agentId: string;
  mailboxEntryId: string;
}

export interface ManagedAgentPlatformMailboxResponsePayload {
  decision?: "approve" | "deny";
  inputText?: string;
  payload?: unknown;
  artifactRefs?: string[];
  priority?: ManagedAgentPriority;
}

export type ManagedAgentPlatformMailboxRespondInput = Omit<RespondToMailboxEntryInput, "ownerPrincipalId">;

export interface ManagedAgentPlatformMailboxListPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformMailboxListInput {}

export interface ManagedAgentPlatformMailboxPullPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformMailboxPullInput {}

export interface ManagedAgentPlatformMailboxAckPayload
  extends ManagedAgentPlatformOwnerPayload, ManagedAgentPlatformMailboxAckInput {}

export interface ManagedAgentPlatformMailboxRespondPayload extends ManagedAgentPlatformOwnerPayload {
  agentId: string;
  mailboxEntryId: string;
  response: ManagedAgentPlatformMailboxResponsePayload;
}

export type ManagedAgentPlatformMailboxListResult = ManagedAgentMailboxListView;
export type ManagedAgentPlatformMailboxPullResult = PullMailboxEntryResult;

export interface ManagedAgentPlatformMailboxAckResult {
  agent: ManagedAgentMailboxListView["agent"];
  mailboxEntry: StoredAgentMailboxEntryRecord;
  message?: StoredAgentMessageRecord;
}

export type ManagedAgentPlatformMailboxRespondResult = RespondToMailboxEntryResult;
