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
  const root = mkdtempSync(join(tmpdir(), "themis-http-operations-cadences-"));
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

test("POST /api/operations/cadences/create|list|update 会维护当前 principal 的节奏记录", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const createResponse = await postJson(baseUrl, "/api/operations/cadences/create", {
      ...buildIdentityPayload("owner-cadences-http"),
      cadence: {
        title: "prod-web 周检",
        frequency: "weekly",
        status: "active",
        nextRunAt: "2026-04-28T01:00:00.000Z",
        ownerPrincipalId: "principal-owner",
        playbookRef: "docs/runbooks/prod-web-weekly-check.md",
        summary: "检查 uptime、证书和备份状态",
        relatedAssetIds: ["asset-ledger-1"],
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as {
      cadence?: {
        cadenceId?: string;
        title?: string;
        playbookRef?: string;
      };
    };
    assert.ok(created.cadence?.cadenceId);
    assert.equal(created.cadence?.title, "prod-web 周检");
    assert.equal(created.cadence?.playbookRef, "docs/runbooks/prod-web-weekly-check.md");

    const listResponse = await postJson(baseUrl, "/api/operations/cadences/list", {
      ...buildIdentityPayload("owner-cadences-http"),
      status: "active",
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json() as {
      cadences?: Array<{
        cadenceId?: string;
        principalId?: string;
        title?: string;
        frequency?: string;
        status?: string;
        ownerPrincipalId?: string;
        relatedAssetIds?: string[];
      }>;
    };
    assert.equal(listed.cadences?.length, 1);
    assert.equal(listed.cadences?.[0]?.cadenceId, created.cadence?.cadenceId);
    assert.equal(listed.cadences?.[0]?.frequency, "weekly");
    assert.equal(listed.cadences?.[0]?.status, "active");
    assert.equal(listed.cadences?.[0]?.ownerPrincipalId, "principal-owner");

    const updateResponse = await postJson(baseUrl, "/api/operations/cadences/update", {
      ...buildIdentityPayload("owner-cadences-http"),
      cadence: {
        cadenceId: created.cadence?.cadenceId,
        title: "prod-web 月检",
        frequency: "monthly",
        status: "paused",
        nextRunAt: "2026-05-01T01:00:00.000Z",
        ownerPrincipalId: "",
        playbookRef: "",
        summary: "",
        relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
      },
    }, authHeaders);

    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json() as {
      cadence?: {
        frequency?: string;
        status?: string;
        ownerPrincipalId?: string;
        playbookRef?: string;
        summary?: string;
        relatedAssetIds?: string[];
      };
    };
    assert.equal(updated.cadence?.frequency, "monthly");
    assert.equal(updated.cadence?.status, "paused");
    assert.equal(updated.cadence?.ownerPrincipalId, undefined);
    assert.equal(updated.cadence?.playbookRef, undefined);
    assert.equal(updated.cadence?.summary, undefined);
    assert.deepEqual(updated.cadence?.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);
  });
});

test("POST /api/operations/cadences/update 在缺少 cadenceId 时返回客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const response = await postJson(baseUrl, "/api/operations/cadences/update", {
      ...buildIdentityPayload("owner-cadences-http-missing-id"),
      cadence: {
        title: "缺 cadenceId",
        frequency: "weekly",
        status: "active",
      },
    }, authHeaders);

    assert.equal(response.status, 400);
    const payload = await response.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "节奏更新请求缺少 cadenceId。");
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
