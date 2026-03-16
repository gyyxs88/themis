export function createSessionActions(app) {
  const { dom, store } = app;

  async function handleForkSession() {
    const source = store.getActiveThread();

    if (!source || store.isBusy() || app.runtime.sessionControlBusy) {
      return;
    }

    try {
      app.runtime.sessionControlBusy = true;
      store.setTransientStatus(source.id, "正在准备 fork 会话，优先从真实 Codex 会话提取逐轮转录。");
      app.renderer.renderAll();

      const bootstrap = await buildForkBootstrap(source);
      const fork = store.createThread();
      fork.title = buildForkTitle(source.title);
      fork.settings = {
        ...store.createDefaultThreadSettings(),
        ...source.settings,
      };
      fork.turns = JSON.parse(JSON.stringify(source.turns));
      fork.bootstrapTranscript = bootstrap.transcript;
      fork.bootstrapMode = bootstrap.mode;
      store.state.threads.unshift(fork);
      store.state = {
        ...store.state,
        activeThreadId: fork.id,
      };
      store.trimThreads();
      store.setTransientStatus(
        fork.id,
        bootstrap.message ?? `已创建 fork 会话。第一次发送时会把${store.describeBootstrapLabel(fork)}导入新的 Codex 会话。`,
      );
      store.saveState();
      app.runtime.workspaceToolsOpen = false;
      app.renderer.renderAll(true);
      dom.goalInput.focus();
    } finally {
      app.runtime.sessionControlBusy = false;
      app.renderer.renderAll();
    }
  }

  async function buildForkBootstrap(thread) {
    if (thread.serverThreadId) {
      try {
        const response = await fetch("/api/sessions/fork-context", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: thread.id,
            threadId: thread.serverThreadId,
          }),
        });
        const data = await app.utils.safeReadJson(response);

        if (response.ok && data?.historyContext) {
          return {
            transcript: data.historyContext,
            mode: store.normalizeBootstrapMode(data.strategy) ?? "session-transcript",
            message: `已创建 fork 会话。第一次发送时会把真实 Codex 会话的逐轮转录导入新的后端会话。${
              data?.truncated ? " 为控制上下文体积，较早的部分历史已截短。" : ""
            }`,
          };
        }
      } catch {
        // Fall back to local reconstruction when the server cannot read the persisted Codex session.
      }
    }

    return {
      transcript: store.buildLocalForkTranscript(thread),
      mode: "local-transcript",
      message: "已创建 fork 会话。第一次发送时会把浏览器里保存的逐轮会话转录导入新的 Codex 会话。",
    };
  }

  function buildForkTitle(title) {
    const baseTitle = typeof title === "string" && title.trim() ? title.trim() : "新会话";
    return `fork ${baseTitle}`;
  }

  return {
    handleForkSession,
  };
}
