import {
  renderComposerActionBarMarkup,
  renderHistoryLoadingState,
  renderStoredSummaryState,
  renderThreadRiskBannerMarkup,
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
    renderThreadList();
    renderWorkspaceHeader();
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
    renderConversationLinkState(thread);
    renderIdentityState();
    renderSkillsState();
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
    dom.settingsThirdPartySection.classList.toggle("hidden", activeSection !== "third-party");
    dom.settingsThirdPartySection.setAttribute("aria-hidden", String(activeSection !== "third-party"));
    dom.settingsModeSwitchSection.classList.toggle("hidden", activeSection !== "mode-switch");
    dom.settingsModeSwitchSection.setAttribute("aria-hidden", String(activeSection !== "mode-switch"));
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
    dom.goalInput.value = mergeComposerDraft(thread);
    dom.goalInput.placeholder = COMPOSER_PLACEHOLDERS[actionBarState.mode] ?? DEFAULT_COMPOSER_PLACEHOLDER;
    dom.submitButton.textContent = COMPOSER_SUBMIT_LABELS[actionBarState.mode] ?? COMPOSER_SUBMIT_LABELS.chat;
    if (dom.composerActionBar) {
      dom.composerActionBar.innerHTML = renderComposerActionBarMarkup(actionBarState, utils);
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

  function renderConversationLinkState(thread) {
    const conversationId = thread?.id || "";

    if (!conversationId) {
      dom.conversationLinkCurrent.textContent = "当前 conversationId：尚未确定";
      dom.conversationLinkNote.textContent = "粘贴一个已有 conversationId，Web 会切到对应会话并尝试载入历史。";
      return;
    }

    dom.conversationLinkCurrent.textContent = `当前 conversationId：${conversationId}`;
    dom.conversationLinkNote.textContent = "把飞书 /current 或其他渠道看到的 conversationId 粘贴到上面，就能把 Web 切到同一条统一会话。";
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

  return {
    renderAll,
    renderThreadList,
    renderWorkspaceTools,
    setToolsPanelOpen,
    setToolsPanelSection,
  };
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
  return ["runtime", "auth", "skills", "third-party", "mode-switch"].includes(section) ? section : "runtime";
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

function shouldShowRemoteBrowserLoginWarning(auth) {
  return !auth.authenticated
    && auth.pendingLogin?.mode !== "device"
    && auth.browserLogin?.supportedOnThisBrowser === false;
}

function buildRemoteBrowserLoginCopy(auth) {
  const localOrigin = auth.browserLogin?.localOrigin || "http://localhost:3100";

  return `当前浏览器不是运行 Themis 的这台机器。远端访问时，更简单的做法是直接用设备码登录。只有你已经打通 localhost:1455 回调链路时，才适合继续浏览器登录；否则推荐改在服务器本机浏览器打开 ${localOrigin}。`;
}
