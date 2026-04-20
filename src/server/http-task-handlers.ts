import type { IncomingMessage, ServerResponse } from "node:http";
import { InMemoryCommunicationRouter } from "../communication/router.js";
import {
  WebAdapter,
  type WebDeliveryMessage,
  type WebTaskPayload,
} from "../channels/index.js";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { appendTaskReplyQuotaFooter } from "../core/task-reply-quota.js";
import { createTaskActivityTimeoutController } from "../core/task-activity-timeout.js";
import {
  InvalidTaskRuntimeSelectionError,
  resolvePublicTaskRuntime,
  type TaskRequest,
  type TaskResult,
  type TaskRuntimeFacade,
  type TaskRuntimeRegistry,
} from "../types/index.js";
import type { SqliteCodexSessionRegistry } from "../storage/index.js";
import { appendWebAuditEvent, resolveRemoteIp } from "./http-audit.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { buildAutomationTaskRunResponse, prepareAutomationTaskRequest } from "./http-task-automation.js";
import { readJsonBody } from "./http-request.js";
import { safeWriteNdjson, writeJson, writeNdjson } from "./http-responses.js";

export async function handleTaskStream(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  runtimeRegistry: TaskRuntimeRegistry,
  authRuntime: CodexAuthRuntime,
  actionBridge: AppServerActionBridge,
  taskTimeoutMs: number,
): Promise<void> {
  const payload = (await readJsonBody(request)) as WebTaskPayload;
  const router = new InMemoryCommunicationRouter();
  const abortController = new AbortController();
  const activityTimeout = createTaskActivityTimeoutController(abortController.signal, taskTimeoutMs);
  let streamClosed = false;
  let streamCompleted = false;
  let detachedRecoveryActionId: string | null = null;
  let detachedRecoveryCloseActionId: string | null = null;
  const closeAbortGraceMs = 63;
  let closeAbortTimer: ReturnType<typeof setTimeout> | null = null;
  const clearCloseAbortTimer = (): void => {
    if (closeAbortTimer) {
      clearTimeout(closeAbortTimer);
      closeAbortTimer = null;
    }
  };
  const armDetachedRecoveryClose = (actionId: string): void => {
    detachedRecoveryCloseActionId = actionId;
  };
  const markClosed = (): void => {
    streamClosed = true;

    if (streamCompleted || abortController.signal.aborted) {
      return;
    }

    if (hasRecoverableDetachedAction(normalizedRequest, detachedRecoveryActionId, actionBridge)) {
      if (detachedRecoveryActionId) {
        armDetachedRecoveryClose(detachedRecoveryActionId);
      }
      return;
    }

    if (detachedRecoveryCloseActionId !== null) {
      abortController.abort(new Error("CLIENT_DISCONNECTED"));
      return;
    }

    if (closeAbortTimer) {
      return;
    }

    closeAbortTimer = setTimeout(() => {
      closeAbortTimer = null;

      if (!streamCompleted && !abortController.signal.aborted && !hasRecoverableDetachedAction(normalizedRequest, detachedRecoveryActionId, actionBridge)) {
        abortController.abort(new Error("CLIENT_DISCONNECTED"));
      }
    }, closeAbortGraceMs);
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
      signal: activityTimeout.signal,
      finalizeResult: (request, taskResult) => appendTaskReplyQuotaFooter(authRuntime, request, taskResult),
      onEvent: async (event) => {
        activityTimeout.touch();
        if (event.type === "task.action_required" && typeof event.payload?.actionId === "string") {
          detachedRecoveryActionId = event.payload.actionId;
          if (streamClosed && hasRecoverableDetachedAction(normalizedRequest, event.payload.actionId, actionBridge)) {
            armDetachedRecoveryClose(event.payload.actionId);
            clearCloseAbortTimer();
          }
        }

        await activityTimeout.wrap(router.publishEvent(event));
      },
    });

    if (result.status === "cancelled") {
      recordTaskCancelledAudit(selectedRuntime, request, normalizedRequest, result, "/api/tasks/stream");
    }

    await activityTimeout.wrap(router.publishResult(result));

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
    activityTimeout.cleanup();
    clearCloseAbortTimer();
    request.off("close", markClosed);
    response.off("close", markClosed);
  }
}

