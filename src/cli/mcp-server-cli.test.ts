import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntryPath = resolve(repoRoot, "src/cli/main.ts");
const tsxBinaryPath = resolve(repoRoot, "node_modules/.bin/tsx");

function createWorkspace(): string {
  const workspace = resolve(tmpdir(), `themis-mcp-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(resolve(workspace, "infra", "local"), { recursive: true });
  return workspace;
}

async function readJsonLine(reader: ReturnType<typeof createInterface>): Promise<Record<string, unknown>> {
  const linePromise = once(reader, "line").then(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error("等待 MCP 响应超时。"));
    }, 10_000);
  });

  return await Promise.race([linePromise, timeoutPromise]);
}

test("themis mcp-server 会通过 stdio 暴露定时任务工具", async () => {
  const workspace = createWorkspace();
  const child = spawn(tsxBinaryPath, [cliEntryPath, "mcp-server", "--user", "cli-tester"], {
    cwd: workspace,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const reader = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "themis-cli-test",
          version: "1.0.0",
        },
      },
    })}\n`);

    const initializePayload = await readJsonLine(reader);
    const initializeResult = initializePayload.result as Record<string, unknown> | undefined;
    assert.equal(initializeResult?.protocolVersion, "2025-06-18");

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    })}\n`);

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })}\n`);

    const toolsPayload = await readJsonLine(reader);
    const toolsResult = toolsPayload.result as { tools?: Array<{ name: string }> } | undefined;
    const toolNames = Array.isArray(toolsResult?.tools)
      ? toolsResult.tools.map((tool) => tool.name)
      : [];
    assert.ok(toolNames.includes("create_scheduled_task"));
    assert.ok(toolNames.includes("dispatch_work_item"));
    assert.ok(toolNames.includes("create_operation_object"));
    assert.ok(toolNames.includes("query_operation_graph"));
    assert.ok(toolNames.includes("get_operations_boss_view"));

    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "create_scheduled_task",
        arguments: {
          goal: "明天上午九点检查发布队列",
          scheduledAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          timezone: "Asia/Shanghai",
        },
      },
    })}\n`);

    const createPayload = await readJsonLine(reader);
    const createResult = createPayload.result as {
      isError?: boolean;
      structuredContent?: {
        task?: {
          scheduledTaskId?: unknown;
        };
      };
    } | undefined;
    assert.equal(createResult?.isError, false);
    assert.equal(typeof createResult?.structuredContent?.task?.scheduledTaskId, "string");
  } finally {
    reader.close();
    child.stdin.end();
    await once(child, "close");
    rmSync(workspace, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});
