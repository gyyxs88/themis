import { randomUUID } from "node:crypto";
import { buildManagedAgentMeetingRoomStreamEvent } from "themis-contracts/managed-agent-platform-meetings";
import type {
  ManagedAgentPlatformMeetingMessageRecord,
  ManagedAgentPlatformMeetingParticipantRecord,
  ManagedAgentPlatformMeetingRoomDetailResult,
  ManagedAgentPlatformMeetingRoomMessageCreateResult,
  ManagedAgentPlatformMeetingRoomStreamEvent,
} from "themis-contracts/managed-agent-platform-meetings";
import type { TaskRequest } from "../types/task.js";
import type { AppServerTaskRuntime } from "./app-server-task-runtime.js";
import type { PlatformMeetingRoomGateway } from "./platform-meeting-room-gateway.js";

const ROUND_START_POLL_INTERVAL_MS = 20;
const ROUND_START_MAX_ATTEMPTS = 250;

export interface MeetingRoomRoundExecutorInput {
  gateway: Pick<PlatformMeetingRoomGateway, "getRoomDetail" | "appendAgentReply" | "appendAgentFailure">;
  runtime: Pick<AppServerTaskRuntime, "runTaskAsPrincipal">;
  started: ManagedAgentPlatformMeetingRoomMessageCreateResult;
  onEvent?: (event: ManagedAgentPlatformMeetingRoomStreamEvent) => void;
}

export class MeetingRoomRoundExecutor {
  private readonly roomTails = new Map<string, Promise<void>>();

  async enqueue(input: MeetingRoomRoundExecutorInput): Promise<void> {
    const roomId = input.started.room.roomId;
    const previous = this.roomTails.get(roomId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        await executeMeetingRoomRound(input);
      });

    this.roomTails.set(roomId, current);

    try {
      await current;
    } finally {
      if (this.roomTails.get(roomId) === current) {
        this.roomTails.delete(roomId);
      }
    }
  }
}

async function executeMeetingRoomRound(input: MeetingRoomRoundExecutorInput): Promise<void> {
  const emit = input.onEvent ?? (() => undefined);
  const { room, round, targetParticipants } = input.started;

  if (round.status === "queued") {
    emit(buildManagedAgentMeetingRoomStreamEvent("room.round.queued", {
      roomId: room.roomId,
      roundId: round.roundId,
    }));
  }

  const detail = await waitForRoundToBecomeRunnable(input.gateway, room.roomId, round.roundId);
  const currentRound = getRoundOrThrow(detail, room.roomId, round.roundId);

  if (shouldStopExecutingRound(detail.room.status, currentRound.status)) {
    return;
  }

  const participantNames = new Map(
    detail.participants
      .filter((participant) => participant.agentId)
      .map((participant) => [participant.agentId ?? "", participant.displayName]),
  );

  for (const participant of targetParticipants) {
    const latestDetail = await input.gateway.getRoomDetail(room.roomId);
    const latestRound = getRoundOrThrow(latestDetail, room.roomId, round.roundId);

    if (shouldStopExecutingRound(latestDetail.room.status, latestRound.status)) {
      return;
    }

    if (
      !latestRound.targetParticipantIds.includes(participant.participantId)
      || latestRound.respondedParticipantIds.includes(participant.participantId)
    ) {
      continue;
    }

    emit(buildManagedAgentMeetingRoomStreamEvent("room.round.started", {
      roomId: room.roomId,
      roundId: round.roundId,
      participantAgentId: participant.agentId ?? "",
    }));

    try {
      const visibleMessages = latestDetail.messages
        .filter((message) => isMessageVisibleToParticipant(message, participant))
        .map((message) => ({
          speaker: resolveVisibleSpeaker(message, participantNames),
          content: message.content,
        }));

      const result = await input.runtime.runTaskAsPrincipal(
        buildMeetingRoomTaskRequest({
          roomTitle: detail.room.title,
          roomGoal: detail.room.goal,
          discussionMode: detail.room.discussionMode,
          managerMessage: input.started.message.content,
          visibleMessages,
          entryMode: participant.entryMode,
          entryContextSnapshotJson: participant.entryContextSnapshotJson,
        }),
        {
          principalId: participant.principalId,
          principalKind: "managed_agent",
          principalDisplayName: participant.displayName,
          principalOrganizationId: detail.room.organizationId,
          ...(participant.roomSessionId ? { conversationId: participant.roomSessionId } : {}),
        },
      );

      const replyText = typeof result.output === "string" && result.output.trim()
        ? result.output.trim()
        : typeof result.summary === "string" && result.summary.trim()
          ? result.summary.trim()
          : "收到，当前没有可直接输出的文字结论。";

      const appended = await input.gateway.appendAgentReply({
        roomId: room.roomId,
        roundId: round.roundId,
        participantId: participant.participantId,
        content: replyText,
      });

      emit(buildManagedAgentMeetingRoomStreamEvent("room.agent.reply", {
        roomId: room.roomId,
        roundId: round.roundId,
        participantAgentId: participant.agentId ?? "",
        messageId: appended.message.messageId,
        content: appended.message.content,
        audience: appended.message.audience,
      }));

      emit(buildManagedAgentMeetingRoomStreamEvent("room.round.completed", {
        roomId: room.roomId,
        roundId: appended.round.roundId,
        participantAgentId: participant.agentId ?? "",
      }));
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);

      try {
        await input.gateway.appendAgentFailure({
          roomId: room.roomId,
          roundId: round.roundId,
          participantId: participant.participantId,
          failureMessage,
        });
      } catch (appendFailureError) {
        if (!isReadOnlyMeetingRoomError(appendFailureError)) {
          throw appendFailureError;
        }
      }

      emit(buildManagedAgentMeetingRoomStreamEvent("room.agent.failed", {
        roomId: room.roomId,
        roundId: round.roundId,
        participantAgentId: participant.agentId ?? "",
        failureMessage,
      }));
    }
  }
}

