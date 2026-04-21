import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import { ConversationService } from "../core/conversation-service.js";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import { createTaskEvent } from "../core/task-runtime-common.js";
import type {
  TaskActionDescriptor,
  TaskActionScope,
  TaskPendingActionSubmitRequest,
  TaskRequest,
  TaskResult,
  TaskRuntimeRunHooks,
} from "../types/index.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

type SyntheticSmokeScenario = "user-input" | "mixed";

export class SyntheticSmokeTaskRuntime {
  private readonly baseRuntime: Pick<RuntimeServiceHost, "getRuntimeStore" | "getIdentityLinkService" | "getPrincipalSkillsService">;
  private readonly runtimeStore: SqliteCodexSessionRegistry;
  private readonly conversationService: ConversationService;
  private readonly actionBridge: AppServerActionBridge;

  constructor(options: {
    baseRuntime: Pick<RuntimeServiceHost, "getRuntimeStore" | "getIdentityLinkService" | "getPrincipalSkillsService">;
    actionBridge: AppServerActionBridge;
  }) {
    this.baseRuntime = options.baseRuntime;
    this.runtimeStore = options.baseRuntime.getRuntimeStore() as SqliteCodexSessionRegistry;
    this.conversationService = new ConversationService(
      this.runtimeStore,
      options.baseRuntime.getIdentityLinkService(),
    );
    this.actionBridge = options.actionBridge;
  }

  getRuntimeStore() {
    return this.runtimeStore;
  }

  getIdentityLinkService() {
    return this.baseRuntime.getIdentityLinkService();
  }

  getPrincipalSkillsService() {
    return this.baseRuntime.getPrincipalSkillsService();
  }

  async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
    const scenario = resolveSyntheticSmokeScenario(request);
    const sanitizedRequest = sanitizeSyntheticSmokeRequest(request);
    const resolved = this.conversationService.resolveRequest(sanitizedRequest);
    request = resolved.request;

    const taskId = request.taskId ?? request.requestId;
    const emit = async (
      type: Parameters<typeof createTaskEvent>[2],
      status: Parameters<typeof createTaskEvent>[3],
      message: string,
      payload?: Record<string, unknown>,
    ): Promise<void> => {
      const event = createTaskEvent(taskId, request.requestId, type, status, message, payload);
      this.runtimeStore.appendTaskEvent(event);
      await hooks.onEvent?.(event);
    };

    this.runtimeStore.upsertTurnFromRequest(request, taskId);

    try {
      throwIfAborted(hooks.signal);
      await emit("task.received", "queued", "Themis accepted the synthetic smoke request.");
      await emit("task.started", "running", buildStartedMessage(scenario));

      const result = scenario === "mixed"
        ? await this.runMixedScenario(request, taskId, resolved.principalId, hooks.signal, emit)
        : await this.runUserInputScenario(request, taskId, resolved.principalId, hooks.signal, emit);

      this.runtimeStore.completeTaskTurn({
        request,
        result,
      });
      return result;
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }

      const result: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "cancelled",
        summary: "Synthetic smoke 已取消。",
        completedAt: new Date().toISOString(),
        structuredOutput: {
          syntheticSmoke: true,
          scenario,
          cancelled: true,
        },
      };

      await emit("task.cancelled", "cancelled", result.summary, result.structuredOutput);
      this.runtimeStore.completeTaskTurn({
        request,
        result,
      });
      return result;
    }
  }

  private async runUserInputScenario(
    request: TaskRequest,
    taskId: string,
    principalId: string | undefined,
    signal: AbortSignal | undefined,
    emit: SmokeEventEmitter,
  ): Promise<TaskResult> {
    const actionId = buildSmokeActionId(request.requestId, "reply");
    const submission = await this.waitForActionSubmission({
      request,
      taskId,
      principalId,
      signal,
      emit,
      action: {
        actionId,
        actionType: "user-input",
        prompt: [
          "Synthetic smoke：请补充一条任意文本。",
          "飞书切到同一会话后，可以直接发普通文本，或使用 /reply 显式提交。",
          `使用 /reply ${actionId} <内容>`,
        ].join("\n"),
        inputSchema: {
          questionIds: ["reply"],
        },
      },
    });
    const replyText = normalizeText(submission.inputText) ?? "";
    const result = createSyntheticSmokeResult(taskId, request.requestId, "user-input", {
      replyText,
    });

    await emit("task.completed", "completed", result.summary, result.structuredOutput);
    return result;
  }

  private async runMixedScenario(
    request: TaskRequest,
    taskId: string,
    principalId: string | undefined,
    signal: AbortSignal | undefined,
    emit: SmokeEventEmitter,
  ): Promise<TaskResult> {
    const approvalActionId = buildSmokeActionId(request.requestId, "approval");
    const approval = await this.waitForActionSubmission({
      request,
      taskId,
      principalId,
      signal,
      emit,
      action: {
        actionId: approvalActionId,
        actionType: "approval",
        prompt: [
          "Synthetic smoke：请先审批，随后会继续等待补充输入。",
          `使用 /approve ${approvalActionId} 或 /deny ${approvalActionId}`,
        ].join("\n"),
        choices: ["approve", "deny"],
      },
    });

    if (approval.decision !== "approve") {
      const result: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "cancelled",
        summary: "Synthetic smoke mixed 已取消：审批被拒绝。",
        completedAt: new Date().toISOString(),
        structuredOutput: {
          syntheticSmoke: true,
          scenario: "mixed",
          approvalDecision: approval.decision ?? "deny",
        },
      };

      await emit("task.cancelled", "cancelled", result.summary, result.structuredOutput);
      return result;
    }

    await emit(
      "task.progress",
      "running",
      "Synthetic smoke mixed 已通过审批，继续等待补充输入。",
      {
        syntheticSmoke: true,
        scenario: "mixed",
        approvalDecision: "approve",
      },
    );

    const replyActionId = buildSmokeActionId(request.requestId, "reply");
    const reply = await this.waitForActionSubmission({
      request,
      taskId,
      principalId,
      signal,
      emit,
      action: {
        actionId: replyActionId,
        actionType: "user-input",
        prompt: [
          "Synthetic smoke mixed：请补充一条任意文本。",
          "飞书此时可直接发普通文本，也可以继续用 /reply。",
          `使用 /reply ${replyActionId} <内容>`,
        ].join("\n"),
        inputSchema: {
          questionIds: ["reply"],
        },
      },
    });
    const replyText = normalizeText(reply.inputText) ?? "";
    const result = createSyntheticSmokeResult(taskId, request.requestId, "mixed", {
      approvalDecision: "approve",
      replyText,
    });

    await emit("task.completed", "completed", result.summary, result.structuredOutput);
    return result;
  }

  private async waitForActionSubmission(input: {
    request: TaskRequest;
    taskId: string;
    principalId: string | undefined;
    signal: AbortSignal | undefined;
    emit: SmokeEventEmitter;
    action: TaskActionDescriptor;
  }): Promise<TaskPendingActionSubmitRequest> {
    const actionScope = buildActionScope(input.request, input.principalId);
    const registeredAction = this.actionBridge.register({
      taskId: input.taskId,
      requestId: input.request.requestId,
      ...(actionScope ? { scope: actionScope } : {}),
      ...input.action,
    });
    const submission = this.actionBridge.waitForSubmission(
      input.taskId,
      input.request.requestId,
      registeredAction.actionId,
    );

    if (!submission) {
      throw new Error(`等待中的 synthetic smoke action 不存在：${registeredAction.actionId}`);
    }

    const discardPendingAction = () => {
      this.actionBridge.discard(input.taskId, input.request.requestId, registeredAction.actionId);
    };

    input.signal?.addEventListener("abort", discardPendingAction, { once: true });

    try {
      await input.emit(
        "task.action_required",
        "waiting",
        registeredAction.prompt,
        buildActionPayload(registeredAction),
      );
      return await waitForPromise(submission, input.signal);
    } finally {
      input.signal?.removeEventListener("abort", discardPendingAction);
      discardPendingAction();
    }
  }
}

