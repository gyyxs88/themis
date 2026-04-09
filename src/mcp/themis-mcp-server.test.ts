import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { ThemisMcpServer } from "./themis-mcp-server.js";

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

test("Themis MCP server 会暴露定时任务工具列表", async () => {
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
      ["create_scheduled_task", "list_scheduled_tasks", "cancel_scheduled_task"],
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
