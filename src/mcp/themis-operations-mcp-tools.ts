import { PrincipalAssetsService } from "../core/principal-assets-service.js";
import { PrincipalCadencesService } from "../core/principal-cadences-service.js";
import { PrincipalCommitmentsService } from "../core/principal-commitments-service.js";
import { PrincipalDecisionsService } from "../core/principal-decisions-service.js";
import { PrincipalOperationEdgesService } from "../core/principal-operation-edges-service.js";
import { PrincipalOperationsBossViewService } from "../core/principal-operations-boss-view-service.js";
import { PrincipalRisksService } from "../core/principal-risks-service.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  PrincipalOperationEdgeObjectType,
  PrincipalOperationEdgeRelationType,
  PrincipalOperationEdgeStatus,
  StoredPrincipalAssetRecord,
  StoredPrincipalCadenceRecord,
  StoredPrincipalCommitmentRecord,
  StoredPrincipalDecisionRecord,
  StoredPrincipalOperationEdgeRecord,
  StoredPrincipalRiskRecord,
} from "../types/index.js";
import {
  PRINCIPAL_ASSET_KINDS,
  PRINCIPAL_ASSET_STATUSES,
  PRINCIPAL_CADENCE_FREQUENCIES,
  PRINCIPAL_CADENCE_STATUSES,
  PRINCIPAL_COMMITMENT_STATUSES,
  PRINCIPAL_DECISION_STATUSES,
  PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES,
  PRINCIPAL_OPERATION_EDGE_RELATION_TYPES,
  PRINCIPAL_OPERATION_EDGE_STATUSES,
  PRINCIPAL_RISK_SEVERITIES,
  PRINCIPAL_RISK_STATUSES,
  PRINCIPAL_RISK_TYPES,
  normalizePrincipalAssetRefs,
  normalizePrincipalCommitmentEvidenceRefs,
  normalizePrincipalCommitmentMilestones,
  normalizePrincipalCommitmentProgressPercent,
} from "../types/index.js";

const MAX_LIST_LIMIT = 100;
const OPERATION_OBJECT_TYPES = ["asset", "decision", "risk", "cadence", "commitment"] as const;

type OperationObjectType = (typeof OPERATION_OBJECT_TYPES)[number];
type OperationObjectRecord =
  | StoredPrincipalAssetRecord
  | StoredPrincipalDecisionRecord
  | StoredPrincipalRiskRecord
  | StoredPrincipalCadenceRecord
  | StoredPrincipalCommitmentRecord;

interface IdentitySnapshot {
  principalId: string;
}

export interface ThemisOperationsMcpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ThemisOperationsMcpToolResult {
  summary: string;
  structuredContent: Record<string, unknown>;
}

export interface ThemisOperationsMcpToolsOptions {
  registry: SqliteCodexSessionRegistry;
}

export class ThemisOperationsMcpTools {
  private readonly assetsService: PrincipalAssetsService;
  private readonly cadencesService: PrincipalCadencesService;
  private readonly commitmentsService: PrincipalCommitmentsService;
  private readonly decisionsService: PrincipalDecisionsService;
  private readonly edgesService: PrincipalOperationEdgesService;
  private readonly risksService: PrincipalRisksService;
  private readonly bossViewService: PrincipalOperationsBossViewService;

  constructor(options: ThemisOperationsMcpToolsOptions) {
    this.edgesService = new PrincipalOperationEdgesService({ registry: options.registry });
    this.assetsService = new PrincipalAssetsService({ registry: options.registry });
    this.decisionsService = new PrincipalDecisionsService({
      registry: options.registry,
      operationEdgesService: this.edgesService,
    });
    this.risksService = new PrincipalRisksService({
      registry: options.registry,
      operationEdgesService: this.edgesService,
    });
    this.cadencesService = new PrincipalCadencesService({
      registry: options.registry,
      operationEdgesService: this.edgesService,
    });
    this.commitmentsService = new PrincipalCommitmentsService({
      registry: options.registry,
      operationEdgesService: this.edgesService,
    });
    this.bossViewService = new PrincipalOperationsBossViewService({
      assetsService: this.assetsService,
      cadencesService: this.cadencesService,
      commitmentsService: this.commitmentsService,
      decisionsService: this.decisionsService,
      edgesService: this.edgesService,
      risksService: this.risksService,
    });
  }

  callTool(
    name: string,
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    switch (name) {
      case "list_operation_objects":
        return this.listOperationObjects(argumentsRecord, identity);
      case "create_operation_object":
        return this.createOperationObject(argumentsRecord, identity);
      case "update_operation_object":
        return this.updateOperationObject(argumentsRecord, identity);
      case "list_operation_edges":
        return this.listOperationEdges(argumentsRecord, identity);
      case "create_operation_edge":
        return this.createOperationEdge(argumentsRecord, identity);
      case "update_operation_edge":
        return this.updateOperationEdge(argumentsRecord, identity);
      case "query_operation_graph":
        return this.queryOperationGraph(argumentsRecord, identity);
      case "get_operations_boss_view":
        return this.getOperationsBossView(argumentsRecord, identity);
      default:
        throw new Error(`Unknown operations tool: ${name}`);
    }
  }

