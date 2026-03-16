import { badgeToneForStatus, formatStatusLabel } from "./copy.js";
import {
  renderHistoryLoadingState,
  renderStoredSummaryState,
  renderThreadButton,
  renderTurnMarkup,
} from "./ui-markup.js";

export function createRenderer(app) {
  const { dom, store, utils } = app;

  function renderAll(scrollToBottom = false) {
    store.ensureActiveThread();
    dom.threadSearchInput.value = app.runtime.threadSearchQuery;
    app.history.renderHistorySyncStatus();
    renderThreadList();
    renderWorkspaceHeader();
    renderWorkspaceTools();
    renderConversation(scrollToBottom);
    renderComposer();
    renderComposerMeta();
    syncBusyState();
  }

  function renderThreadList() {
    const threads = store.getVisibleThreads(app.runtime.threadSearchQuery);

    if (!threads.length) {
      dom.threadList.innerHTML = "";
      dom.threadEmpty.classList.remove("hidden");
      dom.threadEmpty.textContent = app.runtime.threadSearchQuery
        ? "没有匹配的聊天，试试别的关键词。"
        : "还没有聊天记录，发送第一条任务后会出现在这里。";
      return;
    }

    dom.threadEmpty.classList.add("hidden");
    dom.threadList.innerHTML = threads
      .map((thread) =>
        renderThreadButton(thread, {
          active: thread.id === store.state.activeThreadId,
          busy: store.isBusy(),
          escapeHtml: utils.escapeHtml,
        }),
      )
      .join("");
  }

  function renderWorkspaceHeader() {
    const thread = store.getActiveThread();
    const turnCount = app.history.getDisplayTurnCount(thread);
    const status = store.threadStatus(thread);

    if (!thread || !turnCount) {
      dom.workspaceTitle.textContent = "Themis Operator Chat";
      dom.workspaceCopy.textContent = "把任务像聊天一样发出去，让 Themis 在同一条会话里持续回传进度和结果。";
      dom.statusBadge.textContent = "空闲";
      dom.statusBadge.className = "badge idle";
      return;
    }

    dom.workspaceTitle.textContent = thread.title;
    dom.statusBadge.textContent = formatStatusLabel(status);
    dom.statusBadge.className = `badge ${badgeToneForStatus(status)}`;

    if (app.runtime.historyHydratingThreadId === thread.id) {
      dom.workspaceCopy.textContent = `正在从本机 SQLite 历史中载入这个会话的 ${turnCount} 条任务记录。`;
      return;
    }

    if (!thread.turns.length && turnCount > 0) {
      dom.workspaceCopy.textContent = `这个会话已在本机历史中保存，共 ${turnCount} 条任务。点击后会自动载入完整记录。`;
      return;
    }

    dom.workspaceCopy.textContent = thread.bootstrapTranscript && !thread.serverThreadId
      ? `当前会话已在浏览器本地保存，包含 ${turnCount} 条任务。这是一个分叉会话，下一次发送时会把${store.describeBootstrapLabel(thread)}导入新的 Codex 会话。`
      : !thread.serverThreadId
        ? `当前会话已在浏览器本地保存，包含 ${turnCount} 条任务。这个会话的后端上下文目前已重置，下一次发送会创建新的 Codex 会话。`
        : `当前会话已在浏览器本地保存，包含 ${turnCount} 条任务。现在同一会话会在后端复用真实的 Codex thread，多轮上下文已经真正接通。`;
  }

  function renderWorkspaceTools() {
    const thread = store.getActiveThread();
    const latestTurn = thread?.turns.at(-1);
    const summary =
      store.resolveTransientStatus(thread?.id) ??
      (thread?.bootstrapTranscript && !thread?.serverThreadId
        ? store.describeBootstrapStatus(thread)
        : store.buildThreadPreview(thread));

    dom.workspaceToolsPanel.classList.toggle("hidden", !app.runtime.workspaceToolsOpen);
    dom.workspaceToolsToggle.setAttribute("aria-expanded", String(app.runtime.workspaceToolsOpen));
    dom.activeThreadTitle.textContent = thread?.title ?? "当前状态";
    dom.sessionStatus.textContent = summary;
    dom.requestMeta.classList.toggle("empty", !latestTurn && !thread?.storedTurnCount);
    dom.requestMeta.textContent = JSON.stringify(store.buildThreadSummary(thread), null, 2);

    const settings = thread?.settings ?? store.createDefaultThreadSettings();
    dom.modelInput.value = settings.model ?? "";
    dom.reasoningSelect.value = settings.reasoning ?? "";
    dom.approvalSelect.value = settings.approvalPolicy ?? "";

    setSelectedChoice(dom.workflowInputs, store.state.selectedWorkflow ?? app.constants.DEFAULT_WORKFLOW);
    setSelectedChoice(dom.roleInputs, store.state.selectedRole ?? app.constants.DEFAULT_ROLE);

    if (!thread) {
      dom.settingsNote.textContent = "这些设置只作用于当前会话后续发出的任务。";
      return;
    }

    if (thread.serverThreadId) {
      dom.settingsNote.textContent = `当前会话已绑定后端 Codex thread：${thread.serverThreadId}`;
      return;
    }

    if (thread.bootstrapTranscript) {
      dom.settingsNote.textContent = `这是一个分叉会话。下一次发送时，会先把${store.describeBootstrapLabel(thread)}导入新的 Codex 会话。`;
      return;
    }

    dom.settingsNote.textContent = "当前还没有建立后端上下文。首次发送后会创建新的 Codex 会话。";
  }

  function renderConversation(scrollToBottom) {
    const thread = store.getActiveThread();

    if (thread && !thread.turns.length && app.history.threadNeedsHistoryHydration(thread)) {
      dom.conversation.innerHTML = renderHistoryLoadingState(
        thread,
        app.history.getDisplayTurnCount(thread),
        utils.escapeHtml,
      );

      if (scrollToBottom) {
        utils.scrollConversationToBottom(dom.conversation);
      }
      return;
    }

    if (thread && !thread.turns.length && thread.historyHydrated && thread.storedTurnCount > 0) {
      dom.conversation.innerHTML = renderStoredSummaryState(thread, utils.escapeHtml);

      if (scrollToBottom) {
        utils.scrollConversationToBottom(dom.conversation);
      }
      return;
    }

    if (!thread || !thread.turns.length) {
      dom.conversation.innerHTML = dom.emptyThreadMarkup;

      if (scrollToBottom) {
        utils.scrollConversationToBottom(dom.conversation);
      }
      return;
    }

    dom.conversation.innerHTML = thread.turns
      .map((turn, index) => renderTurnMarkup(turn, index + 1, { store, utils }))
      .join("");

    if (scrollToBottom) {
      utils.scrollConversationToBottom(dom.conversation);
    }
  }

  function renderComposer() {
    const thread = store.getActiveThread();
    dom.goalInput.value = thread?.draftGoal ?? "";
    dom.contextInput.value = thread?.draftContext ?? "";
    utils.autoResizeTextarea(dom.goalInput);
    utils.autoResizeTextarea(dom.contextInput);
  }

  function renderComposerMeta() {
    const thread = store.getActiveThread();
    dom.activeWorkflowLabel.textContent = `工作流：${store.state.selectedWorkflow ?? app.constants.DEFAULT_WORKFLOW}`;
    dom.activeRoleLabel.textContent = `角色：${store.state.selectedRole ?? app.constants.DEFAULT_ROLE}`;
    dom.activeThreadLabel.textContent = `会话：${thread?.title ?? "新会话"}`;
  }

  function syncBusyState() {
    const busy = store.isBusy();
    const controlsBusy = busy || app.runtime.sessionControlBusy;

    dom.submitButton.disabled = busy;
    dom.cancelButton.disabled = !busy;
    dom.newThreadButton.disabled = controlsBusy;
    dom.historyRefreshButton.disabled = controlsBusy || app.runtime.historySyncBusy;
    dom.workspaceToolsToggle.disabled = controlsBusy;
    dom.workspaceToolsClose.disabled = controlsBusy;
    dom.resetSessionButton.disabled = controlsBusy;
    dom.forkSessionButton.disabled = controlsBusy;
    dom.threadSearchInput.disabled = controlsBusy && !app.runtime.threadSearchQuery;
    dom.goalInput.disabled = controlsBusy;
    dom.contextInput.disabled = controlsBusy;
    dom.modelInput.disabled = controlsBusy;
    dom.reasoningSelect.disabled = controlsBusy;
    dom.approvalSelect.disabled = controlsBusy;

    dom.workflowInputs.forEach((input) => {
      input.disabled = controlsBusy;
    });

    dom.roleInputs.forEach((input) => {
      input.disabled = controlsBusy;
    });
  }

  function setToolsPanelOpen(nextOpen) {
    app.runtime.workspaceToolsOpen = Boolean(nextOpen);
    renderWorkspaceTools();
  }

  function setSelectedChoice(inputs, value) {
    const target = inputs.find((input) => input.value === value) ?? inputs[0];

    if (target) {
      target.checked = true;
    }
  }

  return {
    renderAll,
    renderThreadList,
    renderWorkspaceTools,
    setToolsPanelOpen,
  };
}
