import { createHash } from "node:crypto";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  PrincipalOperationEdgeObjectType,
  PrincipalOperationEdgeRelationType,
  PrincipalOperationEdgeStatus,
  StoredPrincipalOperationEdgeRecord,
} from "../types/index.js";
import {
  PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES,
  PRINCIPAL_OPERATION_EDGE_RELATION_TYPES,
  PRINCIPAL_OPERATION_EDGE_STATUSES,
} from "../types/index.js";

export interface PrincipalOperationEdgesServiceOptions {
  registry: SqliteCodexSessionRegistry;
}

export interface CreatePrincipalOperationEdgeInput {
  principalId: string;
  fromObjectType: PrincipalOperationEdgeObjectType;
  fromObjectId: string;
  toObjectType: PrincipalOperationEdgeObjectType;
  toObjectId: string;
  relationType?: PrincipalOperationEdgeRelationType;
  status?: PrincipalOperationEdgeStatus;
  label?: string;
  summary?: string;
  edgeId?: string;
  now?: string;
}

export interface UpdatePrincipalOperationEdgeInput {
  principalId: string;
  edgeId: string;
  fromObjectType: PrincipalOperationEdgeObjectType;
  fromObjectId: string;
  toObjectType: PrincipalOperationEdgeObjectType;
  toObjectId: string;
  relationType: PrincipalOperationEdgeRelationType;
  status: PrincipalOperationEdgeStatus;
  label?: string;
  summary?: string;
  now?: string;
}

export interface ListPrincipalOperationEdgesInput {
  principalId: string;
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

export interface SyncPrincipalOperationEdgeInput {
  principalId: string;
  sourceObjectType: PrincipalOperationEdgeObjectType;
  sourceObjectId: string;
  edges: Array<{
    fromObjectType: PrincipalOperationEdgeObjectType;
    fromObjectId: string;
    toObjectType: PrincipalOperationEdgeObjectType;
    toObjectId: string;
    relationType: PrincipalOperationEdgeRelationType;
    label?: string;
    summary?: string;
  }>;
  now?: string;
}

export interface QueryPrincipalOperationGraphInput {
  principalId: string;
  rootObjectType: PrincipalOperationEdgeObjectType;
  rootObjectId: string;
  targetObjectType?: PrincipalOperationEdgeObjectType;
  targetObjectId?: string;
  maxDepth?: number;
  relationTypes?: PrincipalOperationEdgeRelationType[];
  includeArchived?: boolean;
  limit?: number;
  now?: string;
}

export interface PrincipalOperationGraphNode {
  objectType: PrincipalOperationEdgeObjectType;
  objectId: string;
  depth: number;
  viaEdgeId?: string;
  viaObjectType?: PrincipalOperationEdgeObjectType;
  viaObjectId?: string;
}

export interface PrincipalOperationGraphSnapshot {
  principalId: string;
  generatedAt: string;
  maxDepth: number;
  root: {
    objectType: PrincipalOperationEdgeObjectType;
    objectId: string;
  };
  target?: {
    objectType: PrincipalOperationEdgeObjectType;
    objectId: string;
    reachable: boolean;
  };
  relationTypes: PrincipalOperationEdgeRelationType[];
  nodes: PrincipalOperationGraphNode[];
  edges: StoredPrincipalOperationEdgeRecord[];
  shortestPath: StoredPrincipalOperationEdgeRecord[];
}

export class PrincipalOperationEdgesService {
  private readonly registry: SqliteCodexSessionRegistry;

  constructor(options: PrincipalOperationEdgesServiceOptions) {
    this.registry = options.registry;
  }

