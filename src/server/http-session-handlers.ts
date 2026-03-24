import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isSessionTaskSettingsEmpty,
  normalizeSessionTaskSettings,
} from "../core/session-task-settings.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

export async function handleSessionForkContext(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = (await readJsonBody(request)) as { sessionId?: string; threadId?: string };
    const sessionId = payload.sessionId?.trim() ?? "";
    const threadId = payload.threadId?.trim();

    if (!sessionId && !threadId) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: "Missing sessionId or threadId.",
        },
      });
      return;
    }

    const forkContext = await runtime.createForkContext(sessionId, threadId);

    if (!forkContext) {
      writeJson(response, 404, {
        error: {
          code: "SESSION_NOT_FOUND",
          message: "No persisted Codex session transcript was found for this conversation.",
        },
      });
      return;
    }

    writeJson(response, 200, {
      ok: true,
      ...(sessionId ? { sessionId } : {}),
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
    const settings = normalizeSessionTaskSettings(payload?.settings ?? payload);
    const existing = store.getSessionTaskSettings(sessionId);
    const now = new Date().toISOString();

    if (isSessionTaskSettingsEmpty(settings)) {
      store.deleteSessionTaskSettings(sessionId);
      writeJson(response, 200, {
        ok: true,
        sessionId,
        cleared: true,
        settings: null,
        createdAt: existing?.createdAt ?? null,
        updatedAt: now,
      });
      return;
    }

    store.saveSessionTaskSettings({
      sessionId,
      settings,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    writeJson(response, 200, {
      ok: true,
      sessionId,
      settings,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  } catch (error) {
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
