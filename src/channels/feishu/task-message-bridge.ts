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
  progressFlushTimeoutMs?: number;
}

export const FEISHU_PLACEHOLDER_TEXT = "处理中...";
export const FEISHU_COMPLETED_TEXT = "已完成";
export const DEFAULT_FEISHU_PROGRESS_FLUSH_TIMEOUT_MS = 60_000;

export class FeishuTaskMessageBridge {
  private readonly deliveredProgress = new Map<string, string>();
  private readonly deliveredStatus = new Map<string, string>();
  private readonly createText: (text: string) => Promise<FeishuMessageMutationResponse>;
  private readonly updateText: (messageId: string, text: string) => Promise<FeishuMessageMutationResponse>;
  private readonly sendText: (text: string) => Promise<void>;
  private readonly splitText: (text: string) => string[];
  private readonly createDraft: ((draft: FeishuRenderedMessageDraft) => Promise<FeishuMessageMutationResponse>) | null;
  private readonly updateDraft: ((messageId: string, draft: FeishuRenderedMessageDraft) => Promise<FeishuMessageMutationResponse>) | null;
  private readonly progressFlushTimeoutMs: number;
  private currentPlaceholderMessageId: string | null = null;
  private currentPlaceholderUpdatable = false;
  private currentPlaceholderFollowsVisibleProgress = false;
  private pendingProgressItemId: string | null = null;
  private pendingProgressText: string | null = null;
  private lastVisibleProgressText: string | null = null;
  private pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFlushOperation: Promise<void> | null = null;
  private resolvePendingFlushOperation: (() => void) | null = null;

  constructor(options: FeishuTaskMessageBridgeOptions) {
    this.createText = options.createText;
    this.updateText = options.updateText;
    this.sendText = options.sendText;
    this.splitText = options.splitText;
    this.createDraft = options.createDraft ?? null;
    this.updateDraft = options.updateDraft ?? null;
    this.progressFlushTimeoutMs = normalizeProgressFlushTimeoutMs(options.progressFlushTimeoutMs);
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

    await this.cancelScheduledPendingFlush();
    this.pendingProgressItemId = null;
    this.pendingProgressText = null;
    this.lastVisibleProgressText = null;
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

    if (itemType !== "agent_message" || threadEventType !== "item.completed") {
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
    await this.deliverProgressText(itemId, text);
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

  private async deliverProgressText(itemId: string, text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    await this.cancelScheduledPendingFlush();

    if (this.pendingProgressText && this.pendingProgressItemId !== itemId) {
      await this.flushPendingProgressAndKeepPlaceholder();
    }

    this.pendingProgressItemId = itemId;
    this.pendingProgressText = normalizedText;
    this.schedulePendingFlush();
  }

  private async deliverCompletedText(text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    await this.cancelScheduledPendingFlush();

    const pendingProgressText = this.pendingProgressText;
    this.pendingProgressItemId = null;
    this.pendingProgressText = null;

    if (!pendingProgressText) {
      if (
        this.currentPlaceholderFollowsVisibleProgress
        && this.lastVisibleProgressText
        && normalizeComparableReply(this.lastVisibleProgressText) === normalizeComparableReply(normalizedText)
      ) {
        await this.commitCurrentPlaceholder(FEISHU_COMPLETED_TEXT);
        this.lastVisibleProgressText = null;
        return;
      }

      await this.commitCurrentPlaceholder(normalizedText);
      this.lastVisibleProgressText = null;
      return;
    }

    if (normalizeComparableReply(pendingProgressText) === normalizeComparableReply(normalizedText)) {
      await this.commitCurrentPlaceholder(normalizedText);
      this.lastVisibleProgressText = null;
      return;
    }

    await this.commitCurrentPlaceholder(pendingProgressText);
    await this.sendStandaloneMessage(normalizedText);
    this.lastVisibleProgressText = null;
  }

  private async deliverTerminalText(text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    await this.cancelScheduledPendingFlush();
    this.pendingProgressItemId = null;
    this.pendingProgressText = null;
    this.lastVisibleProgressText = null;
    await this.commitCurrentPlaceholder(normalizedText);
  }

  private async sendStandaloneMessage(text: string): Promise<{ messageId: string | null; updatable: boolean }> {
    const chunks = this.splitText(text);

    if (!chunks.length) {
      return {
        messageId: null,
        updatable: false,
      };
    }

    const [firstChunk, ...remainingChunks] = chunks;

    if (!firstChunk) {
      return {
        messageId: null,
        updatable: false,
      };
    }

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
    this.currentPlaceholderFollowsVisibleProgress = false;
  }

  private async ensureFollowupPlaceholderAfterProgress(): Promise<void> {
    if (this.currentPlaceholderUpdatable && this.currentPlaceholderMessageId) {
      return;
    }

    const placeholder = await this.sendStandaloneMessage(FEISHU_PLACEHOLDER_TEXT);
    this.currentPlaceholderMessageId = placeholder.messageId;
    this.currentPlaceholderUpdatable = placeholder.updatable;
    this.currentPlaceholderFollowsVisibleProgress = true;
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

  private async commitCurrentPlaceholder(text: string): Promise<void> {
    await this.ensureCurrentPlaceholder();
    await this.fillCurrentPlaceholder(text);
    this.clearCurrentPlaceholder();
  }

  private async flushPendingProgressAndKeepPlaceholder(): Promise<void> {
    const pendingProgressText = this.pendingProgressText;

    if (!pendingProgressText) {
      return;
    }

    await this.commitCurrentPlaceholder(pendingProgressText);
    this.lastVisibleProgressText = pendingProgressText;
    this.pendingProgressItemId = null;
    this.pendingProgressText = null;
    await this.ensureFollowupPlaceholderAfterProgress();
  }

  private clearCurrentPlaceholder(): void {
    this.currentPlaceholderMessageId = null;
    this.currentPlaceholderUpdatable = false;
    this.currentPlaceholderFollowsVisibleProgress = false;
  }

  private schedulePendingFlush(): void {
    if (!this.pendingProgressText) {
      return;
    }

    this.finishScheduledPendingFlush();

    this.pendingFlushOperation = new Promise<void>((resolve) => {
      this.resolvePendingFlushOperation = resolve;
      this.pendingFlushTimer = setTimeout(() => {
        this.pendingFlushTimer = null;
        void this.flushPendingProgressAndKeepPlaceholder()
          .catch(() => {})
          .finally(() => {
            this.finishScheduledPendingFlush();
          });
      }, this.progressFlushTimeoutMs);
    });
  }

  private async cancelScheduledPendingFlush(): Promise<void> {
    const timer = this.pendingFlushTimer;

    if (timer) {
      clearTimeout(timer);
      this.pendingFlushTimer = null;
      this.finishScheduledPendingFlush();
      return;
    }

    if (this.pendingFlushOperation) {
      await this.pendingFlushOperation;
    }
  }

  private finishScheduledPendingFlush(): void {
    const resolve = this.resolvePendingFlushOperation;
    this.resolvePendingFlushOperation = null;
    this.pendingFlushOperation = null;
    resolve?.();
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

function normalizeProgressFlushTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_FEISHU_PROGRESS_FLUSH_TIMEOUT_MS;
  }

  return Math.max(1, Math.round(value));
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
