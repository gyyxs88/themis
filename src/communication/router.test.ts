import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelAdapter } from "./adapter.js";
import { InMemoryCommunicationRouter } from "./router.js";
import type { TaskError, TaskEvent, TaskRequest, TaskResult } from "../types/index.js";

interface FakeAdapter extends ChannelAdapter {
  calls: {
    normalizedInputs: unknown[];
    events: TaskEvent[];
    results: TaskResult[];
    errors: Array<{ error: TaskError; request: TaskRequest }>;
  };
}

function createRequest(channelId: string, overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    requestId: overrides.requestId ?? `${channelId}-request`,
    ...(overrides.taskId ? { taskId: overrides.taskId } : {}),
    sourceChannel: overrides.sourceChannel ?? channelId,
    user:
      overrides.user ?? {
        userId: `${channelId}-user`,
        displayName: `${channelId}-display`,
      },
    goal: overrides.goal ?? `${channelId} goal`,
    channelContext: overrides.channelContext ?? {},
    createdAt: overrides.createdAt ?? "2026-03-28T12:00:00.000Z",
    ...(overrides.inputText ? { inputText: overrides.inputText } : {}),
    ...(overrides.historyContext ? { historyContext: overrides.historyContext } : {}),
    ...(overrides.attachments ? { attachments: overrides.attachments } : {}),
    ...(overrides.options ? { options: overrides.options } : {}),
  };
}

function createEvent(
  requestId: string,
  taskId: string,
  type: TaskEvent["type"] = "task.progress",
): TaskEvent {
  return {
    eventId: `${taskId}-${type}`,
    taskId,
    requestId,
    type,
    status: type === "task.completed" ? "completed" : "running",
    message: `${type} message`,
    timestamp: "2026-03-28T12:00:01.000Z",
  };
}

function createResult(requestId: string, taskId: string): TaskResult {
  return {
    taskId,
    requestId,
    status: "completed",
    summary: "router result summary",
    completedAt: "2026-03-28T12:00:02.000Z",
  };
}

function createError(code: TaskError["code"] = "CORE_RUNTIME_ERROR"): TaskError {
  return {
    code,
    message: `${code} message`,
  };
}

function createAdapter(
  channelId: string,
  options: {
    canHandle: (input: unknown) => boolean;
    request?: TaskRequest;
  },
): FakeAdapter {
  const request = options.request ?? createRequest(channelId);
  const calls = {
    normalizedInputs: [] as unknown[],
    events: [] as TaskEvent[],
    results: [] as TaskResult[],
    errors: [] as Array<{ error: TaskError; request: TaskRequest }>,
  };

  return {
    channelId,
    calls,
    canHandle(input: unknown): boolean {
      return options.canHandle(input);
    },
    normalizeRequest(input: unknown): TaskRequest {
      calls.normalizedInputs.push(input);
      return request;
    },
    async handleEvent(event: TaskEvent): Promise<void> {
      calls.events.push(event);
    },
    async handleResult(result: TaskResult): Promise<void> {
      calls.results.push(result);
    },
    async handleError(error: TaskError, originalRequest: TaskRequest): Promise<void> {
      calls.errors.push({ error, request: originalRequest });
    },
  };
}

test("registerAdapter 会拒绝重复 channelId", () => {
  const router = new InMemoryCommunicationRouter();
  router.registerAdapter(createAdapter("web", { canHandle: () => false }));

  assert.throws(
    () => router.registerAdapter(createAdapter("web", { canHandle: () => false })),
    /Channel adapter already registered for "web"\./,
  );
});

test("normalizeRequest 会在零命中和多命中时抛错", () => {
  const zeroMatchRouter = new InMemoryCommunicationRouter();
  zeroMatchRouter.registerAdapter(createAdapter("web", { canHandle: () => false }));

  assert.throws(
    () => zeroMatchRouter.normalizeRequest({ source: "unknown" }),
    /No registered channel adapter can handle the incoming payload\./,
  );

  const multiMatchRouter = new InMemoryCommunicationRouter();
  multiMatchRouter.registerAdapter(createAdapter("web", { canHandle: () => true }));
  multiMatchRouter.registerAdapter(createAdapter("feishu", { canHandle: () => true }));

  assert.throws(
    () => multiMatchRouter.normalizeRequest({ goal: "same payload" }),
    /Multiple channel adapters matched the same payload: web, feishu\./,
  );
});

