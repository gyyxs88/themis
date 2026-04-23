import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type { StoredPrincipalDecisionRecord } from "../types/index.js";
import {
  PRINCIPAL_DECISION_STATUSES,
  normalizePrincipalDecisionRelatedIds,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface PrincipalDecisionListPayload extends IdentityPayload {
  status?: StoredPrincipalDecisionRecord["status"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface PrincipalDecisionUpsertPayload extends IdentityPayload {
  decision: {
    decisionId?: string;
    title: string;
    status: StoredPrincipalDecisionRecord["status"];
    summary?: string;
    decidedByPrincipalId?: string;
    decidedAt?: string;
    relatedAssetIds?: string[];
    relatedWorkItemIds?: string[];
  };
}

interface PrincipalDecisionUpdatePayload extends IdentityPayload {
  decision: PrincipalDecisionUpsertPayload["decision"] & {
    decisionId: string;
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

export async function handlePrincipalDecisionList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalDecisionsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalDecisionListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const decisions = runtime.getPrincipalDecisionsService().listDecisions({
      principalId: identity.principalId,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.includeArchived ? { includeArchived: true } : {}),
      ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
    });

    writeJson(response, 200, {
      identity,
      decisions,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalDecisionCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalDecisionsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalDecisionUpsertPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const decision = runtime.getPrincipalDecisionsService().createDecision({
      principalId: identity.principalId,
      title: payload.decision.title,
      status: payload.decision.status,
      ...(payload.decision.summary ? { summary: payload.decision.summary } : {}),
      ...(payload.decision.decidedByPrincipalId
        ? { decidedByPrincipalId: payload.decision.decidedByPrincipalId }
        : {}),
      ...(payload.decision.decidedAt ? { decidedAt: payload.decision.decidedAt } : {}),
      ...(payload.decision.relatedAssetIds ? { relatedAssetIds: payload.decision.relatedAssetIds } : {}),
      ...(payload.decision.relatedWorkItemIds ? { relatedWorkItemIds: payload.decision.relatedWorkItemIds } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      decision,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalDecisionUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalDecisionsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalDecisionUpdatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const decision = runtime.getPrincipalDecisionsService().updateDecision({
      principalId: identity.principalId,
      decisionId: payload.decision.decisionId,
      title: payload.decision.title,
      status: payload.decision.status,
      summary: payload.decision.summary ?? "",
      decidedByPrincipalId: payload.decision.decidedByPrincipalId ?? "",
      decidedAt: payload.decision.decidedAt ?? "",
      ...(payload.decision.relatedAssetIds ? { relatedAssetIds: payload.decision.relatedAssetIds } : {}),
      ...(payload.decision.relatedWorkItemIds ? { relatedWorkItemIds: payload.decision.relatedWorkItemIds } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      decision,
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

function normalizePrincipalDecisionListPayload(value: unknown): PrincipalDecisionListPayload {
  if (!isRecord(value)) {
    throw new Error("决策列表请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const status = normalizeDecisionStatus(value.status);
  const query = normalizeText(value.query);
  const limit = typeof value.limit === "number" && Number.isFinite(value.limit) ? Math.floor(value.limit) : undefined;

  return {
    ...identity,
    ...(status ? { status } : {}),
    ...(query ? { query } : {}),
    ...(value.includeArchived === true ? { includeArchived: true } : {}),
    ...(typeof limit === "number" && limit > 0 ? { limit } : {}),
  };
}

function normalizePrincipalDecisionUpsertPayload(value: unknown): PrincipalDecisionUpsertPayload {
  if (!isRecord(value)) {
    throw new Error("决策请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);

  if (!isRecord(value.decision)) {
    throw new Error("决策请求缺少 decision。");
  }

  const decisionId = normalizeText(value.decision.decisionId);
  const title = normalizeRequiredText(value.decision.title, "决策标题不能为空。");
  const status = normalizeRequiredDecisionStatus(value.decision.status);
  const summary = typeof value.decision.summary === "string" ? value.decision.summary.trim() : "";
  const decidedByPrincipalId = normalizeText(value.decision.decidedByPrincipalId);
  const decidedAt = normalizeText(value.decision.decidedAt);
  const relatedAssetIds = normalizePrincipalDecisionRelatedIds(value.decision.relatedAssetIds);
  const relatedWorkItemIds = normalizePrincipalDecisionRelatedIds(value.decision.relatedWorkItemIds);

  return {
    ...identity,
    decision: {
      ...(decisionId ? { decisionId } : {}),
      title,
      status,
      summary,
      ...(decidedByPrincipalId ? { decidedByPrincipalId } : {}),
      ...(decidedAt ? { decidedAt } : {}),
      relatedAssetIds,
      relatedWorkItemIds,
    },
  };
}

function normalizePrincipalDecisionUpdatePayload(value: unknown): PrincipalDecisionUpdatePayload {
  const payload = normalizePrincipalDecisionUpsertPayload(value);

  if (!payload.decision.decisionId) {
    throw new Error("决策更新请求缺少 decisionId。");
  }

  return payload as PrincipalDecisionUpdatePayload;
}

function normalizeRequiredText(value: unknown, message: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeRequiredDecisionStatus(value: unknown): StoredPrincipalDecisionRecord["status"] {
  const normalized = normalizeDecisionStatus(value);

  if (!normalized) {
    throw new Error("决策 status 不合法。");
  }

  return normalized;
}

function normalizeDecisionStatus(value: unknown): StoredPrincipalDecisionRecord["status"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  if (!PRINCIPAL_DECISION_STATUSES.includes(normalized as StoredPrincipalDecisionRecord["status"])) {
    throw new Error("决策 status 不合法。");
  }

  return normalized as StoredPrincipalDecisionRecord["status"];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
