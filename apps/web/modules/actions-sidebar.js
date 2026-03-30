import { inheritWorkspaceSettings } from "./session-workspace.js";

export function createSidebarActions(app) {
  const { dom, store } = app;

  function bindSettingsControls() {
    const savePrincipalTaskSettings = async (patch) => {
      const current = app.runtime.identity?.taskSettings ?? {};
      await app.identity.saveTaskSettings({
        ...current,
        ...patch,
      });
    };

    const updatePersonaDraft = () => {
      app.identity.updatePersonaDraft({
        assistantLanguageStyleDraft: dom.assistantLanguageStyleInput.value,
        assistantMbtiDraft: dom.assistantMbtiInput.value,
        assistantStyleNotesDraft: dom.assistantStyleNotesInput.value,
        assistantSoulDraft: dom.assistantSoulInput.value,
      });
    };

    const savePersona = () => {
      void app.identity.saveAssistantPersona({
        assistantLanguageStyle: dom.assistantLanguageStyleInput.value,
        assistantMbti: dom.assistantMbtiInput.value,
        assistantStyleNotes: dom.assistantStyleNotesInput.value,
        assistantSoul: dom.assistantSoulInput.value,
      });
    };

    for (const element of [
      dom.assistantLanguageStyleInput,
      dom.assistantMbtiInput,
      dom.assistantStyleNotesInput,
      dom.assistantSoulInput,
    ]) {
      element.addEventListener("input", updatePersonaDraft);
      element.addEventListener("change", savePersona);
    }

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
      app.thirdPartyEndpointProbe.clearIfProviderChanged(
        store.resolveThirdPartySelection({
          ...thread.settings,
          ...nextSettings,
        }).provider?.id || "",
      );
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

    dom.approvalSelect.addEventListener("change", async () => {
      await savePrincipalTaskSettings({
        approvalPolicy: dom.approvalSelect.value,
      });
    });

    dom.sandboxSelect.addEventListener("change", async () => {
      await savePrincipalTaskSettings({
        sandboxMode: dom.sandboxSelect.value,
      });
    });

    dom.webSearchSelect.addEventListener("change", async () => {
      await savePrincipalTaskSettings({
        webSearchMode: dom.webSearchSelect.value,
      });
    });

    dom.networkAccessSelect.addEventListener("change", async () => {
      const selectedNetworkAccess = normalizeBooleanSelectValue(dom.networkAccessSelect.value);
      await savePrincipalTaskSettings({
        networkAccessEnabled: selectedNetworkAccess,
      });
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
      app.thirdPartyEndpointProbe.clearIfProviderChanged(
        store.resolveThirdPartySelection({
          ...thread.settings,
          ...nextSettings,
        }).provider?.id || "",
      );
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

    dom.newThreadButton.addEventListener("click", async () => {
      if (app.runtime.sessionControlBusy) {
        return;
      }

      const activeThread = store.getActiveThread();
      const nextThread = store.createAndActivateThread({
        settings: inheritWorkspaceSettings(activeThread),
      });

      app.runtime.threadControlJoinOpen = false;
      store.clearTransientStatus();
      const inheritedWorkspacePath = typeof nextThread.settings.workspacePath === "string"
        ? nextThread.settings.workspacePath.trim()
        : "";

      if (inheritedWorkspacePath) {
        const result = await app.sessionSettings.commitThreadSettings(nextThread.id, {
          quiet: true,
          clearWorkspaceOnUnknownFailure: true,
        });

        if (!result.ok) {
          if (result.code === "PERSIST_FAILED_RECONCILED") {
            store.setTransientStatus(
              nextThread.id,
              result.found
                ? "新会话继承工作区保存失败，已按服务端状态同步。"
                : "新会话继承工作区未写入服务端，已回退到 Themis 启动目录。",
            );
          } else {
            store.setTransientStatus(
              nextThread.id,
              "新会话继承工作区失败，暂时无法确认服务端状态；当前已回退到 Themis 启动目录，请手动重新保存。",
            );
          }
        }
      }

      app.runtime.workspaceToolsOpen = false;
      app.renderer.renderAll();
      app.layout.closeMobileSidebar();
      dom.goalInput.focus();
    });

    dom.threadList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-thread-id]");

      if (!button) {
        return;
      }

      void activateThread(button.dataset.threadId);
    });
  }

  async function activateThread(threadId, { scrollToBottom = true } = {}) {
    if (!threadId || app.runtime.sessionControlBusy) {
      return;
    }

    store.state = {
      ...store.state,
      activeThreadId: threadId,
    };
    app.runtime.threadControlJoinOpen = false;
    store.clearTransientStatus();
    store.saveState();
    app.renderer.renderAll(scrollToBottom);
    app.layout.closeMobileSidebar();
    await app.history.ensureThreadHistoryLoaded(threadId);
    await app.sessionSettings.loadThreadSettings(threadId, { quiet: true });
  }

  return {
    activateThread,
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
