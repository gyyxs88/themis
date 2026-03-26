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

test("persistThreadSettings 会返回并回写服务端规范化 workspacePath", async () => {
  const { app, thread } = createAppHarness();
  const originalFetch = globalThis.fetch;
  let requestPayload = null;

  try {
    globalThis.fetch = async (_url, init = {}) => {
      requestPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        ok: true,
        settings: {
          workspacePath: "/srv/projects/demo",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const controller = createSessionSettingsController(app);
    const result = await controller.persistThreadSettings("thread-1", {
      workspacePath: "/srv/projects/demo/child/..",
    });

    assert.equal(requestPayload?.settings?.workspacePath, "/srv/projects/demo/child/..");
    assert.equal(result?.ok, true);
    assert.equal(result?.settings?.workspacePath, "/srv/projects/demo");
    assert.equal(thread.settings.workspacePath, "/srv/projects/demo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("工作区保存成功后，本地会话设置使用服务端返回值而不是原始输入", async () => {
  const { app, thread } = createAppHarness();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      settings: {
        workspacePath: "/tmp/foo",
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const controller = createSessionSettingsController(app);
    thread.settings.workspacePath = "/tmp/foo/child/..";

    const result = await controller.persistThreadSettings("thread-1", thread.settings);

    assert.equal(result?.ok, true);
    assert.equal(result?.settings?.workspacePath, "/tmp/foo");
    assert.equal(thread.settings.workspacePath, "/tmp/foo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("commitThreadSettings 会在保存完成前保持忙碌态，并在成功后解除", async () => {
  const { app, thread } = createAppHarness({
    workspacePath: "/tmp/foo/child/..",
  });
  const originalFetch = globalThis.fetch;
  let releasePersist = null;

  try {
    globalThis.fetch = async (_url, init = {}) => {
      if ((init.method ?? "GET") === "PUT") {
        await new Promise((resolve) => {
          releasePersist = resolve;
        });
        return new Response(JSON.stringify({
          ok: true,
          settings: {
            workspacePath: "/tmp/foo",
          },
        }), {
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
    const pending = controller.commitThreadSettings("thread-1", { quiet: true });

    assert.equal(app.runtime.sessionControlBusy, true);
    assert.equal(thread.settings.workspacePath, "/tmp/foo/child/..");

    releasePersist?.();
    const result = await pending;

    assert.equal(result?.ok, true);
    assert.equal(app.runtime.sessionControlBusy, false);
    assert.equal(thread.settings.workspacePath, "/tmp/foo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("commitThreadSettings 失败后会优先按服务端真实 settings 对齐，而不是盲目回滚旧值", async () => {
  const { app, thread } = createAppHarness({
    workspacePath: "/srv/old",
  });
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (_url, init = {}) => {
      const method = init.method ?? "GET";
      calls.push(method);

      if (method === "PUT") {
        return new Response(JSON.stringify({
          error: {
            message: "timeout",
          },
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        found: true,
        settings: {
          workspacePath: "/srv/actual",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const controller = createSessionSettingsController(app);
    thread.settings.workspacePath = "/srv/new/child/..";

    const result = await controller.commitThreadSettings("thread-1", { quiet: true });

    assert.equal(result?.ok, false);
    assert.equal(result?.reconciled, true);
    assert.equal(thread.settings.workspacePath, "/srv/actual");
    assert.deepEqual(calls, ["PUT", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("commitThreadSettings 在继承保存失败且服务端无记录时，不会保留前端继承假象", async () => {
  const { app, thread } = createAppHarness({
    workspacePath: "/srv/inherited",
  });
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (_url, init = {}) => {
      const method = init.method ?? "GET";

      if (method === "PUT") {
        return new Response(JSON.stringify({
          error: {
            message: "network",
          },
        }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        found: false,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const controller = createSessionSettingsController(app);
    const result = await controller.commitThreadSettings("thread-1", {
      quiet: true,
      clearWorkspaceOnUnknownFailure: true,
    });

    assert.equal(result?.ok, false);
    assert.equal(result?.reconciled, true);
    assert.equal(result?.found, false);
    assert.equal(thread.settings.workspacePath, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("commitThreadSettings 保存期间重复触发不会并发打出多个 PUT", async () => {
  const { app } = createAppHarness({
    workspacePath: "/srv/inherited",
  });
  const originalFetch = globalThis.fetch;
  let putCount = 0;
  let releasePersist = null;

  try {
    globalThis.fetch = async (_url, init = {}) => {
      const method = init.method ?? "GET";

      if (method === "PUT") {
        putCount += 1;
        await new Promise((resolve) => {
          releasePersist = resolve;
        });
        return new Response(JSON.stringify({
          ok: true,
          settings: {
            workspacePath: "/srv/inherited",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        found: false,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const controller = createSessionSettingsController(app);
    const first = controller.commitThreadSettings("thread-1", { quiet: true });
    const second = await controller.commitThreadSettings("thread-1", { quiet: true });

    assert.equal(second?.ok, false);
    assert.equal(second?.code, "BUSY");
    assert.equal(putCount, 1);

    releasePersist?.();
    const firstResult = await first;
    assert.equal(firstResult?.ok, true);
    assert.equal(putCount, 1);
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
    runtime: {
      sessionControlBusy: false,
    },
    store: {
      state: {
        activeThreadId: "thread-1",
      },
      getThreadById(threadId) {
        return threadId === "thread-1" ? thread : null;
      },
      getActiveThread() {
        return thread;
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
