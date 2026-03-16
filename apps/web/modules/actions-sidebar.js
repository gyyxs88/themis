export function createSidebarActions(app) {
  const { dom, store } = app;

  function bindSettingsControls() {
    dom.modelSelect.addEventListener("change", () => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const selectedModel = dom.modelSelect.value;
      const defaultModel = app.runtime.runtimeConfig?.defaults?.model ?? "";
      const nextSettings = {
        model: selectedModel && selectedModel !== defaultModel ? selectedModel : "",
      };
      const reasoningOptions = store.getReasoningOptions({
        ...thread.settings,
        ...nextSettings,
      });

      if (
        thread.settings.reasoning &&
        !reasoningOptions.some((option) => option.reasoningEffort === thread.settings.reasoning)
      ) {
        nextSettings.reasoning = "";
      }

      store.updateThreadSettings(nextSettings);
      app.renderer.renderAll();
    });

    dom.reasoningSelect.addEventListener("change", () => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const inherited = store.resolveInheritedSettings(thread.settings);
      const selectedReasoning = dom.reasoningSelect.value;

      store.updateThreadSettings({
        reasoning: selectedReasoning && selectedReasoning !== inherited.reasoning ? selectedReasoning : "",
      });
      app.renderer.renderAll();
    });

    dom.approvalSelect.addEventListener("change", () => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const inherited = store.resolveInheritedSettings(thread.settings);
      const selectedApproval = dom.approvalSelect.value;

      store.updateThreadSettings({
        approvalPolicy: selectedApproval && selectedApproval !== inherited.approvalPolicy ? selectedApproval : "",
      });
      app.renderer.renderAll();
    });
  }

  function bindSidebarControls() {
    dom.threadSearchInput.addEventListener("input", () => {
      app.runtime.threadSearchQuery = dom.threadSearchInput.value;
      app.renderer.renderThreadList();
    });

    dom.newThreadButton.addEventListener("click", () => {
      if (store.isBusy() || app.runtime.sessionControlBusy) {
        return;
      }

      store.createAndActivateThread();
      store.clearTransientStatus();
      app.runtime.workspaceToolsOpen = false;
      app.renderer.renderAll();
      app.layout.closeMobileSidebar();
      dom.goalInput.focus();
    });

    dom.threadList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-thread-id]");

      if (!button || store.isBusy() || app.runtime.sessionControlBusy) {
        return;
      }

      store.state = {
        ...store.state,
        activeThreadId: button.dataset.threadId,
      };
      store.clearTransientStatus();
      store.saveState();
      app.renderer.renderAll(true);
      app.layout.closeMobileSidebar();
      await app.history.ensureThreadHistoryLoaded(button.dataset.threadId);
    });
  }

  return {
    bindSettingsControls,
    bindSidebarControls,
  };
}
