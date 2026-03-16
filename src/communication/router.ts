import type { ChannelAdapter, CommunicationRouter } from "./adapter.js";
import type { ChannelId, TaskError, TaskEvent, TaskRequest, TaskResult } from "../types/index.js";

interface RequestRoute {
  channelId: ChannelId;
  taskId?: string;
}

export class InMemoryCommunicationRouter implements CommunicationRouter {
  private readonly adapters = new Map<ChannelId, ChannelAdapter>();
  private readonly requestRoutes = new Map<string, RequestRoute>();
  private readonly taskRoutes = new Map<string, ChannelId>();

  registerAdapter(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.channelId)) {
      throw new Error(`Channel adapter already registered for "${adapter.channelId}".`);
    }

    this.adapters.set(adapter.channelId, adapter);
  }

  normalizeRequest(input: unknown): TaskRequest {
    const matches = [...this.adapters.values()].filter((adapter) => adapter.canHandle(input));

    if (matches.length === 0) {
      throw new Error("No registered channel adapter can handle the incoming payload.");
    }

    if (matches.length > 1) {
      const channelIds = matches.map((adapter) => adapter.channelId).join(", ");
      throw new Error(`Multiple channel adapters matched the same payload: ${channelIds}.`);
    }

    const adapter = matches[0];

    if (!adapter) {
      throw new Error("Channel adapter resolution failed unexpectedly.");
    }

    const request = adapter.normalizeRequest(input);

    this.requestRoutes.set(request.requestId, {
      channelId: adapter.channelId,
      ...(request.taskId ? { taskId: request.taskId } : {}),
    });

    if (request.taskId) {
      this.taskRoutes.set(request.taskId, adapter.channelId);
    }

    return request;
  }

  async publishEvent(event: TaskEvent): Promise<void> {
    const adapter = this.resolveAdapterForMessage(event.requestId, event.taskId);
    this.taskRoutes.set(event.taskId, adapter.channelId);
    await adapter.handleEvent(event);
  }

  async publishResult(result: TaskResult): Promise<void> {
    const adapter = this.resolveAdapterForMessage(result.requestId, result.taskId);
    this.taskRoutes.set(result.taskId, adapter.channelId);
    await adapter.handleResult(result);
  }

  async publishError(error: TaskError, request: TaskRequest): Promise<void> {
    const adapter = this.resolveAdapterForChannel(request.sourceChannel, request.requestId);

    this.requestRoutes.set(request.requestId, {
      channelId: adapter.channelId,
      ...(request.taskId ? { taskId: request.taskId } : {}),
    });

    if (request.taskId) {
      this.taskRoutes.set(request.taskId, adapter.channelId);
    }

    await adapter.handleError(error, request);
  }

  private resolveAdapterForMessage(requestId: string, taskId?: string): ChannelAdapter {
    const requestRoute = this.requestRoutes.get(requestId);

    if (requestRoute) {
      if (taskId) {
        this.taskRoutes.set(taskId, requestRoute.channelId);
      }

      return this.resolveAdapterForChannel(requestRoute.channelId, requestId);
    }

    if (taskId) {
      const taskChannelId = this.taskRoutes.get(taskId);

      if (taskChannelId) {
        return this.resolveAdapterForChannel(taskChannelId, taskId);
      }
    }

    throw new Error(`No channel route found for request "${requestId}".`);
  }

  private resolveAdapterForChannel(channelId: ChannelId, traceId: string): ChannelAdapter {
    const adapter = this.adapters.get(channelId);

    if (!adapter) {
      throw new Error(`No channel adapter registered for "${channelId}" while resolving "${traceId}".`);
    }

    return adapter;
  }
}
