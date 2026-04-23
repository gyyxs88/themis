import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

interface TestServerContext {
  baseUrl: string;
  runtime: AppServerTaskRuntime;
  runtimeStore: SqliteCodexSessionRegistry;
}

function buildIdentityPayload(channelUserId: string): {
  channel: string;
  channelUserId: string;
  displayName: string;
} {
  return {
    channel: "web",
    channelUserId,
    displayName: "Owner",
  };
}

async function withHttpServer(run: (context: TestServerContext) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-operations-boss-view-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const runtime = new AppServerTaskRuntime({
    workingDirectory: root,
    runtimeStore,
  });
  const server = createThemisHttpServer({ runtime });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  try {
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      runtime,
      runtimeStore,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

async function postJson(
  baseUrl: string,
  pathname: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

test("POST /api/operations/boss-view 会返回当前 principal 的运营老板视图", async () => {
  await withHttpServer(async ({ baseUrl, runtime, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const identityPayload = buildIdentityPayload("owner-boss-view-http");
    const identity = runtime.getIdentityLinkService().ensureIdentity(identityPayload);

    runtime.getPrincipalAssetsService().createAsset({
      principalId: identity.principalId,
      assetId: "asset-prod-web",
      kind: "site",
      name: "prod-web",
      status: "watch",
      now: "2026-04-23T01:00:00.000Z",
    });
    runtime.getPrincipalRisksService().createRisk({
      principalId: identity.principalId,
      riskId: "risk-prod-web-cpu",
      type: "incident",
      title: "prod-web CPU 突增",
      severity: "critical",
      status: "open",
      relatedAssetIds: ["asset-prod-web"],
      now: "2026-04-23T02:00:00.000Z",
    });
    runtime.getPrincipalCadencesService().createCadence({
      principalId: identity.principalId,
      cadenceId: "cadence-prod-web-weekly",
      title: "prod-web 周检",
      frequency: "weekly",
      status: "active",
      nextRunAt: "2026-04-22T01:00:00.000Z",
      now: "2026-04-23T02:30:00.000Z",
    });

    const response = await postJson(baseUrl, "/api/operations/boss-view", {
      ...identityPayload,
      now: "2026-04-23T08:00:00.000Z",
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      bossView?: {
        headline?: { tone?: string; title?: string };
        inventory?: { risks?: { highOrCriticalOpen?: number }; cadences?: { overdue?: number } };
        focusItems?: Array<{ title?: string; actionLabel?: string }>;
      };
    };

    assert.equal(payload.bossView?.headline?.tone, "red");
    assert.equal(payload.bossView?.headline?.title, "今天先处理红灯");
    assert.equal(payload.bossView?.inventory?.risks?.highOrCriticalOpen, 1);
    assert.equal(payload.bossView?.inventory?.cadences?.overdue, 1);
    assert.equal(payload.bossView?.focusItems?.[0]?.title, "prod-web CPU 突增");
    assert.equal(payload.bossView?.focusItems?.[0]?.actionLabel, "确认 owner / 缓解动作");
  });
});

test("POST /api/operations/boss-view 在缺少身份时返回客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const response = await postJson(baseUrl, "/api/operations/boss-view", {
      channel: "web",
    }, authHeaders);

    assert.equal(response.status, 400);
    const payload = await response.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "身份请求缺少必要字段。");
  });
});

async function listenServer(server: Server): Promise<Server> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
