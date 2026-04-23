import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import type {
  PrincipalDecisionStatus,
  StoredPrincipalDecisionRecord,
} from "../types/index.js";
import {
  PRINCIPAL_DECISION_STATUSES,
  normalizePrincipalDecisionRelatedIds,
} from "../types/index.js";

export interface PrincipalDecisionsServiceOptions {
  registry: SqliteCodexSessionRegistry;
  operationEdgesService?: PrincipalOperationEdgesService;
}

export interface CreatePrincipalDecisionInput {
  principalId: string;
  title: string;
  status?: PrincipalDecisionStatus;
  summary?: string;
  decidedByPrincipalId?: string;
  decidedAt?: string;
  relatedAssetIds?: string[];
  relatedWorkItemIds?: string[];
  decisionId?: string;
  now?: string;
}

export interface UpdatePrincipalDecisionInput {
  principalId: string;
  decisionId: string;
  title: string;
  status: PrincipalDecisionStatus;
  summary?: string;
  decidedByPrincipalId?: string;
  decidedAt?: string;
  relatedAssetIds?: string[];
  relatedWorkItemIds?: string[];
  now?: string;
}

export interface ListPrincipalDecisionsInput {
  principalId: string;
  status?: StoredPrincipalDecisionRecord["status"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export class PrincipalDecisionsService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly operationEdgesService: PrincipalOperationEdgesService | undefined;

  constructor(options: PrincipalDecisionsServiceOptions) {
    this.registry = options.registry;
    this.operationEdgesService = options.operationEdgesService;
  }

  createDecision(input: CreatePrincipalDecisionInput): StoredPrincipalDecisionRecord {
    const now = normalizeNow(input.now);
    const summary = normalizeOptionalText(input.summary);
    const decidedByPrincipalId = normalizeOptionalText(input.decidedByPrincipalId);
    const record: StoredPrincipalDecisionRecord = {
      decisionId: normalizeOptionalText(input.decisionId) ?? createId("decision-ledger"),
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      title: normalizeRequiredText(input.title, "Decision title is required."),
      status: normalizeDecisionStatus(input.status ?? "active"),
      ...(summary ? { summary } : {}),
      ...(decidedByPrincipalId ? { decidedByPrincipalId } : {}),
      decidedAt: normalizeTimestamp(input.decidedAt, now),
      relatedAssetIds: normalizeRelatedIds(input.relatedAssetIds),
      relatedWorkItemIds: normalizeRelatedIds(input.relatedWorkItemIds),
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipalDecision(record);
    this.syncGeneratedEdges(record, now);
    return record;
  }

  updateDecision(input: UpdatePrincipalDecisionInput): StoredPrincipalDecisionRecord {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const decisionId = normalizeRequiredText(input.decisionId, "Decision id is required.");
    const existing = this.registry.getPrincipalDecision(principalId, decisionId);

    if (!existing) {
      throw new Error("Principal decision does not exist.");
    }

    const updated: StoredPrincipalDecisionRecord = {
      ...existing,
      title: normalizeRequiredText(input.title, "Decision title is required."),
      status: normalizeDecisionStatus(input.status),
      decidedAt: normalizeTimestamp(input.decidedAt, existing.decidedAt),
      relatedAssetIds: normalizeRelatedIds(input.relatedAssetIds),
      relatedWorkItemIds: normalizeRelatedIds(input.relatedWorkItemIds),
      updatedAt: normalizeNow(input.now),
    };

    const summary = normalizeOptionalText(input.summary);
    const decidedByPrincipalId = normalizeOptionalText(input.decidedByPrincipalId);

    if (summary) {
      updated.summary = summary;
    } else {
      delete updated.summary;
    }

    if (decidedByPrincipalId) {
      updated.decidedByPrincipalId = decidedByPrincipalId;
    } else {
      delete updated.decidedByPrincipalId;
    }

    this.registry.savePrincipalDecision(updated);
    this.syncGeneratedEdges(updated, updated.updatedAt);
    return updated;
  }

  getDecision(principalId: string, decisionId: string): StoredPrincipalDecisionRecord | null {
    return this.registry.getPrincipalDecision(
      normalizeRequiredText(principalId, "Principal id is required."),
      normalizeRequiredText(decisionId, "Decision id is required."),
    );
  }

  listDecisions(input: ListPrincipalDecisionsInput): StoredPrincipalDecisionRecord[] {
    const status = normalizeOptionalText(input.status);
    const query = normalizeOptionalText(input.query);

    return this.registry.listPrincipalDecisions({
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      ...(status ? { status: normalizeDecisionStatus(status) } : {}),
      ...(query ? { query } : {}),
      ...(input.includeArchived === true ? { includeArchived: true } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
  }

  private syncGeneratedEdges(record: StoredPrincipalDecisionRecord, now: string): void {
    if (!this.operationEdgesService) {
      return;
    }

    this.operationEdgesService.syncGeneratedEdgesForObject({
      principalId: record.principalId,
      sourceObjectType: "decision",
      sourceObjectId: record.decisionId,
      edges: record.status === "archived"
        ? []
        : [
          ...record.relatedAssetIds.map((assetId) => ({
            fromObjectType: "decision" as const,
            fromObjectId: record.decisionId,
            toObjectType: "asset" as const,
            toObjectId: assetId,
            relationType: "relates_to" as const,
            label: "决策关联资产",
            summary: `决策「${record.title}」关联资产 ${assetId}。`,
          })),
          ...record.relatedWorkItemIds.map((workItemId) => ({
            fromObjectType: "decision" as const,
            fromObjectId: record.decisionId,
            toObjectType: "work_item" as const,
            toObjectId: workItemId,
            relationType: "relates_to" as const,
            label: "决策关联执行项",
            summary: `决策「${record.title}」关联 work item ${workItemId}。`,
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
  return normalizePrincipalDecisionRelatedIds(value);
}

function normalizeDecisionStatus(value: string): StoredPrincipalDecisionRecord["status"] {
  const normalized = value.trim();

  if (!PRINCIPAL_DECISION_STATUSES.includes(normalized as StoredPrincipalDecisionRecord["status"])) {
    throw new Error("Decision status is invalid.");
  }

  return normalized as StoredPrincipalDecisionRecord["status"];
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
