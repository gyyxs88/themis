import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type { PrincipalAssetRef, StoredPrincipalAssetRecord } from "../types/index.js";
import {
  PRINCIPAL_ASSET_KINDS,
  PRINCIPAL_ASSET_STATUSES,
  normalizePrincipalAssetRefs,
  normalizePrincipalAssetTags,
} from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

interface IdentityPayload {
  channel: string;
  channelUserId: string;
  displayName?: string;
}

interface PrincipalAssetListPayload extends IdentityPayload {
  status?: StoredPrincipalAssetRecord["status"];
  kind?: StoredPrincipalAssetRecord["kind"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

interface PrincipalAssetUpsertPayload extends IdentityPayload {
  asset: {
    assetId?: string;
    kind: StoredPrincipalAssetRecord["kind"];
    name: string;
    status: StoredPrincipalAssetRecord["status"];
    ownerPrincipalId?: string;
    summary?: string;
    tags?: string[];
    refs?: PrincipalAssetRef[];
  };
}

interface PrincipalAssetUpdatePayload extends IdentityPayload {
  asset: PrincipalAssetUpsertPayload["asset"] & {
    assetId: string;
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

export async function handlePrincipalAssetList(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalAssetsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalAssetListPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const assets = runtime.getPrincipalAssetsService().listAssets({
      principalId: identity.principalId,
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.kind ? { kind: payload.kind } : {}),
      ...(payload.query ? { query: payload.query } : {}),
      ...(payload.includeArchived ? { includeArchived: true } : {}),
      ...(typeof payload.limit === "number" ? { limit: payload.limit } : {}),
    });

    writeJson(response, 200, {
      identity,
      assets,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalAssetCreate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalAssetsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalAssetUpsertPayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const asset = runtime.getPrincipalAssetsService().createAsset({
      principalId: identity.principalId,
      kind: payload.asset.kind,
      name: payload.asset.name,
      status: payload.asset.status,
      ...(payload.asset.ownerPrincipalId ? { ownerPrincipalId: payload.asset.ownerPrincipalId } : {}),
      ...(payload.asset.summary ? { summary: payload.asset.summary } : {}),
      ...(payload.asset.tags ? { tags: payload.asset.tags } : {}),
      ...(payload.asset.refs ? { refs: payload.asset.refs } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      asset,
    });
  } catch (error) {
    writeRuntimeError(response, error);
  }
}

export async function handlePrincipalAssetUpdate(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Pick<RuntimeServiceHost, "getIdentityLinkService" | "getPrincipalAssetsService">,
): Promise<void> {
  const payload = await readAndNormalizePayload(request, response, normalizePrincipalAssetUpdatePayload);

  if (!payload) {
    return;
  }

  try {
    const identity = runtime.getIdentityLinkService().ensureIdentity(payload);
    const asset = runtime.getPrincipalAssetsService().updateAsset({
      principalId: identity.principalId,
      assetId: payload.asset.assetId,
      kind: payload.asset.kind,
      name: payload.asset.name,
      status: payload.asset.status,
      ownerPrincipalId: payload.asset.ownerPrincipalId ?? "",
      summary: payload.asset.summary ?? "",
      ...(payload.asset.tags ? { tags: payload.asset.tags } : {}),
      ...(payload.asset.refs ? { refs: payload.asset.refs } : {}),
    });

    writeJson(response, 200, {
      ok: true,
      identity,
      asset,
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

function normalizePrincipalAssetListPayload(value: unknown): PrincipalAssetListPayload {
  if (!isRecord(value)) {
    throw new Error("资产列表请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);
  const status = normalizeAssetStatus(value.status);
  const kind = normalizeAssetKind(value.kind);
  const query = normalizeText(value.query);
  const limit = typeof value.limit === "number" && Number.isFinite(value.limit) ? Math.floor(value.limit) : undefined;

  return {
    ...identity,
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(query ? { query } : {}),
    ...(value.includeArchived === true ? { includeArchived: true } : {}),
    ...(typeof limit === "number" && limit > 0 ? { limit } : {}),
  };
}

function normalizePrincipalAssetUpsertPayload(value: unknown): PrincipalAssetUpsertPayload {
  if (!isRecord(value)) {
    throw new Error("资产请求缺少必要字段。");
  }

  const identity = normalizeIdentityPayload(value);

  if (!isRecord(value.asset)) {
    throw new Error("资产请求缺少 asset。");
  }

  const assetId = normalizeText(value.asset.assetId);
  const kind = normalizeRequiredAssetKind(value.asset.kind);
  const name = normalizeRequiredText(value.asset.name, "资产名称不能为空。");
  const status = normalizeRequiredAssetStatus(value.asset.status);
  const ownerPrincipalId = normalizeText(value.asset.ownerPrincipalId);
  const summary = typeof value.asset.summary === "string" ? value.asset.summary.trim() : "";
  const tags = normalizePrincipalAssetTags(value.asset.tags);
  const refs = normalizePrincipalAssetRefs(value.asset.refs);

  return {
    ...identity,
    asset: {
      ...(assetId ? { assetId } : {}),
      kind,
      name,
      status,
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      summary,
      tags,
      refs,
    },
  };
}

function normalizePrincipalAssetUpdatePayload(value: unknown): PrincipalAssetUpdatePayload {
  const payload = normalizePrincipalAssetUpsertPayload(value);

  if (!payload.asset.assetId) {
    throw new Error("资产更新请求缺少 assetId。");
  }

  return payload as PrincipalAssetUpdatePayload;
}

function normalizeRequiredText(value: unknown, message: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeRequiredAssetKind(value: unknown): StoredPrincipalAssetRecord["kind"] {
  const normalized = normalizeAssetKind(value);

  if (!normalized) {
    throw new Error("资产 kind 不合法。");
  }

  return normalized;
}

function normalizeRequiredAssetStatus(value: unknown): StoredPrincipalAssetRecord["status"] {
  const normalized = normalizeAssetStatus(value);

  if (!normalized) {
    throw new Error("资产 status 不合法。");
  }

  return normalized;
}

function normalizeAssetKind(value: unknown): StoredPrincipalAssetRecord["kind"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized || !PRINCIPAL_ASSET_KINDS.includes(normalized as StoredPrincipalAssetRecord["kind"])) {
    return undefined;
  }

  return normalized as StoredPrincipalAssetRecord["kind"];
}

function normalizeAssetStatus(value: unknown): StoredPrincipalAssetRecord["status"] | undefined {
  const normalized = normalizeText(value);

  if (!normalized || !PRINCIPAL_ASSET_STATUSES.includes(normalized as StoredPrincipalAssetRecord["status"])) {
    return undefined;
  }

  return normalized as StoredPrincipalAssetRecord["status"];
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value.trim();
  return text ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