  private listOperationObjects(
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    const objectType = expectOperationObjectType(argumentsRecord.objectType);
    const principalId = identity.principalId;
    const query = normalizeOptionalMultilineText(argumentsRecord.query);
    const includeArchived = argumentsRecord.includeArchived === true;
    const limit = normalizeOptionalListLimit(argumentsRecord.limit);
    let objects: OperationObjectRecord[];

    switch (objectType) {
      case "asset":
        objects = this.assetsService.listAssets({
          principalId,
          ...(argumentsRecord.status !== undefined
            ? { status: expectEnumText(argumentsRecord.status, PRINCIPAL_ASSET_STATUSES, "Unsupported asset status.") }
            : {}),
          ...(argumentsRecord.kind !== undefined
            ? { kind: expectEnumText(argumentsRecord.kind, PRINCIPAL_ASSET_KINDS, "Unsupported asset kind.") }
            : {}),
          ...(query ? { query } : {}),
          ...(includeArchived ? { includeArchived: true } : {}),
          ...(typeof limit === "number" ? { limit } : {}),
        });
        break;
      case "decision":
        objects = this.decisionsService.listDecisions({
          principalId,
          ...(argumentsRecord.status !== undefined
            ? { status: expectEnumText(argumentsRecord.status, PRINCIPAL_DECISION_STATUSES, "Unsupported decision status.") }
            : {}),
          ...(query ? { query } : {}),
          ...(includeArchived ? { includeArchived: true } : {}),
          ...(typeof limit === "number" ? { limit } : {}),
        });
        break;
      case "risk":
        objects = this.risksService.listRisks({
          principalId,
          ...(argumentsRecord.status !== undefined
            ? { status: expectEnumText(argumentsRecord.status, PRINCIPAL_RISK_STATUSES, "Unsupported risk status.") }
            : {}),
          ...(argumentsRecord.type !== undefined
            ? { type: expectEnumText(argumentsRecord.type, PRINCIPAL_RISK_TYPES, "Unsupported risk type.") }
            : {}),
          ...(argumentsRecord.severity !== undefined
            ? { severity: expectEnumText(argumentsRecord.severity, PRINCIPAL_RISK_SEVERITIES, "Unsupported risk severity.") }
            : {}),
          ...(query ? { query } : {}),
          ...(includeArchived ? { includeArchived: true } : {}),
          ...(typeof limit === "number" ? { limit } : {}),
        });
        break;
      case "cadence":
        objects = this.cadencesService.listCadences({
          principalId,
          ...(argumentsRecord.status !== undefined
            ? { status: expectEnumText(argumentsRecord.status, PRINCIPAL_CADENCE_STATUSES, "Unsupported cadence status.") }
            : {}),
          ...(argumentsRecord.frequency !== undefined
            ? { frequency: expectEnumText(argumentsRecord.frequency, PRINCIPAL_CADENCE_FREQUENCIES, "Unsupported cadence frequency.") }
            : {}),
          ...(query ? { query } : {}),
          ...(includeArchived ? { includeArchived: true } : {}),
          ...(typeof limit === "number" ? { limit } : {}),
        });
        break;
      case "commitment":
        objects = this.commitmentsService.listCommitments({
          principalId,
          ...(argumentsRecord.status !== undefined
            ? { status: expectEnumText(argumentsRecord.status, PRINCIPAL_COMMITMENT_STATUSES, "Unsupported commitment status.") }
            : {}),
          ...(query ? { query } : {}),
          ...(includeArchived ? { includeArchived: true } : {}),
          ...(typeof limit === "number" ? { limit } : {}),
        });
        break;
    }

    return {
      summary: buildOperationObjectListSummary(objectType, objects),
      structuredContent: {
        identity,
        objectType,
        objects,
      },
    };
  }

  private createOperationObject(
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    const objectType = expectOperationObjectType(argumentsRecord.objectType);
    const fields = expectRecord(argumentsRecord.fields, "fields must be an object.");
    const object = this.createObjectByType(objectType, identity.principalId, fields);

    return {
      summary: buildOperationObjectMutationSummary("已创建", objectType, object),
      structuredContent: {
        identity,
        objectType,
        object,
      },
    };
  }

  private updateOperationObject(
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    const objectType = expectOperationObjectType(argumentsRecord.objectType);
    const objectId = expectRequiredText(argumentsRecord.objectId, "objectId is required.");
    const fields = expectRecord(argumentsRecord.fields, "fields must be an object.");
    const object = this.updateObjectByType(objectType, identity.principalId, objectId, fields);

    return {
      summary: buildOperationObjectMutationSummary("已更新", objectType, object),
      structuredContent: {
        identity,
        objectType,
        object,
      },
    };
  }

  private listOperationEdges(
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    const query = normalizeOptionalMultilineText(argumentsRecord.query);
    const limit = normalizeOptionalListLimit(argumentsRecord.limit);
    const edges = this.edgesService.listEdges({
      principalId: identity.principalId,
      ...(argumentsRecord.fromObjectType !== undefined
        ? {
          fromObjectType: expectEnumText(
            argumentsRecord.fromObjectType,
            PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES,
            "Unsupported fromObjectType.",
          ),
        }
        : {}),
      ...optionalTextField("fromObjectId", argumentsRecord.fromObjectId),
      ...(argumentsRecord.toObjectType !== undefined
        ? {
          toObjectType: expectEnumText(
            argumentsRecord.toObjectType,
            PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES,
            "Unsupported toObjectType.",
          ),
        }
        : {}),
      ...optionalTextField("toObjectId", argumentsRecord.toObjectId),
      ...(argumentsRecord.relationType !== undefined
        ? {
          relationType: expectEnumText(
            argumentsRecord.relationType,
            PRINCIPAL_OPERATION_EDGE_RELATION_TYPES,
            "Unsupported relationType.",
          ),
        }
        : {}),
      ...(argumentsRecord.status !== undefined
        ? { status: expectEnumText(argumentsRecord.status, PRINCIPAL_OPERATION_EDGE_STATUSES, "Unsupported edge status.") }
        : {}),
      ...(query ? { query } : {}),
      ...(argumentsRecord.includeArchived === true ? { includeArchived: true } : {}),
      ...(typeof limit === "number" ? { limit } : {}),
    });

    return {
      summary: buildOperationEdgeListSummary(edges),
      structuredContent: {
        identity,
        edges,
      },
    };
  }

