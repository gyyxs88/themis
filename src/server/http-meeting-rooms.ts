import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import type { PlatformMeetingRoomGateway, PlatformMeetingRoomGatewayStatus } from "../core/platform-meeting-room-gateway.js";
import type {
  ManagedAgentPlatformMeetingMessageRecord,
  ManagedAgentPlatformMeetingParticipantRecord,
} from "../contracts/managed-agent-platform-meetings.js";
import {
  buildManagedAgentMeetingRoomStreamEvent,
} from "../contracts/managed-agent-platform-meetings.js";
import type {
  ManagedAgentPlatformMeetingRoomAppendFailureInput,
  ManagedAgentPlatformMeetingRoomAppendReplyInput,
  ManagedAgentPlatformMeetingRoomCloseInput,
  ManagedAgentPlatformMeetingRoomCreateInput,
  ManagedAgentPlatformMeetingRoomCreateResolutionInput,
  ManagedAgentPlatformMeetingRoomMessageCreateInput,
  ManagedAgentPlatformMeetingRoomPromoteResolutionInput,
} from "../contracts/managed-agent-platform-meetings.js";
import type { TaskRequest } from "../types/task.js";
import { readJsonBody } from "./http-request.js";
import { writeJson, writeNdjson } from "./http-responses.js";

const PLATFORM_MEETING_ROOMS_GATEWAY_REQUIRED = {
  error: {
    code: "PLATFORM_MEETING_ROOMS_GATEWAY_REQUIRED",
    message: "内部会议室当前要求已配置平台 gateway，且主 Themis 具备本地 app-server runtime。",
  },
} as const;

export interface MeetingRoomGatewayOptions {
  gateway: PlatformMeetingRoomGateway | null;
}

export interface MeetingRoomStreamOptions extends MeetingRoomGatewayOptions {
  runtime: Pick<AppServerTaskRuntime, "runTaskAsPrincipal"> | null;
}

export function handleMeetingRoomStatus(
  response: ServerResponse,
  options: MeetingRoomGatewayOptions,
  headOnly = false,
): void {
  const status: PlatformMeetingRoomGatewayStatus = options.gateway?.getStatus() ?? {
    accessMode: "gateway_required",
    platformBaseUrl: "",
    ownerPrincipalId: "",
  };

  writeJson(response, 200, status, headOnly);
}

export async function handleMeetingRoomList(
  request: IncomingMessage,
  response: ServerResponse,
  options: MeetingRoomGatewayOptions,
): Promise<void> {
  const gateway = requireMeetingRoomGateway(response, options.gateway);
  if (!gateway) {
    return;
  }

  try {
    const payload = await readJsonBody(request) as { status?: "open" | "closing" | "closed" };
    writeJson(response, 200, await gateway.listRooms({
      ...(payload.status ? { status: payload.status } : {}),
    }));
  } catch (error) {
    writeMeetingRoomError(response, error);
  }
}

export async function handleMeetingRoomCreate(
  request: IncomingMessage,
  response: ServerResponse,
  options: MeetingRoomGatewayOptions,
): Promise<void> {
  const gateway = requireMeetingRoomGateway(response, options.gateway);
  if (!gateway) {
    return;
  }

  try {
    const payload = await readJsonBody(request) as ManagedAgentPlatformMeetingRoomCreateInput;
    writeJson(response, 200, await gateway.createRoom(payload));
  } catch (error) {
    writeMeetingRoomError(response, error);
  }
}

export async function handleMeetingRoomDetail(
  request: IncomingMessage,
  response: ServerResponse,
  options: MeetingRoomGatewayOptions,
): Promise<void> {
  const gateway = requireMeetingRoomGateway(response, options.gateway);
  if (!gateway) {
    return;
  }

  try {
    const payload = await readJsonBody(request) as { roomId?: string };
    const roomId = String(payload.roomId ?? "").trim();
    writeJson(response, 200, await gateway.getRoomDetail(roomId));
  } catch (error) {
    writeMeetingRoomError(response, error);
  }
}

