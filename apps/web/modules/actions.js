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
    app.auth.bindControls();
    app.modeSwitch.bindControls();
    app.thirdPartyEditor.bindControls();
    app.thirdPartyProbe.bindControls();
    bindWorkspaceControls();
    composerActions.bindLifecycleEvents();

    app.renderer.renderAll(true);
    void app.history.refreshHistoryFromServer();
    void app.auth.load();
    void app.identity.load({ quiet: true });
    void app.runtimeConfig.load();
    void app.sessionSettings.loadThreadSettings(store.state.activeThreadId, { quiet: true });
  }

  function bindWorkspaceControls() {
    function canCloseWorkspaceTools() {
      return !app.runtime.thirdPartyEditor.submitting;
    }

    dom.forkThreadButton.addEventListener("click", async () => {
      await sessionActions.handleForkSession();
    });

    dom.conversationLinkButton.addEventListener("click", async () => {
      await sessionActions.handleJoinConversation();
    });

    dom.conversationLinkInput.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }

      event.preventDefault();
      await sessionActions.handleJoinConversation();
    });

    dom.identityLinkCodeButton.addEventListener("click", async () => {
      await app.identity.issueLinkCode();
    });

    dom.workspaceToolsPanel.addEventListener("click", (event) => {
      const sectionButton = event.target.closest("[data-settings-section]");

      if (!sectionButton) {
        return;
      }

      const nextSection = sectionButton.dataset.settingsSection;
      app.renderer.setToolsPanelSection(nextSection);

      if (nextSection === "auth") {
        void app.auth.load({ force: true, quiet: true });
      }
    });

    dom.workspaceToolsToggle.addEventListener("click", () => {
      if (app.runtime.workspaceToolsOpen && !canCloseWorkspaceTools()) {
        return;
      }

      const nextOpen = !app.runtime.workspaceToolsOpen;
      app.renderer.setToolsPanelOpen(nextOpen);

      if (nextOpen && app.runtime.workspaceToolsSection === "auth") {
        void app.auth.load({ force: true, quiet: true });
      }
    });

    dom.workspaceToolsClose.addEventListener("click", () => {
      if (!canCloseWorkspaceTools()) {
        return;
      }

      app.thirdPartyEditor.close(false);
      app.renderer.setToolsPanelOpen(false);
    });

    dom.workspaceToolsBackdrop.addEventListener("click", () => {
      if (!canCloseWorkspaceTools()) {
        return;
      }

      app.thirdPartyEditor.close(false);
      app.renderer.setToolsPanelOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && app.runtime.thirdPartyEditor.open) {
        app.thirdPartyEditor.close();
        return;
      }

      if (event.key === "Escape" && app.runtime.workspaceToolsOpen) {
        if (!canCloseWorkspaceTools()) {
          return;
        }

        app.renderer.setToolsPanelOpen(false);
      }
    });
  }

  return {
    initialize,
  };
}
