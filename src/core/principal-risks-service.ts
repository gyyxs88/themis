import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import type {
  PrincipalRiskSeverity,
  PrincipalRiskStatus,
  PrincipalRiskType,
  StoredPrincipalRiskRecord,
} from "../types/index.js";
import {
  PRINCIPAL_RISK_SEVERITIES,
  PRINCIPAL_RISK_STATUSES,
  PRINCIPAL_RISK_TYPES,
  normalizePrincipalRiskRelatedIds,
} from "../types/index.js";

export interface PrincipalRisksServiceOptions {
  registry: SqliteCodexSessionRegistry;
  operationEdgesService?: PrincipalOperationEdgesService;
}

export interface CreatePrincipalRiskInput {
  principalId: string;
  type?: PrincipalRiskType;
  title: string;
  severity?: PrincipalRiskSeverity;
  status?: PrincipalRiskStatus;
  ownerPrincipalId?: string;
  summary?: string;
  detectedAt?: string;
  relatedAssetIds?: string[];
  linkedDecisionIds?: string[];
  relatedWorkItemIds?: string[];
  riskId?: string;
  now?: string;
}

export interface UpdatePrincipalRiskInput {
  principalId: string;
  riskId: string;
  type: PrincipalRiskType;
  title: string;
  severity: PrincipalRiskSeverity;
  status: PrincipalRiskStatus;
  ownerPrincipalId?: string;
  summary?: string;
  detectedAt?: string;
  relatedAssetIds?: string[];
  linkedDecisionIds?: string[];
  relatedWorkItemIds?: string[];
  now?: string;
}

