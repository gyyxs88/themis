import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { RuntimeEngine, TaskEvent, TaskRequest, TaskResult, TaskRuntimeRunHooks } from "../types/index.js";
import type {
  AppServerReverseRequest,
  AppServerThreadStartParams,
  CodexAppServerNotification,
} from "./codex-app-server.js";
import { CodexAppServerSession } from "./codex-app-server.js";
import { translateAppServerNotification } from "./app-server-event-translator.js";
import { ConversationService } from "./conversation-service.js";
import { createTaskEvent, finalizeTaskResult } from "./codex-runtime.js";
import { IdentityLinkService } from "./identity-link-service.js";
import { PrincipalSkillsService } from "./principal-skills-service.js";
import { validateWorkspacePath } from "./session-workspace.js";

const SESSION_WORKSPACE_UNAVAILABLE_ERROR = "当前会话绑定的工作区不可用，请新建会话后重新设置。";

export interface AppServerTaskRuntimeSession {
  initialize(): Promise<void>;
  startThread(params: AppServerThreadStartParams): Promise<{ threadId: string }>;
  resumeThread(threadId: string, params: AppServerThreadStartParams): Promise<{ threadId: string }>;
  startTurn(threadId: string, prompt: string): Promise<{ turnId: string }>;
  close(): Promise<void>;
  onNotification(handler: (notification: CodexAppServerNotification) => void): void | (() => void);
  onServerRequest(handler: (request: AppServerReverseRequest) => void): void | (() => void);
  respondToServerRequest?(id: string | number, result: unknown): Promise<void>;
  rejectServerRequest?(id: string | number, error: Error): Promise<void>;
}

export interface AppServerTaskRuntimeOptions {
  workingDirectory?: string;
  runtimeStore?: SqliteCodexSessionRegistry;
  principalSkillsService?: PrincipalSkillsService;
  sessionFactory?: () => Promise<AppServerTaskRuntimeSession> | AppServerTaskRuntimeSession;
}

export class AppServerTaskRuntime {
  private readonly workingDirectory: string;
  private readonly runtimeStore: SqliteCodexSessionRegistry;
  private readonly identityLinkService: IdentityLinkService;
  private readonly conversationService: ConversationService;
  private readonly principalSkillsService: PrincipalSkillsService;
  private readonly sessionFactory: () => Promise<AppServerTaskRuntimeSession>;

  constructor(options: AppServerTaskRuntimeOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.runtimeStore = options.runtimeStore ?? new SqliteCodexSessionRegistry();
    this.identityLinkService = new IdentityLinkService(this.runtimeStore);
    this.conversationService = new ConversationService(this.runtimeStore, this.identityLinkService);
    this.principalSkillsService = options.principalSkillsService ?? new PrincipalSkillsService({
      workingDirectory: this.workingDirectory,
      registry: this.runtimeStore,
    });
    this.sessionFactory = async () => await options.sessionFactory?.() ?? new CodexAppServerSession(this.workingDirectory);
  }

  async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
    const resolvedRequest = this.conversationService.resolveRequest(request);
    request = resolvedRequest.request;

    const taskId = request.taskId ?? request.requestId;
    const { signal, cleanup } = createExecutionSignal(hooks.signal, hooks.timeoutMs);
    const eventDelivery = createEventDeliveryQueue(this.runtimeStore, hooks.onEvent);
    let session: AppServerTaskRuntimeSession | null = null;
    let unsubscribeNotification: (() => void) | undefined;
    let unsubscribeServerRequest: (() => void) | undefined;
    let sessionMode: "created" | "resumed" | "ephemeral" = "ephemeral";
    let resolvedThreadId: string | undefined;

    const emit = async (
      type: TaskEvent["type"],
      status: TaskEvent["status"],
      message: string,
      payload?: Record<string, unknown>,
    ): Promise<void> => {
      await eventDelivery.deliver(createTaskEvent(taskId, request.requestId, type, status, message, payload));
    };

    this.runtimeStore.upsertTurnFromRequest(request, taskId);

    try {
      throwIfAborted(signal);
      session = await abortable(() => this.sessionFactory(), signal);
      const activeSession = session;
      throwIfAborted(signal);
      await abortable(() => activeSession.initialize(), signal);

      unsubscribeNotification = toUnsubscribe(activeSession.onNotification((notification) => {
        const event = translateAppServerNotification(taskId, request.requestId, notification);

        if (!event) {
          return;
        }

        eventDelivery.enqueue(event);
      }));
      unsubscribeServerRequest = toUnsubscribe(activeSession.onServerRequest((serverRequest) => {
        if (typeof activeSession.respondToServerRequest === "function") {
          void activeSession.respondToServerRequest(serverRequest.id, null);
        }
      }));

      await emit("task.received", "queued", "Themis accepted the web request.");
      throwIfAborted(signal);

      const executionWorkingDirectory = this.resolveExecutionWorkingDirectory(request);
      const sessionId = normalizeSessionId(request.channelContext.sessionId);
      const storedThreadId = sessionId ? this.runtimeStore.resolveThreadId(sessionId) : null;
      sessionMode = resolveSessionMode(sessionId, storedThreadId);
      const threadStartParams: AppServerThreadStartParams = {
        cwd: executionWorkingDirectory,
      };

      const thread = storedThreadId
        ? await abortable(() => activeSession.resumeThread(storedThreadId, threadStartParams), signal)
        : await abortable(() => activeSession.startThread(threadStartParams), signal);
      const threadId = thread.threadId;
      resolvedThreadId = threadId;
      persistThreadSession(this.runtimeStore, sessionId, threadId, request.createdAt);

      await emit("task.started", "running", "Codex task started.", {
        sessionMode,
        threadId,
        sessionId: sessionId || null,
        conversationId: sessionId || null,
        runtimeEngine: "app-server",
      });
      throwIfAborted(signal);

      await abortable(() => activeSession.startTurn(threadId, request.goal), signal);
      await eventDelivery.flush();
      throwIfAborted(signal);

      const baseResult: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "completed",
        summary: request.goal,
        structuredOutput: {
          session: {
            sessionId: sessionId || null,
            threadId,
            engine: "app-server",
          },
        },
        completedAt: new Date().toISOString(),
      };
      const result = await abortable(
        () => finalizeTaskResult(request, baseResult, hooks.finalizeResult),
        signal,
      );

