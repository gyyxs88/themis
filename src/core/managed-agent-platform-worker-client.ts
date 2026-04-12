import type {
  CompleteManagedAgentWorkerRunInput,
  ManagedAgentWorkerAssignedRun,
  ManagedAgentWorkerRunMutationResult,
  UpdateManagedAgentWorkerRunStatusInput,
} from "./managed-agent-worker-service.js";

export interface ManagedAgentPlatformWorkerClientOptions {
  baseUrl: string;
  ownerPrincipalId: string;
  webAccessToken: string;
  fetchImpl?: typeof fetch;
}

export interface ManagedAgentPlatformWorkerNodeRegistrationInput {
  nodeId?: string;
  organizationId?: string;
  displayName: string;
  slotCapacity: number;
  slotAvailable?: number;
  labels?: string[];
  workspaceCapabilities?: string[];
  credentialCapabilities?: string[];
  providerCapabilities?: string[];
  heartbeatTtlSeconds?: number;
}

export interface ManagedAgentPlatformWorkerNodeHeartbeatInput {
  nodeId: string;
  status?: "online" | "draining" | "offline";
  slotAvailable?: number;
  labels?: string[];
  workspaceCapabilities?: string[];
  credentialCapabilities?: string[];
  providerCapabilities?: string[];
  heartbeatTtlSeconds?: number;
}

