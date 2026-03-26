export function normalizeWorkspacePath(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return normalized ? normalized : "";
}

export function inheritWorkspaceSettings(thread) {
  const workspacePath = normalizeWorkspacePath(thread?.settings?.workspacePath);
  return workspacePath ? { workspacePath } : {};
}

export function isWorkspaceLocked(thread) {
  const storedTurnCount = Number.isFinite(thread?.storedTurnCount) ? Number(thread.storedTurnCount) : 0;
  const hasServerHistory = thread?.serverHistoryAvailable === true && storedTurnCount > 0;
  const hasServerThread = hasNonEmptyText(thread?.serverThreadId);
  const hasServerBackedTurn = Array.isArray(thread?.turns) && thread.turns.some(hasServerBackedTurnSignal);

  return hasServerHistory || hasServerThread || hasServerBackedTurn;
}

function hasServerBackedTurnSignal(turn) {
  return hasNonEmptyText(turn?.requestId)
    || hasNonEmptyText(turn?.taskId)
    || hasNonEmptyText(turn?.serverSessionId)
    || hasNonEmptyText(turn?.serverThreadId);
}

function hasNonEmptyText(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function buildWorkspaceNote(thread) {
  const workspacePath = normalizeWorkspacePath(thread?.settings?.workspacePath);
  const locked = isWorkspaceLocked(thread);

  if (!workspacePath) {
    return locked
      ? "当前会话还没有单独绑定工作区，会回退到 Themis 启动目录。这个会话已经执行过任务，如需修改请先新建会话。"
      : "当前会话还没有单独绑定工作区，会回退到 Themis 启动目录。";
  }

  return locked
    ? `当前会话工作区：${workspacePath}。这个会话已经执行过任务，如需换目录请先新建会话。`
    : `当前会话工作区：${workspacePath}。只对当前会话生效，新会话会默认继承。`;
}
