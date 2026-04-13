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
