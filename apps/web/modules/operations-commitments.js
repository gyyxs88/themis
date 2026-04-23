const FILTER_STATUSES = new Set(["planned", "active", "at_risk", "done", "archived", "all"]);
const COMMITMENT_STATUSES = new Set(["planned", "active", "at_risk", "done", "archived"]);

export function createDefaultOperationsCommitmentsState() {
  return {
    status: "idle",
    loading: false,
    submitting: false,
    errorMessage: "",
    noticeMessage: "",
    filterStatus: "active",
    commitments: [],
    selectedCommitmentId: "",
    draft: createDefaultDraft(),
  };
}

export function createOperationsCommitmentsController(app) {
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
        // Errors are already reflected in operationsCommitments state for the UI.
      }
    };

    dom?.operationsCommitmentsRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.operationsCommitmentsNewButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsCommitmentsFilterSelect?.addEventListener("change", () => {
      setState({
        filterStatus: normalizeFilterStatus(dom.operationsCommitmentsFilterSelect?.value),
        noticeMessage: "",
      });
      render();
      void runSafely(load);
    });

    dom?.operationsCommitmentsStatusSelect?.addEventListener("change", () => {
      updateDraft({
        status: normalizeStatus(dom.operationsCommitmentsStatusSelect?.value),
      });
    });

    dom?.operationsCommitmentsProgressInput?.addEventListener("input", () => {
      updateDraft({
        progressPercentText: dom.operationsCommitmentsProgressInput.value,
      });
    });

    dom?.operationsCommitmentsTitleInput?.addEventListener("input", () => {
      updateDraft({
        title: dom.operationsCommitmentsTitleInput.value,
      });
    });

    dom?.operationsCommitmentsOwnerInput?.addEventListener("input", () => {
      updateDraft({
        ownerPrincipalId: dom.operationsCommitmentsOwnerInput.value,
      });
    });

    dom?.operationsCommitmentsStartsAtInput?.addEventListener("input", () => {
      updateDraft({
        startsAt: dom.operationsCommitmentsStartsAtInput.value,
      });
    });

    dom?.operationsCommitmentsDueAtInput?.addEventListener("input", () => {
      updateDraft({
        dueAt: dom.operationsCommitmentsDueAtInput.value,
      });
    });

    dom?.operationsCommitmentsRelatedAssetsInput?.addEventListener("input", () => {
      updateDraft({
        relatedAssetIdsText: dom.operationsCommitmentsRelatedAssetsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCommitmentsRelatedAssetsInput);
    });

    dom?.operationsCommitmentsLinkedDecisionsInput?.addEventListener("input", () => {
      updateDraft({
        linkedDecisionIdsText: dom.operationsCommitmentsLinkedDecisionsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCommitmentsLinkedDecisionsInput);
    });

    dom?.operationsCommitmentsLinkedRisksInput?.addEventListener("input", () => {
      updateDraft({
        linkedRiskIdsText: dom.operationsCommitmentsLinkedRisksInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCommitmentsLinkedRisksInput);
    });

    dom?.operationsCommitmentsRelatedCadencesInput?.addEventListener("input", () => {
      updateDraft({
        relatedCadenceIdsText: dom.operationsCommitmentsRelatedCadencesInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCommitmentsRelatedCadencesInput);
    });

    dom?.operationsCommitmentsRelatedWorkItemsInput?.addEventListener("input", () => {
      updateDraft({
        relatedWorkItemIdsText: dom.operationsCommitmentsRelatedWorkItemsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCommitmentsRelatedWorkItemsInput);
    });

    dom?.operationsCommitmentsMilestonesInput?.addEventListener("input", () => {
      updateDraft({
        milestonesText: dom.operationsCommitmentsMilestonesInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCommitmentsMilestonesInput);
    });

    dom?.operationsCommitmentsEvidenceRefsInput?.addEventListener("input", () => {
      updateDraft({
        evidenceRefsText: dom.operationsCommitmentsEvidenceRefsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCommitmentsEvidenceRefsInput);
    });

    dom?.operationsCommitmentsSummaryInput?.addEventListener("input", () => {
      updateDraft({
        summary: dom.operationsCommitmentsSummaryInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsCommitmentsSummaryInput);
    });

    dom?.operationsCommitmentsSaveButton?.addEventListener("click", () => {
      void runSafely(save);
    });

    dom?.operationsCommitmentsResetButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsCommitmentsList?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-operations-commitment-id]");
      const commitmentId = normalizeText(button?.dataset?.operationsCommitmentId);

      if (!commitmentId) {
        return;
      }

      selectCommitment(commitmentId);
    });
  }

  function setState(patch) {
    app.runtime.operationsCommitments = {
      ...app.runtime.operationsCommitments,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateDraft(patch) {
    const current = app.runtime.operationsCommitments ?? createDefaultOperationsCommitmentsState();
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
    const current = app.runtime.operationsCommitments ?? createDefaultOperationsCommitmentsState();
    setState({
      selectedCommitmentId: "",
      draft: createDefaultDraft(),
      errorMessage: "",
      noticeMessage: current.noticeMessage,
    });
    render();
  }

  function selectCommitment(commitmentId) {
    const current = app.runtime.operationsCommitments ?? createDefaultOperationsCommitmentsState();
    const commitment = current.commitments.find((item) => normalizeText(item?.commitmentId) === commitmentId);

    if (!commitment) {
      return;
    }

    setState({
      selectedCommitmentId: commitment.commitmentId,
      draft: buildDraftFromCommitment(commitment),
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const current = app.runtime.operationsCommitments ?? createDefaultOperationsCommitmentsState();
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
      const response = await fetch("/api/operations/commitments/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取承诺记录失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.operationsCommitments;
      }

      const commitments = normalizeCommitmentList(data?.commitments);
      const selectedCommitmentId = normalizeText(current.selectedCommitmentId) ?? "";
      const selectedCommitment = selectedCommitmentId
        ? commitments.find((item) => item.commitmentId === selectedCommitmentId) ?? null
        : null;
      const syncDraftFromSelected = options.syncDraftFromSelected === true;

      setState({
        status: "ready",
        commitments,
        loading: false,
        errorMessage: "",
        ...(syncDraftFromSelected
          ? {
            selectedCommitmentId: selectedCommitment?.commitmentId ?? "",
            draft: selectedCommitment ? buildDraftFromCommitment(selectedCommitment) : createDefaultDraft(),
          }
          : {}),
      });
      render();
      return app.runtime.operationsCommitments;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.operationsCommitments;
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
    const current = app.runtime.operationsCommitments ?? createDefaultOperationsCommitmentsState();
    const selectedCommitmentId = normalizeText(current.selectedCommitmentId);
    const payloadCommitment = buildCommitmentPayloadFromDraft(current.draft);
    const creating = !selectedCommitmentId;

    setState({
      submitting: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch(
        creating ? "/api/operations/commitments/create" : "/api/operations/commitments/update",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...buildIdentityPayload(app),
            commitment: {
              ...(selectedCommitmentId ? { commitmentId: selectedCommitmentId } : {}),
              ...payloadCommitment,
            },
          }),
        },
      );
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存承诺记录失败。");
      }

      const savedCommitment = normalizeCommitmentRecord(data?.commitment);
      const nextFilterStatus = savedCommitment
        ? resolvePostSaveFilterStatus(current.filterStatus, savedCommitment.status)
        : current.filterStatus;

      setState({
        submitting: false,
        errorMessage: "",
        noticeMessage: creating ? "已新建承诺。" : "已更新承诺。",
        filterStatus: nextFilterStatus,
        selectedCommitmentId: savedCommitment?.commitmentId ?? "",
        ...(savedCommitment ? { draft: buildDraftFromCommitment(savedCommitment) } : {}),
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
      return app.runtime.operationsCommitments;
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
    selectCommitment,
  };
}

function createDefaultDraft() {
  return {
    title: "",
    status: "active",
    progressPercentText: "0",
    ownerPrincipalId: "",
    startsAt: "",
    dueAt: "",
    relatedAssetIdsText: "",
    linkedDecisionIdsText: "",
    linkedRiskIdsText: "",
    relatedCadenceIdsText: "",
    relatedWorkItemIdsText: "",
    milestonesText: "",
    evidenceRefsText: "",
    summary: "",
  };
}

function buildCommitmentPayloadFromDraft(draft) {
  const safeDraft = draft && typeof draft === "object" ? draft : createDefaultDraft();

  return {
    title: normalizeText(safeDraft.title),
    status: normalizeStatus(safeDraft.status),
    progressPercent: parseProgressPercent(safeDraft.progressPercentText),
    ownerPrincipalId: normalizeText(safeDraft.ownerPrincipalId),
    startsAt: normalizeText(safeDraft.startsAt),
    dueAt: normalizeText(safeDraft.dueAt),
    relatedAssetIds: parseIdList(safeDraft.relatedAssetIdsText),
    linkedDecisionIds: parseIdList(safeDraft.linkedDecisionIdsText),
    linkedRiskIds: parseIdList(safeDraft.linkedRiskIdsText),
    relatedCadenceIds: parseIdList(safeDraft.relatedCadenceIdsText),
    relatedWorkItemIds: parseIdList(safeDraft.relatedWorkItemIdsText),
    milestones: parseMilestones(safeDraft.milestonesText),
    evidenceRefs: parseEvidenceRefs(safeDraft.evidenceRefsText),
    summary: normalizeText(safeDraft.summary),
  };
}

function buildDraftFromCommitment(commitment) {
  return {
    title: normalizeText(commitment?.title),
    status: normalizeStatus(commitment?.status),
    progressPercentText: String(parseProgressPercent(commitment?.progressPercent)),
    ownerPrincipalId: normalizeText(commitment?.ownerPrincipalId),
    startsAt: normalizeText(commitment?.startsAt),
    dueAt: normalizeText(commitment?.dueAt),
    relatedAssetIdsText: formatIdList(commitment?.relatedAssetIds),
    linkedDecisionIdsText: formatIdList(commitment?.linkedDecisionIds),
    linkedRiskIdsText: formatIdList(commitment?.linkedRiskIds),
    relatedCadenceIdsText: formatIdList(commitment?.relatedCadenceIds),
    relatedWorkItemIdsText: formatIdList(commitment?.relatedWorkItemIds),
    milestonesText: formatMilestones(commitment?.milestones),
    evidenceRefsText: formatEvidenceRefs(commitment?.evidenceRefs),
    summary: normalizeText(commitment?.summary),
  };
}

function normalizeCommitmentList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeCommitmentRecord)
    .filter(Boolean);
}

function normalizeCommitmentRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const commitmentId = normalizeText(value.commitmentId);
  const title = normalizeText(value.title);
  const dueAt = normalizeText(value.dueAt);

  if (!commitmentId || !title) {
    return null;
  }

  return {
    commitmentId,
    principalId: normalizeText(value.principalId),
    title,
    status: normalizeStatus(value.status),
    progressPercent: parseProgressPercent(value.progressPercent),
    ownerPrincipalId: normalizeText(value.ownerPrincipalId),
    startsAt: normalizeText(value.startsAt),
    dueAt,
    summary: normalizeText(value.summary),
    milestones: normalizeMilestones(value.milestones),
    evidenceRefs: normalizeEvidenceRefs(value.evidenceRefs),
    relatedAssetIds: normalizeIdArray(value.relatedAssetIds),
    linkedDecisionIds: normalizeIdArray(value.linkedDecisionIds),
    linkedRiskIds: normalizeIdArray(value.linkedRiskIds),
    relatedCadenceIds: normalizeIdArray(value.relatedCadenceIds),
    relatedWorkItemIds: normalizeIdArray(value.relatedWorkItemIds),
    createdAt: normalizeText(value.createdAt),
    updatedAt: normalizeText(value.updatedAt),
  };
}

function normalizeFilterStatus(value) {
  const normalized = normalizeText(value);
  return FILTER_STATUSES.has(normalized) ? normalized : "active";
}

function normalizeStatus(value) {
  const normalized = normalizeText(value);
  return COMMITMENT_STATUSES.has(normalized) ? normalized : "active";
}

function resolvePostSaveFilterStatus(currentFilterStatus, savedStatus) {
  if (currentFilterStatus === "all" || currentFilterStatus === savedStatus) {
    return currentFilterStatus;
  }

  return savedStatus;
}

function parseIdList(value) {
  return normalizeText(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function parseProgressPercent(value) {
  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.trim())
      : 0;

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

function parseMilestones(value) {
  return normalizeText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, title, dueAt, completedAt, summary] = line.split("|").map((item) => item.trim());
      return {
        title: title || status || "",
        status: normalizeMilestoneStatus(title ? status : "planned"),
        ...(dueAt ? { dueAt } : {}),
        ...(completedAt ? { completedAt } : {}),
        ...(summary ? { summary } : {}),
        evidenceRefs: [],
      };
    })
    .filter((milestone) => milestone.title)
    .filter((milestone, index, all) => (
      all.findIndex((item) => item.title === milestone.title && item.dueAt === milestone.dueAt) === index
    ));
}

function parseEvidenceRefs(value) {
  return normalizeText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kind, refValue, label, capturedAt] = line.split("|").map((item) => item.trim());
      return {
        kind: normalizeEvidenceKind(refValue ? kind : "other"),
        value: refValue || kind || "",
        ...(label ? { label } : {}),
        ...(capturedAt ? { capturedAt } : {}),
      };
    })
    .filter((ref) => ref.value)
    .filter((ref, index, all) => (
      all.findIndex((item) => (
        item.kind === ref.kind
        && item.value === ref.value
        && item.label === ref.label
        && item.capturedAt === ref.capturedAt
      )) === index
    ));
}

