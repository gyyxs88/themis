import { nowIso, summarizeForSidebar } from "./utils.js";

export function createStoreHelpers({ app, getState, saveState }) {
  const DEFAULT_REASONING_OPTIONS = [
    { reasoningEffort: "minimal", description: "minimal" },
    { reasoningEffort: "low", description: "low" },
    { reasoningEffort: "medium", description: "medium" },
    { reasoningEffort: "high", description: "high" },
    { reasoningEffort: "xhigh", description: "xhigh" },
  ];
  const LEGACY_PERSONA_LABELS = {
    "themis-default": "Themis",
    executor: "推进官",
    mentor: "带教搭档",
    reviewer: "审查官",
  };

  function buildTaskOptions(settings) {
    const effective = resolveEffectiveSettings(settings);
    const activeModel = effective.accessMode === "third-party" ? effective.thirdPartyModel : effective.model;
    const principalAssistantStyle = resolvePrincipalAssistantStyleOptions();
    const options = {
      ...(effective.profile ? { profile: effective.profile } : {}),
      ...principalAssistantStyle,
      accessMode: effective.accessMode,
      ...(effective.accessMode === "auth" && normalizeText(settings?.authAccountId)
        ? { authAccountId: normalizeText(settings?.authAccountId) }
        : {}),
      ...(activeModel ? { model: activeModel } : {}),
      ...(effective.reasoning ? { reasoning: effective.reasoning } : {}),
      ...(effective.sandboxMode ? { sandboxMode: effective.sandboxMode } : {}),
      ...(effective.webSearchMode ? { webSearchMode: effective.webSearchMode } : {}),
      ...(shouldIncludeNetworkAccess(effective)
        ? { networkAccessEnabled: effective.networkAccessEnabled }
        : {}),
      ...(effective.approvalPolicy ? { approvalPolicy: effective.approvalPolicy } : {}),
      ...(effective.accessMode === "third-party" && effective.thirdPartyProviderId
        ? { thirdPartyProviderId: effective.thirdPartyProviderId }
        : {}),
    };

    return Object.keys(options).length ? options : undefined;
  }

  function resolvePrincipalAssistantStyleOptions() {
    const identity = app.runtime.identity ?? {};
    const languageStyle = normalizeText(identity.assistantLanguageStyle);
    const assistantMbti = normalizeText(identity.assistantMbti);
    const styleNotes = normalizeText(identity.assistantStyleNotes);
    const assistantSoul = normalizeLongText(identity.assistantSoul);

    return {
      ...(languageStyle ? { languageStyle } : {}),
      ...(assistantMbti ? { assistantMbti } : {}),
      ...(styleNotes ? { styleNotes } : {}),
      ...(assistantSoul ? { assistantSoul } : {}),
    };
  }

  function getRuntimeConfig() {
    return app.runtime.runtimeConfig ?? {
      status: "idle",
      errorMessage: "",
      models: [],
      defaults: {
        profile: "",
        model: "",
        reasoning: "",
        approvalPolicy: "",
        sandboxMode: "",
        webSearchMode: "",
        networkAccessEnabled: null,
      },
      accessModes: [],
      thirdPartyProviders: [],
      personas: [],
    };
  }

  function getVisibleModels(settings) {
    const runtimeConfig = getRuntimeConfig();
    const inherited = resolveInheritedSettings(settings);
    const visibleModels = runtimeConfig.models.filter((model) => !model.hidden || model.model === inherited.model);

    if (settings?.model && !visibleModels.some((model) => model.model === settings.model)) {
      visibleModels.unshift(createSyntheticModel(settings.model));
    }

    if (inherited.model && !visibleModels.some((model) => model.model === inherited.model)) {
      visibleModels.unshift(createSyntheticModel(inherited.model));
    }

    return dedupeModels(visibleModels);
  }

  function getThirdPartyProviders() {
    const runtimeConfig = getRuntimeConfig();
    return Array.isArray(runtimeConfig.thirdPartyProviders) ? runtimeConfig.thirdPartyProviders : [];
  }

  function getThirdPartyModels(settings, resolvedProvider = null) {
    const provider = resolvedProvider ?? resolveThirdPartyProvider(settings);

    if (!provider) {
      const configuredModel = normalizeText(settings?.thirdPartyModel);
      return configuredModel
        ? [createSyntheticModel(configuredModel, "当前线程记录的第三方模型，不在当前供应商返回的模型列表中。", false)]
        : [];
    }

    const visibleModels = provider.models.filter((model) => !model.hidden || model.model === provider.defaultModel);
    const configuredModel = normalizeText(settings?.thirdPartyModel);

    if (configuredModel && !visibleModels.some((model) => model.model === configuredModel)) {
      visibleModels.unshift(createSyntheticModel(configuredModel, "当前线程记录的第三方模型，不在当前供应商返回的模型列表中。", false));
    }

    if (provider.defaultModel && !visibleModels.some((model) => model.model === provider.defaultModel)) {
      visibleModels.unshift(createSyntheticModel(provider.defaultModel, "当前第三方供应商配置的默认模型，没有出现在返回列表中。", false));
    }

    return dedupeModels(visibleModels);
  }

  function getReasoningOptions(settings) {
    const accessMode = resolveAccessMode(settings);
    const inherited = resolveInheritedSettings(settings);
    const model = accessMode === "third-party"
      ? getThirdPartyModelById(inherited.thirdPartyModel, settings)
      : getAuthModelById(inherited.model, settings);
    const resolvedOptions = Array.isArray(model?.supportedReasoningEfforts) && model.supportedReasoningEfforts.length
      ? model.supportedReasoningEfforts
      : DEFAULT_REASONING_OPTIONS;
    const explicitReasoning = normalizeText(settings?.reasoning);

    if (explicitReasoning && !resolvedOptions.some((option) => option.reasoningEffort === explicitReasoning)) {
      return [
        {
          reasoningEffort: explicitReasoning,
          description: explicitReasoning,
        },
        ...resolvedOptions,
      ];
    }

    return resolvedOptions;
  }

  function resolveAccessMode(settings) {
    const configuredAccessMode = normalizeText(settings?.accessMode);

    if (configuredAccessMode === "third-party" && getThirdPartyProviders().length) {
      return "third-party";
    }

    return "auth";
  }

  function resolveThirdPartySelection(settings) {
    const provider = resolveThirdPartyProvider(settings);
    const models = getThirdPartyModels(settings, provider);
    const configuredModel = normalizeText(settings?.thirdPartyModel);
    const model = models.find((entry) => entry.model === configuredModel)
      ?? models.find((entry) => entry.model === provider?.defaultModel)
      ?? models[0]
      ?? null;

    return {
      provider,
      models,
      model,
      providerId: provider?.id ?? "",
      modelId: model?.model ?? "",
    };
  }

  function resolveInheritedSettings(settings) {
    const runtimeConfig = getRuntimeConfig();
    const visibleModels = getVisibleModelsWithoutFallback(settings);
    const configuredModel = normalizeText(runtimeConfig.defaults.model);
    const inheritedModel = normalizeText(settings?.model)
      || configuredModel
      || runtimeConfig.models.find((model) => model.isDefault)?.model
      || visibleModels[0]?.model
      || "";
    const accessMode = resolveAccessMode(settings);
    const thirdPartySelection = resolveThirdPartySelection(settings);
    const activeModel = accessMode === "third-party"
      ? getThirdPartyModelById(thirdPartySelection.modelId, settings)
      : getAuthModelById(inheritedModel, settings);
    const reasoningOptions = Array.isArray(activeModel?.supportedReasoningEfforts) && activeModel.supportedReasoningEfforts.length
      ? activeModel.supportedReasoningEfforts
      : DEFAULT_REASONING_OPTIONS;
    const configuredReasoning = normalizeText(runtimeConfig.defaults.reasoning);
    const modelDefaultReasoning = normalizeText(activeModel?.defaultReasoningEffort);
    const inheritedReasoning = accessMode === "third-party"
      ? (
        reasoningOptions.some((option) => option.reasoningEffort === modelDefaultReasoning)
          ? modelDefaultReasoning
          : configuredReasoning
      )
      : (
        reasoningOptions.some((option) => option.reasoningEffort === configuredReasoning)
          ? configuredReasoning
          : modelDefaultReasoning
      );

    return {
      profile: normalizeText(settings?.profile),
      accessMode,
      authAccountId: normalizeText(settings?.authAccountId) || normalizeText(app.runtime.auth?.activeAccountId),
      model: inheritedModel,
      thirdPartyProviderId: thirdPartySelection.providerId,
      thirdPartyModel: thirdPartySelection.modelId,
      reasoning: inheritedReasoning || "",
      sandboxMode: normalizeText(runtimeConfig.defaults.sandboxMode),
      webSearchMode: normalizeText(runtimeConfig.defaults.webSearchMode),
      networkAccessEnabled: normalizeBooleanSetting(runtimeConfig.defaults.networkAccessEnabled),
      approvalPolicy: normalizeText(runtimeConfig.defaults.approvalPolicy) || "untrusted",
    };
  }

  function resolveEffectiveSettings(settings) {
    const inherited = resolveInheritedSettings(settings);
    const reasoningOptions = getReasoningOptions(settings);
    const explicitReasoning = normalizeText(settings?.reasoning);

    return {
      profile: normalizeText(settings?.profile) || inherited.profile,
      accessMode: inherited.accessMode,
      authAccountId: normalizeText(settings?.authAccountId) || inherited.authAccountId,
      model: normalizeText(settings?.model) || inherited.model,
      thirdPartyProviderId: normalizeText(settings?.thirdPartyProviderId) || inherited.thirdPartyProviderId,
      thirdPartyModel: normalizeText(settings?.thirdPartyModel) || inherited.thirdPartyModel,
      reasoning: reasoningOptions.some((option) => option.reasoningEffort === explicitReasoning)
        ? explicitReasoning
        : inherited.reasoning,
      sandboxMode: normalizeText(settings?.sandboxMode) || inherited.sandboxMode,
      webSearchMode: normalizeText(settings?.webSearchMode) || inherited.webSearchMode,
      networkAccessEnabled: normalizeBooleanSetting(settings?.networkAccessEnabled) ?? inherited.networkAccessEnabled,
      approvalPolicy: normalizeText(settings?.approvalPolicy) || inherited.approvalPolicy,
    };
  }

  function shouldBootstrapThread(thread) {
    return Boolean(thread?.bootstrapTranscript && !thread?.serverThreadId);
  }

  function repairInterruptedTurns() {
    for (const thread of getState().threads) {
      for (const turn of thread.turns) {
        if (turn.state !== "queued" && turn.state !== "running") {
          continue;
        }

        turn.state = "cancelled";
        turn.result = turn.result ?? {
          status: "cancelled",
          summary: "浏览器刷新或会话关闭后，本次任务已中断。",
        };
        turn.steps.push({
          title: "会话已中断",
          text: "浏览器刷新或会话关闭后，本次任务未继续运行。",
          tone: "error",
        });
        thread.updatedAt = nowIso();
      }
    }

    saveState();
  }

  function describeBootstrapLabel(thread) {
    if (thread?.bootstrapMode === "session-transcript") {
      return "真实 Codex 会话的逐轮转录";
    }

    return "浏览器里保存的逐轮会话转录";
  }

  function threadStatus(thread) {
    if (!thread) {
      return "idle";
    }

    const latestTurn = thread.turns.at(-1);
    return latestTurn?.state ?? thread.storedStatus ?? "idle";
  }

  function latestTurnMessage(turn) {
    if (turn.result?.summary && turn.state !== "running" && turn.state !== "queued") {
      return turn.result.summary;
    }

    const latestAssistantMessage = getVisibleAssistantMessages(turn).at(-1)?.text ?? turn?.assistantMessages?.at(-1)?.text;

    if (latestAssistantMessage) {
      return latestAssistantMessage;
    }

    return turn.steps.at(-1)?.text ?? "等待任务开始。";
  }

  function getVisibleAssistantMessages(turn) {
    if (!turn || !Array.isArray(turn.assistantMessages) || !turn.assistantMessages.length) {
      return [];
    }

    const messages = turn.assistantMessages.filter((message) => typeof message?.text === "string" && message.text.trim());

    if (!messages.length) {
      return [];
    }

    const finalOutput = typeof turn.result?.output === "string" ? turn.result.output.trim() : "";
    const lastMessage = messages.at(-1);

    if (finalOutput && lastMessage?.text?.trim() === finalOutput) {
      return messages.slice(0, -1);
    }

    return messages;
  }

  function buildThreadPreview(thread) {
    if (!thread) {
      return "等待新的任务。";
    }

    if (app.runtime.historyHydratingThreadId === thread.id) {
      return "正在从本机历史载入完整记录。";
    }

    if (thread.bootstrapTranscript && !thread.serverThreadId) {
      return `fork 会话：下一次发送会先导入${describeBootstrapLabel(thread)}。`;
    }

    const latestTurn = thread.turns.at(-1);

    if (!latestTurn) {
      if (thread.storedSummary) {
        return summarizeForSidebar(thread.storedSummary);
      }

      return "还没有任务，发送第一条消息开始。";
    }

    if (latestTurn.state === "running" || latestTurn.state === "queued") {
      return summarizeForSidebar(latestTurn.steps.at(-1)?.text ?? latestTurn.goal);
    }

    if (latestTurn.result?.summary) {
      return summarizeForSidebar(latestTurn.result.summary);
    }

    if (thread.storedSummary) {
      return summarizeForSidebar(thread.storedSummary);
    }

    return summarizeForSidebar(latestTurn.goal);
  }

  function shouldShowThreadInList(thread, query = "") {
    const state = getState();

    if (!thread) {
      return false;
    }

    const hasContent = Boolean(
      thread.turns.length ||
      thread.storedTurnCount ||
      thread.bootstrapTranscript ||
      thread.draftGoal?.trim() ||
      thread.draftContext?.trim(),
    );

    if (!hasContent && thread.id !== state.activeThreadId) {
      return false;
    }

    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return true;
    }

    const latestTurn = thread.turns.at(-1);
    const searchable = [
      thread.title,
      thread.storedSummary,
      latestTurn?.goal,
      latestTurn?.inputText,
      latestTurn?.result?.summary,
      latestTurn?.result?.output,
      ...(Array.isArray(latestTurn?.assistantMessages) ? latestTurn.assistantMessages.map((message) => message.text) : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(normalizedQuery);
  }

  function syncThreadStoredState(thread, turn) {
    if (!thread || !turn) {
      return;
    }

    thread.storedTurnCount = Math.max(thread.turns.length, thread.storedTurnCount ?? 0);
    thread.storedStatus = turn.state ?? thread.storedStatus;
    thread.storedSummary = turn.result?.summary ?? turn.goal ?? thread.storedSummary;
    thread.serverHistoryAvailable = thread.serverHistoryAvailable || Boolean(turn.requestId || turn.taskId || thread.serverThreadId);
    thread.historyHydrated = true;
  }

  function isDefaultThreadTitle(title) {
    return !title || title === "新会话";
  }

  function buildLocalForkTranscript(thread) {
    const turns = thread.turns.map((turn, index) => renderLocalForkTurn(turn, index + 1));

    if (!turns.length) {
      return "";
    }

    const lines = [
      "Imported conversation transcript from an existing Themis browser session.",
      "Treat the following turns as conversation history that already happened.",
      "Do not answer these turns again. Use them as prior context for the next user request.",
      `Source thread title: ${thread.title}`,
    ];
    const selectedTurns = selectLocalBootstrapTurns(turns);

    if (selectedTurns.omittedCount > 0) {
      lines.push(`[Older ${selectedTurns.omittedCount} turns were omitted to stay within the context budget.]`);
    }

    lines.push(...selectedTurns.turns);
    return lines.join("\n\n");
  }

  function renderLocalForkTurn(turn, index) {
    const lines = [`[Turn ${index}]`, "User goal:", turn.goal];

    if (turn.inputText) {
      lines.push("User context:");
      lines.push(turn.inputText);
    }

    const assistantReply = turn.result?.output ?? turn.result?.summary ?? latestTurnMessage(turn);

    if (assistantReply) {
      lines.push("Assistant reply:");
      lines.push(assistantReply);
    }

    return lines.join("\n");
  }

  function selectLocalBootstrapTurns(turns) {
    const selected = [];
    let totalChars = 0;

    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turnText = turns[index];
      const nextLength = totalChars + turnText.length;

      if (selected.length >= 24 || (selected.length > 0 && nextLength > 24000)) {
        break;
      }

      selected.unshift(turnText);
      totalChars = nextLength;
    }

    return {
      turns: selected,
      omittedCount: Math.max(turns.length - selected.length, 0),
    };
  }

  function getVisibleModelsWithoutFallback(settings) {
    const runtimeConfig = getRuntimeConfig();
    const configuredModel = normalizeText(runtimeConfig.defaults.model);

    return dedupeModels(
      runtimeConfig.models.filter((model) => !model.hidden || model.model === configuredModel || model.model === settings?.model),
    );
  }

  function resolveThirdPartyProvider(settings) {
    const providers = getThirdPartyProviders();
    const configuredProviderId = normalizeText(settings?.thirdPartyProviderId);
    return providers.find((entry) => entry.id === configuredProviderId) ?? providers[0] ?? null;
  }

  function getAuthModelById(modelId, settings) {
    if (!modelId) {
      return null;
    }

    const models = getVisibleModelsWithoutFallback(settings);
    return models.find((model) => model.model === modelId)
      ?? createSyntheticModel(modelId, "当前线程记录的模型，没有出现在 Codex 当前返回的模型列表中。");
  }

  function getThirdPartyModelById(modelId, settings) {
    if (!modelId) {
      return null;
    }

    const models = getThirdPartyModels(settings);
    return models.find((model) => model.model === modelId)
      ?? createSyntheticModel(modelId, "当前线程记录的第三方模型，没有出现在供应商返回的模型列表中。");
  }

  function dedupeModels(models) {
    const unique = new Map();

    for (const model of models) {
      unique.set(model.model, model);
    }

    return [...unique.values()];
  }

  function createSyntheticModel(
    modelId,
    description = "当前线程记录的模型，没有出现在 Codex 当前返回的模型列表中。",
    supportsCodexTasks = true,
  ) {
    return {
      id: modelId,
      model: modelId,
      displayName: modelId,
      description,
      hidden: false,
      supportedReasoningEfforts: DEFAULT_REASONING_OPTIONS,
      defaultReasoningEffort: "",
      supportsPersonality: false,
      supportsCodexTasks,
      isDefault: false,
    };
  }

  function normalizeText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }

  function normalizeBooleanSetting(value) {
    return typeof value === "boolean" ? value : null;
  }

  function normalizeLongText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim()
      .slice(0, 4000);
  }

  function resolveAssistantDisplayLabel(options) {
    const assistantMbti = normalizeText(options?.assistantMbti);
    const languageStyle = normalizeText(options?.languageStyle);
    const assistantSoul = normalizeLongText(options?.assistantSoul);
    const legacyProfile = normalizeText(options?.profile);

    if (assistantMbti && languageStyle) {
      return `Themis · ${truncateLabel(assistantMbti)} / ${truncateLabel(languageStyle)}`;
    }

    if (assistantMbti) {
      return `Themis · ${truncateLabel(assistantMbti, 20)}`;
    }

    if (languageStyle) {
      return `Themis · ${truncateLabel(languageStyle, 20)}`;
    }

    if (assistantSoul) {
      return "Themis · 补充设定";
    }

    return LEGACY_PERSONA_LABELS[legacyProfile] || "Themis";
  }

  function describeAssistantStyle(options) {
    const languageStyle = normalizeText(options?.languageStyle);
    const assistantMbti = normalizeText(options?.assistantMbti);
    const styleNotes = normalizeText(options?.styleNotes);
    const assistantSoul = normalizeLongText(options?.assistantSoul);
    const parts = [
      languageStyle ? `语言风格：${languageStyle}。` : "",
      assistantMbti ? `MBTI / 性格标签：${assistantMbti}。` : "",
      styleNotes ? `补充说明：${styleNotes}。` : "",
      assistantSoul ? `补充设定：已配置 ${assistantSoul.length} 字。` : "",
    ].filter(Boolean);

    if (parts.length) {
      return `${parts.join(" ")} 这些设置只影响提示词和表达风格，不改变模型、权限和工具能力。`;
    }

    const legacyProfile = normalizeText(options?.profile);

    if (legacyProfile && LEGACY_PERSONA_LABELS[legacyProfile]) {
      return `当前沿用旧会话里的预设人格：${LEGACY_PERSONA_LABELS[legacyProfile]}。新会话建议直接填写语言风格、MBTI 或补充说明。`;
    }

    return "当前未设置额外风格。Themis 会按默认协作型助理方式表达，重点仍由你的当轮指令决定。";
  }

  function truncateLabel(value, maxLength = 14) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
  }

  function shouldIncludeNetworkAccess(settings) {
    return typeof settings.networkAccessEnabled === "boolean"
      && settings.sandboxMode !== "read-only"
      && settings.sandboxMode !== "danger-full-access";
  }

  return {
    buildTaskOptions,
    getVisibleModels,
    getThirdPartyProviders,
    getThirdPartyModels,
    getReasoningOptions,
    describeAssistantStyle,
    resolveAssistantDisplayLabel,
    resolveAccessMode,
    resolveThirdPartySelection,
    resolveInheritedSettings,
    resolveEffectiveSettings,
    shouldBootstrapThread,
    repairInterruptedTurns,
    describeBootstrapLabel,
    threadStatus,
    latestTurnMessage,
    getVisibleAssistantMessages,
    buildThreadPreview,
    shouldShowThreadInList,
    syncThreadStoredState,
    isDefaultThreadTitle,
    buildLocalForkTranscript,
  };
}