  private createOperationEdge(
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    const edge = this.edgesService.createEdge({
      principalId: identity.principalId,
      fromObjectType: expectOperationEdgeObjectType(argumentsRecord.fromObjectType, "fromObjectType is required."),
      fromObjectId: expectRequiredText(argumentsRecord.fromObjectId, "fromObjectId is required."),
      toObjectType: expectOperationEdgeObjectType(argumentsRecord.toObjectType, "toObjectType is required."),
      toObjectId: expectRequiredText(argumentsRecord.toObjectId, "toObjectId is required."),
      ...(argumentsRecord.relationType !== undefined
        ? {
          relationType: expectEnumText(
            argumentsRecord.relationType,
            PRINCIPAL_OPERATION_EDGE_RELATION_TYPES,
            "Unsupported relationType.",
          ),
        }
        : {}),
      ...(argumentsRecord.status !== undefined
        ? { status: expectEnumText(argumentsRecord.status, PRINCIPAL_OPERATION_EDGE_STATUSES, "Unsupported edge status.") }
        : {}),
      ...optionalMultilineTextField("label", argumentsRecord.label),
      ...optionalMultilineTextField("summary", argumentsRecord.summary),
    });

    return {
      summary: buildOperationEdgeMutationSummary("已创建", edge),
      structuredContent: {
        identity,
        edge,
      },
    };
  }

  private updateOperationEdge(
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    const edgeId = expectRequiredText(argumentsRecord.edgeId, "edgeId is required.");
    const existing = this.edgesService.getEdge(identity.principalId, edgeId);

    if (!existing) {
      throw new Error("Principal operation edge does not exist.");
    }

    const label = hasOwn(argumentsRecord, "label")
      ? normalizeOptionalMultilineText(argumentsRecord.label)
      : existing.label;
    const summary = hasOwn(argumentsRecord, "summary")
      ? normalizeOptionalMultilineText(argumentsRecord.summary)
      : existing.summary;
    const edge = this.edgesService.updateEdge({
      principalId: identity.principalId,
      edgeId,
      fromObjectType: argumentsRecord.fromObjectType !== undefined
        ? expectOperationEdgeObjectType(argumentsRecord.fromObjectType, "Unsupported fromObjectType.")
        : existing.fromObjectType,
      fromObjectId: normalizeText(argumentsRecord.fromObjectId) ?? existing.fromObjectId,
      toObjectType: argumentsRecord.toObjectType !== undefined
        ? expectOperationEdgeObjectType(argumentsRecord.toObjectType, "Unsupported toObjectType.")
        : existing.toObjectType,
      toObjectId: normalizeText(argumentsRecord.toObjectId) ?? existing.toObjectId,
      relationType: argumentsRecord.relationType !== undefined
        ? expectEnumText(argumentsRecord.relationType, PRINCIPAL_OPERATION_EDGE_RELATION_TYPES, "Unsupported relationType.")
        : existing.relationType,
      status: argumentsRecord.status !== undefined
        ? expectEnumText(argumentsRecord.status, PRINCIPAL_OPERATION_EDGE_STATUSES, "Unsupported edge status.")
        : existing.status,
      ...(label ? { label } : {}),
      ...(summary ? { summary } : {}),
    });

    return {
      summary: buildOperationEdgeMutationSummary("已更新", edge),
      structuredContent: {
        identity,
        edge,
      },
    };
  }

  private queryOperationGraph(
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    const relationTypes = argumentsRecord.relationTypes === undefined
      ? undefined
      : normalizeRelationTypes(argumentsRecord.relationTypes);
    const graph = this.edgesService.queryGraph({
      principalId: identity.principalId,
      rootObjectType: expectOperationEdgeObjectType(argumentsRecord.rootObjectType, "rootObjectType is required."),
      rootObjectId: expectRequiredText(argumentsRecord.rootObjectId, "rootObjectId is required."),
      ...(argumentsRecord.targetObjectType !== undefined
        ? { targetObjectType: expectOperationEdgeObjectType(argumentsRecord.targetObjectType, "Unsupported targetObjectType.") }
        : {}),
      ...optionalTextField("targetObjectId", argumentsRecord.targetObjectId),
      ...(typeof argumentsRecord.maxDepth === "number" ? { maxDepth: argumentsRecord.maxDepth } : {}),
      ...(relationTypes ? { relationTypes } : {}),
      ...(argumentsRecord.includeArchived === true ? { includeArchived: true } : {}),
      ...(typeof argumentsRecord.limit === "number" ? { limit: argumentsRecord.limit } : {}),
    });

    return {
      summary: `对象图已查询：节点 ${graph.nodes.length} 个，边 ${graph.edges.length} 条。`,
      structuredContent: {
        identity,
        graph,
      },
    };
  }

