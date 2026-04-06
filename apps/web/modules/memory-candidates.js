const FILTER_STATUSES = new Set(["suggested", "approved", "rejected", "all"]);
const REVIEW_DECISIONS = new Set(["approve", "reject", "archive"]);

export function createDefaultMemoryCandidatesState() {
  return {
    status: "idle",
    errorMessage: "",
    noticeMessage: "",
    candidates: [],
    loading: false,
    extracting: false,
    reviewingCandidateId: "",
    filterStatus: "suggested",
    includeArchived: false,
  };
}

export function createMemoryCandidatesController(app) {
  const { dom } = app;
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
        // Errors are already reflected in memoryCandidates state for the UI.
      }
    };

    dom?.memoryCandidatesRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.memoryCandidatesExtractButton?.addEventListener("click", () => {
      void runSafely(extractLatest);
    });

    dom?.memoryCandidatesFilterSelect?.addEventListener("change", () => {
      setState({
        filterStatus: normalizeFilterStatus(dom.memoryCandidatesFilterSelect?.value, "suggested"),
        noticeMessage: "",
      });
      render();
      void runSafely(load);
    });

    dom?.memoryCandidatesIncludeArchivedInput?.addEventListener("change", () => {
      setState({
        includeArchived: Boolean(dom.memoryCandidatesIncludeArchivedInput?.checked),
        noticeMessage: "",
      });
      render();
      void runSafely(load);
    });

    dom?.memoryCandidatesList?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-memory-candidate-action]");

      if (!actionButton) {
        return;
      }

      const action = normalizeReviewDecision(actionButton.dataset.memoryCandidateAction);
      const candidateId = normalizeText(actionButton.dataset.memoryCandidateId);

      if (!action || !candidateId) {
        return;
      }

      void runSafely(() => review(candidateId, action));
    });

    dom?.workspaceToolsPanel?.addEventListener("click", (event) => {
      const sectionButton = event.target.closest("[data-settings-section]");

      if (sectionButton?.dataset.settingsSection === "memory-candidates") {
        void runSafely(load);
      }
    });

    dom?.workspaceToolsToggle?.addEventListener("click", () => {
      queueMicrotask(() => {
        if (app.runtime.workspaceToolsOpen && app.runtime.workspaceToolsSection === "memory-candidates") {
          void runSafely(load);
        }
      });
    });
  }

  function setState(patch) {
    app.runtime.memoryCandidates = {
      ...app.runtime.memoryCandidates,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const state = app.runtime.memoryCandidates ?? createDefaultMemoryCandidatesState();
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
        ...(state.filterStatus !== "all" ? { status: state.filterStatus } : {}),
        ...(state.includeArchived ? { includeArchived: true } : {}),
      };
      const response = await fetch("/api/actors/memory-candidates/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取长期记忆候选失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.memoryCandidates;
      }

      const nextState = normalizeMemoryCandidatesList(data);
      setState({
        status: "ready",
        candidates: nextState.candidates,
        loading: false,
        errorMessage: "",
      });
      render();
      return app.runtime.memoryCandidates;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.memoryCandidates;
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

  async function review(candidateId, decision) {
    const normalizedCandidateId = normalizeText(candidateId);
    const normalizedDecision = normalizeReviewDecision(decision);

    if (!normalizedCandidateId || !normalizedDecision) {
      return app.runtime.memoryCandidates;
    }

    setState({
      reviewingCandidateId: normalizedCandidateId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch("/api/actors/memory-candidates/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildIdentityPayload(app),
          candidateId: normalizedCandidateId,
          decision: normalizedDecision,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "更新长期记忆候选失败。");
      }

      setState({
        reviewingCandidateId: "",
        noticeMessage: resolveDecisionNotice(normalizedDecision),
      });
      render();

      await load({ preserveNoticeMessage: true });
      return app.runtime.memoryCandidates;
    } catch (error) {
      setState({
        reviewingCandidateId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function extractLatest() {
    const requestId = resolveLatestCompletedRequestId(app.store?.getActiveThread?.());

    if (!requestId) {
      setState({
        errorMessage: "当前会话还没有可提炼的已完成任务。",
        noticeMessage: "",
      });
      render();
      return app.runtime.memoryCandidates;
    }

    setState({
      extracting: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch("/api/actors/memory-candidates/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildIdentityPayload(app),
          requestId,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "提炼长期记忆候选失败。");
      }

      const extractedCount = Array.isArray(data?.candidates) ? data.candidates.length : 0;
      setState({
        extracting: false,
        noticeMessage: resolveExtractNotice(extractedCount),
      });
      render();

      await load({ preserveNoticeMessage: true });
      return app.runtime.memoryCandidates;
    } catch (error) {
      setState({
        extracting: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  return {
    bindControls,
    extractLatest,
    load,
    review,
    normalizeMemoryCandidatesList,
  };
}

export function normalizeMemoryCandidatesList(payload) {
  const candidates = Array.isArray(payload?.candidates)
    ? payload.candidates.map(normalizeCandidate).filter(Boolean)
    : [];

  return {
    candidates,
  };
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return {
    candidateId: normalizeText(candidate.candidateId),
    principalId: normalizeText(candidate.principalId),
    kind: normalizeText(candidate.kind),
    title: normalizeText(candidate.title),
    summary: normalizeText(candidate.summary),
    rationale: normalizeText(candidate.rationale),
    suggestedContent: normalizeText(candidate.suggestedContent),
    sourceType: normalizeText(candidate.sourceType),
    sourceLabel: normalizeText(candidate.sourceLabel),
    sourceTaskId: normalizeText(candidate.sourceTaskId),
    sourceConversationId: normalizeText(candidate.sourceConversationId),
    status: normalizeFilterStatus(candidate.status, "suggested"),
    approvedMemoryId: normalizeText(candidate.approvedMemoryId),
    reviewedAt: normalizeText(candidate.reviewedAt),
    archivedAt: normalizeText(candidate.archivedAt),
    createdAt: normalizeText(candidate.createdAt),
    updatedAt: normalizeText(candidate.updatedAt),
  };
}

function buildIdentityPayload(app) {
  const browserUserId = normalizeText(app.runtime.identity?.browserUserId) || "browser-local";
  const authEmail = normalizeText(app.runtime.auth?.account?.email);
  const displayName = authEmail || `Themis Web ${browserUserId.slice(-6)}`;

  return {
    channel: "web",
    channelUserId: browserUserId,
    ...(displayName ? { displayName } : {}),
  };
}

function resolveDecisionNotice(decision) {
  switch (decision) {
    case "approve":
      return "已批准候选，并写入正式主记忆。";
    case "reject":
      return "已拒绝候选。";
    case "archive":
      return "已归档候选。";
    default:
      return "已更新候选。";
  }
}

function resolveExtractNotice(extractedCount) {
  if (extractedCount > 0) {
    return `已从最近完成任务提炼出 ${extractedCount} 条长期记忆候选。`;
  }

  return "最近完成任务里没有新的长期记忆候选，或候选已存在。";
}

function normalizeFilterStatus(status, fallback = "all") {
  const normalized = normalizeText(status);
  return FILTER_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeReviewDecision(decision) {
  const normalized = normalizeText(decision);
  return REVIEW_DECISIONS.has(normalized) ? normalized : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveLatestCompletedRequestId(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const requestId = normalizeText(turn?.requestId);
    const resultStatus = normalizeText(turn?.result?.status) || normalizeText(turn?.state);

    if (requestId && resultStatus === "completed") {
      return requestId;
    }
  }

  return "";
}