export async function handleMeetingRoomParticipantsAdd(
  request: IncomingMessage,
  response: ServerResponse,
  options: MeetingRoomGatewayOptions,
): Promise<void> {
  const gateway = requireMeetingRoomGateway(response, options.gateway);
  if (!gateway) {
    return;
  }

  try {
    const payload = await readJsonBody(request) as {
      roomId?: string;
      participants?: ManagedAgentPlatformMeetingRoomCreateInput["participants"];
    };
    const roomId = String(payload.roomId ?? "").trim();
    writeJson(response, 200, await gateway.addParticipants(roomId, payload.participants ?? []));
  } catch (error) {
    writeMeetingRoomError(response, error);
  }
}

export async function handleMeetingRoomCreateResolution(
  request: IncomingMessage,
  response: ServerResponse,
  options: MeetingRoomGatewayOptions,
): Promise<void> {
  const gateway = requireMeetingRoomGateway(response, options.gateway);
  if (!gateway) {
    return;
  }

  try {
    const payload = await readJsonBody(request) as ManagedAgentPlatformMeetingRoomCreateResolutionInput;
    writeJson(response, 200, await gateway.createResolution(payload));
  } catch (error) {
    writeMeetingRoomError(response, error);
  }
}

export async function handleMeetingRoomPromoteResolution(
  request: IncomingMessage,
  response: ServerResponse,
  options: MeetingRoomGatewayOptions,
): Promise<void> {
  const gateway = requireMeetingRoomGateway(response, options.gateway);
  if (!gateway) {
    return;
  }

  try {
    const payload = await readJsonBody(request) as ManagedAgentPlatformMeetingRoomPromoteResolutionInput;
    writeJson(response, 200, await gateway.promoteResolution(payload));
  } catch (error) {
    writeMeetingRoomError(response, error);
  }
}

export async function handleMeetingRoomClose(
  request: IncomingMessage,
  response: ServerResponse,
  options: MeetingRoomGatewayOptions,
): Promise<void> {
  const gateway = requireMeetingRoomGateway(response, options.gateway);
  if (!gateway) {
    return;
  }

  try {
    const payload = await readJsonBody(request) as ManagedAgentPlatformMeetingRoomCloseInput;
    writeJson(response, 200, await gateway.closeRoom(payload));
  } catch (error) {
    writeMeetingRoomError(response, error);
  }
}

