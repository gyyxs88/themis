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
  const root = mkdtempSync(join(tmpdir(), "themis-http-operations-commitments-"));
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

test("POST /api/operations/commitments/create|list|update 会维护当前 principal 的承诺目标", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const createResponse = await postJson(baseUrl, "/api/operations/commitments/create", {
      ...buildIdentityPayload("owner-commitments-http"),
      commitment: {
        title: "Q2 发布主线必须收口",
        status: "active",
        ownerPrincipalId: "principal-owner",
        startsAt: "2026-04-01T00:00:00.000Z",
        dueAt: "2026-06-30T23:59:00.000Z",
        progressPercent: 30,
        summary: "把运营中枢推进到可用控制面",
        milestones: [{
          title: "内测验收",
          status: "active",
          dueAt: "2026-05-15T23:59:00.000Z",
          evidenceRefs: [],
        }],
        evidenceRefs: [{ kind: "work_item", value: "work-item-evidence-1", label: "验收任务" }],
        relatedAssetIds: ["asset-ledger-1"],
        linkedDecisionIds: ["decision-ledger-1"],
        linkedRiskIds: ["risk-ledger-1"],
        relatedCadenceIds: ["cadence-ledger-1"],
        relatedWorkItemIds: ["work-item-1"],
      },
    }, authHeaders);

    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as {
      commitment?: {
        commitmentId?: string;
        title?: string;
        dueAt?: string;
        progressPercent?: number;
      };
    };
    assert.ok(created.commitment?.commitmentId);
    assert.equal(created.commitment?.title, "Q2 发布主线必须收口");
    assert.equal(created.commitment?.dueAt, "2026-06-30T23:59:00.000Z");
    assert.equal(created.commitment?.progressPercent, 30);

    const listResponse = await postJson(baseUrl, "/api/operations/commitments/list", {
      ...buildIdentityPayload("owner-commitments-http"),
      status: "active",
    }, authHeaders);

    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json() as {
      commitments?: Array<{
        commitmentId?: string;
        principalId?: string;
        title?: string;
        status?: string;
        ownerPrincipalId?: string;
        progressPercent?: number;
        milestones?: Array<{ title?: string }>;
        evidenceRefs?: Array<{ kind?: string; value?: string; label?: string }>;
        linkedRiskIds?: string[];
      }>;
    };
    assert.equal(listed.commitments?.length, 1);
    assert.equal(listed.commitments?.[0]?.commitmentId, created.commitment?.commitmentId);
    assert.equal(listed.commitments?.[0]?.status, "active");
    assert.equal(listed.commitments?.[0]?.ownerPrincipalId, "principal-owner");
    assert.equal(listed.commitments?.[0]?.progressPercent, 30);
    assert.equal(listed.commitments?.[0]?.milestones?.[0]?.title, "内测验收");
    assert.deepEqual(listed.commitments?.[0]?.evidenceRefs?.[0], {
      kind: "work_item",
      value: "work-item-evidence-1",
      label: "验收任务",
    });
    assert.deepEqual(listed.commitments?.[0]?.linkedRiskIds, ["risk-ledger-1"]);

    const updateResponse = await postJson(baseUrl, "/api/operations/commitments/update", {
      ...buildIdentityPayload("owner-commitments-http"),
      commitment: {
        commitmentId: created.commitment?.commitmentId,
        title: "Q2 发布主线进入风险跟踪",
        status: "at_risk",
        ownerPrincipalId: "",
        startsAt: "",
        dueAt: "2026-07-15T23:59:00.000Z",
        progressPercent: 68,
        summary: "",
        milestones: [{
          title: "灰度完成",
          status: "done",
          completedAt: "2026-05-20T10:00:00.000Z",
          evidenceRefs: [],
        }],
        evidenceRefs: [{ kind: "work_item", value: "work-item-evidence-2", label: "灰度任务" }],
        relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
        linkedDecisionIds: ["decision-ledger-2"],
        linkedRiskIds: ["risk-ledger-2"],
        relatedCadenceIds: ["cadence-ledger-2"],
        relatedWorkItemIds: ["work-item-2"],
      },
    }, authHeaders);

    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json() as {
      commitment?: {
        status?: string;
        ownerPrincipalId?: string;
        startsAt?: string;
        progressPercent?: number;
        summary?: string;
        milestones?: Array<{ status?: string; title?: string }>;
        evidenceRefs?: Array<{ kind?: string; value?: string; label?: string }>;
        relatedAssetIds?: string[];
        linkedRiskIds?: string[];
      };
    };
    assert.equal(updated.commitment?.status, "at_risk");
    assert.equal(updated.commitment?.ownerPrincipalId, undefined);
    assert.equal(updated.commitment?.startsAt, undefined);
    assert.equal(updated.commitment?.summary, undefined);
    assert.equal(updated.commitment?.progressPercent, 68);
    assert.equal(updated.commitment?.milestones?.[0]?.status, "done");
    assert.equal(updated.commitment?.evidenceRefs?.[0]?.value, "work-item-evidence-2");
    assert.deepEqual(updated.commitment?.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);
    assert.deepEqual(updated.commitment?.linkedRiskIds, ["risk-ledger-2"]);

    const edgesResponse = await postJson(baseUrl, "/api/operations/edges/list", {
      ...buildIdentityPayload("owner-commitments-http"),
      status: "active",
    }, authHeaders);

    assert.equal(edgesResponse.status, 200);
    const edgesPayload = await edgesResponse.json() as {
      edges?: Array<{
        fromObjectType?: string;
        fromObjectId?: string;
        relationType?: string;
        toObjectType?: string;
        toObjectId?: string;
      }>;
    };
    assert.ok(edgesPayload.edges?.some((edge) =>
      edge.fromObjectType === "risk"
      && edge.fromObjectId === "risk-ledger-2"
      && edge.relationType === "blocks"
      && edge.toObjectType === "commitment"
      && edge.toObjectId === created.commitment?.commitmentId
    ));
    assert.ok(edgesPayload.edges?.some((edge) =>
      edge.fromObjectType === "work_item"
      && edge.fromObjectId === "work-item-evidence-2"
      && edge.relationType === "evidence_for"
      && edge.toObjectType === "commitment"
      && edge.toObjectId === created.commitment?.commitmentId
    ));
  });
});

test("POST /api/operations/commitments/update 在缺少 commitmentId 时返回客户端错误", async () => {
  await withHttpServer(async ({ baseUrl, runtimeStore }) => {
    const authHeaders = await createAuthenticatedWebHeaders({ baseUrl, runtimeStore });

    const response = await postJson(baseUrl, "/api/operations/commitments/update", {
      ...buildIdentityPayload("owner-commitments-http-missing-id"),
      commitment: {
        title: "缺 commitmentId",
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
    assert.equal(payload.error?.message, "承诺更新请求缺少 commitmentId。");
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