  createEdge(input: CreatePrincipalOperationEdgeInput): StoredPrincipalOperationEdgeRecord {
    const now = normalizeNow(input.now);
    const label = normalizeOptionalText(input.label);
    const summary = normalizeOptionalText(input.summary);
    const record: StoredPrincipalOperationEdgeRecord = {
      edgeId: normalizeOptionalText(input.edgeId) ?? createId("operation-edge"),
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      fromObjectType: normalizeObjectType(input.fromObjectType),
      fromObjectId: normalizeRequiredText(input.fromObjectId, "From object id is required."),
      toObjectType: normalizeObjectType(input.toObjectType),
      toObjectId: normalizeRequiredText(input.toObjectId, "To object id is required."),
      relationType: normalizeRelationType(input.relationType ?? "relates_to"),
      status: normalizeStatus(input.status ?? "active"),
      ...(label ? { label } : {}),
      ...(summary ? { summary } : {}),
      createdAt: now,
      updatedAt: now,
    };

    this.registry.savePrincipalOperationEdge(record);
    return record;
  }

  updateEdge(input: UpdatePrincipalOperationEdgeInput): StoredPrincipalOperationEdgeRecord {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const edgeId = normalizeRequiredText(input.edgeId, "Operation edge id is required.");
    const existing = this.registry.getPrincipalOperationEdge(principalId, edgeId);

    if (!existing) {
      throw new Error("Principal operation edge does not exist.");
    }

    const updated: StoredPrincipalOperationEdgeRecord = {
      ...existing,
      fromObjectType: normalizeObjectType(input.fromObjectType),
      fromObjectId: normalizeRequiredText(input.fromObjectId, "From object id is required."),
      toObjectType: normalizeObjectType(input.toObjectType),
      toObjectId: normalizeRequiredText(input.toObjectId, "To object id is required."),
      relationType: normalizeRelationType(input.relationType),
      status: normalizeStatus(input.status),
      updatedAt: normalizeNow(input.now),
    };

    const label = normalizeOptionalText(input.label);
    const summary = normalizeOptionalText(input.summary);

    if (label) {
      updated.label = label;
    } else {
      delete updated.label;
    }

    if (summary) {
      updated.summary = summary;
    } else {
      delete updated.summary;
    }

    this.registry.savePrincipalOperationEdge(updated);
    return updated;
  }

  getEdge(principalId: string, edgeId: string): StoredPrincipalOperationEdgeRecord | null {
    return this.registry.getPrincipalOperationEdge(
      normalizeRequiredText(principalId, "Principal id is required."),
      normalizeRequiredText(edgeId, "Operation edge id is required."),
    );
  }

