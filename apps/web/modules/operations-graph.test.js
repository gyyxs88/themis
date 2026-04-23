import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOperationsGraphState,
  createOperationsGraphController,
} from "./operations-graph.js";

test("load 会查询对象图并回写规范化结果", async () => {
  const state = createDefaultOperationsGraphState();
  state.rootObjectType = "risk";
  state.rootObjectId = "risk-ledger-1";
  state.targetObjectType = "asset";
  state.targetObjectId = "asset-ledger-1";
  state.maxDepth = "2";
  const app = createAppStub(state);
  const controller = createOperationsGraphController(app);
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
        graph: {
          principalId: "principal-1",
          generatedAt: "2026-04-23T20:00:00.000Z",
          maxDepth: 2,
          root: { objectType: "risk", objectId: "risk-ledger-1" },
          target: { objectType: "asset", objectId: "asset-ledger-1", reachable: true },
          nodes: [{
            objectType: "risk",
            objectId: "risk-ledger-1",
            depth: 0,
          }, {
            objectType: "commitment",
            objectId: "commitment-ledger-1",
            depth: 1,
            viaEdgeId: "operation-edge-1",
            viaObjectType: "risk",
            viaObjectId: "risk-ledger-1",
          }, {
            objectType: "asset",
            objectId: "asset-ledger-1",
            depth: 2,
            viaEdgeId: "operation-edge-2",
            viaObjectType: "commitment",
            viaObjectId: "commitment-ledger-1",
          }],
          edges: [{
            edgeId: "operation-edge-1",
            fromObjectType: "risk",
            fromObjectId: "risk-ledger-1",
            toObjectType: "commitment",
            toObjectId: "commitment-ledger-1",
            relationType: "blocks",
            status: "active",
            label: "风险阻塞承诺",
          }, {
            edgeId: "operation-edge-2",
            fromObjectType: "commitment",
            fromObjectId: "commitment-ledger-1",
            toObjectType: "asset",
            toObjectId: "asset-ledger-1",
            relationType: "depends_on",
            status: "active",
            label: "承诺依赖资产",
          }],
          shortestPath: [{
            edgeId: "operation-edge-1",
            fromObjectType: "risk",
            fromObjectId: "risk-ledger-1",
            toObjectType: "commitment",
            toObjectId: "commitment-ledger-1",
            relationType: "blocks",
            status: "active",
            label: "风险阻塞承诺",
          }, {
            edgeId: "operation-edge-2",
            fromObjectType: "commitment",
            fromObjectId: "commitment-ledger-1",
            toObjectType: "asset",
            toObjectId: "asset-ledger-1",
            relationType: "depends_on",
            status: "active",
            label: "承诺依赖资产",
          }],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/operations/graph/query");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.displayName, "owner@example.com");
    assert.equal(calls[0].body.rootObjectType, "risk");
    assert.equal(calls[0].body.rootObjectId, "risk-ledger-1");
    assert.equal(calls[0].body.targetObjectType, "asset");
    assert.equal(calls[0].body.targetObjectId, "asset-ledger-1");
    assert.equal(calls[0].body.maxDepth, 2);
    assert.equal(result.status, "ready");
    assert.equal(result.noticeMessage, "对象图已刷新。");
    assert.equal(result.graph.nodes.length, 3);
    assert.equal(result.graph.shortestPath[1].relationType, "depends_on");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("load 缺少根对象 id 时不会请求后端", async () => {
  const state = createDefaultOperationsGraphState();
  state.rootObjectId = "   ";
  const app = createAppStub(state);
  const controller = createOperationsGraphController(app);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => {
      throw new Error("fetch should not be called");
    };

    const result = await controller.load();

    assert.equal(result.status, "idle");
    assert.equal(result.errorMessage, "请先填写根对象 id。");
    assert.equal(app.renderer.renderAllCallCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppStub(operationsGraphState) {
  return {
    runtime: {
      operationsGraph: operationsGraphState,
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
      operationsGraphRefreshButton: null,
      operationsGraphRootTypeSelect: null,
      operationsGraphRootIdInput: null,
      operationsGraphTargetTypeSelect: null,
      operationsGraphTargetIdInput: null,
      operationsGraphDepthSelect: null,
    },
  };
}
