export function createComposerActions(app, streamActions) {
  const { dom, store } = app;
  app.runtime.resumeInterruptedSubmit = () => {
    void resumeInterruptedSubmit();
  };

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

    if (!thread || app.runtime.sessionControlBusy) {
      return;
    }

    const runningThreadId = store.getRunningThreadId();

    if (runningThreadId) {
      requestInterruptSubmit(thread);
      return;
    }

    await submitThread(thread);
  }

  function requestInterruptSubmit(thread) {
    const draftGoal = typeof thread?.draftGoal === "string" ? thread.draftGoal : "";
    const draftContext = typeof thread?.draftContext === "string" ? thread.draftContext : "";
    const goal = mergeDraftContent(draftGoal, draftContext).trim();

    if (!goal) {
      if (store.getActiveThread()?.id === thread.id) {
        dom.goalInput.focus();
      }
      return;
    }

    if (!store.isBusy() || !app.runtime.activeRequestController) {
      void submitThread(thread, {
        goal,
        draftGoal,
        draftContext,
      });
      return;
    }

    app.runtime.pendingInterruptSubmit = {
      targetThreadId: thread.id,
      goal,
      draftGoal,
      draftContext,
    };
    app.renderer.renderAll();
    app.runtime.activeRequestController.abort(new Error("WEB_SUBMIT_REPLACED"));
  }

  async function submitThread(thread, pendingSubmission = null) {
    const goal = (pendingSubmission?.goal ?? mergeDraftContent(thread.draftGoal, thread.draftContext)).trim();

    if (!goal) {
      if (store.getActiveThread()?.id === thread.id) {
        dom.goalInput.focus();
      }
      return;
    }

    const accessMode = store.resolveAccessMode(thread.settings);

    if (accessMode === "auth") {
      const effectiveSettings = store.resolveEffectiveSettings(thread.settings);
      const authCheck = await app.auth.ensureAuthenticated({
        accountId: effectiveSettings.authAccountId,
      });

      if (!authCheck.ok) {
        store.setTransientStatus(thread.id, authCheck.message);
        app.runtime.workspaceToolsSection = "auth";
        app.runtime.workspaceToolsOpen = true;
        app.renderer.renderAll();
        return;
      }
    } else {
      const thirdPartySelection = store.resolveThirdPartySelection(thread.settings);
      const effectiveSettings = store.resolveEffectiveSettings(thread.settings);

      if (!thirdPartySelection.provider) {
        store.setTransientStatus(thread.id, "当前会话切到了第三方模式，但还没有可用的第三方供应商。");
        app.runtime.workspaceToolsSection = "third-party";
        app.runtime.workspaceToolsOpen = true;
        app.renderer.renderAll();
        return;
      }

      if (!thirdPartySelection.model) {
        store.setTransientStatus(thread.id, "当前第三方供应商没有可用模型，请先在设置中选择模型。");
        app.runtime.workspaceToolsSection = "mode-switch";
        app.runtime.workspaceToolsOpen = true;
        app.renderer.renderAll();
        return;
      }

      if (thirdPartySelection.model.supportsCodexTasks === false) {
        store.setTransientStatus(
          thread.id,
          "当前第三方模型未声明支持 Codex agent 任务。请先更换模型，或在模型能力里明确开启该能力。",
        );
        app.runtime.workspaceToolsSection = "third-party";
        app.runtime.workspaceToolsOpen = true;
        app.renderer.renderAll();
        return;
      }

      const searchWarning = store.resolveThirdPartyWebSearchWarning(thread.settings, thirdPartySelection.model);

      if (searchWarning) {
        store.setTransientStatus(thread.id, searchWarning);
        app.runtime.workspaceToolsSection = "runtime";
        app.runtime.workspaceToolsOpen = true;
        dom.webSearchSelect.value = effectiveSettings.webSearchMode || "disabled";
        app.renderer.renderAll();
        return;
      }
    }

    const personaSaved = await app.identity.saveAssistantPersona({
      assistantLanguageStyle: dom.assistantLanguageStyleInput.value,
      assistantMbti: dom.assistantMbtiInput.value,
      assistantStyleNotes: dom.assistantStyleNotesInput.value,
      assistantSoul: dom.assistantSoulInput.value,
    }, { quiet: false });

    if (!personaSaved) {
      return;
    }

    const turn = store.createTurn({
      goal,
      inputText: "",
      options: store.buildTaskOptions(thread.settings),
    });

    thread.turns.push(turn);
    thread.updatedAt = app.utils.nowIso();
    clearSubmittedDraft(thread, pendingSubmission);

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
    app.renderer.renderAll(shouldScrollThread(thread.id));

    try {
      const historyContext = store.shouldBootstrapThread(thread) ? thread.bootstrapTranscript : "";
      const identity = app.identity.getRequestIdentity();
      const response = await fetch("/api/tasks/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: app.runtime.activeRequestController.signal,
        body: JSON.stringify({
          source: "web",
          goal,
          userId: identity.userId,
          ...(identity.displayName ? { displayName: identity.displayName } : {}),
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
      const summary = app.runtime.pendingInterruptSubmit
        ? "已为新消息打断当前任务，浏览器已中止本次流式请求。"
        : "你已取消当前任务，浏览器已中止本次流式请求。";

      if (currentTurn) {
        streamActions.finalizeTurnCancelled(currentTurn, summary);
        store.syncThreadStoredState(thread, currentTurn);
      }

      store.clearActiveRun();
      app.renderer.renderAll(shouldScrollThread(thread.id));

      if (app.runtime.pendingInterruptSubmit) {
        app.runtime.resumeInterruptedSubmit?.();
      }
      return;
    }

    const currentTurn = store.getActiveTurn();

    if (currentTurn) {
      streamActions.finalizeTurnError(currentTurn, error?.message ?? "请求失败");
      store.syncThreadStoredState(thread, currentTurn);
    }

    store.clearActiveRun();
    app.renderer.renderAll(shouldScrollThread(thread.id));
  }

  async function resumeInterruptedSubmit() {
    const pending = app.runtime.pendingInterruptSubmit;
    app.runtime.pendingInterruptSubmit = null;

    if (!pending) {
      return;
    }

    const targetThread = store.getThreadById(pending.targetThreadId);

    if (!targetThread) {
      app.renderer.renderAll();
      return;
    }

    await submitThread(targetThread, pending);
  }

  function applySuggestion(button) {
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

  function clearSubmittedDraft(thread, pendingSubmission) {
    if (!pendingSubmission) {
      thread.draftGoal = "";
      thread.draftContext = "";
      return;
    }

    if ((thread.draftGoal ?? "") === pendingSubmission.draftGoal) {
      thread.draftGoal = "";
    }

    if ((thread.draftContext ?? "") === pendingSubmission.draftContext) {
      thread.draftContext = "";
    }
  }

  function shouldScrollThread(threadId) {
    return store.state.activeThreadId === threadId;
  }

  return {
    bindComposerControls,
    bindLifecycleEvents,
  };
}
