import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultUpdateManagerState, createUpdateManagerController } from "./update-manager.js";

test("load 会读取后端更新概览并回写前端状态", async () => {
  const app = createAppStub(createDefaultUpdateManagerState());
  const controller = createUpdateManagerController(app);
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;

  try {
    globalThis.window = {
      setTimeout: () => 0,
      clearTimeout: () => {},
      confirm: () => true,
    };
    globalThis.fetch = async (url) => {
      assert.equal(url, "/api/updates");
      return jsonResponse({
        check: {
          packageVersion: "0.1.0",
          currentCommit: "1234567890abcdef",
          updateChannel: "release",
          latestCommit: "abcdef1234567890",
          latestReleaseTag: "v0.1.0",
          summary: "当前已经是 GitHub 最新正式 release。",
        },
        operation: null,
        rollbackAnchor: {
          available: true,
          previousCommit: "111111122222223333333",
          currentCommit: "444444455555556666666",
          appliedReleaseTag: "v0.0.9",
          recordedAt: "2026-04-11T00:00:00.000Z",
        },
      });
    };

    const result = await controller.load();

    assert.equal(result.status, "ready");
    assert.equal(app.runtime.updateManager.check?.updateChannel, "release");
    assert.equal(app.runtime.updateManager.check?.latestReleaseTag, "v0.1.0");
    assert.equal(app.runtime.updateManager.rollbackAnchor.available, true);
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("applyUpdate 会带 confirm 调后端并写入 noticeMessage", async () => {
  const app = createAppStub(createDefaultUpdateManagerState());
  const controller = createUpdateManagerController(app);
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];

  try {
    globalThis.window = {
      setTimeout: () => 0,
      clearTimeout: () => {},
      confirm: () => true,
    };
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });

      return jsonResponse({
        ok: true,
        operation: {
          action: "apply",
          status: "running",
          progressStep: "preflight",
          progressMessage: "已受理后台升级请求，正在准备执行。",
        },
      }, 202);
    };

    const result = await controller.applyUpdate();

    assert.equal(result.noticeMessage, "后台升级已启动。");
    assert.equal(result.operation?.action, "apply");
    assert.equal(result.operation?.status, "running");
    assert.equal(calls[0]?.url, "/api/updates/apply");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(calls[0]?.body, { confirm: true });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

function createAppStub(updateManagerState) {
  return {
    runtime: {
      updateManager: updateManagerState,
      workspaceToolsOpen: false,
      workspaceToolsSection: "runtime",
    },
    dom: {
      updateManagerRefreshButton: null,
      updateManagerApplyButton: null,
      updateManagerRollbackButton: null,
      workspaceToolsPanel: null,
      workspaceToolsToggle: null,
    },
    utils: {
      safeReadJson: async (response) => response.json(),
    },
    renderer: {
      renderAllCallCount: 0,
      renderAll() {
        this.renderAllCallCount += 1;
      },
    },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