  private getOperationsBossView(
    argumentsRecord: Record<string, unknown>,
    identity: IdentitySnapshot,
  ): ThemisOperationsMcpToolResult {
    const now = normalizeText(argumentsRecord.now);
    const bossView = this.bossViewService.getBossView({
      principalId: identity.principalId,
      ...(now ? { now } : {}),
    });

    return {
      summary: `${bossView.headline.title}：${bossView.headline.summary}`,
      structuredContent: {
        identity,
        bossView,
      },
    };
  }

  private createObjectByType(
    objectType: OperationObjectType,
    principalId: string,
    fields: Record<string, unknown>,
  ): OperationObjectRecord {
    switch (objectType) {
      case "asset":
        return this.assetsService.createAsset({
          principalId,
          kind: expectEnumText(fields.kind, PRINCIPAL_ASSET_KINDS, "fields.kind is required."),
          name: expectRequiredText(fields.name, "fields.name is required."),
          ...(fields.status !== undefined
            ? { status: expectEnumText(fields.status, PRINCIPAL_ASSET_STATUSES, "Unsupported asset status.") }
            : {}),
          ...optionalTextField("ownerPrincipalId", fields.ownerPrincipalId),
          ...optionalMultilineTextField("summary", fields.summary),
          ...(hasOwn(fields, "tags") ? { tags: normalizeStringArray(fields.tags, "fields.tags must be an array of strings.") } : {}),
          ...(hasOwn(fields, "refs") ? { refs: normalizePrincipalAssetRefs(fields.refs) } : {}),
        });
      case "decision":
        return this.decisionsService.createDecision({
          principalId,
          title: expectRequiredText(fields.title, "fields.title is required."),
          ...(fields.status !== undefined
            ? { status: expectEnumText(fields.status, PRINCIPAL_DECISION_STATUSES, "Unsupported decision status.") }
            : {}),
          ...optionalMultilineTextField("summary", fields.summary),
          ...optionalTextField("decidedByPrincipalId", fields.decidedByPrincipalId),
          ...optionalTextField("decidedAt", fields.decidedAt),
          ...(hasOwn(fields, "relatedAssetIds")
            ? { relatedAssetIds: normalizeStringArray(fields.relatedAssetIds, "fields.relatedAssetIds must be an array of strings.") }
            : {}),
          ...(hasOwn(fields, "relatedWorkItemIds")
            ? { relatedWorkItemIds: normalizeStringArray(fields.relatedWorkItemIds, "fields.relatedWorkItemIds must be an array of strings.") }
            : {}),
        });
      case "risk":
        return this.risksService.createRisk({
          principalId,
          title: expectRequiredText(fields.title, "fields.title is required."),
          ...(fields.type !== undefined
            ? { type: expectEnumText(fields.type, PRINCIPAL_RISK_TYPES, "Unsupported risk type.") }
            : {}),
          ...(fields.severity !== undefined
            ? { severity: expectEnumText(fields.severity, PRINCIPAL_RISK_SEVERITIES, "Unsupported risk severity.") }
            : {}),
          ...(fields.status !== undefined
            ? { status: expectEnumText(fields.status, PRINCIPAL_RISK_STATUSES, "Unsupported risk status.") }
            : {}),
          ...optionalTextField("ownerPrincipalId", fields.ownerPrincipalId),
          ...optionalMultilineTextField("summary", fields.summary),
          ...optionalTextField("detectedAt", fields.detectedAt),
          ...(hasOwn(fields, "relatedAssetIds")
            ? { relatedAssetIds: normalizeStringArray(fields.relatedAssetIds, "fields.relatedAssetIds must be an array of strings.") }
            : {}),
          ...(hasOwn(fields, "linkedDecisionIds")
            ? { linkedDecisionIds: normalizeStringArray(fields.linkedDecisionIds, "fields.linkedDecisionIds must be an array of strings.") }
            : {}),
          ...(hasOwn(fields, "relatedWorkItemIds")
            ? { relatedWorkItemIds: normalizeStringArray(fields.relatedWorkItemIds, "fields.relatedWorkItemIds must be an array of strings.") }
            : {}),
        });
      case "cadence":
        return this.cadencesService.createCadence({
          principalId,
          title: expectRequiredText(fields.title, "fields.title is required."),
          ...(fields.frequency !== undefined
            ? { frequency: expectEnumText(fields.frequency, PRINCIPAL_CADENCE_FREQUENCIES, "Unsupported cadence frequency.") }
            : {}),
          ...(fields.status !== undefined
            ? { status: expectEnumText(fields.status, PRINCIPAL_CADENCE_STATUSES, "Unsupported cadence status.") }
            : {}),
          ...optionalTextField("nextRunAt", fields.nextRunAt),
          ...optionalTextField("ownerPrincipalId", fields.ownerPrincipalId),
          ...optionalTextField("playbookRef", fields.playbookRef),
          ...optionalMultilineTextField("summary", fields.summary),
          ...(hasOwn(fields, "relatedAssetIds")
            ? { relatedAssetIds: normalizeStringArray(fields.relatedAssetIds, "fields.relatedAssetIds must be an array of strings.") }
            : {}),
        });
      case "commitment":
        return this.commitmentsService.createCommitment({
          principalId,
          title: expectRequiredText(fields.title, "fields.title is required."),
          ...(fields.status !== undefined
            ? { status: expectEnumText(fields.status, PRINCIPAL_COMMITMENT_STATUSES, "Unsupported commitment status.") }
            : {}),
          ...optionalTextField("ownerPrincipalId", fields.ownerPrincipalId),
          ...optionalTextField("startsAt", fields.startsAt),
          ...optionalTextField("dueAt", fields.dueAt),
          ...(hasOwn(fields, "progressPercent") ? { progressPercent: normalizePrincipalCommitmentProgressPercent(fields.progressPercent) } : {}),
          ...optionalMultilineTextField("summary", fields.summary),
          ...(hasOwn(fields, "milestones") ? { milestones: normalizePrincipalCommitmentMilestones(fields.milestones, { strictStatus: true }) } : {}),
          ...(hasOwn(fields, "evidenceRefs") ? { evidenceRefs: normalizePrincipalCommitmentEvidenceRefs(fields.evidenceRefs) } : {}),
          ...(hasOwn(fields, "relatedAssetIds")
            ? { relatedAssetIds: normalizeStringArray(fields.relatedAssetIds, "fields.relatedAssetIds must be an array of strings.") }
            : {}),
          ...(hasOwn(fields, "linkedDecisionIds")
            ? { linkedDecisionIds: normalizeStringArray(fields.linkedDecisionIds, "fields.linkedDecisionIds must be an array of strings.") }
            : {}),
          ...(hasOwn(fields, "linkedRiskIds")
            ? { linkedRiskIds: normalizeStringArray(fields.linkedRiskIds, "fields.linkedRiskIds must be an array of strings.") }
            : {}),
          ...(hasOwn(fields, "relatedCadenceIds")
            ? { relatedCadenceIds: normalizeStringArray(fields.relatedCadenceIds, "fields.relatedCadenceIds must be an array of strings.") }
            : {}),
          ...(hasOwn(fields, "relatedWorkItemIds")
            ? { relatedWorkItemIds: normalizeStringArray(fields.relatedWorkItemIds, "fields.relatedWorkItemIds must be an array of strings.") }
            : {}),
        });
    }
  }

