import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOperationsRisksState,
  createOperationsRisksController,
} from "./operations-risks.js";

test("load 会读取风险记录并回写状态", async () => {
  const state = createDefaultOperationsRisksState();
  const app = createAppStub(state);
  const controller = createOperationsRisksController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      return new Response(JSON.stringify({
        risks: [{
          riskId: "risk-ledger-1",
          principalId: "principal-1",
          type: "incident",
          title: "prod-web CPU 突增",
          severity: "critical",
          status: "open",
          ownerPrincipalId: "principal-owner",
          summary: "首页大量超时",
          detectedAt: "2026-04-23T16:00:00.000Z",
          relatedAssetIds: ["asset-ledger-1"],
          linkedDecisionIds: ["decision-ledger-1"],
          relatedWorkItemIds: ["work-item-1"],
          createdAt: "2026-04-23T16:00:00.000Z",
          updatedAt: "2026-04-23T16:05:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/operations/risks/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.status, "open");
    assert.equal(result.risks.length, 1);
    assert.equal(app.runtime.operationsRisks.status, "ready");
    assert.equal(app.runtime.operationsRisks.risks[0].riskId, "risk-ledger-1");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("save 在新建后会刷新列表，并把筛选切到新风险状态", async () => {
  const state = createDefaultOperationsRisksState();
  state.filterStatus = "open";
  state.draft = {
    type: "risk",
    title: "Cloudflare 账号权限过大",
    severity: "high",
    status: "watch",
    ownerPrincipalId: "principal-owner",
    detectedAt: "2026-04-23T16:15:00.000Z",
    relatedAssetIdsText: "asset-ledger-1",
    linkedDecisionIdsText: "decision-ledger-1\ndecision-ledger-2",
    relatedWorkItemIdsText: "work-item-1, work-item-2",
    summary: "当前有共享超管风险",
  };
  const app = createAppStub(state);
  const controller = createOperationsRisksController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/operations/risks/create") {
        return new Response(JSON.stringify({
          risk: {
            riskId: "risk-ledger-2",
            principalId: "principal-1",
            type: "risk",
            title: "Cloudflare 账号权限过大",
            severity: "high",
            status: "watch",
            ownerPrincipalId: "principal-owner",
            detectedAt: "2026-04-23T16:15:00.000Z",
            relatedAssetIds: ["asset-ledger-1"],
            linkedDecisionIds: ["decision-ledger-1", "decision-ledger-2"],
            relatedWorkItemIds: ["work-item-1", "work-item-2"],
            summary: "当前有共享超管风险",
            createdAt: "2026-04-23T16:15:00.000Z",
            updatedAt: "2026-04-23T16:15:00.000Z",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        risks: [{
          riskId: "risk-ledger-2",
          principalId: "principal-1",
          type: "risk",
          title: "Cloudflare 账号权限过大",
          severity: "high",
          status: "watch",
          ownerPrincipalId: "principal-owner",
          detectedAt: "2026-04-23T16:15:00.000Z",
          relatedAssetIds: ["asset-ledger-1"],
          linkedDecisionIds: ["decision-ledger-1", "decision-ledger-2"],
          relatedWorkItemIds: ["work-item-1", "work-item-2"],
          summary: "当前有共享超管风险",
          createdAt: "2026-04-23T16:15:00.000Z",
          updatedAt: "2026-04-23T16:15:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.save();

    assert.equal(calls[0].url, "/api/operations/risks/create");
    assert.equal(calls[0].body.risk.status, "watch");
    assert.deepEqual(calls[0].body.risk.linkedDecisionIds, ["decision-ledger-1", "decision-ledger-2"]);
    assert.equal(calls[1].url, "/api/operations/risks/list");
    assert.equal(calls[1].body.status, "watch");
    assert.equal(app.runtime.operationsRisks.noticeMessage, "已新建风险记录。");
    assert.equal(app.runtime.operationsRisks.filterStatus, "watch");
    assert.equal(app.runtime.operationsRisks.selectedRiskId, "risk-ledger-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectRisk 会把选中的风险写回编辑草稿", () => {
  const state = createDefaultOperationsRisksState();
  state.risks = [{
    riskId: "risk-ledger-3",
    principalId: "principal-1",
    type: "incident",
    title: "支付回调失败",
    severity: "critical",
    status: "open",
    ownerPrincipalId: "principal-pay",
    summary: "导致订单未自动确认",
    detectedAt: "2026-04-23T16:30:00.000Z",
    relatedAssetIds: ["asset-ledger-2"],
    linkedDecisionIds: ["decision-ledger-3"],
    relatedWorkItemIds: ["work-item-3"],
    createdAt: "2026-04-23T16:30:00.000Z",
    updatedAt: "2026-04-23T16:30:00.000Z",
  }];
  const app = createAppStub(state);
  const controller = createOperationsRisksController(app);

  controller.selectRisk("risk-ledger-3");

  assert.equal(app.runtime.operationsRisks.selectedRiskId, "risk-ledger-3");
  assert.equal(app.runtime.operationsRisks.draft.type, "incident");
  assert.equal(app.runtime.operationsRisks.draft.title, "支付回调失败");
  assert.match(app.runtime.operationsRisks.draft.linkedDecisionIdsText, /decision-ledger-3/);
});

function createAppStub(operationsRisksState) {
  return {
    runtime: {
      operationsRisks: operationsRisksState,
      identity: {
        browserUserId: "browser-123",
      },
      auth: {
        account: {
          email: "owner@example.com",
        },
      },
    },
    utils: {
      autoResizeTextarea() {},
      async safeReadJson(response) {
        return await response.json();
      },
    },
    renderer: {
      renderAllCallCount: 0,
      renderAll() {
        this.renderAllCallCount += 1;
      },
    },
    dom: {
      operationsRisksRefreshButton: null,
      operationsRisksNewButton: null,
      operationsRisksFilterSelect: null,
      operationsRisksTypeSelect: null,
      operationsRisksSeveritySelect: null,
      operationsRisksStatusSelect: null,
      operationsRisksTitleInput: null,
      operationsRisksOwnerInput: null,
      operationsRisksDetectedAtInput: null,
      operationsRisksRelatedAssetsInput: null,
      operationsRisksLinkedDecisionsInput: null,
      operationsRisksRelatedWorkItemsInput: null,
      operationsRisksSummaryInput: null,
      operationsRisksSaveButton: null,
      operationsRisksResetButton: null,
      operationsRisksList: null,
    },
  };
}
