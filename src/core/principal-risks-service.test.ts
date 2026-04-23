import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import { PrincipalRisksService } from "./principal-risks-service.js";

function createServiceContext(): {
  root: string;
  databaseFile: string;
  registry: SqliteCodexSessionRegistry;
  service: PrincipalRisksService;
} {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-risks-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile,
  });
  const service = new PrincipalRisksService({ registry });
  const now = "2026-04-23T15:00:00.000Z";

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

test("createRisk 会创建首版风险记录并落到 SQLite schema", () => {
  const context = createServiceContext();

  try {
    const risk = context.service.createRisk({
      principalId: "principal-owner",
      type: "incident",
      title: "prod-web CPU 突增",
      severity: "critical",
      status: "open",
      ownerPrincipalId: "principal-owner",
      summary: "流量突增导致首页大量超时",
      detectedAt: "2026-04-23T15:10:00.000Z",
      relatedAssetIds: ["asset-ledger-1", "asset-ledger-1"],
      linkedDecisionIds: ["decision-ledger-1"],
      relatedWorkItemIds: ["work-item-1", "work-item-2"],
      now: "2026-04-23T15:10:00.000Z",
    });

    assert.equal(risk.type, "incident");
    assert.equal(risk.severity, "critical");
    assert.deepEqual(risk.relatedAssetIds, ["asset-ledger-1"]);
    assert.deepEqual(risk.linkedDecisionIds, ["decision-ledger-1"]);

    const listed = context.service.listRisks({
      principalId: "principal-owner",
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.riskId, risk.riskId);

    const inspector = new Database(context.databaseFile, { readonly: true });

    try {
      const row = inspector.prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'themis_principal_risks'
        `,
      ).get() as { name: string } | undefined;

      assert.equal(row?.name, "themis_principal_risks");
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("listRisks 默认隐藏 archived，并支持按状态和严重度筛选", () => {
  const context = createServiceContext();

  try {
    context.service.createRisk({
      principalId: "principal-owner",
      type: "risk",
      title: "域名证书即将过期",
      severity: "high",
      status: "watch",
      now: "2026-04-23T15:20:00.000Z",
    });
    context.service.createRisk({
      principalId: "principal-owner",
      type: "incident",
      title: "支付回调失败",
      severity: "critical",
      status: "open",
      now: "2026-04-23T15:21:00.000Z",
    });
    context.service.createRisk({
      principalId: "principal-owner",
      type: "risk",
      title: "历史合规问题",
      severity: "medium",
      status: "archived",
      now: "2026-04-23T15:22:00.000Z",
    });

    const visible = context.service.listRisks({
      principalId: "principal-owner",
    });
    const critical = context.service.listRisks({
      principalId: "principal-owner",
      severity: "critical",
    });
    const archived = context.service.listRisks({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });

    assert.deepEqual(
      visible.map((risk) => risk.title),
      ["支付回调失败", "域名证书即将过期"],
    );
    assert.deepEqual(
      critical.map((risk) => risk.title),
      ["支付回调失败"],
    );
    assert.deepEqual(
      archived.map((risk) => risk.title),
      ["历史合规问题"],
    );
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("updateRisk 会保留 createdAt，并允许清空 owner 和 summary", () => {
  const context = createServiceContext();

  try {
    const created = context.service.createRisk({
      principalId: "principal-owner",
      type: "risk",
      title: "Cloudflare 账号权限过大",
      severity: "high",
      status: "watch",
      ownerPrincipalId: "principal-owner",
      summary: "存在共享超管风险",
      detectedAt: "2026-04-23T15:30:00.000Z",
      relatedAssetIds: ["asset-ledger-1"],
      linkedDecisionIds: ["decision-ledger-1"],
      relatedWorkItemIds: ["work-item-1"],
      now: "2026-04-23T15:30:00.000Z",
    });

    const updated = context.service.updateRisk({
      principalId: "principal-owner",
      riskId: created.riskId,
      type: "incident",
      title: "Cloudflare 配置误改已造成线上抖动",
      severity: "critical",
      status: "resolved",
      ownerPrincipalId: "",
      summary: "",
      detectedAt: "2026-04-23T15:35:00.000Z",
      relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
      linkedDecisionIds: ["decision-ledger-2"],
      relatedWorkItemIds: ["work-item-2"],
      now: "2026-04-23T15:40:00.000Z",
    });

    assert.equal(updated.createdAt, "2026-04-23T15:30:00.000Z");
    assert.equal(updated.updatedAt, "2026-04-23T15:40:00.000Z");
    assert.equal(updated.type, "incident");
    assert.equal(updated.severity, "critical");
    assert.equal(updated.status, "resolved");
    assert.equal(updated.ownerPrincipalId, undefined);
    assert.equal(updated.summary, undefined);
    assert.equal(updated.detectedAt, "2026-04-23T15:35:00.000Z");
    assert.deepEqual(updated.linkedDecisionIds, ["decision-ledger-2"]);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("createRisk 和 updateRisk 会同步风险相关自动关系边", () => {
  const context = createServiceContext();
  const operationEdgesService = new PrincipalOperationEdgesService({ registry: context.registry });
  const service = new PrincipalRisksService({
    registry: context.registry,
    operationEdgesService,
  });

  try {
    const created = service.createRisk({
      principalId: "principal-owner",
      riskId: "risk-ledger-auto",
      type: "incident",
      title: "支付回调失败",
      severity: "critical",
      status: "open",
      relatedAssetIds: ["asset-ledger-1"],
      linkedDecisionIds: ["decision-ledger-1"],
      relatedWorkItemIds: ["work-item-1"],
      now: "2026-04-23T15:50:00.000Z",
    });
    const initialEdges = operationEdgesService.listEdges({
      principalId: "principal-owner",
    });

    assert.deepEqual(
      initialEdges.map((edge) => `${edge.fromObjectType}:${edge.fromObjectId}:${edge.relationType}:${edge.toObjectType}:${edge.toObjectId}`).sort(),
      [
        `decision:decision-ledger-1:mitigates:risk:${created.riskId}`,
        `risk:${created.riskId}:relates_to:asset:asset-ledger-1`,
        `work_item:work-item-1:tracks:risk:${created.riskId}`,
      ],
    );

    service.updateRisk({
      principalId: "principal-owner",
      riskId: created.riskId,
      type: "incident",
      title: "支付回调失败",
      severity: "critical",
      status: "archived",
      relatedAssetIds: [],
      linkedDecisionIds: [],
      relatedWorkItemIds: [],
      now: "2026-04-23T15:55:00.000Z",
    });

    const visibleEdges = operationEdgesService.listEdges({
      principalId: "principal-owner",
    });
    const archivedEdges = operationEdgesService.listEdges({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });

    assert.equal(visibleEdges.length, 0);
    assert.equal(archivedEdges.length, 3);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});
