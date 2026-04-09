import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "./codex-runtime.js";
import { ScheduledTaskExecutionService } from "./scheduled-task-execution-service.js";
import { ScheduledTasksService } from "./scheduled-tasks-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { AppServerTaskRuntime } from "./app-server-task-runtime.js";
import type { TaskRequest, TaskResult } from "../types/index.js";

test("ScheduledTaskExecutionService 会 claim 到期任务并按 principal 执行", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-scheduled-task-execution-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const identity = runtime.getIdentityLinkService().ensureIdentity({
    channel: "web",
    channelUserId: "browser-user-1",
    displayName: "owner",
  });
  const scheduledTasksService = new ScheduledTasksService({
    registry: runtimeStore,
  });
  const notifications: Array<{
    outcome: "completed" | "failed" | "cancelled";
    taskId: string;
    runId: string;
    summary?: string;
  }> = [];
  let capturedRequest: TaskRequest | null = null;
  let capturedContext: { principalId?: string; conversationId?: string } | null = null;
  const fakeRuntime = {
    runTaskAsPrincipal: async (
      request: TaskRequest,
      context: { principalId: string; conversationId?: string },
    ): Promise<TaskResult> => {
      capturedRequest = request;
      capturedContext = context;

      return {
        taskId: request.taskId ?? "scheduled-exec-1",
        requestId: request.requestId,
        status: "completed",
        summary: "执行完成",
        output: "{\"services\":[\"api\"]}",
        structuredOutput: {
          ok: true,
        },
        completedAt: "2026-04-08T00:02:05.000Z",
      };
    },
  } as AppServerTaskRuntime;
  const executionService = new ScheduledTaskExecutionService({
    registry: runtimeStore,
    runtime: fakeRuntime,
    onExecutionFinished: async (notification) => {
      notifications.push({
        outcome: notification.outcome.result,
        taskId: notification.task.scheduledTaskId,
        runId: notification.run.runId,
        ...(notification.run.resultSummary ? { summary: notification.run.resultSummary } : {}),
      });
    },
  });

  try {
    const created = scheduledTasksService.createTask({
      principalId: identity.principalId,
      sourceChannel: "web",
      channelUserId: "browser-user-1",
      displayName: "owner",
      sessionId: "web-session-scheduled-exec-1",
      goal: "检查 staging 健康状态",
      inputText: "列出异常服务",
      timezone: "Asia/Shanghai",
      scheduledAt: "2026-04-08T00:01:00.000Z",
      automation: {
        outputMode: "json",
        jsonSchema: {
          type: "object",
        },
      },
      now: "2026-04-08T00:00:00.000Z",
    });

    const result = await executionService.runNext({
      now: "2026-04-08T00:02:00.000Z",
    });

    assert.ok(result.claimed);
    assert.equal(result.execution?.result, "completed");
    if (!capturedContext || !capturedRequest) {
      throw new Error("Expected scheduled task execution to capture request and context.");
    }
    const context = capturedContext as { principalId: string; conversationId?: string };
    const request = capturedRequest as TaskRequest;
    assert.equal(context.principalId, identity.principalId);
    assert.equal(context.conversationId, "web-session-scheduled-exec-1");
    assert.equal(request.goal, "检查 staging 健康状态");
    assert.match(request.inputText ?? "", /Automation output contract:/);
    assert.match(request.inputText ?? "", /Return exactly one valid JSON value/);

    const storedTask = runtimeStore.getScheduledTask(created.scheduledTaskId);
    const storedRuns = runtimeStore.listScheduledTaskRunsByTask(created.scheduledTaskId);

    assert.equal(storedTask?.status, "completed");
    assert.equal(storedTask?.lastRunId, storedRuns[0]?.runId);
    assert.equal(storedRuns.length, 1);
    assert.equal(storedRuns[0]?.status, "completed");
    assert.equal(storedRuns[0]?.resultSummary, "执行完成");
    assert.deepEqual(storedRuns[0]?.structuredOutput, { ok: true });
    assert.deepEqual(notifications, [{
      outcome: "completed",
      taskId: created.scheduledTaskId,
      runId: storedRuns[0]?.runId ?? "",
      summary: "执行完成",
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
