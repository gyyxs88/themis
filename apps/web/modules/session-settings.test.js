import assert from "node:assert/strict";
import test from "node:test";
import { createSessionSettingsController } from "./session-settings.js";
import { createStoreModelHelpers } from "./store-models.js";

test("loadThreadSettings 会把 workspacePath 回写到线程设置", async () => {
  const { app, thread } = createAppHarness();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({
        found: true,
        settings: {
          workspacePath: "/srv/projects/demo",
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

    const controller = createSessionSettingsController(app);
    await controller.loadThreadSettings("thread-1");

    assert.equal(thread.settings.workspacePath, "/srv/projects/demo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadThreadSettings 会把本地 workspacePath 写回服务端", async () => {
  const { app } = createAppHarness({
    workspacePath: "/srv/projects/demo",
  });
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body,
      });

      if ((init.method ?? "GET") === "PUT") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ found: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const controller = createSessionSettingsController(app);
    await controller.loadThreadSettings("thread-1");

    const putCall = calls.find((entry) => entry.method === "PUT");
    assert.ok(putCall);
    assert.equal(JSON.parse(putCall.body).settings.workspacePath, "/srv/projects/demo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("persistThreadSettings 会把 workspacePath 发给服务端", async () => {
  const { app } = createAppHarness();
  const originalFetch = globalThis.fetch;
  const payloads = [];

  try {
    globalThis.fetch = async (_url, init = {}) => {
      payloads.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const controller = createSessionSettingsController(app);
    await controller.persistThreadSettings("thread-1", {
      workspacePath: "/srv/projects/demo",
    });

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]?.settings?.workspacePath, "/srv/projects/demo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createAppHarness(options = {}) {
  const models = createStoreModelHelpers();
  const thread = {
    id: "thread-1",
    settings: {
      ...models.createDefaultThreadSettings(),
      workspacePath: options.workspacePath ?? "",
    },
  };

  const app = {
    store: {
      state: {
        activeThreadId: "thread-1",
      },
      getThreadById(threadId) {
        return threadId === "thread-1" ? thread : null;
      },
      createDefaultThreadSettings: models.createDefaultThreadSettings,
      saveState() {},
    },
    utils: {
      safeReadJson: async (response) => response.json(),
    },
    renderer: {
      renderAll() {},
    },
  };

  return {
    app,
    thread,
  };
}
