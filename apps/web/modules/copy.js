export function formatEventTitle(title) {
  const labels = {
    "task.received": "请求已入队",
    "task.accepted": "线程已建立",
    "task.context_built": "上下文已发送",
    "task.started": "Codex 已启动",
    "task.progress": "执行中",
    "task.memory_updated": "记忆已更新",
    "task.action_required": "需要动作",
    "task.completed": "任务完成",
    "task.failed": "任务失败",
    "task.cancelled": "任务取消",
  };

  return labels[title] ?? title;
}

export function resolveToneFromTitle(title) {
  if (title === "task.failed") {
    return "error";
  }

  if (title === "task.action_required") {
    return "busy";
  }

  if (title === "task.completed" || title === "task.cancelled") {
    return "success";
  }

  return "neutral";
}

export function formatStatusLabel(status) {
  const labels = {
    idle: "空闲",
    queued: "排队中",
    running: "执行中",
    waiting: "等待中",
    completed: "完成",
    failed: "失败",
    cancelled: "已取消",
  };

  return labels[status] ?? status;
}

export function badgeToneForStatus(status) {
  if (status === "running" || status === "queued") {
    return "busy";
  }

  if (status === "waiting") {
    return "busy";
  }

  if (status === "failed") {
    return "error";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  return "idle";
}

export function assistantHeadline(turn) {
  const labels = {
    queued: "正在排队并建立执行通道。",
    running: "正在把这条任务交给 Codex 执行。",
    waiting: "正在等待 action 回复。",
    completed: "这条任务已经完成。",
    failed: "这条任务执行失败。",
    cancelled: "这条任务已被取消。",
  };

  return labels[turn.state] ?? "等待处理。";
}

export function assistantCardClass(stateValue) {
  if (stateValue === "running" || stateValue === "queued" || stateValue === "waiting") {
    return "is-running";
  }

  if (stateValue === "failed" || stateValue === "cancelled") {
    return "is-error";
  }

  return "is-done";
}
