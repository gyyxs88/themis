export function createSessionActions(app) {
  const { dom, store } = app;

  async function handleResetSession() {
    const thread = store.getActiveThread();

    if (!thread || store.isBusy() || app.runtime.sessionControlBusy) {
      return;
    }

    if (!thread.serverThreadId) {
      thread.bootstrapTranscript = "";
      thread.bootstrapMode = null;
      store.touchThread(thread.id);
      store.setTransientStatus(thread.id, "当前会话还没有绑定后端上下文，无需重置。");
      store.saveState();
      app.renderer.renderAll();
      return;
    }

    try {
      app.runtime.sessionControlBusy = true;
      app.renderer.renderAll();

      const response = await fetch("/api/sessions/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: thread.id,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "重置会话失败。");
      }

      thread.serverThreadId = null;
      thread.bootstrapTranscript = "";
      thread.bootstrapMode = null;
      store.touchThread(thread.id);
      store.setTransientStatus(
        thread.id,
        data?.cleared
          ? "已重置当前会话的后端上下文。下一次发送会创建新的 Codex 会话。"
          : "当前会话没有可重置的后端上下文。",
      );
      store.saveState();
      app.renderer.renderAll();
    } catch (error) {
      store.setTransientStatus(thread.id, error.message ?? "重置会话失败。");
      app.renderer.renderAll();
    } finally {
      app.runtime.sessionControlBusy = false;
      app.renderer.renderAll();
    }
  }

  async function handleForkSession() {
    const source = store.getActiveThread();

    if (!source || store.isBusy() || app.runtime.sessionControlBusy) {
      return;
    }

    try {
      app.runtime.sessionControlBusy = true;
      store.setTransientStatus(source.id, "正在准备分叉会话，优先从真实 Codex 会话提取逐轮转录。");
      app.renderer.renderAll();

      const bootstrap = await buildForkBootstrap(source);
      const fork = store.createThread();
      fork.title = `${source.title} / 分叉`;
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
        bootstrap.message ?? `已创建分叉会话。第一次发送时会把${store.describeBootstrapLabel(fork)}导入新的 Codex 会话。`,
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
            message: `已创建分叉会话。第一次发送时会把真实 Codex 会话的逐轮转录导入新的后端会话。${
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
      message: "已创建分叉会话。第一次发送时会把浏览器里保存的逐轮会话转录导入新的 Codex 会话。",
    };
  }

  return {
    handleResetSession,
    handleForkSession,
  };
}