export async function handleMeetingRoomMessageStream(
  request: IncomingMessage,
  response: ServerResponse,
  options: MeetingRoomStreamOptions,
): Promise<void> {
  if (!options.gateway || !options.runtime) {
    writeJson(response, 409, PLATFORM_MEETING_ROOMS_GATEWAY_REQUIRED);
    return;
  }

  try {
    const payload = await readJsonBody(request) as {
      roomId?: string;
      content?: string;
      operatorPrincipalId?: string;
      audience?: ManagedAgentPlatformMeetingRoomMessageCreateInput["audience"];
      targetParticipantIds?: string[];
    };
    const roomId = String(payload.roomId ?? "").trim();
    const content = String(payload.content ?? "").trim();
    const operatorPrincipalId = String(payload.operatorPrincipalId ?? "").trim();

    const started = await options.gateway.createManagerMessage({
      roomId,
      content,
      operatorPrincipalId,
      ...(payload.audience ? { audience: payload.audience } : {}),
      ...(Array.isArray(payload.targetParticipantIds) ? { targetParticipantIds: payload.targetParticipantIds } : {}),
    });

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");

    writeNdjson(response, buildManagedAgentMeetingRoomStreamEvent("room.message.created", {
      roomId: started.room.roomId,
      messageId: started.message.messageId,
      roundId: started.round.roundId,
    }));

    const detail = await options.gateway.getRoomDetail(started.room.roomId);
    const participantNames = new Map(
      detail.participants
        .filter((participant) => participant.agentId)
        .map((participant) => [participant.agentId ?? "", participant.displayName]),
    );

    for (const participant of started.targetParticipants) {
      writeNdjson(response, buildManagedAgentMeetingRoomStreamEvent("room.round.started", {
        roomId: started.room.roomId,
        roundId: started.round.roundId,
        participantAgentId: participant.agentId ?? "",
      }));

      try {
        const visibleMessages = detail.messages
          .filter((message) => isMessageVisibleToParticipant(message, participant))
          .map((message) => ({
            speaker: resolveVisibleSpeaker(message, participantNames),
            content: message.content,
          }));

        const result = await options.runtime.runTaskAsPrincipal(
          buildMeetingRoomTaskRequest({
            roomTitle: detail.room.title,
            roomGoal: detail.room.goal,
            managerMessage: started.message.content,
            visibleMessages,
            entryContextSnapshotJson: participant.entryContextSnapshotJson,
          }),
          {
            principalId: participant.principalId,
            ...(participant.roomSessionId ? { conversationId: participant.roomSessionId } : {}),
          },
        );

        const replyText = typeof result.output === "string" && result.output.trim()
          ? result.output.trim()
          : typeof result.summary === "string" && result.summary.trim()
            ? result.summary.trim()
            : "收到，当前没有可直接输出的文字结论。";

        const appended = await options.gateway.appendAgentReply({
          roomId: started.room.roomId,
          roundId: started.round.roundId,
          participantId: participant.participantId,
          content: replyText,
        });

        writeNdjson(response, buildManagedAgentMeetingRoomStreamEvent("room.agent.reply", {
          roomId: started.room.roomId,
          roundId: started.round.roundId,
          participantAgentId: participant.agentId ?? "",
          messageId: appended.message.messageId,
        }));

        writeNdjson(response, buildManagedAgentMeetingRoomStreamEvent("room.round.completed", {
          roomId: started.room.roomId,
          roundId: appended.round.roundId,
          participantAgentId: participant.agentId ?? "",
        }));
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : String(error);

        await options.gateway.appendAgentFailure({
          roomId: started.room.roomId,
          roundId: started.round.roundId,
          participantId: participant.participantId,
          failureMessage,
        });

        writeNdjson(response, buildManagedAgentMeetingRoomStreamEvent("room.agent.failed", {
          roomId: started.room.roomId,
          roundId: started.round.roundId,
          participantAgentId: participant.agentId ?? "",
          failureMessage,
        }));
      }
    }

    response.end();
  } catch (error) {
    if (!response.headersSent) {
      writeMeetingRoomError(response, error);
      return;
    }

    response.end();
  }
}

function buildMeetingRoomTaskRequest(input: {
  roomTitle: string;
  roomGoal: string;
  managerMessage: string;
  visibleMessages: Array<{ speaker: string; content: string }>;
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
      transcript ? `房间可见历史：\n${transcript}` : "房间可见历史：暂无",
      `你的入场上下文快照：${JSON.stringify(input.entryContextSnapshotJson ?? null)}`,
      `Themis 刚才的问题：${input.managerMessage}`,
      "请直接给出你的判断、建议或需要 Themis 澄清的问题。不要假设自己在和人类直接对话；你的上级是 Themis。",
    ].join("\n\n"),
    channelContext: {
      sessionId: "",
      channelSessionKey: "",
    },
    createdAt: timestamp,
    options: {},
  };
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

function requireMeetingRoomGateway(
  response: ServerResponse,
  gateway: PlatformMeetingRoomGateway | null,
): PlatformMeetingRoomGateway | null {
  if (gateway) {
    return gateway;
  }

  writeJson(response, 409, PLATFORM_MEETING_ROOMS_GATEWAY_REQUIRED);
  return null;
}

function writeMeetingRoomError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : "内部会议室请求处理失败。";
  writeJson(response, 400, {
    error: {
      code: "MEETING_ROOM_REQUEST_FAILED",
      message,
    },
  });
}
