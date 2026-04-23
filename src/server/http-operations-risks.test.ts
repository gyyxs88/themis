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
  const root = mkdtempSync(join(tmpdir(), "themis-http-operations-risks-"));
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

test("POST /api/operations/risks/create|list|update 会维护当前 principal 的风险记录", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const createResponse = await postJson(baseUrl, "/api/operations/risks/create", {
      ...buildIdentityPayload("owner-risks-http"),
      risk: {
        type: "incident",
        title: "prod-web CPU 突增",
        severity: "critical",
        status: "open",
        ownerPrincipalId: "principal-owner",
        summary: "大量请求超时",
        detectedAt: "2026-04-23T15:50:00.000Z",
        relatedAssetIds: ["asset-ledger-1"],
        linkedDecisionIds: ["decision-ledger-1"],
        relatedWorkItemIds: ["work-item-1", "work-item-2"],
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as {
      risk?: {
        riskId?: string;
        title?: string;
        linkedDecisionIds?: string[];
      };
    };
    assert.ok(created.risk?.riskId);
    assert.equal(created.risk?.title, "prod-web CPU 突增");
    assert.deepEqual(created.risk?.linkedDecisionIds, ["decision-ledger-1"]);

    const listResponse = await postJson(baseUrl, "/api/operations/risks/list", {
      ...buildIdentityPayload("owner-risks-http"),
      status: "open",
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json() as {
      risks?: Array<{
        riskId?: string;
        principalId?: string;
        type?: string;
        title?: string;
        severity?: string;
        status?: string;
        ownerPrincipalId?: string;
        linkedDecisionIds?: string[];
      }>;
    };
    assert.equal(listed.risks?.length, 1);
    assert.equal(listed.risks?.[0]?.riskId, created.risk?.riskId);
    assert.equal(listed.risks?.[0]?.type, "incident");
    assert.equal(listed.risks?.[0]?.severity, "critical");
    assert.equal(listed.risks?.[0]?.status, "open");
    assert.equal(listed.risks?.[0]?.ownerPrincipalId, "principal-owner");

    const updateResponse = await postJson(baseUrl, "/api/operations/risks/update", {
      ...buildIdentityPayload("owner-risks-http"),
      risk: {
        riskId: created.risk?.riskId,
        type: "incident",
        title: "prod-web CPU 已恢复",
        severity: "high",
        status: "resolved",
        ownerPrincipalId: "",
        summary: "",
        detectedAt: "2026-04-23T15:50:00.000Z",
        relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
        linkedDecisionIds: ["decision-ledger-2"],
        relatedWorkItemIds: ["work-item-3"],
      },
    }, authHeaders);

    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json() as {
      risk?: {
        severity?: string;
        status?: string;
        ownerPrincipalId?: string;
        summary?: string;
        relatedAssetIds?: string[];
      };
    };
    assert.equal(updated.risk?.severity, "high");
    assert.equal(updated.risk?.status, "resolved");
    assert.equal(updated.risk?.ownerPrincipalId, undefined);
    assert.equal(updated.risk?.summary, undefined);
    assert.deepEqual(updated.risk?.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);
  });
});

test("POST /api/operations/risks/update 在缺少 riskId 时返回客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const response = await postJson(baseUrl, "/api/operations/risks/update", {
      ...buildIdentityPayload("owner-risks-http-missing-id"),
      risk: {
        type: "risk",
        title: "缺 riskId",
        severity: "medium",
        status: "open",
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
    assert.equal(payload.error?.message, "风险更新请求缺少 riskId。");
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
