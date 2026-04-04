import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCodexAuthFilePath, resolveDefaultCodexHome } from "../core/auth-accounts.js";
import type { CodexAuthRuntime } from "../core/codex-auth.js";
import { readOpenAICompatibleProviderConfigs } from "../core/openai-compatible-provider.js";
import { McpInspector, type McpInspectorListResult, type McpServerSummary } from "../mcp/mcp-inspector.js";
import type { SqliteCodexSessionRegistry, StoredTurnInputCompileCapabilityMatrix } from "../storage/index.js";
import { readFeishuDiagnosticsSnapshot, type FeishuDiagnosticsSummary } from "./feishu-diagnostics.js";

export interface RuntimeDiagnosticFileStatus {
  path: string;
  status: "ok" | "missing" | "unreadable";
}

export interface RuntimeDiagnosticsHotspot {
  id: string;
  scope: "auth" | "provider" | "context" | "memory" | "service" | "mcp" | "feishu";
  severity: "error" | "warning" | "info";
  title: string;
  summary: string;
  nextStep: string;
}

export interface RuntimeMcpDiagnosticsSummary {
  statusCounts: {
    healthyCount: number;
    abnormalCount: number;
    unknownCount: number;
  };
  serverDiagnoses: RuntimeMcpServerDiagnosis[];
  primaryDiagnosis: {
    id: string;
    severity: "error" | "warning" | "info";
    title: string;
    summary: string;
  } | null;
  recommendedNextSteps: string[];
}

export interface RuntimeMcpServerDiagnosis {
  server: McpServerSummary;
  classification: "healthy" | "auth_required" | "launch_failed" | "config_invalid" | "degraded" | "unknown";
  severity: "error" | "warning" | "info";
  summary: string;
  recommendedActions: string[];
}

export interface RuntimeDiagnosticsOverview {
  primaryFocus: RuntimeDiagnosticsHotspot | null;
  hotspots: RuntimeDiagnosticsHotspot[];
  suggestedCommands: string[];
}

export interface RuntimeMultimodalSourceChannelCount {
  sourceChannel: string;
  count: number;
}

export interface RuntimeMultimodalRuntimeTargetCount {
  runtimeTarget: string;
  count: number;
}

export interface RuntimeMultimodalWarningCodeCount {
  code: string;
  count: number;
}

export interface RuntimeMultimodalLastTurnSummary {
  requestId: string;
  sourceChannel: string;
  sessionId?: string;
  createdAt: string;
  runtimeTarget: string | null;
  degradationLevel: "native" | "lossless_textualization" | "controlled_fallback" | "blocked" | "unknown";
  partTypes: string[];
  assetKinds: string[];
  warningCodes: string[];
  warningMessages: string[];
  capabilityMatrix: StoredTurnInputCompileCapabilityMatrix | null;
}

export interface RuntimeMultimodalDiagnosticsSummary {
  available: boolean;
  sampleWindowSize: number;
  recentTurnInputCount: number;
  assetCounts: {
    image: number;
    document: number;
  };
  degradationCounts: {
    native: number;
    losslessTextualization: number;
    controlledFallback: number;
    blocked: number;
    unknown: number;
  };
  sourceChannelCounts: RuntimeMultimodalSourceChannelCount[];
  runtimeTargetCounts: RuntimeMultimodalRuntimeTargetCount[];
  warningCodeCounts: RuntimeMultimodalWarningCodeCount[];
  lastTurn: RuntimeMultimodalLastTurnSummary | null;
  lastBlockedTurn: RuntimeMultimodalLastTurnSummary | null;
}

export interface RuntimeDiagnosticsSummary {
  generatedAt: string;
  workingDirectory: string;
  auth: {
    defaultCodexHome: string;
    authFilePath: string;
    authFileExists: boolean;
    snapshotAuthenticated: boolean | null;
    snapshotError?: string;
  };
  provider: {
    activeMode: "auth" | "third-party";
    providerCount: number;
    providerIds: string[];
    readError?: string;
  };
  context: {
    files: RuntimeDiagnosticFileStatus[];
  };
  memory: {
    files: RuntimeDiagnosticFileStatus[];
  };
  overview: RuntimeDiagnosticsOverview;
  feishu: FeishuDiagnosticsSummary;
  service: {
    sqlite: {
      path: string;
      exists: boolean;
    };
    multimodal: RuntimeMultimodalDiagnosticsSummary;
  };
  mcp: McpInspectorListResult & {
    readError?: string;
    diagnostics: RuntimeMcpDiagnosticsSummary;
  };
}

