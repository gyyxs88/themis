import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

test("GET /api/updates 会返回更新概览", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-updates-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const updateService = {
    async readOverview() {
      return {
        check: {
          packageVersion: "0.1.0",
          currentCommit: "1234567890abcdef",
          currentBranch: "main",
          currentCommitSource: "git",
          updateChannel: "release",
          updateSourceRepo: "gyyxs88/themis",
          updateSourceUrl: "https://github.com/gyyxs88/themis",
          updateSourceDefaultBranch: "main",
          latestCommit: "abcdef1234567890",
          latestCommitDate: "2026-04-11T00:00:00.000Z",
          latestCommitUrl: "https://github.com/gyyxs88/themis/commit/abcdef1234567890",
          latestReleaseTag: "v0.1.0",
          latestReleaseName: "v0.1.0",
          latestReleasePublishedAt: "2026-04-11T00:00:00.000Z",
          latestReleaseUrl: "https://github.com/gyyxs88/themis/releases/tag/v0.1.0",
          comparisonStatus: "identical",
          outcome: "up_to_date",
          summary: "当前已经是 GitHub 最新正式 release。",
          errorMessage: null,
        },
        operation: null,
        rollbackAnchor: {
          available: false,
          previousCommit: null,
          currentCommit: null,
          appliedReleaseTag: null,
          recordedAt: null,
        },
      };
    },
  };
  const server = createThemisHttpServer({
    runtime,
    updateService: updateService as never,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const response = await fetch(`${baseUrl}/api/updates`, {
      headers,
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      check?: {
        updateChannel?: string;
        latestReleaseTag?: string | null;
      };
      rollbackAnchor?: {
        available?: boolean;
      };
    };
    assert.equal(payload.check?.updateChannel, "release");
    assert.equal(payload.check?.latestReleaseTag, "v0.1.0");
    assert.equal(payload.rollbackAnchor?.available, false);
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("POST /api/updates/apply 会在确认后启动后台升级", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-updates-apply-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const calls: Array<{ action: string; initiatedBy?: { channel?: string; displayName?: string | null } }> = [];
  const updateService = {
    async readOverview() {
      throw new Error("not used");
    },
    async startApply(input: { initiatedBy: { channel: string; displayName?: string | null } }) {
      calls.push({
        action: "apply",
        initiatedBy: input.initiatedBy,
      });
      return {
        action: "apply",
        status: "running",
        startedAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z",
        finishedAt: null,
        initiatedBy: {
          channel: "web",
          channelUserId: "themis-web-owner",
          displayName: "Themis Web",
          chatId: null,
        },
        progressStep: "preflight",
        progressMessage: "已受理后台升级请求，正在准备执行。",
        result: null,
        errorMessage: null,
      };
    },
  };
  const server = createThemisHttpServer({
    runtime,
    updateService: updateService as never,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const response = await fetch(`${baseUrl}/api/updates/apply`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirm: true,
      }),
    });

    assert.equal(response.status, 202);
    const payload = await response.json() as {
      ok?: boolean;
      operation?: {
        action?: string;
        status?: string;
      };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.operation?.action, "apply");
    assert.equal(payload.operation?.status, "running");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.initiatedBy?.channel, "web");
    assert.equal(calls[0]?.initiatedBy?.displayName, "Themis Web");
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("POST /api/updates/rollback 缺少 confirm 会返回 400", async () => {
  const root = mkdtempSync(join(tmpdir(), "themis-http-updates-rollback-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const updateService = {
    async readOverview() {
      throw new Error("not used");
    },
    async startRollback() {
      throw new Error("not used");
    },
  };
  const server = createThemisHttpServer({
    runtime,
    updateService: updateService as never,
  });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const headers = await createAuthenticatedWebHeaders({
      baseUrl,
      runtimeStore,
    });
    const response = await fetch(`${baseUrl}/api/updates/rollback`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "INVALID_REQUEST",
        message: "后台回滚请求缺少确认标记；请确认后再试。",
      },
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
});

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