  private updateObjectByType(
    objectType: OperationObjectType,
    principalId: string,
    objectId: string,
    fields: Record<string, unknown>,
  ): OperationObjectRecord {
    switch (objectType) {
      case "asset": {
        const existing = this.assetsService.getAsset(principalId, objectId);
        if (!existing) {
          throw new Error("Principal asset does not exist.");
        }
        const ownerPrincipalId = hasOwn(fields, "ownerPrincipalId")
          ? normalizeText(fields.ownerPrincipalId)
          : existing.ownerPrincipalId;
        const summary = hasOwn(fields, "summary")
          ? normalizeOptionalMultilineText(fields.summary)
          : existing.summary;

        return this.assetsService.updateAsset({
          principalId,
          assetId: objectId,
          kind: fields.kind !== undefined
            ? expectEnumText(fields.kind, PRINCIPAL_ASSET_KINDS, "Unsupported asset kind.")
            : existing.kind,
          name: normalizeText(fields.name) ?? existing.name,
          status: fields.status !== undefined
            ? expectEnumText(fields.status, PRINCIPAL_ASSET_STATUSES, "Unsupported asset status.")
            : existing.status,
          ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
          ...(summary ? { summary } : {}),
          tags: hasOwn(fields, "tags")
            ? normalizeStringArray(fields.tags, "fields.tags must be an array of strings.")
            : existing.tags,
          refs: hasOwn(fields, "refs") ? normalizePrincipalAssetRefs(fields.refs) : existing.refs,
        });
      }
      case "decision": {
        const existing = this.decisionsService.getDecision(principalId, objectId);
        if (!existing) {
          throw new Error("Principal decision does not exist.");
        }
        const summary = hasOwn(fields, "summary")
          ? normalizeOptionalMultilineText(fields.summary)
          : existing.summary;
        const decidedByPrincipalId = hasOwn(fields, "decidedByPrincipalId")
          ? normalizeText(fields.decidedByPrincipalId)
          : existing.decidedByPrincipalId;

        return this.decisionsService.updateDecision({
          principalId,
          decisionId: objectId,
          title: normalizeText(fields.title) ?? existing.title,
          status: fields.status !== undefined
            ? expectEnumText(fields.status, PRINCIPAL_DECISION_STATUSES, "Unsupported decision status.")
            : existing.status,
          ...(summary ? { summary } : {}),
          ...(decidedByPrincipalId ? { decidedByPrincipalId } : {}),
          decidedAt: normalizeText(fields.decidedAt) ?? existing.decidedAt,
          relatedAssetIds: hasOwn(fields, "relatedAssetIds")
            ? normalizeStringArray(fields.relatedAssetIds, "fields.relatedAssetIds must be an array of strings.")
            : existing.relatedAssetIds,
          relatedWorkItemIds: hasOwn(fields, "relatedWorkItemIds")
            ? normalizeStringArray(fields.relatedWorkItemIds, "fields.relatedWorkItemIds must be an array of strings.")
            : existing.relatedWorkItemIds,
        });
      }
      case "risk": {
        const existing = this.risksService.getRisk(principalId, objectId);
        if (!existing) {
          throw new Error("Principal risk does not exist.");
        }
        const ownerPrincipalId = hasOwn(fields, "ownerPrincipalId")
          ? normalizeText(fields.ownerPrincipalId)
          : existing.ownerPrincipalId;
        const summary = hasOwn(fields, "summary")
          ? normalizeOptionalMultilineText(fields.summary)
          : existing.summary;

        return this.risksService.updateRisk({
          principalId,
          riskId: objectId,
          type: fields.type !== undefined
            ? expectEnumText(fields.type, PRINCIPAL_RISK_TYPES, "Unsupported risk type.")
            : existing.type,
          title: normalizeText(fields.title) ?? existing.title,
          severity: fields.severity !== undefined
            ? expectEnumText(fields.severity, PRINCIPAL_RISK_SEVERITIES, "Unsupported risk severity.")
            : existing.severity,
          status: fields.status !== undefined
            ? expectEnumText(fields.status, PRINCIPAL_RISK_STATUSES, "Unsupported risk status.")
            : existing.status,
          ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
          ...(summary ? { summary } : {}),
          detectedAt: normalizeText(fields.detectedAt) ?? existing.detectedAt,
          relatedAssetIds: hasOwn(fields, "relatedAssetIds")
            ? normalizeStringArray(fields.relatedAssetIds, "fields.relatedAssetIds must be an array of strings.")
            : existing.relatedAssetIds,
          linkedDecisionIds: hasOwn(fields, "linkedDecisionIds")
            ? normalizeStringArray(fields.linkedDecisionIds, "fields.linkedDecisionIds must be an array of strings.")
            : existing.linkedDecisionIds,
          relatedWorkItemIds: hasOwn(fields, "relatedWorkItemIds")
            ? normalizeStringArray(fields.relatedWorkItemIds, "fields.relatedWorkItemIds must be an array of strings.")
            : existing.relatedWorkItemIds,
        });
      }
      case "cadence": {
        const existing = this.cadencesService.getCadence(principalId, objectId);
        if (!existing) {
          throw new Error("Principal cadence does not exist.");
        }
        const ownerPrincipalId = hasOwn(fields, "ownerPrincipalId")
          ? normalizeText(fields.ownerPrincipalId)
          : existing.ownerPrincipalId;
        const playbookRef = hasOwn(fields, "playbookRef")
          ? normalizeText(fields.playbookRef)
          : existing.playbookRef;
        const summary = hasOwn(fields, "summary")
          ? normalizeOptionalMultilineText(fields.summary)
          : existing.summary;

        return this.cadencesService.updateCadence({
          principalId,
          cadenceId: objectId,
          title: normalizeText(fields.title) ?? existing.title,
          frequency: fields.frequency !== undefined
            ? expectEnumText(fields.frequency, PRINCIPAL_CADENCE_FREQUENCIES, "Unsupported cadence frequency.")
            : existing.frequency,
          status: fields.status !== undefined
            ? expectEnumText(fields.status, PRINCIPAL_CADENCE_STATUSES, "Unsupported cadence status.")
            : existing.status,
          nextRunAt: normalizeText(fields.nextRunAt) ?? existing.nextRunAt,
          ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
          ...(playbookRef ? { playbookRef } : {}),
          ...(summary ? { summary } : {}),
          relatedAssetIds: hasOwn(fields, "relatedAssetIds")
            ? normalizeStringArray(fields.relatedAssetIds, "fields.relatedAssetIds must be an array of strings.")
            : existing.relatedAssetIds,
        });
      }
      case "commitment": {
        const existing = this.commitmentsService.getCommitment(principalId, objectId);
        if (!existing) {
          throw new Error("Principal commitment does not exist.");
        }
        const ownerPrincipalId = hasOwn(fields, "ownerPrincipalId")
          ? normalizeText(fields.ownerPrincipalId)
          : existing.ownerPrincipalId;
        const startsAt = hasOwn(fields, "startsAt")
          ? normalizeText(fields.startsAt)
          : existing.startsAt;
        const summary = hasOwn(fields, "summary")
          ? normalizeOptionalMultilineText(fields.summary)
          : existing.summary;

        return this.commitmentsService.updateCommitment({
          principalId,
          commitmentId: objectId,
          title: normalizeText(fields.title) ?? existing.title,
          status: fields.status !== undefined
            ? expectEnumText(fields.status, PRINCIPAL_COMMITMENT_STATUSES, "Unsupported commitment status.")
            : existing.status,
          ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
          ...(startsAt ? { startsAt } : {}),
          dueAt: normalizeText(fields.dueAt) ?? existing.dueAt,
          progressPercent: hasOwn(fields, "progressPercent")
            ? normalizePrincipalCommitmentProgressPercent(fields.progressPercent)
            : existing.progressPercent,
          ...(summary ? { summary } : {}),
          milestones: hasOwn(fields, "milestones")
            ? normalizePrincipalCommitmentMilestones(fields.milestones, { strictStatus: true })
            : existing.milestones,
          evidenceRefs: hasOwn(fields, "evidenceRefs")
            ? normalizePrincipalCommitmentEvidenceRefs(fields.evidenceRefs)
            : existing.evidenceRefs,
          relatedAssetIds: hasOwn(fields, "relatedAssetIds")
            ? normalizeStringArray(fields.relatedAssetIds, "fields.relatedAssetIds must be an array of strings.")
            : existing.relatedAssetIds,
          linkedDecisionIds: hasOwn(fields, "linkedDecisionIds")
            ? normalizeStringArray(fields.linkedDecisionIds, "fields.linkedDecisionIds must be an array of strings.")
            : existing.linkedDecisionIds,
          linkedRiskIds: hasOwn(fields, "linkedRiskIds")
            ? normalizeStringArray(fields.linkedRiskIds, "fields.linkedRiskIds must be an array of strings.")
            : existing.linkedRiskIds,
          relatedCadenceIds: hasOwn(fields, "relatedCadenceIds")
            ? normalizeStringArray(fields.relatedCadenceIds, "fields.relatedCadenceIds must be an array of strings.")
            : existing.relatedCadenceIds,
          relatedWorkItemIds: hasOwn(fields, "relatedWorkItemIds")
            ? normalizeStringArray(fields.relatedWorkItemIds, "fields.relatedWorkItemIds must be an array of strings.")
            : existing.relatedWorkItemIds,
        });
      }
    }
  }
}

