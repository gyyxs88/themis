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
  const title = thread?.historyArchivedAt ? `${thread.title} · 已归档` : thread.title;

  return `
    <button
      type="button"
      class="thread-button"
      data-thread-id="${escapeHtml(thread.id)}"
      aria-current="${active ? "true" : "false"}"
      ${busy ? "disabled" : ""}
    >
      <span class="thread-title">${escapeHtml(title)}</span>
      <span class="thread-status-inline ${escapeHtml(statusTone)}">
        <span class="thread-status-dot" aria-hidden="true"></span>
        <span>${escapeHtml(statusLabel)}</span>
      </span>
    </button>
  `;
}

export function renderThreadRiskBannerMarkup(riskState, utils) {
  if (!riskState) {
    return "";
  }

  const tone = riskState.tone === "warning" ? "warning" : "neutral";
  const actionKind = typeof riskState.actionKind === "string" ? riskState.actionKind : "";
  const actionLabel = typeof riskState.actionLabel === "string" ? riskState.actionLabel : "";
  const threadId = typeof riskState.threadId === "string" ? riskState.threadId : "";
  const turnId = typeof riskState.turnId === "string" ? riskState.turnId : "";
  const actionMarkup = actionKind && actionLabel
    ? `
      <button
        type="button"
        class="thread-risk-banner-action toolbar-button"
        data-risk-banner-action="${utils.escapeHtml(actionKind)}"
        ${threadId ? `data-thread-id="${utils.escapeHtml(threadId)}"` : ""}
        ${turnId ? `data-turn-id="${utils.escapeHtml(turnId)}"` : ""}
      >
        ${utils.escapeHtml(actionLabel)}
      </button>
    `
    : "";

  return `
    <div class="thread-risk-banner-shell tone-${tone}" data-risk-banner-kind="${utils.escapeHtml(riskState.kind ?? "unknown")}">
      <div class="thread-risk-banner-copy">
        <p class="thread-risk-banner-kicker">任务提醒</p>
        <p class="thread-risk-banner-message">${utils.escapeHtml(riskState.message ?? "")}</p>
      </div>
      ${actionMarkup}
    </div>
  `;
}

export function renderThreadControlSourceMarkup(threadControlState, utils) {
  if (!threadControlState?.source?.label) {
    return "";
  }

  const tone = threadControlState.source.kind === "attached"
    ? "success"
    : threadControlState.source.kind === "fork"
      ? "warning"
      : "idle";

  return `<span class="badge ${utils.escapeHtml(tone)}">${utils.escapeHtml(threadControlState.source.label)}</span>`;
}

export function renderThreadControlDetailsMarkup(threadControlState, utils) {
  const details = Array.isArray(threadControlState?.details) ? threadControlState.details : [];

  if (!details.length) {
    return "";
  }

  return `
    <dl class="thread-control-detail-list">
      ${details.map((item) => `
        <div class="thread-control-detail-item">
          <dt>${utils.escapeHtml(item.label ?? "")}</dt>
          <dd>${utils.escapeHtml(item.value ?? "")}</dd>
        </div>
      `).join("")}
    </dl>
  `;
}

export function renderComposerActionBarMarkup(actionBarState, utils) {
  const state = normalizeComposerActionBarState(actionBarState);
  const modeLabel = resolveComposerModeLabel(state.mode);
  const modeCopy = resolveComposerActionBarCopy(state);
  const reviewButton = renderComposerModeButton("review", "Review", state.review, state.mode, utils);
  const steerButton = renderComposerModeButton("steer", "Steer", state.steer, state.mode, utils);
  const exitMarkup = state.mode !== "chat"
    ? `
      <div class="composer-action-bar-exit">
        <button type="button" class="toolbar-button composer-mode-exit-button" data-composer-mode-button="chat">
          退出动作模式
        </button>
      </div>
    `
    : "";

  return `
    <section class="composer-action-bar" aria-label="显式动作模式" data-composer-mode="${utils.escapeHtml(state.mode)}">
      <div class="composer-action-bar-copy">
        <p class="composer-action-bar-status">${utils.escapeHtml(modeLabel)}</p>
        <p class="composer-action-bar-message">${utils.escapeHtml(modeCopy)}</p>
      </div>
      <div class="composer-action-bar-controls">
        ${reviewButton}
        ${steerButton}
      </div>
      ${exitMarkup}
    </section>
  `;
}

