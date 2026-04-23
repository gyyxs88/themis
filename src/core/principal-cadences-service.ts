import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import type {
  PrincipalCadenceFrequency,
  PrincipalCadenceStatus,
  StoredPrincipalCadenceRecord,
} from "../types/index.js";
import {
  PRINCIPAL_CADENCE_FREQUENCIES,
  PRINCIPAL_CADENCE_STATUSES,
  normalizePrincipalCadenceRelatedIds,
} from "../types/index.js";

export interface PrincipalCadencesServiceOptions {
  registry: SqliteCodexSessionRegistry;
  operationEdgesService?: PrincipalOperationEdgesService;
}

export interface CreatePrincipalCadenceInput {
  principalId: string;
  title: string;
  frequency?: PrincipalCadenceFrequency;
  status?: PrincipalCadenceStatus;
  nextRunAt?: string;
  ownerPrincipalId?: string;
  playbookRef?: string;
  summary?: string;
  relatedAssetIds?: string[];
  cadenceId?: string;
  now?: string;
}

export interface UpdatePrincipalCadenceInput {
  principalId: string;
  cadenceId: string;
  title: string;
  frequency: PrincipalCadenceFrequency;
  status: PrincipalCadenceStatus;
  nextRunAt?: string;
  ownerPrincipalId?: string;
  playbookRef?: string;
  summary?: string;
  relatedAssetIds?: string[];
  now?: string;
}

export interface ListPrincipalCadencesInput {
  principalId: string;
  status?: StoredPrincipalCadenceRecord["status"];
  frequency?: StoredPrincipalCadenceRecord["frequency"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export class PrincipalCadencesService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly operationEdgesService: PrincipalOperationEdgesService | undefined;

  constructor(options: PrincipalCadencesServiceOptions) {
    this.registry = options.registry;
    this.operationEdgesService = options.operationEdgesService;
  }

  createCadence(input: CreatePrincipalCadenceInput): StoredPrincipalCadenceRecord {
    const now = normalizeNow(input.now);
    const ownerPrincipalId = normalizeOptionalText(input.ownerPrincipalId);
    const playbookRef = normalizeOptionalText(input.playbookRef);
    const summary = normalizeOptionalText(input.summary);
    const record: StoredPrincipalCadenceRecord = {
      cadenceId: normalizeOptionalText(input.cadenceId) ?? createId("cadence-ledger"),
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      title: normalizeRequiredText(input.title, "Cadence title is required."),
      frequency: normalizeCadenceFrequency(input.frequency ?? "weekly"),
      status: normalizeCadenceStatus(input.status ?? "active"),
      nextRunAt: normalizeTimestamp(input.nextRunAt, now),
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      ...(playbookRef ? { playbookRef } : {}),
      ...(summary ? { summary } : {}),
      relatedAssetIds: normalizeRelatedIds(input.relatedAssetIds),
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipalCadence(record);
    this.syncGeneratedEdges(record, now);
    return record;
  }

  updateCadence(input: UpdatePrincipalCadenceInput): StoredPrincipalCadenceRecord {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const cadenceId = normalizeRequiredText(input.cadenceId, "Cadence id is required.");
    const existing = this.registry.getPrincipalCadence(principalId, cadenceId);

    if (!existing) {
      throw new Error("Principal cadence does not exist.");
    }

    const updated: StoredPrincipalCadenceRecord = {
      ...existing,
      title: normalizeRequiredText(input.title, "Cadence title is required."),
      frequency: normalizeCadenceFrequency(input.frequency),
      status: normalizeCadenceStatus(input.status),
      nextRunAt: normalizeTimestamp(input.nextRunAt, existing.nextRunAt),
      relatedAssetIds: normalizeRelatedIds(input.relatedAssetIds),
      updatedAt: normalizeNow(input.now),
    };

    const ownerPrincipalId = normalizeOptionalText(input.ownerPrincipalId);
    const playbookRef = normalizeOptionalText(input.playbookRef);
    const summary = normalizeOptionalText(input.summary);

    if (ownerPrincipalId) {
      updated.ownerPrincipalId = ownerPrincipalId;
    } else {
      delete updated.ownerPrincipalId;
    }

    if (playbookRef) {
      updated.playbookRef = playbookRef;
    } else {
      delete updated.playbookRef;
    }

    if (summary) {
      updated.summary = summary;
    } else {
      delete updated.summary;
    }

    this.registry.savePrincipalCadence(updated);
    this.syncGeneratedEdges(updated, updated.updatedAt);
    return updated;
  }

  getCadence(principalId: string, cadenceId: string): StoredPrincipalCadenceRecord | null {
    return this.registry.getPrincipalCadence(
      normalizeRequiredText(principalId, "Principal id is required."),
      normalizeRequiredText(cadenceId, "Cadence id is required."),
    );
  }

  listCadences(input: ListPrincipalCadencesInput): StoredPrincipalCadenceRecord[] {
    const status = normalizeOptionalText(input.status);
    const frequency = normalizeOptionalText(input.frequency);
    const query = normalizeOptionalText(input.query);

    return this.registry.listPrincipalCadences({
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      ...(status ? { status: normalizeCadenceStatus(status) } : {}),
      ...(frequency ? { frequency: normalizeCadenceFrequency(frequency) } : {}),
      ...(query ? { query } : {}),
      ...(input.includeArchived === true ? { includeArchived: true } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
  }

  private syncGeneratedEdges(record: StoredPrincipalCadenceRecord, now: string): void {
    if (!this.operationEdgesService) {
      return;
    }

    this.operationEdgesService.syncGeneratedEdgesForObject({
      principalId: record.principalId,
      sourceObjectType: "cadence",
      sourceObjectId: record.cadenceId,
      edges: record.status === "archived"
        ? []
        : record.relatedAssetIds.map((assetId) => ({
          fromObjectType: "cadence" as const,
          fromObjectId: record.cadenceId,
          toObjectType: "asset" as const,
          toObjectId: assetId,
          relationType: "tracks" as const,
          label: "节奏跟踪资产",
          summary: `节奏「${record.title}」跟踪资产 ${assetId}。`,
        })),
      now,
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

function normalizeRelatedIds(value?: string[]): string[] {
  return normalizePrincipalCadenceRelatedIds(value);
}

function normalizeCadenceFrequency(value: string): StoredPrincipalCadenceRecord["frequency"] {
  const normalized = value.trim();

  if (!PRINCIPAL_CADENCE_FREQUENCIES.includes(normalized as StoredPrincipalCadenceRecord["frequency"])) {
    throw new Error("Cadence frequency is invalid.");
  }

  return normalized as StoredPrincipalCadenceRecord["frequency"];
}

function normalizeCadenceStatus(value: string): StoredPrincipalCadenceRecord["status"] {
  const normalized = value.trim();

  if (!PRINCIPAL_CADENCE_STATUSES.includes(normalized as StoredPrincipalCadenceRecord["status"])) {
    throw new Error("Cadence status is invalid.");
  }

  return normalized as StoredPrincipalCadenceRecord["status"];
}

function normalizeTimestamp(value: string | undefined, fallback: string): string {
  return normalizeOptionalText(value) ?? fallback;
}

function normalizeNow(now?: string): string {
  return normalizeOptionalText(now) ?? new Date().toISOString();
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
