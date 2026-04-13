import type {
  ManagedAgentPlatformWorkerAssignedRunResult,
  ManagedAgentPlatformWorkerNodeDetailInput,
  ManagedAgentPlatformWorkerNodeDetailResult,
  ManagedAgentPlatformWorkerNodeHeartbeatInput,
  ManagedAgentPlatformWorkerNodeLeaseReclaimInput,
  ManagedAgentPlatformWorkerNodeLeaseRecoveryResult,
  ManagedAgentPlatformWorkerNodeListInput,
  ManagedAgentPlatformWorkerNodeMutationResult,
  ManagedAgentPlatformWorkerNodeRecord,
  ManagedAgentPlatformWorkerNodeRegistrationInput,
  ManagedAgentPlatformWorkerProbeResult,
  ManagedAgentPlatformWorkerRunCompleteInput,
  ManagedAgentPlatformWorkerRunMutationResult,
  ManagedAgentPlatformWorkerRunStatusInput,
} from "../contracts/managed-agent-platform-worker.js";

export type {
  ManagedAgentPlatformWorkerAssignedRunResult,
  ManagedAgentPlatformWorkerCompletionResult,
  ManagedAgentPlatformWorkerNodeDetailInput,
  ManagedAgentPlatformWorkerNodeDetailResult,
  ManagedAgentPlatformWorkerNodeExecutionLeaseContext,
  ManagedAgentPlatformWorkerNodeHeartbeatInput,
  ManagedAgentPlatformWorkerNodeLeaseReclaimInput,
  ManagedAgentPlatformWorkerNodeLeaseRecoveryAction,
  ManagedAgentPlatformWorkerNodeLeaseRecoveryResult,
  ManagedAgentPlatformWorkerNodeLeaseRecoverySummary,
  ManagedAgentPlatformWorkerNodeLeaseSummary,
  ManagedAgentPlatformWorkerNodeListInput,
  ManagedAgentPlatformWorkerNodeMutationResult,
  ManagedAgentPlatformWorkerNodeRecord,
  ManagedAgentPlatformWorkerNodeRegistrationInput,
  ManagedAgentPlatformWorkerOrganizationRecord,
  ManagedAgentPlatformWorkerProbeResult,
  ManagedAgentPlatformWorkerPullInput,
  ManagedAgentPlatformWorkerReclaimedLeaseContext,
  ManagedAgentPlatformWorkerRunCompleteInput,
  ManagedAgentPlatformWorkerRunMutationResult,
  ManagedAgentPlatformWorkerRunStatus,
  ManagedAgentPlatformWorkerRunStatusInput,
  ManagedAgentPlatformWorkerWaitingActionPayload,
} from "../contracts/managed-agent-platform-worker.js";

export interface ManagedAgentPlatformWorkerClientOptions {
  baseUrl: string;
  ownerPrincipalId: string;
  webAccessToken: string;
  fetchImpl?: typeof fetch;
}

export class ManagedAgentPlatformWorkerClient {
  private readonly baseUrl: string;
  private readonly ownerPrincipalId: string;
  private readonly webAccessToken: string;
  private readonly fetchImpl: typeof fetch;

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

  async listNodes(input: ManagedAgentPlatformWorkerNodeListInput = {}): Promise<ManagedAgentPlatformWorkerNodeRecord[]> {
    const payload = await this.requestJson<{
      nodes?: ManagedAgentPlatformWorkerNodeRecord[];
    }>("/api/platform/nodes/list", {
      ownerPrincipalId: this.ownerPrincipalId,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    });

    return Array.isArray(payload.nodes) ? payload.nodes : [];
  }

  async getNodeDetail(nodeId: ManagedAgentPlatformWorkerNodeDetailInput["nodeId"]): Promise<ManagedAgentPlatformWorkerNodeDetailResult> {
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
    input: Omit<ManagedAgentPlatformWorkerNodeLeaseReclaimInput, "nodeId"> = {},
  ): Promise<ManagedAgentPlatformWorkerNodeLeaseRecoveryResult> {
    return await this.requestJson("/api/platform/nodes/reclaim", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
    });
  }

  async pullAssignedRun(nodeId: string): Promise<ManagedAgentPlatformWorkerAssignedRunResult | null> {
    const payload = await this.requestJson<{
      organization: ManagedAgentPlatformWorkerAssignedRunResult["organization"] | null;
      node: ManagedAgentPlatformWorkerAssignedRunResult["node"] | null;
      targetAgent: ManagedAgentPlatformWorkerAssignedRunResult["targetAgent"] | null;
      workItem: ManagedAgentPlatformWorkerAssignedRunResult["workItem"] | null;
      run: ManagedAgentPlatformWorkerAssignedRunResult["run"] | null;
      executionLease: ManagedAgentPlatformWorkerAssignedRunResult["executionLease"] | null;
      executionContract: ManagedAgentPlatformWorkerAssignedRunResult["executionContract"] | null;
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

  async updateRunStatus(input: ManagedAgentPlatformWorkerRunStatusInput): Promise<ManagedAgentPlatformWorkerRunMutationResult> {
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

  async completeRun(input: ManagedAgentPlatformWorkerRunCompleteInput): Promise<ManagedAgentPlatformWorkerRunMutationResult> {
    return await this.requestJson("/api/platform/worker/runs/complete", {
      ownerPrincipalId: this.ownerPrincipalId,
      nodeId: input.nodeId,
      runId: input.runId,
      leaseToken: input.leaseToken,
      ...(input.result ? { result: input.result } : {}),
    });
  }

  async probeAccess(input: ManagedAgentPlatformWorkerNodeListInput = {}): Promise<ManagedAgentPlatformWorkerProbeResult> {
    const nodes = await this.listNodes(input);
    return {
      nodeCount: nodes.length,
    };
  }

  private async requestJson<T>(pathname: string, payload: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.webAccessToken}`,
      },
      body: JSON.stringify(payload),
    });
    const parsed = await readJsonResponse(response);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
