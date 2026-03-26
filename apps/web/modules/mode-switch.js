export function createDefaultModeSwitchDraftState() {
  return {
    threadId: "",
    accessMode: "auth",
    authAccountId: "",
    thirdPartyModel: "",
    dirty: false,
  };
}

export function createModeSwitchController(app) {
  const { dom, store } = app;

  function bindControls() {
    dom.accessModeSelect.addEventListener("change", () => {
      updateDraft({
        accessMode: dom.accessModeSelect.value,
      });
    });

    dom.modeSwitchAuthAccountSelect.addEventListener("change", () => {
      updateDraft({
        authAccountId: dom.modeSwitchAuthAccountSelect.value,
      });
    });

    dom.modeSwitchThirdPartyModelSelect.addEventListener("change", () => {
      updateDraft({
        thirdPartyModel: dom.modeSwitchThirdPartyModelSelect.value,
      });
    });

    dom.accessModeApplyButton.addEventListener("click", () => {
      void applyDraft();
    });
  }

  function getDraft(settings = store.getActiveThread()?.settings ?? store.createDefaultThreadSettings()) {
    const thread = store.getActiveThread();
    return syncDraft(thread, settings);
  }

  function updateDraft(patch) {
    const thread = store.getActiveThread();

    if (!thread) {
      return;
    }

    const settings = thread.settings ?? store.createDefaultThreadSettings();
    const current = getDraft(settings);
    app.runtime.modeSwitchDraft = finalizeDraft({
      ...current,
      ...patch,
    }, thread.id, settings, store);
    app.renderer.renderAll();
  }

  async function applyDraft() {
    const thread = store.getActiveThread();

    if (!thread) {
      return;
    }

    const settings = thread.settings ?? store.createDefaultThreadSettings();
    const draft = getDraft(settings);

    if (!draft.dirty) {
      return;
    }

    const nextSettings = {
      accessMode: draft.accessMode === "third-party" ? "third-party" : "",
    };

    if (draft.accessMode === "third-party") {
      nextSettings.thirdPartyModel = draft.thirdPartyModel || "";
    }

    const reasoningOptions = store.getReasoningOptions({
      ...settings,
      ...nextSettings,
    });

    if (
      settings.reasoning
      && !reasoningOptions.some((option) => option.reasoningEffort === settings.reasoning)
    ) {
      nextSettings.reasoning = "";
    }

    store.updateThreadSettings(nextSettings);

    if (draft.accessMode === "auth") {
      const currentTaskSettings = app.runtime.identity?.taskSettings ?? {};
      await app.identity.saveTaskSettings({
        ...currentTaskSettings,
        authAccountId: draft.authAccountId || "",
      }, { quiet: true });
    }

    const appliedSettings = {
      ...settings,
      ...nextSettings,
    };
    const appliedSelection = store.resolveThirdPartySelection(appliedSettings);

    app.thirdPartyProbe.clearIfSelectionChanged(
      appliedSelection.provider?.id || "",
      appliedSelection.model?.model || appliedSelection.modelId || "",
    );
    app.thirdPartyEndpointProbe.clearIfProviderChanged(appliedSelection.provider?.id || "");

    const activeThread = store.getActiveThread();
    app.runtime.modeSwitchDraft = buildDraftState(
      activeThread?.id || "",
      activeThread?.settings ?? store.createDefaultThreadSettings(),
      store,
    );
    app.renderer.renderAll();
  }

  return {
    bindControls,
    getDraft,
    applyDraft,
  };

  function syncDraft(thread, settings) {
    const threadId = thread?.id || "";
    const current = app.runtime.modeSwitchDraft ?? createDefaultModeSwitchDraftState();
    const next = current.threadId !== threadId || !current.dirty
      ? buildDraftState(threadId, settings, store)
      : finalizeDraft(current, threadId, settings, store);

    if (!isSameDraft(current, next)) {
      app.runtime.modeSwitchDraft = next;
    }

    return app.runtime.modeSwitchDraft;
  }
}

function buildDraftState(threadId, settings, store) {
  const effectiveSettings = store.resolveEffectiveSettings(settings);
  const selection = store.resolveThirdPartySelection(settings);

  return {
    ...createDefaultModeSwitchDraftState(),
    threadId,
    accessMode: effectiveSettings.accessMode || "auth",
    authAccountId: normalizeText(effectiveSettings.authAccountId),
    thirdPartyModel: selection.modelId || effectiveSettings.thirdPartyModel || "",
    dirty: false,
  };
}

function finalizeDraft(draft, threadId, settings, store) {
  const effectiveSettings = store.resolveEffectiveSettings(settings);
  const selection = store.resolveThirdPartySelection(settings);
  const normalizedAccessMode = draft.accessMode === "third-party" && store.getThirdPartyProviders().length
    ? "third-party"
    : "auth";
  const normalizedAuthAccountId = normalizedAccessMode === "auth" ? normalizeText(draft.authAccountId) : "";
  const fallbackModel = selection.modelId || effectiveSettings.thirdPartyModel || "";
  const candidateModel = normalizeText(draft.thirdPartyModel);
  const normalizedThirdPartyModel = selection.models.some((model) => model.model === candidateModel)
    ? candidateModel
    : fallbackModel;

  return {
    ...createDefaultModeSwitchDraftState(),
    threadId,
    accessMode: normalizedAccessMode,
    authAccountId: normalizedAuthAccountId,
    thirdPartyModel: normalizedThirdPartyModel,
    dirty: hasDraftChanges(
      {
        accessMode: normalizedAccessMode,
        authAccountId: normalizedAuthAccountId,
        thirdPartyModel: normalizedThirdPartyModel,
      },
      settings,
      effectiveSettings,
    ),
  };
}

function hasDraftChanges(draft, settings, effectiveSettings) {
  const currentAccessMode = effectiveSettings.accessMode || "auth";
  const currentAuthAccountId = normalizeText(effectiveSettings.authAccountId);

  if (draft.accessMode !== currentAccessMode) {
    return true;
  }

  if (draft.accessMode === "auth" && draft.authAccountId !== currentAuthAccountId) {
    return true;
  }

  if (draft.accessMode !== "third-party") {
    return false;
  }

  return draft.thirdPartyModel !== (effectiveSettings.thirdPartyModel || "");
}

function isSameDraft(left, right) {
  return left.threadId === right.threadId
    && left.accessMode === right.accessMode
    && left.authAccountId === right.authAccountId
    && left.thirdPartyModel === right.thirdPartyModel
    && left.dirty === right.dirty;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
