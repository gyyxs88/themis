import assert from "node:assert/strict";
import test from "node:test";
import { createAgentsController, createDefaultAgentsState } from "./agents.js";

test("load 会只读取 Platform Agents 兼容状态", async () => {
  const state = createDefaultAgentsState();
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/list") {
        return jsonResponse({
          compatibility: {
            panelOwnership: "platform",
            accessMode: "platform_gateway",
            statusLevel: "warning",
            message: "当前 Platform Agents 面板只是主 Themis 里的平台兼容入口；实际读写已走平台控制面，后续会迁到独立 Platform 前端。",
            platformBaseUrl: "http://platform.example.com",
            ownerPrincipalId: "principal-platform-owner",
          },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    const result = await controller.load();

    assert.deepEqual(
      calls.map((entry) => entry.url),
      ["/api/agents/list"],
    );
    assert.equal(result.status, "ready");
    assert.equal(result.loading, false);
    assert.equal(result.compatibilityStatus?.panelOwnership, "platform");
    assert.equal(result.compatibilityStatus?.accessMode, "platform_gateway");
    assert.equal(result.compatibilityStatus?.platformBaseUrl, "http://platform.example.com");
    assert.equal(result.compatibilityStatus?.ownerPrincipalId, "principal-platform-owner");
    assert.ok(app.renderer.renderAllCallCount >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("load 在 gateway_required 时只保留状态，不再继续请求治理接口", async () => {
  const state = createDefaultAgentsState();
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: JSON.parse(init.body),
      });

      if (url === "/api/agents/list") {
        return jsonResponse({
          compatibility: {
            panelOwnership: "platform",
            accessMode: "gateway_required",
            statusLevel: "error",
            message: "当前 Platform Agents 兼容入口已经收口为纯 gateway；请先配置 THEMIS_PLATFORM_*，或直接使用独立 themis-platform 页面。",
          },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    };

    const result = await controller.load();

    assert.deepEqual(
      calls.map((entry) => entry.url),
      ["/api/agents/list"],
    );
    assert.equal(result.compatibilityStatus?.accessMode, "gateway_required");
    assert.equal(result.compatibilityStatus?.statusLevel, "error");
    assert.equal(result.errorMessage, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bindControls 会在点击刷新和切到 agents 分区时触发入口状态刷新", async () => {
  const state = createDefaultAgentsState();
  const app = createAppStub(state);
  const controller = createAgentsController(app);
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url) => {
      calls.push(url);
      return jsonResponse({
        compatibility: {
          panelOwnership: "platform",
          accessMode: "gateway_required",
          statusLevel: "error",
          message: "当前 Platform Agents 兼容入口已经收口为纯 gateway；请先配置 THEMIS_PLATFORM_*。",
        },
      });
    };

    controller.bindControls();

    app.dom.agentsRefreshButton.dispatch("click");
    await flushMicrotasks();

    app.dom.workspaceToolsPanel.dispatch("click", {
      target: {
        closest(selector) {
          if (selector === "[data-settings-section]") {
            return {
              dataset: {
                settingsSection: "agents",
              },
            };
          }

          return null;
        },
      },
    });
    await flushMicrotasks();

    app.runtime.workspaceToolsOpen = true;
    app.runtime.workspaceToolsSection = "agents";
    app.dom.workspaceToolsToggle.dispatch("click");
    await flushMicrotasks();
    await flushMicrotasks();

    assert.deepEqual(calls, [
      "/api/agents/list",
      "/api/agents/list",
      "/api/agents/list",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppStub(initialAgentsState) {
  return {
    dom: {
      agentsRefreshButton: createEventTargetStub(),
      workspaceToolsPanel: createEventTargetStub(),
      workspaceToolsToggle: createEventTargetStub(),
    },
    runtime: {
      identity: {
        browserUserId: "browser-user-1",
      },
      auth: {
        account: {
          email: "owner@example.com",
        },
      },
      workspaceToolsOpen: false,
      workspaceToolsSection: "runtime",
      agents: initialAgentsState,
    },
    renderer: {
      renderAllCallCount: 0,
      renderAll() {
        this.renderAllCallCount += 1;
      },
    },
  };
}

function createEventTargetStub() {
  const listeners = new Map();

  return {
    addEventListener(type, handler) {
      const queue = listeners.get(type) ?? [];
      queue.push(handler);
      listeners.set(type, queue);
    },
    dispatch(type, event = {}) {
      const queue = listeners.get(type) ?? [];

      for (const handler of queue) {
        handler(event);
      }
    },
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
}
