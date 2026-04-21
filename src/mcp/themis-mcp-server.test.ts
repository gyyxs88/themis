import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { type ThemisMcpServerOptions, ThemisMcpServer } from "./themis-mcp-server.js";

function createWorkspace(prefix: string): string {
  const workspace = resolve(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
  return workspace;
}

async function initializeServer(server: ThemisMcpServer): Promise<void> {
  const initializeResponse = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "themis-test",
        version: "1.0.0",
      },
    },
  }));

  assert.ok(initializeResponse);
  const initializePayload = JSON.parse(initializeResponse);
  assert.equal(initializePayload.result?.protocolVersion, "2025-06-18");

  const notificationResponse = await server.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }));

  assert.equal(notificationResponse, null);
}

test("Themis MCP server 会暴露定时任务和员工治理工具列表", async () => {
  const workspace = createWorkspace("themis-mcp-tools");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const server = new ThemisMcpServer({
    registry,
    identity: {
      channel: "cli",
      channelUserId: "tester",
      displayName: "Tester",
    },
  });

  try {
    await initializeServer(server);
    const response = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }));

    assert.ok(response);
    const payload = JSON.parse(response);
    assert.equal(payload.error, undefined);
    assert.equal(Array.isArray(payload.result?.tools), true);
    assert.deepEqual(
      payload.result.tools.map((tool: { name: string }) => tool.name),
      [
        "create_scheduled_task",
        "list_scheduled_tasks",
        "cancel_scheduled_task",
        "list_managed_agents",
        "get_managed_agent_detail",
        "create_managed_agent",
        "update_managed_agent_card",
        "update_managed_agent_execution_boundary",
        "dispatch_work_item",
        "update_managed_agent_lifecycle",
      ],
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 支持 create/list/cancel 定时任务闭环", async () => {
  const workspace = createWorkspace("themis-mcp-crud");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const server = new ThemisMcpServer({
    registry,
    identity: {
      channel: "cli",
      channelUserId: "tester",
      displayName: "Tester",
    },
  });

  try {
    await initializeServer(server);
    const scheduledAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const createResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "create_scheduled_task",
        arguments: {
          goal: "五分钟后检查 staging 日志",
          scheduledAt,
          timezone: "Asia/Shanghai",
          inputText: "重点看 error 和 timeout",
        },
      },
    }));

    assert.ok(createResponse);
    const createPayload = JSON.parse(createResponse);
    assert.equal(createPayload.result?.isError, false);
    const createdTaskId = createPayload.result?.structuredContent?.task?.scheduledTaskId;
    assert.equal(typeof createdTaskId, "string");
    assert.equal(createPayload.result?.structuredContent?.task?.goal, "五分钟后检查 staging 日志");

    const listResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "list_scheduled_tasks",
        arguments: {
          statuses: ["scheduled"],
        },
      },
    }));

    assert.ok(listResponse);
    const listPayload = JSON.parse(listResponse);
    assert.equal(listPayload.result?.isError, false);
    assert.equal(listPayload.result?.structuredContent?.tasks?.length, 1);
    assert.equal(listPayload.result?.structuredContent?.tasks?.[0]?.scheduledTaskId, createdTaskId);

    const cancelResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "cancel_scheduled_task",
        arguments: {
          scheduledTaskId: createdTaskId,
        },
      },
    }));

    assert.ok(cancelResponse);
    const cancelPayload = JSON.parse(cancelResponse);
    assert.equal(cancelPayload.result?.isError, false);
    assert.equal(cancelPayload.result?.structuredContent?.task?.status, "cancelled");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 会把默认 session 上下文带进新建定时任务", async () => {
  const workspace = createWorkspace("themis-mcp-default-session");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const server = new ThemisMcpServer({
    registry,
    identity: {
      channel: "web",
      channelUserId: "browser-user-1",
      displayName: "Owner",
    },
    sessionId: "session-web-scheduled-default-1",
    channelSessionKey: "session-web-scheduled-default-1",
  });

  try {
    await initializeServer(server);
    const createResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "create_scheduled_task",
        arguments: {
          goal: "默认会话定时任务",
          scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          timezone: "Asia/Shanghai",
        },
      },
    }));

    assert.ok(createResponse);
    const createPayload = JSON.parse(createResponse);
    assert.equal(createPayload.result?.isError, false);
    assert.equal(createPayload.result?.structuredContent?.task?.sessionId, "session-web-scheduled-default-1");
    assert.equal(
      createPayload.result?.structuredContent?.task?.channelSessionKey,
      "session-web-scheduled-default-1",
    );
    assert.equal(createPayload.result?.structuredContent?.task?.sourceChannel, "web");
    assert.equal(createPayload.result?.structuredContent?.task?.channelUserId, "browser-user-1");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 支持员工治理工具闭环", async () => {
  const workspace = createWorkspace("themis-mcp-managed-agents");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const server = new ThemisMcpServer({
    workingDirectory: workspace,
    registry,
    identity: {
      channel: "web",
      channelUserId: "owner-user-1",
      displayName: "Owner",
    },
  });

  try {
    await initializeServer(server);
    const createResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "create_managed_agent",
        arguments: {
          departmentRole: "前端",
          displayName: "前端·澄",
          mission: "负责 Web 工作台相关实现。",
        },
      },
    }));

    assert.ok(createResponse);
    const createPayload = JSON.parse(createResponse);
    assert.equal(createPayload.result?.isError, false);
    const agentId = createPayload.result?.structuredContent?.agent?.agentId;
    assert.equal(typeof agentId, "string");
    assert.equal(createPayload.result?.structuredContent?.agent?.displayName, "前端·澄");

    const listResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "list_managed_agents",
        arguments: {
          statuses: ["active"],
        },
      },
    }));

    assert.ok(listResponse);
    const listPayload = JSON.parse(listResponse);
    assert.equal(listPayload.result?.isError, false);
    assert.equal(listPayload.result?.structuredContent?.agents?.length, 1);
    assert.equal(listPayload.result?.structuredContent?.agents?.[0]?.agentId, agentId);

    const detailResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "get_managed_agent_detail",
        arguments: {
          agentId,
        },
      },
    }));

    assert.ok(detailResponse);
    const detailPayload = JSON.parse(detailResponse);
    assert.equal(detailPayload.result?.isError, false);
    assert.equal(detailPayload.result?.structuredContent?.agent?.agentId, agentId);
    assert.equal(detailPayload.result?.structuredContent?.agent?.agentCard?.title, "前端");
    assert.equal(detailPayload.result?.structuredContent?.workspacePolicy?.workspacePath, workspace);

    const cardResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 10.5,
      method: "tools/call",
      params: {
        name: "update_managed_agent_card",
        arguments: {
          agentId,
          card: {
            domainTags: ["官网", "品牌"],
            skillTags: ["React", "信息架构"],
            currentFocus: "推进官网首页信息架构。",
          },
        },
      },
    }));

    assert.ok(cardResponse);
    const cardPayload = JSON.parse(cardResponse);
    assert.equal(cardPayload.result?.isError, false);
    assert.deepEqual(cardPayload.result?.structuredContent?.agent?.agentCard?.domainTags, ["官网", "品牌"]);
    assert.equal(cardPayload.result?.structuredContent?.agent?.agentCard?.currentFocus, "推进官网首页信息架构。");

    const agentWorkspace = resolve(workspace, "workspace/frontend");
    mkdirSync(agentWorkspace, { recursive: true });
    const boundaryResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "update_managed_agent_execution_boundary",
        arguments: {
          agentId,
          workspacePolicy: {
            workspacePath: agentWorkspace,
            allowNetworkAccess: false,
          },
          runtimeProfile: {
            approvalPolicy: "never",
            memoryMode: "auto",
          },
        },
      },
    }));

    assert.ok(boundaryResponse);
    const boundaryPayload = JSON.parse(boundaryResponse);
    assert.equal(boundaryPayload.result?.isError, false);
    assert.equal(boundaryPayload.result?.structuredContent?.workspacePolicy?.workspacePath, agentWorkspace);
    assert.equal(boundaryPayload.result?.structuredContent?.workspacePolicy?.allowNetworkAccess, false);
    assert.equal(boundaryPayload.result?.structuredContent?.runtimeProfile?.approvalPolicy, "never");

    const dispatchResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "dispatch_work_item",
        arguments: {
          targetAgentId: agentId,
          dispatchReason: "推进官网改版",
          goal: "完成首页首屏信息架构和交互方案。",
        },
      },
    }));

    assert.ok(dispatchResponse);
    const dispatchPayload = JSON.parse(dispatchResponse);
    assert.equal(dispatchPayload.result?.isError, false);
    assert.equal(dispatchPayload.result?.structuredContent?.targetAgent?.agentId, agentId);
    assert.equal(dispatchPayload.result?.structuredContent?.workItem?.targetAgentId, agentId);

    const lifecycleResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "update_managed_agent_lifecycle",
        arguments: {
          agentId,
          action: "pause",
        },
      },
    }));

    assert.ok(lifecycleResponse);
    const lifecyclePayload = JSON.parse(lifecycleResponse);
    assert.equal(lifecyclePayload.result?.isError, false);
    assert.equal(lifecyclePayload.result?.structuredContent?.agent?.status, "paused");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 会兼容旧平台 dispatch 响应缺少 targetAgent", async () => {
  const workspace = createWorkspace("themis-mcp-managed-agents-compat");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const managedAgentControlPlaneFacade = {
    async dispatchWorkItem() {
      return {
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "owner-user-1",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-21T09:00:00.000Z",
          updatedAt: "2026-04-21T09:00:00.000Z",
        },
        workItem: {
          workItemId: "work-item-alpha",
          organizationId: "org-alpha",
          targetAgentId: "agent-alpha",
          sourceType: "human",
          dispatchReason: "兼容旧平台返回",
          goal: "补齐 targetAgent 回查。",
          status: "queued",
          priority: "normal",
          createdAt: "2026-04-21T09:00:00.000Z",
          updatedAt: "2026-04-21T09:00:00.000Z",
        },
      };
    },
    async getManagedAgentDetailView() {
      return {
        organization: {
          organizationId: "org-alpha",
          ownerPrincipalId: "owner-user-1",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-21T09:00:00.000Z",
          updatedAt: "2026-04-21T09:00:00.000Z",
        },
        principal: {
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "兼容员工",
          kind: "managed_agent",
          createdAt: "2026-04-21T09:00:00.000Z",
          updatedAt: "2026-04-21T09:00:00.000Z",
        },
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-alpha",
          displayName: "兼容员工",
          departmentRole: "平台值班",
          status: "active",
          createdByPrincipalId: "owner-user-1",
          createdAt: "2026-04-21T09:00:00.000Z",
          updatedAt: "2026-04-21T09:00:00.000Z",
        },
        workspacePolicy: null,
        runtimeProfile: null,
        authAccounts: [],
        thirdPartyProviders: [],
      };
    },
  } as unknown as NonNullable<ThemisMcpServerOptions["managedAgentControlPlaneFacade"]>;
  const server = new ThemisMcpServer({
    workingDirectory: workspace,
    registry,
    identity: {
      channel: "web",
      channelUserId: "owner-user-1",
      displayName: "Owner",
    },
    managedAgentControlPlaneFacade,
  });

  try {
    await initializeServer(server);
    const dispatchResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 12.5,
      method: "tools/call",
      params: {
        name: "dispatch_work_item",
        arguments: {
          targetAgentId: "agent-alpha",
          dispatchReason: "兼容旧平台返回",
          goal: "补齐 targetAgent 回查。",
        },
      },
    }));

    assert.ok(dispatchResponse);
    const dispatchPayload = JSON.parse(dispatchResponse);
    assert.equal(dispatchPayload.result?.isError, false);
    assert.equal(dispatchPayload.result?.structuredContent?.targetAgent?.displayName, "兼容员工");
    assert.match(dispatchPayload.result?.content?.[0]?.text ?? "", /兼容员工/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 在业务失败时返回 tool error", async () => {
  const workspace = createWorkspace("themis-mcp-error");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const server = new ThemisMcpServer({
    registry,
    identity: {
      channel: "cli",
      channelUserId: "tester",
    },
  });

  try {
    await initializeServer(server);
    const response = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "cancel_scheduled_task",
        arguments: {
          scheduledTaskId: "scheduled-task-missing",
        },
      },
    }));

    assert.ok(response);
    const payload = JSON.parse(response);
    assert.equal(payload.error, undefined);
    assert.equal(payload.result?.isError, true);
    assert.match(payload.result?.content?.[0]?.text ?? "", /不存在/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
