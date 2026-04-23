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

  function createDefaultModelCapabilities(supportsCodexTasks = true) {
    return {
      textInput: true,
      imageInput: false,
      supportsCodexTasks,
      supportsReasoningSummaries: false,
      supportsVerbosity: false,
      supportsParallelToolCalls: false,
      supportsSearchTool: false,
      supportsImageDetailOriginal: false,
    };
  }

  function getThirdPartyModelCapabilities(model) {
    const supportsCodexTasks = model?.supportsCodexTasks !== false;

    return {
      ...createDefaultModelCapabilities(supportsCodexTasks),
      ...(model?.capabilities && typeof model.capabilities === "object" ? model.capabilities : {}),
      supportsCodexTasks,
    };
  }

  function buildTaskOptions(settings) {
    const effective = resolveEffectiveSettings(settings);
    const activeModel = effective.accessMode === "third-party" ? effective.thirdPartyModel : effective.model;
    const principalAssistantStyle = resolvePrincipalAssistantStyleOptions();
    const options = {
      ...(effective.profile ? { profile: effective.profile } : {}),
      ...principalAssistantStyle,
      accessMode: effective.accessMode,
      ...(effective.accessMode === "auth" && normalizeText(effective.authAccountId)
        ? { authAccountId: normalizeText(effective.authAccountId) }
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

  function resolvePrincipalTaskSettings() {
    const taskSettings = app.runtime.identity?.taskSettings;

    return {
      authAccountId: normalizeText(taskSettings?.authAccountId),
      model: normalizeText(taskSettings?.model),
      reasoning: normalizeText(taskSettings?.reasoning),
      sandboxMode: normalizeText(taskSettings?.sandboxMode),
      webSearchMode: normalizeText(taskSettings?.webSearchMode),
      networkAccessEnabled: normalizeBooleanSetting(taskSettings?.networkAccessEnabled),
      approvalPolicy: normalizeText(taskSettings?.approvalPolicy),
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
    const principalTaskSettings = resolvePrincipalTaskSettings();
    const model = accessMode === "third-party"
      ? getThirdPartyModelById(inherited.thirdPartyModel, settings)
      : getAuthModelById(inherited.model, settings);
    const resolvedOptions = Array.isArray(model?.supportedReasoningEfforts) && model.supportedReasoningEfforts.length
      ? model.supportedReasoningEfforts
      : DEFAULT_REASONING_OPTIONS;
    const explicitReasoning = normalizeText(settings?.reasoning) || normalizeText(principalTaskSettings.reasoning);

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
    const principalTaskSettings = resolvePrincipalTaskSettings();
    const visibleModels = getVisibleModelsWithoutFallback(settings);
    const configuredModel = normalizeText(runtimeConfig.defaults.model);
    const inheritedModel = normalizeText(settings?.model)
      || principalTaskSettings.model
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
    const configuredReasoning = principalTaskSettings.reasoning || normalizeText(runtimeConfig.defaults.reasoning);
    const modelDefaultReasoning = normalizeText(activeModel?.defaultReasoningEffort);
    const inheritedReasoning = configuredReasoning || (
      accessMode === "third-party"
        ? (
          reasoningOptions.some((option) => option.reasoningEffort === modelDefaultReasoning)
            ? modelDefaultReasoning
            : ""
        )
        : modelDefaultReasoning
    );

    return {
      profile: normalizeText(settings?.profile),
      accessMode,
      authAccountId: principalTaskSettings.authAccountId || normalizeText(app.runtime.auth?.activeAccountId),
      model: inheritedModel,
      thirdPartyProviderId: thirdPartySelection.providerId,
      thirdPartyModel: thirdPartySelection.modelId,
      reasoning: inheritedReasoning || "",
      sandboxMode: principalTaskSettings.sandboxMode || normalizeText(runtimeConfig.defaults.sandboxMode),
      webSearchMode: principalTaskSettings.webSearchMode || normalizeText(runtimeConfig.defaults.webSearchMode),
      networkAccessEnabled: principalTaskSettings.networkAccessEnabled
        ?? normalizeBooleanSetting(runtimeConfig.defaults.networkAccessEnabled),
      approvalPolicy: principalTaskSettings.approvalPolicy || normalizeText(runtimeConfig.defaults.approvalPolicy) || "untrusted",
    };
  }

  function resolveEffectiveSettings(settings) {
    const inherited = resolveInheritedSettings(settings);
    const reasoningOptions = getReasoningOptions(settings);
    const explicitReasoning = normalizeText(settings?.reasoning);

    return {
      profile: normalizeText(settings?.profile) || inherited.profile,
      accessMode: inherited.accessMode,
      authAccountId: inherited.authAccountId,
      model: normalizeText(settings?.model) || inherited.model,
      thirdPartyProviderId: normalizeText(settings?.thirdPartyProviderId) || inherited.thirdPartyProviderId,
      thirdPartyModel: normalizeText(settings?.thirdPartyModel) || inherited.thirdPartyModel,
      reasoning: reasoningOptions.some((option) => option.reasoningEffort === explicitReasoning)
        ? explicitReasoning
        : inherited.reasoning,
      sandboxMode: inherited.sandboxMode,
      webSearchMode: inherited.webSearchMode,
      networkAccessEnabled: inherited.networkAccessEnabled,
      approvalPolicy: inherited.approvalPolicy,
    };
  }

  function shouldBootstrapThread(thread) {
    return Boolean(thread?.bootstrapTranscript && !thread?.serverThreadId);
  }

  function repairInterruptedTurns() {
    for (const thread of getState().threads) {
      for (const turn of thread.turns) {
        if (turn.state !== "queued" && turn.state !== "running" && turn.state !== "waiting") {
          continue;
        }

        if (thread.historyNeedsRehydrate && typeof turn.submittedPendingActionId === "string" && turn.submittedPendingActionId) {
          continue;
        }

        if (hasRecoverableServerState(thread, turn)) {
          thread.serverHistoryAvailable = thread.serverHistoryAvailable || hasRecoverableServerState(thread, turn);
          thread.historyNeedsRehydrate = true;
          turn.pendingAction = null;

          if (!hasRecoverySyncStep(turn)) {
            turn.steps.push({
              title: "等待服务端同步状态",
              text: "浏览器刷新或会话关闭后，正在重新同步服务端状态，请稍候。",
              tone: "warning",
            });
          }

          thread.updatedAt = nowIso();
          continue;
        }

        turn.state = "cancelled";
        turn.pendingAction = null;
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

  function resolveTopRiskState(activeThread) {
    if (!activeThread) {
      return null;
    }

    const latestTurn = Array.isArray(activeThread.turns) ? activeThread.turns.at(-1) : null;

    if (latestTurn?.state === "waiting" && latestTurn.pendingAction) {
      return {
        kind: "waiting",
        threadId: activeThread.id,
        turnId: latestTurn.id,
        message: "当前会话等待处理",
        actionKind: "focus-turn",
        actionLabel: "跳到当前 turn",
        tone: "warning",
      };
    }

    if (latestTurn?.submittedPendingActionId) {
      return {
        kind: "rehydrating-current",
        threadId: activeThread.id,
        turnId: latestTurn?.id ?? null,
        message: "当前会话正在同步上一轮 action 后续状态",
        actionKind: "focus-turn",
        actionLabel: "查看当前 turn",
        tone: "neutral",
      };
    }

    if (activeThread.historyNeedsRehydrate && app.runtime.restoredActionHydrationThreadId === activeThread.id) {
      return {
        kind: "rehydrating-current",
        threadId: activeThread.id,
        turnId: latestTurn?.id ?? null,
        message: "当前会话正在同步上一轮任务的真实状态",
        actionKind: "focus-turn",
        actionLabel: "查看当前 turn",
        tone: "neutral",
      };
    }

    const state = getState();
    const hydratingThreads = Array.isArray(state?.threads)
      ? state.threads.filter((thread) => thread?.id !== activeThread.id && thread?.historyNeedsRehydrate)
      : [];
    const otherHydratingThread = hydratingThreads.find((thread) => thread.id === app.runtime.restoredActionHydrationThreadId)
      ?? hydratingThreads[0]
      ?? null;

    if (!otherHydratingThread) {
      return null;
    }

    const otherTurn = Array.isArray(otherHydratingThread.turns) ? otherHydratingThread.turns.at(-1) : null;

    return {
      kind: "rehydrating-other",
      threadId: otherHydratingThread.id,
      turnId: otherTurn?.id ?? null,
      message: otherTurn?.submittedPendingActionId
        ? `会话「${formatThreadTitle(otherHydratingThread)}」仍在同步上一轮 action 后续状态`
        : `会话「${formatThreadTitle(otherHydratingThread)}」仍在同步上一轮任务的真实状态`,
      actionKind: "open-thread",
      actionLabel: "切过去查看",
      tone: "neutral",
    };
  }

  function resolveTurnActionState(thread, turn) {
    if (!turn) {
      return null;
    }

    const latestTurn = Array.isArray(thread?.turns) ? thread.turns.at(-1) : null;

    if (turn.state === "waiting" && turn.pendingAction) {
      const pendingAction = turn.pendingAction ?? {};

      return {
        kind: "waiting",
        heading: "等待处理",
        actionType: typeof pendingAction.actionType === "string" ? pendingAction.actionType : "",
        prompt: typeof pendingAction.prompt === "string" ? pendingAction.prompt : "",
        choices: Array.isArray(pendingAction.choices)
          ? pendingAction.choices.filter((choice) => typeof choice === "string")
          : [],
        errorMessage: typeof turn.pendingActionError === "string" ? turn.pendingActionError : "",
        submitting: Boolean(turn.pendingActionSubmitting),
        inputText: typeof turn.pendingActionInputText === "string" ? turn.pendingActionInputText : "",
      };
    }

    if (turn.submittedPendingActionId) {
      return {
        kind: "rehydrating",
        heading: "状态同步中",
        prompt: "上一轮 action 已提交，正在等待服务端继续执行并同步状态。",
      };
    }

    if (
      thread?.historyNeedsRehydrate
      && app.runtime.restoredActionHydrationThreadId === thread.id
      && latestTurn?.id === turn.id
    ) {
      return {
        kind: "rehydrating",
        heading: "状态同步中",
        prompt: "浏览器刚恢复这个会话，正在向服务端同步上一轮任务的真实状态。",
      };
    }

    return null;
  }

  function resolveComposerActionBarState(thread) {
    const mode = normalizeComposerMode(thread?.composerMode);
    const latestTurn = Array.isArray(thread?.turns) ? thread.turns.at(-1) : null;
    const turnActionState = resolveTurnActionState(thread, latestTurn);
    const isCurrentThreadHydrating = Boolean(
      thread?.historyNeedsRehydrate
      && app.runtime.restoredActionHydrationThreadId === thread?.id,
    );
    const shouldDisableBoth = Boolean(
      !latestTurn
      || latestTurn.state === "waiting"
      || turnActionState?.kind === "waiting"
      || turnActionState?.kind === "rehydrating"
      || isCurrentThreadHydrating,
    );

    if (shouldDisableBoth) {
      return {
        mode,
        review: {
          enabled: false,
          reason: "当前还没有可审查的已收口结果",
        },
        steer: {
          enabled: false,
          reason: "当前没有执行中的任务可调整",
        },
      };
    }

    if (latestTurn.state === "completed" || latestTurn.state === "failed" || latestTurn.state === "cancelled") {
      return {
        mode,
        review: {
          enabled: true,
          reason: "",
        },
        steer: {
          enabled: false,
          reason: "当前没有执行中的任务可调整",
        },
      };
    }

    if (latestTurn.state === "running") {
      return {
        mode,
        review: {
          enabled: false,
          reason: "当前还没有可审查的已收口结果",
        },
        steer: {
          enabled: true,
          reason: "",
        },
      };
    }

    return {
      mode,
      review: {
        enabled: false,
        reason: "当前还没有可审查的已收口结果",
      },
      steer: {
        enabled: false,
        reason: "当前没有执行中的任务可调整",
      },
    };
  }

  function resolveThreadControlState(thread) {
    const latestTurn = Array.isArray(thread?.turns) ? thread.turns.at(-1) : null;
    const waiting = Boolean(latestTurn?.state === "waiting" && latestTurn?.pendingAction);
    const syncing = Boolean(
      latestTurn?.submittedPendingActionId
      || (thread?.historyNeedsRehydrate && app.runtime.restoredActionHydrationThreadId === thread?.id),
    );
    const running = Boolean(latestTurn?.state === "running" || latestTurn?.state === "queued");
    const historyOriginKind = thread?.historyOriginKind === "fork" ? "fork" : "standard";
    const sourceKind = thread?.threadOrigin === "attached"
      ? "attached"
      : thread?.threadOrigin === "fork" || historyOriginKind === "fork"
        ? "fork"
        : "standard";
    const sourceLabel = sourceKind === "fork"
      ? "fork"
      : sourceKind === "attached"
        ? "已接入"
        : "普通会话";
    const status = waiting
      ? { kind: "waiting", label: "等待处理中的 action" }
      : syncing
        ? { kind: "syncing", label: "正在同步" }
        : running
          ? { kind: "running", label: "正在执行" }
          : { kind: "idle", label: "当前空闲" };

    return {
      status,
      source: {
        kind: sourceKind,
        label: sourceLabel,
      },
      conversationId: thread?.id ?? "",
      joinHint: waiting || syncing || running
        ? "切走后只是离开当前线程视图，不会改变目标线程真实执行状态。"
        : "把飞书 /current 或其他渠道拿到的 conversationId 粘贴到这里，就能切到同一条统一会话。",
      details: [
        { label: "conversationId", value: thread?.id ?? "" },
        ...(thread?.serverThreadId ? [{ label: "serverThreadId", value: thread.serverThreadId }] : []),
        { label: "来源", value: sourceLabel },
        ...(thread?.historyOriginLabel ? [{ label: "分支来源", value: thread.historyOriginLabel }] : []),
        ...(thread?.historyOriginSessionId ? [{ label: "源会话", value: thread.historyOriginSessionId }] : []),
        ...(thread?.historyArchivedAt ? [{ label: "归档状态", value: "已归档" }] : []),
      ],
    };
  }

  function hasRecoverableServerState(thread, turn) {
    return Boolean(
      thread?.serverHistoryAvailable
      || thread?.serverThreadId
      || turn?.serverThreadId
      || turn?.requestId
      || turn?.taskId,
    );
  }

  function hasRecoverySyncStep(turn) {
    const latestStep = Array.isArray(turn?.steps) ? turn.steps.at(-1) : null;
    return latestStep?.title === "等待服务端同步状态";
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

    if (
      thread.serverHistoryAvailable
      && shouldApplyServerFilteredVisibility(query)
      && thread.id !== state.activeThreadId
    ) {
      const filteredSessionIds = app.runtime.historyServerFilterSessionIds;

      if (!(filteredSessionIds instanceof Set) || !filteredSessionIds.has(thread.id)) {
        return false;
      }
    }

    if (thread.historyArchivedAt && !app.runtime.historyIncludeArchived && thread.id !== state.activeThreadId) {
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
      thread.id,
      thread.storedSummary,
      thread.historyOriginLabel,
      thread.historyOriginSessionId,
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

  function shouldApplyServerFilteredVisibility(query = "") {
    if (!app.runtime.historyServerFilterActive || !(app.runtime.historyServerFilterSessionIds instanceof Set)) {
      return false;
    }

    const currentQuery = typeof query === "string" ? query.trim() : "";
    const snapshotQuery = typeof app.runtime.historyServerFilterQuery === "string"
      ? app.runtime.historyServerFilterQuery
      : "";
    const currentIncludeArchived = Boolean(app.runtime.historyIncludeArchived);
    const snapshotIncludeArchived = Boolean(app.runtime.historyServerFilterIncludeArchived);

    return currentQuery === snapshotQuery && currentIncludeArchived === snapshotIncludeArchived;
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
    thread.historyNeedsRehydrate = thread.turns.some((candidate) => Boolean(candidate?.submittedPendingActionId));
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
    const principalTaskSettings = resolvePrincipalTaskSettings();
    const configuredModel = normalizeText(runtimeConfig.defaults.model);

    return dedupeModels(
      runtimeConfig.models.filter((model) =>
        !model.hidden
        || model.model === configuredModel
        || model.model === settings?.model
        || model.model === principalTaskSettings.model
      ),
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
    const capabilities = createDefaultModelCapabilities(supportsCodexTasks);

    return {
      id: modelId,
      model: modelId,
      displayName: modelId,
      description,
      hidden: false,
      supportedReasoningEfforts: DEFAULT_REASONING_OPTIONS,
      defaultReasoningEffort: "",
      contextWindow: null,
      capabilities,
      supportsPersonality: false,
      supportsCodexTasks: capabilities.supportsCodexTasks,
      isDefault: false,
    };
  }

  function normalizeText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }

  function normalizeComposerMode(value) {
    if (value === "chat" || value === "review" || value === "steer") {
      return value;
    }

    return "chat";
  }

  function normalizeBooleanSetting(value) {
    return typeof value === "boolean" ? value : null;
  }

  function formatThreadTitle(thread) {
    return typeof thread?.title === "string" && thread.title.trim() ? thread.title.trim() : "新会话";
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

  function resolveThirdPartyWebSearchWarning(settings, resolvedModel = null) {
    const effectiveSettings = resolveEffectiveSettings(settings);

    if (effectiveSettings.accessMode !== "third-party") {
      return "";
    }

    const selection = resolveThirdPartySelection(settings);
    const model = resolvedModel ?? selection.model;

    if (!model) {
      return "";
    }

    const capabilities = getThirdPartyModelCapabilities(model);

    if (effectiveSettings.webSearchMode && effectiveSettings.webSearchMode !== "disabled" && !capabilities.supportsSearchTool) {
      return "当前会话开启了联网搜索，但这个模型未声明支持 search tool";
    }

    return "";
  }

  function applyThirdPartyWebSearchConstraint(settings, patch = {}) {
    const merged = {
      ...settings,
      ...patch,
    };
    const effectiveSettings = resolveEffectiveSettings(merged);

    if (effectiveSettings.accessMode !== "third-party") {
      return {
        patch,
        message: "",
      };
    }

    const selection = resolveThirdPartySelection(merged);
    const model = selection.model;

    if (!model) {
      return {
        patch,
        message: "",
      };
    }

    const capabilities = getThirdPartyModelCapabilities(model);
    const hasWebSearchEnabled = effectiveSettings.webSearchMode && effectiveSettings.webSearchMode !== "disabled";

    if (!hasWebSearchEnabled || capabilities.supportsSearchTool) {
      return {
        patch,
        message: "",
      };
    }

    return {
      patch: {
        ...patch,
        webSearchMode: "disabled",
      },
      message: "当前第三方模型未声明支持 search tool，已自动关闭联网搜索。",
    };
  }

  return {
    buildTaskOptions,
    getVisibleModels,
    getThirdPartyProviders,
    getThirdPartyModels,
    getThirdPartyModelCapabilities,
    getReasoningOptions,
    applyThirdPartyWebSearchConstraint,
    describeAssistantStyle,
    resolveAssistantDisplayLabel,
    resolveAccessMode,
    resolveThirdPartySelection,
    resolveThirdPartyWebSearchWarning,
    resolveInheritedSettings,
    resolveEffectiveSettings,
    shouldBootstrapThread,
    repairInterruptedTurns,
    resolveTopRiskState,
    resolveTurnActionState,
    resolveComposerActionBarState,
    resolveThreadControlState,
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
