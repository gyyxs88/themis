import type { SessionNativeThreadSummary } from "../../core/native-thread-summary.js";

export function renderFeishuWaitingActionSurface(input: {
  sessionId: string;
  latestStatus?: string;
  actionId: string;
  actionType: "approval" | "user-input";
  prompt: string;
  thread?: SessionNativeThreadSummary | null;
}): string {
  const commandLines = input.actionType === "approval"
    ? [
      `- 批准：/approve ${input.actionId}`,
      `- 拒绝：/deny ${input.actionId}`,
    ]
    : [
      "- 直接回复这条消息即可继续",
      `- 如需显式指定 action，也可用：/reply ${input.actionId} <内容>`,
    ];

  return [
    "## 等待你处理",
    `会话：${input.sessionId}`,
    input.latestStatus ? `任务状态：${input.latestStatus}` : "",
    renderThreadSummaryLine(input.thread),
    input.thread?.preview ? `线程预览：${input.thread.preview}` : "",
    "",
    input.prompt,
    "",
    ...commandLines,
  ].filter(Boolean).join("\n");
}

export function renderFeishuCurrentSessionSurface(input: {
  sessionId: string;
  workspacePath?: string | null;
  principalId: string;
  accountLabel: string;
  latestStatus?: string;
  thread?: SessionNativeThreadSummary | null;
}): string {
  return [
    "## 当前会话",
    `当前会话：${input.sessionId}`,
    `当前会话工作区：${input.workspacePath ?? "未设置（回退到 Themis 启动目录）"}`,
    `当前 principal：${input.principalId}`,
    `认证账号：${input.accountLabel}`,
    input.latestStatus ? `任务状态：${input.latestStatus}` : "",
    renderThreadSummaryLine(input.thread),
    input.thread?.preview ? `线程预览：${input.thread.preview}` : "",
  ].filter(Boolean).join("\n");
}

export function renderFeishuTaskStatusSurface(input: {
  phase: "running" | "action-submitted-running" | "restoring" | "completed" | "failed";
  sessionId: string;
  summary: string;
}): string {
  const title = resolveTaskStatusTitle(input.phase);

  return [
    `## ${title}`,
    `会话：${input.sessionId}`,
    input.summary,
  ].join("\n");
}

function renderThreadSummaryLine(thread?: SessionNativeThreadSummary | null): string {
  if (!thread) {
    return "";
  }

  const segments = [
    `线程：${thread.threadId}`,
    thread.status ? `状态 ${thread.status}` : "",
    Number.isFinite(thread.turnCount) ? `${thread.turnCount} turns` : "",
  ].filter(Boolean);

  return segments.join("｜");
}

function resolveTaskStatusTitle(
  phase: "running" | "action-submitted-running" | "restoring" | "completed" | "failed",
): string {
  switch (phase) {
    case "action-submitted-running":
      return "系统继续处理中";
    case "restoring":
      return "系统正在恢复状态";
    case "completed":
      return "任务已完成";
    case "failed":
      return "任务执行失败";
    case "running":
    default:
      return "任务状态更新";
  }
}