function hasRecoverableDetachedAction(
  request: TaskRequest | null,
  actionId: string | null,
  actionBridge: AppServerActionBridge,
): boolean {
  if (!request?.taskId || !actionId) {
    return false;
  }

  return actionBridge.findBySubmission(request.taskId, request.requestId, actionId) !== null;
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
  const activityTimeout = createTaskActivityTimeoutController(undefined, taskTimeoutMs);
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
      signal: activityTimeout.signal,
      finalizeResult: (request, taskResult) => appendTaskReplyQuotaFooter(authRuntime, request, taskResult),
      onEvent: async (event) => {
        activityTimeout.touch();
        await activityTimeout.wrap(router.publishEvent(event));
      },
    });

    if (result.status === "cancelled") {
      recordTaskCancelledAudit(selectedRuntime, request, normalizedRequest, result, "/api/tasks/run");
    }

    await activityTimeout.wrap(router.publishResult(result));

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
  } finally {
    activityTimeout.cleanup();
  }
}

export async function handleTaskAutomationRun(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
  runtimeRegistry: TaskRuntimeRegistry,
  authRuntime: CodexAuthRuntime,
  taskTimeoutMs: number,
): Promise<void> {
  const payload = (await readJsonBody(request)) as WebTaskPayload;
  const router = new InMemoryCommunicationRouter();
  const activityTimeout = createTaskActivityTimeoutController(undefined, taskTimeoutMs);
  const webAdapter = new WebAdapter({
    deliver: async () => {},
  });
  router.registerAdapter(webAdapter);
  let normalizedRequest: TaskRequest | null = null;

  try {
    const baseRequest = router.normalizeRequest({
      ...payload,
      source: "web",
    });
    const automationRequest = prepareAutomationTaskRequest(baseRequest, payload.automation);
    normalizedRequest = automationRequest.request;

    await ensureAuthAvailable(authRuntime, normalizedRequest);

    const selectedRuntime = resolveTaskRuntimeForHttpRequest(runtimeRegistry, normalizedRequest);
    recordTaskAcceptedAudit(selectedRuntime, request, normalizedRequest, "/api/tasks/automation/run");

    const result = await selectedRuntime.runTask(normalizedRequest, {
      signal: activityTimeout.signal,
      finalizeResult: (request, taskResult) => appendTaskReplyQuotaFooter(authRuntime, request, taskResult),
      onEvent: async (event) => {
        activityTimeout.touch();
        await activityTimeout.wrap(router.publishEvent(event));
      },
    });

    if (result.status === "cancelled") {
      recordTaskCancelledAudit(selectedRuntime, request, normalizedRequest, result, "/api/tasks/automation/run");
    }

    const automationResponse = buildAutomationTaskRunResponse(normalizedRequest, result, automationRequest.contract);
    writeJson(response, automationResponse.httpStatus, automationResponse.response);
  } catch (error) {
    const taskError = resolveTaskHandlerError(error, Boolean(normalizedRequest));

    writeJson(response, resolveTaskHandlerErrorStatusCode(error, Boolean(normalizedRequest)), {
      mode: "automation",
      automationVersion: 1,
      error: taskError,
      ...(normalizedRequest ? { requestId: normalizedRequest.requestId } : {}),
    });
  } finally {
    activityTimeout.cleanup();
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
  route: "/api/tasks/run" | "/api/tasks/stream" | "/api/tasks/automation/run",
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
  route: "/api/tasks/run" | "/api/tasks/stream" | "/api/tasks/automation/run",
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
  return resolvePublicTaskRuntime(runtimeRegistry, readRequestedRuntimeEngine(request));
}

function readRequestedRuntimeEngine(request: TaskRequest): string | null | undefined {
  const options = request.options as { runtimeEngine?: unknown } | undefined;

  if (!options || !("runtimeEngine" in options)) {
    return undefined;
  }

  if (options.runtimeEngine === undefined) {
    return undefined;
  }

  if (options.runtimeEngine === null) {
    return null;
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
