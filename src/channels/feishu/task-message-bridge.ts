import type { FeishuDeliveryMessage } from "./types.js";
import type { FeishuRenderedMessageDraft } from "./message-renderer.js";

export interface FeishuMessageMutationResponse {
  code?: number | undefined;
  msg?: string | undefined;
  data?: {
    message_id?: string | undefined;
  } | undefined;
}

export interface FeishuTaskMessageBridgeOptions {
  createText: (text: string) => Promise<FeishuMessageMutationResponse>;
  updateText: (messageId: string, text: string) => Promise<FeishuMessageMutationResponse>;
  sendText: (text: string) => Promise<void>;
  splitText: (text: string) => string[];
  createDraft?: (draft: FeishuRenderedMessageDraft) => Promise<FeishuMessageMutationResponse>;
  updateDraft?: (messageId: string, draft: FeishuRenderedMessageDraft) => Promise<FeishuMessageMutationResponse>;
}

export const FEISHU_PLACEHOLDER_TEXT = "处理中...";
export const FEISHU_COMPLETED_TEXT = "已完成";

export class FeishuTaskMessageBridge {
  private readonly deliveredProgress = new Map<string, string>();
  private readonly deliveredStatus = new Map<string, string>();
  private readonly deliveredToolTrace = new Map<string, string>();
  private readonly toolTraceMessageIds = new Map<string, string | null>();
  private readonly toolTraceUpdatable = new Map<string, boolean>();
  private readonly createText: (text: string) => Promise<FeishuMessageMutationResponse>;
  private readonly updateText: (messageId: string, text: string) => Promise<FeishuMessageMutationResponse>;
  private readonly sendText: (text: string) => Promise<void>;
  private readonly splitText: (text: string) => string[];
  private readonly createDraft: ((draft: FeishuRenderedMessageDraft) => Promise<FeishuMessageMutationResponse>) | null;
  private readonly updateDraft: ((messageId: string, draft: FeishuRenderedMessageDraft) => Promise<FeishuMessageMutationResponse>) | null;
  private currentPlaceholderMessageId: string | null = null;
  private currentPlaceholderUpdatable = false;
  private lastVisibleProgressText: string | null = null;
  private terminalDelivered = false;

  constructor(options: FeishuTaskMessageBridgeOptions) {
    this.createText = options.createText;
    this.updateText = options.updateText;
    this.sendText = options.sendText;
    this.splitText = options.splitText;
    this.createDraft = options.createDraft ?? null;
    this.updateDraft = options.updateDraft ?? null;
  }

  async prepareResponseSlot(): Promise<void> {
    await this.ensureCurrentPlaceholder();
  }

  async replaceCurrentPlaceholderWithDraft(
    draft: FeishuRenderedMessageDraft,
  ): Promise<{ messageId: string | null; updatable: boolean }> {
    if (!this.createDraft || !this.updateDraft) {
      throw new Error("飞书 bridge 未配置 draft create/update 能力。");
    }

    this.clearVisibleProgress();
    await this.ensureCurrentPlaceholder();

    if (!this.currentPlaceholderUpdatable || !this.currentPlaceholderMessageId) {
      const created = await this.createDraft(draft);
      const messageId = normalizeText(created.data?.message_id);
      this.clearCurrentPlaceholder();
      return {
        messageId,
        updatable: Boolean(messageId),
      };
    }

    const response = await this.updateDraft(this.currentPlaceholderMessageId, draft);
    const messageId = normalizeText(response.data?.message_id) ?? this.currentPlaceholderMessageId;
    this.clearCurrentPlaceholder();
    return {
      messageId,
      updatable: Boolean(messageId),
    };
  }

  async deliver(message: FeishuDeliveryMessage): Promise<void> {
    switch (message.kind) {
      case "event":
        if (this.terminalDelivered) {
          return;
        }
        if (message.title === "task.action_required") {
          if (shouldSuppressPersonaOnboardingWaitingEvent(message)) {
            return;
          }
          await this.deliverWaitingAction(message);
          return;
        }
        await this.deliverProgress(message);
        return;
      case "result":
        await this.deliverResult(message);
        return;
      case "error":
        await this.deliverTerminalText(buildFeishuTerminalStateText("执行异常", message.text));
        return;
      default:
        return;
    }
  }

