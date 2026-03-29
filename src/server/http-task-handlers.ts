import type { IncomingMessage, ServerResponse } from "node:http";
import { InMemoryCommunicationRouter } from "../communication/router.js";
import { WebAdapter, type WebDeliveryMessage, type WebTaskPayload } from "../channels/index.js";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { appendTaskReplyQuotaFooter } from "../core/task-reply-quota.js";
import { parseRuntimeEngine, type TaskRequest, type TaskResult, type TaskRuntimeFacade, type TaskRuntimeRegistry } from "../types/index.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import { appendWebAuditEvent, resolveRemoteIp } from "./http-audit.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { safeWriteNdjson, writeJson, writeNdjson } from "./http-responses.js";

export async function handleTaskStream(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  runtimeRegistry: TaskRuntimeRegistry,
  authRuntime: CodexAuthRuntime,
  taskTimeoutMs: number,
): Promise<void> {
  const payload = (await readJsonBody(request)) as WebTaskPayload;
  const router = new InMemoryCommunicationRouter();
  const abortController = new AbortController();
  let streamClosed = false;
  let streamCompleted = false;
  const markClosed = (): void => {
    streamClosed = true;

    if (!streamCompleted && !abortController.signal.aborted) {
      abortController.abort(new Error("CLIENT_DISCONNECTED"));
    }
  };

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");

  request.on("close", markClosed);
  response.on("close", markClosed);

  const webAdapter = new WebAdapter({
    deliver: async (message) => {
      safeWriteNdjson(response, message, streamClosed);
    },
  });

  router.registerAdapter(webAdapter);

  let normalizedRequest: TaskRequest | null = null;

  try {
    normalizedRequest = router.normalizeRequest({
      ...payload,
      source: "web",
      taskId: payload.taskId ?? createId("task"),
    });

    await ensureAuthAvailable(authRuntime, normalizedRequest);

    const selectedRuntime = resolveTaskRuntimeForHttpRequest(runtimeRegistry, normalizedRequest);
    recordTaskAcceptedAudit(selectedRuntime, request, normalizedRequest, "/api/tasks/stream");

    writeNdjson(response, {
      kind: "ack",
      requestId: normalizedRequest.requestId,
      taskId: normalizedRequest.taskId,
      title: "task.accepted",
      text: "Themis accepted the stream request.",
    });

    const result = await selectedRuntime.runTask(normalizedRequest, {
      signal: abortController.signal,
      timeoutMs: taskTimeoutMs,
      finalizeResult: (request, taskResult) => appendTaskReplyQuotaFooter(authRuntime, request, taskResult),
      onEvent: async (event) => {
        await router.publishEvent(event);
      },
    });

    if (result.status === "cancelled") {
      recordTaskCancelledAudit(selectedRuntime, request, normalizedRequest, result, "/api/tasks/stream");
    }

    await router.publishResult(result);

    safeWriteNdjson(response, {
      kind: "done",
      requestId: normalizedRequest.requestId,
      taskId: result.taskId,
      title: "stream.completed",
      text: "Themis finished streaming the task result.",
      result: {
        status: result.status,
        summary: result.summary,
        ...(result.output ? { output: result.output } : {}),
        ...(result.touchedFiles?.length ? { touchedFiles: result.touchedFiles } : {}),
        ...(result.structuredOutput ? { structuredOutput: result.structuredOutput } : {}),
      },
    }, streamClosed);

    streamCompleted = true;
    response.end();
  } catch (error) {
    const taskError = resolveTaskHandlerError(error, Boolean(normalizedRequest));

    if (normalizedRequest) {
      await router.publishError(taskError, normalizedRequest);
    }

    safeWriteNdjson(response, {
      kind: "fatal",
      requestId: normalizedRequest?.requestId,
      taskId: normalizedRequest?.taskId,
      title: taskError.code,
      text: taskError.message,
    }, streamClosed);

    streamCompleted = true;
    response.end();
  } finally {
    request.off("close", markClosed);
    response.off("close", markClosed);
  }
}

