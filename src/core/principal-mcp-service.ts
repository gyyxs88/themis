import { randomInt, randomUUID } from "node:crypto";
import type { McpServerSummary } from "../mcp/mcp-inspector.js";
import { normalizeMcpServerList } from "../mcp/mcp-inspector.js";
import type { CodexAppServerNotification } from "./codex-app-server.js";
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
  onNotification?(handler: (notification: CodexAppServerNotification) => void): () => void;
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
  mcpOauthCallbackUrl?: string | null;
  mcpOauthCallbackBaseUrl?: string | null;
  mcpOauthCallbackPort?: number;
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
  sessionRetained: boolean;
  callbackBridge?: PrincipalMcpOauthCallbackBridge;
}

export interface PrincipalMcpOauthCallbackBridge {
  bridgeId: string;
  publicCallbackUrl: string;
  localCallbackPort: number;
}

export interface PrincipalMcpOauthStatusResult {
  target: PrincipalMcpRuntimeTarget;
  server: PrincipalMcpListItem;
  status: PrincipalMcpOauthAttemptStatus | "not_started";
  attempt: StoredPrincipalMcpOauthAttemptRecord | null;
  materialization?: StoredPrincipalMcpMaterializationRecord;
  refreshed: boolean;
  oauthSessionActive: boolean;
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

export function resolvePrincipalMcpOauthCallbackBaseUrl(
  env: Partial<Record<"THEMIS_MCP_OAUTH_CALLBACK_BASE_URL" | "THEMIS_BASE_URL", string | undefined>> = process.env,
): string | undefined {
  const explicit = normalizeMcpOauthCallbackBaseUrl(env.THEMIS_MCP_OAUTH_CALLBACK_BASE_URL);

  if (explicit) {
    return explicit;
  }

  const fallback = normalizeMcpOauthCallbackBaseUrl(env.THEMIS_BASE_URL);

  if (!fallback || isLoopbackUrl(fallback)) {
    return undefined;
  }

  return fallback;
}

interface ActivePrincipalMcpOauthSession {
  attemptId: string;
  principalId: string;
  serverName: string;
  target: PrincipalMcpRuntimeTarget;
  session: PrincipalMcpManagementSession;
  unsubscribe?: () => void;
  cleanupTimer: ReturnType<typeof setTimeout>;
  callbackBridge?: PrincipalMcpOauthCallbackBridge;
}

export class PrincipalMcpService {
  private readonly registry: SqliteCodexSessionRegistry;
  private readonly activeOauthSessions = new Map<string, ActivePrincipalMcpOauthSession>();

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

    const callbackBridge = createOauthCallbackBridge(options.mcpOauthCallbackBaseUrl, options.mcpOauthCallbackPort);
    const { target, createSession } = this.buildRuntimeSessionFactory(normalizedPrincipalId, {
      ...options,
      ...(callbackBridge ? {
        mcpOauthCallbackUrl: callbackBridge.publicCallbackUrl,
        mcpOauthCallbackPort: callbackBridge.localCallbackPort,
      } : {}),
    });
    const session = await createSession();
    let closeSessionOnExit = true;
    let unsubscribe: (() => void) | undefined;

    try {
      await session.initialize();
      const supportsCompletionNotification = typeof session.onNotification === "function";
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

      if (supportsCompletionNotification && session.onNotification) {
        this.closeActiveOauthSessionsForServer(
          normalizedPrincipalId,
          normalizedServerName,
          "已发起新的 OAuth 授权，旧的等待会话已关闭。",
        );
        unsubscribe = session.onNotification((notification) => {
          if (notification.method === "mcpServer/oauthLogin/completed") {
            void this.finishActiveOauthSession(attempt.attemptId, "completed");
          }
        });
        this.trackActiveOauthSession({
          attemptId: attempt.attemptId,
          principalId: normalizedPrincipalId,
          serverName: normalizedServerName,
          target,
          session,
          unsubscribe,
          cleanupTimer: setTimeout(() => {
            void this.finishActiveOauthSession(
              attempt.attemptId,
              "failed",
              "OAuth callback 等待超时。",
            );
          }, resolveOauthSessionTimeoutMs(options.timeoutSecs)),
          ...(callbackBridge ? { callbackBridge } : {}),
        });
        closeSessionOnExit = false;
      }

      return {
        target,
        server: this.getPrincipalMcpServer(normalizedPrincipalId, normalizedServerName)!,
        authorizationUrl,
        attempt,
        sessionRetained: !closeSessionOnExit,
        ...(callbackBridge && !closeSessionOnExit ? { callbackBridge } : {}),
      };
    } finally {
      if (closeSessionOnExit) {
        unsubscribe?.();
        await session.close();
      }
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
      oauthSessionActive: Boolean(attempt && this.activeOauthSessions.has(attempt.attemptId)),
      nextStep: describeOauthNextStep(normalizedServerName, status, attempt),
    };
  }

