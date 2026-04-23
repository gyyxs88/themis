import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface PrincipalOperationsBossViewPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
  now?: string;
}

async function readAndNormalizePayload<T>(
  request: IncomingMessage,
  response: ServerResponse,
  normalize: (value: unknown) => T,
): Promise<T | null> {
  try {
    return normalize(await readJsonBody(request));
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, false), {
      error: createTaskError(error, false),
    });
    return null;
  }
}

function writeRuntimeError(response: ServerResponse, error: unknown): void {
  writeJson(response, resolveErrorStatusCode(error, true), {
    error: createTaskError(error, true),
  });
}

export async function handlePrincipalOperationsBossView(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalOperationsBossViewService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalOperationsBossViewPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const bossView = runtime.getPrincipalOperationsBossViewService().getBossView({
      principalId: identity.principalId,
      ...(payload.now ? { now: payload.now } : {}),
    });

    writeJson(response, 200, {
      identity,
      bossView,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

function normalizePrincipalOperationsBossViewPayload(value: unknown): PrincipalOperationsBossViewPayload {
  if (!isRecord(value)) {
    throw new Error("老板视图请求缺少必要字段。");
  }

  const channel = normalizeText(value.channel);
  const channelUserId = normalizeText(value.channelUserId);
  const displayName = normalizeText(value.displayName);
  const now = normalizeText(value.now);

  if (!channel || !channelUserId) {
    throw new Error("身份请求缺少必要字段。");
  }

  return {
    channel,
    channelUserId,
    ...(displayName ? { displayName } : {}),
    ...(now ? { now } : {}),
  };
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
