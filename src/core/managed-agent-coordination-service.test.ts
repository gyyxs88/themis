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
  const managedAgentsService = new ManagedAgentsService({ registry, workingDirectory: root });
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

test("ManagedAgentCoordinationService 会让新派工默认继承 target agent 的执行边界", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T11:20:00.000Z",
      updatedAt: "2026-04-07T11:20:00.000Z",
    });
    registry.saveAuthAccount({
      accountId: "acct-shared",
      label: "共享账号",
      codexHome: join(root, "infra/local/codex-auth/acct-shared"),
      isActive: true,
      createdAt: "2026-04-07T11:20:10.000Z",
      updatedAt: "2026-04-07T11:20:10.000Z",
    });

    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责服务端实现。",
      now: "2026-04-07T11:21:00.000Z",
    });
    const workspacePath = join(root, "workspace/backend");
    const sharedPath = join(root, "workspace/shared");
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(sharedPath, { recursive: true });

    managedAgentsService.updateManagedAgentExecutionBoundary({
      ownerPrincipalId: "principal-owner",
      agentId: backend.agent.agentId,
      workspacePolicy: {
        workspacePath,
        additionalDirectories: [sharedPath],
        allowNetworkAccess: false,
      },
      runtimeProfile: {
        accessMode: "auth",
        authAccountId: "acct-shared",
        model: "gpt-5.4-mini",
        reasoning: "high",
        memoryMode: "confirm",
        sandboxMode: "danger-full-access",
        approvalPolicy: "on-request",
        webSearchMode: "disabled",
        networkAccessEnabled: false,
      },
      now: "2026-04-07T11:22:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      dispatchReason: "验证默认执行边界继承",
      goal: "检查新派工 snapshot 是否自动带上默认边界",
      now: "2026-04-07T11:23:00.000Z",
    });

    assert.deepEqual(dispatched.workItem.workspacePolicySnapshot, {
      policyId: backend.agent.defaultWorkspacePolicyId,
      organizationId: backend.organization.organizationId,
      ownerAgentId: backend.agent.agentId,
      displayName: "默认工作区边界",
      workspacePath,
      additionalDirectories: [sharedPath],
      allowNetworkAccess: false,
      createdAt: "2026-04-07T11:21:00.000Z",
      updatedAt: "2026-04-07T11:22:00.000Z",
    });
    assert.equal(dispatched.workItem.runtimeProfileSnapshot?.accessMode, "auth");
    assert.equal(dispatched.workItem.runtimeProfileSnapshot?.authAccountId, "acct-shared");
    assert.equal(dispatched.workItem.runtimeProfileSnapshot?.model, "gpt-5.4-mini");
    assert.equal(dispatched.workItem.runtimeProfileSnapshot?.sandboxMode, "danger-full-access");
    assert.equal(dispatched.workItem.runtimeProfileSnapshot?.approvalPolicy, "on-request");
    assert.equal(dispatched.workItem.runtimeProfileSnapshot?.webSearchMode, "disabled");
    assert.equal(dispatched.workItem.runtimeProfileSnapshot?.networkAccessEnabled, false);
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