test("router 会按 requestId 向命中的 adapter 发布 event 和 result", async () => {
  const router = new InMemoryCommunicationRouter();
  const web = createAdapter("web", {
    canHandle: (input) => (input as { kind?: string }).kind === "web",
    request: createRequest("web", {
      requestId: "req-web",
      taskId: "task-web",
      sourceChannel: "web",
    }),
  });
  const feishu = createAdapter("feishu", {
    canHandle: (input) => (input as { kind?: string }).kind === "feishu",
    request: createRequest("feishu", {
      requestId: "req-feishu",
      taskId: "task-feishu",
      sourceChannel: "feishu",
    }),
  });
  router.registerAdapter(web);
  router.registerAdapter(feishu);

  router.normalizeRequest({ kind: "web" });
  await router.publishEvent(createEvent("req-web", "task-web", "task.started"));
  await router.publishResult(createResult("req-web", "task-web"));

  assert.equal(web.calls.events.length, 1);
  assert.equal(web.calls.results.length, 1);
  assert.equal(feishu.calls.events.length, 0);
  assert.equal(feishu.calls.results.length, 0);
});

test("router 在 request route 缺失时会回退到 task route", async () => {
  const router = new InMemoryCommunicationRouter();
  const web = createAdapter("web", {
    canHandle: (input) => (input as { kind?: string }).kind === "web",
    request: createRequest("web", {
      requestId: "req-task-fallback",
      taskId: "task-task-fallback",
      sourceChannel: "web",
    }),
  });
  router.registerAdapter(web);

  router.normalizeRequest({ kind: "web" });
  await router.publishEvent(createEvent("missing-request", "task-task-fallback"));

  assert.equal(web.calls.events.length, 1);
  assert.equal(web.calls.events[0]?.requestId, "missing-request");
});

test("publishError 会按 sourceChannel 寻址并补写 task route", async () => {
  const router = new InMemoryCommunicationRouter();
  const web = createAdapter("web", {
    canHandle: (input) => (input as { kind?: string }).kind === "web",
  });
  const feishu = createAdapter("feishu", {
    canHandle: (input) => (input as { kind?: string }).kind === "feishu",
  });
  router.registerAdapter(web);
  router.registerAdapter(feishu);

  const request = createRequest("web", {
    requestId: "req-error-route",
    taskId: "task-error-route",
    sourceChannel: "feishu",
  });

  await router.publishError(createError(), request);
  await router.publishEvent(createEvent("missing-request", "task-error-route"));

  assert.equal(web.calls.errors.length, 0);
  assert.equal(web.calls.events.length, 0);
  assert.equal(feishu.calls.errors.length, 1);
  assert.equal(feishu.calls.events.length, 1);
  assert.equal(feishu.calls.errors[0]?.request.requestId, "req-error-route");
  assert.equal(feishu.calls.events[0]?.requestId, "missing-request");
});

test("router 会在无路由和缺少 adapter 时抛明确错误", async () => {
  const router = new InMemoryCommunicationRouter();
  router.registerAdapter(createAdapter("web", { canHandle: () => false }));

  await assert.rejects(
    () => router.publishResult(createResult("missing-request", "missing-task")),
    /No channel route found for request "missing-request"\./,
  );

  await assert.rejects(
    () =>
      router.publishError(
        createError("AUTH_REQUIRED"),
        createRequest("cli", {
          requestId: "req-no-adapter",
          taskId: "task-no-adapter",
          sourceChannel: "cli",
        }),
      ),
    /No channel adapter registered for "cli" while resolving "req-no-adapter"\./,
  );
});
