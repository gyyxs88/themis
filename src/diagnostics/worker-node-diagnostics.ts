import { existsSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { ManagedAgentPlatformWorkerClient } from "../core/managed-agent-platform-worker-client.js";
import { readOpenAICompatibleProviderConfigs } from "../core/openai-compatible-provider.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";

export interface WorkerNodeDiagnosticsWorkspaceSummary {
  inputPath: string;
  resolvedPath: string;
  status: "ok" | "relative" | "missing" | "not_directory";
}

export interface WorkerNodeDiagnosticsCredentialSummary {
  credentialId: string;
  status: "ok" | "missing";
  isActive: boolean;
  codexHome: string | null;
}

export interface WorkerNodeDiagnosticsProviderSummary {
  providerId: string;
  status: "ok" | "missing" | "read_error";
  source: "env" | "db" | null;
  defaultModel: string | null;
  message: string | null;
}

export interface WorkerNodeDiagnosticsPlatformSummary {
  status: "skipped" | "config_incomplete" | "ok" | "failed";
  baseUrl: string | null;
  nodeCount: number | null;
  message: string | null;
}

export interface WorkerNodeDiagnosticsSummary {
  generatedAt: string;
  workingDirectory: string;
  sqlite: {
    path: string;
    exists: boolean;
  };
  workspaces: WorkerNodeDiagnosticsWorkspaceSummary[];
  credentials: WorkerNodeDiagnosticsCredentialSummary[];
  providers: WorkerNodeDiagnosticsProviderSummary[];
  platform: WorkerNodeDiagnosticsPlatformSummary;
  primaryDiagnosis: {
    id: string;
    severity: "error" | "warning" | "info";
    title: string;
    summary: string;
  };
  recommendedNextSteps: string[];
}

export interface WorkerNodeDiagnosticsServiceOptions {
  workingDirectory: string;
  runtimeStore?: SqliteCodexSessionRegistry | null;
  sqliteFilePath?: string;
  fetchImpl?: typeof fetch;
}

export interface ReadWorkerNodeDiagnosticsInput {
  workspaceCapabilities: string[];
  credentialCapabilities: string[];
  providerCapabilities: string[];
  platformBaseUrl?: string | null;
  ownerPrincipalId?: string | null;
  webAccessToken?: string | null;
}

export class WorkerNodeDiagnosticsService {
  private readonly workingDirectory: string;
  private readonly runtimeStore: SqliteCodexSessionRegistry | null;
  private readonly sqliteFilePath: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WorkerNodeDiagnosticsServiceOptions) {
    this.workingDirectory = options.workingDirectory;
    this.runtimeStore = options.runtimeStore ?? null;
    this.sqliteFilePath = options.sqliteFilePath ?? join(this.workingDirectory, "infra/local/themis.db");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async readSummary(input: ReadWorkerNodeDiagnosticsInput): Promise<WorkerNodeDiagnosticsSummary> {
    const workspaces = dedupeStrings(input.workspaceCapabilities).map((workspacePath) =>
      summarizeWorkspacePath(this.workingDirectory, workspacePath)
    );
    const credentials = dedupeStrings(input.credentialCapabilities).map((credentialId) =>
      summarizeCredential(this.runtimeStore, credentialId)
    );
    const providers = summarizeProviders(
      this.workingDirectory,
      this.runtimeStore,
      dedupeStrings(input.providerCapabilities),
    );
    const platform = await this.probePlatform(input);
    const diagnosis = summarizeWorkerNodeDiagnosis({
      workspaces,
      credentials,
      providers,
      platform,
    });

    return {
      generatedAt: new Date().toISOString(),
      workingDirectory: this.workingDirectory,
      sqlite: {
        path: this.sqliteFilePath,
        exists: existsSync(this.sqliteFilePath),
      },
      workspaces,
      credentials,
      providers,
      platform,
      primaryDiagnosis: diagnosis.primaryDiagnosis,
      recommendedNextSteps: diagnosis.recommendedNextSteps,
    };
  }

  private async probePlatform(input: ReadWorkerNodeDiagnosticsInput): Promise<WorkerNodeDiagnosticsPlatformSummary> {
    const platformBaseUrl = normalizeOptionalText(input.platformBaseUrl);
    const ownerPrincipalId = normalizeOptionalText(input.ownerPrincipalId);
    const webAccessToken = normalizeOptionalText(input.webAccessToken);

    if (!platformBaseUrl && !ownerPrincipalId && !webAccessToken) {
      return {
        status: "skipped",
        baseUrl: null,
        nodeCount: null,
        message: "未提供平台连接参数，已跳过平台探测。",
      };
    }

    if (!platformBaseUrl || !ownerPrincipalId || !webAccessToken) {
      return {
        status: "config_incomplete",
        baseUrl: platformBaseUrl,
        nodeCount: null,
        message: "平台探测需要同时提供 --platform / --owner-principal / --token。",
      };
    }

    try {
      const client = new ManagedAgentPlatformWorkerClient({
        baseUrl: platformBaseUrl,
        ownerPrincipalId,
        webAccessToken,
        fetchImpl: this.fetchImpl,
      });
      const result = await client.probeAccess();
      return {
        status: "ok",
        baseUrl: platformBaseUrl,
        nodeCount: result.nodeCount,
        message: "平台登录与节点列表读取成功。",
      };
    } catch (error) {
      return {
        status: "failed",
        baseUrl: platformBaseUrl,
        nodeCount: null,
        message: toErrorMessage(error),
      };
    }
  }
}

function summarizeWorkspacePath(
  workingDirectory: string,
  inputPath: string,
): WorkerNodeDiagnosticsWorkspaceSummary {
  const resolvedPath = resolve(workingDirectory, inputPath);

  if (!inputPath.trim()) {
    return {
      inputPath,
      resolvedPath,
      status: "missing",
    };
  }

  if (!isAbsolutePathLike(inputPath)) {
    return {
      inputPath,
      resolvedPath,
      status: "relative",
    };
  }

  if (!existsSync(resolvedPath)) {
    return {
      inputPath,
      resolvedPath,
      status: "missing",
    };
  }

  if (!lstatSync(resolvedPath).isDirectory()) {
    return {
      inputPath,
      resolvedPath,
      status: "not_directory",
    };
  }

  return {
    inputPath,
    resolvedPath,
    status: "ok",
  };
}

function summarizeCredential(
  runtimeStore: SqliteCodexSessionRegistry | null,
  credentialId: string,
): WorkerNodeDiagnosticsCredentialSummary {
  const account = runtimeStore?.getAuthAccount(credentialId) ?? null;

  return {
    credentialId,
    status: account ? "ok" : "missing",
    isActive: account?.isActive ?? false,
    codexHome: account?.codexHome ?? null,
  };
}

function summarizeProviders(
  workingDirectory: string,
  runtimeStore: SqliteCodexSessionRegistry | null,
  providerCapabilities: string[],
): WorkerNodeDiagnosticsProviderSummary[] {
  if (providerCapabilities.length === 0) {
    return [];
  }

  try {
    const configs = readOpenAICompatibleProviderConfigs(workingDirectory, runtimeStore ?? undefined);
    const configById = new Map(configs.map((config) => [config.id, config]));

    return providerCapabilities.map((providerId) => {
      const config = configById.get(providerId) ?? null;

      return {
        providerId,
        status: config ? "ok" : "missing",
        source: config?.source ?? null,
        defaultModel: config?.defaultModel ?? null,
        message: config ? null : "当前工作目录里没有这个 provider 配置。",
      };
    });
  } catch (error) {
    const message = toErrorMessage(error);
    return providerCapabilities.map((providerId) => ({
      providerId,
      status: "read_error",
      source: null,
      defaultModel: null,
      message,
    }));
  }
}

function summarizeWorkerNodeDiagnosis(input: {
  workspaces: WorkerNodeDiagnosticsWorkspaceSummary[];
  credentials: WorkerNodeDiagnosticsCredentialSummary[];
  providers: WorkerNodeDiagnosticsProviderSummary[];
  platform: WorkerNodeDiagnosticsPlatformSummary;
}): {
  primaryDiagnosis: WorkerNodeDiagnosticsSummary["primaryDiagnosis"];
  recommendedNextSteps: string[];
} {
  const recommendedNextSteps = new Set<string>();
  const relativeWorkspaces = input.workspaces.filter((item) => item.status === "relative");
  const invalidWorkspaces = input.workspaces.filter((item) => item.status === "missing" || item.status === "not_directory");
  const missingCredentials = input.credentials.filter((item) => item.status === "missing");
  const brokenProviders = input.providers.filter((item) => item.status === "missing" || item.status === "read_error");

  if (input.platform.status === "config_incomplete") {
    recommendedNextSteps.add("补齐 --platform / --owner-principal / --token 后重跑 ./themis doctor worker-node。");
    return {
      primaryDiagnosis: {
        id: "platform_probe_config_incomplete",
        severity: "warning",
        title: "Worker Node 平台探测参数不完整",
        summary: "已提供部分平台参数，但不足以完成登录与节点列表探测。",
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  if (input.platform.status === "failed") {
    recommendedNextSteps.add("先确认平台 URL、owner principal 与 Web Access token 是否正确。");
    recommendedNextSteps.add("确认平台服务已启动后，再重跑 ./themis doctor worker-node。");
    return {
      primaryDiagnosis: {
        id: "platform_probe_failed",
        severity: "error",
        title: "Worker Node 无法连通平台",
        summary: input.platform.message ?? "平台登录或节点列表探测失败。",
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  if (invalidWorkspaces.length > 0) {
    recommendedNextSteps.add("把 --workspace 改成节点本机真实存在的绝对目录。");
    recommendedNextSteps.add("确认节点声明的 workspace capability 和派工快照里的 workspacePath 完全一致。");
    return {
      primaryDiagnosis: {
        id: "workspace_capability_invalid",
        severity: "error",
        title: "Worker Node workspace capability 无效",
        summary: `有 ${invalidWorkspaces.length} 个 workspace 路径不存在或不是目录。`,
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  if (relativeWorkspaces.length > 0) {
    recommendedNextSteps.add("把 --workspace 改成绝对路径，避免 scheduler 匹配不到节点。");
    return {
      primaryDiagnosis: {
        id: "workspace_capability_relative",
        severity: "warning",
        title: "Worker Node workspace capability 使用了相对路径",
        summary: "相对路径容易和平台侧 work item 的绝对 workspacePath 匹配失败。",
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  if (missingCredentials.length > 0) {
    recommendedNextSteps.add("为每个 --credential 准备对应本地 auth account，或移除不会真实提供的 capability。");
    recommendedNextSteps.add("如果任务默认使用 default 账号，至少保留 --credential default。");
    return {
      primaryDiagnosis: {
        id: "credential_capability_missing",
        severity: "error",
        title: "Worker Node 声明了 credential capability，但本地账号不存在",
        summary: `有 ${missingCredentials.length} 个 credential capability 在本地 runtime store 中不存在。`,
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  if (brokenProviders.length > 0) {
    recommendedNextSteps.add("补齐对应 provider 配置，或移除不会真实提供的 --provider capability。");
    recommendedNextSteps.add("如果 provider 来自环境变量，确认当前 shell 与 daemon 运行环境能读到同一组配置。");
    return {
      primaryDiagnosis: {
        id: "provider_capability_missing",
        severity: "error",
        title: "Worker Node provider capability 和本地 provider 配置不一致",
        summary: `有 ${brokenProviders.length} 个 provider capability 在当前工作目录中不可用。`,
      },
      recommendedNextSteps: [...recommendedNextSteps],
    };
  }

  recommendedNextSteps.add("可以继续用 ./themis worker-node run 启动节点执行循环。");
  if (input.platform.status === "skipped") {
    recommendedNextSteps.add("如果要连真实平台，再补 --platform / --owner-principal / --token 重跑一次预检。");
  }

  return {
    primaryDiagnosis: {
      id: "healthy",
      severity: "info",
      title: "Worker Node 预检通过",
      summary: input.platform.status === "ok"
        ? "本地 capability 与平台探测都通过，可以进入 daemon 启动阶段。"
        : "本地 capability 检查通过，可以继续补平台参数做远端探测。",
    },
    recommendedNextSteps: [...recommendedNextSteps],
  };
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbsolutePathLike(value: string): boolean {
  return resolve(value) === value;
}