type SmokeEventEmitter = (
  type: Parameters<typeof createTaskEvent>[2],
  status: Parameters<typeof createTaskEvent>[3],
  message: string,
  payload?: Record<string, unknown>,
) => Promise<void>;

function resolveSyntheticSmokeScenario(request: TaskRequest): SyntheticSmokeScenario {
  const options = request.options as { syntheticSmokeScenario?: unknown } | undefined;
  const scenario = normalizeText(typeof options?.syntheticSmokeScenario === "string" ? options.syntheticSmokeScenario : null);

  if (scenario === "user-input" || scenario === "mixed") {
    return scenario;
  }

  throw new Error("synthetic smoke 请求缺少合法的 scenario，当前仅支持 user-input 或 mixed。");
}

function sanitizeSyntheticSmokeRequest(request: TaskRequest): TaskRequest {
  const options = request.options && typeof request.options === "object"
    ? { ...request.options }
    : null;

  if (options && "syntheticSmokeScenario" in options) {
    delete (options as Record<string, unknown>).syntheticSmokeScenario;
  }

  if (options && Object.keys(options).length > 0) {
    return {
      ...request,
      options,
    };
  }

  return {
    ...request,
  };
}

function buildStartedMessage(scenario: SyntheticSmokeScenario): string {
  return scenario === "mixed"
    ? "已创建 synthetic smoke mixed waiting action，先等待审批。"
    : "已创建 synthetic smoke user-input waiting action。";
}

function buildSmokeActionId(requestId: string, prefix: "approval" | "reply"): string {
  const normalized = requestId.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const suffix = normalized.slice(-12) || "smoke";
  return `smoke-${prefix}-${suffix}`;
}

function buildActionScope(request: TaskRequest, principalId?: string): TaskActionScope | undefined {
  const sessionId = normalizeText(request.channelContext.sessionId);
  const userId = normalizeText(request.user.userId);
  const sourceChannel = normalizeText(request.sourceChannel);

  if (!sessionId && !principalId && !userId && !sourceChannel) {
    return undefined;
  }

  return {
    ...(sourceChannel ? { sourceChannel: request.sourceChannel } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(principalId ? { principalId } : {}),
    ...(userId ? { userId } : {}),
  };
}

function buildActionPayload(action: TaskActionDescriptor): Record<string, unknown> {
  return {
    actionId: action.actionId,
    actionType: action.actionType,
    prompt: action.prompt,
    ...(action.choices ? { choices: action.choices } : {}),
    ...(action.inputSchema ? { inputSchema: action.inputSchema } : {}),
  };
}

function createSyntheticSmokeResult(
  taskId: string,
  requestId: string,
  scenario: SyntheticSmokeScenario,
  details: {
    approvalDecision?: string;
    replyText?: string;
  } = {},
): TaskResult {
  const completedAt = new Date().toISOString();

  return {
    taskId,
    requestId,
    status: "completed",
    summary: scenario === "mixed"
      ? "Synthetic smoke mixed 已收口。"
      : "Synthetic smoke user-input 已收口。",
    completedAt,
    structuredOutput: {
      syntheticSmoke: true,
      scenario,
      ...(details.approvalDecision ? { approvalDecision: details.approvalDecision } : {}),
      ...(details.replyText ? { replyText: details.replyText } : {}),
    },
  };
}

async function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return await promise;
  }

  if (signal.aborted) {
    throw toAbortError(signal.reason);
  }

  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(toAbortError(signal.reason));
      };

      signal.addEventListener("abort", abort, { once: true });
    }),
  ]);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw toAbortError(signal.reason);
}

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(typeof reason === "string" ? reason : "ABORT_ERR");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message === "ABORT_ERR" || error.message === "CLIENT_DISCONNECTED";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
