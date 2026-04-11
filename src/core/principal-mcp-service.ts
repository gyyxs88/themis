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
  type PrincipalMcpSourceType,
  type StoredPrincipalMcpMaterializationRecord,
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
}

export interface UpsertPrincipalMcpServerInput {
  principalId: string;
  serverName: string;
  command: string;
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
    const command = normalizeRequiredText(input.command, "MCP command 不能为空。");
    const args = normalizeArgs(input.args);
    const cwd = normalizeOptionalText(input.cwd);
    const env = normalizeEnv(input.env);
    const now = normalizeNow(input.now);
    const existing = this.registry.getPrincipalMcpServer(principalId, serverName);
    const record: StoredPrincipalMcpServerRecord = {
      principalId,
      serverName,
      transportType: "stdio",
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

      this.savePrincipalMcpMaterialization({
        principalId: normalizedPrincipalId,
        serverName: normalizedServerName,
        targetKind: target.targetKind,
        targetId: target.targetId,
        state: "missing",
        authState: "auth_required",
        lastSyncedAt: normalizeNow(options.now),
      });

      return {
        target,
        server: this.getPrincipalMcpServer(normalizedPrincipalId, normalizedServerName)!,
        authorizationUrl,
      };
    } finally {
      await session.close();
    }
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

function normalizeRequiredText(value: string, errorMessage: string): string {
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
