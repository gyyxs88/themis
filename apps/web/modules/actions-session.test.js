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

test("handleForkSession 成功后会收起 thread control join panel 并标记 fork 来源", async () => {
  const harness = createSessionHarness();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      strategy: "native-thread-fork",
      sourceThreadId: "server-thread-source-1",
      threadId: "server-thread-forked-1",
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });

    const actions = createSessionActions(harness.app);
    await actions.handleForkSession();

    const fork = harness.app.store.state.threads[0];

    assert.equal(fork.threadOrigin, "fork");
    assert.equal(harness.app.runtime.threadControlJoinOpen, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleJoinConversation 成功后会 attach、清空输入、收起 join panel 并给目标线程打 transient status", async () => {
  const harness = createSessionHarness();
  const actions = createSessionActions(harness.app);

  harness.app.dom.conversationLinkInput.value = " conversation-target-1 ";

  await actions.handleJoinConversation();

  assert.deepEqual(harness.attachConversationCalls, ["conversation-target-1"]);
  assert.equal(harness.app.dom.conversationLinkInput.value, "");
  assert.equal(harness.app.runtime.threadControlJoinOpen, false);
  assert.equal(harness.app.store.transientStatus?.threadId, "conversation-target-1");
  assert.match(harness.app.store.transientStatus?.text ?? "", /已切到 conversation/);
  assert.equal(harness.renderAllCalls.at(-2)?.scrollToBottom, true);
  assert.equal(harness.goalInputFocusCount.count, 1);
});

test("handleJoinConversation 失败后会保留输入和展开态，并给当前线程写 transient status", async () => {
  const harness = createSessionHarness({
    attachConversationById: async () => {
      throw new Error("join failed");
    },
  });
  const actions = createSessionActions(harness.app);

  harness.app.dom.conversationLinkInput.value = "conversation-target-1";
  await actions.handleJoinConversation();

  assert.equal(harness.app.dom.conversationLinkInput.value, "conversation-target-1");
  assert.equal(harness.app.runtime.threadControlJoinOpen, true);
  assert.equal(harness.app.store.transientStatus?.threadId, "thread-source-1");
  assert.equal(harness.app.store.transientStatus?.text, "join failed");
});

test("handleJoinConversation 失败后会留在原线程、保留输入和展开态，并把错误写回原线程", async () => {
  const harness = createSessionHarness({
    attachConversationById: async (rawConversationId) => {
      harness.attachConversationCalls.push(rawConversationId);
      harness.app.store.state = {
        ...harness.app.store.state,
        activeThreadId: "conversation-target-1",
        threads: [harness.conversationThread, ...harness.app.store.state.threads],
      };
      throw new Error("target thread failed");
    },
  });
  const actions = createSessionActions(harness.app);

  harness.app.dom.conversationLinkInput.value = "conversation-target-1";
  await actions.handleJoinConversation();

  assert.equal(harness.app.dom.conversationLinkInput.value, "conversation-target-1");
  assert.equal(harness.app.runtime.threadControlJoinOpen, true);
  assert.equal(harness.app.store.state.activeThreadId, "thread-source-1");
  assert.equal(harness.app.store.getActiveThread()?.id, "thread-source-1");
  assert.equal(harness.app.store.transientStatus?.threadId, "thread-source-1");
  assert.equal(harness.app.store.transientStatus?.text, "target thread failed");
});

test("handleResetPrincipalState 成功后会收口 thread control join panel 并切到新的空线程", async () => {
  const harness = createSessionHarness();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  try {
    globalThis.window = {
      confirm: () => true,
    };
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(url, "/api/identity/reset");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        channel: "web",
        channelUserId: "user-1",
      });

      return new Response(JSON.stringify({
        reset: {
          clearedConversationCount: 2,
          clearedTurnCount: 5,
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    };

    harness.app.runtime.threadControlJoinOpen = true;

    const actions = createSessionActions(harness.app);
    await actions.handleResetPrincipalState();

    assert.equal(harness.app.runtime.threadControlJoinOpen, false);
    assert.equal(harness.app.store.state.threads.length, 1);
    assert.equal(harness.app.store.state.activeThreadId, harness.app.store.state.threads[0].id);
    assert.match(harness.app.store.transientStatus?.text ?? "", /已清空当前 principal/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

function createSessionHarness(options = {}) {
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
    threadOrigin: "fresh",
    bootstrapTranscript: "",
    bootstrapMode: null,
    turns: [],
  };
  const conversationThread = {
    id: "conversation-target-1",
    title: "接入会话",
    settings: {},
    serverThreadId: "server-thread-target-1",
    threadOrigin: "attach",
    bootstrapTranscript: "",
    bootstrapMode: null,
    turns: [],
  };
  const renderAllCalls = [];
  const goalInputFocusCount = {
    count: 0,
  };
  const attachConversationCalls = [];
  const app = {
    runtime: {
      sessionControlBusy: false,
      threadControlJoinOpen: true,
      workspaceToolsOpen: true,
    },
    dom: {
      goalInput: {
        focus() {
          goalInputFocusCount.count += 1;
        },
      },
      conversationLinkInput: {
        value: "",
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
      getThreadById(threadId) {
        return this.state.threads.find((thread) => thread.id === threadId) ?? null;
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
      isBusy() {
        return false;
      },
      clearTransientStatus() {
        this.transientStatus = null;
      },
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
      async loadThreadSettings() {},
    },
    identity: {
      getRequestIdentity() {
        return { userId: "user-1" };
      },
      async load() {},
    },
    history: {
      attachConversationById: options.attachConversationById ?? (async (rawConversationId) => {
        attachConversationCalls.push(rawConversationId);
        app.store.state = {
          ...app.store.state,
          activeThreadId: conversationThread.id,
          threads: [conversationThread, ...app.store.state.threads],
        };
        return {
          thread: conversationThread,
          foundHistory: true,
        };
      }),
    },
    renderer: {
      renderAll(scrollToBottom = false) {
        renderAllCalls.push({ scrollToBottom });
      },
    },
    utils: {
      safeReadJson: async (response) => await response.json(),
    },
  };

  return {
    app,
    attachConversationCalls,
    conversationThread,
    goalInputFocusCount,
    renderAllCalls,
  };
}