test("ManagedAgentCoordinationService 会把 handoff 落成一等对象，并汇总到 agent 时间线", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T09:00:00.000Z",
      updatedAt: "2026-04-07T09:00:00.000Z",
    });

    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责 Web 工作台。",
      now: "2026-04-07T09:01:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      now: "2026-04-07T09:02:00.000Z",
    });

    const dispatched = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceAgentId: frontend.agent.agentId,
      dispatchReason: "前端等待新的 handoff 记录",
      goal: "补 handoff 一等对象与时间线",
      priority: "high",
      now: "2026-04-07T09:03:00.000Z",
    });

    const handoffMessage = coordinationService.sendAgentMessage({
      ownerPrincipalId: "principal-owner",
      fromAgentId: backend.agent.agentId,
      toAgentId: frontend.agent.agentId,
      workItemId: dispatched.workItem.workItemId,
      messageType: "handoff",
      payload: {
        summary: "handoff 闭环已补齐。",
        blockers: ["还差 Web 展示"],
        recommendedNextActions: ["把时间线面板接到 Agents 页"],
        attachedArtifacts: ["src/server/http-agents.ts"],
      },
      artifactRefs: ["apps/web/modules/ui.js"],
      priority: "high",
      now: "2026-04-07T09:04:00.000Z",
    });

    const handoffs = coordinationService.listHandoffs("principal-owner", {
      agentId: frontend.agent.agentId,
    });
    assert.equal(handoffs.length, 1);
    assert.equal(handoffs[0]?.sourceMessageId, handoffMessage.message.messageId);
    assert.equal(handoffs[0]?.summary, "handoff 闭环已补齐。");
    assert.deepEqual(handoffs[0]?.blockers, ["还差 Web 展示"]);
    assert.deepEqual(handoffs[0]?.recommendedNextActions, ["把时间线面板接到 Agents 页"]);
    assert.deepEqual(
      handoffs[0]?.attachedArtifacts,
      ["src/server/http-agents.ts", "apps/web/modules/ui.js"],
    );

    const timeline = coordinationService.listTimeline("principal-owner", {
      agentId: frontend.agent.agentId,
    });
    assert.equal(timeline[0]?.kind, "handoff");
    assert.equal(timeline[0]?.handoffId, handoffs[0]?.handoffId);
    assert.equal(timeline[0]?.workItemId, dispatched.workItem.workItemId);
    assert.match(timeline[0]?.summary ?? "", /还差 Web 展示/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ManagedAgentCoordinationService 会汇总父子 work item、下游状态与最近 handoff", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T10:00:00.000Z",
      updatedAt: "2026-04-07T10:00:00.000Z",
    });

    const manager = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "经理·曜",
      departmentRole: "经理",
      mission: "负责拆解任务与汇总结果。",
      now: "2026-04-07T10:01:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      now: "2026-04-07T10:02:00.000Z",
    });
    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责页面联调。",
      now: "2026-04-07T10:03:00.000Z",
    });

    const parent = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: manager.agent.agentId,
      dispatchReason: "汇总 P4 协作进展",
      goal: "把下游协作结果整理成可治理视图",
      priority: "high",
      now: "2026-04-07T10:04:00.000Z",
    });
    const completedChild = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceType: "agent",
      sourceAgentId: manager.agent.agentId,
      parentWorkItemId: parent.workItem.workItemId,
      dispatchReason: "补 parent-child 汇总接口",
      goal: "补 work item detail 的协作摘要",
      priority: "high",
      now: "2026-04-07T10:05:00.000Z",
    });
    const waitingChild = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: frontend.agent.agentId,
      sourceType: "agent",
      sourceAgentId: manager.agent.agentId,
      parentWorkItemId: parent.workItem.workItemId,
      dispatchReason: "补 manager 汇总视图",
      goal: "把 child work item 摘要挂到 Web detail 面板",
      priority: "normal",
      now: "2026-04-07T10:06:00.000Z",
    });

    registry.saveAgentWorkItem({
      ...completedChild.workItem,
      status: "completed",
      completedAt: "2026-04-07T10:30:00.000Z",
      updatedAt: "2026-04-07T10:30:00.000Z",
    });
    registry.saveAgentWorkItem({
      ...waitingChild.workItem,
      status: "waiting_agent",
      waitingActionRequest: {
        actionType: "review",
        prompt: "等待经理确认 UI 文案",
      },
      updatedAt: "2026-04-07T10:20:00.000Z",
    });

    coordinationService.createAgentHandoff({
      ownerPrincipalId: "principal-owner",
      fromAgentId: backend.agent.agentId,
      toAgentId: manager.agent.agentId,
      workItemId: completedChild.workItem.workItemId,
      summary: "detail 协作摘要接口已可用。",
      blockers: [],
      recommendedNextActions: ["接 Web detail 视图"],
      attachedArtifacts: ["src/server/http-agents.ts"],
      now: "2026-04-07T10:31:00.000Z",
    });

    const parentCollaboration = coordinationService.getWorkItemCollaboration(
      "principal-owner",
      parent.workItem.workItemId,
    );
    assert.equal(parentCollaboration.parentWorkItem, null);
    assert.equal(parentCollaboration.childSummary.totalCount, 2);
    assert.equal(parentCollaboration.childSummary.openCount, 1);
    assert.equal(parentCollaboration.childSummary.waitingCount, 1);
    assert.equal(parentCollaboration.childSummary.completedCount, 1);
    assert.equal(parentCollaboration.childSummary.failedCount, 0);
    assert.equal(parentCollaboration.childSummary.cancelledCount, 0);

    const completedChildView = parentCollaboration.childWorkItems.find((entry) =>
      entry.workItem.workItemId === completedChild.workItem.workItemId
    );
    assert.equal(completedChildView?.targetAgent?.displayName, "后端·衡");
    assert.equal(completedChildView?.latestHandoff?.summary, "detail 协作摘要接口已可用。");

    const childCollaboration = coordinationService.getWorkItemCollaboration(
      "principal-owner",
      completedChild.workItem.workItemId,
    );
    assert.equal(childCollaboration.parentWorkItem?.workItemId, parent.workItem.workItemId);
    assert.equal(childCollaboration.parentTargetAgent?.displayName, "经理·曜");
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

