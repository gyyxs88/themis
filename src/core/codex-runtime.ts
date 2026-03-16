import {
  Codex,
  type ApprovalMode,
  type ModelReasoningEffort,
  type SandboxMode,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
} from "@openai/codex-sdk";
import { readCodexRuntimeCatalog, type CodexRuntimeCatalog } from "./codex-app-server.js";
import { buildTaskPrompt } from "./prompt.js";
import { buildForkContextFromThread, type CodexForkContext } from "./codex-session-fork.js";
import {
  CodexThreadSessionStore,
  type CodexSessionLease,
  type CodexSessionMode,
} from "./codex-session-store.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskEvent, TaskRequest, TaskResult } from "../types/index.js";

export interface CodexTaskRuntimeOptions {
  codex?: Codex;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  sessionStore?: CodexThreadSessionStore;
  runtimeStore?: SqliteCodexSessionRegistry;
}

export interface CodexTaskRuntimeHooks {
  onEvent?: (event: TaskEvent) => Promise<void> | void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class CodexTaskRuntime {
  private readonly codex: Codex;
  private readonly workingDirectory: string;
  private readonly skipGitRepoCheck: boolean;
  private readonly sessionStore: CodexThreadSessionStore;
  private readonly runtimeStore: SqliteCodexSessionRegistry;

  constructor(options: CodexTaskRuntimeOptions = {}) {
    this.codex = options.codex ?? new Codex();
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.skipGitRepoCheck = options.skipGitRepoCheck ?? false;
    this.sessionStore = options.sessionStore ?? new CodexThreadSessionStore({ codex: this.codex });
    this.runtimeStore = options.runtimeStore ?? this.sessionStore.getSessionRegistry();
  }

  async runTask(request: TaskRequest, hooks: CodexTaskRuntimeHooks = {}): Promise<TaskResult> {
    const taskId = request.taskId ?? createId("task");
    const emit = async (event: TaskEvent): Promise<void> => {
      this.runtimeStore.appendTaskEvent(event);
      await hooks.onEvent?.(event);
    };
    const { signal, cleanup } = createExecutionSignal(hooks.signal, hooks.timeoutMs);
    const threadOptions = buildThreadOptions(request, this.workingDirectory, this.skipGitRepoCheck);
    let sessionLease: CodexSessionLease | null = null;

    try {
      this.runtimeStore.upsertTurnFromRequest(request, taskId);
      await emit(createTaskEvent(taskId, request.requestId, "task.received", "queued", "Themis accepted the web request."));

      sessionLease = await this.sessionStore.acquire(request, threadOptions);
      const thread = sessionLease.thread;
      const prompt = buildTaskPrompt(request);
      const touchedFiles = new Set<string>();
      let finalResponse = "";
      let failureMessage: string | null = null;

      throwIfAborted(signal);

      await emit(
        createTaskEvent(
          taskId,
          request.requestId,
          "task.progress",
          "running",
          describeSessionMode(sessionLease),
          createSessionPayload(sessionLease),
        ),
      );

      await emit(createTaskEvent(taskId, request.requestId, "task.started", "running", "Codex task started."));

      const { events } = await thread.runStreamed(prompt, { signal });

      for await (const sdkEvent of events) {
        throwIfAborted(signal);
        const translated = translateThreadEvent(taskId, request.requestId, sdkEvent);

        if (translated) {
          await emit(translated);
        }

        collectThreadArtifacts(sdkEvent, touchedFiles, (response) => {
          finalResponse = response;
        });

        if (sdkEvent.type === "turn.failed") {
          failureMessage = sdkEvent.error.message;
        }

        if (sdkEvent.type === "error") {
          failureMessage = sdkEvent.message;
        }
      }

      if (failureMessage) {
        await emit(createTaskEvent(taskId, request.requestId, "task.failed", "failed", failureMessage));
        throw new Error(failureMessage);
      }

      const summary = summarizeResponse(finalResponse);
      const touched = [...touchedFiles];
      const resolvedThreadId = thread.id ?? sessionLease.threadId ?? undefined;
      const result: TaskResult = {
        taskId,
        requestId: request.requestId,
        status: "completed",
        summary,
        ...(finalResponse ? { output: finalResponse } : {}),
        ...(touched.length ? { touchedFiles: touched } : {}),
        structuredOutput: {
          session: {
            ...(sessionLease.sessionId ? { sessionId: sessionLease.sessionId } : {}),
            ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
            mode: sessionLease.sessionMode,
          },
        },
        completedAt: new Date().toISOString(),
      };

      this.runtimeStore.completeTaskTurn({
        request,
        result,
        ...resolveSessionPersistence(sessionLease, resolvedThreadId),
      });

      await emit(
        createTaskEvent(taskId, request.requestId, "task.completed", "completed", "Codex task completed.", {
          ...(touched.length ? { touchedFiles: touched } : {}),
          ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
          ...createSessionPayload(sessionLease, resolvedThreadId),
        }),
      );

      return result;
    } catch (error) {
      if (isAbortLikeError(error) || signal.aborted) {
        const message = describeAbort(signal);
        const result: TaskResult = {
          taskId,
          requestId: request.requestId,
          status: "cancelled",
          summary: message,
          completedAt: new Date().toISOString(),
        };

        this.runtimeStore.completeTaskTurn({
          request,
          result,
          ...resolveSessionPersistence(sessionLease),
        });
        await emit(createTaskEvent(taskId, request.requestId, "task.cancelled", "cancelled", message));

        return result;
      }

      this.runtimeStore.failTaskTurn({
        request,
        taskId,
        message: toErrorMessage(error),
        ...resolveSessionPersistence(sessionLease),
      });

      throw error;
    } finally {
      await sessionLease?.release(sessionLease.thread.id ?? sessionLease.threadId ?? null);
      cleanup();
    }
  }

  async createForkContext(sessionId: string, threadId?: string): Promise<CodexForkContext | null> {
    const resolvedThreadId = threadId?.trim() || (await this.sessionStore.resolveThreadId(sessionId));

    if (!resolvedThreadId) {
      return null;
    }

    return buildForkContextFromThread(resolvedThreadId);
  }

  async readRuntimeConfig(): Promise<CodexRuntimeCatalog> {
    return readCodexRuntimeCatalog(this.workingDirectory);
  }

  getRuntimeStore(): SqliteCodexSessionRegistry {
    return this.runtimeStore;
  }
}

function resolveSessionPersistence(
  sessionLease: CodexSessionLease | null,
  resolvedThreadId?: string,
): {
  sessionMode?: string;
  threadId?: string;
} {
  if (!sessionLease) {
    return {};
  }

  const threadId = normalizeOptionalText(resolvedThreadId ?? sessionLease.thread.id ?? sessionLease.threadId);

  return {
    ...(sessionLease.sessionMode ? { sessionMode: sessionLease.sessionMode } : {}),
    ...(threadId ? { threadId } : {}),
  };
}

function buildThreadOptions(
  request: TaskRequest,
  workingDirectory: string,
  skipGitRepoCheck: boolean,
): ThreadOptions {
  return {
    workingDirectory,
    skipGitRepoCheck,
    ...(request.options?.model ? { model: request.options.model } : {}),
    ...(request.options?.reasoning
      ? { modelReasoningEffort: request.options.reasoning as ModelReasoningEffort }
      : {}),
    ...(request.options?.sandboxMode ? { sandboxMode: request.options.sandboxMode as SandboxMode } : {}),
    ...(request.options?.approvalPolicy
      ? { approvalPolicy: request.options.approvalPolicy as ApprovalMode }
      : { approvalPolicy: defaultApprovalPolicy() }),
  };
}

function defaultApprovalPolicy(): ApprovalMode {
  return "untrusted";
}

function createTaskEvent(
  taskId: string,
  requestId: string,
  type: TaskEvent["type"],
  status: TaskEvent["status"],
  message: string,
  payload?: Record<string, unknown>,
): TaskEvent {
  return {
    eventId: createId("event"),
    taskId,
    requestId,
    type,
    status,
    message,
    ...(payload ? { payload } : {}),
    timestamp: new Date().toISOString(),
  };
}

function translateThreadEvent(taskId: string, requestId: string, event: ThreadEvent): TaskEvent | null {
  switch (event.type) {
    case "thread.started":
      return createTaskEvent(taskId, requestId, "task.accepted", "running", "Codex thread is ready.", {
        threadId: event.thread_id,
      });
    case "turn.started":
      return createTaskEvent(taskId, requestId, "task.context_built", "running", "Prompt sent to Codex.");
    case "item.started":
    case "item.updated":
    case "item.completed":
      return createTaskEvent(
        taskId,
        requestId,
        "task.progress",
        "running",
        describeThreadItem(event.item),
        createThreadItemPayload(event.item),
      );
    case "turn.completed":
      return createTaskEvent(taskId, requestId, "task.progress", "running", "Codex finished generating a response.", {
        usage: event.usage,
      });
    case "turn.failed":
      return createTaskEvent(taskId, requestId, "task.failed", "failed", event.error.message);
    case "error":
      return createTaskEvent(taskId, requestId, "task.failed", "failed", event.message);
    default:
      return null;
  }
}

function createThreadItemPayload(item: ThreadItem): Record<string, unknown> {
  return {
    itemType: item.type,
    itemId: item.id,
    ...(item.type === "agent_message" && item.text.trim() ? { itemText: item.text } : {}),
  };
}

function collectThreadArtifacts(
  event: ThreadEvent,
  touchedFiles: Set<string>,
  setFinalResponse: (value: string) => void,
): void {
  if (!("item" in event)) {
    return;
  }

  const item = event.item;

  if (item.type === "agent_message") {
    setFinalResponse(item.text);
    return;
  }

  if (item.type === "file_change") {
    for (const change of item.changes) {
      touchedFiles.add(change.path);
    }
  }
}

function describeThreadItem(item: ThreadItem): string {
  switch (item.type) {
    case "agent_message":
      return item.text.trim() || "Codex produced an assistant message.";
    case "reasoning":
      return "Codex updated its reasoning summary.";
    case "command_execution":
      return `Codex ran: ${item.command}`;
    case "file_change":
      return `Codex applied file changes to ${item.changes.length} file(s).`;
    case "mcp_tool_call":
      return `Codex called MCP tool ${item.server}/${item.tool}.`;
    case "web_search":
      return `Codex searched the web for "${item.query}".`;
    case "todo_list":
      return "Codex updated its internal todo list.";
    case "error":
      return item.message;
    default:
      return "Codex reported progress.";
  }
}

function describeSessionMode(sessionLease: CodexSessionLease): string {
  switch (sessionLease.sessionMode) {
    case "created":
      return "Themis created a new Codex conversation for this session.";
    case "resumed":
      return "Themis resumed the existing Codex conversation for this session.";
    default:
      return "Themis started an ephemeral Codex conversation for this task.";
  }
}

function createSessionPayload(
  sessionLease: CodexSessionLease,
  resolvedThreadId?: string,
): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {
    sessionMode: sessionLease.sessionMode,
  };