async function waitForRoundToBecomeRunnable(
  gateway: Pick<PlatformMeetingRoomGateway, "getRoomDetail">,
  roomId: string,
  roundId: string,
): Promise<ManagedAgentPlatformMeetingRoomDetailResult> {
  for (let attempt = 0; attempt < ROUND_START_MAX_ATTEMPTS; attempt += 1) {
    const detail = await gateway.getRoomDetail(roomId);
    const round = detail.rounds.find((item) => item.roundId === roundId);

    if (!round) {
      throw new Error(`Meeting room round ${roundId} not found in room ${roomId}.`);
    }

    if (round.status !== "queued") {
      return detail;
    }

    await delay(ROUND_START_POLL_INTERVAL_MS);
  }

  throw new Error(`Meeting room round ${roundId} did not become runnable in time.`);
}

function getRoundOrThrow(
  detail: ManagedAgentPlatformMeetingRoomDetailResult,
  roomId: string,
  roundId: string,
) {
  const round = detail.rounds.find((item) => item.roundId === roundId);

  if (!round) {
    throw new Error(`Meeting room round ${roundId} not found in room ${roomId}.`);
  }

  return round;
}

function shouldStopExecutingRound(
  roomStatus: ManagedAgentPlatformMeetingRoomDetailResult["room"]["status"],
  roundStatus: ManagedAgentPlatformMeetingRoomDetailResult["rounds"][number]["status"],
): boolean {
  return roomStatus === "closed"
    || roomStatus === "terminated"
    || roundStatus === "failed"
    || roundStatus === "completed";
}

function isReadOnlyMeetingRoomError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("已被平台终止") || message.includes("已关闭");
}

