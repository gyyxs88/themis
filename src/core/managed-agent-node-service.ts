import type { ManagedAgentNodeStore } from "../storage/index.js";
import type {
  StoredAgentExecutionLeaseRecord,
  StoredAgentRunRecord,
  StoredAgentWorkItemRecord,
  StoredManagedAgentRecord,
  ManagedAgentNodeStatus,
  StoredManagedAgentNodeRecord,
  StoredOrganizationRecord,
} from "../types/index.js";
import {
  NODE_LEASE_RECLAIM_DEFAULT_FAILURE_CODE,
  NODE_LEASE_RECLAIM_DEFAULT_FAILURE_MESSAGE,
  reclaimManagedAgentExecutionLease,
  summarizeManagedAgentLeaseRecovery,
  type ManagedAgentLeaseRecoveryAction,
  type ManagedAgentLeaseRecoverySummary,
  type ManagedAgentReclaimedLeaseContext,
} from "./managed-agent-lease-recovery.js";

const DEFAULT_NODE_HEARTBEAT_TTL_SECONDS = 30;
const NODE_DETAIL_RECENT_LEASE_LIMIT = 20;

export interface ManagedAgentNodeServiceOptions {
  registry: ManagedAgentNodeStore;
}

export interface RegisterManagedAgentNodeInput {
  ownerPrincipalId: string;
  organizationId?: string;
  nodeId?: string;
  displayName: string;
  slotCapacity: number;
  slotAvailable?: number;
  labels?: string[];
  workspaceCapabilities?: string[];
  credentialCapabilities?: string[];
  providerCapabilities?: string[];
  heartbeatTtlSeconds?: number;
  now?: string;
}

export interface HeartbeatManagedAgentNodeInput {
  ownerPrincipalId: string;
  nodeId: string;
  status?: ManagedAgentNodeStatus;
  slotAvailable?: number;
  labels?: string[];
  workspaceCapabilities?: string[];
  credentialCapabilities?: string[];
  providerCapabilities?: string[];
  heartbeatTtlSeconds?: number;
  now?: string;
}

export interface ManagedAgentNodeMutationResult {
  organization: StoredOrganizationRecord;
  node: StoredManagedAgentNodeRecord;
}

export interface ManagedAgentNodeGovernanceInput {
  ownerPrincipalId: string;
  nodeId: string;
  now?: string;
}

export interface ManagedAgentNodeLeaseReclaimInput extends ManagedAgentNodeGovernanceInput {
  failureCode?: string;
  failureMessage?: string;
}

export interface ManagedAgentNodeExecutionLeaseContext {
  lease: StoredAgentExecutionLeaseRecord;
  run: StoredAgentRunRecord | null;
  workItem: StoredAgentWorkItemRecord | null;
  targetAgent: StoredManagedAgentRecord | null;
}

export type ManagedAgentNodeLeaseRecoveryAction = ManagedAgentLeaseRecoveryAction;
export type ManagedAgentNodeReclaimedLeaseContext = ManagedAgentReclaimedLeaseContext;
export type ManagedAgentNodeLeaseRecoverySummary = ManagedAgentLeaseRecoverySummary;

export interface ManagedAgentNodeLeaseSummary {
  totalCount: number;
  activeCount: number;
  expiredCount: number;
  releasedCount: number;
  revokedCount: number;
}

export interface ManagedAgentNodeDetailView {
  organization: StoredOrganizationRecord;
  node: StoredManagedAgentNodeRecord;
  leaseSummary: ManagedAgentNodeLeaseSummary;
  activeExecutionLeases: ManagedAgentNodeExecutionLeaseContext[];
  recentExecutionLeases: ManagedAgentNodeExecutionLeaseContext[];
}

export interface ManagedAgentNodeLeaseRecoveryResult {
  organization: StoredOrganizationRecord;
  node: StoredManagedAgentNodeRecord;
  summary: ManagedAgentNodeLeaseRecoverySummary;
  reclaimedLeases: ManagedAgentNodeReclaimedLeaseContext[];
}

