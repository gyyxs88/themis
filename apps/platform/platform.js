const OWNER_PRINCIPAL_STORAGE_KEY = "themis.platform.ownerPrincipalId";

export function normalizeOwnerPrincipalId(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveInitialOwnerPrincipalId(search = "", storedValue = "") {
  const searchParams = new URLSearchParams(typeof search === "string" ? search : "");
  return normalizeOwnerPrincipalId(searchParams.get("ownerPrincipalId"))
    || normalizeOwnerPrincipalId(storedValue);
}

export function summarizeNodes(nodes) {
  const summary = {
    total: 0,
    online: 0,
    draining: 0,
    offline: 0,
  };

  for (const node of Array.isArray(nodes) ? nodes : []) {
    summary.total += 1;

    if (node?.status === "online") {
      summary.online += 1;
      continue;
    }

    if (node?.status === "draining") {
      summary.draining += 1;
      continue;
    }

    if (node?.status === "offline") {
      summary.offline += 1;
    }
  }

  return summary;
}

export function initializePlatformSurface(options = {}) {
  const documentRef = options.document ?? globalThis.document;

  if (!documentRef) {
    return null;
  }

  const fetchFn = options.fetch ?? globalThis.fetch;
  const storage = options.storage ?? safeStorage();
  const locationSearch = options.locationSearch ?? globalThis.location?.search ?? "";
  const dom = {
    sessionTitle: documentRef.getElementById("platform-session-title"),
    sessionNote: documentRef.getElementById("platform-session-note"),
    ownerForm: documentRef.getElementById("platform-owner-form"),
    ownerInput: documentRef.getElementById("platform-owner-input"),
    ownerSubmitButton: documentRef.getElementById("platform-owner-submit"),
    ownerNote: documentRef.getElementById("platform-owner-note"),
    refreshButton: documentRef.getElementById("platform-refresh-button"),
    nodesStatus: documentRef.getElementById("platform-nodes-status"),
    nodesEmpty: documentRef.getElementById("platform-nodes-empty"),
    nodesList: documentRef.getElementById("platform-nodes-list"),
    summaryTotal: documentRef.getElementById("platform-summary-total"),
    summaryOnline: documentRef.getElementById("platform-summary-online"),
    summaryDraining: documentRef.getElementById("platform-summary-draining"),
    summaryOffline: documentRef.getElementById("platform-summary-offline"),
  };
  const state = {
    loading: false,
    errorMessage: "",
    tokenLabel: "",
    ownerPrincipalId: resolveInitialOwnerPrincipalId(
      locationSearch,
      storage?.getItem?.(OWNER_PRINCIPAL_STORAGE_KEY) ?? "",
    ),
    nodes: [],
  };

  if (dom.ownerInput) {
    dom.ownerInput.value = state.ownerPrincipalId;
  }

  const render = () => {
    const summary = summarizeNodes(state.nodes);
    const hasNodes = state.nodes.length > 0;
    const statusMessage = state.errorMessage
      ? state.errorMessage
      : state.loading
        ? "正在从平台控制面读取节点列表。"
        : state.ownerPrincipalId
          ? `当前 ownerPrincipalId：${state.ownerPrincipalId}`
          : "请先填写 ownerPrincipalId，再读取当前平台下的 Worker Nodes。";

    if (dom.sessionTitle) {
      dom.sessionTitle.textContent = state.tokenLabel ? `已登录：${state.tokenLabel}` : "正在确认登录状态";
    }

    if (dom.sessionNote) {
      dom.sessionNote.textContent = state.ownerPrincipalId
        ? "当前页面已经独立挂在 Platform surface，上游节点读写全部走 /api/platform/*。"
        : "当前页面已经独立挂在 Platform surface；填入 ownerPrincipalId 后即可查看节点总览。";
    }

    if (dom.ownerNote) {
      dom.ownerNote.textContent = state.ownerPrincipalId
        ? `后续刷新会继续使用 ${state.ownerPrincipalId}。`
        : "如果你是从主 Themis 的兼容入口跳转过来的，这里通常会自动带上当前 ownerPrincipalId。";
    }

    if (dom.ownerSubmitButton) {
      dom.ownerSubmitButton.disabled = state.loading;
    }

    if (dom.refreshButton) {
      dom.refreshButton.disabled = state.loading;
    }

    if (dom.nodesStatus) {
      dom.nodesStatus.textContent = statusMessage;
    }

    if (dom.summaryTotal) {
      dom.summaryTotal.textContent = String(summary.total);
    }

    if (dom.summaryOnline) {
      dom.summaryOnline.textContent = String(summary.online);
    }

    if (dom.summaryDraining) {
      dom.summaryDraining.textContent = String(summary.draining);
    }

    if (dom.summaryOffline) {
      dom.summaryOffline.textContent = String(summary.offline);
    }

    if (dom.nodesEmpty) {
      dom.nodesEmpty.hidden = hasNodes;
      dom.nodesEmpty.textContent = state.errorMessage
        ? "读取失败，请检查 ownerPrincipalId、平台登录状态或当前控制面配置。"
        : state.ownerPrincipalId
          ? "当前 ownerPrincipalId 下还没有注册节点。"
          : "先填写 ownerPrincipalId，再从平台控制面读取节点列表。";
    }

    if (dom.nodesList) {
      dom.nodesList.innerHTML = hasNodes
        ? state.nodes.map((node) => renderNodeCard(node)).join("")
        : "";
    }
  };

  const loadSessionStatus = async () => {
    if (typeof fetchFn !== "function") {
      return;
    }

    try {
      const response = await fetchFn("/api/web-auth/status", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      const payload = await safeReadJson(response);
      state.tokenLabel = response.ok && payload?.authenticated && typeof payload?.tokenLabel === "string"
        ? payload.tokenLabel.trim()
        : "";
    } catch {
      state.tokenLabel = "";
    }
  };

  const loadNodes = async () => {
    state.ownerPrincipalId = normalizeOwnerPrincipalId(dom.ownerInput?.value ?? state.ownerPrincipalId);

    if (!state.ownerPrincipalId || typeof fetchFn !== "function") {
      state.errorMessage = "";
      state.nodes = [];
      render();
      return;
    }

    storage?.setItem?.(OWNER_PRINCIPAL_STORAGE_KEY, state.ownerPrincipalId);
    state.loading = true;
    state.errorMessage = "";
    render();

    try {
      const response = await fetchFn("/api/platform/nodes/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ownerPrincipalId: state.ownerPrincipalId,
        }),
      });
      const payload = await safeReadJson(response);

      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "读取节点列表失败。"));
      }

      state.nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
    } catch (error) {
      state.nodes = [];
      state.errorMessage = error instanceof Error ? error.message : "读取节点列表失败。";
    } finally {
      state.loading = false;
      render();
    }
  };

  dom.ownerForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadNodes();
  });

  dom.refreshButton?.addEventListener("click", () => {
    void loadNodes();
  });

  void (async () => {
    await loadSessionStatus();
    render();
    if (state.ownerPrincipalId) {
      await loadNodes();
    }
  })();

  return {
    loadNodes,
    render,
  };
}

