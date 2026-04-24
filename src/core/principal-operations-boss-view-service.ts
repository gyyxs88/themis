import type { PrincipalAssetsService } from "./principal-assets-service.js";
import type { PrincipalCadencesService } from "./principal-cadences-service.js";
import type { PrincipalCommitmentsService } from "./principal-commitments-service.js";
import type { PrincipalDecisionsService } from "./principal-decisions-service.js";
import type { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import type { PrincipalRisksService } from "./principal-risks-service.js";
import type {
  PrincipalOperationsBossViewDecisionItem,
  PrincipalOperationsBossViewFocusItem,
  PrincipalOperationsBossViewHeadline,
  PrincipalOperationsBossViewInventory,
  PrincipalOperationsBossViewMetric,
  PrincipalOperationsBossViewRelationItem,
  PrincipalOperationsBossViewSnapshot,
  PrincipalOperationsBossViewTone,
  StoredPrincipalAssetRecord,
  StoredPrincipalCadenceRecord,
  StoredPrincipalCommitmentRecord,
  StoredPrincipalDecisionRecord,
  StoredPrincipalOperationEdgeRecord,
  StoredPrincipalRiskRecord,
} from "../types/index.js";

export interface PrincipalOperationsBossViewServiceOptions {
  assetsService: PrincipalAssetsService;
  cadencesService: PrincipalCadencesService;
  commitmentsService: PrincipalCommitmentsService;
  decisionsService: PrincipalDecisionsService;
  edgesService: PrincipalOperationEdgesService;
  risksService: PrincipalRisksService;
}

export interface GetPrincipalOperationsBossViewInput {
  principalId: string;
  now?: string;
}

export class PrincipalOperationsBossViewService {
  private readonly assetsService: PrincipalAssetsService;
  private readonly cadencesService: PrincipalCadencesService;
  private readonly commitmentsService: PrincipalCommitmentsService;
  private readonly decisionsService: PrincipalDecisionsService;
  private readonly edgesService: PrincipalOperationEdgesService;
  private readonly risksService: PrincipalRisksService;

  constructor(options: PrincipalOperationsBossViewServiceOptions) {
    this.assetsService = options.assetsService;
    this.cadencesService = options.cadencesService;
    this.commitmentsService = options.commitmentsService;
    this.decisionsService = options.decisionsService;
    this.edgesService = options.edgesService;
    this.risksService = options.risksService;
  }

  getBossView(input: GetPrincipalOperationsBossViewInput): PrincipalOperationsBossViewSnapshot {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const generatedAt = normalizeTimestamp(input.now);
    const nowMs = Date.parse(generatedAt);
    const assets = this.assetsService.listAssets({ principalId, includeArchived: true });
    const cadences = this.cadencesService.listCadences({ principalId, includeArchived: true });
    const commitments = this.commitmentsService.listCommitments({ principalId, includeArchived: true });
    const decisions = this.decisionsService.listDecisions({ principalId, includeArchived: true });
    const edges = this.edgesService.listEdges({ principalId, includeArchived: true });
    const risks = this.risksService.listRisks({ principalId, includeArchived: true });
    const labels = buildObjectLabelResolver({ assets, cadences, commitments, decisions, risks });
    const activeAssets = assets.filter((item) => item.status === "active");
    const watchAssets = assets.filter((item) => item.status === "watch");
    const activeRisks = risks.filter((item) => item.status === "open" || item.status === "watch");
    const openRisks = risks.filter((item) => item.status === "open");
    const highOrCriticalRisks = activeRisks.filter((item) => item.severity === "high" || item.severity === "critical");
    const activeCadences = cadences.filter((item) => item.status === "active");
    const overdueCadences = activeCadences.filter((item) => isPastOrEqual(item.nextRunAt, nowMs));
    const upcomingCadences = activeCadences.filter((item) => isWithinUpcomingWindow(item.nextRunAt, nowMs));
    const activeCommitments = commitments.filter((item) =>
      item.status === "planned" || item.status === "active" || item.status === "at_risk"
    );
    const atRiskCommitments = commitments.filter((item) => item.status === "at_risk");
    const overdueCommitments = activeCommitments.filter((item) => isPastOrEqual(item.dueAt, nowMs));
    const doneCommitments = commitments.filter((item) => item.status === "done");
    const activeDecisions = decisions.filter((item) => item.status === "active");
    const supersededDecisions = decisions.filter((item) => item.status === "superseded");
    const activeEdges = edges.filter((item) => item.status === "active");
    const edgeObjectState = buildEdgeObjectState({ risks, commitments });
    const blockingEdges = activeEdges.filter((item) => isEffectiveBlockingEdge(item, edgeObjectState));
    const bossViewEdges = activeEdges.filter((item) =>
      item.relationType !== "blocks" || isEffectiveBlockingEdge(item, edgeObjectState)
    );
    const inventory = buildInventory({
      activeAssets,
      watchAssets,
      assets,
      activeRisks,
      openRisks,
      highOrCriticalRisks,
      risks,
      activeCadences,
      overdueCadences,
      upcomingCadences,
      cadences,
      activeCommitments,
      atRiskCommitments,
      overdueCommitments,
      doneCommitments,
      commitments,
      activeDecisions,
      supersededDecisions,
      decisions,
      activeEdges,
      blockingEdges,
      edges,
    });

    return {
      principalId,
      generatedAt,
      headline: buildHeadline(inventory),
      metrics: buildMetrics(inventory),
      focusItems: buildFocusItems({
        risks: highOrCriticalRisks,
        blockingEdges,
        overdueCadences,
        overdueCommitments,
        atRiskCommitments,
        watchAssets,
        assetCoverageById: buildAssetCoverageById({ risks, cadences }),
        labels,
      }),
      relationItems: buildRelationItems(bossViewEdges, labels),
      recentDecisions: buildRecentDecisions(decisions),
      inventory,
    };
  }
}

interface ObjectLabelInput {
  assets: StoredPrincipalAssetRecord[];
  cadences: StoredPrincipalCadenceRecord[];
  commitments: StoredPrincipalCommitmentRecord[];
  decisions: StoredPrincipalDecisionRecord[];
  risks: StoredPrincipalRiskRecord[];
}

interface FocusInput {
  risks: StoredPrincipalRiskRecord[];
  blockingEdges: StoredPrincipalOperationEdgeRecord[];
  overdueCadences: StoredPrincipalCadenceRecord[];
  overdueCommitments: StoredPrincipalCommitmentRecord[];
  atRiskCommitments: StoredPrincipalCommitmentRecord[];
  watchAssets: StoredPrincipalAssetRecord[];
  assetCoverageById: Map<string, AssetFocusCoverage>;
  labels: (type: string, id: string) => string;
}

interface AssetFocusCoverage {
  hasRisk: boolean;
  hasActiveRisk: boolean;
  hasActiveCadence: boolean;
}

interface InventoryInput {
  assets: StoredPrincipalAssetRecord[];
  activeAssets: StoredPrincipalAssetRecord[];
  watchAssets: StoredPrincipalAssetRecord[];
  risks: StoredPrincipalRiskRecord[];
  activeRisks: StoredPrincipalRiskRecord[];
  openRisks: StoredPrincipalRiskRecord[];
  highOrCriticalRisks: StoredPrincipalRiskRecord[];
  cadences: StoredPrincipalCadenceRecord[];
  activeCadences: StoredPrincipalCadenceRecord[];
  overdueCadences: StoredPrincipalCadenceRecord[];
  upcomingCadences: StoredPrincipalCadenceRecord[];
  commitments: StoredPrincipalCommitmentRecord[];
  activeCommitments: StoredPrincipalCommitmentRecord[];
  atRiskCommitments: StoredPrincipalCommitmentRecord[];
  overdueCommitments: StoredPrincipalCommitmentRecord[];
  doneCommitments: StoredPrincipalCommitmentRecord[];
  decisions: StoredPrincipalDecisionRecord[];
  activeDecisions: StoredPrincipalDecisionRecord[];
  supersededDecisions: StoredPrincipalDecisionRecord[];
  edges: StoredPrincipalOperationEdgeRecord[];
  activeEdges: StoredPrincipalOperationEdgeRecord[];
  blockingEdges: StoredPrincipalOperationEdgeRecord[];
}

function buildInventory(input: InventoryInput): PrincipalOperationsBossViewInventory {
  return {
    assets: {
      total: input.assets.filter((item) => item.status !== "archived").length,
      active: input.activeAssets.length,
      watch: input.watchAssets.length,
    },
    risks: {
      total: input.risks.filter((item) => item.status !== "archived").length,
      open: input.openRisks.length,
      watch: input.activeRisks.filter((item) => item.status === "watch").length,
      highOrCriticalOpen: input.highOrCriticalRisks.length,
    },
    cadences: {
      total: input.cadences.filter((item) => item.status !== "archived").length,
      active: input.activeCadences.length,
      overdue: input.overdueCadences.length,
      upcoming: input.upcomingCadences.length,
    },
    commitments: {
      total: input.commitments.filter((item) => item.status !== "archived").length,
      active: input.activeCommitments.length,
      atRisk: input.atRiskCommitments.length,
      overdue: input.overdueCommitments.length,
      done: input.doneCommitments.length,
    },
    decisions: {
      total: input.decisions.filter((item) => item.status !== "archived").length,
      active: input.activeDecisions.length,
      superseded: input.supersededDecisions.length,
    },
    edges: {
      total: input.edges.filter((item) => item.status !== "archived").length,
      active: input.activeEdges.length,
      blocking: input.blockingEdges.length,
    },
  };
}

function buildHeadline(inventory: PrincipalOperationsBossViewInventory): PrincipalOperationsBossViewHeadline {
  if (
    inventory.risks.highOrCriticalOpen > 0
    || inventory.edges.blocking > 0
    || inventory.commitments.atRisk > 0
    || inventory.commitments.overdue > 0
  ) {
    return {
      tone: "red",
      title: "今天先处理红灯",
      summary: `有 ${inventory.risks.highOrCriticalOpen} 个高危未收口风险、${inventory.edges.blocking} 条阻塞关系、${inventory.commitments.atRisk} 个 at_risk 承诺、${inventory.commitments.overdue} 个逾期承诺，需要先确认 owner、影响面和下一步动作。`,
    };
  }

  if (inventory.cadences.overdue > 0 || inventory.assets.watch > 0 || inventory.risks.open > 0) {
    return {
      tone: "amber",
      title: "运营面有待跟进",
      summary: `有 ${inventory.cadences.overdue} 个逾期节奏、${inventory.assets.watch} 个 watch 资产、${inventory.risks.open} 个 open 风险，适合先做一轮收口。`,
    };
  }

  return {
    tone: "green",
    title: "运营面暂时平稳",
    summary: "当前没有明显红灯；可以继续补资产、决策、风险、节奏、承诺和关系边，让老板视图更有真相密度。",
  };
}

function buildMetrics(inventory: PrincipalOperationsBossViewInventory): PrincipalOperationsBossViewMetric[] {
  return [
    {
      key: "active_assets",
      label: "活跃资产",
      value: inventory.assets.active,
      tone: inventory.assets.active > 0 ? "green" : "neutral",
      detail: `${inventory.assets.watch} 个资产处于 watch。`,
    },
    {
      key: "open_risks",
      label: "未收口风险",
      value: inventory.risks.open + inventory.risks.watch,
      tone: inventory.risks.highOrCriticalOpen > 0 ? "red" : inventory.risks.open > 0 ? "amber" : "green",
      detail: `${inventory.risks.highOrCriticalOpen} 个 high / critical。`,
    },
    {
      key: "overdue_cadences",
      label: "逾期节奏",
      value: inventory.cadences.overdue,
      tone: inventory.cadences.overdue > 0 ? "amber" : "green",
      detail: `${inventory.cadences.upcoming} 个节奏 7 天内到期。`,
    },
    {
      key: "blocking_edges",
      label: "阻塞关系",
      value: inventory.edges.blocking,
      tone: inventory.edges.blocking > 0 ? "red" : "green",
      detail: `${inventory.edges.active} 条 active 关系边。`,
    },
    {
      key: "active_commitments",
      label: "进行中承诺",
      value: inventory.commitments.active,
      tone: inventory.commitments.atRisk > 0 || inventory.commitments.overdue > 0
        ? "red"
        : inventory.commitments.active > 0
          ? "green"
          : "neutral",
      detail: `${inventory.commitments.atRisk} 个 at_risk，${inventory.commitments.overdue} 个已逾期。`,
    },
    {
      key: "active_decisions",
      label: "有效决策",
      value: inventory.decisions.active,
      tone: inventory.decisions.active > 0 ? "green" : "neutral",
      detail: `${inventory.decisions.superseded} 条已被替代。`,
    },
  ];
}

function buildFocusItems(input: FocusInput): PrincipalOperationsBossViewFocusItem[] {
  const overdueCommitmentIds = new Set(input.overdueCommitments.map((commitment) => commitment.commitmentId));
  const riskItems = [...input.risks]
    .sort(compareRisks)
    .map((risk): PrincipalOperationsBossViewFocusItem => ({
      objectType: "risk",
      objectId: risk.riskId,
      title: risk.title,
      label: `${risk.severity} / ${risk.status}`,
      tone: risk.severity === "critical" ? "red" : "amber",
      summary: risk.summary ?? buildRelatedSummary("关联资产", risk.relatedAssetIds, input.labels, "asset"),
      actionLabel: "确认 owner / 缓解动作",
    }));
  const edgeItems = input.blockingEdges.map((edge): PrincipalOperationsBossViewFocusItem => ({
    objectType: "operation_edge",
    objectId: edge.edgeId,
    title: edge.label ?? `${input.labels(edge.fromObjectType, edge.fromObjectId)} 阻塞 ${input.labels(edge.toObjectType, edge.toObjectId)}`,
    label: "blocks",
    tone: "red",
    summary: edge.summary || `${input.labels(edge.fromObjectType, edge.fromObjectId)} -> ${input.labels(edge.toObjectType, edge.toObjectId)}`,
    actionLabel: "拆解阻塞关系",
  }));
  const cadenceItems = [...input.overdueCadences]
    .sort(compareCadencesByNextRun)
    .map((cadence): PrincipalOperationsBossViewFocusItem => ({
      objectType: "cadence",
      objectId: cadence.cadenceId,
      title: cadence.title,
      label: "cadence overdue",
      tone: "amber",
      summary: cadence.summary ?? `下一次执行时间：${cadence.nextRunAt}`,
      actionLabel: "恢复节奏或暂停",
    }));
  const commitmentItems = [...input.atRiskCommitments, ...input.overdueCommitments]
    .filter(dedupeCommitments)
    .sort(compareCommitmentsByDueAt)
    .map((commitment): PrincipalOperationsBossViewFocusItem => ({
      objectType: "commitment",
      objectId: commitment.commitmentId,
      title: commitment.title,
      label: `${commitment.status} / due ${commitment.dueAt}`,
      tone: commitment.status === "at_risk" || overdueCommitmentIds.has(commitment.commitmentId) ? "red" : "amber",
      summary: commitment.summary ?? buildRelatedSummary("关联风险", commitment.linkedRiskIds, input.labels, "risk"),
      actionLabel: "确认承诺 owner / 截止动作",
    }));
  const assetItems = input.watchAssets.map((asset): PrincipalOperationsBossViewFocusItem => {
    const coverage = input.assetCoverageById.get(asset.assetId) ?? {
      hasRisk: false,
      hasActiveRisk: false,
      hasActiveCadence: false,
    };

    return {
      objectType: "asset",
      objectId: asset.assetId,
      title: asset.name,
      label: `${asset.kind} / watch`,
      tone: "amber",
      summary: asset.summary ?? buildWatchAssetSummary(coverage),
      actionLabel: resolveWatchAssetActionLabel(coverage),
    };
  });

  return [...riskItems, ...edgeItems, ...commitmentItems, ...cadenceItems, ...assetItems].slice(0, 8);
}

function buildAssetCoverageById(input: {
  risks: StoredPrincipalRiskRecord[];
  cadences: StoredPrincipalCadenceRecord[];
}): Map<string, AssetFocusCoverage> {
  const coverageById = new Map<string, AssetFocusCoverage>();
  const ensureCoverage = (assetId: string): AssetFocusCoverage => {
    const existing = coverageById.get(assetId);

    if (existing) {
      return existing;
    }

    const created: AssetFocusCoverage = {
      hasRisk: false,
      hasActiveRisk: false,
      hasActiveCadence: false,
    };
    coverageById.set(assetId, created);
    return created;
  };

  for (const risk of input.risks) {
    if (risk.status === "archived") {
      continue;
    }

    for (const assetId of risk.relatedAssetIds) {
      const coverage = ensureCoverage(assetId);
      coverage.hasRisk = true;
      coverage.hasActiveRisk ||= risk.status === "open" || risk.status === "watch";
    }
  }

  for (const cadence of input.cadences) {
    if (cadence.status !== "active") {
      continue;
    }

    for (const assetId of cadence.relatedAssetIds) {
      ensureCoverage(assetId).hasActiveCadence = true;
    }
  }

  return coverageById;
}

function buildWatchAssetSummary(coverage: AssetFocusCoverage): string {
  if (coverage.hasRisk && coverage.hasActiveCadence) {
    return "该资产处于 watch，已有风险和节奏事实，适合复查观察结论。";
  }

  return "该资产处于 watch，需要补负责人、风险或固定巡检节奏。";
}

function resolveWatchAssetActionLabel(coverage: AssetFocusCoverage): string {
  if (coverage.hasActiveRisk && coverage.hasActiveCadence) {
    return "跟进风险和节奏";
  }

  if (coverage.hasRisk && coverage.hasActiveCadence) {
    return "复查观察结论";
  }

  if (coverage.hasRisk) {
    return "补巡检节奏";
  }

  if (coverage.hasActiveCadence) {
    return "补风险判断";
  }

  return "补风险或节奏";
}

function buildRelationItems(
  edges: StoredPrincipalOperationEdgeRecord[],
  labels: (type: string, id: string) => string,
): PrincipalOperationsBossViewRelationItem[] {
  return [...edges]
    .sort(compareEdges)
    .slice(0, 8)
    .map((edge) => ({
      edgeId: edge.edgeId,
      relationType: edge.relationType,
      tone: resolveRelationTone(edge.relationType),
      label: edge.label ?? edge.relationType,
      fromLabel: labels(edge.fromObjectType, edge.fromObjectId),
      toLabel: labels(edge.toObjectType, edge.toObjectId),
      summary: edge.summary ?? `${labels(edge.fromObjectType, edge.fromObjectId)} -> ${labels(edge.toObjectType, edge.toObjectId)}`,
    }));
}

function buildRecentDecisions(decisions: StoredPrincipalDecisionRecord[]): PrincipalOperationsBossViewDecisionItem[] {
  return decisions
    .filter((item) => item.status !== "archived")
    .sort((left, right) => Date.parse(right.decidedAt) - Date.parse(left.decidedAt))
    .slice(0, 5)
    .map((decision) => ({
      decisionId: decision.decisionId,
      title: decision.title,
      status: decision.status,
      decidedAt: decision.decidedAt,
      summary: decision.summary ?? "尚未补充决策摘要。",
    }));
}

function buildObjectLabelResolver(input: ObjectLabelInput): (type: string, id: string) => string {
  const labels = new Map<string, string>();

  for (const asset of input.assets) {
    labels.set(`asset:${asset.assetId}`, asset.name);
  }
  for (const cadence of input.cadences) {
    labels.set(`cadence:${cadence.cadenceId}`, cadence.title);
  }
  for (const commitment of input.commitments) {
    labels.set(`commitment:${commitment.commitmentId}`, commitment.title);
  }
  for (const decision of input.decisions) {
    labels.set(`decision:${decision.decisionId}`, decision.title);
  }
  for (const risk of input.risks) {
    labels.set(`risk:${risk.riskId}`, risk.title);
  }

  return (type, id) => labels.get(`${type}:${id}`) ?? `${type}: ${id}`;
}

function isEffectiveBlockingEdge(
  edge: StoredPrincipalOperationEdgeRecord,
  input: EdgeObjectState,
): boolean {
  if (edge.relationType !== "blocks" || edge.status !== "active") {
    return false;
  }

  return isEndpointNotClosed(edge.fromObjectType, edge.fromObjectId, input)
    && isEndpointNotClosed(edge.toObjectType, edge.toObjectId, input);
}

interface EdgeObjectState {
  risksById: Map<string, StoredPrincipalRiskRecord>;
  commitmentsById: Map<string, StoredPrincipalCommitmentRecord>;
}

function buildEdgeObjectState(input: {
  risks: StoredPrincipalRiskRecord[];
  commitments: StoredPrincipalCommitmentRecord[];
}): EdgeObjectState {
  return {
    risksById: new Map(input.risks.map((risk) => [risk.riskId, risk])),
    commitmentsById: new Map(input.commitments.map((commitment) => [commitment.commitmentId, commitment])),
  };
}

function isEndpointNotClosed(
  objectType: string,
  objectId: string,
  input: EdgeObjectState,
): boolean {
  if (objectType === "risk") {
    const risk = input.risksById.get(objectId);
    return !risk || risk.status === "open" || risk.status === "watch";
  }

  if (objectType === "commitment") {
    const commitment = input.commitmentsById.get(objectId);
    return !commitment
      || commitment.status === "planned"
      || commitment.status === "active"
      || commitment.status === "at_risk";
  }

  return true;
}

function buildRelatedSummary(
  label: string,
  ids: string[],
  labels: (type: string, id: string) => string,
  objectType: string,
): string {
  if (ids.length === 0) {
    return "尚未补充摘要。";
  }

  return `${label}：${ids.map((id) => labels(objectType, id)).join("、")}`;
}

function compareRisks(left: StoredPrincipalRiskRecord, right: StoredPrincipalRiskRecord): number {
  const severityDelta = riskSeverityRank(right.severity) - riskSeverityRank(left.severity);

  if (severityDelta !== 0) {
    return severityDelta;
  }

  return Date.parse(right.detectedAt) - Date.parse(left.detectedAt);
}

function compareCadencesByNextRun(
  left: StoredPrincipalCadenceRecord,
  right: StoredPrincipalCadenceRecord,
): number {
  return Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt);
}