export interface ManagedAgentPlatformWorkerOrganizationRecord {
  organizationId: string;
  ownerPrincipalId: string;
  displayName: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedAgentPlatformWorkerNodeRecord {
  nodeId: string;
  organizationId: string;
  displayName: string;
  status: "online" | "draining" | "offline";
  slotCapacity: number;
  slotAvailable: number;
  labels: string[];
  workspaceCapabilities: string[];
  credentialCapabilities: string[];
  providerCapabilities: string[];
  heartbeatTtlSeconds: number;
  lastHeartbeatAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedAgentPlatformWorkerNodeLeaseSummary {
  totalCount: number;
  activeCount: number;
  expiredCount: number;
  releasedCount: number;
  revokedCount: number;
}

export interface ManagedAgentPlatformWorkerNodeExecutionLeaseContext {
  lease: {
    leaseId: string;
    runId: string;
    workItemId: string;
    targetAgentId: string;
    nodeId: string;
    status: string;
    leaseToken: string;
    leaseExpiresAt: string;
    lastHeartbeatAt?: string;
    createdAt: string;
    updatedAt: string;
  };
  run: {
    runId: string;
    status: string;
    failureCode?: string;
    failureMessage?: string;
  } | null;
  workItem: {
    workItemId: string;
    status: string;
  } | null;
  targetAgent: {
    agentId: string;
    displayName: string;
  } | null;
}

export type ManagedAgentPlatformWorkerNodeLeaseRecoveryAction = "requeued" | "waiting_preserved" | "lease_revoked";

export interface ManagedAgentPlatformWorkerNodeMutationResult {
  organization: ManagedAgentPlatformWorkerOrganizationRecord;
  node: ManagedAgentPlatformWorkerNodeRecord;
}

export interface ManagedAgentPlatformWorkerReclaimedLeaseContext {
  lease: {
    leaseId: string;
    runId?: string;
    workItemId?: string;
    targetAgentId?: string;
    nodeId?: string;
    status: string;
    leaseToken?: string;
    leaseExpiresAt?: string;
    lastHeartbeatAt?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  run: {
    runId: string;
    status: string;
    failureCode?: string;
    failureMessage?: string;
  } | null;
  workItem: {
    workItemId: string;
    status: string;
  } | null;
  targetAgent: {
    agentId: string;
    displayName: string;
  } | null;
  recoveryAction: ManagedAgentPlatformWorkerNodeLeaseRecoveryAction;
}

export interface ManagedAgentPlatformWorkerNodeLeaseRecoverySummary {
  activeLeaseCount: number;
  reclaimedRunCount: number;
  requeuedWorkItemCount: number;
  preservedWaitingCount: number;
  revokedLeaseOnlyCount: number;
}

export interface ManagedAgentPlatformWorkerNodeDetailResult {
  organization: ManagedAgentPlatformWorkerOrganizationRecord;
  node: ManagedAgentPlatformWorkerNodeRecord;
  leaseSummary: ManagedAgentPlatformWorkerNodeLeaseSummary;
  activeExecutionLeases: ManagedAgentPlatformWorkerNodeExecutionLeaseContext[];
  recentExecutionLeases: ManagedAgentPlatformWorkerNodeExecutionLeaseContext[];
}

export interface ManagedAgentPlatformWorkerNodeLeaseRecoveryResult {
  organization: ManagedAgentPlatformWorkerOrganizationRecord;
  node: ManagedAgentPlatformWorkerNodeRecord;
  summary: ManagedAgentPlatformWorkerNodeLeaseRecoverySummary;
  reclaimedLeases: ManagedAgentPlatformWorkerReclaimedLeaseContext[];
}

export interface ManagedAgentPlatformWorkerProbeResult {
  nodeCount: number;
}

export class ManagedAgentPlatformWorkerClient {
  private readonly baseUrl: string;
  private readonly ownerPrincipalId: string;
  private readonly webAccessToken: string;
  private readonly fetchImpl: typeof fetch;
  private cookieHeader: string | null = null;

  constructor(options: ManagedAgentPlatformWorkerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.ownerPrincipalId = options.ownerPrincipalId.trim();
    this.webAccessToken = options.webAccessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async registerNode(
    input: ManagedAgentPlatformWorkerNodeRegistrationInput,
  ): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestJson("/api/platform/nodes/register", {
      ownerPrincipalId: this.ownerPrincipalId,
      node: input,
    });
  }

  async heartbeatNode(
    input: ManagedAgentPlatformWorkerNodeHeartbeatInput,
  ): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestJson("/api/platform/nodes/heartbeat", {
      ownerPrincipalId: this.ownerPrincipalId,
      node: input,
    });
  }

  async listNodes(input: { organizationId?: string } = {}): Promise<ManagedAgentPlatformWorkerNodeRecord[]> {
    const payload = await this.requestJson<{
      nodes?: ManagedAgentPlatformWorkerNodeRecord[];
    }>("/api/platform/nodes/list", {
      ownerPrincipalId: this.ownerPrincipalId,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    });

    return Array.isArray(payload.nodes) ? payload.nodes : [];
  }

  async getNodeDetail(nodeId: string): Promise<ManagedAgentPlatformWorkerNodeDetailResult> {
    return await this.requestJson("/api/platform/nodes/detail", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId,
    });
  }

  async drainNode(nodeId: string): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestJson("/api/platform/nodes/drain", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId,
    });
  }

  async offlineNode(nodeId: string): Promise<ManagedAgentPlatformWorkerNodeMutationResult> {
    return await this.requestJson("/api/platform/nodes/offline", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId,
    });
  }

  async reclaimNodeLeases(
    nodeId: string,
    input: {
      failureCode?: string;
      failureMessage?: string;
    } = {},
  ): Promise<ManagedAgentPlatformWorkerNodeLeaseRecoveryResult> {
    return await this.requestJson("/api/platform/nodes/reclaim", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
    });
  }

  async pullAssignedRun(nodeId: string): Promise<ManagedAgentWorkerAssignedRun | null> {
    const payload = await this.requestJson<{
      organization: ManagedAgentWorkerAssignedRun["organization"] | null;
      node: ManagedAgentWorkerAssignedRun["node"] | null;
      targetAgent: ManagedAgentWorkerAssignedRun["targetAgent"] | null;
      workItem: ManagedAgentWorkerAssignedRun["workItem"] | null;
      run: ManagedAgentWorkerAssignedRun["run"] | null;
      executionLease: ManagedAgentWorkerAssignedRun["executionLease"] | null;
      executionContract: ManagedAgentWorkerAssignedRun["executionContract"] | null;
    }>("/api/platform/worker/runs/pull", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId,
    });

    if (!payload.organization || !payload.node || !payload.targetAgent || !payload.workItem || !payload.run
      || !payload.executionLease || !payload.executionContract) {
      return null;
    }

    return {
      organization: payload.organization,
      node: payload.node,
      targetAgent: payload.targetAgent,
      workItem: payload.workItem,
      run: payload.run,
      executionLease: payload.executionLease,
      executionContract: payload.executionContract,
    };
  }

  async updateRunStatus(input: UpdateManagedAgentWorkerRunStatusInput): Promise<ManagedAgentWorkerRunMutationResult> {
    return await this.requestJson("/api/platform/worker/runs/update", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId: input.nodeId,
      runId: input.runId,
      leaseToken: input.leaseToken,
      status: input.status,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
      ...(input.waitingAction ? { waitingAction: input.waitingAction } : {}),
    });
  }

  async completeRun(input: CompleteManagedAgentWorkerRunInput): Promise<ManagedAgentWorkerRunMutationResult> {
    return await this.requestJson("/api/platform/worker/runs/complete", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId: input.nodeId,
      runId: input.runId,
      leaseToken: input.leaseToken,
      ...(input.result ? { result: input.result } : {}),
    });
  }

  async probeAccess(input: { organizationId?: string } = {}): Promise<ManagedAgentPlatformWorkerProbeResult> {
    const nodes = await this.listNodes(input);
    return {
      nodeCount: nodes.length,
    };
  }

  private async authenticate(): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/web-auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: this.webAccessToken,
      }),
    });

    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(resolveHttpErrorMessage(payload, response.status, "平台登录失败。"));
    }

    const setCookieHeader = response.headers.get("set-cookie");

    if (!setCookieHeader) {
      throw new Error("平台登录成功，但未返回 Web session cookie。");
    }

    this.cookieHeader = extractCookie(setCookieHeader, "themis_web_session");
  }

  private async requestJson<T>(pathname: string, payload: Record<string, unknown>, retry = true): Promise<T> {
    if (!this.cookieHeader) {
      await this.authenticate();
    }

    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
      },
      body: JSON.stringify(payload),
    });
    const parsed = await readJsonResponse(response);

    if (response.status === 401 && retry) {
      this.cookieHeader = null;
      await this.authenticate();
      return await this.requestJson<T>(pathname, payload, false);
    }

    if (!response.ok) {
      throw new Error(resolveHttpErrorMessage(parsed, response.status, `平台请求失败：${pathname}`));
    }

    return parsed as T;
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      raw: text,
    };
  }
}

function resolveHttpErrorMessage(payload: unknown, status: number, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }

  return `${fallback}（HTTP ${status}）`;
}

function extractCookie(setCookieHeader: string, name: string): string {
  const prefix = `${name}=`;

  for (const part of setCookieHeader.split(/, (?=[^;]+=)/)) {
    const cookie = part.split(";", 1)[0]?.trim();

    if (cookie?.startsWith(prefix)) {
      return cookie;
    }
  }

  throw new Error(`Missing cookie ${name}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
