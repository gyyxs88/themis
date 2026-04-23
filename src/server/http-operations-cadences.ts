import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type { StoredPrincipalCadenceRecord } from "../types/index.js";
import {
  PRINCIPAL_CADENCE_FREQUENCIES,
  PRINCIPAL_CADENCE_STATUSES,
  normalizePrincipalCadenceRelatedIds,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface PrincipalCadenceListPayload extends IdentityPayload {
  status?: StoredPrincipalCadenceRecord["status"];
  frequency?: StoredPrincipalCadenceRecord["frequency"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface PrincipalCadenceUpsertPayload extends IdentityPayload {
  cadence: {
    cadenceId?: string;
    title: string;
    frequency: StoredPrincipalCadenceRecord["frequency"];
    status: StoredPrincipalCadenceRecord["status"];
    nextRunAt?: string;
    ownerPrincipalId?: string;
    playbookRef?: string;
    summary?: string;
    relatedAssetIds?: string[];
  };
}

interface PrincipalCadenceUpdatePayload extends IdentityPayload {
  cadence: PrincipalCadenceUpsertPayload["cadence"] & {
    cadenceId: string;
  };
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

export async function handlePrincipalCadenceList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalCadencesService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalCadenceListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const cadences = runtime.getPrincipalCadencesService().listCadences({
      principalId: identity.principalId,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.frequency ? { frequency: payload.frequency } : {}),
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.includeArchived ? { includeArchived: true } : {}),
      ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
    });

    writeJson(response, 200, {
      identity,
      cadences,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalCadenceCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalCadencesService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalCadenceUpsertPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const cadence = runtime.getPrincipalCadencesService().createCadence({
      principalId: identity.principalId,
      title: payload.cadence.title,
      frequency: payload.cadence.frequency,
      status: payload.cadence.status,
      ...(payload.cadence.nextRunAt ? { nextRunAt: payload.cadence.nextRunAt } : {}),
      ...(payload.cadence.ownerPrincipalId ? { ownerPrincipalId: payload.cadence.ownerPrincipalId } : {}),
      ...(payload.cadence.playbookRef ? { playbookRef: payload.cadence.playbookRef } : {}),
      ...(payload.cadence.summary ? { summary: payload.cadence.summary } : {}),
      ...(payload.cadence.relatedAssetIds ? { relatedAssetIds: payload.cadence.relatedAssetIds } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      cadence,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalCadenceUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalCadencesService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalCadenceUpdatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const cadence = runtime.getPrincipalCadencesService().updateCadence({
      principalId: identity.principalId,
      cadenceId: payload.cadence.cadenceId,
      title: payload.cadence.title,
      frequency: payload.cadence.frequency,
      status: payload.cadence.status,
      nextRunAt: payload.cadence.nextRunAt ?? "",
      ownerPrincipalId: payload.cadence.ownerPrincipalId ?? "",
      playbookRef: payload.cadence.playbookRef ?? "",
      summary: payload.cadence.summary ?? "",
      ...(payload.cadence.relatedAssetIds ? { relatedAssetIds: payload.cadence.relatedAssetIds } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      cadence,
    });
  } catch (error) {
    writeRuntimeError(response, error);
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

function normalizePrincipalCadenceListPayload(value: unknown): PrincipalCadenceListPayload {
  if (!isRecord(value)) {
    throw new Error("节奏列表请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const status = normalizeCadenceStatus(value.status);
  const frequency = normalizeCadenceFrequency(value.frequency);
  const query = normalizeText(value.query);
  const limit = typeof value.limit === "number" && Number.isFinite(value.limit) ? Math.floor(value.limit) : undefined;

  return {
    ...identity,
    ...(status ? { status } : {}),
    ...(frequency ? { frequency } : {}),
    ...(query ? { query } : {}),
    ...(value.includeArchived === true ? { includeArchived: true } : {}),
    ...(typeof limit === "number" && limit > 0 ? { limit } : {}),
  };
}

function normalizePrincipalCadenceUpsertPayload(value: unknown): PrincipalCadenceUpsertPayload {
  if (!isRecord(value)) {
    throw new Error("节奏请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);

  if (!isRecord(value.cadence)) {
    throw new Error("节奏请求缺少 cadence。");
  }

  const cadenceId = normalizeText(value.cadence.cadenceId);
  const title = normalizeRequiredText(value.cadence.title, "节奏标题不能为空。");
  const frequency = normalizeRequiredCadenceFrequency(value.cadence.frequency);
  const status = normalizeRequiredCadenceStatus(value.cadence.status);
  const nextRunAt = normalizeText(value.cadence.nextRunAt);
  const ownerPrincipalId = normalizeText(value.cadence.ownerPrincipalId);
  const playbookRef = normalizeText(value.cadence.playbookRef);
  const summary = typeof value.cadence.summary === "string" ? value.cadence.summary.trim() : "";
  const relatedAssetIds = normalizePrincipalCadenceRelatedIds(value.cadence.relatedAssetIds);

  return {
    ...identity,
    cadence: {
      ...(cadenceId ? { cadenceId } : {}),
      title,
      frequency,
      status,
      ...(nextRunAt ? { nextRunAt } : {}),
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      ...(playbookRef ? { playbookRef } : {}),
      summary,
      relatedAssetIds,
    },
  };
}

function normalizePrincipalCadenceUpdatePayload(value: unknown): PrincipalCadenceUpdatePayload {
  const payload = normalizePrincipalCadenceUpsertPayload(value);

  if (!payload.cadence.cadenceId) {
    throw new Error("节奏更新请求缺少 cadenceId。");
  }

  return {
    ...payload,
    cadence: {
      ...payload.cadence,
      cadenceId: payload.cadence.cadenceId,
    },
  };
}

function normalizeRequiredCadenceFrequency(value: unknown): StoredPrincipalCadenceRecord["frequency"] {
  const normalized = normalizeCadenceFrequency(value);

  if (!normalized) {
    throw new Error("节奏频率不合法。");
  }

  return normalized;
}

function normalizeRequiredCadenceStatus(value: unknown): StoredPrincipalCadenceRecord["status"] {
  const normalized = normalizeCadenceStatus(value);

  if (!normalized) {
    throw new Error("节奏状态不合法。");
  }

  return normalized;
}

function normalizeCadenceFrequency(value: unknown): StoredPrincipalCadenceRecord["frequency"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  return PRINCIPAL_CADENCE_FREQUENCIES.includes(normalized as StoredPrincipalCadenceRecord["frequency"])
    ? normalized as StoredPrincipalCadenceRecord["frequency"]
    : undefined;
}

function normalizeCadenceStatus(value: unknown): StoredPrincipalCadenceRecord["status"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  return PRINCIPAL_CADENCE_STATUSES.includes(normalized as StoredPrincipalCadenceRecord["status"])
    ? normalized as StoredPrincipalCadenceRecord["status"]
    : undefined;
}

function normalizeRequiredText(value: unknown, message: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
