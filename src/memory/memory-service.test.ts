import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryService } from "./memory-service.js";
import type { TaskRequest, TaskResult } from "../types/index.js";

function createRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    requestId: "req-memory-1",
    taskId: "task-memory-1",
    sourceChannel: "web",
    user: {
      userId: "user-1",
      displayName: "User",
    },
    goal: "实现 memory service",
    channelContext: {
      sessionId: "session-memory-1",
    },
    createdAt: "2026-03-28T12:00:00.000Z",
    ...overrides,
  };
}

function createResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId: "task-memory-1",
    requestId: "req-memory-1",
    status: "completed",
    summary: "完成 memory service",
    completedAt: "2026-03-28T12:30:00.000Z",
    ...overrides,
  };
}

test("recordTaskStart 会更新 active 并把任务挂到 in-progress（不重复）", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-memory-service-start-"));

  try {
    mkdirSync(join(root, "memory", "tasks"), { recursive: true });
    writeFileSync(join(root, "memory", "tasks", "in-progress.md"), "# 进行中\n\n## 当前工作\n\n", "utf8");
    const service = new MemoryService({ workingDirectory: root });
    const request = createRequest();

    const firstUpdates = service.recordTaskStart({
      request,
      taskId: request.taskId ?? "task-memory-1",
      principalId: "principal-1",
      conversationId: "session-memory-1",
    });
    const secondUpdates = service.recordTaskStart({
      request,
      taskId: request.taskId ?? "task-memory-1",
      principalId: "principal-1",
      conversationId: "session-memory-1",
    });

    const activeContent = readFileSync(join(root, "memory", "sessions", "active.md"), "utf8");
    const inProgressContent = readFileSync(join(root, "memory", "tasks", "in-progress.md"), "utf8");
    assert.ok(firstUpdates.length >= 1);
    assert.ok(secondUpdates.length >= 1);
    assert.match(activeContent, /当前任务：task-memory-1/);
    assert.equal((inProgressContent.match(/task-memory-1/g) ?? []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordTaskCompletion 会更新 active、迁移 in-progress，并在 verified=true 时写入 done", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-memory-service-completion-"));

  try {
    mkdirSync(join(root, "memory", "tasks"), { recursive: true });
    writeFileSync(
      join(root, "memory", "tasks", "in-progress.md"),
      "# 进行中\n\n## 当前工作\n\n- [task-memory-1] 实现 memory service\n",
      "utf8",
    );
    writeFileSync(join(root, "memory", "tasks", "done.md"), "# 已完成\n\n## 当前已完成模块\n\n", "utf8");
    const service = new MemoryService({ workingDirectory: root });
    const request = createRequest();
    const result = createResult();

    const updates = service.recordTaskCompletion({
      request,
      result,
      taskId: request.taskId ?? "task-memory-1",
      principalId: "principal-1",
      conversationId: "session-memory-1",
      verified: true,
    });

    const activeContent = readFileSync(join(root, "memory", "sessions", "active.md"), "utf8");
    const inProgressContent = readFileSync(join(root, "memory", "tasks", "in-progress.md"), "utf8");
    const doneContent = readFileSync(join(root, "memory", "tasks", "done.md"), "utf8");
    assert.ok(updates.length >= 1);
    assert.match(activeContent, /最近完成：task-memory-1/);
    assert.doesNotMatch(inProgressContent, /task-memory-1/);
    assert.match(doneContent, /task-memory-1/);
    assert.match(doneContent, /完成 memory service/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
