import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { ManagedAgentCoordinationService } from "./managed-agent-coordination-service.js";
import { ManagedAgentsService } from "./managed-agents-service.js";

function createServiceContext() {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-coordination-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  const managedAgentsService = new ManagedAgentsService({ registry });
  const coordinationService = new ManagedAgentCoordinationService({ registry });

  return { root, databaseFile, registry, managedAgentsService, coordinationService };
}

test("ManagedAgentCoordinationService 支持人类派工，并把 work item 落到 owner 可见范围内", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T07:20:00.000Z",
      updatedAt: "2026-04-06T07:20:00.000Z",
    });

    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·澄",
      departmentRole: "后端",
      mission: "负责后端接口与数据模型。",
      now: "2026-04-06T07:21:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      dispatchReason: "补齐 agent 管理接口",
      goal: "完成 work item 与 message 的最小落库骨架",
      contextPacket: { source: "todoist", scope: "phase-a" },
      priority: "high",
      now: "2026-04-06T07:22:00.000Z",
    });

    assert.equal(dispatched.organization.organizationId, backend.organization.organizationId);
    assert.equal(dispatched.workItem.targetAgentId, backend.agent.agentId);
    assert.equal(dispatched.workItem.sourceType, "human");
    assert.equal(dispatched.workItem.status, "queued");
    assert.equal(dispatched.dispatchMessage, undefined);

    const listed = coordinationService.listWorkItems("principal-owner");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.workItemId, dispatched.workItem.workItemId);

    const detail = coordinationService.getWorkItem("principal-owner", dispatched.workItem.workItemId);
    assert.equal(detail?.priority, "high");
    assert.deepEqual(detail?.contextPacket, { source: "todoist", scope: "phase-a" });
    assert.deepEqual(
      coordinationService.listMessagesForWorkItem("principal-owner", dispatched.workItem.workItemId),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentCoordinationService 支持 agent 派工、结构化消息与 mailbox ack", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T07:30:00.000Z",
      updatedAt: "2026-04-06T07:30:00.000Z",
    });

    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·澄",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      now: "2026-04-06T07:31:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·砺",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      now: "2026-04-06T07:32:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceAgentId: frontend.agent.agentId,
      dispatchReason: "前端需要新的详情接口",
      goal: "补 work item detail 与 mailbox 拉取骨架",
      contextPacket: { ticket: "AG-2" },
      priority: "urgent",
      now: "2026-04-06T07:33:00.000Z",
    });

    assert.equal(dispatched.workItem.sourceType, "agent");
    assert.equal(dispatched.dispatchMessage?.messageType, "dispatch");
    assert.equal(dispatched.dispatchMessage?.fromAgentId, frontend.agent.agentId);
    assert.equal(dispatched.mailboxEntry?.ownerAgentId, backend.agent.agentId);

    const replied = coordinationService.sendAgentMessage({
      ownerPrincipalId: "principal-owner",
      fromAgentId: backend.agent.agentId,
      toAgentId: frontend.agent.agentId,
      workItemId: dispatched.workItem.workItemId,
      messageType: "question",
      payload: {
        question: "接口里是否要把 organization 一起返回？",
      },
      artifactRefs: ["docs/product/themis-persistent-agent-architecture.md"],
      priority: "high",
      requiresAck: true,
      now: "2026-04-06T07:34:00.000Z",
    });

    assert.equal(replied.message.messageType, "question");
    assert.equal(replied.mailboxEntry.status, "pending");

    const backendMailbox = coordinationService.listMailbox("principal-owner", backend.agent.agentId);
    assert.equal(backendMailbox.length, 1);
    assert.equal(backendMailbox[0]?.message.messageType, "dispatch");

    const frontendMailbox = coordinationService.listMailbox("principal-owner", frontend.agent.agentId);
    assert.equal(frontendMailbox.length, 1);
    assert.equal(frontendMailbox[0]?.message.messageType, "question");

    const acked = coordinationService.ackMailboxEntry(
      "principal-owner",
      frontend.agent.agentId,
      replied.mailboxEntry.mailboxEntryId,
      "2026-04-06T07:35:00.000Z",
    );
    assert.equal(acked.status, "acked");
    assert.equal(acked.ackedAt, "2026-04-06T07:35:00.000Z");

    const messages = coordinationService.listMessagesForWorkItem("principal-owner", dispatched.workItem.workItemId);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.messageType, "dispatch");
    assert.equal(messages[1]?.messageType, "question");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentCoordinationService 支持 mailbox pull / respond，并在 waiting_agent 时重新排队 work item", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T07:40:00.000Z",
      updatedAt: "2026-04-06T07:40:00.000Z",
    });

    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      now: "2026-04-06T07:41:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      now: "2026-04-06T07:42:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceAgentId: frontend.agent.agentId,
      dispatchReason: "前端等待后端确认发布步骤",
      goal: "确认是否可以执行推送",
      priority: "urgent",
      now: "2026-04-06T07:43:00.000Z",
    });
    registry.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "waiting_agent",
      updatedAt: "2026-04-06T07:44:00.000Z",
    });
    registry.saveAgentRun({
      runId: "run-waiting-1",
      organizationId: dispatched.workItem.organizationId,
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: backend.agent.agentId,
      schedulerId: "scheduler-test",
      leaseToken: "lease-waiting-1",
      leaseExpiresAt: "2026-04-06T07:50:00.000Z",
      status: "waiting_action",
      startedAt: "2026-04-06T07:44:00.000Z",
      lastHeartbeatAt: "2026-04-06T07:44:00.000Z",
      createdAt: "2026-04-06T07:44:00.000Z",
      updatedAt: "2026-04-06T07:44:00.000Z",
    });

    const approvalRequest = coordinationService.sendAgentMessage({
      ownerPrincipalId: "principal-owner",
      fromAgentId: backend.agent.agentId,
      toAgentId: frontend.agent.agentId,
      workItemId: dispatched.workItem.workItemId,
      runId: "run-waiting-1",
      messageType: "approval_request",
      payload: {
        prompt: "是否允许执行 git push origin main",
      },
      priority: "urgent",
      requiresAck: true,
      now: "2026-04-06T07:44:30.000Z",
    });

    const pulled = coordinationService.pullMailboxEntry(
      "principal-owner",
      frontend.agent.agentId,
      "2026-04-06T07:45:00.000Z",
    );
    assert.equal(pulled.item?.entry.mailboxEntryId, approvalRequest.mailboxEntry.mailboxEntryId);
    assert.equal(pulled.item?.entry.status, "leased");

    const replied = coordinationService.respondToMailboxEntry({
      ownerPrincipalId: "principal-owner",
      agentId: frontend.agent.agentId,
      mailboxEntryId: approvalRequest.mailboxEntry.mailboxEntryId,
      decision: "approve",
      inputText: "可以继续，记得同步 release note。",
      now: "2026-04-06T07:46:00.000Z",
    });

    assert.equal(replied.sourceMailboxEntry.status, "acked");
    assert.equal(replied.responseMessage.messageType, "approval_result");
    assert.equal((replied.responseMessage.payload as { decision?: string }).decision, "approve");
    assert.equal(replied.responseMailboxEntry.ownerAgentId, backend.agent.agentId);
    assert.equal(replied.responseMailboxEntry.status, "acked");
    assert.equal(replied.resumedWorkItem?.status, "queued");
    assert.equal(replied.resumedRuns.length, 1);
    assert.equal(replied.resumedRuns[0]?.status, "interrupted");
    assert.equal(replied.resumedRuns[0]?.failureCode, "WAITING_RESUME_TRIGGERED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentCoordinationService 支持对 waiting_human work item 提交治理回复并重新排队", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T08:10:00.000Z",
      updatedAt: "2026-04-06T08:10:00.000Z",
    });

    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·衡",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      now: "2026-04-06T08:11:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      dispatchReason: "需要你确认发布是否继续",
      goal: "等待人工审批发布动作",
      priority: "urgent",
      now: "2026-04-06T08:12:00.000Z",
    });
    registry.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "waiting_human",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许执行 git push origin main",
        choices: ["approve", "deny"],
      },
      updatedAt: "2026-04-06T08:13:00.000Z",
    });
    registry.saveAgentRun({
      runId: "run-human-waiting-1",
      organizationId: dispatched.workItem.organizationId,
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: ops.agent.agentId,
      schedulerId: "scheduler-test",
      leaseToken: "lease-human-waiting-1",
      leaseExpiresAt: "2026-04-06T08:20:00.000Z",
      status: "waiting_action",
      startedAt: "2026-04-06T08:13:00.000Z",
      lastHeartbeatAt: "2026-04-06T08:13:00.000Z",
      createdAt: "2026-04-06T08:13:00.000Z",
      updatedAt: "2026-04-06T08:13:00.000Z",
    });

    const responded = coordinationService.respondToHumanWaitingWorkItem({
      ownerPrincipalId: "principal-owner",
      workItemId: dispatched.workItem.workItemId,
      decision: "approve",
      inputText: "可以继续，但先确认 release note。",
      now: "2026-04-06T08:14:00.000Z",
    });

    assert.equal(responded.workItem.status, "queued");
    assert.equal(
      (responded.workItem.latestHumanResponse as { decision?: string } | undefined)?.decision,
      "approve",
    );
    assert.equal(responded.resumedRuns.length, 1);
    assert.equal(responded.resumedRuns[0]?.status, "interrupted");
    assert.equal(responded.resumedRuns[0]?.failureCode, "WAITING_RESUME_TRIGGERED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentCoordinationService 支持把 waiting_agent 升级到顶层治理，并关闭待回复 mailbox", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T08:15:00.000Z",
      updatedAt: "2026-04-06T08:15:00.000Z",
    });

    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      now: "2026-04-06T08:16:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      now: "2026-04-06T08:17:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceAgentId: frontend.agent.agentId,
      dispatchReason: "前端等待后端确认发布步骤",
      goal: "确认是否可以执行推送",
      priority: "urgent",
      now: "2026-04-06T08:18:00.000Z",
    });
    registry.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "waiting_agent",
      waitingActionRequest: {
        waitingFor: "agent",
        actionType: "approval",
        prompt: "是否允许执行 git push origin main",
        choices: ["approve", "deny"],
      },
      updatedAt: "2026-04-06T08:19:00.000Z",
    });
    const approvalRequest = coordinationService.sendAgentMessage({
      ownerPrincipalId: "principal-owner",
      fromAgentId: backend.agent.agentId,
      toAgentId: frontend.agent.agentId,
      workItemId: dispatched.workItem.workItemId,
      runId: "run-waiting-escalate-1",
      messageType: "approval_request",
      payload: {
        prompt: "是否允许执行 git push origin main",
        choices: ["approve", "deny"],
      },
      priority: "urgent",
      requiresAck: true,
      now: "2026-04-06T08:19:30.000Z",
    });

    const escalated = coordinationService.escalateWaitingAgentWorkItemToHuman({
      ownerPrincipalId: "principal-owner",
      workItemId: dispatched.workItem.workItemId,
      inputText: "上游 agent 长时间未答复，转由顶层治理。",
      now: "2026-04-06T08:20:00.000Z",
    });

    assert.equal(escalated.workItem.status, "waiting_human");
    assert.equal(
      (escalated.workItem.waitingActionRequest as { waitingFor?: string } | undefined)?.waitingFor,
      "human",
    );
    assert.equal(
      (escalated.workItem.waitingActionRequest as { sourceType?: string } | undefined)?.sourceType,
      "agent_escalation",
    );
    assert.equal(
      (escalated.workItem.waitingActionRequest as { escalationInputText?: string } | undefined)?.escalationInputText,
      "上游 agent 长时间未答复，转由顶层治理。",
    );
    assert.equal(escalated.latestWaitingMessage?.messageId, approvalRequest.message.messageId);
    assert.equal(escalated.ackedMailboxEntries.length, 1);
    assert.equal(escalated.ackedMailboxEntries[0]?.mailboxEntryId, approvalRequest.mailboxEntry.mailboxEntryId);
    assert.equal(escalated.ackedMailboxEntries[0]?.status, "acked");
    assert.equal(
      registry.getAgentMailboxEntry(approvalRequest.mailboxEntry.mailboxEntryId)?.status,
      "acked",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentCoordinationService 支持取消安全可收口的 work item，并关闭旧 mailbox 后通知上游 agent", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T02:00:00.000Z",
      updatedAt: "2026-04-07T02:00:00.000Z",
    });

    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      now: "2026-04-07T02:01:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      now: "2026-04-07T02:02:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceAgentId: frontend.agent.agentId,
      dispatchReason: "后端任务已不再需要继续",
      goal: "原定接口方案作废，准备取消这条 work item",
      priority: "high",
      now: "2026-04-07T02:03:00.000Z",
    });

    const cancelled = coordinationService.cancelWorkItem({
      ownerPrincipalId: "principal-owner",
      workItemId: dispatched.workItem.workItemId,
      reason: "方案切换，改由顶层直接处理。",
      now: "2026-04-07T02:04:00.000Z",
    });

    assert.equal(cancelled.workItem.status, "cancelled");
    assert.equal(cancelled.workItem.completedAt, "2026-04-07T02:04:00.000Z");
    assert.equal(cancelled.ackedMailboxEntries.length, 1);
    assert.equal(cancelled.ackedMailboxEntries[0]?.mailboxEntryId, dispatched.mailboxEntry?.mailboxEntryId);
    assert.equal(cancelled.ackedMailboxEntries[0]?.status, "acked");
    assert.equal(cancelled.notificationMessage?.messageType, "cancel");
    assert.equal(cancelled.notificationMessage?.fromAgentId, backend.agent.agentId);
    assert.equal(cancelled.notificationMessage?.toAgentId, frontend.agent.agentId);
    assert.equal(cancelled.notificationMailboxEntry?.ownerAgentId, frontend.agent.agentId);
    assert.equal(cancelled.notificationMailboxEntry?.status, "pending");
    assert.equal(
      registry.getAgentMailboxEntry(dispatched.mailboxEntry?.mailboxEntryId ?? "")?.status,
      "acked",
    );

    const messages = coordinationService.listMessagesForWorkItem("principal-owner", dispatched.workItem.workItemId);
    assert.deepEqual(
      messages.map((message) => message.messageType),
      ["dispatch", "cancel"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentCoordinationService 目前会拒绝取消仍有 active run 的 work item", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T02:10:00.000Z",
      updatedAt: "2026-04-07T02:10:00.000Z",
    });

    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      now: "2026-04-07T02:11:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      dispatchReason: "仍在执行中的任务",
      goal: "这条 work item 暂时还不能被安全取消",
      priority: "urgent",
      now: "2026-04-07T02:12:00.000Z",
    });

    registry.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "running",
      startedAt: "2026-04-07T02:13:00.000Z",
      updatedAt: "2026-04-07T02:13:00.000Z",
    });
    registry.saveAgentRun({
      runId: "run-active-cancel-blocked-1",
      organizationId: dispatched.workItem.organizationId,
      workItemId: dispatched.workItem.workItemId,
      targetAgentId: ops.agent.agentId,
      schedulerId: "scheduler-test",
      leaseToken: "lease-active-cancel-blocked-1",
      leaseExpiresAt: "2026-04-07T02:20:00.000Z",
      status: "running",
      startedAt: "2026-04-07T02:13:00.000Z",
      lastHeartbeatAt: "2026-04-07T02:13:30.000Z",
      createdAt: "2026-04-07T02:13:00.000Z",
      updatedAt: "2026-04-07T02:13:30.000Z",
    });

    assert.throws(() => coordinationService.cancelWorkItem({
      ownerPrincipalId: "principal-owner",
      workItemId: dispatched.workItem.workItemId,
      now: "2026-04-07T02:14:00.000Z",
    }), {
      message: "Work item has active runs and cannot be cancelled yet.",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentCoordinationService 会汇总组织级等待队列与升级摘要", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-06T08:20:00.000Z",
      updatedAt: "2026-04-06T08:20:00.000Z",
    });

    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·衡",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      now: "2026-04-06T08:21:00.000Z",
    });
    const ops = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "运维·曜",
      departmentRole: "运维",
      mission: "负责发布和值班。",
      now: "2026-04-06T08:22:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: ops.agent.agentId,
      sourceType: "agent",
      sourceAgentId: frontend.agent.agentId,
      sourcePrincipalId: frontend.principal.principalId,
      dispatchReason: "等待发布审批",
      goal: "确认是否允许继续部署",
      priority: "urgent",
      now: "2026-04-06T08:23:00.000Z",
    });
    registry.saveAgentWorkItem({
      ...dispatched.workItem,
      status: "waiting_agent",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许执行 deploy production",
      },
      updatedAt: "2026-04-06T08:24:00.000Z",
    });
    coordinationService.sendAgentMessage({
      ownerPrincipalId: "principal-owner",
      fromAgentId: ops.agent.agentId,
      toAgentId: frontend.agent.agentId,
      workItemId: dispatched.workItem.workItemId,
      messageType: "approval_request",
      payload: {
        prompt: "是否允许执行 deploy production",
      },
      priority: "urgent",
      requiresAck: true,
      now: "2026-04-06T08:24:30.000Z",
    });

    const queue = coordinationService.listOrganizationWaitingQueue("principal-owner");
    assert.equal(queue.summary.totalCount, 1);
    assert.equal(queue.summary.waitingAgentCount, 1);
    assert.equal(queue.summary.waitingHumanCount, 0);
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0]?.targetAgent.agentId, ops.agent.agentId);
    assert.equal(queue.items[0]?.sourceAgent?.agentId, frontend.agent.agentId);
    assert.equal(queue.items[0]?.latestWaitingMessage?.messageType, "approval_request");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("schema 20 迁移会创建 work item、message 与 mailbox 表", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-managed-agent-coordination-schema-"));
  const databaseFile = join(root, "infra/local/themis.db");
  mkdirSync(join(root, "infra/local"), { recursive: true });
  const bootstrap = new Database(databaseFile);

  try {
    bootstrap.exec(`
      PRAGMA user_version = 17;

      CREATE TABLE themis_principals (
        principal_id TEXT PRIMARY KEY,
        display_name TEXT,
        principal_kind TEXT NOT NULL DEFAULT 'human_user',
        organization_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } finally {
    bootstrap.close();
  }

  const registry = new SqliteCodexSessionRegistry({ databaseFile });
  void registry;

  const verify = new Database(databaseFile, { readonly: true });

  try {
    const workItemsTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_work_items'
      `)
      .get() as { name: string } | undefined;
    const messagesTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_messages'
      `)
      .get() as { name: string } | undefined;
    const mailboxesTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_mailboxes'
      `)
      .get() as { name: string } | undefined;
    const workItemColumns = verify
      .prepare(`PRAGMA table_info(themis_agent_work_items)`)
      .all() as Array<{ name: string }>;
    const workItemColumnNames = new Set(workItemColumns.map((column) => column.name));

    assert.equal(workItemsTable?.name, "themis_agent_work_items");
    assert.equal(messagesTable?.name, "themis_agent_messages");
    assert.equal(mailboxesTable?.name, "themis_agent_mailboxes");
    assert.equal(workItemColumnNames.has("waiting_action_request_json"), true);
    assert.equal(workItemColumnNames.has("latest_human_response_json"), true);
  } finally {
    verify.close();
    rmSync(root, { recursive: true, force: true });
  }
});
