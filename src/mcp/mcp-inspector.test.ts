import assert from "node:assert/strict";
import test from "node:test";
import { McpInspector } from "./mcp-inspector.js";

test("McpInspector 会归一化 mcpServerStatus/list，并用 reload + list 作为 probe", async () => {
  const calls: string[] = [];
  const inspector = new McpInspector({
    workingDirectory: "/tmp/demo",
    createSession: async () => ({
      initialize: async () => {},
      request: async (method: string) => {
        calls.push(method);

        if (method === "mcpServerStatus/list") {
          return {
            data: [
              {
                id: "context7",
                name: "Context 7",
                status: "healthy",
                transport: "stdio",
              },
            ],
          };
        }

        if (method === "config/mcpServer/reload") {
          return { ok: true };
        }

        throw new Error(`unexpected method: ${method}`);
      },
      close: async () => {},
    }) as never,
  });

  const listed = await inspector.list();
  const reloaded = await inspector.reload();
  const probed = await inspector.probe();

  assert.equal(listed.servers[0]?.id, "context7");
  assert.equal(listed.servers[0]?.name, "Context 7");
  assert.equal(reloaded.servers[0]?.status, "healthy");
  assert.equal(probed.servers[0]?.status, "healthy");
  assert.deepEqual(calls, [
    "mcpServerStatus/list",
    "config/mcpServer/reload",
    "mcpServerStatus/list",
    "config/mcpServer/reload",
    "mcpServerStatus/list",
  ]);
});

test("McpInspector 在字段缺失时会降级到 unknown", async () => {
  const inspector = new McpInspector({
    workingDirectory: "/tmp/demo",
    createSession: async () => ({
      initialize: async () => {},
      request: async () => ({
        data: [
          {
            id: null,
            name: 42,
            status: undefined,
          },
        ],
      }),
      close: async () => {},
    }) as never,
  });

  const listed = await inspector.list();

  assert.deepEqual(listed.servers, [
    {
      id: "unknown",
      name: "unknown",
      status: "unknown",
    },
  ]);
});
