import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";

function createServiceContext(): {
  root: string;
  databaseFile: string;
  registry: SqliteCodexSessionRegistry;
  service: PrincipalOperationEdgesService;
} {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-operation-edges-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile,
  });
  const service = new PrincipalOperationEdgesService({ registry });
  const now = "2026-04-23T18:00:00.000Z";

  registry.savePrincipal({
    principalId: "principal-owner",
    displayName: "Owner",
    createdAt: now,
    updatedAt: now,
  });

  return {
    root,
    databaseFile,
    registry,
    service,
  };
}

test("createEdge 会创建结构化关系边并落到 SQLite schema", () => {
  const context = createServiceContext();

  try {
    const edge = context.service.createEdge({
      principalId: "principal-owner",
      fromObjectType: "decision",
      fromObjectId: "decision-ledger-1",
      toObjectType: "risk",
      toObjectId: "risk-ledger-1",
      relationType: "mitigates",
      status: "active",
      label: "先降级风险",
      summary: "该决策用于降低支付回调失败风险",
      now: "2026-04-23T18:10:00.000Z",
    });

    assert.equal(edge.relationType, "mitigates");
    assert.equal(edge.status, "active");
    assert.equal(edge.fromObjectType, "decision");
    assert.equal(edge.toObjectType, "risk");

    const listed = context.service.listEdges({
      principalId: "principal-owner",
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.edgeId, edge.edgeId);

    const inspector = new Database(context.databaseFile, { readonly: true });

    try {
      const row = inspector.prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'themis_principal_operation_edges'
        `,
      ).get() as { name: string } | undefined;

      assert.equal(row?.name, "themis_principal_operation_edges");
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("listEdges 默认隐藏 archived，并支持按端点和关系类型筛选", () => {
  const context = createServiceContext();

  try {
    context.service.createEdge({
      principalId: "principal-owner",
      fromObjectType: "cadence",
      fromObjectId: "cadence-ledger-1",
      toObjectType: "risk",
      toObjectId: "risk-ledger-1",
      relationType: "tracks",
      status: "active",
      now: "2026-04-23T18:20:00.000Z",
    });
    context.service.createEdge({
      principalId: "principal-owner",
      fromObjectType: "risk",
      fromObjectId: "risk-ledger-1",
      toObjectType: "decision",
      toObjectId: "decision-ledger-1",
      relationType: "depends_on",
      status: "active",
      now: "2026-04-23T18:21:00.000Z",
    });
    context.service.createEdge({
      principalId: "principal-owner",
      fromObjectType: "asset",
      fromObjectId: "asset-ledger-old",
      toObjectType: "risk",
      toObjectId: "risk-ledger-old",
      relationType: "relates_to",
      status: "archived",
      now: "2026-04-23T18:22:00.000Z",
    });

    const visible = context.service.listEdges({
      principalId: "principal-owner",
    });
    const riskIncoming = context.service.listEdges({
      principalId: "principal-owner",
      toObjectType: "risk",
      toObjectId: "risk-ledger-1",
    });
    const tracks = context.service.listEdges({
      principalId: "principal-owner",
      relationType: "tracks",
    });
    const archived = context.service.listEdges({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });

    assert.deepEqual(
      visible.map((edge) => edge.relationType).sort(),
      ["depends_on", "tracks"],
    );
    assert.deepEqual(
      riskIncoming.map((edge) => edge.fromObjectId),
      ["cadence-ledger-1"],
    );
    assert.deepEqual(
      tracks.map((edge) => edge.fromObjectType),
      ["cadence"],
    );
    assert.deepEqual(
      archived.map((edge) => edge.fromObjectId),
      ["asset-ledger-old"],
    );
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("updateEdge 会保留 createdAt，并允许清空 label 和 summary", () => {
  const context = createServiceContext();

  try {
    const created = context.service.createEdge({
      principalId: "principal-owner",
      fromObjectType: "cadence",
      fromObjectId: "cadence-ledger-1",
      toObjectType: "asset",
      toObjectId: "asset-ledger-1",
      relationType: "tracks",
      status: "active",
      label: "周检覆盖资产",
      summary: "每周检查 prod-web",
      now: "2026-04-23T18:30:00.000Z",
    });

    const updated = context.service.updateEdge({
      principalId: "principal-owner",
      edgeId: created.edgeId,
      fromObjectType: "cadence",
      fromObjectId: "cadence-ledger-1",
      toObjectType: "risk",
      toObjectId: "risk-ledger-2",
      relationType: "tracks",
      status: "archived",
      label: "",
      summary: "",
      now: "2026-04-23T18:40:00.000Z",
    });

    assert.equal(updated.createdAt, "2026-04-23T18:30:00.000Z");
    assert.equal(updated.updatedAt, "2026-04-23T18:40:00.000Z");
    assert.equal(updated.toObjectType, "risk");
    assert.equal(updated.toObjectId, "risk-ledger-2");
    assert.equal(updated.status, "archived");
    assert.equal(updated.label, undefined);
    assert.equal(updated.summary, undefined);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("syncGeneratedEdgesForObject 会幂等补边并归档过期自动边", () => {
  const context = createServiceContext();

  try {
    const first = context.service.syncGeneratedEdgesForObject({
      principalId: "principal-owner",
      sourceObjectType: "risk",
      sourceObjectId: "risk-ledger-1",
      edges: [{
        fromObjectType: "risk",
        fromObjectId: "risk-ledger-1",
        toObjectType: "asset",
        toObjectId: "asset-ledger-1",
        relationType: "relates_to",
        label: "风险关联资产",
      }, {
        fromObjectType: "risk",
        fromObjectId: "risk-ledger-1",
        toObjectType: "asset",
        toObjectId: "asset-ledger-1",
        relationType: "relates_to",
        label: "重复边会被去重",
      }],
      now: "2026-04-23T18:50:00.000Z",
    });

    assert.equal(first.length, 1);
    assert.match(first[0]?.edgeId ?? "", /^operation-edge-auto-/);
    assert.equal(first[0]?.status, "active");

    const second = context.service.syncGeneratedEdgesForObject({
      principalId: "principal-owner",
      sourceObjectType: "risk",
      sourceObjectId: "risk-ledger-1",
      edges: [{
        fromObjectType: "risk",
        fromObjectId: "risk-ledger-1",
        toObjectType: "asset",
        toObjectId: "asset-ledger-2",
        relationType: "relates_to",
        label: "风险关联新资产",
      }],
      now: "2026-04-23T18:55:00.000Z",
    });

    const archived = context.service.listEdges({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });
    const visible = context.service.listEdges({
      principalId: "principal-owner",
    });

    assert.equal(second.length, 1);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.toObjectId, "asset-ledger-2");
    assert.equal(archived.length, 1);
    assert.equal(archived[0]?.toObjectId, "asset-ledger-1");
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("queryGraph 会基于 active 关系边返回根对象子图和最短路径", () => {
  const context = createServiceContext();

  try {
    context.service.createEdge({
      principalId: "principal-owner",
      edgeId: "edge-risk-commitment",
      fromObjectType: "risk",
      fromObjectId: "risk-ledger-1",
      toObjectType: "commitment",
      toObjectId: "commitment-ledger-1",
      relationType: "blocks",
      status: "active",
      label: "风险阻塞承诺",
      now: "2026-04-23T19:00:00.000Z",
    });
    context.service.createEdge({
      principalId: "principal-owner",
      edgeId: "edge-commitment-asset",
      fromObjectType: "commitment",
      fromObjectId: "commitment-ledger-1",
      toObjectType: "asset",
      toObjectId: "asset-ledger-1",
      relationType: "relates_to",
      status: "active",
      label: "承诺关联资产",
      now: "2026-04-23T19:01:00.000Z",
    });
    context.service.createEdge({
      principalId: "principal-owner",
      edgeId: "edge-asset-archived",
      fromObjectType: "asset",
      fromObjectId: "asset-ledger-1",
      toObjectType: "decision",
      toObjectId: "decision-ledger-old",
      relationType: "relates_to",
      status: "archived",
      now: "2026-04-23T19:02:00.000Z",
    });

    const graph = context.service.queryGraph({
      principalId: "principal-owner",
      rootObjectType: "risk",
      rootObjectId: "risk-ledger-1",
      targetObjectType: "asset",
      targetObjectId: "asset-ledger-1",
      maxDepth: 2,
      now: "2026-04-23T19:03:00.000Z",
    });

    assert.equal(graph.root.objectType, "risk");
    assert.equal(graph.target?.reachable, true);
    assert.deepEqual(
      graph.nodes.map((node) => `${node.depth}:${node.objectType}:${node.objectId}`),
      [
        "0:risk:risk-ledger-1",
        "1:commitment:commitment-ledger-1",
        "2:asset:asset-ledger-1",
      ],
    );
    assert.deepEqual(
      graph.shortestPath.map((edge) => edge.edgeId),
      ["edge-risk-commitment", "edge-commitment-asset"],
    );
    assert.equal(graph.edges.some((edge) => edge.edgeId === "edge-asset-archived"), false);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});