export async function handleTaskRun(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  runtimeRegistry: TaskRuntimeRegistry,
  authRuntime: CodexAuthRuntime,
  taskTimeoutMs: number,
): Promise<void> {
  const payload = (await readJsonBody(request)) as WebTaskPayload;
  const deliveries: WebDeliveryMessage[] = [];
  const router = new InMemoryCommunicationRouter();
  const webAdapter = new WebAdapter({
    deliver: async (message) => {
      deliveries.push(message);
    },
  });

  router.registerAdapter(webAdapter);

  let normalizedRequest: TaskRequest | null = null;

  try {
    normalizedRequest = router.normalizeRequest({
      ...payload,
      source: "web",
    });

    await ensureAuthAvailable(authRuntime, normalizedRequest);

    const selectedRuntime = resolveTaskRuntimeForHttpRequest(runtimeRegistry, normalizedRequest);
    recordTaskAcceptedAudit(selectedRuntime, request, normalizedRequest, "/api/tasks/run");

    const result = await selectedRuntime.runTask(normalizedRequest, {
      timeoutMs: taskTimeoutMs,
      finalizeResult: (request, taskResult) => appendTaskReplyQuotaFooter(authRuntime, request, taskResult),
      onEvent: async (event) => {
        await router.publishEvent(event);
      },
    });

    if (result.status === "cancelled") {
      recordTaskCancelledAudit(selectedRuntime, request, normalizedRequest, result, "/api/tasks/run");
    }

    await router.publishResult(result);

    writeJson(response, 200, {
      requestId: normalizedRequest.requestId,
      taskId: result.taskId,
      deliveries,
      result: {
        status: result.status,
        summary: result.summary,
        ...(result.output ? { output: result.output } : {}),
        ...(result.touchedFiles?.length ? { touchedFiles: result.touchedFiles } : {}),
        ...(result.structuredOutput ? { structuredOutput: result.structuredOutput } : {}),
      },
    });
  } catch (error) {
    const taskError = resolveTaskHandlerError(error, Boolean(normalizedRequest));

    if (normalizedRequest) {
      await router.publishError(taskError, normalizedRequest);
    }

    writeJson(response, resolveTaskHandlerErrorStatusCode(error, Boolean(normalizedRequest)), {
      error: taskError,
      ...(normalizedRequest ? { requestId: normalizedRequest.requestId } : {}),
      ...(deliveries.length ? { deliveries } : {}),
    });
  }
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

async function ensureAuthAvailable(authRuntime: CodexAuthRuntime, request: TaskRequest): Promise<void> {
  if (request.options?.accessMode === "third-party") {
    if (authRuntime.readThirdPartyProviderProfile()?.type === "openai-compatible") {
      return;
    }

    throw new Error("当前没有可用的第三方兼容接入配置。");
  }

  const auth = await authRuntime.readSnapshot(request.options?.authAccountId);

  if (!auth.requiresOpenaiAuth || auth.authenticated) {
    return;
  }

  throw new Error("Not logged in");
}

function recordTaskAcceptedAudit(
  runtime: TaskRuntimeFacade,
  request: IncomingMessage,
  taskRequest: TaskRequest,
  route: "/api/tasks/run" | "/api/tasks/stream",
): void {
  const remoteIp = resolveRemoteIp(request);

  appendWebAuditEvent(
    resolveRuntimeStore(runtime),
    "web_access.task_accepted",
    "Web 任务已接受",
    {
      route,
      requestId: taskRequest.requestId,
      taskId: taskRequest.taskId ?? null,
      sourceChannel: taskRequest.sourceChannel,
      userId: taskRequest.user.userId,
      ...(taskRequest.channelContext.sessionId ? { sessionId: taskRequest.channelContext.sessionId } : {}),
      ...(taskRequest.channelContext.channelSessionKey ? { channelSessionKey: taskRequest.channelContext.channelSessionKey } : {}),
    },
    {
      ...(remoteIp ? { remoteIp } : {}),
    },
  );
}

function recordTaskCancelledAudit(
  runtime: TaskRuntimeFacade,
  request: IncomingMessage,
  taskRequest: TaskRequest,
  result: Pick<TaskResult, "taskId" | "requestId" | "status" | "summary">,
  route: "/api/tasks/run" | "/api/tasks/stream",
): void {
  const remoteIp = resolveRemoteIp(request);

  appendWebAuditEvent(
    resolveRuntimeStore(runtime),
    "web_access.task_cancelled",
    "Web 任务已取消",
    {
      route,
      requestId: result.requestId,
      taskId: result.taskId,
      status: result.status,
      summary: result.summary,
      sourceChannel: taskRequest.sourceChannel,
      userId: taskRequest.user.userId,
      ...(taskRequest.channelContext.sessionId ? { sessionId: taskRequest.channelContext.sessionId } : {}),
      ...(taskRequest.channelContext.channelSessionKey ? { channelSessionKey: taskRequest.channelContext.channelSessionKey } : {}),
    },
    {
      ...(remoteIp ? { remoteIp } : {}),
    },
  );
}

function resolveTaskRuntimeForHttpRequest(
  runtimeRegistry: TaskRuntimeRegistry,
  request: TaskRequest,
): TaskRuntimeFacade {
  const requestedValue = readRequestedRuntimeEngine(request);

  if (requestedValue === undefined) {
    return runtimeRegistry.defaultRuntime;
  }

  const parsedEngine = parseRuntimeEngine(requestedValue);

  if (!parsedEngine) {
    throw new InvalidTaskRuntimeSelectionError(`Invalid runtimeEngine: ${String(requestedValue)}`);
  }

  const selectedRuntime = runtimeRegistry.runtimes?.[parsedEngine];

  if (!selectedRuntime) {
    throw new InvalidTaskRuntimeSelectionError(`Requested runtimeEngine is not enabled: ${parsedEngine}`);
  }

  return selectedRuntime;
}

function readRequestedRuntimeEngine(request: TaskRequest): string | undefined {
  const options = request.options as { runtimeEngine?: unknown } | undefined;

  if (!options || !("runtimeEngine" in options)) {
    return undefined;
  }

  return typeof options.runtimeEngine === "string"
    ? options.runtimeEngine
    : String(options.runtimeEngine);
}

function resolveTaskHandlerError(error: unknown, hasNormalizedRequest: boolean) {
  if (error instanceof InvalidTaskRuntimeSelectionError) {
    return {
      code: "INVALID_REQUEST" as const,
      message: error.message,
    };
  }

  return createTaskError(error, hasNormalizedRequest);
}

function resolveTaskHandlerErrorStatusCode(error: unknown, hasNormalizedRequest: boolean): number {
  if (error instanceof InvalidTaskRuntimeSelectionError) {
    return 400;
  }

  return resolveErrorStatusCode(error, hasNormalizedRequest);
}

function resolveRuntimeStore(runtime: TaskRuntimeFacade): SqliteCodexSessionRegistry {
  return runtime.getRuntimeStore() as SqliteCodexSessionRegistry;
}

class InvalidTaskRuntimeSelectionError extends Error {}