function buildMeetingRoomTaskRequest(input: {
  roomTitle: string;
  roomGoal: string;
  discussionMode: ManagedAgentPlatformMeetingRoomDetailResult["room"]["discussionMode"];
  managerMessage: string;
  visibleMessages: Array<{ speaker: string; content: string }>;
  entryMode: ManagedAgentPlatformMeetingParticipantRecord["entryMode"];
  entryContextSnapshotJson: unknown;
}): TaskRequest {
  const transcript = input.visibleMessages
    .map((message) => `${message.speaker}: ${message.content}`)
    .join("\n");
  const timestamp = new Date().toISOString();

  return {
    requestId: randomUUID(),
    sourceChannel: "web",
    user: {
      userId: "themis-internal-meeting-room",
      displayName: "Themis Internal Meeting Room",
    },
    goal: `参与内部会议室讨论：${input.roomTitle}`,
    inputText: [
      `你正在参加 Themis 发起的内部会议室：${input.roomTitle}`,
      `房间目标：${input.roomGoal}`,
      renderDiscussionModeSection(input.discussionMode),
      transcript ? `房间可见历史：\n${transcript}` : "房间可见历史：暂无",
      renderEntryContextSection(input.entryMode, input.entryContextSnapshotJson),
      `Themis 刚才的问题：${input.managerMessage}`,
      renderDiscussionModeInstruction(input.discussionMode),
    ].join("\n\n"),
    channelContext: {
      sessionId: "",
      channelSessionKey: "",
    },
    createdAt: timestamp,
    options: {},
  };
}

function renderDiscussionModeSection(
  discussionMode: ManagedAgentPlatformMeetingRoomDetailResult["room"]["discussionMode"],
): string {
  return `讨论模式：${discussionMode === "collaborative" ? "协作模式" : "主持模式"}`;
}

function renderDiscussionModeInstruction(
  discussionMode: ManagedAgentPlatformMeetingRoomDetailResult["room"]["discussionMode"],
): string {
  if (discussionMode === "collaborative") {
    return [
      "Themis 仍是会议发起人和最终决策者，但这轮讨论采用协作模式。",
      "你可以直接回应其他数字员工已经给出的观点，补充证据、质疑假设、提出新的动作建议，但不要把自己当成在和人类聊天。",
    ].join("\n");
  }

  return [
    "这轮讨论采用主持模式。",
    "请按 Themis 提问逐条作答，直接给出你的判断、建议或需要 Themis 澄清的问题。不要假设自己在和人类直接对话；你的上级是 Themis。",
  ].join("\n");
}

function renderEntryContextSection(
  entryMode: ManagedAgentPlatformMeetingParticipantRecord["entryMode"],
  snapshot: unknown,
): string {
  const lines = [`入场方式：${resolveEntryModeLabel(entryMode)}`];

  if (entryMode === "active_work_context") {
    const rendered = renderActiveWorkContextSnapshot(snapshot);
    return rendered ? [lines[0], rendered].join("\n") : lines.join("\n");
  }

  if (entryMode === "selected_context") {
    const rendered = renderSelectedContextSnapshot(snapshot);
    return rendered ? [lines[0], rendered].join("\n") : lines.join("\n");
  }

  return lines.join("\n");
}

