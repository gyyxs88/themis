import {
  renderComposerActionBarMarkup,
  renderDraftInputAssetsMarkup,
  renderHistoryLoadingState,
  renderStoredSummaryState,
  renderThreadControlDetailsMarkup,
  renderThreadRiskBannerMarkup,
  renderThreadControlSourceMarkup,
  renderThreadButton,
  renderTurnMarkup,
} from "./ui-markup.js";
import { requiresAuthentication, requiresLocalBrowserForChatgptLogin } from "./auth.js";
import { buildWorkspaceNote, isWorkspaceLocked, normalizeWorkspacePath } from "./session-workspace.js";

const DEFAULT_COMPOSER_PLACEHOLDER = "直接输入你的目标、约束和注意事项，例如：继续把这个界面做成员工可用版本，并优先优化输入体验";

const COMPOSER_PLACEHOLDERS = {
  chat: DEFAULT_COMPOSER_PLACEHOLDER,
  review: "补充你希望重点审查的内容，例如：优先看回归风险和缺失测试",
  steer: "补充你希望当前执行如何调整，例如：先收紧范围，只处理 Web 回归",
};

const COMPOSER_SUBMIT_LABELS = {
  chat: "发送给 Themis",
  review: "提交 Review",
  steer: "发送 Steer",
};

