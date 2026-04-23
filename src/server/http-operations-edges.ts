import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type { StoredPrincipalOperationEdgeRecord } from "../types/index.js";
import {
  PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES,
  PRINCIPAL_OPERATION_EDGE_RELATION_TYPES,
  PRINCIPAL_OPERATION_EDGE_STATUSES,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface PrincipalOperationEdgeListPayload extends IdentityPayload {
  fromObjectType?: StoredPrincipalOperationEdgeRecord["fromObjectType"];
  fromObjectId?: string;
  toObjectType?: StoredPrincipalOperationEdgeRecord["toObjectType"];
  toObjectId?: string;
  relationType?: StoredPrincipalOperationEdgeRecord["relationType"];
  status?: StoredPrincipalOperationEdgeRecord["status"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface PrincipalOperationGraphQueryPayload extends IdentityPayload {
  rootObjectType: StoredPrincipalOperationEdgeRecord["fromObjectType"];
  rootObjectId: string;
  targetObjectType?: StoredPrincipalOperationEdgeRecord["fromObjectType"];
  targetObjectId?: string;
  maxDepth?: number;
  relationTypes?: StoredPrincipalOperationEdgeRecord["relationType"][];
  includeArchived?: boolean;
  limit?: number;
}

interface PrincipalOperationEdgeUpsertPayload extends IdentityPayload {
  edge: {
    edgeId?: string;
    fromObjectType: StoredPrincipalOperationEdgeRecord["fromObjectType"];
    fromObjectId: string;
    toObjectType: StoredPrincipalOperationEdgeRecord["toObjectType"];
    toObjectId: string;
    relationType: StoredPrincipalOperationEdgeRecord["relationType"];
    status: StoredPrincipalOperationEdgeRecord["status"];
    label?: string;
    summary?: string;
  };
}

interface PrincipalOperationEdgeUpdatePayload extends IdentityPayload {
  edge: PrincipalOperationEdgeUpsertPayload["edge"] & {
    edgeId: string;
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

export async function handlePrincipalOperationEdgeList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalOperationEdgesService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalOperationEdgeListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const edges = runtime.getPrincipalOperationEdgesService().listEdges({
      principalId: identity.principalId,
      ...(payload.fromObjectType ? { fromObjectType: payload.fromObjectType } : {}),
      ...(payload.fromObjectId ? { fromObjectId: payload.fromObjectId } : {}),
      ...(payload.toObjectType ? { toObjectType: payload.toObjectType } : {}),
      ...(payload.toObjectId ? { toObjectId: payload.toObjectId } : {}),
      ...(payload.relationType ? { relationType: payload.relationType } : {}),
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.includeArchived ? { includeArchived: true } : {}),
      ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
    });

    writeJson(response, 200, {
      identity,
      edges,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalOperationGraphQuery(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalOperationEdgesService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalOperationGraphQueryPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const graph = runtime.getPrincipalOperationEdgesService().queryGraph({
      principalId: identity.principalId,
      rootObjectType: payload.rootObjectType,
      rootObjectId: payload.rootObjectId,
      ...(payload.targetObjectType ? { targetObjectType: payload.targetObjectType } : {}),
      ...(payload.targetObjectId ? { targetObjectId: payload.targetObjectId } : {}),
      ...(typeof payload.maxDepth === "number" ? { maxDepth: payload.maxDepth } : {}),
      ...(payload.relationTypes ? { relationTypes: payload.relationTypes } : {}),
      ...(payload.includeArchived ? { includeArchived: true } : {}),
      ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
    });

    writeJson(response, 200, {
      identity,
      graph,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalOperationEdgeCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalOperationEdgesService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalOperationEdgeUpsertPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const edge = runtime.getPrincipalOperationEdgesService().createEdge({
      principalId: identity.principalId,
      fromObjectType: payload.edge.fromObjectType,
      fromObjectId: payload.edge.fromObjectId,
      toObjectType: payload.edge.toObjectType,
      toObjectId: payload.edge.toObjectId,
      relationType: payload.edge.relationType,
      status: payload.edge.status,
      ...(payload.edge.label ? { label: payload.edge.label } : {}),
      ...(payload.edge.summary ? { summary: payload.edge.summary } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      edge,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalOperationEdgeUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalOperationEdgesService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalOperationEdgeUpdatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const edge = runtime.getPrincipalOperationEdgesService().updateEdge({
      principalId: identity.principalId,
      edgeId: payload.edge.edgeId,
      fromObjectType: payload.edge.fromObjectType,
      fromObjectId: payload.edge.fromObjectId,
      toObjectType: payload.edge.toObjectType,
      toObjectId: payload.edge.toObjectId,
      relationType: payload.edge.relationType,
      status: payload.edge.status,
      label: payload.edge.label ?? "",
      summary: payload.edge.summary ?? "",
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      edge,
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

function normalizePrincipalOperationEdgeListPayload(value: unknown): PrincipalOperationEdgeListPayload {
  if (!isRecord(value)) {
    throw new Error("关系边列表请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const fromObjectType = normalizeObjectType(value.fromObjectType);
  const fromObjectId = normalizeText(value.fromObjectId);
  const toObjectType = normalizeObjectType(value.toObjectType);
  const toObjectId = normalizeText(value.toObjectId);
  const relationType = normalizeRelationType(value.relationType);
  const status = normalizeStatus(value.status);
  const query = normalizeText(value.query);
  const limit = typeof value.limit === "number" && Number.isFinite(value.limit) ? Math.floor(value.limit) : undefined;

  return {
    ...identity,
    ...(fromObjectType ? { fromObjectType } : {}),
    ...(fromObjectId ? { fromObjectId } : {}),
    ...(toObjectType ? { toObjectType } : {}),
    ...(toObjectId ? { toObjectId } : {}),
    ...(relationType ? { relationType } : {}),
    ...(status ? { status } : {}),
    ...(query ? { query } : {}),
    ...(value.includeArchived === true ? { includeArchived: true } : {}),
    ...(typeof limit === "number" && limit > 0 ? { limit } : {}),
  };
}

function normalizePrincipalOperationGraphQueryPayload(value: unknown): PrincipalOperationGraphQueryPayload {
  if (!isRecord(value)) {
    throw new Error("图查询请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const rootObjectType = normalizeRequiredObjectType(value.rootObjectType);
  const rootObjectId = normalizeRequiredText(value.rootObjectId, "图查询根对象 id 不能为空。");
  const targetObjectType = normalizeObjectType(value.targetObjectType);
  const targetObjectId = normalizeText(value.targetObjectId);
  const maxDepth = typeof value.maxDepth === "number" && Number.isFinite(value.maxDepth)
    ? Math.floor(value.maxDepth)
    : undefined;
  const limit = typeof value.limit === "number" && Number.isFinite(value.limit) ? Math.floor(value.limit) : undefined;
  const relationTypes = normalizeRelationTypes(value.relationTypes);

  return {
    ...identity,
    rootObjectType,
    rootObjectId,
    ...(targetObjectType ? { targetObjectType } : {}),
    ...(targetObjectId ? { targetObjectId } : {}),
    ...(typeof maxDepth === "number" && maxDepth > 0 ? { maxDepth } : {}),
    ...(relationTypes.length > 0 ? { relationTypes } : {}),
    ...(value.includeArchived === true ? { includeArchived: true } : {}),
    ...(typeof limit === "number" && limit > 0 ? { limit } : {}),
  };
}

function normalizePrincipalOperationEdgeUpsertPayload(value: unknown): PrincipalOperationEdgeUpsertPayload {
  if (!isRecord(value)) {
    throw new Error("关系边请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);

  if (!isRecord(value.edge)) {
    throw new Error("关系边请求缺少 edge。");
  }

  const edgeId = normalizeText(value.edge.edgeId);
  const fromObjectType = normalizeRequiredObjectType(value.edge.fromObjectType);
  const fromObjectId = normalizeRequiredText(value.edge.fromObjectId, "关系边起点 id 不能为空。");
  const toObjectType = normalizeRequiredObjectType(value.edge.toObjectType);
  const toObjectId = normalizeRequiredText(value.edge.toObjectId, "关系边终点 id 不能为空。");
  const relationType = normalizeRequiredRelationType(value.edge.relationType);
  const status = normalizeRequiredStatus(value.edge.status);
  const label = normalizeText(value.edge.label);
  const summary = typeof value.edge.summary === "string" ? value.edge.summary.trim() : "";

  return {
    ...identity,
    edge: {
      ...(edgeId ? { edgeId } : {}),
      fromObjectType,
      fromObjectId,
      toObjectType,
      toObjectId,
      relationType,
      status,
      ...(label ? { label } : {}),
      summary,
    },
  };
}

function normalizePrincipalOperationEdgeUpdatePayload(value: unknown): PrincipalOperationEdgeUpdatePayload {
  const payload = normalizePrincipalOperationEdgeUpsertPayload(value);

  if (!payload.edge.edgeId) {
    throw new Error("关系边更新请求缺少 edgeId。");
  }

  return {
    ...payload,
    edge: {
      ...payload.edge,
      edgeId: payload.edge.edgeId,
    },
  };
}

function normalizeRequiredObjectType(value: unknown): StoredPrincipalOperationEdgeRecord["fromObjectType"] {
  const normalized = normalizeObjectType(value);

  if (!normalized) {
    throw new Error("关系边对象类型不合法。");
  }

  return normalized;
}

function normalizeRequiredRelationType(value: unknown): StoredPrincipalOperationEdgeRecord["relationType"] {
  const normalized = normalizeRelationType(value);

  if (!normalized) {
    throw new Error("关系边类型不合法。");
  }

  return normalized;
}

function normalizeRequiredStatus(value: unknown): StoredPrincipalOperationEdgeRecord["status"] {
  const normalized = normalizeStatus(value);

  if (!normalized) {
    throw new Error("关系边状态不合法。");
  }

  return normalized;
}

function normalizeObjectType(value: unknown): StoredPrincipalOperationEdgeRecord["fromObjectType"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  return PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES.includes(
    normalized as StoredPrincipalOperationEdgeRecord["fromObjectType"],
  )
    ? normalized as StoredPrincipalOperationEdgeRecord["fromObjectType"]
    : undefined;
}

function normalizeRelationType(value: unknown): StoredPrincipalOperationEdgeRecord["relationType"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  return PRINCIPAL_OPERATION_EDGE_RELATION_TYPES.includes(
    normalized as StoredPrincipalOperationEdgeRecord["relationType"],
  )
    ? normalized as StoredPrincipalOperationEdgeRecord["relationType"]
    : undefined;
}

function normalizeRelationTypes(value: unknown): StoredPrincipalOperationEdgeRecord["relationType"][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map(normalizeRelationType)
    .filter((item): item is StoredPrincipalOperationEdgeRecord["relationType"] => Boolean(item)))];
}

function normalizeStatus(value: unknown): StoredPrincipalOperationEdgeRecord["status"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  return PRINCIPAL_OPERATION_EDGE_STATUSES.includes(normalized as StoredPrincipalOperationEdgeRecord["status"])
    ? normalized as StoredPrincipalOperationEdgeRecord["status"]
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
