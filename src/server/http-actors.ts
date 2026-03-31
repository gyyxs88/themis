import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodexTaskRuntime } from "../core/codex-runtime.js";
import { createTaskError, resolveErrorStatusCode, toErrorMessage } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface ActorCreatePayload extends IdentityPayload {
  actor: {
    displayName: string;
    role: string;
  };
}

interface ActorScopePayload extends IdentityPayload {
  actorId: string;
  scopeId: string;
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

function writeActorBoundaryError(response: ServerResponse, error: unknown): void {
  if (isActorBoundaryError(error)) {
    writeJson(response, 400, {
      error: createTaskError(error, false),
    });
    return;
  }

  writeRuntimeError(response, error);
}

export async function handleActorCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeActorCreatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const actor = runtime.getPrincipalActorsService().createActor({
      principalId: identity.principalId,
      displayName: payload.actor.displayName,
      role: payload.actor.role,
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      actor,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleActorList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeIdentityPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const actors = runtime.getPrincipalActorsService().listActors(identity.principalId);

    writeJson(response, 200, {
      identity,
      actors,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handleActorTimeline(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeActorScopePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const takeover = runtime.getPrincipalActorsService().takeOverActorTask({
      principalId: identity.principalId,
      actorId: payload.actorId,
      scopeId: payload.scopeId,
    });

    writeJson(response, 200, {
      identity,
      timeline: takeover.timeline,
    });
  } catch (error) {
    writeActorBoundaryError(response, error);
  }
}

export async function handleActorTakeover(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizeActorScopePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const result = runtime.getPrincipalActorsService().takeOverActorTask({
      principalId: identity.principalId,
      actorId: payload.actorId,
      scopeId: payload.scopeId,
    });

    writeJson(response, 200, result);
  } catch (error) {
    writeActorBoundaryError(response, error);
  }
}

function normalizeIdentityPayload(value: unknown): IdentityPayload {
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

function normalizeActorCreatePayload(value: unknown): ActorCreatePayload {
  if (!isRecord(value) || !isRecord(value.actor)) {
    throw new Error("actor 创建请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const displayName = normalizeText(value.actor.displayName);
  const role = normalizeText(value.actor.role);

  if (!displayName || !role) {
    throw new Error("actor 创建请求缺少必要字段。");
  }

  return {
    ...identity,
    actor: {
      displayName,
      role,
    },
  };
}

function normalizeActorScopePayload(value: unknown): ActorScopePayload {
  if (!isRecord(value)) {
    throw new Error("actor scope 请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const actorId = normalizeText(value.actorId);
  const scopeId = normalizeText(value.scopeId);

  if (!actorId || !scopeId) {
    throw new Error("actor scope 请求缺少必要字段。");
  }

  return {
    ...identity,
    actorId,
    scopeId,
  };
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isActorBoundaryError(error: unknown): boolean {
  const message = toErrorMessage(error);

  return message === "Principal actor does not exist."
    || message === "Actor task scope does not exist.";
}
