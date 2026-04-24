import { buildPlatformServiceAuthorizationHeader } from "themis-contracts/managed-agent-platform-access";
import type {
  ManagedAgentPlatformMeetingRoomAppendFailureInput,
  ManagedAgentPlatformMeetingRoomAppendReplyInput,
  ManagedAgentPlatformMeetingRoomAppendReplyResult,
  ManagedAgentPlatformMeetingRoomCloseInput,
  ManagedAgentPlatformMeetingRoomCloseResult,
  ManagedAgentPlatformMeetingRoomCreateInput,
  ManagedAgentPlatformMeetingRoomCreateResolutionInput,
  ManagedAgentPlatformMeetingRoomCreateResolutionResult,
  ManagedAgentPlatformMeetingRoomCreateResult,
  ManagedAgentPlatformMeetingRoomDetailResult,
  ManagedAgentPlatformMeetingRoomListResult,
  ManagedAgentPlatformMeetingRoomMessageCreateInput,
  ManagedAgentPlatformMeetingRoomMessageCreateResult,
  ManagedAgentPlatformMeetingRoomParticipantsAddResult,
  ManagedAgentPlatformMeetingRoomPromoteResolutionInput,
  ManagedAgentPlatformMeetingRoomPromoteResolutionResult,
} from "themis-contracts/managed-agent-platform-meetings";
import { readManagedAgentPlatformGatewayConfig } from "./managed-agent-platform-gateway-client.js";

export interface PlatformMeetingRoomGatewayStatus {
  accessMode: "platform_gateway" | "gateway_required";
  platformBaseUrl: string;
  ownerPrincipalId: string;
}

export interface PlatformMeetingRoomGatewayOptions {
  baseUrl: string;
  ownerPrincipalId: string;
  webAccessToken: string;
  fetchImpl?: typeof fetch;
}

export class PlatformMeetingRoomGateway {
  private readonly baseUrl: string;
  private readonly ownerPrincipalId: string;
  private readonly webAccessToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PlatformMeetingRoomGatewayOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl);
    this.ownerPrincipalId = options.ownerPrincipalId;
    this.webAccessToken = options.webAccessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getStatus(): PlatformMeetingRoomGatewayStatus {
    return {
      accessMode: "platform_gateway",
      platformBaseUrl: this.baseUrl,
      ownerPrincipalId: this.ownerPrincipalId,
    };
  }

  async listRooms(input: { status?: "open" | "closing" | "closed" } = {}): Promise<ManagedAgentPlatformMeetingRoomListResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomListResult>("/api/platform/meeting-rooms/list", {
      ownerPrincipalId: this.ownerPrincipalId,
      ...(input.status ? { status: input.status } : {}),
    });
  }

  async createRoom(input: ManagedAgentPlatformMeetingRoomCreateInput): Promise<ManagedAgentPlatformMeetingRoomCreateResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomCreateResult>("/api/platform/meeting-rooms/create", {
      ownerPrincipalId: this.ownerPrincipalId,
      room: input,
    });
  }

  async getRoomDetail(roomId: string): Promise<ManagedAgentPlatformMeetingRoomDetailResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomDetailResult>("/api/platform/meeting-rooms/detail", {
      ownerPrincipalId: this.ownerPrincipalId,
      roomId,
    });
  }

  async addParticipants(
    roomId: string,
    participants: ManagedAgentPlatformMeetingRoomCreateInput["participants"],
  ): Promise<ManagedAgentPlatformMeetingRoomParticipantsAddResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomParticipantsAddResult>(
      "/api/platform/meeting-rooms/participants/add",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        roomId,
        participants,
      },
    );
  }

  async createManagerMessage(
    input: ManagedAgentPlatformMeetingRoomMessageCreateInput,
  ): Promise<ManagedAgentPlatformMeetingRoomMessageCreateResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomMessageCreateResult>(
      "/api/platform/meeting-rooms/messages/create",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        message: input,
      },
    );
  }

  async appendAgentReply(
    input: ManagedAgentPlatformMeetingRoomAppendReplyInput,
  ): Promise<ManagedAgentPlatformMeetingRoomAppendReplyResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomAppendReplyResult>(
      "/api/platform/meeting-rooms/messages/append-agent-reply",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        reply: input,
      },
    );
  }

  async appendAgentFailure(
    input: ManagedAgentPlatformMeetingRoomAppendFailureInput,
  ): Promise<ManagedAgentPlatformMeetingRoomAppendReplyResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomAppendReplyResult>(
      "/api/platform/meeting-rooms/messages/append-agent-failure",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        failure: input,
      },
    );
  }

  async createResolution(
    input: ManagedAgentPlatformMeetingRoomCreateResolutionInput,
  ): Promise<ManagedAgentPlatformMeetingRoomCreateResolutionResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomCreateResolutionResult>(
      "/api/platform/meeting-rooms/resolutions/create",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        resolution: input,
      },
    );
  }

  async promoteResolution(
    input: ManagedAgentPlatformMeetingRoomPromoteResolutionInput,
  ): Promise<ManagedAgentPlatformMeetingRoomPromoteResolutionResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomPromoteResolutionResult>(
      "/api/platform/meeting-rooms/resolutions/promote",
      {
        ownerPrincipalId: this.ownerPrincipalId,
        resolution: input,
      },
    );
  }

  async closeRoom(input: ManagedAgentPlatformMeetingRoomCloseInput): Promise<ManagedAgentPlatformMeetingRoomCloseResult> {
    return await this.requestJson<ManagedAgentPlatformMeetingRoomCloseResult>("/api/platform/meeting-rooms/close", {
      ownerPrincipalId: this.ownerPrincipalId,
      room: input,
    });
  }

  private async requestJson<T>(pathname: string, payload: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildPlatformServiceAuthorizationHeader(this.webAccessToken),
      },
      body: JSON.stringify(payload),
    });
    const parsed = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(resolveHttpErrorMessage(parsed, response.status, `平台会议室请求失败：${pathname}`));
    }

    return parsed as T;
  }
}

export function resolvePlatformMeetingRoomGateway(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): PlatformMeetingRoomGateway | null {
  const config = readManagedAgentPlatformGatewayConfig(env);
  return config
    ? new PlatformMeetingRoomGateway({
      ...config,
      ...(fetchImpl ? { fetchImpl } : {}),
    })
    : null;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      raw: text,
    };
  }
}

function resolveHttpErrorMessage(payload: unknown, status: number, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }

  return `${fallback}（HTTP ${status}）`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
