import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkerNodeDiagnosticsService } from "./worker-node-diagnostics.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

test("WorkerNodeDiagnosticsService 会识别本地缺失的 workspace / credential / provider 能力", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-worker-node-diagnostics-missing-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });

  try {
    const service = new WorkerNodeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
    });
    const summary = await service.readSummary({
      workspaceCapabilities: ["workspace/relative", join(root, "missing-workspace")],
      credentialCapabilities: ["default"],
      providerCapabilities: ["provider-missing"],
    });

    assert.equal(summary.workspaces[0]?.status, "relative");
    assert.equal(summary.workspaces[1]?.status, "missing");
    assert.equal(summary.credentials[0]?.status, "missing");
    assert.equal(summary.providers[0]?.status, "missing");
    assert.equal(summary.platform.status, "skipped");
    assert.equal(summary.primaryDiagnosis.id, "workspace_capability_invalid");
    assert.ok(summary.recommendedNextSteps.some((step) => step.includes("--workspace")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("WorkerNodeDiagnosticsService 会探测平台可达性并汇总本地 ok 状态", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-worker-node-diagnostics-platform-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  let server: ReturnType<typeof createServer> | null = null;

  try {
    const workspacePath = join(root, "workspace/worker-a");
    mkdirSync(workspacePath, { recursive: true });
    runtimeStore.saveAuthAccount({
      accountId: "default",
      label: "默认账号",
      codexHome: join(root, "infra/local/codex-auth/default"),
      isActive: true,
      createdAt: "2026-04-12T08:10:00.000Z",
      updatedAt: "2026-04-12T08:10:00.000Z",
    });
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "POST" && url.pathname === "/api/web-auth/login") {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "themis_web_session=session-worker-node-diagnostics; Path=/; HttpOnly",
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/platform/nodes/list") {
        res.writeHead(200, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({
          ok: true,
          nodes: [
            {
              nodeId: "node-worker-a",
            },
          ],
        }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("test server failed to bind");
    }

    const service = new WorkerNodeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
    });
    const summary = await service.readSummary({
      workspaceCapabilities: [workspacePath],
      credentialCapabilities: ["default"],
      providerCapabilities: [],
      platformBaseUrl: `http://127.0.0.1:${address.port}`,
      ownerPrincipalId: "principal-owner",
      webAccessToken: "secret-token",
    });

    assert.equal(summary.workspaces[0]?.status, "ok");
    assert.equal(summary.credentials[0]?.status, "ok");
    assert.equal(summary.platform.status, "ok");
    assert.equal(summary.platform.nodeCount, 1);
    assert.equal(summary.primaryDiagnosis.id, "healthy");
  } finally {
    server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
