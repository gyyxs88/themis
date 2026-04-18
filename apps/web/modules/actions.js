import { createComposerActions } from "./actions-composer.js";
import { createSessionActions } from "./actions-session.js";
import { createSidebarActions } from "./actions-sidebar.js";
import { createStreamActions } from "./actions-stream.js";
import { isWorkspaceLocked, normalizeWorkspacePath } from "./session-workspace.js";

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
    bindThreadRiskBannerControls();
    app.auth.bindControls();
    app.updateManager.bindControls();
    app.modeSwitch.bindControls();
    app.meetingRooms.bindControls();
    app.thirdPartyEditor.bindControls();
    app.thirdPartyEndpointProbe.bindControls();
    app.thirdPartyProbe.bindControls();
    bindWorkspaceControls();
    composerActions.bindLifecycleEvents();

    app.renderer.renderAll(true);
    void app.history.refreshHistoryFromServer();
    void app.auth.load();
    void app.identity.load({ quiet: true });
    void app.runtimeConfig.load();
    void app.updateManager.load({ quiet: true });
    void app.sessionSettings.loadThreadSettings(store.state.activeThreadId, { quiet: true });
  }

  function bindThreadRiskBannerControls() {
    dom.threadRiskBanner.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-risk-banner-action]");

      if (!actionButton) {
        return;
      }

      const actionKind = actionButton.dataset.riskBannerAction;
      const threadId = actionButton.dataset.threadId ?? "";
      const turnId = actionButton.dataset.turnId ?? "";

      if (actionKind === "open-thread") {
        void sidebarActions.activateThread(threadId);
        return;
      }

      if (actionKind === "focus-turn" && turnId) {
        document.getElementById(`turn-anchor-${turnId}`)?.scrollIntoView({
          block: "start",
        });
      }
    });
  }

  function bindWorkspaceControls() {
    function canCloseWorkspaceTools() {
      return !app.runtime.thirdPartyEditor.submitting;
    }

    async function refreshMeetingRoomsPanel() {
      try {
        await app.meetingRooms.loadStatus();
        if (app.runtime.meetingRooms?.accessMode === "platform_gateway") {
          await app.meetingRooms.loadRooms({ refreshActive: true });
        }
      } catch {
        // Errors are already reflected in meetingRooms state for the UI.
      }
    }

    async function persistWorkspaceSettings() {
      const thread = store.getActiveThread();

      if (!thread || app.runtime.sessionControlBusy || store.isBusy() || isWorkspaceLocked(thread)) {
        return;
      }

      store.updateThreadSettings(
        {
          workspacePath: normalizeWorkspacePath(dom.sessionWorkspaceInput.value),
        },
        {
          persist: false,
        },
      );

      const result = await app.sessionSettings.commitThreadSettings(thread.id, {
        quiet: true,
      });

      if (result.ok) {
        store.clearTransientStatus();
        app.renderer.renderAll();
        return;
      }

      if (result.code === "PERSIST_FAILED_RECONCILED") {
        store.setTransientStatus(
          thread.id,
          result.found
            ? "保存工作区失败，已按服务端状态同步。"
            : "保存工作区失败，服务端当前未绑定工作区，已回退到 Themis 启动目录。",
        );
      } else {
        store.setTransientStatus(
          thread.id,
          "保存工作区失败，暂时无法确认服务端状态；当前显示可能与服务端不一致，请稍后重试或刷新页面。",
        );
      }

      app.renderer.renderAll();
    }

    dom.forkThreadButton.addEventListener("click", async () => {
      await sessionActions.handleForkSession();
    });

    dom.threadArchiveButton?.addEventListener("click", async () => {
      const activeThread = store.getActiveThread();

      if (!activeThread) {
        return;
      }

      await app.history.toggleThreadArchive(activeThread.id, !activeThread.historyArchivedAt);
    });

    dom.threadControlJoinToggle.addEventListener("click", () => {
      const nextOpen = !app.runtime.threadControlJoinOpen;
      app.runtime.threadControlJoinOpen = nextOpen;
      app.renderer.renderAll();

      if (nextOpen) {
        dom.conversationLinkInput.focus();
      }
    });

    dom.resetPrincipalButton.addEventListener("click", async () => {
      await sessionActions.handleResetPrincipalState();
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

    dom.sessionWorkspaceApplyButton.addEventListener("click", async () => {
      await persistWorkspaceSettings();
    });

    dom.sessionWorkspaceInput.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      await persistWorkspaceSettings();
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
      } else if (nextSection === "meeting-rooms") {
        void refreshMeetingRoomsPanel();
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
      } else if (nextOpen && app.runtime.workspaceToolsSection === "meeting-rooms") {
        void refreshMeetingRoomsPanel();
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
