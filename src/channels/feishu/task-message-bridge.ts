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
  progressMaxTextUpdates?: number;
}

export const FEISHU_PLACEHOLDER_TEXT = "处理中...";
export const FEISHU_COMPLETED_TEXT = "已完成";
export const DEFAULT_FEISHU_PROGRESS_FLUSH_TIMEOUT_MS = 20_000;
const FEISHU_EAGER_PROGRESS_MIN_LENGTH = 220;
const FEISHU_EAGER_PROGRESS_MIN_LENGTH_WITH_BULLETS = 120;
const FEISHU_EAGER_PROGRESS_MIN_BULLET_COUNT = 2;
const FEISHU_PROGRESS_FORCE_FLUSH_TIMEOUT_MULTIPLIER = 2;
const DEFAULT_FEISHU_PROGRESS_MAX_TEXT_UPDATES = 20;
const FEISHU_PROGRESS_RESERVED_FINAL_UPDATE_COUNT = 1;

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
  private readonly progressForceFlushTimeoutMs: number;
  private readonly progressMaxTextUpdates: number;
  private readonly progressIncrementalUpdateLimit: number;
  private currentPlaceholderMessageId: string | null = null;
  private currentPlaceholderUpdatable = false;
  private currentPlaceholderFollowsVisibleProgress = false;
  private activeProgressItemId: string | null = null;
  private activeProgressMessageId: string | null = null;
  private activeProgressUpdatable = false;
  private activeProgressText: string | null = null;
  private activeProgressTextUpdateCount = 0;
  private activeProgressIncrementalUpdatesPaused = false;
  private pendingProgressItemId: string | null = null;
  private pendingProgressText: string | null = null;
  private pendingProgressStartedAt = 0;
  private pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFlushOperation: Promise<void> | null = null;
  private resolvePendingFlushOperation: (() => void) | null = null;
  private terminalDelivered = false;

  constructor(options: FeishuTaskMessageBridgeOptions) {
    this.createText = options.createText;
    this.updateText = options.updateText;
    this.sendText = options.sendText;
    this.splitText = options.splitText;
    this.createDraft = options.createDraft ?? null;
    this.updateDraft = options.updateDraft ?? null;
    this.progressFlushTimeoutMs = normalizeProgressFlushTimeoutMs(options.progressFlushTimeoutMs);
    this.progressForceFlushTimeoutMs = Math.max(
      this.progressFlushTimeoutMs + 1,
      this.progressFlushTimeoutMs * FEISHU_PROGRESS_FORCE_FLUSH_TIMEOUT_MULTIPLIER,
    );
    this.progressMaxTextUpdates = normalizeProgressMaxTextUpdates(options.progressMaxTextUpdates);
    this.progressIncrementalUpdateLimit = Math.max(
      0,
      this.progressMaxTextUpdates - FEISHU_PROGRESS_RESERVED_FINAL_UPDATE_COUNT,
    );
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
    this.clearPendingProgress();
    this.clearActiveProgress();
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

    if (this.pendingProgressText && this.pendingProgressItemId !== itemId) {
      await this.cancelScheduledPendingFlush();
      await this.flushPendingProgress({ force: true });
    }

    if (this.pendingProgressItemId !== itemId || !this.pendingProgressStartedAt) {
      this.pendingProgressStartedAt = Date.now();
    }

    this.pendingProgressItemId = itemId;
    this.pendingProgressText = normalizedText;

    if (this.activeProgressIncrementalUpdatesPaused && this.activeProgressItemId === itemId) {
      return;
    }

    if (shouldFlushProgressImmediately(normalizedText, this.activeProgressText)) {
      await this.cancelScheduledPendingFlush();
      await this.flushPendingProgress({ force: true });
      return;
    }

    this.schedulePendingFlush();
  }

  private async deliverCompletedText(text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    await this.cancelScheduledPendingFlush();
    this.terminalDelivered = true;

    const pendingProgressItemId = this.pendingProgressItemId;
    this.clearPendingProgress();

    if (!this.activeProgressItemId) {
      await this.commitCurrentPlaceholder(normalizedText);
      this.clearActiveProgress();
      return;
    }

    if (pendingProgressItemId && pendingProgressItemId !== this.activeProgressItemId) {
      const committed = await this.commitCurrentPlaceholder(normalizedText);
      this.setActiveProgress(pendingProgressItemId, committed, normalizedText);
      await this.ensureFollowupPlaceholderAfterProgress();
      await this.commitCurrentPlaceholder(FEISHU_COMPLETED_TEXT);
      this.clearActiveProgress();
      return;
    }

    if (normalizeComparableReply(this.activeProgressText ?? "") !== normalizeComparableReply(normalizedText)) {
      const updated = await this.writeActiveProgressText(normalizedText, { final: true });
      if (updated) {
        this.activeProgressText = normalizedText;
      }
    }

    await this.ensureFollowupPlaceholderAfterProgress();
    await this.commitCurrentPlaceholder(FEISHU_COMPLETED_TEXT);
    this.clearActiveProgress();
  }

  private async deliverTerminalText(text: string): Promise<void> {
    const normalizedText = normalizeText(text);

    if (!normalizedText) {
      return;
    }

    await this.cancelScheduledPendingFlush();
    this.terminalDelivered = true;
    this.clearPendingProgress();
    this.clearActiveProgress();
    await this.commitCurrentPlaceholder(normalizedText);
  }

  private async sendStandaloneMessage(
    text: string,
  ): Promise<{ messageId: string | null; updatable: boolean; textUpdateCount: number }> {
    const chunks = this.splitText(text);

    if (!chunks.length) {
      return {
        messageId: null,
        updatable: false,
        textUpdateCount: 0,
      };
    }

    const [firstChunk, ...remainingChunks] = chunks;

    if (!firstChunk) {
      return {
        messageId: null,
        updatable: false,
        textUpdateCount: 0,
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
      textUpdateCount: 0,
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

  private async commitCurrentPlaceholder(
    text: string,
  ): Promise<{ messageId: string | null; updatable: boolean; textUpdateCount: number }> {
    await this.ensureCurrentPlaceholder();
    const messageId = this.currentPlaceholderMessageId;
    const updatable = this.currentPlaceholderUpdatable;
    await this.fillCurrentPlaceholder(text);
    this.clearCurrentPlaceholder();
    return {
      messageId,
      updatable,
      textUpdateCount: updatable && messageId ? 1 : 0,
    };
  }

  private async flushPendingProgress(options?: { force?: boolean }): Promise<void> {
    const pendingProgressItemId = this.pendingProgressItemId;
    const pendingProgressText = this.pendingProgressText;
    const force = options?.force === true;

    if (!pendingProgressItemId || !pendingProgressText) {
      return;
    }

    const activeProgressText = this.activeProgressItemId === pendingProgressItemId
      ? this.activeProgressText
      : null;
    const nextVisibleText = force
      ? pendingProgressText
      : selectProgressFlushText(pendingProgressText, activeProgressText);

    if (!nextVisibleText) {
      this.schedulePendingFlush();
      return;
    }

    if (this.activeProgressItemId && this.activeProgressItemId === pendingProgressItemId) {
      const updated = await this.writeActiveProgressText(nextVisibleText);
      if (!updated) {
        return;
      }
    } else {
      const committed = await this.commitCurrentPlaceholder(nextVisibleText);
      this.setActiveProgress(pendingProgressItemId, committed, nextVisibleText);
      await this.ensureFollowupPlaceholderAfterProgress();
    }

    this.activeProgressText = nextVisibleText;

    if (normalizeComparableReply(nextVisibleText) === normalizeComparableReply(pendingProgressText)) {
      if (
        this.pendingProgressItemId === pendingProgressItemId
        && this.pendingProgressText === pendingProgressText
      ) {
        this.clearPendingProgress();
      }
      return;
    }

    this.pendingProgressStartedAt = Date.now();
    this.schedulePendingFlush();
  }

  private clearCurrentPlaceholder(): void {
    this.currentPlaceholderMessageId = null;
    this.currentPlaceholderUpdatable = false;
    this.currentPlaceholderFollowsVisibleProgress = false;
  }

  private schedulePendingFlush(): void {
    if (!this.pendingProgressText || this.pendingFlushTimer) {
      return;
    }

    this.finishScheduledPendingFlush();

    this.pendingFlushOperation = new Promise<void>((resolve) => {
      this.resolvePendingFlushOperation = resolve;
      const elapsedMs = this.pendingProgressStartedAt ? Math.max(0, Date.now() - this.pendingProgressStartedAt) : 0;
      const remainingForceFlushMs = Math.max(1, this.progressForceFlushTimeoutMs - elapsedMs);
      const delayMs = Math.max(1, Math.min(this.progressFlushTimeoutMs, remainingForceFlushMs));

      this.pendingFlushTimer = setTimeout(() => {
        this.pendingFlushTimer = null;
        const force = this.pendingProgressStartedAt
          ? Date.now() - this.pendingProgressStartedAt >= this.progressForceFlushTimeoutMs
          : false;
        void this.flushPendingProgress({ force })
          .catch(() => {})
          .finally(() => {
            this.finishScheduledPendingFlush();
          });
      }, delayMs);
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

  private clearPendingProgress(): void {
    this.pendingProgressItemId = null;
    this.pendingProgressText = null;
    this.pendingProgressStartedAt = 0;
  }

  private setActiveProgress(
    itemId: string,
    slot: { messageId: string | null; updatable: boolean; textUpdateCount: number },
    text: string,
  ): void {
    this.activeProgressItemId = itemId;
    this.activeProgressMessageId = slot.messageId;
    this.activeProgressUpdatable = slot.updatable;
    this.activeProgressText = text;
    this.activeProgressTextUpdateCount = slot.textUpdateCount;
    this.activeProgressIncrementalUpdatesPaused = false;
  }

  private clearActiveProgress(): void {
    this.activeProgressItemId = null;
    this.activeProgressMessageId = null;
    this.activeProgressUpdatable = false;
    this.activeProgressText = null;
    this.activeProgressTextUpdateCount = 0;
    this.activeProgressIncrementalUpdatesPaused = false;
  }

  private async writeActiveProgressText(
    text: string,
    options?: { final?: boolean },
  ): Promise<boolean> {
    if (this.activeProgressUpdatable && this.activeProgressMessageId) {
      if (options?.final !== true && this.activeProgressTextUpdateCount >= this.progressIncrementalUpdateLimit) {
        this.activeProgressIncrementalUpdatesPaused = true;
        return false;
      }

      await this.updateText(this.activeProgressMessageId, text);
      this.activeProgressTextUpdateCount += 1;
      return true;
    }

    const sent = await this.sendStandaloneMessage(text);
    this.activeProgressMessageId = sent.messageId;
    this.activeProgressUpdatable = sent.updatable;
    this.activeProgressTextUpdateCount = sent.textUpdateCount;
    return true;
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

function normalizeProgressMaxTextUpdates(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_FEISHU_PROGRESS_MAX_TEXT_UPDATES;
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

function selectProgressFlushText(text: string, currentVisibleText: string | null): string | null {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return null;
  }

  const visibleText = normalizeText(currentVisibleText);

  if (!visibleText) {
    const boundary = findLatestProgressBoundary(normalizedText);
    return boundary ? normalizedText.slice(0, boundary).trimEnd() : null;
  }

  if (!normalizedText.startsWith(visibleText)) {
    return null;
  }

  const suffix = normalizedText.slice(visibleText.length);
  const boundary = findLatestProgressBoundary(suffix);

  if (!boundary) {
    return null;
  }

  const nextVisibleText = normalizedText.slice(0, visibleText.length + boundary).trimEnd();

  if (normalizeComparableReply(nextVisibleText) === normalizeComparableReply(visibleText)) {
    return null;
  }

  return nextVisibleText;
}

function findLatestProgressBoundary(text: string): number | null {
  if (!text) {
    return null;
  }

  const blankLineBoundary = findLastBoundaryMatch(text, /\n\s*\n/g);

  if (blankLineBoundary) {
    return blankLineBoundary;
  }

  const chineseSentenceBoundary = findLastBoundaryMatch(text, /[。！？][`”"'）)]*/g);

  if (chineseSentenceBoundary) {
    return chineseSentenceBoundary;
  }

  return findLastBoundaryMatch(text, /[.!?][`”"'）)]*(?=\s|$)/g);
}

function findLastBoundaryMatch(text: string, pattern: RegExp): number | null {
  let lastBoundary: number | null = null;

  for (const match of text.matchAll(pattern)) {
    const start = typeof match.index === "number" ? match.index : -1;
    const matched = match[0] ?? "";

    if (start < 0 || !matched) {
      continue;
    }

    lastBoundary = start + matched.length;
  }

  return lastBoundary;
}

function shouldFlushProgressImmediately(text: string, lastVisibleProgressText: string | null): boolean {
  if (lastVisibleProgressText) {
    return false;
  }

  const comparable = normalizeComparableReply(text);

  if (!comparable) {
    return false;
  }

  const bulletCount = comparable
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:-|\*)\s+/.test(line))
    .length;
  const normalizedComparable = comparable.trim();
  const endsCleanly = /[。！？.!?`”"'）)]$/.test(normalizedComparable);

  if (
    bulletCount >= FEISHU_EAGER_PROGRESS_MIN_BULLET_COUNT
    && normalizedComparable.length >= FEISHU_EAGER_PROGRESS_MIN_LENGTH_WITH_BULLETS
  ) {
    return true;
  }

  return normalizedComparable.length >= FEISHU_EAGER_PROGRESS_MIN_LENGTH && endsCleanly;
}
