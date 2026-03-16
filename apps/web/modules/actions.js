import { createComposerActions } from "./actions-composer.js";
import { createSessionActions } from "./actions-session.js";
import { createSidebarActions } from "./actions-sidebar.js";
import { createStreamActions } from "./actions-stream.js";

export function createActions(app) {
  const { dom, store } = app;
  const composerActions = createComposerActions(app, createStreamActions(app));
  const sessionActions = createSessionActions(app);
  const sidebarActions = createSidebarActions(app);

  function initialize() {
    store.repairInterruptedTurns();
    store.ensureActiveThread();

    sidebarActions.bindWorkflowControls();
    sidebarActions.bindRoleControls();
    sidebarActions.bindSettingsControls();
    composerActions.bindComposerControls();
    sidebarActions.bindSidebarControls();
    bindWorkspaceControls();
    composerActions.bindLifecycleEvents();

    app.renderer.renderAll(true);
    void app.history.refreshHistoryFromServer();
  }

  function bindWorkspaceControls() {
    dom.workspaceToolsToggle.addEventListener("click", () => {
      app.renderer.setToolsPanelOpen(!app.runtime.workspaceToolsOpen);
    });

    dom.workspaceToolsClose.addEventListener("click", () => {
      app.renderer.setToolsPanelOpen(false);
    });

    dom.workspaceToolsBackdrop.addEventListener("click", () => {
      app.renderer.setToolsPanelOpen(false);
    });

    dom.settingsSectionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        app.renderer.setToolsSection(button.dataset.settingsSection);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && app.runtime.workspaceToolsOpen) {
        app.renderer.setToolsPanelOpen(false);
      }
    });

    dom.resetSessionButton.addEventListener("click", async () => {
      await sessionActions.handleResetSession();
    });

    dom.forkSessionButton.addEventListener("click", async () => {
      await sessionActions.handleForkSession();
    });
  }

  return {
    initialize,
  };
}
