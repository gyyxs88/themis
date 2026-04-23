import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { PrincipalCommitmentsService } from "./principal-commitments-service.js";
import { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";

function createServiceContext(): {
  root: string;
  databaseFile: string;
  registry: SqliteCodexSessionRegistry;
  service: PrincipalCommitmentsService;
} {
  const root = mkdtempSync(join(tmpdir(), "themis-principal-commitments-service-"));
  const databaseFile = join(root, "infra/local/themis.db");
  const registry = new SqliteCodexSessionRegistry({
    databaseFile,
  });
  const service = new PrincipalCommitmentsService({ registry });
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

test("createCommitment 会创建首版承诺目标并落到 SQLite schema", () => {
  const context = createServiceContext();

  try {
    const commitment = context.service.createCommitment({
      principalId: "principal-owner",
      title: "Q2 发布主线必须收口",
      status: "active",
      ownerPrincipalId: "principal-owner",
      startsAt: "2026-04-01T00:00:00.000Z",
      dueAt: "2026-06-30T23:59:00.000Z",
      progressPercent: 37.6,
      summary: "把运营中枢从方向页推进到可用控制面",
      milestones: [{
        title: "内测验收",
        status: "active",
        dueAt: "2026-05-15T23:59:00.000Z",
        evidenceRefs: [{ kind: "work_item", value: "work-item-evidence-1", label: "验收任务" }],
      }],
      evidenceRefs: [
        { kind: "work_item", value: "work-item-evidence-1", label: "验收任务" },
        { kind: "url", value: "https://example.com/report", label: "报告" },
      ],
      relatedAssetIds: ["asset-ledger-1", "asset-ledger-1"],
      linkedDecisionIds: ["decision-ledger-1"],
      linkedRiskIds: ["risk-ledger-1"],
      relatedCadenceIds: ["cadence-ledger-1"],
      relatedWorkItemIds: ["work-item-1"],
      now: "2026-04-23T18:10:00.000Z",
    });

    assert.equal(commitment.status, "active");
    assert.equal(commitment.progressPercent, 38);
    assert.equal(commitment.ownerPrincipalId, "principal-owner");
    assert.equal(commitment.milestones[0]?.title, "内测验收");
    assert.equal(commitment.evidenceRefs[0]?.kind, "work_item");
    assert.deepEqual(commitment.relatedAssetIds, ["asset-ledger-1"]);
    assert.deepEqual(commitment.linkedRiskIds, ["risk-ledger-1"]);

    const listed = context.service.listCommitments({
      principalId: "principal-owner",
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.commitmentId, commitment.commitmentId);

    const inspector = new Database(context.databaseFile, { readonly: true });

    try {
      const row = inspector.prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name = 'themis_principal_commitments'
        `,
      ).get() as { name: string } | undefined;

      assert.equal(row?.name, "themis_principal_commitments");
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("listCommitments 默认隐藏 archived，并支持按状态筛选", () => {
  const context = createServiceContext();

  try {
    context.service.createCommitment({
      principalId: "principal-owner",
      title: "Q2 发布主线",
      status: "active",
      dueAt: "2026-06-30T23:59:00.000Z",
      now: "2026-04-23T18:20:00.000Z",
    });
    context.service.createCommitment({
      principalId: "principal-owner",
      title: "安全审计补齐",
      status: "at_risk",
      dueAt: "2026-05-15T23:59:00.000Z",
      now: "2026-04-23T18:21:00.000Z",
    });
    context.service.createCommitment({
      principalId: "principal-owner",
      title: "历史承诺归档",
      status: "archived",
      dueAt: "2026-03-31T23:59:00.000Z",
      now: "2026-04-23T18:22:00.000Z",
    });

    const visible = context.service.listCommitments({
      principalId: "principal-owner",
    });
    const atRisk = context.service.listCommitments({
      principalId: "principal-owner",
      status: "at_risk",
    });
    const archived = context.service.listCommitments({
      principalId: "principal-owner",
      status: "archived",
      includeArchived: true,
    });

    assert.deepEqual(
      visible.map((commitment) => commitment.title),
      ["安全审计补齐", "Q2 发布主线"],
    );
    assert.deepEqual(
      atRisk.map((commitment) => commitment.title),
      ["安全审计补齐"],
    );
    assert.deepEqual(
      archived.map((commitment) => commitment.title),
      ["历史承诺归档"],
    );
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("updateCommitment 会保留 createdAt，并允许清空 owner、startsAt 和 summary", () => {
  const context = createServiceContext();

  try {
    const created = context.service.createCommitment({
      principalId: "principal-owner",
      title: "Q2 发布主线",
      status: "active",
      ownerPrincipalId: "principal-owner",
      startsAt: "2026-04-01T00:00:00.000Z",
      dueAt: "2026-06-30T23:59:00.000Z",
      progressPercent: 45,
      summary: "先把发布主线跑通",
      milestones: [{
        title: "灰度完成",
        status: "active",
        evidenceRefs: [],
      }],
      evidenceRefs: [{ kind: "url", value: "https://example.com/gray", label: "灰度记录" }],
      relatedAssetIds: ["asset-ledger-1"],
      linkedDecisionIds: ["decision-ledger-1"],
      linkedRiskIds: ["risk-ledger-1"],
      relatedCadenceIds: ["cadence-ledger-1"],
      relatedWorkItemIds: ["work-item-1"],
      now: "2026-04-23T18:30:00.000Z",
    });

    const updated = context.service.updateCommitment({
      principalId: "principal-owner",
      commitmentId: created.commitmentId,
      title: "Q2 发布主线扩展",
      status: "at_risk",
      ownerPrincipalId: "",
      startsAt: "",
      dueAt: "2026-07-15T23:59:00.000Z",
      progressPercent: 64,
      summary: "",
      milestones: [],
      evidenceRefs: [],
      relatedAssetIds: ["asset-ledger-2"],
      linkedDecisionIds: ["decision-ledger-2"],
      linkedRiskIds: ["risk-ledger-2"],
      relatedCadenceIds: ["cadence-ledger-2"],
      relatedWorkItemIds: ["work-item-2"],
      now: "2026-04-23T18:40:00.000Z",
    });

    assert.equal(updated.createdAt, "2026-04-23T18:30:00.000Z");
    assert.equal(updated.updatedAt, "2026-04-23T18:40:00.000Z");
    assert.equal(updated.status, "at_risk");
    assert.equal(updated.ownerPrincipalId, undefined);
    assert.equal(updated.startsAt, undefined);
    assert.equal(updated.summary, undefined);
    assert.equal(updated.dueAt, "2026-07-15T23:59:00.000Z");
    assert.equal(updated.progressPercent, 64);
    assert.deepEqual(updated.milestones, []);
    assert.deepEqual(updated.evidenceRefs, []);
    assert.deepEqual(updated.relatedAssetIds, ["asset-ledger-2"]);
    assert.deepEqual(updated.linkedDecisionIds, ["decision-ledger-2"]);
    assert.deepEqual(updated.linkedRiskIds, ["risk-ledger-2"]);
    assert.deepEqual(updated.relatedCadenceIds, ["cadence-ledger-2"]);
    assert.deepEqual(updated.relatedWorkItemIds, ["work-item-2"]);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("createCommitment 和 updateCommitment 会同步承诺相关自动关系边", () => {
  const context = createServiceContext();
  const operationEdgesService = new PrincipalOperationEdgesService({ registry: context.registry });
  const service = new PrincipalCommitmentsService({
    registry: context.registry,
    operationEdgesService,
  });

  try {
    const created = service.createCommitment({
      principalId: "principal-owner",
      commitmentId: "commitment-ledger-auto",
      title: "Q2 发布主线",
      status: "active",
      dueAt: "2026-06-30T23:59:00.000Z",
      relatedAssetIds: ["asset-ledger-1"],
      linkedDecisionIds: ["decision-ledger-1"],
      linkedRiskIds: ["risk-ledger-1"],
      relatedCadenceIds: ["cadence-ledger-1"],
      relatedWorkItemIds: ["work-item-1"],
      evidenceRefs: [{ kind: "work_item", value: "work-item-evidence-1", label: "验收任务" }],
      now: "2026-04-23T18:50:00.000Z",
    });
    const initialEdges = operationEdgesService.listEdges({
      principalId: "principal-owner",
    });

    assert.deepEqual(
      initialEdges.map((edge) => `${edge.fromObjectType}:${edge.fromObjectId}:${edge.relationType}:${edge.toObjectType}:${edge.toObjectId}`).sort(),
      [
        "cadence:cadence-ledger-1:tracks:commitment:commitment-ledger-auto",
        "commitment:commitment-ledger-auto:depends_on:decision:decision-ledger-1",
        "commitment:commitment-ledger-auto:depends_on:work_item:work-item-1",
        "commitment:commitment-ledger-auto:relates_to:asset:asset-ledger-1",
        "risk:risk-ledger-1:blocks:commitment:commitment-ledger-auto",
        "work_item:work-item-evidence-1:evidence_for:commitment:commitment-ledger-auto",
      ],
    );

    service.updateCommitment({
      principalId: "principal-owner",
      commitmentId: created.commitmentId,
      title: "Q2 发布主线",
      status: "archived",
      dueAt: "2026-06-30T23:59:00.000Z",
      relatedAssetIds: ["asset-ledger-2"],
      linkedDecisionIds: ["decision-ledger-2"],
      linkedRiskIds: ["risk-ledger-2"],
      relatedCadenceIds: ["cadence-ledger-2"],
      relatedWorkItemIds: ["work-item-2"],
      evidenceRefs: [],
      now: "2026-04-23T18:55:00.000Z",
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
    assert.equal(archivedEdges.length, 6);
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("createCommitment 遇到已解决风险或已完成承诺时不会生成当前阻塞边", () => {
  const context = createServiceContext();
  const operationEdgesService = new PrincipalOperationEdgesService({ registry: context.registry });
  const service = new PrincipalCommitmentsService({
    registry: context.registry,
    operationEdgesService,
  });

  try {
    context.registry.savePrincipalRisk({
      principalId: "principal-owner",
      riskId: "risk-ledger-resolved",
      type: "incident",
      title: "历史 520 事故",
      severity: "medium",
      status: "resolved",
      detectedAt: "2026-04-23T18:56:00.000Z",
      relatedAssetIds: [],
      linkedDecisionIds: [],
      relatedWorkItemIds: [],
      createdAt: "2026-04-23T18:56:00.000Z",
      updatedAt: "2026-04-23T18:56:00.000Z",
    });

    service.createCommitment({
      principalId: "principal-owner",
      commitmentId: "commitment-ledger-done",
      title: "历史事故收口",
      status: "done",
      dueAt: "2026-04-23T18:59:00.000Z",
      linkedRiskIds: ["risk-ledger-resolved"],
      now: "2026-04-23T19:00:00.000Z",
    });

    const edges = operationEdgesService.listEdges({
      principalId: "principal-owner",
    });

    assert.deepEqual(
      edges.map((edge) => `${edge.fromObjectType}:${edge.fromObjectId}:${edge.relationType}:${edge.toObjectType}:${edge.toObjectId}`),
      ["risk:risk-ledger-resolved:relates_to:commitment:commitment-ledger-done"],
    );
    assert.equal(edges[0]?.label, "承诺关联风险");
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});
