import { createActionInteraction } from "./actions-interaction.js";

export function createComposerActions(app, streamActions) {
  const { dom, store } = app;
  const actionInteraction = createActionInteraction({
    submitAction: submitActionRequest,
  });
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
      const turn = store.getActiveTurn();

      if (turn?.state === "waiting") {
        const activeThread = store.getActiveThread();

        store.appendStep(
          turn,
          "等待中的 action 不能直接取消",
          "请先提交这个 action，或者切回对应会话后再处理。",
          "warning",
        );

        if (activeThread) {
          store.setTransientStatus(activeThread.id, "当前等待中的 action 不能直接取消，请先提交或切回对应会话。");
        }

        store.touchThread(app.runtime.activeRunRef?.threadId ?? activeThread?.id ?? "");
        store.saveState();
        app.renderer.renderAll(true);
        return;
      }

      if (!app.runtime.activeRequestController || !app.runtime.activeRunRef) {
        return;
      }

      app.runtime.activeRequestController.abort();
      const runningTurn = store.getTurn(app.runtime.activeRunRef.threadId, app.runtime.activeRunRef.turnId);

      if (!runningTurn) {
        return;
      }

      store.appendStep(runningTurn, "已请求取消", "浏览器已发出取消信号，服务端会停止对应任务。");
      runningTurn.state = "cancelled";
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

    resumePendingRestoredActionHydration();
  }

  const restoredActionRehydrateDelayMs = Number.isFinite(app.runtime.restoredActionRehydrateDelayMs)
    ? Math.max(0, Number(app.runtime.restoredActionRehydrateDelayMs))
    : 500;
  const restoredActionRehydrateMaxAttempts = Number.isFinite(app.runtime.restoredActionRehydrateMaxAttempts)
    ? Math.max(1, Number(app.runtime.restoredActionRehydrateMaxAttempts))
    : 3;
  const restoredActionRehydrateRecoveryDelayMs = Number.isFinite(app.runtime.restoredActionRehydrateRecoveryDelayMs)
    ? Math.max(0, Number(app.runtime.restoredActionRehydrateRecoveryDelayMs))
    : 1500;

  async function handleSubmit(event) {
    event.preventDefault();

    const thread = store.getActiveThread();

    if (!thread || app.runtime.sessionControlBusy) {
      return;
    }

    if (store.isRestoredActionHydrating?.()) {
      const hydratingThread = store.getThreadById?.(app.runtime.restoredActionHydrationThreadId ?? "");
      store.setTransientStatus(thread.id, buildRestoredActionHydrationMessage(thread, hydratingThread));
      app.renderer.renderAll();
      return;
    }

    const currentTurn = store.getActiveTurn();
    const latestTurn = thread.turns.at(-1) ?? null;
    const restoredWaitingTurn = !currentTurn
      && latestTurn?.state === "waiting"
      && latestTurn.pendingAction
      ? latestTurn
      : null;

    if (currentTurn?.state === "waiting" && currentTurn.pendingAction) {
      if (app.runtime.activeRunRef?.threadId !== thread.id) {
        store.setTransientStatus(thread.id, "当前会话不是等待中的 action 所在会话，请切回对应会话再提交。");
        app.renderer.renderAll();
        return;
      }

      await submitWaitingAction(thread, currentTurn);
      return;
    }

    if (restoredWaitingTurn) {
      await submitWaitingAction(thread, restoredWaitingTurn, {}, {
        restoredFromHistory: true,
      });
      return;
    }

    const specialAction = parseSpecialAction(mergeDraftContent(thread.draftGoal, thread.draftContext));

    if (specialAction) {
      await submitSpecialAction(thread, currentTurn, specialAction);
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

  async function submitWaitingAction(thread, turn, submission = {}, options = {}) {
    if (turn.pendingActionSubmitting) {
      return;
    }

    const actionType = turn.pendingAction?.actionType;
    const explicitDecision = typeof submission.decision === "string" ? submission.decision.trim() : "";
    const explicitInputText = typeof submission.inputText === "string" ? submission.inputText.trim() : "";
    const actionInput = explicitInputText || mergeDraftContent(thread.draftGoal, thread.draftContext).trim();

    if (!actionType) {
      store.setTransientStatus(thread.id, "当前等待中的 action 已失效，请刷新后重试。");
      app.renderer.renderAll();
      return;
    }

    if (actionType === "approval" && !explicitDecision) {
      store.setTransientStatus(thread.id, "请直接在当前 turn 卡片里点击批准或拒绝。");
      app.renderer.renderAll();
      return;
    }

    if (actionType === "user-input" && !actionInput) {
      if (store.getActiveThread()?.id === thread.id) {
        dom.goalInput.focus();
      }
      return;
    }

    turn.pendingActionError = "";
    turn.pendingActionSubmitting = true;
    store.touchThread(thread.id);
    store.saveState();
    app.renderer.renderAll(shouldScrollThread(thread.id));

    try {
      if (actionType === "approval") {
        await actionInteraction.submitApproval(turn, explicitDecision);
      } else if (actionType === "user-input") {
        await actionInteraction.submitUserInput(turn, actionInput);
      } else {
        turn.pendingActionSubmitting = false;
        store.setTransientStatus(thread.id, `暂不支持等待中的 action 类型：${actionType}`);
        app.renderer.renderAll();
        return;
      }
    } catch (error) {
      turn.pendingActionSubmitting = false;
      turn.pendingActionError = error?.message ?? "提交 action 失败";
      store.touchThread(thread.id);
      store.saveState();
      app.renderer.renderAll(shouldScrollThread(thread.id));
      return;
    }

    thread.draftGoal = "";
    thread.draftContext = "";
    dom.goalInput.value = "";
    app.utils.autoResizeTextarea(dom.goalInput);
    store.syncThreadStoredState(thread, turn);
    store.touchThread(thread.id);
    store.saveState();
    app.renderer.renderAll(shouldScrollThread(thread.id));

    if (options.restoredFromHistory && typeof app.history?.ensureThreadHistoryLoaded === "function") {
      void continueRestoredActionHydration(thread.id);
    }
  }

  async function submitSpecialAction(thread, currentTurn, specialAction) {
    if (!specialAction.value) {
      if (store.getActiveThread()?.id === thread.id) {
        dom.goalInput.focus();
      }
      return;
    }

    try {
      if (specialAction.mode === "review") {
        await actionInteraction.submitReview(thread, specialAction.value);
        store.setTransientStatus(thread.id, "已提交 review 请求。");
      } else if (specialAction.mode === "steer") {
        const steerTurn = resolveSteerTurn(thread, currentTurn);
        await actionInteraction.submitSteer(thread, specialAction.value, steerTurn?.serverTurnId);
        store.setTransientStatus(thread.id, "已发送 steer 请求。");
      } else {
        store.setTransientStatus(thread.id, `暂不支持指令：/${specialAction.mode}`);
        app.renderer.renderAll();
        return;
      }
    } catch (error) {
      store.setTransientStatus(thread.id, error?.message ?? "提交 action 失败");
      app.renderer.renderAll();
      return;
    }

    thread.draftGoal = "";
    thread.draftContext = "";
    dom.goalInput.value = "";
    app.utils.autoResizeTextarea(dom.goalInput);
    store.touchThread(thread.id);
    store.saveState();
    app.renderer.renderAll(shouldScrollThread(thread.id));
  }

  async function submitActionRequest(payload) {
    const response = await fetch("/api/tasks/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await app.utils.safeReadJson(response);
      throw new Error(data?.error?.message ?? "提交 action 失败");
    }

    return response.json();
  }

  async function continueRestoredActionHydration(threadId) {
    clearRestoredActionHydrationRetryTimer();
    app.runtime.restoredActionHydrationThreadId = threadId;
    app.renderer.renderAll();

    try {
      const resolved = await runRestoredActionHydrationBatch(threadId);

      if (resolved) {
        return;
      }

      const currentThread = store.getThreadById?.(threadId);

      if (!currentThread?.historyNeedsRehydrate) {
        return;
      }

      store.setTransientStatus(threadId, buildRestoredActionHydrationRetryMessage(currentThread));
      scheduleRestoredActionHydrationRetry(threadId);
    } finally {
      const currentThread = store.getThreadById?.(threadId);

      if (!currentThread?.historyNeedsRehydrate && app.runtime.restoredActionHydrationThreadId === threadId) {
        app.runtime.restoredActionHydrationThreadId = null;
      }

      app.renderer.renderAll();
    }
  }

  async function runRestoredActionHydrationBatch(threadId) {
    for (let attempt = 0; attempt < restoredActionRehydrateMaxAttempts; attempt += 1) {
      try {
        await app.history.ensureThreadHistoryLoaded(threadId, { force: true });
      } catch (error) {
        console.error("Restored waiting action rehydrate failed.", error);
        return false;
      }

      const currentThread = store.getThreadById?.(threadId);

      if (!currentThread?.historyNeedsRehydrate) {
        return true;
      }

      if (attempt >= restoredActionRehydrateMaxAttempts - 1) {
        return false;
      }

      await waitForNextRestoredHydrationAttempt();
    }

    return false;
  }

  function waitForNextRestoredHydrationAttempt() {
    if (restoredActionRehydrateDelayMs <= 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      setTimeout(resolve, restoredActionRehydrateDelayMs);
    });
  }

  function scheduleRestoredActionHydrationRetry(threadId) {
    const timer = setTimeout(() => {
      if (app.runtime.restoredActionHydrationThreadId !== threadId) {
        return;
      }

      void continueRestoredActionHydration(threadId);
    }, restoredActionRehydrateRecoveryDelayMs);

    timer?.unref?.();
    app.runtime.restoredActionHydrationRetryTimer = timer;
  }

  function clearRestoredActionHydrationRetryTimer() {
    if (app.runtime.restoredActionHydrationRetryTimer) {
      clearTimeout(app.runtime.restoredActionHydrationRetryTimer);
      app.runtime.restoredActionHydrationRetryTimer = null;
    }
  }

  function resumePendingRestoredActionHydration() {
    if (app.runtime.activeRunRef || app.runtime.restoredActionHydrationThreadId) {
      return;
    }

    const pendingThread = store.state.threads.find((candidate) => candidate?.historyNeedsRehydrate);

    if (!pendingThread) {
      return;
    }

    void continueRestoredActionHydration(pendingThread.id);
  }

  function buildRestoredActionHydrationMessage(activeThread, hydratingThread) {
    if (!hydratingThread) {
      return "上一轮 action 已提交，正在等待服务端继续执行并同步状态，请稍候再发新消息。";
    }

    if (!isSubmittedActionHydrationThread(hydratingThread)) {
      if (activeThread?.id === hydratingThread.id) {
        return "浏览器刚恢复这个会话，正在向服务端同步上一轮任务的真实状态；当前会话暂时不能继续发送新消息。";
      }

      const title = typeof hydratingThread.title === "string" && hydratingThread.title.trim()
        ? `「${hydratingThread.title.trim()}」`
        : "另一个会话";
      return `${title} 正在同步上一轮任务的真实状态。当前 Web 端暂不支持并行继续执行，请稍候再发新消息。`;
    }

    if (activeThread?.id === hydratingThread.id) {
      return "上一轮 action 已提交，正在等待服务端继续执行并同步状态；当前会话暂时不能继续发送新消息。";
    }

    const title = typeof hydratingThread.title === "string" && hydratingThread.title.trim()
      ? `「${hydratingThread.title.trim()}」`
      : "另一个会话";
    return `${title} 仍在同步上一轮 action 的后续状态。当前 Web 端暂不支持并行继续执行，请稍候再发新消息。`;
  }

  function buildRestoredActionHydrationRetryMessage(thread) {
    if (!isSubmittedActionHydrationThread(thread)) {
      return "浏览器已恢复这个会话，但服务端状态还没完全同步。当前会话会继续锁定，直到同步完成；如果长时间没有变化，请刷新页面。";
    }

    return "上一轮 action 已提交，但服务端状态还没完全同步。当前会话会继续锁定，直到同步完成；如果长时间没有变化，请刷新页面。";
  }

  function isSubmittedActionHydrationThread(thread) {
    if (!thread || !Array.isArray(thread.turns)) {
      return false;
    }

    return thread.turns.some(
      (turn) => typeof turn?.submittedPendingActionId === "string" && turn.submittedPendingActionId,
    );
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

    if (app.runtime.pendingInterruptSubmit) {
      app.runtime.resumeInterruptedSubmit?.();
    }
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

  function parseSpecialAction(goal) {
    const normalizedGoal = typeof goal === "string" ? goal.trim() : "";

    if (!normalizedGoal.startsWith("/")) {
      return null;
    }

    if (/^\/review(?:\s|$)/.test(normalizedGoal)) {
      return {
        mode: "review",
        value: normalizedGoal.replace(/^\/review\b/, "").trim(),
      };
    }

    if (/^\/steer(?:\s|$)/.test(normalizedGoal)) {
      return {
        mode: "steer",
        value: normalizedGoal.replace(/^\/steer\b/, "").trim(),
      };
    }

    return null;
  }

  function resolveSteerTurn(thread, currentTurn) {
    if (app.runtime.activeRunRef?.threadId === thread.id && currentTurn) {
      return currentTurn;
    }

    return thread.turns.at(-1) ?? null;
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
