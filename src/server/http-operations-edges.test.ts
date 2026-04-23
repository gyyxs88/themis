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
  const root = mkdtempSync(join(tmpdir(), "themis-http-operations-edges-"));
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

test("POST /api/operations/edges/create|list|update 会维护当前 principal 的关系边", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const createResponse = await postJson(baseUrl, "/api/operations/edges/create", {
      ...buildIdentityPayload("owner-edges-http"),
      edge: {
        fromObjectType: "decision",
        fromObjectId: "decision-ledger-1",
        toObjectType: "risk",
        toObjectId: "risk-ledger-1",
        relationType: "mitigates",
        status: "active",
        label: "先降级风险",
        summary: "该决策用于降低支付风险",
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as {
      edge?: {
        edgeId?: string;
        relationType?: string;
        label?: string;
      };
    };
    assert.ok(created.edge?.edgeId);
    assert.equal(created.edge?.relationType, "mitigates");
    assert.equal(created.edge?.label, "先降级风险");

    const listResponse = await postJson(baseUrl, "/api/operations/edges/list", {
      ...buildIdentityPayload("owner-edges-http"),
      toObjectType: "risk",
      toObjectId: "risk-ledger-1",
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json() as {
      edges?: Array<{
        edgeId?: string;
        fromObjectType?: string;
        toObjectType?: string;
        relationType?: string;
        status?: string;
      }>;
    };
    assert.equal(listed.edges?.length, 1);
    assert.equal(listed.edges?.[0]?.edgeId, created.edge?.edgeId);
    assert.equal(listed.edges?.[0]?.fromObjectType, "decision");
    assert.equal(listed.edges?.[0]?.toObjectType, "risk");
    assert.equal(listed.edges?.[0]?.status, "active");

    const updateResponse = await postJson(baseUrl, "/api/operations/edges/update", {
      ...buildIdentityPayload("owner-edges-http"),
      edge: {
        edgeId: created.edge?.edgeId,
        fromObjectType: "cadence",
        fromObjectId: "cadence-ledger-1",
        toObjectType: "risk",
        toObjectId: "risk-ledger-1",
        relationType: "tracks",
        status: "archived",
        label: "",
        summary: "",
      },
    }, authHeaders);

    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json() as {
      edge?: {
        fromObjectType?: string;
        relationType?: string;
        status?: string;
        label?: string;
        summary?: string;
      };
    };
    assert.equal(updated.edge?.fromObjectType, "cadence");
    assert.equal(updated.edge?.relationType, "tracks");
    assert.equal(updated.edge?.status, "archived");
    assert.equal(updated.edge?.label, undefined);
    assert.equal(updated.edge?.summary, undefined);
  });
});

test("POST /api/operations/edges/update 在缺少 edgeId 时返回客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const response = await postJson(baseUrl, "/api/operations/edges/update", {
      ...buildIdentityPayload("owner-edges-http-missing-id"),
      edge: {
        fromObjectType: "decision",
        fromObjectId: "decision-ledger-1",
        toObjectType: "risk",
        toObjectId: "risk-ledger-1",
        relationType: "mitigates",
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
    assert.equal(payload.error?.message, "关系边更新请求缺少 edgeId。");
  });
});

test("POST /api/operations/graph/query 会返回当前 principal 的对象关系子图", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });
    const identity = buildIdentityPayload("owner-graph-http");

    await postJson(baseUrl, "/api/operations/edges/create", {
      ...identity,
      edge: {
        fromObjectType: "risk",
        fromObjectId: "risk-ledger-1",
        toObjectType: "commitment",
        toObjectId: "commitment-ledger-1",
        relationType: "blocks",
        status: "active",
        label: "风险阻塞承诺",
      },
    }, authHeaders);
    await postJson(baseUrl, "/api/operations/edges/create", {
      ...identity,
      edge: {
        fromObjectType: "commitment",
        fromObjectId: "commitment-ledger-1",
        toObjectType: "asset",
        toObjectId: "asset-ledger-1",
        relationType: "relates_to",
        status: "active",
        label: "承诺关联资产",
      },
    }, authHeaders);

    const response = await postJson(baseUrl, "/api/operations/graph/query", {
      ...identity,
      rootObjectType: "risk",
      rootObjectId: "risk-ledger-1",
      targetObjectType: "asset",
      targetObjectId: "asset-ledger-1",
      maxDepth: 2,
    }, authHeaders);

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      graph?: {
        root?: { objectType?: string; objectId?: string };
        target?: { reachable?: boolean };
        nodes?: Array<{ objectType?: string; objectId?: string; depth?: number }>;
        shortestPath?: Array<{ relationType?: string }>;
      };
    };

    assert.equal(payload.graph?.root?.objectType, "risk");
    assert.equal(payload.graph?.target?.reachable, true);
    assert.deepEqual(
      payload.graph?.nodes?.map((node) => `${node.depth}:${node.objectType}:${node.objectId}`),
      [
        "0:risk:risk-ledger-1",
        "1:commitment:commitment-ledger-1",
        "2:asset:asset-ledger-1",
      ],
    );
    assert.deepEqual(
      payload.graph?.shortestPath?.map((edge) => edge.relationType),
      ["blocks", "relates_to"],
    );
  });
});

test("POST /api/operations/graph/query 在缺少根对象时返回客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const response = await postJson(baseUrl, "/api/operations/graph/query", {
      ...buildIdentityPayload("owner-graph-http-missing-root"),
      rootObjectType: "risk",
    }, authHeaders);

    assert.equal(response.status, 400);
    const payload = await response.json() as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    assert.equal(payload.error?.code, "INVALID_REQUEST");
    assert.equal(payload.error?.message, "图查询根对象 id 不能为空。");
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
