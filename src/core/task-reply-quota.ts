import type { CodexAuthRuntime } from "./codex-auth.js";
import type { CodexAuthRateLimits, CodexAuthRateLimitWindow } from "./codex-app-server.js";
import type { TaskRequest, TaskResult } from "../types/index.js";

export interface TaskReplyQuotaWindow {
  label: string;
  remainingPercent: number;
  windowDurationMins: number;
  resetsAt: string | null;
}

export interface TaskReplyQuotaFooter {
  text: string;
  windows: TaskReplyQuotaWindow[];
  capturedAt: string;
}

const TASK_REPLY_QUOTA_KEY = "replyQuota";

export async function appendTaskReplyQuotaFooter(
  authRuntime: CodexAuthRuntime,
  request: TaskRequest,
  result: TaskResult,
): Promise<TaskResult> {
  if (request.options?.accessMode === "third-party" || result.status !== "completed") {
    return result;
  }

  const snapshot = await safeReadAuthSnapshot(authRuntime);
  const footer = snapshot?.rateLimits ? buildTaskReplyQuotaFooter(snapshot.rateLimits) : null;

  if (!footer) {
    return result;
  }

  return {
    ...result,
    structuredOutput: {
      ...(result.structuredOutput ?? {}),
      [TASK_REPLY_QUOTA_KEY]: footer,
    },
  };
}

export function extractTaskReplyQuotaFooter(
  structuredOutput: Record<string, unknown> | undefined,
): TaskReplyQuotaFooter | null {
  const value = structuredOutput?.[TASK_REPLY_QUOTA_KEY];

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  const text = typeof record.text === "string" ? record.text.trim() : "";
  const capturedAt = typeof record.capturedAt === "string" ? record.capturedAt : "";
  const windows = Array.isArray(record.windows)
    ? record.windows
      .map((entry: unknown) => normalizeTaskReplyQuotaWindow(entry))
      .filter((entry: TaskReplyQuotaWindow | null): entry is TaskReplyQuotaWindow => Boolean(entry))
    : [];

  if (!text || !capturedAt || !windows.length) {
    return null;
  }

  return {
    text,
    windows,
    capturedAt,
  };
}

export function appendTaskReplyQuotaText(
  text: string,
  structuredOutput: Record<string, unknown> | undefined,
): string {
  const footer = extractTaskReplyQuotaFooter(structuredOutput);
  const normalizedText = text.trim();

  if (!footer?.text) {
    return normalizedText;
  }

  if (!normalizedText) {
    return footer.text;
  }

  return `${normalizedText}\n\n${footer.text}`;
}

async function safeReadAuthSnapshot(authRuntime: CodexAuthRuntime) {
  try {
    return await authRuntime.readSnapshot();
  } catch {
    return null;
  }
}

function buildTaskReplyQuotaFooter(rateLimits: CodexAuthRateLimits): TaskReplyQuotaFooter | null {
  const windows = [rateLimits.primary, rateLimits.secondary]
    .map((window) => buildTaskReplyQuotaWindow(window))
    .filter((window): window is TaskReplyQuotaWindow => Boolean(window))
    .sort((left, right) => left.windowDurationMins - right.windowDurationMins);
  const dedupedWindows = dedupeTaskReplyQuotaWindows(windows);

  if (!dedupedWindows.length) {
    return null;
  }

  return {
    text: `额度剩余：${dedupedWindows.map((window) => `${window.label} ${window.remainingPercent}%`).join("｜")}`,
    windows: dedupedWindows,
    capturedAt: new Date().toISOString(),
  };
}

function buildTaskReplyQuotaWindow(window: CodexAuthRateLimitWindow | null): TaskReplyQuotaWindow | null {
  if (!window?.windowDurationMins) {
    return null;
  }

  return {
    label: formatTaskReplyQuotaLabel(window.windowDurationMins),
    remainingPercent: calculateRemainingPercent(window.usedPercent),
    windowDurationMins: window.windowDurationMins,
    resetsAt: window.resetsAt,
  };
}

function normalizeTaskReplyQuotaWindow(value: unknown): TaskReplyQuotaWindow | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const remainingPercent = typeof record.remainingPercent === "number" && Number.isFinite(record.remainingPercent)
    ? Math.max(0, Math.min(100, Math.round(record.remainingPercent)))
    : null;
  const windowDurationMins = typeof record.windowDurationMins === "number" && Number.isFinite(record.windowDurationMins)
    ? Math.max(1, Math.round(record.windowDurationMins))
    : null;
  const resetsAt = typeof record.resetsAt === "string" ? record.resetsAt : null;

  if (!label || remainingPercent === null || windowDurationMins === null) {
    return null;
  }

  return {
    label,
    remainingPercent,
    windowDurationMins,
    resetsAt,
  };
}

function dedupeTaskReplyQuotaWindows(windows: TaskReplyQuotaWindow[]): TaskReplyQuotaWindow[] {
  const seenLabels = new Set<string>();
  const deduped: TaskReplyQuotaWindow[] = [];

  for (const window of windows) {
    if (seenLabels.has(window.label)) {
      continue;
    }

    seenLabels.add(window.label);
    deduped.push(window);
  }

  return deduped;
}

function calculateRemainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
}

function formatTaskReplyQuotaLabel(windowDurationMins: number): string {
  if (windowDurationMins === 60) {
    return "1h";
  }

  if (windowDurationMins < 1440 && windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60}h`;
  }

  if (windowDurationMins === 1440) {
    return "1d";
  }

  if (windowDurationMins === 10080) {
    return "1w";
  }

  if (windowDurationMins % 1440 === 0) {
    return `${windowDurationMins / 1440}d`;
  }

  return `${windowDurationMins}m`;
}
