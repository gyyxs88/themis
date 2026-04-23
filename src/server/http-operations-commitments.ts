import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type {
  PrincipalCommitmentEvidenceRef,
  PrincipalCommitmentMilestone,
  StoredPrincipalCommitmentRecord,
} from "../types/index.js";
import {
  PRINCIPAL_COMMITMENT_STATUSES,
  normalizePrincipalCommitmentEvidenceRefs,
  normalizePrincipalCommitmentMilestones,
  normalizePrincipalCommitmentProgressPercent,
  normalizePrincipalCommitmentRelatedIds,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface PrincipalCommitmentListPayload extends IdentityPayload {
  status?: StoredPrincipalCommitmentRecord["status"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface PrincipalCommitmentUpsertPayload extends IdentityPayload {
  commitment: {
    commitmentId?: string;
    title: string;
    status: StoredPrincipalCommitmentRecord["status"];
    ownerPrincipalId?: string;
    startsAt?: string;
    dueAt?: string;
    progressPercent: number;
    summary?: string;
    milestones: PrincipalCommitmentMilestone[];
    evidenceRefs: PrincipalCommitmentEvidenceRef[];
    relatedAssetIds?: string[];
    linkedDecisionIds?: string[];
    linkedRiskIds?: string[];
    relatedCadenceIds?: string[];
    relatedWorkItemIds?: string[];
  };
}

interface PrincipalCommitmentUpdatePayload extends IdentityPayload {
  commitment: PrincipalCommitmentUpsertPayload["commitment"] & {
    commitmentId: string;
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

export async function handlePrincipalCommitmentList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalCommitmentsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalCommitmentListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const commitments = runtime.getPrincipalCommitmentsService().listCommitments({
      principalId: identity.principalId,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.includeArchived ? { includeArchived: true } : {}),
      ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
    });

    writeJson(response, 200, {
      identity,
      commitments,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalCommitmentCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalCommitmentsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalCommitmentUpsertPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const commitment = runtime.getPrincipalCommitmentsService().createCommitment({
      principalId: identity.principalId,
      title: payload.commitment.title,
      status: payload.commitment.status,
      ...(payload.commitment.ownerPrincipalId ? { ownerPrincipalId: payload.commitment.ownerPrincipalId } : {}),
      ...(payload.commitment.startsAt ? { startsAt: payload.commitment.startsAt } : {}),
      ...(payload.commitment.dueAt ? { dueAt: payload.commitment.dueAt } : {}),
      progressPercent: payload.commitment.progressPercent,
      ...(payload.commitment.summary ? { summary: payload.commitment.summary } : {}),
      milestones: payload.commitment.milestones,
      evidenceRefs: payload.commitment.evidenceRefs,
      ...(payload.commitment.relatedAssetIds ? { relatedAssetIds: payload.commitment.relatedAssetIds } : {}),
      ...(payload.commitment.linkedDecisionIds ? { linkedDecisionIds: payload.commitment.linkedDecisionIds } : {}),
      ...(payload.commitment.linkedRiskIds ? { linkedRiskIds: payload.commitment.linkedRiskIds } : {}),
      ...(payload.commitment.relatedCadenceIds ? { relatedCadenceIds: payload.commitment.relatedCadenceIds } : {}),
      ...(payload.commitment.relatedWorkItemIds ? { relatedWorkItemIds: payload.commitment.relatedWorkItemIds } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      commitment,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalCommitmentUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalCommitmentsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalCommitmentUpdatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const commitment = runtime.getPrincipalCommitmentsService().updateCommitment({
      principalId: identity.principalId,
      commitmentId: payload.commitment.commitmentId,
      title: payload.commitment.title,
      status: payload.commitment.status,
      ownerPrincipalId: payload.commitment.ownerPrincipalId ?? "",
      startsAt: payload.commitment.startsAt ?? "",
      dueAt: payload.commitment.dueAt ?? "",
      progressPercent: payload.commitment.progressPercent,
      summary: payload.commitment.summary ?? "",
      milestones: payload.commitment.milestones,
      evidenceRefs: payload.commitment.evidenceRefs,
      ...(payload.commitment.relatedAssetIds ? { relatedAssetIds: payload.commitment.relatedAssetIds } : {}),
      ...(payload.commitment.linkedDecisionIds ? { linkedDecisionIds: payload.commitment.linkedDecisionIds } : {}),
      ...(payload.commitment.linkedRiskIds ? { linkedRiskIds: payload.commitment.linkedRiskIds } : {}),
      ...(payload.commitment.relatedCadenceIds ? { relatedCadenceIds: payload.commitment.relatedCadenceIds } : {}),
      ...(payload.commitment.relatedWorkItemIds ? { relatedWorkItemIds: payload.commitment.relatedWorkItemIds } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      commitment,
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

function normalizePrincipalCommitmentListPayload(value: unknown): PrincipalCommitmentListPayload {
  if (!isRecord(value)) {
    throw new Error("承诺列表请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const status = normalizeCommitmentStatus(value.status);
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

function normalizePrincipalCommitmentUpsertPayload(value: unknown): PrincipalCommitmentUpsertPayload {
  if (!isRecord(value)) {
    throw new Error("承诺请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);

  if (!isRecord(value.commitment)) {
    throw new Error("承诺请求缺少 commitment。");
  }

  const commitmentId = normalizeText(value.commitment.commitmentId);
  const title = normalizeRequiredText(value.commitment.title, "承诺标题不能为空。");
  const status = normalizeRequiredCommitmentStatus(value.commitment.status);
  const ownerPrincipalId = normalizeText(value.commitment.ownerPrincipalId);
  const startsAt = normalizeText(value.commitment.startsAt);
  const dueAt = normalizeText(value.commitment.dueAt);
  const progressPercent = normalizePrincipalCommitmentProgressPercent(value.commitment.progressPercent);
  const summary = typeof value.commitment.summary === "string" ? value.commitment.summary.trim() : "";
  const milestones = normalizePrincipalCommitmentMilestones(value.commitment.milestones);
  const evidenceRefs = normalizePrincipalCommitmentEvidenceRefs(value.commitment.evidenceRefs);
  const relatedAssetIds = normalizePrincipalCommitmentRelatedIds(value.commitment.relatedAssetIds);
  const linkedDecisionIds = normalizePrincipalCommitmentRelatedIds(value.commitment.linkedDecisionIds);
  const linkedRiskIds = normalizePrincipalCommitmentRelatedIds(value.commitment.linkedRiskIds);
  const relatedCadenceIds = normalizePrincipalCommitmentRelatedIds(value.commitment.relatedCadenceIds);
  const relatedWorkItemIds = normalizePrincipalCommitmentRelatedIds(value.commitment.relatedWorkItemIds);

  return {
    ...identity,
    commitment: {
      ...(commitmentId ? { commitmentId } : {}),
      title,
      status,
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      ...(startsAt ? { startsAt } : {}),
      ...(dueAt ? { dueAt } : {}),
      progressPercent,
      summary,
      milestones,
      evidenceRefs,
      relatedAssetIds,
      linkedDecisionIds,
      linkedRiskIds,
      relatedCadenceIds,
      relatedWorkItemIds,
    },
  };
}

function normalizePrincipalCommitmentUpdatePayload(value: unknown): PrincipalCommitmentUpdatePayload {
  const payload = normalizePrincipalCommitmentUpsertPayload(value);

  if (!payload.commitment.commitmentId) {
    throw new Error("承诺更新请求缺少 commitmentId。");
  }

  return payload as PrincipalCommitmentUpdatePayload;
}

function normalizeRequiredText(value: unknown, message: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeRequiredCommitmentStatus(value: unknown): StoredPrincipalCommitmentRecord["status"] {
  const normalized = normalizeCommitmentStatus(value);

  if (!normalized) {
    throw new Error("承诺 status 不合法。");
  }

  return normalized;
}

function normalizeCommitmentStatus(value: unknown): StoredPrincipalCommitmentRecord["status"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  if (!PRINCIPAL_COMMITMENT_STATUSES.includes(normalized as StoredPrincipalCommitmentRecord["status"])) {
    throw new Error("承诺 status 不合法。");
  }

  return normalized as StoredPrincipalCommitmentRecord["status"];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
