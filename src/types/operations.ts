export const PRINCIPAL_ASSET_KINDS = [
  "site",
  "domain",
  "server",
  "service",
  "database",
  "account",
  "storage",
  "workspace",
  "document",
  "other",
] as const;

export type PrincipalAssetKind = (typeof PRINCIPAL_ASSET_KINDS)[number];

export const PRINCIPAL_ASSET_STATUSES = ["active", "watch", "archived"] as const;

export type PrincipalAssetStatus = (typeof PRINCIPAL_ASSET_STATUSES)[number];

export const PRINCIPAL_ASSET_REF_KINDS = [
  "domain",
  "host",
  "repo",
  "provider_resource",
  "doc",
  "url",
  "workspace",
  "other",
] as const;

export type PrincipalAssetRefKind = (typeof PRINCIPAL_ASSET_REF_KINDS)[number];

export interface PrincipalAssetRef {
  kind: PrincipalAssetRefKind;
  value: string;
  label?: string;
}

export interface StoredPrincipalAssetRecord {
  assetId: string;
  principalId: string;
  kind: PrincipalAssetKind;
  name: string;
  status: PrincipalAssetStatus;
  ownerPrincipalId?: string;
  summary?: string;
  tags: string[];
  refs: PrincipalAssetRef[];
  createdAt: string;
  updatedAt: string;
}

export function normalizePrincipalAssetTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export function normalizePrincipalAssetRef(value: unknown): PrincipalAssetRef | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  const refValue = typeof record.value === "string" ? record.value.trim() : "";
  const label = typeof record.label === "string" ? record.label.trim() : "";

  if (!PRINCIPAL_ASSET_REF_KINDS.includes(kind as PrincipalAssetRefKind) || !refValue) {
    return null;
  }

  return {
    kind: kind as PrincipalAssetRefKind,
    value: refValue,
    ...(label ? { label } : {}),
  };
}

export function normalizePrincipalAssetRefs(value: unknown): PrincipalAssetRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dedupe = new Set<string>();
  const refs: PrincipalAssetRef[] = [];

  for (const item of value) {
    const normalized = normalizePrincipalAssetRef(item);

    if (!normalized) {
      continue;
    }

    const dedupeKey = `${normalized.kind}\u0000${normalized.value}\u0000${normalized.label ?? ""}`;
    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.add(dedupeKey);
    refs.push(normalized);
  }

  return refs;
}

export const PRINCIPAL_DECISION_STATUSES = ["active", "superseded", "archived"] as const;

export type PrincipalDecisionStatus = (typeof PRINCIPAL_DECISION_STATUSES)[number];