  listEdges(input: ListPrincipalOperationEdgesInput): StoredPrincipalOperationEdgeRecord[] {
    const fromObjectType = normalizeOptionalText(input.fromObjectType);
    const fromObjectId = normalizeOptionalText(input.fromObjectId);
    const toObjectType = normalizeOptionalText(input.toObjectType);
    const toObjectId = normalizeOptionalText(input.toObjectId);
    const relationType = normalizeOptionalText(input.relationType);
    const status = normalizeOptionalText(input.status);
    const query = normalizeOptionalText(input.query);

    return this.registry.listPrincipalOperationEdges({
      principalId: normalizeRequiredText(input.principalId, "Principal id is required."),
      ...(fromObjectType ? { fromObjectType: normalizeObjectType(fromObjectType) } : {}),
      ...(fromObjectId ? { fromObjectId } : {}),
      ...(toObjectType ? { toObjectType: normalizeObjectType(toObjectType) } : {}),
      ...(toObjectId ? { toObjectId } : {}),
      ...(relationType ? { relationType: normalizeRelationType(relationType) } : {}),
      ...(status ? { status: normalizeStatus(status) } : {}),
      ...(query ? { query } : {}),
      ...(input.includeArchived === true ? { includeArchived: true } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
  }

  syncGeneratedEdgesForObject(input: SyncPrincipalOperationEdgeInput): StoredPrincipalOperationEdgeRecord[] {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const sourceObjectType = normalizeObjectType(input.sourceObjectType);
    const sourceObjectId = normalizeRequiredText(input.sourceObjectId, "Source object id is required.");
    const now = normalizeNow(input.now);
    const prefix = buildGeneratedEdgePrefix(sourceObjectType, sourceObjectId);
    const existingGeneratedEdges = this.registry.listPrincipalOperationEdges({
      principalId,
      includeArchived: true,
    }).filter((edge) => edge.edgeId.startsWith(prefix));
    const existingById = new Map(existingGeneratedEdges.map((edge) => [edge.edgeId, edge]));
    const desiredEdges = dedupeGeneratedEdges(input.edges).map((edge) => ({
      ...edge,
      edgeId: buildGeneratedEdgeId({
        sourceObjectType,
        sourceObjectId,
        fromObjectType: normalizeObjectType(edge.fromObjectType),
        fromObjectId: normalizeRequiredText(edge.fromObjectId, "Generated edge from object id is required."),
        toObjectType: normalizeObjectType(edge.toObjectType),
        toObjectId: normalizeRequiredText(edge.toObjectId, "Generated edge to object id is required."),
        relationType: normalizeRelationType(edge.relationType),
      }),
    }));
    const desiredEdgeIds = new Set(desiredEdges.map((edge) => edge.edgeId));
    const synced: StoredPrincipalOperationEdgeRecord[] = [];

    for (const edge of desiredEdges) {
      const existing = existingById.get(edge.edgeId);

      if (existing) {
        synced.push(this.updateEdge({
          principalId,
          edgeId: existing.edgeId,
          fromObjectType: edge.fromObjectType,
          fromObjectId: edge.fromObjectId,
          toObjectType: edge.toObjectType,
          toObjectId: edge.toObjectId,
          relationType: edge.relationType,
          status: "active",
          ...(edge.label ? { label: edge.label } : {}),
          ...(edge.summary ? { summary: edge.summary } : {}),
          now,
        }));
        continue;
      }

      synced.push(this.createEdge({
        principalId,
        edgeId: edge.edgeId,
        fromObjectType: edge.fromObjectType,
        fromObjectId: edge.fromObjectId,
        toObjectType: edge.toObjectType,
        toObjectId: edge.toObjectId,
        relationType: edge.relationType,
        status: "active",
        ...(edge.label ? { label: edge.label } : {}),
        ...(edge.summary ? { summary: edge.summary } : {}),
        now,
      }));
    }

    for (const edge of existingGeneratedEdges) {
      if (desiredEdgeIds.has(edge.edgeId) || edge.status === "archived") {
        continue;
      }

      this.updateEdge({
        principalId,
        edgeId: edge.edgeId,
        fromObjectType: edge.fromObjectType,
        fromObjectId: edge.fromObjectId,
        toObjectType: edge.toObjectType,
        toObjectId: edge.toObjectId,
        relationType: edge.relationType,
        status: "archived",
        ...(edge.label ? { label: edge.label } : {}),
        ...(edge.summary ? { summary: edge.summary } : {}),
        now,
      });
    }

    return synced;
  }

  queryGraph(input: QueryPrincipalOperationGraphInput): PrincipalOperationGraphSnapshot {
    const principalId = normalizeRequiredText(input.principalId, "Principal id is required.");
    const rootObjectType = normalizeObjectType(input.rootObjectType);
    const rootObjectId = normalizeRequiredText(input.rootObjectId, "Root object id is required.");
    const targetObjectType = normalizeOptionalText(input.targetObjectType);
    const targetObjectId = normalizeOptionalText(input.targetObjectId);
    const normalizedTargetObjectType = targetObjectType ? normalizeObjectType(targetObjectType) : undefined;
    const maxDepth = normalizeGraphDepth(input.maxDepth);
    const relationTypes = normalizeGraphRelationTypes(input.relationTypes);
    const relationTypeSet = new Set(relationTypes);
    const rootKey = buildObjectKey(rootObjectType, rootObjectId);
    const targetKey = normalizedTargetObjectType && targetObjectId
      ? buildObjectKey(normalizedTargetObjectType, targetObjectId)
      : "";
    const candidateEdges = this.registry.listPrincipalOperationEdges({
      principalId,
      includeArchived: input.includeArchived === true,
      limit: normalizeGraphEdgeLimit(input.limit),
    }).filter((edge) => {
      if (input.includeArchived !== true && edge.status !== "active") {
        return false;
      }

      return relationTypeSet.size === 0 || relationTypeSet.has(edge.relationType);
    });
    const adjacency = buildGraphAdjacency(candidateEdges);
    const nodes = new Map<string, PrincipalOperationGraphNode>();
    const pathEdgeIdsByNode = new Map<string, string[]>();
    const includedEdges = new Map<string, StoredPrincipalOperationEdgeRecord>();
    const queue: Array<{ objectType: PrincipalOperationEdgeObjectType; objectId: string; depth: number }> = [{
      objectType: rootObjectType,
      objectId: rootObjectId,
      depth: 0,
    }];

    nodes.set(rootKey, {
      objectType: rootObjectType,
      objectId: rootObjectId,
      depth: 0,
    });
    pathEdgeIdsByNode.set(rootKey, []);

    while (queue.length > 0) {
      const current = queue.shift();

      if (!current || current.depth >= maxDepth) {
        continue;
      }

      const currentKey = buildObjectKey(current.objectType, current.objectId);
      const currentPathEdgeIds = pathEdgeIdsByNode.get(currentKey) ?? [];

      for (const edge of adjacency.get(currentKey) ?? []) {
        const next = resolveOtherEndpoint(edge, current.objectType, current.objectId);

        if (!next) {
          continue;
        }

        const nextKey = buildObjectKey(next.objectType, next.objectId);
        includedEdges.set(edge.edgeId, edge);

        if (nodes.has(nextKey)) {
          continue;
        }

        const nextDepth = current.depth + 1;
        nodes.set(nextKey, {
          objectType: next.objectType,
          objectId: next.objectId,
          depth: nextDepth,
          viaEdgeId: edge.edgeId,
          viaObjectType: current.objectType,
          viaObjectId: current.objectId,
        });
        pathEdgeIdsByNode.set(nextKey, [...currentPathEdgeIds, edge.edgeId]);
        queue.push({
          objectType: next.objectType,
          objectId: next.objectId,
          depth: nextDepth,
        });
      }
    }

    const shortestPath = (targetKey ? pathEdgeIdsByNode.get(targetKey) ?? [] : [])
      .map((edgeId) => candidateEdges.find((edge) => edge.edgeId === edgeId))
      .filter((edge): edge is StoredPrincipalOperationEdgeRecord => Boolean(edge));

    return {
      principalId,
      generatedAt: normalizeNow(input.now),
      maxDepth,
      root: {
        objectType: rootObjectType,
        objectId: rootObjectId,
      },
      ...(targetKey && normalizedTargetObjectType && targetObjectId
        ? {
          target: {
            objectType: normalizedTargetObjectType,
            objectId: targetObjectId,
            reachable: pathEdgeIdsByNode.has(targetKey),
          },
        }
        : {}),
      relationTypes,
      nodes: [...nodes.values()].sort(compareGraphNodes),
      edges: [...includedEdges.values()],
      shortestPath,
    };
  }
}

function dedupeGeneratedEdges(inputEdges: SyncPrincipalOperationEdgeInput["edges"]): SyncPrincipalOperationEdgeInput["edges"] {
  const seen = new Set<string>();
  const edges: SyncPrincipalOperationEdgeInput["edges"] = [];

  for (const edge of inputEdges) {
    const key = [
      edge.fromObjectType,
      edge.fromObjectId,
      edge.relationType,
      edge.toObjectType,
      edge.toObjectId,
    ].join("\u0000");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    edges.push(edge);
  }

  return edges;
}

function buildGeneratedEdgePrefix(
  sourceObjectType: PrincipalOperationEdgeObjectType,
  sourceObjectId: string,
): string {
  return `operation-edge-auto-${createStableKey([sourceObjectType, sourceObjectId])}-`;
}

function buildGeneratedEdgeId(input: {
  sourceObjectType: PrincipalOperationEdgeObjectType;
  sourceObjectId: string;
  fromObjectType: PrincipalOperationEdgeObjectType;
  fromObjectId: string;
  toObjectType: PrincipalOperationEdgeObjectType;
  toObjectId: string;
  relationType: PrincipalOperationEdgeRelationType;
}): string {
  const sourceKey = createStableKey([input.sourceObjectType, input.sourceObjectId]);
  const edgeKey = createStableKey([
    input.sourceObjectType,
    input.sourceObjectId,
    input.fromObjectType,
    input.fromObjectId,
    input.relationType,
    input.toObjectType,
    input.toObjectId,
  ]);

  return `operation-edge-auto-${sourceKey}-${edgeKey}`;
}

function createStableKey(parts: string[]): string {
  return createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 16);
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

function normalizeObjectType(value: string): StoredPrincipalOperationEdgeRecord["fromObjectType"] {
  const normalized = value.trim();

  if (!PRINCIPAL_OPERATION_EDGE_OBJECT_TYPES.includes(normalized as StoredPrincipalOperationEdgeRecord["fromObjectType"])) {
    throw new Error("Operation edge object type is invalid.");
  }

  return normalized as StoredPrincipalOperationEdgeRecord["fromObjectType"];
}

function normalizeRelationType(value: string): StoredPrincipalOperationEdgeRecord["relationType"] {
  const normalized = value.trim();

  if (!PRINCIPAL_OPERATION_EDGE_RELATION_TYPES.includes(normalized as StoredPrincipalOperationEdgeRecord["relationType"])) {
    throw new Error("Operation edge relation type is invalid.");
  }

  return normalized as StoredPrincipalOperationEdgeRecord["relationType"];
}

function normalizeStatus(value: string): StoredPrincipalOperationEdgeRecord["status"] {
  const normalized = value.trim();

  if (!PRINCIPAL_OPERATION_EDGE_STATUSES.includes(normalized as StoredPrincipalOperationEdgeRecord["status"])) {
    throw new Error("Operation edge status is invalid.");
  }

  return normalized as StoredPrincipalOperationEdgeRecord["status"];
}

function normalizeGraphDepth(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 2;
  }

  return Math.max(1, Math.min(4, Math.floor(value)));
}

function normalizeGraphEdgeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 500;
  }

