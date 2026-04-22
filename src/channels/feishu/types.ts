import type { TaskAttachment, TaskInputEnvelope, TaskOptions } from "../../types/index.js";

export interface FeishuSender {
  userId?: string;
  openId?: string;
  name?: string;
  tenantKey?: string;
}

export interface FeishuMessageContext {
  messageId?: string;
  chatId?: string;
  threadId?: string;
  text?: string;
  locale?: string;
}

export interface FeishuTaskPayload {
  source?: "feishu";
  requestId?: string;
  taskId?: string;
  sessionId?: string;
  goal?: string;
  inputText?: string;
  additionalPromptSections?: string[];
  inputEnvelope?: TaskInputEnvelope;
  sender?: FeishuSender;
  message?: FeishuMessageContext;
  attachments?: TaskAttachment[];
  options?: TaskOptions;
  createdAt?: string;
}

export type FeishuDeliveryKind = "event" | "result" | "error";

export interface FeishuDeliveryMessage {
  kind: FeishuDeliveryKind;
  requestId: string;
  taskId?: string;
  title: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export type FeishuMessageSink = (message: FeishuDeliveryMessage) => Promise<void>;
