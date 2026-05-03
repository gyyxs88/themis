import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultRuntimeConfigState, createRuntimeConfigController } from "./runtime-config.js";

test("runtime config load 会保留 provider capabilities 与 hooks 摘要", async () => {
  const app = createAppStub();
  const controller = createRuntimeConfigController(app);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, "/api/runtime/config");
      return new Response(JSON.stringify({
        models: [{
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          isDefault: true,
          capabilities: {
            supportsSearchTool: true,
          },
        }],
        defaults: {
          model: "gpt-5.5",
          reasoning: "xhigh",
        },
        providerCapabilities: {
          available: true,
          namespaceTools: true,
          imageGeneration: true,
          webSearch: true,
          readError: null,
        },
        runtimeHooks: {
          entries: [{
            cwd: "/workspace/demo",
            hooks: [{
              key: "project:userPromptSubmit:1",
              eventName: "userPromptSubmit",
              handlerType: "command",
              command: "node hook.js",
              timeoutSec: 10,
              enabled: true,
            }],
            warnings: ["hook warning"],
            errors: [{
              path: "/workspace/demo/bad-hook.toml",
              message: "bad hook",
            }],
          }],
          totalHookCount: 1,
          enabledHookCount: 1,
          warningCount: 1,
          errorCount: 1,
          readError: null,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await controller.load();

    assert.equal(app.runtime.runtimeConfig.status, "ready");
    assert.equal(app.runtime.runtimeConfig.models[0].model, "gpt-5.5");
    assert.equal(app.runtime.runtimeConfig.providerCapabilities.namespaceTools, true);
    assert.equal(app.runtime.runtimeConfig.providerCapabilities.imageGeneration, true);
    assert.equal(app.runtime.runtimeConfig.runtimeHooks.totalHookCount, 1);
    assert.equal(app.runtime.runtimeConfig.runtimeHooks.entries[0].hooks[0].command, "node hook.js");
    assert.equal(app.renderer.renderAllCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppStub() {
  return {
    runtime: {
      runtimeConfig: createDefaultRuntimeConfigState(),
    },
    utils: {
      safeReadJson: async (response) => await response.json(),
    },
    renderer: {
      renderAllCallCount: 0,
      renderAll() {
        this.renderAllCallCount += 1;
      },
    },
  };
}
