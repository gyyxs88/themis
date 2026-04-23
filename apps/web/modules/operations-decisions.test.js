import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOperationsDecisionsState,
  createOperationsDecisionsController,
} from "./operations-decisions.js";

test("load 会读取决策记录并回写状态", async () => {
  const state = createDefaultOperationsDecisionsState();
  const app = createAppStub(state);
  const controller = createOperationsDecisionsController(app);
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
        decisions: [{
          decisionId: "decision-ledger-1",
          principalId: "principal-1",
          title: "当前阶段先叫运营中枢",
          status: "active",
          summary: "数字公司操作系统留作最终形态",
          decidedByPrincipalId: "principal-owner",
          decidedAt: "2026-04-23T14:00:00.000Z",
          relatedAssetIds: ["asset-ledger-1"],
          relatedWorkItemIds: ["work-item-1"],
          createdAt: "2026-04-23T14:00:00.000Z",
          updatedAt: "2026-04-23T14:05:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/operations/decisions/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.status, "active");
    assert.equal(result.decisions.length, 1);
    assert.equal(app.runtime.operationsDecisions.status, "ready");
    assert.equal(app.runtime.operationsDecisions.decisions[0].decisionId, "decision-ledger-1");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("save 在新建后会刷新列表，并把筛选切到新决策状态", async () => {
  const state = createDefaultOperationsDecisionsState();
  state.filterStatus = "active";
  state.draft = {
    title: "先把决策沉淀成结构化对象",
    status: "superseded",
    decidedByPrincipalId: "principal-owner",
    decidedAt: "2026-04-23T14:15:00.000Z",
    relatedAssetIdsText: "asset-ledger-1\nasset-ledger-2",
    relatedWorkItemIdsText: "work-item-1, work-item-2",
    summary: "避免关键拍板只散在聊天里",
  };
  const app = createAppStub(state);
  const controller = createOperationsDecisionsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/operations/decisions/create") {
        return new Response(JSON.stringify({
          decision: {
            decisionId: "decision-ledger-2",
            principalId: "principal-1",
            title: "先把决策沉淀成结构化对象",
            status: "superseded",
            decidedByPrincipalId: "principal-owner",
            decidedAt: "2026-04-23T14:15:00.000Z",
            relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
            relatedWorkItemIds: ["work-item-1", "work-item-2"],
            summary: "避免关键拍板只散在聊天里",
            createdAt: "2026-04-23T14:15:00.000Z",
            updatedAt: "2026-04-23T14:15:00.000Z",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        decisions: [{
          decisionId: "decision-ledger-2",
          principalId: "principal-1",
          title: "先把决策沉淀成结构化对象",
          status: "superseded",
          decidedByPrincipalId: "principal-owner",
          decidedAt: "2026-04-23T14:15:00.000Z",
          relatedAssetIds: ["asset-ledger-1", "asset-ledger-2"],
          relatedWorkItemIds: ["work-item-1", "work-item-2"],
          summary: "避免关键拍板只散在聊天里",
          createdAt: "2026-04-23T14:15:00.000Z",
          updatedAt: "2026-04-23T14:15:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.save();

    assert.equal(calls[0].url, "/api/operations/decisions/create");
    assert.equal(calls[0].body.decision.status, "superseded");
    assert.deepEqual(calls[0].body.decision.relatedAssetIds, ["asset-ledger-1", "asset-ledger-2"]);
    assert.deepEqual(calls[0].body.decision.relatedWorkItemIds, ["work-item-1", "work-item-2"]);
    assert.equal(calls[1].url, "/api/operations/decisions/list");
    assert.equal(calls[1].body.status, "superseded");
    assert.equal(app.runtime.operationsDecisions.noticeMessage, "已新建决策记录。");
    assert.equal(app.runtime.operationsDecisions.filterStatus, "superseded");
    assert.equal(app.runtime.operationsDecisions.selectedDecisionId, "decision-ledger-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectDecision 会把选中的决策写回编辑草稿", () => {
  const state = createDefaultOperationsDecisionsState();
  state.decisions = [{
    decisionId: "decision-ledger-3",
    principalId: "principal-1",
    title: "先做 Asset，再补 Decision",
    status: "active",
    summary: "先把真实世界锚点补起来",
    decidedByPrincipalId: "principal-owner",
    decidedAt: "2026-04-23T14:30:00.000Z",
    relatedAssetIds: ["asset-ledger-1"],
    relatedWorkItemIds: ["work-item-1"],
    createdAt: "2026-04-23T14:30:00.000Z",
    updatedAt: "2026-04-23T14:30:00.000Z",
  }];
  const app = createAppStub(state);
  const controller = createOperationsDecisionsController(app);

  controller.selectDecision("decision-ledger-3");

  assert.equal(app.runtime.operationsDecisions.selectedDecisionId, "decision-ledger-3");
  assert.equal(app.runtime.operationsDecisions.draft.title, "先做 Asset，再补 Decision");
  assert.equal(app.runtime.operationsDecisions.draft.decidedByPrincipalId, "principal-owner");
  assert.match(app.runtime.operationsDecisions.draft.relatedAssetIdsText, /asset-ledger-1/);
});

function createAppStub(operationsDecisionsState) {
  return {
    runtime: {
      operationsDecisions: operationsDecisionsState,
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
      operationsDecisionsRefreshButton: null,
      operationsDecisionsNewButton: null,
      operationsDecisionsFilterSelect: null,
      operationsDecisionsTitleInput: null,
      operationsDecisionsStatusSelect: null,
      operationsDecisionsDecidedByInput: null,
      operationsDecisionsDecidedAtInput: null,
      operationsDecisionsRelatedAssetsInput: null,
      operationsDecisionsRelatedWorkItemsInput: null,
      operationsDecisionsSummaryInput: null,
      operationsDecisionsSaveButton: null,
      operationsDecisionsResetButton: null,
      operationsDecisionsList: null,
    },
  };
}