  private async deliverProgress(message: FeishuDeliveryMessage): Promise<void> {
    const metadata = asRecord(message.metadata);
    const traceKind = normalizeText(metadata?.traceKind);

    if (traceKind === "tool") {
      await this.deliverToolTrace(message, metadata);
      return;
    }

    const surfaceKind = normalizeText(metadata?.feishuSurfaceKind);

    if (surfaceKind === "status") {
      const text = resolveDeliveryText(message, metadata);

      if (!text) {
        return;
      }

      const previous = this.deliveredStatus.get(message.requestId);

      if (previous === text) {
        return;
      }

      this.deliveredStatus.set(message.requestId, text);
      await this.sendStandaloneMessage(text);
      return;
    }

    const itemType = normalizeText(metadata?.itemType);
    const threadEventType = normalizeText(metadata?.threadEventType);
    const itemPhase = normalizeText(metadata?.itemPhase);

    if (itemType !== "agent_message" || threadEventType !== "item.completed" || itemPhase === "final_answer") {
      return;
    }

    const text = resolveDeliveryText(message, metadata);

    if (!text) {
      return;
    }

    const itemId = normalizeText(metadata?.itemId) ?? message.requestId;
    const previous = this.deliveredProgress.get(itemId);

    if (previous === text) {
      return;
    }

    this.deliveredProgress.set(itemId, text);
    await this.deliverProgressText(text);
  }

  private async deliverToolTrace(
    message: FeishuDeliveryMessage,
    metadata: Record<string, unknown> | null,
  ): Promise<void> {
    const bucketId = normalizeText(metadata?.traceBucketId) ?? `${message.requestId}:tool`;
    const text = resolveDeliveryText(message, metadata);

    if (!text) {
      return;
    }

    const previous = this.deliveredToolTrace.get(bucketId);

    if (previous === text) {
      return;
    }

    this.deliveredToolTrace.set(bucketId, text);
    const messageId = this.toolTraceMessageIds.get(bucketId);
    const updatable = this.toolTraceUpdatable.get(bucketId) === true;

    if (messageId && updatable) {
      await this.updateStandaloneMessage(messageId, text);
      return;
    }

    let created: { messageId: string | null; updatable: boolean };

    if (this.shouldReuseCurrentPlaceholderForFirstToolTrace()) {
      created = await this.commitCurrentPlaceholder(text);
      await this.ensureFollowupPlaceholderAfterProgress();
    } else {
      created = await this.sendStandaloneMessage(text);
    }

    this.toolTraceMessageIds.set(bucketId, created.messageId);
    this.toolTraceUpdatable.set(bucketId, created.updatable);
  }

  private async deliverResult(message: FeishuDeliveryMessage): Promise<void> {
    const metadata = asRecord(message.metadata);
    const status = normalizeText(metadata?.status) ?? "completed";
    const text = resolveDeliveryText(message, metadata);

    if (status === "completed") {
      if (!text) {
        return;
      }

      await this.deliverCompletedText(text);
      return;
    }

    if (status === "cancelled") {
      await this.deliverTerminalText(buildFeishuTerminalStateText("任务已取消", text));
      return;
    }

    await this.deliverTerminalText(buildFeishuTerminalStateText("任务失败", text));
  }

  private async deliverWaitingAction(message: FeishuDeliveryMessage): Promise<void> {
    const metadata = asRecord(message.metadata);
    const text = resolveDeliveryText(message, metadata);

    if (!text) {
      return;
    }

    await this.deliverTerminalText(text);
  }

  private async deliverProgressText(text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    await this.commitCurrentPlaceholder(normalizedText);
    this.lastVisibleProgressText = normalizedText;
    await this.ensureFollowupPlaceholderAfterProgress();
  }

  private async deliverCompletedText(text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    this.terminalDelivered = true;

    if (!this.lastVisibleProgressText) {
      await this.commitCurrentPlaceholder(normalizedText);
      this.clearVisibleProgress();
      return;
    }

    if (normalizeComparableReply(this.lastVisibleProgressText) === normalizeComparableReply(normalizedText)) {
      await this.commitCurrentPlaceholder(FEISHU_COMPLETED_TEXT);
      this.clearVisibleProgress();
      return;
    }

    await this.commitCurrentPlaceholder(normalizedText);
    await this.ensureFollowupPlaceholderAfterProgress();
    await this.commitCurrentPlaceholder(FEISHU_COMPLETED_TEXT);
    this.clearVisibleProgress();
  }

  private async deliverTerminalText(text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    this.terminalDelivered = true;
    this.clearVisibleProgress();
    await this.commitCurrentPlaceholder(normalizedText);
  }

  private async sendStandaloneMessage(
    text: string,
  ): Promise<{ messageId: string | null; updatable: boolean }> {
    const chunks = this.splitText(text);

    if (chunks.length === 0 || !chunks[0]) {
      return {
        messageId: null,
        updatable: false,
      };
    }

    const [firstChunk, ...remainingChunks] = chunks;
    const created = await this.createText(firstChunk);
    const messageId = normalizeText(created.data?.message_id);

    for (const chunk of remainingChunks) {
      await this.sendText(chunk);
    }

    return {
      messageId,
      updatable: Boolean(messageId),
    };
  }