      this.runtimeStore.completeTaskTurn({
        request,
        result,
        sessionMode,
        ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
      });
      persistThreadSession(this.runtimeStore, sessionId, resolvedThreadId, result.completedAt);
      return result;
    } catch (error) {
      const message = toErrorMessage(error);

      try {
        await eventDelivery.flush();
        await emit("task.failed", "failed", message);
      } catch {
        // 保留原始执行错误，不让事件回调错误覆盖它。
      }

      this.runtimeStore.failTaskTurn({
        request,
        taskId,
        message,
        sessionMode,
        ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
      });
      throw error;
    } finally {
      try {
        await eventDelivery.flush();
      } catch {
        // finally 阶段不覆盖主错误。
      }
      unsubscribeNotification?.();
      unsubscribeServerRequest?.();
      await session?.close();
      cleanup();
    }
  }

  getRuntimeStore(): SqliteCodexSessionRegistry {
    return this.runtimeStore;
  }

  getIdentityLinkService(): IdentityLinkService {
    return this.identityLinkService;
  }

  getPrincipalSkillsService(): PrincipalSkillsService {
    return this.principalSkillsService;
  }

  private resolveExecutionWorkingDirectory(request: TaskRequest): string {
    const sessionId = normalizeSessionId(request.channelContext.sessionId);

    if (!sessionId) {
      return this.workingDirectory;
    }

    const workspacePath = this.runtimeStore.getSessionTaskSettings(sessionId)?.settings.workspacePath?.trim();

    if (!workspacePath) {
      return this.workingDirectory;
    }

    try {
      return validateWorkspacePath(workspacePath);
    } catch {
      throw new Error(SESSION_WORKSPACE_UNAVAILABLE_ERROR);
    }
  }
}

function createExecutionSignal(
  externalSignal?: AbortSignal,
  timeoutMs?: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      const abortFromExternal = (): void => {
        controller.abort(externalSignal.reason);
      };

      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
      cleanups.push(() => externalSignal.removeEventListener("abort", abortFromExternal));
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    const timer = setTimeout(() => {
      controller.abort(new Error(`TASK_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);

    cleanups.push(() => clearTimeout(timer));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  throw signal.reason instanceof Error ? signal.reason : new Error("任务已被取消。");
}

async function abortable<T>(
  run: () => Promise<T> | T,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const pending = Promise.resolve().then(run);

  if (signal.aborted) {
    throwIfAborted(signal);
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error("任务已被取消。"));
    };

    signal.addEventListener("abort", abort, { once: true });

    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function createEventDeliveryQueue(
  runtimeStore: SqliteCodexSessionRegistry,
  onEvent: TaskRuntimeRunHooks["onEvent"],
): {
  enqueue: (event: TaskEvent) => void;
  deliver: (event: TaskEvent) => Promise<void>;
  flush: () => Promise<void>;
} {
  let chain = Promise.resolve();
  let failure: unknown = null;

  const schedule = (event: TaskEvent): Promise<void> => {
    const next = chain.then(async () => {
      runtimeStore.appendTaskEvent(event);
      await onEvent?.(event);
    });

    chain = next.catch((error: unknown) => {
      if (failure === null) {
        failure = error;
      }
    });

    return next;
  };

  return {
    enqueue: (event) => {
      void schedule(event);
    },
    deliver: async (event) => {
      await schedule(event);
    },
    flush: async () => {
      await chain;

      if (failure !== null) {
        const error = failure;
        failure = null;
        throw error;
      }
    },
  };
}

function persistThreadSession(
  runtimeStore: SqliteCodexSessionRegistry,
  sessionId: string,
  threadId: string | undefined,
  timestamp: string,
): void {
  if (!sessionId || !threadId) {
    return;
  }

  const existing = runtimeStore.getSession(sessionId);

  runtimeStore.saveSession({
    sessionId,
    threadId,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

function resolveSessionMode(
  sessionId: string,
  storedThreadId: string | null,
): "created" | "resumed" | "ephemeral" {
  if (!sessionId) {
    return "ephemeral";
  }

  return storedThreadId ? "resumed" : "created";
}

function normalizeSessionId(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function toUnsubscribe(value: void | (() => void)): (() => void) | undefined {
  return typeof value === "function" ? value : undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "App-server task failed.";
}

export const APP_SERVER_RUNTIME_ENGINE: RuntimeEngine = "app-server";
