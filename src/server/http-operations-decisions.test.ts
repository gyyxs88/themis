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
  const root = mkdtempSync(join(tmpdir(), "themis-http-operations-decisions-"));
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

test("POST /api/operations/decisions/create|list|update 会维护当前 principal 的决策记录", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const createResponse = await postJson(baseUrl, "/api/operations/decisions/create", {
      ...buildIdentityPayload("owner-decisions-http"),
      decision: {
        title: "当前阶段先叫运营中枢",
        status: "active",
        summary: "数字公司操作系统先保留为最终形态",
        decidedByPrincipalId: "principal-owner",
        decidedAt: "2026-04-23T14:10:00.000Z",
        relatedAssetIds: ["asset-ledger-1"],
        relatedWorkItemIds: ["work-item-1", "work-item-2"],
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as {
      decision?: {
        decisionId?: string;
        title?: string;
        relatedWorkItemIds?: string[];
      };
    };
    assert.ok(created.decision?.decisionId);
    assert.equal(created.decision?.title, "当前阶段先叫运营中枢");
    assert.deepEqual(created.decision?.relatedWorkItemIds, ["work-item-1", "work-item-2"]);

    const listResponse = await postJson(baseUrl, "/api/operations/decisions/list", {
      ...buildIdentityPayload("owner-decisions-http"),
      status: "active",
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json() as {
      decisions?: Array<{
        decisionId?: string;
        principalId?: string;
        title?: string;
        status?: string;
        decidedByPrincipalId?: string;
        relatedAssetIds?: string[];
        relatedWorkItemIds?: string[];
      }>;
    };
    assert.equal(listed.decisions?.length, 1);
    assert.equal(listed.decisions?.[0]?.decisionId, created.decision?.decisionId);
    assert.equal(listed.decisions?.[0]?.title, "当前阶段先叫运营中枢");
    assert.equal(listed.decisions?.[0]?.status, "active");
    assert.equal(listed.decisions?.[0]?.decidedByPrincipalId, "principal-owner");
    assert.deepEqual(listed.decisions?.[0]?.relatedAssetIds, ["asset-ledger-1"]);

    const updateResponse = await postJson(baseUrl, "/api/operations/decisions/update", {
      ...buildIdentityPayload("owner-decisions-http"),
      decision: {
        decisionId: created.decision?.decisionId,
        title: "当前阶段先做运营中枢，OS 留作北极星",
        status: "superseded",
        summary: "",
        decidedByPrincipalId: "",
        decidedAt: "2026-04-23T14:15:00.000Z",
        relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
        relatedWorkItemIds: ["work-item-3"],
      },
    }, authHeaders);

    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json() as {
      decision?: {
        status?: string;
        summary?: string;
        decidedByPrincipalId?: string;
        relatedAssetIds?: string[];
      };
    };
    assert.equal(updated.decision?.status, "superseded");
    assert.equal(updated.decision?.summary, undefined);
    assert.equal(updated.decision?.decidedByPrincipalId, undefined);
    assert.deepEqual(updated.decision?.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);

    const edgeListResponse = await postJson(baseUrl, "/api/operations/edges/list", {
      ...buildIdentityPayload("owner-decisions-http"),
      fromObjectType: "decision",
      fromObjectId: created.decision?.decisionId,
    }, authHeaders);

    assert.equal(edgeListResponse.status, 200);
    const edgeList = await edgeListResponse.json() as {
      edges?: Array<{
        relationType?: string;
        toObjectType?: string;
        toObjectId?: string;
      }>;
    };
    assert.deepEqual(
      edgeList.edges?.map((edge) => `${edge.relationType}:${edge.toObjectType}:${edge.toObjectId}`).sort(),
      [
        "relates_to:asset:asset-ledger-1",
        "relates_to:asset:asset-ledger-2",
        "relates_to:work_item:work-item-3",
      ],
    );
  });
});

test("POST /api/operations/decisions/update 在缺少 decisionId 时返回客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const response = await postJson(baseUrl, "/api/operations/decisions/update", {
      ...buildIdentityPayload("owner-decisions-http-missing-id"),
      decision: {
        title: "缺 decisionId",
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
    assert.equal(payload.error?.message, "决策更新请求缺少 decisionId。");
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
