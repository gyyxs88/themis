import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import type {
  PrincipalCommitmentEvidenceRef,
  PrincipalCommitmentMilestone,
  PrincipalCommitmentStatus,
  StoredPrincipalCommitmentRecord,
} from "../types/index.js";
import {
  PRINCIPAL_COMMITMENT_STATUSES,
  normalizePrincipalCommitmentEvidenceRefs,
  normalizePrincipalCommitmentMilestones,
  normalizePrincipalCommitmentProgressPercent,
  normalizePrincipalCommitmentRelatedIds,
} from "../types/index.js";

export interface PrincipalCommitmentsServiceOptions {
  registry: SqliteCodexSessionRegistry;
  operationEdgesService?: PrincipalOperationEdgesService;
}

export interface CreatePrincipalCommitmentInput {
  principalId: string;
  title: string;
  status?: PrincipalCommitmentStatus;
  ownerPrincipalId?: string;
  startsAt?: string;
  dueAt?: string;
  progressPercent?: number;
  summary?: string;
  milestones?: PrincipalCommitmentMilestone[];
  evidenceRefs?: PrincipalCommitmentEvidenceRef[];
  relatedAssetIds?: string[];
  linkedDecisionIds?: string[];
  linkedRiskIds?: string[];
  relatedCadenceIds?: string[];
  relatedWorkItemIds?: string[];
  commitmentId?: string;
  now?: string;
}

export interface UpdatePrincipalCommitmentInput {
  principalId: string;
  commitmentId: string;
  title: string;
  status: PrincipalCommitmentStatus;
  ownerPrincipalId?: string;
  startsAt?: string;
  dueAt?: string;
  progressPercent?: number;
  summary?: string;
  milestones?: PrincipalCommitmentMilestone[];
  evidenceRefs?: PrincipalCommitmentEvidenceRef[];
  relatedAssetIds?: string[];
  linkedDecisionIds?: string[];
  linkedRiskIds?: string[];
  relatedCadenceIds?: string[];
  relatedWorkItemIds?: string[];
  now?: string;
}

export interface ListPrincipalCommitmentsInput {
  principalId: string;
  status?: StoredPrincipalCommitmentRecord["status"];
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export class PrincipalCommitmentsService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly operationEdgesService: PrincipalOperationEdgesService | undefined;

  constructor(options: PrincipalCommitmentsServiceOptions) {
    this.registry = options.registry;
    this.operationEdgesService = options.operationEdgesService;
  }