  if (sessionLease.sessionId) {
    payload.sessionId = sessionLease.sessionId;
  }

  if (resolvedThreadId ?? sessionLease.threadId) {
    payload.threadId = resolvedThreadId ?? sessionLease.threadId;
  }

  return Object.keys(payload).length ? payload : undefined;
}

function summarizeResponse(finalResponse: string): string {
  const normalized = finalResponse.trim();

  if (!normalized) {
    return "Codex completed the task but did not return a final text response.";
  }

  const [firstLine] = normalized.split("\n");
  return firstLine ? firstLine.slice(0, 200) : normalized.slice(0, 200);
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
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

  throw signal.reason instanceof Error ? signal.reason : new Error(describeAbort(signal));
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message.startsWith("TASK_TIMEOUT:");
}

function describeAbort(signal: AbortSignal): string {
  const reason = signal.reason;

  if (reason instanceof Error) {
    if (reason.message.startsWith("TASK_TIMEOUT:")) {
      const timeout = reason.message.split(":")[1] ?? "0";
      const seconds = Math.max(1, Math.round(Number.parseInt(timeout, 10) / 1000));
      return `任务因超时被取消，超时时间约为 ${seconds} 秒。`;
    }

    if (reason.message === "CLIENT_DISCONNECTED") {
      return "客户端已断开连接，任务已停止。";
    }
  }

  return "任务已被取消。";
}

function normalizeOptionalText(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
