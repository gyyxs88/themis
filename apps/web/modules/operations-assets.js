const FILTER_STATUSES = new Set(["active", "watch", "archived", "all"]);
const ASSET_KINDS = new Set([
  "site",
  "domain",
  "server",
  "service",
  "database",
  "account",
  "storage",
  "workspace",
  "document",
  "other",
]);
const ASSET_STATUSES = new Set(["active", "watch", "archived"]);
const ASSET_REF_KINDS = new Set(["domain", "host", "repo", "provider_resource", "doc", "url", "workspace", "other"]);

export function createDefaultOperationsAssetsState() {
  return {
    status: "idle",
    loading: false,
    submitting: false,
    errorMessage: "",
    noticeMessage: "",
    filterStatus: "active",
    assets: [],
    selectedAssetId: "",
    draft: createDefaultDraft(),
  };
}

export function createOperationsAssetsController(app) {
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
        // Errors are already reflected in operationsAssets state for the UI.
      }
    };

    dom?.operationsAssetsRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.operationsAssetsNewButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsAssetsFilterSelect?.addEventListener("change", () => {
      setState({
        filterStatus: normalizeFilterStatus(dom.operationsAssetsFilterSelect?.value),
        noticeMessage: "",
      });
      render();
      void runSafely(load);
    });

    dom?.operationsAssetsKindSelect?.addEventListener("change", () => {
      updateDraft({
        kind: normalizeKind(dom.operationsAssetsKindSelect?.value),
      });
    });

    dom?.operationsAssetsNameInput?.addEventListener("input", () => {
      updateDraft({
        name: dom.operationsAssetsNameInput.value,
      });
    });

    dom?.operationsAssetsStatusSelect?.addEventListener("change", () => {
      updateDraft({
        status: normalizeStatus(dom.operationsAssetsStatusSelect?.value),
      });
    });

    dom?.operationsAssetsOwnerInput?.addEventListener("input", () => {
      updateDraft({
        ownerPrincipalId: dom.operationsAssetsOwnerInput.value,
      });
    });

    dom?.operationsAssetsTagsInput?.addEventListener("input", () => {
      updateDraft({
        tagsText: dom.operationsAssetsTagsInput.value,
      });
    });

    dom?.operationsAssetsRefsInput?.addEventListener("input", () => {
      updateDraft({
        refsText: dom.operationsAssetsRefsInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsAssetsRefsInput);
    });

    dom?.operationsAssetsSummaryInput?.addEventListener("input", () => {
      updateDraft({
        summary: dom.operationsAssetsSummaryInput.value,
      });
      utils.autoResizeTextarea?.(dom.operationsAssetsSummaryInput);
    });

    dom?.operationsAssetsSaveButton?.addEventListener("click", () => {
      void runSafely(save);
    });

    dom?.operationsAssetsResetButton?.addEventListener("click", () => {
      resetDraft();
    });

    dom?.operationsAssetsList?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-operations-asset-id]");
      const assetId = normalizeText(button?.dataset?.operationsAssetId);

      if (!assetId) {
        return;
      }

      selectAsset(assetId);
    });
  }

  function setState(patch) {
    app.runtime.operationsAssets = {
      ...app.runtime.operationsAssets,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateDraft(patch) {
    const current = app.runtime.operationsAssets ?? createDefaultOperationsAssetsState();
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
    const current = app.runtime.operationsAssets ?? createDefaultOperationsAssetsState();
    setState({
      selectedAssetId: "",
      draft: createDefaultDraft(),
      errorMessage: "",
      noticeMessage: current.noticeMessage,
    });
    render();
  }

  function selectAsset(assetId) {
    const current = app.runtime.operationsAssets ?? createDefaultOperationsAssetsState();
    const asset = current.assets.find((item) => normalizeText(item?.assetId) === assetId);

    if (!asset) {
      return;
    }

    setState({
      selectedAssetId: asset.assetId,
      draft: buildDraftFromAsset(asset),
      errorMessage: "",
      noticeMessage: "",
    });
    render();
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const current = app.runtime.operationsAssets ?? createDefaultOperationsAssetsState();
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
      const response = await fetch("/api/operations/assets/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "读取资产台账失败。");
      }

      if (requestId !== loadRequestId) {
        return app.runtime.operationsAssets;
      }

      const assets = normalizeAssetList(data?.assets);
      const selectedAssetId = normalizeText(current.selectedAssetId) ?? "";
      const selectedAsset = selectedAssetId
        ? assets.find((item) => item.assetId === selectedAssetId) ?? null
        : null;
      const syncDraftFromSelected = options.syncDraftFromSelected === true;

      setState({
        status: "ready",
        assets,
        loading: false,
        errorMessage: "",
        ...(syncDraftFromSelected
          ? {
            selectedAssetId: selectedAsset?.assetId ?? "",
            draft: selectedAsset ? buildDraftFromAsset(selectedAsset) : createDefaultDraft(),
          }
          : {}),
      });
      render();
      return app.runtime.operationsAssets;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.operationsAssets;
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
    const current = app.runtime.operationsAssets ?? createDefaultOperationsAssetsState();
    const selectedAssetId = normalizeText(current.selectedAssetId);
    const payloadAsset = buildAssetPayloadFromDraft(current.draft);
    const creating = !selectedAssetId;

    setState({
      submitting: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await fetch(creating ? "/api/operations/assets/create" : "/api/operations/assets/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...buildIdentityPayload(app),
          asset: {
            ...(selectedAssetId ? { assetId: selectedAssetId } : {}),
            ...payloadAsset,
          },
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存资产台账失败。");
      }

      const savedAsset = normalizeAssetRecord(data?.asset);
      const nextFilterStatus = savedAsset
        ? resolvePostSaveFilterStatus(current.filterStatus, savedAsset.status)
        : current.filterStatus;

      setState({
        submitting: false,
        errorMessage: "",
        noticeMessage: creating ? "已新建资产台账。" : "已更新资产台账。",
        filterStatus: nextFilterStatus,
        selectedAssetId: savedAsset?.assetId ?? "",
        ...(savedAsset ? { draft: buildDraftFromAsset(savedAsset) } : {}),
      });
      render();

      await load({
        preserveNoticeMessage: true,
        syncDraftFromSelected: true,
      });
      return app.runtime.operationsAssets;
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
    selectAsset,
  };
}

function createDefaultDraft() {
  return {
    kind: "site",
    name: "",
    status: "active",
    ownerPrincipalId: "",
    summary: "",
    tagsText: "",
    refsText: "",
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

function buildAssetPayloadFromDraft(draft) {
  return {
    kind: normalizeKind(draft?.kind),
    name: normalizeRequiredText(draft?.name, "资产名称不能为空。"),
    status: normalizeStatus(draft?.status),
    ...(normalizeText(draft?.ownerPrincipalId) ? { ownerPrincipalId: normalizeText(draft?.ownerPrincipalId) } : {}),
    summary: typeof draft?.summary === "string" ? draft.summary.trim() : "",
    tags: parseTagsText(draft?.tagsText),
    refs: parseRefsText(draft?.refsText),
  };
}

function buildDraftFromAsset(asset) {
  return {
    kind: normalizeKind(asset.kind),
    name: asset.name ?? "",
    status: normalizeStatus(asset.status),
    ownerPrincipalId: asset.ownerPrincipalId ?? "",
    summary: asset.summary ?? "",
    tagsText: Array.isArray(asset.tags) ? asset.tags.join(", ") : "",
    refsText: formatRefsText(asset.refs),
  };
}

function parseTagsText(value) {
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

function parseRefsText(value) {
  if (typeof value !== "string") {
    return [];
  }

  const refs = [];

  for (const line of value.split("\n")) {
    const normalizedLine = line.trim();

    if (!normalizedLine) {
      continue;
    }

    const pipeParts = normalizedLine.split("|").map((item) => item.trim()).filter(Boolean);
    let kind = "";
    let refValue = "";
    let label = "";

    if (pipeParts.length >= 2) {
      [kind, refValue] = pipeParts;
      label = pipeParts[2] ?? "";
    } else {
      const separatorIndex = normalizedLine.indexOf(":");
      if (separatorIndex > 0) {
        kind = normalizedLine.slice(0, separatorIndex).trim();
        refValue = normalizedLine.slice(separatorIndex + 1).trim();
      } else {
        kind = "other";
        refValue = normalizedLine;
      }
    }

    if (!ASSET_REF_KINDS.has(kind) || !refValue) {
      throw new Error(`资产引用格式不合法：${normalizedLine}`);
    }

    refs.push({
      kind,
      value: refValue,
      ...(label ? { label } : {}),
    });
  }

  return refs;
}

function formatRefsText(value) {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((ref) => {
      const kind = normalizeText(ref?.kind);
      const refValue = normalizeText(ref?.value);
      const label = normalizeText(ref?.label);

      if (!kind || !refValue) {
        return "";
      }

      return label ? `${kind}|${refValue}|${label}` : `${kind}:${refValue}`;
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeAssetList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeAssetRecord)
    .filter(Boolean);
}

function normalizeAssetRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const assetId = normalizeText(value.assetId);
  const principalId = normalizeText(value.principalId);
  const kind = normalizeKind(value.kind);
  const name = normalizeText(value.name);
  const status = normalizeStatus(value.status);
  const ownerPrincipalId = normalizeText(value.ownerPrincipalId);
  const summary = normalizeText(value.summary);
  const tags = Array.isArray(value.tags)
    ? [...new Set(value.tags.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
  const refs = Array.isArray(value.refs)
    ? value.refs
      .map((ref) => {
        const refKind = normalizeText(ref?.kind);
        const refValue = normalizeText(ref?.value);
        const label = normalizeText(ref?.label);

        if (!refKind || !refValue || !ASSET_REF_KINDS.has(refKind)) {
          return null;
        }

        return {
          kind: refKind,
          value: refValue,
          ...(label ? { label } : {}),
        };
      })
      .filter(Boolean)
    : [];

  if (!assetId || !principalId || !name) {
    return null;
  }

  return {
    assetId,
    principalId,
    kind,
    name,
    status,
    ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
    ...(summary ? { summary } : {}),
    tags,
    refs,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function normalizeFilterStatus(value) {
  return FILTER_STATUSES.has(value) ? value : "active";
}

function normalizeKind(value) {
  return ASSET_KINDS.has(value) ? value : "site";
}

function normalizeStatus(value) {
  return ASSET_STATUSES.has(value) ? value : "active";
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

function resolvePostSaveFilterStatus(currentFilterStatus, assetStatus) {
  if (currentFilterStatus === "all" || currentFilterStatus === assetStatus) {
    return currentFilterStatus;
  }

  return assetStatus;
}
