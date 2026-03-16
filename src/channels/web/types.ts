import type { TaskAttachment, TaskOptions, UserRole } from "../../types/index.js";

export interface WebTaskPayload {
  source?: "web";
  requestId?: string;
  taskId?: string;
  workflow?: string;
  goal?: string;
  inputText?: string;
  historyContext?: string;
  role?: UserRole;
  userId?: string;
  displayName?: string;
  sessionId?: string;
  attachments?: TaskAttachment[];
  options?: TaskOptions;
  createdAt?: string;
}

export type WebDeliveryKind = "event" | "result" | "error";

export interface WebDeliveryMessage {
  kind: WebDeliveryKind;
  requestId: string;
  taskId?: string;
  title: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export type WebMessageSink = (message: WebDeliveryMessage) => Promise<void>;

export interface WebTaskRunResponse {
  requestId: string;
  taskId: string;
  deliveries: WebDeliveryMessage[];
  result: {
    status: string;
    summary: string;
    output?: string;
    touchedFiles?: string[];
    structuredOutput?: Record<string, unknown>;
  };
}