export function isManagedAgentNodeHeartbeatExpired(node: StoredManagedAgentNodeRecord, now: string): boolean {
  const lastHeartbeatAt = Date.parse(node.lastHeartbeatAt);
  const currentTimestamp = Date.parse(now);

  if (Number.isNaN(lastHeartbeatAt) || Number.isNaN(currentTimestamp)) {
    return false;
  }

  return currentTimestamp - lastHeartbeatAt > node.heartbeatTtlSeconds * 1000;
}

export class ManagedAgentNodeService {
  private readonly registry: ManagedAgentNodeStore;

  constructor(options: ManagedAgentNodeServiceOptions) {
    this.registry = options.registry;
  }

  listNodes(ownerPrincipalId: string, organizationId?: string, now?: string): StoredManagedAgentNodeRecord[] {
    const organization = this.resolveOwnedOrganization(ownerPrincipalId, organizationId);
    this.markStaleNodesOffline(organization.organizationId, normalizeTimestamp(now));
    return this.registry.listManagedAgentNodesByOrganization(organization.organizationId);
  }

  getNode(ownerPrincipalId: string, nodeId: string, now?: string): StoredManagedAgentNodeRecord | null {
    const normalizedNodeId = normalizeRequiredText(nodeId, "Node id is required.");
    const node = this.registry.getManagedAgentNode(normalizedNodeId);

    if (!node) {
      return null;
    }

    this.requireOwnedOrganization(ownerPrincipalId, node.organizationId);
    this.markStaleNodesOffline(node.organizationId, normalizeTimestamp(now));
    return this.registry.getManagedAgentNode(normalizedNodeId);
  }

  getNodeDetailView(ownerPrincipalId: string, nodeId: string, now?: string): ManagedAgentNodeDetailView | null {
    const node = this.getNode(ownerPrincipalId, nodeId, now);

    if (!node) {
      return null;
    }

    const organization = this.requireOwnedOrganization(ownerPrincipalId, node.organizationId);
    const executionLeases = this.registry.listAgentExecutionLeasesByNode(node.nodeId).sort(compareByUpdatedAtDesc);
    const executionLeaseContexts = executionLeases.map((lease) => ({
      lease,
      run: this.registry.getAgentRun(lease.runId),
      workItem: this.registry.getAgentWorkItem(lease.workItemId),
      targetAgent: this.registry.getManagedAgent(lease.targetAgentId),
    }));

    return {
      organization,
      node,
      leaseSummary: summarizeExecutionLeases(executionLeases),
      activeExecutionLeases: executionLeaseContexts.filter((context) => context.lease.status === "active"),
      recentExecutionLeases: executionLeaseContexts.slice(0, NODE_DETAIL_RECENT_LEASE_LIMIT),
    };
  }

