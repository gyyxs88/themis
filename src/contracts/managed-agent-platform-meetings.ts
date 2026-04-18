import type { ManagedAgentPlatformOwnerPayload } from "./managed-agent-platform-worker.js";

export type ManagedAgentMeetingRoomStatus = "open" | "closing" | "closed";
export type ManagedAgentMeetingDiscussionMode = "moderated" | "collaborative";
export type ManagedAgentMeetingParticipantKind = "themis" | "managed_agent";
export type ManagedAgentMeetingRoomRole = "host" | "participant";
export type ManagedAgentMeetingEntryMode = "blank" | "active_work_context" | "selected_context";
export type ManagedAgentMeetingRoundStatus = "queued" | "running" | "completed" | "failed";
export type ManagedAgentMeetingMessageAudience = "all_participants" | "themis_only" | "selected_participants";
export type ManagedAgentMeetingMessageKind = "message" | "status" | "summary" | "error";
export type ManagedAgentMeetingResolutionStatus = "draft" | "accepted" | "promoted";
export type ManagedAgentMeetingArtifactRefType =
  | "work_item"
  | "handoff"
  | "managed_agent_timeline"
  | "conversation_summary"
  | "document";

export interface ManagedAgentPlatformMeetingRoomRecord {
  roomId: string;
  ownerPrincipalId: string;
  organizationId: string;
  title: string;
  goal: string;
  status: ManagedAgentMeetingRoomStatus;
  discussionMode: ManagedAgentMeetingDiscussionMode;
  createdByOperatorPrincipalId: string;
  closedAt?: string | null;
  closingSummary?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ManagedAgentPlatformMeetingParticipantRecord {
  participantId: string;
  roomId: string;
  participantKind: ManagedAgentMeetingParticipantKind;
  principalId: string;
  agentId?: string | null;
  displayName: string;
  roomRole: ManagedAgentMeetingRoomRole;
  entryMode: ManagedAgentMeetingEntryMode;
  entryContextSnapshotJson?: unknown;
  roomSessionId?: string | null;
  joinedAt: string;
  leftAt?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ManagedAgentPlatformMeetingRoundRecord {
  roundId: string;
  roomId: string;
  triggerMessageId: string;
  status: ManagedAgentMeetingRoundStatus;
  targetParticipantIds: string[];
  respondedParticipantIds: string[];
  startedAt?: string | null;
  completedAt?: string | null;
  failureMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ManagedAgentPlatformMeetingMessageRecord {
  messageId: string;
  roomId: string;
  roundId?: string | null;
  speakerType: "themis" | "managed_agent" | "system";
  speakerPrincipalId?: string | null;
  speakerAgentId?: string | null;
  operatorPrincipalId?: string | null;
  audience: ManagedAgentMeetingMessageAudience;
  visibleParticipantIds?: string[];
  content: string;
  messageKind: ManagedAgentMeetingMessageKind;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ManagedAgentPlatformMeetingResolutionRecord {
  resolutionId: string;
  roomId: string;
  sourceMessageIds: string[];
  title: string;
  summary: string;
  status: ManagedAgentMeetingResolutionStatus;
  promotedWorkItemId?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ManagedAgentPlatformMeetingArtifactRefRecord {
  artifactRefId: string;
  roomId: string;
  participantId?: string | null;
  refType: ManagedAgentMeetingArtifactRefType;
  refId: string;
  snapshotJson?: unknown;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export const MANAGED_AGENT_MEETING_ROOM_STATUSES = ["open", "closing", "closed"] as const;
export const MANAGED_AGENT_MEETING_ROUND_STATUSES = ["queued", "running", "completed", "failed"] as const;

export interface ManagedAgentPlatformMeetingRoomCreateInput {
  title: string;
  goal: string;
  discussionMode?: ManagedAgentMeetingDiscussionMode;
  operatorPrincipalId: string;
  organizationId: string;
  participants?: Array<{
    agentId: string;
    entryMode?: ManagedAgentMeetingEntryMode;
    selectedArtifactRefs?: Array<{
      refType: ManagedAgentPlatformMeetingArtifactRefRecord["refType"];
      refId: string;
      snapshotJson?: unknown;
    }>;
  }>;
}

export interface ManagedAgentPlatformMeetingRoomMessageCreateInput {
  roomId: string;
  content: string;
  operatorPrincipalId: string;
  audience?: ManagedAgentPlatformMeetingMessageRecord["audience"];
  targetParticipantIds?: string[];
}

export interface ManagedAgentPlatformMeetingRoomAppendReplyInput {
  roomId: string;
  roundId: string;
  participantId: string;
  content: string;
}

export interface ManagedAgentPlatformMeetingRoomAppendFailureInput {
  roomId: string;
  roundId: string;
  participantId: string;
  failureMessage: string;
}

export interface ManagedAgentPlatformMeetingRoomCreateResolutionInput {
  roomId: string;
  sourceMessageIds: string[];
  title: string;
  summary: string;
}

export interface ManagedAgentPlatformMeetingRoomPromoteResolutionInput {
  roomId: string;
  resolutionId: string;
  targetAgentId: string;
  dispatchReason?: string;
  goal?: string;
}

export interface ManagedAgentPlatformMeetingRoomCloseInput {
  roomId: string;
  closingSummary: string;
}

export interface ManagedAgentPlatformMeetingRoomListPayload extends ManagedAgentPlatformOwnerPayload {
  status?: ManagedAgentPlatformMeetingRoomRecord["status"];
}

export interface ManagedAgentPlatformMeetingRoomCreatePayload extends ManagedAgentPlatformOwnerPayload {
  room: ManagedAgentPlatformMeetingRoomCreateInput;
}

export interface ManagedAgentPlatformMeetingRoomDetailPayload extends ManagedAgentPlatformOwnerPayload {
  roomId: string;
}

export interface ManagedAgentPlatformMeetingRoomParticipantsAddPayload extends ManagedAgentPlatformOwnerPayload {
  roomId: string;
  participants: ManagedAgentPlatformMeetingRoomCreateInput["participants"];
}

export interface ManagedAgentPlatformMeetingRoomMessageCreatePayload extends ManagedAgentPlatformOwnerPayload {
  message: ManagedAgentPlatformMeetingRoomMessageCreateInput;
}

export interface ManagedAgentPlatformMeetingRoomAppendReplyPayload extends ManagedAgentPlatformOwnerPayload {
  reply: ManagedAgentPlatformMeetingRoomAppendReplyInput;
}

export interface ManagedAgentPlatformMeetingRoomAppendFailurePayload extends ManagedAgentPlatformOwnerPayload {
  failure: ManagedAgentPlatformMeetingRoomAppendFailureInput;
}

export interface ManagedAgentPlatformMeetingRoomCreateResolutionPayload extends ManagedAgentPlatformOwnerPayload {
  resolution: ManagedAgentPlatformMeetingRoomCreateResolutionInput;
}

export interface ManagedAgentPlatformMeetingRoomPromoteResolutionPayload extends ManagedAgentPlatformOwnerPayload {
  resolution: ManagedAgentPlatformMeetingRoomPromoteResolutionInput;
}

export interface ManagedAgentPlatformMeetingRoomClosePayload extends ManagedAgentPlatformOwnerPayload {
  room: ManagedAgentPlatformMeetingRoomCloseInput;
}

export interface ManagedAgentPlatformMeetingRoomDetailResult {
  room: ManagedAgentPlatformMeetingRoomRecord;
  participants: ManagedAgentPlatformMeetingParticipantRecord[];
  rounds: ManagedAgentPlatformMeetingRoundRecord[];
  messages: ManagedAgentPlatformMeetingMessageRecord[];
  resolutions: ManagedAgentPlatformMeetingResolutionRecord[];
  artifactRefs: ManagedAgentPlatformMeetingArtifactRefRecord[];
}

export interface ManagedAgentPlatformMeetingRoomListResult {
  rooms: ManagedAgentPlatformMeetingRoomRecord[];
}

export type ManagedAgentPlatformMeetingRoomCreateResult = ManagedAgentPlatformMeetingRoomDetailResult;
export type ManagedAgentPlatformMeetingRoomParticipantsAddResult = ManagedAgentPlatformMeetingRoomDetailResult;
export type ManagedAgentPlatformMeetingRoomCreateResolutionResult = ManagedAgentPlatformMeetingRoomDetailResult;
export type ManagedAgentPlatformMeetingRoomPromoteResolutionResult = ManagedAgentPlatformMeetingRoomDetailResult;
export type ManagedAgentPlatformMeetingRoomCloseResult = ManagedAgentPlatformMeetingRoomDetailResult;

export interface ManagedAgentPlatformMeetingRoomMessageCreateResult {
  room: ManagedAgentPlatformMeetingRoomRecord;
  message: ManagedAgentPlatformMeetingMessageRecord;
  round: ManagedAgentPlatformMeetingRoundRecord;
  targetParticipants: ManagedAgentPlatformMeetingParticipantRecord[];
}

export interface ManagedAgentPlatformMeetingRoomAppendReplyResult {
  room: ManagedAgentPlatformMeetingRoomRecord;
  round: ManagedAgentPlatformMeetingRoundRecord;
  message: ManagedAgentPlatformMeetingMessageRecord;
}

export interface ManagedAgentPlatformMeetingRoomStreamEventBase {
  roomId: string;
}

export type ManagedAgentPlatformMeetingRoomStreamEvent =
  | ({ event: "room.message.created" } & ManagedAgentPlatformMeetingRoomStreamEventBase & {
      messageId: string;
      roundId: string;
    })
  | ({ event: "room.round.queued" } & ManagedAgentPlatformMeetingRoomStreamEventBase & {
      roundId: string;
    })
  | ({ event: "room.round.started" } & ManagedAgentPlatformMeetingRoomStreamEventBase & {
      roundId: string;
      participantAgentId: string;
    })
  | ({ event: "room.agent.reply" } & ManagedAgentPlatformMeetingRoomStreamEventBase & {
      roundId: string;
      participantAgentId: string;
      messageId: string;
      content: string;
      audience: ManagedAgentPlatformMeetingMessageRecord["audience"];
    })
  | ({ event: "room.agent.failed" } & ManagedAgentPlatformMeetingRoomStreamEventBase & {
      roundId: string;
      participantAgentId: string;
      failureMessage: string;
    })
  | ({ event: "room.round.completed" } & ManagedAgentPlatformMeetingRoomStreamEventBase & {
      roundId: string;
      participantAgentId: string;
    });

export function buildManagedAgentMeetingRoomStreamEvent<
  T extends ManagedAgentPlatformMeetingRoomStreamEvent["event"],
>(
  event: T,
  payload: Omit<Extract<ManagedAgentPlatformMeetingRoomStreamEvent, { event: T }>, "event">,
): Extract<ManagedAgentPlatformMeetingRoomStreamEvent, { event: T }> {
  return {
    event,
    ...payload,
  } as Extract<ManagedAgentPlatformMeetingRoomStreamEvent, { event: T }>;
}
