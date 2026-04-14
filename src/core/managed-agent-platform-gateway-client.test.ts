import assert from "node:assert/strict";
import test from "node:test";
import { ManagedAgentPlatformGatewayClient } from "./managed-agent-platform-gateway-client.js";

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

test("ManagedAgentPlatformGatewayClient 会按项目工作区绑定契约读写平台 projects 接口", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const headers = normalizeHeaders(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    calls.push({
      url,
      headers,
      body,
    });

    if (url.endsWith("/api/platform/projects/workspace-binding/list")) {
      return new Response(JSON.stringify({
        bindings: [{
          projectId: "project-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Workspace",
          continuityMode: "sticky",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        }],
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.endsWith("/api/platform/projects/workspace-binding/detail")) {
      return new Response(JSON.stringify({
        binding: {
          projectId: "project-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Workspace",
          canonicalWorkspacePath: "/srv/alpha",
          continuityMode: "sticky",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:05:00.000Z",
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.endsWith("/api/platform/projects/workspace-binding/upsert")) {
      return new Response(JSON.stringify({
        binding: {
          projectId: "project-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Workspace",
          canonicalWorkspacePath: "/srv/alpha",
          preferredNodeId: "node-alpha",
          lastActiveWorkspacePath: "/srv/alpha",
          continuityMode: "replicated",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:10:00.000Z",
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const client = new ManagedAgentPlatformGatewayClient({
    baseUrl: "https://platform.example.com/",
    ownerPrincipalId: "principal-owner",
    webAccessToken: "token-123",
    fetchImpl,
  });

  const bindings = await client.listProjectWorkspaceBindings({
    organizationId: "org-alpha",
  });
  const binding = await client.getProjectWorkspaceBinding("project-alpha");
  const upserted = await client.upsertProjectWorkspaceBinding({
    projectId: "project-alpha",
    displayName: "Alpha Workspace",
    organizationId: "org-alpha",
    canonicalWorkspacePath: "/srv/alpha",
    preferredNodeId: "node-alpha",
    lastActiveWorkspacePath: "/srv/alpha",
    continuityMode: "replicated",
  });

  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]?.projectId, "project-alpha");
  assert.equal(binding?.canonicalWorkspacePath, "/srv/alpha");
  assert.equal(upserted.preferredNodeId, "node-alpha");
  assert.equal(upserted.continuityMode, "replicated");

  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
  assert.equal(calls[0]?.body.ownerPrincipalId, "principal-owner");
  assert.equal(calls[0]?.body.organizationId, "org-alpha");

  assert.equal(calls[1]?.body.projectId, "project-alpha");

  assert.deepEqual(calls[2]?.body, {
    ownerPrincipalId: "principal-owner",
    binding: {
      projectId: "project-alpha",
      displayName: "Alpha Workspace",
      organizationId: "org-alpha",
      canonicalWorkspacePath: "/srv/alpha",
      preferredNodeId: "node-alpha",
      lastActiveWorkspacePath: "/srv/alpha",
      continuityMode: "replicated",
    },
  });
});

test("ManagedAgentPlatformGatewayClient 会按 work-items 契约读写平台协作接口", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const headers = normalizeHeaders(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    calls.push({
      url,
      headers,
      body,
    });

    if (url.endsWith("/api/platform/work-items/list")) {
      return jsonResponse({
        workItems: [{
          workItemId: "work-item-alpha",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "推进项目 Alpha",
          goal: "完成第一阶段改造",
          status: "queued",
          priority: "high",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
        }],
      });
    }

    if (url.endsWith("/api/platform/work-items/dispatch")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        workItem: {
          workItemId: "work-item-beta",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "推进项目 Alpha",
          goal: "完成第一阶段改造",
          status: "queued",
          priority: "high",
          projectId: "project-alpha",
          createdAt: "2026-04-13T10:05:00.000Z",
          updatedAt: "2026-04-13T10:05:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/work-items/respond")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        workItem: {
          workItemId: "work-item-beta",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "推进项目 Alpha",
          goal: "完成第一阶段改造",
          status: "running",
          priority: "high",
          projectId: "project-alpha",
          createdAt: "2026-04-13T10:05:00.000Z",
          updatedAt: "2026-04-13T10:06:00.000Z",
        },
        message: null,
      });
    }

    if (url.endsWith("/api/platform/work-items/escalate")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        workItem: {
          workItemId: "work-item-beta",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "推进项目 Alpha",
          goal: "完成第一阶段改造",
          status: "waiting_human",
          priority: "high",
          projectId: "project-alpha",
          createdAt: "2026-04-13T10:05:00.000Z",
          updatedAt: "2026-04-13T10:07:00.000Z",
        },
        message: null,
      });
    }

    if (url.endsWith("/api/platform/work-items/detail")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        workItem: {
          workItemId: "work-item-beta",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "推进项目 Alpha",
          goal: "完成第一阶段改造",
          status: "waiting_human",
          priority: "high",
          projectId: "project-alpha",
          createdAt: "2026-04-13T10:05:00.000Z",
          updatedAt: "2026-04-13T10:07:00.000Z",
        },
        targetAgent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        sourcePrincipal: {
          principalId: "principal-owner",
          organizationId: "org-alpha",
          displayName: "Owner",
          kind: "human_user",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        messages: [],
        collaboration: {
          parentWorkItem: null,
          parentTargetAgent: null,
          childSummary: {
            totalCount: 0,
            queuedCount: 0,
            runningCount: 0,
            waitingCount: 0,
            completedCount: 0,
            failedCount: 0,
            cancelledCount: 0,
          },
          childWorkItems: [],
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const client = new ManagedAgentPlatformGatewayClient({
    baseUrl: "https://platform.example.com/",
    ownerPrincipalId: "principal-owner",
    webAccessToken: "token-123",
    fetchImpl,
  });

  const list = await client.listWorkItems({
    agentId: "agent-alpha",
  });
  const dispatch = await client.dispatchWorkItem({
    targetAgentId: "agent-alpha",
    projectId: "project-alpha",
    sourceType: "human",
    sourcePrincipalId: "principal-owner",
    dispatchReason: "推进项目 Alpha",
    goal: "完成第一阶段改造",
    priority: "high",
  });
  const responded = await client.respondToHumanWaitingWorkItem({
    workItemId: "work-item-beta",
    decision: "approve",
    inputText: "继续执行",
    artifactRefs: ["artifact-1"],
  });
  const escalated = await client.escalateWaitingAgentWorkItemToHuman({
    workItemId: "work-item-beta",
    inputText: "需要你确认下一步范围",
  });
  const detail = await client.getWorkItemDetail("work-item-beta");

  assert.equal(list.length, 1);
  assert.equal(list[0]?.workItemId, "work-item-alpha");
  assert.equal(dispatch.workItem.projectId, "project-alpha");
  assert.equal(responded.workItem.status, "running");
  assert.equal(escalated.workItem.status, "waiting_human");
  assert.equal(detail?.workItem.workItemId, "work-item-beta");
  assert.equal(detail?.targetAgent?.agentId, "agent-alpha");

  assert.equal(calls.length, 5);
  assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
  assert.deepEqual(calls[0]?.body, {
    ownerPrincipalId: "principal-owner",
    agentId: "agent-alpha",
  });
  assert.deepEqual(calls[1]?.body, {
    ownerPrincipalId: "principal-owner",
    workItem: {
      targetAgentId: "agent-alpha",
      projectId: "project-alpha",
      sourceType: "human",
      sourcePrincipalId: "principal-owner",
      dispatchReason: "推进项目 Alpha",
      goal: "完成第一阶段改造",
      priority: "high",
    },
  });
  assert.deepEqual(calls[2]?.body, {
    ownerPrincipalId: "principal-owner",
    workItemId: "work-item-beta",
    response: {
      decision: "approve",
      inputText: "继续执行",
      artifactRefs: ["artifact-1"],
    },
  });
  assert.deepEqual(calls[3]?.body, {
    ownerPrincipalId: "principal-owner",
    workItemId: "work-item-beta",
    escalation: {
      inputText: "需要你确认下一步范围",
    },
  });
  assert.deepEqual(calls[4]?.body, {
    ownerPrincipalId: "principal-owner",
    workItemId: "work-item-beta",
  });
});

test("ManagedAgentPlatformGatewayClient 会按 mailbox 与 runs 契约读写平台协作视图", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const headers = normalizeHeaders(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    calls.push({
      url,
      headers,
      body,
    });

    if (url.endsWith("/api/platform/runs/list")) {
      return jsonResponse({
        runs: [{
          runId: "run-alpha",
          organizationId: "org-alpha",
          workItemId: "work-item-alpha",
          targetAgentId: "agent-alpha",
          status: "running",
          leaseToken: "lease-alpha",
          createdAt: "2026-04-13T10:20:00.000Z",
          updatedAt: "2026-04-13T10:20:00.000Z",
        }],
      });
    }

    if (url.endsWith("/api/platform/runs/detail")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        run: {
          runId: "run-alpha",
          organizationId: "org-alpha",
          workItemId: "work-item-alpha",
          targetAgentId: "agent-alpha",
          status: "running",
          leaseToken: "lease-alpha",
          createdAt: "2026-04-13T10:20:00.000Z",
          updatedAt: "2026-04-13T10:20:00.000Z",
        },
        workItem: {
          workItemId: "work-item-alpha",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "推进项目 Alpha",
          goal: "完成第一阶段改造",
          status: "running",
          priority: "high",
          createdAt: "2026-04-13T10:18:00.000Z",
          updatedAt: "2026-04-13T10:20:00.000Z",
        },
        targetAgent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/agents/handoffs/list")) {
      return jsonResponse({
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        handoffs: [],
        timeline: [],
      });
    }

    if (url.endsWith("/api/platform/agents/mailbox/list")) {
      return jsonResponse({
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        items: [],
      });
    }

    if (url.endsWith("/api/platform/agents/mailbox/pull")) {
      return jsonResponse({
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        item: null,
      });
    }

    if (url.endsWith("/api/platform/agents/mailbox/ack")) {
      return jsonResponse({
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        mailboxEntry: {
          mailboxEntryId: "mailbox-entry-alpha",
          organizationId: "org-alpha",
          agentId: "agent-alpha",
          messageId: "message-alpha",
          status: "acked",
          leasedAt: "2026-04-13T10:21:00.000Z",
          ackedAt: "2026-04-13T10:22:00.000Z",
          createdAt: "2026-04-13T10:20:30.000Z",
          updatedAt: "2026-04-13T10:22:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/agents/mailbox/respond")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        sourceMailboxEntry: {
          mailboxEntryId: "mailbox-entry-alpha",
          organizationId: "org-alpha",
          agentId: "agent-alpha",
          messageId: "message-alpha",
          status: "acked",
          leasedAt: "2026-04-13T10:21:00.000Z",
          ackedAt: "2026-04-13T10:22:00.000Z",
          createdAt: "2026-04-13T10:20:30.000Z",
          updatedAt: "2026-04-13T10:22:00.000Z",
        },
        sourceMessage: {
          messageId: "message-alpha",
          organizationId: "org-alpha",
          fromAgentId: "agent-beta",
          toAgentId: "agent-alpha",
          messageType: "question",
          payload: null,
          createdAt: "2026-04-13T10:20:30.000Z",
          updatedAt: "2026-04-13T10:20:30.000Z",
        },
        responseMessage: {
          messageId: "message-beta",
          organizationId: "org-alpha",
          fromAgentId: "agent-alpha",
          toAgentId: "agent-beta",
          messageType: "answer",
          payload: null,
          createdAt: "2026-04-13T10:22:30.000Z",
          updatedAt: "2026-04-13T10:22:30.000Z",
        },
        responseMailboxEntry: {
          mailboxEntryId: "mailbox-entry-beta",
          organizationId: "org-alpha",
          agentId: "agent-beta",
          messageId: "message-beta",
          status: "pending",
          createdAt: "2026-04-13T10:22:30.000Z",
          updatedAt: "2026-04-13T10:22:30.000Z",
        },
        resumedRuns: [],
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const client = new ManagedAgentPlatformGatewayClient({
    baseUrl: "https://platform.example.com/",
    ownerPrincipalId: "principal-owner",
    webAccessToken: "token-123",
    fetchImpl,
  });

  const runs = await client.listRuns({
    agentId: "agent-alpha",
    workItemId: "work-item-alpha",
  });
  const runDetail = await client.getRunDetail("run-alpha");
  const handoffs = await client.getAgentHandoffListView({
    agentId: "agent-alpha",
    workItemId: "work-item-alpha",
    limit: 5,
  });
  const mailbox = await client.getAgentMailboxListView("agent-alpha");
  const pulled = await client.pullMailboxEntry("agent-alpha");
  const acked = await client.ackMailboxEntry("agent-alpha", "mailbox-entry-alpha");
  const responded = await client.respondToMailboxEntry({
    agentId: "agent-alpha",
    mailboxEntryId: "mailbox-entry-alpha",
    decision: "approve",
    inputText: "继续推进",
    priority: "high",
  });

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.runId, "run-alpha");
  assert.equal(runDetail?.run.runId, "run-alpha");
  assert.equal(handoffs.agent.agentId, "agent-alpha");
  assert.equal(mailbox.agent.agentId, "agent-alpha");
  assert.equal(pulled.item, null);
  assert.equal(acked.mailboxEntry.mailboxEntryId, "mailbox-entry-alpha");
  assert.equal(responded.agent.agentId, "agent-alpha");

  assert.equal(calls.length, 7);
  assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
  assert.deepEqual(calls[0]?.body, {
    ownerPrincipalId: "principal-owner",
    agentId: "agent-alpha",
    workItemId: "work-item-alpha",
  });
  assert.deepEqual(calls[1]?.body, {
    ownerPrincipalId: "principal-owner",
    runId: "run-alpha",
  });
  assert.deepEqual(calls[2]?.body, {
    ownerPrincipalId: "principal-owner",
    agentId: "agent-alpha",
    workItemId: "work-item-alpha",
    limit: 5,
  });
  assert.deepEqual(calls[3]?.body, {
    ownerPrincipalId: "principal-owner",
    agentId: "agent-alpha",
  });
  assert.deepEqual(calls[4]?.body, {
    ownerPrincipalId: "principal-owner",
    agentId: "agent-alpha",
  });
  assert.deepEqual(calls[5]?.body, {
    ownerPrincipalId: "principal-owner",
    agentId: "agent-alpha",
    mailboxEntryId: "mailbox-entry-alpha",
  });
  assert.deepEqual(calls[6]?.body, {
    ownerPrincipalId: "principal-owner",
    agentId: "agent-alpha",
    mailboxEntryId: "mailbox-entry-alpha",
    response: {
      decision: "approve",
      inputText: "继续推进",
      priority: "high",
    },
  });
});

test("ManagedAgentPlatformGatewayClient 会按 agents 与 governance 契约读写平台治理接口", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const headers = normalizeHeaders(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    calls.push({
      url,
      headers,
      body,
    });

    if (url.endsWith("/api/platform/agents/create")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        principal: {
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          kind: "managed_agent",
          createdAt: "2026-04-13T10:30:00.000Z",
          updatedAt: "2026-04-13T10:30:00.000Z",
        },
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T10:30:00.000Z",
          updatedAt: "2026-04-13T10:30:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/agents/execution-boundary/update")) {
      return jsonResponse({
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T10:30:00.000Z",
          updatedAt: "2026-04-13T10:31:00.000Z",
        },
        workspacePolicy: {
          policyId: "workspace-policy-alpha",
          ownerAgentId: "agent-alpha",
          displayName: "Alpha Workspace",
          workspacePath: "/srv/alpha",
          createdAt: "2026-04-13T10:31:00.000Z",
          updatedAt: "2026-04-13T10:31:00.000Z",
        },
        runtimeProfile: {
          profileId: "runtime-profile-alpha",
          ownerAgentId: "agent-alpha",
          displayName: "Alpha Runtime",
          model: "gpt-5.4",
          reasoning: "high",
          createdAt: "2026-04-13T10:31:00.000Z",
          updatedAt: "2026-04-13T10:31:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/agents/spawn-policy/update")) {
      return jsonResponse({
        policy: {
          organizationId: "org-alpha",
          maxActiveAgents: 6,
          maxActiveAgentsPerRole: 2,
          createdAt: "2026-04-13T10:32:00.000Z",
          updatedAt: "2026-04-13T10:32:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/agents/waiting/list")) {
      return jsonResponse({
        summary: {
          totalCount: 2,
          waitingHumanCount: 1,
          waitingAgentCount: 1,
          escalationCount: 0,
        },
        items: [],
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const client = new ManagedAgentPlatformGatewayClient({
    baseUrl: "https://platform.example.com/",
    ownerPrincipalId: "principal-owner",
    webAccessToken: "token-123",
    fetchImpl,
  });

  const created = await client.createManagedAgent({
    departmentRole: "交付经理",
    displayName: "Alpha Agent",
    mission: "推进项目 Alpha",
    organizationId: "org-alpha",
  });
  const boundary = await client.updateManagedAgentExecutionBoundary({
    agentId: "agent-alpha",
    workspacePolicy: {
      displayName: "Alpha Workspace",
      workspacePath: "/srv/alpha",
    },
    runtimeProfile: {
      displayName: "Alpha Runtime",
      model: "gpt-5.4",
      reasoning: "high",
    },
  });
  const policy = await client.updateSpawnPolicy({
    organizationId: "org-alpha",
    maxActiveAgents: 6,
    maxActiveAgentsPerRole: 2,
  });
  const waiting = await client.listOrganizationWaitingQueue({
    organizationId: "org-alpha",
    managerAgentId: "agent-manager",
    attentionOnly: true,
    waitingFor: "human",
    failedOnly: true,
    limit: 10,
  });

  assert.equal(created.agent.agentId, "agent-alpha");
  assert.equal(boundary.workspacePolicy.workspacePath, "/srv/alpha");
  assert.equal(policy.maxActiveAgents, 6);
  assert.equal(waiting.summary.totalCount, 2);

  assert.equal(calls.length, 4);
  assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
  assert.deepEqual(calls[0]?.body, {
    ownerPrincipalId: "principal-owner",
    agent: {
      departmentRole: "交付经理",
      displayName: "Alpha Agent",
      mission: "推进项目 Alpha",
      organizationId: "org-alpha",
    },
  });
  assert.deepEqual(calls[1]?.body, {
    ownerPrincipalId: "principal-owner",
    agentId: "agent-alpha",
    boundary: {
      workspacePolicy: {
        displayName: "Alpha Workspace",
        workspacePath: "/srv/alpha",
      },
      runtimeProfile: {
        displayName: "Alpha Runtime",
        model: "gpt-5.4",
        reasoning: "high",
      },
    },
  });
  assert.deepEqual(calls[2]?.body, {
    ownerPrincipalId: "principal-owner",
    policy: {
      organizationId: "org-alpha",
      maxActiveAgents: 6,
      maxActiveAgentsPerRole: 2,
    },
  });
  assert.deepEqual(calls[3]?.body, {
    ownerPrincipalId: "principal-owner",
    organizationId: "org-alpha",
    managerAgentId: "agent-manager",
    attentionOnly: true,
    waitingFor: "human",
    failedOnly: true,
    limit: 10,
  });
});

test("ManagedAgentPlatformGatewayClient 会按 nodes 与 worker runs 契约读写平台节点接口", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const headers = normalizeHeaders(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};

    calls.push({
      url,
      headers,
      body,
    });

    if (url.endsWith("/api/platform/nodes/register")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        node: {
          nodeId: "node-alpha",
          organizationId: "org-alpha",
          displayName: "Worker Alpha",
          status: "online",
          slotCapacity: 2,
          slotAvailable: 2,
          labels: ["linux"],
          workspaceCapabilities: ["/srv/alpha"],
          credentialCapabilities: ["default"],
          providerCapabilities: ["openai"],
          heartbeatTtlSeconds: 30,
          lastHeartbeatAt: "2026-04-13T11:00:00.000Z",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:00:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/nodes/heartbeat")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        node: {
          nodeId: "node-alpha",
          organizationId: "org-alpha",
          displayName: "Worker Alpha",
          status: "online",
          slotCapacity: 2,
          slotAvailable: 1,
          labels: ["linux"],
          workspaceCapabilities: ["/srv/alpha"],
          credentialCapabilities: ["default"],
          providerCapabilities: ["openai"],
          heartbeatTtlSeconds: 30,
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:01:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/nodes/list")) {
      return jsonResponse({
        nodes: [{
          nodeId: "node-alpha",
          organizationId: "org-alpha",
          displayName: "Worker Alpha",
          status: "online",
          slotCapacity: 2,
          slotAvailable: 1,
          labels: ["linux"],
          workspaceCapabilities: ["/srv/alpha"],
          credentialCapabilities: ["default"],
          providerCapabilities: ["openai"],
          heartbeatTtlSeconds: 30,
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:01:00.000Z",
        }],
      });
    }

    if (url.endsWith("/api/platform/nodes/detail")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        node: {
          nodeId: "node-alpha",
          organizationId: "org-alpha",
          displayName: "Worker Alpha",
          status: "online",
          slotCapacity: 2,
          slotAvailable: 1,
          labels: ["linux"],
          workspaceCapabilities: ["/srv/alpha"],
          credentialCapabilities: ["default"],
          providerCapabilities: ["openai"],
          heartbeatTtlSeconds: 30,
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:01:00.000Z",
        },
        leaseSummary: {
          totalCount: 1,
          activeCount: 1,
          expiredCount: 0,
          releasedCount: 0,
          revokedCount: 0,
        },
        activeExecutionLeases: [],
        recentExecutionLeases: [],
      });
    }

    if (url.endsWith("/api/platform/nodes/drain") || url.endsWith("/api/platform/nodes/offline")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        node: {
          nodeId: "node-alpha",
          organizationId: "org-alpha",
          displayName: "Worker Alpha",
          status: url.endsWith("/drain") ? "draining" : "offline",
          slotCapacity: 2,
          slotAvailable: 1,
          labels: ["linux"],
          workspaceCapabilities: ["/srv/alpha"],
          credentialCapabilities: ["default"],
          providerCapabilities: ["openai"],
          heartbeatTtlSeconds: 30,
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:02:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/platform/nodes/reclaim")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        node: {
          nodeId: "node-alpha",
          organizationId: "org-alpha",
          displayName: "Worker Alpha",
          status: "offline",
          slotCapacity: 2,
          slotAvailable: 2,
          labels: ["linux"],
          workspaceCapabilities: ["/srv/alpha"],
          credentialCapabilities: ["default"],
          providerCapabilities: ["openai"],
          heartbeatTtlSeconds: 30,
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:03:00.000Z",
        },
        summary: {
          activeLeaseCount: 1,
          reclaimedRunCount: 1,
          requeuedWorkItemCount: 0,
          preservedWaitingCount: 0,
          revokedLeaseOnlyCount: 0,
        },
        reclaimedLeases: [],
      });
    }

    if (url.endsWith("/api/platform/worker/runs/pull")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        node: {
          nodeId: "node-alpha",
          organizationId: "org-alpha",
          displayName: "Worker Alpha",
          status: "online",
          slotCapacity: 2,
          slotAvailable: 1,
          labels: ["linux"],
          workspaceCapabilities: ["/srv/alpha"],
          credentialCapabilities: ["default"],
          providerCapabilities: ["openai"],
          heartbeatTtlSeconds: 30,
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:01:00.000Z",
        },
        targetAgent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        workItem: {
          workItemId: "work-item-alpha",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "推进项目 Alpha",
          goal: "完成第一阶段改造",
          status: "running",
          priority: "high",
          createdAt: "2026-04-13T11:00:30.000Z",
          updatedAt: "2026-04-13T11:01:00.000Z",
        },
        run: {
          runId: "run-alpha",
          organizationId: "org-alpha",
          workItemId: "work-item-alpha",
          targetAgentId: "agent-alpha",
          status: "created",
          leaseToken: "lease-alpha",
          createdAt: "2026-04-13T11:01:00.000Z",
          updatedAt: "2026-04-13T11:01:00.000Z",
        },
        executionLease: {
          leaseId: "lease-alpha",
          organizationId: "org-alpha",
          workItemId: "work-item-alpha",
          runId: "run-alpha",
          targetAgentId: "agent-alpha",
          nodeId: "node-alpha",
          leaseToken: "lease-alpha",
          status: "active",
          leasedAt: "2026-04-13T11:01:00.000Z",
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          expiresAt: "2026-04-13T11:02:00.000Z",
          createdAt: "2026-04-13T11:01:00.000Z",
          updatedAt: "2026-04-13T11:01:00.000Z",
        },
        executionContract: {
          workspacePath: "/srv/alpha",
          taskAccessMode: "workspace_write",
          sandboxMode: "workspace_write",
          approvalPolicy: "never",
          webSearchMode: "enabled",
          reasoningLevel: "high",
          model: "gpt-5.4",
          auth: { credentialIds: ["default"] },
          provider: { id: "openai" },
          bootstrap: { mode: "existing" },
        },
      });
    }

    if (url.endsWith("/api/platform/worker/runs/update") || url.endsWith("/api/platform/worker/runs/complete")) {
      return jsonResponse({
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "principal-owner",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        node: {
          nodeId: "node-alpha",
          organizationId: "org-alpha",
          displayName: "Worker Alpha",
          status: "online",
          slotCapacity: 2,
          slotAvailable: 1,
          labels: ["linux"],
          workspaceCapabilities: ["/srv/alpha"],
          credentialCapabilities: ["default"],
          providerCapabilities: ["openai"],
          heartbeatTtlSeconds: 30,
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:01:00.000Z",
        },
        targetAgent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "Alpha Agent",
          departmentRole: "交付经理",
          status: "active",
          createdByPrincipalId: "principal-owner",
          createdAt: "2026-04-13T09:00:00.000Z",
          updatedAt: "2026-04-13T09:00:00.000Z",
        },
        workItem: {
          workItemId: "work-item-alpha",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "推进项目 Alpha",
          goal: "完成第一阶段改造",
          status: url.endsWith("/complete") ? "completed" : "running",
          priority: "high",
          createdAt: "2026-04-13T11:00:30.000Z",
          updatedAt: "2026-04-13T11:02:00.000Z",
        },
        run: {
          runId: "run-alpha",
          organizationId: "org-alpha",
          workItemId: "work-item-alpha",
          targetAgentId: "agent-alpha",
          status: url.endsWith("/complete") ? "completed" : "running",
          leaseToken: "lease-alpha",
          createdAt: "2026-04-13T11:01:00.000Z",
          updatedAt: "2026-04-13T11:02:00.000Z",
        },
        executionLease: {
          leaseId: "lease-alpha",
          organizationId: "org-alpha",
          workItemId: "work-item-alpha",
          runId: "run-alpha",
          targetAgentId: "agent-alpha",
          nodeId: "node-alpha",
          leaseToken: "lease-alpha",
          status: url.endsWith("/complete") ? "released" : "active",
          leasedAt: "2026-04-13T11:01:00.000Z",
          lastHeartbeatAt: "2026-04-13T11:01:00.000Z",
          expiresAt: "2026-04-13T11:02:00.000Z",
          createdAt: "2026-04-13T11:01:00.000Z",
          updatedAt: "2026-04-13T11:02:00.000Z",
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const client = new ManagedAgentPlatformGatewayClient({
    baseUrl: "https://platform.example.com/",
    ownerPrincipalId: "principal-owner",
    webAccessToken: "token-123",
    fetchImpl,
  });

  const registered = await client.registerNode({
    displayName: "Worker Alpha",
    slotCapacity: 2,
    workspaceCapabilities: ["/srv/alpha"],
    credentialCapabilities: ["default"],
    providerCapabilities: ["openai"],
    labels: ["linux"],
  });
  const heartbeat = await client.heartbeatNode({
    nodeId: "node-alpha",
    slotAvailable: 1,
    labels: ["linux"],
  });
  const nodes = await client.listNodes({
    organizationId: "org-alpha",
  });
  const nodeDetail = await client.getNodeDetail("node-alpha");
  const draining = await client.markNodeDraining("node-alpha");
  const offline = await client.markNodeOffline("node-alpha");
  const reclaimed = await client.reclaimNodeLeases({
    nodeId: "node-alpha",
    failureCode: "NODE_OFFLINE",
    failureMessage: "node offline during test",
  });
  const assigned = await client.pullAssignedRun({
    nodeId: "node-alpha",
  });
  const updated = await client.updateWorkerRunStatus({
    nodeId: "node-alpha",
    runId: "run-alpha",
    leaseToken: "lease-alpha",
    status: "running",
  });
  const completed = await client.completeWorkerRun({
    nodeId: "node-alpha",
    runId: "run-alpha",
    leaseToken: "lease-alpha",
    result: {
      summary: "done",
    },
  });

  assert.equal(registered.node.nodeId, "node-alpha");
  assert.equal(heartbeat.node.slotAvailable, 1);
  assert.equal(nodes.length, 1);
  assert.equal(nodeDetail?.node.nodeId, "node-alpha");
  assert.equal(draining.node.status, "draining");
  assert.equal(offline.node.status, "offline");
  assert.equal(reclaimed.summary.reclaimedRunCount, 1);
  assert.equal(assigned?.run.runId, "run-alpha");
  assert.equal(updated.run.status, "running");
  assert.equal(completed.run.status, "completed");

  assert.equal(calls.length, 10);
  assert.equal(calls[0]?.headers.authorization, "Bearer token-123");
  assert.deepEqual(calls[0]?.body, {
    ownerPrincipalId: "principal-owner",
    node: {
      displayName: "Worker Alpha",
      slotCapacity: 2,
      labels: ["linux"],
      workspaceCapabilities: ["/srv/alpha"],
      credentialCapabilities: ["default"],
      providerCapabilities: ["openai"],
    },
  });
  assert.deepEqual(calls[1]?.body, {
    ownerPrincipalId: "principal-owner",
    node: {
      nodeId: "node-alpha",
      slotAvailable: 1,
      labels: ["linux"],
    },
  });
  assert.deepEqual(calls[2]?.body, {
    ownerPrincipalId: "principal-owner",
    organizationId: "org-alpha",
  });
  assert.deepEqual(calls[3]?.body, {
    ownerPrincipalId: "principal-owner",
    nodeId: "node-alpha",
  });
  assert.deepEqual(calls[4]?.body, {
    ownerPrincipalId: "principal-owner",
    nodeId: "node-alpha",
  });
  assert.deepEqual(calls[5]?.body, {
    ownerPrincipalId: "principal-owner",
    nodeId: "node-alpha",
  });
  assert.deepEqual(calls[6]?.body, {
    ownerPrincipalId: "principal-owner",
    nodeId: "node-alpha",
    failureCode: "NODE_OFFLINE",
    failureMessage: "node offline during test",
  });
  assert.deepEqual(calls[7]?.body, {
    ownerPrincipalId: "principal-owner",
    nodeId: "node-alpha",
  });
  assert.deepEqual(calls[8]?.body, {
    ownerPrincipalId: "principal-owner",
    nodeId: "node-alpha",
    runId: "run-alpha",
    leaseToken: "lease-alpha",
    status: "running",
  });
  assert.deepEqual(calls[9]?.body, {
    ownerPrincipalId: "principal-owner",
    nodeId: "node-alpha",
    runId: "run-alpha",
    leaseToken: "lease-alpha",
    result: {
      summary: "done",
    },
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
}
