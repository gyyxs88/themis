export function createSidebarActions(app) {
  const { dom, store } = app;

  function bindWorkflowControls() {
    dom.workflowInputs.forEach((input) => {
      input.addEventListener("change", () => {
        store.state = {
          ...store.state,
          selectedWorkflow: input.value,
        };
        store.saveState();
        app.renderer.renderAll();
      });
    });
  }

  function bindRoleControls() {
    dom.roleInputs.forEach((input) => {
      input.addEventListener("change", () => {
        store.state = {
          ...store.state,
          selectedRole: input.value,
        };
        store.saveState();
        app.renderer.renderAll();
      });
    });
  }

  function bindSettingsControls() {
    dom.modelInput.addEventListener("input", () => {
      store.updateThreadSettings({ model: dom.modelInput.value.trim() });
      app.renderer.renderAll();
    });

    dom.reasoningSelect.addEventListener("change", () => {
      store.updateThreadSettings({ reasoning: dom.reasoningSelect.value });
      app.renderer.renderAll();
    });

    dom.approvalSelect.addEventListener("change", () => {
      store.updateThreadSettings({ approvalPolicy: dom.approvalSelect.value });
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

    dom.historyRefreshButton.addEventListener("click", async () => {
      if (app.runtime.historySyncBusy || store.isBusy()) {
        return;
      }

      await app.history.refreshHistoryFromServer({ force: true });
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
    bindWorkflowControls,
    bindRoleControls,
    bindSettingsControls,
    bindSidebarControls,
  };
}
