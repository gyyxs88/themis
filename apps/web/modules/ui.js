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
      .map((thread) => {
        const status = store.threadStatus(thread);

        return renderThreadButton(thread, {
          active: thread.id === store.state.activeThreadId,
          busy: store.isBusy(),
          status,
          escapeHtml: utils.escapeHtml,
        });
      })
      .join("");
  }

  function renderWorkspaceHeader() {
    const thread = store.getActiveThread();
    const turnCount = app.history.getDisplayTurnCount(thread);

    if (!thread || !turnCount) {
      dom.workspaceTitle.textContent = "Themis Operator Chat";
      dom.workspaceCopy.textContent = "把任务像聊天一样发出去，让 Themis 在同一条会话里持续回传进度和结果。";
      return;
    }

    dom.workspaceTitle.textContent = thread.title;

    if (app.runtime.historyHydratingThreadId === thread.id) {
      dom.workspaceCopy.textContent = `正在从本机 SQLite 历史中载入这个会话的 ${turnCount} 条任务记录。`;
      return;
    }

    if (!thread.turns.length && turnCount > 0) {
      dom.workspaceCopy.textContent = `这个会话已在本机历史中保存，共 ${turnCount} 条任务。点击后会自动载入完整记录。`;
      return;
    }

    dom.workspaceCopy.textContent = thread.bootstrapTranscript && !thread.serverThreadId
      ? `当前会话已在浏览器本地保存，包含 ${turnCount} 条任务。这是一个 fork 会话，第一次发送时会先把${store.describeBootstrapLabel(thread)}导入新的 Codex 会话。`
      : !thread.serverThreadId
        ? `当前会话已在浏览器本地保存，包含 ${turnCount} 条任务。首次发送后会创建新的 Codex 会话。`
        : `当前会话已在浏览器本地保存，包含 ${turnCount} 条任务。现在同一会话会在后端复用真实的 Codex thread，多轮上下文已经真正接通。`;
  }

  function renderWorkspaceTools() {
    const thread = store.getActiveThread();
    const open = Boolean(app.runtime.workspaceToolsOpen);

    dom.workspaceToolsPanel.classList.toggle("hidden", !open);
    dom.workspaceToolsPanel.classList.toggle("open", open);
    dom.workspaceToolsPanel.setAttribute("aria-hidden", String(!open));
    dom.workspaceToolsToggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("workspace-modal-open", open);

    const settings = thread?.settings ?? store.createDefaultThreadSettings();
    const effectiveSettings = store.resolveEffectiveSettings(settings);

    renderModelSelect(settings, effectiveSettings);
    renderReasoningSelect(settings, effectiveSettings);
    dom.approvalSelect.value = effectiveSettings.approvalPolicy ?? "";
    renderRuntimeConfigNote(effectiveSettings.model);

    if (!thread) {
      dom.settingsNote.textContent = "这些设置只作用于当前会话后续发出的任务。";
      return;
    }

    if (thread.serverThreadId) {
      dom.settingsNote.textContent = `当前会话已绑定后端 Codex thread：${thread.serverThreadId}`;
      return;
    }

    if (thread.bootstrapTranscript) {
      dom.settingsNote.textContent = `这是一个 fork 会话。第一次发送时，会先把${store.describeBootstrapLabel(thread)}导入新的 Codex 会话。`;
      return;
    }

    dom.settingsNote.textContent = "当前还没有建立后端上下文。首次发送后会创建新的 Codex 会话。";
  }

  function renderModelSelect(settings, effectiveSettings) {
    const runtimeConfig = app.runtime.runtimeConfig;
    const models = store.getVisibleModels(settings);

    if (runtimeConfig.status === "loading" && !models.length) {
      dom.modelSelect.innerHTML = '<option value="">正在读取 Codex 模型...</option>';
      dom.modelSelect.value = "";
      return;
    }

    if (!models.length) {
      dom.modelSelect.innerHTML = `<option value="">${utils.escapeHtml(resolveModelFallbackLabel(runtimeConfig))}</option>`;
      dom.modelSelect.value = "";
      return;
    }

    const defaultModel = runtimeConfig.defaults.model ?? "";

    dom.modelSelect.innerHTML = models
      .map((model) => {
        const label = buildModelOptionLabel(model, defaultModel);
        return `<option value="${utils.escapeHtml(model.model)}">${utils.escapeHtml(label)}</option>`;
      })
      .join("");

    dom.modelSelect.value = effectiveSettings.model ?? "";
  }

  function renderReasoningSelect(settings, effectiveSettings) {
    const inherited = store.resolveInheritedSettings(settings);
    const options = store.getReasoningOptions(settings);

    dom.reasoningSelect.innerHTML = options
      .map((option) => {
        const label = option.reasoningEffort === inherited.reasoning
          ? `${option.reasoningEffort}（默认）`
          : option.reasoningEffort;
        return `<option value="${utils.escapeHtml(option.reasoningEffort)}">${utils.escapeHtml(label)}</option>`;
      })
      .join("");

    dom.reasoningSelect.value = effectiveSettings.reasoning ?? options[0]?.reasoningEffort ?? "";
  }

  function renderRuntimeConfigNote(effectiveModel) {
    const runtimeConfig = app.runtime.runtimeConfig;

    if (runtimeConfig.status === "loading") {
      dom.runtimeConfigNote.textContent = "正在通过 Codex app-server 读取模型列表与默认运行配置。";
      return;
    }

    if (runtimeConfig.status === "error") {
      dom.runtimeConfigNote.textContent = runtimeConfig.errorMessage
        ? `读取 Codex 模型列表失败：${runtimeConfig.errorMessage}`
        : "读取 Codex 模型列表失败，当前会继续使用后端默认配置。";
      return;
    }

    if (runtimeConfig.status !== "ready") {
      dom.runtimeConfigNote.textContent = "模型与默认值将在读取 Codex 运行配置后显示。";
      return;
    }

    const parts = ["模型列表来自 Codex app-server。"];

    if (runtimeConfig.defaults.model) {
      parts.push(`当前默认模型：${runtimeConfig.defaults.model}。`);
    } else if (effectiveModel) {
      parts.push(`当前会话生效模型：${effectiveModel}。`);
    }

    if (runtimeConfig.defaults.reasoning) {
      parts.push(`默认推理：${runtimeConfig.defaults.reasoning}。`);
    }

    dom.runtimeConfigNote.textContent = parts.join(" ");
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
    dom.goalInput.value = mergeComposerDraft(thread);
    utils.autoResizeTextarea(dom.goalInput);
  }

  function renderComposerMeta() {
    const thread = store.getActiveThread();
    dom.activeThreadLabel.textContent = `会话：${thread?.title ?? "新会话"}`;
  }

  function syncBusyState() {
    const busy = store.isBusy();
    const controlsBusy = busy || app.runtime.sessionControlBusy;

    dom.submitButton.disabled = busy;
    dom.cancelButton.disabled = !busy;
    dom.forkThreadButton.disabled = controlsBusy;
    dom.newThreadButton.disabled = controlsBusy;
    dom.workspaceToolsToggle.disabled = false;
    dom.workspaceToolsClose.disabled = false;
    dom.threadSearchInput.disabled = controlsBusy && !app.runtime.threadSearchQuery;
    dom.goalInput.disabled = controlsBusy;
    dom.modelSelect.disabled = controlsBusy || !store.getVisibleModels(store.getActiveThread()?.settings).length;
    dom.reasoningSelect.disabled = controlsBusy;
    dom.approvalSelect.disabled = controlsBusy;
  }

  function setToolsPanelOpen(nextOpen) {
    app.runtime.workspaceToolsOpen = Boolean(nextOpen);
    renderWorkspaceTools();
  }

  function mergeComposerDraft(thread) {
    const goal = typeof thread?.draftGoal === "string" ? thread.draftGoal.trim() : "";
    const context = typeof thread?.draftContext === "string" ? thread.draftContext.trim() : "";

    if (!goal) {
      return context;
    }

    if (!context) {
      return goal;
    }

    return `${goal}\n\n补充要求：\n${context}`;
  }

  return {
    renderAll,
    renderThreadList,
    renderWorkspaceTools,
    setToolsPanelOpen,
  };
}

function buildModelOptionLabel(model, defaultModel) {
  if (model.model === defaultModel) {
    return `${model.displayName}（默认）`;
  }

  if (model.description?.includes("没有出现在")) {
    return `${model.displayName}（当前配置）`;
  }

  return model.displayName;
}

function resolveModelFallbackLabel(runtimeConfig) {
  if (runtimeConfig.status === "error") {
    return "无法读取 Codex 模型列表";
  }

  if (runtimeConfig.status === "ready") {
    return "暂无可用模型";
  }

  return "正在读取 Codex 模型...";
}