export interface RuntimeDiagnosticsServiceOptions {
  workingDirectory: string;
  runtimeStore?: SqliteCodexSessionRegistry | null;
  authRuntime?: CodexAuthRuntime | null;
  sqliteFilePath?: string;
  mcpInspector?: Pick<McpInspector, "list" | "probe" | "reload"> | null;
}

const CONTEXT_FILES = [
  "README.md",
  "AGENTS.md",
  "memory/project/overview.md",
  "memory/architecture/overview.md",
] as const;

const MEMORY_FILES = [
  "memory/sessions/active.md",
  "memory/tasks/backlog.md",
  "memory/tasks/in-progress.md",
  "memory/tasks/done.md",
] as const;

const RECENT_MULTIMODAL_TURN_INPUT_LIMIT = 24;
const RECENT_MULTIMODAL_SESSION_SCAN_LIMIT = 64;

export class RuntimeDiagnosticsService {
  private readonly workingDirectory: string;
  private readonly runtimeStore: SqliteCodexSessionRegistry | null;
  private readonly authRuntime: CodexAuthRuntime | null;
  private readonly sqliteFilePath: string;
  private readonly mcpInspector: Pick<McpInspector, "list" | "probe" | "reload"> | null;

  constructor(options: RuntimeDiagnosticsServiceOptions) {
    this.workingDirectory = options.workingDirectory;
    this.runtimeStore = options.runtimeStore ?? null;
    this.authRuntime = options.authRuntime ?? null;
    this.sqliteFilePath = options.sqliteFilePath ?? join(this.workingDirectory, "infra/local/themis.db");
    this.mcpInspector = options.mcpInspector ?? new McpInspector({
      workingDirectory: this.workingDirectory,
    });
  }

  async readSummary(): Promise<RuntimeDiagnosticsSummary> {
    const defaultCodexHome = resolveDefaultCodexHome();
    const authFilePath = resolveCodexAuthFilePath(defaultCodexHome);
    const authFileExists = existsSync(authFilePath);
    let snapshotAuthenticated: boolean | null = null;
    let snapshotError: string | undefined;

    if (this.authRuntime) {
      try {
        const snapshot = await this.authRuntime.readSnapshot();
        snapshotAuthenticated = snapshot.authenticated;
      } catch (error) {
        snapshotError = toErrorMessage(error);
      }
    }

    let providerCount = 0;
    let providerIds: string[] = [];
    let providerReadError: string | undefined;
    const activeProviderProfile = this.authRuntime?.readThirdPartyProviderProfile() ?? null;
    try {
      const configs = readOpenAICompatibleProviderConfigs(this.workingDirectory, this.runtimeStore ?? undefined);
      providerCount = configs.length;
      providerIds = configs.map((config) => config.id);
    } catch (error) {
      providerReadError = toErrorMessage(error);
    }

    const mcpSummary = await this.readMcpSummary();
    const feishuSummary = await readFeishuDiagnosticsSnapshot({
      workingDirectory: this.workingDirectory,
      runtimeStore: this.runtimeStore,
      sqliteFilePath: this.sqliteFilePath,
    });
    const contextFiles = CONTEXT_FILES.map((path) => readPathStatus(this.workingDirectory, path));
    const memoryFiles = MEMORY_FILES.map((path) => readPathStatus(this.workingDirectory, path));
    const multimodal = summarizeRecentTurnInputDiagnostics(this.runtimeStore);
    const service = {
      sqlite: {
        path: this.sqliteFilePath,
        exists: existsSync(this.sqliteFilePath),
      },
      multimodal,
    };
    const provider = {
      activeMode: this.authRuntime
        ? (activeProviderProfile ? "third-party" : "auth")
        : (providerCount > 0 ? "third-party" : "auth"),
      providerCount,
      providerIds,
      ...(providerReadError ? { readError: providerReadError } : {}),
    } satisfies RuntimeDiagnosticsSummary["provider"];
    const auth = {
      defaultCodexHome,
      authFilePath,
      authFileExists,
      snapshotAuthenticated,
      ...(snapshotError ? { snapshotError } : {}),
    } satisfies RuntimeDiagnosticsSummary["auth"];
    const overview = summarizeRuntimeOverview({
      auth,
      provider,
      context: {
        files: contextFiles,
      },
      memory: {
        files: memoryFiles,
      },
      service,
      mcp: mcpSummary,
      feishu: feishuSummary,
    });

    return {
      generatedAt: new Date().toISOString(),
      workingDirectory: this.workingDirectory,
      auth,
      provider,
      context: {
        files: contextFiles,
      },
      memory: {
        files: memoryFiles,
      },
      overview,
      feishu: feishuSummary,
      service,
      mcp: mcpSummary,
    };
  }

