import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type {
  RuntimeEngine,
  TaskRequest,
  TaskResult,
  TaskRuntimeRunHooks,
} from "../types/index.js";
import type {
  AppServerReverseRequest,
  AppServerThreadStartParams,
  CodexAppServerNotification,
} from "./codex-app-server.js";
import { CodexAppServerSession } from "./codex-app-server.js";
import { IdentityLinkService } from "./identity-link-service.js";
import { PrincipalSkillsService } from "./principal-skills-service.js";
import { translateAppServerNotification } from "./app-server-event-translator.js";
import { createTaskEvent, finalizeTaskResult } from "./codex-runtime.js";

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
  private readonly principalSkillsService: PrincipalSkillsService;
  private readonly sessionFactory: () => Promise<AppServerTaskRuntimeSession>;

  constructor(options: AppServerTaskRuntimeOptions = {}) {
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.runtimeStore = options.runtimeStore ?? new SqliteCodexSessionRegistry();
    this.identityLinkService = new IdentityLinkService(this.runtimeStore);
    this.principalSkillsService = options.principalSkillsService ?? new PrincipalSkillsService({
      workingDirectory: this.workingDirectory,
      registry: this.runtimeStore,
    });
    this.sessionFactory = async () => await options.sessionFactory?.() ?? new CodexAppServerSession(this.workingDirectory);
  }

  async runTask(request: TaskRequest, hooks: TaskRuntimeRunHooks = {}): Promise<TaskResult> {
    const taskId = request.taskId ?? request.requestId;
    const session = await this.sessionFactory();
    let unsubscribeNotification: (() => void) | undefined;
    let unsubscribeServerRequest: (() => void) | undefined;

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
    await session.initialize();

    try {
      unsubscribeNotification = toUnsubscribe(session.onNotification((notification) => {
        const event = translateAppServerNotification(taskId, request.requestId, notification);

        if (!event) {
          return;
        }

        this.runtimeStore.appendTaskEvent(event);
        void hooks.onEvent?.(event);
      }));
      unsubscribeServerRequest = toUnsubscribe(session.onServerRequest((serverRequest) => {
        if (typeof session.respondToServerRequest === "function") {
          void session.respondToServerRequest(serverRequest.id, null);
        }
      }));

      await emit("task.received", "queued", "Themis accepted the web request.");
      const threadStartParams: AppServerThreadStartParams = {
        cwd: this.workingDirectory,
      };
      const sessionMode = resolveSessionMode(request);
      const thread = request.channelContext.sessionId
        ? await session.resumeThread(request.channelContext.sessionId, threadStartParams)
        : await session.startThread(threadStartParams);

      await emit("task.started", "running", "Codex task started.", {
        sessionMode,
        threadId: thread.threadId,
        sessionId: request.channelContext.sessionId ?? null,
        conversationId: request.channelContext.sessionId ?? null,
        runtimeEngine: "app-server",
      });
      await session.startTurn(thread.threadId, request.goal);

      const baseResult: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "completed",
        summary: request.goal,
        structuredOutput: {
          session: {
            sessionId: request.channelContext.sessionId ?? null,
            threadId: thread.threadId,
            engine: "app-server",
          },
        },
        completedAt: new Date().toISOString(),
      };
      const result = await finalizeTaskResult(request, baseResult, hooks.finalizeResult);

      this.runtimeStore.completeTaskTurn({
        request,
        result,
        sessionMode,
        threadId: thread.threadId,
      });
      return result;
    } catch (error) {
      const message = toErrorMessage(error);

      await emit("task.failed", "failed", message);
      this.runtimeStore.failTaskTurn({
        request,
        taskId,
        message,
        sessionMode: resolveSessionMode(request),
      });
      throw error;
    } finally {
      unsubscribeNotification?.();
      unsubscribeServerRequest?.();
      await session.close();
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
}

function resolveSessionMode(request: TaskRequest): "created" | "resumed" | "ephemeral" {
  return request.channelContext.sessionId ? "resumed" : "ephemeral";
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
