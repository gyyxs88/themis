const FILTER_STATUSES = new Set(["active", "paused", "archived", "all"]);
const CADENCE_FREQUENCIES = new Set(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"]);
const CADENCE_STATUSES = new Set(["active", "paused", "archived"]);

export function createDefaultOperationsCadencesState() {
  return {
    status: "idle",
    loading: false,
    submitting: false,
    errorMessage: "",
    noticeMessage: "",
    filterStatus: "active",
    cadences: [],
    selectedCadenceId: "",
    draft: createDefaultDraft(),
  };
}

export function createOperationsCadencesController(app) {
  const { dom, utils } = app;
  let controlsBound = false;
  let loadRequestId = 0;

  function bindControls() {
    if (controlsBound) {
      return;
    }

    controlsBound = true;
    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already reflected in operationsCadences state for the UI.
      }
    };

    dom?.operationsCadencesRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.operationsCadencesNewButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsCadencesFilterSelect?.addEventListener("change", () => {
      setState({
        filterStatus: normalizeFilterStatus(dom.operationsCadencesFilterSelect?.value),
        noticeMessage: "",
      });
      render();
      void runSafely(load);
    });

    dom?.operationsCadencesFrequencySelect?.addEventListener("change", () => {
      updateDraft({
        frequency: normalizeFrequency(dom.operationsCadencesFrequencySelect?.value),
      });
    });

    dom?.operationsCadencesStatusSelect?.addEventListener("change", () => {
      updateDraft({
        status: normalizeStatus(dom.operationsCadencesStatusSelect?.value),
      });
    });

    dom?.operationsCadencesTitleInput?.addEventListener("input", () => {
      updateDraft({
        title: dom.operationsCadencesTitleInput.value,
      });
    });

    dom?.operationsCadencesNextRunAtInput?.addEventListener("input", () => {
      updateDraft({
        nextRunAt: dom.operationsCadencesNextRunAtInput.value,
      });
    });

    dom?.operationsCadencesOwnerInput?.addEventListener("input", () => {
      updateDraft({
        ownerPrincipalId: dom.operationsCadencesOwnerInput.value,
      });
    });

    dom?.operationsCadencesPlaybookRefInput?.addEventListener("input", () => {
      updateDraft({
        playbookRef: dom.operationsCadencesPlaybookRefInput.value,
      });
    });

    dom?.operationsCadencesRelatedAssetsInput?.addEventListener("input", () => {
      updateDraft({
        relatedAssetIdsText: dom.operationsCadencesRelatedAssetsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCadencesRelatedAssetsInput);
    });

    dom?.operationsCadencesSummaryInput?.addEventListener("input", () => {
      updateDraft({
        summary: dom.operationsCadencesSummaryInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCadencesSummaryInput);
    });

    dom?.operationsCadencesSaveButton?.addEventListener("click", () => {
      void runSafely(save);
    });

    dom?.operationsCadencesResetButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsCadencesList?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-operations-cadence-id]");
      const cadenceId = normalizeText(button?.dataset?.operationsCadenceId);

      if (!cadenceId) {
        return;
      }

      selectCadence(cadenceId);
    });
  }

  function setState(patch) {
    app.runtime.operationsCadences = {
      ...app.runtime.operationsCadences,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateDraft(patch) {
    const current = app.runtime.operationsCadences ?? createDefaultOperationsCadencesState();
    setState({
      draft: {
        ...current.draft,
        ...patch,
      },
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  function resetDraft() {
    const current = app.runtime.operationsCadences ?? createDefaultOperationsCadencesState();
    setState({
      selectedCadenceId: "",
      draft: createDefaultDraft(),
      errorMessage: "",
      noticeMessage: current.noticeMessage,
    });
    render();
  }

  function selectCadence(cadenceId) {
    const current = app.runtime.operationsCadences ?? createDefaultOperationsCadencesState();
    const cadence = current.cadences.find((item) => normalizeText(item?.cadenceId) === cadenceId);

    if (!cadence) {
      return;
    }

    setState({
      selectedCadenceId: cadence.cadenceId,
      draft: buildDraftFromCadence(cadence),
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const current = app.runtime.operationsCadences ?? createDefaultOperationsCadencesState();
    const preserveNoticeMessage = options.preserveNoticeMessage === true;

    setState({
      loading: true,
      errorMessage: "",
      ...(preserveNoticeMessage ? {} : { noticeMessage: "" }),
    });
    render();

    try {
      const payload = {
        ...buildIdentityPayload(app),
        ...(current.filterStatus !== "all" ? { status: current.filterStatus } : {}),
      };
      const response = await fetch("/api/operations/cadences/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取节奏记录失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.operationsCadences;
      }

      const cadences = normalizeCadenceList(data?.cadences);
      const selectedCadenceId = normalizeText(current.selectedCadenceId) ?? "";
      const selectedCadence = selectedCadenceId
        ? cadences.find((item) => item.cadenceId === selectedCadenceId) ?? null
        : null;
      const syncDraftFromSelected = options.syncDraftFromSelected === true;

      setState({
        status: "ready",
        cadences,
        loading: false,
        errorMessage: "",
        ...(syncDraftFromSelected
          ? {
            selectedCadenceId: selectedCadence?.cadenceId ?? "",
            draft: selectedCadence ? buildDraftFromCadence(selectedCadence) : createDefaultDraft(),
          }
          : {}),
      });
      render();
      return app.runtime.operationsCadences;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.operationsCadences;
      }

      setState({
        status: "error",
        loading: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function save() {
    const current = app.runtime.operationsCadences ?? createDefaultOperationsCadencesState();
    const selectedCadenceId = normalizeText(current.selectedCadenceId);
    const payloadCadence = buildCadencePayloadFromDraft(current.draft);
    const creating = !selectedCadenceId;

    setState({
      submitting: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch(
        creating ? "/api/operations/cadences/create" : "/api/operations/cadences/update",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...buildIdentityPayload(app),
            cadence: {
              ...(selectedCadenceId ? { cadenceId: selectedCadenceId } : {}),
              ...payloadCadence,
            },
          }),
        },
      );
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存节奏记录失败。");
      }

      const savedCadence = normalizeCadenceRecord(data?.cadence);
      const nextFilterStatus = savedCadence
        ? resolvePostSaveFilterStatus(current.filterStatus, savedCadence.status)
        : current.filterStatus;

      setState({
        submitting: false,
        errorMessage: "",
        noticeMessage: creating ? "已新建节奏。" : "已更新节奏。",
        filterStatus: nextFilterStatus,
        selectedCadenceId: savedCadence?.cadenceId ?? "",
        ...(savedCadence ? { draft: buildDraftFromCadence(savedCadence) } : {}),
      });
      render();

      await load({
        preserveNoticeMessage: true,
        syncDraftFromSelected: true,
      });
      await Promise.allSettled([
        app.operationsEdges?.load?.({ preserveNoticeMessage: true }),
        app.operationsBossView?.load?.({ preserveNoticeMessage: true }),
      ]);
      return app.runtime.operationsCadences;
    } catch (error) {
      setState({
        submitting: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  return {
    bindControls,
    load,
    save,
    resetDraft,
    selectCadence,
  };
}

function createDefaultDraft() {
  return {
    title: "",
    frequency: "weekly",
    status: "active",
    nextRunAt: "",
    ownerPrincipalId: "",
    playbookRef: "",
    relatedAssetIdsText: "",
    summary: "",
  };
}

function buildIdentityPayload(app) {
  const browserUserId = normalizeText(app.runtime?.identity?.browserUserId) || "web-browser";
  const displayName = normalizeText(app.runtime?.auth?.account?.email) || "Web Owner";

  return {
    channel: "web",
    channelUserId: browserUserId,
    displayName,
  };
}

function buildCadencePayloadFromDraft(draft) {
  return {
    title: normalizeRequiredText(draft?.title, "节奏标题不能为空。"),
    frequency: normalizeFrequency(draft?.frequency),
    status: normalizeStatus(draft?.status),
    ...(normalizeText(draft?.nextRunAt) ? { nextRunAt: normalizeText(draft?.nextRunAt) } : {}),
    ...(normalizeText(draft?.ownerPrincipalId) ? { ownerPrincipalId: normalizeText(draft?.ownerPrincipalId) } : {}),
    ...(normalizeText(draft?.playbookRef) ? { playbookRef: normalizeText(draft?.playbookRef) } : {}),
    summary: typeof draft?.summary === "string" ? draft.summary.trim() : "",
    relatedAssetIds: parseRelatedIdsText(draft?.relatedAssetIdsText),
  };
}

function buildDraftFromCadence(cadence) {
  return {
    title: cadence.title ?? "",
    frequency: normalizeFrequency(cadence.frequency),
    status: normalizeStatus(cadence.status),
    nextRunAt: cadence.nextRunAt ?? "",
    ownerPrincipalId: cadence.ownerPrincipalId ?? "",
    playbookRef: cadence.playbookRef ?? "",
    relatedAssetIdsText: Array.isArray(cadence.relatedAssetIds) ? cadence.relatedAssetIds.join("\n") : "",
    summary: cadence.summary ?? "",
  };
}

function parseRelatedIdsText(value) {
  if (typeof value !== "string") {
    return [];
  }

  return [...new Set(
    value
      .split(/[,\n]/u)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizeCadenceList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeCadenceRecord)
    .filter(Boolean);
}

function normalizeCadenceRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const cadenceId = normalizeText(value.cadenceId);
  const principalId = normalizeText(value.principalId);
  const title = normalizeText(value.title);
  const frequency = normalizeFrequency(value.frequency);
  const status = normalizeStatus(value.status);
  const nextRunAt = normalizeText(value.nextRunAt);
  const ownerPrincipalId = normalizeText(value.ownerPrincipalId);
  const playbookRef = normalizeText(value.playbookRef);
  const summary = normalizeText(value.summary);
  const relatedAssetIds = parseRelatedIdsArray(value.relatedAssetIds);

  if (!cadenceId || !principalId || !title || !nextRunAt) {
    return null;
  }

  return {
    cadenceId,
    principalId,
    title,
    frequency,
    status,
    nextRunAt,
    ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
    ...(playbookRef ? { playbookRef } : {}),
    ...(summary ? { summary } : {}),
    relatedAssetIds,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function parseRelatedIdsArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizeFilterStatus(value) {
  return FILTER_STATUSES.has(value) ? value : "active";
}

function normalizeFrequency(value) {
  return CADENCE_FREQUENCIES.has(value) ? value : "weekly";
}

function normalizeStatus(value) {
  return CADENCE_STATUSES.has(value) ? value : "active";
}

function normalizeRequiredText(value, message) {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function resolvePostSaveFilterStatus(currentFilterStatus, cadenceStatus) {
  if (currentFilterStatus === "all" || currentFilterStatus === cadenceStatus) {
    return currentFilterStatus;
  }

  return cadenceStatus;
}
