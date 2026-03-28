import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MemoryUpdate, TaskRequest, TaskResult } from "../types/index.js";

interface MemoryServiceOptions {
  workingDirectory: string;
}

interface RecordTaskStartInput {
  request: TaskRequest;
  taskId: string;
  principalId?: string;
  conversationId?: string;
}

interface RecordTaskCompletionInput {
  request: TaskRequest;
  result: TaskResult;
  taskId: string;
  principalId?: string;
  conversationId?: string;
  verified: boolean;
}

interface RecordTaskTerminalInput {
  request: TaskRequest;
  taskId: string;
  principalId?: string;
  conversationId?: string;
  terminalStatus: "failed" | "cancelled";
  summary: string;
}

const DEFAULT_IN_PROGRESS_HEADER = "# 进行中\n\n## 当前工作\n\n";
const DEFAULT_DONE_HEADER = "# 已完成\n\n## 当前已完成模块\n\n";

export class MemoryService {
  private readonly workingDirectory: string;

  constructor(options: MemoryServiceOptions) {
    this.workingDirectory = options.workingDirectory;
  }

  recordTaskStart(input: RecordTaskStartInput): MemoryUpdate[] {
    const updates: MemoryUpdate[] = [];
    const activePath = "memory/sessions/active.md";
    const inProgressPath = "memory/tasks/in-progress.md";
    const sessionId = input.conversationId ?? input.request.channelContext.sessionId ?? "";
    const activeContent = [
      "# 当前会话",
      "",
      `- 会话：${sessionId || "<unknown>"}`,
      `- 当前任务：${input.taskId}`,
      `- 目标：${input.request.goal}`,
      "- 状态：running",
      "",
    ].join("\n");
    writeRelativeFile(this.workingDirectory, activePath, activeContent);
    updates.push({
      kind: "session",
      target: activePath,
      action: "updated",
    });

    const inProgressContent = readRelativeFile(this.workingDirectory, inProgressPath, DEFAULT_IN_PROGRESS_HEADER);
    const nextInProgress = appendInProgressTask(inProgressContent, input.taskId, input.request.goal);
    if (nextInProgress !== inProgressContent) {
      writeRelativeFile(this.workingDirectory, inProgressPath, nextInProgress);
      updates.push({
        kind: "task",
        target: inProgressPath,
        action: "updated",
      });
    }

    return updates;
  }

  recordTaskCompletion(input: RecordTaskCompletionInput): MemoryUpdate[] {
    const updates: MemoryUpdate[] = [];
    const activePath = "memory/sessions/active.md";
    const inProgressPath = "memory/tasks/in-progress.md";
    const donePath = "memory/tasks/done.md";
    const sessionId = input.conversationId ?? input.request.channelContext.sessionId ?? "";
    const activeContent = [
      "# 当前会话",
      "",
      `- 会话：${sessionId || "<unknown>"}`,
      `- 最近完成：${input.taskId}`,
      `- 摘要：${input.result.summary}`,
      "- 状态：completed",
      "",
    ].join("\n");
    writeRelativeFile(this.workingDirectory, activePath, activeContent);
    updates.push({
      kind: "session",
      target: activePath,
      action: "updated",
    });

    const inProgressContent = readRelativeFile(this.workingDirectory, inProgressPath, DEFAULT_IN_PROGRESS_HEADER);
    const nextInProgress = removeInProgressTask(inProgressContent, input.taskId);
    if (nextInProgress !== inProgressContent) {
      writeRelativeFile(this.workingDirectory, inProgressPath, nextInProgress);
      updates.push({
        kind: "task",
        target: inProgressPath,
        action: "updated",
      });
    }

    if (input.verified) {
      const doneContent = readRelativeFile(this.workingDirectory, donePath, DEFAULT_DONE_HEADER);
      const doneEntry = `- [${input.taskId}] ${input.result.summary}`;
      const nextDone = ensureTrailingNewline(doneContent).concat(`${doneEntry}\n`);
      writeRelativeFile(this.workingDirectory, donePath, nextDone);
      updates.push({
        kind: "task",
        target: donePath,
        action: "updated",
      });
    }

    return updates;
  }

  recordTaskTerminal(input: RecordTaskTerminalInput): MemoryUpdate[] {
    const updates: MemoryUpdate[] = [];
    const activePath = "memory/sessions/active.md";
    const inProgressPath = "memory/tasks/in-progress.md";
    const sessionId = input.conversationId ?? input.request.channelContext.sessionId ?? "";
    const activeContent = [
      "# 当前会话",
      "",
      `- 会话：${sessionId || "<unknown>"}`,
      `- 最近任务：${input.taskId}`,
      `- 摘要：${input.summary}`,
      `- 状态：${input.terminalStatus}`,
      "",
    ].join("\n");
    writeRelativeFile(this.workingDirectory, activePath, activeContent);
    updates.push({
      kind: "session",
      target: activePath,
      action: "updated",
    });

    const inProgressContent = readRelativeFile(this.workingDirectory, inProgressPath, DEFAULT_IN_PROGRESS_HEADER);
    const nextInProgress = removeInProgressTask(inProgressContent, input.taskId);
    if (nextInProgress !== inProgressContent) {
      writeRelativeFile(this.workingDirectory, inProgressPath, nextInProgress);
      updates.push({
        kind: "task",
        target: inProgressPath,
        action: "updated",
      });
    }

    return updates;
  }
}

function appendInProgressTask(content: string, taskId: string, goal: string): string {
  if (content.includes(`[${taskId}]`)) {
    return content;
  }

  const line = `- [${taskId}] ${goal}`;
  return ensureTrailingNewline(content).concat(`${line}\n`);
}

function removeInProgressTask(content: string, taskId: string): string {
  const lines = content.split("\n");
  const marker = `[${taskId}]`;
  const nextLines = lines.filter((line) => !line.includes(marker));
  return `${nextLines.join("\n").replace(/\n+$/u, "\n")}`;
}

function ensureTrailingNewline(content: string): string {
  if (!content.trim()) {
    return content;
  }

  return content.endsWith("\n") ? content : `${content}\n`;
}

function readRelativeFile(root: string, relativePath: string, fallback: string): string {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return fallback;
  }
  return readFileSync(absolutePath, "utf8");
}

function writeRelativeFile(root: string, relativePath: string, content: string): void {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}
