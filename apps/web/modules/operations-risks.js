const FILTER_STATUSES = new Set(["open", "watch", "resolved", "archived", "all"]);
const RISK_TYPES = new Set(["risk", "incident"]);
const RISK_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const RISK_STATUSES = new Set(["open", "watch", "resolved", "archived"]);

export function createDefaultOperationsRisksState() {
  return {
    status: "idle",
    loading: false,
    submitting: false,
    errorMessage: "",
    noticeMessage: "",
    filterStatus: "open",
    risks: [],
    selectedRiskId: "",
    draft: createDefaultDraft(),
  };
}

export function createOperationsRisksController(app) {
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
        // Errors are already reflected in operationsRisks state for the UI.
      }
    };

    dom?.operationsRisksRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.operationsRisksNewButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsRisksFilterSelect?.addEventListener("change", () => {
      setState({
        filterStatus: normalizeFilterStatus(dom.operationsRisksFilterSelect?.value),
        noticeMessage: "",
      });
      render();
      void runSafely(load);
    });

    dom?.operationsRisksTypeSelect?.addEventListener("change", () => {
      updateDraft({
        type: normalizeType(dom.operationsRisksTypeSelect?.value),
      });
    });

    dom?.operationsRisksSeveritySelect?.addEventListener("change", () => {
      updateDraft({
        severity: normalizeSeverity(dom.operationsRisksSeveritySelect?.value),
      });
    });

    dom?.operationsRisksStatusSelect?.addEventListener("change", () => {
      updateDraft({
        status: normalizeStatus(dom.operationsRisksStatusSelect?.value),
      });
    });

    dom?.operationsRisksTitleInput?.addEventListener("input", () => {
      updateDraft({
        title: dom.operationsRisksTitleInput.value,
      });
    });

    dom?.operationsRisksOwnerInput?.addEventListener("input", () => {
      updateDraft({
        ownerPrincipalId: dom.operationsRisksOwnerInput.value,
      });
    });

    dom?.operationsRisksDetectedAtInput?.addEventListener("input", () => {
      updateDraft({
        detectedAt: dom.operationsRisksDetectedAtInput.value,
      });
    });

    dom?.operationsRisksRelatedAssetsInput?.addEventListener("input", () => {
      updateDraft({
        relatedAssetIdsText: dom.operationsRisksRelatedAssetsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsRisksRelatedAssetsInput);
    });

    dom?.operationsRisksLinkedDecisionsInput?.addEventListener("input", () => {
      updateDraft({
        linkedDecisionIdsText: dom.operationsRisksLinkedDecisionsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsRisksLinkedDecisionsInput);
    });

    dom?.operationsRisksRelatedWorkItemsInput?.addEventListener("input", () => {
      updateDraft({
        relatedWorkItemIdsText: dom.operationsRisksRelatedWorkItemsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsRisksRelatedWorkItemsInput);
    });

    dom?.operationsRisksSummaryInput?.addEventListener("input", () => {
      updateDraft({
        summary: dom.operationsRisksSummaryInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsRisksSummaryInput);
    });

    dom?.operationsRisksSaveButton?.addEventListener("click", () => {
      void runSafely(save);
    });

    dom?.operationsRisksResetButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsRisksList?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-operations-risk-id]");
      const riskId = normalizeText(button?.dataset?.operationsRiskId);

      if (!riskId) {
        return;
      }

      selectRisk(riskId);
    });
  }

  function setState(patch) {
    app.runtime.operationsRisks = {
      ...app.runtime.operationsRisks,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateDraft(patch) {
    const current = app.runtime.operationsRisks ?? createDefaultOperationsRisksState();
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
    const current = app.runtime.operationsRisks ?? createDefaultOperationsRisksState();
    setState({
      selectedRiskId: "",
      draft: createDefaultDraft(),
      errorMessage: "",
      noticeMessage: current.noticeMessage,
    });
    render();
  }

  function selectRisk(riskId) {
    const current = app.runtime.operationsRisks ?? createDefaultOperationsRisksState();
    const risk = current.risks.find((item) => normalizeText(item?.riskId) === riskId);

    if (!risk) {
      return;
    }

    setState({
      selectedRiskId: risk.riskId,
      draft: buildDraftFromRisk(risk),
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const current = app.runtime.operationsRisks ?? createDefaultOperationsRisksState();
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
      const response = await fetch("/api/operations/risks/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取风险记录失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.operationsRisks;
      }

      const risks = normalizeRiskList(data?.risks);
      const selectedRiskId = normalizeText(current.selectedRiskId) ?? "";
      const selectedRisk = selectedRiskId
        ? risks.find((item) => item.riskId === selectedRiskId) ?? null
        : null;
      const syncDraftFromSelected = options.syncDraftFromSelected === true;

      setState({
        status: "ready",
        risks,
        loading: false,
        errorMessage: "",
        ...(syncDraftFromSelected
          ? {
            selectedRiskId: selectedRisk?.riskId ?? "",
            draft: selectedRisk ? buildDraftFromRisk(selectedRisk) : createDefaultDraft(),
          }
          : {}),
      });
      render();
      return app.runtime.operationsRisks;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.operationsRisks;
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
    const current = app.runtime.operationsRisks ?? createDefaultOperationsRisksState();
    const selectedRiskId = normalizeText(current.selectedRiskId);
    const payloadRisk = buildRiskPayloadFromDraft(current.draft);
    const creating = !selectedRiskId;

    setState({
      submitting: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch(creating ? "/api/operations/risks/create" : "/api/operations/risks/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildIdentityPayload(app),
          risk: {
            ...(selectedRiskId ? { riskId: selectedRiskId } : {}),
            ...payloadRisk,
          },
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存风险记录失败。");
      }

      const savedRisk = normalizeRiskRecord(data?.risk);
      const nextFilterStatus = savedRisk
        ? resolvePostSaveFilterStatus(current.filterStatus, savedRisk.status)
        : current.filterStatus;

      setState({
        submitting: false,
        errorMessage: "",
        noticeMessage: creating ? "已新建风险记录。" : "已更新风险记录。",
        filterStatus: nextFilterStatus,
        selectedRiskId: savedRisk?.riskId ?? "",
        ...(savedRisk ? { draft: buildDraftFromRisk(savedRisk) } : {}),
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
      return app.runtime.operationsRisks;
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
    selectRisk,
  };
}

function createDefaultDraft() {
  return {
    type: "risk",
    title: "",
    severity: "medium",
    status: "open",
    ownerPrincipalId: "",
    detectedAt: "",
    relatedAssetIdsText: "",
    linkedDecisionIdsText: "",
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

function buildRiskPayloadFromDraft(draft) {
  return {
    type: normalizeType(draft?.type),
    title: normalizeRequiredText(draft?.title, "风险标题不能为空。"),
    severity: normalizeSeverity(draft?.severity),
    status: normalizeStatus(draft?.status),
    ...(normalizeText(draft?.ownerPrincipalId) ? { ownerPrincipalId: normalizeText(draft?.ownerPrincipalId) } : {}),
    ...(normalizeText(draft?.detectedAt) ? { detectedAt: normalizeText(draft?.detectedAt) } : {}),
    summary: typeof draft?.summary === "string" ? draft.summary.trim() : "",
    relatedAssetIds: parseRelatedIdsText(draft?.relatedAssetIdsText),
    linkedDecisionIds: parseRelatedIdsText(draft?.linkedDecisionIdsText),
    relatedWorkItemIds: parseRelatedIdsText(draft?.relatedWorkItemIdsText),
  };
}

function buildDraftFromRisk(risk) {
  return {
    type: normalizeType(risk.type),
    title: risk.title ?? "",
    severity: normalizeSeverity(risk.severity),
    status: normalizeStatus(risk.status),
    ownerPrincipalId: risk.ownerPrincipalId ?? "",
    detectedAt: risk.detectedAt ?? "",
    relatedAssetIdsText: Array.isArray(risk.relatedAssetIds) ? risk.relatedAssetIds.join("\n") : "",
    linkedDecisionIdsText: Array.isArray(risk.linkedDecisionIds) ? risk.linkedDecisionIds.join("\n") : "",
    relatedWorkItemIdsText: Array.isArray(risk.relatedWorkItemIds) ? risk.relatedWorkItemIds.join("\n") : "",
    summary: risk.summary ?? "",
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

function normalizeRiskList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeRiskRecord)
    .filter(Boolean);
}

function normalizeRiskRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const riskId = normalizeText(value.riskId);
  const principalId = normalizeText(value.principalId);
  const type = normalizeType(value.type);
  const title = normalizeText(value.title);
  const severity = normalizeSeverity(value.severity);
  const status = normalizeStatus(value.status);
  const ownerPrincipalId = normalizeText(value.ownerPrincipalId);
  const summary = normalizeText(value.summary);
  const detectedAt = normalizeText(value.detectedAt);
  const relatedAssetIds = parseRelatedIdsArray(value.relatedAssetIds);
  const linkedDecisionIds = parseRelatedIdsArray(value.linkedDecisionIds);
  const relatedWorkItemIds = parseRelatedIdsArray(value.relatedWorkItemIds);

  if (!riskId || !principalId || !title || !detectedAt) {
    return null;
  }

  return {
    riskId,
    principalId,
    type,
    title,
    severity,
    status,
    ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
    ...(summary ? { summary } : {}),
    detectedAt,
    relatedAssetIds,
    linkedDecisionIds,
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
  return FILTER_STATUSES.has(value) ? value : "open";
}

function normalizeType(value) {
  return RISK_TYPES.has(value) ? value : "risk";
}

function normalizeSeverity(value) {
  return RISK_SEVERITIES.has(value) ? value : "medium";
}

function normalizeStatus(value) {
  return RISK_STATUSES.has(value) ? value : "open";
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

function resolvePostSaveFilterStatus(currentFilterStatus, riskStatus) {
  if (currentFilterStatus === "all" || currentFilterStatus === riskStatus) {
    return currentFilterStatus;
  }

  return riskStatus;
}