function renderActiveWorkContextSnapshot(snapshot: unknown): string {
  const record = asRecord(snapshot);
  const currentWorkItem = asRecord(record?.currentWorkItem);
  const latestHandoff = asRecord(record?.latestHandoff);
  const lines: string[] = [];

  if (currentWorkItem) {
    const goal = normalizeText(currentWorkItem.goal) || "未命名工作项";
    const workItemId = normalizeText(currentWorkItem.workItemId);
    lines.push(`当前工作项：${goal}${workItemId ? `（${workItemId}）` : ""}`);
    lines.push(`当前状态：${normalizeText(currentWorkItem.status) || "unknown"}`);

    const priority = normalizeText(currentWorkItem.priority);
    if (priority) {
      lines.push(`优先级：${priority}`);
    }

    const dispatchReason = normalizeText(currentWorkItem.dispatchReason);
    if (dispatchReason) {
      lines.push(`派发原因：${dispatchReason}`);
    }

    const waitingFor = normalizeText(currentWorkItem.waitingFor);
    if (waitingFor === "human") {
      lines.push("等待人：Themis");
    } else if (waitingFor === "agent") {
      lines.push("等待人：其他数字员工");
    }

    const latestWaitingMessage = normalizeText(currentWorkItem.latestWaitingMessage);
    if (latestWaitingMessage) {
      lines.push(`最新等待消息：${latestWaitingMessage}`);
    }

    const latestHumanResponse = normalizeText(currentWorkItem.latestHumanResponse);
    if (latestHumanResponse) {
      lines.push(`最近的人类回复：${latestHumanResponse}`);
    }

    const latestHandoffSummary = normalizeText(currentWorkItem.latestHandoffSummary);
    if (latestHandoffSummary) {
      lines.push(`最近交接摘要：${latestHandoffSummary}`);
    }

    const waitingActionRequest = asRecord(currentWorkItem.waitingActionRequest);
    const waitingActionPrompt = normalizeText(waitingActionRequest?.prompt ?? waitingActionRequest?.message);
    if (waitingActionPrompt) {
      lines.push(`等待动作：${waitingActionPrompt}`);
    }
  }

  if (latestHandoff) {
    const summary = normalizeText(latestHandoff.summary);
    if (summary) {
      lines.push(`最新交接：${summary}`);
    }

    const blockers = normalizeStringArray(latestHandoff.blockers);
    if (blockers.length > 0) {
      lines.push(`当前阻塞：${blockers.join("；")}`);
    }

    const recommendedNextActions = normalizeStringArray(latestHandoff.recommendedNextActions);
    if (recommendedNextActions.length > 0) {
      lines.push(`建议下一步：${recommendedNextActions.join("；")}`);
    }
  }

  const note = normalizeText(record?.note);
  if (lines.length === 0 && note) {
    lines.push(`上下文说明：${note}`);
  }

  return lines.join("\n");
}

function renderSelectedContextSnapshot(snapshot: unknown): string {
  const record = asRecord(snapshot);
  const refs = Array.isArray(record?.selectedArtifactRefs) ? record.selectedArtifactRefs : [];

  if (refs.length === 0) {
    const note = normalizeText(record?.note);
    return note ? `上下文说明：${note}` : "上下文说明：当前没有指定材料。";
  }

  return [
    "指定材料：",
    ...refs.map((item) => {
      const artifact = asRecord(item);
      const refType = resolveArtifactRefTypeLabel(normalizeText(artifact?.refType));
      const refId = normalizeText(artifact?.refId) || "unknown";
      const snapshotSummary = summarizeArtifactSnapshot(artifact?.snapshotJson);
      return snapshotSummary
        ? `- ${refType}：${refId}（${snapshotSummary}）`
        : `- ${refType}：${refId}`;
    }),
  ].join("\n");
}

function summarizeArtifactSnapshot(snapshot: unknown): string {
  const record = asRecord(snapshot);
  if (!record) {
    return "";
  }

  const summary = normalizeText(record.summary ?? record.title ?? record.goal ?? record.content ?? record.note);
  return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
}

function resolveEntryModeLabel(entryMode: ManagedAgentPlatformMeetingParticipantRecord["entryMode"]): string {
  if (entryMode === "active_work_context") {
    return "带当前工作上下文";
  }

  if (entryMode === "selected_context") {
    return "带指定上下文";
  }

  return "空白入场";
}

function resolveArtifactRefTypeLabel(refType: string): string {
  switch (refType) {
    case "work_item":
      return "工作项";
    case "handoff":
      return "交接";
    case "managed_agent_timeline":
      return "员工时间线";
    case "conversation_summary":
      return "对话摘要";
    case "document":
      return "文档";
    default:
      return refType || "材料";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => normalizeText(item))
      .filter(Boolean)
    : [];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMessageVisibleToParticipant(
  message: ManagedAgentPlatformMeetingMessageRecord,
  participant: ManagedAgentPlatformMeetingParticipantRecord,
): boolean {
  if (message.audience === "all_participants") {
    return true;
  }

  return Array.isArray(message.visibleParticipantIds) && message.visibleParticipantIds.includes(participant.participantId);
}

function resolveVisibleSpeaker(
  message: ManagedAgentPlatformMeetingMessageRecord,
  participantNames: Map<string, string>,
): string {
  if (message.speakerType === "themis") {
    return "Themis";
  }

  if (message.speakerType === "managed_agent") {
    return participantNames.get(message.speakerAgentId ?? "") ?? "Managed Agent";
  }

  return "System";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
