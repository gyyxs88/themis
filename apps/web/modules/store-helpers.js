import { nowIso, summarizeForSidebar } from "./utils.js";

export function createStoreHelpers({ app, getState, saveState }) {
  const DEFAULT_REASONING_OPTIONS = [
    { reasoningEffort: "low", description: "low" },
    { reasoningEffort: "medium", description: "medium" },
    { reasoningEffort: "high", description: "high" },
    { reasoningEffort: "xhigh", description: "xhigh" },
  ];

  function buildTaskOptions(settings) {
    const effective = resolveEffectiveSettings(settings);
    const options = {
      ...(effective.model ? { model: effective.model } : {}),
      ...(effective.reasoning ? { reasoning: effective.reasoning } : {}),
      ...(effective.approvalPolicy ? { approvalPolicy: effective.approvalPolicy } : {}),
    };

    return Object.keys(options).length ? options : undefined;
  }

  function getRuntimeConfig() {
    return app.runtime.runtimeConfig ?? {
      status: "idle",
      errorMessage: "",
      models: [],
      defaults: {
        model: "",
        reasoning: "",
        approvalPolicy: "",
      },
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

  function getReasoningOptions(settings) {
    const inherited = resolveInheritedSettings(settings);
    const model = getModelById(inherited.model, settings);
    const options = Array.isArray(model?.supportedReasoningEfforts) && model.supportedReasoningEfforts.length
      ? model.supportedReasoningEfforts
      : DEFAULT_REASONING_OPTIONS;

    if (settings?.reasoning && !options.some((option) => option.reasoningEffort === settings.reasoning)) {
      return [
        {
          reasoningEffort: settings.reasoning,
          description: settings.reasoning,
        },
        ...options,
      ];
    }

    return options;
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
    const model = getModelById(inheritedModel, settings);
    const reasoningOptions = Array.isArray(model?.supportedReasoningEfforts) && model.supportedReasoningEfforts.length
      ? model.supportedReasoningEfforts
      : DEFAULT_REASONING_OPTIONS;
    const configuredReasoning = normalizeText(runtimeConfig.defaults.reasoning);
    const inheritedReasoning = reasoningOptions.some((option) => option.reasoningEffort === configuredReasoning)
      ? configuredReasoning
      : normalizeText(model?.defaultReasoningEffort);

    return {
      model: inheritedModel,
      reasoning: inheritedReasoning || "",
      approvalPolicy: normalizeText(runtimeConfig.defaults.approvalPolicy) || "untrusted",
    };
  }

  function resolveEffectiveSettings(settings) {
    const inherited = resolveInheritedSettings(settings);
    const reasoningOptions = getReasoningOptions(settings);
    const explicitReasoning = normalizeText(settings?.reasoning);

    return {
      model: normalizeText(settings?.model) || inherited.model,
      reasoning: reasoningOptions.some((option) => option.reasoningEffort === explicitReasoning)
        ? explicitReasoning
        : inherited.reasoning,
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

  function getModelById(modelId, settings) {
    if (!modelId) {
      return null;
    }

    const models = getVisibleModelsWithoutFallback(settings);
    return models.find((model) => model.model === modelId) ?? createSyntheticModel(modelId);
  }

  function dedupeModels(models) {
    const unique = new Map();

    for (const model of models) {
      unique.set(model.model, model);
    }

    return [...unique.values()];
  }

  function createSyntheticModel(modelId) {
    return {
      id: modelId,
      model: modelId,
      displayName: modelId,
      description: "当前线程记录的模型，没有出现在 Codex 当前返回的模型列表中。",
      hidden: false,
      supportedReasoningEfforts: DEFAULT_REASONING_OPTIONS,
      defaultReasoningEffort: "",
      supportsPersonality: false,
      isDefault: false,
    };
  }

  function normalizeText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim();
  }

  return {
    buildTaskOptions,
    getVisibleModels,
    getReasoningOptions,
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
