import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { MySqlManagedAgentControlPlaneStore } from "./mysql-managed-agent-control-plane-store.js";

function isDockerAvailable(): boolean {
  const result = spawnSync("docker", ["version"], { stdio: "ignore" });
  return result.status === 0;
}

function runDocker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function parseDockerPort(output: string): number {
  const matched = output.match(/:(\d+)\s*$/);

  if (!matched) {
    throw new Error(`无法解析 docker port 输出：${output}`);
  }

  return Number.parseInt(matched[1] ?? "", 10);
}

async function waitForMySql(store: MySqlManagedAgentControlPlaneStore): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < 60_000) {
    try {
      await store.ping();
      return;
    } catch (error) {
      lastError = error;
      await delay(1_000);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("等待 MySQL 就绪超时。");
}

test("MySqlManagedAgentControlPlaneStore 会 round-trip 项目绑定、协作事实与 claim 语义", {
  timeout: 120_000,
}, async (t) => {
  if (!isDockerAvailable()) {
    t.skip("当前环境不可用 docker，跳过 MySQL 集成测试。");
    return;
  }

  const containerName = `themis-mysql-store-${randomUUID().slice(0, 8)}`;
  runDocker([
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-e",
    "MYSQL_ROOT_PASSWORD=root",
    "-e",
    "MYSQL_DATABASE=themis_test",
    "-p",
    "127.0.0.1::3306",
    "mysql:8.4",
  ]);
  t.after(() => {
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  });

  const port = parseDockerPort(runDocker(["port", containerName, "3306/tcp"]));
  const store = new MySqlManagedAgentControlPlaneStore({
    host: "127.0.0.1",
    port,
    user: "root",
    password: "root",
    database: "themis_test",
  });
  t.after(async () => {
    await store.close();
  });

  await waitForMySql(store);
  await store.ensureSchema();

  const now = "2026-04-13T12:00:00.000Z";
  const later = "2026-04-13T12:30:00.000Z";
  const stale = "2026-04-13T11:00:00.000Z";

  await store.savePrincipal({
    principalId: "principal-owner",
    displayName: "Owner",
    kind: "human_user",
    createdAt: now,
    updatedAt: now,
  });
  await store.saveOrganization({
    organizationId: "org-1",
    ownerPrincipalId: "principal-owner",
    displayName: "Themis Org",
    slug: "themis-org",
    createdAt: now,
    updatedAt: now,
  });
  await store.savePrincipal({
    principalId: "principal-agent-1",
    displayName: "前端员工",
    kind: "managed_agent",
    organizationId: "org-1",
    createdAt: now,
    updatedAt: now,
  });
  await store.savePrincipal({
    principalId: "principal-agent-2",
    displayName: "后端员工",
    kind: "managed_agent",
    organizationId: "org-1",
    createdAt: now,
    updatedAt: now,
  });
  await store.saveManagedAgent({
    agentId: "agent-1",
    principalId: "principal-agent-1",
    organizationId: "org-1",
    createdByPrincipalId: "principal-owner",
    displayName: "前端员工",
    slug: "frontend-agent",
    departmentRole: "frontend",
    mission: "负责网站前端开发。",
    status: "active",
    autonomyLevel: "bounded",
    creationMode: "manual",
    exposurePolicy: "gateway_only",
    createdAt: now,
    updatedAt: now,
  });
  await store.saveManagedAgent({
    agentId: "agent-2",
    principalId: "principal-agent-2",
    organizationId: "org-1",
    createdByPrincipalId: "principal-owner",
    displayName: "后端员工",
    slug: "backend-agent",
    departmentRole: "backend",
    mission: "负责网站后端开发。",
    status: "active",
    autonomyLevel: "bounded",
    creationMode: "manual",
    exposurePolicy: "gateway_only",
    createdAt: now,
    updatedAt: now,
  });
  await store.saveAgentWorkspacePolicy({
    policyId: "workspace-1",
    organizationId: "org-1",
    ownerAgentId: "agent-1",
    displayName: "官网工作区",
    workspacePath: "/srv/site-a",
    additionalDirectories: ["/srv/site-a/docs"],
    allowNetworkAccess: true,
    createdAt: now,
    updatedAt: now,
  });
  await store.saveAgentRuntimeProfile({
    profileId: "runtime-1",
    organizationId: "org-1",
    ownerAgentId: "agent-1",
    displayName: "默认模型",
    model: "gpt-5.4",
    approvalPolicy: "never",
    accessMode: "auth",
    createdAt: now,
    updatedAt: now,
  });
  await store.saveProjectWorkspaceBinding({
    projectId: "project-site-a",
    organizationId: "org-1",
    displayName: "官网项目",
    owningAgentId: "agent-1",
    workspacePolicyId: "workspace-1",
    canonicalWorkspacePath: "/srv/site-a",
    preferredNodeId: "node-a",
    lastActiveNodeId: "node-a",
    lastActiveWorkspacePath: "/srv/site-a",
    continuityMode: "sticky",
    createdAt: now,
    updatedAt: later,
  });
  await store.saveAgentSpawnPolicy({
    organizationId: "org-1",
    maxActiveAgents: 8,
    maxActiveAgentsPerRole: 3,
    createdAt: now,
    updatedAt: now,
  });
  await store.saveAgentSpawnSuggestionState({
    suggestionId: "spawn-1",
    organizationId: "org-1",
    state: "ignored",
    payload: { reason: "已有足够人手" },
    createdAt: now,
    updatedAt: now,
  });
  await store.saveManagedAgentNode({
    nodeId: "node-a",
    organizationId: "org-1",
    displayName: "A 服务器",
    status: "online",
    slotCapacity: 2,
    slotAvailable: 1,
    labels: ["lan", "primary"],
    workspaceCapabilities: ["/srv/site-a"],
    credentialCapabilities: ["credential-1"],
    providerCapabilities: ["openai"],
    heartbeatTtlSeconds: 60,
    lastHeartbeatAt: later,
    createdAt: now,
    updatedAt: later,
  });
  await store.saveAgentWorkItem({
    workItemId: "work-item-parent",
    organizationId: "org-1",
    targetAgentId: "agent-1",
    projectId: "project-site-a",
    sourceType: "human",
    sourcePrincipalId: "principal-owner",
    dispatchReason: "继续开发官网",
    goal: "继续完善官网首页。",
    priority: "high",
    status: "waiting_human",
    workspacePolicySnapshot: {
      policyId: "workspace-1",
      displayName: "官网工作区",
      workspacePath: "/srv/site-a",
    },
    runtimeProfileSnapshot: {
      profileId: "runtime-1",
      displayName: "默认模型",
      model: "gpt-5.4",
    },
    createdAt: now,
    startedAt: now,
    updatedAt: later,
  });
  await store.saveAgentWorkItem({
    workItemId: "work-item-child",
    organizationId: "org-1",
    targetAgentId: "agent-2",
    projectId: "project-site-a",
    sourceType: "agent",
    sourcePrincipalId: "principal-owner",
    sourceAgentId: "agent-1",
    parentWorkItemId: "work-item-parent",
    dispatchReason: "拆给后端员工",
    goal: "实现官网接口。",
    priority: "normal",
    status: "queued",
    createdAt: now,
    updatedAt: later,
  });
  await store.saveAgentRun({
    runId: "run-stale-1",
    organizationId: "org-1",
    workItemId: "work-item-parent",
    targetAgentId: "agent-1",
    schedulerId: "scheduler-a",
    leaseToken: "lease-stale-1",
    leaseExpiresAt: stale,
    status: "running",
    startedAt: now,
    createdAt: now,
    updatedAt: later,
  });
  await store.saveAgentExecutionLease({
    leaseId: "lease-1",
    runId: "run-stale-1",
    workItemId: "work-item-parent",
    targetAgentId: "agent-1",
    nodeId: "node-a",
    status: "active",
    leaseToken: "lease-stale-1",
    leaseExpiresAt: stale,
    lastHeartbeatAt: stale,
    createdAt: now,
    updatedAt: later,
  });
  await store.saveAgentMessage({
    messageId: "message-1",
    organizationId: "org-1",
    fromAgentId: "agent-1",
    toAgentId: "agent-2",
    workItemId: "work-item-parent",
    runId: "run-stale-1",
    messageType: "question",
    payload: { question: "需要后端确认接口字段" },
    artifactRefs: ["artifact-1"],
    priority: "high",
    requiresAck: true,
    createdAt: now,
  });
  await store.saveAgentMailboxEntry({
    mailboxEntryId: "mailbox-1",
    organizationId: "org-1",
    ownerAgentId: "agent-2",
    messageId: "message-1",
    workItemId: "work-item-parent",
    priority: "high",
    status: "pending",
    requiresAck: true,
    availableAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await store.saveAgentHandoff({
    handoffId: "handoff-1",
    organizationId: "org-1",
    fromAgentId: "agent-1",
    toAgentId: "agent-2",
    workItemId: "work-item-parent",
    sourceMessageId: "message-1",
    sourceRunId: "run-stale-1",
    summary: "前端等待接口字段确认。",
    blockers: ["接口字段未定"],
    recommendedNextActions: ["确认接口响应结构"],
    attachedArtifacts: ["artifact-1"],
    payload: { source: "coordination" },
    createdAt: now,
    updatedAt: later,
  });
  await store.saveAgentAuditLog({
    auditLogId: "audit-1",
    organizationId: "org-1",
    eventType: "spawn_suggestion_ignored",
    actorPrincipalId: "principal-owner",
    subjectAgentId: "agent-1",
    suggestionId: "spawn-1",
    summary: "忽略自动扩编建议。",
    payload: { reason: "当前先不扩编" },
    createdAt: later,
  });

  const projectBinding = await store.getProjectWorkspaceBinding("project-site-a");
  assert.equal(projectBinding?.preferredNodeId, "node-a");
  assert.equal(projectBinding?.continuityMode, "sticky");

  const workspacePolicy = await store.getAgentWorkspacePolicyByOwnerAgent("agent-1");
  assert.equal(workspacePolicy?.workspacePath, "/srv/site-a");
  const runtimeProfile = await store.getAgentRuntimeProfileByOwnerAgent("agent-1");
  assert.equal(runtimeProfile?.model, "gpt-5.4");

  assert.equal((await store.listManagedAgentsByOrganization("org-1")).length, 2);
  assert.equal((await store.listManagedAgentsByOwnerPrincipal("principal-owner")).length, 2);
  assert.equal((await store.listProjectWorkspaceBindingsByOrganization("org-1")).length, 1);
  assert.equal((await store.listAgentWorkItemsByOwnerPrincipal("principal-owner")).length, 2);
  assert.equal((await store.listAgentWorkItemsByTargetAgent("agent-2")).length, 1);
  assert.equal((await store.listAgentWorkItemsByParentWorkItem("work-item-parent")).length, 1);
  assert.equal((await store.getAgentWorkItem("work-item-parent"))?.projectId, "project-site-a");

  const claimedMailbox = await store.claimNextAgentMailboxEntry({
    ownerAgentId: "agent-2",
    leaseToken: "mailbox-lease-1",
    leasedAt: later,
    now: later,
  });
  assert.equal(claimedMailbox?.status, "leased");
  assert.equal(claimedMailbox?.leaseToken, "mailbox-lease-1");
  assert.equal((await store.listAgentMessagesByWorkItem("work-item-parent")).length, 1);
  assert.equal((await store.listAgentMessagesByAgent("agent-2")).length, 1);
  assert.equal((await store.getAgentMessage("message-1"))?.messageType, "question");
  assert.equal((await store.listAgentMailboxEntriesByAgent("agent-2"))[0]?.status, "leased");
  assert.equal((await store.getAgentMailboxEntry("mailbox-1"))?.status, "leased");

  assert.equal((await store.getAgentHandoff("handoff-1"))?.summary, "前端等待接口字段确认。");
  assert.equal((await store.listAgentHandoffsByWorkItem("work-item-parent")).length, 1);
  assert.equal((await store.listAgentHandoffsByAgent("agent-2")).length, 1);

  assert.equal((await store.getAgentSpawnPolicy("org-1"))?.maxActiveAgents, 8);
  assert.equal((await store.getAgentSpawnSuggestionState("spawn-1"))?.state, "ignored");
  assert.equal((await store.listAgentSpawnSuggestionStatesByOrganization("org-1")).length, 1);
  assert.equal((await store.listAgentAuditLogsByOrganization("org-1")).length, 1);
  assert.equal((await store.listStaleActiveAgentRuns(now)).length, 1);
  assert.equal((await store.listAgentRunsByOwnerPrincipal("principal-owner")).length, 1);
  assert.equal((await store.listAgentRunsByWorkItem("work-item-parent")).length, 1);
  assert.equal((await store.listActiveAgentExecutionLeases()).length, 1);
  assert.equal((await store.getActiveAgentExecutionLeaseByRun("run-stale-1"))?.nodeId, "node-a");
  assert.equal((await store.listAgentExecutionLeasesByRun("run-stale-1")).length, 1);
  assert.equal((await store.listAgentExecutionLeasesByNode("node-a")).length, 1);

  const claimedWorkItem = await store.claimNextRunnableAgentWorkItem({
    schedulerId: "scheduler-b",
    leaseToken: "lease-new-1",
    leaseExpiresAt: "2026-04-13T13:00:00.000Z",
    now: later,
    organizationId: "org-1",
  });
  assert.equal(claimedWorkItem?.workItem.workItemId, "work-item-child");
  assert.equal(claimedWorkItem?.workItem.status, "planning");
  assert.equal(claimedWorkItem?.workItem.projectId, "project-site-a");
  assert.equal(claimedWorkItem?.run.status, "created");
  assert.equal((await store.listAgentRunsByWorkItem("work-item-child")).length, 1);
  assert.equal((await store.getAgentRun(claimedWorkItem?.run.runId ?? ""))?.status, "created");

  assert.equal(await store.deleteAgentSpawnSuggestionState("spawn-1"), true);
  assert.equal(await store.getAgentSpawnSuggestionState("spawn-1"), null);
});
