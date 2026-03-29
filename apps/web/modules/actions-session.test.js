import assert from "node:assert/strict";
import test from "node:test";
import { createSessionActions } from "./actions-session.js";

test("handleForkSession 在原生 fork 成功时会提交 targetSessionId 并直接绑定新的 serverThreadId", async () => {
  const harness = createSessionHarness();
  const originalFetch = globalThis.fetch;
  const calls = [];

  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body) : null,
      });

      return new Response(JSON.stringify({
        strategy: "native-thread-fork",
        sourceThreadId: "server-thread-source-1",
        threadId: "server-thread-forked-1",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    const actions = createSessionActions(harness.app);
    await actions.handleForkSession();

    const request = calls[0];
    const fork = harness.app.store.state.threads[0];

    assert.equal(request?.url, "/api/sessions/fork-context");
    assert.equal(request?.method, "POST");
    assert.deepEqual(request?.body, {
      sessionId: "thread-source-1",
      threadId: "server-thread-source-1",
      targetSessionId: "thread-fork-1",
    });
    assert.equal(fork.id, "thread-fork-1");
    assert.equal(fork.serverThreadId, "server-thread-forked-1");
    assert.equal(fork.bootstrapTranscript, "");
    assert.equal(fork.bootstrapMode, null);
    assert.match(harness.app.store.transientStatus?.text ?? "", /直接 fork|无需再导入/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleForkSession 在真实 server fork 请求失败时会回退到本地 transcript fork", async () => {
  const harness = createSessionHarness();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: {
        message: "fork failed",
      },
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });

    const actions = createSessionActions(harness.app);
    await actions.handleForkSession();

    const fork = harness.app.store.state.threads[0];

    assert.equal(harness.app.store.state.threads.length, 2);
    assert.equal(harness.app.store.state.activeThreadId, "thread-fork-1");
    assert.equal(fork.id, "thread-fork-1");
    assert.equal(fork.serverThreadId, null);
    assert.equal(fork.bootstrapTranscript, "local transcript");
    assert.equal(fork.bootstrapMode, "local-transcript");
    assert.match(harness.app.store.transientStatus?.text ?? "", /浏览器|本地|逐轮会话转录/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleForkSession 在服务端返回 SESSION_CONFLICT 时不会回退到本地 transcript fork", async () => {
  const harness = createSessionHarness();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: {
        code: "SESSION_CONFLICT",
        message: "Target session already has persisted history and cannot be rebound.",
      },
    }), {
      status: 409,
      headers: {
        "Content-Type": "application/json",
      },
    });

    const actions = createSessionActions(harness.app);
    await actions.handleForkSession();

    assert.equal(harness.app.store.state.threads.length, 1);
    assert.equal(harness.app.store.state.activeThreadId, "thread-source-1");
    assert.match(harness.app.store.transientStatus?.text ?? "", /persisted history|cannot be rebound|冲突/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createSessionHarness() {
  const sourceThread = {
    id: "thread-source-1",
    title: "源会话",
    settings: {
      workspacePath: "/workspace/demo",
    },
    serverThreadId: "server-thread-source-1",
    bootstrapTranscript: "",
    bootstrapMode: null,
    turns: [
      {
        id: "turn-source-1",
        goal: "源会话 turn",
      },
    ],
  };
  const createdFork = {
    id: "thread-fork-1",
    title: "新会话",
    settings: {},
    serverThreadId: null,
    bootstrapTranscript: "",
    bootstrapMode: null,
    turns: [],
  };
  const app = {
    runtime: {
      sessionControlBusy: false,
      workspaceToolsOpen: true,
    },
    dom: {
      goalInput: {
        focus() {},
      },
    },
    store: {
      transientStatus: null,
      state: {
        activeThreadId: sourceThread.id,
        threads: [sourceThread],
      },
      getActiveThread() {
        return this.state.threads.find((thread) => thread.id === this.state.activeThreadId) ?? null;
      },
      createThread() {
        return structuredClone(createdFork);
      },
      createDefaultThreadSettings() {
        return {
          workspacePath: "",
        };
      },
      trimThreads() {},
      saveState() {},
      setTransientStatus(threadId, text) {
        this.transientStatus = {
          threadId,
          text,
        };
      },
      buildLocalForkTranscript() {
        return "local transcript";
      },
      normalizeBootstrapMode(value) {
        return value === "session-transcript" || value === "local-transcript" ? value : null;
      },
      describeBootstrapLabel() {
        return "真实 Codex 会话";
      },
    },
    sessionSettings: {
      persistThreadSettings: async () => ({ ok: true }),
    },
    renderer: {
      renderAll() {},
    },
    utils: {
      safeReadJson: async (response) => await response.json(),
    },
  };

  return {
    app,
  };
}