test("ManagedAgentCoordinationService 会汇总组织级跨父任务协作看板，并给出 attention 级别", () => {
  const { root, registry, managedAgentsService, coordinationService } = createServiceContext();

  try {
    registry.savePrincipal({
      principalId: "principal-owner",
      displayName: "老板",
      createdAt: "2026-04-07T12:00:00.000Z",
      updatedAt: "2026-04-07T12:00:00.000Z",
    });

    const managerA = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "经理·曜",
      departmentRole: "经理",
      mission: "负责拆解任务与汇总结果。",
      now: "2026-04-07T12:01:00.000Z",
    });
    const managerB = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "经理·青",
      departmentRole: "经理",
      mission: "负责另一条协作链路。",
      now: "2026-04-07T12:02:00.000Z",
    });
    const backend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "后端·衡",
      departmentRole: "后端",
      mission: "负责接口与存储。",
      now: "2026-04-07T12:03:00.000Z",
    });
    const frontend = managedAgentsService.createManagedAgent({
      ownerPrincipalId: "principal-owner",
      displayName: "前端·岚",
      departmentRole: "前端",
      mission: "负责页面联调。",
      now: "2026-04-07T12:04:00.000Z",
    });

    const urgentParent = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: managerA.agent.agentId,
      dispatchReason: "收口 P6 经理治理台",
      goal: "把下游协作摘要沉到组织级治理面",
      priority: "urgent",
      now: "2026-04-07T12:05:00.000Z",
    });
    const urgentWaitingChild = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: frontend.agent.agentId,
      sourceType: "agent",
      sourceAgentId: managerA.agent.agentId,
      parentWorkItemId: urgentParent.workItem.workItemId,
      dispatchReason: "补 Web 汇总卡片",
      goal: "补组织级跨父任务汇总台 UI",
      priority: "high",
      now: "2026-04-07T12:06:00.000Z",
    });
    const urgentCompletedChild = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceType: "agent",
      sourceAgentId: managerA.agent.agentId,
      parentWorkItemId: urgentParent.workItem.workItemId,
      dispatchReason: "补 dashboard 接口",
      goal: "补组织级跨父任务汇总 API",
      priority: "high",
      now: "2026-04-07T12:07:00.000Z",
    });
    const normalParent = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: managerB.agent.agentId,
      dispatchReason: "整理常规协作进展",
      goal: "把低风险协作保持在正常推进状态",
      priority: "normal",
      now: "2026-04-07T12:08:00.000Z",
    });
    const normalChild = coordinationService.dispatchWorkItem({
      ownerPrincipalId: "principal-owner",
      targetAgentId: backend.agent.agentId,
      sourceType: "agent",
      sourceAgentId: managerB.agent.agentId,
      parentWorkItemId: normalParent.workItem.workItemId,
      dispatchReason: "补文档同步",
      goal: "同步实现说明到文档",
      priority: "normal",
      now: "2026-04-07T12:09:00.000Z",
    });

    registry.saveAgentWorkItem({
      ...urgentWaitingChild.workItem,
      status: "waiting_human",
      waitingActionRequest: {
        actionType: "approval",
        prompt: "是否允许直接上线这版 manager dashboard？",
        choices: ["approve", "deny"],
      },
      updatedAt: "2026-04-07T12:10:00.000Z",
    });
    registry.saveAgentWorkItem({
      ...urgentCompletedChild.workItem,
      status: "completed",
      completedAt: "2026-04-07T12:11:00.000Z",
      updatedAt: "2026-04-07T12:11:00.000Z",
    });
    registry.saveAgentWorkItem({
      ...urgentParent.workItem,
      latestHumanResponse: {
        decision: "approve",
        inputText: "可以继续，把跨父任务聚合面直接接到 Agents 面板。",
        respondedAt: "2026-04-07T12:13:00.000Z",
      },
      updatedAt: "2026-04-07T12:13:00.000Z",
    });
    registry.saveAgentWorkItem({
      ...normalChild.workItem,
      status: "running",
      updatedAt: "2026-04-07T12:12:00.000Z",
    });

    coordinationService.sendAgentMessage({
      ownerPrincipalId: "principal-owner",
      fromAgentId: frontend.agent.agentId,
      toAgentId: managerA.agent.agentId,
      workItemId: urgentWaitingChild.workItem.workItemId,
      messageType: "escalation",
      payload: {
        summary: "UI 方案还有一个治理分歧，需要顶层确认。",
      },
      priority: "high",
      now: "2026-04-07T12:12:30.000Z",
    });
    coordinationService.createAgentHandoff({
      ownerPrincipalId: "principal-owner",
      fromAgentId: backend.agent.agentId,
      toAgentId: managerA.agent.agentId,
      workItemId: urgentCompletedChild.workItem.workItemId,
      summary: "跨父任务 dashboard API 已经可用。",
      blockers: [],
      recommendedNextActions: ["把 Web 卡片接上去"],
      attachedArtifacts: ["src/server/http-agents.ts"],
      now: "2026-04-07T12:12:00.000Z",
    });
    coordinationService.createAgentHandoff({
      ownerPrincipalId: "principal-owner",
      fromAgentId: backend.agent.agentId,
      toAgentId: managerB.agent.agentId,
      workItemId: normalChild.workItem.workItemId,
      summary: "文档同步正在推进，没有额外阻塞。",
      blockers: [],
      recommendedNextActions: ["继续补文档"],
      attachedArtifacts: ["docs/product/themis-p6-manager-governance-dashboard-plan.md"],
      now: "2026-04-07T12:12:10.000Z",
    });

    const dashboard = coordinationService.listOrganizationCollaborationDashboard("principal-owner", {
      now: "2026-04-07T12:30:00.000Z",
    });
    assert.equal(dashboard.summary.totalCount, 2);
    assert.equal(dashboard.summary.urgentCount, 1);
    assert.equal(dashboard.summary.attentionCount, 0);
    assert.equal(dashboard.summary.normalCount, 1);
    assert.equal(dashboard.items[0]?.parentWorkItem.workItemId, urgentParent.workItem.workItemId);
    assert.equal(dashboard.items[0]?.managerAgent.displayName, "经理·曜");
    assert.equal(dashboard.items[0]?.attentionLevel, "urgent");
    assert.match(dashboard.items[0]?.attentionReasons.join("；") ?? "", /等待顶层治理/);
    assert.equal(dashboard.items[0]?.latestWaitingMessage?.messageType, "escalation");
    assert.equal(dashboard.items[0]?.latestHandoff?.summary, "跨父任务 dashboard API 已经可用。");
    assert.equal(dashboard.items[0]?.lastActivityKind, "governance");
    assert.match(dashboard.items[0]?.lastActivitySummary ?? "", /治理结论：approve/);
    assert.equal(dashboard.items[1]?.attentionLevel, "normal");

    const filtered = coordinationService.listOrganizationCollaborationDashboard("principal-owner", {
      managerAgentId: managerA.agent.agentId,
      attentionOnly: true,
      now: "2026-04-07T12:30:00.000Z",
    });
    assert.equal(filtered.summary.totalCount, 1);
    assert.equal(filtered.items.length, 1);
    assert.equal(filtered.items[0]?.parentWorkItem.workItemId, urgentParent.workItem.workItemId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("schema 25 迁移会创建 work item、message、mailbox 与 handoff 表", () => {
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
    const handoffsTable = verify
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'themis_agent_handoffs'
      `)
      .get() as { name: string } | undefined;
    const workItemColumns = verify
      .prepare(`PRAGMA table_info(themis_agent_work_items)`)
      .all() as Array<{ name: string }>;
    const workItemColumnNames = new Set(workItemColumns.map((column) => column.name));

    assert.equal(workItemsTable?.name, "themis_agent_work_items");
    assert.equal(messagesTable?.name, "themis_agent_messages");
    assert.equal(mailboxesTable?.name, "themis_agent_mailboxes");
    assert.equal(handoffsTable?.name, "themis_agent_handoffs");
    assert.equal(workItemColumnNames.has("waiting_action_request_json"), true);
    assert.equal(workItemColumnNames.has("latest_human_response_json"), true);
  } finally {
    verify.close();
    rmSync(root, { recursive: true, force: true });
  }
});
