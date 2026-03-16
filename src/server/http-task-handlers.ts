import type { IncomingMessage, ServerResponse } from "node:http";
import { InMemoryCommunicationRouter } from "../communication/router.js";
import { WebAdapter, type WebDeliveryMessage, type WebTaskPayload } from "../channels/index.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import type { TaskRequest } from "../types/index.js";
import { createTaskError, resolveErrorStatusCode } from "./http-errors.js";
import { readJsonBody } from "./http-request.js";
import { safeWriteNdjson, writeJson, writeNdjson } from "./http-responses.js";

export async function handleTaskStream(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: CodexTaskRuntime,
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

    writeNdjson(response, {
      kind: "ack",
      requestId: normalizedRequest.requestId,
      taskId: normalizedRequest.taskId,
      title: "task.accepted",
      text: "Themis accepted the stream request.",
    });

    const result = await runtime.runTask(normalizedRequest, {
      signal: abortController.signal,
      timeoutMs: taskTimeoutMs,
      onEvent: async (event) => {
        await router.publishEvent(event);
      },
    });

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
    const taskError = createTaskError(error, Boolean(normalizedRequest));

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

    const result = await runtime.runTask(normalizedRequest, {
      timeoutMs: taskTimeoutMs,
      onEvent: async (event) => {
        await router.publishEvent(event);
      },
    });

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
    const taskError = createTaskError(error, Boolean(normalizedRequest));

    if (normalizedRequest) {
      await router.publishError(taskError, normalizedRequest);
    }

    writeJson(response, resolveErrorStatusCode(error, Boolean(normalizedRequest)), {
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
