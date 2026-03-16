export function createComposerActions(app, streamActions) {
  const { dom, store } = app;

  function bindComposerControls() {
    dom.goalInput.addEventListener("input", () => {
      flattenDraftContext();
      app.utils.autoResizeTextarea(dom.goalInput);
      store.updateActiveDraft("draftGoal", dom.goalInput.value);
    });

    dom.goalInput.addEventListener("keydown", (event) => {
      if (event.isComposing || event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      dom.form.requestSubmit();
    });

    dom.cancelButton.addEventListener("click", () => {
      if (!app.runtime.activeRequestController || !app.runtime.activeRunRef) {
        return;
      }

      app.runtime.activeRequestController.abort();
      const turn = store.getTurn(app.runtime.activeRunRef.threadId, app.runtime.activeRunRef.turnId);

      if (!turn) {
        return;
      }

      store.appendStep(turn, "已请求取消", "浏览器已发出取消信号，服务端会停止对应任务。");
      turn.state = "cancelled";
      store.touchThread(app.runtime.activeRunRef.threadId);
      store.saveState();
      app.renderer.renderAll(true);
    });

    dom.form.addEventListener("submit", handleSubmit);
  }

  function bindLifecycleEvents() {
    document.addEventListener("click", (event) => {
      const suggestionButton = event.target.closest(".suggestion-chip");

      if (suggestionButton) {
        applySuggestion(suggestionButton);
      }
    });

    window.addEventListener("beforeunload", () => {
      app.runtime.activeRequestController?.abort();
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const thread = store.getActiveThread();

    if (!thread || store.isBusy() || app.runtime.sessionControlBusy) {
      return;
    }

    const goal = mergeDraftContent(thread.draftGoal, thread.draftContext).trim();

    if (!goal) {
      dom.goalInput.focus();
      return;
    }

    const turn = store.createTurn({
      goal,
      inputText: "",
      options: store.buildTaskOptions(thread.settings),
    });

    thread.turns.push(turn);
    thread.updatedAt = app.utils.nowIso();
    thread.draftGoal = "";
    thread.draftContext = "";

    if (store.isDefaultThreadTitle(thread.title)) {
      thread.title = app.utils.titleFromGoal(goal);
    }

    store.syncThreadStoredState(thread, turn);
    app.runtime.activeRunRef = {
      threadId: thread.id,
      turnId: turn.id,
    };
    app.runtime.activeRequestController = new AbortController();
    store.clearTransientStatus();
    store.trimThreads();
    store.saveState();
    app.renderer.renderAll(true);

    try {
      const historyContext = store.shouldBootstrapThread(thread) ? thread.bootstrapTranscript : "";
      const response = await fetch("/api/tasks/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: app.runtime.activeRequestController.signal,
        body: JSON.stringify({
          source: "web",
          goal,
          sessionId: thread.id,
          ...(turn.options ? { options: turn.options } : {}),
          ...(historyContext ? { historyContext } : {}),
        }),
      });

      if (!response.ok || !response.body) {
        const data = await app.utils.safeReadJson(response);
        throw new Error(data?.error?.message ?? "请求失败");
      }

      await streamActions.consumeNdjsonStream(response.body);
    } catch (error) {
      finalizeSubmitError(thread, error);
    }
  }

  function finalizeSubmitError(thread, error) {
    if (error?.name === "AbortError") {
      const currentTurn = store.getActiveTurn();

      if (currentTurn) {
        streamActions.finalizeTurnCancelled(currentTurn, "你已取消当前任务，浏览器已中止本次流式请求。");
        store.syncThreadStoredState(thread, currentTurn);
      }

      store.clearActiveRun();
      app.renderer.renderAll(true);
      return;
    }

    const currentTurn = store.getActiveTurn();

    if (currentTurn) {
      streamActions.finalizeTurnError(currentTurn, error?.message ?? "请求失败");
      store.syncThreadStoredState(thread, currentTurn);
    }

    store.clearActiveRun();
    app.renderer.renderAll(true);
  }

  function applySuggestion(button) {
    if (store.isBusy()) {
      return;
    }

    const thread = store.getActiveThread();

    if (!thread) {
      return;
    }

    if (button.dataset.goal || button.dataset.context) {
      thread.draftGoal = mergeDraftContent(button.dataset.goal ?? "", button.dataset.context ?? "");
      thread.draftContext = "";
    }

    store.touchThread(thread.id);
    store.saveState();
    app.renderer.renderAll();
    dom.goalInput.focus();
  }

  function flattenDraftContext() {
    const thread = store.getActiveThread();

    if (!thread || !thread.draftContext) {
      return;
    }

    thread.draftContext = "";
    store.touchThread(thread.id);
    store.saveState();
  }

  function mergeDraftContent(goal, context) {
    const normalizedGoal = typeof goal === "string" ? goal.trim() : "";
    const normalizedContext = typeof context === "string" ? context.trim() : "";

    if (!normalizedGoal) {
      return normalizedContext;
    }

    if (!normalizedContext) {
      return normalizedGoal;
    }

    return `${normalizedGoal}\n\n补充要求：\n${normalizedContext}`;
  }

  return {
    bindComposerControls,
    bindLifecycleEvents,
  };
}