export interface StoredPrincipalDecisionRecord {
  decisionId: string;
  principalId: string;
  title: string;
  status: PrincipalDecisionStatus;
  summary?: string;
  decidedByPrincipalId?: string;
  decidedAt: string;
  relatedAssetIds: string[];
  relatedWorkItemIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function normalizePrincipalDecisionRelatedIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export const PRINCIPAL_RISK_TYPES = ["risk", "incident"] as const;

export type PrincipalRiskType = (typeof PRINCIPAL_RISK_TYPES)[number];

export const PRINCIPAL_RISK_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type PrincipalRiskSeverity = (typeof PRINCIPAL_RISK_SEVERITIES)[number];

export const PRINCIPAL_RISK_STATUSES = ["open", "watch", "resolved", "archived"] as const;

export type PrincipalRiskStatus = (typeof PRINCIPAL_RISK_STATUSES)[number];

export interface StoredPrincipalRiskRecord {
  riskId: string;
  principalId: string;
  type: PrincipalRiskType;
  title: string;
  severity: PrincipalRiskSeverity;
  status: PrincipalRiskStatus;
  ownerPrincipalId?: string;
  summary?: string;
  detectedAt: string;
  relatedAssetIds: string[];
  linkedDecisionIds: string[];
  relatedWorkItemIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function normalizePrincipalRiskRelatedIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export const PRINCIPAL_CADENCE_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "custom",
] as const;

export type PrincipalCadenceFrequency = (typeof PRINCIPAL_CADENCE_FREQUENCIES)[number];

export const PRINCIPAL_CADENCE_STATUSES = ["active", "paused", "archived"] as const;

export type PrincipalCadenceStatus = (typeof PRINCIPAL_CADENCE_STATUSES)[number];

export interface StoredPrincipalCadenceRecord {
  cadenceId: string;
  principalId: string;
  title: string;
  frequency: PrincipalCadenceFrequency;
  status: PrincipalCadenceStatus;
  nextRunAt: string;
  ownerPrincipalId?: string;
  playbookRef?: string;
  summary?: string;
  relatedAssetIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function normalizePrincipalCadenceRelatedIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export const PRINCIPAL_COMMITMENT_STATUSES = ["planned", "active", "at_risk", "done", "archived"] as const;

export type PrincipalCommitmentStatus = (typeof PRINCIPAL_COMMITMENT_STATUSES)[number];

export const PRINCIPAL_COMMITMENT_MILESTONE_STATUSES = ["planned", "active", "blocked", "done"] as const;

export type PrincipalCommitmentMilestoneStatus = (typeof PRINCIPAL_COMMITMENT_MILESTONE_STATUSES)[number];

export const PRINCIPAL_COMMITMENT_EVIDENCE_KINDS = [
  "url",
  "doc",
  "artifact",
  "run",
  "work_item",
  "other",
] as const;

export type PrincipalCommitmentEvidenceKind = (typeof PRINCIPAL_COMMITMENT_EVIDENCE_KINDS)[number];

export interface PrincipalCommitmentEvidenceRef {
  kind: PrincipalCommitmentEvidenceKind;
  value: string;
  label?: string;
  capturedAt?: string;
}

export interface PrincipalCommitmentMilestone {
  milestoneId?: string;
  title: string;
  status: PrincipalCommitmentMilestoneStatus;
  dueAt?: string;
  completedAt?: string;
  summary?: string;
  evidenceRefs: PrincipalCommitmentEvidenceRef[];
}

export interface StoredPrincipalCommitmentRecord {
  commitmentId: string;
  principalId: string;
  title: string;
  status: PrincipalCommitmentStatus;
  ownerPrincipalId?: string;
  startsAt?: string;
  dueAt: string;
  progressPercent: number;
  summary?: string;
  milestones: PrincipalCommitmentMilestone[];
  evidenceRefs: PrincipalCommitmentEvidenceRef[];
  relatedAssetIds: string[];
  linkedDecisionIds: string[];
  linkedRiskIds: string[];
  relatedCadenceIds: string[];
  relatedWorkItemIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function normalizePrincipalCommitmentRelatedIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export function normalizePrincipalCommitmentProgressPercent(value: unknown): number {
  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.trim())
      : 0;

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

export function normalizePrincipalCommitmentEvidenceRef(value: unknown): PrincipalCommitmentEvidenceRef | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  const refValue = typeof record.value === "string" ? record.value.trim() : "";
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const capturedAt = typeof record.capturedAt === "string" ? record.capturedAt.trim() : "";

  if (!PRINCIPAL_COMMITMENT_EVIDENCE_KINDS.includes(kind as PrincipalCommitmentEvidenceKind) || !refValue) {
    return null;
  }

  return {
    kind: kind as PrincipalCommitmentEvidenceKind,
    value: refValue,
    ...(label ? { label } : {}),
    ...(capturedAt ? { capturedAt } : {}),
  };
}

export function normalizePrincipalCommitmentEvidenceRefs(value: unknown): PrincipalCommitmentEvidenceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dedupe = new Set<string>();
  const refs: PrincipalCommitmentEvidenceRef[] = [];

  for (const item of value) {
    const normalized = normalizePrincipalCommitmentEvidenceRef(item);

    if (!normalized) {
      continue;
    }

    const dedupeKey = [
      normalized.kind,
      normalized.value,
      normalized.label ?? "",
      normalized.capturedAt ?? "",
    ].join("\u0000");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.add(dedupeKey);
    refs.push(normalized);
  }

  return refs;
}

export function normalizePrincipalCommitmentMilestone(value: unknown): PrincipalCommitmentMilestone | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const milestoneId = typeof record.milestoneId === "string" ? record.milestoneId.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const rawStatus = typeof record.status === "string" ? record.status.trim() : "planned";
  const dueAt = typeof record.dueAt === "string" ? record.dueAt.trim() : "";
  const completedAt = typeof record.completedAt === "string" ? record.completedAt.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const status = PRINCIPAL_COMMITMENT_MILESTONE_STATUSES.includes(rawStatus as PrincipalCommitmentMilestoneStatus)
    ? rawStatus as PrincipalCommitmentMilestoneStatus
    : "planned";

  if (!title) {
    return null;
  }