  registerNode(input: RegisterManagedAgentNodeInput): ManagedAgentNodeMutationResult {
    const now = normalizeTimestamp(input.now);
    const organization = this.resolveOwnedOrganization(input.ownerPrincipalId, input.organizationId);
    const existing = input.nodeId ? this.registry.getManagedAgentNode(input.nodeId) : null;

    if (existing && existing.organizationId !== organization.organizationId) {
      throw new Error("Managed agent node belongs to another organization.");
    }

    const slotCapacity = normalizePositiveInteger(input.slotCapacity, "slotCapacity");
    const slotAvailable = normalizeNodeSlotAvailable(input.slotAvailable, slotCapacity);
    const heartbeatTtlSeconds = normalizePositiveInteger(
      input.heartbeatTtlSeconds ?? DEFAULT_NODE_HEARTBEAT_TTL_SECONDS,
      "heartbeatTtlSeconds",
    );

    const node: StoredManagedAgentNodeRecord = {
      nodeId: existing?.nodeId ?? normalizeOptionalText(input.nodeId) ?? createId("node"),
      organizationId: organization.organizationId,
      displayName: normalizeRequiredText(input.displayName, "displayName is required."),
      status: "online",
      slotCapacity,
      slotAvailable,
      labels: normalizeStringArray(input.labels),
      workspaceCapabilities: normalizeStringArray(input.workspaceCapabilities),
      credentialCapabilities: normalizeStringArray(input.credentialCapabilities),
      providerCapabilities: normalizeStringArray(input.providerCapabilities),
      heartbeatTtlSeconds,
      lastHeartbeatAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.registry.saveManagedAgentNode(node);

    return {
      organization,
      node: this.registry.getManagedAgentNode(node.nodeId) ?? node,
    };
  }

  heartbeatNode(input: HeartbeatManagedAgentNodeInput): ManagedAgentNodeMutationResult {
    const now = normalizeTimestamp(input.now);
    const node = this.registry.getManagedAgentNode(normalizeRequiredText(input.nodeId, "nodeId is required."));

    if (!node) {
      throw new Error("Managed agent node not found.");
    }

    const organization = this.requireOwnedOrganization(input.ownerPrincipalId, node.organizationId);
    const slotAvailable = input.slotAvailable === undefined
      ? node.slotAvailable
      : normalizeNodeSlotAvailable(input.slotAvailable, node.slotCapacity);
    const heartbeatTtlSeconds = input.heartbeatTtlSeconds === undefined
      ? node.heartbeatTtlSeconds
      : normalizePositiveInteger(input.heartbeatTtlSeconds, "heartbeatTtlSeconds");
    const nextStatus = input.status ?? (node.status === "offline" ? "online" : node.status);

    const updated: StoredManagedAgentNodeRecord = {
      ...node,
      status: nextStatus,
      slotAvailable,
      ...(input.labels ? { labels: normalizeStringArray(input.labels) } : {}),
      ...(input.workspaceCapabilities ? { workspaceCapabilities: normalizeStringArray(input.workspaceCapabilities) } : {}),
      ...(input.credentialCapabilities ? { credentialCapabilities: normalizeStringArray(input.credentialCapabilities) } : {}),
      ...(input.providerCapabilities ? { providerCapabilities: normalizeStringArray(input.providerCapabilities) } : {}),
      heartbeatTtlSeconds,
      lastHeartbeatAt: now,
      updatedAt: now,
    };

    this.registry.saveManagedAgentNode(updated);

    return {
      organization,
      node: this.registry.getManagedAgentNode(updated.nodeId) ?? updated,
    };
  }

  markNodeDraining(input: ManagedAgentNodeGovernanceInput): ManagedAgentNodeMutationResult {
    return this.updateNodeStatus(input, "draining");
  }

  markNodeOffline(input: ManagedAgentNodeGovernanceInput): ManagedAgentNodeMutationResult {
    return this.updateNodeStatus(input, "offline");
  }

  reclaimNodeLeases(input: ManagedAgentNodeLeaseReclaimInput): ManagedAgentNodeLeaseRecoveryResult {
    const now = normalizeTimestamp(input.now);
    const normalizedFailureCode = normalizeOptionalText(input.failureCode) ?? NODE_LEASE_RECLAIM_DEFAULT_FAILURE_CODE;
    const normalizedFailureMessage = normalizeOptionalText(input.failureMessage) ?? NODE_LEASE_RECLAIM_DEFAULT_FAILURE_MESSAGE;
    const node = this.getNode(input.ownerPrincipalId, normalizeRequiredText(input.nodeId, "nodeId is required."), now);

    if (!node) {
      throw new Error("Managed agent node not found.");
    }

    if (node.status !== "offline") {
      throw new Error("Managed agent node must be offline before reclaiming leases.");
    }

    const organization = this.requireOwnedOrganization(input.ownerPrincipalId, node.organizationId);
    const reclaimedLeases = this.registry.listAgentExecutionLeasesByNode(node.nodeId)
      .filter((lease) => lease.status === "active")
      .sort(compareByUpdatedAtDesc)
      .map((lease) => reclaimManagedAgentExecutionLease(this.registry, lease, now, {
        failureCode: normalizedFailureCode,
        failureMessage: normalizedFailureMessage,
      }));
    const updatedNode: StoredManagedAgentNodeRecord = {
      ...node,
      slotAvailable: 0,
      updatedAt: now,
    };
    this.registry.saveManagedAgentNode(updatedNode);

    return {
      organization,
      node: this.registry.getManagedAgentNode(updatedNode.nodeId) ?? updatedNode,
      summary: summarizeManagedAgentLeaseRecovery(reclaimedLeases),
      reclaimedLeases,
    };
  }

  private markStaleNodesOffline(organizationId: string, now: string): void {
    const nodes = this.registry.listManagedAgentNodesByOrganization(organizationId);

    for (const node of nodes) {
      if (!isManagedAgentNodeHeartbeatExpired(node, now)) {
        continue;
      }

      if (node.status === "offline" && node.slotAvailable === 0) {
        continue;
      }

      this.registry.saveManagedAgentNode({
        ...node,
        status: "offline",
        slotAvailable: 0,
        updatedAt: now,
      });
    }
  }

  private updateNodeStatus(
    input: ManagedAgentNodeGovernanceInput,
    status: ManagedAgentNodeStatus,
  ): ManagedAgentNodeMutationResult {
    const now = normalizeTimestamp(input.now);
    const normalizedNodeId = normalizeRequiredText(input.nodeId, "nodeId is required.");
    const node = this.getNode(input.ownerPrincipalId, normalizedNodeId, now);

    if (!node) {
      throw new Error("Managed agent node not found.");
    }

    const organization = this.requireOwnedOrganization(input.ownerPrincipalId, node.organizationId);
    const updated: StoredManagedAgentNodeRecord = {
      ...node,
      status,
      slotAvailable: status === "offline" ? 0 : node.slotAvailable,
      updatedAt: now,
    };

    this.registry.saveManagedAgentNode(updated);

    return {
      organization,
      node: this.registry.getManagedAgentNode(updated.nodeId) ?? updated,
    };
  }

  private resolveOwnedOrganization(ownerPrincipalId: string, organizationId?: string): StoredOrganizationRecord {
    const ownerId = normalizeRequiredText(ownerPrincipalId, "Owner principal id is required.");
    const principal = this.registry.getPrincipal(ownerId);

    if (!principal) {
      throw new Error("Owner principal not found.");
    }

    if (organizationId) {
      return this.requireOwnedOrganization(ownerId, organizationId);
    }

    const organization = this.registry.listOrganizationsByOwnerPrincipal(ownerId)[0];

    if (!organization) {
      throw new Error("Organization not found.");
    }

    return organization;
  }

  private requireOwnedOrganization(ownerPrincipalId: string, organizationId: string): StoredOrganizationRecord {
    const ownerId = normalizeRequiredText(ownerPrincipalId, "Owner principal id is required.");
    const organization = this.registry.getOrganization(normalizeRequiredText(organizationId, "Organization id is required."));

    if (!organization || organization.ownerPrincipalId !== ownerId) {
      throw new Error("Organization not found.");
    }

    return organization;
  }
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} is invalid.`);
  }

  return Math.floor(value);
}

function normalizeNodeSlotAvailable(value: number | undefined, slotCapacity: number): number {
  if (value === undefined) {
    return slotCapacity;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new Error("slotAvailable is invalid.");
  }

  return Math.min(slotCapacity, Math.floor(value));
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeTimestamp(value: string | undefined): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}

function compareByUpdatedAtDesc<T extends { updatedAt: string; createdAt: string }>(a: T, b: T): number {
  const updatedDelta = toTimestamp(b.updatedAt) - toTimestamp(a.updatedAt);

  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
}

function summarizeExecutionLeases(executionLeases: StoredAgentExecutionLeaseRecord[]): ManagedAgentNodeLeaseSummary {
  const summary: ManagedAgentNodeLeaseSummary = {
    totalCount: executionLeases.length,
    activeCount: 0,
    expiredCount: 0,
    releasedCount: 0,
    revokedCount: 0,
  };

  for (const lease of executionLeases) {
    if (lease.status === "active") {
      summary.activeCount += 1;
      continue;
    }

    if (lease.status === "expired") {
      summary.expiredCount += 1;
      continue;
    }

    if (lease.status === "released") {
      summary.releasedCount += 1;
      continue;
    }

    summary.revokedCount += 1;
  }

  return summary;
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
