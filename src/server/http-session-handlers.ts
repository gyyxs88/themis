import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildForkContextFromThread,
  buildPreferredForkContext,
} from "../core/codex-session-fork.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { resolveStoredSessionThreadReference } from "../core/session-thread-reference.js";
import {
  SESSION_WORKSPACE_LOCKED_ERROR,
  persistSessionTaskSettings,
} from "../core/session-settings-service.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { RuntimeEngine, TaskRuntimeRegistry } from "../types/index.js";
import { resolveTaskRuntime } from "../types/index.js";
import { appendWebAuditEvent, buildRemoteIpContext } from "./http-audit.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

export async function handleSessionForkContext(
  request: IncomingMessage,
  response: ServerResponse,
  runtimeRegistry: TaskRuntimeRegistry,
): Promise<void> {
  try {
    const payload = (await readJsonBody(request)) as {
      sessionId?: string;
      threadId?: string;
      targetSessionId?: string;
    };
    const sessionId = payload.sessionId?.trim() ?? "";
    const threadId = payload.threadId?.trim();
    const targetSessionId = payload.targetSessionId?.trim();

    if (!sessionId && !threadId) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: "Missing sessionId or threadId.",
        },
      });
      return;
    }

    const store = runtimeRegistry.defaultRuntime.getRuntimeStore() as SqliteCodexSessionRegistry;

    if (targetSessionId && !canBindForkedSession(store, targetSessionId)) {
      writeJson(response, 409, {
        error: {
          code: "SESSION_CONFLICT",
          message: "Target session already has persisted history and cannot be rebound.",
        },
      });
      return;
    }

    const sourceThreadId = resolveForkSourceThreadId(store, sessionId, threadId);
    const runtimeEngine = sessionId ? resolveSessionRuntimeEngine(store, sessionId) : null;
    const selectedRuntime = runtimeEngine
      ? resolveTaskRuntime(runtimeRegistry, runtimeEngine)
      : runtimeRegistry.defaultRuntime;
    const optimisticAppServerRuntime = runtimeRegistry.runtimes?.["app-server"];
    const nativeForkRuntime = runtimeEngine === "app-server"
      ? selectedRuntime
      : (sourceThreadId && targetSessionId && optimisticAppServerRuntime && typeof optimisticAppServerRuntime.forkThread === "function"
        ? optimisticAppServerRuntime
        : null);
    const nativeFork = sourceThreadId && nativeForkRuntime && typeof nativeForkRuntime.forkThread === "function"
      ? nativeForkRuntime.forkThread
      : null;
    const forkContext = await buildPreferredForkContext({
      runtimeEngine: nativeFork ? "app-server" : runtimeEngine,
      sourceThreadId: sourceThreadId ?? "",
      ...(nativeFork
        ? {
          forkThread: async () => await nativeFork({
          threadId: sourceThreadId!,
          }),
        }
        : {}),
      replayFallback: async () => {
        if (!sourceThreadId) {
          return null;
        }

        return await buildForkContextFromThread(sourceThreadId);
      },
    });

    if (!forkContext) {
      writeJson(response, 404, {
        error: {
          code: "SESSION_NOT_FOUND",
          message: "No persisted Codex session transcript was found for this conversation.",
        },
      });
      return;
    }

    if (forkContext.strategy === "native-thread-fork" && targetSessionId) {
      if (!bindForkedSession(store, targetSessionId, forkContext.threadId)) {
        writeJson(response, 409, {
          error: {
            code: "SESSION_CONFLICT",
            message: "Target session already has persisted history and cannot be rebound.",
          },
        });
        return;
      }
    }

    writeJson(response, 200, {
      ok: true,
      ...(sessionId ? { sessionId } : {}),
      ...(targetSessionId ? { targetSessionId } : {}),
      ...forkContext,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

export function handleSessionSettingsRead(
  url: URL,
  response: ServerResponse,
  store: SqliteCodexSessionRegistry,
  headOnly = false,
): void {
  const sessionId = extractSessionIdFromSettingsPath(url.pathname);

  if (!sessionId) {
    writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "Missing session id.",
      },
    }, headOnly);
    return;
  }

  const record = store.getSessionTaskSettings(sessionId);

  writeJson(response, 200, {
    sessionId,
    found: Boolean(record),
    settings: record?.settings ?? null,
    createdAt: record?.createdAt ?? null,
    updatedAt: record?.updatedAt ?? null,
  }, headOnly);
}

export async function handleSessionSettingsWrite(
  request: IncomingMessage,
  response: ServerResponse,
  store: SqliteCodexSessionRegistry,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const sessionId = extractSessionIdFromSettingsPath(url.pathname);

    if (!sessionId) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: "Missing session id.",
        },
      });
      return;
    }

    const payload = await readJsonBody(request) as { settings?: unknown };
    const patch = hasOwnProperty(payload, "settings") ? payload.settings : payload;
    const result = persistSessionTaskSettings(store, sessionId, patch, new Date().toISOString());

    appendWebAuditEvent(
      store,
      "web_access.session_settings_updated",
      "session 任务设置已更新",
      {
        sessionId: result.sessionId,
        cleared: result.cleared,
        settings: result.settings,
      },
      buildRemoteIpContext(request),
    );

    writeJson(response, 200, {
      ok: true,
      ...result,
    });
  } catch (error) {
    if (isSessionSettingsRequestError(error)) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: toErrorMessage(error),
        },
      });
      return;
    }

    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

function extractSessionIdFromSettingsPath(pathname: string): string {
  const prefix = "/api/sessions/";
  const suffix = "/settings";

  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return "";
  }

  return decodeURIComponent(pathname.slice(prefix.length, pathname.length - suffix.length)).trim();
}

function hasOwnProperty(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && Object.prototype.hasOwnProperty.call(value, key);
}

function isSessionSettingsRequestError(error: unknown): boolean {
  const message = toErrorMessage(error);
  return message === SESSION_WORKSPACE_LOCKED_ERROR
    || message === "Session id is required."
    || message === "工作区不能为空。"
    || message === "只支持服务端本机绝对路径。"
    || message === "工作区不存在。"
    || message === "工作区不是目录。"
    || message === "工作区不可访问。";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveForkSourceThreadId(
  store: SqliteCodexSessionRegistry,
  sessionId: string,
  explicitThreadId?: string,
): string | null {
  const normalizedExplicit = normalizeText(explicitThreadId);

  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  if (!sessionId) {
    return null;
  }

  return resolveStoredSessionThreadReference(store, sessionId).threadId;
}

function resolveSessionRuntimeEngine(
  store: SqliteCodexSessionRegistry,
  sessionId: string,
): RuntimeEngine | null {
  return resolveStoredSessionThreadReference(store, sessionId).engine;
}

function bindForkedSession(
  store: SqliteCodexSessionRegistry,
  targetSessionId: string,
  threadId: string,
): boolean {
  const timestamp = new Date().toISOString();

  return store.tryCreateSessionBinding({
    sessionId: targetSessionId,
    threadId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function canBindForkedSession(
  store: SqliteCodexSessionRegistry,
  targetSessionId: string,
): boolean {
  if (store.getSession(targetSessionId)) {
    return false;
  }

  return store.listSessionTurns(targetSessionId).length === 0;
}

function normalizeText(value: string | undefined | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
