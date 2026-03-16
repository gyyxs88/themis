import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { serveWebAsset } from "./http-assets.js";
import { toErrorMessage } from "./http-errors.js";
import { handleHistorySessionDetail, handleHistorySessions } from "./http-history.js";
import { writeJson } from "./http-responses.js";
import { handleSessionForkContext, handleSessionReset } from "./http-session-handlers.js";
import { handleTaskRun, handleTaskStream } from "./http-task-handlers.js";

export interface ThemisHttpServerOptions {
  host?: string;
  port?: number;
  runtime?: CodexTaskRuntime;
  taskTimeoutMs?: number;
}

export function createThemisHttpServer(options: ThemisHttpServerOptions = {}): Server {
  const runtime = options.runtime ?? new CodexTaskRuntime();
  const runtimeStore = runtime.getRuntimeStore();
  const taskTimeoutMs = options.taskTimeoutMs ?? resolveTaskTimeoutMs();

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const isHeadRequest = request.method === "HEAD";

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/health") {
        return writeJson(response, 200, {
          ok: true,
          service: "themis-webui",
        }, isHeadRequest);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/run") {
        return handleTaskRun(request, response, runtime, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/stream") {
        return handleTaskStream(request, response, runtime, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/sessions/reset") {
        return handleSessionReset(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/sessions/fork-context") {
        return handleSessionForkContext(request, response, runtime);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/history/sessions") {
        return handleHistorySessions(url, response, runtimeStore, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname.startsWith("/api/history/sessions/")) {
        return handleHistorySessionDetail(url, response, runtimeStore, isHeadRequest);
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

function resolveTaskTimeoutMs(): number {
  const rawValue = process.env.THEMIS_TASK_TIMEOUT_MS ?? "300000";
  const parsed = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
}
