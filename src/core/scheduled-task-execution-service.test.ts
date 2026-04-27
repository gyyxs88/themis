import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { AppServerTaskRuntime } from "./app-server-task-runtime.js";
import { ScheduledTaskExecutionService } from "./scheduled-task-execution-service.js";
import { ScheduledTasksService } from "./scheduled-tasks-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import type { TaskRequest, TaskResult } from "../types/index.js";

test("schema 32 迁移会为定时任务补 watch_work_item_id 列和索引", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-scheduled-task-schema-migration-"));
  const databaseFile = join(root, "infra/local/themis.db");

  try {
    mkdirSync(join(root, "infra/local"), { recursive: true });
    const bootstrap = new Database(databaseFile);
    bootstrap.exec(`
      CREATE TABLE themis_principals (
        principal_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        principal_kind TEXT NOT NULL DEFAULT 'human_user',
        organization_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE themis_scheduled_tasks (
        scheduled_task_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        source_channel TEXT NOT NULL,
        channel_user_id TEXT NOT NULL,
        display_name TEXT,
        session_id TEXT,
        channel_session_key TEXT,
        goal TEXT NOT NULL,
        input_text TEXT,
        options_json TEXT,
        automation_json TEXT,
        timezone TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL,
        last_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cancelled_at TEXT,
        completed_at TEXT,
        last_error TEXT
      );

      PRAGMA user_version = 32;
    `);
    bootstrap.close();

    new SqliteCodexSessionRegistry({ databaseFile });

    const verify = new Database(databaseFile, { readonly: true });
    const columns = verify.prepare(`PRAGMA table_info(themis_scheduled_tasks)`).all() as Array<{ name: string }>;
    const indexes = verify.prepare(`PRAGMA index_list(themis_scheduled_tasks)`).all() as Array<{ name: string }>;
    const userVersion = verify.pragma("user_version", { simple: true }) as number;

    assert.equal(columns.some((column) => column.name === "watch_work_item_id"), true);
    assert.equal(indexes.some((index) => index.name === "themis_scheduled_tasks_watch_idx"), true);
    assert.equal(userVersion >= 33, true);
    verify.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ScheduledTaskExecutionService 会 claim 到期任务并按 principal 执行", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-scheduled-task-execution-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
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
