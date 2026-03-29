import type { IncomingMessage, ServerResponse } from "node:http";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { resolveStoredSessionThreadReference } from "../core/session-thread-reference.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import {
  resolveTaskRuntime,
  type RuntimeEngine,
  type TaskActionSubmitRequest,
  type TaskPendingActionSubmitRequest,
  type TaskRuntimeRegistry,
} from "../types/index.js";
import { readJsonBody } from "./http-request.js";
import { writeJson } from "./http-responses.js";

export async function handleTaskActionSubmit(
  request: IncomingMessage,
  response: ServerResponse,
  actionBridge: AppServerActionBridge,
  runtimeRegistry: TaskRuntimeRegistry,
): Promise<void> {
  let payload: TaskActionSubmitRequest;

  try {
    payload = (await readJsonBody(request)) as TaskActionSubmitRequest;
  } catch (error) {
    if (error instanceof SyntaxError) {
      writeJson(response, 400, {
        error: {
          code: "INVALID_REQUEST",
          message: "请求体不是合法的 JSON。",
        },
      });
      return;
    }

    throw error;
  }

  if (isReviewActionSubmitRequest(payload)) {
    return await handleReviewActionSubmit(response, payload, runtimeRegistry);
  }

  if (isSteerActionSubmitRequest(payload)) {
    return await handleSteerActionSubmit(response, payload, runtimeRegistry);
  }

  if (!isPendingActionSubmitRequest(payload)) {
    writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "当前 action 请求缺少必要字段。",
      },
    });
    return;
  }

  const action = actionBridge.findBySubmission(payload.taskId, payload.requestId, payload.actionId);

  if (!action) {
    writeJson(response, 404, {
      error: {
        code: "INVALID_REQUEST",
        message: "未找到匹配的等待中 action。",
      },
    });
    return;
  }

  if (!actionBridge.resolve(payload)) {
    writeJson(response, 404, {
      error: {
        code: "INVALID_REQUEST",
        message: "未找到匹配的等待中 action。",
      },
    });
    return;
  }

  writeJson(response, 200, { ok: true });
}

async function handleReviewActionSubmit(
  response: ServerResponse,
  payload: Extract<TaskActionSubmitRequest, { mode: "review" }>,
  runtimeRegistry: TaskRuntimeRegistry,
): Promise<void> {
  const sessionId = normalizeText(payload.sessionId);
  const instructions = normalizeText(payload.instructions);

  if (!sessionId || !instructions) {
    writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "review 请求缺少 sessionId 或 instructions。",
      },
    });
    return;
  }

  const runtime = await selectRuntimeForSession(runtimeRegistry, sessionId);

  if (typeof runtime.startReview !== "function") {
    writeJson(response, 409, {
      error: {
        code: "UNSUPPORTED_ACTION",
        message: "当前会话的运行时不支持 review。",
      },
    });
    return;
  }

  let result;

  try {
    result = await runtime.startReview({
      sessionId,
      instructions,
    });
  } catch (error) {
    if (writeMappedInteractiveActionError(response, error)) {
      return;
    }

    throw error;
  }

  writeJson(response, 200, {
    ok: true,
    reviewThreadId: result.reviewThreadId,
    turnId: result.turnId,
  });
}

async function handleSteerActionSubmit(
  response: ServerResponse,
  payload: Extract<TaskActionSubmitRequest, { mode: "steer" }>,
  runtimeRegistry: TaskRuntimeRegistry,
): Promise<void> {
  const sessionId = normalizeText(payload.sessionId);
  const message = normalizeText(payload.message);

  if (!sessionId || !message) {
    writeJson(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "steer 请求缺少 sessionId 或 message。",
      },
    });
    return;
  }

  const runtime = await selectRuntimeForSession(runtimeRegistry, sessionId);

  if (typeof runtime.steerTurn !== "function") {
    writeJson(response, 409, {
      error: {
        code: "UNSUPPORTED_ACTION",
        message: "当前会话的运行时不支持 steer。",
      },
    });
    return;
  }

  const turnId = normalizeText(payload.turnId);
  let result;

  try {
    result = await runtime.steerTurn({
      sessionId,
      message,
      ...(turnId ? { turnId } : {}),
    });
  } catch (error) {
    if (writeMappedInteractiveActionError(response, error)) {
      return;
    }

    throw error;
  }

  writeJson(response, 200, {
    ok: true,
    turnId: result.turnId,
  });
}

async function selectRuntimeForSession(
  runtimeRegistry: TaskRuntimeRegistry,
  sessionId: string,
){
  const store = runtimeRegistry.defaultRuntime.getRuntimeStore() as SqliteCodexSessionRegistry;
  const runtimeEngine = resolveSessionRuntimeEngine(store, sessionId);

  if (runtimeEngine) {
    return resolveTaskRuntime(runtimeRegistry, runtimeEngine);
  }

  const storedThreadId = normalizeText(store.getSession(sessionId)?.threadId);
  const appServerRuntime = runtimeRegistry.runtimes?.["app-server"];

  if (storedThreadId && appServerRuntime?.readThreadSnapshot) {
    try {
      const snapshot = await appServerRuntime.readThreadSnapshot({
        threadId: storedThreadId,
      });

      if (snapshot) {
        return appServerRuntime;
      }
    } catch {
      // 让调用方继续走默认 runtime 的不支持分支。
    }
  }

  return runtimeRegistry.defaultRuntime;
}

function resolveSessionRuntimeEngine(
  store: SqliteCodexSessionRegistry,
  sessionId: string,
): RuntimeEngine | null {
  return resolveStoredSessionThreadReference(store, sessionId).engine;
}

function isPendingActionSubmitRequest(payload: TaskActionSubmitRequest): payload is TaskPendingActionSubmitRequest {
  return !("mode" in payload) || payload.mode === undefined;
}

function isReviewActionSubmitRequest(
  payload: TaskActionSubmitRequest,
): payload is Extract<TaskActionSubmitRequest, { mode: "review" }> {
  return "mode" in payload && payload.mode === "review";
}

function isSteerActionSubmitRequest(
  payload: TaskActionSubmitRequest,
): payload is Extract<TaskActionSubmitRequest, { mode: "steer" }> {
  return "mode" in payload && payload.mode === "steer";
}

function mapInteractiveActionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message === "当前会话还没有可用的 app-server thread。"
    || message === "当前会话还没有可引导的 app-server turn。"
    || message === "当前 app-server runtime 不支持 review/start。"
    || message === "当前 app-server runtime 不支持 turn/steer。"
  ) {
    const mapped = new Error(message);
    (mapped as Error & { statusCode?: number; errorCode?: string }).statusCode = 409;
    (mapped as Error & { statusCode?: number; errorCode?: string }).errorCode =
      message.includes("不支持") ? "UNSUPPORTED_ACTION" : "INVALID_ACTION_STATE";
    return mapped;
  }

  return error instanceof Error ? error : new Error(message);
}

function writeMappedInteractiveActionError(response: ServerResponse, error: unknown): boolean {
  const mapped = mapInteractiveActionError(error) as Error & {
    statusCode?: number;
    errorCode?: string;
  };

  if (!mapped.statusCode || !mapped.errorCode) {
    return false;
  }

  writeJson(response, mapped.statusCode, {
    error: {
      code: mapped.errorCode,
      message: mapped.message,
    },
  });
  return true;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
