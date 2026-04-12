import {
  ManagedAgentPlatformWorkerClient,
  type ManagedAgentPlatformWorkerNodeLeaseRecoveryResult,
  type ManagedAgentPlatformWorkerNodeMutationResult,
} from "../core/managed-agent-platform-worker-client.js";

export type WorkerFleetGovernanceAction = "drain" | "offline" | "reclaim";

export interface ExecuteWorkerFleetGovernanceInput {
  platformBaseUrl: string;
  ownerPrincipalId: string;
  webAccessToken: string;
  action: WorkerFleetGovernanceAction;
  nodeIds: string[];
  failureCode?: string | null;
  failureMessage?: string | null;
  now?: string;
}

export interface WorkerFleetGovernanceNodeResult {
  nodeId: string;
  outcome: "ok" | "failed";
  node: ManagedAgentPlatformWorkerNodeMutationResult["node"] | null;
  reclaim: ManagedAgentPlatformWorkerNodeLeaseRecoveryResult | null;
  errorMessage: string | null;
}

export interface WorkerFleetGovernanceSummary {
  generatedAt: string;
  platformBaseUrl: string;
  action: WorkerFleetGovernanceAction;
  requestedNodeIds: string[];
  successCount: number;
  failureCount: number;
  results: WorkerFleetGovernanceNodeResult[];
}

export interface WorkerFleetGovernanceServiceOptions {
  fetchImpl?: typeof fetch;
}

export class WorkerFleetGovernanceService {
  private readonly fetchImpl: typeof fetch;

  constructor(options: WorkerFleetGovernanceServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async execute(input: ExecuteWorkerFleetGovernanceInput): Promise<WorkerFleetGovernanceSummary> {
    const generatedAt = normalizeNow(input.now);
    const action = normalizeAction(input.action);
    const nodeIds = normalizeNodeIds(input.nodeIds);
    const client = new ManagedAgentPlatformWorkerClient({
      baseUrl: normalizeRequiredText(input.platformBaseUrl, "platformBaseUrl is required."),
      ownerPrincipalId: normalizeRequiredText(input.ownerPrincipalId, "ownerPrincipalId is required."),
      webAccessToken: normalizeRequiredText(input.webAccessToken, "webAccessToken is required."),
      fetchImpl: this.fetchImpl,
    });
    const failureCode = normalizeOptionalText(input.failureCode);
    const failureMessage = normalizeOptionalText(input.failureMessage);
    const results: WorkerFleetGovernanceNodeResult[] = [];

    for (const nodeId of nodeIds) {
      try {
        if (action === "drain") {
          const mutation = await client.drainNode(nodeId);
          results.push({
            nodeId,
            outcome: "ok",
            node: mutation.node,
            reclaim: null,
            errorMessage: null,
          });
          continue;
        }

        if (action === "offline") {
          const mutation = await client.offlineNode(nodeId);
          results.push({
            nodeId,
            outcome: "ok",
            node: mutation.node,
            reclaim: null,
            errorMessage: null,
          });
          continue;
        }

        const reclaim = await client.reclaimNodeLeases(nodeId, {
          ...(failureCode ? { failureCode } : {}),
          ...(failureMessage ? { failureMessage } : {}),
        });
        results.push({
          nodeId,
          outcome: "ok",
          node: reclaim.node,
          reclaim,
          errorMessage: null,
        });
      } catch (error) {
        results.push({
          nodeId,
          outcome: "failed",
          node: null,
          reclaim: null,
          errorMessage: toErrorMessage(error),
        });
      }
    }

    return {
      generatedAt,
      platformBaseUrl: input.platformBaseUrl.trim(),
      action,
      requestedNodeIds: nodeIds,
      successCount: results.filter((item) => item.outcome === "ok").length,
      failureCount: results.filter((item) => item.outcome === "failed").length,
      results,
    };
  }
}

function normalizeAction(value: WorkerFleetGovernanceAction): WorkerFleetGovernanceAction {
  if (value === "drain" || value === "offline" || value === "reclaim") {
    return value;
  }

  throw new Error("Unsupported worker fleet governance action.");
}

function normalizeNodeIds(values: string[]): string[] {
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new Error("At least one node id is required.");
  }

  return [...new Set(normalized)];
}

function normalizeRequiredText(value: string | null | undefined, message: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeNow(value: string | null | undefined): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
