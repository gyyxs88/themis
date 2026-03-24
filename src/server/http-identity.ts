import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodexTaskRuntime } from "../core/codex-runtime.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";

interface IdentityPayload {
  channel?: unknown;
  channelUserId?: unknown;
  displayName?: unknown;
}

export async function handleIdentityStatus(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = normalizeIdentityPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);

    writeJson(response, 200, {
      identity,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleIdentityLinkCodeCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = normalizeIdentityPayload(await readJsonBody(request));
    const linkCode = runtime.getIdentityLinkService().issueLinkCode(payload);

    writeJson(response, 200, {
      linkCode,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export async function handleIdentityReset(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = normalizeIdentityPayload(await readJsonBody(request));
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const resetAt = new Date().toISOString();
    const reset = runtime.getRuntimeStore().resetPrincipalState(identity.principalId, resetAt);

    writeJson(response, 200, {
      ok: true,
      identity,
      reset,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

function normalizeIdentityPayload(value: unknown): {
  channel: string;
  channelUserId: string;
  displayName?: string;
} {
  if (!isRecord(value)) {
    throw new Error("身份请求缺少必要字段。");
  }

  const channel = normalizeText(value.channel);
  const channelUserId = normalizeText(value.channelUserId);
  const displayName = normalizeText(value.displayName);

  if (!channel || !channelUserId) {
    throw new Error("身份请求缺少必要字段。");
  }

  return {
    channel,
    channelUserId,
    ...(displayName ? { displayName } : {}),
  };
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
