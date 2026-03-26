import { createStoreHelpers } from "./store-helpers.js";
import { createStoreModelHelpers } from "./store-models.js";
import {
  nowIso,
  pickEarlierTimestamp,
  pickLaterTimestamp,
  safeJsonParse,
  titleFromGoal,
} from "./utils.js";

export function createStore(app) {
  const { MAX_THREAD_COUNT, STORAGE_KEY } = app.constants;
  const models = createStoreModelHelpers();

  let state = loadState();
  let transientStatus = null;

  const helpers = createStoreHelpers({
    app,
    getState: () => state,
    saveState,
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return models.createInitialState();
      }

      const parsed = safeJsonParse(raw);
      return models.normalizeState(parsed);
    } catch {
      return models.createInitialState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function appendStep(turn, title, text, tone = "neutral", metadata) {
    turn.steps.push({
      title,
      text,
      tone,
      ...(metadata ? { metadata } : {}),
    });
  }

  function upsertAssistantMessage(turn, messageId, text) {
    if (!turn || typeof text !== "string") {
      return false;
    }

    const normalizedText = text.trim();

    if (!normalizedText) {
      return false;
    }

    const messages = Array.isArray(turn.assistantMessages) ? turn.assistantMessages : (turn.assistantMessages = []);
    const normalizedId = typeof messageId === "string" && messageId ? messageId : null;

    if (normalizedId) {
      const existing = messages.find((message) => message.id === normalizedId);

      if (existing) {
        existing.text = normalizedText;
        return true;
      }
    }

    messages.push({
      id: normalizedId ?? app.utils.createId("assistant-msg"),
      text: normalizedText,
    });

    return true;
  }

  function getSortedThreads() {
    return [...state.threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  function getActiveThread() {
    return state.threads.find((thread) => thread.id === state.activeThreadId) ?? null;
  }

  function getThreadById(threadId) {
    return state.threads.find((thread) => thread.id === threadId) ?? null;
  }

  function getTurn(threadId, turnId) {
    return state.threads.find((thread) => thread.id === threadId)?.turns.find((turn) => turn.id === turnId) ?? null;
  }

  function getActiveTurn() {
    if (!app.runtime.activeRunRef) {
      return null;
    }

    return getTurn(app.runtime.activeRunRef.threadId, app.runtime.activeRunRef.turnId);
  }

  function ensureActiveThread() {
    if (!state.threads.length) {
      const thread = models.createThread();
      state.threads.push(thread);
      state.activeThreadId = thread.id;
      saveState();
      return;
    }

    if (!state.activeThreadId || !getActiveThread()) {
      state.activeThreadId = getSortedThreads()[0]?.id ?? state.threads[0].id;
      saveState();
    }
  }

  function trimThreads() {
    if (state.threads.length <= MAX_THREAD_COUNT) {
      return;
    }

    const keepIds = new Set(
      getSortedThreads()
        .slice(0, MAX_THREAD_COUNT)
        .map((thread) => thread.id),
    );

    state.threads = state.threads.filter((thread) => keepIds.has(thread.id));
  }

  function touchThread(threadId) {
    const thread = getThreadById(threadId);

    if (thread) {
      thread.updatedAt = nowIso();
    }
  }

  function updateActiveDraft(field, value) {
    const thread = getActiveThread();

    if (!thread) {
      return;
    }

    thread[field] = value;
    touchThread(thread.id);
    saveState();
  }

  function updateThreadSettings(patch, options = {}) {
    const thread = getActiveThread();

    if (!thread) {
      return null;
    }

    const constrained = helpers.applyThirdPartyWebSearchConstraint(thread.settings, patch);

    thread.settings = {
      ...models.createDefaultThreadSettings(),
      ...thread.settings,
      ...constrained.patch,
    };
    if (constrained.message) {
      setTransientStatus(thread.id, constrained.message);
    }
    touchThread(thread.id);
    saveState();
    if (options.persist !== false) {
      void app.sessionSettings?.persistThreadSettings(thread.id, thread.settings, { quiet: true });
    }
    return thread.settings;
  }

  function createAndActivateThread(options = {}) {
    const thread = models.createThread(options);
    state.threads.unshift(thread);
    state.activeThreadId = thread.id;
    trimThreads();
    saveState();
    return thread;
  }

  function applyRuntimeMetadata(thread, turn, metadata) {
    const session = metadata?.session && typeof metadata.session === "object" ? metadata.session : metadata;

    if (!session || typeof session !== "object") {
      return;
    }

    if (typeof session.threadId === "string") {
      thread.serverThreadId = session.threadId;
      thread.bootstrapTranscript = "";
      thread.bootstrapMode = null;
      turn.serverThreadId = session.threadId;
    }

    if (typeof session.sessionId === "string") {
      turn.serverSessionId = session.sessionId;
    }

    if (typeof session.sessionMode === "string") {
      turn.sessionMode = session.sessionMode;
    }

    if (typeof session.mode === "string") {
      turn.sessionMode = session.mode;
    }
  }

  function getVisibleThreads(query = "") {
    return getSortedThreads().filter((thread) => helpers.shouldShowThreadInList(thread, query));
  }

  function setTransientStatus(threadId, text) {
    transientStatus = {
      threadId,
      text,
    };
  }

  function clearTransientStatus() {
    transientStatus = null;
  }

  function resolveTransientStatus(threadId) {
    if (!transientStatus || transientStatus.threadId !== threadId) {
      return null;
    }

    return transientStatus.text;
  }

  function isBusy() {
    return Boolean(app.runtime.activeRequestController && app.runtime.activeRunRef);
  }

  function getRunningThreadId() {
    return isBusy() ? app.runtime.activeRunRef.threadId : null;
  }

  function isThreadRunning(threadId) {
    return Boolean(threadId) && getRunningThreadId() === threadId;
  }

  function clearActiveRun() {
    if (app.runtime.activeRunRef) {
      touchThread(app.runtime.activeRunRef.threadId);
    }

    app.runtime.activeRequestController = null;
    app.runtime.activeRunRef = null;
    saveState();
  }

  return {
    get state() {
      return state;
    },
    set state(nextState) {
      state = nextState;
    },
    saveState,
    createDefaultThreadSettings: models.createDefaultThreadSettings,
    createThread: models.createThread,
    createTurn: models.createTurn,
    appendStep,
    upsertAssistantMessage,
    normalizeBootstrapMode: models.normalizeBootstrapMode,
    repairInterruptedTurns: helpers.repairInterruptedTurns,
    ensureActiveThread,
    getSortedThreads,
    getVisibleThreads,
    getActiveThread,
    getThreadById,
    getTurn,
    getActiveTurn,
    trimThreads,
    touchThread,
    updateActiveDraft,
    updateThreadSettings,
    createAndActivateThread,
    applyRuntimeMetadata,
    buildTaskOptions: helpers.buildTaskOptions,
    getPersonas: helpers.getPersonas,
    getVisibleModels: helpers.getVisibleModels,
    resolvePersonaProfile: helpers.resolvePersonaProfile,
    getThirdPartyProviders: helpers.getThirdPartyProviders,
    getThirdPartyModels: helpers.getThirdPartyModels,
    getReasoningOptions: helpers.getReasoningOptions,
    describeAssistantStyle: helpers.describeAssistantStyle,
    resolveAssistantDisplayLabel: helpers.resolveAssistantDisplayLabel,
    resolveAccessMode: helpers.resolveAccessMode,
    resolveThirdPartySelection: helpers.resolveThirdPartySelection,
    resolveInheritedSettings: helpers.resolveInheritedSettings,
    resolveEffectiveSettings: helpers.resolveEffectiveSettings,
    shouldBootstrapThread: helpers.shouldBootstrapThread,
    buildThreadPreview: helpers.buildThreadPreview,
    describeBootstrapLabel: helpers.describeBootstrapLabel,
    threadStatus: helpers.threadStatus,
    latestTurnMessage: helpers.latestTurnMessage,
    getVisibleAssistantMessages: helpers.getVisibleAssistantMessages,
    setTransientStatus,
    clearTransientStatus,
    resolveTransientStatus,
    syncThreadStoredState: helpers.syncThreadStoredState,
    isBusy,
    getRunningThreadId,
    isThreadRunning,
    clearActiveRun,
    isDefaultThreadTitle: helpers.isDefaultThreadTitle,
    buildLocalForkTranscript: helpers.buildLocalForkTranscript,
    titleFromGoal,
    pickEarlierTimestamp,
    pickLaterTimestamp,
  };
}