export function buildThemisOperationsToolDefinitions(): ThemisOperationsMcpToolDefinition[] {
  return [
    {
      name: "list_operation_objects",
      title: "List Operation Objects",
      description: "列出 Themis 运营中枢对象。objectType 支持 asset / decision / risk / cadence / commitment。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          objectType: buildOperationObjectTypeSchema(),
          status: { type: "string", description: "可选。按该对象类型的状态过滤。" },
          kind: { type: "string", enum: [...PRINCIPAL_ASSET_KINDS], description: "asset 专用过滤。" },
          type: { type: "string", enum: [...PRINCIPAL_RISK_TYPES], description: "risk 专用过滤。" },
          severity: { type: "string", enum: [...PRINCIPAL_RISK_SEVERITIES], description: "risk 专用过滤。" },
          frequency: { type: "string", enum: [...PRINCIPAL_CADENCE_FREQUENCIES], description: "cadence 专用过滤。" },
          query: { type: "string", description: "可选。按标题、名称或摘要搜索。" },
          includeArchived: { type: "boolean", description: "可选。是否包含归档对象。" },
          limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
        },
        required: ["objectType"],
      },
    },
    {
      name: "create_operation_object",
      title: "Create Operation Object",
      description: "创建一个机器原生运营对象。fields 根据 objectType 传入对应字段。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          objectType: buildOperationObjectTypeSchema(),
          fields: buildOperationFieldsSchema(),
        },
        required: ["objectType", "fields"],
      },
    },
    {
      name: "update_operation_object",
      title: "Update Operation Object",
      description: "按 objectType 和 objectId 更新运营对象；fields 支持局部字段，未传字段会保留原值。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          objectType: buildOperationObjectTypeSchema(),
          objectId: { type: "string", description: "对象 id，例如 assetId / decisionId / riskId / cadenceId / commitmentId。" },
          fields: buildOperationFieldsSchema(),
        },
        required: ["objectType", "objectId", "fields"],
      },
    },
    {
      name: "list_operation_edges",
      title: "List Operation Edges",
      description: "列出运营对象关系边，可按端点、关系类型、状态或文本查询过滤。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          fromObjectType: buildOperationEdgeObjectTypeSchema(),
          fromObjectId: { type: "string" },
          toObjectType: buildOperationEdgeObjectTypeSchema(),
          toObjectId: { type: "string" },
          relationType: buildOperationRelationTypeSchema(),
          status: buildOperationEdgeStatusSchema(),
          query: { type: "string" },
          includeArchived: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
        },
      },
    },
    {
      name: "create_operation_edge",
      title: "Create Operation Edge",
      description: "创建一条运营对象关系边，用于表达依赖、阻塞、缓解、跟踪、证据等公司事实。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          fromObjectType: buildOperationEdgeObjectTypeSchema(),
          fromObjectId: { type: "string" },
          toObjectType: buildOperationEdgeObjectTypeSchema(),
          toObjectId: { type: "string" },
          relationType: buildOperationRelationTypeSchema(),
          status: buildOperationEdgeStatusSchema(),
          label: { type: "string" },
          summary: { type: "string" },
        },
        required: ["fromObjectType", "fromObjectId", "toObjectType", "toObjectId"],
      },
    },
    {
      name: "update_operation_edge",
      title: "Update Operation Edge",
      description: "局部更新一条运营对象关系边；未传字段会保留原值。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          edgeId: { type: "string" },
          fromObjectType: buildOperationEdgeObjectTypeSchema(),
          fromObjectId: { type: "string" },
          toObjectType: buildOperationEdgeObjectTypeSchema(),
          toObjectId: { type: "string" },
          relationType: buildOperationRelationTypeSchema(),
          status: buildOperationEdgeStatusSchema(),
          label: { type: "string" },
          summary: { type: "string" },
        },
        required: ["edgeId"],
      },
    },
    {
      name: "query_operation_graph",
      title: "Query Operation Graph",
      description: "从一个对象出发查询小深度运营关系子图；可选 target 时返回当前深度内最短路径。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          rootObjectType: buildOperationEdgeObjectTypeSchema(),
          rootObjectId: { type: "string" },
          targetObjectType: buildOperationEdgeObjectTypeSchema(),
          targetObjectId: { type: "string" },
          maxDepth: { type: "integer", minimum: 1, maximum: 4 },
          relationTypes: {
            type: "array",
            items: buildOperationRelationTypeSchema(),
          },
          includeArchived: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 1000 },
        },
        required: ["rootObjectType", "rootObjectId"],
      },
    },
    {
      name: "get_operations_boss_view",
      title: "Get Operations Boss View",
      description: "读取运营中枢只读老板视图，用于人类观测、审计和异常刹车前的状态判断。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          now: { type: "string", description: "可选。用于测试或按指定时间生成视图。" },
        },
      },
    },
  ];
}

