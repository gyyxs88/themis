import { createId, nowIso } from "./utils.js";

const FALLBACK_TASK_INPUT_ENVELOPE_SOURCE_CHANNEL = "web";
const FALLBACK_TASK_INPUT_ENVELOPE_CREATED_AT = "1970-01-01T00:00:00.000Z";

export function createStoreModelHelpers() {
  function createDefaultThreadSettings() {
    return {
      profile: "",
      accessMode: "",
      authAccountId: "",
      model: "",
      reasoning: "",
      approvalPolicy: "",
      sandboxMode: "",
      webSearchMode: "",
      networkAccessEnabled: "",
      thirdPartyProviderId: "",
      thirdPartyModel: "",
      workspacePath: "",
    };
  }

  function createThread(options = {}) {
    const timestamp = nowIso();
    const settings = {
      ...createDefaultThreadSettings(),
      ...(options.settings && typeof options.settings === "object" ? options.settings : {}),
    };

    return {
      id: createId("thread"),
      title: "新会话",
      createdAt: timestamp,
      updatedAt: timestamp,
      draftGoal: "",
      draftContext: "",
      draftInputAssets: [],
      composerMode: normalizeComposerMode(options.composerMode),
      threadOrigin: normalizeThreadOrigin(options.threadOrigin),
      settings: normalizeThreadSettings(settings),
      serverThreadId: null,
      bootstrapTranscript: "",
      bootstrapMode: null,
      serverHistoryAvailable: false,
      storedTurnCount: 0,
      storedSummary: "",
      storedStatus: null,
      historyArchivedAt: null,
      historyOriginKind: "standard",
      historyOriginSessionId: null,
      historyOriginLabel: null,
      historyHydrated: true,
      historyNeedsRehydrate: false,
      turns: [],
    };
  }

  function createInitialState() {
    const thread = createThread();

    return {
      activeThreadId: thread.id,
      threads: [thread],
    };
  }

  function createTurn({ goal, inputText, options, inputEnvelope }) {
    const normalizedInputEnvelope = normalizeTaskInputEnvelope(inputEnvelope);

    return {
      id: createId("turn"),
      createdAt: nowIso(),
      goal,
      inputText,
      ...(normalizedInputEnvelope ? { inputEnvelope: normalizedInputEnvelope } : {}),
      ...(options ? { options } : {}),
      requestId: null,
      taskId: null,
      pendingAction: null,
      pendingActionInputText: "",
      pendingActionError: "",
      pendingActionSubmitting: false,
      submittedPendingActionId: null,
      serverThreadId: null,
      serverSessionId: null,
      sessionMode: null,
      state: "queued",
      assistantMessages: [],
      steps: [
        {
          title: "准备执行",
          text: "正在连接 Themis 后端并等待任务回执。",
          tone: "neutral",
        },
      ],
      result: null,
    };
  }

  function normalizeState(value) {
    const threads = Array.isArray(value?.threads)
      ? value.threads.map(normalizeThread).filter(Boolean)
      : [];

    return {
      activeThreadId: typeof value?.activeThreadId === "string" ? value.activeThreadId : threads[0]?.id ?? null,
      threads: threads.length ? threads : [createThread()],
    };
  }

  function normalizeThread(thread) {
    if (!thread || typeof thread !== "object") {
      return null;
    }

    return {
      id: typeof thread.id === "string" ? thread.id : createId("thread"),
      title: typeof thread.title === "string" && thread.title.trim() ? thread.title : "新会话",
      createdAt: typeof thread.createdAt === "string" ? thread.createdAt : nowIso(),
      updatedAt: typeof thread.updatedAt === "string" ? thread.updatedAt : nowIso(),
      draftGoal: typeof thread.draftGoal === "string" ? thread.draftGoal : "",
      draftContext: typeof thread.draftContext === "string" ? thread.draftContext : "",
      draftInputAssets: normalizeDraftInputAssets(thread.draftInputAssets),
      composerMode: normalizeComposerMode(thread.composerMode),
      threadOrigin: normalizeThreadOrigin(thread.threadOrigin),
      settings: normalizeThreadSettings(thread.settings),
      serverThreadId: typeof thread.serverThreadId === "string" ? thread.serverThreadId : null,
      bootstrapTranscript: typeof thread.bootstrapTranscript === "string" ? thread.bootstrapTranscript : "",
      bootstrapMode: normalizeBootstrapMode(thread.bootstrapMode),
      serverHistoryAvailable: typeof thread.serverHistoryAvailable === "boolean" ? thread.serverHistoryAvailable : false,
      storedTurnCount: Number.isFinite(thread.storedTurnCount) ? Math.max(0, Number(thread.storedTurnCount)) : 0,
      storedSummary: typeof thread.storedSummary === "string" ? thread.storedSummary : "",
      storedStatus: typeof thread.storedStatus === "string" ? thread.storedStatus : null,
      historyArchivedAt: typeof thread.historyArchivedAt === "string" ? thread.historyArchivedAt : null,
      historyOriginKind: normalizeHistoryOriginKind(thread.historyOriginKind),
      historyOriginSessionId: typeof thread.historyOriginSessionId === "string" ? thread.historyOriginSessionId : null,
      historyOriginLabel: typeof thread.historyOriginLabel === "string" ? thread.historyOriginLabel : null,
      historyHydrated: typeof thread.historyHydrated === "boolean" ? thread.historyHydrated : true,
      historyNeedsRehydrate: typeof thread.historyNeedsRehydrate === "boolean" ? thread.historyNeedsRehydrate : false,
      turns: Array.isArray(thread.turns) ? thread.turns.map(normalizeTurn).filter(Boolean) : [],
    };
  }

  function normalizeTurn(turn) {
    if (!turn || typeof turn !== "object") {
      return null;
    }

    const inputEnvelope = normalizeTaskInputEnvelope(turn.inputEnvelope);

    return {
      id: typeof turn.id === "string" ? turn.id : createId("turn"),
      createdAt: typeof turn.createdAt === "string" ? turn.createdAt : nowIso(),
      goal: typeof turn.goal === "string" ? turn.goal : "",
      inputText: typeof turn.inputText === "string" ? turn.inputText : "",
      ...(inputEnvelope ? { inputEnvelope } : {}),
      options: normalizeTurnOptions(turn.options),
      requestId: typeof turn.requestId === "string" ? turn.requestId : null,
      taskId: typeof turn.taskId === "string" ? turn.taskId : null,
      pendingAction: normalizePendingAction(turn.pendingAction),
      pendingActionInputText: typeof turn.pendingActionInputText === "string" ? turn.pendingActionInputText : "",
      pendingActionError: typeof turn.pendingActionError === "string" ? turn.pendingActionError : "",
      pendingActionSubmitting: typeof turn.pendingActionSubmitting === "boolean" ? turn.pendingActionSubmitting : false,
      submittedPendingActionId: typeof turn.submittedPendingActionId === "string" ? turn.submittedPendingActionId : null,
      serverThreadId: typeof turn.serverThreadId === "string" ? turn.serverThreadId : null,
      serverSessionId: typeof turn.serverSessionId === "string" ? turn.serverSessionId : null,
      sessionMode: typeof turn.sessionMode === "string" ? turn.sessionMode : null,
      state: typeof turn.state === "string" ? turn.state : "queued",
      assistantMessages: Array.isArray(turn.assistantMessages)
        ? turn.assistantMessages.map(normalizeAssistantMessage).filter(Boolean)
        : [],
      steps: Array.isArray(turn.steps) ? turn.steps.map(normalizeStep).filter(Boolean) : [],
      result: normalizeResult(turn.result),
    };
  }

  function normalizeAssistantMessage(message) {
    if (!message || typeof message !== "object") {
      return null;
    }

    const text = typeof message.text === "string" ? message.text.trim() : "";

    if (!text) {
      return null;
    }

    return {
      id: typeof message.id === "string" && message.id ? message.id : createId("assistant-msg"),
      text,
    };
  }

  function normalizeDraftInputAssets(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((asset) => {
        if (!asset || typeof asset !== "object") {
          return null;
        }

        const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : null;
        const textExtraction = asset.textExtraction && typeof asset.textExtraction === "object"
          ? asset.textExtraction
          : null;

        return {
          ...(typeof asset.assetId === "string" ? { assetId: asset.assetId } : {}),
          ...(asset.kind === "image" || asset.kind === "document" ? { kind: asset.kind } : {}),
          ...(typeof asset.name === "string" ? { name: asset.name } : {}),
          ...(typeof asset.mimeType === "string" ? { mimeType: asset.mimeType } : {}),
          ...(Number.isFinite(asset.sizeBytes) ? { sizeBytes: Number(asset.sizeBytes) } : {}),
          ...(typeof asset.localPath === "string" ? { localPath: asset.localPath } : {}),
          ...(typeof asset.sourceChannel === "string" ? { sourceChannel: asset.sourceChannel } : {}),
          ...(typeof asset.sourceMessageId === "string" ? { sourceMessageId: asset.sourceMessageId } : {}),
          ...(typeof asset.createdAt === "string" ? { createdAt: asset.createdAt } : {}),
          ...(textExtraction ? { textExtraction } : {}),
          ...(metadata ? { metadata } : {}),
          ...(typeof asset.ingestionStatus === "string" ? { ingestionStatus: asset.ingestionStatus } : {}),
        };
      })
      .filter(Boolean);
  }

  function normalizeTaskInputEnvelope(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const envelopeId = typeof value.envelopeId === "string" ? value.envelopeId : "";
    const sourceChannel = typeof value.sourceChannel === "string" && value.sourceChannel
      ? value.sourceChannel
      : FALLBACK_TASK_INPUT_ENVELOPE_SOURCE_CHANNEL;
    const createdAt = typeof value.createdAt === "string" && value.createdAt
      ? value.createdAt
      : FALLBACK_TASK_INPUT_ENVELOPE_CREATED_AT;

    const parts = Array.isArray(value.parts)
      ? value.parts.map(normalizeTaskInputPart).filter(Boolean)
      : [];

    return {
      envelopeId,
      sourceChannel,
      ...(typeof value.sourceSessionId === "string" ? { sourceSessionId: value.sourceSessionId } : {}),
      ...(typeof value.sourceMessageId === "string" ? { sourceMessageId: value.sourceMessageId } : {}),
      parts,
      assets: normalizeDraftInputAssets(value.assets),
      createdAt,
    };
  }

  function normalizeTaskInputPart(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const partId = typeof value.partId === "string" ? value.partId : "";
    const type = value.type === "text" || value.type === "image" || value.type === "document" ? value.type : "";
    const role = value.role === "user" ? value.role : "";
    const order = Number.isFinite(value.order) ? Number(value.order) : null;

    if (!partId || !type || !role || order === null) {
      return null;
    }

    if (type === "text") {
      if (typeof value.text !== "string") {
        return null;
      }

      return {
        partId,
        type,
        role,
        order,
        text: value.text,
      };
    }

    if (typeof value.assetId !== "string" || !value.assetId) {
      return null;
    }

    return {
      partId,
      type,
      role,
      order,
      assetId: value.assetId,
      ...(typeof value.caption === "string" ? { caption: value.caption } : {}),
    };
  }

  function normalizeStep(step) {
    if (!step || typeof step !== "object") {
      return null;
    }

    return {
      title: typeof step.title === "string" ? step.title : "执行步骤",
      text: typeof step.text === "string" ? step.text : "",
      tone: typeof step.tone === "string" ? step.tone : "neutral",
      ...(step.metadata && typeof step.metadata === "object" ? { metadata: step.metadata } : {}),
    };
  }

  function normalizeThreadSettings(value) {
    if (!value || typeof value !== "object") {
      return createDefaultThreadSettings();
    }

    return {
      profile: typeof value.profile === "string" ? value.profile : "",
      accessMode: typeof value.accessMode === "string" ? value.accessMode : "",
      authAccountId: typeof value.authAccountId === "string" ? value.authAccountId : "",
      model: typeof value.model === "string" ? value.model : "",
      reasoning: typeof value.reasoning === "string" ? value.reasoning : "",
      approvalPolicy: typeof value.approvalPolicy === "string" ? value.approvalPolicy : "",
      sandboxMode: typeof value.sandboxMode === "string" ? value.sandboxMode : "",
      webSearchMode: typeof value.webSearchMode === "string" ? value.webSearchMode : "",
      networkAccessEnabled: normalizeOptionalBooleanSetting(value.networkAccessEnabled),
      thirdPartyProviderId: typeof value.thirdPartyProviderId === "string" ? value.thirdPartyProviderId : "",
      thirdPartyModel: typeof value.thirdPartyModel === "string" ? value.thirdPartyModel : "",
      workspacePath: typeof value.workspacePath === "string" ? value.workspacePath.trim() : "",
    };
  }

  function normalizeTurnOptions(value) {
    if (!value || typeof value !== "object") {
      return undefined;
    }

      const normalized = {
        ...(typeof value.profile === "string" && value.profile ? { profile: value.profile } : {}),
        ...(typeof value.languageStyle === "string" && value.languageStyle
          ? { languageStyle: value.languageStyle }
          : {}),
        ...(typeof value.assistantMbti === "string" && value.assistantMbti
          ? { assistantMbti: value.assistantMbti }
          : {}),
        ...(typeof value.styleNotes === "string" && value.styleNotes ? { styleNotes: value.styleNotes } : {}),
        ...(typeof value.assistantSoul === "string" && value.assistantSoul ? { assistantSoul: value.assistantSoul } : {}),
        ...(typeof value.accessMode === "string" && value.accessMode ? { accessMode: value.accessMode } : {}),
        ...(typeof value.authAccountId === "string" && value.authAccountId ? { authAccountId: value.authAccountId } : {}),
        ...(typeof value.model === "string" && value.model ? { model: value.model } : {}),
        ...(typeof value.reasoning === "string" && value.reasoning ? { reasoning: value.reasoning } : {}),
        ...(typeof value.approvalPolicy === "string" && value.approvalPolicy
          ? { approvalPolicy: value.approvalPolicy }
          : {}),
        ...(typeof value.sandboxMode === "string" && value.sandboxMode ? { sandboxMode: value.sandboxMode } : {}),
        ...(typeof value.webSearchMode === "string" && value.webSearchMode ? { webSearchMode: value.webSearchMode } : {}),
        ...(typeof value.networkAccessEnabled === "boolean" ? { networkAccessEnabled: value.networkAccessEnabled } : {}),
        ...(typeof value.thirdPartyProviderId === "string" && value.thirdPartyProviderId
          ? { thirdPartyProviderId: value.thirdPartyProviderId }
          : {}),
        ...(Array.isArray(value.additionalDirectories)
          ? { additionalDirectories: value.additionalDirectories.filter((entry) => typeof entry === "string") }
          : {}),
      };

    return Object.keys(normalized).length ? normalized : undefined;
  }

  function normalizeResult(result) {
    if (!result || typeof result !== "object") {
      return null;
    }

    return {
      status: typeof result.status === "string" ? result.status : "completed",
      summary: typeof result.summary === "string" ? result.summary : "",
      ...(typeof result.output === "string" ? { output: result.output } : {}),
      ...(Array.isArray(result.touchedFiles) ? { touchedFiles: result.touchedFiles } : {}),
      ...(result.structuredOutput && typeof result.structuredOutput === "object"
        ? { structuredOutput: result.structuredOutput }
        : {}),
    };
  }

  function normalizePendingAction(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const actionId = typeof value.actionId === "string" ? value.actionId : "";
    const actionType = typeof value.actionType === "string" ? value.actionType : "";

    if (!actionId || !actionType) {
      return null;
    }

    return {
      actionId,
      actionType,
      ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
      ...(Array.isArray(value.choices) ? { choices: value.choices.filter((choice) => typeof choice === "string") } : {}),
    };
  }

  function normalizeThreadOrigin(value) {
    if (value === "fork" || value === "attached") {
      return value;
    }

    return "standard";
  }

  function normalizeHistoryOriginKind(value) {
    return value === "fork" ? "fork" : "standard";
  }

  function normalizeBootstrapMode(value) {
    if (value === "session-transcript" || value === "local-transcript") {
      return value;
    }

    return null;
  }

  function normalizeComposerMode(value) {
    if (value === "chat" || value === "review" || value === "steer") {
      return value;
    }

    return "chat";
  }

  function normalizeOptionalBooleanSetting(value) {
    return typeof value === "boolean" ? value : "";
  }

  return {
    createDefaultThreadSettings,
    createThread,
    createInitialState,
    createTurn,
    normalizeState,
    normalizeTaskInputEnvelope,
    normalizeTaskInputPart,
    normalizeThreadOrigin,
    normalizeBootstrapMode,
    normalizeComposerMode,
  };
}