function renderNodeCard(node) {
  const status = normalizeNodeStatus(node?.status);
  const statusLabel = resolveNodeStatusLabel(status);
  const labels = Array.isArray(node?.labels) ? node.labels : [];
  const workspaceCapabilities = Array.isArray(node?.workspaceCapabilities) ? node.workspaceCapabilities : [];
  const credentialCapabilities = Array.isArray(node?.credentialCapabilities) ? node.credentialCapabilities : [];
  const providerCapabilities = Array.isArray(node?.providerCapabilities) ? node.providerCapabilities : [];
  const metaChips = [
    `槽位 ${normalizeNumber(node?.slotAvailable, 0)}/${normalizeNumber(node?.slotCapacity, 0)}`,
    node?.heartbeatTtlSeconds ? `TTL ${normalizeNumber(node.heartbeatTtlSeconds, 0)}s` : "",
    node?.lastHeartbeatAt ? `最近心跳 ${formatTimestamp(node.lastHeartbeatAt)}` : "",
  ].filter(Boolean);
  const capabilityChips = [
    ...labels.map((label) => `标签 ${label}`),
    workspaceCapabilities.length ? `工作区 ${workspaceCapabilities.length}` : "",
    credentialCapabilities.length ? `凭据 ${credentialCapabilities.length}` : "",
    providerCapabilities.length ? `Provider ${providerCapabilities.length}` : "",
  ].filter(Boolean);

  return `<article class="platform-node-card">
    <div class="platform-node-head">
      <div>
        <h3 class="platform-node-title">${escapeHtml(node?.displayName || node?.nodeId || "未命名节点")}</h3>
        <div class="platform-node-meta">
          <span class="platform-chip status-${status}">${escapeHtml(statusLabel)}</span>
          <span class="platform-chip">${escapeHtml(node?.nodeId || "未知 nodeId")}</span>
          <span class="platform-chip">${escapeHtml(node?.organizationId || "未知组织")}</span>
        </div>
      </div>
    </div>
    <div class="platform-node-meta">
      ${metaChips.map((item) => `<span class="platform-chip">${escapeHtml(item)}</span>`).join("")}
    </div>
    <div class="platform-node-capabilities">
      ${capabilityChips.map((item) => `<span class="platform-chip">${escapeHtml(item)}</span>`).join("")}
    </div>
  </article>`;
}

function resolveNodeStatusLabel(status) {
  switch (status) {
    case "online":
      return "在线";
    case "draining":
      return "排水中";
    case "offline":
      return "离线";
    default:
      return "状态未知";
  }
}

function normalizeNodeStatus(value) {
  return ["online", "draining", "offline"].includes(value)
    ? value
    : "unknown";
}

function normalizeNumber(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function formatTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "未知";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readErrorMessage(payload, fallback) {
  return typeof payload?.error?.message === "string" && payload.error.message.trim()
    ? payload.error.message.trim()
    : fallback;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

if (typeof document !== "undefined") {
  initializePlatformSurface();
}