function buildOperationObjectTypeSchema(): Record<string, unknown> {
  return {
    type: "string",
    enum: [...OPERATION_OBJECT_TYPES],
  };
}

function buildOperationEdgeObjectTypeSchema(): Record<string, unknown> {
  return {
    type: "string",
    enum: [...PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES],
  };
}

function buildOperationRelationTypeSchema(): Record<string, unknown> {
  return {
    type: "string",
    enum: [...PRINCIPAL_OPERATION_EDGE_RELATION_TYPES],
  };
}

function buildOperationEdgeStatusSchema(): Record<string, unknown> {
  return {
    type: "string",
    enum: [...PRINCIPAL_OPERATION_EDGE_STATUSES],
  };
}

function buildOperationFieldsSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: true,
    description: [
      "asset: kind, name, status, ownerPrincipalId, summary, tags, refs.",
      "decision: title, status, summary, decidedByPrincipalId, decidedAt, relatedAssetIds, relatedWorkItemIds.",
      "risk: title, type, severity, status, ownerPrincipalId, summary, detectedAt, relatedAssetIds, linkedDecisionIds, relatedWorkItemIds.",
      "cadence: title, frequency, status, nextRunAt, ownerPrincipalId, playbookRef, summary, relatedAssetIds.",
      "commitment: title, status, ownerPrincipalId, startsAt, dueAt, progressPercent, summary, milestones (status: planned / active / in_progress / blocked / done), evidenceRefs, relatedAssetIds, linkedDecisionIds, linkedRiskIds, relatedCadenceIds, relatedWorkItemIds.",
    ].join(" "),
  };
}

