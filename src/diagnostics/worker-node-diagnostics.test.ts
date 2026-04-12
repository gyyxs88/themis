import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkerNodeDiagnosticsService } from "./worker-node-diagnostics.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { resolveCodexAuthFilePath, resolveManagedCodexHome } from "../core/auth-accounts.js";

test("WorkerNodeDiagnosticsService 会识别本地缺失的 workspace / credential / provider 能力", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-worker-node-diagnostics-missing-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const originalCodexHome = process.env.CODEX_HOME;

  try {
    process.env.CODEX_HOME = join(root, "missing-codex-home");
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
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
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

      if (req.method === "POST" && url.pathname === "/api/platform/nodes/list") {
        assert.equal(req.headers.authorization, "Bearer secret-token");
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

test("WorkerNodeDiagnosticsService 会把本地已存在 auth.json 的 fresh credential 判定为 ok", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-worker-node-diagnostics-auth-file-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const originalCodexHome = process.env.CODEX_HOME;

  try {
    const defaultCodexHome = join(root, "codex-home-default");
    const opsCodexHome = resolveManagedCodexHome(root, "ops");
    mkdirSync(defaultCodexHome, { recursive: true });
    mkdirSync(opsCodexHome, { recursive: true });
    writeFileSync(resolveCodexAuthFilePath(defaultCodexHome), "{\"token\":\"default\"}", "utf8");
    writeFileSync(resolveCodexAuthFilePath(opsCodexHome), "{\"token\":\"ops\"}", "utf8");
    process.env.CODEX_HOME = defaultCodexHome;

    const service = new WorkerNodeDiagnosticsService({
      workingDirectory: root,
      runtimeStore,
    });
    const summary = await service.readSummary({
      workspaceCapabilities: [],
      credentialCapabilities: ["default", "ops"],
      providerCapabilities: [],
    });

    assert.equal(summary.credentials[0]?.credentialId, "default");
    assert.equal(summary.credentials[0]?.status, "ok");
    assert.equal(summary.credentials[0]?.codexHome, defaultCodexHome);
    assert.equal(summary.credentials[1]?.credentialId, "ops");
    assert.equal(summary.credentials[1]?.status, "ok");
    assert.equal(summary.credentials[1]?.codexHome, opsCodexHome);
    assert.equal(summary.primaryDiagnosis.id, "healthy");
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
