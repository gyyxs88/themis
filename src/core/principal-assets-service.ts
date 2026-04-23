import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  PrincipalAssetRef,
  PrincipalAssetStatus,
  StoredPrincipalAssetRecord,
} from "../types/index.js";
import {
  PRINCIPAL_ASSET_KINDS,
  PRINCIPAL_ASSET_REF_KINDS,
  PRINCIPAL_ASSET_STATUSES,
} from "../types/index.js";

export interface PrincipalAssetsServiceOptions {
  registry: SqliteCodexSessionRegistry;
}

export interface CreatePrincipalAssetInput {
  principalId: string;
  kind: StoredPrincipalAssetRecord["kind"];
  name: string;
  status?: PrincipalAssetStatus;
  ownerPrincipalId?: string;
  summary?: string;
  tags?: string[];
  refs?: PrincipalAssetRef[];
  assetId?: string;
  now?: string;
}

export interface UpdatePrincipalAssetInput {
  principalId: string;
  assetId: string;
  kind: StoredPrincipalAssetRecord["kind"];
  name: string;
  status: PrincipalAssetStatus;
  ownerPrincipalId?: string;
  summary?: string;
  tags?: string[];
  refs?: PrincipalAssetRef[];
  now?: string;
}

export interface ListPrincipalAssetsInput {
  principalId: string;
  status?: StoredPrincipalAssetRecord["status"];
  kind?: StoredPrincipalAssetRecord["kind"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export class PrincipalAssetsService {
  private readonly registry: SqliteCodexSessionRegistry;

  constructor(options: PrincipalAssetsServiceOptions) {
    this.registry = options.registry;
  }

  createAsset(input: CreatePrincipalAssetInput): StoredPrincipalAssetRecord {
    const now = normalizeNow(input.now);
    const ownerPrincipalId = normalizeOptionalText(input.ownerPrincipalId);
    const summary = normalizeOptionalText(input.summary);
    const record: StoredPrincipalAssetRecord = {
      assetId: normalizeOptionalText(input.assetId) ?? createId("asset-ledger"),
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      kind: normalizeAssetKind(input.kind),
      name: normalizeRequiredText(input.name, "Asset name is required."),
      status: normalizeAssetStatus(input.status ?? "active"),
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      ...(summary ? { summary } : {}),
      tags: normalizeTags(input.tags),
      refs: normalizeRefs(input.refs),
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipalAsset(record);
    return record;
  }

  updateAsset(input: UpdatePrincipalAssetInput): StoredPrincipalAssetRecord {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const assetId = normalizeRequiredText(input.assetId, "Asset id is required.");
    const existing = this.registry.getPrincipalAsset(principalId, assetId);

    if (!existing) {
      throw new Error("Principal asset does not exist.");
    }

    const updated: StoredPrincipalAssetRecord = {
      ...existing,
      kind: normalizeAssetKind(input.kind),
      name: normalizeRequiredText(input.name, "Asset name is required."),
      status: normalizeAssetStatus(input.status),
      tags: normalizeTags(input.tags),
      refs: normalizeRefs(input.refs),
      updatedAt: normalizeNow(input.now),
    };

    const ownerPrincipalId = normalizeOptionalText(input.ownerPrincipalId);
    const summary = normalizeOptionalText(input.summary);

    if (ownerPrincipalId) {
      updated.ownerPrincipalId = ownerPrincipalId;
    } else {
      delete updated.ownerPrincipalId;
    }

    if (summary) {
      updated.summary = summary;
    } else {
      delete updated.summary;
    }

    this.registry.savePrincipalAsset(updated);
    return updated;
  }

  getAsset(principalId: string, assetId: string): StoredPrincipalAssetRecord | null {
    return this.registry.getPrincipalAsset(
      normalizeRequiredText(principalId, "Principal id is required."),
      normalizeRequiredText(assetId, "Asset id is required."),
    );
  }

  listAssets(input: ListPrincipalAssetsInput): StoredPrincipalAssetRecord[] {
    const status = normalizeOptionalText(input.status);
    const kind = normalizeOptionalText(input.kind);
    const query = normalizeOptionalText(input.query);

    return this.registry.listPrincipalAssets({
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      ...(status ? { status: normalizeAssetStatus(status) } : {}),
      ...(kind ? { kind: normalizeAssetKind(kind) } : {}),
      ...(query ? { query } : {}),
      ...(input.includeArchived === true ? { includeArchived: true } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
  }
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeOptionalText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeTags(value?: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function normalizeRefs(value?: PrincipalAssetRef[]): PrincipalAssetRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const refs: PrincipalAssetRef[] = [];

  for (const item of value) {
    const kind = normalizeOptionalText(item?.kind);
    const refValue = normalizeOptionalText(item?.value);
    const label = normalizeOptionalText(item?.label);

    if (!kind || !refValue) {
      continue;
    }

    const normalizedKind = normalizeAssetRefKind(kind);
    const dedupeKey = `${normalizedKind}\u0000${refValue}\u0000${label ?? ""}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    refs.push({
      kind: normalizedKind,
      value: refValue,
      ...(label ? { label } : {}),
    });
  }

  return refs;
}

function normalizeAssetKind(value: string): StoredPrincipalAssetRecord["kind"] {
  const normalized = value.trim();

  if (!PRINCIPAL_ASSET_KINDS.includes(normalized as StoredPrincipalAssetRecord["kind"])) {
    throw new Error("Asset kind is invalid.");
  }

  return normalized as StoredPrincipalAssetRecord["kind"];
}

function normalizeAssetStatus(value: string): StoredPrincipalAssetRecord["status"] {
  const normalized = value.trim();

  if (!PRINCIPAL_ASSET_STATUSES.includes(normalized as StoredPrincipalAssetRecord["status"])) {
    throw new Error("Asset status is invalid.");
  }

  return normalized as StoredPrincipalAssetRecord["status"];
}

function normalizeAssetRefKind(value: string): PrincipalAssetRef["kind"] {
  const normalized = value.trim();

  if (!PRINCIPAL_ASSET_REF_KINDS.includes(normalized as PrincipalAssetRef["kind"])) {
    throw new Error("Asset ref kind is invalid.");
  }

  return normalized as PrincipalAssetRef["kind"];
}

function normalizeNow(now?: string): string {
  return normalizeOptionalText(now) ?? new Date().toISOString();
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
