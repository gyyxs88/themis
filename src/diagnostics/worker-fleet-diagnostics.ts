import {
  ManagedAgentPlatformWorkerClient,
  type ManagedAgentPlatformWorkerNodeDetailResult,
  type ManagedAgentPlatformWorkerNodeLeaseSummary,
  type ManagedAgentPlatformWorkerNodeRecord,
} from "../core/managed-agent-platform-worker-client.js";

export interface ReadWorkerFleetDiagnosticsInput {
  platformBaseUrl: string;
  ownerPrincipalId: string;
  webAccessToken: string;
  organizationId?: string | null;
  now?: string;
}

export interface WorkerFleetDiagnosticsNodeAttention {
  severity: "error" | "warning";
  code: "detail_failed" | "offline_active_lease" | "heartbeat_expired" | "heartbeat_stale" | "draining_active_lease";
  summary: string;
  recommendedAction: string;
}

export interface WorkerFleetDiagnosticsNodeSummary {
  node: ManagedAgentPlatformWorkerNodeRecord;
  leaseSummary: ManagedAgentPlatformWorkerNodeLeaseSummary | null;
  heartbeatAgeSeconds: number | null;
  heartbeatRemainingSeconds: number | null;
  heartbeatFreshness: "fresh" | "stale" | "expired" | "unknown";
  detailError: string | null;
  attention: WorkerFleetDiagnosticsNodeAttention | null;
}

export interface WorkerFleetDiagnosticsSummary {
  generatedAt: string;
  platformBaseUrl: string;
  organizationId: string | null;
  nodeCount: number;
  counts: {
    online: number;
    draining: number;
    offline: number;
    stale: number;
    expired: number;
    errorCount: number;
    warningCount: number;
  };
  nodes: WorkerFleetDiagnosticsNodeSummary[];
  primaryDiagnosis: {
    id: string;
    severity: "error" | "warning" | "info";
    title: string;
    summary: string;
  };
  recommendedNextSteps: string[];
}

export interface WorkerFleetDiagnosticsServiceOptions {
  fetchImpl?: typeof fetch;
}

const EMPTY_LEASE_SUMMARY: ManagedAgentPlatformWorkerNodeLeaseSummary = {
  totalCount: 0,
  activeCount: 0,
  expiredCount: 0,
  releasedCount: 0,
  revokedCount: 0,
};

export class WorkerFleetDiagnosticsService {
  private readonly fetchImpl: typeof fetch;

  constructor(options: WorkerFleetDiagnosticsServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async readSummary(input: ReadWorkerFleetDiagnosticsInput): Promise<WorkerFleetDiagnosticsSummary> {
    const generatedAt = normalizeNow(input.now);
    const client = new ManagedAgentPlatformWorkerClient({
      baseUrl: normalizeRequiredText(input.platformBaseUrl, "platformBaseUrl is required."),
      ownerPrincipalId: normalizeRequiredText(input.ownerPrincipalId, "ownerPrincipalId is required."),
      webAccessToken: normalizeRequiredText(input.webAccessToken, "webAccessToken is required."),
      fetchImpl: this.fetchImpl,
    });
    const organizationId = normalizeOptionalText(input.organizationId);
    const nodes = await client.listNodes({
      ...(organizationId ? { organizationId } : {}),
    });
    const summaries = await Promise.all(nodes.map(async (node) => await this.summarizeNode(client, node, generatedAt)));
    const counts = summarizeCounts(summaries);
    const diagnosis = summarizeFleetDiagnosis(summaries, counts);

    return {
      generatedAt,
      platformBaseUrl: input.platformBaseUrl.trim(),
      organizationId,
      nodeCount: summaries.length,
      counts,
      nodes: summaries,
      primaryDiagnosis: diagnosis.primaryDiagnosis,
      recommendedNextSteps: diagnosis.recommendedNextSteps,
    };
  }

  private async summarizeNode(
    client: ManagedAgentPlatformWorkerClient,
    node: ManagedAgentPlatformWorkerNodeRecord,
    now: string,
  ): Promise<WorkerFleetDiagnosticsNodeSummary> {
    const heartbeat = summarizeHeartbeat(node, now);

    try {
      const detail = await client.getNodeDetail(node.nodeId);
      const attention = summarizeNodeAttention(node, detail, heartbeat);
      return {
        node,
        leaseSummary: detail.leaseSummary,
        heartbeatAgeSeconds: heartbeat.ageSeconds,
        heartbeatRemainingSeconds: heartbeat.remainingSeconds,
        heartbeatFreshness: heartbeat.freshness,
        detailError: null,
        attention,
      };
    } catch (error) {
      return {
        node,
        leaseSummary: null,
        heartbeatAgeSeconds: heartbeat.ageSeconds,
        heartbeatRemainingSeconds: heartbeat.remainingSeconds,
        heartbeatFreshness: heartbeat.freshness,
        detailError: toErrorMessage(error),
        attention: {
          severity: "error",
          code: "detail_failed",
          summary: "节点详情读取失败，当前无法判断 lease 状态。",
          recommendedAction: `重试读取节点 ${node.displayName} (${node.nodeId}) 的 detail；若持续失败，先排查平台日志与 Web 登录态。`,
        },
      };
    }
  }
}

function summarizeHeartbeat(
  node: ManagedAgentPlatformWorkerNodeRecord,
  now: string,
): {
  ageSeconds: number | null;
  remainingSeconds: number | null;
  freshness: WorkerFleetDiagnosticsNodeSummary["heartbeatFreshness"];
} {
  const nowTs = Date.parse(now);
  const lastHeartbeatAt = node.lastHeartbeatAt ?? "";
  const heartbeatTtlSeconds = node.heartbeatTtlSeconds ?? 0;
  const lastHeartbeatTs = Date.parse(lastHeartbeatAt);

  if (Number.isNaN(nowTs) || Number.isNaN(lastHeartbeatTs) || heartbeatTtlSeconds <= 0) {
    return {
      ageSeconds: null,
      remainingSeconds: null,
      freshness: "unknown",
    };
  }

  const ageSeconds = Math.max(0, Math.floor((nowTs - lastHeartbeatTs) / 1000));
  const remainingSeconds = heartbeatTtlSeconds - ageSeconds;
  if (ageSeconds > heartbeatTtlSeconds) {
    return {
      ageSeconds,
      remainingSeconds,
      freshness: "expired",
    };
  }

  if (ageSeconds > Math.floor((heartbeatTtlSeconds * 2) / 3)) {
    return {
      ageSeconds,
      remainingSeconds,
      freshness: "stale",
    };
  }

  return {
    ageSeconds,
    remainingSeconds,
    freshness: "fresh",
  };
}

function summarizeNodeAttention(
  node: ManagedAgentPlatformWorkerNodeRecord,
  detail: ManagedAgentPlatformWorkerNodeDetailResult,
  heartbeat: ReturnType<typeof summarizeHeartbeat>,
): WorkerFleetDiagnosticsNodeAttention | null {
  const leaseSummary = detail.leaseSummary ?? EMPTY_LEASE_SUMMARY;

  if (node.status === "offline" && leaseSummary.activeCount > 0) {
    return {
      severity: "error",
      code: "offline_active_lease",
      summary: "节点已 offline，但仍挂着 active lease。",
      recommendedAction: `先确认节点 ${node.displayName} (${node.nodeId}) 是否已经真正停机；如需立刻恢复任务，执行 POST /api/platform/nodes/reclaim。`,
    };
  }

  if (heartbeat.freshness === "expired" && node.status !== "offline") {
    return {
      severity: "error",
      code: "heartbeat_expired",
      summary: "节点心跳已超过 TTL，但仍未稳定退出调度面。",
      recommendedAction: `先在节点 ${node.displayName} (${node.nodeId}) 本机执行 systemctl --user status 与 journalctl 排查；必要时再显式 offline。`,
    };
  }

  if (node.status === "draining" && leaseSummary.activeCount > 0) {
    return {
      severity: "warning",
      code: "draining_active_lease",
      summary: "节点处于 draining，仍有任务在跑。",
      recommendedAction: `继续观察节点 ${node.displayName} (${node.nodeId}) 的 active lease 是否自然清空，再决定是否停机。`,
    };
  }

  if (heartbeat.freshness === "stale" && node.status !== "offline") {
    return {
      severity: "warning",
      code: "heartbeat_stale",
      summary: "节点心跳已接近 TTL。",
      recommendedAction: `先在节点 ${node.displayName} (${node.nodeId}) 本机执行 systemctl --user status 与 journalctl，确认服务没有卡死或频繁重启。`,
    };
  }

  return null;
}

function summarizeCounts(nodes: WorkerFleetDiagnosticsNodeSummary[]): WorkerFleetDiagnosticsSummary["counts"] {
  return {
    online: nodes.filter((item) => item.node.status === "online").length,
    draining: nodes.filter((item) => item.node.status === "draining").length,
    offline: nodes.filter((item) => item.node.status === "offline").length,
    stale: nodes.filter((item) => item.heartbeatFreshness === "stale").length,
    expired: nodes.filter((item) => item.heartbeatFreshness === "expired").length,
    errorCount: nodes.filter((item) => item.attention?.severity === "error").length,
    warningCount: nodes.filter((item) => item.attention?.severity === "warning").length,
  };
}

function summarizeFleetDiagnosis(
  nodes: WorkerFleetDiagnosticsNodeSummary[],
  counts: WorkerFleetDiagnosticsSummary["counts"],
): {
  primaryDiagnosis: WorkerFleetDiagnosticsSummary["primaryDiagnosis"];
  recommendedNextSteps: string[];
} {
  const recommendedNextSteps = new Set<string>();

  if (nodes.length === 0) {
    recommendedNextSteps.add(
      "先按部署手册在目标机器上执行 ./themis doctor worker-node 与 ./themis worker-node run ... --once，确认至少有 1 台节点成功注册。",
    );
    return {
      primaryDiagnosis: {
        id: "worker_fleet_empty",
        severity: "warning",
        title: "平台当前没有已注册 Worker Node",
        summary: "平台登录成功，但当前节点列表为空。",
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  for (const node of nodes) {
    if (node.attention) {
      recommendedNextSteps.add(node.attention.recommendedAction);
    }
  }

  if (counts.errorCount > 0) {
    return {
      primaryDiagnosis: {
        id: "worker_fleet_attention_error",
        severity: "error",
        title: "Worker Node 集群存在需要立即治理的节点",
        summary: `当前共有 ${counts.errorCount} 台节点处于 error attention 状态，建议优先处理 offline active lease、detail 失败或 TTL 异常节点。`,
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  if (counts.warningCount > 0) {
    return {
      primaryDiagnosis: {
        id: "worker_fleet_attention_warning",
        severity: "warning",
        title: "Worker Node 集群存在需要关注的节点",
        summary: `当前共有 ${counts.warningCount} 台节点处于 warning attention 状态，常见原因是心跳接近 TTL 或 draining 节点仍有活动任务。`,
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  recommendedNextSteps.add("继续按固定顺序值守：systemd --user -> doctor worker-node -> nodes/list -> nodes/detail。");
  return {
    primaryDiagnosis: {
      id: "worker_fleet_healthy",
      severity: "info",
      title: "Worker Node 集群状态正常",
      summary: "当前所有已注册节点都处于可解释状态，没有发现需要值班立即处理的 attention 项。",
    },
    recommendedNextSteps: [...recommendedNextSteps],
  };
}

function normalizeRequiredText(value: string, message: string): string {
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
  const normalized = normalizeOptionalText(value);
  return normalized ?? new Date().toISOString();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
