import type { ChannelAdapter } from "../../communication/adapter.js";
import type { TaskError, TaskEvent, TaskRequest, TaskResult } from "../../types/index.js";
import type { WebMessageSink, WebTaskPayload } from "./types.js";

export interface WebAdapterOptions {
  deliver?: WebMessageSink;
}

const NOOP_DELIVERY: WebMessageSink = async () => {};

export class WebAdapter implements ChannelAdapter<WebTaskPayload> {
  readonly channelId = "web" as const;

  private readonly deliver: WebMessageSink;

  constructor(options: WebAdapterOptions = {}) {
    this.deliver = options.deliver ?? NOOP_DELIVERY;
  }

  canHandle(input: WebTaskPayload): boolean {
    if (!isRecord(input)) {
      return false;
    }

    if (input.source === "web") {
      return true;
    }

    return typeof input.goal === "string";
  }

  normalizeRequest(input: WebTaskPayload): TaskRequest {
    if (!this.canHandle(input)) {
      throw new Error("Payload is not a web request.");
    }

    const goal = normalizeText(input.goal);

    if (!goal) {
      throw new Error("Web payload is missing a task goal.");
    }

    const taskId = normalizeText(input.taskId);
    const inputText = normalizeText(input.inputText);
    const historyContext = normalizeText(input.historyContext);
    const userId = normalizeText(input.userId) ?? "webui";
    const displayName = normalizeText(input.displayName);
    const channelSessionKey = normalizeText(input.sessionId);

    return {
      requestId: normalizeText(input.requestId) ?? createId("web-req"),
      ...(taskId ? { taskId } : {}),
      sourceChannel: this.channelId,
      user: {
        userId,
        ...(displayName ? { displayName } : {}),
      },
      goal,
      ...(inputText ? { inputText } : {}),
      ...(historyContext ? { historyContext } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.options ? { options: input.options } : {}),
      channelContext: {
        ...(channelSessionKey ? { channelSessionKey } : {}),
      },
      createdAt: normalizeText(input.createdAt) ?? new Date().toISOString(),
    };
  }

  async handleEvent(event: TaskEvent): Promise<void> {
    await this.deliver({
      kind: "event",
      requestId: event.requestId,
      taskId: event.taskId,
      title: event.type,
      text: event.message ?? `Task status changed to ${event.status}.`,
      ...(event.payload ? { metadata: event.payload } : {}),
    });
  }

  async handleResult(result: TaskResult): Promise<void> {
    await this.deliver({
      kind: "result",
      requestId: result.requestId,
      taskId: result.taskId,
      title: `task.${result.status}`,
      text: result.summary,
      metadata: {
        ...(result.output ? { output: result.output } : {}),
        ...(result.touchedFiles?.length ? { touchedFiles: result.touchedFiles } : {}),
        ...(result.memoryUpdates?.length ? { memoryUpdates: result.memoryUpdates } : {}),
        ...(result.structuredOutput ? { structuredOutput: result.structuredOutput } : {}),
      },
    });
  }

  async handleError(error: TaskError, request: TaskRequest): Promise<void> {
    await this.deliver({
      kind: "error",
      requestId: request.requestId,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      title: error.code,
      text: error.message,
      ...(error.details ? { metadata: error.details } : {}),
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
