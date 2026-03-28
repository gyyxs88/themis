export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function safeReadJson(response) {
  try {
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      window.location?.assign &&
      window.location.pathname !== "/login"
    ) {
      window.location.assign("/login");
    }

    return await response.json();
  } catch {
    return null;
  }
}

export function autoResizeTextarea(textarea) {
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, 240);
  textarea.style.height = `${Math.max(nextHeight, 72)}px`;
}

export function scrollConversationToBottom(conversation) {
  requestAnimationFrame(() => {
    conversation.scrollTo({
      top: conversation.scrollHeight,
      behavior: "smooth",
    });
  });
}

export function titleFromGoal(goal) {
  const normalized = String(goal ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > 30 ? `${normalized.slice(0, 30)}…` : normalized;
}

export function summarizeForSidebar(text, maxLength = 56) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "还没有任务，发送第一条消息开始。";
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

export function pickEarlierTimestamp(current, incoming) {
  if (!incoming) {
    return current;
  }

  if (!current) {
    return incoming;
  }

  return new Date(incoming).getTime() < new Date(current).getTime() ? incoming : current;
}

export function pickLaterTimestamp(current, incoming) {
  if (!incoming) {
    return current;
  }

  if (!current) {
    return incoming;
  }

  return new Date(incoming).getTime() > new Date(current).getTime() ? incoming : current;
}

export function formatRelativeTime(iso) {
  if (!iso) {
    return "刚刚";
  }

  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(delta / 60000);

  if (minutes <= 1) {
    return "刚刚";
  }

  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} 小时前`;
  }

  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

export function parseJsonText(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function renderRichText(text) {
  const normalized = String(text ?? "").trim();

  if (!normalized) {
    return "";
  }

  const regex = /```([\w-]+)?\n?([\s\S]*?)```/g;
  let cursor = 0;
  let html = "";
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    html += renderParagraphs(normalized.slice(cursor, match.index));
    html += `<pre class="code-block"><code>${escapeHtml(match[2].trimEnd())}</code></pre>`;
    cursor = match.index + match[0].length;
  }

  html += renderParagraphs(normalized.slice(cursor));
  return `<div class="rich-text">${html}</div>`;
}

export function renderParagraphs(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)
    .join("");
}
