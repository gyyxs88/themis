import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrincipalAssetsService } from "./principal-assets-service.js";
import { PrincipalCadencesService } from "./principal-cadences-service.js";
import { PrincipalCommitmentsService } from "./principal-commitments-service.js";
import { PrincipalDecisionsService } from "./principal-decisions-service.js";
import { PrincipalOperationEdgesService } from "./principal-operation-edges-service.js";
import { PrincipalOperationsBossViewService } from "./principal-operations-boss-view-service.js";
import { PrincipalRisksService } from "./principal-risks-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";

test("getBossView 会把风险、节奏、关系边聚合成老板视图红灯", () => {
  const root = mkdtempSync(join(tmpdir(), "themis-operations-boss-view-"));
  const registry = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const assetsService = new PrincipalAssetsService({ registry });
  const cadencesService = new PrincipalCadencesService({ registry });
  const commitmentsService = new PrincipalCommitmentsService({ registry });
  const decisionsService = new PrincipalDecisionsService({ registry });
  const edgesService = new PrincipalOperationEdgesService({ registry });
  const risksService = new PrincipalRisksService({ registry });
  const bossViewService = new PrincipalOperationsBossViewService({
    assetsService,
    cadencesService,
    commitmentsService,
    decisionsService,
    edgesService,
    risksService,
  });
  registry.savePrincipal({
    principalId: "principal-owner",
    displayName: "Owner",
    createdAt: "2026-04-23T05:00:00.000Z",
    updatedAt: "2026-04-23T05:00:00.000Z",
  });

  try {
    const principalId = "principal-owner";
    assetsService.createAsset({
      principalId,
      assetId: "asset-prod-web",
      kind: "site",
      name: "prod-web",
      status: "watch",
      summary: "生产入口需要补固定巡检。",
      now: "2026-04-22T08:00:00.000Z",
    });
    decisionsService.createDecision({
      principalId,
      decisionId: "decision-freeze",
      title: "先冻结发布窗口",
      status: "active",
      summary: "风险未收口前不继续发布。",
      decidedAt: "2026-04-23T07:30:00.000Z",
      now: "2026-04-23T07:30:00.000Z",
    });
    risksService.createRisk({
      principalId,
      riskId: "risk-prod-web-cpu",
      type: "incident",
      title: "prod-web CPU 突增",
      severity: "critical",
      status: "open",
      relatedAssetIds: ["asset-prod-web"],
      detectedAt: "2026-04-23T06:00:00.000Z",
      now: "2026-04-23T06:00:00.000Z",
    });
    cadencesService.createCadence({
      principalId,
      cadenceId: "cadence-prod-web-weekly",
      title: "prod-web 周检",
      frequency: "weekly",
      status: "active",
      nextRunAt: "2026-04-22T01:00:00.000Z",
      now: "2026-04-20T08:00:00.000Z",
    });
    commitmentsService.createCommitment({
      principalId,
      commitmentId: "commitment-q2-launch",
      title: "Q2 发布主线必须收口",
      status: "at_risk",
      dueAt: "2026-04-22T23:59:00.000Z",
      linkedRiskIds: ["risk-prod-web-cpu"],
      relatedCadenceIds: ["cadence-prod-web-weekly"],
      now: "2026-04-20T08:10:00.000Z",
    });
    edgesService.createEdge({
      principalId,
      edgeId: "edge-freeze-blocks-release",
      fromObjectType: "risk",
      fromObjectId: "risk-prod-web-cpu",
      toObjectType: "decision",
      toObjectId: "decision-freeze",
      relationType: "blocks",
      label: "风险阻塞发布",
      status: "active",
      now: "2026-04-23T07:40:00.000Z",
    });

    const bossView = bossViewService.getBossView({
      principalId,
      now: "2026-04-23T08:00:00.000Z",
    });

    assert.equal(bossView.headline.tone, "red");
    assert.equal(bossView.inventory.risks.highOrCriticalOpen, 1);
    assert.equal(bossView.inventory.cadences.overdue, 1);
    assert.equal(bossView.inventory.commitments.atRisk, 1);
    assert.equal(bossView.inventory.commitments.overdue, 1);
    assert.equal(bossView.inventory.edges.blocking, 1);
    assert.equal(bossView.focusItems[0]?.title, "prod-web CPU 突增");
    assert.ok(bossView.focusItems.some((item) => item.title === "Q2 发布主线必须收口"));
    assert.ok(bossView.focusItems.some((item) => item.title === "风险阻塞发布"));
    assert.equal(bossView.relationItems[0]?.fromLabel, "prod-web CPU 突增");
    assert.equal(bossView.relationItems[0]?.toLabel, "先冻结发布窗口");
    assert.equal(bossView.recentDecisions[0]?.title, "先冻结发布窗口");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
