import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL, type TaskRequest, type TaskResult } from "../types/index.js";
import { SqliteCodexSessionRegistry } from "./codex-session-registry.js";

test("SqliteCodexSessionRegistry 会保存历史元数据，并支持 query/origin/archive 过滤", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-history-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    upsertCompletedTurn(registry, {
      sessionId: "session-standard-1",
      requestId: "request-standard-1",
      taskId: "task-standard-1",
      goal: "普通历史会话",
      createdAt: "2026-04-02T09:00:00.000Z",
      completedAt: "2026-04-02T09:00:30.000Z",
    });
    upsertCompletedTurn(registry, {
      sessionId: "session-fork-1",
      requestId: "request-fork-1",
      taskId: "task-fork-1",
      goal: "分支历史会话",
      createdAt: "2026-04-02T09:01:00.000Z",
      completedAt: "2026-04-02T09:01:30.000Z",
    });
    upsertCompletedTurn(registry, {
      sessionId: "session-archived-1",
      requestId: "request-archived-1",
      taskId: "task-archived-1",
      goal: "已归档历史会话",
      createdAt: "2026-04-02T09:02:00.000Z",
      completedAt: "2026-04-02T09:02:30.000Z",
    });

    registry.saveSessionHistoryMetadata({
      sessionId: "session-fork-1",
      originKind: "fork",
      originSessionId: "session-standard-1",
      originLabel: "fork 自 session-standard-1",
      createdAt: "2026-04-02T09:01:30.000Z",
      updatedAt: "2026-04-02T09:01:30.000Z",
    });
    registry.archiveSessionHistory("session-archived-1", "2026-04-02T09:03:00.000Z");

    const defaultList = registry.listRecentSessionsByFilter({}, 10);
    assert.deepEqual(defaultList.map((item) => item.sessionId), [
      "session-fork-1",
      "session-standard-1",
    ]);
    assert.equal(defaultList[0]?.originKind, "fork");
    assert.equal(defaultList[0]?.originSessionId, "session-standard-1");
    assert.equal(defaultList[0]?.originLabel, "fork 自 session-standard-1");

    const forkOnly = registry.listRecentSessionsByFilter({ originKind: "fork" }, 10);
    assert.deepEqual(forkOnly.map((item) => item.sessionId), ["session-fork-1"]);

    const queried = registry.listRecentSessionsByFilter({ query: "fork 自 session-standard-1" }, 10);
    assert.deepEqual(queried.map((item) => item.sessionId), ["session-fork-1"]);

    const archived = registry.listRecentSessionsByFilter({ includeArchived: true, query: "已归档历史会话" }, 10);
    assert.deepEqual(archived.map((item) => item.sessionId), ["session-archived-1"]);
    assert.equal(archived[0]?.archivedAt, "2026-04-02T09:03:00.000Z");

    const forkSummary = registry.getSessionHistorySummary("session-fork-1");
    assert.equal(forkSummary?.originKind, "fork");
    assert.equal(forkSummary?.originSessionId, "session-standard-1");
    assert.equal(forkSummary?.originLabel, "fork 自 session-standard-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SqliteCodexSessionRegistry 会把 archive / unarchive 持久化到历史元数据", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-history-archive-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    upsertCompletedTurn(registry, {
      sessionId: "session-toggle-1",
      requestId: "request-toggle-1",
      taskId: "task-toggle-1",
      goal: "归档切换测试",
      createdAt: "2026-04-02T10:00:00.000Z",
      completedAt: "2026-04-02T10:00:30.000Z",
    });

    assert.equal(registry.archiveSessionHistory("session-toggle-1", "2026-04-02T10:01:00.000Z"), true);
    assert.equal(registry.getSessionHistorySummary("session-toggle-1")?.archivedAt, "2026-04-02T10:01:00.000Z");
    assert.deepEqual(registry.listRecentSessionsByFilter({}, 10), []);

    assert.equal(registry.unarchiveSessionHistory("session-toggle-1", "2026-04-02T10:02:00.000Z"), true);
    assert.equal(registry.getSessionHistorySummary("session-toggle-1")?.archivedAt ?? null, null);
    assert.deepEqual(registry.listRecentSessionsByFilter({}, 10).map((item) => item.sessionId), ["session-toggle-1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SqliteCodexSessionRegistry 默认不会把 agent-internal 会话暴露到 history 列表", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-history-internal-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    upsertCompletedTurn(registry, {
      sessionId: "session-human-1",
      requestId: "request-human-1",
      taskId: "task-human-1",
      goal: "普通对外会话",
      createdAt: "2026-04-06T11:20:00.000Z",
      completedAt: "2026-04-06T11:20:30.000Z",
    });
    upsertCompletedTurn(registry, {
      sessionId: "agent-work-item:work-item-1",
      requestId: "request-agent-1",
      taskId: "task-agent-1",
      goal: "内部 agent 会话",
      sourceChannel: MANAGED_AGENT_INTERNAL_SOURCE_CHANNEL,
      userId: "principal-agent-1",
      userDisplayName: "后端·衡",
      createdAt: "2026-04-06T11:21:00.000Z",
      completedAt: "2026-04-06T11:21:30.000Z",
    });

    assert.deepEqual(registry.listRecentSessionsByFilter({}, 10).map((item) => item.sessionId), ["session-human-1"]);
    assert.equal(registry.getSessionHistorySummary("agent-work-item:work-item-1")?.sessionId, "agent-work-item:work-item-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SqliteCodexSessionRegistry 不会让终态 turn 被晚到 progress 写回 running", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-registry-history-late-progress-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    const request: TaskRequest = {
      requestId: "request-late-progress-1",
      taskId: "task-late-progress-1",
      sourceChannel: "feishu",
      user: {
        userId: "user-late-progress",
        displayName: "Late Progress",
      },
      goal: "超时后又收到晚到 progress",
      channelContext: {
        sessionId: "session-late-progress-1",
      },
      createdAt: "2026-04-20T12:24:27.614Z",
    };

    registry.upsertTurnFromRequest(request, request.taskId ?? "task-late-progress-1");
    registry.completeTaskTurn({
      request,
      result: {
        requestId: request.requestId,
        taskId: request.taskId ?? "task-late-progress-1",
        status: "cancelled",
        summary: "任务因超时被取消，超时时间约为 300 秒。",
        completedAt: "2026-04-20T12:29:22.329Z",
      },
    });
    registry.appendTaskEvent({
      eventId: "event-late-progress-1",
      requestId: request.requestId,
      taskId: request.taskId ?? "task-late-progress-1",
      type: "task.progress",
      status: "running",
      message: "老板，这台也查清了。",
      payload: {
        itemType: "agent_message",
        threadEventType: "item.completed",
        itemId: "item-late-progress-1",
      },
      timestamp: "2026-04-20T12:28:22.174Z",
    });

    const turn = registry.getTurn(request.requestId);
    assert.equal(turn?.status, "cancelled");
    assert.equal(turn?.updatedAt, "2026-04-20T12:29:22.329Z");
    assert.equal(turn?.summary, "任务因超时被取消，超时时间约为 300 秒。");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function upsertCompletedTurn(
  registry: SqliteCodexSessionRegistry,
  input: {
    sessionId: string;
    requestId: string;
    taskId: string;
    goal: string;
    sourceChannel?: string;
    userId?: string;
    userDisplayName?: string;
    createdAt: string;
    completedAt: string;
  },
): void {
  const request: TaskRequest = {
    requestId: input.requestId,
    taskId: input.taskId,
    sourceChannel: input.sourceChannel ?? "web",
    user: {
      userId: input.userId ?? "user-history-registry",
      displayName: input.userDisplayName ?? "History Registry",
    },
    goal: input.goal,
    channelContext: {
      sessionId: input.sessionId,
    },
    createdAt: input.createdAt,
  };
  const result: TaskResult = {
    requestId: input.requestId,
    taskId: input.taskId,
    status: "completed",
    summary: `${input.goal} 已完成`,
    completedAt: input.completedAt,
  };

  registry.upsertTurnFromRequest(request, input.taskId);
  registry.completeTaskTurn({
    request,
    result,
  });
}
