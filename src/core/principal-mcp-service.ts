import { randomUUID } from "node:crypto";
import type { McpServerSummary } from "../mcp/mcp-inspector.js";
import { normalizeMcpServerList } from "../mcp/mcp-inspector.js";
import {
  buildCodexProcessEnv,
  createCodexAuthStorageConfigOverrides,
  ensureAuthAccountCodexHome,
  type CodexAuthAccountSummary,
} from "./auth-accounts.js";
import { CodexAppServerSession } from "./codex-app-server.js";
import type { CodexCliConfigOverrides } from "./auth-accounts.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  normalizePrincipalMcpServerName,
  type PrincipalMcpAuthState,
  type PrincipalMcpMaterializationState,
  type PrincipalMcpOauthAttemptStatus,
  type PrincipalMcpTransportType,
  type PrincipalMcpSourceType,
  type StoredPrincipalMcpMaterializationRecord,
  type StoredPrincipalMcpOauthAttemptRecord,
  type StoredPrincipalMcpServerRecord,
} from "./principal-mcp.js";

export interface PrincipalMcpServiceOptions {
  registry: SqliteCodexSessionRegistry;
}

interface PrincipalMcpManagementSession {
  initialize(): Promise<void>;
  request(method: string, params: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export interface PrincipalMcpRuntimeTarget {
  targetKind: "auth-account";
  targetId: string;
}

export interface PrincipalMcpCreateSessionInput {
  env?: Record<string, string>;
  configOverrides: CodexCliConfigOverrides;
  target: PrincipalMcpRuntimeTarget;
}

export interface PrincipalMcpRuntimeOptions {
  workingDirectory: string;
  activeAuthAccount?: Pick<CodexAuthAccountSummary, "accountId" | "codexHome"> | null;
  createSession?: (
    input: PrincipalMcpCreateSessionInput,
  ) => Promise<PrincipalMcpManagementSession> | PrincipalMcpManagementSession;
  now?: string;
}

export interface PrincipalMcpReloadResult {
  target: PrincipalMcpRuntimeTarget;
  runtimeServers: McpServerSummary[];
  servers: PrincipalMcpListItem[];
}

export interface PrincipalMcpOauthLoginResult {
  target: PrincipalMcpRuntimeTarget;
  server: PrincipalMcpListItem;
  authorizationUrl: string;
  attempt: StoredPrincipalMcpOauthAttemptRecord;
}

export interface PrincipalMcpOauthStatusResult {
  target: PrincipalMcpRuntimeTarget;
  server: PrincipalMcpListItem;
  status: PrincipalMcpOauthAttemptStatus | "not_started";
  attempt: StoredPrincipalMcpOauthAttemptRecord | null;
  materialization?: StoredPrincipalMcpMaterializationRecord;
  refreshed: boolean;
  nextStep: string;
}

export interface PrincipalMcpOauthStatusOptions extends Partial<PrincipalMcpRuntimeOptions> {
  refresh?: boolean;
}

export interface UpsertPrincipalMcpServerInput {
  principalId: string;
  serverName: string;
  transportType?: PrincipalMcpTransportType;
  command?: string;
  url?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  enabled?: boolean;
  sourceType?: PrincipalMcpSourceType;
  now?: string;
}

export interface PrincipalMcpMaterializationSummary {
  totalTargets: number;
  readyCount: number;
  authRequiredCount: number;
  failedCount: number;
}

export interface PrincipalMcpListItem extends StoredPrincipalMcpServerRecord {
  materializations: StoredPrincipalMcpMaterializationRecord[];
  summary: PrincipalMcpMaterializationSummary;
}

export interface RemovePrincipalMcpServerResult {
  serverName: string;
  removedDefinition: boolean;
  removedMaterializations: number;
}

export class PrincipalMcpService {
  private readonly registry: SqliteCodexSessionRegistry;

  constructor(options: PrincipalMcpServiceOptions) {
    this.registry = options.registry;
  }

  listPrincipalMcpServers(principalId: string): PrincipalMcpListItem[] {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");

    return this.registry
      .listPrincipalMcpServers(normalizedPrincipalId)
      .map((server) => {
        const materializations = this.registry.listPrincipalMcpMaterializations(
          normalizedPrincipalId,
          server.serverName,
        );

        return {
          ...server,
          materializations,
          summary: summarizeMaterializations(materializations),
        };
      });
  }

  getPrincipalMcpServer(principalId: string, serverName: string): PrincipalMcpListItem | null {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const normalizedServerName = normalizeRequiredServerName(serverName);
    const record = this.registry.getPrincipalMcpServer(normalizedPrincipalId, normalizedServerName);

    if (!record) {
      return null;
    }

    const materializations = this.registry.listPrincipalMcpMaterializations(
      normalizedPrincipalId,
      normalizedServerName,
    );

    return {
      ...record,
      materializations,
      summary: summarizeMaterializations(materializations),
    };
  }

  upsertPrincipalMcpServer(input: UpsertPrincipalMcpServerInput): PrincipalMcpListItem {
    const principalId = normalizeRequiredText(input.principalId, "principalId 不能为空。");
    const serverName = normalizeRequiredServerName(input.serverName);
    const now = normalizeNow(input.now);
    const existing = this.registry.getPrincipalMcpServer(principalId, serverName);
    const transportType = input.transportType ?? existing?.transportType ?? (
      normalizeOptionalText(input.url) ? "streamable_http" : "stdio"
    );
    const command = transportType === "streamable_http"
      ? normalizeRequiredText(input.url ?? input.command ?? existing?.command, "MCP url 不能为空。")
      : normalizeRequiredText(input.command ?? existing?.command, "MCP command 不能为空。");
    const args = transportType === "stdio" ? normalizeArgs(input.args) : [];
    const cwd = transportType === "stdio" ? normalizeOptionalText(input.cwd) : undefined;
    const env = transportType === "stdio" ? normalizeEnv(input.env) : {};
    const record: StoredPrincipalMcpServerRecord = {
      principalId,
      serverName,
      transportType,
      command,
      argsJson: JSON.stringify(args),
      envJson: JSON.stringify(env),
      ...(cwd ? { cwd } : {}),
      enabled: input.enabled ?? existing?.enabled ?? true,
      sourceType: input.sourceType ?? existing?.sourceType ?? "manual",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.registry.savePrincipalMcpServer(record);
    return this.getPrincipalMcpServer(principalId, serverName)!;
  }

  setPrincipalMcpServerEnabled(
    principalId: string,
    serverName: string,
    enabled: boolean,
    now?: string,
  ): PrincipalMcpListItem {
    const existing = this.registry.getPrincipalMcpServer(
      normalizeRequiredText(principalId, "principalId 不能为空。"),
      normalizeRequiredServerName(serverName),
    );

    if (!existing) {
      throw new Error(`MCP server ${serverName.trim()} 不存在。`);
    }

    this.registry.savePrincipalMcpServer({
      ...existing,
      enabled,
      updatedAt: normalizeNow(now),
    });

    return this.getPrincipalMcpServer(existing.principalId, existing.serverName)!;
  }

  removePrincipalMcpServer(principalId: string, serverName: string): RemovePrincipalMcpServerResult {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const normalizedServerName = normalizeRequiredServerName(serverName);
    const removedMaterializations = this.registry.deletePrincipalMcpMaterializations(
      normalizedPrincipalId,
      normalizedServerName,
    );
    this.registry.deletePrincipalMcpOauthAttempts(
      normalizedPrincipalId,
      normalizedServerName,
    );
    const removedDefinition = this.registry.deletePrincipalMcpServer(
      normalizedPrincipalId,
      normalizedServerName,
    );

    return {
      serverName: normalizedServerName,
      removedDefinition,
      removedMaterializations,
    };
  }

  savePrincipalMcpMaterialization(record: StoredPrincipalMcpMaterializationRecord): void {
    const principalId = normalizeRequiredText(record.principalId, "principalId 不能为空。");
    const serverName = normalizeRequiredServerName(record.serverName);

    if (!this.registry.getPrincipalMcpServer(principalId, serverName)) {
      throw new Error(`MCP server ${serverName} 不存在。`);
    }

    this.registry.savePrincipalMcpMaterialization({
      ...record,
      principalId,
      serverName,
    });
  }

  buildRuntimeConfigOverrides(principalId: string): CodexCliConfigOverrides {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const overrides: CodexCliConfigOverrides = {};

    for (const server of this.registry.listPrincipalMcpServers(normalizedPrincipalId)) {
      if (!server.enabled) {
        continue;
      }

      if (server.transportType === "streamable_http") {
        overrides[`mcp_servers.${server.serverName}`] = {
          url: normalizeRequiredText(server.command, `MCP server ${server.serverName} 的 url 不能为空。`),
        };
        continue;
      }

      const args = parseStringArray(server.argsJson, server.serverName, "args_json");
      const env = parseStringRecord(server.envJson, server.serverName, "env_json");
      overrides[`mcp_servers.${server.serverName}`] = {
        command: server.command,
        args,
        ...(server.cwd ? { cwd: server.cwd } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    }

    return overrides;
  }

  async reloadPrincipalMcpServers(
    principalId: string,
    options: PrincipalMcpRuntimeOptions,
  ): Promise<PrincipalMcpReloadResult> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const { target, createSession } = this.buildRuntimeSessionFactory(normalizedPrincipalId, options);
    const session = await createSession();

    try {
      await session.initialize();
      await session.request("config/mcpServer/reload", {});
      const response = await session.request("mcpServerStatus/list", {});
      const runtimeServers = normalizeMcpServerList(readObjectValue(response, "data"));

      this.updateRuntimeMaterializations(normalizedPrincipalId, target, runtimeServers, options.now);

      return {
        target,
        runtimeServers,
        servers: this.listPrincipalMcpServers(normalizedPrincipalId),
      };
    } finally {
      await session.close();
    }
  }

  async startPrincipalMcpOauthLogin(
    principalId: string,
    serverName: string,
    options: PrincipalMcpRuntimeOptions & {
      scopes?: string[];
      timeoutSecs?: number;
    },
  ): Promise<PrincipalMcpOauthLoginResult> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const normalizedServerName = normalizeRequiredServerName(serverName);
    const existing = this.getPrincipalMcpServer(normalizedPrincipalId, normalizedServerName);

    if (!existing) {
      throw new Error(`MCP server ${normalizedServerName} 不存在。`);
    }

    const { target, createSession } = this.buildRuntimeSessionFactory(normalizedPrincipalId, options);
    const session = await createSession();

    try {
      await session.initialize();
      const response = await session.request("mcpServer/oauth/login", {
        name: normalizedServerName,
        ...(Array.isArray(options.scopes) && options.scopes.length > 0 ? { scopes: options.scopes } : {}),
        ...(typeof options.timeoutSecs === "number" && Number.isFinite(options.timeoutSecs) && options.timeoutSecs > 0
          ? { timeoutSecs: options.timeoutSecs }
          : {}),
      });
      const authorizationUrl = normalizeOptionalText(readObjectValue(response, "authorizationUrl"));

      if (!authorizationUrl) {
        throw new Error(`MCP server ${normalizedServerName} 没有返回可用的 OAuth 授权链接。`);
      }

      const now = normalizeNow(options.now);
      const attempt: StoredPrincipalMcpOauthAttemptRecord = {
        attemptId: `mcp-oauth-${randomUUID()}`,
        principalId: normalizedPrincipalId,
        serverName: normalizedServerName,
        targetKind: target.targetKind,
        targetId: target.targetId,
        status: "waiting",
        authorizationUrl,
        startedAt: now,
        updatedAt: now,
      };

      this.registry.savePrincipalMcpOauthAttempt(attempt);
      this.savePrincipalMcpMaterialization({
        principalId: normalizedPrincipalId,
        serverName: normalizedServerName,
        targetKind: target.targetKind,
        targetId: target.targetId,
        state: "missing",
        authState: "auth_required",
        lastSyncedAt: now,
      });

      return {
        target,
        server: this.getPrincipalMcpServer(normalizedPrincipalId, normalizedServerName)!,
        authorizationUrl,
        attempt,
      };
    } finally {
      await session.close();
    }
  }

  async getPrincipalMcpOauthStatus(
    principalId: string,
    serverName: string,
    options: PrincipalMcpOauthStatusOptions = {},
  ): Promise<PrincipalMcpOauthStatusResult> {
    const normalizedPrincipalId = normalizeRequiredText(principalId, "principalId 不能为空。");
    const normalizedServerName = normalizeRequiredServerName(serverName);
    const existing = this.getPrincipalMcpServer(normalizedPrincipalId, normalizedServerName);

    if (!existing) {
      throw new Error(`MCP server ${normalizedServerName} 不存在。`);
    }

    let latestAttempt = this.registry.getLatestPrincipalMcpOauthAttempt(
      normalizedPrincipalId,
      normalizedServerName,
    );
    let refreshed = false;
    let target = this.resolveStatusTarget(options, latestAttempt);
    let server = existing;

    if (options.refresh !== false) {
      const reloadOptions: PrincipalMcpRuntimeOptions = {
        workingDirectory: normalizeRequiredText(options.workingDirectory, "workingDirectory 不能为空。"),
      };

      if (options.activeAuthAccount !== undefined) {
        reloadOptions.activeAuthAccount = options.activeAuthAccount;
      }

      if (options.createSession !== undefined) {
        reloadOptions.createSession = options.createSession;
      }

      if (options.now !== undefined) {
        reloadOptions.now = options.now;
      }

      const result = await this.reloadPrincipalMcpServers(normalizedPrincipalId, reloadOptions);
      refreshed = true;
      target = result.target;
      server = result.servers.find((item) => item.serverName === normalizedServerName)
        ?? this.getPrincipalMcpServer(normalizedPrincipalId, normalizedServerName)!;
    }

    latestAttempt = this.registry.getLatestPrincipalMcpOauthAttempt(
      normalizedPrincipalId,
      normalizedServerName,
    );
    const targetMaterialization = findMaterializationForTarget(server.materializations, target);
    const status = resolveOauthStatus(latestAttempt, targetMaterialization);
    const now = normalizeNow(options.now);
    const attempt = latestAttempt && status !== "not_started"
      ? updateOauthAttemptStatus(latestAttempt, status, now, targetMaterialization)
      : latestAttempt;

    if (attempt && refreshed) {
      this.registry.savePrincipalMcpOauthAttempt(attempt);
    }

    return {
      target,
      server: this.getPrincipalMcpServer(normalizedPrincipalId, normalizedServerName)!,
      status,
      attempt: attempt ?? null,
      ...(targetMaterialization ? { materialization: targetMaterialization } : {}),
      refreshed,
      nextStep: describeOauthNextStep(normalizedServerName, status, attempt),
    };
  }

  private buildRuntimeSessionFactory(
    principalId: string,
    options: PrincipalMcpRuntimeOptions,
  ): {
    target: PrincipalMcpRuntimeTarget;
    createSession: () => Promise<PrincipalMcpManagementSession>;
  } {
    const workingDirectory = normalizeRequiredText(options.workingDirectory, "workingDirectory 不能为空。");
    const fallbackActiveAccount = this.registry.getActiveAuthAccount();
    const activeAuthAccount = options.activeAuthAccount ?? (
      fallbackActiveAccount
        ? {
          accountId: fallbackActiveAccount.accountId,
          codexHome: fallbackActiveAccount.codexHome,
        }
        : null
    );
    const target: PrincipalMcpRuntimeTarget = {
      targetKind: "auth-account",
      targetId: normalizeOptionalText(activeAuthAccount?.accountId) ?? "default",
    };
    const principalOverrides = this.buildRuntimeConfigOverrides(principalId);
    const accountOverrides = activeAuthAccount
      ? createCodexAuthStorageConfigOverrides()
      : {};
    const configOverrides: CodexCliConfigOverrides = {
      ...accountOverrides,
      ...principalOverrides,
    };
    const env = activeAuthAccount
      ? buildManagedSessionEnv(workingDirectory, activeAuthAccount.codexHome)
      : undefined;

    return {
      target,
      createSession: async () => {
        if (options.createSession) {
          return await options.createSession({
            ...(env ? { env } : {}),
            configOverrides,
            target,
          });
        }

        return new CodexAppServerSession(workingDirectory, {
          ...(env ? { env } : {}),
          configOverrides,
        });
      },
    };
  }

  private updateRuntimeMaterializations(
    principalId: string,
    target: PrincipalMcpRuntimeTarget,
    runtimeServers: McpServerSummary[],
    now?: string,
  ): void {
    const checkedAt = normalizeNow(now);
    const runtimeServerByName = new Map<string, McpServerSummary>();

    for (const runtimeServer of runtimeServers) {
      const normalizedName = normalizeOptionalText(runtimeServer.name) ?? normalizeOptionalText(runtimeServer.id);

      if (!normalizedName) {
        continue;
      }

      runtimeServerByName.set(normalizedName, runtimeServer);
    }

    for (const server of this.registry.listPrincipalMcpServers(principalId)) {
      const runtimeServer = runtimeServerByName.get(server.serverName);
      const materialization = runtimeServer
        ? createMaterializationFromRuntimeServer(runtimeServer)
        : {
          state: "missing" as PrincipalMcpMaterializationState,
          authState: "unknown" as PrincipalMcpAuthState,
          lastError: `当前 runtime 槽位里没有看到 ${server.serverName} 的状态。`,
        };

      this.savePrincipalMcpMaterialization({
        principalId,
        serverName: server.serverName,
        targetKind: target.targetKind,
        targetId: target.targetId,
        state: materialization.state,
        authState: materialization.authState,
        lastSyncedAt: checkedAt,
        ...(materialization.lastError ? { lastError: materialization.lastError } : {}),
      });
    }
  }

  private resolveStatusTarget(
    options: PrincipalMcpOauthStatusOptions,
    latestAttempt?: StoredPrincipalMcpOauthAttemptRecord | null,
  ): PrincipalMcpRuntimeTarget {
    if (latestAttempt?.targetKind === "auth-account") {
      return {
        targetKind: latestAttempt.targetKind,
        targetId: latestAttempt.targetId,
      };
    }

    const fallbackActiveAccount = this.registry.getActiveAuthAccount();
    const activeAuthAccount = options.activeAuthAccount ?? (
      fallbackActiveAccount
        ? {
          accountId: fallbackActiveAccount.accountId,
          codexHome: fallbackActiveAccount.codexHome,
        }
        : null
    );

    return {
      targetKind: "auth-account",
      targetId: normalizeOptionalText(activeAuthAccount?.accountId) ?? "default",
    };
  }
}

function summarizeMaterializations(
  materializations: StoredPrincipalMcpMaterializationRecord[],
): PrincipalMcpMaterializationSummary {
  let readyCount = 0;
  let authRequiredCount = 0;
  let failedCount = 0;

  for (const materialization of materializations) {
    if (materialization.authState === "auth_required") {
      authRequiredCount += 1;
      continue;
    }

    if (materialization.state === "failed") {
      failedCount += 1;
      continue;
    }

    if (materialization.state === "synced") {
      readyCount += 1;
    }
  }

  return {
    totalTargets: materializations.length,
    readyCount,
    authRequiredCount,
    failedCount,
  };
}

function findMaterializationForTarget(
  materializations: StoredPrincipalMcpMaterializationRecord[],
  target: PrincipalMcpRuntimeTarget,
): StoredPrincipalMcpMaterializationRecord | undefined {
  return materializations.find(
    (materialization) => materialization.targetKind === target.targetKind
      && materialization.targetId === target.targetId,
  );
}

function resolveOauthStatus(
  attempt: StoredPrincipalMcpOauthAttemptRecord | null,
  materialization: StoredPrincipalMcpMaterializationRecord | undefined,
): PrincipalMcpOauthAttemptStatus | "not_started" {
  if (!attempt) {
    return "not_started";
  }

  if (!materialization) {
    return attempt.status === "completed" ? "completed" : "waiting";
  }

  if (materialization.state === "synced" && materialization.authState !== "auth_required") {
    return "completed";
  }

  if (materialization.state === "failed" || materialization.authState === "unsupported") {
    return "failed";
  }

  return "waiting";
}

function updateOauthAttemptStatus(
  attempt: StoredPrincipalMcpOauthAttemptRecord,
  status: PrincipalMcpOauthAttemptStatus,
  now: string,
  materialization: StoredPrincipalMcpMaterializationRecord | undefined,
): StoredPrincipalMcpOauthAttemptRecord {
  const baseAttempt: StoredPrincipalMcpOauthAttemptRecord = { ...attempt };

  delete baseAttempt.completedAt;
  delete baseAttempt.lastError;

  return {
    ...baseAttempt,
    status,
    updatedAt: now,
    ...(status === "completed" ? { completedAt: attempt.completedAt ?? now } : {}),
    ...(status === "failed" && materialization?.lastError ? { lastError: materialization.lastError } : {}),
  };
}

function describeOauthNextStep(
  serverName: string,
  status: PrincipalMcpOauthAttemptStatus | "not_started",
  attempt: StoredPrincipalMcpOauthAttemptRecord | null,
): string {
  if (status === "completed") {
    return "当前槽位已就绪；后续任务可以直接使用这个 MCP server。";
  }

  if (status === "failed") {
    return `当前槽位返回失败或不支持 OAuth；请检查 MCP server 配置，必要时重新执行 /mcp oauth ${serverName}。`;
  }

  if (status === "waiting" && attempt) {
    return `请打开授权链接完成授权，然后执行 /mcp oauth status ${serverName} 或 /mcp reload。`;
  }

  return `尚未记录授权尝试；请执行 /mcp oauth ${serverName}。`;
}

function parseStringArray(value: string, serverName: string, fieldName: string): string[] {
  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`MCP server ${serverName} 的 ${fieldName} 不是字符串数组。`);
  }

  return parsed
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseStringRecord(value: string, serverName: string, fieldName: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`MCP server ${serverName} 的 ${fieldName} 不是对象。`);
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([key, entry]) => key.trim().length > 0 && typeof entry === "string"),
  );
}