  createCommitment(input: CreatePrincipalCommitmentInput): StoredPrincipalCommitmentRecord {
    const now = normalizeNow(input.now);
    const ownerPrincipalId = normalizeOptionalText(input.ownerPrincipalId);
    const startsAt = normalizeOptionalText(input.startsAt);
    const summary = normalizeOptionalText(input.summary);
    const status = normalizeCommitmentStatus(input.status ?? "active");
    const record: StoredPrincipalCommitmentRecord = {
      commitmentId: normalizeOptionalText(input.commitmentId) ?? createId("commitment-ledger"),
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      title: normalizeRequiredText(input.title, "Commitment title is required."),
      status,
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      ...(startsAt ? { startsAt } : {}),
      dueAt: normalizeTimestamp(input.dueAt, now),
      progressPercent: normalizeCommitmentProgress(input.progressPercent, status),
      ...(summary ? { summary } : {}),
      milestones: normalizeCommitmentMilestones(input.milestones),
      evidenceRefs: normalizeCommitmentEvidenceRefs(input.evidenceRefs),
      relatedAssetIds: normalizeRelatedIds(input.relatedAssetIds),
      linkedDecisionIds: normalizeRelatedIds(input.linkedDecisionIds),
      linkedRiskIds: normalizeRelatedIds(input.linkedRiskIds),
      relatedCadenceIds: normalizeRelatedIds(input.relatedCadenceIds),
      relatedWorkItemIds: normalizeRelatedIds(input.relatedWorkItemIds),
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipalCommitment(record);
    this.syncGeneratedEdges(record, now);
    return record;
  }

  updateCommitment(input: UpdatePrincipalCommitmentInput): StoredPrincipalCommitmentRecord {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const commitmentId = normalizeRequiredText(input.commitmentId, "Commitment id is required.");
    const existing = this.registry.getPrincipalCommitment(principalId, commitmentId);

    if (!existing) {
      throw new Error("Principal commitment does not exist.");
    }

    const updated: StoredPrincipalCommitmentRecord = {
      ...existing,
      title: normalizeRequiredText(input.title, "Commitment title is required."),
      status: normalizeCommitmentStatus(input.status),
      dueAt: normalizeTimestamp(input.dueAt, existing.dueAt),
      progressPercent: normalizeCommitmentProgress(input.progressPercent, input.status),
      milestones: normalizeCommitmentMilestones(input.milestones),
      evidenceRefs: normalizeCommitmentEvidenceRefs(input.evidenceRefs),
      relatedAssetIds: normalizeRelatedIds(input.relatedAssetIds),
      linkedDecisionIds: normalizeRelatedIds(input.linkedDecisionIds),
      linkedRiskIds: normalizeRelatedIds(input.linkedRiskIds),
      relatedCadenceIds: normalizeRelatedIds(input.relatedCadenceIds),
      relatedWorkItemIds: normalizeRelatedIds(input.relatedWorkItemIds),
      updatedAt: normalizeNow(input.now),
    };

    const ownerPrincipalId = normalizeOptionalText(input.ownerPrincipalId);
    const startsAt = normalizeOptionalText(input.startsAt);
    const summary = normalizeOptionalText(input.summary);

    if (ownerPrincipalId) {
      updated.ownerPrincipalId = ownerPrincipalId;
    } else {
      delete updated.ownerPrincipalId;
    }

    if (startsAt) {
      updated.startsAt = startsAt;
    } else {
      delete updated.startsAt;
    }

    if (summary) {
      updated.summary = summary;
    } else {
      delete updated.summary;
    }

    this.registry.savePrincipalCommitment(updated);
    this.syncGeneratedEdges(updated, updated.updatedAt);
    return updated;
  }

  getCommitment(principalId: string, commitmentId: string): StoredPrincipalCommitmentRecord | null {
    return this.registry.getPrincipalCommitment(
      normalizeRequiredText(principalId, "Principal id is required."),
      normalizeRequiredText(commitmentId, "Commitment id is required."),
    );
  }

  listCommitments(input: ListPrincipalCommitmentsInput): StoredPrincipalCommitmentRecord[] {
    const status = normalizeOptionalText(input.status);
    const query = normalizeOptionalText(input.query);

    return this.registry.listPrincipalCommitments({
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      ...(status ? { status: normalizeCommitmentStatus(status) } : {}),
      ...(query ? { query } : {}),
      ...(input.includeArchived === true ? { includeArchived: true } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
  }

  private syncGeneratedEdges(record: StoredPrincipalCommitmentRecord, now: string): void {
    if (!this.operationEdgesService) {
      return;
    }

    this.operationEdgesService.syncGeneratedEdgesForObject({
      principalId: record.principalId,
      sourceObjectType: "commitment",
      sourceObjectId: record.commitmentId,
      edges: record.status === "archived"
        ? []
        : [
          ...record.relatedAssetIds.map((assetId) => ({
            fromObjectType: "commitment" as const,
            fromObjectId: record.commitmentId,
            toObjectType: "asset" as const,
            toObjectId: assetId,
            relationType: "relates_to" as const,
            label: "承诺关联资产",
            summary: `承诺「${record.title}」关联资产 ${assetId}。`,
          })),
          ...record.linkedDecisionIds.map((decisionId) => ({
            fromObjectType: "commitment" as const,
            fromObjectId: record.commitmentId,
            toObjectType: "decision" as const,
            toObjectId: decisionId,
            relationType: "depends_on" as const,
            label: "承诺依赖决策",
            summary: `承诺「${record.title}」依赖决策 ${decisionId}。`,
          })),
          ...record.linkedRiskIds.map((riskId) => {
            const blocksCommitment = this.shouldLinkedRiskBlockCommitment(record, riskId);

            return {
              fromObjectType: "risk" as const,
              fromObjectId: riskId,
              toObjectType: "commitment" as const,
              toObjectId: record.commitmentId,
              relationType: blocksCommitment ? "blocks" as const : "relates_to" as const,
              label: blocksCommitment ? "风险阻塞承诺" : "承诺关联风险",
              summary: blocksCommitment
                ? `风险 ${riskId} 阻塞承诺「${record.title}」。`
                : `承诺「${record.title}」关联已收口或非阻塞风险 ${riskId}。`,
            };
          }),
          ...record.relatedCadenceIds.map((cadenceId) => ({
            fromObjectType: "cadence" as const,
            fromObjectId: cadenceId,
            toObjectType: "commitment" as const,
            toObjectId: record.commitmentId,
            relationType: "tracks" as const,
            label: "节奏跟踪承诺",
            summary: `节奏 ${cadenceId} 跟踪承诺「${record.title}」。`,
          })),
          ...record.relatedWorkItemIds.map((workItemId) => ({
            fromObjectType: "commitment" as const,
            fromObjectId: record.commitmentId,
            toObjectType: "work_item" as const,
            toObjectId: workItemId,
            relationType: "depends_on" as const,
            label: "承诺依赖执行项",
            summary: `承诺「${record.title}」依赖 work item ${workItemId}。`,
          })),
          ...collectWorkItemEvidenceRefs(record).map((workItemId) => ({
            fromObjectType: "work_item" as const,
            fromObjectId: workItemId,
            toObjectType: "commitment" as const,
            toObjectId: record.commitmentId,
            relationType: "evidence_for" as const,
            label: "执行证据支撑承诺",
            summary: `work item ${workItemId} 是承诺「${record.title}」的证据。`,
          })),
        ],
      now,
    });
  }

  private shouldLinkedRiskBlockCommitment(record: StoredPrincipalCommitmentRecord, riskId: string): boolean {
    if (record.status === "done" || record.status === "archived") {
      return false;
    }

    const risk = this.registry.getPrincipalRisk(record.principalId, riskId);

    if (risk?.status === "resolved" || risk?.status === "archived") {
      return false;
    }

    return true;
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
  return normalizePrincipalCommitmentRelatedIds(value);
}

function normalizeCommitmentProgress(value: number | undefined, status: PrincipalCommitmentStatus): number {
  if (typeof value === "undefined") {
    return status === "done" ? 100 : 0;
  }

  return normalizePrincipalCommitmentProgressPercent(value);
}

function normalizeCommitmentMilestones(value?: PrincipalCommitmentMilestone[]): PrincipalCommitmentMilestone[] {
  return normalizePrincipalCommitmentMilestones(value, { strictStatus: true });
}

function normalizeCommitmentEvidenceRefs(value?: PrincipalCommitmentEvidenceRef[]): PrincipalCommitmentEvidenceRef[] {
  return normalizePrincipalCommitmentEvidenceRefs(value);
}

function normalizeCommitmentStatus(value: string): StoredPrincipalCommitmentRecord["status"] {
  const normalized = value.trim();

  if (!PRINCIPAL_COMMITMENT_STATUSES.includes(normalized as StoredPrincipalCommitmentRecord["status"])) {
    throw new Error("Commitment status is invalid.");
  }

  return normalized as StoredPrincipalCommitmentRecord["status"];
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

function collectWorkItemEvidenceRefs(record: StoredPrincipalCommitmentRecord): string[] {
  const workItemIds = new Set<string>();
  const addEvidenceRefs = (refs: PrincipalCommitmentEvidenceRef[]): void => {
    for (const ref of refs) {
      if (ref.kind === "work_item") {
        const value = ref.value.trim();

        if (value) {
          workItemIds.add(value);
        }
      }
    }
  };

  addEvidenceRefs(record.evidenceRefs);
  for (const milestone of record.milestones) {
    addEvidenceRefs(milestone.evidenceRefs);
  }

  return [...workItemIds];
}
