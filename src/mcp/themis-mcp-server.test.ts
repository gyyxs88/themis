import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
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
        "manage_themis_secret",
        "provision_cloudflare_worker_secret",
        "update_managed_agent_lifecycle",
        "list_operation_objects",
        "create_operation_object",
        "update_operation_object",
        "list_operation_edges",
        "create_operation_edge",
        "update_operation_edge",
        "query_operation_graph",
        "get_operations_boss_view",
      ],
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 提供密码本工具给 Themis 自己增删改查且不回显 secret", async () => {
  const workspace = createWorkspace("themis-mcp-secret-book");
  const themisSecretStoreFile = resolve(workspace, "infra/local/themis-secrets.json");
  const secretValue = "github_pat_11AAAA2222_bbbbbbbbbbbbbbbbbbbbbbbb";
  const server = new ThemisMcpServer({
    workingDirectory: workspace,
    env: {
      ...process.env,
      THEMIS_SECRET_STORE_FILE: themisSecretStoreFile,
    },
    identity: {
      channel: "cli",
      channelUserId: "tester",
      displayName: "Tester",
    },
  });

  try {
    await initializeServer(server);
    const setResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "manage_themis_secret",
        arguments: {
          action: "set",
          secretRef: "github-token",
          value: secretValue,
        },
      },
    }));

    assert.ok(setResponse);
    const setPayload = JSON.parse(setResponse);
    assert.equal(setPayload.result?.isError, false);
    assert.equal(setPayload.result?.structuredContent?.secretRef, "github-token");
    assert.equal(setPayload.result?.structuredContent?.valueStored, true);
    assert.doesNotMatch(JSON.stringify(setPayload), new RegExp(secretValue));
    assert.deepEqual(JSON.parse(readFileSync(themisSecretStoreFile, "utf8")), {
      "github-token": secretValue,
    });

    const listResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "manage_themis_secret",
        arguments: {
          action: "list",
        },
      },
    }));

    assert.ok(listResponse);
    const listPayload = JSON.parse(listResponse);
    assert.equal(listPayload.result?.isError, false);
    assert.deepEqual(listPayload.result?.structuredContent?.secretRefs, ["github-token"]);

    const getResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "manage_themis_secret",
        arguments: {
          action: "get",
          secretRef: "github-token",
        },
      },
    }));

    assert.ok(getResponse);
    const getPayload = JSON.parse(getResponse);
    assert.equal(getPayload.result?.isError, false);
    assert.equal(getPayload.result?.structuredContent?.exists, true);
    assert.doesNotMatch(JSON.stringify(getPayload), new RegExp(secretValue));

    const renameResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "manage_themis_secret",
        arguments: {
          action: "rename",
          secretRef: "github-token",
          newSecretRef: "github-worker-token",
        },
      },
    }));

    assert.ok(renameResponse);
    const renamePayload = JSON.parse(renameResponse);
    assert.equal(renamePayload.result?.isError, false);
    assert.equal(renamePayload.result?.structuredContent?.renamed, true);
    assert.deepEqual(JSON.parse(readFileSync(themisSecretStoreFile, "utf8")), {
      "github-worker-token": secretValue,
    });
    assert.doesNotMatch(JSON.stringify(renamePayload), new RegExp(secretValue));

    const removeResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: {
        name: "manage_themis_secret",
        arguments: {
          action: "remove",
          secretRef: "github-worker-token",
        },
      },
    }));

    assert.ok(removeResponse);
    const removePayload = JSON.parse(removeResponse);
    assert.equal(removePayload.result?.isError, false);
    assert.equal(removePayload.result?.structuredContent?.removed, true);
    assert.deepEqual(JSON.parse(readFileSync(themisSecretStoreFile, "utf8")), {});
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 密码本工具拒绝未知 token 参数", async () => {
  const workspace = createWorkspace("themis-mcp-secret-book-token-arg");
  const server = new ThemisMcpServer({
    workingDirectory: workspace,
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
      id: 35,
      method: "tools/call",
      params: {
        name: "manage_themis_secret",
        arguments: {
          action: "set",
          secretRef: "github-token",
          token: "should-not-be-accepted",
        },
      },
    }));

    assert.ok(response);
    const payload = JSON.parse(response);
    assert.equal(payload.result?.isError, true);
    assert.match(payload.result?.content?.[0]?.text ?? "", /token is not allowed/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 能用管理 token 准备 Cloudflare worker secret 且不回显 token", async () => {
  const workspace = createWorkspace("themis-mcp-cloudflare-secret");
  const workerSecretStoreFile = resolve(workspace, "infra/local/worker-secrets.json");
  const themisSecretStoreFile = resolve(workspace, "infra/local/themis-secrets.json");
  const accountId = "0123456789abcdef0123456789abcdef";
  writeFileSync(themisSecretStoreFile, `${JSON.stringify({
    "cloudflare-account-id": accountId,
  }, null, 2)}\n`, "utf8");
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, method, body });

    if (url.endsWith(`/accounts/${accountId}/tokens/permission_groups`)) {
      return jsonResponse({
        success: true,
        result: [
          {
            id: "permission-zone-read",
            name: "Zone Read",
            scopes: ["com.cloudflare.api.account.zone"],
          },
          {
            id: "permission-dns-read",
            name: "DNS Read",
            scopes: ["com.cloudflare.api.account.zone"],
          },
        ],
      });
    }

    if (url.includes("/zones?")) {
      const parsed = new URL(url);
      const domain = parsed.searchParams.get("name");
      return jsonResponse({
        success: true,
        result: domain === "novelrift.com"
          ? [{
              id: "zone-novelrift",
              name: "novelrift.com",
            }]
          : [],
      });
    }

    if (url.endsWith(`/accounts/${accountId}/tokens`) && method === "POST") {
      assert.ok(body);
      const parsedBody = JSON.parse(body) as {
        name?: string;
        policies?: Array<{
          effect?: string;
          resources?: Record<string, string>;
          permission_groups?: Array<{ id?: string; name?: string }>;
        }>;
      };
      assert.match(parsedBody.name ?? "", /^themis-worker-cloudflare-readonly-token-/);
      assert.equal(parsedBody.policies?.[0]?.effect, "allow");
      assert.deepEqual(parsedBody.policies?.[0]?.resources, {
        "com.cloudflare.api.account.zone.zone-novelrift": "*",
      });
      assert.deepEqual(parsedBody.policies?.[0]?.permission_groups, [
        { id: "permission-zone-read", name: "Zone Read" },
        { id: "permission-dns-read", name: "DNS Read" },
      ]);

      return jsonResponse({
        success: true,
        result: {
          id: "created-token-id",
          name: parsedBody.name,
          value: "generated-worker-token-secret",
        },
      });
    }

    return jsonResponse({
      success: false,
      errors: [{ message: `unexpected ${method} ${url}` }],
    }, 404);
  };
  const server = new ThemisMcpServer({
    workingDirectory: workspace,
    env: {
      ...process.env,
      THEMIS_CLOUDFLARE_MANAGEMENT_TOKEN: "management-token-secret",
      THEMIS_SECRET_STORE_FILE: themisSecretStoreFile,
      THEMIS_MANAGED_AGENT_WORKER_SECRET_STORE_FILE: workerSecretStoreFile,
    },
    fetchImpl,
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
      id: 3,
      method: "tools/call",
      params: {
        name: "provision_cloudflare_worker_secret",
        arguments: {
          domains: ["novelrift.com"],
        },
      },
    }));

    assert.ok(response);
    const payload = JSON.parse(response);
    assert.equal(payload.result?.isError, false);
    assert.equal(payload.result?.structuredContent?.result?.status, "provisioned");
    assert.equal(payload.result?.structuredContent?.result?.source, "cloudflare_management_token");
    assert.equal(payload.result?.structuredContent?.result?.secretRef, "cloudflare-readonly-token");
    assert.equal(payload.result?.structuredContent?.result?.envName, "CLOUDFLARE_API_TOKEN");
    assert.equal(payload.result?.structuredContent?.result?.written, true);
    assert.equal(payload.result?.structuredContent?.result?.cloudflareTokenEndpoint, "account");
    assert.equal(payload.result?.structuredContent?.result?.accountIdConfigured, true);

    const responseText = JSON.stringify(payload);
    assert.doesNotMatch(responseText, /generated-worker-token-secret/);
    assert.doesNotMatch(responseText, /management-token-secret/);
    assert.doesNotMatch(responseText, new RegExp(accountId));
    assert.deepEqual(JSON.parse(readFileSync(workerSecretStoreFile, "utf8")), {
      "cloudflare-readonly-token": "generated-worker-token-secret",
    });
    assert.equal(calls.some((call) => call.url.endsWith(`/accounts/${accountId}/tokens`) && call.method === "POST"), true);
    assert.equal(calls.some((call) => call.url.endsWith("/user/tokens") || call.url.endsWith("/user/tokens/permission_groups")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 使用 Cloudflare 管理 token 时要求配置 accountId", async () => {
  const workspace = createWorkspace("themis-mcp-cloudflare-secret-missing-account");
  const workerSecretStoreFile = resolve(workspace, "infra/local/worker-secrets.json");
  const calls: string[] = [];
  const server = new ThemisMcpServer({
    workingDirectory: workspace,
    env: {
      ...process.env,
      THEMIS_CLOUDFLARE_MANAGEMENT_TOKEN: "management-token-secret",
      THEMIS_SECRET_STORE_FILE: resolve(workspace, "infra/local/themis-secrets.json"),
      THEMIS_MANAGED_AGENT_WORKER_SECRET_STORE_FILE: workerSecretStoreFile,
      THEMIS_CLOUDFLARE_ACCOUNT_ID: undefined,
      CLOUDFLARE_ACCOUNT_ID: undefined,
    },
    fetchImpl: async (input) => {
      calls.push(String(input));
      return jsonResponse({ success: true, result: [] });
    },
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
      id: 3,
      method: "tools/call",
      params: {
        name: "provision_cloudflare_worker_secret",
        arguments: {
          domains: ["novelrift.com"],
        },
      },
    }));

    assert.ok(response);
    const payload = JSON.parse(response);
    assert.equal(payload.result?.isError, true);
    assert.match(payload.result?.content?.[0]?.text ?? "", /cloudflare-account-id/);
    assert.deepEqual(calls, []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 拒绝在 Cloudflare secret provision 参数中夹带 token", async () => {
  const workspace = createWorkspace("themis-mcp-cloudflare-secret-token-arg");
  const server = new ThemisMcpServer({
    workingDirectory: workspace,
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
      id: 4,
      method: "tools/call",
      params: {
        name: "provision_cloudflare_worker_secret",
        arguments: {
          domains: ["novelrift.com"],
          token: "should-not-be-accepted",
        },
      },
    }));

    assert.ok(response);
    const payload = JSON.parse(response);
    assert.equal(payload.result?.isError, true);
    assert.match(payload.result?.content?.[0]?.text ?? "", /token is not allowed/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 支持机器原生运营对象、关系边、对象图和老板视图闭环", async () => {
  const workspace = createWorkspace("themis-mcp-operations");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const server = new ThemisMcpServer({
    registry,
    identity: {
      channel: "web",
      channelUserId: "operations-owner-1",
      displayName: "Operations Owner",
    },
  });

  try {
    await initializeServer(server);
    const createAssetResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "create_operation_object",
        arguments: {
          objectType: "asset",
          fields: {
            kind: "service",
            name: "Themis 运营中枢",
            status: "active",
            summary: "数字公司运营对象账本。",
            tags: ["operations", "machine-native"],
          },
        },
      },
    }));

    assert.ok(createAssetResponse);
    const createAssetPayload = JSON.parse(createAssetResponse);
    assert.equal(createAssetPayload.result?.isError, false);
    const assetId = createAssetPayload.result?.structuredContent?.object?.assetId;
    assert.equal(typeof assetId, "string");

    const createDecisionResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "create_operation_object",
        arguments: {
          objectType: "decision",
          fields: {
            title: "运营系统机器优先",
            status: "active",
            summary: "Themis 和数字员工是主使用者，人类只负责观测和刹车。",
            relatedAssetIds: [assetId],
          },
        },
      },
    }));

    assert.ok(createDecisionResponse);
    const createDecisionPayload = JSON.parse(createDecisionResponse);
    assert.equal(createDecisionPayload.result?.isError, false);
    const decisionId = createDecisionPayload.result?.structuredContent?.object?.decisionId;
    assert.equal(typeof decisionId, "string");

    const createCommitmentResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "create_operation_object",
        arguments: {
          objectType: "commitment",
          fields: {
            title: "让 Themis 会用运营中枢",
            status: "active",
            dueAt: "2026-04-30T00:00:00.000Z",
            progressPercent: 10,
            summary: "补齐机器可调用的运营对象工具面。",
            relatedAssetIds: [assetId],
            linkedDecisionIds: [decisionId],
            relatedWorkItemIds: ["work-item-operations-mcp"],
            milestones: [{
              title: "MCP 工具闭环",
              status: "in_progress",
              dueAt: "2026-04-29T00:00:00.000Z",
              evidenceRefs: [],
            }],
            evidenceRefs: [{
              kind: "work_item",
              value: "work-item-operations-mcp",
              label: "MCP 工具实现任务",
            }],
          },
        },
      },
    }));

    assert.ok(createCommitmentResponse);
    const createCommitmentPayload = JSON.parse(createCommitmentResponse);
    assert.equal(createCommitmentPayload.result?.isError, false);
    const commitmentId = createCommitmentPayload.result?.structuredContent?.object?.commitmentId;
    assert.equal(typeof commitmentId, "string");
    assert.equal(createCommitmentPayload.result?.structuredContent?.object?.milestones?.[0]?.status, "in_progress");

    const listCommitmentsResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "list_operation_objects",
        arguments: {
          objectType: "commitment",
          status: "active",
        },
      },
    }));

    assert.ok(listCommitmentsResponse);
    const listCommitmentsPayload = JSON.parse(listCommitmentsResponse);
    assert.equal(listCommitmentsPayload.result?.isError, false);
    assert.equal(listCommitmentsPayload.result?.structuredContent?.objects?.length, 1);
    assert.equal(listCommitmentsPayload.result?.structuredContent?.objects?.[0]?.commitmentId, commitmentId);
    assert.equal(listCommitmentsPayload.result?.structuredContent?.objects?.[0]?.milestones?.[0]?.status, "in_progress");

    const listEdgesResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "list_operation_edges",
        arguments: {
          status: "active",
        },
      },
    }));

    assert.ok(listEdgesResponse);
    const listEdgesPayload = JSON.parse(listEdgesResponse);
    assert.equal(listEdgesPayload.result?.isError, false);
    const edgeKeys = listEdgesPayload.result?.structuredContent?.edges?.map((edge: {
      fromObjectType: string;
      fromObjectId: string;
      relationType: string;
      toObjectType: string;
      toObjectId: string;
    }) => `${edge.fromObjectType}:${edge.fromObjectId}:${edge.relationType}:${edge.toObjectType}:${edge.toObjectId}`);
    assert.ok(edgeKeys.includes(`commitment:${commitmentId}:relates_to:asset:${assetId}`));
    assert.ok(edgeKeys.includes(`commitment:${commitmentId}:depends_on:decision:${decisionId}`));
    assert.ok(edgeKeys.includes(`work_item:work-item-operations-mcp:evidence_for:commitment:${commitmentId}`));

    const graphResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: "query_operation_graph",
        arguments: {
          rootObjectType: "commitment",
          rootObjectId: commitmentId,
          targetObjectType: "asset",
          targetObjectId: assetId,
          maxDepth: 2,
        },
      },
    }));

    assert.ok(graphResponse);
    const graphPayload = JSON.parse(graphResponse);
    assert.equal(graphPayload.result?.isError, false);
    assert.equal(graphPayload.result?.structuredContent?.graph?.target?.reachable, true);
    assert.equal(graphPayload.result?.structuredContent?.graph?.shortestPath?.length, 1);

    const bossViewResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: {
        name: "get_operations_boss_view",
        arguments: {},
      },
    }));

    assert.ok(bossViewResponse);
    const bossViewPayload = JSON.parse(bossViewResponse);
    assert.equal(bossViewPayload.result?.isError, false);
    assert.equal(bossViewPayload.result?.structuredContent?.bossView?.inventory?.assets?.active, 1);
    assert.equal(bossViewPayload.result?.structuredContent?.bossView?.inventory?.commitments?.active, 1);
    assert.equal(bossViewPayload.result?.structuredContent?.bossView?.inventory?.decisions?.active, 1);
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
          watch: {
            workItemId: "work-item-watch-1",
          },
        },
      },
    }));

    assert.ok(createResponse);
    const createPayload = JSON.parse(createResponse);
    assert.equal(createPayload.result?.isError, false);
    const createdTaskId = createPayload.result?.structuredContent?.task?.scheduledTaskId;
    assert.equal(typeof createdTaskId, "string");
    assert.equal(createPayload.result?.structuredContent?.task?.goal, "五分钟后检查 staging 日志");
    assert.equal(createPayload.result?.structuredContent?.task?.watch?.workItemId, "work-item-watch-1");

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
    assert.equal(listPayload.result?.structuredContent?.tasks?.[0]?.watch?.workItemId, "work-item-watch-1");

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
            secretEnvRefs: [{
              envName: "CLOUDFLARE_API_TOKEN",
              secretRef: "cloudflare-readonly-token",
              required: true,
            }],
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
    assert.deepEqual(boundaryPayload.result?.structuredContent?.runtimeProfile?.secretEnvRefs, [{
      envName: "CLOUDFLARE_API_TOKEN",
      secretRef: "cloudflare-readonly-token",
      required: true,
    }]);

    const serviceWorkspaceResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 11.5,
      method: "tools/call",
      params: {
        name: "update_managed_agent_execution_boundary",
        arguments: {
          agentId,
          workspacePolicy: {
            workspacePath: workspace,
          },
        },
      },
    }));

    assert.ok(serviceWorkspaceResponse);
    const serviceWorkspacePayload = JSON.parse(serviceWorkspaceResponse);
    assert.equal(serviceWorkspacePayload.result?.isError, true);
    assert.match(
      serviceWorkspacePayload.result?.content?.[0]?.text ?? "",
      /员工工作区不能直接设置为当前 Themis 服务目录/,
    );

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

    const dispatchWithSecretValueResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 12.5,
      method: "tools/call",
      params: {
        name: "dispatch_work_item",
        arguments: {
          targetAgentId: agentId,
          dispatchReason: "验证 secret 引用",
          goal: "只允许传 secret 引用。",
          runtimeProfileSnapshot: {
            secretEnvRefs: [{
              envName: "CLOUDFLARE_API_TOKEN",
              secretRef: "cloudflare-readonly-token",
              value: "cf-secret-value",
            }],
          },
        },
      },
    }));

    assert.ok(dispatchWithSecretValueResponse);
    const dispatchWithSecretValuePayload = JSON.parse(dispatchWithSecretValueResponse);
    assert.equal(dispatchWithSecretValuePayload.result?.isError, true);
    assert.match(
      dispatchWithSecretValuePayload.result?.content?.[0]?.text ?? "",
      /secretEnvRefs.*value/i,
    );

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