  private async readMcpSummary(): Promise<RuntimeDiagnosticsSummary["mcp"]> {
    if (!this.mcpInspector) {
      return {
        servers: [],
        diagnostics: summarizeMcpDiagnostics({
          servers: [],
        }),
      };
    }

    try {
      const summary = await this.mcpInspector.list();
      return {
        ...summary,
        diagnostics: summarizeMcpDiagnostics(summary),
      };
    } catch (error) {
      return {
        servers: [],
        readError: toErrorMessage(error),
        diagnostics: summarizeMcpDiagnostics({
          servers: [],
          readError: toErrorMessage(error),
        }),
      };
    }
  }
}

function readPathStatus(root: string, relativePath: string): RuntimeDiagnosticFileStatus {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      path: relativePath,
      status: "missing",
    };
  }

  try {
    readFileSync(absolutePath, "utf8");
    return {
      path: relativePath,
      status: "ok",
    };
  } catch {
    return {
      path: relativePath,
      status: "unreadable",
    };
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeMcpDiagnostics(summary: {
  servers: McpServerSummary[];
  readError?: string;
}): RuntimeMcpDiagnosticsSummary {
  const serverDiagnoses = summary.servers.map((server) => diagnoseMcpServer(server));
  const healthyCount = serverDiagnoses.filter((item) => item.classification === "healthy").length;
  const abnormalCount = serverDiagnoses.filter((item) => item.classification !== "healthy").length;
  const unknownCount = serverDiagnoses.filter((item) => item.classification === "unknown").length;

  if (summary.readError) {
    return {
      statusCounts: {
        healthyCount,
        abnormalCount,
        unknownCount,
      },
      serverDiagnoses,
      primaryDiagnosis: {
        id: "list_failed",
        severity: "error",
        title: "MCP server 列表读取失败",
        summary: summary.readError,
      },
      recommendedNextSteps: [
        "./themis doctor service",
        "npm run dev:web",
        "./themis doctor mcp",
      ],
    };
  }

  if (abnormalCount > 0) {
    return {
      statusCounts: {
        healthyCount,
        abnormalCount,
        unknownCount,
      },
      serverDiagnoses,
      primaryDiagnosis: {
        id: "server_degraded",
        severity: "warning",
        title: "MCP server 状态异常",
        summary: `当前共有 ${abnormalCount} 个 server 不是 healthy，建议先确认 app-server 与 MCP 配置是否已稳定加载。`,
      },
      recommendedNextSteps: [
        "./themis doctor service",
        "./themis doctor mcp",
      ],
    };
  }

  return {
    statusCounts: {
      healthyCount,
      abnormalCount,
      unknownCount,
    },
    serverDiagnoses,
    primaryDiagnosis: {
      id: "healthy",
      severity: "info",
      title: "当前未发现 MCP 阻塞",
      summary: "MCP server 列表已可读，当前状态分布没有明显异常。",
    },
    recommendedNextSteps: [
      "./themis doctor mcp",
    ],
  };
}

function diagnoseMcpServer(server: McpServerSummary): RuntimeMcpServerDiagnosis {
  const status = server.status.trim().toLowerCase();
  const auth = (server.auth ?? "").trim().toLowerCase();
  const detailText = [server.error, server.message, server.auth, server.status]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (status === "healthy" && !server.error && !matchesAuthIssue(auth) && !matchesAuthIssue(detailText)) {
    return {
      server,
      classification: "healthy",
      severity: "info",
      summary: "当前 MCP server 状态正常，可继续使用。",
      recommendedActions: [
        "./themis doctor mcp",
      ],
    };
  }

  if (matchesAuthIssue(auth) || matchesAuthIssue(detailText)) {
    return {
      server,
      classification: "auth_required",
      severity: "warning",
      summary: "需要先完成 MCP server 认证后再继续使用。",
      recommendedActions: [
        "补齐对应 MCP server 的认证或重新执行 OAuth 登录。",
        "./themis doctor mcp",
      ],
    };
  }

  if (matchesConfigIssue(detailText)) {
    return {
      server,
      classification: "config_invalid",
      severity: "error",
      summary: "MCP server 配置无效，当前无法稳定装载。",
      recommendedActions: [
        "检查 command / args / cwd / env 配置后重新 reload。",
        "./themis doctor mcp",
      ],
    };
  }

  if (matchesLaunchIssue(detailText)) {
    return {
      server,
      classification: "launch_failed",
      severity: "error",
      summary: "MCP server 启动失败，当前进程未成功拉起。",
      recommendedActions: [
        "检查 server command、cwd 和本地依赖后重新 reload。",
        "./themis doctor service",
      ],
    };
  }

  if (status === "unknown" || status.length === 0) {
    return {
      server,
      classification: "unknown",
      severity: "warning",
      summary: "MCP server 当前状态未知，建议重新读取列表并核对 app-server 输出。",
      recommendedActions: [
        "./themis doctor mcp",
        "./themis doctor service",
      ],
    };
  }

  return {
    server,
    classification: "degraded",
    severity: "warning",
    summary: server.message ?? server.error ?? "MCP server 状态异常，但暂时无法进一步归类。",
    recommendedActions: [
      "./themis doctor service",
      "./themis doctor mcp",
    ],
  };
}

function matchesAuthIssue(value: string): boolean {
  return /(auth|oauth|login|token|credential|unauthor|forbidden|permission|required)/.test(value)
    && !/(authenticated|authorized)/.test(value);
}

function matchesConfigIssue(value: string): boolean {
  return /(config|invalid|schema|parse|malformed)/.test(value);
}

function matchesLaunchIssue(value: string): boolean {
  return /(spawn|enoent|exit|launch|start failed|boot failed|crash|refused)/.test(value);
}

function summarizeRuntimeOverview(input: {
  auth: RuntimeDiagnosticsSummary["auth"];
  provider: RuntimeDiagnosticsSummary["provider"];
  context: RuntimeDiagnosticsSummary["context"];
  memory: RuntimeDiagnosticsSummary["memory"];
  service: RuntimeDiagnosticsSummary["service"];
  mcp: RuntimeDiagnosticsSummary["mcp"];
  feishu: RuntimeDiagnosticsSummary["feishu"];
}): RuntimeDiagnosticsOverview {
  const hotspots: RuntimeDiagnosticsHotspot[] = [];

  if (input.auth.snapshotError) {
    hotspots.push({
      id: "auth_snapshot_error",
      scope: "auth",
      severity: "error",
      title: "auth 快照读取失败",
      summary: input.auth.snapshotError,
      nextStep: "./themis doctor auth",
    });
  } else if (!input.auth.authFileExists && input.provider.activeMode === "auth") {
    hotspots.push({
      id: "auth_missing",
      scope: "auth",
      severity: "warning",
      title: "auth 文件缺失",
      summary: "当前默认走 auth 模式，但本地 auth 文件不存在。",
      nextStep: "./themis doctor auth",
    });
  }

  if (input.provider.readError) {
    hotspots.push({
      id: "provider_read_error",
      scope: "provider",
      severity: "error",
      title: "provider 配置读取失败",
      summary: input.provider.readError,
      nextStep: "./themis doctor provider",
    });
  }

  const contextProblemSummary = summarizeFileProblems(input.context.files);
  if (contextProblemSummary) {
    hotspots.push({
      id: "context_files_missing",
      scope: "context",
      severity: "warning",
      title: "context 文件不完整",
      summary: contextProblemSummary,
      nextStep: "./themis doctor context",
    });
  }

  const memoryProblemSummary = summarizeFileProblems(input.memory.files);
  if (memoryProblemSummary) {
    hotspots.push({
      id: "memory_files_missing",
      scope: "memory",
      severity: "warning",
      title: "memory 文件不完整",
      summary: memoryProblemSummary,
      nextStep: "./themis doctor memory",
    });
  }

  if (!input.service.sqlite.exists) {
    hotspots.push({
      id: "sqlite_missing",
      scope: "service",
      severity: "warning",
      title: "SQLite 文件缺失",
      summary: `本地运行库尚未落盘：${input.service.sqlite.path}`,
      nextStep: "./themis doctor service",
    });
  }

  if (input.service.multimodal.degradationCounts.blocked > 0) {
    hotspots.push({
      id: "multimodal_inputs_blocked",
      scope: "service",
      severity: "warning",
      title: "最近存在被阻止的多模态输入",
      summary: summarizeBlockedMultimodalInputs(input.service.multimodal),
      nextStep: "./themis doctor service",
    });
  }

  const feishuDiagnosis = input.feishu.diagnostics.primaryDiagnosis;
  if (feishuDiagnosis && feishuDiagnosis.id !== "healthy") {
    hotspots.push({
      id: `feishu_${feishuDiagnosis.id}`,
      scope: "feishu",
      severity: feishuDiagnosis.severity,
      title: feishuDiagnosis.title,
      summary: buildFeishuHotspotSummary(input.feishu),
      nextStep: "./themis doctor feishu",
    });
  }

  if (input.mcp.diagnostics.primaryDiagnosis && input.mcp.diagnostics.primaryDiagnosis.id !== "healthy") {
    hotspots.push({
      id: `mcp_${input.mcp.diagnostics.primaryDiagnosis.id}`,
      scope: "mcp",
      severity: input.mcp.diagnostics.primaryDiagnosis.severity,
      title: input.mcp.diagnostics.primaryDiagnosis.title,
      summary: input.mcp.diagnostics.primaryDiagnosis.summary,
      nextStep: "./themis doctor mcp",
    });
  }

  hotspots.sort((left, right) => compareSeverity(left.severity, right.severity) || compareScopePriority(left.scope, right.scope));

  return {
    primaryFocus: hotspots[0] ?? null,
    hotspots,
    suggestedCommands: Array.from(new Set(hotspots.map((item) => item.nextStep))),
  };
}

function summarizeFileProblems(files: RuntimeDiagnosticFileStatus[]): string | null {
  const missingCount = files.filter((file) => file.status === "missing").length;
  const unreadableCount = files.filter((file) => file.status === "unreadable").length;

  if (missingCount === 0 && unreadableCount === 0) {
    return null;
  }

  const parts: string[] = [];

  if (missingCount > 0) {
    parts.push(`${missingCount} 个 missing`);
  }

  if (unreadableCount > 0) {
    parts.push(`${unreadableCount} 个 unreadable`);
  }

  return `当前共有 ${parts.join("，")}。`;
}

function buildFeishuHotspotSummary(summary: FeishuDiagnosticsSummary): string {
  const primaryDiagnosis = summary.diagnostics.primaryDiagnosis;
  const parts = [
    primaryDiagnosis?.summary ?? "飞书最近窗口存在异常。",
  ];
  const trend = summarizeFeishuTrend(summary);

  if (trend) {
    parts.push(`最近窗口异常：${trend}`);
  }

  return parts.join(" ");
}

function summarizeFeishuTrend(summary: FeishuDiagnosticsSummary): string | null {
  const parts = [
    summary.diagnostics.recentWindowStats.pendingInputNotFoundCount > 0
      ? `pending_input.not_found ${summary.diagnostics.recentWindowStats.pendingInputNotFoundCount}`
      : null,
    summary.diagnostics.recentWindowStats.pendingInputAmbiguousCount > 0
      ? `pending_input.ambiguous ${summary.diagnostics.recentWindowStats.pendingInputAmbiguousCount}`
      : null,
    summary.diagnostics.recentWindowStats.staleIgnoredCount > 0
      ? `stale_ignored ${summary.diagnostics.recentWindowStats.staleIgnoredCount}`
      : null,
    summary.diagnostics.recentWindowStats.duplicateIgnoredCount > 0
      ? `duplicate_ignored ${summary.diagnostics.recentWindowStats.duplicateIgnoredCount}`
      : null,
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join(" / ") : null;
}

function compareSeverity(left: RuntimeDiagnosticsHotspot["severity"], right: RuntimeDiagnosticsHotspot["severity"]): number {
  const severityRank: Record<RuntimeDiagnosticsHotspot["severity"], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };

  return severityRank[left] - severityRank[right];
}

function compareScopePriority(left: RuntimeDiagnosticsHotspot["scope"], right: RuntimeDiagnosticsHotspot["scope"]): number {
  const scopeRank: Record<RuntimeDiagnosticsHotspot["scope"], number> = {
    feishu: 0,
    mcp: 1,
    service: 2,
    auth: 3,
    provider: 4,
    memory: 5,
    context: 6,
  };

  return scopeRank[left] - scopeRank[right];
}

function summarizeRecentTurnInputDiagnostics(
  runtimeStore: SqliteCodexSessionRegistry | null,
): RuntimeMultimodalDiagnosticsSummary {
  const baseSummary = createEmptyMultimodalDiagnosticsSummary(Boolean(runtimeStore));

  if (!runtimeStore) {
    return baseSummary;
  }

  const recentTurnInputs = runtimeStore
    .listRecentSessions(RECENT_MULTIMODAL_SESSION_SCAN_LIMIT)
    .flatMap((session) => runtimeStore.listSessionTurns(session.sessionId))
    .map((turn) => {
      const input = runtimeStore.getTurnInput(turn.requestId);
      return input
        ? {
            turn,
            input,
          }
        : null;
    })
    .filter((item): item is {
      turn: ReturnType<SqliteCodexSessionRegistry["listSessionTurns"]>[number];
      input: NonNullable<ReturnType<SqliteCodexSessionRegistry["getTurnInput"]>>;
    } => item !== null)
    .sort((left, right) => compareRecentTurnInput(left.input.createdAt, left.turn.requestId, right.input.createdAt, right.turn.requestId))
    .slice(0, RECENT_MULTIMODAL_TURN_INPUT_LIMIT);

  if (recentTurnInputs.length === 0) {
    return baseSummary;
  }

  const sourceChannelCounts = new Map<string, number>();
  const runtimeTargetCounts = new Map<string, number>();
  const warningCodeCounts = new Map<string, number>();
  const assetCounts = {
    image: 0,
    document: 0,
  };
  const degradationCounts = {
    native: 0,
    losslessTextualization: 0,
    controlledFallback: 0,
    blocked: 0,
    unknown: 0,
  };

  for (const record of recentTurnInputs) {
    incrementCount(sourceChannelCounts, record.input.envelope.sourceChannel);

    for (const asset of record.input.assets) {
      if (asset.kind === "image") {
        assetCounts.image += 1;
      } else if (asset.kind === "document") {
        assetCounts.document += 1;
      }
    }

    const compileSummary = record.input.compileSummary;
    const runtimeTarget = normalizeCountKey(compileSummary?.runtimeTarget);
    incrementCount(runtimeTargetCounts, runtimeTarget);
    for (const warning of compileSummary?.warnings ?? []) {
      const warningCode = normalizeOptionalText(warning.code);

      if (!warningCode) {
        continue;
      }

      incrementCount(warningCodeCounts, warningCode);
    }

    switch (compileSummary?.degradationLevel) {
      case "native":
        degradationCounts.native += 1;
        break;
      case "lossless_textualization":
        degradationCounts.losslessTextualization += 1;
        break;
      case "controlled_fallback":
        degradationCounts.controlledFallback += 1;
        break;
      case "blocked":
        degradationCounts.blocked += 1;
        break;
      default:
        degradationCounts.unknown += 1;
        break;
    }
  }

  const lastRecord = recentTurnInputs[0] ?? null;
  const lastBlockedRecord = recentTurnInputs.find((record) => record.input.compileSummary?.degradationLevel === "blocked") ?? null;

  return {
    available: true,
    sampleWindowSize: RECENT_MULTIMODAL_TURN_INPUT_LIMIT,
    recentTurnInputCount: recentTurnInputs.length,
    assetCounts,
    degradationCounts,
    sourceChannelCounts: mapCountEntries(sourceChannelCounts).map(([sourceChannel, count]) => ({
      sourceChannel,
      count,
    })),
    runtimeTargetCounts: mapCountEntries(runtimeTargetCounts).map(([runtimeTarget, count]) => ({
      runtimeTarget,
      count,
    })),
    warningCodeCounts: mapCountEntries(warningCodeCounts).map(([code, count]) => ({
      code,
      count,
    })),
    lastTurn: lastRecord
      ? buildMultimodalLastTurnSummary(lastRecord)
      : null,
    lastBlockedTurn: lastBlockedRecord
      ? buildMultimodalLastTurnSummary(lastBlockedRecord)
      : null,
  };
}

function createEmptyMultimodalDiagnosticsSummary(available: boolean): RuntimeMultimodalDiagnosticsSummary {
  return {
    available,
    sampleWindowSize: RECENT_MULTIMODAL_TURN_INPUT_LIMIT,
    recentTurnInputCount: 0,
    assetCounts: {
      image: 0,
      document: 0,
    },
    degradationCounts: {
      native: 0,
      losslessTextualization: 0,
      controlledFallback: 0,
      blocked: 0,
      unknown: 0,
    },
    sourceChannelCounts: [],
    runtimeTargetCounts: [],
    warningCodeCounts: [],
    lastTurn: null,
    lastBlockedTurn: null,
  };
}

function compareRecentTurnInput(
  leftCreatedAt: string,
  leftRequestId: string,
  rightCreatedAt: string,
  rightRequestId: string,
): number {
  const timestampDiff = rightCreatedAt.localeCompare(leftCreatedAt);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return rightRequestId.localeCompare(leftRequestId);
}

function incrementCount(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function mapCountEntries(counter: Map<string, number>): Array<[string, number]> {
  return [...counter.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function normalizeCountKey(value: string | undefined): string {
  const normalized = normalizeOptionalText(value);
  return normalized ?? "unknown";
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeDegradationLevel(
  value: "native" | "lossless_textualization" | "controlled_fallback" | "blocked" | undefined,
): RuntimeMultimodalLastTurnSummary["degradationLevel"] {
  return value ?? "unknown";
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function buildMultimodalLastTurnSummary(record: {
  turn: ReturnType<SqliteCodexSessionRegistry["listSessionTurns"]>[number];
  input: NonNullable<ReturnType<SqliteCodexSessionRegistry["getTurnInput"]>>;
}): RuntimeMultimodalLastTurnSummary {
  const sessionId = normalizeOptionalText(record.input.envelope.sourceSessionId) ?? normalizeOptionalText(record.turn.sessionId);

  return {
    requestId: record.turn.requestId,
    sourceChannel: record.input.envelope.sourceChannel,
    ...(sessionId ? { sessionId } : {}),
    createdAt: record.input.createdAt,
    runtimeTarget: normalizeOptionalText(record.input.compileSummary?.runtimeTarget) ?? null,
    degradationLevel: normalizeDegradationLevel(record.input.compileSummary?.degradationLevel),
    partTypes: dedupeStrings(
      [...record.input.envelope.parts]
        .sort((left, right) => left.order - right.order)
        .map((part) => part.type),
    ),
    assetKinds: dedupeStrings(record.input.assets.map((asset) => asset.kind)),
    warningCodes: dedupeStrings(record.input.compileSummary?.warnings.map((warning) => warning.code) ?? []),
    warningMessages: dedupeStrings(record.input.compileSummary?.warnings.map((warning) => warning.message) ?? []),
    capabilityMatrix: record.input.compileSummary?.capabilityMatrix ?? null,
  };
}

function summarizeBlockedMultimodalInputs(summary: RuntimeMultimodalDiagnosticsSummary): string {
  const parts = [
    `最近 ${summary.recentTurnInputCount} 条 turn input 中有 ${summary.degradationCounts.blocked} 条被 runtime 阻止。`,
  ];

  if (summary.lastBlockedTurn) {
    parts.push(
      `最近一次 blocked 来自 ${summary.lastBlockedTurn.sourceChannel}，编译结果是 ${summary.lastBlockedTurn.runtimeTarget ?? "unknown"} / ${summary.lastBlockedTurn.degradationLevel}。`,
    );
    if (summary.lastBlockedTurn.warningCodes.length > 0) {
      parts.push(`原因码：${summary.lastBlockedTurn.warningCodes.join(", ")}。`);
    } else if (summary.lastBlockedTurn.warningMessages.length > 0) {
      parts.push(`原因：${summary.lastBlockedTurn.warningMessages.join(" / ")}。`);
    }
  } else if (summary.lastTurn) {
    parts.push(
      `最新一条来自 ${summary.lastTurn.sourceChannel}，编译结果是 ${summary.lastTurn.runtimeTarget ?? "unknown"} / ${summary.lastTurn.degradationLevel}。`,
    );
  }

  return parts.join(" ");
}
