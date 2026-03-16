import {
  assistantCardClass,
  assistantHeadline,
  badgeToneForStatus,
  formatStatusLabel,
} from "./copy.js";

export function renderThreadButton(thread, { active, busy, status, escapeHtml }) {
  const resolvedStatus = status ?? "idle";
  const statusTone = badgeToneForStatus(resolvedStatus);
  const statusLabel = formatStatusLabel(resolvedStatus);

  return `
    <button
      type="button"
      class="thread-button"
      data-thread-id="${escapeHtml(thread.id)}"
      aria-current="${active ? "true" : "false"}"
      ${busy ? "disabled" : ""}
    >
      <span class="thread-title">${escapeHtml(thread.title)}</span>
      <span class="thread-status-inline ${escapeHtml(statusTone)}">
        <span class="thread-status-dot" aria-hidden="true"></span>
        <span>${escapeHtml(statusLabel)}</span>
      </span>
    </button>
  `;
}

export function renderTurnMarkup(turn, index, { store, utils }) {
  const assistantMessages = store.getVisibleAssistantMessages(turn);
  const assistantStreamMarkup = assistantMessages.length
    ? renderAssistantMessages(assistantMessages, utils, { showOperatorDetails: false })
    : "";
  const resultMarkup = turn.result
    ? renderResultBlock(turn.result, utils)
      : "";
  const assistantSummaryMarkup = !turn.result && !assistantMessages.length
    ? `<div class="assistant-summary">${utils.escapeHtml(store.latestTurnMessage(turn))}</div>`
    : "";

  return `
    <section class="message-row user-row" aria-label="用户请求">
      <article class="message-card user-card">
        <div class="bubble-meta">
          <span>你</span>
        </div>
        <p class="bubble-body">${utils.escapeHtml(turn.goal)}</p>
        ${turn.inputText ? `<div class="context-snippet">${utils.escapeHtml(turn.inputText)}</div>` : ""}
      </article>
    </section>

    <section class="message-row assistant-row" aria-label="Themis 响应">
      <article class="message-card assistant-card ${assistantCardClass(turn.state)}">
        <div class="assistant-head">
          <div>
            <h3>Themis</h3>
            <p class="assistant-copy">${assistantHeadline(turn)}</p>
          </div>
          <span class="badge ${badgeToneForStatus(turn.state)}">${formatStatusLabel(turn.state)}</span>
        </div>
        ${assistantSummaryMarkup}
        ${assistantStreamMarkup}
        ${resultMarkup}
      </article>
    </section>
  `;
}

function renderAssistantMessages(messages, utils, { showOperatorDetails }) {
  if (!Array.isArray(messages) || !messages.length) {
    return "";
  }

  const streamClass = showOperatorDetails ? "assistant-stream operator" : "assistant-stream chat";
  const headMarkup = showOperatorDetails
    ? `
      <div class="assistant-stream-head">
        <p class="assistant-stream-kicker">过程消息</p>
        <span class="assistant-stream-count">${messages.length} 条</span>
      </div>
    `
    : "";

  return `
    <section class="${streamClass}" aria-label="${showOperatorDetails ? "过程消息" : "assistant 消息"}">
      ${headMarkup}
      <div class="assistant-stream-list">
        ${messages.map((message, index) => renderAssistantMessage(message, index, utils, { showOperatorDetails })).join("")}
      </div>
    </section>
  `;
}

function renderAssistantMessage(message, index, utils, { showOperatorDetails }) {
  const indexMarkup = showOperatorDetails
    ? `<div class="assistant-stream-index">${index + 1}</div>`
    : "";
  const itemClass = showOperatorDetails ? "assistant-stream-item operator" : "assistant-stream-item chat";

  return `
    <article class="${itemClass}">
      ${indexMarkup}
      <p class="assistant-stream-copy">${utils.escapeHtml(message.text)}</p>
    </article>
  `;
}

export function renderHistoryLoadingState(thread, turnCount, escapeHtml) {
  return `
    <div class="empty-thread history-placeholder">
      <p class="empty-kicker">历史载入中</p>
      <h3>${escapeHtml(thread.title)}</h3>
      <p>正在从本机 SQLite 历史中恢复这个会话的 ${turnCount} 条任务记录。</p>
    </div>
  `;
}

export function renderStoredSummaryState(thread, escapeHtml) {
  return `
    <div class="empty-thread history-placeholder">
      <p class="empty-kicker">仅有摘要</p>
      <h3>${escapeHtml(thread.title)}</h3>
      <p>${escapeHtml(thread.storedSummary || "这个会话已经出现在历史列表中，但本机暂时没有可恢复的完整任务详情。")}</p>
    </div>
  `;
}

function renderStep(step, index, utils) {
  const metaMarkup = step.metadata ? `<pre class="step-meta">${utils.escapeHtml(JSON.stringify(step.metadata, null, 2))}</pre>` : "";
  return `
    <article class="step-item ${utils.escapeHtml(step.tone)}">
      <div class="step-index">${index + 1}</div>
      <div>
        <p class="step-title">${utils.escapeHtml(step.title)}</p>
        <p class="step-copy">${utils.escapeHtml(step.text)}</p>
        ${metaMarkup}
      </div>
    </article>
  `;
}

function renderResultBlock(result, utils) {
  const summaryText = typeof result.summary === "string" ? result.summary.trim() : "";
  const outputText = typeof result.output === "string" ? result.output.trim() : "";
  const summaryMarkup = summaryText && summaryText !== outputText ? utils.renderRichText(summaryText) : "";
  const output = outputText ? utils.renderRichText(outputText) : "";
  const touchedFiles = Array.isArray(result.touchedFiles) && result.touchedFiles.length
    ? `
      <div class="file-tags">
        ${result.touchedFiles.map((file) => `<span class="file-tag">${utils.escapeHtml(file)}</span>`).join("")}
      </div>
    `
    : "";

  return `
    <section class="result-surface ${result.status === "failed" ? "failed" : ""}">
      <div class="result-head">
        <div>
          <h4>最终结果</h4>
          <p class="result-meta">状态：${utils.escapeHtml(result.status ?? "unknown")}</p>
        </div>
      </div>
      ${summaryMarkup || (!output ? utils.renderRichText(result.summary ?? "无") : "")}
      ${output}
      ${touchedFiles}
    </section>
  `;
}
