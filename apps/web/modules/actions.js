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

    sidebarActions.bindSettingsControls();
    composerActions.bindComposerControls();
    sidebarActions.bindSidebarControls();
    bindWorkspaceControls();
    composerActions.bindLifecycleEvents();

    app.renderer.renderAll(true);
    void app.history.refreshHistoryFromServer();
    void app.runtimeConfig.load();
  }

  function bindWorkspaceControls() {
    dom.forkThreadButton.addEventListener("click", async () => {
      await sessionActions.handleForkSession();
    });

    dom.workspaceToolsToggle.addEventListener("click", () => {
      app.renderer.setToolsPanelOpen(!app.runtime.workspaceToolsOpen);
    });

    dom.workspaceToolsClose.addEventListener("click", () => {
      app.renderer.setToolsPanelOpen(false);
    });

    dom.workspaceToolsBackdrop.addEventListener("click", () => {
      app.renderer.setToolsPanelOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && app.runtime.workspaceToolsOpen) {
        app.renderer.setToolsPanelOpen(false);
      }
    });
  }

  return {
    initialize,
  };
}
