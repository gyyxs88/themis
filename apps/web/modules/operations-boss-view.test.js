import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultOperationsBossViewState,
  createOperationsBossViewController,
} from "./operations-boss-view.js";

test("load 会读取老板视图并回写状态", async () => {
  const state = createDefaultOperationsBossViewState();
  const app = createAppStub(state);
  const controller = createOperationsBossViewController(app);
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
        bossView: {
          principalId: "principal-owner",
          generatedAt: "2026-04-23T18:30:00.000Z",
          headline: {
            tone: "red",
            title: "今天先处理红灯",
            summary: "有 1 个高危未收口风险。",
          },
          metrics: [{
            key: "open_risks",
            label: "未收口风险",
            value: 1,
            tone: "red",
            detail: "1 个 high / critical。",
          }],
          focusItems: [{
            objectType: "risk",
            objectId: "risk-ledger-1",
            title: "prod-web CPU 突增",
            label: "critical / open",
            tone: "red",
            summary: "关联资产：prod-web",
            actionLabel: "确认 owner / 缓解动作",
          }],
          relationItems: [],
          recentDecisions: [],
          inventory: {},
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await controller.load();

    assert.equal(calls[0].url, "/api/operations/boss-view");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.channel, "web");
    assert.equal(calls[0].body.channelUserId, "browser-123");
    assert.equal(result.status, "ready");
    assert.equal(app.runtime.operationsBossView.bossView.headline.title, "今天先处理红灯");
    assert.equal(app.runtime.operationsBossView.bossView.metrics[0].value, 1);
    assert.equal(app.runtime.operationsBossView.noticeMessage, "老板视图已刷新。");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("load 失败时会回写错误状态", async () => {
  const state = createDefaultOperationsBossViewState();
  const app = createAppStub(state);
  const controller = createOperationsBossViewController(app);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: {
        message: "老板视图请求失败。",
      },
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });

    await assert.rejects(() => controller.load(), /老板视图请求失败/);
    assert.equal(app.runtime.operationsBossView.status, "error");
    assert.equal(app.runtime.operationsBossView.loading, false);
    assert.equal(app.runtime.operationsBossView.errorMessage, "老板视图请求失败。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppStub(operationsBossViewState) {
  return {
    runtime: {
      operationsBossView: operationsBossViewState,
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
      operationsBossViewRefreshButton: null,
    },
  };
}
