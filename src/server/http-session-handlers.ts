import type { IncomingMessage, ServerResponse } from "node:http";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

export async function handleSessionReset(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
): Promise<void> {
  try {
    const payload = (await readJsonBody(request)) as { sessionId?: string };
    const sessionId = payload.sessionId?.trim();

    if (!sessionId) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: "Missing sessionId.",
        },
      });
      return;
    }

    const cleared = await runtime.resetSession(sessionId);

    writeJson(response, 200, {
      ok: true,
      sessionId,
      cleared,
    });
  } catch (error) {
    writeJson(response, resolveErrorStatusCode(error, true), {
      error: createTaskError(error, true),
    });
  }
}

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
