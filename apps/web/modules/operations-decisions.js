const FILTER_STATUSES = new Set(["active", "superseded", "archived", "all"]);
const DECISION_STATUSES = new Set(["active", "superseded", "archived"]);

export function createDefaultOperationsDecisionsState() {
  return {
    status: "idle",
    loading: false,
    submitting: false,
    errorMessage: "",
    noticeMessage: "",
    filterStatus: "active",
    decisions: [],
    selectedDecisionId: "",
    draft: createDefaultDraft(),
  };
}

export function createOperationsDecisionsController(app) {
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
        // Errors are already reflected in operationsDecisions state for the UI.
      }
    };

    dom?.operationsDecisionsRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.operationsDecisionsNewButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsDecisionsFilterSelect?.addEventListener("change", () => {
      setState({
        filterStatus: normalizeFilterStatus(dom.operationsDecisionsFilterSelect?.value),
        noticeMessage: "",
      });
      render();
      void runSafely(load);
    });

    dom?.operationsDecisionsTitleInput?.addEventListener("input", () => {
      updateDraft({
        title: dom.operationsDecisionsTitleInput.value,
      });
    });

    dom?.operationsDecisionsStatusSelect?.addEventListener("change", () => {
      updateDraft({
        status: normalizeStatus(dom.operationsDecisionsStatusSelect?.value),
      });
    });

    dom?.operationsDecisionsDecidedByInput?.addEventListener("input", () => {
      updateDraft({
        decidedByPrincipalId: dom.operationsDecisionsDecidedByInput.value,
      });
    });

    dom?.operationsDecisionsDecidedAtInput?.addEventListener("input", () => {
      updateDraft({
        decidedAt: dom.operationsDecisionsDecidedAtInput.value,
      });
    });

    dom?.operationsDecisionsRelatedAssetsInput?.addEventListener("input", () => {
      updateDraft({
        relatedAssetIdsText: dom.operationsDecisionsRelatedAssetsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsDecisionsRelatedAssetsInput);
    });

    dom?.operationsDecisionsRelatedWorkItemsInput?.addEventListener("input", () => {
      updateDraft({
        relatedWorkItemIdsText: dom.operationsDecisionsRelatedWorkItemsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsDecisionsRelatedWorkItemsInput);
    });

    dom?.operationsDecisionsSummaryInput?.addEventListener("input", () => {
      updateDraft({
        summary: dom.operationsDecisionsSummaryInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsDecisionsSummaryInput);
    });

    dom?.operationsDecisionsSaveButton?.addEventListener("click", () => {
      void runSafely(save);
    });

    dom?.operationsDecisionsResetButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsDecisionsList?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-operations-decision-id]");
      const decisionId = normalizeText(button?.dataset?.operationsDecisionId);

      if (!decisionId) {
        return;
      }

      selectDecision(decisionId);
    });
  }

  function setState(patch) {
    app.runtime.operationsDecisions = {
      ...app.runtime.operationsDecisions,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateDraft(patch) {
    const current = app.runtime.operationsDecisions ?? createDefaultOperationsDecisionsState();
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
    const current = app.runtime.operationsDecisions ?? createDefaultOperationsDecisionsState();
    setState({
      selectedDecisionId: "",
      draft: createDefaultDraft(),
      errorMessage: "",
      noticeMessage: current.noticeMessage,
    });
    render();
  }

  function selectDecision(decisionId) {
    const current = app.runtime.operationsDecisions ?? createDefaultOperationsDecisionsState();
    const decision = current.decisions.find((item) => normalizeText(item?.decisionId) === decisionId);

    if (!decision) {
      return;
    }

    setState({
      selectedDecisionId: decision.decisionId,
      draft: buildDraftFromDecision(decision),
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const current = app.runtime.operationsDecisions ?? createDefaultOperationsDecisionsState();
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
      const response = await fetch("/api/operations/decisions/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取决策记录失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.operationsDecisions;
      }

      const decisions = normalizeDecisionList(data?.decisions);
      const selectedDecisionId = normalizeText(current.selectedDecisionId) ?? "";
      const selectedDecision = selectedDecisionId
        ? decisions.find((item) => item.decisionId === selectedDecisionId) ?? null
        : null;
      const syncDraftFromSelected = options.syncDraftFromSelected === true;

      setState({
        status: "ready",
        decisions,
        loading: false,
        errorMessage: "",
        ...(syncDraftFromSelected
          ? {
            selectedDecisionId: selectedDecision?.decisionId ?? "",
            draft: selectedDecision ? buildDraftFromDecision(selectedDecision) : createDefaultDraft(),
          }
          : {}),
      });
      render();
      return app.runtime.operationsDecisions;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.operationsDecisions;
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
    const current = app.runtime.operationsDecisions ?? createDefaultOperationsDecisionsState();
    const selectedDecisionId = normalizeText(current.selectedDecisionId);
    const payloadDecision = buildDecisionPayloadFromDraft(current.draft);
    const creating = !selectedDecisionId;

    setState({
      submitting: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch(
        creating ? "/api/operations/decisions/create" : "/api/operations/decisions/update",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...buildIdentityPayload(app),
            decision: {
              ...(selectedDecisionId ? { decisionId: selectedDecisionId } : {}),
              ...payloadDecision,
            },
          }),
        },
      );
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存决策记录失败。");
      }

      const savedDecision = normalizeDecisionRecord(data?.decision);
      const nextFilterStatus = savedDecision
        ? resolvePostSaveFilterStatus(current.filterStatus, savedDecision.status)
        : current.filterStatus;

      setState({
        submitting: false,
        errorMessage: "",
        noticeMessage: creating ? "已新建决策记录。" : "已更新决策记录。",
        filterStatus: nextFilterStatus,
        selectedDecisionId: savedDecision?.decisionId ?? "",
        ...(savedDecision ? { draft: buildDraftFromDecision(savedDecision) } : {}),
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
      return app.runtime.operationsDecisions;
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
    selectDecision,
  };
}

function createDefaultDraft() {
  return {
    title: "",
    status: "active",
    decidedByPrincipalId: "",
    decidedAt: "",
    relatedAssetIdsText: "",
    relatedWorkItemIdsText: "",
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

function buildDecisionPayloadFromDraft(draft) {
  return {
    title: normalizeRequiredText(draft?.title, "决策标题不能为空。"),
    status: normalizeStatus(draft?.status),
    ...(normalizeText(draft?.decidedByPrincipalId)
      ? { decidedByPrincipalId: normalizeText(draft?.decidedByPrincipalId) }
      : {}),
    ...(normalizeText(draft?.decidedAt) ? { decidedAt: normalizeText(draft?.decidedAt) } : {}),
    summary: typeof draft?.summary === "string" ? draft.summary.trim() : "",
    relatedAssetIds: parseRelatedIdsText(draft?.relatedAssetIdsText),
    relatedWorkItemIds: parseRelatedIdsText(draft?.relatedWorkItemIdsText),
  };
}

function buildDraftFromDecision(decision) {
  return {
    title: decision.title ?? "",
    status: normalizeStatus(decision.status),
    decidedByPrincipalId: decision.decidedByPrincipalId ?? "",
    decidedAt: decision.decidedAt ?? "",
    relatedAssetIdsText: Array.isArray(decision.relatedAssetIds) ? decision.relatedAssetIds.join("\n") : "",
    relatedWorkItemIdsText: Array.isArray(decision.relatedWorkItemIds) ? decision.relatedWorkItemIds.join("\n") : "",
    summary: decision.summary ?? "",
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

function normalizeDecisionList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeDecisionRecord)
    .filter(Boolean);
}

function normalizeDecisionRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const decisionId = normalizeText(value.decisionId);
  const principalId = normalizeText(value.principalId);
  const title = normalizeText(value.title);
  const status = normalizeStatus(value.status);
  const summary = normalizeText(value.summary);
  const decidedByPrincipalId = normalizeText(value.decidedByPrincipalId);
  const decidedAt = normalizeText(value.decidedAt);
  const relatedAssetIds = parseRelatedIdsArray(value.relatedAssetIds);
  const relatedWorkItemIds = parseRelatedIdsArray(value.relatedWorkItemIds);

  if (!decisionId || !principalId || !title || !decidedAt) {
    return null;
  }

  return {
    decisionId,
    principalId,
    title,
    status,
    ...(summary ? { summary } : {}),
    ...(decidedByPrincipalId ? { decidedByPrincipalId } : {}),
    decidedAt,
    relatedAssetIds,
    relatedWorkItemIds,
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

function normalizeStatus(value) {
  return DECISION_STATUSES.has(value) ? value : "active";
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

function resolvePostSaveFilterStatus(currentFilterStatus, decisionStatus) {
  if (currentFilterStatus === "all" || currentFilterStatus === decisionStatus) {
    return currentFilterStatus;
  }

  return decisionStatus;
}