  return Math.max(1, Math.min(1000, Math.floor(value)));
}

function normalizeGraphRelationTypes(
  value: PrincipalOperationEdgeRelationType[] | undefined,
): PrincipalOperationEdgeRelationType[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((item) => item.trim())
    .filter((item) => PRINCIPAL_OPERATION_EDGE_RELATION_TYPES.includes(item as PrincipalOperationEdgeRelationType))
    .map((item) => item as PrincipalOperationEdgeRelationType))];
}

function buildGraphAdjacency(
  edges: StoredPrincipalOperationEdgeRecord[],
): Map<string, StoredPrincipalOperationEdgeRecord[]> {
  const adjacency = new Map<string, StoredPrincipalOperationEdgeRecord[]>();

  for (const edge of edges) {
    const fromKey = buildObjectKey(edge.fromObjectType, edge.fromObjectId);
    const toKey = buildObjectKey(edge.toObjectType, edge.toObjectId);

    if (!adjacency.has(fromKey)) {
      adjacency.set(fromKey, []);
    }

    if (!adjacency.has(toKey)) {
      adjacency.set(toKey, []);
    }

    adjacency.get(fromKey)?.push(edge);
    adjacency.get(toKey)?.push(edge);
  }

  return adjacency;
}

function resolveOtherEndpoint(
  edge: StoredPrincipalOperationEdgeRecord,
  objectType: PrincipalOperationEdgeObjectType,
  objectId: string,
): { objectType: PrincipalOperationEdgeObjectType; objectId: string } | null {
  if (edge.fromObjectType === objectType && edge.fromObjectId === objectId) {
    return {
      objectType: edge.toObjectType,
      objectId: edge.toObjectId,
    };
  }

  if (edge.toObjectType === objectType && edge.toObjectId === objectId) {
    return {
      objectType: edge.fromObjectType,
      objectId: edge.fromObjectId,
    };
  }

  return null;
}

function buildObjectKey(objectType: PrincipalOperationEdgeObjectType, objectId: string): string {
  return `${objectType}\u0000${objectId}`;
}

function compareGraphNodes(a: PrincipalOperationGraphNode, b: PrincipalOperationGraphNode): number {
  return a.depth - b.depth
    || a.objectType.localeCompare(b.objectType)
    || a.objectId.localeCompare(b.objectId);
}

function normalizeNow(now?: string): string {
  return normalizeOptionalText(now) ?? new Date().toISOString();
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
