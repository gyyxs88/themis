import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { MeetingRoomRoundExecutor } from "../core/meeting-room-round-executor.js";
import type { PlatformMeetingRoomGateway, PlatformMeetingRoomGatewayStatus } from "../core/platform-meeting-room-gateway.js";
import {
  buildManagedAgentMeetingRoomStreamEvent,
} from "themis-contracts/managed-agent-platform-meetings";
import type {
  ManagedAgentPlatformMeetingRoomAppendFailureInput,
  ManagedAgentPlatformMeetingRoomCloseInput,
  ManagedAgentPlatformMeetingRoomCreateInput,
  ManagedAgentPlatformMeetingRoomCreateResolutionInput,
  ManagedAgentPlatformMeetingRoomMessageCreateInput,
  ManagedAgentPlatformMeetingRoomPromoteResolutionInput,
} from "themis-contracts/managed-agent-platform-meetings";
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
  roundExecutor: MeetingRoomRoundExecutor | null;
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
  if (!options.gateway || !options.runtime || !options.roundExecutor) {
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

    await options.roundExecutor.enqueue({
      gateway: options.gateway,
      runtime: options.runtime,
      started,
      onEvent(event) {
        writeNdjson(response, event);
      },
    });

    response.end();
  } catch (error) {
    if (!response.headersSent) {
      writeMeetingRoomError(response, error);
      return;
    }

    response.end();
  }
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