  private async ensureCurrentPlaceholder(): Promise<void> {
    if (this.currentPlaceholderUpdatable && this.currentPlaceholderMessageId) {
      return;
    }

    const placeholder = await this.sendStandaloneMessage(FEISHU_PLACEHOLDER_TEXT);
    this.currentPlaceholderMessageId = placeholder.messageId;
    this.currentPlaceholderUpdatable = placeholder.updatable;
  }

  private async ensureFollowupPlaceholderAfterProgress(): Promise<void> {
    if (this.currentPlaceholderUpdatable && this.currentPlaceholderMessageId) {
      return;
    }

    const placeholder = await this.sendStandaloneMessage(FEISHU_PLACEHOLDER_TEXT);
    this.currentPlaceholderMessageId = placeholder.messageId;
    this.currentPlaceholderUpdatable = placeholder.updatable;
  }

  private async fillCurrentPlaceholder(text: string): Promise<void> {
    if (!this.currentPlaceholderUpdatable || !this.currentPlaceholderMessageId) {
      await this.sendStandaloneMessage(text);
      return;
    }

    const chunks = this.splitText(text);
    const [firstChunk, ...remainingChunks] = chunks;

    if (!firstChunk) {
      return;
    }

    await this.updateText(this.currentPlaceholderMessageId, firstChunk);

    for (const chunk of remainingChunks) {
      await this.sendText(chunk);
    }
  }

  private async updateStandaloneMessage(messageId: string, text: string): Promise<void> {
    const chunks = this.splitText(text);
    const [firstChunk, ...remainingChunks] = chunks;

    if (!firstChunk) {
      return;
    }

    await this.updateText(messageId, firstChunk);

    for (const chunk of remainingChunks) {
      await this.sendText(chunk);
    }
  }

  private async commitCurrentPlaceholder(
    text: string,
  ): Promise<{ messageId: string | null; updatable: boolean }> {
    await this.ensureCurrentPlaceholder();
    const messageId = this.currentPlaceholderMessageId;
    const updatable = this.currentPlaceholderUpdatable;
    await this.fillCurrentPlaceholder(text);
    this.clearCurrentPlaceholder();
    return {
      messageId,
      updatable,
    };
  }

  private clearCurrentPlaceholder(): void {
    this.currentPlaceholderMessageId = null;
    this.currentPlaceholderUpdatable = false;
  }

  private clearVisibleProgress(): void {
    this.lastVisibleProgressText = null;
  }

  private shouldReuseCurrentPlaceholderForFirstToolTrace(): boolean {
    return !this.lastVisibleProgressText
      && this.toolTraceMessageIds.size === 0
      && this.currentPlaceholderUpdatable
      && Boolean(this.currentPlaceholderMessageId);
  }
}

export function normalizeComparableReply(text: string): string {
  return normalizeText(stripQuotaFooter(text).body) ?? "";
}

function stripQuotaFooter(text: string): { body: string; quotaFooter: string | null } {
  const normalizedText = normalizeText(text) ?? "";

  if (!normalizedText) {
    return {
      body: "",
      quotaFooter: null,
    };
  }

  const marker = "\n\n额度剩余：";
  const markerIndex = normalizedText.lastIndexOf(marker);

  if (markerIndex >= 0) {
    const body = normalizedText.slice(0, markerIndex).trim();
    const quotaFooter = normalizedText.slice(markerIndex + 2).trim();
    return {
      body,
      quotaFooter: quotaFooter || null,
    };
  }

  if (normalizedText.startsWith("额度剩余：")) {
    return {
      body: "",
      quotaFooter: normalizedText,
    };
  }

  return {
    body: normalizedText,
    quotaFooter: null,
  };
}

function resolveDeliveryText(
  message: FeishuDeliveryMessage,
  metadata: Record<string, unknown> | null,
): string | null {
  const directText = normalizeText(message.text);

  if (directText) {
    return directText;
  }

  const itemText = normalizeText(metadata?.itemText);

  if (itemText) {
    return itemText;
  }

  const output = normalizeText(metadata?.output);
  return output ?? null;
}

function buildFeishuTerminalStateText(label: string, text: string | null): string {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return label;
  }

  return `${normalizedText}\n\n${label}`;
}

function shouldSuppressPersonaOnboardingWaitingEvent(message: FeishuDeliveryMessage): boolean {
  if (message.title !== "task.action_required") {
    return false;
  }

  const metadata = asRecord(message.metadata);
  const actionId = normalizeText(metadata?.actionId);
  const personaOnboarding = asRecord(metadata?.personaOnboarding);

  return !actionId && Boolean(personaOnboarding);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}
