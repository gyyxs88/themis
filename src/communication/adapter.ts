import type { ChannelId, TaskError, TaskEvent, TaskRequest, TaskResult } from "../types/index.js";

export interface ChannelAdapter<Input = unknown> {
  readonly channelId: ChannelId;
  canHandle(input: Input): boolean;
  normalizeRequest(input: Input): TaskRequest;
  handleEvent(event: TaskEvent): Promise<void>;
  handleResult(result: TaskResult): Promise<void>;
  handleError(error: TaskError, request: TaskRequest): Promise<void>;
}

export interface CommunicationRouter {
  registerAdapter(adapter: ChannelAdapter): void;
  normalizeRequest(input: unknown): TaskRequest;
  publishEvent(event: TaskEvent): Promise<void>;
  publishResult(result: TaskResult): Promise<void>;
  publishError(error: TaskError, request: TaskRequest): Promise<void>;
}