  return {
    ...(milestoneId ? { milestoneId } : {}),
    title,
    status,
    ...(dueAt ? { dueAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(summary ? { summary } : {}),
    evidenceRefs: normalizePrincipalCommitmentEvidenceRefs(record.evidenceRefs),
  };
}

export function normalizePrincipalCommitmentMilestones(value: unknown): PrincipalCommitmentMilestone[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dedupe = new Set<string>();
  const milestones: PrincipalCommitmentMilestone[] = [];

  for (const item of value) {
    const normalized = normalizePrincipalCommitmentMilestone(item);

    if (!normalized) {
      continue;
    }

    const dedupeKey = [
      normalized.milestoneId ?? "",
      normalized.title,
      normalized.dueAt ?? "",
    ].join("\u0000");

    if (dedupe.has(dedupeKey)) {
      continue;
    }

    dedupe.add(dedupeKey);
    milestones.push(normalized);
  }

  return milestones;
}

export const PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES = [
  "asset",
  "commitment",
  "decision",
  "risk",
  "cadence",
  "work_item",
] as const;

export type PrincipalOperationEdgeObjectType = (typeof PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES)[number];

export const PRINCIPAL_OPERATION_EDGE_RELATION_TYPES = [
  "relates_to",
  "depends_on",
  "mitigates",
  "tracks",
  "blocks",
  "supersedes",
  "evidence_for",
] as const;

export type PrincipalOperationEdgeRelationType = (typeof PRINCIPAL_OPERATION_EDGE_RELATION_TYPES)[number];

export const PRINCIPAL_OPERATION_EDGE_STATUSES = ["active", "archived"] as const;

export type PrincipalOperationEdgeStatus = (typeof PRINCIPAL_OPERATION_EDGE_STATUSES)[number];

export interface StoredPrincipalOperationEdgeRecord {
  edgeId: string;
  principalId: string;
  fromObjectType: PrincipalOperationEdgeObjectType;
  fromObjectId: string;
  toObjectType: PrincipalOperationEdgeObjectType;
  toObjectId: string;
  relationType: PrincipalOperationEdgeRelationType;
  status: PrincipalOperationEdgeStatus;
  label?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export const PRINCIPAL_OPERATIONS_BOSS_VIEW_TONES = ["green", "amber", "red", "neutral"] as const;

export type PrincipalOperationsBossViewTone = (typeof PRINCIPAL_OPERATIONS_BOSS_VIEW_TONES)[number];

export interface PrincipalOperationsBossViewHeadline {
  tone: Exclude<PrincipalOperationsBossViewTone, "neutral">;
  title: string;
  summary: string;
}

export interface PrincipalOperationsBossViewMetric {
  key: string;
  label: string;
  value: number;
  tone: PrincipalOperationsBossViewTone;
  detail: string;
}

export interface PrincipalOperationsBossViewFocusItem {
  objectType: "asset" | "cadence" | "commitment" | "risk" | "operation_edge";
  objectId: string;
  title: string;
  label: string;
  tone: Exclude<PrincipalOperationsBossViewTone, "neutral">;
  summary: string;
  actionLabel: string;
}

export interface PrincipalOperationsBossViewRelationItem {
  edgeId: string;
  relationType: PrincipalOperationEdgeRelationType;
  tone: PrincipalOperationsBossViewTone;
  label: string;
  fromLabel: string;
  toLabel: string;
  summary: string;
}

export interface PrincipalOperationsBossViewDecisionItem {
  decisionId: string;
  title: string;
  status: PrincipalDecisionStatus;
  decidedAt: string;
  summary: string;
}

export interface PrincipalOperationsBossViewInventory {
  assets: {
    total: number;
    active: number;
    watch: number;
  };
  risks: {
    total: number;
    open: number;
    watch: number;
    highOrCriticalOpen: number;
  };
  cadences: {
    total: number;
    active: number;
    overdue: number;
    upcoming: number;
  };
  commitments: {
    total: number;
    active: number;
    atRisk: number;
    overdue: number;
    done: number;
  };
  decisions: {
    total: number;
    active: number;
    superseded: number;
  };
  edges: {
    total: number;
    active: number;
    blocking: number;
  };
}

export interface PrincipalOperationsBossViewSnapshot {
  principalId: string;
  generatedAt: string;
  headline: PrincipalOperationsBossViewHeadline;
  metrics: PrincipalOperationsBossViewMetric[];
  focusItems: PrincipalOperationsBossViewFocusItem[];
  relationItems: PrincipalOperationsBossViewRelationItem[];
  recentDecisions: PrincipalOperationsBossViewDecisionItem[];
  inventory: PrincipalOperationsBossViewInventory;
}
