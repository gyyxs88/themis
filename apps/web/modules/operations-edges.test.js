import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOperationsEdgesState,
  createOperationsEdgesController,
} from "./operations-edges.js";

test("load 会读取关系边并回写状态", async () => {
  const state = createDefaultOperationsEdgesState();
  const app = createAppStub(state);
  const controller = createOperationsEdgesController(app);
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
        edges: [{
          edgeId: "operation-edge-1",
          principalId: "principal-1",
          fromObjectType: "decision",
          fromObjectId: "decision-ledger-1",
          toObjectType: "risk",
          toObjectId: "risk-ledger-1",
          relationType: "mitigates",
          status: "active",
          label: "先降级风险",
          summary: "该决策用于降低支付风险",
          createdAt: "2026-04-23T18:00:00.000Z",
          updatedAt: "2026-04-23T18:05:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/operations/edges/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.status, "active");
    assert.equal(result.edges.length, 1);
    assert.equal(app.runtime.operationsEdges.status, "ready");
    assert.equal(app.runtime.operationsEdges.edges[0].edgeId, "operation-edge-1");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("save 在新建后会刷新列表，并把筛选切到新关系边状态", async () => {
  const state = createDefaultOperationsEdgesState();
  state.filterStatus = "active";
  state.draft = {
    fromObjectType: "cadence",
    fromObjectId: "cadence-ledger-1",
    toObjectType: "risk",
    toObjectId: "risk-ledger-1",
    relationType: "tracks",
    status: "archived",
    label: "周检跟踪风险",
    summary: "该节奏用于持续跟踪风险变化",
  };
  const app = createAppStub(state);
  const controller = createOperationsEdgesController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/operations/edges/create") {
        return new Response(JSON.stringify({
          edge: {
            edgeId: "operation-edge-2",
            principalId: "principal-1",
            fromObjectType: "cadence",
            fromObjectId: "cadence-ledger-1",
            toObjectType: "risk",
            toObjectId: "risk-ledger-1",
            relationType: "tracks",
            status: "archived",
            label: "周检跟踪风险",
            summary: "该节奏用于持续跟踪风险变化",
            createdAt: "2026-04-23T18:15:00.000Z",
            updatedAt: "2026-04-23T18:15:00.000Z",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        edges: [{
          edgeId: "operation-edge-2",
          principalId: "principal-1",
          fromObjectType: "cadence",
          fromObjectId: "cadence-ledger-1",
          toObjectType: "risk",
          toObjectId: "risk-ledger-1",
          relationType: "tracks",
          status: "archived",
          label: "周检跟踪风险",
          summary: "该节奏用于持续跟踪风险变化",
          createdAt: "2026-04-23T18:15:00.000Z",
          updatedAt: "2026-04-23T18:15:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.save();

    assert.equal(calls[0].url, "/api/operations/edges/create");
    assert.equal(calls[0].body.edge.relationType, "tracks");
    assert.equal(calls[0].body.edge.status, "archived");
    assert.equal(calls[1].url, "/api/operations/edges/list");
    assert.equal(calls[1].body.status, "archived");
    assert.equal(app.runtime.operationsEdges.noticeMessage, "已新建关系边。");
    assert.equal(app.runtime.operationsEdges.filterStatus, "archived");
    assert.equal(app.runtime.operationsEdges.selectedEdgeId, "operation-edge-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectEdge 会把选中的关系边写回编辑草稿", () => {
  const state = createDefaultOperationsEdgesState();
  state.edges = [{
    edgeId: "operation-edge-3",
    principalId: "principal-1",
    fromObjectType: "decision",
    fromObjectId: "decision-ledger-1",
    toObjectType: "risk",
    toObjectId: "risk-ledger-1",
    relationType: "mitigates",
    status: "active",
    label: "先降级风险",
    summary: "该决策用于降低支付风险",
    createdAt: "2026-04-23T18:20:00.000Z",
    updatedAt: "2026-04-23T18:20:00.000Z",
  }];
  const app = createAppStub(state);
  const controller = createOperationsEdgesController(app);

  controller.selectEdge("operation-edge-3");

  assert.equal(app.runtime.operationsEdges.selectedEdgeId, "operation-edge-3");
  assert.equal(app.runtime.operationsEdges.draft.fromObjectType, "decision");
  assert.equal(app.runtime.operationsEdges.draft.toObjectType, "risk");
  assert.equal(app.runtime.operationsEdges.draft.relationType, "mitigates");
});

function createAppStub(operationsEdgesState) {
  return {
    runtime: {
      operationsEdges: operationsEdgesState,
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
      operationsEdgesRefreshButton: null,
      operationsEdgesNewButton: null,
      operationsEdgesFilterSelect: null,
      operationsEdgesFromTypeSelect: null,
      operationsEdgesFromIdInput: null,
      operationsEdgesToTypeSelect: null,
      operationsEdgesToIdInput: null,
      operationsEdgesRelationSelect: null,
      operationsEdgesStatusSelect: null,
      operationsEdgesLabelInput: null,
      operationsEdgesSummaryInput: null,
      operationsEdgesSaveButton: null,
      operationsEdgesResetButton: null,
      operationsEdgesList: null,
    },
  };
}