function buildManagedSessionEnv(workingDirectory: string, codexHome: string): Record<string, string> {
  ensureAuthAccountCodexHome(workingDirectory, codexHome);
  return buildCodexProcessEnv(codexHome);
}

function createMaterializationFromRuntimeServer(server: McpServerSummary): {
  state: PrincipalMcpMaterializationState;
  authState: PrincipalMcpAuthState;
  lastError?: string;
} {
  const status = normalizeOptionalText(server.status)?.toLowerCase() ?? "";
  const auth = normalizeOptionalText(server.auth)?.toLowerCase() ?? "";
  const detailText = [server.error, server.message, server.auth, server.status]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ")
    .toLowerCase();
  const normalizedError = normalizeOptionalText(server.error)
    ?? normalizeOptionalText(server.message)
    ?? (detailText ? detailText : undefined);

  if (matchesUnsupportedAuth(auth) || matchesUnsupportedAuth(detailText)) {
    return {
      state: "missing",
      authState: "unsupported",
      ...(normalizedError ? { lastError: normalizedError } : {}),
    };
  }

  if (matchesAuthIssue(auth) || matchesAuthIssue(detailText)) {
    return {
      state: "missing",
      authState: "auth_required",
      ...(normalizedError ? { lastError: normalizedError } : {}),
    };
  }

  if (matchesHealthyStatus(status) && !normalizeOptionalText(server.error) && !normalizeOptionalText(server.message)) {
    return {
      state: "synced",
      authState: auth ? "authenticated" : "unknown",
    };
  }

  if (!status || status === "unknown") {
    return {
      state: "missing",
      authState: auth ? "authenticated" : "unknown",
      ...(normalizedError ? { lastError: normalizedError } : {}),
    };
  }

  return {
    state: "failed",
    authState: auth ? "authenticated" : "unknown",
    ...(normalizedError ? { lastError: normalizedError } : {}),
  };
}

function normalizeArgs(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeEnv(value: Record<string, string> | undefined): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => key.trim().length > 0 && typeof entry === "string")
      .map(([key, entry]) => [key.trim(), entry]),
  );
}

function normalizeRequiredServerName(value: string): string {
  const normalized = normalizePrincipalMcpServerName(value);

  if (!normalized) {
    throw new Error("MCP server 名称不合法，仅支持字母、数字、下划线和短横线。");
  }

  return normalized;
}

function normalizeRequiredText(value: unknown, errorMessage: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error(errorMessage);
  }

  return normalized;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function readObjectValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  return (input as Record<string, unknown>)[key];
}

function normalizeNow(value: string | undefined): string {
  return normalizeOptionalText(value) ?? new Date().toISOString();
}

function matchesAuthIssue(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  return /(oauth|login|token|credential|unauthor|forbidden|permission|required|auth[_ -]?required)/.test(value);
}

function matchesUnsupportedAuth(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  return /(unsupported|not supported)/.test(value);
}

function matchesHealthyStatus(value: string): boolean {
  return /^(healthy|available|enabled|ready|ok)$/.test(value);
}