test("Themis MCP server 会在唯一 organization 下自动带上 organizationId 创建员工", async () => {
  const workspace = createWorkspace("themis-mcp-create-agent-default-org");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const capturedInputs: Array<Record<string, unknown>> = [];
  const managedAgentControlPlaneFacade = {
    async listManagedAgents() {
      return {
        organizations: [{
          organizationId: "org-platform",
          ownerPrincipalId: "owner-user-1",
          displayName: "Platform Org",
          slug: "platform-org",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        }],
        agents: [],
      };
    },
    async getManagedAgentDetailView() {
      return null;
    },
    async createManagedAgent(input: Record<string, unknown>) {
      capturedInputs.push(input);
      return {
        organization: {
          organizationId: "org-platform",
          ownerPrincipalId: "owner-user-1",
          displayName: "Platform Org",
          slug: "platform-org",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        },
        principal: {
          principalId: "principal-agent-alpha",
          organizationId: "org-platform",
          displayName: "平台负责人",
          kind: "managed_agent",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        },
        agent: {
          agentId: "agent-alpha",
          principalId: "principal-agent-alpha",
          organizationId: "org-platform",
          displayName: "平台负责人",
          departmentRole: "Platform",
          mission: "负责平台默认组织。",
          status: "active",
          createdByPrincipalId: "owner-user-1",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        },
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
    const createResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 12.6,
      method: "tools/call",
      params: {
        name: "create_managed_agent",
        arguments: {
          departmentRole: "Platform",
          displayName: "平台负责人",
          mission: "负责平台默认组织。",
        },
      },
    }));

    assert.ok(createResponse);
    const createPayload = JSON.parse(createResponse);
    assert.equal(createPayload.result?.isError, false);
    assert.equal(capturedInputs[0]?.organizationId, "org-platform");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Themis MCP server 会在指定 supervisor 时沿用其 organizationId 创建员工", async () => {
  const workspace = createWorkspace("themis-mcp-create-agent-supervisor-org");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: resolve(workspace, "infra/local/themis.db"),
  });
  const capturedInputs: Array<Record<string, unknown>> = [];
  const managedAgentControlPlaneFacade = {
    async listManagedAgents() {
      return {
        organizations: [{
          organizationId: "org-alpha",
          ownerPrincipalId: "owner-user-1",
          displayName: "Alpha Org",
          slug: "alpha-org",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        }, {
          organizationId: "org-beta",
          ownerPrincipalId: "owner-user-1",
          displayName: "Beta Org",
          slug: "beta-org",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        }],
        agents: [],
      };
    },
    async getManagedAgentDetailView(_ownerPrincipalId: string, agentId: string) {
      if (agentId !== "agent-supervisor") {
        return null;
      }

      return {
        organization: {
          organizationId: "org-beta",
          ownerPrincipalId: "owner-user-1",
          displayName: "Beta Org",
          slug: "beta-org",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        },
        principal: {
          principalId: "principal-agent-supervisor",
          organizationId: "org-beta",
          displayName: "监督负责人",
          kind: "managed_agent",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        },
        agent: {
          agentId: "agent-supervisor",
          principalId: "principal-agent-supervisor",
          organizationId: "org-beta",
          displayName: "监督负责人",
          departmentRole: "Platform",
          mission: "负责监督子员工。",
          status: "active",
          createdByPrincipalId: "owner-user-1",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        },
        workspacePolicy: null,
        runtimeProfile: null,
        authAccounts: [],
        thirdPartyProviders: [],
      };
    },
    async createManagedAgent(input: Record<string, unknown>) {
      capturedInputs.push(input);
      return {
        organization: {
          organizationId: "org-beta",
          ownerPrincipalId: "owner-user-1",
          displayName: "Beta Org",
          slug: "beta-org",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        },
        principal: {
          principalId: "principal-agent-child",
          organizationId: "org-beta",
          displayName: "子员工",
          kind: "managed_agent",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
        },
        agent: {
          agentId: "agent-child",
          principalId: "principal-agent-child",
          organizationId: "org-beta",
          displayName: "子员工",
          departmentRole: "Support",
          mission: "负责辅助监督负责人。",
          status: "active",
          createdByPrincipalId: "owner-user-1",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:00:00.000Z",
          supervisorPrincipalId: "principal-agent-supervisor",
        },
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
    const createResponse = await server.handleMessage(JSON.stringify({
      jsonrpc: "2.0",
      id: 12.7,
      method: "tools/call",
      params: {
        name: "create_managed_agent",
        arguments: {
          departmentRole: "Support",
          displayName: "子员工",
          mission: "负责辅助监督负责人。",
          supervisorAgentId: "agent-supervisor",
        },
      },
    }));

    assert.ok(createResponse);
    const createPayload = JSON.parse(createResponse);
    assert.equal(createPayload.result?.isError, false);
    assert.equal(capturedInputs[0]?.organizationId, "org-beta");
    assert.equal(capturedInputs[0]?.supervisorAgentId, "agent-supervisor");
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