export function createRenderer(app) {
  const { dom, store, utils } = app;

  function renderAll(scrollToBottom = false) {
    store.ensureActiveThread();
    dom.threadSearchInput.value = app.runtime.threadSearchQuery;
    if (dom.threadShowArchivedInput) {
      dom.threadShowArchivedInput.checked = Boolean(app.runtime.historyIncludeArchived);
    }
    renderThreadList();
    renderWorkspaceHeader();
    renderThreadControlPanel();
    renderWorkspaceTools();
    renderThirdPartyEditor();
    renderThreadRiskBanner();
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
          busy: app.runtime.sessionControlBusy,
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
    const activeSection = resolveWorkspaceToolsSection(app.runtime.workspaceToolsSection);

    dom.workspaceToolsPanel.classList.toggle("hidden", !open);
    dom.workspaceToolsPanel.classList.toggle("open", open);
    dom.workspaceToolsPanel.setAttribute("aria-hidden", String(!open));
    dom.workspaceToolsToggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("workspace-modal-open", open);
    renderWorkspaceToolsSections(activeSection);

    const settings = thread?.settings ?? store.createDefaultThreadSettings();
    const effectiveSettings = store.resolveEffectiveSettings(settings);

    renderAssistantStyleInputs(effectiveSettings);
    renderModelSelect(settings, effectiveSettings);
    renderThirdPartyProviderSelect(settings, effectiveSettings);
    renderThirdPartyModelSelect(settings, effectiveSettings);
    renderModeSwitchControls(settings, effectiveSettings);
    renderSessionWorkspaceControls(thread);
    renderReasoningSelect(settings, effectiveSettings);
    dom.approvalSelect.value = effectiveSettings.approvalPolicy ?? "";
    renderSandboxSelect(effectiveSettings);
    renderWebSearchSelect(settings, effectiveSettings);
    renderNetworkAccessSelect(effectiveSettings);
    renderAssistantStyleNote(effectiveSettings);
    renderRuntimeConfigNote(settings, effectiveSettings);
    renderUpdateManagerState();
    renderIdentityState();
    renderMemoryCandidatesState();
    renderSkillsState();
    renderMcpState();
    renderPluginsState();
    renderThirdPartyNotes(settings, effectiveSettings);
    renderThirdPartyEndpointProbeState(settings);
    renderThirdPartyProbeState(settings);
    renderThirdPartyProbeWritebackState(settings);
    renderAuthState();

    if (!thread) {
      dom.settingsNote.textContent = "上方人格字段和下方 sandbox / search / network / approval / account 都属于当前 principal 的长期默认配置，会同时影响 Web 和飞书后续新任务。";
      return;
    }

    if (thread.serverThreadId) {
      dom.settingsNote.textContent = `当前会话已绑定后端 Codex thread：${thread.serverThreadId}。人格字段与 sandbox / search / network / approval / account 仍按当前 principal 的长期默认配置生效。`;
      return;
    }

    if (thread.bootstrapTranscript) {
      dom.settingsNote.textContent = `这是一个 fork 会话。第一次发送时，会先把${store.describeBootstrapLabel(thread)}导入新的 Codex 会话；人格字段与 sandbox / search / network / approval / account 仍按当前 principal 的长期默认配置生效。`;
      return;
    }

    dom.settingsNote.textContent = "上方人格字段和下方 sandbox / search / network / approval / account 都属于当前 principal 的长期默认配置，会同时影响 Web 和飞书后续新任务。";
  }

  function renderThreadRiskBanner() {
    const thread = store.getActiveThread();
    const riskState = thread ? store.resolveTopRiskState(thread) : null;

    if (!riskState) {
      dom.threadRiskBanner.innerHTML = "";
      dom.threadRiskBanner.classList.add("hidden");
      dom.threadRiskBanner.setAttribute("aria-hidden", "true");
      return;
    }

    dom.threadRiskBanner.innerHTML = renderThreadRiskBannerMarkup(riskState, utils);
    dom.threadRiskBanner.classList.remove("hidden");
    dom.threadRiskBanner.setAttribute("aria-hidden", "false");
  }

  function renderThreadControlPanel() {
    const thread = store.getActiveThread();
    const threadControlState = thread ? store.resolveThreadControlState(thread) : null;
    const joinOpen = Boolean(app.runtime.threadControlJoinOpen);

    if (!thread || !threadControlState) {
      dom.threadControlPanel.hidden = true;
      dom.threadControlPanel.classList.add("hidden");
      dom.threadControlPanel.setAttribute("aria-hidden", "true");
      return;
    }

    dom.threadControlStatus.textContent = threadControlState.status?.label || "当前空闲";
    dom.threadControlConversationId.textContent = threadControlState.conversationId || "";
    dom.threadControlSource.innerHTML = renderThreadControlSourceMarkup(threadControlState, utils);
    dom.threadControlDetailsBody.innerHTML = renderThreadControlDetailsMarkup(threadControlState, utils);
    dom.threadControlJoinHint.textContent = threadControlState.joinHint || "";
    dom.conversationLinkNote.textContent = threadControlState.joinHint || "";
    if (dom.threadArchiveButton) {
      dom.threadArchiveButton.textContent = thread.historyArchivedAt ? "取消归档" : "归档当前会话";
    }
    dom.threadControlJoinPanel.hidden = !joinOpen;
    dom.threadControlJoinPanel.classList.toggle("hidden", !joinOpen);
    dom.threadControlJoinPanel.setAttribute("aria-hidden", String(!joinOpen));
    dom.threadControlJoinToggle.setAttribute("aria-expanded", String(joinOpen));
    dom.threadControlPanel.hidden = false;
    dom.threadControlPanel.classList.remove("hidden");
    dom.threadControlPanel.setAttribute("aria-hidden", "false");
  }

  function renderThirdPartyEditor() {
    let editor = app.runtime.thirdPartyEditor;
    const providers = store.getThirdPartyProviders();
    const mode = editor.mode === "model" ? "model" : "provider";
    const hasProviders = providers.length > 0;
    const normalizedProviderId = hasProviders && mode === "model"
      ? providers.some((provider) => provider.id === editor.modelForm.providerId)
        ? editor.modelForm.providerId
        : providers[0]?.id || ""
      : editor.modelForm.providerId;

    if (normalizedProviderId !== editor.modelForm.providerId) {
      app.runtime.thirdPartyEditor = {
        ...editor,
        modelForm: {
          ...editor.modelForm,
          providerId: normalizedProviderId,
        },
      };
      editor = app.runtime.thirdPartyEditor;
    }

    dom.thirdPartyEditorModal.classList.toggle("hidden", !editor.open);
    dom.thirdPartyEditorModal.setAttribute("aria-hidden", String(!editor.open));
    dom.thirdPartyEditorTitle.textContent = mode === "model" ? "添加模型" : "添加供应商";
    dom.thirdPartyEditorCopy.textContent = mode === "model"
      ? "给某个第三方供应商补充一个可选模型。"
      : "把新的第三方兼容供应商写入本地配置。";
    dom.thirdPartyEditorError.classList.toggle("hidden", !editor.errorMessage);
    dom.thirdPartyEditorError.textContent = editor.errorMessage || "";
    dom.thirdPartyProviderForm.classList.toggle("hidden", mode !== "provider");
    dom.thirdPartyModelForm.classList.toggle("hidden", mode !== "model");

    dom.thirdPartyProviderIdInput.value = editor.providerForm.id;
    dom.thirdPartyProviderNameInput.value = editor.providerForm.name;
    dom.thirdPartyProviderBaseUrlInput.value = editor.providerForm.baseUrl;
    dom.thirdPartyProviderApiKeyInput.value = editor.providerForm.apiKey;
    dom.thirdPartyProviderEndpointCandidatesInput.value = editor.providerForm.endpointCandidates;
    dom.thirdPartyProviderWireApiSelect.value = editor.providerForm.wireApi;
    dom.thirdPartyProviderWebsocketInput.checked = Boolean(editor.providerForm.supportsWebsockets);

    dom.thirdPartyModelProviderSelect.innerHTML = hasProviders
      ? providers
        .map((provider) => `<option value="${utils.escapeHtml(provider.id)}">${utils.escapeHtml(provider.name || provider.id)}</option>`)
        .join("")
      : '<option value="">请先添加供应商</option>';
    dom.thirdPartyModelProviderSelect.value = normalizedProviderId || "";
    dom.thirdPartyModelIdInput.value = editor.modelForm.model;
    dom.thirdPartyModelDisplayNameInput.value = editor.modelForm.displayName;
    dom.thirdPartyModelDefaultReasoningSelect.value = editor.modelForm.defaultReasoningLevel || "medium";
    dom.thirdPartyModelContextWindowInput.value = editor.modelForm.contextWindow;
    dom.thirdPartyModelDescriptionInput.value = editor.modelForm.description;
    dom.thirdPartyModelSupportsCodexInput.checked = Boolean(editor.modelForm.supportsCodexTasks);
    dom.thirdPartyModelImageInput.checked = Boolean(editor.modelForm.imageInput);
    dom.thirdPartyModelSearchInput.checked = Boolean(editor.modelForm.supportsSearchTool);
    dom.thirdPartyModelParallelToolsInput.checked = Boolean(editor.modelForm.supportsParallelToolCalls);
    dom.thirdPartyModelVerbosityInput.checked = Boolean(editor.modelForm.supportsVerbosity);
    dom.thirdPartyModelReasoningSummaryInput.checked = Boolean(editor.modelForm.supportsReasoningSummaries);
    dom.thirdPartyModelImageDetailInput.checked = Boolean(editor.modelForm.supportsImageDetailOriginal);
    dom.thirdPartyModelDefaultInput.checked = Boolean(editor.modelForm.setAsDefault);
  }

  function renderWorkspaceToolsSections(activeSection) {
    dom.workspaceToolsNavButtons.forEach((button) => {
      const active = button.dataset.settingsSection === activeSection;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });

    dom.settingsRuntimeSection.classList.toggle("hidden", activeSection !== "runtime");
    dom.settingsRuntimeSection.setAttribute("aria-hidden", String(activeSection !== "runtime"));
    dom.settingsAuthSection.classList.toggle("hidden", activeSection !== "auth");
    dom.settingsAuthSection.setAttribute("aria-hidden", String(activeSection !== "auth"));
    dom.settingsSkillsSection.classList.toggle("hidden", activeSection !== "skills");
    dom.settingsSkillsSection.setAttribute("aria-hidden", String(activeSection !== "skills"));
    dom.settingsMcpSection.classList.toggle("hidden", activeSection !== "mcp");
    dom.settingsMcpSection.setAttribute("aria-hidden", String(activeSection !== "mcp"));
    dom.settingsPluginsSection.classList.toggle("hidden", activeSection !== "plugins");
    dom.settingsPluginsSection.setAttribute("aria-hidden", String(activeSection !== "plugins"));
    dom.settingsAgentsSection?.classList.toggle("hidden", activeSection !== "agents");
    dom.settingsAgentsSection?.setAttribute("aria-hidden", String(activeSection !== "agents"));
    dom.settingsMemoryCandidatesSection.classList.toggle("hidden", activeSection !== "memory-candidates");
    dom.settingsMemoryCandidatesSection.setAttribute("aria-hidden", String(activeSection !== "memory-candidates"));
    dom.settingsThirdPartySection.classList.toggle("hidden", activeSection !== "third-party");
    dom.settingsThirdPartySection.setAttribute("aria-hidden", String(activeSection !== "third-party"));
    dom.settingsModeSwitchSection.classList.toggle("hidden", activeSection !== "mode-switch");
    dom.settingsModeSwitchSection.setAttribute("aria-hidden", String(activeSection !== "mode-switch"));
  }

  function renderMemoryCandidatesState() {
    const candidatesState = app.runtime.memoryCandidates ?? {};
    const candidates = Array.isArray(candidatesState.candidates) ? candidatesState.candidates : [];
    const busy = Boolean(candidatesState.loading || candidatesState.extracting || candidatesState.reviewingCandidateId);
    const statusMessage = resolveMemoryCandidatesStatusMessage(candidatesState, candidates.length);

    dom.memoryCandidatesFilterSelect.value = resolveMemoryCandidatesFilterValue(candidatesState.filterStatus);
    dom.memoryCandidatesIncludeArchivedInput.checked = Boolean(candidatesState.includeArchived);
    dom.memoryCandidatesRefreshButton.disabled = busy;
    dom.memoryCandidatesExtractButton.disabled = busy;
    dom.memoryCandidatesFilterSelect.disabled = busy;
    dom.memoryCandidatesIncludeArchivedInput.disabled = busy;

    dom.memoryCandidatesStatusNote.classList.toggle("hidden", !statusMessage);
    dom.memoryCandidatesStatusNote.textContent = statusMessage;
    if (statusMessage) {
      dom.memoryCandidatesStatusNote.dataset.state = candidatesState.errorMessage
        ? "error"
        : busy
          ? "loading"
          : candidatesState.noticeMessage
            ? "supported"
            : "inconclusive";
    } else {
      delete dom.memoryCandidatesStatusNote.dataset.state;
    }

    dom.memoryCandidatesListEmpty.classList.toggle("hidden", candidates.length > 0);
    dom.memoryCandidatesListEmpty.textContent = resolveEmptyMemoryCandidatesLabel(candidatesState);
    dom.memoryCandidatesList.innerHTML = candidates
      .map((candidate) => renderMemoryCandidateCard(candidate, {
        busy,
        reviewingCandidateId: candidatesState.reviewingCandidateId,
        escapeHtml: utils.escapeHtml,
        formatRelativeTime: utils.formatRelativeTime,
      }))
      .join("");
  }

  function renderSkillsState() {
    const skillsState = app.runtime.skills ?? {};
    const skills = Array.isArray(skillsState.skills) ? skillsState.skills : [];
    const curated = Array.isArray(skillsState.curated) ? skillsState.curated : [];
    const busy = Boolean(skillsState.loading || skillsState.installing || skillsState.syncing);
    const statusMessage = resolveSkillsStatusMessage(skillsState);
    const statusTone = skillsState.errorMessage
      ? "error"
      : busy
        ? "loading"
        : skillsState.noticeMessage
          ? "inconclusive"
          : "supported";

    dom.skillsStatusNote.classList.toggle("hidden", !statusMessage);
    dom.skillsStatusNote.textContent = statusMessage;
    if (statusMessage) {
      dom.skillsStatusNote.dataset.state = statusTone;
    } else {
      delete dom.skillsStatusNote.dataset.state;
    }

    dom.skillsListEmpty.classList.toggle("hidden", skills.length > 0);
    dom.skillsList.innerHTML = skills
      .map((skill) => renderSkillCard(skill, {
        busy,
        escapeHtml: utils.escapeHtml,
        formatRelativeTime: utils.formatRelativeTime,
      }))
      .join("");

    dom.skillsCuratedEmpty.classList.toggle("hidden", curated.length > 0);
    dom.skillsCuratedList.innerHTML = curated
      .map((item) => renderCuratedSkillCard(item, {
        busy,
        escapeHtml: utils.escapeHtml,
      }))
      .join("");
  }

  function renderMcpState() {
    const mcpState = app.runtime.mcp ?? {};
    const servers = Array.isArray(mcpState.servers) ? mcpState.servers : [];
    const busy = Boolean(mcpState.loading || mcpState.mutating);
    const statusMessage = resolveMcpStatusMessage(mcpState);
    const statusTone = mcpState.errorMessage
      ? "error"
      : busy
        ? "loading"
        : mcpState.noticeMessage
          ? "inconclusive"
          : "supported";

    dom.mcpStatusNote.classList.toggle("hidden", !statusMessage);
    dom.mcpStatusNote.textContent = statusMessage;
    if (statusMessage) {
      dom.mcpStatusNote.dataset.state = statusTone;
    } else {
      delete dom.mcpStatusNote.dataset.state;
    }

    dom.mcpRefreshButton.disabled = busy;
    dom.mcpReloadButton.disabled = busy;
    dom.mcpSaveButton.disabled = busy;
    dom.mcpResetButton.disabled = busy;
    dom.mcpServerNameInput.disabled = busy;
    dom.mcpCommandInput.disabled = busy;
    dom.mcpArgsInput.disabled = busy;
    dom.mcpCwdInput.disabled = busy;
    dom.mcpEnvInput.disabled = busy;
    dom.mcpEnabledInput.disabled = busy;

    dom.mcpListEmpty.classList.toggle("hidden", servers.length > 0);
    dom.mcpList.innerHTML = servers
      .map((server) => renderMcpCard(server, {
        busy,
        escapeHtml: utils.escapeHtml,
        formatRelativeTime: utils.formatRelativeTime,
      }))
      .join("");
  }

  function renderPluginsState() {
    const pluginsState = app.runtime.plugins ?? {};
    const principalPlugins = Array.isArray(pluginsState.principalPlugins) ? pluginsState.principalPlugins : [];
    const marketplaces = Array.isArray(pluginsState.marketplaces) ? pluginsState.marketplaces : [];
    const detailsById = pluginsState.detailsById && typeof pluginsState.detailsById === "object"
      ? pluginsState.detailsById
      : {};
    const featuredPluginIds = new Set(
      Array.isArray(pluginsState.featuredPluginIds)
        ? pluginsState.featuredPluginIds.filter((item) => typeof item === "string" && item.trim().length > 0)
        : [],
    );
    const busy = Boolean(pluginsState.loading || pluginsState.mutating);
    const statusMessage = resolvePluginsStatusMessage(pluginsState);
    const thread = store.getActiveThread();
    const workspacePath = normalizeWorkspacePath(thread?.settings?.workspacePath);
    const statusTone = pluginsState.errorMessage
      ? "error"
      : busy
        ? "loading"
        : pluginsState.noticeMessage
          ? "inconclusive"
          : pluginsState.remoteSyncError || (pluginsState.marketplaceLoadErrors?.length ?? 0) > 0
            ? "inconclusive"
          : "supported";

    dom.pluginsNote.textContent = workspacePath
      ? `这里优先展示当前 principal 已拥有的 plugins，并叠加会话工作区 ${workspacePath} 下当前可发现的 marketplace。切换工作区后，“当前可用”状态可能变化，但 principal 拥有权不会漂移。`
      : "这里优先展示当前 principal 已拥有的 plugins，并叠加当前环境可发现的 marketplace。切换认证账号或服务工作区只会影响当前可用状态，不会改变 principal 拥有权。";

    dom.pluginsStatusNote.classList.toggle("hidden", !statusMessage);
    dom.pluginsStatusNote.textContent = statusMessage;
    if (statusMessage) {
      dom.pluginsStatusNote.dataset.state = statusTone;
    } else {
      delete dom.pluginsStatusNote.dataset.state;
    }

    dom.pluginsRefreshButton.disabled = busy;
    dom.pluginsRemoteSyncButton.disabled = busy;

    const renderOptions = {
      busy,
      detailsById,
      expandedPluginId: typeof pluginsState.expandedPluginId === "string" ? pluginsState.expandedPluginId : "",
      detailLoadingPluginId: typeof pluginsState.detailLoadingPluginId === "string"
        ? pluginsState.detailLoadingPluginId
        : "",
      featuredPluginIds,
      escapeHtml: utils.escapeHtml,
    };

    dom.pluginsListEmpty.classList.toggle("hidden", principalPlugins.length > 0 || marketplaces.length > 0);
    dom.pluginsList.innerHTML = [
      principalPlugins.length > 0 ? renderPrincipalPluginsSection(principalPlugins, renderOptions) : "",
      marketplaces.length > 0 ? renderPluginDiscoverySection(marketplaces, renderOptions) : "",
    ].filter(Boolean).join("");
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

  function renderAssistantStyleInputs(effectiveSettings) {
    dom.assistantLanguageStyleInput.value = app.runtime.identity?.assistantLanguageStyleDraft
      ?? app.runtime.identity?.assistantLanguageStyle
      ?? "";
    dom.assistantMbtiInput.value = app.runtime.identity?.assistantMbtiDraft
      ?? app.runtime.identity?.assistantMbti
      ?? "";
    dom.assistantStyleNotesInput.value = app.runtime.identity?.assistantStyleNotesDraft
      ?? app.runtime.identity?.assistantStyleNotes
      ?? "";
    dom.assistantSoulInput.value = app.runtime.identity?.assistantSoulDraft ?? app.runtime.identity?.assistantSoul ?? "";
  }

  function renderAssistantStyleNote(effectiveSettings) {
    const assistantLanguageStyle = app.runtime.identity?.assistantLanguageStyleDraft
      ?? app.runtime.identity?.assistantLanguageStyle
      ?? "";
    const assistantMbti = app.runtime.identity?.assistantMbtiDraft
      ?? app.runtime.identity?.assistantMbti
      ?? "";
    const assistantStyleNotes = app.runtime.identity?.assistantStyleNotesDraft
      ?? app.runtime.identity?.assistantStyleNotes
      ?? "";
    const assistantSoul = app.runtime.identity?.assistantSoulDraft
      ?? app.runtime.identity?.assistantSoul
      ?? "";
    const styleDescription = store.describeAssistantStyle({
      languageStyle: assistantLanguageStyle,
      assistantMbti,
      styleNotes: assistantStyleNotes,
      assistantSoul,
    });
    const hasUnsavedDraft = assistantLanguageStyle !== (app.runtime.identity?.assistantLanguageStyle ?? "")
      || assistantMbti !== (app.runtime.identity?.assistantMbti ?? "")
      || assistantStyleNotes !== (app.runtime.identity?.assistantStyleNotes ?? "")
      || assistantSoul !== (app.runtime.identity?.assistantSoul ?? "");
    dom.assistantStyleNote.textContent = app.runtime.identity?.savingPersona
      ? `${styleDescription} 正在保存当前 principal 的长期人格。`
      : hasUnsavedDraft
        ? `${styleDescription} 这里配置的是当前 principal 的长期人格，所有会话默认继承；发送消息前会自动保存，只有重置 principal 才会一起清空。`
        : `${styleDescription} 这里配置的是当前 principal 的长期人格，所有会话默认继承；只有重置 principal 才会一起清空。`;
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

  function renderThirdPartyProviderSelect(settings, effectiveSettings) {
    const providers = store.getThirdPartyProviders();

    if (!providers.length) {
      dom.thirdPartyProviderSelect.innerHTML = '<option value="">当前没有可用第三方供应商</option>';
      dom.thirdPartyProviderSelect.value = "";
      return;
    }

    dom.thirdPartyProviderSelect.innerHTML = providers
      .map((provider) => {
        const label = provider.name || provider.id;
        return `<option value="${utils.escapeHtml(provider.id)}">${utils.escapeHtml(label)}</option>`;
      })
      .join("");

    dom.thirdPartyProviderSelect.value = effectiveSettings.thirdPartyProviderId || providers[0]?.id || "";
  }

  function renderThirdPartyModelSelect(settings, effectiveSettings) {
    const selection = store.resolveThirdPartySelection(settings);
    const models = store.getThirdPartyModels(settings);
    const fallbackLabel = models.length ? "请选择第三方模型" : "当前供应商没有可用模型";
    const markup = models.length
      ? models
        .map((model) => {
          const label = buildModelOptionLabel(model, selection.provider?.defaultModel || effectiveSettings.thirdPartyModel);
          return `<option value="${utils.escapeHtml(model.model)}">${utils.escapeHtml(label)}</option>`;
        })
        .join("")
      : `<option value="">${utils.escapeHtml(fallbackLabel)}</option>`;

    dom.thirdPartyModelSelect.innerHTML = markup;
    dom.modeSwitchThirdPartyModelSelect.innerHTML = markup;
    dom.thirdPartyModelSelect.value = effectiveSettings.thirdPartyModel || "";
  }

  function renderModeSwitchControls(settings, effectiveSettings) {
    const draft = app.modeSwitch.getDraft(settings);
    const accessModes = Array.isArray(app.runtime.runtimeConfig.accessModes)
      ? app.runtime.runtimeConfig.accessModes
      : [];

    dom.accessModeSelect.innerHTML = accessModes
      .map((mode) => {
        const disabled = mode.id === "third-party" && !store.getThirdPartyProviders().length;
        return `<option value="${utils.escapeHtml(mode.id)}"${disabled ? " disabled" : ""}>${utils.escapeHtml(mode.label || mode.id)}</option>`;
      })
      .join("");

    dom.accessModeSelect.value = draft.accessMode || effectiveSettings.accessMode || "auth";
    renderModeSwitchAuthAccountSelect(app.runtime.auth, draft);
    dom.modeSwitchAuthAccountRow.classList.toggle("hidden", draft.accessMode !== "auth");
    dom.modeSwitchThirdPartyModelRow.classList.toggle("hidden", draft.accessMode !== "third-party");
    dom.modeSwitchThirdPartyModelSelect.value = draft.thirdPartyModel || "";
    dom.accessModeApplyButton.textContent = draft.accessMode !== (effectiveSettings.accessMode || "auth")
      ? "确定切换"
      : "确定应用";

    const pendingNote = buildAccessModePendingNote(store, settings, effectiveSettings, draft, app.runtime.auth);
    dom.accessModePendingNote.classList.toggle("hidden", !pendingNote);
    dom.accessModePendingNote.textContent = pendingNote;

    renderAccessModeNote(settings, effectiveSettings, app.runtime.auth);
  }

  function renderSessionWorkspaceControls(thread) {
    dom.sessionWorkspaceInput.value = normalizeWorkspacePath(thread?.settings?.workspacePath);
    dom.sessionWorkspaceNote.textContent = buildWorkspaceNote(thread);

    const locked = isWorkspaceLocked(thread);
    dom.sessionWorkspaceInput.disabled = locked;
    dom.sessionWorkspaceApplyButton.disabled = locked;
  }

  function renderSandboxSelect(effectiveSettings) {
    dom.sandboxSelect.value = effectiveSettings.sandboxMode ?? "";
  }

  function renderWebSearchSelect(settings, effectiveSettings) {
    const selection = store.resolveThirdPartySelection(settings);
    const searchSupported = effectiveSettings.accessMode !== "third-party"
      || !selection.model
      || store.getThirdPartyModelCapabilities(selection.model).supportsSearchTool;

    Array.from(dom.webSearchSelect.options).forEach((option) => {
      if (!(option instanceof HTMLOptionElement)) {
        return;
      }

      if (searchSupported) {
        option.disabled = false;
        return;
      }

      option.disabled = option.value !== "disabled";
    });

    dom.webSearchSelect.value = searchSupported
      ? effectiveSettings.webSearchMode ?? ""
      : "disabled";
  }

  function renderNetworkAccessSelect(effectiveSettings) {
    dom.networkAccessSelect.value = toBooleanSelectValue(effectiveSettings.networkAccessEnabled);
  }

  function renderRuntimeConfigNote(settings, effectiveSettings) {
    const runtimeConfig = app.runtime.runtimeConfig;
    const provider = runtimeConfig.provider;
    const effectiveModel = effectiveSettings.model || "";

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

    if (store.resolveAccessMode(settings) === "third-party") {
      const thirdPartySelection = store.resolveThirdPartySelection(settings);
      const parts = ["当前会话已切到第三方模式。这里的模型下拉只影响认证模式。"];

      if (thirdPartySelection.provider?.name) {
        parts.push(`当前第三方供应商：${thirdPartySelection.provider.name}。`);
      }

      if (effectiveSettings.thirdPartyModel) {
        parts.push(`当前第三方模型：${effectiveSettings.thirdPartyModel}。`);
      }

      dom.runtimeConfigNote.textContent = parts.join(" ");
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

    if (runtimeConfig.defaults.sandboxMode) {
      parts.push(`默认沙箱：${runtimeConfig.defaults.sandboxMode}。`);
    }

    if (runtimeConfig.defaults.webSearchMode) {
      parts.push(`默认联网搜索：${runtimeConfig.defaults.webSearchMode}。`);
    }

    if (typeof runtimeConfig.defaults.networkAccessEnabled === "boolean") {
      parts.push(`workspace-write 默认网络访问：${runtimeConfig.defaults.networkAccessEnabled ? "开启" : "关闭"}。`);
    }

    dom.runtimeConfigNote.textContent = parts.join(" ");
  }

  function renderUpdateManagerState() {
    const updateState = app.runtime.updateManager;
    const check = updateState.check;
    const operation = updateState.operation;
    const rollbackAnchor = updateState.rollbackAnchor;
    const currentVersion = check
      ? [check.packageVersion || "未检测到版本号", check.currentCommit ? `提交 ${shortCommit(check.currentCommit)}` : null]
        .filter(Boolean)
        .join(" · ")
      : "正在读取";
    const targetVersion = !check
      ? "正在读取"
      : check.updateChannel === "release"
        ? check.latestReleaseTag
          ? `${check.latestReleaseTag}${check.latestCommit ? ` · ${shortCommit(check.latestCommit)}` : ""}`
          : "当前还没有正式 release"
        : check.latestCommit
          ? shortCommit(check.latestCommit)
          : "未检测到远端提交";
    const rollbackText = rollbackAnchor?.available
      ? `${shortCommit(rollbackAnchor.previousCommit)}${rollbackAnchor.appliedReleaseTag ? ` · 来自 ${rollbackAnchor.appliedReleaseTag}` : ""}`
      : "当前没有最近一次成功升级记录";
    const operationText = !operation
      ? "当前没有运行中的升级任务。"
      : operation.status === "running"
        ? `${operation.action === "apply" ? "升级" : "回滚"}进行中：${operation.progressMessage || operation.progressStep || "正在执行"}`
        : operation.status === "failed"
          ? `最近一次${operation.action === "apply" ? "升级" : "回滚"}失败：${operation.errorMessage || "未知错误"}`
          : operation.result?.summary || `最近一次${operation.action === "apply" ? "升级" : "回滚"}已完成。`;

    dom.updateManagerCurrent.textContent = currentVersion;
    dom.updateManagerTarget.textContent = targetVersion;
    dom.updateManagerRollback.textContent = rollbackText;
    dom.updateManagerOperation.textContent = operationText;

    if (updateState.status === "loading") {
      dom.updateManagerNote.textContent = "正在检查 GitHub 更新源与本地升级状态。";
    } else if (updateState.status === "error") {
      dom.updateManagerNote.textContent = updateState.errorMessage
        ? `读取升级状态失败：${updateState.errorMessage}`
        : "读取升级状态失败。";
    } else if (check?.summary) {
      dom.updateManagerNote.textContent = check.summary;
    } else {
      dom.updateManagerNote.textContent = "正式实例可在这里检查 GitHub 更新、执行后台升级或回滚上一版。";
    }

    dom.updateManagerActionNote.textContent = updateState.errorMessage
      ? updateState.errorMessage
      : updateState.noticeMessage
        ? updateState.noticeMessage
        : operation?.result?.restartStatus === "failed"
          ? `版本切换已完成，但请求重启失败：${operation.result.restartErrorMessage || "未知错误"}`
          : "Web 入口会在后台执行受控升级，版本切换完成后再请求重启当前服务。";
    dom.updateManagerRefreshButton.disabled = updateState.busyAction === "apply" || updateState.busyAction === "rollback";
    dom.updateManagerApplyButton.disabled = updateState.busyAction === "apply" || operation?.status === "running";
    dom.updateManagerRollbackButton.disabled = updateState.busyAction === "rollback"
      || operation?.status === "running"
      || !rollbackAnchor?.available;
  }

  function renderThirdPartyNotes(settings, effectiveSettings) {
    const selection = store.resolveThirdPartySelection(settings);

    if (!selection.provider) {
      dom.thirdPartyProviderNote.textContent = "当前还没有可用的第三方兼容供应商。可以先点上面的“添加供应商”。";
      dom.thirdPartyModelNote.textContent = "接入第三方模式前，需要先准备供应商和至少一个模型。";
      return;
    }

    const providerParts = [`当前可用供应商：${selection.provider.name}。`];

    if (selection.provider.baseUrl) {
      providerParts.push(`当前主端点：${selection.provider.baseUrl}。`);
    }

    if (selection.provider.endpointCandidates?.length) {
      providerParts.push(`候选端点：${selection.provider.endpointCandidates.length} 个。`);
    }

    if (selection.provider.source) {
      providerParts.push(`配置来源：${describeThirdPartyProviderSource(selection.provider.source)}。`);
    }

    if (selection.provider.wireApi) {
      providerParts.push(`兼容通道：${selection.provider.wireApi}。`);
    }

    if (typeof selection.provider.supportsWebsockets === "boolean") {
      providerParts.push(`WebSocket 流式：${selection.provider.supportsWebsockets ? "开启" : "关闭"}。`);
    }

    dom.thirdPartyProviderNote.textContent = providerParts.join(" ");

    if (effectiveSettings.thirdPartyModel) {
      const modelParts = [`当前第三方模型：${effectiveSettings.thirdPartyModel}。`];

      if (selection.model?.contextWindow) {
        modelParts.push(`上下文窗口：${formatLargeNumber(selection.model.contextWindow)}。`);
      }

      modelParts.push(`声明能力：${describeThirdPartyModelCapabilities(selection.model)}。`);

      if (selection.model?.supportsCodexTasks === false) {
        modelParts.push("这个模型当前未声明支持 Codex agent 任务，Themis 会直接阻止发送。");
      }

      modelParts.push("当前除了 Codex 任务守卫外，联网搜索和明确不支持图片输入的模型也会被前后端收紧；其它能力位仍主要用于模型画像和提示。");
      dom.thirdPartyModelNote.textContent = modelParts.join(" ");
      return;
    }

    dom.thirdPartyModelNote.textContent = "第三方模型列表会跟随所选供应商切换。";
  }

  function renderAccessModeNote(settings, effectiveSettings, auth) {
    if (effectiveSettings.accessMode === "third-party") {
      const selection = store.resolveThirdPartySelection(store.getActiveThread()?.settings);
      const providerName = selection.provider?.name || "第三方兼容供应商";
      const modelName = effectiveSettings.thirdPartyModel || selection.modelId || "默认模型";
      const supportText = selection.model?.supportsCodexTasks === false
        ? "这个模型当前未声明支持 Codex agent 任务，不能直接用于 Themis 执行。"
        : "这种模式不依赖 ChatGPT 认证。";
      const capabilityText = selection.model ? `已声明：${describeThirdPartyModelCapabilities(selection.model, true)}。` : "";
      const warningText = buildThirdPartyModelRuntimeWarnings(selection.model, settings);
      dom.accessModeNote.textContent = [
        `当前会话会通过 ${providerName} 发送任务，模型 ${modelName}。`,
        supportText,
        capabilityText,
        warningText ? `注意：${warningText}` : "",
      ].filter(Boolean).join(" ");
      return;
    }

    const effectiveAuthAccountId = normalizeAuthAccountId(effectiveSettings.authAccountId);
    const effectiveAccount = findAuthAccount(auth, effectiveAuthAccountId);

    if (effectiveAuthAccountId) {
      dom.accessModeNote.textContent = `当前会话会通过 Codex / ChatGPT 认证模式发送任务，并使用当前 principal 默认认证账号 ${formatAuthAccountDisplayName(effectiveAccount, effectiveAuthAccountId)}。`;
      return;
    }

    dom.accessModeNote.textContent = "当前会话会通过 Codex / ChatGPT 认证模式发送任务，并跟随 Themis 系统默认账号。";
  }

  function describeThirdPartyProviderSource(source) {
    if (source === "env") {
      return "环境变量";
    }

    if (source === "db") {
      return "本地数据库";
    }

    return source || "未知";
  }

  function getThirdPartyModelCapabilities(model) {
    return store.getThirdPartyModelCapabilities(model);
  }

  function describeThirdPartyModelCapabilities(model, compact = false) {
    if (!model) {
      return compact ? "缺少能力画像" : "当前只记录了模型名，还没有能力画像";
    }

    const capabilities = getThirdPartyModelCapabilities(model);
    const separator = compact ? "，" : "；";

    return [
      `Codex 任务${capabilities.supportsCodexTasks ? "支持" : "未声明"}`,
      `图片输入${capabilities.imageInput ? "支持" : "未声明"}`,
      `搜索工具${capabilities.supportsSearchTool ? "支持" : "未声明"}`,
      `并行工具${capabilities.supportsParallelToolCalls ? "支持" : "未声明"}`,
      `verbosity${capabilities.supportsVerbosity ? "支持" : "未声明"}`,
      `reasoning summary${capabilities.supportsReasoningSummaries ? "支持" : "未声明"}`,
      `原图细节${capabilities.supportsImageDetailOriginal ? "支持" : "未声明"}`,
    ].join(separator);
  }

  function buildThirdPartyModelRuntimeWarnings(model, settings) {
    return store.resolveThirdPartyWebSearchWarning(settings, model);
  }

  function formatLargeNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return "";
    }

    return new Intl.NumberFormat("zh-CN").format(value);
  }

  function renderThirdPartyProbeState(settings) {
    const selection = store.resolveThirdPartySelection(settings);
    const probe = app.runtime.thirdPartyProbe;
    const matchesSelection = probe.providerId === (selection.provider?.id || "")
      && probe.model === (selection.model?.model || selection.modelId || "");

    dom.thirdPartyProbeButton.textContent = probe.status === "loading" && matchesSelection
      ? "正在测试..."
      : matchesSelection && probe.checkedAt
        ? "重新测试这个模型"
        : "测试这个模型";

    dom.thirdPartyProbeNote.dataset.state = matchesSelection ? probe.status || "idle" : "idle";

    if (!selection.provider || !selection.model) {
      dom.thirdPartyProbeNote.textContent = "先选好供应商和模型，再点按钮测试它能不能跑 Themis 的真实 Codex 任务。";
      return;
    }

    if (!matchesSelection || probe.status === "idle") {
      dom.thirdPartyProbeNote.textContent = "按钮会发起一次只读探测：让模型实际执行命令并回写结果。只有这条链路通过，才算真的支持 Themis。";
      return;
    }

    const checkedAt = probe.checkedAt ? ` 测试时间：${utils.formatRelativeTime(probe.checkedAt)}。` : "";
    const commandNote = probe.observedCommand ? ` 观察到的命令：${probe.observedCommand}` : "";
    const previewNote = probe.outputPreview ? ` 输出预览：${probe.outputPreview}` : "";
    dom.thirdPartyProbeNote.textContent = `${probe.summary}${checkedAt} ${probe.detail}${commandNote}${previewNote}`.trim();
  }

  function renderThirdPartyEndpointProbeState(settings) {
    const selection = store.resolveThirdPartySelection(settings);
    const probe = app.runtime.thirdPartyEndpointProbe;
    const matchesProvider = probe.providerId === (selection.provider?.id || "");

    dom.thirdPartyEndpointProbeButton.textContent = probe.status === "loading" && matchesProvider
      ? "正在检测端点..."
      : matchesProvider && probe.checkedAt
        ? "重新检测端点"
        : "检测端点并自动选主地址";

    dom.thirdPartyEndpointProbeNote.dataset.state = matchesProvider
      ? probe.status === "healthy"
        ? "supported"
        : probe.status || "idle"
      : "idle";

    if (!selection.provider) {
      dom.thirdPartyEndpointProbeNote.textContent = "先选好供应商，再检测它的主端点和候选端点。";
      return;
    }

    if (!matchesProvider || probe.status === "idle") {
      dom.thirdPartyEndpointProbeNote.textContent = "按钮会批量检查当前主端点和候选端点，优先把健康且最快的地址提升为主端点。";
      return;
    }

    const checkedAt = probe.checkedAt ? ` 检测时间：${utils.formatRelativeTime(probe.checkedAt)}。` : "";
    const selectedNote = probe.selectedBaseUrl ? ` 当前选中的主端点：${probe.selectedBaseUrl}。` : "";
    const latencyNote = typeof probe.fastestHealthyLatencyMs === "number"
      ? ` 最快健康时延：${probe.fastestHealthyLatencyMs}ms。`
      : "";
    const failedCount = probe.results.filter((entry) => entry.ok === false).length;
    const failedNote = failedCount ? ` 本次有 ${failedCount} 个端点未通过健康检查。` : "";
    const persistedNote = probe.persistedMessage ? ` ${probe.persistedMessage}` : "";

    dom.thirdPartyEndpointProbeNote.textContent = `${probe.summary}${checkedAt} ${probe.detail}${selectedNote}${latencyNote}${failedNote}${persistedNote}`.trim();
  }

  function renderThirdPartyProbeWritebackState(settings) {
    const selection = store.resolveThirdPartySelection(settings);
    const probe = app.runtime.thirdPartyProbe;
    const matchesSelection = probe.providerId === (selection.provider?.id || "")
      && probe.model === (selection.model?.model || selection.modelId || "");
    const canPersistSelection = matchesSelection
      && ["supported", "unsupported"].includes(probe.status)
      && selection.provider?.source !== "env"
      && selection.model?.model === selection.provider?.defaultModel;
    const persistMessage = matchesSelection ? probe.persistMessage : "";
    const shouldShowRow = canPersistSelection || Boolean(persistMessage);

    dom.thirdPartyProbeApplyRow.classList.toggle("hidden", !shouldShowRow);
    dom.thirdPartyProbeApplyButton.classList.toggle("hidden", !canPersistSelection);

    if (!shouldShowRow) {
      dom.thirdPartyProbeApplyNote.classList.add("hidden");
      dom.thirdPartyProbeApplyNote.textContent = "";
      return;
    }

    dom.thirdPartyProbeApplyButton.textContent = probe.status === "supported"
      ? "把当前模型标记为支持 Codex 任务"
      : "把当前模型标记为不支持 Codex 任务";

    if (!persistMessage) {
      dom.thirdPartyProbeApplyNote.classList.add("hidden");
      dom.thirdPartyProbeApplyNote.textContent = "";
      return;
    }

    dom.thirdPartyProbeApplyNote.classList.remove("hidden");
    dom.thirdPartyProbeApplyNote.textContent = persistMessage;
  }

  function renderAuthState() {
    const auth = app.runtime.auth;
    const pendingLogin = auth.pendingLogin;
    const browserPending = pendingLogin?.mode === "browser";
    const devicePending = pendingLogin?.mode === "device";
    const remoteBrowserWarning = shouldShowRemoteBrowserLoginWarning(auth);

    renderAuthAccountControls(auth);

    dom.authRemoteLoginPanel.classList.toggle("hidden", !remoteBrowserWarning);
    dom.authBrowserLoginPanel.classList.toggle("hidden", !browserPending);
    dom.authDeviceLoginPanel.classList.toggle("hidden", !devicePending);
    dom.authLoginCancelButton.classList.toggle("hidden", !pendingLogin);

    if (remoteBrowserWarning) {
      dom.authRemoteLoginCopy.textContent = buildRemoteBrowserLoginCopy(auth);
      dom.authRemoteLoginCommand.textContent = auth.browserLogin?.sshTunnelCommand || "";
      dom.authRemoteLoginCommand.classList.toggle("hidden", !auth.browserLogin?.sshTunnelCommand);
    } else {
      dom.authRemoteLoginCopy.textContent = "";
      dom.authRemoteLoginCommand.textContent = "";
      dom.authRemoteLoginCommand.classList.add("hidden");
    }

    if (browserPending) {
      dom.authBrowserLoginLink.href = pendingLogin.authUrl || "#";
      dom.authBrowserLoginNote.textContent = describeBrowserLoginNote(auth, pendingLogin.startedAt);
    } else {
      dom.authBrowserLoginLink.href = "#";
      dom.authBrowserLoginNote.textContent = "授权完成后会回到这台机器的 localhost:1455。";
    }

    if (devicePending) {
      dom.authDeviceLoginLink.href = pendingLogin.verificationUri || "#";
      dom.authDeviceLoginCode.textContent = pendingLogin.userCode || "正在生成设备码...";
      dom.authDeviceLoginNote.textContent = describeDeviceLoginNote(pendingLogin.startedAt, pendingLogin.expiresAt);
    } else {
      dom.authDeviceLoginLink.href = "#";
      dom.authDeviceLoginCode.textContent = "";
      dom.authDeviceLoginNote.textContent = "打开授权页后，输入这里显示的一次性 code。";
    }

    dom.authDeviceLoginCopyButton.disabled = !devicePending || !pendingLogin?.userCode;
    renderAuthRateLimits(auth);

    if (auth.status === "loading") {
      dom.authStatusNote.textContent = "正在检查 Codex 认证状态。";
      return;
    }

    if (auth.status === "error") {
      dom.authStatusNote.textContent = auth.errorMessage
        ? `读取认证状态失败：${auth.errorMessage}`
        : "读取认证状态失败。";
      return;
    }

    dom.authStatusNote.textContent = buildAuthStatusNote(auth);
  }

  function renderAuthAccountControls(auth) {
    const accounts = Array.isArray(auth.accounts) ? auth.accounts : [];
    const activeAccountId = normalizeAuthAccountId(auth.activeAccountId)
      || accounts.find((account) => account.isActive)?.accountId
      || accounts[0]?.accountId
      || "";
    const currentAccountId = normalizeAuthAccountId(auth.currentAccountId) || activeAccountId;
    const activeAccount = findAuthAccount(auth, activeAccountId);
    const currentAccount = findAuthAccount(auth, currentAccountId);

    dom.authAccountSelect.innerHTML = accounts.length
      ? accounts
        .map((account) => `<option value="${utils.escapeHtml(account.accountId)}">${utils.escapeHtml(formatAuthAccountSelectLabel(account))}</option>`)
        .join("")
      : '<option value="">默认账号</option>';
    dom.authAccountSelect.value = currentAccountId || "";

    if (!accounts.length) {
      dom.authAccountNote.textContent = "当前还没有独立账号槽位；首次检测到已登录账号后，系统会自动按账号邮箱建槽并归档认证文件。";
      return;
    }

    if (currentAccountId && currentAccountId !== activeAccountId && currentAccount) {
      dom.authAccountNote.textContent = `当前正在查看 ${formatAuthAccountDisplayName(currentAccount)}；默认账号是 ${formatAuthAccountDisplayName(activeAccount, activeAccountId)}。`;
      return;
    }

    dom.authAccountNote.textContent = `当前正在查看默认账号 ${formatAuthAccountDisplayName(activeAccount, activeAccountId)}。`;
  }

  function renderModeSwitchAuthAccountSelect(auth, draft) {
    const accounts = Array.isArray(auth.accounts) ? auth.accounts : [];
    const activeAccountId = normalizeAuthAccountId(auth.activeAccountId)
      || accounts.find((account) => account.isActive)?.accountId
      || accounts[0]?.accountId
      || "";
    const activeAccount = findAuthAccount(auth, activeAccountId);
    const followDefaultLabel = activeAccount
      ? `跟随默认账号（${formatAuthAccountSelectLabel(activeAccount)}）`
      : "跟随默认账号";

    dom.modeSwitchAuthAccountSelect.innerHTML = [
      `<option value="">${utils.escapeHtml(followDefaultLabel)}</option>`,
      ...accounts.map((account) => (
        `<option value="${utils.escapeHtml(account.accountId)}">${utils.escapeHtml(formatAuthAccountSelectLabel(account))}</option>`
      )),
    ].join("");
    dom.modeSwitchAuthAccountSelect.value = draft.authAccountId || "";
  }

  function renderAuthRateLimits(auth) {
    const showPanel = auth.status === "ready" && auth.authenticated;
    const rateLimits = auth.rateLimits;
    const creditsCopy = buildRateLimitCreditsCopy(rateLimits?.credits);

    dom.authRateLimitsPanel.classList.toggle("hidden", !showPanel);

    if (!showPanel) {
      resetAuthRateLimitCard({
        card: dom.authRateLimitPrimaryCard,
        label: dom.authRateLimitPrimaryLabel,
        remaining: dom.authRateLimitPrimaryRemaining,
        progress: dom.authRateLimitPrimaryProgress,
        fill: dom.authRateLimitPrimaryFill,
        reset: dom.authRateLimitPrimaryReset,
      }, "主额度窗口");
      resetAuthRateLimitCard({
        card: dom.authRateLimitSecondaryCard,
        label: dom.authRateLimitSecondaryLabel,
        remaining: dom.authRateLimitSecondaryRemaining,
        progress: dom.authRateLimitSecondaryProgress,
        fill: dom.authRateLimitSecondaryFill,
        reset: dom.authRateLimitSecondaryReset,
      }, "次额度窗口");
      dom.authRateLimitsPlan.classList.add("hidden");
      dom.authRateLimitsPlan.textContent = "";
      dom.authRateLimitsGrid.classList.add("hidden");
      dom.authRateLimitsEmpty.classList.add("hidden");
      dom.authRateLimitsCredits.classList.add("hidden");
      dom.authRateLimitsCredits.textContent = "";
      return;
    }

    const planLabel = formatPlanType(rateLimits?.planType || auth.account?.planType);
    dom.authRateLimitsPlan.classList.toggle("hidden", !planLabel);
    dom.authRateLimitsPlan.textContent = planLabel || "";

    const hasPrimary = renderAuthRateLimitCard({
      card: dom.authRateLimitPrimaryCard,
      label: dom.authRateLimitPrimaryLabel,
      remaining: dom.authRateLimitPrimaryRemaining,
      progress: dom.authRateLimitPrimaryProgress,
      fill: dom.authRateLimitPrimaryFill,
      reset: dom.authRateLimitPrimaryReset,
    }, rateLimits?.primary, "主额度窗口");
    const hasSecondary = renderAuthRateLimitCard({
      card: dom.authRateLimitSecondaryCard,
      label: dom.authRateLimitSecondaryLabel,
      remaining: dom.authRateLimitSecondaryRemaining,
      progress: dom.authRateLimitSecondaryProgress,
      fill: dom.authRateLimitSecondaryFill,
      reset: dom.authRateLimitSecondaryReset,
    }, rateLimits?.secondary, "次额度窗口");
    const hasWindows = hasPrimary || hasSecondary;

    dom.authRateLimitsGrid.classList.toggle("hidden", !hasWindows);
    dom.authRateLimitsEmpty.classList.toggle("hidden", hasWindows || Boolean(creditsCopy));
    dom.authRateLimitsEmpty.textContent = resolveAuthRateLimitsEmptyCopy(auth);
    dom.authRateLimitsCredits.classList.toggle("hidden", !creditsCopy);
    dom.authRateLimitsCredits.textContent = creditsCopy;
  }

  function renderAuthRateLimitCard(elements, rateLimitWindow, fallbackLabel) {
    if (!rateLimitWindow?.windowDurationMins) {
      resetAuthRateLimitCard(elements, fallbackLabel);
      return false;
    }

    const remainingPercent = calculateRemainingPercent(rateLimitWindow.usedPercent);
    const level = resolveRateLimitLevel(remainingPercent);

    elements.card.classList.remove("hidden");
    elements.card.dataset.level = level;
    elements.label.textContent = formatRateLimitWindowLabel(rateLimitWindow.windowDurationMins, fallbackLabel);
    elements.remaining.textContent = `${remainingPercent}%`;
    elements.progress.setAttribute("aria-valuenow", String(remainingPercent));
    elements.fill.style.width = `${remainingPercent}%`;
    elements.reset.textContent = formatRateLimitResetText(rateLimitWindow.resetsAt);
    return true;
  }

  function resetAuthRateLimitCard(elements, fallbackLabel) {
    elements.card.classList.add("hidden");
    elements.card.dataset.level = "healthy";
    elements.label.textContent = fallbackLabel;
    elements.remaining.textContent = "0%";
    elements.progress.setAttribute("aria-valuenow", "0");
    elements.fill.style.width = "0%";
    elements.reset.textContent = "重置时间待确认";
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
      .map((turn, index) => renderTurnMarkup(turn, index + 1, { thread, store, utils }))
      .join("");

    if (scrollToBottom) {
      utils.scrollConversationToBottom(dom.conversation);
    }
  }

  function renderComposer() {
    const thread = store.getActiveThread();
    const actionBarState = store.resolveComposerActionBarState(thread);
    const effectiveComposerMode = resolveEffectiveComposerMode(actionBarState);
    dom.goalInput.value = mergeComposerDraft(thread);
    dom.goalInput.placeholder = COMPOSER_PLACEHOLDERS[effectiveComposerMode] ?? DEFAULT_COMPOSER_PLACEHOLDER;
    dom.submitButton.textContent = COMPOSER_SUBMIT_LABELS[effectiveComposerMode] ?? COMPOSER_SUBMIT_LABELS.chat;
    if (dom.composerActionBar) {
      dom.composerActionBar.innerHTML = renderComposerActionBarMarkup({
        ...actionBarState,
        mode: effectiveComposerMode,
      }, utils);
    }
    if (dom.composerInputAssetsList) {
      dom.composerInputAssetsList.innerHTML = renderDraftInputAssetsMarkup(thread?.draftInputAssets, utils);
    }
    utils.autoResizeTextarea(dom.goalInput);
    renderComposerAuthNote();
  }

  function renderComposerAuthNote() {
    const thread = store.getActiveThread();
    const auth = app.runtime.auth;
    const settings = thread?.settings ?? store.createDefaultThreadSettings();
    const transientMessage = thread ? store.resolveTransientStatus(thread.id) : "";
    const runningThreadId = store.getRunningThreadId();
    const pendingInterruptMessage = buildPendingInterruptNote({
      activeThread: thread,
      pendingInterruptSubmit: app.runtime.pendingInterruptSubmit,
    });
    const runningMessage = buildComposerRunNote({
      activeThread: thread,
      runningThread: runningThreadId ? store.getThreadById(runningThreadId) : null,
    });
    const authMessage = buildComposerAuthNote({
      auth,
      settings,
      accessMode: store.resolveAccessMode(settings),
      thirdPartySelection: store.resolveThirdPartySelection(settings),
      effectiveSettings: store.resolveEffectiveSettings(settings),
    });
    const message = [
      transientMessage,
      pendingInterruptMessage,
      runningMessage,
      authMessage,
    ].filter(Boolean).join(" ");
    const visible = Boolean(message);

    dom.composerAuthNote.classList.toggle("hidden", !visible);
    dom.composerAuthNote.textContent = visible ? message : "";
  }

  function renderComposerMeta() {
    const thread = store.getActiveThread();
    dom.activeThreadLabel.textContent = `会话：${thread?.title ?? "新会话"}`;
  }

  function syncBusyState() {
    const activeThread = store.getActiveThread();
    const runBusy = store.isBusy();
    const cancellableRunBusy = Boolean(app.runtime.activeRequestController && app.runtime.activeRunRef);
    const restoredActionHydrating = Boolean(app.runtime.restoredActionHydrationThreadId);
    const settings = activeThread?.settings ?? store.createDefaultThreadSettings();
    const effectiveSettings = store.resolveEffectiveSettings(settings);
    const accessMode = store.resolveAccessMode(settings);
    const thirdPartySelection = store.resolveThirdPartySelection(settings);
    const modeSwitchDraft = app.modeSwitch.getDraft(settings);
    const thirdPartyEditor = app.runtime.thirdPartyEditor;
    const workspaceLocked = isWorkspaceLocked(activeThread);
    const authMissing = accessMode === "auth" && requiresAuthentication(app.runtime.auth);
    const thirdPartyUnavailable = accessMode === "third-party"
      && (
        !thirdPartySelection.provider
        || !thirdPartySelection.model
        || thirdPartySelection.model.supportsCodexTasks === false
      );
    const controlsBusy = app.runtime.sessionControlBusy || app.runtime.authBusy;
    const editorBusy = controlsBusy || thirdPartyEditor.submitting;

    dom.submitButton.disabled = app.runtime.sessionControlBusy
      || restoredActionHydrating
      || authMissing
      || thirdPartyUnavailable
      || (accessMode === "auth" && app.runtime.auth.status === "loading");
    dom.cancelButton.disabled = !cancellableRunBusy;
    dom.forkThreadButton.disabled = app.runtime.sessionControlBusy || runBusy;
    dom.resetPrincipalButton.disabled = controlsBusy || runBusy;
    dom.newThreadButton.disabled = app.runtime.sessionControlBusy;
    dom.workspaceToolsToggle.disabled = false;
    dom.workspaceToolsClose.disabled = false;
    dom.threadSearchInput.disabled = app.runtime.sessionControlBusy && !app.runtime.threadSearchQuery;
    dom.goalInput.disabled = app.runtime.sessionControlBusy;
    dom.modelSelect.disabled = controlsBusy
      || !store.getVisibleModels(store.getActiveThread()?.settings).length
      || Boolean(app.runtime.runtimeConfig.provider?.lockedModel);
    dom.assistantLanguageStyleInput.disabled = controlsBusy || app.runtime.identity?.savingPersona;
    dom.assistantMbtiInput.disabled = controlsBusy || app.runtime.identity?.savingPersona;
    dom.assistantStyleNotesInput.disabled = controlsBusy || app.runtime.identity?.savingPersona;
    dom.assistantSoulInput.disabled = controlsBusy || app.runtime.identity?.savingPersona;
    dom.reasoningSelect.disabled = controlsBusy;
    dom.approvalSelect.disabled = controlsBusy || app.runtime.identity?.savingTaskSettings;
    dom.sandboxSelect.disabled = controlsBusy || app.runtime.identity?.savingTaskSettings;
    dom.webSearchSelect.disabled = controlsBusy || app.runtime.identity?.savingTaskSettings;
    dom.networkAccessSelect.disabled = controlsBusy
      || app.runtime.identity?.savingTaskSettings
      || effectiveSettings.sandboxMode === "read-only"
      || effectiveSettings.sandboxMode === "danger-full-access";
    dom.threadControlJoinToggle.disabled = controlsBusy;
    dom.conversationLinkInput.disabled = controlsBusy;
    dom.conversationLinkButton.disabled = controlsBusy;
    dom.identityLinkCodeButton.disabled = controlsBusy || app.runtime.identity?.issuing;
    dom.skillsLocalPathInput.disabled = controlsBusy || app.runtime.skills.loading || app.runtime.skills.installing || app.runtime.skills.syncing;
    dom.skillsGithubUrlInput.disabled = controlsBusy || app.runtime.skills.loading || app.runtime.skills.installing || app.runtime.skills.syncing;
    dom.skillsGithubUrlRefInput.disabled = controlsBusy || app.runtime.skills.loading || app.runtime.skills.installing || app.runtime.skills.syncing;
    dom.skillsGithubRepoInput.disabled = controlsBusy || app.runtime.skills.loading || app.runtime.skills.installing || app.runtime.skills.syncing;
    dom.skillsGithubPathInput.disabled = controlsBusy || app.runtime.skills.loading || app.runtime.skills.installing || app.runtime.skills.syncing;
    dom.skillsGithubRepoRefInput.disabled = controlsBusy || app.runtime.skills.loading || app.runtime.skills.installing || app.runtime.skills.syncing;
    dom.skillsInstallLocalButton.disabled = controlsBusy
      || app.runtime.skills.loading
      || app.runtime.skills.installing
      || app.runtime.skills.syncing;
    dom.skillsInstallGithubUrlButton.disabled = controlsBusy
      || app.runtime.skills.loading
      || app.runtime.skills.installing
      || app.runtime.skills.syncing;
    dom.skillsInstallGithubRepoButton.disabled = controlsBusy
      || app.runtime.skills.loading
      || app.runtime.skills.installing
      || app.runtime.skills.syncing;
    dom.skillsRefreshButton.disabled = controlsBusy || app.runtime.skills.loading || app.runtime.skills.installing || app.runtime.skills.syncing;
    dom.skillsPanelActions?.querySelectorAll("[data-skill-action]").forEach((button) => {
      const installed = button.dataset.skillInstalled === "true";
      button.disabled = controlsBusy
        || app.runtime.skills.loading
        || app.runtime.skills.installing
        || app.runtime.skills.syncing
        || (button.dataset.skillAction === "install-curated" && installed);
    });
    const mcpBusy = controlsBusy || app.runtime.mcp.loading || app.runtime.mcp.mutating;
    dom.mcpServerNameInput.disabled = mcpBusy || dom.mcpServerNameInput.dataset.locked === "true";
    dom.mcpCommandInput.disabled = mcpBusy;
    dom.mcpArgsInput.disabled = mcpBusy;
    dom.mcpCwdInput.disabled = mcpBusy;
    dom.mcpEnvInput.disabled = mcpBusy;
    dom.mcpEnabledInput.disabled = mcpBusy;
    dom.mcpSaveButton.disabled = mcpBusy;
    dom.mcpResetButton.disabled = mcpBusy;
    dom.mcpRefreshButton.disabled = mcpBusy;
    dom.mcpPanelActions?.querySelectorAll("[data-mcp-action]").forEach((button) => {
      button.disabled = mcpBusy;
    });
    const pluginsBusy = controlsBusy || app.runtime.plugins.loading || app.runtime.plugins.mutating;
    dom.pluginsRefreshButton.disabled = pluginsBusy;
    dom.pluginsRemoteSyncButton.disabled = pluginsBusy;
    dom.pluginsPanelActions?.querySelectorAll("[data-plugin-action]").forEach((button) => {
      button.disabled = pluginsBusy;
    });
    dom.accessModeSelect.disabled = controlsBusy || !app.runtime.runtimeConfig.accessModes?.length;
    dom.modeSwitchAuthAccountSelect.disabled = controlsBusy
      || app.runtime.identity?.savingTaskSettings
      || modeSwitchDraft.accessMode !== "auth"
      || !app.runtime.auth.accounts.length;
    dom.sessionWorkspaceInput.disabled = controlsBusy || runBusy || workspaceLocked;
    dom.sessionWorkspaceApplyButton.disabled = controlsBusy || runBusy || workspaceLocked;
    dom.accessModeApplyButton.disabled = controlsBusy
      || !modeSwitchDraft.dirty
      || (
        modeSwitchDraft.accessMode === "third-party"
        && (
          !thirdPartySelection.provider
          || !modeSwitchDraft.thirdPartyModel
        )
      );
    dom.thirdPartyAddProviderButton.disabled = editorBusy;
    dom.thirdPartyAddModelButton.disabled = editorBusy || !store.getThirdPartyProviders().length;
    dom.thirdPartyProviderSelect.disabled = controlsBusy || !store.getThirdPartyProviders().length;
    dom.thirdPartyEndpointProbeButton.disabled = controlsBusy
      || app.runtime.thirdPartyEndpointProbe.status === "loading"
      || !thirdPartySelection.provider;
    dom.thirdPartyModelSelect.disabled = controlsBusy || !thirdPartySelection.provider || !store.getThirdPartyModels(settings).length;
    dom.thirdPartyProbeButton.disabled = controlsBusy
      || app.runtime.thirdPartyProbe.status === "loading"
      || !thirdPartySelection.provider
      || !thirdPartySelection.model;
    dom.thirdPartyProbeApplyButton.disabled = controlsBusy
      || app.runtime.thirdPartyProbe.persistStatus === "saving"
      || !thirdPartySelection.provider
      || !thirdPartySelection.model
      || !["supported", "unsupported"].includes(app.runtime.thirdPartyProbe.status);
    dom.modeSwitchThirdPartyModelSelect.disabled = controlsBusy
      || modeSwitchDraft.accessMode !== "third-party"
      || !thirdPartySelection.provider
      || !store.getThirdPartyModels(settings).length;
    dom.thirdPartyEditorClose.disabled = thirdPartyEditor.submitting;
    dom.thirdPartyProviderIdInput.disabled = editorBusy;
    dom.thirdPartyProviderNameInput.disabled = editorBusy;
    dom.thirdPartyProviderBaseUrlInput.disabled = editorBusy;
    dom.thirdPartyProviderApiKeyInput.disabled = editorBusy;
    dom.thirdPartyProviderEndpointCandidatesInput.disabled = editorBusy;
    dom.thirdPartyProviderWireApiSelect.disabled = editorBusy;
    dom.thirdPartyProviderWebsocketInput.disabled = editorBusy;
    dom.thirdPartyProviderSubmitButton.disabled = editorBusy;
    dom.thirdPartyProviderCancelButton.disabled = thirdPartyEditor.submitting;
    dom.thirdPartyModelProviderSelect.disabled = editorBusy || !store.getThirdPartyProviders().length;
    dom.thirdPartyModelIdInput.disabled = editorBusy;
    dom.thirdPartyModelDisplayNameInput.disabled = editorBusy;
    dom.thirdPartyModelDefaultReasoningSelect.disabled = editorBusy;
    dom.thirdPartyModelContextWindowInput.disabled = editorBusy;
    dom.thirdPartyModelDescriptionInput.disabled = editorBusy;
    dom.thirdPartyModelSupportsCodexInput.disabled = editorBusy;
    dom.thirdPartyModelImageInput.disabled = editorBusy;
    dom.thirdPartyModelSearchInput.disabled = editorBusy;
    dom.thirdPartyModelParallelToolsInput.disabled = editorBusy;
    dom.thirdPartyModelVerbosityInput.disabled = editorBusy;
    dom.thirdPartyModelReasoningSummaryInput.disabled = editorBusy;
    dom.thirdPartyModelImageDetailInput.disabled = editorBusy;
    dom.thirdPartyModelDefaultInput.disabled = editorBusy;
    dom.thirdPartyModelSubmitButton.disabled = editorBusy || !store.getThirdPartyProviders().length;
    dom.thirdPartyModelCancelButton.disabled = thirdPartyEditor.submitting;
    dom.authChatgptLoginButton.disabled = controlsBusy;
    dom.authChatgptDeviceLoginButton.disabled = controlsBusy;
    dom.authAccountSelect.disabled = controlsBusy || !app.runtime.auth.accounts.length;
    dom.authAccountActivateButton.disabled = controlsBusy
      || !app.runtime.auth.accounts.length
      || app.runtime.auth.currentAccountId === app.runtime.auth.activeAccountId;
    dom.authAccountCreateInput.disabled = controlsBusy;
    dom.authAccountCreateButton.disabled = controlsBusy;
    dom.authDeviceLoginCopyButton.disabled = controlsBusy
      || app.runtime.auth.pendingLogin?.mode !== "device"
      || !app.runtime.auth.pendingLogin?.userCode;
    dom.authLogoutButton.disabled = controlsBusy || !app.runtime.auth.authenticated;
    dom.authLoginCancelButton.disabled = controlsBusy || !app.runtime.auth.pendingLogin;
    dom.authApiKeyInput.disabled = controlsBusy;
    dom.authApiKeyButton.disabled = controlsBusy;
  }

  function setToolsPanelOpen(nextOpen, nextSection = "") {
    app.runtime.workspaceToolsOpen = Boolean(nextOpen);
    if (nextSection) {
      app.runtime.workspaceToolsSection = resolveWorkspaceToolsSection(nextSection);
    }
    renderWorkspaceTools();
  }

  function setToolsPanelSection(nextSection) {
    app.runtime.workspaceToolsSection = resolveWorkspaceToolsSection(nextSection);
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

  function resolveEffectiveComposerMode(actionBarState) {
    const mode = actionBarState?.mode;

    if (mode === "review" && actionBarState.review?.enabled) {
      return "review";
    }

    if (mode === "steer" && actionBarState.steer?.enabled) {
      return "steer";
    }

    return "chat";
  }

  function renderIdentityState() {
    const identity = app.runtime.identity;
    const browserUserId = identity?.browserUserId || "";
    const principalId = identity?.principalId || "";
    const principalDisplayName = identity?.principalDisplayName || "";
    const linkCode = identity?.linkCode || "";
    const expiresAt = identity?.linkCodeExpiresAt || "";
    const errorMessage = identity?.errorMessage || "";

    dom.identityBrowserNote.textContent = browserUserId
      ? `当前浏览器身份：${browserUserId}`
      : "当前浏览器身份：尚未初始化";

    if (principalId) {
      dom.identityPrincipalNote.textContent = principalDisplayName
        ? `当前 principal：${principalId}（${principalDisplayName}）`
        : `当前 principal：${principalId}`;
    } else if (identity?.status === "loading") {
      dom.identityPrincipalNote.textContent = "当前 principal：正在读取";
    } else if (errorMessage) {
      dom.identityPrincipalNote.textContent = `当前 principal：读取失败，${errorMessage}`;
    } else {
      dom.identityPrincipalNote.textContent = "当前 principal：尚未建立";
    }

    if (linkCode) {
      dom.identityLinkCode.classList.remove("hidden");
      dom.identityLinkCode.textContent = expiresAt
        ? `绑定码：${linkCode}｜有效期至 ${formatIdentityTime(expiresAt)}`
        : `绑定码：${linkCode}`;
      dom.identityLinkNote.textContent = `默认一般不需要绑定码；如果你要认领旧浏览器身份，可到飞书发送 \`/link ${linkCode}\`。`;
      return;
    }

    dom.identityLinkCode.classList.add("hidden");
    dom.identityLinkCode.textContent = "";
    dom.identityLinkNote.textContent = "默认情况下 Web 和飞书已经共享同一私人助理 principal；只有认领旧浏览器身份时，才需要 `/link 绑定码`。";
  }

  function renderAgentsState() {
    const agentsState = app.runtime.agents ?? {};
    const compatibilityStatus = normalizeAgentsCompatibilityStatusState(agentsState.compatibilityStatus);
    const statusMessage = resolveAgentsStatusMessage(agentsState);
    const busy = Boolean(agentsState.loading);

    dom.agentsStatusNote.classList.toggle("hidden", !statusMessage);
    dom.agentsStatusNote.textContent = statusMessage;
    if (statusMessage) {
      dom.agentsStatusNote.dataset.state = agentsState.errorMessage
        ? "error"
        : busy
          ? "loading"
          : agentsState.noticeMessage
            ? "supported"
            : compatibilityStatus?.statusLevel === "error"
              ? "error"
              : compatibilityStatus
                ? "warning"
                : "supported";
    } else {
      delete dom.agentsStatusNote.dataset.state;
    }

    syncAgentsPlatformEntry(dom, compatibilityStatus);
    if (dom.agentsRefreshButton) {
      dom.agentsRefreshButton.disabled = busy;
      dom.agentsRefreshButton.textContent = busy ? "刷新中..." : "刷新入口状态";
    }
  }

  return {
    renderAll,
    renderComposer,
    renderConversation,
    renderThreadList,
    renderThreadControlPanel,
    renderWorkspaceTools,
    renderAgentsState,
    setToolsPanelOpen,
    setToolsPanelSection,
  };
}

function resolveAgentsStatusMessage(agentsState) {
  const compatibilityStatus = normalizeAgentsCompatibilityStatusState(agentsState.compatibilityStatus);

  if (agentsState.errorMessage) {
    return agentsState.errorMessage;
  }

  if (agentsState.loading) {
    return "正在读取 Platform 兼容入口状态。";
  }

  if (agentsState.creating) {
    return "正在创建新的持久化 agent。";
  }

  if (agentsState.detailLoading) {
    return "正在读取当前 agent 的任务和内部信箱。";
  }

  if (agentsState.dispatching) {
    return "正在提交派工。";
  }

  if (agentsState.updatingSpawnPolicy) {
    return "正在更新当前组织的自动创建护栏。";
  }

  if (agentsState.approvingSpawnSuggestionId) {
    return "正在按建议创建新的长期 agent。";
  }

  if (agentsState.approvingIdleRecoverySuggestionId) {
    return "正在批准当前空闲回收建议。";
  }

  if (agentsState.ignoringSpawnSuggestionId) {
    return "正在忽略当前自动创建建议。";
  }

  if (agentsState.rejectingSpawnSuggestionId) {
    return "正在拒绝当前自动创建建议。";
  }

  if (agentsState.restoringSpawnSuggestionId) {
    return "正在恢复被忽略或拒绝的自动创建建议。";
  }

  if (agentsState.workItemDetailLoading) {
    return "正在读取 work item 详情。";
  }

  if (agentsState.cancelingWorkItemId) {
    return "正在取消当前 work item。";
  }

  if (agentsState.lifecycleUpdatingAgentId) {
    return resolveAgentLifecycleStatusMessage(agentsState.lifecycleUpdatingAction);
  }

  if (agentsState.escalatingWorkItemId) {
    return "正在把等待中的 agent 阻塞升级到顶层治理。";
  }

  if (agentsState.ackingMailboxEntryId) {
    return "正在确认内部消息。";
  }

  if (agentsState.noticeMessage) {
    return agentsState.noticeMessage;
  }

  if (compatibilityStatus?.message) {
    return compatibilityStatus.message;
  }

  return "";
}

function normalizeAgentsCompatibilityStatusState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const accessMode = typeof value.accessMode === "string" ? value.accessMode : "gateway_required";
  const statusLevel = value.statusLevel === "error" ? "error" : "warning";
  const message = typeof value.message === "string" ? value.message : "";
  const platformBaseUrl = typeof value.platformBaseUrl === "string" ? value.platformBaseUrl : "";
  const ownerPrincipalId = typeof value.ownerPrincipalId === "string" ? value.ownerPrincipalId : "";

  if (value.panelOwnership !== "platform") {
    return null;
  }

  return {
    panelOwnership: "platform",
    accessMode: ["platform_gateway", "gateway_required", "invalid_gateway_config"].includes(accessMode)
      ? accessMode
      : "gateway_required",
    statusLevel,
    message: message.trim(),
    platformBaseUrl: platformBaseUrl.trim(),
    ownerPrincipalId: ownerPrincipalId.trim(),
  };
}

function syncAgentsPlatformEntry(dom, compatibilityStatus) {
  if (!dom.agentsOpenPlatformLink || !dom.agentsOpenPlatformNote) {
    return;
  }

  const platformHomeUrl = resolveAgentsPlatformHomeUrl(compatibilityStatus);
  const directLinkAvailable = Boolean(platformHomeUrl);
  dom.agentsOpenPlatformLink.href = directLinkAvailable ? platformHomeUrl : "#";
  dom.agentsOpenPlatformLink.classList.toggle("disabled", !directLinkAvailable);
  dom.agentsOpenPlatformLink.setAttribute("aria-disabled", directLinkAvailable ? "false" : "true");
  dom.agentsOpenPlatformLink.tabIndex = directLinkAvailable ? 0 : -1;
  dom.agentsOpenPlatformNote.textContent = resolveAgentsPlatformEntryNote(compatibilityStatus, platformHomeUrl);
}

function resolveAgentsPlatformHomeUrl(compatibilityStatus) {
  if (!compatibilityStatus?.platformBaseUrl) {
    return "";
  }

  const baseUrl = compatibilityStatus.platformBaseUrl.trim();

  if (!baseUrl) {
    return "";
  }

  try {
    const platformUrl = new URL(baseUrl);
    const ownerPrincipalId = typeof compatibilityStatus.ownerPrincipalId === "string"
      ? compatibilityStatus.ownerPrincipalId.trim()
      : "";

    if (ownerPrincipalId) {
      platformUrl.searchParams.set("ownerPrincipalId", ownerPrincipalId);
    }

    return platformUrl.toString();
  } catch {
    return baseUrl;
  }
}

function resolveAgentsPlatformEntryNote(compatibilityStatus, platformHomeUrl) {
  if (platformHomeUrl) {
    return `当前主 Themis 只保留独立 Platform 页面的跳转入口：${platformHomeUrl}。后续平台治理请直接在那里完成。`;
  }

  if (compatibilityStatus?.accessMode === "gateway_required") {
    return "主 Themis 已不再托管这个平台治理面；请先配置平台 gateway，或直接切到独立 themis-platform 页面。";
  }

  if (compatibilityStatus?.accessMode === "invalid_gateway_config") {
    return "当前平台 Gateway 配置异常，兼容入口暂时只能展示状态，无法生成独立 Platform 页面入口。";
  }

  return "已配置平台上游后，这里会给出独立 Platform 页面的直达入口。";
}

function resolveSkillsStatusMessage(skillsState) {
  if (skillsState.errorMessage) {
    return skillsState.errorMessage;
  }

  if (skillsState.installing) {
    return "正在安装 skill，并同步到全部受管认证账号槽位。";
  }

  if (skillsState.syncing) {
    return "正在重同步或删除 skill，请稍候。";
  }

  if (skillsState.loading) {
    return "正在读取当前 principal 的 skills 与 curated 列表。";
  }

  if (skillsState.noticeMessage) {
    return skillsState.noticeMessage;
  }

  return "";
}

function resolveMcpStatusMessage(mcpState) {
  if (mcpState.errorMessage) {
    return mcpState.errorMessage;
  }

  if (mcpState.mutating && mcpState.busyMessage) {
    return mcpState.busyMessage;
  }

  if (mcpState.loading) {
    return "正在读取当前 principal 的 MCP 列表。";
  }

  if (mcpState.noticeMessage) {
    return mcpState.noticeMessage;
  }

  return "";
}

function resolvePluginsStatusMessage(pluginsState) {
  if (pluginsState.errorMessage) {
    return pluginsState.errorMessage;
  }

  if (pluginsState.mutating && pluginsState.busyMessage) {
    return pluginsState.busyMessage;
  }

  if (pluginsState.loading) {
    return "正在读取当前 principal 的 plugins 和当前环境可发现的 marketplaces。";
  }

  if (pluginsState.noticeMessage) {
    return pluginsState.noticeMessage;
  }

  if (pluginsState.remoteSyncError) {
    return `远程同步失败：${pluginsState.remoteSyncError}`;
  }

  const loadErrorCount = Array.isArray(pluginsState.marketplaceLoadErrors)
    ? pluginsState.marketplaceLoadErrors.length
    : 0;

  if (loadErrorCount > 0) {
    return `当前有 ${loadErrorCount} 个 marketplace 读取失败，可先刷新确认。`;
  }

  return "";
}

function renderSkillCard(skill, options) {
  const busyAttr = options.busy ? " disabled" : "";
  const summary = skill.summary ?? {};
  const totalAccounts = typeof summary.totalAccounts === "number" ? summary.totalAccounts : 0;
  const syncedCount = typeof summary.syncedCount === "number" ? summary.syncedCount : 0;
  const materializations = Array.isArray(skill.materializations) ? skill.materializations : [];
  const summaryCopy = totalAccounts > 0
    ? `已同步 ${syncedCount} / ${totalAccounts} 个账号槽位`
    : "当前还没有受管认证账号槽位";
  const materializationMarkup = materializations.length
    ? `<div class="skill-materialization-list">${materializations.map((item) => {
      const syncedAt = item.lastSyncedAt
        ? `｜${options.escapeHtml(options.formatRelativeTime(item.lastSyncedAt))}`
        : "";
      const errorCopy = item.lastError
        ? `<span class="skill-materialization-error">${options.escapeHtml(item.lastError)}</span>`
        : "";

      return `
        <div class="skill-materialization-item">
          <span>${options.escapeHtml(item.targetId || "未命名账号")}</span>
          <span class="skill-materialization-state" data-state="${options.escapeHtml(item.state || "missing")}">
            ${options.escapeHtml(formatMaterializationStateLabel(item.state))}
          </span>
          <span class="skill-materialization-time">${options.escapeHtml(syncedAt ? syncedAt.slice(1) : "待同步")}</span>
          ${errorCopy}
        </div>
      `;
    }).join("")}</div>`
    : "";
  const errorMarkup = skill.lastError
    ? `<p class="skill-card-error">${options.escapeHtml(skill.lastError)}</p>`
    : "";

  return `
    <article class="skill-card">
      <div class="skill-card-head">
        <div>
          <h4>${options.escapeHtml(skill.skillName)}</h4>
          <p class="skill-card-copy">${options.escapeHtml(skill.description || "暂无描述")}</p>
        </div>
        <div class="skill-card-actions">
          <button
            type="button"
            class="toolbar-button subtle"
            data-mcp-action="oauth"
            data-mcp-server-name="${options.escapeHtml(server.serverName || "")}"${busyAttr}
          >OAuth</button>
          <button
            type="button"
            class="toolbar-button subtle"
            data-skill-action="sync"
            data-skill-name="${options.escapeHtml(skill.skillName)}"${busyAttr}
          >重同步</button>
          <button
            type="button"
            class="ghost-button"
            data-skill-action="remove"
            data-skill-name="${options.escapeHtml(skill.skillName)}"${busyAttr}
          >删除</button>
        </div>
      </div>
      <div class="skill-pill-row">
        <span class="skill-pill">${options.escapeHtml(formatSkillSourceLabel(skill.sourceType))}</span>
        <span class="skill-pill" data-tone="${options.escapeHtml(skill.installStatus || "ready")}">
          ${options.escapeHtml(formatInstallStatusLabel(skill.installStatus))}
        </span>
      </div>
      <p class="skill-card-summary">${options.escapeHtml(summaryCopy)}</p>
      ${errorMarkup}
      ${materializationMarkup}
    </article>
  `;
}

function renderCuratedSkillCard(item, options) {
  const disabled = options.busy || item.installed;

  return `
    <article class="skill-card skill-card-curated">
      <div class="skill-card-head">
        <div>
          <h4>${options.escapeHtml(item.name)}</h4>
          <p class="skill-card-copy">来自 OpenAI curated skills，可直接安装到当前 principal。</p>
        </div>
        <div class="skill-card-actions">
          <span class="skill-pill"${item.installed ? ' data-tone="ready"' : ""}>
            ${options.escapeHtml(item.installed ? "已安装" : "未安装")}
          </span>
          <button
            type="button"
            class="toolbar-button subtle"
            data-skill-action="install-curated"
            data-skill-name="${options.escapeHtml(item.name)}"
            data-skill-installed="${item.installed ? "true" : "false"}"${disabled ? " disabled" : ""}
          >${options.escapeHtml(item.installed ? "已安装" : "安装")}</button>
        </div>
      </div>
    </article>
  `;
}

function renderMcpCard(server, options) {
  const busyAttr = options.busy ? " disabled" : "";
  const materializations = Array.isArray(server.materializations) ? server.materializations : [];
  const summary = server.summary ?? {};
  const totalTargets = typeof summary.totalTargets === "number" ? summary.totalTargets : 0;
  const readyCount = typeof summary.readyCount === "number" ? summary.readyCount : 0;
  const authRequiredCount = typeof summary.authRequiredCount === "number" ? summary.authRequiredCount : 0;
  const failedCount = typeof summary.failedCount === "number" ? summary.failedCount : 0;
  const args = Array.isArray(server.args) ? server.args : [];
  const env = server.env && typeof server.env === "object" ? server.env : {};
  const commandCopy = [server.command, ...args]
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .join(" ");
  const summaryCopy = totalTargets > 0
    ? `当前有 ${totalTargets} 个运行槽位记录，已就绪 ${readyCount} 个，待认证 ${authRequiredCount} 个，失败 ${failedCount} 个。`
    : "当前还没有 runtime 槽位状态记录。";
  const cwdMarkup = server.cwd
    ? `<p class="skill-card-copy">cwd：<code>${options.escapeHtml(server.cwd)}</code></p>`
    : "";
  const envMarkup = Object.keys(env).length > 0
    ? `<p class="skill-card-copy">env keys：${options.escapeHtml(Object.keys(env).join(", "))}</p>`
    : "";
  const materializationMarkup = materializations.length
    ? `<div class="skill-materialization-list">${materializations.map((item) => {
      const syncedAt = item.lastSyncedAt
        ? options.formatRelativeTime(item.lastSyncedAt)
        : "待同步";
      const authLabel = formatMcpAuthStateLabel(item.authState);
      const errorCopy = item.lastError
        ? `<span class="skill-materialization-error">${options.escapeHtml(item.lastError)}</span>`
        : "";

      return `
        <div class="skill-materialization-item">
          <span>${options.escapeHtml(item.targetId || "未命名槽位")}</span>
          <span class="skill-materialization-state" data-state="${options.escapeHtml(item.state || "missing")}">
            ${options.escapeHtml(formatMaterializationStateLabel(item.state))}
          </span>
          <span class="skill-materialization-time">${options.escapeHtml(`${authLabel}｜${syncedAt}`)}</span>
          ${errorCopy}
        </div>
      `;
    }).join("")}</div>`
    : "";

  return `
    <article class="skill-card">
      <div class="skill-card-head">
        <div>
          <h4>${options.escapeHtml(server.serverName || "未命名 MCP")}</h4>
          <p class="skill-card-copy"><code>${options.escapeHtml(commandCopy || server.command || "")}</code></p>
          ${cwdMarkup}
          ${envMarkup}
        </div>
        <div class="skill-card-actions">
          <button
            type="button"
            class="toolbar-button subtle"
            data-mcp-action="edit"
            data-mcp-server-name="${options.escapeHtml(server.serverName || "")}"${busyAttr}
          >编辑</button>
          <button
            type="button"
            class="toolbar-button subtle"
            data-mcp-action="${server.enabled === false ? "enable" : "disable"}"
            data-mcp-server-name="${options.escapeHtml(server.serverName || "")}"${busyAttr}
          >${options.escapeHtml(server.enabled === false ? "启用" : "停用")}</button>
          <button
            type="button"
            class="ghost-button"
            data-mcp-action="remove"
            data-mcp-server-name="${options.escapeHtml(server.serverName || "")}"${busyAttr}
          >删除</button>
        </div>
      </div>
      <div class="skill-pill-row">
        <span class="skill-pill">${options.escapeHtml(formatMcpSourceLabel(server.sourceType))}</span>
        <span class="skill-pill"${server.enabled === false ? "" : ' data-tone="ready"'}>
          ${options.escapeHtml(server.enabled === false ? "已停用" : "已启用")}
        </span>
      </div>
      <p class="skill-card-summary">${options.escapeHtml(summaryCopy)}</p>
      ${materializationMarkup}
    </article>
  `;
}

function renderPluginMarketplaceCard(marketplace, options) {
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const displayName = marketplace.interface?.displayName || marketplace.name || "未命名 marketplace";
  const marketplacePath = marketplace.path || "";

  return `
    <article class="skill-card">
      <div class="skill-card-head">
        <div>
          <h4>${options.escapeHtml(displayName)}</h4>
          <p class="skill-card-copy"><code>${options.escapeHtml(marketplacePath)}</code></p>
        </div>
        <div class="skill-card-actions">
          <span class="skill-pill">${options.escapeHtml(`${plugins.length} 个 plugins`)}</span>
        </div>
      </div>
      <div class="settings-stack">
        ${plugins.length > 0
          ? plugins.map((plugin) => renderPluginCard(plugin, marketplace, options)).join("")
          : '<p class="skill-card-summary">当前 marketplace 没有可见 plugin。</p>'}
      </div>
    </article>
  `;
}

function renderPrincipalPluginsSection(principalPlugins, options) {
  return `
    <article class="skill-card">
      <div class="skill-card-head">
        <div>
          <h4>当前 Principal</h4>
          <p class="skill-card-copy">这些 plugin 归主人本人所有；当前环境只决定它们此刻能不能用。</p>
        </div>
        <div class="skill-card-actions">
          <span class="skill-pill" data-tone="ready">${options.escapeHtml(`${principalPlugins.length} 个已拥有`)}</span>
        </div>
      </div>
      <div class="settings-stack">
        ${principalPlugins.map((plugin) => renderPrincipalPluginCard(plugin, options)).join("")}
      </div>
    </article>
  `;
}

function renderPluginDiscoverySection(marketplaces, options) {
  return `
    <article class="skill-card">
      <div class="skill-card-head">
        <div>
          <h4>当前环境发现</h4>
          <p class="skill-card-copy">这里展示当前 runtime / 工作区下能发现到的 marketplace 和 plugin 候选。</p>
        </div>
      </div>
      <div class="settings-stack">
        ${marketplaces.map((marketplace) => renderPluginMarketplaceCard(marketplace, options)).join("")}
      </div>
    </article>
  `;
}

function renderPrincipalPluginCard(plugin, options) {
  return renderPluginCard({
    ...plugin.summary,
    sourceType: plugin.sourceType || plugin.summary.sourceType,
    sourceScope: plugin.sourceScope || plugin.summary.sourceScope,
    sourcePath: plugin.sourcePath || plugin.summary.sourcePath,
    sourceRef: plugin.sourceRef || plugin.summary.sourceRef || null,
    lastError: plugin.lastError || plugin.summary.lastError || "",
    repairAction: plugin.repairAction || plugin.summary.repairAction || "none",
    repairHint: plugin.repairHint || plugin.summary.repairHint || "",
    currentMaterialization: plugin.currentMaterialization || null,
  }, {
    path: plugin.marketplacePath,
    name: plugin.marketplaceName,
    interface: {
      displayName: plugin.marketplaceName,
    },
  }, {
    ...options,
    hideFeatured: true,
  });
}

function renderPluginCard(plugin, marketplace, options) {
  const pluginId = plugin.id || plugin.name || "";
  const pluginName = plugin.name || pluginId || "未命名 plugin";
  const pluginKey = createPluginCardKey(marketplace.path, pluginId || pluginName);
  const detail = pluginKey ? options.detailsById[pluginKey] ?? null : null;
  const expanded = pluginKey && options.expandedPluginId === pluginKey;
  const detailLoading = pluginKey && options.detailLoadingPluginId === pluginKey;
  const capabilities = Array.isArray(plugin.interface?.capabilities) ? plugin.interface.capabilities : [];
  const capabilityCopy = capabilities.length > 0 ? capabilities.join(", ") : "暂无能力标签";
  const description = plugin.interface?.shortDescription || "暂无说明";
  const featured = options.hideFeatured === true ? false : options.featuredPluginIds.has(pluginId);
  const owned = plugin.owned === true;
  const runtimeAvailable = plugin.runtimeState !== "missing";
  const detailAvailable = owned || runtimeAvailable;
  const installUnavailable = plugin.installPolicy === "NOT_AVAILABLE";
  const primaryActionLabel = owned ? "移出 principal" : installUnavailable ? "暂不可纳入" : "纳入 principal";
  const primaryAction = owned ? "uninstall" : "install";
  const primaryDisabled = options.busy || (!owned && installUnavailable);
  const sourceCopy = buildPluginSourceCopy(plugin, marketplace);
  const runtimeCopy = buildPluginRuntimeCopy(plugin);
  const repairCopy = plugin.repairHint ? `建议：${plugin.repairHint}` : "";
  const errorMarkup = plugin.lastError
    ? `<p class="skill-card-error">${options.escapeHtml(plugin.lastError)}</p>`
    : "";
  const detailMarkup = expanded
    ? detailLoading
      ? '<p class="skill-card-summary">正在读取 plugin 详情。</p>'
      : detail
        ? renderPluginDetail(detail, options)
        : '<p class="skill-card-summary">当前没有更多详情。</p>'
    : "";

  return `
    <article class="skill-card skill-card-curated">
      <div class="skill-card-head">
        <div>
          <h4>${options.escapeHtml(plugin.interface?.displayName || pluginName)}</h4>
          <p class="skill-card-copy">${options.escapeHtml(description)}</p>
        </div>
        <div class="skill-card-actions">
          <button
            type="button"
            class="toolbar-button subtle"
            data-plugin-action="detail"
            data-marketplace-path="${options.escapeHtml(marketplace.path || "")}"
            data-plugin-name="${options.escapeHtml(pluginName)}"
            data-plugin-id="${options.escapeHtml(pluginId)}"${options.busy || !detailAvailable ? " disabled" : ""}
          >${options.escapeHtml(detailLoading ? "读取中..." : expanded ? "收起" : "详情")}</button>
          <button
            type="button"
            class="${owned ? "ghost-button" : "toolbar-button subtle"}"
            data-plugin-action="${options.escapeHtml(primaryAction)}"
            data-marketplace-path="${options.escapeHtml(marketplace.path || "")}"
            data-plugin-name="${options.escapeHtml(pluginName)}"
            data-plugin-id="${options.escapeHtml(pluginId)}"${primaryDisabled ? " disabled" : ""}
          >${options.escapeHtml(primaryActionLabel)}</button>
        </div>
      </div>
      <div class="skill-pill-row">
        <span class="skill-pill"${owned ? ' data-tone="ready"' : ""}>
          ${options.escapeHtml(owned ? "已纳入 principal" : plugin.runtimeInstalled ? "仅当前 runtime 已安装" : "未纳入 principal")}
        </span>
        <span class="skill-pill"${plugin.runtimeState === "installed" ? ' data-tone="ready"' : ""}>
          ${options.escapeHtml(formatPluginRuntimeStateLabel(plugin.runtimeState))}
        </span>
        <span class="skill-pill">${options.escapeHtml(formatPluginInstallPolicyLabel(plugin.installPolicy))}</span>
        <span class="skill-pill">${options.escapeHtml(formatPluginAuthPolicyLabel(plugin.authPolicy))}</span>
        ${featured ? '<span class="skill-pill" data-tone="ready">featured</span>' : ""}
      </div>
      <p class="skill-card-summary">${options.escapeHtml(capabilityCopy)}</p>
      ${sourceCopy ? `<p class="skill-card-copy">${options.escapeHtml(sourceCopy)}</p>` : ""}
      ${runtimeCopy ? `<p class="skill-card-copy">${options.escapeHtml(runtimeCopy)}</p>` : ""}
      ${repairCopy ? `<p class="skill-card-copy">${options.escapeHtml(repairCopy)}</p>` : ""}
      ${errorMarkup}
      ${detailMarkup}
    </article>
  `;
}

function renderPluginDetail(detail, options) {
  const skills = Array.isArray(detail.skills) ? detail.skills : [];
  const apps = Array.isArray(detail.apps) ? detail.apps : [];
  const mcpServers = Array.isArray(detail.mcpServers) ? detail.mcpServers : [];
  const description = detail.description || detail.summary?.interface?.longDescription || "暂无额外说明";
  const skillsMarkup = skills.length > 0
    ? `<div class="skill-materialization-list">${skills.map((skill) => `
        <div class="skill-materialization-item">
          <span>${options.escapeHtml(skill.name || "未命名 skill")}</span>
          <span class="skill-materialization-state" data-state="${options.escapeHtml(skill.enabled ? "synced" : "missing")}">
            ${options.escapeHtml(skill.enabled ? "已启用" : "未启用")}
          </span>
          <span class="skill-materialization-time">${options.escapeHtml(skill.shortDescription || skill.description || "")}</span>
        </div>
      `).join("")}</div>`
    : '<p class="skill-card-copy">无附带 skills。</p>';
  const appsMarkup = apps.length > 0
    ? `<div class="skill-materialization-list">${apps.map((pluginApp) => `
        <div class="skill-materialization-item">
          <span>${options.escapeHtml(pluginApp.name || pluginApp.id || "未命名 app")}</span>
          <span class="skill-materialization-state" data-state="${options.escapeHtml(pluginApp.needsAuth ? "missing" : "synced")}">
            ${options.escapeHtml(pluginApp.needsAuth ? "需认证" : "可直接用")}
          </span>
          <span class="skill-materialization-time">${options.escapeHtml(pluginApp.description || "")}</span>
        </div>
      `).join("")}</div>`
    : '<p class="skill-card-copy">无附带 apps。</p>';
  const mcpMarkup = mcpServers.length > 0
    ? `<p class="skill-card-copy">MCP：${options.escapeHtml(mcpServers.join(", "))}</p>`
    : '<p class="skill-card-copy">无附带 MCP server。</p>';
  const sourceCopy = buildPluginSourceCopy({
    ...(detail.summary ?? {}),
    sourceType: detail.sourceType || detail.summary?.sourceType,
    sourceScope: detail.sourceScope || detail.summary?.sourceScope,
    sourcePath: detail.sourcePath || detail.summary?.sourcePath,
    sourceRef: detail.sourceRef || detail.summary?.sourceRef || null,
  }, {
    path: detail.marketplacePath,
    name: detail.marketplaceName,
  });
  const runtimeCopy = buildPluginRuntimeCopy(detail);
  const repairCopy = detail.repairHint ? `建议：${detail.repairHint}` : "";
  const errorMarkup = detail.lastError
    ? `<p class="skill-card-error">${options.escapeHtml(detail.lastError)}</p>`
    : "";

  return `
    <div class="settings-stack">
      <p class="skill-card-copy">${options.escapeHtml(description)}</p>
      ${sourceCopy ? `<p class="skill-card-copy">${options.escapeHtml(sourceCopy)}</p>` : ""}
      ${runtimeCopy ? `<p class="skill-card-copy">${options.escapeHtml(runtimeCopy)}</p>` : ""}
      ${repairCopy ? `<p class="skill-card-copy">${options.escapeHtml(repairCopy)}</p>` : ""}
      ${errorMarkup}
      ${skillsMarkup}
      ${appsMarkup}
      ${mcpMarkup}
    </div>
  `;
}

function buildPluginSourceCopy(plugin, marketplace) {
  const sourceTypeLabel = formatPluginSourceLabel(plugin.sourceType);
  const sourceScopeLabel = formatPluginSourceScopeLabel(plugin.sourceScope);
  const sourceRef = plugin.sourceRef && typeof plugin.sourceRef === "object" ? plugin.sourceRef : null;
  const sourcePath = plugin.sourcePath || sourceRef?.sourcePath || "";
  const workspaceFingerprint = sourceRef?.workspaceFingerprint || "";
  const marketplaceName = sourceRef?.marketplaceName || marketplace?.name || "";
  const marketplacePath = sourceRef?.marketplacePath || marketplace?.path || "";

  const details = [];

  if (sourcePath) {
    details.push(sourcePath);
  }

  if (workspaceFingerprint && plugin.sourceType === "repo-local") {
    details.push(`工作区 ${workspaceFingerprint}`);
  }

  if (!sourcePath && marketplacePath) {
    details.push(`${marketplaceName || "marketplace"} @ ${marketplacePath}`);
  }

  if (!details.length && marketplaceName) {
    details.push(marketplaceName);
  }

  if (sourceScopeLabel && sourceScopeLabel !== "未知来源边界") {
    details.unshift(sourceScopeLabel);
  }

  return details.length > 0 ? `来源：${sourceTypeLabel}｜${details.join("｜")}` : `来源：${sourceTypeLabel}`;
}

function buildPluginRuntimeCopy(plugin) {
  const materialization = plugin.currentMaterialization && typeof plugin.currentMaterialization === "object"
    ? plugin.currentMaterialization
    : null;

  if (!materialization) {
    return "";
  }

  const parts = [];

  if (materialization.targetId) {
    parts.push(`槽位 ${materialization.targetId}`);
  }

  if (materialization.workspaceFingerprint) {
    parts.push(`工作区 ${materialization.workspaceFingerprint}`);
  }

  if (materialization.lastSyncedAt) {
    parts.push(`同步于 ${materialization.lastSyncedAt}`);
  }

  return parts.length > 0 ? `当前物化：${parts.join("｜")}` : "";
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

function resolveWorkspaceToolsSection(section) {
  return ["runtime", "auth", "skills", "mcp", "plugins", "memory-candidates", "third-party", "mode-switch"].includes(section)
    ? section
    : "runtime";
}

function createPluginCardKey(marketplacePath, pluginKey) {
  const normalizedMarketplacePath = typeof marketplacePath === "string" ? marketplacePath.trim() : "";
  const normalizedPluginKey = typeof pluginKey === "string" ? pluginKey.trim() : "";

  if (!normalizedMarketplacePath || !normalizedPluginKey) {
    return "";
  }

  return `${normalizedMarketplacePath}::${normalizedPluginKey}`;
}

function formatPluginInstallPolicyLabel(value) {
  switch (value) {
    case "AVAILABLE":
      return "可安装";
    case "INSTALLED_BY_DEFAULT":
      return "默认安装";
    case "NOT_AVAILABLE":
      return "不可安装";
    default:
      return "安装策略未知";
  }
}

function formatPluginAuthPolicyLabel(value) {
  switch (value) {
    case "ON_INSTALL":
      return "安装时认证";
    case "ON_USE":
      return "使用时认证";
    default:
      return "认证策略未知";
  }
}

function formatPluginRuntimeStateLabel(value) {
  switch (value) {
    case "installed":
      return "当前已可用";
    case "available":
      return "当前可发现";
    case "missing":
      return "当前工作区不可用";
    case "auth_required":
      return "当前需认证";
    case "failed":
      return "当前状态异常";
    default:
      return "状态未知";
  }
}

function formatPluginSourceLabel(sourceType) {
  switch (sourceType) {
    case "marketplace":
      return "marketplace";
    case "repo-local":
      return "repo 本地";
    case "home-local":
      return "宿主机本地";
    default:
      return "未知来源";
  }
}

function formatPluginSourceScopeLabel(sourceScope) {
  switch (sourceScope) {
    case "marketplace":
      return "可跨工作区复用";
    case "workspace-current":
      return "当前工作区";
    case "workspace-other":
      return "其他工作区";
    case "host-local":
      return "宿主机本地";
    default:
      return "未知来源边界";
  }
}

function resolveMemoryCandidatesFilterValue(filterStatus) {
  return ["suggested", "approved", "rejected", "all"].includes(filterStatus) ? filterStatus : "suggested";
}

function resolveMemoryCandidatesStatusMessage(candidatesState, candidateCount) {
  if (candidatesState.errorMessage) {
    return candidatesState.errorMessage;
  }

  if (candidatesState.loading) {
    return "正在读取长期记忆候选列表。";
  }

  if (candidatesState.extracting) {
    return "正在从最近完成任务提炼长期记忆候选。";
  }

  if (candidatesState.noticeMessage) {
    return candidatesState.noticeMessage;
  }

  if (candidateCount === 0 && candidatesState.status === "ready") {
    return "当前筛选条件下没有候选，可稍后刷新或切换查看范围。";
  }

  return "";
}


function normalizeAgentCreateDraft(draft) {
  return {
    departmentRole: typeof draft?.departmentRole === "string" ? draft.departmentRole : "",
    displayName: typeof draft?.displayName === "string" ? draft.displayName : "",
    mission: typeof draft?.mission === "string" ? draft.mission : "",
  };
}

function normalizeSpawnPolicyDraft(draft, activeSpawnPolicy) {
  return {
    organizationId: typeof draft?.organizationId === "string"
      ? draft.organizationId
      : typeof activeSpawnPolicy?.organizationId === "string"
        ? activeSpawnPolicy.organizationId
        : "",
    maxActiveAgents: Number.isFinite(draft?.maxActiveAgents)
      ? Number(draft.maxActiveAgents)
      : Number.isFinite(activeSpawnPolicy?.maxActiveAgents)
        ? Number(activeSpawnPolicy.maxActiveAgents)
        : 12,
    maxActiveAgentsPerRole: Number.isFinite(draft?.maxActiveAgentsPerRole)
      ? Number(draft.maxActiveAgentsPerRole)
      : Number.isFinite(activeSpawnPolicy?.maxActiveAgentsPerRole)
        ? Number(activeSpawnPolicy.maxActiveAgentsPerRole)
        : 3,
  };
}

function normalizeExecutionBoundaryDraft(draft) {
  return {
    workspacePath: typeof draft?.workspacePath === "string" ? draft.workspacePath : "",
    additionalDirectoriesText: typeof draft?.additionalDirectoriesText === "string" ? draft.additionalDirectoriesText : "",
    allowNetworkAccess: draft?.allowNetworkAccess !== false,
    accessMode: draft?.accessMode === "third-party" ? "third-party" : "auth",
    authAccountId: typeof draft?.authAccountId === "string" ? draft.authAccountId : "",
    thirdPartyProviderId: typeof draft?.thirdPartyProviderId === "string" ? draft.thirdPartyProviderId : "",
    model: typeof draft?.model === "string" ? draft.model : "",
    reasoning: typeof draft?.reasoning === "string" ? draft.reasoning : "",
    memoryMode: typeof draft?.memoryMode === "string" ? draft.memoryMode : "",
    sandboxMode: typeof draft?.sandboxMode === "string" && draft.sandboxMode
      ? draft.sandboxMode
      : "workspace-write",
    approvalPolicy: typeof draft?.approvalPolicy === "string" && draft.approvalPolicy
      ? draft.approvalPolicy
      : "never",
    webSearchMode: typeof draft?.webSearchMode === "string" && draft.webSearchMode
      ? draft.webSearchMode
      : "live",
    networkAccessEnabled: draft?.networkAccessEnabled !== false,
  };
}

function resolveActiveSpawnPolicy(spawnPolicies, selectedAgent, selectedOrganization) {
  const organizationId = typeof selectedAgent?.organizationId === "string" && selectedAgent.organizationId.trim()
    ? selectedAgent.organizationId.trim()
    : typeof selectedOrganization?.organizationId === "string" && selectedOrganization.organizationId.trim()
      ? selectedOrganization.organizationId.trim()
      : "";

  if (organizationId) {
    return spawnPolicies.find((policy) => policy?.organizationId === organizationId) ?? spawnPolicies[0] ?? null;
  }

  return spawnPolicies[0] ?? null;
}

function normalizeAgentDispatchDraft(draft, selectedAgentId) {
  const fallbackTarget = typeof selectedAgentId === "string" ? selectedAgentId : "";

  return {
    targetAgentId: typeof draft?.targetAgentId === "string" ? draft.targetAgentId : fallbackTarget,
    sourceType: ["human", "agent", "system"].includes(draft?.sourceType) ? draft.sourceType : "human",
    sourceAgentId: typeof draft?.sourceAgentId === "string" ? draft.sourceAgentId : "",
    dispatchReason: typeof draft?.dispatchReason === "string" ? draft.dispatchReason : "",
    goal: typeof draft?.goal === "string" ? draft.goal : "",
    contextPacketText: typeof draft?.contextPacketText === "string" ? draft.contextPacketText : "",
    priority: ["low", "normal", "high", "urgent"].includes(draft?.priority) ? draft.priority : "normal",
  };
}

function normalizeHumanResponseDraft(draft, detail) {
  const workItemId = typeof detail?.workItem?.workItemId === "string" ? detail.workItem.workItemId : "";
  const status = typeof detail?.workItem?.status === "string" ? detail.workItem.status : "";

  if (!workItemId || status !== "waiting_human") {
    return {
      workItemId: "",
      decision: "",
      inputText: "",
    };
  }

  return {
    workItemId,
    decision: ["approve", "deny"].includes(draft?.decision) ? draft.decision : "",
    inputText: typeof draft?.inputText === "string" ? draft.inputText : "",
  };
}

function normalizeOrganizationWaitingResponseDrafts(drafts) {
  if (!drafts || typeof drafts !== "object") {
    return {};
  }

  return Object.entries(drafts).reduce((result, [workItemId, value]) => {
    if (typeof workItemId !== "string" || !workItemId.trim()) {
      return result;
    }

    result[workItemId] = {
      decision: ["approve", "deny"].includes(value?.decision) ? value.decision : "",
      inputText: typeof value?.inputText === "string" ? value.inputText : "",
    };
    return result;
  }, {});
}

function normalizeWaitingQueueSummary(summary, fallbackTotalCount) {
  return {
    totalCount: Number.isFinite(summary?.totalCount) ? Number(summary.totalCount) : Number(fallbackTotalCount || 0),
    waitingHumanCount: Number.isFinite(summary?.waitingHumanCount) ? Number(summary.waitingHumanCount) : 0,
    waitingAgentCount: Number.isFinite(summary?.waitingAgentCount) ? Number(summary.waitingAgentCount) : 0,
    escalationCount: Number.isFinite(summary?.escalationCount) ? Number(summary.escalationCount) : 0,
  };
}

function normalizeGovernanceOverviewState(value) {
  const overview = isRecord(value) ? value : {};

  return {
    urgentParentCount: Number.isFinite(overview.urgentParentCount) ? Number(overview.urgentParentCount) : 0,
    attentionParentCount: Number.isFinite(overview.attentionParentCount) ? Number(overview.attentionParentCount) : 0,
    waitingHumanCount: Number.isFinite(overview.waitingHumanCount) ? Number(overview.waitingHumanCount) : 0,
    waitingAgentCount: Number.isFinite(overview.waitingAgentCount) ? Number(overview.waitingAgentCount) : 0,
    staleParentCount: Number.isFinite(overview.staleParentCount) ? Number(overview.staleParentCount) : 0,
    failedChildCount: Number.isFinite(overview.failedChildCount) ? Number(overview.failedChildCount) : 0,
    managersNeedingAttentionCount: Number.isFinite(overview.managersNeedingAttentionCount)
      ? Number(overview.managersNeedingAttentionCount)
      : 0,
    managerHotspots: Array.isArray(overview.managerHotspots)
      ? overview.managerHotspots.filter((item) => isRecord(item) && isRecord(item.managerAgent))
      : [],
  };
}

function normalizeGovernanceFiltersState(value, organizations, agents) {
  const safeValue = isRecord(value) ? value : {};
  const organizationId = typeof safeValue.organizationId === "string" && safeValue.organizationId.trim()
    ? safeValue.organizationId.trim()
    : typeof organizations?.[0]?.organizationId === "string" && organizations[0].organizationId.trim()
      ? organizations[0].organizationId.trim()
      : "";
  const managerAgentId = typeof safeValue.managerAgentId === "string" && safeValue.managerAgentId.trim()
    ? safeValue.managerAgentId.trim()
    : "";
  const visibleAgents = Array.isArray(agents)
    ? agents.filter((agent) => !organizationId || agent?.organizationId === organizationId)
    : [];
  const selectedManagerId = visibleAgents.some((agent) => agent?.agentId === managerAgentId)
    ? managerAgentId
    : "";

  return {
    organizationId,
    managerAgentId: selectedManagerId,
    attentionLevel: ["all", "normal", "attention", "urgent"].includes(safeValue.attentionLevel)
      ? safeValue.attentionLevel
      : "all",
    waitingFor: ["any", "human", "agent"].includes(safeValue.waitingFor)
      ? safeValue.waitingFor
      : "any",
    staleOnly: safeValue.staleOnly === true,
    failedOnly: safeValue.failedOnly === true,
  };
}

function resolveGovernanceOverviewSummaryText({ loading, overview }) {
  if (loading) {
    return "正在汇总当前组织的治理热点与 manager 负载。";
  }

  return `当前有 ${overview.urgentParentCount} 条紧急父任务、${overview.waitingHumanCount} 条等待顶层治理的任务、${overview.managersNeedingAttentionCount} 个需要关注的 manager。`;
}

function renderGovernanceOverviewSummaryCards(overview, { busy, escapeHtml }) {
  const cards = [
    {
      label: "紧急父任务",
      value: overview.urgentParentCount,
      copy: "点击后只看 urgent。",
      preset: "urgent",
    },
    {
      label: "关注父任务",
      value: overview.attentionParentCount,
      copy: "点击后只看 attention。",
      preset: "attention",
    },
    {
      label: "等人类",
      value: overview.waitingHumanCount,
      copy: "点击后只看 waiting_human。",
      preset: "waiting_human",
    },
    {
      label: "等 agent",
      value: overview.waitingAgentCount,
      copy: "点击后只看 waiting_agent。",
      preset: "waiting_agent",
    },
    {
      label: "陈旧链路",
      value: overview.staleParentCount,
      copy: "点击后只看 stale。",
      preset: "stale",
    },
    {
      label: "需关注 manager",
      value: overview.managersNeedingAttentionCount,
      copy: `失败子任务 ${overview.failedChildCount} 条。`,
      preset: "",
    },
  ];

  return cards.map((card) => {
    const actionable = card.preset.length > 0;

    return actionable
      ? `
        <button
          type="button"
          class="agent-summary-card agent-summary-card-action"
          data-agent-governance-preset="${escapeHtml(card.preset)}"
          ${busy ? "disabled" : ""}
        >
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
          <small>${escapeHtml(card.copy)}</small>
        </button>
      `
      : `
        <article class="agent-summary-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
          <small>${escapeHtml(card.copy)}</small>
        </article>
      `;
  }).join("");
}

function renderGovernanceManagerOptions(agents, organizationId, selectedManagerId, escapeHtml) {
  const visibleAgents = Array.isArray(agents)
    ? agents.filter((agent) => !organizationId || agent?.organizationId === organizationId)
    : [];

  return [
    '<option value="">全部 manager</option>',
    ...visibleAgents.map((agent) => {
      const label = agent?.displayName || agent?.departmentRole || agent?.agentId || "未命名 agent";
      const value = typeof agent?.agentId === "string" ? agent.agentId : "";
      const selected = value === selectedManagerId ? ' selected="selected"' : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    }),
  ].join("");
}

function resolveGovernanceHotspotsSummaryText({ loading, hotspotCount, managerCount }) {
  if (loading) {
    return "正在计算 manager 热点。";
  }

  if (hotspotCount <= 0) {
    return "当前还没有需要特别关注的 manager 热点。";
  }

  return `当前有 ${managerCount} 个需要关注的 manager，这里优先展示最值得先看的 ${hotspotCount} 条热点。`;
}

function renderGovernanceHotspotCard(item, {
  busy,
  escapeHtml,
  formatRelativeTime,
}) {
  const managerAgent = isRecord(item?.managerAgent) ? item.managerAgent : {};
  const status = resolveAgentStatus(managerAgent?.status);
  const openParentCount = Number.isFinite(item?.openParentCount) ? Number(item.openParentCount) : 0;
  const urgentParentCount = Number.isFinite(item?.urgentParentCount) ? Number(item.urgentParentCount) : 0;
  const attentionParentCount = Number.isFinite(item?.attentionParentCount) ? Number(item.attentionParentCount) : 0;
  const waitingCount = Number.isFinite(item?.waitingCount) ? Number(item.waitingCount) : 0;
  const staleParentCount = Number.isFinite(item?.staleParentCount) ? Number(item.staleParentCount) : 0;
  const failedChildCount = Number.isFinite(item?.failedChildCount) ? Number(item.failedChildCount) : 0;

  return `
    <article class="agent-card agent-card-compact">
      <div class="agent-card-head">
        <div class="agent-card-heading">
          <h4>${escapeHtml(managerAgent?.displayName || managerAgent?.departmentRole || managerAgent?.agentId || "未知 manager")}</h4>
          <p class="agent-card-copy">优先回答“现在该先盯谁”。这张热点卡只保留筛选和聚焦两个动作。</p>
        </div>
        <div class="agent-pill-row">
          <span class="badge ${escapeHtml(resolveStatusTone(status))}">${escapeHtml(resolveAgentStatusLabel(status))}</span>
          <span class="agent-pill">${escapeHtml(`urgent ${urgentParentCount}`)}</span>
        </div>
      </div>
      <div class="agent-meta-grid">
        ${renderAgentMetaItem("父任务", String(openParentCount), escapeHtml)}
        ${renderAgentMetaItem("waiting", String(waitingCount), escapeHtml)}
        ${renderAgentMetaItem("attention", String(attentionParentCount), escapeHtml)}
        ${renderAgentMetaItem("stale", String(staleParentCount), escapeHtml)}
        ${renderAgentMetaItem("失败子任务", String(failedChildCount), escapeHtml)}
        ${renderAgentMetaItem("最近活动", formatRelativeTime(item?.latestActivityAt), escapeHtml)}
      </div>
      <div class="agent-card-actions">
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-governance-hotspot-filter="${escapeHtml(managerAgent?.agentId || "")}"
          ${busy ? "disabled" : ""}
        >
          只看该 manager
        </button>
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-governance-hotspot-focus="${escapeHtml(managerAgent?.agentId || "")}"
          ${busy ? "disabled" : ""}
        >
          切到 manager
        </button>
      </div>
    </article>
  `;
}

function resolveWaitingQueueSummaryText({ loading, waitingSummary, waitingCount }) {
  if (loading) {
    return "正在汇总当前组织下的等待项与升级摘要。";
  }

  if (!waitingCount) {
    return "当前没有需要顶层治理的等待项。";
  }

  return `当前共有 ${waitingSummary.totalCount} 条待治理项：等人 ${waitingSummary.waitingHumanCount} 条，等 agent ${waitingSummary.waitingAgentCount} 条，升级摘要 ${waitingSummary.escalationCount} 条。`;
}

function normalizeCollaborationDashboardSummary(summary, fallbackTotalCount) {
  return {
    totalCount: Number.isFinite(summary?.totalCount) ? Number(summary.totalCount) : Number(fallbackTotalCount || 0),
    urgentCount: Number.isFinite(summary?.urgentCount) ? Number(summary.urgentCount) : 0,
    attentionCount: Number.isFinite(summary?.attentionCount) ? Number(summary.attentionCount) : 0,
    normalCount: Number.isFinite(summary?.normalCount) ? Number(summary.normalCount) : 0,
  };
}

function resolveCollaborationDashboardSummaryText({ loading, summary, collaborationCount }) {
  if (loading) {
    return "正在汇总跨父任务协作链路与关注等级。";
  }

  if (!collaborationCount) {
    return "当前还没有进入组织级汇总台的跨父任务协作链路。";
  }

  return `当前共有 ${summary.totalCount} 条跨父任务协作链路：紧急 ${summary.urgentCount} 条，需要关注 ${summary.attentionCount} 条，正常推进 ${summary.normalCount} 条。`;
}

function renderAgentSelect(select, agents, currentAgentId, emptyLabel, escapeHtml) {
  if (!select) {
    return;
  }

  const options = Array.isArray(agents) ? agents : [];
  select.innerHTML = options.length
    ? options
      .map((agent) => `
        <option value="${escapeHtml(agent?.agentId || "")}">
          ${escapeHtml(`${agent?.displayName || agent?.departmentRole || agent?.agentId || "未知 agent"} · ${agent?.departmentRole || "未分类"}`)}
        </option>
      `)
      .join("")
    : `<option value="">${escapeHtml(emptyLabel)}</option>`;
  select.value = options.some((agent) => agent?.agentId === currentAgentId)
    ? currentAgentId
    : options[0]?.agentId || "";
}

function renderSimpleSelect(select, items, currentValue, emptyLabel, mapper, escapeHtml) {
  if (!select) {
    return;
  }

  const options = Array.isArray(items) ? items : [];
  select.innerHTML = [
    `<option value="">${escapeHtml(emptyLabel)}</option>`,
    ...options.map((item) => {
      const mapped = mapper(item);
      return `<option value="${escapeHtml(mapped.value)}">${escapeHtml(mapped.label)}</option>`;
    }),
  ].join("");
  select.value = options.some((item) => mapper(item).value === currentValue)
    ? currentValue
    : "";
}

function setExecutionBoundaryDisabled(dom, disabled) {
  if (dom.agentsExecutionBoundaryWorkspaceInput) {
    dom.agentsExecutionBoundaryWorkspaceInput.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryAdditionalDirsInput) {
    dom.agentsExecutionBoundaryAdditionalDirsInput.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryPolicyNetworkSelect) {
    dom.agentsExecutionBoundaryPolicyNetworkSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryAccessModeSelect) {
    dom.agentsExecutionBoundaryAccessModeSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryAuthAccountSelect) {
    dom.agentsExecutionBoundaryAuthAccountSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryProviderSelect) {
    dom.agentsExecutionBoundaryProviderSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryModelInput) {
    dom.agentsExecutionBoundaryModelInput.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryReasoningSelect) {
    dom.agentsExecutionBoundaryReasoningSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryMemoryModeSelect) {
    dom.agentsExecutionBoundaryMemoryModeSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundarySandboxSelect) {
    dom.agentsExecutionBoundarySandboxSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryApprovalSelect) {
    dom.agentsExecutionBoundaryApprovalSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryWebSearchSelect) {
    dom.agentsExecutionBoundaryWebSearchSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundaryRuntimeNetworkSelect) {
    dom.agentsExecutionBoundaryRuntimeNetworkSelect.disabled = disabled;
  }
  if (dom.agentsExecutionBoundarySaveButton) {
    dom.agentsExecutionBoundarySaveButton.disabled = disabled;
  }
}

function renderOrganizationWaitingCard(item, {
  selectedWorkItemId,
  waitingResponseDraft,
  escalatingWorkItemId,
  respondingWorkItemId,
  busy,
  escapeHtml,
  formatRelativeTime,
}) {
  const workItem = item?.workItem ?? {};
  const targetAgent = item?.targetAgent ?? {};
  const managerAgent = item?.managerAgent ?? {};
  const parentWorkItem = item?.parentWorkItem ?? null;
  const sourceAgent = item?.sourceAgent ?? null;
  const sourcePrincipal = item?.sourcePrincipal ?? null;
  const latestWaitingMessage = item?.latestWaitingMessage ?? null;
  const status = resolveWorkItemStatus(workItem.status);
  const selected = workItem?.workItemId === selectedWorkItemId;
  const waitingHuman = workItem?.status === "waiting_human";
  const attentionLabel = resolveWaitingAttentionLabel(workItem, latestWaitingMessage);
  const summary = resolveWaitingQueueItemSummary(workItem, latestWaitingMessage);
  const decisionChoices = Array.isArray(workItem?.waitingActionRequest?.choices)
    ? workItem.waitingActionRequest.choices.filter((choice) => choice === "approve" || choice === "deny")
    : [];
  const showDecisionSelect = waitingHuman && decisionChoices.length > 0;
  const currentDraft = {
    decision: ["approve", "deny"].includes(waitingResponseDraft?.decision) ? waitingResponseDraft.decision : "",
    inputText: typeof waitingResponseDraft?.inputText === "string" ? waitingResponseDraft.inputText : "",
  };
  const escalateDisabled = busy || workItem?.workItemId === escalatingWorkItemId;
  const submitDisabled = busy || workItem?.workItemId === respondingWorkItemId;

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div class="agent-card-heading">
          <h4>${escapeHtml(targetAgent?.displayName || targetAgent?.departmentRole || targetAgent?.agentId || "未知 agent")}</h4>
          <p class="agent-card-copy">${escapeHtml(summary)}</p>
        </div>
        <div class="agent-pill-row">
          <span class="badge ${escapeHtml(resolveStatusTone(status))}">${escapeHtml(resolveWorkItemStatusLabel(status))}</span>
          <span class="agent-pill">${escapeHtml(attentionLabel)}</span>
        </div>
      </div>
      <div class="agent-meta-grid">
        ${renderAgentMetaItem("workItem", workItem?.workItemId || "未知", escapeHtml)}
        ${renderAgentMetaItem("manager", managerAgent?.displayName || managerAgent?.agentId || targetAgent?.displayName || "未知", escapeHtml)}
        ${renderAgentMetaItem("来源", sourceAgent?.displayName || sourcePrincipal?.displayName || sourcePrincipal?.principalId || "未知", escapeHtml)}
        ${renderAgentMetaItem("优先级", resolvePriorityLabel(resolvePriority(workItem?.priority)), escapeHtml)}
        ${renderAgentMetaItem("最近更新", formatRelativeTime(workItem?.updatedAt), escapeHtml)}
      </div>
      ${parentWorkItem?.workItemId ? `
        <div class="agent-block">
          <p class="agent-block-title">所属父任务</p>
          <p class="agent-card-copy">${escapeHtml(parentWorkItem?.goal || parentWorkItem?.dispatchReason || parentWorkItem?.workItemId || "当前父任务没有额外摘要。")}</p>
        </div>
      ` : ""}
      ${waitingHuman ? `
        <div class="agent-block">
          <p class="agent-block-title">直接治理</p>
          <div class="settings-stack">
            <p class="settings-section-copy">这是给顶层 Themis 的治理入口。提交后会把当前 work item 重新排回队列继续执行，不需要先跳到详情页。</p>
            ${showDecisionSelect ? `
              <label class="settings-field">
                <span>审批结果</span>
                <select
                  data-agent-waiting-decision="${escapeHtml(workItem?.workItemId || "")}"
                  ${submitDisabled ? "disabled" : ""}
                >
                  <option value="">请选择</option>
                  <option value="approve" ${currentDraft.decision === "approve" ? "selected" : ""}>approve</option>
                  <option value="deny" ${currentDraft.decision === "deny" ? "selected" : ""}>deny</option>
                </select>
              </label>
            ` : ""}
            <label class="settings-field">
              <span>补充说明</span>
              <textarea
                rows="3"
                data-agent-waiting-input="${escapeHtml(workItem?.workItemId || "")}"
                placeholder="例如：可以继续，但先确认监控和回滚准备。"
                ${submitDisabled ? "disabled" : ""}
              >${escapeHtml(currentDraft.inputText || "")}</textarea>
            </label>
          </div>
        </div>
      ` : ""}
      ${workItem?.status === "waiting_agent" ? `
        <div class="agent-block">
          <p class="agent-block-title">升级处理</p>
          <div class="settings-stack">
            <p class="settings-section-copy">当前阻塞卡在 agent 间答复上。升级后会把它转成顶层治理项，并关闭原来的待回复 mailbox，之后可以直接在这里提交治理回复。</p>
          </div>
        </div>
      ` : ""}
      <div class="agent-card-actions">
        ${parentWorkItem?.workItemId ? `
          <button
            type="button"
            class="toolbar-button subtle"
            data-agent-waiting-parent-open="${escapeHtml(parentWorkItem?.workItemId || "")}"
            data-agent-waiting-parent-agent-id="${escapeHtml(managerAgent?.agentId || targetAgent?.agentId || "")}"
          >
            查看父任务
          </button>
        ` : ""}
        ${workItem?.status === "waiting_agent" ? `
          <button
            type="button"
            class="toolbar-button subtle"
            data-agent-waiting-escalate="${escapeHtml(workItem?.workItemId || "")}"
            ${escalateDisabled ? "disabled" : ""}
          >
            ${workItem?.workItemId === escalatingWorkItemId ? "升级中..." : "升级到顶层治理"}
          </button>
        ` : ""}
        ${waitingHuman ? `
          <button
            type="button"
            class="toolbar-button subtle"
            data-agent-waiting-respond="${escapeHtml(workItem?.workItemId || "")}"
            ${submitDisabled ? "disabled" : ""}
          >
            ${workItem?.workItemId === respondingWorkItemId ? "提交中..." : "直接提交治理回复"}
          </button>
        ` : ""}
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-waiting-open="${escapeHtml(workItem?.workItemId || "")}"
          data-agent-waiting-agent-id="${escapeHtml(targetAgent?.agentId || "")}"
        >
          ${selected ? "正在查看中" : "定位并处理"}
        </button>
      </div>
    </article>
  `;
}

function renderOrganizationCollaborationDashboardCard(item, {
  selectedAgentId,
  selectedWorkItemId,
  busy,
  escapeHtml,
  formatRelativeTime,
}) {
  const parentWorkItem = item?.parentWorkItem ?? {};
  const managerAgent = item?.managerAgent ?? {};
  const childSummary = normalizeChildWorkItemSummary(item?.childSummary);
  const attentionLevel = resolveCollaborationAttentionLevel(item?.attentionLevel);
  const managerStatus = resolveAgentStatus(item?.managerStatus || managerAgent?.status);
  const waitingHumanChildCount = Number.isFinite(item?.waitingHumanChildCount) ? Number(item.waitingHumanChildCount) : 0;
  const waitingAgentChildCount = Number.isFinite(item?.waitingAgentChildCount) ? Number(item.waitingAgentChildCount) : 0;
  const failedChildCount = Number.isFinite(item?.failedChildCount) ? Number(item.failedChildCount) : 0;
  const staleChildCount = Number.isFinite(item?.staleChildCount) ? Number(item.staleChildCount) : 0;
  const attentionReasons = Array.isArray(item?.attentionReasons)
    ? item.attentionReasons.filter((reason) => typeof reason === "string" && reason.trim())
    : [];
  const selected = parentWorkItem?.workItemId === selectedWorkItemId;
  const focusedManager = managerAgent?.agentId === selectedAgentId;
  const openDisabled = busy || !parentWorkItem?.workItemId || !managerAgent?.agentId;
  const focusDisabled = busy || !managerAgent?.agentId;
  const waitingOpenDisabled = busy || !item?.latestWaitingWorkItemId || !item?.latestWaitingTargetAgentId;
  const lifecycleAction = managerStatus === "paused" ? "resume" : managerStatus === "active" ? "pause" : "";
  const lifecycleDisabled = busy || !lifecycleAction || !managerAgent?.agentId;
  const activitySummary = typeof item?.lastActivitySummary === "string" && item.lastActivitySummary.trim()
    ? item.lastActivitySummary.trim()
    : (typeof parentWorkItem?.goal === "string" && parentWorkItem.goal.trim())
      ? parentWorkItem.goal.trim()
      : "当前父任务没有额外摘要。";

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div class="agent-card-heading">
          <h4>${escapeHtml(parentWorkItem?.goal || parentWorkItem?.dispatchReason || parentWorkItem?.workItemId || "未命名父任务")}</h4>
          <p class="agent-card-copy">${escapeHtml(activitySummary)}</p>
        </div>
        <div class="agent-pill-row">
          <span class="badge ${escapeHtml(resolveAttentionTone(attentionLevel))}">${escapeHtml(resolveCollaborationAttentionLabel(attentionLevel))}</span>
          <span class="badge ${escapeHtml(resolveStatusTone(resolveWorkItemStatus(parentWorkItem?.status)))}">${escapeHtml(resolveWorkItemStatusLabel(resolveWorkItemStatus(parentWorkItem?.status)))}</span>
        </div>
      </div>
      <div class="agent-meta-grid">
        ${renderAgentMetaItem("manager", managerAgent?.displayName || managerAgent?.agentId || "未知", escapeHtml)}
        ${renderAgentMetaItem("manager 状态", resolveAgentStatusLabel(managerStatus), escapeHtml)}
        ${renderAgentMetaItem("父 workItem", parentWorkItem?.workItemId || "未知", escapeHtml)}
        ${renderAgentMetaItem("子任务", `${childSummary.totalCount} 条 / 进行中 ${childSummary.openCount}`, escapeHtml)}
        ${renderAgentMetaItem("等待中", `${childSummary.waitingCount} 条`, escapeHtml)}
        ${renderAgentMetaItem("等人类 / 等 agent", `${waitingHumanChildCount} / ${waitingAgentChildCount}`, escapeHtml)}
        ${renderAgentMetaItem("失败 / stale", `${failedChildCount} / ${staleChildCount}`, escapeHtml)}
        ${renderAgentMetaItem("最近活动", formatRelativeTime(item?.lastActivityAt), escapeHtml)}
        ${renderAgentMetaItem("最近动作", resolveCollaborationActivityKindLabel(item?.lastActivityKind), escapeHtml)}
      </div>
      ${attentionReasons.length
        ? `
          <div class="agent-block">
            <p class="agent-block-title">关注原因</p>
            <p class="agent-card-copy">${escapeHtml(attentionReasons.join("；"))}</p>
          </div>
        `
        : ""}
      <div class="agent-card-actions">
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-collaboration-open="${escapeHtml(parentWorkItem?.workItemId || "")}"
          data-agent-collaboration-agent-id="${escapeHtml(managerAgent?.agentId || "")}"
          ${openDisabled ? "disabled" : ""}
        >
          ${selected ? "正在查看父任务" : "查看父任务详情"}
        </button>
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-collaboration-focus="${escapeHtml(managerAgent?.agentId || "")}"
          ${focusDisabled ? "disabled" : ""}
        >
          ${focusedManager ? "当前 manager" : "切到 manager"}
        </button>
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-collaboration-waiting-open="${escapeHtml(item?.latestWaitingWorkItemId || "")}"
          data-agent-collaboration-waiting-agent-id="${escapeHtml(item?.latestWaitingTargetAgentId || "")}"
          ${waitingOpenDisabled ? "disabled" : ""}
        >
          查看等待项
        </button>
        ${lifecycleAction ? `
          <button
            type="button"
            class="toolbar-button subtle"
            data-agent-collaboration-lifecycle="${escapeHtml(lifecycleAction)}"
            data-agent-collaboration-lifecycle-agent-id="${escapeHtml(managerAgent?.agentId || "")}"
            ${lifecycleDisabled ? "disabled" : ""}
          >
            ${escapeHtml(lifecycleAction === "pause" ? "暂停 manager" : "恢复 manager")}
          </button>
        ` : ""}
      </div>
    </article>
  `;
}

function renderAgentSpawnSuggestionCard(suggestion, {
  busy,
  approvingSpawnSuggestionId,
  ignoringSpawnSuggestionId,
  rejectingSpawnSuggestionId,
  escapeHtml,
}) {
  const suggestionId = typeof suggestion?.suggestionId === "string" ? suggestion.suggestionId : "";
  const displayName = typeof suggestion?.displayName === "string" ? suggestion.displayName : "待命名 agent";
  const departmentRole = typeof suggestion?.departmentRole === "string" ? suggestion.departmentRole : "未知职责";
  const rationale = typeof suggestion?.rationale === "string" ? suggestion.rationale : "当前没有附加理由。";
  const supportingAgent = typeof suggestion?.supportingAgentDisplayName === "string"
    ? suggestion.supportingAgentDisplayName
    : "当前团队";
  const openWorkItemCount = Number.isFinite(suggestion?.openWorkItemCount) ? Number(suggestion.openWorkItemCount) : 0;
  const waitingWorkItemCount = Number.isFinite(suggestion?.waitingWorkItemCount) ? Number(suggestion.waitingWorkItemCount) : 0;
  const highPriorityWorkItemCount = Number.isFinite(suggestion?.highPriorityWorkItemCount)
    ? Number(suggestion.highPriorityWorkItemCount)
    : 0;
  const guardrail = isRecord(suggestion?.guardrail) ? suggestion.guardrail : null;
  const guardrailBlocked = guardrail?.blocked === true;
  const guardrailBlockedReason = typeof guardrail?.blockedReason === "string"
    ? guardrail.blockedReason
    : "";
  const organizationActiveAgentCount = Number.isFinite(guardrail?.organizationActiveAgentCount)
    ? Number(guardrail.organizationActiveAgentCount)
    : 0;
  const organizationActiveAgentLimit = Number.isFinite(guardrail?.organizationActiveAgentLimit)
    ? Number(guardrail.organizationActiveAgentLimit)
    : 0;
  const roleActiveAgentCount = Number.isFinite(guardrail?.roleActiveAgentCount)
    ? Number(guardrail.roleActiveAgentCount)
    : 0;
  const roleActiveAgentLimit = Number.isFinite(guardrail?.roleActiveAgentLimit)
    ? Number(guardrail.roleActiveAgentLimit)
    : 0;
  const auditFacts = isRecord(suggestion?.auditFacts) ? suggestion.auditFacts : null;
  const creationReason = typeof auditFacts?.creationReason === "string"
    ? auditFacts.creationReason
    : rationale;
  const namingBasis = typeof auditFacts?.namingBasis === "string"
    ? auditFacts.namingBasis
    : "";
  const approving = suggestionId && approvingSpawnSuggestionId === suggestionId;
  const ignoring = suggestionId && ignoringSpawnSuggestionId === suggestionId;
  const rejecting = suggestionId && rejectingSpawnSuggestionId === suggestionId;
  const approveDisabled = !suggestionId || busy || guardrailBlocked;
  const governanceDisabled = !suggestionId || busy;

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div>
          <h4>${escapeHtml(displayName)}</h4>
          <p class="agent-card-copy">${escapeHtml(departmentRole)} · 建议由 ${escapeHtml(supportingAgent)} 负责带教</p>
        </div>
        <span class="agent-status-pill ${guardrailBlocked ? "warning" : "active"}">${guardrailBlocked ? "护栏阻止" : "建议创建"}</span>
      </div>
      <p class="agent-card-copy">${escapeHtml(creationReason)}</p>
      <p class="agent-card-copy">未完成任务 ${openWorkItemCount} · 等待治理 ${waitingWorkItemCount} · 高优 ${highPriorityWorkItemCount}</p>
      <p class="agent-card-copy">组织活跃 agent ${organizationActiveAgentCount}/${organizationActiveAgentLimit} · 同角色 ${roleActiveAgentCount}/${roleActiveAgentLimit}</p>
      ${guardrailBlockedReason ? `<p class="agent-card-copy">${escapeHtml(guardrailBlockedReason)}</p>` : ""}
      ${namingBasis ? `<p class="agent-card-copy">${escapeHtml(namingBasis)}</p>` : ""}
      <div class="agent-mailbox-actions">
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-spawn-approve="${escapeHtml(suggestionId)}"
          ${approveDisabled ? "disabled" : ""}
        >${approving ? "创建中..." : guardrailBlocked ? "当前不能创建" : "按建议创建"}</button>
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-spawn-ignore="${escapeHtml(suggestionId)}"
          ${governanceDisabled ? "disabled" : ""}
        >${ignoring ? "忽略中..." : "先忽略"}</button>
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-spawn-reject="${escapeHtml(suggestionId)}"
          ${governanceDisabled ? "disabled" : ""}
        >${rejecting ? "拒绝中..." : "拒绝"}</button>
      </div>
    </article>
  `;
}

function renderSuppressedAgentSpawnSuggestionCard(suggestion, {
  busy,
  restoringSpawnSuggestionId,
  escapeHtml,
  formatRelativeTime,
}) {
  const suggestionId = typeof suggestion?.suggestionId === "string" ? suggestion.suggestionId : "";
  const displayName = typeof suggestion?.displayName === "string" ? suggestion.displayName : "待命名 agent";
  const departmentRole = typeof suggestion?.departmentRole === "string" ? suggestion.departmentRole : "未知职责";
  const supportingAgent = typeof suggestion?.supportingAgentDisplayName === "string"
    ? suggestion.supportingAgentDisplayName
    : "当前团队";
  const suppressionState = typeof suggestion?.suppressionState === "string" ? suggestion.suppressionState : "ignored";
  const badgeLabel = suppressionState === "rejected" ? "已拒绝" : "已忽略";
  const restorePending = suggestionId && restoringSpawnSuggestionId === suggestionId;
  const updatedAt = typeof suggestion?.updatedAt === "string" ? suggestion.updatedAt : "";
  const reason = isRecord(suggestion?.auditFacts) && typeof suggestion.auditFacts.creationReason === "string"
    ? suggestion.auditFacts.creationReason
    : typeof suggestion?.rationale === "string"
      ? suggestion.rationale
      : "当前没有保留建议理由。";

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div>
          <h4>${escapeHtml(displayName)}</h4>
          <p class="agent-card-copy">${escapeHtml(departmentRole)} · 原建议由 ${escapeHtml(supportingAgent)} 带教</p>
        </div>
        <span class="agent-status-pill warning">${escapeHtml(badgeLabel)}</span>
      </div>
      <p class="agent-card-copy">${escapeHtml(reason)}</p>
      ${updatedAt ? `<p class="agent-card-copy">最近治理：${escapeHtml(formatRelativeTime(updatedAt) || updatedAt)}</p>` : ""}
      <div class="agent-mailbox-actions">
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-spawn-restore="${escapeHtml(suggestionId)}"
          ${!suggestionId || busy ? "disabled" : ""}
        >${restorePending ? "恢复中..." : "恢复建议"}</button>
      </div>
    </article>
  `;
}

function renderAgentSpawnAuditLogCard(auditLog, {
  escapeHtml,
  formatRelativeTime,
}) {
  const eventType = typeof auditLog?.eventType === "string" ? auditLog.eventType : "";
  const displayName = typeof auditLog?.displayName === "string" ? auditLog.displayName : "待命名 agent";
  const departmentRole = typeof auditLog?.departmentRole === "string" ? auditLog.departmentRole : "未知职责";
  const summary = typeof auditLog?.summary === "string" ? auditLog.summary : "当前没有审计摘要。";
  const supportingAgentDisplayName = typeof auditLog?.supportingAgentDisplayName === "string"
    ? auditLog.supportingAgentDisplayName
    : "";
  const auditFacts = isRecord(auditLog?.auditFacts) ? auditLog.auditFacts : null;
  const guardrail = isRecord(auditLog?.guardrail) ? auditLog.guardrail : null;
  const badgeLabel = eventType === "spawn_suggestion_blocked"
    ? "护栏拦截"
    : eventType === "spawn_suggestion_ignored"
      ? "已忽略"
      : eventType === "spawn_suggestion_rejected"
        ? "已拒绝"
        : eventType === "spawn_suggestion_restored"
          ? "已恢复"
          : "已批准";
  const badgeClass = eventType === "spawn_suggestion_blocked"
    || eventType === "spawn_suggestion_ignored"
    || eventType === "spawn_suggestion_rejected"
    ? "warning"
    : "active";
  const guardrailText = guardrail
    ? `组织活跃 agent ${Number.isFinite(guardrail.organizationActiveAgentCount) ? Number(guardrail.organizationActiveAgentCount) : 0}/${Number.isFinite(guardrail.organizationActiveAgentLimit) ? Number(guardrail.organizationActiveAgentLimit) : 0} · 同角色 ${Number.isFinite(guardrail.roleActiveAgentCount) ? Number(guardrail.roleActiveAgentCount) : 0}/${Number.isFinite(guardrail.roleActiveAgentLimit) ? Number(guardrail.roleActiveAgentLimit) : 0}`
    : "";

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div>
          <h4>${escapeHtml(displayName)}</h4>
          <p class="agent-card-copy">${escapeHtml(departmentRole)}${supportingAgentDisplayName ? ` · 来源 ${escapeHtml(supportingAgentDisplayName)}` : ""}</p>
        </div>
        <span class="agent-status-pill ${badgeClass}">${escapeHtml(badgeLabel)}</span>
      </div>
      <p class="agent-card-copy">${escapeHtml(summary)}</p>
      ${typeof auditFacts?.expectedScope === "string" ? `<p class="agent-card-copy">${escapeHtml(auditFacts.expectedScope)}</p>` : ""}
      ${guardrailText ? `<p class="agent-card-copy">${escapeHtml(guardrailText)}</p>` : ""}
      <p class="agent-card-copy">记录时间：${escapeHtml(formatRelativeTime(auditLog?.createdAt))}</p>
    </article>
  `;
}

function renderAgentIdleRecoverySuggestionCard(suggestion, {
  busy,
  approvingIdleRecoverySuggestionId,
  escapeHtml,
}) {
  const suggestionId = typeof suggestion?.suggestionId === "string" ? suggestion.suggestionId : "";
  const displayName = typeof suggestion?.displayName === "string" ? suggestion.displayName : "待命名 agent";
  const departmentRole = typeof suggestion?.departmentRole === "string" ? suggestion.departmentRole : "未知职责";
  const recommendedAction = typeof suggestion?.recommendedAction === "string" ? suggestion.recommendedAction : "pause";
  const idleHours = Number.isFinite(suggestion?.idleHours) ? Number(suggestion.idleHours) : 0;
  const lastActivitySummary = typeof suggestion?.lastActivitySummary === "string"
    ? suggestion.lastActivitySummary
    : "当前没有记录最近活动。";
  const rationale = typeof suggestion?.rationale === "string"
    ? suggestion.rationale
    : "当前没有记录空闲回收原因。";
  const openWorkItemCount = Number.isFinite(suggestion?.openWorkItemCount) ? Number(suggestion.openWorkItemCount) : 0;
  const pendingMailboxCount = Number.isFinite(suggestion?.pendingMailboxCount) ? Number(suggestion.pendingMailboxCount) : 0;
  const recentClosedWorkItemCount = Number.isFinite(suggestion?.recentClosedWorkItemCount)
    ? Number(suggestion.recentClosedWorkItemCount)
    : 0;
  const recentHandoffCount = Number.isFinite(suggestion?.recentHandoffCount) ? Number(suggestion.recentHandoffCount) : 0;
  const approving = suggestionId && approvingIdleRecoverySuggestionId === suggestionId;

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div>
          <h4>${escapeHtml(displayName)}</h4>
          <p class="agent-card-copy">${escapeHtml(departmentRole)} · ${escapeHtml(recommendedAction === "archive" ? "建议归档" : "建议暂停")}</p>
        </div>
        <span class="agent-status-pill warning">${escapeHtml(recommendedAction === "archive" ? "建议归档" : "建议暂停")}</span>
      </div>
      <p class="agent-card-copy">${escapeHtml(rationale)}</p>
      <p class="agent-card-copy">连续空闲 ${idleHours} 小时 · 未完成任务 ${openWorkItemCount} · 待处理 mailbox ${pendingMailboxCount}</p>
      <p class="agent-card-copy">近 30 天已收口任务 ${recentClosedWorkItemCount} · handoff ${recentHandoffCount}</p>
      <p class="agent-card-copy">${escapeHtml(lastActivitySummary)}</p>
      <div class="agent-mailbox-actions">
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-idle-approve="${escapeHtml(suggestionId)}"
          ${!suggestionId || busy ? "disabled" : ""}
        >${approving ? "处理中..." : recommendedAction === "archive" ? "按建议归档" : "按建议暂停"}</button>
      </div>
    </article>
  `;
}

function renderAgentIdleRecoveryAuditLogCard(auditLog, {
  escapeHtml,
  formatRelativeTime,
}) {
  const eventType = typeof auditLog?.eventType === "string" ? auditLog.eventType : "";
  const displayName = typeof auditLog?.displayName === "string" ? auditLog.displayName : "待命名 agent";
  const departmentRole = typeof auditLog?.departmentRole === "string" ? auditLog.departmentRole : "未知职责";
  const summary = typeof auditLog?.summary === "string" ? auditLog.summary : "当前没有审计摘要。";
  const badgeLabel = eventType === "idle_recovery_archive_approved" ? "已归档" : "已暂停";
  const idleHours = Number.isFinite(auditLog?.idleHours) ? Number(auditLog.idleHours) : 0;

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div>
          <h4>${escapeHtml(displayName)}</h4>
          <p class="agent-card-copy">${escapeHtml(departmentRole)} · 连续空闲 ${idleHours} 小时</p>
        </div>
        <span class="agent-status-pill warning">${escapeHtml(badgeLabel)}</span>
      </div>
      <p class="agent-card-copy">${escapeHtml(summary)}</p>
      <p class="agent-card-copy">记录时间：${escapeHtml(formatRelativeTime(auditLog?.createdAt))}</p>
    </article>
  `;
}

function renderAgentCard(agent, { selected, escapeHtml, formatRelativeTime }) {
  const status = resolveAgentStatus(agent?.status);
  const role = typeof agent?.departmentRole === "string" ? agent.departmentRole : "未分类";
  const mission = typeof agent?.mission === "string" && agent.mission.trim()
    ? agent.mission
    : "还没有填写使命说明。";

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div class="agent-card-heading">
          <h4>${escapeHtml(agent?.displayName || role)}</h4>
          <p class="agent-card-copy">${escapeHtml(mission)}</p>
        </div>
        <div class="agent-pill-row">
          <span class="badge ${escapeHtml(resolveStatusTone(status))}">${escapeHtml(resolveAgentStatusLabel(status))}</span>
          <span class="agent-pill">${escapeHtml(role)}</span>
        </div>
      </div>
      <div class="agent-meta-grid">
        ${renderAgentMetaItem("创建方式", agent?.creationMode || "manual", escapeHtml)}
        ${renderAgentMetaItem("自治级别", agent?.autonomyLevel || "bounded", escapeHtml)}
        ${renderAgentMetaItem("暴露策略", agent?.exposurePolicy || "gateway_only", escapeHtml)}
        ${renderAgentMetaItem("最近更新", formatRelativeTime(agent?.updatedAt), escapeHtml)}
      </div>
      <div class="agent-card-actions">
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-select="${escapeHtml(agent?.agentId || "")}"
        >
          ${selected ? "当前查看中" : "查看详情"}
        </button>
      </div>
    </article>
  `;
}

function renderAgentHandoffCard(handoff, { selectedAgentId, escapeHtml, formatRelativeTime }) {
  const outgoing = handoff?.fromAgentId === selectedAgentId;
  const blockers = Array.isArray(handoff?.blockers) ? handoff.blockers : [];
  const recommendedNextActions = Array.isArray(handoff?.recommendedNextActions) ? handoff.recommendedNextActions : [];
  const attachedArtifacts = Array.isArray(handoff?.attachedArtifacts) ? handoff.attachedArtifacts : [];
  const counterpartyLabel = typeof handoff?.counterpartyDisplayName === "string" && handoff.counterpartyDisplayName.trim()
    ? handoff.counterpartyDisplayName
    : outgoing
      ? typeof handoff?.toAgentDisplayName === "string" && handoff.toAgentDisplayName.trim()
        ? handoff.toAgentDisplayName
        : typeof handoff?.toAgentId === "string"
          ? handoff.toAgentId
          : "未知 agent"
      : typeof handoff?.fromAgentDisplayName === "string" && handoff.fromAgentDisplayName.trim()
        ? handoff.fromAgentDisplayName
        : typeof handoff?.fromAgentId === "string"
          ? handoff.fromAgentId
        : "未知 agent";

  return `
    <article class="agent-card">
      <div class="agent-card-head">
        <div>
          <h4>${escapeHtml(outgoing ? "发起交接" : "收到交接")}</h4>
          <p class="agent-card-copy">${escapeHtml(outgoing ? `交给 ${counterpartyLabel}` : `来自 ${counterpartyLabel}`)}</p>
        </div>
        <span class="agent-status-pill warning">${escapeHtml("handoff")}</span>
      </div>
      <p class="agent-card-copy">${escapeHtml(handoff?.summary || "当前没有 handoff 摘要。")}</p>
      ${blockers.length ? `<p class="agent-card-copy">阻塞：${escapeHtml(blockers.join("；"))}</p>` : ""}
      ${recommendedNextActions.length ? `<p class="agent-card-copy">下一步：${escapeHtml(recommendedNextActions.join("；"))}</p>` : ""}
      ${attachedArtifacts.length ? `<p class="agent-card-copy">附件：${escapeHtml(attachedArtifacts.join("，"))}</p>` : ""}
      <div class="agent-meta-grid">
        ${renderAgentMetaItem("workItem", handoff?.workItemId || "未知", escapeHtml)}
        ${renderAgentMetaItem("时间", formatRelativeTime(handoff?.createdAt), escapeHtml)}
      </div>
    </article>
  `;
}

function renderAgentTimelineEntryCard(entry, { escapeHtml, formatRelativeTime }) {
  const kind = typeof entry?.kind === "string" ? entry.kind : "response";
  const counterparty = typeof entry?.counterpartyDisplayName === "string" && entry.counterpartyDisplayName.trim()
    ? ` · ${entry.counterpartyDisplayName}`
    : "";

  return `
    <article class="agent-card agent-card-compact agent-timeline-card">
      <div class="agent-card-head">
        <div class="agent-card-heading">
          <h4>${escapeHtml(entry?.title || "时间线事件")}</h4>
          <p class="agent-card-copy">${escapeHtml(entry?.summary || "当前没有事件摘要。")}</p>
        </div>
        <div class="agent-pill-row">
          <span class="badge ${escapeHtml(resolveTimelineTone(kind))}">${escapeHtml(resolveTimelineKindLabel(kind))}</span>
        </div>
      </div>
      <div class="agent-meta-grid">
        ${renderAgentMetaItem("时间", formatRelativeTime(entry?.at), escapeHtml)}
        ${renderAgentMetaItem("workItem", `${entry?.workItemId || "无"}${counterparty}`, escapeHtml)}
      </div>
    </article>
  `;
}

function renderAgentMetaGrid({
  selectedAgent,
  principal,
  organization,
  handoffCount,
  workItemCount,
  mailboxCount,
  lifecycleUpdatingAgentId,
  lifecycleUpdatingAction,
  busy,
  escapeHtml,
}) {
  const status = resolveAgentStatus(selectedAgent?.status);
  const agentId = selectedAgent?.agentId || "";
  const updatingThisAgent = agentId && agentId === lifecycleUpdatingAgentId;

  return [
    renderAgentMetaItem("职责", selectedAgent?.departmentRole || "未分类", escapeHtml),
    renderAgentMetaItem("状态", resolveAgentStatusLabel(status), escapeHtml),
    renderAgentMetaItem("建档", resolveAgentBootstrapLabel(selectedAgent?.bootstrapProfile), escapeHtml),
    renderAgentMetaItem("Organization", organization?.displayName || organization?.organizationId || "未绑定", escapeHtml),
    renderAgentMetaItem("Principal", principal?.principalId || selectedAgent?.principalId || "未知", escapeHtml),
    renderAgentMetaItem("Handoffs", String(handoffCount ?? 0), escapeHtml),
    renderAgentMetaItem("Work Items", String(workItemCount ?? 0), escapeHtml),
    renderAgentMetaItem("Mailbox", String(mailboxCount ?? 0), escapeHtml),
    renderAgentLifecycleActions({
      agentId,
      status,
      updatingThisAgent,
      lifecycleUpdatingAction,
      busy,
      escapeHtml,
    }),
  ].join("");
}

function renderAgentMetaItem(label, value, escapeHtml) {
  return `
    <div class="agent-meta-item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function resolveTimelineKindLabel(kind) {
  switch (kind) {
    case "handoff":
      return "交接";
    case "dispatch":
      return "派工";
    case "waiting":
      return "等待";
    case "governance":
      return "治理";
    case "delivery":
      return "收口";
    case "cancellation":
      return "取消";
    default:
      return "回复";
  }
}

function resolveTimelineTone(kind) {
  switch (kind) {
    case "handoff":
      return "warning";
    case "waiting":
    case "governance":
      return "caution";
    case "delivery":
      return "ok";
    case "cancellation":
      return "danger";
    default:
      return "neutral";
  }
}

function renderAgentLifecycleActions({
  agentId,
  status,
  updatingThisAgent,
  lifecycleUpdatingAction,
  busy,
  escapeHtml,
}) {
  if (!agentId) {
    return "";
  }

  const actions = status === "paused"
    ? ["resume", "archive"]
    : status === "archived"
      ? []
      : ["pause", "archive"];
  const helperCopy = status === "archived"
    ? "这个 agent 已归档，不再接收新任务，也不会再被 scheduler claim。"
    : "暂停后不会再被 scheduler claim 新任务；归档后仍可查看历史，但不再接收新任务。";

  return `
    <div class="agent-block">
      <p class="agent-block-title">治理动作</p>
      <div class="settings-stack">
        <p class="settings-section-copy">${escapeHtml(helperCopy)}</p>
        ${actions.length ? `
          <div class="agent-card-actions">
            ${actions.map((action) => `
              <button
                type="button"
                class="${action === "archive" ? "ghost-button" : "toolbar-button subtle"}"
                data-agent-lifecycle-action="${escapeHtml(action)}"
                data-agent-lifecycle-agent-id="${escapeHtml(agentId)}"
                ${busy ? "disabled" : ""}
              >
                ${escapeHtml(resolveAgentLifecycleButtonLabel(action, updatingThisAgent && lifecycleUpdatingAction === action))}
              </button>
            `).join("")}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function renderAgentWorkItemCard(workItem, { selected, escapeHtml, formatRelativeTime }) {
  const status = resolveWorkItemStatus(workItem?.status);
  const priority = resolvePriority(workItem?.priority);

  return `
    <article class="agent-card agent-card-compact">
      <div class="agent-card-head">
        <div class="agent-card-heading">
          <h4>${escapeHtml(workItem?.goal || workItem?.dispatchReason || "未命名 work item")}</h4>
          <p class="agent-card-copy">${escapeHtml(workItem?.dispatchReason || "没有额外派工原因。")}</p>
        </div>
        <div class="agent-pill-row">
          <span class="badge ${escapeHtml(resolveStatusTone(status))}">${escapeHtml(resolveWorkItemStatusLabel(status))}</span>
          <span class="agent-pill">${escapeHtml(resolvePriorityLabel(priority))}</span>
        </div>
      </div>
      <div class="agent-meta-grid">
        ${renderAgentMetaItem("来源", resolveSourceTypeLabel(workItem?.sourceType), escapeHtml)}
        ${renderAgentMetaItem("创建时间", formatRelativeTime(workItem?.createdAt), escapeHtml)}
        ${renderAgentMetaItem("workItemId", workItem?.workItemId || "未知", escapeHtml)}
      </div>
      <div class="agent-card-actions">
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-work-item-select="${escapeHtml(workItem?.workItemId || "")}"
        >
          ${selected ? "正在查看详情" : "查看详情"}
        </button>
      </div>
    </article>
  `;
}

function renderAgentWorkItemDetail(detail, {
  loading,
  busy,
  cancelingWorkItemId,
  respondingWorkItemId,
  humanResponseDraft,
  escapeHtml,
}) {
  if (loading) {
    return '<div class="settings-section-copy">正在读取 work item 详情。</div>';
  }

  if (!detail?.workItem) {
    return '<div class="settings-section-copy">选择一条 work item 后，这里会显示上下文包和内部消息。</div>';
  }

  const contextPacket = renderJsonBlock(detail.workItem.contextPacket, escapeHtml);
  const waitingAction = detail.workItem.waitingActionRequest;
  const latestHumanResponse = detail.workItem.latestHumanResponse;
  const messages = Array.isArray(detail.messages) ? detail.messages : [];
  const waitingHuman = detail.workItem.status === "waiting_human";
  const waitingActionBlock = renderWaitingActionBlock(waitingAction, escapeHtml);
  const latestHumanResponseBlock = renderLatestHumanResponseBlock(latestHumanResponse, escapeHtml);
  const decisionChoices = Array.isArray(waitingAction?.choices)
    ? waitingAction.choices.filter((choice) => choice === "approve" || choice === "deny")
    : [];
  const showDecisionSelect = waitingHuman && decisionChoices.length > 0;
  const currentDraft = humanResponseDraft ?? { decision: "", inputText: "" };
  const cancellable = canCancelWorkItem(detail.workItem);
  const cancelDisabled = busy || detail.workItem.workItemId === cancelingWorkItemId;
  const submitDisabled = busy || detail.workItem.workItemId === respondingWorkItemId;
  const parentWorkItemBlock = renderParentWorkItemBlock(detail.parentWorkItem, detail.parentTargetAgent, escapeHtml);
  const childWorkItemsBlock = renderChildWorkItemSummaryBlock(detail.childSummary, detail.childWorkItems, escapeHtml);

  return `
    <article class="agent-detail-shell">
      <div class="tool-group-head">
        <h4>Work Item Detail</h4>
        <span class="meta-label">${escapeHtml(detail.workItem.workItemId || "")}</span>
      </div>
      <div class="settings-stack">
        <p class="settings-section-copy">${escapeHtml(detail.workItem.goal || "没有目标说明。")}</p>
        <div class="agent-meta-grid">
          ${renderAgentMetaItem("目标 agent", detail.targetAgent?.displayName || detail.targetAgent?.agentId || "未知", escapeHtml)}
          ${renderAgentMetaItem("来源 principal", detail.sourcePrincipal?.principalId || "未知", escapeHtml)}
          ${renderAgentMetaItem("来源 agent", detail.sourceAgent?.displayName || detail.sourceAgent?.agentId || "human / system", escapeHtml)}
          ${renderAgentMetaItem("状态", resolveWorkItemStatusLabel(resolveWorkItemStatus(detail.workItem.status)), escapeHtml)}
        </div>
        ${parentWorkItemBlock}
        ${childWorkItemsBlock}
        ${contextPacket ? `
          <div class="agent-block">
            <p class="agent-block-title">上下文包</p>
            ${contextPacket}
          </div>
        ` : ""}
        ${waitingActionBlock}
        ${latestHumanResponseBlock}
        ${cancellable ? `
          <div class="agent-block">
            <p class="agent-block-title">治理动作</p>
            <div class="settings-stack">
              <p class="settings-section-copy">这条 work item 目前还在安全可收口范围内。取消后会关闭旧 mailbox，并把状态收口成 cancelled。</p>
              <div class="agent-card-actions">
                <button
                  type="button"
                  class="toolbar-button subtle"
                  data-agent-work-item-cancel="${escapeHtml(detail.workItem.workItemId || "")}"
                  ${cancelDisabled ? "disabled" : ""}
                >
                  ${detail.workItem.workItemId === cancelingWorkItemId ? "取消中..." : "取消该 work item"}
                </button>
              </div>
            </div>
          </div>
        ` : ""}
        ${waitingHuman ? `
          <div class="agent-block">
            <p class="agent-block-title">顶层治理回复</p>
            <div class="settings-stack">
              <p class="settings-section-copy">子 agent 不直接对人。这里提交的是治理回复，提交后会把当前 work item 重新排回队列继续执行。</p>
              ${showDecisionSelect ? `
                <label class="settings-field">
                  <span>审批结果</span>
                  <select data-agent-human-decision ${submitDisabled ? "disabled" : ""}>
                    <option value="">请选择</option>
                    <option value="approve" ${currentDraft.decision === "approve" ? "selected" : ""}>approve</option>
                    <option value="deny" ${currentDraft.decision === "deny" ? "selected" : ""}>deny</option>
                  </select>
                </label>
              ` : ""}
              <label class="settings-field">
                <span>补充说明</span>
                <textarea
                  rows="4"
                  data-agent-human-input
                  placeholder="例如：可以继续发布，但要先补 release note。"
                  ${submitDisabled ? "disabled" : ""}
                >${escapeHtml(currentDraft.inputText || "")}</textarea>
              </label>
              <div class="agent-card-actions">
                <button
                  type="button"
                  class="toolbar-button subtle"
                  data-agent-human-respond="${escapeHtml(detail.workItem.workItemId || "")}"
                  ${submitDisabled ? "disabled" : ""}
                >
                  ${detail.workItem.workItemId === respondingWorkItemId ? "提交中..." : "提交治理回复"}
                </button>
              </div>
            </div>
          </div>
        ` : ""}
        <div class="agent-block">
          <p class="agent-block-title">内部消息</p>
          <div class="agent-message-list">
            ${messages.length
              ? messages.map((message) => `
                <article class="agent-message-card">
                  <div class="agent-card-head">
                    <div class="agent-card-heading">
                      <h4>${escapeHtml(resolveMessageTypeLabel(message?.messageType))}</h4>
                      <p class="agent-card-copy">${escapeHtml(renderMessageSummary(message))}</p>
                    </div>
                    <span class="agent-pill">${escapeHtml(resolvePriorityLabel(resolvePriority(message?.priority)))}</span>
                  </div>
                </article>
              `).join("")
              : '<p class="settings-section-copy">这条 work item 还没有结构化内部消息。</p>'}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderParentWorkItemBlock(parentWorkItem, parentTargetAgent, escapeHtml) {
  if (!isRecord(parentWorkItem)) {
    return "";
  }

  return `
    <div class="agent-block">
      <p class="agent-block-title">父任务</p>
      <div class="settings-stack">
        <p class="settings-section-copy">${escapeHtml(parentWorkItem.goal || parentWorkItem.dispatchReason || "当前父任务没有额外说明。")}</p>
        <div class="agent-meta-grid">
          ${renderAgentMetaItem("父 workItem", parentWorkItem.workItemId || "未知", escapeHtml)}
          ${renderAgentMetaItem("负责人", parentTargetAgent?.displayName || parentTargetAgent?.agentId || "未知", escapeHtml)}
          ${renderAgentMetaItem("状态", resolveWorkItemStatusLabel(resolveWorkItemStatus(parentWorkItem.status)), escapeHtml)}
        </div>
      </div>
    </div>
  `;
}

function renderChildWorkItemSummaryBlock(summaryValue, childItemsValue, escapeHtml) {
  const summary = normalizeChildWorkItemSummary(summaryValue);
  const childItems = Array.isArray(childItemsValue)
    ? childItemsValue.filter((item) => isRecord(item) && isRecord(item.workItem))
    : [];

  if (summary.totalCount <= 0 && childItems.length === 0) {
    return "";
  }

  return `
    <div class="agent-block">
      <p class="agent-block-title">下游协作汇总</p>
      <div class="settings-stack">
        <p class="settings-section-copy">当前 work item 已派出 ${escapeHtml(String(summary.totalCount))} 条下游子任务，这里汇总它们的收口进展。</p>
        <div class="agent-meta-grid">
          ${renderAgentMetaItem("总数", String(summary.totalCount), escapeHtml)}
          ${renderAgentMetaItem("进行中", String(summary.openCount), escapeHtml)}
          ${renderAgentMetaItem("等待中", String(summary.waitingCount), escapeHtml)}
          ${renderAgentMetaItem("已完成", String(summary.completedCount), escapeHtml)}
          ${renderAgentMetaItem("失败", String(summary.failedCount), escapeHtml)}
          ${renderAgentMetaItem("已取消", String(summary.cancelledCount), escapeHtml)}
        </div>
        <div class="agent-message-list">
          ${childItems.length
            ? childItems.map((item) => {
              const childWorkItem = item.workItem;
              const childTargetAgent = isRecord(item.targetAgent) ? item.targetAgent : null;
              const latestHandoff = isRecord(item.latestHandoff) ? item.latestHandoff : null;

              return `
                <article class="agent-message-card">
                  <div class="agent-card-head">
                    <div class="agent-card-heading">
                      <h4>${escapeHtml(childTargetAgent?.displayName || childTargetAgent?.agentId || childWorkItem.targetAgentId || "未知 agent")}</h4>
                      <p class="agent-card-copy">${escapeHtml(childWorkItem.goal || childWorkItem.dispatchReason || "当前子任务没有额外说明。")}</p>
                    </div>
                    <span class="badge ${escapeHtml(resolveStatusTone(resolveWorkItemStatus(childWorkItem.status)))}">${escapeHtml(resolveWorkItemStatusLabel(resolveWorkItemStatus(childWorkItem.status)))}</span>
                  </div>
                  <div class="agent-meta-grid">
                    ${renderAgentMetaItem("子 workItem", childWorkItem.workItemId || "未知", escapeHtml)}
                    ${renderAgentMetaItem("优先级", resolvePriorityLabel(resolvePriority(childWorkItem.priority)), escapeHtml)}
                  </div>
                  ${latestHandoff?.summary
                    ? `<p class="agent-card-copy">最新 handoff：${escapeHtml(latestHandoff.summary)}</p>`
                    : ""}
                </article>
              `;
            }).join("")
            : '<p class="settings-section-copy">当前还没有下游子任务。</p>'}
        </div>
      </div>
    </div>
  `;
}

function normalizeChildWorkItemSummary(value) {
  if (!isRecord(value)) {
    return {
      totalCount: 0,
      openCount: 0,
      waitingCount: 0,
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
    };
  }

  return {
    totalCount: Number.isFinite(value.totalCount) ? Number(value.totalCount) : 0,
    openCount: Number.isFinite(value.openCount) ? Number(value.openCount) : 0,
    waitingCount: Number.isFinite(value.waitingCount) ? Number(value.waitingCount) : 0,
    completedCount: Number.isFinite(value.completedCount) ? Number(value.completedCount) : 0,
    failedCount: Number.isFinite(value.failedCount) ? Number(value.failedCount) : 0,
    cancelledCount: Number.isFinite(value.cancelledCount) ? Number(value.cancelledCount) : 0,
  };
}

function renderWaitingActionBlock(waitingAction, escapeHtml) {
  if (!waitingAction || typeof waitingAction !== "object") {
    return "";
  }

  const prompt = typeof waitingAction.prompt === "string" ? waitingAction.prompt : "";
  const actionType = typeof waitingAction.actionType === "string" ? waitingAction.actionType : "unknown";
  const choices = Array.isArray(waitingAction.choices)
    ? waitingAction.choices.filter((choice) => typeof choice === "string" && choice.trim())
    : [];
  const inputSchema = renderJsonBlock(waitingAction.inputSchema, escapeHtml);

  return `
    <div class="agent-block">
      <p class="agent-block-title">等待中的治理请求</p>
      <div class="settings-stack">
        <p class="settings-section-copy">${escapeHtml(prompt || "当前等待请求没有额外说明。")}</p>
        <div class="agent-meta-grid">
          ${renderAgentMetaItem("类型", actionType, escapeHtml)}
          ${renderAgentMetaItem("候选项", choices.length ? choices.join(", ") : "无", escapeHtml)}
        </div>
        ${inputSchema ? `
          <div>
            <p class="agent-block-title">输入约束</p>
            ${inputSchema}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function renderLatestHumanResponseBlock(latestHumanResponse, escapeHtml) {
  const rendered = renderJsonBlock(latestHumanResponse, escapeHtml);

  if (!rendered) {
    return "";
  }

  return `
    <div class="agent-block">
      <p class="agent-block-title">最近一次治理回复</p>
      ${rendered}
    </div>
  `;
}

function renderAgentMailboxCard(item, { busy, ackingMailboxEntryId, escapeHtml, formatRelativeTime }) {
  const entry = item?.entry ?? {};
  const message = item?.message ?? {};
  const ackable = entry.status !== "acked";

  return `
    <article class="agent-card agent-card-compact">
      <div class="agent-card-head">
        <div class="agent-card-heading">
          <h4>${escapeHtml(resolveMessageTypeLabel(message.messageType))}</h4>
          <p class="agent-card-copy">${escapeHtml(renderMessageSummary(message))}</p>
        </div>
        <div class="agent-pill-row">
          <span class="badge ${escapeHtml(resolveStatusTone(resolveMailboxStatus(entry.status)))}">${escapeHtml(resolveMailboxStatusLabel(resolveMailboxStatus(entry.status)))}</span>
          <span class="agent-pill">${escapeHtml(resolvePriorityLabel(resolvePriority(entry.priority || message.priority)))}</span>
        </div>
      </div>
      <div class="agent-meta-grid">
        ${renderAgentMetaItem("messageId", message.messageId || "未知", escapeHtml)}
        ${renderAgentMetaItem("workItem", message.workItemId || entry.workItemId || "无", escapeHtml)}
        ${renderAgentMetaItem("可见时间", formatRelativeTime(entry.availableAt), escapeHtml)}
      </div>
      <div class="agent-card-actions">
        <button
          type="button"
          class="toolbar-button subtle"
          data-agent-mailbox-ack="${escapeHtml(entry.mailboxEntryId || "")}"
          data-agent-mailbox-owner-id="${escapeHtml(entry.ownerAgentId || "")}"
          ${!ackable || busy ? "disabled" : ""}
        >
          ${entry.mailboxEntryId === ackingMailboxEntryId ? "确认中..." : ackable ? "确认消息" : "已确认"}
        </button>
      </div>
    </article>
  `;
}

function renderJsonBlock(value, escapeHtml) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `<pre class="agent-code-block">${escapeHtml(rendered)}</pre>`;
}

function renderMessageSummary(message) {
  const payload = message?.payload;

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  if (payload && typeof payload === "object") {
    if (typeof payload.goal === "string" && payload.goal.trim()) {
      return payload.goal.trim();
    }

    if (typeof payload.question === "string" && payload.question.trim()) {
      return payload.question.trim();
    }

    if (typeof payload.dispatchReason === "string" && payload.dispatchReason.trim()) {
      return payload.dispatchReason.trim();
    }
  }

  return "没有额外摘要。";
}

function resolveWaitingQueueItemSummary(workItem, latestWaitingMessage) {
  const prompt = typeof workItem?.waitingActionRequest?.prompt === "string"
    ? workItem.waitingActionRequest.prompt.trim()
    : "";
  const messageSummary = latestWaitingMessage ? renderMessageSummary(latestWaitingMessage) : "";
  const goal = typeof workItem?.goal === "string" ? workItem.goal.trim() : "";

  return prompt || messageSummary || goal || "当前等待项没有额外摘要。";
}

function resolveWaitingAttentionLabel(workItem, latestWaitingMessage) {
  if (workItem?.status === "waiting_human") {
    return "顶层治理";
  }

  if (latestWaitingMessage?.messageType === "approval_request") {
    return "审批请求";
  }

  if (latestWaitingMessage?.messageType === "question") {
    return "等待回复";
  }

  if (latestWaitingMessage?.messageType === "escalation") {
    return "升级阻塞";
  }

  return "待处理";
}

function resolveCollaborationAttentionLevel(level) {
  return ["normal", "attention", "urgent"].includes(level) ? level : "normal";
}

function resolveCollaborationAttentionLabel(level) {
  return {
    urgent: "紧急介入",
    attention: "需要关注",
    normal: "正常推进",
  }[resolveCollaborationAttentionLevel(level)] ?? "正常推进";
}

function resolveCollaborationActivityKindLabel(kind) {
  return {
    handoff: "最新交接",
    waiting: "最新等待",
    governance: "最新治理",
    work_item: "最近更新",
  }[typeof kind === "string" ? kind : "work_item"] ?? "最近更新";
}

function resolveAgentStatus(status) {
  return ["provisioning", "bootstrapping", "active", "paused", "degraded", "archived"].includes(status)
    ? status
    : "provisioning";
}

function resolveSelectedAgentCopy(agent) {
  const mission = typeof agent?.mission === "string" && agent.mission.trim()
    ? agent.mission.trim()
    : "这个 agent 还没有补充使命说明。";
  const bootstrapProfile = isRecord(agent?.bootstrapProfile) ? agent.bootstrapProfile : null;
  const bootstrapState = typeof bootstrapProfile?.state === "string" ? bootstrapProfile.state : "";
  const summary = typeof bootstrapProfile?.summary === "string" && bootstrapProfile.summary.trim()
    ? bootstrapProfile.summary.trim()
    : "";

  if (!bootstrapProfile) {
    return mission;
  }

  if (bootstrapState === "completed" && summary) {
    return `${mission} 当前建档摘要：${summary}`;
  }

  if (bootstrapState === "waiting_agent" || bootstrapState === "waiting_human") {
    return `${mission} 当前仍在做首次职责建档，正在等待上游补充信息。`;
  }

  if (bootstrapState === "failed" || bootstrapState === "cancelled") {
    return `${mission} 首次职责建档还没有成功收口，需要治理介入。`;
  }

  if (resolveAgentStatus(agent?.status) === "bootstrapping") {
    return `${mission} 当前正在做首次职责建档，还不能承接新的正式派工。`;
  }

  return mission;
}

function resolveAgentBootstrapLabel(bootstrapProfile) {
  const record = isRecord(bootstrapProfile) ? bootstrapProfile : null;
  const state = typeof record?.state === "string" ? record.state : "";

  return {
    pending: "建档进行中",
    waiting_human: "建档等治理",
    waiting_agent: "建档等上游",
    completed: "已完成建档",
    failed: "建档失败",
    cancelled: "建档取消",
  }[state] ?? "未建档";
}

function resolveAgentStatusLabel(status) {
  return {
    provisioning: "筹备中",
    bootstrapping: "建档中",
    active: "活跃",
    paused: "暂停",
    degraded: "降级",
    archived: "归档",
  }[status] ?? status;
}

function resolveWorkItemStatus(status) {
  return [
    "queued",
    "planning",
    "running",
    "waiting_human",
    "waiting_agent",
    "blocked",
    "handoff_pending",
    "completed",
    "failed",
    "cancelled",
  ].includes(status)
    ? status
    : "queued";
}

function resolveWorkItemStatusLabel(status) {
  return {
    queued: "排队中",
    planning: "规划中",
    running: "执行中",
    waiting_human: "等人类",
    waiting_agent: "等 agent",
    blocked: "阻塞",
    handoff_pending: "待交接",
    completed: "完成",
    failed: "失败",
    cancelled: "取消",
  }[status] ?? status;
}

function resolveMailboxStatus(status) {
  return ["pending", "leased", "acked"].includes(status) ? status : "pending";
}

function resolveMailboxStatusLabel(status) {
  return {
    pending: "待处理",
    leased: "处理中",
    acked: "已确认",
  }[status] ?? status;
}

function resolveAgentLifecycleButtonLabel(action, busy) {
  if (action === "pause") {
    return busy ? "暂停中..." : "暂停";
  }

  if (action === "resume") {
    return busy ? "恢复中..." : "恢复";
  }

  if (action === "archive") {
    return busy ? "归档中..." : "归档";
  }

  return action || "更新状态";
}

function resolveAgentLifecycleStatusMessage(action) {
  if (action === "pause") {
    return "正在暂停当前 agent。";
  }

  if (action === "resume") {
    return "正在恢复当前 agent。";
  }

  if (action === "archive") {
    return "正在归档当前 agent。";
  }

  return "正在更新 agent 生命周期状态。";
}

function resolvePriority(priority) {
  return ["low", "normal", "high", "urgent"].includes(priority) ? priority : "normal";
}

function resolvePriorityLabel(priority) {
  return {
    low: "低优先级",
    normal: "普通",
    high: "高优先级",
    urgent: "紧急",
  }[priority] ?? priority;
}

function resolveSourceTypeLabel(sourceType) {
  return {
    human: "human",
    agent: "agent",
    system: "system",
  }[sourceType] ?? "human";
}

function resolveMessageTypeLabel(messageType) {
  return {
    dispatch: "正式派工",
    status_update: "状态更新",
    question: "问题",
    answer: "回答",
    handoff: "交接",
    escalation: "升级",
    approval_request: "审批请求",
    approval_result: "审批结果",
    artifact_offer: "产物交付",
    cancel: "取消",
  }[messageType] ?? (messageType || "内部消息");
}

function resolveStatusTone(status) {
  if (["running", "queued", "planning", "waiting_human", "waiting_agent", "pending", "leased", "provisioning", "bootstrapping"].includes(status)) {
    return "busy";
  }

  if (["failed", "blocked", "degraded"].includes(status)) {
    return "error";
  }

  if (["cancelled", "paused", "archived", "acked"].includes(status)) {
    return "cancelled";
  }

  return "idle";
}

function resolveAttentionTone(level) {
  if (level === "urgent") {
    return "error";
  }

  if (level === "attention") {
    return "busy";
  }

  return "idle";
}

function canCancelWorkItem(workItem) {
  const status = resolveWorkItemStatus(workItem?.status);
  return ["queued", "planning", "running", "waiting_human", "waiting_agent", "blocked", "handoff_pending"].includes(status);
}

function resolveEmptyMemoryCandidatesLabel(candidatesState) {
  switch (resolveMemoryCandidatesFilterValue(candidatesState.filterStatus)) {
    case "approved":
      return "当前还没有已批准的长期记忆候选。";
    case "rejected":
      return "当前还没有已拒绝的长期记忆候选。";
    case "all":
      return candidatesState.includeArchived
        ? "当前还没有长期记忆候选。"
        : "当前没有未归档的长期记忆候选。";
    default:
      return "当前还没有待审核的长期记忆候选。";
  }
}

function renderMemoryCandidateCard(candidate, options) {
  const busy = options.busy;
  const escapeHtml = options.escapeHtml;
  const reviewingCandidateId = options.reviewingCandidateId;
  const formatRelativeTime = options.formatRelativeTime;
  const updatedAt = candidate.updatedAt ? formatRelativeTime(candidate.updatedAt) : "刚刚";
  const archived = Boolean(candidate.archivedAt);
  const candidateBusy = reviewingCandidateId && reviewingCandidateId === candidate.candidateId;
  const canReview = candidate.status === "suggested" && !archived;
  const archiveDisabled = busy || archived;

  return `
    <article class="memory-candidate-card">
      <div class="memory-candidate-head">
        <div class="memory-candidate-heading">
          <div class="skill-pill-row">
            <span class="skill-pill" data-tone="${escapeHtml(resolveMemoryCandidateTone(candidate.status, archived))}">
              ${escapeHtml(resolveMemoryCandidateStatusLabel(candidate.status, archived))}
            </span>
            <span class="skill-pill">${escapeHtml(resolveMemoryCandidateKindLabel(candidate.kind))}</span>
            <span class="skill-pill">${escapeHtml(resolveMemoryCandidateSourceTypeLabel(candidate.sourceType))}</span>
          </div>
          <h4>${escapeHtml(candidate.title || "未命名候选")}</h4>
          <p class="memory-candidate-summary">${escapeHtml(candidate.summary || "没有摘要。")}</p>
        </div>
        <p class="memory-candidate-timestamp">更新于 ${escapeHtml(updatedAt)}</p>
      </div>

      <dl class="memory-candidate-meta-list">
        <div>
          <dt>来源</dt>
          <dd>${escapeHtml(candidate.sourceLabel || "未记录")}</dd>
        </div>
        <div>
          <dt>候选 ID</dt>
          <dd>${escapeHtml(candidate.candidateId)}</dd>
        </div>
        ${candidate.sourceTaskId ? `<div><dt>任务</dt><dd>${escapeHtml(candidate.sourceTaskId)}</dd></div>` : ""}
        ${candidate.sourceConversationId ? `<div><dt>会话</dt><dd>${escapeHtml(candidate.sourceConversationId)}</dd></div>` : ""}
        ${candidate.approvedMemoryId ? `<div><dt>正式记忆</dt><dd>${escapeHtml(candidate.approvedMemoryId)}</dd></div>` : ""}
      </dl>

      <div class="memory-candidate-block">
        <p class="memory-candidate-block-title">建议理由</p>
        <p class="memory-candidate-copy">${escapeHtml(candidate.rationale || "未提供理由。")}</p>
      </div>

      <div class="memory-candidate-block">
        <p class="memory-candidate-block-title">建议写入内容</p>
        <pre class="memory-candidate-content">${escapeHtml(candidate.suggestedContent || "未提供内容。")}</pre>
      </div>

      <div class="memory-candidate-actions">
        ${canReview ? `
          <button
            type="button"
            class="toolbar-button subtle"
            data-memory-candidate-action="approve"
            data-memory-candidate-id="${escapeHtml(candidate.candidateId)}"
            ${busy ? "disabled" : ""}
          >
            ${candidateBusy ? "处理中..." : "批准"}
          </button>
          <button
            type="button"
            class="ghost-button"
            data-memory-candidate-action="reject"
            data-memory-candidate-id="${escapeHtml(candidate.candidateId)}"
            ${busy ? "disabled" : ""}
          >
            拒绝
          </button>
        ` : ""}
        <button
          type="button"
          class="ghost-button"
          data-memory-candidate-action="archive"
          data-memory-candidate-id="${escapeHtml(candidate.candidateId)}"
          ${archiveDisabled ? "disabled" : ""}
        >
          ${archived ? "已归档" : "归档"}
        </button>
      </div>
    </article>
  `;
}

function resolveMemoryCandidateStatusLabel(status, archived) {
  if (archived) {
    return "已归档";
  }

  switch (status) {
    case "approved":
      return "已批准";
    case "rejected":
      return "已拒绝";
    default:
      return "待审核";
  }
}

function resolveMemoryCandidateTone(status, archived) {
  if (archived) {
    return "partially_synced";
  }

  switch (status) {
    case "approved":
      return "ready";
    case "rejected":
      return "error";
    default:
      return "syncing";
  }
}

function resolveMemoryCandidateKindLabel(kind) {
  switch (kind) {
    case "collaboration-style":
      return "协作风格";
    case "behavior":
      return "行为约束";
    case "preference":
      return "偏好";
    case "task-note":
      return "任务备注";
    default:
      return kind || "未分类";
  }
}

function resolveMemoryCandidateSourceTypeLabel(sourceType) {
  switch (sourceType) {
    case "manual":
      return "手工";
    case "imported":
      return "导入";
    case "themis":
      return "Themis";
    default:
      return sourceType || "未知来源";
  }
}

function formatSkillSourceLabel(sourceType) {
  switch (sourceType) {
    case "local-path":
      return "本机目录";
    case "github-url":
      return "GitHub URL";
    case "github-repo-path":
      return "GitHub Repo/Path";
    case "curated":
      return "Curated";
    default:
      return "未知来源";
  }
}

function formatMcpSourceLabel(sourceType) {
  switch (sourceType) {
    case "manual":
      return "手工";
    case "themis-managed":
      return "Themis 注入";
    default:
      return "未知来源";
  }
}

function formatInstallStatusLabel(status) {
  switch (status) {
    case "ready":
      return "已同步";
    case "syncing":
      return "同步中";
    case "partially_synced":
      return "部分失败";
    case "error":
      return "异常";
    default:
      return "未知状态";
  }
}

function formatMaterializationStateLabel(state) {
  switch (state) {
    case "synced":
      return "已同步";
    case "missing":
      return "缺失";
    case "conflict":
      return "冲突";
    case "failed":
      return "失败";
    default:
      return "未知";
  }
}

function formatMcpAuthStateLabel(state) {
  switch (state) {
    case "authenticated":
      return "已认证";
    case "auth_required":
      return "待认证";
    case "unsupported":
      return "未支持";
    default:
      return "认证未知";
  }
}

function formatIdentityTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");

  return `${month}-${day} ${hour}:${minute}`;
}

function buildAuthStatusNote(auth) {
  if (auth.authenticated) {
    if (auth.authMethod === "chatgpt") {
      const email = auth.account?.email || "当前 ChatGPT 账号";
      const plan = formatPlanType(auth.account?.planType);
      return appendThirdPartyAvailability(
        plan ? `已登录 ${email}，套餐 ${plan}。` : `已登录 ${email}。`,
        auth,
      );
    }

    if (auth.authMethod === "apiKey" || auth.authMethod === "apikey") {
      return appendThirdPartyAvailability("当前已通过 API Key 登录 Codex。", auth);
    }

    return appendThirdPartyAvailability("当前已有可用的 Codex 认证。", auth);
  }

  if (auth.pendingLogin?.mode === "device") {
    return "设备码登录进行中。请打开授权页，输入一次性 code，完成授权后状态会自动刷新。";
  }

  if (auth.pendingLogin?.authUrl) {
    if (shouldShowRemoteBrowserLoginWarning(auth)) {
      return "ChatGPT 浏览器登录已发起。若你当前不在服务器本机浏览器，请确认 localhost:1455 的回调隧道已经打通；否则更建议改用设备码登录。";
    }

    return "ChatGPT 浏览器登录进行中。请在运行 Themis 的这台机器上完成授权，授权完成后会自动回到本机回调页。";
  }

  if (auth.lastError) {
    return appendThirdPartyAvailability(`上次认证操作失败：${auth.lastError}`, auth);
  }

  return appendThirdPartyAvailability(
    "当前还没有可用的 Codex 认证。发送任务前请先完成 ChatGPT 浏览器登录、设备码登录，或保存 API Key。",
    auth,
  );
}

function buildComposerAuthNote({ auth, settings, accessMode, thirdPartySelection, effectiveSettings }) {
  if (accessMode === "third-party") {
    if (!thirdPartySelection.provider) {
      return "当前会话切到了第三方模式，但后端还没有可用的第三方兼容供应商。";
    }

    if (!thirdPartySelection.model) {
      return `当前第三方供应商 ${thirdPartySelection.provider.name} 没有可用模型，请先在设置里选择模型。`;
    }

    if (thirdPartySelection.model.supportsCodexTasks === false) {
      return `当前第三方模型 ${thirdPartySelection.model.model} 未声明支持 Codex agent 任务，Themis 已阻止发送。`;
    }

    const warningText = buildThirdPartyModelRuntimeWarnings(thirdPartySelection.model, settings);

    return warningText
      ? `当前将通过 ${thirdPartySelection.provider.name} 的兼容通道发送，模型 ${thirdPartySelection.model.model}。注意：${warningText}。`
      : `当前将通过 ${thirdPartySelection.provider.name} 的兼容通道发送，模型 ${thirdPartySelection.model.model}。`;
  }

  if (auth.status === "loading") {
    return "正在检查 Codex 认证状态，确认后才能发送任务。";
  }

  if (auth.status === "error") {
    return auth.errorMessage
      ? `当前无法确认 Codex 认证状态：${auth.errorMessage}`
      : "当前无法确认 Codex 认证状态。";
  }

  if (requiresAuthentication(auth)) {
    if (auth.pendingLogin?.mode === "device") {
      return "设备码登录已发起。打开授权页，输入设置面板里的设备码，完成授权后才能发送任务。";
    }

    if (requiresLocalBrowserForChatgptLogin(auth)) {
      const localOrigin = auth.browserLogin?.localOrigin || "http://localhost:3100";
      return `当前浏览器不是运行 Themis 的这台机器。要做 ChatGPT 浏览器登录，请改在服务器本机浏览器打开 ${localOrigin}，或先手动打通 localhost:1455 的 SSH 隧道。更省事的做法是直接用设备码登录。`;
    }

    if (auth.pendingLogin?.authUrl) {
      if (shouldShowRemoteBrowserLoginWarning(auth)) {
        return "ChatGPT 浏览器登录已发起。若你当前不在服务器本机浏览器，请确认 localhost:1455 回调隧道已经打通，然后再发送任务。";
      }

      return "先在运行 Themis 的这台机器上完成 ChatGPT 浏览器登录，才能发送任务。";
    }

    return "先完成 ChatGPT 浏览器登录、设备码登录或保存 API Key，才能发送任务。";
  }

  return "";
}

  function toBooleanSelectValue(value) {
  if (value === true) {
    return "true";
  }

  function shortCommit(value) {
    return typeof value === "string" && value ? value.slice(0, 7) : "未检测到";
  }

  if (value === false) {
    return "false";
  }

  return "";
}

function buildComposerRunNote({ activeThread, runningThread }) {
  if (!runningThread) {
    return "";
  }

  if (activeThread?.id === runningThread.id) {
    return "当前会话正在执行上一条请求。你现在直接发送新消息时，Themis 会先打断当前任务，再自动发送新消息。";
  }

  const runningTitle = typeof runningThread.title === "string" && runningThread.title.trim()
    ? `「${runningThread.title.trim()}」`
    : "另一个会话";

  return `${runningTitle} 正在执行中。当前 Web 端暂不支持多个会话并行运行；你现在发送新消息时，Themis 会先打断它，再自动发送当前消息。`;
}

function buildPendingInterruptNote({ activeThread, pendingInterruptSubmit }) {
  if (!pendingInterruptSubmit || pendingInterruptSubmit.targetThreadId !== activeThread?.id) {
    return "";
  }

  return "正在打断当前任务，随后会自动发送你刚才的新消息。";
}

function buildRestoredActionHydrationNote({ activeThread, hydratingThread }) {
  if (!hydratingThread) {
    return "";
  }

  if (!isSubmittedActionHydrationThread(hydratingThread)) {
    if (activeThread?.id === hydratingThread.id) {
      return "浏览器刚恢复这个会话，正在向服务端同步上一轮任务的真实状态；当前会话暂时不能继续发送新消息。";
    }

    const hydratingTitle = typeof hydratingThread.title === "string" && hydratingThread.title.trim()
      ? `「${hydratingThread.title.trim()}」`
      : "另一个会话";
    return `${hydratingTitle} 正在同步上一轮任务的真实状态。当前 Web 端暂不支持并行继续执行，请稍候再发新消息。`;
  }

  if (activeThread?.id === hydratingThread.id) {
    return "上一轮 action 已提交，正在等待服务端继续执行并同步状态；当前会话暂时不能继续发送新消息。";
  }

  const hydratingTitle = typeof hydratingThread.title === "string" && hydratingThread.title.trim()
    ? `「${hydratingThread.title.trim()}」`
    : "另一个会话";
  return `${hydratingTitle} 仍在同步上一轮 action 的后续状态。当前 Web 端暂不支持并行继续执行，请稍候再发新消息。`;
}

function isSubmittedActionHydrationThread(thread) {
  if (!thread || !Array.isArray(thread.turns)) {
    return false;
  }

  return thread.turns.some(
    (turn) => typeof turn?.submittedPendingActionId === "string" && turn.submittedPendingActionId,
  );
}

function buildAccessModePendingNote(store, settings, effectiveSettings, draft, auth) {
  if (!draft.dirty) {
    return "";
  }

  const currentSelection = store.resolveThirdPartySelection(settings);

  if (draft.accessMode !== (effectiveSettings.accessMode || "auth")) {
    if (draft.accessMode === "third-party") {
      if (!currentSelection.provider) {
        return "当前还没有可用的第三方供应商，暂时不能切到第三方模式。";
      }

      if (!draft.thirdPartyModel) {
        return `当前供应商 ${currentSelection.provider.name} 还没有可用模型，暂时不能切到第三方模式。`;
      }

      return `已选择切到第三方模式，供应商 ${currentSelection.provider.name}，模型 ${draft.thirdPartyModel}。点击“确定切换”后才会生效。`;
    }

    if (draft.authAccountId) {
      return `已选择切回认证模式，并把当前 principal 默认认证账号改成 ${formatAuthAccountDisplayName(findAuthAccount(auth, draft.authAccountId), draft.authAccountId)}。点击“确定切换”后才会生效。`;
    }

    return "已选择切回认证模式，并改为跟随 Themis 系统默认账号。点击“确定切换”后才会生效。";
  }

  if (draft.accessMode === "auth" && draft.authAccountId !== normalizeAuthAccountId(effectiveSettings.authAccountId)) {
    if (draft.authAccountId) {
      return `已选择把当前 principal 默认认证账号改成 ${formatAuthAccountDisplayName(findAuthAccount(auth, draft.authAccountId), draft.authAccountId)}。点击“确定应用”后才会生效。`;
    }

    return "已选择让当前 principal 重新跟随 Themis 系统默认账号。点击“确定应用”后才会生效。";
  }

  if (draft.accessMode === "third-party" && draft.thirdPartyModel !== (effectiveSettings.thirdPartyModel || "")) {
    return `已选择把第三方模式模型改成 ${draft.thirdPartyModel}。点击“确定应用”后才会生效。`;
  }

  return "";
}

function describeBrowserLoginNote(auth, startedAt) {
  const startedLabel = formatLocalTime(startedAt);

  if (shouldShowRemoteBrowserLoginWarning(auth)) {
    if (!startedLabel) {
      return "如果当前浏览器不在服务器本机，请先确认你已经把 localhost:1455 转发到服务器，再继续授权。";
    }

    return `浏览器授权已在 ${startedLabel} 发起。如果当前浏览器不在服务器本机，请先确认你已经把 localhost:1455 转发到服务器，再继续授权。`;
  }

  if (!startedLabel) {
    return "请在运行 Themis 的这台机器上完成浏览器授权，授权完成后会回到本机 localhost:1455。";
  }

  return `浏览器授权已在 ${startedLabel} 发起。请在运行 Themis 的这台机器上完成授权，授权完成后会回到本机 localhost:1455。`;
}

function describeDeviceLoginNote(startedAt, expiresAt) {
  const startedLabel = formatLocalTime(startedAt);
  const expiresLabel = formatLocalTime(expiresAt);
  const parts = [];

  if (startedLabel) {
    parts.push(`设备码已在 ${startedLabel} 生成。`);
  } else {
    parts.push("设备码已生成。");
  }

  parts.push("打开授权页后，输入上面的一次性 code。");

  if (expiresLabel) {
    parts.push(`如果还没授权，通常会在 ${expiresLabel} 左右过期。`);
  }

  return parts.join("");
}

function appendThirdPartyAvailability(message, auth) {
  if (auth?.providerProfile?.type !== "openai-compatible") {
    return message;
  }

  const providerName = auth.providerProfile.name || "第三方兼容供应商";
  return `${message} 另外已检测到 ${providerName} 的兼容通道，可在“第三方配置”或“模式切换”里启用。`;
}

function formatLocalTime(iso) {
  if (!iso) {
    return "";
  }

  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocalDateTime(iso) {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function calculateRemainingPercent(usedPercent) {
  const used = typeof usedPercent === "number" && Number.isFinite(usedPercent) ? usedPercent : 0;
  return Math.max(0, Math.min(100, Math.round(100 - used)));
}

function resolveRateLimitLevel(remainingPercent) {
  if (remainingPercent <= 15) {
    return "danger";
  }

  if (remainingPercent <= 35) {
    return "warning";
  }

  return "healthy";
}

function formatRateLimitWindowLabel(windowDurationMins, fallbackLabel) {
  if (!windowDurationMins) {
    return fallbackLabel;
  }

  if (windowDurationMins === 60) {
    return "每小时使用限额";
  }

  if (windowDurationMins < 1440 && windowDurationMins % 60 === 0) {
    return `${windowDurationMins / 60} 小时使用限额`;
  }

  if (windowDurationMins === 1440) {
    return "每日使用限额";
  }

  if (windowDurationMins === 10080) {
    return "每周使用限额";
  }

  if (windowDurationMins % 1440 === 0) {
    return `${windowDurationMins / 1440} 天使用限额`;
  }

  return `${windowDurationMins} 分钟使用限额`;
}

function formatRateLimitResetText(iso) {
  const label = formatLocalDateTime(iso);
  return label ? `重置时间：${label}` : "重置时间待确认";
}

function resolveAuthRateLimitsEmptyCopy(auth) {
  if (auth.authMethod === "apiKey" || auth.authMethod === "apikey") {
    return "当前登录方式没有返回 ChatGPT 套餐额度；如果你现在走的是 API Key，这里通常不会显示这类窗口。";
  }

  return "当前账户暂时没有返回可展示的额度窗口。";
}

function buildRateLimitCreditsCopy(credits) {
  if (!credits) {
    return "";
  }

  if (credits.unlimited) {
    return "附加 credits：不限额。";
  }

  const balance = typeof credits.balance === "string" ? credits.balance.trim() : "";
  const numericBalance = Number(balance);

  if (balance && Number.isFinite(numericBalance) && numericBalance > 0) {
    return `附加 credits 余额：${balance}。`;
  }

  if (credits.hasCredits) {
    return balance ? `附加 credits：${balance}。` : "当前账号另有附加 credits。";
  }

  return "";
}

function formatPlanType(planType) {
  if (typeof planType !== "string" || !planType) {
    return "";
  }

  const planLabels = {
    free: "Free",
    go: "Go",
    plus: "Plus",
    pro: "Pro",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Edu",
    unknown: "Unknown",
  };

  return planLabels[planType] ?? planType;
}

function findAuthAccount(auth, accountId) {
  const normalizedAccountId = normalizeAuthAccountId(accountId);

  if (!normalizedAccountId || !Array.isArray(auth?.accounts)) {
    return null;
  }

  return auth.accounts.find((account) => account.accountId === normalizedAccountId) ?? null;
}

function formatAuthAccountSelectLabel(account) {
  if (!account) {
    return "未命名账号";
  }

  const baseLabel = formatAuthAccountDisplayName(account, account.accountId);
  return account.isActive ? `${baseLabel}（默认）` : baseLabel;
}

function formatAuthAccountDisplayName(account, fallbackAccountId = "") {
  const accountEmail = typeof account?.accountEmail === "string" && account.accountEmail.trim()
    ? account.accountEmail.trim()
    : "";
  const label = typeof account?.label === "string" && account.label.trim()
    ? account.label.trim()
    : "";
  const accountId = typeof account?.accountId === "string" && account.accountId.trim()
    ? account.accountId.trim()
    : normalizeAuthAccountId(fallbackAccountId);
  const displayLabel = accountEmail || label;

  return displayLabel || accountId || "当前账号";
}

function normalizeAuthAccountId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function shouldShowRemoteBrowserLoginWarning(auth) {
  return !auth.authenticated
    && auth.pendingLogin?.mode !== "device"
    && auth.browserLogin?.supportedOnThisBrowser === false;
}

function buildRemoteBrowserLoginCopy(auth) {
  const localOrigin = auth.browserLogin?.localOrigin || "http://localhost:3100";

  return `当前浏览器不是运行 Themis 的这台机器。远端访问时，更简单的做法是直接用设备码登录。只有你已经打通 localhost:1455 回调链路时，才适合继续浏览器登录；否则推荐改在服务器本机浏览器打开 ${localOrigin}。`;
}
