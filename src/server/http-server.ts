import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { RuntimeEngine, TaskRuntimeFacade } from "../types/index.js";
import { WebAccessService } from "../core/web-access.js";
import { serveWebAsset } from "./http-assets.js";
import {
  handleAuthAccountCreate,
  handleAuthAccountSelect,
  handleAuthLogin,
  handleAuthLoginCancel,
  handleAuthLogout,
  handleAuthStatus,
} from "./http-auth.js";
import { toErrorMessage } from "./http-errors.js";
import { handleHistorySessionDetail, handleHistorySessions } from "./http-history.js";
import {
  handleIdentityLinkCodeCreate,
  handleIdentityPersonaUpdate,
  handleIdentityReset,
  handleIdentityStatus,
  handleIdentityTaskSettingsUpdate,
} from "./http-identity.js";
import { handleRuntimeConfig } from "./http-runtime-config.js";
import {
  handleDiagnostics,
  handleDiagnosticsMcp,
  handleDiagnosticsMcpProbe,
  handleDiagnosticsMcpReload,
  type CreateMcpInspector,
} from "./http-diagnostics.js";
import {
  handleSkillsCuratedCatalog,
  handleSkillsInstall,
  handleSkillsList,
  handleSkillsRemove,
  handleSkillsSync,
} from "./http-skills.js";
import { writeJson } from "./http-responses.js";
import { maybeHandleWebAccessRoute, requireWebAccess } from "./http-web-access.js";
import {
  handleSessionForkContext,
  handleSessionSettingsRead,
  handleSessionSettingsWrite,
} from "./http-session-handlers.js";
import { handleTaskActionSubmit } from "./http-task-actions.js";
import { handleTaskRun, handleTaskStream } from "./http-task-handlers.js";
import {
  handleThirdPartyCapabilityWriteback,
  handleThirdPartyEndpointProbe,
  handleThirdPartyModelCreate,
  handleThirdPartyProbe,
  handleThirdPartyProviderCreate,
} from "./http-third-party-probe.js";

const DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID = "principal-local-owner";

export interface ThemisServerRuntimeRegistry {
  defaultRuntime: TaskRuntimeFacade;
  runtimes?: Partial<Record<RuntimeEngine, TaskRuntimeFacade>>;
}

export interface ThemisHttpServerOptions {
  host?: string;
  port?: number;
  runtime?: CodexTaskRuntime;
  runtimeRegistry?: ThemisServerRuntimeRegistry;
  authRuntime?: CodexAuthRuntime;
  taskTimeoutMs?: number;
  createMcpInspector?: CreateMcpInspector;
  actionBridge?: AppServerActionBridge;
}

