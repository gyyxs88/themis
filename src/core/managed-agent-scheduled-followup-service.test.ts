import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ManagedAgentWorkItemDetailView } from "./managed-agent-coordination-service.js";
import { ManagedAgentScheduledFollowupService } from "./managed-agent-scheduled-followup-service.js";
import { ScheduledTasksService } from "./scheduled-tasks-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

test("ManagedAgentScheduledFollowupService 会在 watched work item 提前完成后取消回看", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-followup-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const scheduledTasksService = new ScheduledTasksService({ registry });
  const notifications: Array<{ taskId: string; outcome: string }> = [];

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-22T08:00:00.000Z",
      updatedAt: "2026-04-22T08:00:00.000Z",
    });

    const task = scheduledTasksService.createTask({
      principalId: "principal-owner",
      sourceChannel: "feishu",
      channelUserId: "user-1",
      sessionId: "session-followup-1",
      channelSessionKey: "session-followup-1",
      goal: "16:40 回看 Cloudflare 只读派工结果",
      watch: {
        workItemId: "work-item-followup-1",
      },
      timezone: "Asia/Shanghai",
      scheduledAt: "2026-04-22T08:40:00.000Z",
      now: "2026-04-22T08:10:00.000Z",
    });

    const service = new ManagedAgentScheduledFollowupService({
      scheduledTasksService,
      controlPlaneFacade: {
        async getWorkItemDetailView(ownerPrincipalId: string, workItemId: string) {
          assert.equal(ownerPrincipalId, "principal-owner");
          assert.equal(workItemId, "work-item-followup-1");
          return buildWorkItemDetailView("principal-owner", "completed");
        },
      },
      onFollowupResolved: async (notification) => {
        notifications.push({
          taskId: notification.task.scheduledTaskId,
          outcome: notification.outcome,
        });
      },
    });

    const result = await service.scan("2026-04-22T08:15:00.000Z");
    const storedTask = registry.getScheduledTask(task.scheduledTaskId);

    assert.equal(result.scannedTasks, 1);
    assert.equal(result.cancelledTasks.length, 1);
    assert.equal(result.cancelledTasks[0]?.scheduledTaskId, task.scheduledTaskId);
    assert.equal(storedTask?.status, "cancelled");
    assert.equal(storedTask?.cancelledAt, "2026-04-22T08:15:00.000Z");
    assert.deepEqual(notifications, [{
      taskId: task.scheduledTaskId,
      outcome: "completed",
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentScheduledFollowupService 不会取消仍未收口的 watched 回看", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-followup-open-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const scheduledTasksService = new ScheduledTasksService({ registry });

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-22T09:00:00.000Z",
      updatedAt: "2026-04-22T09:00:00.000Z",
    });

    const task = scheduledTasksService.createTask({
      principalId: "principal-owner",
      sourceChannel: "feishu",
      channelUserId: "user-1",
      goal: "16:40 回看执行进展",
      watch: {
        workItemId: "work-item-followup-2",
      },
      timezone: "Asia/Shanghai",
      scheduledAt: "2026-04-22T08:40:00.000Z",
      now: "2026-04-22T08:10:00.000Z",
    });

    const service = new ManagedAgentScheduledFollowupService({
      scheduledTasksService,
      controlPlaneFacade: {
        async getWorkItemDetailView() {
          return buildWorkItemDetailView("principal-owner", "running");
        },
      },
    });

    const result = await service.scan("2026-04-22T08:15:00.000Z");
    const storedTask = registry.getScheduledTask(task.scheduledTaskId);

    assert.equal(result.scannedTasks, 1);
    assert.equal(result.cancelledTasks.length, 0);
    assert.equal(storedTask?.status, "scheduled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function buildWorkItemDetailView(
  principalId: string,
  status: ManagedAgentWorkItemDetailView["workItem"]["status"],
): ManagedAgentWorkItemDetailView {
  return {
    organization: null,
    workItem: {
      workItemId: status === "running" ? "work-item-followup-2" : "work-item-followup-1",
      organizationId: "org-1",
      targetAgentId: "agent-cloudflare-1",
      sourceType: "human",
      sourcePrincipalId: principalId,
      dispatchReason: "Cloudflare 只读核查",
      goal: "确认目标 IP 对应的 zone 和 DNS 记录",
      priority: "normal",
      status,
      createdAt: "2026-04-22T08:10:00.000Z",
      ...(status === "completed" ? { completedAt: "2026-04-22T08:14:00.000Z" } : {}),
      updatedAt: "2026-04-22T08:14:00.000Z",
    },
    targetAgent: {
      agentId: "agent-cloudflare-1",
      principalId,
      organizationId: "org-1",
      createdByPrincipalId: principalId,
      displayName: "顾潮",
      slug: "guchao",
      departmentRole: "网络运维",
      mission: "负责 Cloudflare 只读核查。",
      status: "active",
      autonomyLevel: "bounded",
      creationMode: "manual",
      exposurePolicy: "gateway_only",
      createdAt: "2026-04-22T08:00:00.000Z",
      updatedAt: "2026-04-22T08:14:00.000Z",
    },
    sourceAgent: null,
    sourcePrincipal: null,
    messages: [],
    collaboration: {
      parentWorkItem: null,
      parentTargetAgent: null,
      childSummary: {
        totalCount: 0,
        openCount: 0,
        waitingCount: 0,
        completedCount: 0,
        failedCount: 0,
        cancelledCount: 0,
      },
      childWorkItems: [],
    },
    latestCompletion: status === "completed"
      ? {
          summary: "Cloudflare 只读核查已完成，已定位到具体记录。",
          completedAt: "2026-04-22T08:14:00.000Z",
        }
      : null,
  };
}