function compareCommitmentsByDueAt(
  left: StoredPrincipalCommitmentRecord,
  right: StoredPrincipalCommitmentRecord,
): number {
  return Date.parse(left.dueAt) - Date.parse(right.dueAt);
}

function dedupeCommitments(
  commitment: StoredPrincipalCommitmentRecord,
  index: number,
  commitments: StoredPrincipalCommitmentRecord[],
): boolean {
  return commitments.findIndex((item) => item.commitmentId === commitment.commitmentId) === index;
}

function compareEdges(
  left: StoredPrincipalOperationEdgeRecord,
  right: StoredPrincipalOperationEdgeRecord,
): number {
  const priorityDelta = relationPriority(left.relationType) - relationPriority(right.relationType);

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function riskSeverityRank(value: StoredPrincipalRiskRecord["severity"]): number {
  switch (value) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function relationPriority(value: StoredPrincipalOperationEdgeRecord["relationType"]): number {
  switch (value) {
    case "blocks":
      return 1;
    case "depends_on":
      return 2;
    case "mitigates":
      return 3;
    case "tracks":
      return 4;
    case "supersedes":
      return 5;
    case "evidence_for":
      return 6;
    case "relates_to":
      return 7;
  }
}

function resolveRelationTone(value: StoredPrincipalOperationEdgeRecord["relationType"]): PrincipalOperationsBossViewTone {
  switch (value) {
    case "blocks":
      return "red";
    case "depends_on":
      return "amber";
    case "mitigates":
    case "tracks":
      return "green";
    case "evidence_for":
    case "relates_to":
    case "supersedes":
      return "neutral";
  }
}

function isPastOrEqual(value: string, nowMs: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= nowMs;
}

function isWithinUpcomingWindow(value: string, nowMs: number): boolean {
  const timestamp = Date.parse(value);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  return Number.isFinite(timestamp) && timestamp > nowMs && timestamp <= nowMs + sevenDaysMs;
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeTimestamp(value?: string): string {
  const normalized = value?.trim();
  return normalized || new Date().toISOString();
}
