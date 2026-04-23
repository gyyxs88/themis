import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOperationsAssetsState,
  createOperationsAssetsController,
} from "./operations-assets.js";

test("load 会读取资产台账并回写状态", async () => {
  const state = createDefaultOperationsAssetsState();
  const app = createAppStub(state);
  const controller = createOperationsAssetsController(app);
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
        assets: [{
          assetId: "asset-ledger-1",
          principalId: "principal-1",
          kind: "site",
          name: "Themis 官网",
          status: "active",
          ownerPrincipalId: "principal-owner",
          summary: "主站入口",
          tags: ["官网"],
          refs: [{
            kind: "domain",
            value: "themis.example.com",
          }],
          createdAt: "2026-04-23T02:00:00.000Z",
          updatedAt: "2026-04-23T02:05:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/operations/assets/list");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(calls[0].body.status, "active");
    assert.equal(result.assets.length, 1);
    assert.equal(app.runtime.operationsAssets.status, "ready");
    assert.equal(app.runtime.operationsAssets.assets[0].assetId, "asset-ledger-1");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("save 在新建后会刷新列表，并把筛选切到新资产状态", async () => {
  const state = createDefaultOperationsAssetsState();
  state.filterStatus = "active";
  state.draft = {
    kind: "database",
    name: "订单库",
    status: "watch",
    ownerPrincipalId: "principal-db",
    summary: "核心业务库",
    tagsText: "生产, 核心",
    refsText: "host:10.0.0.12\ndoc|docs/runbooks/order-db.md|Runbook",
  };
  const app = createAppStub(state);
  const controller = createOperationsAssetsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/operations/assets/create") {
        return new Response(JSON.stringify({
          asset: {
            assetId: "asset-ledger-2",
            principalId: "principal-1",
            kind: "database",
            name: "订单库",
            status: "watch",
            ownerPrincipalId: "principal-db",
            summary: "核心业务库",
            tags: ["生产", "核心"],
            refs: [{
              kind: "host",
              value: "10.0.0.12",
            }, {
              kind: "doc",
              value: "docs/runbooks/order-db.md",
              label: "Runbook",
            }],
            createdAt: "2026-04-23T03:00:00.000Z",
            updatedAt: "2026-04-23T03:00:00.000Z",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        assets: [{
          assetId: "asset-ledger-2",
          principalId: "principal-1",
          kind: "database",
          name: "订单库",
          status: "watch",
          ownerPrincipalId: "principal-db",
          summary: "核心业务库",
          tags: ["生产", "核心"],
          refs: [{
            kind: "host",
            value: "10.0.0.12",
          }, {
            kind: "doc",
            value: "docs/runbooks/order-db.md",
            label: "Runbook",
          }],
          createdAt: "2026-04-23T03:00:00.000Z",
          updatedAt: "2026-04-23T03:00:00.000Z",
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.save();

    assert.equal(calls[0].url, "/api/operations/assets/create");
    assert.equal(calls[0].body.asset.status, "watch");
    assert.equal(calls[0].body.asset.refs.length, 2);
    assert.equal(calls[1].url, "/api/operations/assets/list");
    assert.equal(calls[1].body.status, "watch");
    assert.equal(app.runtime.operationsAssets.noticeMessage, "已新建资产台账。");
    assert.equal(app.runtime.operationsAssets.filterStatus, "watch");
    assert.equal(app.runtime.operationsAssets.selectedAssetId, "asset-ledger-2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectAsset 会把选中的资产写回编辑草稿", () => {
  const state = createDefaultOperationsAssetsState();
  state.assets = [{
    assetId: "asset-ledger-3",
    principalId: "principal-1",
    kind: "service",
    name: "支付回调",
    status: "active",
    ownerPrincipalId: "principal-pay",
    summary: "收支付网关回调",
    tags: ["支付"],
    refs: [{
      kind: "url",
      value: "https://api.example.com/pay/callback",
    }],
    createdAt: "2026-04-23T04:00:00.000Z",
    updatedAt: "2026-04-23T04:00:00.000Z",
  }];
  const app = createAppStub(state);
  const controller = createOperationsAssetsController(app);

  controller.selectAsset("asset-ledger-3");

  assert.equal(app.runtime.operationsAssets.selectedAssetId, "asset-ledger-3");
  assert.equal(app.runtime.operationsAssets.draft.kind, "service");
  assert.equal(app.runtime.operationsAssets.draft.name, "支付回调");
  assert.match(app.runtime.operationsAssets.draft.refsText, /url:https:\/\/api\.example\.com\/pay\/callback/);
});

function createAppStub(operationsAssetsState) {
  return {
    runtime: {
      operationsAssets: operationsAssetsState,
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
      operationsAssetsRefreshButton: null,
      operationsAssetsNewButton: null,
      operationsAssetsFilterSelect: null,
      operationsAssetsKindSelect: null,
      operationsAssetsNameInput: null,
      operationsAssetsStatusSelect: null,
      operationsAssetsOwnerInput: null,
      operationsAssetsTagsInput: null,
      operationsAssetsRefsInput: null,
      operationsAssetsSummaryInput: null,
      operationsAssetsSaveButton: null,
      operationsAssetsResetButton: null,
      operationsAssetsList: null,
    },
  };
}
