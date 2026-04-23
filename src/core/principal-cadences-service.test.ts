import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PrincipalCadencesService } from "./principal-cadences-service.js";
import { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";

function createServiceContext(): {
  root: string;
  databaseFile: string;
  registry: SqliteCodexSessionRegistry;
  service: PrincipalCadencesService;
} {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-cadences-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile,
  });
  const service = new PrincipalCadencesService({ registry });
  const now = "2026-04-23T17:00:00.000Z";

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

test("createCadence 会创建首版节奏记录并落到 SQLite schema", () => {
  const context = createServiceContext();

  try {
    const cadence = context.service.createCadence({
      principalId: "principal-owner",
      title: "prod-web 周检",
      frequency: "weekly",
      status: "active",
      nextRunAt: "2026-04-28T01:00:00.000Z",
      ownerPrincipalId: "principal-owner",
      playbookRef: "docs/runbooks/prod-web-weekly-check.md",
      summary: "每周检查 uptime、证书和备份状态",
      relatedAssetIds: ["asset-ledger-1", "asset-ledger-1"],
      now: "2026-04-23T17:10:00.000Z",
    });

    assert.equal(cadence.frequency, "weekly");
    assert.equal(cadence.status, "active");
    assert.deepEqual(cadence.relatedAssetIds, ["asset-ledger-1"]);
    assert.equal(cadence.playbookRef, "docs/runbooks/prod-web-weekly-check.md");

    const listed = context.service.listCadences({
      principalId: "principal-owner",
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.cadenceId, cadence.cadenceId);

    const inspector = new Database(context.databaseFile, { readonly: true });

    try {
      const row = inspector.prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'themis_principal_cadences'
        `,
      ).get() as { name: string } | undefined;

      assert.equal(row?.name, "themis_principal_cadences");
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("listCadences 默认隐藏 archived，并支持按状态和频率筛选", () => {
  const context = createServiceContext();

  try {
    context.service.createCadence({
      principalId: "principal-owner",
      title: "域名续费巡检",
      frequency: "monthly",
      status: "active",
      nextRunAt: "2026-05-01T00:00:00.000Z",
      now: "2026-04-23T17:20:00.000Z",
    });
    context.service.createCadence({
      principalId: "principal-owner",
      title: "季度账单复盘",
      frequency: "quarterly",
      status: "paused",
      nextRunAt: "2026-07-01T00:00:00.000Z",
      now: "2026-04-23T17:21:00.000Z",
    });
    context.service.createCadence({
      principalId: "principal-owner",
      title: "历史下线站点复盘",
      frequency: "yearly",
      status: "archived",
      nextRunAt: "2026-12-01T00:00:00.000Z",
      now: "2026-04-23T17:22:00.000Z",
    });

    const visible = context.service.listCadences({
      principalId: "principal-owner",
    });
    const paused = context.service.listCadences({
      principalId: "principal-owner",
      status: "paused",
    });
    const quarterly = context.service.listCadences({
      principalId: "principal-owner",
      frequency: "quarterly",
    });
    const archived = context.service.listCadences({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });

    assert.deepEqual(
      visible.map((cadence) => cadence.title),
      ["域名续费巡检", "季度账单复盘"],
    );
    assert.deepEqual(
      paused.map((cadence) => cadence.title),
      ["季度账单复盘"],
    );
    assert.deepEqual(
      quarterly.map((cadence) => cadence.title),
      ["季度账单复盘"],
    );
    assert.deepEqual(
      archived.map((cadence) => cadence.title),
      ["历史下线站点复盘"],
    );
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("updateCadence 会保留 createdAt，并允许清空 owner、playbook 和 summary", () => {
  const context = createServiceContext();

  try {
    const created = context.service.createCadence({
      principalId: "principal-owner",
      title: "备份抽查",
      frequency: "weekly",
      status: "active",
      nextRunAt: "2026-04-24T01:00:00.000Z",
      ownerPrincipalId: "principal-owner",
      playbookRef: "docs/runbooks/backup-check.md",
      summary: "每周抽查一次恢复流程",
      relatedAssetIds: ["asset-ledger-1"],
      now: "2026-04-23T17:30:00.000Z",
    });

    const updated = context.service.updateCadence({
      principalId: "principal-owner",
      cadenceId: created.cadenceId,
      title: "备份月度抽查",
      frequency: "monthly",
      status: "paused",
      nextRunAt: "2026-05-01T01:00:00.000Z",
      ownerPrincipalId: "",
      playbookRef: "",
      summary: "",
      relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
      now: "2026-04-23T17:40:00.000Z",
    });

    assert.equal(updated.createdAt, "2026-04-23T17:30:00.000Z");
    assert.equal(updated.updatedAt, "2026-04-23T17:40:00.000Z");
    assert.equal(updated.frequency, "monthly");
    assert.equal(updated.status, "paused");
    assert.equal(updated.ownerPrincipalId, undefined);
    assert.equal(updated.playbookRef, undefined);
    assert.equal(updated.summary, undefined);
    assert.equal(updated.nextRunAt, "2026-05-01T01:00:00.000Z");
    assert.deepEqual(updated.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("createCadence 和 updateCadence 会同步节奏到资产的自动关系边", () => {
  const context = createServiceContext();
  const operationEdgesService = new PrincipalOperationEdgesService({ registry: context.registry });
  const service = new PrincipalCadencesService({
    registry: context.registry,
    operationEdgesService,
  });

  try {
    const created = service.createCadence({
      principalId: "principal-owner",
      cadenceId: "cadence-ledger-auto",
      title: "prod-web 周检",
      frequency: "weekly",
      status: "active",
      nextRunAt: "2026-04-28T01:00:00.000Z",
      relatedAssetIds: ["asset-ledger-1"],
      now: "2026-04-23T17:50:00.000Z",
    });
    const initialEdges = operationEdgesService.listEdges({
      principalId: "principal-owner",
    });

    assert.equal(initialEdges.length, 1);
    assert.equal(initialEdges[0]?.fromObjectType, "cadence");
    assert.equal(initialEdges[0]?.fromObjectId, created.cadenceId);
    assert.equal(initialEdges[0]?.relationType, "tracks");
    assert.equal(initialEdges[0]?.toObjectId, "asset-ledger-1");

    service.updateCadence({
      principalId: "principal-owner",
      cadenceId: created.cadenceId,
      title: "prod-web 周检",
      frequency: "weekly",
      status: "active",
      nextRunAt: "2026-04-28T01:00:00.000Z",
      relatedAssetIds: ["asset-ledger-2"],
      now: "2026-04-23T17:55:00.000Z",
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
    assert.deepEqual(archivedEdges.map((edge) => edge.toObjectId), ["asset-ledger-1"]);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});
