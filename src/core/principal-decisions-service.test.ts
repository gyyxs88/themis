import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { PrincipalDecisionsService } from "./principal-decisions-service.js";
import { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

function createServiceContext(): {
  root: string;
  databaseFile: string;
  registry: SqliteCodexSessionRegistry;
  service: PrincipalDecisionsService;
} {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-decisions-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile,
  });
  const service = new PrincipalDecisionsService({ registry });
  const now = "2026-04-23T13:00:00.000Z";

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

test("createDecision 会创建首版决策记录并落到 SQLite schema", () => {
  const context = createServiceContext();

  try {
    const decision = context.service.createDecision({
      principalId: "principal-owner",
      title: "先把运营中枢定位收在控制面",
      status: "active",
      summary: "当前不直接叫数字公司操作系统",
      decidedByPrincipalId: "principal-owner",
      decidedAt: "2026-04-23T13:10:00.000Z",
      relatedAssetIds: ["asset-ledger-1", "asset-ledger-1"],
      relatedWorkItemIds: ["work-item-1", "work-item-2"],
      now: "2026-04-23T13:10:00.000Z",
    });

    assert.equal(decision.status, "active");
    assert.deepEqual(decision.relatedAssetIds, ["asset-ledger-1"]);
    assert.deepEqual(decision.relatedWorkItemIds, ["work-item-1", "work-item-2"]);

    const listed = context.service.listDecisions({
      principalId: "principal-owner",
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.decisionId, decision.decisionId);

    const inspector = new Database(context.databaseFile, { readonly: true });

    try {
      const row = inspector.prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'themis_principal_decisions'
        `,
      ).get() as { name: string } | undefined;

      assert.equal(row?.name, "themis_principal_decisions");
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("listDecisions 默认隐藏 archived，并支持按状态筛选", () => {
  const context = createServiceContext();

  try {
    context.service.createDecision({
      principalId: "principal-owner",
      title: "继续沿用现有资产模型",
      status: "active",
      now: "2026-04-23T13:20:00.000Z",
    });
    context.service.createDecision({
      principalId: "principal-owner",
      title: "旧口径改成 superseded",
      status: "superseded",
      now: "2026-04-23T13:21:00.000Z",
    });
    context.service.createDecision({
      principalId: "principal-owner",
      title: "历史拍板归档",
      status: "archived",
      now: "2026-04-23T13:22:00.000Z",
    });

    const visible = context.service.listDecisions({
      principalId: "principal-owner",
    });
    const archived = context.service.listDecisions({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });

    assert.deepEqual(
      visible.map((decision) => decision.title),
      ["旧口径改成 superseded", "继续沿用现有资产模型"],
    );
    assert.deepEqual(
      archived.map((decision) => decision.title),
      ["历史拍板归档"],
    );
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("updateDecision 会保留 createdAt，并允许清空决定人和摘要", () => {
  const context = createServiceContext();

  try {
    const created = context.service.createDecision({
      principalId: "principal-owner",
      title: "先接资产再接决策",
      status: "active",
      summary: "因为资产锚点先更关键",
      decidedByPrincipalId: "principal-owner",
      decidedAt: "2026-04-23T13:30:00.000Z",
      relatedAssetIds: ["asset-ledger-1"],
      relatedWorkItemIds: ["work-item-1"],
      now: "2026-04-23T13:30:00.000Z",
    });

    const updated = context.service.updateDecision({
      principalId: "principal-owner",
      decisionId: created.decisionId,
      title: "先接资产，再把决策做成一等对象",
      status: "superseded",
      summary: "",
      decidedByPrincipalId: "",
      decidedAt: "2026-04-23T13:35:00.000Z",
      relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
      relatedWorkItemIds: ["work-item-2"],
      now: "2026-04-23T13:35:00.000Z",
    });

    assert.equal(updated.createdAt, "2026-04-23T13:30:00.000Z");
    assert.equal(updated.updatedAt, "2026-04-23T13:35:00.000Z");
    assert.equal(updated.status, "superseded");
    assert.equal(updated.summary, undefined);
    assert.equal(updated.decidedByPrincipalId, undefined);
    assert.equal(updated.decidedAt, "2026-04-23T13:35:00.000Z");
    assert.deepEqual(updated.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);
    assert.deepEqual(updated.relatedWorkItemIds, ["work-item-2"]);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("createDecision 和 updateDecision 会同步自动关系边", () => {
  const context = createServiceContext();
  const operationEdgesService = new PrincipalOperationEdgesService({ registry: context.registry });
  const service = new PrincipalDecisionsService({
    registry: context.registry,
    operationEdgesService,
  });

  try {
    const created = service.createDecision({
      principalId: "principal-owner",
      decisionId: "decision-ledger-auto",
      title: "发布先走灰度",
      status: "active",
      relatedAssetIds: ["asset-ledger-1"],
      relatedWorkItemIds: ["work-item-1"],
      now: "2026-04-23T13:50:00.000Z",
    });
    const initialEdges = operationEdgesService.listEdges({
      principalId: "principal-owner",
    });

    assert.deepEqual(
      initialEdges.map((edge) => `${edge.fromObjectType}:${edge.fromObjectId}:${edge.relationType}:${edge.toObjectType}:${edge.toObjectId}`).sort(),
      [
        `decision:${created.decisionId}:relates_to:asset:asset-ledger-1`,
        `decision:${created.decisionId}:relates_to:work_item:work-item-1`,
      ],
    );

    service.updateDecision({
      principalId: "principal-owner",
      decisionId: created.decisionId,
      title: "发布先走灰度",
      status: "active",
      relatedAssetIds: ["asset-ledger-2"],
      relatedWorkItemIds: [],
      now: "2026-04-23T13:55:00.000Z",
    });

    const visibleEdges = operationEdgesService.listEdges({
      principalId: "principal-owner",
    });
    const archivedEdges = operationEdgesService.listEdges({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });

    assert.deepEqual(visibleEdges.map((edge) => edge.toObjectId), ["asset-ledger-2"]);
    assert.deepEqual(archivedEdges.map((edge) => edge.toObjectId).sort(), ["asset-ledger-1", "work-item-1"]);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});
