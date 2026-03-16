import {
  assistantCardClass,
  assistantHeadline,
  badgeToneForStatus,
  formatStatusLabel,
} from "./copy.js";

export function renderThreadButton(thread, { active, busy, escapeHtml }) {
  return `
    <button
      type="button"
      class="thread-button"
      data-thread-id="${escapeHtml(thread.id)}"
      aria-current="${active ? "true" : "false"}"
      ${busy ? "disabled" : ""}
    >
      <span class="thread-title">${escapeHtml(thread.title)}</span>
    </button>
  `;
}

export function renderTurnMarkup(turn, index, { store, utils }) {
  const details = JSON.stringify(
    {
      state: turn.state,
      workflow: turn.workflow,
      role: turn.role,
      options: turn.options ?? null,
      requestId: turn.requestId,
      taskId: turn.taskId,
      serverThreadId: turn.serverThreadId,
      serverSessionId: turn.serverSessionId,
      sessionMode: turn.sessionMode,
      hasContext: Boolean(turn.inputText),
      createdAt: turn.createdAt,
      stepCount: turn.steps.length,
    },
    null,
    2,
  );

  const resultMarkup = turn.result
    ? renderResultBlock(turn.result, utils)
    : `
      <section class="result-surface placeholder">
        <div class="result-head">
          <div>
            <h4>最终结果</h4>
            <p class="result-empty">结果会在这里出现。</p>
          </div>
        </div>
      </section>
    `;

  return `
    <section class="message-row user-row" aria-label="用户请求">
      <article class="message-card user-card">
        <div class="bubble-meta">
          <span>你</span>
          <span>${utils.escapeHtml(turn.workflow)}</span>
          <span>${utils.escapeHtml(turn.role)}</span>
          <span>第 ${index} 条任务</span>
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
        <div class="assistant-summary">${utils.escapeHtml(store.latestTurnMessage(turn))}</div>
        <div class="step-list">${turn.steps.map((step, stepIndex) => renderStep(step, stepIndex, utils)).join("")}</div>
        ${resultMarkup}
        <details class="tools-details turn-details">
          <summary>查看本次任务详情</summary>
          <pre class="meta-panel">${utils.escapeHtml(details)}</pre>
        </details>
      </article>
    </section>
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
  const output = result.output ? utils.renderRichText(result.output) : "";
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
      ${utils.renderRichText(result.summary ?? "无")}
      ${output}
      ${touchedFiles}
    </section>
  `;
}