function formatMilestones(value) {
  return normalizeMilestones(value)
    .map((milestone) => [
      milestone.status,
      milestone.title,
      milestone.dueAt,
      milestone.completedAt,
      milestone.summary,
    ].map((item) => item || "").join(" | ").replace(/\s+\|\s+$/g, ""))
    .join("\n");
}

function formatEvidenceRefs(value) {
  return normalizeEvidenceRefs(value)
    .map((ref) => [
      ref.kind,
      ref.value,
      ref.label,
      ref.capturedAt,
    ].map((item) => item || "").join(" | ").replace(/\s+\|\s+$/g, ""))
    .join("\n");
}

function normalizeMilestones(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      milestoneId: normalizeText(item.milestoneId),
      title: normalizeText(item.title),
      status: normalizeMilestoneStatus(item.status),
      dueAt: normalizeText(item.dueAt),
      completedAt: normalizeText(item.completedAt),
      summary: normalizeText(item.summary),
      evidenceRefs: normalizeEvidenceRefs(item.evidenceRefs),
    }))
    .filter((item) => item.title);
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      kind: normalizeEvidenceKind(item.kind),
      value: normalizeText(item.value),
      label: normalizeText(item.label),
      capturedAt: normalizeText(item.capturedAt),
    }))
    .filter((item) => item.value);
}

function normalizeMilestoneStatus(value) {
  const normalized = normalizeText(value);
  return ["planned", "active", "blocked", "done"].includes(normalized) ? normalized : "planned";
}

function normalizeEvidenceKind(value) {
  const normalized = normalizeText(value);
  return ["url", "doc", "artifact", "run", "work_item", "other"].includes(normalized) ? normalized : "other";
}

function formatIdList(value) {
  return normalizeIdArray(value).join("\n");
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function buildIdentityPayload(app) {
  const browserUserId = normalizeText(app.runtime?.identity?.browserUserId) || "browser";
  const accountEmail = normalizeText(app.runtime?.auth?.account?.email);

  return {
    channel: "web",
    channelUserId: browserUserId,
    ...(accountEmail ? { displayName: accountEmail } : {}),
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
