export function createSessionActions(app) {
  const { dom, store } = app;

  async function handleForkSession() {
    const source = store.getActiveThread();

    if (!source || app.runtime.sessionControlBusy) {
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
      void app.sessionSettings.persistThreadSettings(fork.id, fork.settings, { quiet: true });
      app.runtime.workspaceToolsOpen = false;
      app.renderer.renderAll(true);
      dom.goalInput.focus();
    } finally {
      app.runtime.sessionControlBusy = false;
      app.renderer.renderAll();
    }
  }

  async function handleJoinConversation() {
    const rawConversationId = typeof dom.conversationLinkInput?.value === "string"
      ? dom.conversationLinkInput.value.trim()
      : "";

    if (!rawConversationId || app.runtime.sessionControlBusy) {
      return;
    }

    try {
      app.runtime.sessionControlBusy = true;
      app.renderer.renderAll();

      const result = await app.history.attachConversationById(rawConversationId);
      const thread = result.thread ?? store.getThreadById(rawConversationId);

      if (thread) {
        store.setTransientStatus(
          thread.id,
          result.foundHistory
            ? `已切到 conversation ${thread.id}，本机历史和会话设置已载入。`
            : `已切到 conversation ${thread.id}。当前还没有本机历史，下一次发送会直接接到这个统一会话。`,
        );
      }

      dom.conversationLinkInput.value = "";
      app.runtime.workspaceToolsOpen = false;
      app.renderer.renderAll(true);
      dom.goalInput.focus();
    } finally {
      app.runtime.sessionControlBusy = false;
      app.renderer.renderAll();
    }
  }

  async function handleResetPrincipalState() {
    if (app.runtime.sessionControlBusy || store.isBusy()) {
      return;
    }

    const confirmed = window.confirm(
      "这会清空当前 principal 的人格档案、对话历史和记忆，并让 Web / 飞书从头开始。确认继续？",
    );

    if (!confirmed) {
      return;
    }

    const activeThread = store.getActiveThread();

    try {
      app.runtime.sessionControlBusy = true;

      if (activeThread) {
        store.setTransientStatus(activeThread.id, "正在清空当前 principal 的人格档案、历史和记忆。");
      }

      app.renderer.renderAll();

      const identity = app.identity.getRequestIdentity();
      const response = await fetch("/api/identity/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: "web",
          channelUserId: identity.userId,
          ...(identity.displayName ? { displayName: identity.displayName } : {}),
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "重置失败。");
      }

      const nextThread = store.createThread();
      const reset = data?.reset ?? {};
      const clearedConversationCount = Number.isFinite(reset.clearedConversationCount)
        ? Number(reset.clearedConversationCount)
        : 0;
      const clearedTurnCount = Number.isFinite(reset.clearedTurnCount)
        ? Number(reset.clearedTurnCount)
        : 0;

      store.state = {
        activeThreadId: nextThread.id,
        threads: [nextThread],
      };
      store.clearTransientStatus();
      store.setTransientStatus(
        nextThread.id,
        `已清空当前 principal 的人格档案、历史和记忆。共删除 ${clearedConversationCount} 条会话、${clearedTurnCount} 条任务记录。`,
      );
      app.runtime.activeRequestController = null;
      app.runtime.activeRunRef = null;
      app.runtime.workspaceToolsOpen = false;
      app.runtime.historyHydratingThreadId = null;
      app.runtime.identity = {
        ...app.runtime.identity,
        linkCode: "",
        linkCodeExpiresAt: "",
        errorMessage: "",
      };

      store.saveState();
      await app.sessionSettings.loadThreadSettings(nextThread.id, { quiet: true });
      void app.identity.load({ quiet: true });
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
    handleJoinConversation,
    handleResetPrincipalState,
  };
}
