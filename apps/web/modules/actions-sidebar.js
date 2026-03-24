export function createSidebarActions(app) {
  const { dom, store } = app;

  function bindSettingsControls() {
    dom.personaSelect.addEventListener("change", () => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const inherited = store.resolveInheritedSettings(thread.settings);
      const selectedProfile = dom.personaSelect.value;

      store.updateThreadSettings({
        profile: selectedProfile && selectedProfile !== inherited.profile ? selectedProfile : "",
      });
      app.renderer.renderAll();
    });

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
      app.thirdPartyProbe.clearIfSelectionChanged(
        store.resolveThirdPartySelection({
          ...thread.settings,
          ...nextSettings,
        }).provider?.id || "",
        store.resolveThirdPartySelection({
          ...thread.settings,
          ...nextSettings,
        }).model?.model || "",
      );
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

    dom.sandboxSelect.addEventListener("change", () => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const inherited = store.resolveInheritedSettings(thread.settings);
      const selectedSandbox = dom.sandboxSelect.value;

      store.updateThreadSettings({
        sandboxMode: selectedSandbox && selectedSandbox !== inherited.sandboxMode ? selectedSandbox : "",
      });
      app.renderer.renderAll();
    });

    dom.webSearchSelect.addEventListener("change", () => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const inherited = store.resolveInheritedSettings(thread.settings);
      const selectedWebSearch = dom.webSearchSelect.value;

      store.updateThreadSettings({
        webSearchMode: selectedWebSearch && selectedWebSearch !== inherited.webSearchMode ? selectedWebSearch : "",
      });
      app.renderer.renderAll();
    });

    dom.networkAccessSelect.addEventListener("change", () => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const inherited = store.resolveInheritedSettings(thread.settings);
      const selectedNetworkAccess = normalizeBooleanSelectValue(dom.networkAccessSelect.value);

      store.updateThreadSettings({
        networkAccessEnabled: selectedNetworkAccess !== null && selectedNetworkAccess !== inherited.networkAccessEnabled
          ? selectedNetworkAccess
          : "",
      });
      app.renderer.renderAll();
    });

    dom.thirdPartyProviderSelect.addEventListener("change", () => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const providers = store.getThirdPartyProviders();
      const selectedProviderId = dom.thirdPartyProviderSelect.value;
      const defaultProviderId = providers[0]?.id ?? "";
      const nextSettings = {
        thirdPartyProviderId: selectedProviderId && selectedProviderId !== defaultProviderId ? selectedProviderId : "",
      };
      const thirdPartyModels = store.getThirdPartyModels({
        ...thread.settings,
        ...nextSettings,
      });

      if (
        thread.settings.thirdPartyModel
        && !thirdPartyModels.some((model) => model.model === thread.settings.thirdPartyModel)
      ) {
        nextSettings.thirdPartyModel = "";
      }

      const reasoningOptions = store.getReasoningOptions({
        ...thread.settings,
        ...nextSettings,
      });

      if (
        thread.settings.reasoning
        && !reasoningOptions.some((option) => option.reasoningEffort === thread.settings.reasoning)
      ) {
        nextSettings.reasoning = "";
      }

      store.updateThreadSettings(nextSettings);
      app.thirdPartyProbe.clearIfSelectionChanged(
        store.resolveThirdPartySelection({
          ...thread.settings,
          ...nextSettings,
        }).provider?.id || "",
        store.resolveThirdPartySelection({
          ...thread.settings,
          ...nextSettings,
        }).model?.model || "",
      );
      app.renderer.renderAll();
    });

    const handleThirdPartyModelChange = (selectedModel) => {
      const thread = store.getActiveThread();

      if (!thread) {
        return;
      }

      const selection = store.resolveThirdPartySelection(thread.settings);
      const nextSettings = {
        thirdPartyModel: selectedModel && selectedModel !== selection.modelId ? selectedModel : "",
      };
      const reasoningOptions = store.getReasoningOptions({
        ...thread.settings,
        ...nextSettings,
      });

      if (
        thread.settings.reasoning
        && !reasoningOptions.some((option) => option.reasoningEffort === thread.settings.reasoning)
      ) {
        nextSettings.reasoning = "";
      }

      store.updateThreadSettings(nextSettings);
      app.renderer.renderAll();
    };

    dom.thirdPartyModelSelect.addEventListener("change", () => {
      handleThirdPartyModelChange(dom.thirdPartyModelSelect.value);
    });

  }

  function bindSidebarControls() {
    dom.threadSearchInput.addEventListener("input", () => {
      app.runtime.threadSearchQuery = dom.threadSearchInput.value;
      app.renderer.renderThreadList();
    });

    dom.newThreadButton.addEventListener("click", () => {
      if (app.runtime.sessionControlBusy) {
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

      if (!button || app.runtime.sessionControlBusy) {
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
      await app.sessionSettings.loadThreadSettings(button.dataset.threadId, { quiet: true });
    });
  }

  return {
    bindSettingsControls,
    bindSidebarControls,
  };
}

function normalizeBooleanSelectValue(value) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}