  async handlePrincipalMcpOauthCallback(
    bridgeId: string,
    search: string,
  ): Promise<{
    statusCode: number;
    contentType: string;
    body: string;
  }> {
    const normalizedBridgeId = normalizeOptionalText(bridgeId);

    if (!normalizedBridgeId) {
      return createOauthCallbackBridgeResponse(400, "Invalid OAuth callback.");
    }

    const activeSession = Array.from(this.activeOauthSessions.values())
      .find((entry) => entry.callbackBridge?.bridgeId === normalizedBridgeId);

    if (!activeSession?.callbackBridge) {
      return createOauthCallbackBridgeResponse(404, "OAuth callback has expired or is unknown.");
    }

    const callbackUrl = `http://127.0.0.1:${activeSession.callbackBridge.localCallbackPort}/callback${search}`;

    try {
      const response = await fetch(callbackUrl, {
        method: "GET",
        redirect: "manual",
      });
      const body = await response.text();

      return {
        statusCode: response.status,
        contentType: response.headers.get("content-type") ?? "text/plain; charset=utf-8",
        body,
      };
    } catch (error) {
      await this.finishActiveOauthSession(
        activeSession.attemptId,
        "failed",
        `OAuth callback bridge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return createOauthCallbackBridgeResponse(502, "OAuth callback bridge failed.");
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
    const oauthCallbackOverrides = buildMcpOauthCallbackConfigOverrides(options);
    const configOverrides: CodexCliConfigOverrides = {
      ...accountOverrides,
      ...principalOverrides,
      ...oauthCallbackOverrides,
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

  private trackActiveOauthSession(session: ActivePrincipalMcpOauthSession): void {
    this.activeOauthSessions.set(session.attemptId, session);
  }

  private closeActiveOauthSessionsForServer(principalId: string, serverName: string, lastError: string): void {
    for (const session of this.activeOauthSessions.values()) {
      if (session.principalId === principalId && session.serverName === serverName) {
        void this.finishActiveOauthSession(session.attemptId, "failed", lastError);
      }
    }
  }

  private async finishActiveOauthSession(
    attemptId: string,
    status: PrincipalMcpOauthAttemptStatus,
    lastError?: string,
  ): Promise<void> {
    const activeSession = this.activeOauthSessions.get(attemptId);

    if (!activeSession) {
      return;
    }

    this.activeOauthSessions.delete(attemptId);
    clearTimeout(activeSession.cleanupTimer);
    activeSession.unsubscribe?.();

    const now = new Date().toISOString();
    const latestAttempt = this.registry.getLatestPrincipalMcpOauthAttempt(
      activeSession.principalId,
      activeSession.serverName,
    );

    if (latestAttempt?.attemptId === attemptId) {
      this.registry.savePrincipalMcpOauthAttempt({
        ...latestAttempt,
        status,
        updatedAt: now,
        ...(status === "completed" ? { completedAt: latestAttempt.completedAt ?? now } : {}),
        ...(status === "failed" && lastError ? { lastError } : {}),
      });
    }

    if (status === "completed") {
      this.savePrincipalMcpMaterialization({
        principalId: activeSession.principalId,
        serverName: activeSession.serverName,
        targetKind: activeSession.target.targetKind,
        targetId: activeSession.target.targetId,
        state: "synced",
        authState: "authenticated",
        lastSyncedAt: now,
      });
    }

    try {
      await activeSession.session.close();
    } catch {
      // The OAuth callback has already reached a terminal state; close failures are non-fatal.
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

function buildMcpOauthCallbackConfigOverrides(options: PrincipalMcpRuntimeOptions): CodexCliConfigOverrides {
  const callbackUrl = normalizeOptionalText(options.mcpOauthCallbackUrl);
  const callbackPort = normalizeMcpOauthCallbackPort(options.mcpOauthCallbackPort);

  return {
    ...(callbackUrl ? { mcp_oauth_callback_url: callbackUrl } : {}),
    ...(typeof callbackPort === "number" ? { mcp_oauth_callback_port: callbackPort } : {}),
  };
}

function createOauthCallbackBridge(
  configuredBaseUrl: string | null | undefined,
  configuredPort: number | undefined,
): PrincipalMcpOauthCallbackBridge | undefined {
  const baseUrl = normalizeMcpOauthCallbackBaseUrl(configuredBaseUrl);

  if (!baseUrl) {
    return undefined;
  }

  const bridgeId = randomUUID();
  const localCallbackPort = normalizeMcpOauthCallbackPort(configuredPort) ?? randomInt(20000, 50000);
  const publicCallbackUrl = new URL(`/api/mcp/oauth/callback/${bridgeId}`, `${baseUrl}/`).toString();

  return {
    bridgeId,
    publicCallbackUrl,
    localCallbackPort,
  };
}

function normalizeMcpOauthCallbackBaseUrl(value: string | null | undefined): string | undefined {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function normalizeMcpOauthCallbackPort(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 65535) {
    return undefined;
  }

  return value;
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname.endsWith(".localhost");
  } catch {
    return true;
  }
}

function resolveOauthSessionTimeoutMs(timeoutSecs: number | undefined): number {
  const normalizedTimeoutSecs = typeof timeoutSecs === "number" && Number.isFinite(timeoutSecs) && timeoutSecs > 0
    ? timeoutSecs
    : 900;

  return Math.min(Math.max(Math.ceil(normalizedTimeoutSecs + 5), 30), 3600) * 1000;
}

function createOauthCallbackBridgeResponse(statusCode: number, body: string): {
  statusCode: number;
  contentType: string;
  body: string;
} {
  return {
    statusCode,
    contentType: "text/plain; charset=utf-8",
    body,
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