function buildOperationObjectListSummary(objectType: OperationObjectType, objects: OperationObjectRecord[]): string {
  if (objects.length === 0) {
    return `当前没有匹配的 ${objectType} 对象。`;
  }

  return [
    `共找到 ${objects.length} 个 ${objectType} 对象。`,
    ...objects.map((object, index) => {
      const label = getOperationObjectLabel(objectType, object);
      const status = "status" in object ? object.status : "<unknown>";
      return `${index + 1}. [${status}] ${label} - ${getOperationObjectId(objectType, object)}`;
    }),
  ].join("\n");
}

function buildOperationObjectMutationSummary(
  action: string,
  objectType: OperationObjectType,
  object: OperationObjectRecord,
): string {
  return `${action} ${objectType} ${getOperationObjectLabel(objectType, object)}（${getOperationObjectId(objectType, object)}）。`;
}

function buildOperationEdgeListSummary(edges: StoredPrincipalOperationEdgeRecord[]): string {
  if (edges.length === 0) {
    return "当前没有匹配的运营关系边。";
  }

  return [
    `共找到 ${edges.length} 条运营关系边。`,
    ...edges.map((edge, index) =>
      `${index + 1}. [${edge.status}] ${edge.fromObjectType}:${edge.fromObjectId} --${edge.relationType}--> ${edge.toObjectType}:${edge.toObjectId} - ${edge.edgeId}`
    ),
  ].join("\n");
}

function buildOperationEdgeMutationSummary(action: string, edge: StoredPrincipalOperationEdgeRecord): string {
  return `${action}关系边 ${edge.edgeId}：${edge.fromObjectType}:${edge.fromObjectId} --${edge.relationType}--> ${edge.toObjectType}:${edge.toObjectId}。`;
}

function getOperationObjectId(objectType: OperationObjectType, object: OperationObjectRecord): string {
  switch (objectType) {
    case "asset":
      return (object as StoredPrincipalAssetRecord).assetId;
    case "decision":
      return (object as StoredPrincipalDecisionRecord).decisionId;
    case "risk":
      return (object as StoredPrincipalRiskRecord).riskId;
    case "cadence":
      return (object as StoredPrincipalCadenceRecord).cadenceId;
    case "commitment":
      return (object as StoredPrincipalCommitmentRecord).commitmentId;
  }
}

function getOperationObjectLabel(objectType: OperationObjectType, object: OperationObjectRecord): string {
  switch (objectType) {
    case "asset":
      return (object as StoredPrincipalAssetRecord).name;
    case "decision":
      return (object as StoredPrincipalDecisionRecord).title;
    case "risk":
      return (object as StoredPrincipalRiskRecord).title;
    case "cadence":
      return (object as StoredPrincipalCadenceRecord).title;
    case "commitment":
      return (object as StoredPrincipalCommitmentRecord).title;
  }
}

function expectOperationObjectType(value: unknown): OperationObjectType {
  return expectEnumText(value, OPERATION_OBJECT_TYPES, "Unsupported objectType.");
}

function expectOperationEdgeObjectType(
  value: unknown,
  message: string,
): PrincipalOperationEdgeObjectType {
  return expectEnumText(value, PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES, message);
}

function normalizeRelationTypes(value: unknown): PrincipalOperationEdgeRelationType[] {
  if (!Array.isArray(value)) {
    throw new Error("relationTypes must be an array of strings.");
  }

  return [...new Set(value.map((item) =>
    expectEnumText(item, PRINCIPAL_OPERATION_EDGE_RELATION_TYPES, "Unsupported relationTypes item.")
  ))];
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function expectRequiredText(value: unknown, message: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function expectEnumText<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  message: string,
): T[number] {
  const normalized = expectRequiredText(value, message);

  if (!allowed.includes(normalized as T[number])) {
    throw new Error(message);
  }

  return normalized as T[number];
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function optionalTextField<const K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  const normalized = normalizeText(value);
  return normalized ? { [key]: normalized } as Record<K, string> : {};
}

function normalizeOptionalMultilineText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return normalized ? normalized : undefined;
}

function optionalMultilineTextField<const K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  const normalized = normalizeOptionalMultilineText(value);
  return normalized ? { [key]: normalized } as Record<K, string> : {};
}

function normalizeStringArray(value: unknown, message: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }

  return [...new Set(value.map((item) => expectRequiredText(item, message)))];
}

function normalizeOptionalListLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("limit must be an integer.");
  }

  if (value < 1 || value > MAX_LIST_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_LIST_LIMIT}.`);
  }

  return value;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