export function renderDraftInputAssetsMarkup(draftInputAssets, utils) {
  const assets = Array.isArray(draftInputAssets) ? draftInputAssets : [];

  if (!assets.length) {
    return "";
  }

  return `
    <div class="composer-input-assets-shell">
      <p class="composer-input-assets-label">已添加附件</p>
      <ul class="composer-input-assets-list">
        ${assets.map((asset, index) => `
          <li class="composer-input-assets-item">
            <span class="composer-input-assets-name">${utils.escapeHtml(asset.name ?? asset.localPath ?? `asset-${index + 1}`)}</span>
            <button
              type="button"
              class="toolbar-button composer-input-assets-remove"
              data-draft-input-asset-remove="${index}"
            >
              移除
            </button>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

export function renderTurnMarkup(turn, index, { thread = null, store, utils }) {
  const assistantLabel = store.resolveAssistantDisplayLabel(turn.options);
  const assistantMessages = store.getVisibleAssistantMessages(turn);
  const turnActionState = typeof store.resolveTurnActionState === "function"
    ? store.resolveTurnActionState(thread, turn)
    : null;
  const actionSurfaceMarkup = renderTurnActionSurface(turnActionState, turn, thread, utils);
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

    <section
      class="message-row assistant-row"
      id="turn-anchor-${utils.escapeHtml(turn.id)}"
      data-turn-id="${utils.escapeHtml(turn.id)}"
      aria-label="Themis 响应"
      tabindex="-1"
    >
      <article class="message-card assistant-card ${assistantCardClass(turn.state)}">
        <div class="assistant-head">
          <div>
            <h3>${utils.escapeHtml(assistantLabel)}</h3>
            <p class="assistant-copy">${assistantHeadline(turn)}</p>
          </div>
          <span class="badge ${badgeToneForStatus(turn.state)}">${formatStatusLabel(turn.state)}</span>
        </div>
        ${actionSurfaceMarkup}
        ${assistantSummaryMarkup}
        ${assistantStreamMarkup}
        ${resultMarkup}
      </article>
    </section>
  `;
}

function normalizeComposerActionBarState(actionBarState) {
  return {
    mode: normalizeComposerMode(actionBarState?.mode),
    review: normalizeComposerActionOption(actionBarState?.review),
    steer: normalizeComposerActionOption(actionBarState?.steer),
  };
}

function normalizeComposerMode(mode) {
  if (mode === "review" || mode === "steer" || mode === "chat") {
    return mode;
  }

  return "chat";
}

function normalizeComposerActionOption(option) {
  return {
    enabled: Boolean(option?.enabled),
    reason: typeof option?.reason === "string" ? option.reason : "",
  };
}

function resolveComposerModeLabel(mode) {
  if (mode === "review") {
    return "当前模式：Review";
  }

  if (mode === "steer") {
    return "当前模式：Steer";
  }

  return "当前模式：普通发送";
}

function resolveComposerActionBarCopy(actionBarState) {
  if (actionBarState.mode === "review") {
    return "将对当前会话最近一轮已收口结果发起 review";
  }

  if (actionBarState.mode === "steer") {
    return "将把这条调整意见发给当前执行中的任务";
  }

  const disabledReasons = [actionBarState.review, actionBarState.steer]
    .filter((option) => !option.enabled && option.reason)
    .map((option) => option.reason);

  if (disabledReasons.length) {
    return disabledReasons.join(" ");
  }

  return "选择一种显式动作模式，或继续普通发送。";
}

function renderComposerModeButton(mode, label, option, activeMode, utils) {
  const active = activeMode === mode;
  const disabledReasonId = option.reason ? `composer-${mode}-reason` : "";
  const unavailable = !option.enabled;
  const classes = [
    "toolbar-button",
    "composer-mode-button",
    active ? "active" : "",
    unavailable ? "unavailable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="composer-mode-card">
      <button
        type="button"
        class="${classes}"
        data-composer-mode-button="${utils.escapeHtml(mode)}"
        ${unavailable ? 'data-composer-mode-unavailable="true"' : ""}
        aria-pressed="${active ? "true" : "false"}"
        ${disabledReasonId ? `aria-describedby="${disabledReasonId}"` : ""}
      >
        ${utils.escapeHtml(label)}
      </button>
      ${option.reason
        ? `<p class="composer-mode-reason" id="${disabledReasonId}">${utils.escapeHtml(option.reason)}</p>`
        : ""}
    </div>
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

function renderTurnActionSurface(actionState, turn, thread, utils) {
  if (!actionState) {
    return "";
  }

  if (actionState.kind === "waiting") {
    return renderWaitingActionSurface(actionState, turn, thread, utils);
  }

  if (actionState.kind === "rehydrating") {
    return renderRecoveryActionSurface(actionState, turn, thread, utils);
  }

  return "";
}

function renderWaitingActionSurface(actionState, turn, thread, utils) {
  const actionType = actionState.actionType || "approval";
  const threadId = typeof thread?.id === "string" ? thread.id : "";
  const actionLabel = actionState.prompt || "等待处理中的 action。";
  const actionChoices = actionType === "approval"
    ? resolveApprovalChoices(actionState.choices)
    : [];
  const choiceMarkup = actionType === "approval"
    ? `
      <div class="turn-action-choice-row">
        ${actionChoices.map((choice) => `
          <button
            type="button"
            class="choice-chip turn-action-choice"
            data-turn-action-kind="waiting"
            data-waiting-action-decision="${utils.escapeHtml(choice.decision)}"
            ${threadId ? `data-thread-id="${utils.escapeHtml(threadId)}"` : ""}
            data-turn-id="${utils.escapeHtml(turn.id)}"
            ${actionState.submitting ? "disabled" : ""}
          >
            ${utils.escapeHtml(choice.label)}
          </button>
        `).join("")}
      </div>
    `
    : `
      <form class="turn-action-input-form" data-turn-action-kind="waiting" data-waiting-action-type="${utils.escapeHtml(actionType)}">
        <label class="turn-action-input-label" for="turn-action-input-${utils.escapeHtml(turn.id)}">
          输入回复
        </label>
        <textarea
          id="turn-action-input-${utils.escapeHtml(turn.id)}"
          class="turn-action-input"
          rows="4"
          data-turn-id="${utils.escapeHtml(turn.id)}"
          ${threadId ? `data-thread-id="${utils.escapeHtml(threadId)}"` : ""}
          placeholder="请输入回复">${utils.escapeHtml(actionState.inputText || "")}</textarea>
        <div class="turn-action-input-footer">
          <button
            type="submit"
            class="primary-button turn-action-submit"
            data-turn-action-kind="waiting"
            data-waiting-action-type="${utils.escapeHtml(actionType)}"
            data-turn-id="${utils.escapeHtml(turn.id)}"
            ${threadId ? `data-thread-id="${utils.escapeHtml(threadId)}"` : ""}
            ${actionState.submitting ? "disabled" : ""}
          >
            提交回复
          </button>
        </div>
      </form>
    `;
  const errorMarkup = actionState.errorMessage
    ? `<p class="turn-action-error">${utils.escapeHtml(actionState.errorMessage)}</p>`
    : "";

  return `
    <section
      class="turn-action-surface waiting"
      data-turn-action-kind="waiting"
      data-turn-id="${utils.escapeHtml(turn.id)}"
      ${threadId ? `data-thread-id="${utils.escapeHtml(threadId)}"` : ""}
    >
      <div class="turn-action-head">
        <div>
          <p class="turn-action-kicker">${utils.escapeHtml(actionState.heading || "等待处理")}</p>
          <p class="turn-action-copy">${utils.escapeHtml(actionLabel)}</p>
        </div>
        <span class="badge busy">等待中</span>
      </div>
      ${choiceMarkup}
      ${errorMarkup}
    </section>
  `;
}

function renderRecoveryActionSurface(actionState, turn, thread, utils) {
  const threadId = typeof thread?.id === "string" ? thread.id : "";

  return `
    <section
      class="turn-action-surface recovery"
      data-turn-action-kind="rehydrating"
      data-turn-id="${utils.escapeHtml(turn.id)}"
      ${threadId ? `data-thread-id="${utils.escapeHtml(threadId)}"` : ""}
    >
      <div class="turn-action-head">
        <div>
          <p class="turn-action-kicker">${utils.escapeHtml(actionState.heading || "状态同步中")}</p>
          <p class="turn-action-copy">${utils.escapeHtml(actionState.prompt || "")}</p>
        </div>
      </div>
    </section>
  `;
}

function resolveApprovalChoices(choices) {
  const normalizedChoices = Array.isArray(choices) && choices.length
    ? choices
    : ["approve", "deny"];

  return normalizedChoices.map((choice) => {
    const decision = String(choice);
    const normalized = decision.trim().toLowerCase();

    if (normalized === "approve") {
      return { decision, label: "批准" };
    }

    if (normalized === "deny" || normalized === "reject") {
      return { decision: "deny", label: "拒绝" };
    }

    return { decision, label: decision };
  });
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
  const quotaFooterText = resolveReplyQuotaFooterText(result);
  const summaryMarkup = summaryText && summaryText !== outputText ? utils.renderRichText(summaryText) : "";
  const output = outputText ? utils.renderRichText(outputText) : "";
  const touchedFiles = Array.isArray(result.touchedFiles) && result.touchedFiles.length
    ? `
      <div class="file-tags">
        ${result.touchedFiles.map((file) => `<span class="file-tag">${utils.escapeHtml(file)}</span>`).join("")}
      </div>
    `
    : "";
  const quotaFooter = quotaFooterText
    ? `<p class="reply-quota-footer">${utils.escapeHtml(quotaFooterText)}</p>`
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
      ${quotaFooter}
    </section>
  `;
}

function resolveReplyQuotaFooterText(result) {
  const footer = result?.structuredOutput?.replyQuota;

  if (!footer || typeof footer !== "object") {
    return "";
  }

  return typeof footer.text === "string" ? footer.text.trim() : "";
}
