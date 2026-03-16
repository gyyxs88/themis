export function createComposerActions(app, streamActions) {
  const { DEFAULT_ROLE, DEFAULT_WORKFLOW } = app.constants;
  const { dom, store } = app;

  function bindComposerControls() {
    dom.goalInput.addEventListener("input", () => {
      app.utils.autoResizeTextarea(dom.goalInput);
      store.updateActiveDraft("draftGoal", dom.goalInput.value);
    });

    dom.contextInput.addEventListener("input", () => {
      app.utils.autoResizeTextarea(dom.contextInput);
      store.updateActiveDraft("draftContext", dom.contextInput.value);
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

    const goal = thread.draftGoal.trim();
    const inputText = thread.draftContext.trim();
    const workflow = store.state.selectedWorkflow ?? DEFAULT_WORKFLOW;
    const role = store.state.selectedRole ?? DEFAULT_ROLE;

    if (!goal) {
      dom.goalInput.focus();
      return;
    }

    const turn = store.createTurn({
      workflow,
      role,
      goal,
      inputText,
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
          workflow,
          role,
          goal,
          inputText,
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

    if (button.dataset.workflow) {
      store.state = {
        ...store.state,
        selectedWorkflow: button.dataset.workflow,
      };
    }

    if (button.dataset.goal) {
      thread.draftGoal = button.dataset.goal;
    }

    if (button.dataset.context) {
      thread.draftContext = button.dataset.context;
    }

    store.touchThread(thread.id);
    store.saveState();
    app.renderer.renderAll();
    dom.goalInput.focus();
  }

  return {
    bindComposerControls,
    bindLifecycleEvents,
  };
}