export interface ListPrincipalRisksInput {
  principalId: string;
  status?: StoredPrincipalRiskRecord["status"];
  type?: StoredPrincipalRiskRecord["type"];
  severity?: StoredPrincipalRiskRecord["severity"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export class PrincipalRisksService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly operationEdgesService: PrincipalOperationEdgesService | undefined;

  constructor(options: PrincipalRisksServiceOptions) {
    this.registry = options.registry;
    this.operationEdgesService = options.operationEdgesService;
  }

  createRisk(input: CreatePrincipalRiskInput): StoredPrincipalRiskRecord {
    const now = normalizeNow(input.now);
    const ownerPrincipalId = normalizeOptionalText(input.ownerPrincipalId);
    const summary = normalizeOptionalText(input.summary);
    const record: StoredPrincipalRiskRecord = {
      riskId: normalizeOptionalText(input.riskId) ?? createId("risk-ledger"),
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      type: normalizeRiskType(input.type ?? "risk"),
      title: normalizeRequiredText(input.title, "Risk title is required."),
      severity: normalizeRiskSeverity(input.severity ?? "medium"),
      status: normalizeRiskStatus(input.status ?? "open"),
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      ...(summary ? { summary } : {}),
      detectedAt: normalizeTimestamp(input.detectedAt, now),
      relatedAssetIds: normalizeRelatedIds(input.relatedAssetIds),
      linkedDecisionIds: normalizeRelatedIds(input.linkedDecisionIds),
      relatedWorkItemIds: normalizeRelatedIds(input.relatedWorkItemIds),
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipalRisk(record);
    this.syncGeneratedEdges(record, now);
    return record;
  }

  updateRisk(input: UpdatePrincipalRiskInput): StoredPrincipalRiskRecord {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const riskId = normalizeRequiredText(input.riskId, "Risk id is required.");
    const existing = this.registry.getPrincipalRisk(principalId, riskId);

    if (!existing) {
      throw new Error("Principal risk does not exist.");
    }

    const updated: StoredPrincipalRiskRecord = {
      ...existing,
      type: normalizeRiskType(input.type),
      title: normalizeRequiredText(input.title, "Risk title is required."),
      severity: normalizeRiskSeverity(input.severity),
      status: normalizeRiskStatus(input.status),
      detectedAt: normalizeTimestamp(input.detectedAt, existing.detectedAt),
      relatedAssetIds: normalizeRelatedIds(input.relatedAssetIds),
      linkedDecisionIds: normalizeRelatedIds(input.linkedDecisionIds),
      relatedWorkItemIds: normalizeRelatedIds(input.relatedWorkItemIds),
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

    this.registry.savePrincipalRisk(updated);
    this.syncGeneratedEdges(updated, updated.updatedAt);
    return updated;
  }

  getRisk(principalId: string, riskId: string): StoredPrincipalRiskRecord | null {
    return this.registry.getPrincipalRisk(
      normalizeRequiredText(principalId, "Principal id is required."),
      normalizeRequiredText(riskId, "Risk id is required."),
    );
  }

  listRisks(input: ListPrincipalRisksInput): StoredPrincipalRiskRecord[] {
    const status = normalizeOptionalText(input.status);
    const type = normalizeOptionalText(input.type);
    const severity = normalizeOptionalText(input.severity);
    const query = normalizeOptionalText(input.query);

    return this.registry.listPrincipalRisks({
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      ...(status ? { status: normalizeRiskStatus(status) } : {}),
      ...(type ? { type: normalizeRiskType(type) } : {}),
      ...(severity ? { severity: normalizeRiskSeverity(severity) } : {}),
      ...(query ? { query } : {}),
      ...(input.includeArchived === true ? { includeArchived: true } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
  }

  private syncGeneratedEdges(record: StoredPrincipalRiskRecord, now: string): void {
    if (!this.operationEdgesService) {
      return;
    }

    this.operationEdgesService.syncGeneratedEdgesForObject({
      principalId: record.principalId,
      sourceObjectType: "risk",
      sourceObjectId: record.riskId,
      edges: record.status === "archived"
        ? []
        : [
          ...record.relatedAssetIds.map((assetId) => ({
            fromObjectType: "risk" as const,
            fromObjectId: record.riskId,
            toObjectType: "asset" as const,
            toObjectId: assetId,
            relationType: "relates_to" as const,
            label: "风险关联资产",
            summary: `风险「${record.title}」关联资产 ${assetId}。`,
          })),
          ...record.linkedDecisionIds.map((decisionId) => ({
            fromObjectType: "decision" as const,
            fromObjectId: decisionId,
            toObjectType: "risk" as const,
            toObjectId: record.riskId,
            relationType: "mitigates" as const,
            label: "决策缓解风险",
            summary: `决策 ${decisionId} 用于缓解风险「${record.title}」。`,
          })),
          ...record.relatedWorkItemIds.map((workItemId) => ({
            fromObjectType: "work_item" as const,
            fromObjectId: workItemId,
            toObjectType: "risk" as const,
            toObjectId: record.riskId,
            relationType: "tracks" as const,
            label: "执行项跟踪风险",
            summary: `Work item ${workItemId} 跟踪风险「${record.title}」。`,
          })),
        ],
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
  return normalizePrincipalRiskRelatedIds(value);
}

function normalizeRiskType(value: string): StoredPrincipalRiskRecord["type"] {
  const normalized = value.trim();

  if (!PRINCIPAL_RISK_TYPES.includes(normalized as StoredPrincipalRiskRecord["type"])) {
    throw new Error("Risk type is invalid.");
  }

  return normalized as StoredPrincipalRiskRecord["type"];
}

function normalizeRiskSeverity(value: string): StoredPrincipalRiskRecord["severity"] {
  const normalized = value.trim();

  if (!PRINCIPAL_RISK_SEVERITIES.includes(normalized as StoredPrincipalRiskRecord["severity"])) {
    throw new Error("Risk severity is invalid.");
  }

  return normalized as StoredPrincipalRiskRecord["severity"];
}

function normalizeRiskStatus(value: string): StoredPrincipalRiskRecord["status"] {
  const normalized = value.trim();

  if (!PRINCIPAL_RISK_STATUSES.includes(normalized as StoredPrincipalRiskRecord["status"])) {
    throw new Error("Risk status is invalid.");
  }

  return normalized as StoredPrincipalRiskRecord["status"];
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
