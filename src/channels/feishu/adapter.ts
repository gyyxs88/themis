import type { ChannelAdapter } from "../../communication/adapter.js";
import type { TaskError, TaskEvent, TaskRequest, TaskResult } from "../../types/index.js";
import type { FeishuDeliveryMessage, FeishuMessageSink, FeishuTaskPayload } from "./types.js";

export interface FeishuAdapterOptions {
  deliver?: FeishuMessageSink;
}

const NOOP_DELIVERY: FeishuMessageSink = async () => {};

export class FeishuAdapter implements ChannelAdapter<FeishuTaskPayload> {
  readonly channelId = "feishu" as const;

  private readonly deliver: FeishuMessageSink;

  constructor(options: FeishuAdapterOptions = {}) {
    this.deliver = options.deliver ?? NOOP_DELIVERY;
  }

  canHandle(input: FeishuTaskPayload): boolean {
    if (!isRecord(input)) {
      return false;
    }

    if (input.source === "feishu") {
      return true;
    }

    return isRecord(input.sender) || isRecord(input.message);
  }

  normalizeRequest(input: FeishuTaskPayload): TaskRequest {
    if (!this.canHandle(input)) {
      throw new Error("Payload is not a Feishu request.");
    }

    const goal = normalizeText(input.goal) ?? normalizeText(input.message?.text);

    if (!goal) {
      throw new Error("Feishu payload is missing a task goal.");
    }

    const userId = normalizeText(input.sender?.userId) ?? normalizeText(input.sender?.openId);

    if (!userId) {
      throw new Error("Feishu payload is missing sender identity.");
    }

    const taskId = normalizeText(input.taskId);
    const displayName = normalizeText(input.sender?.name);
    const tenantId = normalizeText(input.sender?.tenantKey);
    const inputText = normalizeText(input.inputText);
    const channelSessionKey = normalizeText(input.sessionId) ?? normalizeText(input.message?.chatId);
    const replyTarget = normalizeText(input.message?.chatId);
    const threadId = normalizeText(input.message?.threadId);
    const messageId = normalizeText(input.message?.messageId);
    const locale = normalizeText(input.message?.locale);

    return {
      requestId: normalizeText(input.requestId) ?? createId("feishu-req"),
      ...(taskId ? { taskId } : {}),
      sourceChannel: this.channelId,
      user: {
        userId,
        ...(displayName ? { displayName } : {}),
        ...(tenantId ? { tenantId } : {}),
      },
      goal,
      ...(inputText ? { inputText } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.options ? { options: input.options } : {}),
      channelContext: {
        ...(channelSessionKey ? { channelSessionKey } : {}),
        ...(threadId ? { threadId } : {}),
        ...(messageId ? { messageId } : {}),
        ...(replyTarget ? { replyTarget } : {}),
        ...(locale ? { locale } : {}),
      },
      createdAt: normalizeText(input.createdAt) ?? new Date().toISOString(),
    };
  }

  async handleEvent(event: TaskEvent): Promise<void> {
    const payload = isRecord(event.payload) ? event.payload : undefined;
    const itemType = normalizeText(typeof payload?.itemType === "string" ? payload.itemType : undefined);

    if (event.type !== "task.progress" || itemType !== "agent_message") {
      return;
    }

    await this.deliver({
      kind: "event",
      requestId: event.requestId,
      taskId: event.taskId,
      title: event.type,
      text: event.message ?? `Task status changed to ${event.status}.`,
      ...(payload ? { metadata: payload } : {}),
    });
  }

  async handleResult(result: TaskResult): Promise<void> {
    const text = normalizeText(result.output) ?? normalizeText(result.summary) ?? "任务已结束。";

    await this.deliver({
      kind: "result",
      requestId: result.requestId,
      taskId: result.taskId,
      title: `task.${result.status}`,
      text,
      metadata: {
        status: result.status,
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