export function createThemisHttpServer(options: ThemisHttpServerOptions = {}): Server {
  const runtime = options.runtime ?? new CodexTaskRuntime();
  const actionBridge = options.actionBridge ?? new AppServerActionBridge();
  const defaultAppServerRuntime = new AppServerTaskRuntime({
    workingDirectory: runtime.getWorkingDirectory(),
    runtimeStore: runtime.getRuntimeStore(),
    actionBridge,
  });
  const runtimeRegistry = normalizeRuntimeRegistry(runtime, defaultAppServerRuntime, options.runtimeRegistry);
  const authRuntime = options.authRuntime ?? new CodexAuthRuntime({
    workingDirectory: runtime.getWorkingDirectory(),
    registry: runtime.getRuntimeStore(),
    onManagedAccountReady: async (account) => {
      try {
        await runtime.getPrincipalSkillsService().syncAllSkillsToAuthAccount(
          DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID,
          account.accountId,
        );
      } catch (error) {
        console.error(`[themis/auth] 自动补同步 skills 失败：${toErrorMessage(error)}`);
      }
    },
  });
  const runtimeStore = runtime.getRuntimeStore();
  const webAccessService = new WebAccessService({ registry: runtimeStore });
  const taskTimeoutMs = options.taskTimeoutMs ?? resolveTaskTimeoutMs();

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const isHeadRequest = request.method === "HEAD";

      if (await maybeHandleWebAccessRoute(request, response, webAccessService)) {
        return;
      }

      if (!requireWebAccess(request, response, webAccessService)) {
        return;
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/health") {
        return writeJson(response, 200, {
          ok: true,
          service: "themis-webui",
        }, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/runtime/config") {
        return handleRuntimeConfig(response, runtime, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/diagnostics") {
        return handleDiagnostics(response, runtime, authRuntime, options.createMcpInspector, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/diagnostics/mcp") {
        return handleDiagnosticsMcp(response, runtime, authRuntime, options.createMcpInspector, isHeadRequest);
      }

      if (request.method === "POST" && url.pathname === "/api/diagnostics/mcp/probe") {
        return handleDiagnosticsMcpProbe(response, runtime, options.createMcpInspector);
      }

      if (request.method === "POST" && url.pathname === "/api/diagnostics/mcp/reload") {
        return handleDiagnosticsMcpReload(response, runtime, options.createMcpInspector);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/probe") {
        return handleThirdPartyProbe(request, response, runtime, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/codex-task-support") {
        return handleThirdPartyCapabilityWriteback(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/providers/endpoint-probe") {
        return handleThirdPartyEndpointProbe(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/providers") {
        return handleThirdPartyProviderCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/models") {
        return handleThirdPartyModelCreate(request, response, runtime);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/auth/status") {
        return handleAuthStatus(request, response, authRuntime, isHeadRequest);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/accounts") {
        return handleAuthAccountCreate(request, response, authRuntime, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/account/select") {
        return handleAuthAccountSelect(request, response, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/status") {
        return handleIdentityStatus(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/link-code") {
        return handleIdentityLinkCodeCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/reset") {
        return handleIdentityReset(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/persona") {
        return handleIdentityPersonaUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/task-settings") {
        return handleIdentityTaskSettingsUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/list") {
        return handleSkillsList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/install") {
        return handleSkillsInstall(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/remove") {
        return handleSkillsRemove(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/sync") {
        return handleSkillsSync(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/catalog/curated") {
        return handleSkillsCuratedCatalog(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        return handleAuthLogin(request, response, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login/cancel") {
        return handleAuthLoginCancel(request, response, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        return handleAuthLogout(request, response, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/run") {
        return handleTaskRun(request, response, runtime, runtimeRegistry, authRuntime, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/stream") {
        return handleTaskStream(request, response, runtime, runtimeRegistry, authRuntime, actionBridge, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/actions") {
        return await handleTaskActionSubmit(request, response, actionBridge, runtimeRegistry);
      }

      if (request.method === "POST" && url.pathname === "/api/sessions/fork-context") {
        return handleSessionForkContext(request, response, runtimeRegistry);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/settings")) {
        return handleSessionSettingsRead(url, response, runtimeStore, isHeadRequest);
      }

      if ((request.method === "PUT" || request.method === "POST") && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/settings")) {
        return handleSessionSettingsWrite(request, response, runtimeStore);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/history/sessions") {
        return handleHistorySessions(url, response, runtimeStore, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname.startsWith("/api/history/sessions/")) {
        return await handleHistorySessionDetail(url, response, runtimeStore, runtimeRegistry, isHeadRequest);
      }

      if (request.method === "GET" || isHeadRequest) {
        return serveWebAsset(url.pathname, response, isHeadRequest);
      }

      return writeJson(response, 405, {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `Unsupported method: ${request.method ?? "UNKNOWN"}`,
        },
      });
    } catch (error) {
      return writeJson(response, 500, {
        error: {
          code: "SERVER_ERROR",
          message: toErrorMessage(error),
        },
      });
    }
  });
}

export function resolveListenAddresses(host: string, port: number): string[] {
  const addresses = new Set<string>();
  addresses.add(`http://localhost:${port}`);

  if (host !== "0.0.0.0") {
    addresses.add(`http://${host}:${port}`);
    return [...addresses];
  }

  const interfaces = networkInterfaces();

  for (const values of Object.values(interfaces)) {
    for (const entry of values ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.add(`http://${entry.address}:${port}`);
      }
    }
  }

  return [...addresses];
}

function normalizeRuntimeRegistry(
  runtime: CodexTaskRuntime,
  defaultAppServerRuntime: TaskRuntimeFacade,
  runtimeRegistry: ThemisServerRuntimeRegistry | undefined,
): ThemisServerRuntimeRegistry {
  if (!runtimeRegistry) {
    return {
      defaultRuntime: defaultAppServerRuntime,
      runtimes: {
        sdk: runtime,
        "app-server": defaultAppServerRuntime,
      },
    };
  }

  const defaultRuntime = runtimeRegistry.defaultRuntime;
  const normalizedRegistry: ThemisServerRuntimeRegistry = {
    defaultRuntime,
    runtimes: {
      sdk: runtime,
      ...(runtimeRegistry.runtimes ?? {}),
    },
  };
  const baseStore = runtime.getRuntimeStore();

  if (defaultRuntime.getRuntimeStore() !== baseStore) {
    throw new Error("Task runtime store mismatch for default runtime: all runtimes must share the base runtime store.");
  }

  for (const [engine, registeredRuntime] of Object.entries(normalizedRegistry.runtimes ?? {})) {
    if (!registeredRuntime) {
      continue;
    }

    if (registeredRuntime.getRuntimeStore() !== baseStore) {
      throw new Error(`Task runtime store mismatch for engine "${engine}": all runtimes must share the base runtime store.`);
    }
  }

  return normalizedRegistry;
}

function resolveTaskTimeoutMs(): number {
  const rawValue = process.env.THEMIS_TASK_TIMEOUT_MS ?? "300000";
  const parsed = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
}
