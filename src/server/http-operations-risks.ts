import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type { StoredPrincipalRiskRecord } from "../types/index.js";
import {
  PRINCIPAL_RISK_SEVERITIES,
  PRINCIPAL_RISK_STATUSES,
  PRINCIPAL_RISK_TYPES,
  normalizePrincipalRiskRelatedIds,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface PrincipalRiskListPayload extends IdentityPayload {
  status?: StoredPrincipalRiskRecord["status"];
  type?: StoredPrincipalRiskRecord["type"];
  severity?: StoredPrincipalRiskRecord["severity"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface PrincipalRiskUpsertPayload extends IdentityPayload {
  risk: {
    riskId?: string;
    type: StoredPrincipalRiskRecord["type"];
    title: string;
    severity: StoredPrincipalRiskRecord["severity"];
    status: StoredPrincipalRiskRecord["status"];
    ownerPrincipalId?: string;
    summary?: string;
    detectedAt?: string;
    relatedAssetIds?: string[];
    linkedDecisionIds?: string[];
    relatedWorkItemIds?: string[];
  };
}

interface PrincipalRiskUpdatePayload extends IdentityPayload {
  risk: PrincipalRiskUpsertPayload["risk"] & {
    riskId: string;
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

export async function handlePrincipalRiskList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalRisksService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalRiskListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const risks = runtime.getPrincipalRisksService().listRisks({
      principalId: identity.principalId,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.type ? { type: payload.type } : {}),
      ...(payload.severity ? { severity: payload.severity } : {}),
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.includeArchived ? { includeArchived: true } : {}),
      ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
    });

    writeJson(response, 200, {
      identity,
      risks,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalRiskCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalRisksService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalRiskUpsertPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const risk = runtime.getPrincipalRisksService().createRisk({
      principalId: identity.principalId,
      type: payload.risk.type,
      title: payload.risk.title,
      severity: payload.risk.severity,
      status: payload.risk.status,
      ...(payload.risk.ownerPrincipalId ? { ownerPrincipalId: payload.risk.ownerPrincipalId } : {}),
      ...(payload.risk.summary ? { summary: payload.risk.summary } : {}),
      ...(payload.risk.detectedAt ? { detectedAt: payload.risk.detectedAt } : {}),
      ...(payload.risk.relatedAssetIds ? { relatedAssetIds: payload.risk.relatedAssetIds } : {}),
      ...(payload.risk.linkedDecisionIds ? { linkedDecisionIds: payload.risk.linkedDecisionIds } : {}),
      ...(payload.risk.relatedWorkItemIds ? { relatedWorkItemIds: payload.risk.relatedWorkItemIds } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      risk,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalRiskUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalRisksService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalRiskUpdatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const risk = runtime.getPrincipalRisksService().updateRisk({
      principalId: identity.principalId,
      riskId: payload.risk.riskId,
      type: payload.risk.type,
      title: payload.risk.title,
      severity: payload.risk.severity,
      status: payload.risk.status,
      ownerPrincipalId: payload.risk.ownerPrincipalId ?? "",
      summary: payload.risk.summary ?? "",
      detectedAt: payload.risk.detectedAt ?? "",
      ...(payload.risk.relatedAssetIds ? { relatedAssetIds: payload.risk.relatedAssetIds } : {}),
      ...(payload.risk.linkedDecisionIds ? { linkedDecisionIds: payload.risk.linkedDecisionIds } : {}),
      ...(payload.risk.relatedWorkItemIds ? { relatedWorkItemIds: payload.risk.relatedWorkItemIds } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      risk,
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

function normalizePrincipalRiskListPayload(value: unknown): PrincipalRiskListPayload {
  if (!isRecord(value)) {
    throw new Error("风险列表请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const status = normalizeRiskStatus(value.status);
  const type = normalizeRiskType(value.type);
  const severity = normalizeRiskSeverity(value.severity);
  const query = normalizeText(value.query);
  const limit = typeof value.limit === "number" && Number.isFinite(value.limit) ? Math.floor(value.limit) : undefined;

  return {
    ...identity,
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(severity ? { severity } : {}),
    ...(query ? { query } : {}),
    ...(value.includeArchived === true ? { includeArchived: true } : {}),
    ...(typeof limit === "number" && limit > 0 ? { limit } : {}),
  };
}

function normalizePrincipalRiskUpsertPayload(value: unknown): PrincipalRiskUpsertPayload {
  if (!isRecord(value)) {
    throw new Error("风险请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);

  if (!isRecord(value.risk)) {
    throw new Error("风险请求缺少 risk。");
  }

  const riskId = normalizeText(value.risk.riskId);
  const type = normalizeRequiredRiskType(value.risk.type);
  const title = normalizeRequiredText(value.risk.title, "风险标题不能为空。");
  const severity = normalizeRequiredRiskSeverity(value.risk.severity);
  const status = normalizeRequiredRiskStatus(value.risk.status);
  const ownerPrincipalId = normalizeText(value.risk.ownerPrincipalId);
  const summary = typeof value.risk.summary === "string" ? value.risk.summary.trim() : "";
  const detectedAt = normalizeText(value.risk.detectedAt);
  const relatedAssetIds = normalizePrincipalRiskRelatedIds(value.risk.relatedAssetIds);
  const linkedDecisionIds = normalizePrincipalRiskRelatedIds(value.risk.linkedDecisionIds);
  const relatedWorkItemIds = normalizePrincipalRiskRelatedIds(value.risk.relatedWorkItemIds);

  return {
    ...identity,
    risk: {
      ...(riskId ? { riskId } : {}),
      type,
      title,
      severity,
      status,
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      summary,
      ...(detectedAt ? { detectedAt } : {}),
      relatedAssetIds,
      linkedDecisionIds,
      relatedWorkItemIds,
    },
  };
}

function normalizePrincipalRiskUpdatePayload(value: unknown): PrincipalRiskUpdatePayload {
  const payload = normalizePrincipalRiskUpsertPayload(value);

  if (!payload.risk.riskId) {
    throw new Error("风险更新请求缺少 riskId。");
  }

  return payload as PrincipalRiskUpdatePayload;
}

function normalizeRequiredText(value: unknown, message: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeRequiredRiskType(value: unknown): StoredPrincipalRiskRecord["type"] {
  const normalized = normalizeRiskType(value);

  if (!normalized) {
    throw new Error("风险 type 不合法。");
  }

  return normalized;
}

function normalizeRequiredRiskSeverity(value: unknown): StoredPrincipalRiskRecord["severity"] {
  const normalized = normalizeRiskSeverity(value);

  if (!normalized) {
    throw new Error("风险 severity 不合法。");
  }

  return normalized;
}

function normalizeRequiredRiskStatus(value: unknown): StoredPrincipalRiskRecord["status"] {
  const normalized = normalizeRiskStatus(value);

  if (!normalized) {
    throw new Error("风险 status 不合法。");
  }

  return normalized;
}

function normalizeRiskType(value: unknown): StoredPrincipalRiskRecord["type"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  if (!PRINCIPAL_RISK_TYPES.includes(normalized as StoredPrincipalRiskRecord["type"])) {
    throw new Error("风险 type 不合法。");
  }

  return normalized as StoredPrincipalRiskRecord["type"];
}

function normalizeRiskSeverity(value: unknown): StoredPrincipalRiskRecord["severity"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  if (!PRINCIPAL_RISK_SEVERITIES.includes(normalized as StoredPrincipalRiskRecord["severity"])) {
    throw new Error("风险 severity 不合法。");
  }

  return normalized as StoredPrincipalRiskRecord["severity"];
}

function normalizeRiskStatus(value: unknown): StoredPrincipalRiskRecord["status"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  if (!PRINCIPAL_RISK_STATUSES.includes(normalized as StoredPrincipalRiskRecord["status"])) {
    throw new Error("风险 status 不合法。");
  }

  return normalized as StoredPrincipalRiskRecord["status"];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
