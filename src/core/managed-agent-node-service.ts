import type { ManagedAgentNodeStore } from "../storage/index.js";
import type {
  ManagedAgentNodeStatus,
  StoredManagedAgentNodeRecord,
  StoredOrganizationRecord,
} from "../types/index.js";

const DEFAULT_NODE_HEARTBEAT_TTL_SECONDS = 30;

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

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
